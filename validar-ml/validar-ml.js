const mlFileInput = document.getElementById('mlFile');
const analyzeBtn = document.getElementById('analyzeBtn');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const resultsEl = document.getElementById('results');
const resultsBody = document.getElementById('resultsBody');
const actionCountersEl = document.getElementById('actionCounters');

let lastObservations = [];
let activeFilter = 'ALL';
let omitidosSetCache = null;

function normalizeHeader(str) {
  return String(str || '')
    .normalize('NFD')                 // separa letras de acentos
    .replace(/[\u0300-\u036f]/g, '')  // quita los acentos
    .toLowerCase()
    .trim();
}

function validarExcelPublicacionesML(rows) {
  // En tu export de ML, los encabezados reales están en la fila 3 (index 2)
  const headerRow = rows[2] || [];
  const header = headerRow.map(h => normalizeHeader(h));

  // Columnas reales típicas de Publicaciones ML
  const clavesML = [
    'numero de publicacion',
    'titulo',
    'variantes',
    'sku',
    'en mi deposito'
  ];

  // Columnas típicas de Ventas / Odoo para descartar
  const clavesNoML = [
    '# de venta',
    'fecha de venta',
    'total (clp)'
  ];

  const pareceML = clavesML.some(k => header.some(h => h.includes(k)));
  const pareceVentas = clavesNoML.some(k => header.some(h => h.includes(k)));

  return pareceML && !pareceVentas;
}

