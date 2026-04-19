document.addEventListener("DOMContentLoaded", async () => {

  const resultsBody = document.getElementById("ventasResultsBody");
  const addVentaBtn = document.getElementById("addVentaBtn");
  const resultsSection = document.getElementById("ventasResults");
  const countersEl = document.getElementById("actionCounters");
  const filesInput = document.getElementById("filesInput");
  const statusEl = document.getElementById("statusVentas");
  const modalContainer = document.getElementById("modalImagesContainer");
  const modal = document.getElementById("modalImagen");
  const cerrarModal = document.getElementById("cerrarModal");
  const selectAll = document.getElementById("selectAll");
  const exportBtn = document.getElementById("exportVentasBtn");
  const formatCLP = (n) => new Intl.NumberFormat("es-CL").format(n);
  let modoSupervisor = false;
  let toastTimer = null;

  selectAll.addEventListener("change", () => {
    const checks = document.querySelectorAll(".row-check");

    checks.forEach(ch => {
        ch.checked = selectAll.checked;
    });
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

  function actualizarSelectAll() {

    const checks = document.querySelectorAll(".row-check");
    const total = checks.length;
    const activos = Array.from(checks).filter(c => c.checked).length;

    const selectAll = document.getElementById("selectAll");

    selectAll.checked = total > 0 && total === activos;
    selectAll.indeterminate = activos > 0 && activos < total;
  }

  async function exportarVentasOdoo() {
    const resumenPedidos = {};
    /*const rows = Array.from(document.querySelectorAll("#ventasResultsBody tr"))
        .filter(tr => tr.querySelector(".row-check")?.checked);*/

    const rows = Array.from(document.querySelectorAll(".row-check"))
      .filter(ch => ch.checked)
      .map(ch => ch.closest("tr"));

    const resumen = {};

    rows.forEach(tr => {
      const checkbox = tr.querySelector(".row-check");
      if (!checkbox || !checkbox.checked) return;
      const venta = tr.dataset.venta;
      const precio = Number(
        tr.querySelector(".valor-text")?.textContent.replace(/\./g, '') || 0
      );

      //console.log(venta, precio);

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
        const venta = tr.dataset.venta;
        const codigo = tr.querySelector(".codigo-input")?.value.trim();
        const cantidad = Number(
          tr.querySelector(".unidades-vendidas")?.value || 0
        );

        const precio = Number(
          (tr.querySelector(".valor-text")?.textContent || "0").replace(/\./g, '')
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
            "Cliente": index === 0 ? "Consumidor Final Anónimo" : "",
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
          //console.log(index, l.precio, numeropedidoCasam, resumenPedidos[numeropedidoCasam]);
          resumenPedidos[numeropedidoCasam] += (l.precio * l.cantidad) * 1.19;
        });

      });

      // 🔵 UBICACIONES (1 producto = 1 orden)
      ordenesIndividuales.forEach(v => {

        const l = v.lineas[0];

        dataExcel.push({
          "Referencia de la orden": v.referencia,
          "Cliente": "Consumidor Final Anónimo",
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

  exportBtn.addEventListener("click", exportarVentasOdoo);

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

  let ventaCounter = 1;

  let variantesOdooCache = [];
  let stockOdooCache = [];
  let odooQtyByVentaCodigo = new Map();

  resultsSection.classList.add("hidden");
  countersEl.classList.add("hidden");

  /*function actualizarCheckboxSegunObs(tr, obsTexto) {

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
  }*/

  function actualizarCheckboxSegunMatch(tr) {

    const firstCell = tr.children[0];
    let existingCheck = firstCell.querySelector(".row-check");

    const codigo = tr.querySelector(".codigo-input")?.value.trim();
    const info = getVarianteOdooFlexible(codigo);

    const hayMatch = !!info;

    if (hayMatch) {

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

  function actualizarSelectAll() {

    const checks = document.querySelectorAll(".row-check");
    const total = checks.length;
    const activos = Array.from(checks).filter(c => c.checked).length;

    const selectAll = document.getElementById("selectAll");

    selectAll.checked = total > 0 && total === activos;
    selectAll.indeterminate = activos > 0 && activos < total;
  }

  async function cargarVentasServer(){

    try{

      const res = await fetch('/api/ventas-particulares');

      if(!res.ok) return;

      const data = await res.json();

      if(!Array.isArray(data)) return;

      resultsBody.innerHTML = "";

      data.forEach(v => {

        agregarLineaVenta(v.venta);

        const tr = resultsBody.lastChild;

        tr.querySelector(".fecha-input").value = v.fecha || "";
        tr.querySelector(".codigo-input").value = v.codigo || "";
        tr.querySelector(".unidades-vendidas").value = v.unidades || 1;
        tr.querySelector(".precio-total").value = v.total || "";

        if(v.flex){
          tr.querySelector(".flex-check").checked = true;
        }

        if(v.courier){
          tr.querySelector(".courier-check").checked = true;

          const courierInput = tr.querySelector(".courier-valor");
          courierInput.classList.remove("hidden");
          courierInput.value = v.courierValor || "";
        }

        // 🔥 recalcular todo
        calcularValorOdoo(tr);
        validarLinea(tr);

      });

      // 🔥 asegurar que se vea
      resultsSection.classList.remove("hidden");

    }catch(err){
      console.error("Error cargando ventas:", err);
    }

  }

  document.addEventListener("keydown", (e) => {

    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "p") {

      const pass = prompt("Clave supervisor:");

      if (pass === "4744") {
        modoSupervisor = true;

        alert("Modo supervisor activado");

        // 🔥 FORZAR REVALIDACIÓN
        iniciarModoSupervisor();
      } else {
        alert("Clave incorrecta");
      }
    }

  });

  async function iniciarModoSupervisor() {

    statusEl.textContent = "Modo supervisor activo ⚠️";

    resultsSection.classList.remove("hidden");
    countersEl.classList.remove("hidden");

    await recargarSistema();

    // 🔥 ESTA ES LA CLAVE
    await cargarVentasServer();
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
      check('/api/odoo/stock/info', 'Stock Ubicaciones Odoo'),
      check('/api/odoo/variantes/info', 'Variantes Odoo')
    ]);

    return faltantes;
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

  function getVarianteOdooFlexible(code){

    if(!code) return null;

    // 1. exacto primero
    let exact = variantesOdooCache.find(v => v.barcode === code);
    if(exact) return exact;

    // 2. buscar por contenido
    const matches = variantesOdooCache.filter(v =>
      v.barcode.includes(code) || code.includes(v.barcode)
    );

    // 3. solo una coincidencia → usarla
    if(matches.length === 1){
      return matches[0];
    }

    return null;
  }

  async function validarEstadoInicial(){

    // ✅ bypass directo
    if (modoSupervisor) {
      statusEl.textContent = "Modo supervisor activo ⚠️";
      return true;
    }

    const faltantes = await validarArchivosDelDia();

    if (faltantes.length) {

      statusEl.innerHTML = `
        ❌ Faltan archivos:<br>
        ${faltantes.map(f => `- ${f}`).join("<br>")}
      `;

      resultsSection.classList.add("hidden");
      countersEl.classList.add("hidden");

      return false;
    }

    const estadoRes = await fetch('/api/estado/odoo-ventas');
    const estado = await estadoRes.json();

    //console.log(estado);

    if (estado.pendienteVentasOdoo && !modoSupervisor){

      exportBtn.disabled = true;

      showToast("Debes cargar el Excel de Ventas Odoo actualizado", 3000, "error");

      statusEl.innerHTML = `
        ⚠️ Debes cargar el archivo de Ventas Odoo antes de continuar.
      `;

      return false;
    }

    statusEl.textContent = "Archivos OK ✅";

    return true;
  }

  function buscarCodigoEquivalente(venta, codigo){

    if(!codigo) return null;

    // 1. match exacto primero
    const keyExact = `${venta}|${codigo}`;
    if(odooQtyByVentaCodigo.has(keyExact)){
      return codigo;
    }

    // 2. buscar coincidencias por contenido
    const matches = [];

    odooQtyByVentaCodigo.forEach((_, key) => {

      const [v, cod] = key.split("|");

      if(v !== venta) return;

      if(cod.includes(codigo) || codigo.includes(cod)){
        matches.push(cod);
      }

    });

    // 3. si hay UNA sola → usarla
    if(matches.length === 1){
      return matches[0];
    }

    return null;
  }

  function aplicarFiltro(tipo){

    const rows = resultsBody.querySelectorAll("tr");

    rows.forEach(tr => {

      const obs = tr.querySelector(".obs-cell")?.textContent || "";

      if(tipo === "TODOS"){
        tr.style.display = "";
      }
      else if(tipo === "OK"){
        tr.style.display = obs === "OK" ? "" : "none";
      }
      else if(tipo === "OBS"){
        tr.style.display = obs !== "OK" ? "" : "none";
      }

    });

  }

  function construirCapsulas(){

    const rows = [...resultsBody.querySelectorAll("tr")];

    // 🔴 si no hay filas → ocultar
    if (!rows.length) {
      countersEl.classList.add("hidden");
      countersEl.innerHTML = "";
      return;
    }

    const total = rows.length;

    const ok = rows.filter(r =>
      r.querySelector(".obs-cell")?.textContent === "OK"
    ).length;

    const obs = total - ok;

    countersEl.innerHTML = "";

    const items = [
      {key:"TODOS", label:`TODOS (${total})`},
      {key:"OBS", label:`OBSERVACIONES (${obs})`},
      {key:"OK", label:`OK (${ok})`}
    ];

    items.forEach(i => {

      const pill = document.createElement("span");

      pill.className = "pill" + (i.key === "OBS" ? " active" : "");
      pill.dataset.filter = i.key;
      pill.textContent = i.label;

      pill.onclick = () => {

        document.querySelectorAll(".pill")
          .forEach(p => p.classList.remove("active"));

        pill.classList.add("active");

        aplicarFiltro(i.key);

      };

      countersEl.appendChild(pill);

    });

    countersEl.classList.remove("hidden");

     countersEl.classList.remove("hidden");

    aplicarFiltro("OBS");   // 🔥 activar observaciones por defecto
  }

  /* ================================
  CARGAR VARIANTES ODOO
  ================================ */

  async function loadUltimasVariantesOdooParaBusqueda(){

    if (variantesOdooCache.length) return;

    const res = await fetch('/api/odoo/variantes/ultimo',{cache:"no-store"});
    if(!res.ok) return;

    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf,{type:"array"});
    const ws = wb.Sheets[wb.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(ws,{header:1,defval:""});

    variantesOdooCache = rows.slice(1)
    .map(r=>({
        barcode:String(r[1]||"").trim(),
        default_code:String(r[0]||"").trim(),
        name:String(r[2]||"").trim(),
        variant:String(r[5]||"").trim()
    }))
    .filter(v=>v.barcode);

  }

  /* ================================
  CARGAR STOCK ODOO
  ================================ */

  async function loadStockOdoo(){

    if(stockOdooCache.length) return;

    const res = await fetch('/api/odoo/stock/ultimo',{cache:"no-store"});
    if(!res.ok) return;

    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf,{type:"array"});
    const ws = wb.Sheets[wb.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(ws,{header:1,defval:""});

    const header = rows[0].map(h=>String(h).toLowerCase());

    const COL_BARCODE = header.findIndex(h=>h.includes("código"));
    const COL_UBICACION = header.findIndex(h=>h.includes("ubicación"));
    const COL_CANTIDAD = header.findIndex(h=>h.includes("cantidad"));

    stockOdooCache = rows.slice(1)
    .map(r=>({
      barcode:String(r[COL_BARCODE]||"").trim(),
      ubicacion:String(r[COL_UBICACION]||"").trim(),
      cantidad:Number(r[COL_CANTIDAD]||0)
    }))
    .filter(r=>r.barcode);

  }

  /* ================================
  CARGAR VENTAS ODOO
  ================================ */

  async function loadVentasOdoo(){

    const res = await fetch('/api/odoo/ventas/ultimo',{cache:"no-store"});
    if(!res.ok) return;

    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf,{type:"array"});
    const ws = wb.Sheets[wb.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(ws,{header:1,defval:""});

    rows.forEach(r=>{
      const venta = String(r[6]||"").trim();
      const codigo = String(r[8]||"").trim();
      const qty = Number(r[7]||0);

      //if (r[0] == "MLDESPCASAMSTOCK00013")
        //console.log(venta, codigo, qty);

      if(!venta || !codigo) return;

      const key = `${venta}|${codigo}`;

      odooQtyByVentaCodigo.set(
        key,
        (odooQtyByVentaCodigo.get(key)||0)+qty
      );

    });
  }

  /* ================================
  UBICACIONES
  ================================ */

  function getUbicacionesPorCodigo(code){

    if(!code) return [];

    return stockOdooCache
    .filter(r => r.barcode === code)
    .map(r => ({
      ubicacion: r.ubicacion,
      cantidad: r.cantidad
    }))
    .sort((a,b)=>b.cantidad-a.cantidad);;
  }

  function renderUbicaciones(tr, code){

    const ubic = getUbicacionesPorCodigo(code);

    tr.querySelector(".ubicaciones-col").innerHTML =
      ubic.length
      ? ubic.map(u => {

          const ubicacionLimpia = u.ubicacion;

          return `
            <div class="ubicacion-tag">
              <span class="ubicacion-text">
                ${u.ubicacion} <b>(${u.cantidad})</b>
              </span>
              <span class="copy-btn" data-copy="${ubicacionLimpia}">📋</span>
            </div>
          `;

        }).join("")
      : "";

  }

  /* ================================
  VARIANTE POR CÓDIGO
  ================================ */

  function getVarianteOdooPorCodigo(code){

    return variantesOdooCache.find(v=>v.barcode===code) || null;

  }

  function getFechaHoy(){

    const hoy = new Date();

    const yyyy = hoy.getFullYear();
    const mm = String(hoy.getMonth()+1).padStart(2,"0");
    const dd = String(hoy.getDate()).padStart(2,"0");

    return `${yyyy}-${mm}-${dd}`;
  }

  /* ================================
  AGREGAR LINEA VENTA
  ================================ */

  function agregarLineaVenta(venta){

    const tr = document.createElement("tr");

    tr.dataset.venta = venta;

    tr.innerHTML = `
    <td class="check-cell"></td>
    <td>
      ${venta}
      <span class="copy-btn" data-copy="${venta}">📋</span>
    </td>

    <td>
    <input type="date" class="fecha-input">
    </td>
    <td style="display: none;"></td>
    <td>

    <div class="codigo-wrapper">
    <input class="codigo-input">
    <div class="odoo-suggestions hidden"></div>
    </div>

    <div class="producto-despachar">

      <div class="linea-nombre">
        <span class="nombre-valor"></span>
      </div>

      <div class="linea-variante">
        <span class="variante-valor"></span>
      </div>

    </div>

    </td>

    <td class="ubicaciones-col"></td>
    <td>
      <input type="number" class="unidades-vendidas" value="1">
      <span class="copy-btn copy-unidades">📋</span>
    </td>

    <td class="unidades-odoo">0</td>

    <td>
    <input type="number" class="precio-total">
    </td>

    <td>

    <input type="checkbox" class="flex-check">

    </td>

    <td>

    <input type="checkbox" class="courier-check">
    <input class="courier-valor hidden" type="number" placeholder="Valor envío">

    </td>

    <td class="valor-odoo morado">
      <span class="valor-text">0</span>
      <span class="copy-btn copy-precio">📋</span>
    </td>

    <td class="obs-cell"></td>

    <td>
      <button class="lock-btn" title="Bloquear venta">🔒</button>
      <button class="pack-btn">📦</button>
      <button class="delete-btn">🗑</button>
    </td>

    `;

    resultsBody.appendChild(tr);
    
    const fechaInput = tr.querySelector(".fecha-input");
    if(fechaInput) fechaInput.value = getFechaHoy();
  }

  /* ================================
  AGREGAR VENTA
  ================================ */

  addVentaBtn.addEventListener("click",()=>{

    agregarLineaVenta(ventaCounter);

    ventaCounter++;

    ordenarTablaDesc();
  });

  resultsBody.addEventListener("click",e=>{

    if(!e.target.classList.contains("delete-btn")) return;

    const tr = e.target.closest("tr");

    const obs = tr.querySelector(".obs-cell")?.textContent;

    if(obs === "OK") return;

    const venta = tr.dataset.venta;

    tr.remove();

    const parent = resultsBody.querySelector(
      `tr[data-venta="${venta}"]:not(.pack-row)`
    );

    const hijas = resultsBody.querySelectorAll(
      `tr.pack-row[data-venta="${venta}"]`
    );

    if(parent && hijas.length === 0){
      parent.classList.remove("pack-parent");
    }

  });

  /* ================================
  PAQUETE
  ================================ */

  resultsBody.addEventListener("click",e=>{

    if(!e.target.classList.contains("pack-btn")) return;

    const tr = e.target.closest("tr");
    const venta = tr.dataset.venta;
    const nueva = tr.cloneNode(true);

    nueva.classList.remove("pack-parent");
    nueva.classList.add("paquete-hija-row");
    nueva.dataset.venta = venta;

    /* limpiar campos */

    nueva.querySelector(".codigo-input").value = "";
    nueva.querySelector(".nombre-valor").textContent = "";
    nueva.querySelector(".variante-valor").textContent = "";
    nueva.querySelector(".ubicaciones-col").innerHTML = "";
    nueva.querySelector(".obs-cell").textContent = "";
    nueva.querySelector(".unidades-vendidas").value = 1;

    const copyCodigo = nueva.querySelector(".copy-codigo");
    if(copyCodigo) copyCodigo.remove();

    const fechaCell = nueva.querySelector(".fecha-input")?.closest("td");
    if(fechaCell) fechaCell.innerHTML = "";

    nueva.querySelector(".odoo-suggestions").innerHTML = "";
    nueva.querySelector(".odoo-suggestions").classList.add("hidden");

    const precioCell = nueva.querySelector(".precio-total")?.closest("td");
    if(precioCell) precioCell.innerHTML="";

    const flexCell = nueva.querySelector(".flex-check")?.closest("td");
    if(flexCell) flexCell.innerHTML="";

    const courierCell = nueva.querySelector(".courier-check")?.closest("td");
    if(courierCell) courierCell.innerHTML="";

    const valorCell = nueva.querySelector(".valor-odoo")?.closest("td");
    if(valorCell) valorCell.innerHTML="";

    const packBtn = nueva.querySelector(".pack-btn");
    if(packBtn) packBtn.remove();

    resultsBody.insertBefore(nueva, tr.nextSibling);

    tr.classList.add("pack-parent");

    calcularValorOdoo(nueva);
    validarLinea(nueva);
  });

  /* ================================
  CALCULAR VALOR ODOO
  ================================ */

  function parseCLP(value){

    if(!value) return 0;

    return Number(
      String(value)
        .replace(/\./g,"")   // quitar separador miles
        .replace(/,/g,"")    // quitar comas
        .replace(/[^\d]/g,"")
    );

  }

  function calcularValorOdoo(tr){

    if(tr.classList.contains("pack-row")) return;

    const totalInput = tr.querySelector(".precio-total");
    const unidadesInput = tr.querySelector(".unidades-vendidas");

    if(!totalInput || !unidadesInput) return;   // 👈 evita error en pack-row

    const total = parseCLP(totalInput.value);
    const unidades = Number(unidadesInput.value || 1);

    let totalBase = total;

    const flex = tr.querySelector(".flex-check");
    const courier = tr.querySelector(".courier-check");
    const courierValor = tr.querySelector(".courier-valor");

    if(flex?.checked){
      totalBase -= 3000 * 1.19;
    }

    if(courier?.checked){
      const envio = parseCLP(courierValor?.value);
      totalBase -= envio;
    }

    const valor = unidades ? (totalBase/unidades)/1.19 : 0;

    const valorCell = tr.querySelector(".valor-odoo");

    if(valorCell){
      valorCell.querySelector(".valor-text").textContent =
        Math.round(valor).toLocaleString("es-CL");
    }

  }

  /* ================================
  VALIDACIÓN
  ================================ */

  function validarLinea(tr){

    const firstCell = tr.children[0];
    firstCell.innerHTML = "";

    const venta = tr.dataset.venta;

    const codigo = tr.querySelector(".codigo-input").value.trim();

    const unidades = Number(tr.querySelector(".unidades-vendidas").value||0);

    const codigoEquivalente = buscarCodigoEquivalente(venta, codigo);

    const key = codigoEquivalente
      ? `${venta}|${codigoEquivalente}`
      : `${venta}|${codigo}`;

    const qtyOdoo = odooQtyByVentaCodigo.get(key)||0;

    tr.querySelector(".unidades-odoo").textContent = qtyOdoo;

    let obs = "";

    if(!codigo)
    obs = "INGRESE PRODUCTO";

    else if(!odooQtyByVentaCodigo.has(key))
    obs = "REGISTRAR VENTA EN ODOO";

    else if(qtyOdoo < unidades)
    obs = "FALTAN UNIDADES POR ENTREGAR EN ODOO";

    else if(qtyOdoo > unidades)
    obs = "EXCESO UNIDADES";

    else
    obs = "OK";

    const cell = tr.querySelector(".obs-cell");

    cell.textContent = obs;

    cell.classList.toggle("ok-cell",obs==="OK");
    cell.classList.toggle("error-cell",obs!=="OK");

    construirCapsulas();

    actualizarCheckboxSegunMatch(tr);
  }

  function getCodigoOriginalConLetras(default_code = '') {

    const partes = String(default_code).split('/');

    return partes
      .map(p => p.replace(/[^A-Z0-9]/gi, ''))
      .find(p => /[A-Z]/i.test(p)) || '';
  }

  function toggleLockVenta(tr){

    const venta = tr.dataset.venta;

    // 🔥 todas las filas del mismo paquete
    const rows = document.querySelectorAll(`tr[data-venta="${venta}"]`);

    const isLocked = tr.classList.contains("locked");

    if(!isLocked){

      // 🔒 BLOQUEAR TODAS
      rows.forEach(r => {

        r.classList.add("locked");

        r.querySelectorAll("input, button").forEach(el => {
          if(!el.classList.contains("lock-btn")){
            el.disabled = true;
          }
        });

        const btn = r.querySelector(".lock-btn");
        if(btn){
          btn.textContent = "🔓";
          btn.title = "Desbloquear venta";
        }

      });

    }else{

      // 🔓 DESBLOQUEAR TODAS
      const pass = prompt("Ingrese clave para desbloquear:");

      if(pass !== "4744"){
        alert("Clave incorrecta");
        return;
      }

      rows.forEach(r => {

        r.classList.remove("locked");

        r.querySelectorAll("input, button").forEach(el => {
          el.disabled = false;
        });

        const btn = r.querySelector(".lock-btn");
        if(btn){
          btn.textContent = "🔒";
          btn.title = "Bloquear venta";
        }

      });

    }
  }

  /* ================================
  EVENTOS INPUT
  ================================ */

  resultsBody.addEventListener("input", async (e) => {

    const tr = e.target.closest("tr");
    if(!tr) return;

    if(tr.classList.contains("locked")) return;

    if(
      e.target.classList.contains("unidades-vendidas") ||
      e.target.classList.contains("precio-total") ||
      e.target.classList.contains("courier-valor")
    ){
      guardarVentasDebounced();
    }

    /* ======================
      CALCULAR VALOR ODOO
    ====================== */

    if(
      e.target.classList.contains("precio-total") ||
      e.target.classList.contains("unidades-vendidas") ||
      e.target.classList.contains("courier-valor")
    ){
      calcularValorOdoo(tr);
    }

    /* ======================
      BUSCAR PRODUCTO
    ====================== */

    if(e.target.classList.contains("codigo-input")){

      const input = e.target;
      const tr = input.closest("tr");
      const suggestionsEl = tr.querySelector(".odoo-suggestions");

      const value = input.value.trim().toLowerCase();

      /* ======================
        AUTOCOMPLETE
      ====================== */

      if(value.length < 3){
          suggestionsEl.classList.add("hidden");
          suggestionsEl.innerHTML = "";

          // 🔥 limpiar UI
          tr.querySelector(".nombre-valor").textContent = "";
          tr.querySelector(".variante-valor").textContent = "";
          tr.querySelector(".ubicaciones-col").innerHTML = "";

          const copyBtn = tr.querySelector(".copy-codigo");
          if(copyBtn) copyBtn.remove();
      }else{

        const matches = variantesOdooCache
          .filter(v =>
            v.barcode.toLowerCase().includes(value) ||
            v.name.toLowerCase().includes(value) ||
            v.default_code.toLowerCase().includes(value)
          )
          .slice(0,200);

        if(matches.length){

          suggestionsEl.innerHTML = `
          <div class="odoo-header">
            <span>Variantes Odoo</span>
            <span class="odoo-close">✕</span>
          </div>
          <div class="odoo-list">
            ${matches.map(v => `
              <div class="odoo-option" data-barcode="${v.barcode}">
                <span class="odoo-barcode">${v.barcode}</span>
                <span class="odoo-default_code">${v.default_code}</span>
                <span class="odoo-name">${v.name}</span>
                <span class="odoo-variant">${v.variant}</span>
              </div>
            `).join("")}
          </div>
          `;

          suggestionsEl.classList.remove("hidden");

        }else{

          suggestionsEl.classList.add("hidden");
          suggestionsEl.innerHTML = "";

        }
      }

      /* ======================
        MATCH EXACTO
      ====================== */

      const code = input.value.trim();
      const info = getVarianteOdooFlexible(code);

      if(info){

        tr.querySelector(".nombre-valor").textContent = info.name;
        tr.querySelector(".variante-valor").textContent = info.variant;
        renderUbicaciones(tr, code);

        // 🔥 COPY BTN
        let copyBtn = tr.querySelector(".copy-codigo");

        if(!copyBtn){
          copyBtn = document.createElement("span");
          copyBtn.className = "copy-btn copy-codigo";
          copyBtn.textContent = "📋";

          tr.querySelector(".codigo-wrapper").appendChild(copyBtn);
        }

        copyBtn.dataset.copy = code;

      }else{

        // 🔥 LIMPIAR CUANDO NO HAY MATCH
        tr.querySelector(".nombre-valor").textContent = "";
        tr.querySelector(".variante-valor").textContent = "";
        tr.querySelector(".ubicaciones-col").innerHTML = "";

        const copyBtn = tr.querySelector(".copy-codigo");
        if(copyBtn) copyBtn.remove();

      }

    }

    validarLinea(tr);

  });

  filesInput.addEventListener("change", async () => {

    const files = Array.from(filesInput.files);

    if (!files.length) return;

    // ❌ validar fecha
    const erroresFecha = files
      .filter(f => !esArchivoDeHoy(f))
      .map(f => f.name);

    if (erroresFecha.length) {
      statusEl.textContent =
        `❌ Archivos no son del día: ${erroresFecha.join(", ")}`;
      return;
    }

    statusEl.textContent = 'Subiendo archivos...';

    for (const file of files) {

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
      else {
        continue;
      }

      await fetch(endpoint, {
        method: "POST",
        body: formData
      });

      if (name.includes("sale.order")) {
        await fetch('/api/estado/odoo-ventas', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pendienteVentasOdoo: false })
            });
      }

    }

    const faltantes = await validarArchivosDelDia();

    if (faltantes.length) {

      statusEl.innerHTML = `
        ❌ Faltan archivos:<br>
        ${faltantes.map(f => `- ${f}`).join("<br>")}
      `;

      return;
    }

    statusEl.textContent = "Archivos cargados ✅";

    // 🔥 RECARGAR TODO
    await recargarSistema();

    await cargarVentasServer();

  });

  async function recargarSistema(){

    variantesOdooCache = [];
    stockOdooCache = [];
    odooQtyByVentaCodigo.clear();

    await loadUltimasVariantesOdooParaBusqueda();
    await loadStockOdoo();
    await loadVentasOdoo();

    resultsBody.innerHTML = "";

    ventaCounter = 1;

    agregarLineaVenta(ventaCounter);
    ventaCounter++;

    construirCapsulas();

    // 🔥 AQUÍ se muestra
    resultsSection.classList.remove("hidden");

  }

  /* ================================
  COURIER INPUT
  ================================ */

  resultsBody.addEventListener("change",e=>{

    if(!e.target.classList.contains("courier-check")) return;

    const tr = e.target.closest("tr");
    const input = tr.querySelector(".courier-valor");

    if(e.target.checked)
    input.classList.remove("hidden");
    else
    input.classList.add("hidden");

  });

  /* ================================
  INIT
  ================================ */

  await loadUltimasVariantesOdooParaBusqueda();
  await loadStockOdoo();
  await loadVentasOdoo();
  await cargarVentasServer();

  resultsBody.addEventListener("keydown", (e) => {

    if (!e.target.classList.contains("codigo-input")) return;

    if (e.key === "Escape") {

      const tr = e.target.closest("tr");
      const suggestionsEl = tr.querySelector(".odoo-suggestions");

      suggestionsEl.classList.add("hidden");
      suggestionsEl.innerHTML = "";

    }

  });

  resultsBody.addEventListener("click", (e) => {

    if(e.target.classList.contains("lock-btn")){
      const tr = e.target.closest("tr");
      toggleLockVenta(tr);
      return;
    }

    const option = e.target.closest(".odoo-option");
    if (!option) return;

    const tr = option.closest("tr");
    const input = tr.querySelector(".codigo-input");
    const suggestionsEl = tr.querySelector(".odoo-suggestions");

    const barcode = option.dataset.barcode;

    input.value = barcode;

    const info = getVarianteOdooPorCodigo(barcode);

    if (info) {

      tr.querySelector(".nombre-valor").textContent = info.name;
      tr.querySelector(".variante-valor").textContent = info.variant;

      const ubic = getUbicacionesPorCodigo(barcode);

      // 🔥 AGREGAR COPY BTN
      let copyBtn = tr.querySelector(".copy-codigo");

      if(!copyBtn){
        copyBtn = document.createElement("span");
        copyBtn.className = "copy-btn copy-codigo";
        copyBtn.textContent = "📋";

        tr.querySelector(".codigo-wrapper").appendChild(copyBtn);
      }

      copyBtn.dataset.copy = barcode;

      tr.querySelector(".ubicaciones-col").innerHTML =
        ubic.map(u => `
          <div class="ubicacion-tag">
            <span class="ubicacion-text">
              ${u.ubicacion} <b>(${u.cantidad})</b>
            </span>
            <span class="copy-btn" data-copy="${u.ubicacion}">📋</span>
          </div>
        `).join("");

    }

    suggestionsEl.classList.add("hidden");
    suggestionsEl.innerHTML = "";

    validarLinea(tr);

  });

  resultsBody.addEventListener("change", e => {

    const tr = e.target.closest("tr");
    if(!tr) return;

    const flex = tr.querySelector(".flex-check");
    const courier = tr.querySelector(".courier-check");
    const courierValor = tr.querySelector(".courier-valor");

    if(e.target.classList.contains("flex-check")){

      if(flex.checked){
        courier.checked = false;
        courierValor.classList.add("hidden");
      }

      calcularValorOdoo(tr);
    }

    if(e.target.classList.contains("courier-check")){

      if(courier.checked){
        flex.checked = false;
        courierValor.classList.remove("hidden");
      }else{
        courierValor.classList.add("hidden");
      }

      calcularValorOdoo(tr);
    }

  });

  async function guardarVentasServer(){

    const filas = [...resultsBody.querySelectorAll("tr")];

    const data = filas.map(tr=>({

      venta: tr.dataset.venta,
      fecha: tr.querySelector(".fecha-input")?.value || "",
      codigo: tr.querySelector(".codigo-input")?.value || "",
      unidades: tr.querySelector(".unidades-vendidas")?.value || "",
      total: tr.querySelector(".precio-total")?.value || "",
      flex: tr.querySelector(".flex-check")?.checked || false,
      courier: tr.querySelector(".courier-check")?.checked || false,
      courierValor: tr.querySelector(".courier-valor")?.value || "",
      pack: tr.classList.contains("pack-parent"),
      locked: tr.classList.contains("locked"),
      paquetehijarow: tr.classList.contains("paquete-hija-row")

    }));

    await fetch('/api/ventas-particulares',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data)
    });

  }

  function ordenarTablaDesc() {
    const rows = [...resultsBody.querySelectorAll("tr")];

    rows.sort((a, b) => {
      const va = Number(a.dataset.venta) || 0;
      const vb = Number(b.dataset.venta) || 0;
      return vb - va;
    });

    rows.forEach(r => resultsBody.appendChild(r));
  }

  async function cargarVentasServer(){

    const res = await fetch('/api/ventas-particulares');

    if(!res.ok) return;

    const data = await res.json();

    if(!data.length) return;

    resultsBody.innerHTML="";

    data.sort((a,b)=>Number(b.venta) - Number(a.venta));

    data.forEach(v=>{

      agregarLineaVenta(v.venta);

      const tr = resultsBody.querySelector(`tr[data-venta="${v.venta}"]:last-child`);

      if(v.pack)
        tr.classList.add("pack-parent");

      tr.querySelector(".fecha-input").value = v.fecha || "";
      tr.querySelector(".codigo-input").value = v.codigo || "";

      const code = v.codigo || "";

      if(code){

        const info = getVarianteOdooFlexible(code);

        if(info){

          const codigoOriginal = getCodigoOriginalConLetras(info.default_code);

          const nombreEl = tr.querySelector(".nombre-valor");

          nombreEl.innerHTML = `
            ${codigoOriginal ? `
              <div class="codigo-original-line">
                <span class="codigo-original-label">Código original:</span>
                <span lass="codigo-original-valor">${codigoOriginal}</span>
              </div>
            ` : ''}

            <div>
              ${info.name || ''}
            </div>
          `;

          tr.querySelector(".variante-valor").textContent = info.variant;

          renderUbicaciones(tr, code);

          /* copiar código producto */

          let copyBtn = tr.querySelector(".copy-codigo");

          if(!copyBtn){

            copyBtn = document.createElement("span");
            copyBtn.className = "copy-btn copy-codigo";
            copyBtn.textContent = "📋";

            tr.querySelector(".codigo-wrapper").appendChild(copyBtn);
          }

          copyBtn.dataset.copy = code;
        }

      }
      
      tr.querySelector(".unidades-vendidas").value = v.unidades || 1;
      tr.querySelector(".precio-total").value = parseCLP(v.total || "");

      tr.querySelector(".flex-check").checked = v.flex || false;
      tr.querySelector(".courier-check").checked = v.courier || false;

      if(v.courier){
        const c = tr.querySelector(".courier-valor");
        c.classList.remove("hidden");
        c.value = parseCLP(v.courierValor || "");
      }

      if(v.paquetehijarow){

        tr.classList.add("paquete-hija-row");

        const packBtn = tr.querySelector(".pack-btn");
        if(packBtn) packBtn.remove();

        const precioCell = tr.querySelector(".precio-total")?.closest("td");
        if(precioCell) precioCell.innerHTML="";

        const flexCell = tr.querySelector(".flex-check")?.closest("td");
        if(flexCell) flexCell.innerHTML="";

        const courierCell = tr.querySelector(".courier-check")?.closest("td");
        if(courierCell) courierCell.innerHTML="";

        const valorCell = tr.querySelector(".valor-odoo")?.closest("td");
        if(valorCell) valorCell.innerHTML="";

        const fechaCell = tr.querySelector(".fecha-input")?.closest("td");
        if(fechaCell) fechaCell.innerHTML = "";
      }

      calcularValorOdoo(tr);
      validarLinea(tr);
    });
    
    const ventasBloqueadas = new Set(
      data.filter(v => v.locked).map(v => v.venta)
    );

    ventasBloqueadas.forEach(venta => {

      const rows = resultsBody.querySelectorAll(`tr[data-venta="${venta}"]`);

      rows.forEach(r => {
        r.classList.add("locked");

        r.querySelectorAll("input, button").forEach(el => {
          if(!el.classList.contains("lock-btn")){
            el.disabled = true;
          }
        });

        const btn = r.querySelector(".lock-btn");
        if(btn){
          btn.textContent = "🔓";
          btn.title = "Desbloquear venta";
        }
      });

    });
    
    ordenarTablaDesc();

    /* ======================
      MARCAR PADRES DE PACK
    ====================== */

    const ventas = [...new Set(data.map(v => v.venta))];

    ventas.forEach(venta => {

      const rows = [...resultsBody.querySelectorAll(`tr[data-venta="${venta}"]`)];

      const hasPack = rows.some(r => r.classList.contains("pack-row"));

      if(hasPack){

        const parent = rows.find(r => !r.classList.contains("pack-row"));

        if(parent){
          parent.classList.add("pack-parent");
        }

      }

    });

    ventaCounter =
      Math.max(
        0,
        ...[...resultsBody.querySelectorAll("tr")]
          .map(r => Number(r.dataset.venta) || 0)
      ) + 1;
  }

  let saveTimer;

  function guardarVentasDebounced(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(guardarVentasServer,400);
  }

  function copiarTexto(texto){

    if(!texto) return;

    navigator.clipboard.writeText(texto).catch(()=>{
      const tmp = document.createElement("textarea");
      tmp.value = texto;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand("copy");
      tmp.remove();
    });

  }

  resultsBody.addEventListener("click", (e) => {

    const btn = e.target.closest(".copy-btn");
    if(!btn) return;

    let texto = btn.dataset.copy;

    if(btn.classList.contains("copy-unidades")){
      texto = btn.closest("td").querySelector(".unidades-vendidas")?.value;
    }

    if(btn.classList.contains("copy-precio")){
      texto = btn.closest("td").querySelector(".valor-text")?.textContent;
    }

    copiarTexto(texto);

  });

  resultsBody.addEventListener("input", guardarVentasDebounced);
  resultsBody.addEventListener("change", guardarVentasDebounced);
  resultsBody.addEventListener("click", guardarVentasDebounced);

  /* ================================
  AUTO UPDATE DESDE CARPETA
  ================================ */

  const autoBtn = document.getElementById("autoUpdateBtn");

  autoBtn?.addEventListener("click", () => {
    document.getElementById("fileInputOdoo").click();
  });

  const fileInput = document.getElementById("fileInputOdoo");

  fileInput.addEventListener("change", async (e) => {

    const files = Array.from(e.target.files);

    if(!files.length) return;

    try{

      autoBtn.disabled = true;
      autoBtn.textContent = "Actualizando...";
      statusEl.textContent = "📂 Leyendo archivos...";

      // 🔹 limpiar caches
      variantesOdooCache = [];
      stockOdooCache = [];
      odooQtyByVentaCodigo.clear();

      for(const file of files){

        const path = file.webkitRelativePath.toLowerCase();

        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer,{type:"array"});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws,{header:1,defval:""});

        /* ======================
          VARIANTES
        ====================== */
        if(path.includes("product.product")){

          variantesOdooCache = rows.slice(1)
            .map(r=>({
              barcode:String(r[1]||"").trim(),
              default_code:String(r[0]||"").trim(),
              name:String(r[2]||"").trim(),
              variant:String(r[5]||"").trim()
            }))
            .filter(v=>v.barcode);

        }

        /* ======================
          STOCK
        ====================== */
        else if(path.includes("stock.quant")){

          const header = rows[0].map(h=>String(h).toLowerCase());

          const COL_BARCODE = header.findIndex(h=>h.includes("código"));
          const COL_UBICACION = header.findIndex(h=>h.includes("ubicación"));
          const COL_CANTIDAD = header.findIndex(h=>h.includes("cantidad"));

          stockOdooCache = rows.slice(1)
            .map(r=>({
              barcode:String(r[COL_BARCODE]||"").trim(),
              ubicacion:String(r[COL_UBICACION]||"").trim(),
              cantidad:Number(r[COL_CANTIDAD]||0)
            }))
            .filter(r=>r.barcode);

        }

        /* ======================
          VENTAS
        ====================== */
        else if(path.includes("sale.order")){

          rows.forEach(r=>{

            const venta = String(r[6]||"").trim();
            const codigo = String(r[8]||"").trim();
            const qty = Number(r[7]||0);

            if(!venta || !codigo) return;

            const key = `${venta}|${codigo}`;

            odooQtyByVentaCodigo.set(
              key,
              (odooQtyByVentaCodigo.get(key)||0)+qty
            );

          });

        }

      }

      // 🔁 recalcular tabla
      const rowsUI = resultsBody.querySelectorAll("tr");

      rowsUI.forEach(tr => {

        const code = tr.querySelector(".codigo-input")?.value || "";

        if(code){
          const info = getVarianteOdooFlexible(code);

          if(info){
            const codigoOriginal = getCodigoOriginalConLetras(info.default_code);

            const nombreEl = tr.querySelector(".nombre-valor");

            nombreEl.innerHTML = `
              ${codigoOriginal ? `
                <div class="codigo-original-line">
                  <span class="codigo-original-label">Código original:</span>
                  <span lass="codigo-original-valor">${codigoOriginal}</span>
                </div>
              ` : ''}

              <div>
                ${info.name || ''}
              </div>
            `;

            tr.querySelector(".variante-valor").textContent = info.variant;
            renderUbicaciones(tr, code);
          }
        }

        calcularValorOdoo(tr);
        validarLinea(tr);

      });

      statusEl.textContent = "✅ Archivos cargados correctamente";

    }catch(err){

      console.error(err);
      statusEl.textContent = "❌ Error leyendo archivos";

    }finally{

      autoBtn.disabled = false;
      autoBtn.textContent = "Actualizar todo desde Carpeta";

      fileInput.value = ""; // reset

    }

  });
  
  const ok = await validarEstadoInicial();

  if (ok) {
    resultsSection.classList.remove("hidden");
    construirCapsulas();
  }
});