document.addEventListener("DOMContentLoaded", async () => {

  const resultsBody = document.getElementById("ventasResultsBody");
  const addVentaBtn = document.getElementById("addVentaBtn");
  const resultsSection = document.getElementById("ventasResults");
  const countersEl = document.getElementById("actionCounters");

  let ventaCounter = 1;

  let variantesOdooCache = [];
  let stockOdooCache = [];
  let odooQtyByVentaCodigo = new Map();

  resultsSection.classList.remove("hidden");

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
    <td style="display: none;"></td>
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
            v.name.toLowerCase().includes(value)
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

          tr.querySelector(".nombre-valor").textContent = info.name;
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
  const statusEl = document.getElementById("statusVentas");

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
            tr.querySelector(".nombre-valor").textContent = info.name;
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
});