async function loadOmitidosFromConfig() {
  if (omitidosSetCache) return omitidosSetCache;

  try {
    const res = await fetch('/validar-ml/configuracion.xlsx', { cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo cargar configuracion.xlsx');

    const arrayBuffer = await res.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    const sheetName =
      workbook.SheetNames.find((n) => normalizeHeader(n).includes('omitidos')) ||
      workbook.SheetNames[0];

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

    const set = new Set(
      rows
        .map((r) =>
          normalizeMlPublication(
            r['Número de publicación'] ||
              r['Publicacion'] ||
              r['Código'] ||
              r['Codigo'] ||
              r[Object.keys(r)[0]]
          )
        )
        .filter(Boolean)
    );

    omitidosSetCache = set;
    console.log('OMITIDOS cargados:', Array.from(set));
    return set;
  } catch (e) {
    console.warn('No se pudo cargar configuracion.xlsx (OMITIDOS). Se continúa sin OMITIDOS.', e);
    omitidosSetCache = new Set();
    return omitidosSetCache;
  }
}

let stockMlConfigCache = null;

async function loadStockMlConfigFromConfig() {
  if (stockMlConfigCache) return stockMlConfigCache;

  try {
    const res = await fetch('/validar-ml/configuracion.xlsx', { cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo cargar configuracion.xlsx');

    const arrayBuffer = await res.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    const sheetName =
      workbook.SheetNames.find((n) => normalizeHeader(n).includes('stock ml')) ||
      workbook.SheetNames.find((n) => normalizeHeader(n).includes('stockml'));

    if (!sheetName) {
      stockMlConfigCache = new Map();
      return stockMlConfigCache;
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

    const map = new Map();

    if (!rows.length) {
      stockMlConfigCache = map;
      return stockMlConfigCache;
    }

    const headers = Object.keys(rows[0] || {});
    const pubCol = detectColumn(headers, ['numero de publicacion']);
    const maxCol = detectColumn(headers, ['cantidad']);
    const unitsCol = detectColumn(headers, ['unidades']);

    rows.forEach((r) => {
      const pub = normalizeMlPublication(r[pubCol] || r[Object.keys(r)[0]]);
      const maxMl = toNumber(r[maxCol] || r[Object.keys(r)[1]]);
      const units = toNumber(r[unitsCol] || r[Object.keys(r)[2]]);

      if (pub && Number.isFinite(maxMl) && maxMl > 0) {
        map.set(pub, {
          maxMl,
          units: Number.isFinite(units) && units > 0 ? units : 1, // default unidades = 1
        });
      }
    });

    stockMlConfigCache = map;
    console.log('STOCK ML config cargado:', Array.from(map.entries()));
    return stockMlConfigCache;
  } catch (e) {
    console.warn('No se pudo cargar STOCK ML desde configuracion.xlsx. Se usará máximo 2 y unidades=1.', e);
    stockMlConfigCache = new Map();
    return stockMlConfigCache;
  }
}

mlFileInput.addEventListener('click', () => {
  if (mlFileInput.files.length) {
    analyzeBtn.disabled = false;
  }
});

function renderActionCounters(rows) {
  const counts = rows.reduce(
    (acc, r) => {
      acc.OK += r.action === 'OK' ? 1 : 0;
      acc.SUBIR += r.action === 'SUBIR' ? 1 : 0;
      acc.BAJAR += r.action === 'BAJAR' ? 1 : 0;
      acc.OMITIDOS += r.action === 'OMITIDOS' ? 1 : 0;
      acc['NO ENCONTRADO'] += r.action === 'NO ENCONTRADO' ? 1 : 0;
      acc['2da. Sel.'] += r.action === '2da. Sel.' ? 1 : 0;
      acc.ALL += 1;
      return acc;
    },
    { OK: 0, SUBIR: 0, BAJAR: 0, 'NO ENCONTRADO': 0, '2da. Sel.': 0, OMITIDOS: 0, ALL: 0 }
  );

  actionCountersEl.innerHTML = `
    <span class="pill ${activeFilter === 'ALL' ? 'active' : ''}" data-filter="ALL">Todos: <strong>${counts.ALL}</strong></span>
    <span class="pill ${activeFilter === 'OK' ? 'active' : ''}" data-filter="OK">OK: <strong>${counts.OK}</strong></span>
    <span class="pill ${activeFilter === 'SUBIR' ? 'active' : ''}" data-filter="SUBIR">SUBIR: <strong>${counts.SUBIR}</strong></span>
    <span class="pill ${activeFilter === 'BAJAR' ? 'active' : ''}" data-filter="BAJAR">BAJAR: <strong>${counts.BAJAR}</strong></span>
    <span class="pill ${activeFilter === 'NO ENCONTRADO' ? 'active' : ''}" data-filter="NO ENCONTRADO">NO ENCONTRADO: <strong>${counts['NO ENCONTRADO']}</strong></span>
    <span class="pill ${activeFilter === '2da. Sel.' ? 'active' : ''}" data-filter="2da. Sel.">2da. Sel.: <strong>${counts['2da. Sel.']}</strong></span>
    <span class="pill ${activeFilter === 'OMITIDOS' ? 'active' : ''}" data-filter="OMITIDOS">OMITIDOS: <strong>${counts.OMITIDOS}</strong></span>
  `;

  actionCountersEl.classList.remove('hidden');

  actionCountersEl.querySelectorAll('.pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      activeFilter = pill.dataset.filter;
      applyActiveFilter();
    });
  });
}

function applyActiveFilter() {
  if (!lastObservations.length) return;

  const filtered =
    activeFilter === 'ALL'
      ? lastObservations
      : lastObservations.filter((row) => row.action === activeFilter);

  renderObservations(filtered);
  renderActionCounters(lastObservations);  // 👈 siempre usar el universo completo

  resultsEl.classList.remove('filter-SUBIR', 'filter-BAJAR');
  if (activeFilter === 'SUBIR') resultsEl.classList.add('filter-SUBIR');
  if (activeFilter === 'BAJAR') resultsEl.classList.add('filter-BAJAR');
}

function updateButtonState() {
  analyzeBtn.disabled = !mlFileInput.files.length;
}

mlFileInput.addEventListener('change', updateButtonState);

async function uploadPublicacionesML(file) {
  const fd = new FormData();
  fd.append("archivo", file);

  const res = await fetch("/api/ml/publicaciones", {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    throw new Error("No se pudo subir Publicaciones ML al servidor.");
  }

  return res.json();
}

async function fetchUltimasPublicacionesML() {
  const infoRes = await fetch("/api/ml/publicaciones/info", { cache: "no-store" });
  if (!infoRes.ok) {
    return null; // 👈 no hay aún
  }
  const info = await infoRes.json();

  const fileRes = await fetch("/api/ml/publicaciones/ultimo", { cache: "no-store" });
  if (!fileRes.ok) {
    throw new Error("No se pudo descargar Publicaciones ML.");
  }

  const buf = await fileRes.arrayBuffer();
  const file = new File([buf], info.file);

  return { file, info };
}

const mlInfoEl = document.getElementById("mlInfo");

analyzeBtn.addEventListener('click', async () => {
  try {
    clearView();

    if (!mlFileInput.files.length) {
      statusEl.textContent = 'Selecciona el archivo de Publicaciones ML para continuar.';
      return;
    }

    statusEl.textContent = 'Validando archivo de Publicaciones ML...';

    // 🔎 Leer Excel para validar
    const file = mlFileInput.files[0];
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    // 👇 Elegir la hoja correcta
    const sheetName =
      wb.SheetNames.find(n => normalizeHeader(n).includes('publicaciones')) ||
      wb.SheetNames[0];

    const ws = wb.Sheets[sheetName];

    // 👇 Leer filas crudas para validar encabezados en la fila 3
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

    if (!validarExcelPublicacionesML(rows)) {
      statusEl.textContent =
        '❌ El archivo seleccionado no corresponde a Publicaciones de MercadoLibre. ' +
        'Descárgalo desde MercadoLibre (Publicaciones → Modificar desde Excel → Descargar).';
      return;
    }

    statusEl.textContent = 'Subiendo Publicaciones ML...';

    // ⬆️ Subir archivo (ya validado)
    const uploadRes = await uploadPublicacionesML(file);

    statusEl.textContent = 'Cargando Variantes Odoo y Publicaciones ML...';

    // ⬇️ Descargar el archivo recién subido
    const mlFileRes = await fetch('/api/ml/publicaciones/ultimo', { cache: 'no-store' });
    if (!mlFileRes.ok) throw new Error('No se pudo descargar Publicaciones ML recién subidas.');
    const mlBuf = await mlFileRes.arrayBuffer();
    const mlFilePersistido = new File([mlBuf], uploadRes.file);

    const [
      { file: odooFile, info: odooInfo },
      omitidosSet,
      stockMlConfigMap,
      variantesValidarSet
    ] = await Promise.all([
      fetchUltimasVariantesOdoo(),
      loadOmitidosFromConfig(),
      loadStockMlConfigFromConfig(),
      loadVariantesValidarFromConfig(),
    ]);

    document.getElementById('odooInfo').innerText =
      `Variantes Odoo cargadas el: ${new Date(odooInfo.uploadedAt).toLocaleString()}`;

    mlInfoEl.innerText =
      `Publicaciones ML cargadas el: ${new Date(uploadRes.uploadedAt).toLocaleString()}`;

    statusEl.textContent = 'Procesando archivos...';

    const mlRows = await readExcelRows(mlFilePersistido, {
      preferredSheetNameIncludes: 'publicaciones',
      fallbackSheetIndex: 1,
      headerRowIndex: 2,
    });

    const odooRows = await readExcelRows(odooFile);

    const observations = buildObservations(
      odooRows,
      mlRows,
      omitidosSet,
      stockMlConfigMap,
      variantesValidarSet
    );

    lastObservations = observations;
    activeFilter = 'ALL';
    renderObservations(observations);
    renderActionCounters(observations);
    statusEl.textContent = '';

  } catch (error) {
    console.error(error);
    statusEl.textContent = `Error: ${error.message}`;
  }
});

function clearView() {
  summaryEl.innerHTML = '';
  resultsBody.innerHTML = '';
  summaryEl.classList.add('hidden');
  resultsEl.classList.add('hidden');
}

function normalizeMlVariantForOdoo(variant) {
  const v = normalizeVariantColor(variant)
    .replace(/\/+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Reglas de reemplazo específicas de negocio
  if (v === 'ambos lados' || v === 'ambos lado' || v === 'ambos lados ') {
    return 'amboslados';
  }

  return v;
}

function extractColorFromMlVariant(variantRaw) {
  if (!variantRaw) return '';

  const v = normalizeVariantColor(variantRaw);

  let cleaned = v
    // quitar izquierdo/derecho en todas sus formas
    .replace(/\bizquierdo\s*\/\s*derecho\b/g, '')
    .replace(/\bizquierdo\b/g, '')
    .replace(/\bderecho\b/g, '')
    // reglas existentes
    .replace(/amboslados|ambos lados/g, '')
    // separadores
    .replace(/[\/\-+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

function readExcelRows(file, options = {}) {
  if (!file) throw new Error('Falta cargar uno de los archivos.');

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: 'array' });
        const sheetName = pickSheetName(workbook.SheetNames, options);
        const sheet = workbook.Sheets[sheetName];

        const jsonOptions = { defval: '' };
        if (Number.isInteger(options.headerRowIndex) && options.headerRowIndex > 0) {
          jsonOptions.range = options.headerRowIndex;
        }

        const rows = XLSX.utils.sheet_to_json(sheet, jsonOptions);
        resolve(rows);
      } catch {
        reject(new Error(`No se pudo leer ${file.name}.`));
      }
    };
    reader.onerror = () => reject(new Error(`No se pudo abrir ${file.name}.`));
    reader.readAsArrayBuffer(file);
  });
}

function pickSheetName(sheetNames, options = {}) {
  const { preferredSheetNameIncludes = '', fallbackSheetIndex = 0 } = options;
  const norm = normalizeHeader(preferredSheetNameIncludes);
  return (
    sheetNames.find((n) => normalizeHeader(n).includes(norm)) ||
    sheetNames[fallbackSheetIndex] ||
    sheetNames[0]
  );
}

function normalizeHeader(header) {
  return String(header)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function detectColumn(headers, candidates) {
  const normalized = headers.map((h) => ({
    original: h,
    normalized: normalizeHeader(h),
  }));

  for (const candidate of candidates) {
    const exact = normalized.find((h) => h.normalized === candidate);
    if (exact) return exact.original;
  }
  for (const candidate of candidates) {
    const found = normalized.find((h) => h.normalized.includes(candidate));
    if (found) return found.original;
  }
  return null;
}

function normalizeMlPublication(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\u00A0/g, '')       // 👈 quita NBSP (espacios invisibles de Excel)
    .replace(/\s+/g, '')
    .replace(/^MLC/, '')
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeBarcode(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '');
}

function normalizeVariantColor(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isSecondSelection(text) {
  const t = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s.\-_/]/g, '');

  return (
    t.includes('2dasel') ||
    t.includes('2daseleccion') ||
    t.includes('segundaseleccion') ||
    t.includes('2daselec') ||
    t.includes ('2ªseleccion')
  );
}

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

