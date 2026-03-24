//const mlFileInput = document.getElementById('mlFile');
const analyzeBtn = document.getElementById('analyzeBtn');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const resultsEl = document.getElementById('results');
const resultsBody = document.getElementById('resultsBody');
const actionCountersEl = document.getElementById('actionCounters');

let lastObservations = [];
let activeFilter = 'ALL';
let omitidosSetCache = null;
let toastTimer;

const modal = document.getElementById("modalImagen");
const cerrarModal = document.getElementById("cerrarModal");
const modalContainer = document.getElementById("modalImagesContainer");

const ayudas = {
  verVariantesOdoo: [
    "/imagenes/variantes-odoo0.jpg",
    "/imagenes/variantes-odoo1.jpg"
  ],
  verPublicacionesML: [
    "/imagenes/publicaciones-ml0.jpg",
    "/imagenes/publicaciones-ml1.jpg"
  ]
};

cerrarModal.addEventListener("click", () => {
  modal.classList.add("hidden");
});

modal.addEventListener("click", (e) => {
  if (e.target === modal) {
    modal.classList.add("hidden");
  }
});

function esArchivoDeHoy(file) {
  const hoy = new Date();
  const fechaArchivo = new Date(file.lastModified);

  return (
    fechaArchivo.getDate() === hoy.getDate() &&
    fechaArchivo.getMonth() === hoy.getMonth() &&
    fechaArchivo.getFullYear() === hoy.getFullYear()
  );
}

function normalizeHeader(str) {
  return String(str || '')
    .normalize('NFD')                 // separa letras de acentos
    .replace(/[\u0300-\u036f]/g, '')  // quita los acentos
    .toLowerCase()
    .trim();
}

function normalizeMlPublication(value) {
  return String(value || '')
    .toUpperCase()
    .replace('MLC','')
    .replace(/[^0-9]/g,'')
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
  const res = await fetch('/validar-ml/configuracion.xlsx', { cache: 'no-store' });
  if (!res.ok) throw new Error('No se pudo cargar configuracion.xlsx');

  const arrayBuffer = await res.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  if (!__stockMlConfigCache) {
    __stockMlConfigCache = new Map();
  }

  if (omitidosSetCache) return omitidosSetCache;

  try {
    const res = await fetch('/validar-ml/configuracion.xlsx', { cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo cargar configuracion.xlsx');

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

        //console.log(pub, sku);

        if (!pub || !sku) return;

        if (!packMap.has(pub)) packMap.set(pub, []);

        packMap.get(pub).push(sku);

      });

      // unir packs con la config existente
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
    //console.log('OMITIDOS cargados:', Array.from(set));
    return set;
  } catch (e) {
    console.warn('No se pudo cargar configuracion.xlsx (OMITIDOS). Se continúa sin OMITIDOS.', e);
    omitidosSetCache = new Set();
    return omitidosSetCache;
  }
}

