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
  const filesInput = document.getElementById("filesInput");
  const formatCLP = (n) => new Intl.NumberFormat("es-CL").format(n);
  const esLocal = location.hostname === 'localhost';
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
  let variantesValidarSet = new Set();

  const gunModal = document.getElementById("gunScannerModal");
  const closeGun = document.getElementById("closeGunScanner");
  const exportBtn = document.getElementById("exportVentasBtn");

  const autoUpdateBtn = document.getElementById("autoUpdateBtn");
  const tituloVentas = document.getElementById("verVentasOdoo");
  const modal = document.getElementById("modalImagen");
  const cerrarModal = document.getElementById("cerrarModal");
  const selectAll = document.getElementById("selectAll");
  
  let modoSupervisor = false;

  selectAll.addEventListener("change", () => {
    const checks = document.querySelectorAll(".row-check");

    checks.forEach(ch => {
        ch.checked = selectAll.checked;
    });
  });

  tituloVentas.addEventListener("click", () => {
    modal.classList.remove("hidden");
  });

  cerrarModal.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  // cerrar haciendo click fuera
  modal.addEventListener("click", (e) => {
    if(e.target === modal){
      modal.classList.add("hidden");
    }
  });

  const modalContainer = document.getElementById("modalImagesContainer");

  // 🔥 CONFIGURACIÓN DE IMÁGENES POR LINK
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
    verExcelVentasML: [
      "/imagenes/ventas-ml1.jpg",
      "/imagenes/ventas-ml2.jpg"
    ]
  };

  // 🔥 ACTIVAR TODOS LOS LINKS AUTOMÁTICAMENTE
  Object.keys(ayudas).forEach(id => {

    const el = document.getElementById(id);
    if(!el) return;

    el.addEventListener("click", () => {

      const images = ayudas[id];

      modalContainer.innerHTML = images.map(src => `
        <img src="${src}" class="modal-img" />
      `).join("");

      modal.classList.remove("hidden");

    });

  });

  document.addEventListener("keydown", async (e) => {

    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "p") {

      const clave = prompt("Ingrese clave supervisor");

      if (clave === "4744") {
        modoSupervisor = true;

        showToast("Modo supervisor activado ⚠️", 2000);

        // 🔥 volver a correr validación SIN restricciones
        await runValidacionVentas();

      } else {
        showToast("Clave incorrecta ❌", 2000, "error");
      }
    }

  });

  function resolverCodigoEquivalente(ventaKey, codigo){

    if(!codigo) return null;

    const code = normCodigo(codigo);

    // 1. exacto
    const keyExact = `${ventaKey}|${code}`;
    if(odooQtyByVentaCodigo.has(keyExact)){
      return code;
    }

    // 2. buscar coincidencias
    const matches = [];

    odooQtyByVentaCodigo.forEach((_, key) => {

      const [v, cod] = key.split("|");

      if(v !== ventaKey) return;

      const codNorm = normCodigo(cod);

      if(
        codNorm.includes(code) ||
        code.includes(codNorm)
      ){
        matches.push(cod);
      }

    });

    // 3. solo una → válida
    if(matches.length === 1){
      return matches[0];
    }

    return null;
  }

  function actualizarSelectAll() {

    const checks = document.querySelectorAll(".row-check");
    const total = checks.length;
    const activos = Array.from(checks).filter(c => c.checked).length;

    const selectAll = document.getElementById("selectAll");

    selectAll.checked = total > 0 && total === activos;
    selectAll.indeterminate = activos > 0 && activos < total;
  }

  function mostrarResumenExportacion(resumen) {

    return new Promise(resolve => {

      const modal = document.createElement("div");
      modal.className = "confirm-modal";

      let html = `
        <div class="confirm-box" style="min-width:400px;">
          <h3>Ventas a procesar</h3>
          <table style="width:100%; margin-top:10px; color:white;">
            <thead>
              <tr>
                <th style="text-align:left;">Número</th>
                <th style="text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>
      `;

      Object.entries(resumen).forEach(([orden, total]) => {
        html += `
          <tr>
            <td>${orden}</td>
            <td style="text-align:right;">${formatCLP(total)}</td>
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>

          <div style="margin-top:15px;">
            <button id="confirmExport">Confirmar</button>
            <button id="cancelExport">Cancelar</button>
          </div>
        </div>
      `;

      modal.innerHTML = html;
      document.body.appendChild(modal);

      modal.querySelector("#confirmExport").onclick = () => {
        modal.remove();
        resolve(true);
      };

      modal.querySelector("#cancelExport").onclick = () => {
        modal.remove();
        resolve(false);
      };

    });
  }

  filesInput.addEventListener("change", async () => {

    const files = Array.from(filesInput.files);

    if (!files.length) return;

    showToast("Subiendo archivos...", 1500);

    for (const file of files) {

      try {

        const formData = new FormData();
        formData.append("archivo", file);
        formData.append("lastModified", file.lastModified);

        // 🔥 detectar tipo automáticamente
        const name = file.name.toLowerCase();

        let endpoint = "";

        if (name.includes("_ventas_cl_mercado_libre_")) {
          endpoint = "/api/ml/ventas";
        } 
        else if (name.includes("sale.order")) {
          endpoint = "/api/odoo/ventas";

          await fetch('/api/estado/odoo-ventas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pendienteVentasOdoo: false })
          });
        }
        else if (name.includes("product.product")) {
          endpoint = "/api/odoo/variantes";
        }
        else if (name.includes("stock.quant")) {
          endpoint = "/api/odoo/stock";
        } 
        else {
          showToast(`Archivo no reconocido: ${file.name}`, 3000, "error");
          continue;
        }

        const res = await fetch(endpoint, {
          method: "POST",
          body: formData
        });

        if (!res.ok) {
          const err = await res.json();
          showToast(err.error || `Error en ${file.name}`, 3000, "error");
          continue;
        }

        showToast(`✔ ${file.name} cargado`, 1500);

      } catch (err) {
        console.error(err);
        showToast(`Error subiendo ${file.name}`, 3000, "error");
      }
    }

    showToast("Carga finalizada 🚀", 1500);

    await runValidacionVentas();

  });

  function confirmarCantidad(cantidad) {
    return new Promise((resolve) => {

      const modal = document.createElement("div");
      modal.className = "confirm-modal";

      modal.innerHTML = `
        <div class="confirm-box">
          <p>¿Confirma que está despachando ${cantidad} unidades?</p>
          <button id="okBtn">Confirmar</button>
          <button id="cancelBtn">Cancelar</button>
        </div>
      `;

      document.body.appendChild(modal);

      modal.querySelector("#okBtn").onclick = () => {
        modal.remove();
        resolve(true);
      };

      modal.querySelector("#cancelBtn").onclick = () => {
        modal.remove();
        resolve(false);
      };

    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      modal.classList.add("hidden");
    }
  });

  autoUpdateBtn.addEventListener("click", async () => {

    try {
      showToast("Actualizando archivos...", 1500);

      const res = await fetch('/api/data/update-all', { method: 'POST' });

      // 🔥 AQUÍ TU NUEVA LÓGICA
      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || "Error actualizando archivos", 3000, "error");
        return;
      }

      showToast("Archivos actualizados ✅", 1500);

      await runValidacionVentas();

    } catch (err) {
      console.error(err);
      showToast("Error de conexión", 2000, "error");
    }

  });

  exportBtn.addEventListener("click", exportarVentasOdoo);

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

  if (closeGun && gunModal) {
    closeGun.onclick = () => {
      gunModal.classList.add("hidden");
    };
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

      const cantidad = Number(
        tr.querySelector('.qty-valor')?.textContent || 0
      );

      if (cantidad > 1) {

        const ok = await confirmarCantidad(cantidad);

        if (!ok) {
          showToast("Despacho cancelado ❌", 1500, "error");

          // limpiar UI
          scanResultEl.textContent = "—";
          lastScannedCode = null;

          return; // 🚫 IMPORTANTE
        }
      }

      // Persistir escaneo
      await fetch('/api/ml/ventas/codigos', {
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

  function actualizarCheckboxSegunObs(tr, obsTexto) {

    const firstCell = tr.children[0];
    let existingCheck = firstCell.querySelector(".row-check");

    if (obsTexto === 'REGISTRAR VENTA EN ODOO') {

      if (!existingCheck) {
        const check = document.createElement("input");
        check.type = "checkbox";
        check.className = "row-check";

        check.addEventListener("change", actualizarSelectAll);

        firstCell.innerHTML = "";
        firstCell.appendChild(check);
      }

    } else {
      if (existingCheck) {
        firstCell.innerHTML = "";
      }
    }

    actualizarSelectAll();
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
      actualizarCheckboxSegunObs(tr, obsCell.textContent);
      return false;
    }

    // 🔴 Producto incorrecto
    if (!cambioProducto && !contienePubML(codigoEfectivo, pubKey)) {
      obsCell.textContent = 'PRODUCTO A DESPACHAR INCORRECTO';
      obsCell.classList.remove('ok-cell');
      obsCell.classList.add('error-cell');
      actualizarCheckboxSegunObs(tr, obsCell.textContent);
      return false;
    }

    // 🟡 Falta escaneo
    if (!escaneado) {
      obsCell.textContent = 'ESCANEE EL PRODUCTO';
      obsCell.classList.remove('ok-cell');
      obsCell.classList.add('error-cell');
      actualizarCheckboxSegunObs(tr, obsCell.textContent);
      return false;
    }

    // 🔴 Escaneo distinto
    if (!codigoCoincideConEscaneo(valor, escaneado)) {
      obsCell.textContent = 'EL CÓDIGO NO COINCIDE CON EL ESCÁNER';
      obsCell.classList.remove('ok-cell');
      obsCell.classList.add('error-cell');
      actualizarCheckboxSegunObs(tr, obsCell.textContent);
      return false;
    }

    // 🔹 Validación Odoo
    const codigoEquivalente = resolverCodigoEquivalente(
      ventaKey,
      codigoEfectivo
    );

    const codigoFinal = codigoEquivalente || codigoEfectivo;

    const existeProductoEnOdoo =
      odooQtyByVentaCodigo.has(`${ventaKey}|${codigoFinal}`);

    if (!existeProductoEnOdoo) {
      obsCell.textContent = 'REGISTRAR VENTA EN ODOO';
      obsCell.classList.remove('ok-cell');
      obsCell.classList.add('error-cell');
      actualizarCheckboxSegunObs(tr, obsCell.textContent);
      return false;
    }

    const unidadesDespachar = Number(
      tr.querySelector('.qty-despachar')?.textContent || 0
    );

    const qtyOdoo =
      odooQtyByVentaCodigo.get(`${ventaKey}|${codigoFinal}`) || 0;

    if (qtyOdoo < unidadesDespachar) {
      obsCell.textContent = 'FALTAN UNIDADES POR ENTREGAR EN ODOO';
      obsCell.classList.remove('ok-cell');
      obsCell.classList.add('error-cell');
      actualizarCheckboxSegunObs(tr, obsCell.textContent);
      return false;
    }

    if (qtyOdoo > unidadesDespachar) {
      obsCell.textContent = 'EXCESO DE UNIDADES REGISTRADAS';
      obsCell.classList.remove('ok-cell');
      obsCell.classList.add('error-cell');
      actualizarCheckboxSegunObs(tr, obsCell.textContent);
      return false;
    }

    obsCell.textContent = 'OK';
    obsCell.classList.remove('error-cell');
    obsCell.classList.add('ok-cell');
    actualizarCheckboxSegunObs(tr, obsCell.textContent);

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
      .filter(v => v.barcode || v.default_code);

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

  function getVarianteOdooFlexible(barcode){

    if (!barcode) return null;

    const code = normCodigo(barcode);

    // exacto
    let exact = variantesOdooCache.find(v =>
      normCodigo(v.barcode) === code
    );

    if(exact) return exact;

    // contenido
    const matches = variantesOdooCache.filter(v => {

      const b = normCodigo(v.barcode);

      return b.includes(code) || code.includes(b);
    });

    if(matches.length === 1){
      return matches[0];
    }

    return null;
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

  loadOdooInfo();

  function includesCancelOrReturn(estadoML) {
    const s = String(estadoML || '').toLowerCase();
    //console.log(s);
    return s.includes('cancel') || (s.includes('devol') && !s.includes('habilitada') && !s.includes('camino'));
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

  setTimeout(async () => {
    try {
      await runValidacionVentas();
    } catch (e) {
      console.warn("Auto validación no ejecutada aún", e);
    }
  }, 300);

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

  function construirResumenPedidos() {

    const resumen = {};

    const items = window._ventasProcesadas || [];

    items.forEach(item => {

      // 🔥 SOLO los que vas a exportar
      if (item.obs !== 'REGISTRAR VENTA EN ODOO') return;

      const totalLinea = Math.round(item.precio * item.cantidad * 1.19);

      if (!resumen[item.venta]) {
        resumen[item.venta] = 0;
      }

      resumen[item.venta] += totalLinea;
    });

    return resumen;
  }

  async function validarArchivosDelDia() {

    const hoy = new Date();
    hoy.setHours(0,0,0,0);

    const faltantes = [];

    async function check(url, nombre) {
      try {
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

      } catch {
        faltantes.push(nombre);
      }
    }

    await Promise.all([
      check('/api/odoo/ventas/info', 'Ventas Odoo'),
      check('/api/ml/ventas/info', 'Ventas ML'),
      check('/api/odoo/variantes/info', 'Variantes Odoo'),
      check('/api/odoo/stock/info', 'Stock Ubicaciones Odoo')
    ]);

    return faltantes;
  }

  async function runValidacionVentas() {
    // 🔒 VALIDAR ARCHIVOS DEL DÍA
    const faltantes = await validarArchivosDelDia();

    // 🧠 detectar entorno local

    const estadoRes = await fetch('/api/estado/odoo-ventas');
    const estado = await estadoRes.json();

    if (estado.pendienteVentasOdoo && !modoSupervisor){

      exportBtn.disabled = true;

      showToast("Debes cargar el Excel de Ventas Odoo actualizado", 3000, "error");

      statusEl.innerHTML = `
        ⚠️ Debes cargar el archivo de Ventas Odoo antes de continuar.
      `;

      return;
    }

    if (faltantes.length && !esLocal && !modoSupervisor){

      statusEl.textContent = '';

      showToast(
        "Debes actualizar archivos del día",
        3000,
        "error"
      );

      statusEl.innerHTML = `
      ❌ Faltan archivos:<br>
      ${faltantes.map(f => `- ${f}`).join("<br>")}
      `;

      if (faltantes.length) {
        exportBtn.disabled = true;
        return;
      } else {
        exportBtn.disabled = false;
      }

      return; // 🚫 SOLO bloquea en producción
    }

    codigosPorVenta = {};
    const codigosRes = await fetch('/api/ml/ventas/codigos');
    codigosPorVenta = await codigosRes.json();

    statusEl.textContent = 'Procesando archivos...';
    await loadUltimasVariantesOdooParaBusqueda();
    await loadStockOdoo();
    variantesValidarSet = await loadVariantesValidarFromConfig();
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
      const cutoff = location.hostname === 'localhost'
        ? new Date('2026-01-01')   // entorno local
        : new Date('2026-03-06');  // producción
      const observaciones = [];
      const observacionesOK = [];
      window._ventasProcesadas = [];
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
        const q = Number(row[7]) || 0; // Col H

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
        else if (!existeEnOdoo && (totalCLP > 0 || esLineaHijaPaquete) && !esCancelODevolucion){
          obs = 'REGISTRAR VENTA EN ODOO';
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

          // 🔹 calcular sugerido igual que en el render
          let codigoSugeridoTemp = '';

          try {
            const varianteML = String(r[ML_COL_VARIANTE] || '')
              .replace(/color\s*:/i, '')
              .trim();

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

          const precioUnitarioCorrecto =
            cantidadADespachar > 0
              ? Math.round(precioMostrado / cantidadADespachar)
              : precioMostrado;

          let obsFinal = obs; // copiamos el obs base

          // 🔹 VALIDACIÓN ODOO AQUÍ DENTRO
          if (existeEnOdoo && !includesCancelOrReturn(estadoML)) {

            const codigoEquivalente = resolverCodigoEquivalente(
              ventaKey,
              codigoKey
            );

            const codigoFinal = codigoEquivalente || codigoKey;

            if (!codigoKey) {
              obsFinal = 'INGRESE PRODUCTO A DESPACHAR';

            } else if (!odooQtyByVentaCodigo.has(`${ventaKey}|${codigoFinal}`)) {

              if (existeVentaEnOdooConOtroCodigo) {
                obsFinal = 'EXISTE LA VENTA EN ODOO, PERO CON OTRO CÓDIGO';
              } else {
                obsFinal = 'REGISTRAR VENTA EN ODOO';
              }

            } else {
              const codigoEquivalente = resolverCodigoEquivalente(
                ventaKey,
                codigoKey
              );

              const codigoFinal = codigoEquivalente || codigoKey;

              const qtyOdoo =
                odooQtyByVentaCodigo.get(`${ventaKey}|${codigoFinal}`) || 0;

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
            if (!escaneoValido && !includesCancelOrReturn(estadoML)) {
              obsRender = 'ESCANEE EL PRODUCTO';
            } else {
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
          pubProcesar
        };

          itemBase.r[ML_COL_PUBML] = pubProcesar;

          console.log(itemBase.ventaMLFinal, obsRender);

          if (obsRender === 'OK') {
            observacionesOK.push(itemBase);
          } else {
            observaciones.push(itemBase);
          }

          window._ventasProcesadas.push({
            venta: itemBase.ventaMLFinal,
            precio: itemBase.precioUnitario,
            cantidad: itemBase.cantidad,
            obs: itemBase.obs
          });
        }
      }

      if (!observaciones.length && !observacionesOK.length) {
        statusEl.textContent = 'No se encontraron observaciones 🎉';
        return;
      }

      let pintarPrimeraLineaPaquete = true;
      let ultimaVenta = 0;

      for (const item of observaciones) {
        const obs = item.obs;
        const pubML = String(item.r[ML_COL_PUBML] || '').trim(); // Col Q

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
        
        if (ultimaVenta != item.ventaMLFinal)
          pintarPrimeraLineaPaquete = true;

        //console.log(ultimaVenta, item.ventaMLFinal);

        ultimaVenta = item.ventaMLFinal;

        if (item.esLineaHijaPaquete && !pintarPrimeraLineaPaquete) {
          tr.classList.add('paquete-hija-row');
        }
        else if (item.esLineaHijaPaquete){
          tr.classList.add('pack-parent');
          pintarPrimeraLineaPaquete = false;
        }
		    else if (item.esPack) {
          tr.classList.add('pack-row');
        }
        else if (highlightDespacho) {
          tr.classList.add('kit-row');
        }

        const tituloReal = tituloPorPublicacion.get(pubMLSinMLC);

        const tituloPub = tituloReal
          ? tituloReal
          : String(item.r[ML_COL_TITULO] || '').trim();// Col S
        let variante = String(item.r[ML_COL_VARIANTE] || '')
          .replace(/color\s*:/i, '')
          .trim(); // Col T

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

          if (matches && matches.length) {
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
          <td>
            ${
              item.obs === "REGISTRAR VENTA EN ODOO"
                ? `<input type="checkbox" class="row-check">`
                : ``
            }
          </td>
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
                      value="${codigoEfectivo}"
                    />
                    <div class="odoo-suggestions hidden"></div>
                  </div>

                  ${(() => {
                    const codigoEquivalente = resolverCodigoEquivalente(
                      ventaKey,
                      codigoEfectivo
                    );

                    const codigoFinal = codigoEquivalente || codigoEfectivo;

                    const info = getVarianteOdooFlexible(codigoFinal);

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

              const codigoEquivalente = resolverCodigoEquivalente(
                ventaKey,
                codigoEfectivo
              );

              const codigoFinal = codigoEquivalente || codigoEfectivo;

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
            <div class="precio-copy">
              <span class="precio-valor">${item.precioUnitario.toLocaleString('es-CL')}</span>
              <span class="copy-precio" data-precio="${item.precioUnitario}" title="Copiar precio">📋</span>
            </div>
          </td>
          <td class="obs-cell error-cell">
            ${item.obs}
          </td>
        `;
        
        const check = tr.querySelector(".row-check");

        if (check) {
          check.addEventListener("change", actualizarSelectAll);
        }

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

        const codigoEquivalente = resolverCodigoEquivalente(
          ventaKey,
          codigoKey
        );

        const codigoFinal = codigoEquivalente || codigoKey;

        const qtyOdoo =
          odooQtyByVentaCodigo.get(`${ventaKey}|${codigoFinal}`) || 0;
        
        tr.innerHTML = `
          <td>
          </td>
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
                const codigo = item.codigoPersistido || '';
                const info = getVarianteOdooFlexible(codigo);

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
          <td>${qtyOdoo}</td>

          <!-- Cambio producto -->
          <td>—</td>

          <!-- Precio -->
          <td>
            <div class="precio-copy">
              <span class="precio-valor">${item.precioUnitario.toLocaleString('es-CL')}</span>
              <span class="copy-precio" data-precio="${item.precioUnitario}" title="Copiar precio">📋</span>
            </div>
          </td>

          <td class="obs-cell ok-cell">OK</td>
        `;

        resultsBody.appendChild(tr);
      }

      buildPills([...observaciones, ...observacionesOK]);
      restaurarEstadoDespachoUI();
      actualizarSelectAll();

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
    const nombreEl = tr.querySelector('.nombre-valor');
    const varianteEl = tr.querySelector('.variante-valor');

    const ubicacionesCell = tr.querySelector('.ubicaciones-col');

    if (ubicacionesCell) {

      const codigo = normCodigo(input.value);
      const ubicaciones = getUbicacionesPorCodigo(codigo);

      if (!ubicaciones.length) {
        ubicacionesCell.innerHTML = '—';
      } else {

        ubicacionesCell.innerHTML = ubicaciones.map(u => `
          <div class="ubicacion-tag">
            <span class="ubicacion-text">
              ${u.ubicacion} <b>(${u.cantidad})</b>
            </span>
            <span class="copy-ubicacion"
                  data-ubicacion="${u.ubicacion}"
                  title="Copiar ubicación">📋</span>
          </div>
        `).join('');

      }

    }

    const info = getVarianteOdooFlexible(normCodigo(input.value)) || {};

    nombreEl.textContent = info.name || '—';
    varianteEl.textContent = info.variant || '—';

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
      await fetch('/api/ml/ventas/codigos', {
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
    //await uploadIfExists(latest.publicaciones, "/api/ml/publicaciones");
    await uploadIfExists(latest.ventasML, "/api/ml/ventas");

    variantesOdooCache = [];
    stockOdooCache = [];
    odooQtyByVentaCodigo = new Map();

    await loadUltimasVariantesOdooParaBusqueda();
    await loadStockOdoo();
    variantesValidarSet = await loadVariantesValidarFromConfig();

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

  function mostrarValidacionTotales(resumen) {
    return new Promise(resolve => {

      const modal = document.createElement("div");
      modal.className = "confirm-modal";

      let html = `
        <div class="confirm-box" style="min-width:400px;">
          <h3>Verifique la importación en Odoo</h3>
          <table style="width:100%; margin-top:10px; color:white;">
            <thead>
              <tr>
                <th style="text-align:left;">Número Pedido</th>
                <th style="text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>
      `;

      Object.entries(resumen)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .forEach(([orden, total]) => {
        html += `
          <tr>
            <td>${orden}</td>
            <td style="text-align:right;">${formatCLP(Math.round(total))}</td>
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>

          <p style="margin-top:10px;">
            Confirma que los montos coinciden en Odoo
          </p>

          <div style="margin-top:15px;">
            <button id="confirm2">Confirmar</button>
            <button id="cancel2">Cancelar</button>
          </div>
        </div>
      `;

      modal.innerHTML = html;
      document.body.appendChild(modal);

      modal.querySelector("#confirm2").onclick = () => {
        modal.remove();
        resolve(true);
      };

      modal.querySelector("#cancel2").onclick = () => {
        modal.remove();
        resolve(false);
      };

    });
  }
  
  async function exportarVentasOdoo() {
    const resumenPedidos = {};
    const rows = Array.from(document.querySelectorAll("#ventasResultsBody tr"))
        .filter(tr => tr.querySelector(".row-check")?.checked);

    const resumen = {};

    rows.forEach(tr => {
      const checkbox = tr.querySelector(".row-check");
      if (!checkbox || !checkbox.checked) return;
      const venta = tr.querySelector(".copy-venta")?.dataset?.venta;
      const precio = Number(
        tr.querySelector(".precio-valor")?.textContent.replace(/\./g, '') || 0
      );

      if (!venta) return;

      if (!resumen[venta]) resumen[venta] = 0;
      resumen[venta] += precio;
    });

    let confirmado = await mostrarResumenExportacion(resumen);

    if (!confirmado) {
      showToast("Carga cancelada", 1500, "error");
      return;
    }

    //resultsSection.classList.add("hidden");
    //resultsBody.innerHTML = "";
    
    // 🔹 SOLO filas con observación específica
    const filas = rows.filter(tr => {
      const obs = tr.querySelector(".obs-cell")?.textContent.trim();
      return obs === "REGISTRAR VENTA EN ODOO";
    });

    if(!filas.length){
      showToast("No hay ventas para exportar", 2000, "error");
      return;
    }

    try {
      // 🔹 pedir correlativo al backend
      const res = await fetch("/api/ml/ventas/correlativo");

      if(!res.ok){
        console.error("Error backend correlativo", await res.text());
        throw new Error("No se pudo obtener el correlativo");
      }

      const data = await res.json();
      const correlativo = data.correlativo;

      let correlativoActual = correlativo;

      const dataExcel = [];

      const ventasAgrupadas = new Map();   // 🟢 CASAMSTOCK
      const ordenesIndividuales = [];      // 🔵 UBICACIONES

      filas.forEach(tr => {
        const orden = tr.dataset.orden;
        const venta = tr.querySelector(".copy-venta")?.dataset.venta;
        const codigo = tr.querySelector(".codigo-input")?.value.trim();
        const cantidad = Number(tr.querySelector(".qty-valor")?.textContent || 0);
        const precio = Number(
          tr.querySelector(".precio-valor")?.textContent.replace(/\./g,'') || 0
        );

        tr.dataset.orden = venta.referencia;

        const ubicaciones = getUbicacionesPorCodigo(codigo);
        const multi = ubicaciones.length > 1;

        if (multi) {

          // 🔵 MLDESPUBICACIONES → 1 producto = 1 orden
          correlativoActual++;

          const correlativoStr = String(correlativoActual).padStart(5,'0');

          ordenesIndividuales.push({
            referencia: `MLDESPUBICACIONES${correlativoStr}`,
            lineas: [{
              codigo,
              cantidad,
              precio,
              venta
            }]
          });

        } else {

          const KEY_CASAMSTOCK = "GLOBAL";

          if(!ventasAgrupadas.has(KEY_CASAMSTOCK)){

            correlativoActual++;

            const correlativoStr = String(correlativoActual).padStart(5,'0');

            ventasAgrupadas.set(KEY_CASAMSTOCK, {
              referencia: `MLDESPCASAMSTOCK${correlativoStr}`,
              lineas: []
            });
          }

          ventasAgrupadas.get(KEY_CASAMSTOCK).lineas.push({
            codigo,
            cantidad,
            precio,
            venta
          });
        }

      });

      let numeropedidoCasam = ' ';

      // 🔹 construir excel
      // 🟢 CASAMSTOCK (por venta)
      ventasAgrupadas.forEach(v => {

        v.lineas.forEach((l, index) => {

          dataExcel.push({
            "Referencia de la orden": index === 0 ? v.referencia : "",
            "Cliente": index === 0 ? "MercadoLibre" : "",
            "Líneas de la orden/Cantidad": l.cantidad,
            "Líneas de la orden/Producto": l.codigo,
            "Líneas de la orden/Precio unitario": l.precio,
            "Líneas de la orden/Nro. Vta.": l.venta
          });

          if (index === 0){
            numeropedidoCasam = v.referencia;
          }
          
          if (!resumenPedidos[numeropedidoCasam]){
            resumenPedidos[numeropedidoCasam] = 0;
          }
          console.log(index, l.precio, numeropedidoCasam, resumenPedidos[numeropedidoCasam]);
          resumenPedidos[numeropedidoCasam] += (l.precio * l.cantidad) * 1.19;
        });

      });

      // 🔵 UBICACIONES (1 producto = 1 orden)
      ordenesIndividuales.forEach(v => {

        const l = v.lineas[0];

        dataExcel.push({
          "Referencia de la orden": v.referencia,
          "Cliente": "MercadoLibre",
          "Líneas de la orden/Cantidad": l.cantidad,
          "Líneas de la orden/Producto": l.codigo,
          "Líneas de la orden/Precio unitario": l.precio,
          "Líneas de la orden/Nro. Vta.": l.venta
        });

        if (!resumenPedidos[v.referencia]){
            resumenPedidos[v.referencia] = 0;
          }
            
          resumenPedidos[v.referencia] += Math.round((l.precio * 1.19) * l.cantidad);

      });

      // 🔹 generar archivo
      const ws = XLSX.utils.json_to_sheet(dataExcel);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Ventas");

      XLSX.writeFile(wb, "ventas_odoo.xlsx");

      let confirmado = await mostrarValidacionTotales(resumenPedidos);

      if (!confirmado) {
        showToast("Carga cancelada", 1500, "error");
        return;
      }

      await fetch('/api/estado/odoo-ventas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendienteVentasOdoo: true })
      });

      // 🔹 guardar nuevo correlativo
      await fetch("/api/ml/ventas/correlativo", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ correlativo: correlativoActual })
      });

      // limpiar UI
      resultsBody.innerHTML = '';
      resultsSection.classList.add('hidden');

      // bloquear botón
      exportBtn.disabled = true;

      // mensaje
      statusEl.innerHTML = `
      ⚠️ Debes cargar nuevamente el archivo <b>Ventas Odoo</b> actualizado
      `;

      showToast("Excel exportado correctamente 🚀");
    } catch (err) {
      console.error(err);
      showToast("Error al exportar ventas", 2000, "error");
    }
  }
});