let variantesValidarCache = null;

async function loadVariantesValidarFromConfig() {
  if (variantesValidarCache) return variantesValidarCache;

  try {
    const res = await fetch('/validar-ml/configuracion.xlsx', { cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo cargar configuracion.xlsx');

    const arrayBuffer = await res.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

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
    console.log('VARIANTES VALIDAR cargadas:', Array.from(set));
    return set;
  } catch (e) {
    console.warn('No se pudo cargar VARIANTES VALIDAR desde configuracion.xlsx.', e);
    variantesValidarCache = new Set();
    return variantesValidarCache;
  }
}

function extractBaseCodes(value) {
  const s = String(value || '').toUpperCase();

  // Quitar sufijo -1, -2, etc.
  const noSuffix = s.split('-')[0];

  // Separar por "/" para obtener todos los códigos base posibles
  const parts = noSuffix.split('/');

  // Limpiar cada parte (solo alfanumérico)
  return parts
    .map((p) => p.replace(/[^0-9A-Z]/g, ''))
    .filter(Boolean);
}

function matchesFibraCarbono(oVar, oName, mlVariant) {
  const a = 'fibra de carbono';
  const b = 'fibra carbono';

  if (mlVariant === a || mlVariant === b) {
    if (oVar) return oVar === a || oVar === b;
    return oName.includes(a) || oName.includes(b);
  }
  return false;
}

function normalizeMlCategory(text) {
  return normalizeVariantColor(text || '')
    .replace(/\bizquierdo\s*\/\s*derecho\b/g, '')  // quita "izquierdo/derecho"
    .replace(/\bizquierdo\b/g, '')                 // por si vienen sueltos
    .replace(/\bderecho\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchUltimasVariantesOdoo() {
  const infoRes = await fetch('/api/odoo/variantes/info', { cache: 'no-store' });
  if (!infoRes.ok) {
    throw new Error('No hay Variantes Odoo cargadas aún.');
  }
  const info = await infoRes.json();

  const fileRes = await fetch('/api/odoo/variantes/ultimo', { cache: 'no-store' });
  if (!fileRes.ok) {
    throw new Error('No se pudo descargar el archivo de Variantes Odoo.');
  }
  const buf = await fileRes.arrayBuffer();
  const file = new File([buf], info.file);

  return { file, info };
}

function buildObservations(odooRows, mlRows, omitidosSet = new Set(), stockMlConfigMap = new Map(), variantesValidarSet = new Set()) {
  if (!odooRows.length || !mlRows.length) {
    throw new Error('Uno de los archivos no tiene filas para analizar.');
  }

  const odooHeaders = Object.keys(odooRows[0]);
  const mlHeaders = Object.keys(mlRows[0]);

  const mlVariantCol = detectColumn(mlHeaders, ['variantes', 'variante']);
  const mlTitleCol = detectColumn(mlHeaders, ['titulo']);
  const mlPubCol = detectColumn(mlHeaders, ['numero de publicacion']);
  const mlStockCol = detectColumn(mlHeaders, ['en mi deposito']);

  if (!mlVariantCol || !mlTitleCol || !mlPubCol || !mlStockCol) {
    throw new Error('En PUBLICACIONES ML faltan columnas requeridas.');
  }

  const odooVariantCol = detectColumn(odooHeaders, ['valores de las variantes/valor', 'valores de las variantes', 'valor']);
  const odooBarcodeCol = detectColumn(odooHeaders, ['codigo de barras', 'barcode']);
  const odooStockCol = detectColumn(odooHeaders, ['cantidad a mano']);
  const odooNameCol = detectColumn(odooHeaders, ['nombre', 'name']);

  if (!odooVariantCol || !odooBarcodeCol || !odooStockCol || !odooNameCol) {
    throw new Error('En STOCK ODOO faltan columnas requeridas.');
  }

  const odooNormalized = odooRows.map((row) => ({
    barcode: normalizeBarcode(row[odooBarcodeCol]),
    variant: normalizeVariantColor(row[odooVariantCol]),
    name: normalizeVariantColor(row[odooNameCol] || ''),
    stock: Math.max(0, toNumber(row[odooStockCol])),
  }));

  const filteredMlRows = mlRows; // no eliminar filas aquí

  const titleByPublication = new Map();

  mlRows.forEach((r) => {
    const pub = normalizeMlPublication(r[mlPubCol]);
    const title = String(r[mlTitleCol] || '').trim();
    if (pub && title && !titleByPublication.has(pub)) {
      titleByPublication.set(pub, title);
    }
  });

  return filteredMlRows.map((row) => {
    const originalPublication = row[mlPubCol];
    const normalizedPublication = normalizeMlPublication(originalPublication);
    const mlStock = Math.max(0, toNumber(row[mlStockCol]));
    const mlVariantRaw = String(row[mlVariantCol] || '').trim();

    // Si la variante es "-" o vacía, no analizamos stock, pero sí usamos el título si hace falta
    const hasValidVariant = mlVariantRaw !== '-' && mlVariantRaw !== '';
    let mlTitle = String(row[mlTitleCol] || '').trim();
    if (!mlTitle) {
      mlTitle = titleByPublication.get(normalizedPublication) || '';
    }

    if (!hasValidVariant) {
      return null; // la filtramos después del map
    }

    const mlVariantForDisplay =
    mlVariantRaw && mlTitle && mlVariantRaw.trim() === mlTitle.trim()
      ? ''   // no mostrar variante si es igual al título
      : mlVariantRaw;

    if (omitidosSet.has(normalizedPublication) && mlStock === 0) {
      return {
        publication: originalPublication,
        mlVariantDisplay: mlVariantForDisplay,
        mlTitleDisplay: mlTitle,
        mlStock,
        odooStock: 0,
        suggestedStock: 0,
        action: 'OMITIDOS',
        detail: 'Marcado como OMITIDO desde configuracion.xlsx (stock ML = 0)',
      };
    }

    let mlVariant = extractColorFromMlVariant(mlVariantRaw);
    mlVariant = normalizeVariantColor(mlVariant);
    // Normalizar separadores para variantes compuestas (ej: rojo-negro-rojo -> rojo negro rojo)
    mlVariant = mlVariant.replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();

    // Normalizar "original" también cuando aparece en el NOMBRE
    const titleHasOriginal = normalizeVariantColor(mlTitle).includes('original');

    const mlVariantIsNoVariant =
      ['izquierdo/conductor', 'original'].includes(mlVariant) || titleHasOriginal;

    // Caso especial: Título === Variante → no buscar variante en Odoo
    if (mlTitle && mlVariantRaw && mlTitle === mlVariantRaw) mlVariant = '';

    // Caso especial: Variante ML es "izquierdo/conductor" u "original"
    // o el Título contiene "original" → no buscar variante en Odoo
    if (mlVariantIsNoVariant) mlVariant = '';

    // Buscar TODOS los productos de Odoo cuyo barcode contenga el código ML (en cualquier posición)
    const cleanPub = normalizedPublication.replace(/[^0-9A-Z]/g, '');

    const allMatchesByCode = odooNormalized.filter((o) => {
      const baseCodes = extractBaseCodes(o.barcode);
      return baseCodes.some((code) => code.includes(cleanPub));
    });

    // Si hay variante ML, filtrar por variante/nombre; si no, usar todos
    let matches = allMatchesByCode;

    const isColorVariant = mlVariant && variantesValidarSet.has(mlVariant);

    // 1) Intentar match por variante (si existe)
    if (mlVariant) {
      matches = allMatchesByCode.filter((o) => {
      const oVar = o.variant || '';
      const oName = o.name || '';

      if (matchesFibraCarbono(oVar, oName, mlVariant)) return true;

      if (oVar) {
        return oVar === mlVariant; // exacto en columna variante
      }

      return oName.includes(mlVariant); // permisivo en nombre
    });
    }

    // 2) Si NO hubo match por variante, manejar fallback según reglas
    if (matches.length === 0) {
      const mlVariantFull = mlVariant; // ya normalizada
      const isColorVariant2 = mlVariant && variantesValidarSet.has(mlVariant);
      const isCompositeVariant = mlVariantFull && mlVariantFull.includes(' ');

      // Para variantes compuestas validables: SOLO match completo, sin parciales
      let strictVariantMatches = [];
      if (mlVariantFull) {
        strictVariantMatches = allMatchesByCode.filter((o) => {
        const oVar = o.variant || '';
        const oName = o.name || '';

        if (matchesFibraCarbono(oVar, oName, mlVariantFull)) return true;

        if (oVar) {
          return oVar === mlVariantFull; // exacto
        }
        return oName.includes(mlVariantFull); // frase completa
      });
      }

      if (strictVariantMatches.length > 0) {
        matches = strictVariantMatches;
      } else if ((isColorVariant2 || (mlVariantFull && mlVariantFull.includes(' '))) && allMatchesByCode.length > 1) {
        // 🔒 Colores/variantes validables + múltiples SKUs → NO mezclar, no fallback
        matches = [];
      } else {
        // ✅ SKU único (o no es color/variante validable) → fallback por código
        matches = allMatchesByCode;
      }
    }

    const hasMatchInOdoo = matches.length > 0;
    const odooStock = hasMatchInOdoo ? Math.min(...matches.map((m) => m.stock)) : 0;
    const cfg = stockMlConfigMap.get(normalizedPublication);
    const maxMlConfigured = cfg?.maxMl ?? 2;      // default 2
    const unitsPerPack = cfg?.units ?? 1;         // default 1

    // Convertir el máximo configurado a máximo en packs ML
    const maxByConfigInPacks = Math.floor(maxMlConfigured / unitsPerPack);

    // Cuántos packs ML se pueden activar según stock real de Odoo
    const maxByOdoo = Math.floor(odooStock / unitsPerPack);

    // Máximo final permitido en ML (packs)
    const suggestedStock = Math.min(maxByConfigInPacks, maxByOdoo);

    // 🏷️ Clasificación 2da. Sel. (prioridad máxima)
    const is2daSel =
      isSecondSelection(mlTitle) ||
      matches.some((m) => isSecondSelection(m.name));

    if (is2daSel) {
      return {
        publication: originalPublication,
        mlVariantDisplay: mlVariantForDisplay,
        mlTitleDisplay: mlTitle,
        mlStock,
        odooStock,
        suggestedStock,
        action: '2da. Sel.',
        detail: 'Clasificado como segunda selección',
      };
    }

    let action = 'OK';
    let detail = 'No requiere cambios.';

    if (!hasMatchInOdoo) {
      action = 'NO ENCONTRADO';
      detail = 'La publicación no existe en STOCK ODOO.';
    } else if (mlStock < suggestedStock) {
      action = 'SUBIR';
      detail = `Subir ${suggestedStock - mlStock} unidad(es).`;
       if (normalizedPublication === '582291290') {
        console.log('DEBUG 582291290', {
          mlVariant,
          allMatchesByCode,
          matchesByColor: matches,
          odooStock,
        });
      }
    } else if (mlStock > suggestedStock) {
      action = 'BAJAR';
      detail = `Bajar ${mlStock - suggestedStock} unidad(es).`;
      if (normalizedPublication === '1032755107') {
        console.log('DEBUG 1032755107', {
          mlVariant,
          allMatchesByCode,
          matchesByColor: matches,
          odooStock,
        });
      }
    }

    return {
      publication: originalPublication,
      mlVariantDisplay: mlVariantForDisplay,
      mlTitleDisplay: mlTitle,
      mlStock,
      odooStock,
      suggestedStock,
      action,
      detail,
    };
  }).filter(Boolean);   // 👈 ESTO TE FALTABA
}

function renderObservations(observations) {
  resultsBody.innerHTML = '';

  observations.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.publication}</td>
      <td>${row.mlTitleDisplay || ''}</td>
      <td>${row.mlVariantDisplay || ''}</td>
      <td>${row.mlStock}</td>
      <td>${row.odooStock}</td>
      <td>${row.suggestedStock}</td>
      <td class="${(row.action === 'SUBIR' || row.action === 'BAJAR') && Math.abs(row.suggestedStock - row.mlStock) > 0
        ? `action-${row.action}`
        : ''}">
        ${row.action}
      </td>
      <td>${row.detail}</td>
    `;
    resultsBody.appendChild(tr);
  });

  summaryEl.classList.remove('hidden');
  resultsEl.classList.remove('hidden');
}

(async () => {
  try {
    const res = await fetch('/api/odoo/variantes/info', { cache: 'no-store' });
    if (!res.ok) return;

    const info = await res.json();
    document.getElementById('odooInfo').innerText =
      `Utilizando Variantes Odoo el: ${new Date(info.uploadedAt).toLocaleString()}`;
  } catch {}
})();