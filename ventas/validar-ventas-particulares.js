document.addEventListener("DOMContentLoaded", async () => {

  const resultsBody = document.getElementById("ventasResultsBody");
  const addVentaBtn = document.getElementById("addVentaBtn");
  const resultsSection = document.getElementById("ventasResults");

  let ventaCounter = 1;

  let variantesOdooCache = [];
  let stockOdooCache = [];
  let odooQtyByVentaCodigo = new Map();

  resultsSection.classList.remove("hidden");

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
    .filter(r=>r.barcode===code)
    .map(r=>`${r.ubicacion} (${r.cantidad})`);

  }

  function renderUbicaciones(tr, code){

    const ubic = getUbicacionesPorCodigo(code);

    tr.querySelector(".ubicaciones-col").innerHTML =
      ubic.length
      ? ubic.map(u => {

          const ubicacionLimpia = u.replace(/\s*\(\d+\)$/, "");

          return `
            <div class="ubicacion-tag">
              <span class="ubicacion-text">${u}</span>
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

  /* ================================
  AGREGAR LINEA VENTA
  ================================ */

  function agregarLineaVenta(venta){

    const tr = document.createElement("tr");

    tr.dataset.venta = venta;

    tr.innerHTML = `

    <td>
      ${venta}
      <span class="copy-btn" data-copy="${venta}">📋</span>
    </td>

    <td>
    <input type="date" class="fecha-input">
    </td>

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
      <button class="pack-btn">📦</button>
      <button class="delete-btn">🗑</button>
    </td>

    `;

    resultsBody.appendChild(tr);
  }

  /* ================================
  AGREGAR VENTA
  ================================ */

  addVentaBtn.addEventListener("click",()=>{

    agregarLineaVenta(ventaCounter);

    ventaCounter++;

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
    nueva.classList.add("pack-row");
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

  function calcularValorOdoo(tr){

    if(tr.classList.contains("pack-row")) return;

    const totalInput = tr.querySelector(".precio-total");
    const unidadesInput = tr.querySelector(".unidades-vendidas");

    if(!totalInput || !unidadesInput) return;   // 👈 evita error en pack-row

    const total = Number(totalInput.value || 0);
    const unidades = Number(unidadesInput.value || 1);

    let totalBase = total;

    const flex = tr.querySelector(".flex-check");
    const courier = tr.querySelector(".courier-check");
    const courierValor = tr.querySelector(".courier-valor");

    if(flex?.checked){
      totalBase -= 3000 * 1.19;
    }

    if(courier?.checked){
      const envio = Number(courierValor?.value || 0);
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

    const key = `${venta}|${codigo}`;

    const qtyOdoo = odooQtyByVentaCodigo.get(key)||0;

    tr.querySelector(".unidades-odoo").textContent = qtyOdoo;

    let obs = "";

    if(!codigo)
    obs = "INGRESE PRODUCTO";

    else if(!odooQtyByVentaCodigo.has(key))
    obs = "REGISTRAR VENTA EN ODOO";

    else if(qtyOdoo < unidades)
    obs = "FALTAN UNIDADES";

    else if(qtyOdoo > unidades)
    obs = "EXCESO UNIDADES";

    else
    obs = "OK";

    const cell = tr.querySelector(".obs-cell");

    cell.textContent = obs;

    cell.classList.toggle("ok-cell",obs==="OK");
    cell.classList.toggle("error-cell",obs!=="OK");

  }

  /* ================================
  EVENTOS INPUT
  ================================ */

  resultsBody.addEventListener("input", async (e) => {

    const tr = e.target.closest("tr");
    if(!tr) return;

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
      const info = getVarianteOdooPorCodigo(code);

      if(info){

        tr.querySelector(".nombre-valor").textContent = info.name;
        tr.querySelector(".variante-valor").textContent = info.variant;
        renderUbicaciones(tr, code);

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

      tr.querySelector(".ubicaciones-col").innerHTML =
        ubic.map(u => `
          <div class="ubicacion-tag">
            <span class="ubicacion-text">${u}</span>
            <span class="copy-btn" data-copy="${u}">📋</span>
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
      pack: tr.classList.contains("pack-row")

    }));

    await fetch('/api/ventas-particulares',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data)
    });

  }

  async function cargarVentasServer(){

    const res = await fetch('/api/ventas-particulares');

    if(!res.ok) return;

    const data = await res.json();

    if(!data.length) return;

    resultsBody.innerHTML="";

    data.forEach(v=>{

      agregarLineaVenta(v.venta);

      const tr = resultsBody.lastElementChild;

      tr.querySelector(".fecha-input").value = v.fecha || "";
      tr.querySelector(".codigo-input").value = v.codigo || "";

      const code = v.codigo || "";

      if(code){

        const info = getVarianteOdooPorCodigo(code);

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
      tr.querySelector(".precio-total").value = v.total || "";

      tr.querySelector(".flex-check").checked = v.flex || false;
      tr.querySelector(".courier-check").checked = v.courier || false;

      if(v.courier){
        const c = tr.querySelector(".courier-valor");
        c.classList.remove("hidden");
        c.value = v.courierValor || "";
      }

      if(v.pack){

        tr.classList.add("pack-row");

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
});