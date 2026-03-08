document.addEventListener('DOMContentLoaded', () => {
  const START_ROW = 6;
  const mlInput = document.getElementById('mlVentasFile');
  const analyzeBtn = document.getElementById('analyzeVentasBtn');
  const statusEl = document.getElementById('statusVentas');
  const resultsSection = document.getElementById('ventasResults');
  const resultsBody = document.getElementById('ventasResultsBody');
  const odooVentasInfo = document.getElementById('odooVentasInfo');
  const mlVentasInfo = document.getElementById('mlVentasInfo');
  // === ÍNDICES ODOO (ajusta una vez y listo) ===
  const ODOO_COL_VENTA = 6;    // Col G: Número de venta (ML)
  const ODOO_COL_CODIGO = 8;   // Col C: Código de producto
  const ODOO_COL_QTY = 7;      // Col H: Cantidad
  // === ÍNDICES ML (Ventas ML) ===
  // Ajusta aquí si cambia el formato del Excel de ML
  const ML_COL_VENTA = 0;      // Col A: Número de venta ML
  let odooQtyByVentaCodigo = new Map();
  let toastTimer = null;
  let variantesOdooCache = [];
  let stockOdooCache = [];
  let codigosPorVenta = {};
  let lastScannerTs = 0;
  let scanInterval = null;
  let scanTargetInput = null;
  let scanResultEl = null;
  let lastScanTs = 0;
  let lastScannedCode = null;
  let scannerLock = false;

  async function pollScanner() {

    try {

      const res = await fetch('/api/scanner/last');
      const data = await res.json();

     if (!data || !data.code) {
        scanInterval = setTimeout(pollScanner, 250);
        return;
      }

      handleScan(data);

    } catch (err) {
      console.error("Scanner error", err);
    }

    scanInterval = setTimeout(pollScanner, 250);
  }

  async function handleScan(data) {

    const code = String(data.code || '').trim();
    if (!code) return;

    if (!scanResultEl) return;

    const tr = scanResultEl.closest("tr");
    if (!tr) return;

    const input = tr.querySelector(".codigo-input");
    if (!input) return;

    const ventaML = input.dataset.venta;
    const pubML = input.dataset.pubml;

    const keyPersistencia = `${ventaML}|${pubML}`;

    lastScannedCode = code;
    lastScanTs = data.ts || Date.now();

    // Mostrar escaneo en pantalla
    scanResultEl.textContent = code;

    try {

      // Persistir escaneo
      await fetch('/api/ml/ventas/codigos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: keyPersistencia,
          ventaML,
          pubML,
          escaneado: code
        })
      });

      // actualizar cache local
      codigosPorVenta[keyPersistencia] = {
        ...(codigosPorVenta[keyPersistencia] || {}),
        escaneado: code
      };

    } catch (err) {
      console.error("Error guardando escaneo", err);
    }

    await validarLineaDespacho(tr, input);

    showToast("Producto escaneado 📦", 1500);

  }

  async function validarLineaDespacho(tr, input) {

    const obsCell = tr.querySelector('.obs-cell');
    const checkbox = tr.querySelector('.cambio-checkbox');

    const pubML = input.dataset.pubml;
    const ventaML = input.dataset.venta;
    const valor = input.value || '';

    const keyPersistencia = `${ventaML}|${pubML}`;

    const pubKey = String(pubML || '').replace(/^MLC/i, '').trim();
    const cambioProducto = checkbox && checkbox.checked;

    const escaneado =
      codigosPorVenta[keyPersistencia]?.escaneado || null;

    const codigoEfectivo = normCodigo(valor);
    const ventaKey = normVentaKey(ventaML);

    // 🔹 Si no hay código ingresado
    if (!codigoEfectivo) {
      obsCell.textContent = 'INGRESE PRODUCTO A DESPACHAR';
      obsCell.classList.remove('ok-cell');
      obsCell.classList.add('error-cell');
      return false;
    }

    // 🔴 Producto incorrecto
    if (!cambioProducto && !contienePubML(codigoEfectivo, pubKey)) {
      obsCell.textContent = 'PRODUCTO A DESPACHAR INCORRECTO';
      obsCell.classList.remove('ok-cell');
      obsCell.classList.add('error-cell');
      return false;
    }

    // 🟡 Falta escaneo
    if (!escaneado) {
      obsCell.textContent = 'ESCANEE EL PRODUCTO';
      obsCell.classList.remove('ok-cell');
      obsCell.classList.add('error-cell');
      return false;
    }

    // 🔴 Escaneo distinto
    if (normCodigo(valor) !== normCodigo(escaneado)) {
      obsCell.textContent = 'EL CÓDIGO NO COINCIDE CON EL ESCÁNER';
      obsCell.classList.remove('ok-cell');
      obsCell.classList.add('error-cell');
      return false;
    }

    // 🔹 Validación Odoo
    const existeProductoEnOdoo =
      odooQtyByVentaCodigo.has(`${ventaKey}|${codigoEfectivo}`);

    if (!existeProductoEnOdoo) {
      obsCell.textContent = 'PRODUCTO NO REGISTRADO EN ODOO';
      obsCell.classList.remove('ok-cell');
      obsCell.classList.add('error-cell');
      return false;
    }

    const unidadesDespachar = Number(
      tr.querySelector('.qty-despachar')?.textContent || 0
    );

    const qtyOdoo =
      odooQtyByVentaCodigo.get(`${ventaKey}|${codigoEfectivo}`) || 0;

    if (qtyOdoo < unidadesDespachar) {
      obsCell.textContent = 'FALTAN UNIDADES POR ENTREGAR';
      obsCell.classList.remove('ok-cell');
      obsCell.classList.add('error-cell');
      return false;
    }

    if (qtyOdoo > unidadesDespachar) {
      obsCell.textContent = 'EXCESO DE UNIDADES REGISTRADAS';
      obsCell.classList.remove('ok-cell');
      obsCell.classList.add('error-cell');
      return false;
    }

    obsCell.textContent = 'OK';
    obsCell.classList.remove('error-cell');
    obsCell.classList.add('ok-cell');

    lastScannedCode = null;

    await runValidacionVentas();

    return true;
  }

  resultsBody.addEventListener("click", async (e) => {

    const btn = e.target.closest(".scan-btn");
    if (!btn) return;

    const tr = btn.closest("tr");

    scanResultEl = tr.querySelector(".scan-result");

    // reset
    lastScannedCode = null;
    lastScanTs = Date.now() + 300; 

    document.activeElement.blur();

    clearTimeout(scanInterval);

    pollScanner();

    showToast("Esperando escaneo 📡");

  });

  async function loadUltimasVariantesOdooParaBusqueda() {
    if (variantesOdooCache.length) return;

    const res = await fetch('/api/odoo/variantes/ultimo', { cache: 'no-store' });
    if (!res.ok) return;

    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Odoo variantes:
    // Col B = Código de barras
    // Col C = Nombre
    // Col E = Variante

    variantesOdooCache = rows.slice(1).map(r => ({
      barcode: String(r[1] || '').trim(),   // B
      name: String(r[2] || '').trim(),      // C
      variant: String(r[5] || '').trim()    // F
    })).filter(v => v.barcode);

    clearInterval(scanInterval);
    scanInterval = null;
  }

  async function loadStockOdoo() {

    if (stockOdooCache.length) return;

    const res = await fetch('/api/odoo/stock/ultimo', { cache: 'no-store' });

    if (!res.ok) return;

    const buf = await res.arrayBuffer();

    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const header = rows[0].map(h => String(h).toLowerCase());

    const COL_BARCODE = header.findIndex(h =>
      h.includes('producto/código') || h.includes('código de barras')
    );

    const COL_UBICACION = header.findIndex(h =>
      h.includes('ubicación')
    );

    stockOdooCache = rows.slice(1).map(r => ({
      barcode: String(r[COL_BARCODE] || '').trim(),
      ubicacion: String(r[COL_UBICACION] || '').trim()
    })).filter(r => r.barcode);

  }
  
  function getUbicacionesPorCodigo(barcode) {

    if (!barcode) return [];

    const code = String(barcode).trim().toLowerCase();

    return stockOdooCache
      .filter(r => r.barcode.toLowerCase() === code)
      .map(r => r.ubicacion)
      .filter(Boolean);
  }

  function getVarianteOdooPorCodigo(barcode) {
    if (!barcode) return null;

    const code = String(barcode).trim().toLowerCase();

    return variantesOdooCache.find(v =>
      v.barcode.toLowerCase() === code
    ) || null;
  }

  function buildPackMap(configWorkbook) {
    const ws = configWorkbook.Sheets['Pack'];
    
    if (!ws) return new Map();

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
    const map = new Map();

    for (let i = 0; i < rows.length; i++) {
      const padre = String(rows[i][0] || '').replace(/^MLC/i, '').trim();
      const hija  = String(rows[i][1] || '').replace(/^MLC/i, '').trim();

      if (!padre || !hija) continue;

      if (!map.has(padre)) map.set(padre, []);
      map.get(padre).push(hija);
    }

    return map;
  }

  function getCellHyperlink(sheet, rowIndex, colIndex) {
    const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
    const cell = sheet[cellAddress];

    if (cell && cell.l && cell.l.Target) {
      return cell.l.Target;
    }

    return null;
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

  function normCodigo(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')     // quita espacios
      .replace(/[-–—]/g, '')  // quita guiones
      .replace(/\.0$/, '');   // quita .0 típico de Excel
  }

  function normVentaKey(v) {
    return String(v || '')
      .trim()
      .replace(/\s+/g, '');  // quita espacios internos
  }

  function contienePubML(codigoIngresado, pubML) {
    if (!codigoIngresado || !pubML) return false;

    const a = String(codigoIngresado).toUpperCase().replace(/\s+/g, '');
    const b = String(pubML).toUpperCase().replace(/\s+/g, '').replace(/^MLC/, '');

    return a.includes(b);
  }

  async function loadOdooInfo() {
    try {
      const res = await fetch('/api/odoo/ventas/info');
      if (!res.ok) throw new Error('No hay Ventas ML cargadas aún');
      const json = await res.json();
      odooVentasInfo.textContent =
        `Usando Ventas Odoo cargadas el: ${new Date(json.uploadedAt).toLocaleString('es-CL')}`;
    } catch {
      odooVentasInfo.textContent =
        'No hay Ventas Odoo cargadas. Ve al menú "Ventas Odoo" para subir el archivo.';
    }
  }

  loadOdooInfo();

  function includesCancelOrReturn(estadoML) {
    const s = String(estadoML || '').toLowerCase();
    //console.log(s);
    return s.includes('cancel') || s.includes('devol');
  }

  async function updateAnalyzeAvailability() {
    try {
      const hasFileSelected =
        mlInput && mlInput.files && mlInput.files.length > 0;

      // Si hay archivo seleccionado, SIEMPRE permitir validar (porque subirá)
      if (hasFileSelected) {
        analyzeBtn.disabled = false;
        return;
      }

      // Si no hay archivo seleccionado, depender del último Ventas ML persistido
      const res = await fetch('/api/ml/ventas/info', { cache: 'no-store' });
      analyzeBtn.disabled = !res.ok;

    } catch {
      analyzeBtn.disabled = false; // fallback permisivo para no bloquear al usuario
    }
  }

  updateAnalyzeAvailability();

  function toNumberCLP(v) {
    if (typeof v === 'number') return v;
    if (v === null || v === undefined) return 0;
    const n = parseFloat(
      String(v)
        .replace(/\./g, '')
        .replace(',', '.')
        .replace(/[^\d.-]/g, '')
    );
    return isNaN(n) ? 0 : n;
  }

  function resetResultadosUI() {
    // 🧹 Limpiar resultados anteriores
    resultsBody.innerHTML = '';
    resultsSection.classList.add('hidden');

    // 🧹 Limpiar contadores/pills
    const countersEl = document.getElementById('actionCounters');
    if (countersEl) {
      countersEl.innerHTML = '';
      countersEl.classList.add('hidden');
    }

    // 🧹 Limpiar mensajes de estado
    statusEl.textContent = '';
  }

  function calcularPrecioMostrado(totalCLP, ingresoEnvioCLP, costoEnvioCLP, estadoML) {
    const total = toNumberCLP(totalCLP);
    const ingreso = toNumberCLP(ingresoEnvioCLP);
    const costo = toNumberCLP(costoEnvioCLP); // si no es número → 0
    const estado = String(estadoML || '').toLowerCase();

    // 👉 NUEVA REGLA: si está cancelada y total = 0, mostrar 0 sin cálculo
    if (estado.includes('cancel') && total === 0) {
      return 0;
    }

    // Caso B: sin envío válido
    if (!(ingreso > 0)) {
      return Math.round(total / 1.19);
    }

    // Caso A: con envío válido y (ingreso + costo) > 0
    if ((ingreso + costo) > 0) {
      const base = total - (3000 * 1.19);
      return Math.round(base / 1.19);
    }

    // Fallback
    return Math.round(total / 1.19);
  }

  async function readRows(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  }

  function excelDateToJSDate(serial) {
    // Excel epoch (1899-12-30)
    const utc_days = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;                                        
    const date_info = new Date(utc_value * 1000);
    return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate());
  }

  function parseDate(value) {
    if (!value) return null;

    // Caso 1: número (serial Excel)
    if (typeof value === 'number') {
      const utc_days = Math.floor(value - 25569);
      const utc_value = utc_days * 86400;
      const date_info = new Date(utc_value * 1000);
      return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate());
    }

    const s = String(value).trim().toLowerCase();

    // Caso 2: formato español "16 de febrero de 2026 12:33 hs."
    const meses = {
      enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
      julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
      noviembre: 10, diciembre: 11
    };

    const matchEs = s.match(
      /^(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i
    );

    if (matchEs) {
      const day = parseInt(matchEs[1], 10);
      const monthName = matchEs[2];
      const year = parseInt(matchEs[3], 10);
      const hour = matchEs[4] ? parseInt(matchEs[4], 10) : 0;
      const minute = matchEs[5] ? parseInt(matchEs[5], 10) : 0;

      const month = meses[monthName];
      if (month === undefined) return null;

      return new Date(year, month, day, hour, minute);
    }

    // Caso 3: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);

    // Caso 4: DD-MM-YYYY
    if (/^\d{2}-\d{2}-\d{4}/.test(s)) {
      const [d, m, y] = s.split('-');
      return new Date(`${y}-${m}-${d}`);
    }

    // Fallback
    const d = new Date(value);
    return isNaN(d) ? null : d;
  }

  function normVenta(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim().replace(/\s+/g, '');
  }

  const countersEl = document.getElementById('actionCounters');

  function applyFilter(filter) {
    const rows = resultsBody.querySelectorAll('tr');

    rows.forEach(tr => {
      const obsCell = tr.querySelector('.obs-cell');
      if (!obsCell) return;

      const obs = obsCell.textContent.trim();

      switch (filter) {
        case 'TODOS':
          tr.style.display = '';
          break;

        case 'OK':
          tr.style.display = obs === 'OK' ? '' : 'none';
          break;

        case 'CON_OBS':
          tr.style.display = obs !== 'OK' ? '' : 'none';
          break;
      }
    });
  }

  function buildPills(items) {
    if (!countersEl) return;

    const counts = items.reduce((acc, r) => {
      acc.TODOS = (acc.TODOS || 0) + 1;

      if (r.obs === 'OK') {
        acc.OK = (acc.OK || 0) + 1;
      } else {
        acc.CON_OBS = (acc.CON_OBS || 0) + 1;
      }

      return acc;
    }, {});

    countersEl.innerHTML = '';

    const pillsOrder = ['TODOS', 'CON_OBS', 'OK'];

    const labels = {
      TODOS: 'TODOS',
      CON_OBS: 'OBSERVACIONES',
      OK: 'OK'
    };

    pillsOrder.forEach(k => {
      const pill = document.createElement('span');
      pill.className = 'pill' + (k === 'CON_OBS' ? ' active' : '');
      pill.dataset.filter = k;
      pill.textContent = `${labels[k]} (${counts[k] || 0})`;

      pill.onclick = () => {
        document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        applyFilter(k);
      };

      countersEl.appendChild(pill);
    });

    countersEl.classList.remove('hidden');

    applyFilter('CON_OBS');
  }

  async function runValidacionVentas() {
    codigosPorVenta = {};
    const codigosRes = await fetch('/api/ml/ventas/codigos');
    codigosPorVenta = await codigosRes.json();

    statusEl.textContent = 'Procesando archivos...';
    await loadUltimasVariantesOdooParaBusqueda();
    await loadStockOdoo();
    resultsBody.innerHTML = '';
    resultsSection.classList.add('hidden');

    try {
      const mlRes = await fetch('/api/ml/ventas/ultimo');
      if (!mlRes.ok) {
        throw new Error('No hay Ventas ML cargadas. Sube el archivo primero.');
      }
      const mlBuf = await mlRes.arrayBuffer();
      const wbML = XLSX.read(mlBuf, { type: 'array' });
      const wsML = wbML.Sheets[wbML.SheetNames[0]];
      const mlRows = XLSX.utils.sheet_to_json(wsML, { header: 1, raw: false });
      //const HEADER_ROW_INDEX = 5; // fila donde están los títulos
      const HEADER_ROW_INDEX = START_ROW - 1;
      const headerRow = mlRows[HEADER_ROW_INDEX] || [];

      function findColIndexByName(posiblesNombres = []) {
        return headerRow.findIndex(col => {
          const text = String(col || '').toLowerCase().trim();
          return posiblesNombres.some(nombre =>
            text.includes(nombre.toLowerCase())
          );
        });
      }

      const ML_COL_TITULO = findColIndexByName([
        'título de la publicación',
        'titulo de la publicacion'
      ]);

      if (ML_COL_TITULO === -1) {
        throw new Error('No se encontró la columna "Título de la publicación" en el Excel.');
      }

      const ML_COL_TOTAL = findColIndexByName([
        'total (clp)',
        'total clp'
      ]);

      if (ML_COL_TOTAL === -1) {
        throw new Error('No se encontró la columna "Total (CLP)" en el Excel de Ventas ML.');
      }

      const ML_COL_UNIDADES = findColIndexByName([
        'unidades'
      ]);

      if (ML_COL_UNIDADES === -1) {
        throw new Error('No se encontró la columna "Unidades" en el Excel de Ventas ML.');
      }

      const ML_COL_PUBML = findColIndexByName([
        '# de publicación',
        '# de publicacion'
      ]);

      if (ML_COL_PUBML === -1) {
        throw new Error('No se encontró la columna "# de publicación" en el Excel de Ventas ML.');
      }

      const ML_COL_VARIANTE = findColIndexByName([
        'variante'
      ]);

      if (ML_COL_VARIANTE === -1) {
        throw new Error('No se encontró la columna "Variante" en el Excel de Ventas ML.');
      }

      // === Odoo ===
      const odooRes = await fetch('/api/odoo/ventas/ultimo');
      if (!odooRes.ok) {
        throw new Error('No hay Ventas Odoo cargadas. Ve al menú "Ventas Odoo" y sube el archivo.');
      }
      const odooBuf = await odooRes.arrayBuffer();
      const wbOdoo = XLSX.read(odooBuf, { type: 'array' });
      const wsOdoo = wbOdoo.Sheets[wbOdoo.SheetNames[0]];
      const odooRows = XLSX.utils.sheet_to_json(wsOdoo, { header: 1, raw: false });

      let tituloPorPublicacion = new Map();

      try {
        const pubRes = await fetch('/api/ml/publicaciones/ultimo', { cache: 'no-store' });
        if (pubRes.ok) {

          const pubBuf = await pubRes.arrayBuffer();
          const wbPub = XLSX.read(pubBuf, { type: 'array' });

          const sheetName =
            wbPub.SheetNames.find(n =>
              String(n).toLowerCase().includes('publicaciones')
            ) || wbPub.SheetNames[1] || wbPub.SheetNames[0];

          const wsPub = wbPub.Sheets[sheetName];

          // 👇 encabezado en fila 3 (igual que validar-ml)
          const pubRows = XLSX.utils.sheet_to_json(wsPub, {
            defval: '',
            range: 2
          });

          for (const row of pubRows) {
            const pub = String(row['Número de publicación'] || '')
              .replace(/^MLC/i, '')
              .trim();

            const titulo = String(row['Título'] || '').trim();

            if (pub && titulo) {
              tituloPorPublicacion.set(pub, titulo);
            }
          }

          //console.log('Titulos cargados:', tituloPorPublicacion.size);
        }
      } catch (e) {
        console.warn('No se pudo cargar Publicaciones ML para títulos.', e);
      }

      // 🔹 Leer configuración para packs
      let packMap = new Map();

      try {
        const response = await fetch('/validar-ml/configuracion.xlsx', {
          cache: 'no-store'
        });

        if (response.ok) {
          const configBuf = await response.arrayBuffer();
          const wbConfig = XLSX.read(configBuf, { type: 'array' });
          packMap = buildPackMap(wbConfig);
        }
      } catch (e) {
        packMap = new Map();
      }

      //console.log(packMap);

      const mlData = mlRows.slice(START_ROW);
      const odooData = odooRows.slice(0);
      const cutoff = new Date('2026-03-06');
      const observaciones = [];
      const observacionesOK = [];
      const odooQtyByVenta = new Map();

      // Set con las ventas registradas en Odoo (col G -> index 6)
      const odooSet = new Set(
        odooData
          .map(r => normVenta(r[6]))  // Col G
          .filter(Boolean)
      );

      odooQtyByVentaCodigo = buildOdooQtyIndex(odooRows);

      for (const row of odooData) {
        const v = normVentaKey(row[6]); // 🔥 usar SIEMPRE normVentaKey Col G
        const q = Number(row[7] || 0); // Col H
        if (v) {
          odooQtyByVenta.set(v, (odooQtyByVenta.get(v) || 0) + q);
        }
      }

      let paqueteActivo = false;
      let precioPaqueteActivo = 0;
      let primeraLineaPaquete = false;
      let ventaPaqueteActiva = null;
      let ventaLinkPaqueteActivo = null;

      for (let i = 0; i < mlData.length; i++) {
        const r = mlData[i];
        const excelRowIndex = START_ROW + i;
        const ventaLink = getCellHyperlink(wsML, excelRowIndex, ML_COL_VENTA);
        const ventaML = String(r[ML_COL_VENTA] || '').trim(); // Col A (# de venta)
        const fecha = parseDate(r[1]);  // Col B (Fecha de venta)
        const estadoML = String(r[2] || '');; // Col C (Estado ML)
        //const totalCLPraw = r[13];         // Col M
        const totalCLPraw = r[ML_COL_TOTAL];
        const ingresoEnvioCLP = r[9]; // Col J
        const costoEnvioCLP = r[10];  // Col K
        const cantidadRaw = r[ML_COL_UNIDADES]; // Col G (Unidades)
        const cantidad = Number(cantidadRaw) || 0;
        const totalCLP = typeof totalCLPraw === 'number'
          ? totalCLPraw
          : parseFloat(String(totalCLPraw || '').replace(/\./g, '').replace(',', '.'));

        const precioMostrado = calcularPrecioMostrado(
          totalCLP,
          ingresoEnvioCLP,
          costoEnvioCLP,
          estadoML
        );

        const titulo = String(r[ML_COL_TITULO] || '').toLowerCase();

        let esHeaderPaquete = false;
        let esLineaHijaPaquete = false;

        // Detectar inicio de paquete
        if (estadoML.toLowerCase().includes('paquete de')) {
          paqueteActivo = true;
          precioPaqueteActivo = totalCLP;
          primeraLineaPaquete = true;

          ventaPaqueteActiva = ventaML;        // 👈 guardar venta principal
          ventaLinkPaqueteActivo = ventaLink;  // 👈 guardar link principal

          continue;
        }

        // Si estamos dentro de un paquete
        if (paqueteActivo) {
          //console.log('total',totalCLP);
          if (!isNaN(totalCLP)) {
            // apareció una nueva venta normal → cerrar paquete
            paqueteActivo = false;
          } else {
            //console.log('tittt',titulo);
            esLineaHijaPaquete = true;
          }
        }

        let ventaMLFinal = ventaML;
        let ventaLinkFinal = ventaLink;

        if (esLineaHijaPaquete && ventaPaqueteActiva) {
          ventaMLFinal = ventaPaqueteActiva;
          ventaLinkFinal = ventaLinkPaqueteActivo;
        }

        if (!ventaML || !fecha) continue;
        if (fecha < cutoff) continue;

        if(
          isNaN(totalCLP) &&
          !esLineaHijaPaquete
        ) continue;

        if (
          !(totalCLP > 0 || totalCLP === 0) &&
          !esLineaHijaPaquete
        ) continue;

        const existeEnOdoo = odooSet.has(normVentaKey(ventaMLFinal));

        let obs = null;

        // Cantidad de entrega desde Odoo (col H -> índice 7)
        const qtyEntrega = odooQtyByVenta.get(normVentaKey(ventaML)) || 0;
        const esCancelODevolucion = includesCancelOrReturn(estadoML);

        /*if (ventaML === '2000011724053271') {
          console.log({
            estadoML,
            esCancelODevolucion,
            qtyEntrega
          });
        }*/

        // 1️⃣ PRIORIDAD MÁXIMA: DEVOLVER
        if (esCancelODevolucion && qtyEntrega > 0) {
          obs = 'DEVOLVER';
        }

        // 2️⃣ Registrar venta
        else if (!existeEnOdoo && (totalCLP > 0 || esLineaHijaPaquete)){
          obs = 'REGISTRAR VENTA';
        }

        // 3️⃣ Entregar
        else if (existeEnOdoo && totalCLP > 0 && qtyEntrega === 0 && !esCancelODevolucion) {
          obs = 'ENTREGAR';
        }

        const unidadesML = Number(r[ML_COL_UNIDADES] || 0);
        const pubOriginal = String(r[ML_COL_PUBML] || '').replace(/^MLC/i, '').trim();

        // 🔹 Ver si es pack
        const publicacionesPack = packMap.get(pubOriginal);

        // Si es pack → procesamos hijas
        const publicacionesAProcesar = 
          (publicacionesPack && publicacionesPack.length)
            ? publicacionesPack
            : [pubOriginal];

        // ✅ USAR SOLO datos del procesamiento
        //alert(qtyRegistradaOdoo);
        
        // 🆕 Validación Odoo SOLO si hay código ingresado
        const ventaKey = normVentaKey(ventaMLFinal);
        const existeVentaEnOdooConOtroCodigo = Array.from(odooQtyByVentaCodigo.keys())
          .some(k => k.startsWith(`${ventaKey}|`));

        for (let idx = 0; idx < publicacionesAProcesar.length; idx++) {

          const pubProcesar = publicacionesAProcesar[idx];

          const keyPersistencia = `${ventaMLFinal}|${pubProcesar}`;

          const codigoPersistido =
            codigosPorVenta[keyPersistencia]?.codigo || '';

          const codigoKey = normCodigo(codigoPersistido);

          const cambioProductoPersistido =
            codigosPorVenta[keyPersistencia]?.cambioProducto || false;

          const cantidadADespachar = await calcularCantidadDespacho(
            pubProcesar,
            unidadesML
          );

          const precioUnitarioCorrecto =
            cantidadADespachar > 0
              ? Math.round(precioMostrado / cantidadADespachar)
              : precioMostrado;

          let obsFinal = obs; // copiamos el obs base

          // 🔹 VALIDACIÓN ODOO AQUÍ DENTRO
          if (existeEnOdoo && !includesCancelOrReturn(estadoML)) {

            if (!codigoKey) {
              obsFinal = 'INGRESE PRODUCTO A DESPACHAR';

            } else if (!odooQtyByVentaCodigo.has(`${ventaKey}|${codigoKey}`)) {

              if (existeVentaEnOdooConOtroCodigo) {
                obsFinal = 'EXISTE LA VENTA EN ODOO, PERO CON OTRO CÓDIGO';
              } else {
                obsFinal = 'PRODUCTO NO REGISTRADO EN ODOO';
              }

            } else {

              const qtyOdoo =
                odooQtyByVentaCodigo.get(`${ventaKey}|${codigoKey}`) || 0;

              if (qtyOdoo < cantidadADespachar) {
                obsFinal = 'FALTAN UNIDADES POR ENTREGAR';

              } else if (qtyOdoo > cantidadADespachar) {
                obsFinal = 'EXCESO DE UNIDADES REGISTRADAS';

              } else {
                obsFinal = null;
              }
            }
          }

          if (obsFinal === 'REGISTRAR VENTA' && !codigoKey) {
            obsFinal = 'INGRESE PRODUCTO A DESPACHAR';
          }

          // 🔥 Si existe en Odoo y no hay código, NO puede ser OK
          if (existeEnOdoo && !codigoKey && !includesCancelOrReturn(estadoML)) {
            obsFinal = 'INGRESE PRODUCTO A DESPACHAR';
          }

          //const esPack = !!publicacionesPack;

          const esPack = publicacionesAProcesar.length > 1;

          let precioMostradoFinal = precioMostrado;
          let precioUnitarioFinal = precioUnitarioCorrecto;

          if (esLineaHijaPaquete) {
            if (primeraLineaPaquete) {
              precioMostradoFinal = calcularPrecioMostrado(
                precioPaqueteActivo,
                ingresoEnvioCLP,
                costoEnvioCLP,
                estadoML
              );
              
              precioUnitarioFinal =
                cantidadADespachar > 0
                  ? Math.round(precioMostradoFinal / cantidadADespachar)
                  : precioMostradoFinal;

              primeraLineaPaquete = false;
            } else {
              precioMostradoFinal = 0;
              precioUnitarioFinal = 0;
            }
          }

          if (esPack && idx > 0) {
            precioMostradoFinal = 0;
            precioUnitarioFinal = 0;
          }

          // 🔒 No permitir OK si no hubo escaneo
          const escaneado =
          codigosPorVenta[keyPersistencia]?.escaneado || null;

          const pubKey = String(pubProcesar || '').replace(/^MLC/i, '').trim();
          const cambioProducto = cambioProductoPersistido;

          const codigoIngresado =
          codigosPorVenta[keyPersistencia]?.codigo || null;

          const escaneoValido =
          codigoIngresado &&
          escaneado &&
          normCodigo(escaneado) === normCodigo(codigoIngresado);

          // 🔴 Primero validar producto correcto
          if (
            codigoIngresado &&
            !cambioProducto &&
            !contienePubML(codigoIngresado, pubProcesar)
          ) {
            obsFinal = 'PRODUCTO A DESPACHAR INCORRECTO';
          }

          // 🟡 Luego validar escaneo
          else if (codigoIngresado && !escaneado) {
            obsFinal = 'ESCANEE EL PRODUCTO';
          }

          // 🔴 Escaneo incorrecto
          else if (
            codigoIngresado &&
            escaneado &&
            normCodigo(codigoIngresado) !== normCodigo(escaneado)
          ) {
            obsFinal = 'EL CÓDIGO NO COINCIDE CON EL ESCÁNER';
          }

          const itemBase = {
          r: [...r],
          ventaMLFinal,
          ventaLink: ventaLinkFinal,
          obs: obsFinal || 'OK',
          precioMostrado: precioMostradoFinal,
          precioUnitario: precioUnitarioFinal,
          cantidad: unidadesML,
          codigoPersistido,
          cambioProducto: cambioProductoPersistido,
          esPack,
          esLineaHijaPaquete,
          pubProcesar
        };

          itemBase.r[ML_COL_PUBML] = pubProcesar;

          if (!obsFinal && escaneoValido) {
            observacionesOK.push(itemBase);
          } else {
            observaciones.push(itemBase);
          }
        }
      }

      if (!observaciones.length && !observacionesOK.length) {
        statusEl.textContent = 'No se encontraron observaciones 🎉';
        return;
      }

      for (const item of observaciones) {
        const obs = item.obs;
        const pubML = String(item.r[ML_COL_PUBML] || '').trim(); // Col Q

        const isRegistrar = obs === 'REGISTRAR VENTA';

        const tr = document.createElement('tr');

        const unidadesML = item.cantidad || 0;
        const pubMLSinMLC = String(item.r[ML_COL_PUBML] || '')
          .replace(/^MLC/i, '')
          .trim();

        let unidadesDespachar = await calcularCantidadDespacho(
          pubMLSinMLC,
          unidadesML
        );
      
        // 🔴 Si es DEVOLVER, forzar visualmente a 0
        if (obs === 'DEVOLVER') {
          unidadesDespachar = 0;
        }

        const highlightDespacho = unidadesDespachar > unidadesML;

        if (item.esLineaHijaPaquete) {
          tr.classList.add('paquete-hija-row');
        }

        if (highlightDespacho) {
          tr.classList.add('kit-row');
        }

        if (item.esPack) {
          tr.classList.add('pack-row');
        }

        const tituloReal = tituloPorPublicacion.get(pubMLSinMLC);

        const tituloPub = tituloReal
          ? tituloReal
          : String(item.r[ML_COL_TITULO] || '').trim();// Col S
        let variante = String(item.r[ML_COL_VARIANTE] || '').trim(); // Col T

        // Normalización de variante
        const varianteNorm = variante.toLowerCase();
        const tituloNorm = tituloPub.toLowerCase();

        const variantesIgnorar = ['original', 'aluminio', 'ambos lados'];

        let mostrarVariante = variante &&
          varianteNorm !== tituloNorm &&
          !variantesIgnorar.includes(varianteNorm);

        if (mostrarVariante) {
          variante = variante.replace(/color:/i, '').trim();
        }

        const mostrarInfoProducto = true; // siempre que la fila exista, mostrar el producto
        const ventaMLRow = item.ventaMLFinal;
        const codigo = (item.codigoPersistido || '').toUpperCase();
        const ventaKey = normVentaKey(ventaMLRow);
        const codigoKey = normCodigo(item.codigoPersistido);
        const qtyRegistradaOdoo =
          odooQtyByVentaCodigo.get(`${ventaKey}|${codigoKey}`) || 0;

        tr.innerHTML = `
          <td>
            <div class="venta-copy">
              ${item.ventaLink
                ? `<a href="${item.ventaLink}" target="_blank" class="venta-link">${item.ventaMLFinal}</a>`
                : item.ventaMLFinal
              }
              <span class="copy-venta" data-venta="${item.ventaMLFinal}" title="Copiar venta">📋</span>
            </div>
          </td>
          <td>${item.r[1]}</td>
          <td>${item.r[2]}</td>
          <td>
            ${mostrarInfoProducto
              ? `
                <div class="producto-despachar">
                  <div class="linea-pubml">
                    <span class="pubml-tag">${pubMLSinMLC}</span>
                  </div>

                  <div class="linea-titulo">
                    <span class="titulo-pub">${tituloPub}</span>
                  </div>
                  <div>
                    ${mostrarVariante ? `<span class="variante-pub">(${variante})</span>` : ``}
                  </div>

                  <!-- 👇 Input SIEMPRE visible en NO OK -->
                  <div class="codigo-wrapper">
                    <input
                      type="text"
                      class="codigo-input"
                      placeholder="${item.codigoPersistido ? 'Modificar código' : 'Ingresar código'}"
                      data-venta="${ventaMLRow}"
                      data-pubml="${pubMLSinMLC}"
                      value="${item.codigoPersistido || ''}"
                    />
                    <div class="odoo-suggestions hidden"></div>
                  </div>

                  ${(() => {
                    const info = getVarianteOdooPorCodigo(item.codigoPersistido);

                    return `
                    `;
                  })()}

                  ${(() => {
                    const info = getVarianteOdooPorCodigo(item.codigoPersistido);

                    return `
                      <div class="linea-nombre">
                        <span class="codigo-label">Nombre prod. a despachar:</span>
                        <span class="nombre-valor">${info?.name || '—'}</span>
                      </div>

                      <div class="linea-variante">
                        <span class="codigo-label">Variante prod. a despachar:</span>
                        <span class="variante-valor">${info?.variant || '—'}</span>
                      </div>
                    `;
                  })()}
                  <div class="scan-area">
                    <button class="scan-btn">📷 Escanear</button>

                    <div class="scan-result-wrapper">
                      <span class="scan-result">
                        ${codigosPorVenta[`${item.ventaMLFinal}|${pubMLSinMLC}`]?.escaneado || '—'}
                      </span>
                      <span 
                        class="copy-scan" 
                        data-scan="${codigosPorVenta[`${item.ventaMLFinal}|${pubMLSinMLC}`]?.escaneado || ''}"
                        title="Copiar código escaneado"
                      >📋</span>
                    </div>

                  </div>
              `
              : `—`}
          </td>
          <td class="ubicaciones-col">
            ${(() => {

              const ubicaciones = getUbicacionesPorCodigo(item.codigoPersistido);

              if (!ubicaciones.length) return '—';

             return ubicaciones
            .map(u => `
              <div class="ubicacion-tag">
                <span class="ubicacion-text">${u}</span>
                <span class="copy-ubicacion" data-ubicacion="${u}" title="Copiar ubicación">📋</span>
              </div>
            `)
            .join('');

            })()}
          </td>
          <td>
            ${obs !== 'OK'
              ? `<input type="checkbox" class="cambio-checkbox" ${item.cambioProducto ? 'checked' : ''} />`
              : `—`}
          </td>
          <td>${unidadesML}</td>
          <td class="qty-despachar ${highlightDespacho ? 'qty-alert' : ''}"
              title="${highlightDespacho ? 'Kit detectado: se despachan más unidades que las vendidas en ML' : ''}">
            ${unidadesDespachar}
          ${highlightDespacho ? '<span class="kit-badge">(KIT)</span>' : ''}
          </td>
          <td class="${
            qtyRegistradaOdoo < unidadesDespachar ? 'qty-alert' :
            qtyRegistradaOdoo > unidadesDespachar ? 'qty-exceso' : ''
          }">
            ${qtyRegistradaOdoo}
          </td>
          <td>
            <span class="precio-valor">${item.precioUnitario.toLocaleString('es-CL')}</span>
            <span class="copy-precio" data-precio="${item.precioUnitario}" title="Copiar precio">📋</span>
          </td>
          <td class="obs-cell ${item.obs === 'INGRESE PRODUCTO A DESPACHAR' || item.obs === 'ESCANEE EL PRODUCTO' || item.obs === 'EL CÓDIGO NO COINCIDE CON EL ESCÁNER' || item.obs === 'PRODUCTO A DESPACHAR INCORRECTO' ? 'error-cell' : ''}">
            ${item.obs}
          </td>
        `;

        resultsBody.appendChild(tr);
      }

      // 👉 Renderizar ventas OK (ocultas por defecto)
      for (const item of observacionesOK) {

        const tr = document.createElement('tr');

        const unidadesML = item.cantidad || 0;
        const pubMLSinMLC = String(item.r[ML_COL_PUBML] || '')
          .replace(/^MLC/i, '')
          .trim();

        const unidadesDespachar = await calcularCantidadDespacho(
          pubMLSinMLC,
          unidadesML
        );

        const highlightDespacho = unidadesDespachar > unidadesML;

        if (item.esLineaHijaPaquete) {
          tr.classList.add('paquete-hija-row');
        }

        if (highlightDespacho) {
          tr.classList.add('kit-row');
        }

        if (item.esPack) {
          tr.classList.add('pack-row');
        }

        tr.dataset.obs = 'OK';

        tr.dataset.pubml = item.pubProcesar;

        const ventaMLRow = item.ventaMLFinal;        
        const codigoKey = normCodigo(item.codigoPersistido);
        const ventaKey = normVentaKey(ventaMLRow);

        const unidOdoo =
          odooQtyByVentaCodigo.get(`${ventaKey}|${codigoKey}`) || 0;

        tr.innerHTML = `
          <td>
            <div class="venta-copy">
              ${item.ventaLink
                ? `<a href="${item.ventaLink}" target="_blank" class="venta-link">${item.ventaMLFinal}</a>`
                : item.ventaMLFinal
              }
              <span class="copy-venta" data-venta="${item.ventaMLFinal}" title="Copiar venta">📋</span>
            </div>
          </td>
          <td>${item.r[1]}</td>
          <td>${item.r[2]}</td>
          <td>
            <div class="producto-despachar">
              <div class="linea-pubml">
                <span class="pubml-tag">${String(item.r[ML_COL_PUBML] || '').replace(/^MLC/i, '')}</span>
              </div>

              <div class="linea-titulo">
                <span class="titulo-pub">${String(item.r[ML_COL_TITULO] || '').trim()}</span>
              </div>
              <div>
                ${(() => {
                  const v = String(item.r[ML_COL_VARIANTE] || '').trim();
                  const t = String(item.r[ML_COL_TITULO] || '').trim().toLowerCase();
                  const vn = v.toLowerCase();
                  const ign = ['original', 'aluminio', 'ambos lados'];
                  return v && vn !== t && !ign.includes(vn)
                    ? `<span class="variante-pub">(${v.replace(/color:/i, '').trim()})</span>`
                    : ``;
                })()}
              </div>

              <!-- 👇 SOLO en OK -->
              ${(() => {
                const info = getVarianteOdooPorCodigo(item.codigoPersistido);

                return `
                  <div class="linea-codigo">
                    <span class="codigo-label">Código despachado:</span>
                    <span class="codigo-valor">${item.codigoPersistido || '—'}</span>
                    <span class="copy-codigo" data-codigo="${item.codigoPersistido}" title="Copiar código">📋</span>
                  </div>

                  <div class="linea-nombre">
                    <span class="codigo-label">Nombre prod. despachado:</span>
                    <span class="nombre-valor">${info?.name || '—'}</span>
                  </div>

                  <div class="linea-variante">
                    <span class="codigo-label">Variante prod. despachado:</span>
                    <span class="variante-valor">${info?.variant || '—'}</span>
                  </div>
                `;
              })()}
            </div>
          </td>
          <!-- Modificar producto despachado -->
          <td class="ubicaciones-col">
            ${(() => {

              const ubicaciones = getUbicacionesPorCodigo(item.codigoPersistido);

              if (!ubicaciones.length) return '—';

              return ubicaciones
                .map(u => `
                  <div class="ubicacion-tag">
                    <span class="ubicacion-text">${u}</span>
                    <span class="copy-ubicacion" data-ubicacion="${u}" title="Copiar ubicación">📋</span>
                  </div>
                `)
                .join('');

            })()}
          </td>

          <td>
            <input type="checkbox" ${item.cambioProducto ? 'checked' : ''} disabled />
          </td>

          <!-- Unid. a despachar -->
          <td>${item.cantidad || 0}</td>

          <!-- Unid. en Odoo -->
          <td>${unidOdoo}</td>

          <!-- Cambio producto -->
          <td>—</td>

          <!-- Precio -->
          <td>
            <span class="precio-valor">${item.precioUnitario.toLocaleString('es-CL')}</span>
            <span class="copy-precio" data-precio="${item.precioUnitario}" title="Copiar precio">📋</span>
          </td>

          <td class="obs-cell ok-cell">OK</td>
        `;

        resultsBody.appendChild(tr);
      }

      buildPills([...observaciones, ...observacionesOK]);

      resultsSection.classList.remove('hidden');
      statusEl.textContent = `Se encontraron ${observaciones.length} observaciones.`;
    } catch (err) {
      console.error(err);
      statusEl.textContent = err.message || 'Error procesando los archivos. Revisa el formato.';
    }
  };

  function buildOdooQtyIndex(odooRows) {
    const map = new Map();

    for (const r of odooRows) {
      // en buildOdooQtyIndex:
      const venta = normVentaKey(r[ODOO_COL_VENTA]);
      const codigo = normCodigo(r[ODOO_COL_CODIGO]);
      const qty = Number(r[ODOO_COL_QTY] || 0);

      if (!venta || !codigo) continue;

      const key = `${venta}|${codigo}`;
      map.set(key, (map.get(key) || 0) + qty);
    }

    return map;
  }

  async function loadMlInfo() {
    try {
      const res = await fetch('/api/ml/ventas/info', { cache: 'no-store' }); // 👈
      if (!res.ok) throw new Error('No hay Ventas ML cargadas aún');
      const json = await res.json();
      mlVentasInfo.textContent =
        `Usando Ventas ML cargadas el: ${new Date(json.uploadedAt).toLocaleString('es-CL')}`;
    } catch {
      mlVentasInfo.textContent =
        'No hay Ventas ML cargadas aún. Ve al menú "Ventas ML" para cargar el archivo.';
    }
  }

  loadMlInfo();

  let saveTimeout;

  resultsBody.addEventListener('input', async (e) => {
    if (!e.target.classList.contains('codigo-input')) return;

    const input = e.target;
    const tr = input.closest('tr');
    const obsCell = tr.querySelector('.obs-cell');
    const checkbox = tr.querySelector('.cambio-checkbox');

    const pubML = input.dataset.pubml;   // # publicación ML sin MLC
    const ventaML = input.dataset.venta; // # venta ML
    const valor = input.value || '';

    const keyPersistencia = `${ventaML}|${pubML}`;

    // 🔹 Persistir SIEMPRE el código (aunque no sea OK)
    const cambioProductoActual =
    tr.querySelector('.cambio-checkbox')?.checked || false;

    try {
      await fetch('/api/ml/ventas/codigos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: keyPersistencia,
          ventaML,
          pubML,
          codigo: valor,
          cambioProducto: cambioProductoActual
        })
      });

      codigosPorVenta[`${ventaML}|${pubML}`] = {
        ...(codigosPorVenta[`${ventaML}|${pubML}`] || {}),
        codigo: valor
      };
    } catch (err) {
      console.error('Error guardando código provisional', err);
    }
    
    await validarLineaDespacho(tr, input);
  });

  // 🔎 AUTOCOMPLETE VARIANTES ODOO
  resultsBody.addEventListener('input', async (e) => {
    if (!e.target.classList.contains('codigo-input')) return;

    const input = e.target;
    const tr = input.closest('tr');
    const suggestionsEl = tr.querySelector('.odoo-suggestions');

    if (!suggestionsEl) return;

    // 🚫 No mostrar variantes si el código no coincide con el escáner
    if (lastScannedCode && normCodigo(input.value) !== normCodigo(lastScannedCode)) {
      suggestionsEl.classList.add('hidden');
      suggestionsEl.innerHTML = '';
      return;
    }

    const value = input.value.trim().toLowerCase();

    if (value.length < 3) {
      suggestionsEl.classList.add('hidden');
      suggestionsEl.innerHTML = '';
      return;
    }

    await loadUltimasVariantesOdooParaBusqueda();

    const matches = variantesOdooCache
      .filter(v =>
        v.barcode.toLowerCase().includes(value) ||
        v.name.toLowerCase().includes(value)
      )
      .slice(0, 500);

    if (!matches.length) {
      suggestionsEl.classList.add('hidden');
      return;
    }

    suggestionsEl.innerHTML = `
      <div class="odoo-header">
        <span class="odoo-title">Variantes Odoo</span>
        <span class="odoo-close">✕</span>
      </div>

      <div class="odoo-list">
        ${matches.map(v => `
          <div class="odoo-option" data-barcode="${v.barcode}">
            <span class="odoo-barcode">${v.barcode}</span>
            <span class="odoo-name">${v.name}</span>
            <span class="odoo-variant">${v.variant}</span>
          </div>
        `).join('')}
      </div>
    `;

    suggestionsEl.classList.remove('hidden');
  });

  resultsBody.addEventListener('click', (e) => {

    // 🔹 Click en opción
    const option = e.target.closest('.odoo-option');
    if (option) {
      const tr = option.closest('tr');
      const input = tr.querySelector('.codigo-input');
      const suggestionsEl = tr.querySelector('.odoo-suggestions');

      input.value = option.dataset.barcode;

      const nombreEl = tr.querySelector('.nombre-valor');
      const varianteEl = tr.querySelector('.variante-valor');
      const codigoEl = tr.querySelector('.codigo-valor');
      if (codigoEl) codigoEl.textContent = option.dataset.barcode;

      nombreEl.textContent = option.querySelector('.odoo-name')?.textContent || '—';
      varianteEl.textContent = option.querySelector('.odoo-variant')?.textContent || '—';

      suggestionsEl.classList.add('hidden');
      suggestionsEl.innerHTML = '';

      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // 🔹 Click en botón cerrar ✕
    if (e.target.classList.contains('odoo-close')) {
      const tr = e.target.closest('tr');
      const suggestionsEl = tr.querySelector('.odoo-suggestions');

      suggestionsEl.classList.add('hidden');
      suggestionsEl.innerHTML = '';
      return;
    }

  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadMlInfo();
      updateAnalyzeAvailability();
    }
  });

  function validarExcelVentasML(file, rows) {
    // Heurísticas típicas del Excel de Ventas ML
    // Ajusta estos textos a los encabezados reales de tu archivo de ML
    const header = (rows[5] || rows[0] || []).join(' ').toLowerCase(); // tu ML parte desde fila 6
    const tieneVenta = header.includes('venta') || header.includes('# venta') || header.includes('n° venta');
    const tieneEstado = header.includes('estado');
    const tieneFecha = header.includes('fecha');

    // ML suele tener columnas: Venta, Fecha, Estado, Producto, Precio, Envío, etc.
    return tieneVenta && tieneEstado && tieneFecha;
  }

  resultsBody.addEventListener('click', async (e) => {

    const btn = e.target.closest('.copy-ubicacion');
    if (!btn) return;

    const ubicacion = btn.dataset.ubicacion;

    try {
      await navigator.clipboard.writeText(ubicacion);
      showToast(`Ubicación copiada: ${ubicacion}`, 1500, 'success');
    } catch {
      console.warn('No se pudo copiar');
    }

  });

  resultsBody.addEventListener('click', async (e) => {

    const ventaBtn = e.target.closest('.copy-venta');
    if (ventaBtn) {
      const venta = ventaBtn.dataset.venta;
      await navigator.clipboard.writeText(venta);
      showToast(`Venta copiada: ${venta}`, 1500);
      return;
    }

    const codigoBtn = e.target.closest('.copy-codigo');
    if (codigoBtn) {
      const codigo = codigoBtn.dataset.codigo;
      await navigator.clipboard.writeText(codigo);
      showToast(`Código copiado: ${codigo}`, 1500);
      return;
    }

    const precioBtn = e.target.closest('.copy-precio');
    if (precioBtn) {
      const precio = precioBtn.dataset.precio;
      await navigator.clipboard.writeText(precio);
      showToast(`Precio copiado: ${Number(precio).toLocaleString('es-CL')}`, 1500);
      return;
    }

    const scanBtn = e.target.closest('.copy-scan');
    if (scanBtn) {
      const code = scanBtn.dataset.scan;

      if (!code) {
        showToast('No hay código escaneado', 1500, 'error');
        return;
      }

      await navigator.clipboard.writeText(code);
      showToast(`Código escaneado copiado: ${code}`, 1500);
      return;
    }
  });

  analyzeBtn.addEventListener('click', async () => {
    try {
      resetResultadosUI();
      // 1) Validar que el archivo seleccionado sea Ventas ML (si hay archivo)
      /*if (mlInput.files.length) {
        const file = mlInput.files[0];
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

        if (!validarExcelVentasML(file, rows)) {
          statusEl.textContent = '❌ El archivo seleccionado no parece ser Ventas ML. Revisa que descargaste el Excel correcto desde MercadoLibre.';
          return;
        }

        // 2) Subir Ventas ML (solo si pasa validación)
        const fd = new FormData();
        fd.append('archivo', file);

        statusEl.textContent = 'Subiendo Ventas ML...';
        const up = await fetch('/api/ml/ventas', { method: 'POST', body: fd });
        if (!up.ok) {
          const t = await up.text();
          throw new Error('Error subiendo Ventas ML: ' + t);
        }
      }*/

      // 3) Validar contra el último Ventas ML persistido
      await runValidacionVentas();

      // 4) Refrescar info
      await loadMlInfo();
      await updateAnalyzeAvailability();

    } catch (e) {
      console.error(e);
      statusEl.textContent = e.message || 'Error al subir/validar Ventas ML';
    }
  });

  resultsBody.addEventListener('change', async (e) => {
    if (!e.target.classList.contains('cambio-checkbox')) return;

    const tr = e.target.closest('tr');
    const input = tr.querySelector('.codigo-input');

    if (!input) return;

    const pubML = input.dataset.pubml;
    const ventaML = input.dataset.venta;

    await fetch('/api/ml/ventas/codigos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: `${ventaML}|${pubML}`,
        ventaML,
        pubML,
        cambioProducto: e.target.checked
      })
    });

    // 🔁 Forzar revalidación
    validarLineaDespacho(tr, input);
  });

  resultsBody.addEventListener('click', (e) => {
    const btn = e.target.closest('.edit-btn');
    if (!btn) return;

    const tr = btn.closest('tr');
    const input = tr.querySelector('.codigo-input');
    if (!input) return;

    // 🔓 Siempre abrir el input al presionar el lápiz
    input.classList.remove('hidden');
    input.focus();
    input.select();
  });

  resultsBody.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('codigo-input')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.classList.add('hidden');
    }
  });

  /*resultsBody.addEventListener('blur', (e) => {
    if (!e.target.classList.contains('codigo-input')) return;

    const input = e.target;
    const tr = input.closest('tr');
    const isClickingEdit = tr?.querySelector('.edit-btn:hover');

    // Si el blur viene de hacer click en el lápiz, NO cerrar
    if (isClickingEdit) return;

    setTimeout(() => input.classList.add('hidden'), 150);
  }, true);*/

  if (mlInput) {

    mlInput.addEventListener('pointerdown', resetResultadosUI);
    mlInput.addEventListener('change', resetResultadosUI);
    mlInput.addEventListener('change', updateAnalyzeAvailability);

    let lastFileValue = mlInput.value;

    setInterval(() => {
      if (mlInput.value !== lastFileValue) {
        lastFileValue = mlInput.value;

        if (!mlInput.value) {
          resetResultadosUI();
        }
      }
    }, 300);

  }

  resultsBody.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('codigo-input')) return;

    if (e.key === 'Escape') {
      const tr = e.target.closest('tr');
      const sug = tr.querySelector('.odoo-suggestions');
      if (sug) {
        sug.classList.add('hidden');
        sug.innerHTML = '';
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('.odoo-suggestions') || 
        e.target.classList.contains('codigo-input')) return;

    document.querySelectorAll('.odoo-suggestions').forEach(el => {
      el.classList.add('hidden');
      el.innerHTML = '';
    });
  });

  const autoBtn = document.getElementById("autoUpdateBtn");

  autoBtn.addEventListener("click", async () => {

    let dirHandle;

    try {
      dirHandle = await window.showDirectoryPicker();
    } catch {
      return; // usuario canceló
    }

    const patterns = {
      variantes: "Variantes de producto (product.product)",
      ventasOdoo: "Orden de venta (sale.order)",
      publicaciones: "Publicaciones-",
      quants: "Quants (stock.quant)",
      ventasML: "_Ventas_CL_Mercado_Libre_y_Mercado_Shops"
    };

    const latest = {};

    for await (const entry of dirHandle.values()) {

      if (entry.kind !== "file") continue;

      const file = await entry.getFile();

      for (const key in patterns) {

        if (file.name.includes(patterns[key])) {

          if (!latest[key]) {
            latest[key] = file;
          } else {

            const current = latest[key];

            if (
              file.lastModified > current.lastModified
            ) {
              latest[key] = file;
            }

          }

        }

      }

    }

    //console.log("Archivos detectados:", latest);

    await uploadIfExists(latest.variantes, "/api/odoo/variantes");
    await uploadIfExists(latest.ventasOdoo, "/api/odoo/ventas");
    await uploadIfExists(latest.quants, "/api/odoo/stock");
    await uploadIfExists(latest.publicaciones, "/api/ml/publicaciones");
    await uploadIfExists(latest.ventasML, "/api/ml/ventas");

    variantesOdooCache = [];
    stockOdooCache = [];
    odooQtyByVentaCodigo = new Map();

    await loadUltimasVariantesOdooParaBusqueda();
    await loadStockOdoo();

    showToast("Archivos actualizados ✔", 2000);

    analyzeBtn.click();
  });

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
});