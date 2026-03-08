// /public/js/config-helpers.js

// === Normalización de publicación ML (MLC / sin MLC, espacios, símbolos) ===7

// === Cache del Stock ML (configuracion.xlsx) ===
let __stockMlConfigCache = null;

function normalizeMlPublication(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\u00A0/g, '')
    .replace(/\s+/g, '')
    .replace(/^MLC/, '')
    .replace(/[^A-Z0-9]/g, '');
}

// === Normalización de headers (sin acentos) ===
function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeBarcode(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '');
}

// === Detección flexible de columnas ===
function detectColumn(headers, candidates) {
  const normalized = headers.map((h) => ({ original: h, normalized: normalizeHeader(h) }));
  for (const c of candidates) {
    const exact = normalized.find((h) => h.normalized === c);
    if (exact) return exact.original;
  }
  for (const c of candidates) {
    const found = normalized.find((h) => h.normalized.includes(c));
    if (found) return found.original;
  }
  return null;
}

// === Parse numérico robusto ===
function toNumber(value) {
  if (typeof value === 'number') return value;
  const parsed = Number(
    String(value || '')
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[^0-9.-]/g, '')
  );
  return Number.isFinite(parsed) ? parsed : 0;
}

// === Cargar Stock ML desde configuracion.xlsx (hoja "Stock ML") ===
async function loadStockMlConfigFromConfig() {
  if (__stockMlConfigCache) return __stockMlConfigCache;

  const res = await fetch('/validar-ml/configuracion.xlsx', { cache: 'no-store' });
  if (!res.ok) throw new Error('No se pudo cargar configuracion.xlsx');

  const arrayBuffer = await res.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  const sheetName =
    workbook.SheetNames.find((n) => normalizeHeader(n).includes('stock ml')) ||
    workbook.SheetNames.find((n) => normalizeHeader(n).includes('stockml'));

  if (!sheetName) {
    __stockMlConfigCache = new Map();
    return __stockMlConfigCache;
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

  const headers = Object.keys(rows[0] || {});
  const pubCol = detectColumn(headers, ['numero de publicacion', 'publicacion']);
  const unitsCol = detectColumn(headers, ['unidades', 'unidad', 'units']);
  const maxMlCol = detectColumn(headers, ['cantidad', 'maximo', 'max ml', 'stock ml']);

  const map = new Map();
  rows.forEach((r) => {
    const pubRaw = pubCol ? r[pubCol] : r[Object.keys(r)[0]];
    const maxMlRaw = maxMlCol ? r[maxMlCol] : r[Object.keys(r)[1]];
    const unitsRaw = unitsCol ? r[unitsCol] : r[Object.keys(r)[2]];

    const pub = normalizeMlPublication(pubRaw);
    const maxMl = toNumber(maxMlRaw) || 2;   // 👈 default 2 si vacío
    const units = toNumber(unitsRaw) || 1;   // 👈 default 1 si vacío

    if (pub) {
      map.set(pub, { maxMl, units });
    }
  });

  __stockMlConfigCache = map;
  return map;
}

// === Cálculo de cantidad real a despachar (kit-aware) ===
async function calcularCantidadDespacho(pubML, unidadesML) {
  const map = await loadStockMlConfigFromConfig();
  const key = normalizeMlPublication(pubML);
  const cfg = map.get(key);              // { maxMl, units }

  const uML = Number(unidadesML) || 0;
  const unitsPerKit = cfg?.units ?? 1;   // 👈 si no es kit, 1

  return unitsPerKit * uML;
}

// === Cache variantes validar ===
let variantesValidarCache = null;

async function loadVariantesValidarFromConfig() {
  if (variantesValidarCache) return variantesValidarCache;

  try {
    const res = await fetch('/validar-ml/configuracion.xlsx', { cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo cargar configuracion.xlsx');

    const arrayBuffer = await res.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    if (!__stockMlConfigCache) {
      __stockMlConfigCache = new Map();
    }

    // 🔹 Buscar hoja packs después de leer el workbook
    const packsSheet = workbook.SheetNames.find(n =>
      normalizeHeader(n).includes('pack')
    );

    if (packsSheet) {
      const sheet = workbook.Sheets[packsSheet];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      const packMap = new Map();

      rows.forEach(r => {

        const pub = normalizeMlPublication(r[0]);
        const sku = normalizeMlPublication(r[1]);

        if (!pub || !sku) return;

        if (!packMap.has(pub)) packMap.set(pub, []);

        packMap.get(pub).push(sku);

      });

      packMap.forEach((skus, pub) => {

        if (!__stockMlConfigCache) {
          __stockMlConfigCache = new Map();
        }

        const existing = __stockMlConfigCache.get(pub) || {};

        __stockMlConfigCache.set(pub, {
          ...existing,
          skus
        });

      });

    }

    if (!__stockMlConfigCache) {
      __stockMlConfigCache = new Map();
    }

    const sheetName =
      workbook.SheetNames.find((n) => normalizeHeader(n).includes('variantes validar')) ||
      workbook.SheetNames.find((n) => normalizeHeader(n).includes('variantes'));

    if (!sheetName) {
      variantesValidarCache = new Set();
      return variantesValidarCache;
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

    const set = new Set(
      rows
        .map((r) =>
          normalizeVariantColor(r[Object.keys(r)[0]])
            .replace(/[-_/]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        )
        .filter(Boolean)
    );

    variantesValidarCache = set;
    //console.log('VARIANTES VALIDAR cargadas:', Array.from(set));
    return set;
  } catch (e) {
    console.warn('No se pudo cargar VARIANTES VALIDAR desde configuracion.xlsx.', e);
    variantesValidarCache = new Set();
    return variantesValidarCache;
  }
}