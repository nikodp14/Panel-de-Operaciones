document.addEventListener('DOMContentLoaded', () => {
  const START_ROW = 1;
  const mlInput = null;
  const analyzeBtn = document.getElementById('analyzeVentasBtn');
  const statusEl = document.getElementById('statusVentas');
  const resultsSection = document.getElementById('ventasResults');
  const resultsBody = document.getElementById('ventasResultsBody');
  const odooVentasInfo = document.getElementById('odooVentasInfo');
  const jumpsellerVentasInfo = document.getElementById('jumpsellerVentasInfo');
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
  let envioTimeout = null;
  let scanResultEl = null;
  let lastScanTs = 0;
  let lastScannedCode = null;
  let scannerLock = false;
  let variantesValidarSet = new Set();
  let jumpsellerProductosCache = [];
  let validacionEnCurso = false;

  const gunModal = document.getElementById("gunScannerModal");
  const closeGun = document.getElementById("closeGunScanner");
  const modal = document.getElementById("modalImagen");
  const cerrarModal = document.getElementById("cerrarModal");
  const modalContainer = document.getElementById("modalImagesContainer");
  const filesInput = document.getElementById("filesInput");

  // 🔥 mismas ayudas que ML + nueva
  const ayudas = {
    verVariantesOdoo: [
      "/imagenes/variantes-odoo0.jpg",
      "/imagenes/variantes-odoo1.jpg",
      "/imagenes/variantes-odoo2.jpg"
    ],
    verStockUbicacionesOdoo: [
      "/imagenes/stock-ubicaciones-odoo0.jpg",
      "/imagenes/stock-ubicaciones-odoo1.jpg",
      "/imagenes/stock-ubicaciones-odoo2.jpg"
    ],
    verVentasOdoo: [
      "/imagenes/ventas-odoo0.jpg",
      "/imagenes/ventas-odoo1.jpg",
      "/imagenes/ventas-odoo2.jpg"
    ],
    verProductosJumpseller: [
      "/imagenes/productos-jumpseller.jpg"
    ],
    verPedidosJumpseller: [
      "/imagenes/pedidos-jumpseller 1.jpg",
      "/imagenes/pedidos-jumpseller 2.jpg"
    ]
  };

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

  cerrarModal.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.add("hidden");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      modal.classList.add("hidden");
    }
  });

  async function archivosSonDeHoy() {

    const endpoints = [
      '/api/odoo/ventas/info',
      '/api/odoo/stock/info',
      '/api/odoo/variantes/info',
      '/api/jumpseller/productos/info',
      '/api/jumpseller/ventas/info'
    ];

    const resultados = await Promise.all(
      endpoints.map(async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return false;

          const data = await res.json();
          const fecha = new Date(data.uploadedAt);

          const hoy = new Date();

          return (
            fecha.getFullYear() === hoy.getFullYear() &&
            fecha.getMonth() === hoy.getMonth() &&
            fecha.getDate() === hoy.getDate()
          );
        } catch {
          return false;
        }
      })
    );

    return resultados.every(Boolean);
  }

  async function validarArchivosDelDiaJumpseller() {

    const hoy = new Date();
    hoy.setHours(0,0,0,0);

    const faltantes = [];

    async function check(url, nombre) {
      try {
        const esLocal = location.hostname === 'localhost';
        if (!esLocal){
          const res = await fetch(url, { cache: 'no-store' });

          if (!res.ok) {
            faltantes.push(nombre);
            return;
          }

          const data = await res.json();
          const fecha = new Date(data.uploadedAt);
          fecha.setHours(0,0,0,0);

          if (fecha.getTime() !== hoy.getTime()) {
            faltantes.push(nombre);
          }
        }

      } catch {
        faltantes.push(nombre);
      }
    }

    await Promise.all([
      check('/api/odoo/ventas/info', 'Ventas Odoo'),
      check('/api/odoo/stock/info', 'Stock Odoo'),
      check('/api/odoo/variantes/info', 'Variantes Odoo'),
      check('/api/jumpseller/productos/info', 'Productos Jumpseller'),
      check('/api/jumpseller/ventas/info', 'Pedidos Jumpseller')
    ]);

    return faltantes;
  }

  function esArchivoDeHoy(file) {

    const hoy = new Date();
    const fechaArchivo = new Date(file.lastModified);

    return (
      hoy.getFullYear() === fechaArchivo.getFullYear() &&
      hoy.getMonth() === fechaArchivo.getMonth() &&
      hoy.getDate() === fechaArchivo.getDate()
    );
  }

  function validarArchivosSeleccionados(files) {

    const esLocal = location.hostname === 'localhost';

    const required = {
      variantes: esLocal ? true : false,
      stock: esLocal ? true : false,
      ventas: esLocal ? true : false,
      productos: esLocal ? true : false,
      pedidos: esLocal ? true : false
    };

    const erroresFecha = [];

    files.forEach(file => {

      const name = file.name.toLowerCase();

      // 🔴 validar fecha
      if (!esArchivoDeHoy(file)) {
        erroresFecha.push(file.name);
        return;
      }

      // 🔍 detectar tipo
      if (name.includes("product.product")) {
        required.variantes = true;
      }
      else if (name.includes("stock.quant")) {
        required.stock = true;
      }
      else if (name.includes("sale.order")) {
        required.ventas = true;
      }
      else if (name.includes("demoto_productos_")) {
        required.productos = true;
      }
      else if (name.includes("demoto_pedidos_")) {
        required.pedidos = true;
        console.log('pasa');
      }

    });

    return { required, erroresFecha };
  }

  filesInput.addEventListener("change", async () => {

    const files = Array.from(filesInput.files);

    if (!files.length) return;

    const { required, erroresFecha } =
      validarArchivosSeleccionados(files);

    // ❌ archivos no son del día
    if (erroresFecha.length) {
      statusEl.textContent =
        `❌ Archivos no son del día: ${erroresFecha.join(", ")}`;
      return;
    }

    // ❌ faltan archivos
    let faltantes = Object.entries(required)
      .filter(([_, ok]) => !ok)
      .map(([k]) => k);

    if (faltantes.length) {

      const nombres = {
        variantes: "Variantes Odoo",
        stock: "Stock Odoo",
        ventas: "Ventas Odoo",
        productos: "Productos Jumpseller",
        pedidos: "Pedidos Jumpseller"
      };
    }

    // ✅ TODO OK → subir archivos
  
    statusEl.textContent = '';
    showToast("Subiendo archivos...", 1500);

    for (const file of files) {

      try {

        const formData = new FormData();
        formData.append("archivo", file);
        formData.append("lastModified", file.lastModified);

        const name = file.name.toLowerCase();

        let endpoint = "";

        if (name.includes("sale.order")) {
          endpoint = "/api/odoo/ventas";
        }
        else if (name.includes("product.product")) {
          endpoint = "/api/odoo/variantes";
        }
        else if (name.includes("stock.quant")) {
          endpoint = "/api/odoo/stock";
        }
        else if (name.includes("demoto_productos_")) {
          endpoint = "/api/jumpseller/productos";
        }
        else if (name.includes("demoto_pedidos_")) {
          endpoint = "/api/jumpseller/ventas";
        }
        else {
          continue;
        }

        const res = await fetch(endpoint, {
          method: "POST",
          body: formData
        });

        if (!res.ok) {
          showToast(`Error en ${file.name}`, 3000, "error");
          continue;
        }

      } catch (err) {
        console.error(err);
      }
    }

    showToast("Archivos cargados ✅", 1500);

    faltantes = await validarArchivosDelDiaJumpseller();

    if (faltantes.length) {

      statusEl.innerHTML = `
        ❌ Faltan archivos:<br>
        ${faltantes.map(f => `- ${f}`).join("<br>")}
      `;

      return;
    }

    await runValidacionVentas();

  });

  resultsBody.addEventListener("click", e => {

    const gunBtn = e.target.closest(".scan-gun-btn");
    if(!gunBtn) return;

    const tr = gunBtn.closest("tr");

    scanResultEl = tr.querySelector(".scan-result");

    lastScannedCode = null;
    lastScanTs = Date.now() + 300;

    gunModal.classList.remove("hidden");

    clearTimeout(scanInterval);
    pollScanner();

    // 🔥 foco al input del iframe
    setTimeout(() => {

      const frame = document.getElementById("gunScannerFrame");
      const input = frame?.contentWindow?.document?.getElementById("barcodeInput");

      if(input){
        input.focus();
      }

    },200);

    showToast("Esperando escaneo con pistola 📦");

  });

  closeGun.onclick = () => {
    gunModal.classList.add("hidden");
  };

  async function loadJumpsellerProductos() {

    if (jumpsellerProductosCache.length) return;

    const res = await fetch('/api/jumpseller/productos/ultimo', { cache: 'no-store' });
    if (!res.ok) return;

    const buf = await res.arrayBuffer();

    const wb = XLSX.read(buf, {
      type: 'array',
      raw: false,
      cellText: true
    });

    const ws = wb.Sheets[wb.SheetNames[0]];

    jumpsellerProductosCache =
      XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: '',
        raw: false
      });
  }

  function getPublicacionDesdeJumpsellerSKU(skuBuscado) {

    if (!skuBuscado) return null;

    const rows = jumpsellerProductosCache;

    for (let i = 0; i < rows.length; i++) {

      const sku = normSKU(rows[i][15]); // columna P

      if (sku !== skuBuscado) continue;

      const estado = String(rows[i][14] || '').trim(); // columna O

      // 🟢 Caso 1: es producto padre
      if (estado) {
        return sku.replace(/^MLC/i, '');
      }

      // 🟡 Caso 2: es variante → subir filas
      for (let j = i - 1; j >= 0; j--) {

        const estadoArriba = String(rows[j][14] || '').trim();

        if (estadoArriba) {

          const pub = String(rows[j][15] || '').trim();

          return pub.replace(/^MLC/i, '');
        }
      }
    }

    return null;
  }

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

    const codigoInput = (input?.value || '').trim();

    const ventaML = input.dataset.venta;
    const pubML = input.dataset.pubml;

    const keyPersistencia = `${ventaML}|${pubML}`;

    lastScannedCode = code;
    lastScanTs = data.ts || Date.now();

    // Mostrar escaneo en pantalla
    scanResultEl.textContent = code;

    const copyBtn = scanResultEl.parentElement.querySelector('.copy-scan');
    if (copyBtn) copyBtn.dataset.scan = code;

    try {

      // Persistir escaneo
      await fetch('/api/jumpseller/ventas/codigos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: keyPersistencia,
          ventaML,
          pubML,
          codigo: codigoInput,   // 👈 guardar código del input
          escaneado: code
        })
      });

      // actualizar cache local
      codigosPorVenta[keyPersistencia] = {
        ...(codigosPorVenta[keyPersistencia] || {}),
        codigo: codigoInput,
        escaneado: code
      };

    } catch (err) {
      console.error("Error guardando escaneo", err);
    }

    await validarLineaDespacho(tr, input);

    showToast("Producto escaneado 📦", 1500);

  }

  function restaurarEstadoDespachoUI() {

    const rows = resultsBody.querySelectorAll("tr");

    rows.forEach(tr => {

      const input = tr.querySelector(".codigo-input");
      const scanEl = tr.querySelector(".scan-result");

      if (!input) return;

      const venta = input.dataset.venta;
      const pub = input.dataset.pubml;

      const key = `${venta}|${pub}`;

      const data = codigosPorVenta[key];

      if (!data) return;

      // 🔹 Restaurar código ingresado
      if (data.codigo) {
        input.value = data.codigo;
      }

      // 🔹 Restaurar escaneo
      if (scanEl && data.escaneado) {
        scanEl.textContent = data.escaneado;
      }

    });

  }

  function extraerColorDesdeTitulo(titulo) {

    if (!titulo) return '';

    const match = titulo.match(/\(color:\s*([^)]+)\)/i);

    if (match) {
      return match[1].trim();
    }

    return '';
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
    //console.log('codigoEfectivo');
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
    if (!codigoCoincideConEscaneo(valor, escaneado)) {
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
      obsCell.textContent = 'FALTAN UNIDADES POR ENTREGAR EN ODOO';
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

    // 🔹 validar si requiere envío
    const metodo = (tr.dataset.metodoenvio || '').toLowerCase();

    const requiereEnvio =
      !metodo.includes('demoto') &&
      !(metodo.includes('santiago') &&
        metodo.includes('colina') &&
        metodo.includes('padre')) &&
      !tr.classList.contains('paquete-hija-row');

    const envioInput = tr.querySelector('.envio-input');
    const envioValor = Number(envioInput?.value || 0);

    if (requiereEnvio && !envioValor) {

      obsCell.textContent = 'INGRESE COSTO DE ENVÍO';
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

  resultsBody.addEventListener('input', (e) => {

    if (!e.target.classList.contains('envio-input')) return;

    const input = e.target;

    const ventaML = input.dataset.venta;
    const pubML = input.dataset.pubml;

    const key = `${ventaML}|${pubML}`;
    const valor = toNumberCLP(input.value);

    clearTimeout(envioTimeout);

    envioTimeout = setTimeout(async () => {

      try {

        await fetch('/api/jumpseller/ventas/codigos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key,
            ventaML,
            pubML,
            envioManual: valor
          })
        });

        codigosPorVenta[key] = {
          ...(codigosPorVenta[key] || {}),
          envioManual: valor
        };

        await runValidacionVentas();

      } catch (err) {
        console.error("Error guardando envío", err);
      }

    }, 500);

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

    variantesOdooCache = rows.slice(1)
      .map(r => ({
        barcode: normalizeBarcode(r[1]),

        // versión original (para mostrar)
        name: String(r[2] || '').trim(),
        variant: String(r[5] || '').trim(),
        
        default_code: String(r[0] || '').trim(),

        // versión normalizada (para comparar)
        nameNorm: normalizeVariantColor(r[2] || ''),
        variantNorm: normalizeVariantColor(r[5] || '')
      }))
      .filter(v => v.barcode);

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

    const COL_CANTIDAD = header.findIndex(h =>
      h.includes('cantidad')
    );

    stockOdooCache = rows.slice(1).map(r => ({
      barcode: String(r[COL_BARCODE] || '').trim(),
      ubicacion: String(r[COL_UBICACION] || '').trim(),
      cantidad: Number(r[COL_CANTIDAD] || 0)
    })).filter(r => r.barcode);

  }
  
  function getUbicacionesPorCodigo(barcode) {

    if (!barcode) return [];

    const code = String(barcode).trim().toLowerCase();

    return stockOdooCache
    .filter(r => r.barcode.toLowerCase() === code)
    .map(r => ({
      ubicacion: r.ubicacion,
      cantidad: r.cantidad
    }))
    .filter(r => r.ubicacion)
    .sort((a,b)=>b.cantidad-a.cantidad);
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
      //.replace(/[-–—]/g, '')  // quita guiones, se modifica para corregir - para ubicaciones
      .replace(/\.0$/, '');   // quita .0 típico de Excel
  }

  function codigoCoincideConEscaneo(codigoEsperado, escaneado) {

    const esperado = normCodigo(codigoEsperado);
    const scan = normCodigo(escaneado);

    if (!esperado || !scan) return false;

    // ✅ 1. coincidencia exacta
    if (esperado === scan) return true;

    // ✅ 2. coincidencia parcial directa
    if (esperado.includes(scan) || scan.includes(esperado)) {
      return true;
    }

    // ✅ 3. NUEVO: buscar coincidencias en TODAS las variantes Odoo
    const matches = variantesOdooCache.filter(v => {
      const barcode = normCodigo(v.barcode);
      const internal = normCodigo(v.default_code);

      return (
        (barcode && (barcode.includes(scan) || scan.includes(barcode)) && barcode.includes(esperado)) ||
        (internal && (internal.includes(scan) || scan.includes(internal)) && internal.includes(esperado))
      );
    });

    // 👉 SOLO aceptar si hay UNA coincidencia
    if (matches.length === 1) {
      return true;
    }

    return false;
  }

  function normSKU(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .trim()
      .replace(/\.0$/, '');
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
      if (!res.ok) throw new Error('No hay Ventas Odoo cargadas aún');
      const json = await res.json();
      odooVentasInfo.textContent =
        `Usando Ventas Odoo cargadas el: ${new Date(json.uploadedAt).toLocaleString('es-CL')}`;
    } catch {
      odooVentasInfo.textContent =
        'No hay Ventas Odoo cargadas. Ve al menú "Ventas Odoo" para subir el archivo.';
    }
  }

  loadArchivosInfo();

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
      const res = await ventasRefetch('/api/jumpseller/ventas/info', { cache: 'no-store' });
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

  async function loadArchivosInfo() {

    const container = document.getElementById("archivosInfo");
    if (!container) return;

    const endpoints = [
      { url: '/api/odoo/ventas/info', label: 'Ventas Odoo' },
      { url: '/api/odoo/stock/info', label: 'Stock Odoo' },
      { url: '/api/odoo/variantes/info', label: 'Variantes Odoo' },
      { url: '/api/jumpseller/productos/info', label: 'Productos Jumpseller' },
      { url: '/api/jumpseller/pedidos/info', label: 'Pedidos Jumpseller' }
    ];

    const hoy = new Date();

    const results = await Promise.all(
      endpoints.map(async (e) => {

        try {
          const res = await fetch(e.url);
          if (!res.ok) return { ...e, ok: false };

          const data = await res.json();
          const fecha = new Date(data.uploadedAt);

          const esHoy =
            fecha.getFullYear() === hoy.getFullYear() &&
            fecha.getMonth() === hoy.getMonth() &&
            fecha.getDate() === hoy.getDate();

          return {
            ...e,
            ok: true,
            fecha,
            esHoy
          };

        } catch {
          return { ...e, ok: false };
        }

      })
    );

    container.innerHTML = results.map(r => {

      if (!r.ok) {
        return `<p class="file-error">❌ ${r.label}: no cargado</p>`;
      }

      const fechaStr = r.fecha.toLocaleString('es-CL');

      return `
        <p class="${r.esHoy ? 'file-ok' : 'file-old'}">
          ${r.esHoy ? '🟢' : '🟡'} ${r.label}: ${fechaStr}
        </p>
      `;

    }).join("");

}

  async function runValidacionVentas() {
    if (validacionEnCurso) return;
    validacionEnCurso = true;
    codigosPorVenta = {};
    const codigosRes = await fetch('/api/jumpseller/ventas/codigos');
    codigosPorVenta = await codigosRes.json();

    const faltantes = await validarArchivosDelDiaJumpseller();

    if (faltantes.length) {
      showToast("Faltan archivos del día", 3000, "error");

      statusEl.innerHTML = `
        ❌ Faltan archivos:<br>
        ${faltantes.map(f => `- ${f}`).join("<br>")}
      `;

      return;
    }

    statusEl.textContent = 'Procesando archivos...';
    await loadUltimasVariantesOdooParaBusqueda();
    await loadStockOdoo();
    await loadJumpsellerProductos();
    variantesValidarSet = await loadVariantesValidarFromConfig();
    resultsBody.innerHTML = '';
    resultsSection.classList.add('hidden');

    try {
      const ventasRes = await fetch('/api/jumpseller/ventas/ultimo');
      if (!ventasRes.ok) {
        throw new Error('No hay Ventas Jumpseller cargadas. Sube el archivo primero.');
      }
      const mlBuf = await ventasRes.arrayBuffer();
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
        'nombre del producto'
      ]);

      if (ML_COL_TITULO === -1) {
        throw new Error('No se encontró la columna "Nombre del producto" en el Excel.');
      }

      const ML_COL_METODO_ENVIO = findColIndexByName([
        'nombre del método de envío',
        'metodo de envio',
        'método de envío'
      ]);

      if (ML_COL_METODO_ENVIO === -1) {
        throw new Error('No se encontró la columna "Nombre del método de envío" en el Excel.');
      }

      const ML_COL_TOTAL = headerRow.findIndex(col => {
        const text = String(col || '').toLowerCase().trim();
        return text.includes('total') && !text.includes('subtotal');
      });

      if (ML_COL_TOTAL === -1) {
        throw new Error('No se encontró la columna "Total" en el Excel de Ventas ML.');
      }

      const ML_COL_UNIDADES = findColIndexByName([
        'cantidad de productos'
      ]);

      if (ML_COL_UNIDADES === -1) {
        throw new Error('No se encontró la columna "Cantidad de Productos" en el Excel de Ventas ML.');
      }

      const ML_COL_PUBML = findColIndexByName([
        'sku del producto'
      ]);

      if (ML_COL_PUBML === -1) {
        throw new Error('No se encontró la columna "SKU del Producto" en el Excel de Ventas ML.');
      }

      const ML_COL_VARIANTE = findColIndexByName([
        'variante'
      ]);

      const ML_COL_PAGO = findColIndexByName([
        'nombre de pago'
      ]);

      if (ML_COL_PAGO === -1) {
        throw new Error('No se encontró la columna "Nombre de Pago" en el Excel de Ventas Jumpseller.');
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
        const pubRes = await fetch('/api/jumpseller/publicaciones/ultimo', { cache: 'no-store' });
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
      const cutoff = location.hostname === 'localhost'
        ? new Date('2026-01-01')   // entorno local
        : new Date('2026-03-13');  // producción
      const observaciones = [];
      const observacionesOK = [];
      const odooQtyByVenta = new Map();

      // Set con las ventas registradas en Odoo (col G -> index 6)
      const odooSet = new Set(
        odooData
          .map(r => normVenta(r[6]))  // Col G
          .filter(Boolean)
      );

      let ultimaVenta = 0;

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
      let ventaContexto = null;
      let fechaContexto = null;
      let pagoContexto = null;
      let estadoContexto = null;
      let ventaLinkContexto = null;

      for (let i = 0; i < mlData.length; i++) {
        const r = mlData[i];
        const excelRowIndex = START_ROW + i;
		    const ventaLink = '';
        const ML_COL_FECHA = findColIndexByName([
          'fecha'
        ]);
        const ML_COL_ENVIO = findColIndexByName([
          'envío',
          'envio'
        ]);
        const ML_COL_ESTADO = findColIndexByName([
          'estado del pago'
        ]);
        
        let ventaML = String(r[ML_COL_VENTA] || '').trim();
        let fecha = parseDate(r[ML_COL_FECHA]);
        let nombrePago = String(r[ML_COL_PAGO] || '').trim();
        let estadoML = String(r[ML_COL_ESTADO] || '');
        
        //const totalCLPraw = r[13];         // Col M
        const totalCLPraw = r[ML_COL_TOTAL];
        const ingresoEnvioCLP = r[9]; // Col J
        const costoEnvioCLP = 0;//r[10];  // Col K
        const cantidadRaw = r[ML_COL_UNIDADES]; // Col G (Unidades)
        const cantidad = Number(cantidadRaw) || 0;
        const totalCLP = typeof totalCLPraw === 'number'
          ? totalCLPraw
          : parseFloat(String(totalCLPraw || '').replace(/\./g, '').replace(',', '.'));
		    let fechaMostrada = r[ML_COL_FECHA];
        let esLineaHijaPaquete = !totalCLP;
   
        primeraLineaPaquete = false;
		
        const precioMostrado = calcularPrecioMostrado(
          totalCLP,
          ingresoEnvioCLP,
          costoEnvioCLP,
          estadoML
        );

        const titulo = String(r[ML_COL_TITULO] || '').toLowerCase();
        let metodoEnvio = String(r[ML_COL_METODO_ENVIO] || '').trim();

        if (!esLineaHijaPaquete) {
          // Cabecera nueva
          ventaContexto = ventaML;
          fechaContexto = fecha;;
          pagoContexto = nombrePago;
          estadoContexto = estadoML;
        } else {
          // Heredar contexto
          ventaML = ventaContexto;
          fecha = fechaContexto;
          fechaMostrada = fechaContexto.toLocaleDateString("es-CL");
          nombrePago = pagoContexto;
          estadoML = estadoContexto;
        }

        // Detectar inicio de paquete
        if (esLineaHijaPaquete) {
          paqueteActivo = true;
          precioPaqueteActivo = totalCLP;

          ventaPaqueteActiva = ventaML;        // 👈 guardar venta principal
          ventaLinkPaqueteActivo = ventaLink;  // 👈 guardar link principal
        }

        if (nombrePago.toLowerCase().trim() === 'mercadolibre') {
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

        // 1️⃣ PRIORIDAD MÁXIMA: DEVOLVER
        if (esCancelODevolucion && qtyEntrega > 0) {
          obs = 'DEVOLVER';
        }

        // 2️⃣ Registrar venta
        else if (!existeEnOdoo && (totalCLP > 0 || esLineaHijaPaquete) && !esCancelODevolucion){
          obs = 'REGISTRAR VENTA EN ODOO';
        }

        // 3️⃣ Entregar
        else if (existeEnOdoo && totalCLP > 0 && qtyEntrega === 0 && !esCancelODevolucion) {
          obs = 'ENTREGAR';
        }

        const unidadesML = Number(r[ML_COL_UNIDADES] || 0);
        let pubOriginal = String(r[ML_COL_PUBML] || '')
          .replace(/^MLC/i, '')
          .trim();

        // si no parece publicación ML
        const pubDetectada =
          getPublicacionDesdeJumpsellerSKU(normSKU(r[ML_COL_PUBML]));;
        
        if (pubDetectada) {
          pubOriginal = pubDetectada;
        }

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

          // 🔹 calcular sugerido igual que en el render
          let codigoSugeridoTemp = '';

          try {
            let varianteML = '';
            if (ML_COL_VARIANTE !== -1) {
              varianteML = String(r[ML_COL_VARIANTE] || '')
                .replace(/color\s*:/i, '')
                .trim();
            } else {
              const tituloRaw = String(r[ML_COL_TITULO] || '');
              varianteML = extraerColorDesdeTitulo(tituloRaw);
            }

            const matches = resolveMlVariant({
              publication: pubProcesar,
              mlVariantRaw: varianteML,
              mlTitle: titulo,
              odooProducts: variantesOdooCache,
              variantesValidarSet
            });

            if (matches && matches.length) {
              codigoSugeridoTemp = matches[0].barcode;
            }

          } catch (err) {
            console.warn("Resolver variante ML error", err);
          }

          // 🔹 usar persistido o sugerido
          const codigoEfectivoTemp =
            codigoPersistido || codigoSugeridoTemp || '';

          const codigoKey = normCodigo(codigoEfectivoTemp);

          const cambioProductoPersistido =
            codigosPorVenta[keyPersistencia]?.cambioProducto || false;

          const cantidadADespachar = await calcularCantidadDespacho(
            pubProcesar,
            unidadesML
          );

          let baseTotal = precioMostrado;

          const metodo = (metodoEnvio || '').toLowerCase();
          let obsFinal = obs; // copiamos el obs base

          if (metodo.includes('demoto')) {

            // retiro → no descontar nada
            baseTotal = precioMostrado;

          }
          else if (metodo.includes('santiago') &&
                  metodo.includes('colina') &&
                  metodo.includes('padre')) {

            // despacho propio
            /*if(ventaKey == 3062){
              console.log(precioMostrado);
            }*/
            baseTotal = precioMostrado - (3000);

          }
          else {

            const envioInput =
              codigosPorVenta[keyPersistencia]?.envioManual || 0;

            if (idx == 0 && (!envioInput || Number(envioInput) == 0) && !includesCancelOrReturn(estadoML)) {
              obsFinal = 'INGRESE COSTO DE ENVÍO';
            }

            baseTotal = precioMostrado - (envioInput / 1.19);

          }

          const precioUnitarioCorrecto =
            cantidadADespachar > 0
              ? Math.round(baseTotal / cantidadADespachar)
              : baseTotal;  

          // 🔹 VALIDACIÓN ODOO AQUÍ DENTRO
          if (existeEnOdoo && !includesCancelOrReturn(estadoML)) {

            if (!codigoKey) {
              obsFinal = 'INGRESE PRODUCTO A DESPACHAR';

            } else if (!odooQtyByVentaCodigo.has(`${ventaKey}|${codigoKey}`)) {

              if (existeVentaEnOdooConOtroCodigo) {
                obsFinal = 'EXISTE LA VENTA EN ODOO, PERO CON OTRO CÓDIGO';
              } else {
                obsFinal = 'REGISTRAR VENTA EN ODOO';
              }

            } else {

              const qtyOdoo =
                odooQtyByVentaCodigo.get(`${ventaKey}|${codigoKey}`) || 0;

              if (qtyOdoo < cantidadADespachar) {
                obsFinal = 'FALTAN UNIDADES POR ENTREGAR EN ODOO';

              } else if (qtyOdoo > cantidadADespachar) {
                obsFinal = 'EXCESO DE UNIDADES REGISTRADAS';

              } else {
                obsFinal = null;
              }
            }
          }

          if (obsFinal === 'REGISTRAR VENTA EN ODOO' && !codigoKey) {
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
            
            if(mlData[i+1]){
              esLineaHijaPaquete = !mlData[i+1][ML_COL_TOTAL];
            }
          }

          // 🔒 No permitir OK si no hubo escaneo
          const escaneado =
          codigosPorVenta[keyPersistencia]?.escaneado || null;

          const pubKey = String(pubProcesar || '').replace(/^MLC/i, '').trim();
          const cambioProducto = cambioProductoPersistido;

          const codigoIngresado =
          codigosPorVenta[keyPersistencia]?.codigo || '';

          const codigoEfectivo =
          codigoIngresado || codigoSugeridoTemp || '';

          const escaneoValido =
          codigoEfectivo &&
          escaneado &&
          codigoCoincideConEscaneo(codigoEfectivo, escaneado);

          // 🔴 Primero validar producto correcto
          if (
          codigoEfectivo &&
          !cambioProducto &&
          !contienePubML(codigoEfectivo, pubProcesar)
          ) {
            obsFinal = 'PRODUCTO A DESPACHAR INCORRECTO';
          }

          else if (codigoEfectivo && !escaneado && !includesCancelOrReturn(estadoML)) {
            obsFinal = 'ESCANEE EL PRODUCTO';
          }

          else if (
          codigoEfectivo &&
          escaneado &&
          !codigoCoincideConEscaneo(codigoEfectivo, escaneado)
          ) {
            obsFinal = 'EL CÓDIGO NO COINCIDE CON EL ESCÁNER';
          }

          let obsRender = obsFinal;

            // 🔒 Nunca permitir OK sin escaneo válido
          if (!obsRender) {

            const requiereEnvio =
              !esLineaHijaPaquete &&
              !(metodoEnvio || '').toLowerCase().includes('demoto') &&
              !((metodoEnvio || '').toLowerCase().includes('santiago') &&
                (metodoEnvio || '').toLowerCase().includes('colina') &&
                (metodoEnvio || '').toLowerCase().includes('padre'));

            const envioGuardado =
              codigosPorVenta[keyPersistencia]?.envioManual || 0;

            if (requiereEnvio && (!envioGuardado || envioGuardado == 0) && !includesCancelOrReturn(estadoML)) {
              obsRender = 'INGRESE COSTO DE ENVÍO';
            }
            else if (!escaneoValido && !includesCancelOrReturn(estadoML)) {
              obsRender = 'ESCANEE EL PRODUCTO';
            }
            else {
              obsRender = 'OK';
            }
          }

          const itemBase = {
            r: [...r],
            ventaMLFinal,
            ventaLink: ventaLinkFinal,
            obs: obsRender,
            precioMostrado: precioMostradoFinal,
            precioUnitario: precioUnitarioFinal,
            cantidad: unidadesML,
            codigoPersistido,
            cambioProducto: cambioProductoPersistido,
            esPack,
            esLineaHijaPaquete,
            pubProcesar,
            fechaMostrada: fechaMostrada,
            estadopagoMostrado : estadoML,
            metodoEnvio
          };

          itemBase.r[ML_COL_PUBML] = pubProcesar;

          if (obsRender === 'OK') {
            observacionesOK.push(itemBase);
          } else {
            observaciones.push(itemBase);
          }
        }
      }

      const totalObs = observaciones.length;

      if (totalObs === 0) {
        statusEl.textContent = 'No se encontraron observaciones 🎉';
      } else {
        statusEl.textContent = `Se encontraron ${totalObs} observaciones`;
      }

      let ultimaFilaRenderizada = null;
      let pintarPrimeraLineaPack = true;

      for (const item of observaciones) {
        const obs = item.obs;
        const pubML = String(item.r[ML_COL_PUBML] || '').trim(); // Col Q

        const isRegistrar = obs === 'REGISTRAR VENTA EN ODOO';

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
        
        /*if (item.ventaMLFinal == 3162){
            console.log(item.esLineaHijaPaquete);
            console.log('ultimaFilaRenderizada');
            console.log(ultimaFilaRenderizada);
            console.log(item.pubProcesar);
          }*/

        if (item.ventaMLFinal != ultimaVenta)
          pintarPrimeraLineaPack = true;
          
        ultimaVenta = item.ventaMLFinal;

        if (item.esLineaHijaPaquete) {
          tr.classList.add('paquete-hija-row');
          // 🔹 marcar cabecera retroactivamente
          if (ultimaFilaRenderizada && pintarPrimeraLineaPack) {
            ultimaFilaRenderizada.classList.remove('pack-row');
            ultimaFilaRenderizada.classList.add('pack-parent');
            pintarPrimeraLineaPack = false;
          }
        }
        else if (item.esPack) {
          tr.classList.add('pack-row');
        }
        else if (highlightDespacho) {
          tr.classList.add('kit-row');
        }

        const tituloReal = tituloPorPublicacion.get(pubMLSinMLC);

        const tituloPub = /*tituloReal
          ? tituloReal
          : */String(item.r[ML_COL_TITULO] || '').trim();// Col S
        let variante = '';
        if (ML_COL_VARIANTE !== -1) {
          variante = String(item.r[ML_COL_VARIANTE] || '')
          .replace(/color\s*:/i, '')
          .trim(); // Col T
        } else {
          variante = extraerColorDesdeTitulo(tituloPub);
        }

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
        let codigoSugerido = '';

        try {
          const matches = resolveMlVariant({
            publication: pubMLSinMLC,
            mlVariantRaw: variante,
            mlTitle: tituloPub,
            odooProducts: variantesOdooCache,
            variantesValidarSet
          });
          
          /*if (pubMLSinMLC == 2823789240){
            console.log(pubMLSinMLC, variante, tituloPub, variantesOdooCache, variantesValidarSet, matches);
          }*/

          if (matches && matches.length === 1) {
            codigoSugerido = matches[0].barcode;
          }

        } catch (err) {
          console.warn("Resolver variante ML error", err);
        }

        const codigoPersistidoLimpio =
          (item.codigoPersistido || '').trim();

        const codigoEfectivo =
          codigoPersistidoLimpio
            ? codigoPersistidoLimpio
            : (codigoSugerido || '');

        const qtyRegistradaOdoo =
          odooQtyByVentaCodigo.get(`${ventaKey}|${codigoEfectivo}`) || 0;

        tr.innerHTML = `
          <td></td>
          <td>
            <div class="venta-copy">
              ${item.ventaLink
                ? `<a href="${item.ventaLink}" target="_blank" class="venta-link">${item.ventaMLFinal}</a>`
                : item.ventaMLFinal
              }
              <span class="copy-venta" data-venta="${item.ventaMLFinal}" title="Copiar venta">📋</span>
            </div>
          </td>
          <td>${item.fechaMostrada}</td>
          <td>${item.estadopagoMostrado}</td>
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
                      value="${codigoEfectivo}"
                    />
                    <div class="odoo-suggestions hidden"></div>
                  </div>

                  ${(() => {
                    const info = getVarianteOdooPorCodigo(codigoEfectivo);

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
                    <button class="scan-btn">Escanear celular</button>
                    <button class="scan-gun-btn">Escanear pistola</button>

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

              const ubicaciones = getUbicacionesPorCodigo(codigoEfectivo);

              if (!ubicaciones.length) return '—';

              return ubicaciones
              .map(u => `
                <div class="ubicacion-tag">
                  <span class="ubicacion-text">
                    ${u.ubicacion} <b>(${u.cantidad})</b>
                  </span>
                  <span class="copy-ubicacion" data-ubicacion="${u.ubicacion}" title="Copiar ubicación">📋</span>
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
            <div class="qty-wrapper">
              <span class="qty-valor">${unidadesDespachar}</span>
              <span class="copy-qty" data-qty="${unidadesDespachar}" title="Copiar unidades">📋</span>
              ${highlightDespacho ? '<span class="kit-badge">(PACK)</span>' : ''}
            </div>
          </td>
          <td class="${
            qtyRegistradaOdoo < unidadesDespachar ? 'qty-alert' :
            qtyRegistradaOdoo > unidadesDespachar ? 'qty-exceso' : ''
          }">
            ${qtyRegistradaOdoo}
          </td>
          <td>
              ${!item.esLineaHijaPaquete &&
              !(item.metodoEnvio || '').toLowerCase().includes('demoto') &&
              !((item.metodoEnvio || '').toLowerCase().includes('santiago') &&
                (item.metodoEnvio || '').toLowerCase().includes('colina') &&
                (item.metodoEnvio || '').toLowerCase().includes('padre')) ? `
                <div class="envio-input-wrapper">
                  <input 
                    type="number"
                    class="envio-input"
                    placeholder="Costo envío"
                    data-venta="${ventaMLRow}"
                    data-pubml="${pubMLSinMLC}"
                    value="${codigosPorVenta[`${item.ventaMLFinal}|${pubMLSinMLC}`]?.envioManual || ''}"
                  />
                </div>
              ` : ''}
            <span class="precio-valor">${item.precioUnitario.toLocaleString('es-CL')}</span>
            <span class="copy-precio" data-precio="${item.precioUnitario}" title="Copiar precio">📋</span>
          </td>
          <td class="obs-cell error-cell">
            ${item.obs}
          </td>
        `;

        resultsBody.appendChild(tr);
        ultimaFilaRenderizada = tr;
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
        else if (item.esPack) {
          tr.classList.add('pack-row');
        }
        else if (highlightDespacho) {
          tr.classList.add('kit-row');
        }

        tr.dataset.obs = 'OK';

        tr.dataset.pubml = item.pubProcesar;

        const ventaMLRow = item.ventaMLFinal;        
        const codigoKey = normCodigo(item.codigoPersistido);
        const ventaKey = normVentaKey(ventaMLRow);

        const unidOdoo =
          odooQtyByVentaCodigo.get(`${ventaKey}|${codigoKey}`) || 0;

        const ML_COL_FECHA = findColIndexByName([
          'fecha'
        ]);
        const ML_COL_ESTADO = findColIndexByName([
          'estado del pago'
        ]);

        tr.innerHTML = `
          <td></td>
          <td>
            <div class="venta-copy">
              ${item.ventaLink
                ? `<a href="${item.ventaLink}" target="_blank" class="venta-link">${item.ventaMLFinal}</a>`
                : item.ventaMLFinal
              }
              <span class="copy-venta" data-venta="${item.ventaMLFinal}" title="Copiar venta">📋</span>
            </div>
          </td>
          <td>${item.fechaMostrada}</td>
          <td>${item.estadopagoMostrado}</td>
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

              const codigoFinal =
                normCodigo(item.codigoPersistido || '');

              const ubicaciones = getUbicacionesPorCodigo(codigoFinal);

              if (!ubicaciones.length) return '—';

              return ubicaciones
                .map(u => `
                  <div class="ubicacion-tag">
                    <span class="ubicacion-text">
                      ${u.ubicacion} <b>(${u.cantidad})</b>
                    </span>
                    <span class="copy-ubicacion" data-ubicacion="${u.ubicacion}" title="Copiar ubicación">📋</span>
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

          ${(() => {

            const key = `${item.ventaMLFinal}|${item.pubProcesar}`;
            const envioGuardado = codigosPorVenta[key]?.envioManual;

            if (envioGuardado) {
              return `
                <div class="envio-input-wrapper">
                  <input 
                    type="number"
                    class="envio-input"
                    value="${envioGuardado}"
                    readonly
                  />
                </div>
              `;
            }

            return '';

          })()}

          <span class="precio-valor">${item.precioUnitario.toLocaleString('es-CL')}</span>
          <span class="copy-precio" data-precio="${item.precioUnitario}" title="Copiar precio">📋</span>

        </td>

          <td class="obs-cell ok-cell">OK</td>
        `;

        resultsBody.appendChild(tr);
      }

      buildPills([...observaciones, ...observacionesOK]);

      restaurarEstadoDespachoUI();

      resultsSection.classList.remove('hidden');
      statusEl.textContent = `Se encontraron ${observaciones.length} observaciones.`;
      validacionEnCurso = false;
    } catch (err) {
      console.error(err);
      statusEl.textContent = err.message || 'Error procesando los archivos. Revisa el formato.';
      validacionEnCurso = false;
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
      const res = await ventasRefetch('/api/jumpseller/ventas/info', { cache: 'no-store' }); // 👈
      if (!res.ok) throw new Error('No hay Ventas Jumpseller cargadas aún');
      const json = await res.json();
      jumpsellerVentasInfo.textContent =
        `Usando Ventas ML cargadas el: ${new Date(json.uploadedAt).toLocaleString('es-CL')}`;
    } catch {
      jumpsellerVentasInfo.textContent =
        'No hay Ventas Jumpseller cargadas aún. Ve al menú "Ventas ML" para cargar el archivo.';
    }
  }

  let saveTimeout;

  resultsBody.addEventListener('input', async (e) => {
    if (!e.target.classList.contains('codigo-input')) return;

    const input = e.target;
    const tr = input.closest('tr');
    const obsCell = tr.querySelector('.obs-cell');
    const nombreEl = tr.querySelector('.nombre-valor');
    const varianteEl = tr.querySelector('.variante-valor');

    const info = getVarianteOdooPorCodigo(input.value);

    if (info) {
      if (nombreEl) nombreEl.textContent = info.name || '—';
      if (varianteEl) varianteEl.textContent = info.variant || '—';
    } else {
      if (nombreEl) nombreEl.textContent = '—';
      if (varianteEl) varianteEl.textContent = '—';
    }
        const checkbox = tr.querySelector('.cambio-checkbox');

    const pubML = input.dataset.pubml;   // # publicación ML sin MLC
    const ventaML = input.dataset.venta; // # venta ML
    const valor = input.value || '';

    const keyPersistencia = `${ventaML}|${pubML}`;

    // 🔹 Persistir SIEMPRE el código (aunque no sea OK)
    const cambioProductoActual =
    tr.querySelector('.cambio-checkbox')?.checked || false;

    try {
      await fetch('/api/jumpseller/ventas/codigos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: keyPersistencia,
          ventaML,
          pubML,
          codigo: valor.trim(),
          cambioProducto: cambioProductoActual
        })
      });

      codigosPorVenta[`${ventaML}|${pubML}`] = {
        ...(codigosPorVenta[`${ventaML}|${pubML}`] || {}),
        codigo: valor.trim()
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

  /*document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      updateAnalyzeAvailability();
    }
  });*/

  function validarExcelVentasJumpseller(file, rows) {
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

    const copyQty = e.target.closest('.copy-qty');
    if (copyQty) {
      const qty = copyQty.dataset.qty;
      navigator.clipboard.writeText(qty);
      showToast("Unidades copiadas 📋");
      return;
    }

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

        if (!validarExcelVentasJumpseller(file, rows)) {
          statusEl.textContent = '❌ El archivo seleccionado no parece ser Ventas ML. Revisa que descargaste el Excel correcto desde MercadoLibre.';
          return;
        }

        // 2) Subir Ventas ML (solo si pasa validación)
        const fd = new FormData();
        fd.append('archivo', file);

        statusEl.textContent = 'Subiendo Ventas ML...';
        const up = await fetch('/api/jumpseller/ventas', { method: 'POST', body: fd });
        if (!up.ok) {
          const t = await up.text();
          throw new Error('Error subiendo Ventas ML: ' + t);
        }
      }*/

      // 3) Validar contra el último Ventas ML persistido
      await runValidacionVentas();

      // 4) Refrescar info
      //await loadMlInfo();
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

    await fetch('/api/jumpseller/ventas/codigos', {
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
      e.stopPropagation();
      e.target.blur(); // solo confirmar edición
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

  /*const autoBtn = document.getElementById("autoUpdateBtn");

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
      ventasJumpseller: "demoto_Pedidos_",
      productosJumpseller: "demoto_productos_",
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
    //await uploadIfExists(latest.publicaciones, "/api/jumpseller/publicaciones");
    await uploadIfExists(latest.ventasJumpseller, "/api/jumpseller/ventas");
    await uploadIfExists(latest.productosJumpseller, "/api/jumpseller/productos");

    variantesOdooCache = [];
    stockOdooCache = [];
    odooQtyByVentaCodigo = new Map();

    await loadUltimasVariantesOdooParaBusqueda();
    await loadStockOdoo();
    variantesValidarSet = await loadVariantesValidarFromConfig();

    showToast("Archivos actualizados ✔", 2000);

    analyzeBtn.click();
  });*/

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

  window.addEventListener("message", (event) => {

    if(event.data?.type === "scanner-done"){

      const gunModal = document.getElementById("gunScannerModal");

      if(gunModal){
        gunModal.classList.add("hidden");
      }

    }

  });

  document.addEventListener("keydown", (e) => {

    if(e.key === "Escape"){

      const gunModal = document.getElementById("gunScannerModal");

      if(gunModal && !gunModal.classList.contains("hidden")){
        gunModal.classList.add("hidden");
      }

    }
  });

  setTimeout(async () => {

    try {
      statusEl.textContent = 'Ejecutando validación automática...';

      await runValidacionVentas();

    } catch (err) {
      console.error("Auto validación error", err);
      statusEl.textContent = 'Error en validación automática';
    }

  }, 300);

  setTimeout(async () => {

    try {
      statusEl.textContent = 'Cargando validación automática...';
      await runValidacionVentas();
    } catch (err) {
      console.warn("Auto validación no ejecutada", err);
    }

  }, 300);
});