function renderActionCounters(rows) {
  const counts = rows.reduce(
    (acc, r) => {
      acc.OK += r.action === 'OK' ? 1 : 0;
      acc.OBS += (r.action === 'SUBIR' || r.action === 'BAJAR') ? 1 : 0;
      acc['NO ENCONTRADO'] += r.action === 'NO ENCONTRADO' ? 1 : 0;
      acc['2da. Sel.'] += r.action === '2da. Sel.' ? 1 : 0;
      acc.OMITIDOS += r.action === 'OMITIDOS' ? 1 : 0;
      acc.ALL += 1;
      return acc;
    },
    { OK: 0, OBS: 0, 'NO ENCONTRADO': 0, '2da. Sel.': 0, OMITIDOS: 0, ALL: 0 }
  );

  actionCountersEl.innerHTML = `
    <span class="pill ${activeFilter === 'ALL' ? 'active' : ''}" data-filter="ALL">TODOS: <strong>${counts.ALL}</strong></span>
    <span class="pill ${activeFilter === 'OBS' ? 'active' : ''}" data-filter="OBS">
      OBSERVACIONES: <strong>${counts.OBS}</strong>
    </span>
    <span class="pill ${activeFilter === 'OK' ? 'active' : ''}" data-filter="OK">OK: <strong>${counts.OK}</strong></span>
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
      : activeFilter === 'OBS'
        ? lastObservations.filter(r => r.action === 'SUBIR' || r.action === 'BAJAR')
        : lastObservations.filter(r => r.action === activeFilter);

  renderObservations(filtered);
  renderActionCounters(lastObservations);  // 👈 siempre usar el universo completo

  resultsEl.classList.remove('filter-SUBIR', 'filter-BAJAR');
  if (activeFilter === 'SUBIR') resultsEl.classList.add('filter-SUBIR');
  if (activeFilter === 'BAJAR') resultsEl.classList.add('filter-BAJAR');
}

async function uploadPublicacionesML(fileToUse) {
  const fd = new FormData();
  fd.append("archivo", fileToUse);

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

    let fileToUse;

    // Usar siempre el último Publicaciones ML del servidor
    const mlData = await fetchUltimasPublicacionesML();

    if (!mlData) {
      throw new Error('Aún no hay Publicaciones ML cargadas en el servidor.');
    }

    fileToUse = mlData.file;

    mlInfoEl.innerText =
      `Usando Publicaciones ML cargadas el: ${new Date(mlData.info.uploadedAt).toLocaleString()}`;

    statusEl.textContent = 'Validando archivo de Publicaciones ML...';

    // 🔎 Leer Excel para validar
    const buf = await fileToUse.arrayBuffer();
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
    const uploadRes = await uploadPublicacionesML(fileToUse);

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
    activeFilter = 'OBS';
    applyActiveFilter();
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

function readExcelRows(fileToUse, options = {}) {
  if (!fileToUse) throw new Error('Falta cargar uno de los archivos.');

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
    reader.readAsArrayBuffer(fileToUse);
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
  const mlStockCol = detectColumn(mlHeaders, ['en mi deposito', 'en tu deposito']);

  if (!mlVariantCol) {
    throw new Error('En PUBLICACIONES ML falta la columna Variante.');
  }

  if (!mlTitleCol) {
    throw new Error('En PUBLICACIONES ML falta la columna Título.');
  }

  if (!mlPubCol) {
    throw new Error('En PUBLICACIONES ML falta la columna Número de Publicación.');
  }

  if (!mlStockCol) {
    throw new Error('En PUBLICACIONES ML falta la columna Stock.');
  }

  const odooVariantCol = detectColumn(odooHeaders, ['valores de las variantes/valor', 'valores de las variantes', 'valor']);
  const odooBarcodeCol = detectColumn(odooHeaders, ['codigo de barras', 'barcode']);
  const odooStockCol = detectColumn(odooHeaders, ['cantidad a mano']);
  const odooNameCol = detectColumn(odooHeaders, ['nombre', 'name']);

  if (!odooVariantCol || !odooBarcodeCol || !odooStockCol || !odooNameCol) {
    throw new Error('En STOCK ODOO faltan columnas requeridas.');
  }

  const odooNormalized = odooRows
    .map((row) => ({
      barcode: normalizeBarcode(row[odooBarcodeCol]),
      variant: normalizeVariantColor(row[odooVariantCol]),
      name: normalizeVariantColor(row[odooNameCol] || ''),
      stock: Math.max(0, toNumber(row[odooStockCol])),
    }))
    .filter(p => p.barcode);

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
    // lógica centralizada en /js/ml-variant-resolver.js
    let matches = resolveMlVariant({
      publication: normalizedPublication,
      mlVariantRaw,
      mlTitle,
      odooProducts: odooNormalized,
      variantesValidarSet
    });

    /*if (normalizedPublication == 2823789240){
      console.log(normalizedPublication, mlVariantRaw, mlTitle, odooNormalized, variantesValidarSet, matches);
    }*/

    let hasMatchInOdoo = matches.length > 0;

    const cfg = {
      ...(stockMlConfigMap.get(normalizedPublication) || {}),
      ...(__stockMlConfigCache?.get(normalizedPublication) || {})
    };

    let odooStock = 0;
    // 🔹 Si la publicación tiene SKUs definidos en configuración (pack)
    if (cfg?.skus) {
      const packSkus = String(cfg.skus)
        .split(/[\/,]/)
        .map(s => s.trim())
        .filter(Boolean);

      let packCapacity = [];

      for (const sku of packSkus) {

        const odooMatch = odooNormalized.filter(o =>
          extractBaseCodes(o.barcode).some(code => code.includes(sku))
        );

        if (!odooMatch.length) {
          packCapacity = [0];
          break;
        }

        const stockSku = Math.min(...odooMatch.map(m => m.stock));

        // 🔹 obtener units por SKU (si no existe usar 1)
        const unitsSku =
          stockMlConfigMap.get(sku)?.units ??
          __stockMlConfigCache?.get(sku)?.units ??
          1;

        const packsFromSku = Math.floor(stockSku / unitsSku);

        packCapacity.push(packsFromSku);
      }

      odooStock = packCapacity.length ? Math.min(...packCapacity) : 0;

      // 🔧 FIX: si es pack y encontramos SKUs, no es NO ENCONTRADO
      if (packSkus.length) {
        hasMatchInOdoo = true;
      }

    } else {

      // 🔹 comportamiento normal (no pack)
      odooStock = hasMatchInOdoo
        ? Math.min(...matches.map((m) => m.stock))
        : 0;
    }

    /*if (normalizedPublication === '3394755938') {
      console.log(cfg);
    }*/
    const maxMlConfigured = cfg?.maxMl ?? 2;      // default 2
    const unitsPerPack = cfg?.units ?? 1;         // default 1

    // Convertir el máximo configurado a máximo en packs ML
    const maxByConfigInPacks = Math.floor(maxMlConfigured / unitsPerPack);

    // Cuántos packs ML se pueden activar según stock real de Odoo
    const maxByOdoo = cfg?.skus
      ? odooStock
      : Math.floor(odooStock / unitsPerPack);

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
    } else if (mlStock > suggestedStock) {
      action = 'BAJAR';
      detail = `Bajar ${mlStock - suggestedStock} unidad(es).`;
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
      <td class="numero-publicacion">
        ${normalizeMlPublication(row.publication)}
        <span class="copy-venta" data-copy="${normalizeMlPublication(row.publication)}" title="Copiar publicación">📋</span>      </td>
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

    tr.querySelector('.copy-venta')?.addEventListener('click', (e) => {
      const text = e.target.dataset.copy;
      navigator.clipboard.writeText(text);
    });
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

(async () => {
  try {
    const infoRes = await fetch('/api/ml/publicaciones/info', { cache: 'no-store' });
    if (!infoRes.ok) return;

    const info = await infoRes.json();
    mlInfoEl.innerText =
      `Utilizando Publicaciones ML cargadas el: ${new Date(info.uploadedAt).toLocaleString()}`;

    analyzeBtn.disabled = false;
  } catch {}
})();

async function uploadIfExists(file, url) {

  if (!file) return;

  const fd = new FormData();
  fd.append("archivo", file);

  await fetch(url, {
    method: "POST",
    body: fd
  });

  //console.log("Subido:", file.name);

}

function showToast(message, duration = 3000, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.style.background =
    type === 'success' ? '#16a34a' :
    type === 'error'   ? '#dc2626' :
    '#1f2937';

  toast.classList.remove('hidden');
  requestAnimationFrame(() => toast.classList.add('show'));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 250);
  }, duration);
}

Object.keys(ayudas).forEach(id => {

 const el = document.getElementById(id);
  if (!el) return;

  el.addEventListener("click", () => {

    const images = ayudas[id];

    modalContainer.innerHTML = images.map(src => `
      <img src="${src}" class="modal-img" />
    `).join("");

    modal.classList.remove("hidden");

  });

});

const filesInput = document.getElementById("filesInput");

filesInput.addEventListener("change", async () => {

  const files = Array.from(filesInput.files);
  if (!files.length) return;

  let variantesCargadas = false;
  let publicacionesCargadas = false;

  showToast("Subiendo archivos...", 1500);

  for (const file of files) {

    try {
      if (!esArchivoDeHoy(file)) {
        showToast(`❌ ${file.name} no es del día`, 4000, "error");
        continue;
      }

      const name = file.name.toLowerCase();

      let endpoint = "";

      if (name.includes("product.product")) {
        endpoint = "/api/odoo/variantes";
        variantesCargadas = true;
      } 
      else if (name.includes("publicaciones")) {
        endpoint = "/api/ml/publicaciones";
        publicacionesCargadas = true;
      } 
      else {
        showToast(`Archivo no reconocido: ${file.name}`, 3000, "error");
        continue;
      }

      const fd = new FormData();
      fd.append("archivo", file);
      fd.append("lastModified", file.lastModified);

      const res = await fetch(endpoint, {
        method: "POST",
        body: fd
      });

      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || `Error en ${file.name}`, 3000, "error");
        continue;
      }

      showToast(`✔ ${file.name}`, 1200);

    } catch (err) {
      console.error(err);
      showToast(`Error subiendo ${file.name}`, 3000, "error");
    }
  }

  // 🔥 actualizar info en pantalla
  try {
    if (variantesCargadas) {
      const odoo = await fetch('/api/odoo/variantes/info').then(r => r.json());
      document.getElementById('odooInfo').innerText =
        `Variantes Odoo cargadas el: ${new Date(odoo.uploadedAt).toLocaleString()}`;
    }

    if (publicacionesCargadas) {
      const ml = await fetch('/api/ml/publicaciones/info').then(r => r.json());
      document.getElementById('mlInfo').innerText =
        `Publicaciones ML cargadas el: ${new Date(ml.uploadedAt).toLocaleString()}`;
    }

  } catch (e) {
    console.warn("Error actualizando info", e);
  }

  // 🔥 habilitar análisis
  analyzeBtn.disabled = !(variantesCargadas && publicacionesCargadas);

  showToast("Carga finalizada 🚀", 1500);

  // 🔥 auto ejecutar si ambos están
  if (variantesCargadas && publicacionesCargadas) {
    analyzeBtn.click();
  }

});