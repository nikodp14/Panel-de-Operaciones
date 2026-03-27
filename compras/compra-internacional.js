let jumpsellerPriceMapCache = null;
const gananciaIndividualInput = document.getElementById('gananciaIndividual');
const gananciaPackInput = document.getElementById('gananciaPack');

function actualizarChecksHeader(){

  const filas = document.querySelectorAll('#comprasBody tr');

  const checksIngresado = [...filas]
    .map(tr => tr.querySelector('.ingresado-check'))
    .filter(Boolean);

  const checksExport = [...filas]
    .map(tr => tr.querySelector('.export-check'))
    .filter(Boolean);

  const allIngresado = checksIngresado.length &&
    checksIngresado.every(c => c.checked);

  const allExport = checksExport.length &&
    checksExport.every(c => c.checked);

  document.getElementById('checkAllIngresado').checked = allIngresado;
  document.getElementById('checkAllExport').checked = allExport;
}

function actualizarEstadoExportacion(){

  const checks = document.querySelectorAll('.export-check');
  const algunoMarcado = [...checks].some(c => c.checked);

  document.getElementById('exportarExcelBtn').disabled = !algunoMarcado;
}

function getGananciaIndividual(){
  return Number(gananciaIndividualInput.value || 80) / 100;
}

function getGananciaPack(){
  return Number(gananciaPackInput.value || 70) / 100;
}

async function loadJumpsellerPriceMap(){

  if (jumpsellerPriceMapCache) return jumpsellerPriceMapCache;

  const res = await fetch('/api/jumpseller/productos/ultimo', { cache:'no-store' });

  if(!res.ok){
    return new Map();
  }

  const buf = await res.arrayBuffer();

  const wb = XLSX.read(buf,{ type:'array' });

  const ws = wb.Sheets[wb.SheetNames[0]];

  const rows = XLSX.utils.sheet_to_json(ws,{
    header:1,
    defval:'',
    raw:false
  });

  const map = new Map();

  const header = rows[0].map(h =>
    String(h || '').trim().toLowerCase()
  );

  const indiceSku = header.findIndex(h => h === 'sku');
  const indicePrice = header.findIndex(h => h === 'price');

  rows.slice(1).forEach(r => {

    const sku = String(r[indiceSku] || '')
      .replace(/^MLC/i,'')
      .trim()
      .toUpperCase();

    const price = Math.round(Number(r[indicePrice] || 0));

    if(sku){
      map.set(sku, price);
    }

  });

  jumpsellerPriceMapCache = map;

  return map;

}
    
document.addEventListener('DOMContentLoaded', async () => {

  const body = document.getElementById('comprasBody');
  const cotizacionInput = document.getElementById('cotizacionInput');
  const addBtn = document.getElementById('addRowBtn');
  const cargarBtn = document.getElementById('cargarCotBtn');

  const totalCompraFooter = document.getElementById('totalCompraFooter');
  const totalConIvaFooter = document.getElementById('totalConIvaFooter');

  const STORAGE_KEY = 'comprasCotizacionesInternacional';

  const DESCUENTO = 0.25;
  const IVA = 1.19;
  const jumpsellerPriceMap = await loadJumpsellerPriceMap();

  const fechaPedidoInput = document.getElementById('fechaPedido');
  const dolarLabel = document.getElementById('dolarCalculado');
  let dolarActual = null;
  let modoNumeroCotizacion = false;

  const usarNumeroCotBtn = document.getElementById('usarNumeroCotBtn');
  const cargarCotBtn = document.getElementById('cargarCotBtn');

  const verCotizacionesBtn = document.getElementById('verCotizacionesBtn');
  const cotizacionesModal = document.getElementById('cotizacionesModal');
  const cotizacionesLista = document.getElementById('cotizacionesLista');
  const cerrarCotizaciones = document.getElementById('cerrarCotizaciones');

  const buscarProductoCot = document.getElementById('buscarProductoCot');
  const buscarProductoSug = document.getElementById('buscarProductoSug');

  let filtroBarcodeCot = '';

  let cacheCotizaciones = {};

  function calcularPrecioOdoo(precioUSD){

    if(dolarActual === null) return 0;

    const valor = precioUSD * dolarActual;

    return Number(valor.toFixed(6));

  }

  function pintarComparacionPrecio(el, calculado, actual){

    if (!actual) return;

    if (calculado > actual){
      el.style.color = 'red';
      el.style.fontWeight = '700';
    }
    else if (actual > calculado){
      el.style.color = '#0a8f2f';
      el.style.fontWeight = '700';
    }
    else{
      el.style.color = '';
      el.style.fontWeight = '';
    }

  }

  function pintarAlertaPrecioML(el, precioActual){

      if(!el) return;

      if(precioActual === 0){
        el.innerHTML += `
          <span class="ml-alerta" title="Precio ML no encontrado" style="margin-left:6px;cursor:help;">
            ⚠️
          </span>
        `;
      }

  }

  function pintarAlertaPrecioJumpseller(el, precioActual){

    if(!el) return;

    if(precioActual === 0){
      el.innerHTML += `
        <span class="ml-alerta" title="Precio Jumpseller no encontrado" style="margin-left:6px;cursor:help;">
          ⚠️
        </span>
      `;
    }

  }

  function pintarEstadoPublicacion(el, estado){

    if(!el) return;

    el.textContent = estado || '';

    if ((estado || '').toLowerCase().includes('inactiva')){
      el.style.color = 'red';
      el.style.fontWeight = '700';
    }
    else{
      el.style.color = '';
      el.style.fontWeight = '';
    }

  }

  function obtenerCostosML(tr){

    const porcentajeTexto = tr.querySelector('.porcentaje-comision')?.textContent || '0';

    const comision = Number(porcentajeTexto.replace('%','')) || 0;

    const envio = Number(
      (tr.querySelector('.costo-envio-input')?.value || '').replace(/\./g,'')
    ) || 0;

    return {comision, envio};

  }

  function actualizarPrecioJumpseller(tr, precioOdoo, numeroPub, esPack){

    const precio = calcularPrecioJumpseller(precioOdoo, esPack, tr);

    const actual = jumpsellerPriceMap?.get(numeroPub) || 0;

    const el = tr.querySelector('.precio-jumpseller');

    el.innerHTML = renderCopiable(precio.toFixed(0), false, true);

    pintarComparacionPrecio(el, precio, actual);

    pintarAlertaPrecioJumpseller(el, actual);

  }
          
  async function cargarListaCotizaciones(){

    const res = await fetch('/api/cotizaciones-internacional');
    const data = await res.json();
    cacheCotizaciones = data || {};

    const cotizaciones = Object.entries(data || {});

    const porNumero = [];
    const porFecha = [];

    cotizaciones.forEach(([c,v]) => {

      const lineas = v?.lineas?.length || 0;

      // 🔹 ignorar cotizaciones sin líneas
      if (lineas === 0) return;

      if (/^\d{4}-\d{2}-\d{2}$/.test(c)) {
        porFecha.push([c,v]);
      } else {
        porNumero.push([c,v]);
      }

    });

    porNumero.sort((a,b)=> Number(b) - Number(a));
    porFecha.sort((a,b)=> b[0].localeCompare(a[0]));

    cotizacionesLista.innerHTML = `

      <div class="cotizacion-grupo">
        <h4>Por número</h4>
        ${porNumero.map(([c,v]) => `
          <div class="cotizacion-item" data-cot="${c}">
            <span class="cot-num">Cotización ${c}</span>
            <span class="cot-lineas">(${v?.lineas?.length || 0} líneas)</span>
          </div>
        `).join('')}
      </div>

      <div class="cotizacion-grupo">
        <h4>Por fecha</h4>
        ${porFecha.map(([c,v]) => `
          <div class="cotizacion-item" data-cot="${c}">
            <span class="cot-num">${c}</span>
            <span class="cot-lineas">(${v?.lineas?.length || 0} líneas)</span>
          </div>
        `).join('')}
      </div>

    `;
  }

  verCotizacionesBtn.addEventListener('click', async () => {

    await cargarListaCotizaciones();

    cotizacionesModal.classList.remove('hidden');

  });

  cerrarCotizaciones.addEventListener('click', () => {

    cotizacionesModal.classList.add('hidden');

  });

  cotizacionesLista.addEventListener('click', async (e) => {

    const item = e.target.closest('.cotizacion-item');
    if(!item) return;

    const cot = item.dataset.cot;

    if (/^\d{4}-\d{2}-\d{2}$/.test(cot)) {

      modoNumeroCotizacion = false;

      cotizacionInput.style.display = 'none';
      cargarCotBtn.style.display = 'none';

      fechaPedidoInput.value = cot;

    } else {

      modoNumeroCotizacion = true;

      cotizacionInput.style.display = 'inline-block';
      cargarCotBtn.style.display = 'inline-block';

      cotizacionInput.value = cot;

    }

    cotizacionesModal.classList.add('hidden');

    await cargarCotizacion();

  });

  usarNumeroCotBtn.addEventListener('click', async () => {

    // 🔹 Si estamos en modo FECHA → cambiar a modo COTIZACIÓN
    if (!modoNumeroCotizacion) {

      modoNumeroCotizacion = true;

      usarNumeroCotBtn.textContent = 'Volver a funcionamiento por fecha';

      cotizacionInput.style.display = 'inline-block';
      cargarCotBtn.style.display = 'inline-block';

      // limpiar tabla
      body.innerHTML = '';

      cotizacionInput.value = '';

      addRow();

      cotizacionInput.focus();

      return;
    }

    // 🔹 Si estamos en modo COTIZACIÓN → volver a modo FECHA
    modoNumeroCotizacion = false;

    usarNumeroCotBtn.textContent = 'Ingresar N° cotización';

    cotizacionInput.style.display = 'none';
    cargarCotBtn.style.display = 'none';

    cotizacionInput.value = '';

    const fecha = fechaPedidoInput.value;

    if (fecha) {
      await cargarCotizacion();
    }

  });

  function obtenerClaveCotizacion(){

    if (modoNumeroCotizacion) {
      return cotizacionInput.value.trim();
    }

    return fechaPedidoInput.value;

  }

  document.addEventListener('click', e => {

    if (!e.target.classList.contains('copiar-icon')) return;

    let valor = '';

    // 🔹 caso input (codigo)
    const codigoRow = e.target.closest('.codigo-row');
    if (codigoRow) {
      const input = codigoRow.querySelector('.codigo-input');
      valor = input?.value || '';
    }

    // 🔹 caso celdas copiables (precio, ML, etc)
    const copiableCell = e.target.closest('.copiable-cell');
    if (copiableCell) {
      const el = copiableCell.querySelector('.copiable-value');

      if (el) {
        valor = el.tagName === 'INPUT'
          ? el.value
          : el.textContent;
      }
    }

    copiarAlPortapapeles(valor.trim());

  });

  function copiarAlPortapapeles(texto) {

    if (!texto) return;

    navigator.clipboard.writeText(texto);

    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = 'Copiado';
      toast.classList.remove('hidden');
      toast.classList.add('show');

      setTimeout(() => {
        toast.classList.remove('show');
      }, 1200);
    }
  }

  function renderCopiable(valor, isLink = false, isPrice = false) {

    const link = isLink
      ? `https://articulo.mercadolibre.cl/MLC-${valor}`
      : null;

    return `
      <div class="copiable-cell">
        ${
          isLink
            ? `<a href="${link}" target="_blank" class="copiable-link copiable-value">${valor}</a>`
            : `<span>${isPrice ? '$' + Math.round(valor).toLocaleString('es-CL') : valor}</span><span class="copiable-value" style="display: none;">${valor}</span>`
        }
        <span class="copiar-icon">📋</span>
      </div>
    `;
  }

  async function obtenerDolar(fecha){

    try{

      const res = await fetch(`/api/dolar?fecha=${fecha}`);

      if(!res.ok) throw new Error("No disponible");

      const data = await res.json();

      aplicarValorDolar(data.valor);

      if (data.fechaUsada && data.fechaUsada !== fecha) {
        dolarLabel.innerHTML =
          `${dolarActual.toFixed(2)} <span style="color:#888;">(Último día hábil ${data.fechaUsada})</span>`;
      }

    }catch(err){

      console.error("No se pudo obtener dólar", err);

      dolarActual = null;
      dolarLabel.textContent = "Error";

    }

  }

  function aplicarValorDolar(dolar){

  const dolarMas30 = dolar + 30;

  dolarActual = dolarMas30;

  dolarLabel.textContent = dolarMas30.toFixed(2);

}

  let variantesCache = [];

  let packSetCache = null;

  function findIndiceComision(headerRow) {
    const header = headerRow.map(h => normalizeHeader(h || ''));

    // palabras clave que pueden indicar comisión
    const keywords = ['cargo por venta'];

    // recorremos columnas y buscamos la primera que contenga todas las claves
    for (let i = 0; i < header.length; i++) {
      const cell = header[i];

      // si el encabezado contiene todas estas palabras en cualquier parte
      const contiene = keywords.every(kw => cell.includes(kw));
      if (contiene) {
        return i;
      }
    }

    // si no se encontró nada, devolvemos -1
    return -1;
  }

  async function loadPackSet() {
    if (packSetCache) return packSetCache;

    const res = await fetch('/validar-ml/configuracion.xlsx', { cache: 'no-store' });
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    const sheetName =
      wb.SheetNames.find(n => n.toLowerCase().includes('pack'));

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const set = new Set();

    rows.forEach(r => {
      const pub = String(r['Nro. Publicación Pack'] || r['nro, publicacion pack'] || '')
        .replace(/^MLC/i,'')
        .trim()
        .toUpperCase();

      if(pub){
        set.add(pub);
      }

    });

    packSetCache = set;
    return set;
  }

  let comisionMapCache = null;

  async function loadComisionMap() {

    if (comisionMapCache) return comisionMapCache;

    const res = await fetch('/api/ml/comisiones/ultimo', { cache: 'no-store' });
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    const sheetName =
      wb.SheetNames.find(n => n.toLowerCase().includes('publicaciones')) ||
      wb.SheetNames[0];

    const ws = wb.Sheets[sheetName];

    // 🔥 Leer como matriz completa
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: ''
    });

    if (!rows.length) return new Map();

    // 🔥 Detectar encabezado (normalmente fila 2 o 3 en ML)
    const headerRow = rows[2] || rows[1] || rows[0];

    function normalizeHeader(str) {
      return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    }

    const headerNormalized = headerRow.map(h => normalizeHeader(h));

    // 🔥 Buscar columna de Número de publicación
    const indicePublicacion = headerNormalized.findIndex(h =>
      h.includes('numero') && h.includes('publicacion')
    );

    // 🔥 Buscar columna Cargo por venta dinámicamente
    const indiceComision = headerNormalized.findIndex(h =>
      h.includes('cargo') && h.includes('venta')
    );

    // 🔥 Buscar columna Precio dinámicamente
    const indicePrecio = headerNormalized.findIndex(h =>
      h.includes('precio')
    );

    const indiceEstado = headerNormalized.findIndex(h =>
      h.includes('estado')
    );

    if (indicePublicacion === -1 || indiceComision === -1 || indicePrecio === -1) {
      console.warn('⚠ No se encontraron columnas necesarias en planilla ML');
      return new Map();
    }

    const indiceTitulo = headerNormalized.findIndex(h =>
      h.includes('titulo')
    );

    const map = new Map();

    // 🔥 Iterar desde fila siguiente al header
    rows.slice(3).forEach(r => {

      const pub = String(r[indicePublicacion] || '')
        .replace(/^MLC/i, '')
        .trim()
        .toUpperCase();

      const comision = parseFloat(
        String(r[indiceComision] || '').replace('%', '')
      ) || 0;

      const precioMLActual = parseFloat(
        String(r[indicePrecio] || '')
          .replace(/\./g,'')
          .replace(',','.')
      ) || 0;

      const estado = String(r[indiceEstado] || '').trim();

      if (pub) {
        map.set(pub, {
          comision,
          precio: precioMLActual,
          estado,
          titulo: indiceTitulo >= 0 ? r[indiceTitulo] : ''
        });
      }
    });

    comisionMapCache = map;
    return map;
  }

  async function obtenerComisionDesdeBarcode(barcodeRaw) {

    const packSet = await loadPackSet();
    const comisionMap = await loadComisionMap();

    const partes = String(barcodeRaw || '')
    .split('/')
    .map(p =>
      p
        .replace(/^MLC/i,'')
        .split('-')[0]        // 🔥 elimina -1, -2, etc
        .trim()
        .toUpperCase()
    )
    .filter(Boolean);

    // Buscar cuál existe en publicaciones ML
    const candidatos = partes.filter(p => comisionMap.has(p));

    if (!candidatos.length) {
      return { comision: 0, publicacion: '' };
    }

    // Quitar los que son pack
    const individuales = candidatos.filter(p => !packSet.has(p));

    const final = individuales.length ? individuales[0] : candidatos[0];

    const data = comisionMap.get(final);

    if (data?.comision === 0 && final) {
      alert(`⚠ La publicación ${final} tiene comisión 0%. Verifique carga del archivo publicaciones.`);
    }

    return {
      comision: data?.comision || 0,
      publicacion: final || '',
      precioActual: data?.precio || 0
    };
  }

  async function loadVariantes() {
    if (variantesCache.length) return;

    const res = await fetch('/api/odoo/variantes/ultimo');
    if (!res.ok) return;

    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    variantesCache = rows.slice(1).map(r => ({
      barcode: String(r[1] || '').trim().toUpperCase(),
      name: String(r[2] || '').trim(),
      variant: String(r[5] || '').trim()
    })).filter(v => v.barcode);
  }
    
  function addRow() {
    const tr = document.createElement('tr');
    tr.dataset.precioUsd = '';
    tr.dataset.rowid = crypto.randomUUID();

    tr.innerHTML = `
      <td>
        <input type="checkbox" class="export-check">
      </td>

      <td>
        <input type="checkbox" class="ingresado-check">
      </td>
      <td style="position: relative;">
        <div class="producto-comprar">
          <div class="codigo-row">
            <input type="text" class="codigo-input copiable-value" placeholder="Buscar producto..." />
            <span class="copiar-icon">📋</span>
          </div>

          <div class="odoo-suggestions hidden"></div>

          <div class="producto-info">
            <div class="linea-nombre">
              <span class="nombre-valor"></span>
            </div>
            <div class="linea-variante">
              <span class="variante-valor"></span>
            </div>
          </div>

        </div>
      </td>
      <td>
        <input type="number" class="cantidad-input" min="0" value="0" />
      </td>
      <td>
        <input type="number" class="total-input" min="0" value="0" />
      </td>
      <td class="precio-usd">0</td>
      <td class="precio-odoo">0</td>
      <td class="total-odoo">0</td>
      <td class="numero-publicacion"></td>
      <td class="estado-publicacion"></td>
      <td class="porcentaje-ganancia">0</td>
      <td>
        <input type="number" class="precio-caja-input" min="0" value="0">
      </td>
      <td class="ml-col precio-jumpseller">0</td>
      <td class="ml-col">
        <input type="number" class="costo-envio-input" min="0" value="0" />
      </td>
      <td class="ml-col porcentaje-comision">0</td>
      <td class="ml-col precio-ml">0</td>
      <td class="delete-col">
        <button class="delete-row-btn">✕</button>
      </td>
    `;

    body.appendChild(tr);

    actualizarChecksHeader();
  }

  function calcularPrecioJumpseller(precioOdoo, esPack, tr){

    const margen = esPack
      ? 1 + getGananciaPack()
      : 1 + getGananciaIndividual();

    const precioCaja = Number(
      tr.querySelector('.precio-caja-input')?.value || 0
    );

    const base = (precioOdoo * margen * 1.19) + precioCaja;

    return Math.ceil((base - 990) / 1000) * 1000 + 990;

  }

  function pintarComparacionML(el, calculado, actual){

    if (!actual) return;

    if (calculado > actual){
      el.style.color = 'red';
      el.style.fontWeight = '700';
    }
    else if (actual > calculado){
      el.style.color = '#1dbe4b';
      el.style.fontWeight = '700';
    }
    else{
      el.style.color = '';
      el.style.fontWeight = '';
    }

  }

  function obtenerDatosML(tr){

    const numeroPub =
      tr.querySelector('.numero-publicacion .copiable-value')?.textContent
      ?.trim()
      ?.toUpperCase() || '';

    const data = comisionMapCache?.get(numeroPub) || {};

    return {
      numeroPub,
      esPack: packSetCache?.has(numeroPub),
      precioActual: data?.precio || 0,
      estado: data?.estado || ''
    };

  }

  function calcularFila(tr, parent = null){

    const {numeroPub, esPack, precioActual} = obtenerDatosML(tr);

    const dataMap = comisionMapCache?.get(numeroPub);

    const gananciaEl = tr.querySelector('.porcentaje-ganancia');

    if(gananciaEl){
      const porcentaje = esPack
        ? gananciaPackInput.value
        : gananciaIndividualInput.value;

      gananciaEl.textContent = porcentaje + '%';
    }

    pintarEstadoPublicacion(
      tr.querySelector('.estado-publicacion'),
      dataMap?.estado
    );

    const totalLinea =
      Number(tr.querySelector('.total-input')?.value || 0);

    let precioUSD;
    let cantidad;

    if(parent){ // sub-publicación

      if(esPack){
        precioUSD = totalLinea;
      }else{
        precioUSD = Number(parent.dataset.precioUsd || 0);
      }

    }else{ // línea principal

      cantidad =
        Number(tr.querySelector('.cantidad-input')?.value) || 0;

      precioUSD = cantidad ? totalLinea / cantidad : 0;

    }

    const precioOdoo = calcularPrecioOdoo(precioUSD);
    tr.dataset.precioUsd = precioUSD;
    const precioUsdEl = tr.querySelector('.precio-usd');
    const precioOdooEl = tr.querySelector('.precio-odoo');
    const totalOdooEl = tr.querySelector('.total-odoo');

    // 🔹 sub-publicación NO pack → ocultar todo
    if(parent && !esPack){

      if(precioUsdEl) precioUsdEl.textContent = '';
      if(precioOdooEl) precioOdooEl.innerHTML = '';
      if(totalOdooEl) totalOdooEl.textContent = '';

    }

    // 🔹 sub-publicación pack → mostrar USD pero ocultar Odoo
    else if(parent && esPack){

      if(precioUsdEl) precioUsdEl.textContent = '';
      if(precioOdooEl) precioOdooEl.innerHTML = '';
      if(totalOdooEl) totalOdooEl.textContent = '';

    }

    // 🔹 publicación principal
    else{

      if(precioUsdEl) precioUsdEl.textContent = precioUSD.toFixed(2);
      if(precioOdooEl) precioOdooEl.innerHTML = renderCopiable(precioOdoo.toFixed(0), false, true);
      if(totalOdooEl) totalOdooEl.textContent = '$ ' + Math.round(precioOdoo.toFixed(0) * cantidad).toLocaleString('es-CL');
    }

    actualizarPrecioJumpseller(tr, precioOdoo, numeroPub, esPack);

    const {comision, envio} = obtenerCostosML(tr);

    const precioMLEl = tr.querySelector('.precio-ml');

    let precioML = 0;

    if (!parent && totalLinea <= 0){

      precioMLEl.innerHTML =
        '<span style="color:#999;font-style:italic;">Ingrese costo</span>';

    }
    else if (envio <= 0 || comision <= 0){

      precioMLEl.innerHTML =
        '<span style="color:#999;font-style:italic;">Complete costos ML</span>';

    }
    else{

      precioML = calcularPrecioML(
        precioOdoo,
        comision,
        envio,
        esPack,
        tr
      );

      precioMLEl.innerHTML =
        renderCopiable(precioML.toFixed(0), false, true);

    }

    pintarComparacionML(precioMLEl, precioML, precioActual);

    pintarAlertaPrecioML(precioMLEl, precioActual);

    return {
      totalLinea,
      precioOdoo
    };

  }

  function recalcularTotales(){

    let totalCompra = 0;
    let totalOdoo = 0;

    document
    .querySelectorAll('#comprasBody tr:not(.sub-publicacion)')
    .forEach(tr=>{

      const exportCheck = tr.querySelector('.export-check');
      const ingresadoCheck = tr.querySelector('.ingresado-check');

      // 🔥 solo considerar seleccionados y NO ingresados
      if(!exportCheck?.checked) return;
      if(ingresadoCheck?.checked) return;

      calcularFila(tr); // 🔥 siempre recalcula UI

      const precioOdoo = Number(
        tr.querySelector('.precio-odoo .copiable-value')?.textContent || 0
      );

      const cantidad =
        Number(tr.querySelector('.cantidad-input')?.value) || 0;

      totalOdoo += cantidad * precioOdoo;

  });

    document
      .querySelectorAll('#comprasBody tr.sub-publicacion')
      .forEach(tr=>{

        const parent =
          document.querySelector(`tr[data-rowid="${tr.dataset.parent}"]`);

        if(!parent) return;

        calcularFila(tr, parent);

    });

    totalConIvaFooter.textContent =
    '$ ' + Math.round(totalOdoo).toLocaleString('es-CL');

  }

  async function procesarPublicaciones(tr, barcodeRaw){

    const resultado = await obtenerComisionDesdeBarcode(barcodeRaw);

    const publicaciones = String(barcodeRaw || '')
      .split('/')
      .map(p => p.replace(/^MLC/i,'').split('-')[0].trim().toUpperCase())
      .filter(Boolean);

    const comisionMap = await loadComisionMap();

    const packSet = await loadPackSet();

    const publicacionesValidas = publicaciones.filter(p => comisionMap.has(p));

    // separar individuales y packs
    const individuales = publicacionesValidas.filter(p => !packSet.has(p));
    const packs = publicacionesValidas.filter(p => packSet.has(p));

    // ordenar correctamente
    let ordenadas = [];

    if (individuales.length) {
      ordenadas = [...individuales, ...packs];
    } else {
      ordenadas = [...packs];
    }

    // eliminar sublíneas existentes
    document.querySelectorAll(`tr[data-parent="${tr.dataset.rowid}"]`)
      .forEach(r => r.remove());

    const filaPrincipal = tr;

    if(ordenadas.length > 1){

      let insertAfter = filaPrincipal;

      ordenadas.slice(1).forEach(pub => {

        const esPack = packSet.has(pub);
        const sub = document.createElement('tr');
        sub.classList.add('sub-publicacion');
        sub.dataset.parent = filaPrincipal.dataset.rowid;

        const data = comisionMap.get(pub);

        sub.innerHTML = `
          <td></td>
          <td></td>
          <td class="subproducto">
            ↳ publicación adicional
            <div class="subtitulo">${data?.titulo || ''}</div>
          </td>
          <td class="pack-cantidad">${esPack ? 1 : ''}</td>

          <td>
            ${esPack
              ? '<input type="number" class="total-input" value="0">'
              : ''
            }
          </td>

          <td class="precio-usd">${esPack ? '0' : ''}</td>
          <td class="precio-odoo">${esPack ? '0' : ''}</td>
          <td class="total-odoo">${esPack ? '0' : ''}</td>

          <td class="ml-col numero-publicacion">
            ${renderCopiable(pub, true)}
          </td>

          <td class="ml-col estado-publicacion">
            ${data?.estado || ''}
          </td>
          <td></td>
          <td></td>
          <td class="ml-col precio-jumpseller"></td>

          <td class="ml-col">
            <input type="text" class="costo-envio-input" value="0">
          </td>

          <td class="ml-col porcentaje-comision">
            ${data?.comision || 0}%
          </td>

          <td class="ml-col precio-ml"></td>

          <td></td>
        `;

        insertAfter.parentNode.insertBefore(sub, insertAfter.nextSibling);
        insertAfter = sub;

        pintarEstadoPublicacion(
          sub.querySelector('.estado-publicacion'),
          data?.estado
        );

      });
    }

    filaPrincipal.querySelector('.porcentaje-comision').textContent =
      resultado.comision + '%';

    const pub = ordenadas[0] || (resultado.publicacion || '').toUpperCase().trim();

    filaPrincipal.querySelector('.numero-publicacion').innerHTML =
      renderCopiable(pub, true);

    const data = comisionMap.get(pub);

    if (data?.titulo) {

      const nombreEl = filaPrincipal.querySelector('.nombre-valor');
      const varianteEl = filaPrincipal.querySelector('.variante-valor');

      const tituloML = String(data.titulo || '').trim();
      const varianteOdoo = String(varianteEl.textContent || '').trim();

      // 🔹 mostrar título ML como nombre principal
      nombreEl.textContent = tituloML;

      // 🔹 mostrar variante solo si es distinta del título
      if (varianteOdoo && !tituloML.toLowerCase().includes(varianteOdoo.toLowerCase())) {
        varianteEl.style.display = '';
      } else {
        varianteEl.style.display = 'none';
      }

    }
  }

  let exactMatch = null;

  body.addEventListener('input', async (e) => {

    if (e.target.classList.contains('codigo-input')) {

      const input = e.target;
      const tr = input.closest('tr');
      const suggestions = tr.querySelector('.odoo-suggestions');
      const nombreEl = tr.querySelector('.nombre-valor');
      const varianteEl = tr.querySelector('.variante-valor');

      const rawValue = input.value.trim();
      const normalizedValue = rawValue.toUpperCase();
      const lowerValue = rawValue.toLowerCase();

      // 🔥 Obtener comisión ML desde barcode
      let codigoFinal = normalizedValue;

      // 🔥 Limpiar si no coincide con barcode válido
      await loadVariantes();

      // 🔥 matches SOLO por barcode (para autocompletar seguro)
      const matchesBarcode = variantesCache.filter(v =>
        v.barcode.includes(normalizedValue)
      );

      // 🔥 matches generales (para sugerencias)
      const matches = variantesCache.filter(v =>
        v.barcode.includes(normalizedValue) ||
        v.name.toLowerCase().includes(lowerValue)
      );

      const exactMatch = variantesCache.find(v => v.barcode === normalizedValue);

      // 🔥 CASO 1: input vacío → limpiar TODO
      if(!normalizedValue){
        nombreEl.textContent = '';
        varianteEl.textContent = '';
        tr.classList.remove('fila-error');

        suggestions.innerHTML = '';
        suggestions.classList.add('hidden');

        return;
      }

      // 🔥 CASO 2: match exacto → llenar
      if (exactMatch) {

        nombreEl.textContent = exactMatch.name || '';
        varianteEl.textContent = exactMatch.variant || '';

        tr.classList.remove('fila-error');

      } else {

        // 🔥 CASO 3: NO match → limpiar SIEMPRE
        nombreEl.textContent = '';
        varianteEl.textContent = '';

        tr.classList.add('fila-error');
      }

      // 🔥 CASO NORMAL (solo si hay match válido)
      if (exactMatch) {
        await procesarPublicaciones(tr, codigoFinal);
        calcularFila(tr);
        guardarCotizacion();
      }

      if (lowerValue.length < 3) {
        suggestions.innerHTML = '';
        suggestions.classList.add('hidden');
        return;
      }

      // 🔥 si hay SOLO UNA coincidencia → autocompletar
      if(normalizedValue.length >= 3 && matches.length === 1){

        const unico = matches[0];

        input.value = unico.barcode; // 🔥 reemplaza por código real

        nombreEl.textContent = unico.name || '';
        varianteEl.textContent = unico.variant || '';

        tr.classList.remove('fila-error');

        suggestions.innerHTML = '';
        suggestions.classList.add('hidden');

        await procesarPublicaciones(tr, unico.barcode);
        calcularFila(tr);
        guardarCotizacion();

        return;
      }

      suggestions.innerHTML = `
        <div class="odoo-header">
          <span>Variantes Odoo</span>
          <span class="odoo-close">✕</span>
        </div>
        <div class="odoo-list">
          ${matches.map(v => `
            <div class="odoo-option" data-barcode="${v.barcode}">
              <div class="odoo-barcode">${v.barcode}</div>
              <div class="odoo-name">${v.name}</div>
              <div class="odoo-variant">${v.variant}</div>
            </div>
          `).join('')}
        </div>
      `;

      suggestions.classList.remove('hidden');

      guardarCotizacion();
    }

    if (
      e.target.classList.contains('cantidad-input') ||
      e.target.classList.contains('total-input') ||
      e.target.classList.contains('costo-envio-input') ||
      e.target.classList.contains('precio-caja-input')
    ){
      const tr = e.target.closest('tr');
      if(tr) calcularFila(tr);
      recalcularTotales();
      guardarCotizacion();
    }

    if (e.target.classList.contains('costo-envio-input')) {
      guardarCotizacion();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.odoo-suggestions')
        .forEach(el => el.classList.add('hidden'));
    }
  });

  body.addEventListener('click', async (e) => {

    if (e.target.classList.contains('odoo-close')) {
      const sug = e.target.closest('.odoo-suggestions');
      sug.classList.add('hidden');
      return;
    }

    const option = e.target.closest('.odoo-option');
    if (!option) return;

    const tr = option.closest('tr');
    const input = tr.querySelector('.codigo-input');
    const nombreEl = tr.querySelector('.nombre-valor');
    const varianteEl = tr.querySelector('.variante-valor');
    const suggestions = tr.querySelector('.odoo-suggestions');

    const barcode = option.dataset.barcode;
    const info = variantesCache.find(v => v.barcode === barcode);

    input.value = barcode;

    const resultado = await obtenerComisionDesdeBarcode(barcode);

    await procesarPublicaciones(tr, barcode);
    nombreEl.textContent = info?.name || '';
    varianteEl.textContent = info?.variant || '';
    tr.classList.remove('fila-error');

    guardarCotizacion();

    suggestions.classList.add('hidden');
  });

  body.addEventListener('click', (e) => {

  const deleteBtn = e.target.closest('.delete-row-btn');
    if (!deleteBtn) return;

    const confirmar = confirm('¿Eliminar esta línea?');
    if (!confirmar) return;

    const tr = deleteBtn.closest('tr');
    tr.remove();

    recalcularTotales();
    guardarCotizacion();
  });

  addBtn.addEventListener('click', () => {

  const clave = obtenerClaveCotizacion();

    if (!clave) {
      alert('Seleccione una fecha o ingrese N° de cotización');
      return;
    }

    addRow();

  });

  async function guardarCotizacion() {

    const cot = obtenerClaveCotizacion();
    if (!cot) return;

    const lineas = [];

    document.querySelectorAll('#comprasBody tr:not(.sub-publicacion)').forEach(tr => {

      const rowid = tr.dataset.rowid;

      const subs = [...document.querySelectorAll(`tr[data-parent="${rowid}"]`)];

      const subEnvios = subs.map(r =>
        r.querySelector('.costo-envio-input')?.value || 0
      );

      const subTotales = subs.map(r =>
        r.querySelector('.total-input')?.value || 0
      );

      const barcode = tr.querySelector('.codigo-input')?.value || '';

      const esValido = variantesCache.some(v => v.barcode === barcode);

      lineas.push({
        barcode,
        nombre: esValido ? (tr.querySelector('.nombre-valor')?.textContent || '') : '',
        variante: esValido ? (tr.querySelector('.variante-valor')?.textContent || '') : '',
        cantidad: tr.querySelector('.cantidad-input')?.value || 0,
        total: tr.querySelector('.total-input')?.value || 0,
        costoEnvio: tr.querySelector('.costo-envio-input')?.value || 0,
        precioCaja: tr.querySelector('.precio-caja-input')?.value || 0,
        ingresado: tr.querySelector('.ingresado-check')?.checked || false,
        seleccionado: tr.querySelector('.export-check')?.checked || false,
        subEnvios,
        subTotales
      });

    });

    await fetch(`/api/cotizaciones-internacional/${cot}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha: fechaPedidoInput.value || '',
        gananciaIndividual: gananciaIndividualInput.value,
        gananciaPack: gananciaPackInput.value,
        lineas
      })
    });

  }

  async function cargarCotizacion() {
    const cot = obtenerClaveCotizacion();
    if (!cot) return;

    const res = await fetch(`/api/cotizaciones-internacional/${cot}`);
    const cotData = await res.json();

    if(cotData?.gananciaIndividual){
      gananciaIndividualInput.value = cotData.gananciaIndividual;
    }

    if(cotData?.gananciaPack){
      gananciaPackInput.value = cotData.gananciaPack;
    }

    if (cotData?.fecha) {
      fechaPedidoInput.value = cotData.fecha;
      await obtenerDolar(cotData.fecha);
    }

    body.innerHTML = '';

    if (!cotData || !cotData.lineas || !cotData.lineas.length) {

      body.innerHTML = '';
      addRow();
      return;

    }

    await loadVariantes();

    await Promise.all(
      cotData.lineas.map(async (l) => {

        addRow();
        const tr = body.lastElementChild;

        const barcode = l.barcode || '';

        const input = tr.querySelector('.codigo-input');
        input.value = barcode;

        // 🔥 disparar lógica de sub publicaciones
        const esValido = variantesCache.some(v => v.barcode === barcode);

        if(esValido){
          tr.querySelector('.nombre-valor').textContent = l.nombre;
          tr.querySelector('.variante-valor').textContent = l.variante;
        }else{
          tr.querySelector('.nombre-valor').textContent = '';
          tr.querySelector('.variante-valor').textContent = '';
        }

        await procesarPublicaciones(tr, barcode);

        if (l.subEnvios?.length) {

          const subs = document.querySelectorAll(
            `tr[data-parent="${tr.dataset.rowid}"]`
          );

          subs.forEach((sub,i)=>{
            const val = l.subEnvios[i];

            const inputEnvio = sub.querySelector('.costo-envio-input');

            if (val !== undefined && inputEnvio) {
              inputEnvio.value = val;
            }
          });
        }

        if (l.subTotales?.length) {

          const subs = document.querySelectorAll(
            `tr[data-parent="${tr.dataset.rowid}"]`
          );

          subs.forEach((sub,i)=>{
            const val = l.subTotales[i];

            const inputTotal = sub.querySelector('.total-input');

            if (val !== undefined && inputTotal) {
              inputTotal.value = val;
            }
          });

        }

        tr.querySelector('.cantidad-input').value = l.cantidad;
        tr.querySelector('.total-input').value = l.total;
        tr.querySelector('.costo-envio-input').value = l.costoEnvio || 0;
        tr.querySelector('.precio-caja-input').value = l.precioCaja || 0;

        calcularFila(tr);
        
        if(l.seleccionado){
          const checkSel = tr.querySelector('.export-check');
          if(checkSel) checkSel.checked = true;
        }

        if(l.ingresado){
          const check = tr.querySelector('.ingresado-check');
          check.checked = true;
          actualizarEstadoIngresado(tr);
        }
      })
    );

    recalcularTotales();
    guardarCotizacion();
    actualizarChecksHeader();
    actualizarEstadoExportacion();
  }

  cargarBtn.addEventListener('click', async () => {
    await cargarCotizacion();
  });

  fechaPedidoInput.addEventListener('change', async e => {

    const fecha = e.target.value;

    if (!fecha) return;

    await obtenerDolar(fecha);

    if (!modoNumeroCotizacion) {
      await cargarCotizacion();
    }

  });

  function calcularPrecioML(precioOdoo, comisionPercent, envio, esPack, tr) {

    const comision = comisionPercent / 100;

    if (comision >= 1) return 0;

    const margen = esPack
      ? 1 + getGananciaPack()
      : 1 + getGananciaIndividual();

    const precioCaja = Number(
      tr.querySelector('.precio-caja-input')?.value || 0
    );

    const brutoNecesario =
      ((precioOdoo * margen * 1.19) + precioCaja + envio) / (1 - comision);

    const redondeado =
      Math.floor(brutoNecesario / 1000) * 1000 + 990;

    return redondeado;
  }

  const hoy = new Date().toISOString().slice(0,10);

  if (!fechaPedidoInput.value) {
    fechaPedidoInput.value = hoy;
    await obtenerDolar(hoy);
    await cargarCotizacion();
  }

  buscarProductoCot.addEventListener('input', async e => {

    const val = e.target.value.trim().toLowerCase();

    // 🔹 si se borró el texto → restaurar lista completa
    if(val.length === 0){
      filtroBarcodeCot = '';
      buscarProductoSug.classList.add('hidden');
      await cargarListaCotizaciones();
      return;
    }

    if(val.length < 3){
      buscarProductoSug.classList.add('hidden');
      return;
    }

    await loadVariantes();

    const matches = variantesCache
      .filter(v =>
        v.barcode.toLowerCase().includes(val) ||
        v.name.toLowerCase().includes(val)
      )
      .slice(0,50);

    buscarProductoSug.innerHTML = matches.map(v=>`
      <div class="odoo-option" data-barcode="${v.barcode}">
        <div class="odoo-barcode">${v.barcode}</div>
        <div class="odoo-name">${v.name}</div>
        <div class="odoo-variant">${v.variant}</div>
      </div>
    `).join('');

    buscarProductoSug.classList.remove('hidden');

  });

  buscarProductoSug.addEventListener('click', e=>{

    const opt = e.target.closest('.odoo-option');
    if(!opt) return;

    const barcode = opt.dataset.barcode;

    filtroBarcodeCot = barcode;

    buscarProductoCot.value = barcode;

    buscarProductoSug.classList.add('hidden');

    mostrarCotizacionesFiltradas();

  });

  function mostrarCotizacionesFiltradas(){

    const data = cacheCotizaciones;

    const cotizaciones = Object.entries(data || {});

    const filtradas = cotizaciones.filter(([c,v])=>{

      const lineas = v?.lineas || [];

      if(!lineas.length) return false;

      if(!filtroBarcodeCot) return true;

      return lineas.some(l =>
        String(l.barcode || '').toUpperCase() === filtroBarcodeCot
      );

    });

    cotizacionesLista.innerHTML = filtradas.map(([c,v])=>{

      const lineas = v?.lineas?.length || 0;

      return `
        <div class="cotizacion-item" data-cot="${c}">
          <span class="cot-num">${c}</span>
          <span class="cot-lineas">(${lineas} líneas)</span>
        </div>
      `;

    }).join('');
  }

  gananciaIndividualInput.addEventListener('input', ()=>{
    recalcularTotales();
    guardarCotizacion();
  });

  gananciaPackInput.addEventListener('input', ()=>{
    recalcularTotales();
    guardarCotizacion();
  });

  body.addEventListener('change', e=>{

    if(e.target.classList.contains('export-check')){
      actualizarEstadoExportacion();
      guardarCotizacion();
    }

    if(e.target.classList.contains('ingresado-check')){
      const tr = e.target.closest('tr');

      actualizarEstadoIngresado(tr);
      guardarCotizacion();
    }

    actualizarChecksHeader();
    recalcularTotales();

  });

  document
  .getElementById('checkAllExport')
  .addEventListener('change', e=>{

    const checked = e.target.checked;

    document.querySelectorAll('.export-check')
    .forEach(c => c.checked = checked);

    actualizarEstadoExportacion();
    recalcularTotales(); // 🔥 clave
    guardarCotizacion();

  });

  async function exportarPedidoExcelInternacional(){

    const filasInvalidas = [];

    document.querySelectorAll('#comprasBody tr').forEach(tr => {

      const check = tr.querySelector('.export-check');
      const ingresado = tr.querySelector('.ingresado-check');

      if(!check || !check.checked) return;
      if(ingresado && ingresado.checked) return;

      const nombre = tr.querySelector('.nombre-valor')?.textContent?.trim();

      if(!nombre){
        filasInvalidas.push(tr);
      }

    });

    filasInvalidas.forEach(tr=>{
      tr.style.background = '#fee2e2';
    });

    if(filasInvalidas.length){
      alert(`⚠️ ${filasInvalidas.length} producto(s) no coinciden con una variante`);

      return; // 🔥 bloquea exportación
    }

    const resContador = await fetch('/api/contador-internacional', {
      method: 'POST'
    });

    const dataContador = await resContador.json();

    const refOrden = 'I' + String(dataContador.numero).padStart(5,'0');

    const now = new Date();

    const fecha =
      String(now.getDate()).padStart(2,'0') + '-' +
      String(now.getMonth()+1).padStart(2,'0') + '-' +
      now.getFullYear() + ' ' +
      String(now.getHours()).padStart(2,'0') + ':' +
      String(now.getMinutes()).padStart(2,'0') + ':' +
      String(now.getSeconds()).padStart(2,'0');

    const rows = [];

    rows.push([
      "Referencia de la orden",
      "Proveedor",
      "Fecha de confirmación",
      "Fecha límite de la orden",
      "Líneas del pedido/Cantidad",
      "Líneas del pedido/Producto",
      "Líneas del pedido/Precio unitario"
    ]);

    const lineas = [];

    document.querySelectorAll('#comprasBody tr').forEach(tr => {

      const check = tr.querySelector('.export-check');
      const ingresado = tr.querySelector('.ingresado-check');

      if(!check || !check.checked) return;
      if(ingresado && ingresado.checked) return;

      const producto = tr.querySelector('.codigo-input')?.value || '';
      const cantidad = tr.querySelector('.cantidad-input')?.value || '';
      const precio = Number(
        tr.querySelector('.precio-odoo .copiable-value')?.textContent || '0'
      );

      if(!producto) return;

      lineas.push({cantidad, producto, precio});

    });

    lineas.forEach((l,i)=>{

      rows.push([
        i === 0 ? refOrden : "",
        i === 0 ? "AliExpress" : "",
        i === 0 ? "" : "",
        i === 0 ? fecha : "",
        l.cantidad,
        l.producto,
        l.precio
      ]);

    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "Pedido");

    XLSX.writeFile(wb, `pedido_${refOrden}.xlsx`);

    const confirmar = confirm('¿Marcar líneas exportadas como ingresadas?');

    if(confirmar){

      document.querySelectorAll('#comprasBody tr').forEach(tr => {

        const checkExport = tr.querySelector('.export-check');
        const checkIngresado = tr.querySelector('.ingresado-check');

        if(!checkExport || !checkIngresado) return;

        if(checkExport.checked){

          checkIngresado.checked = true;

          actualizarEstadoIngresado(tr);
        }

      });

      actualizarEstadoExportacion();
      recalcularTotales();
      guardarCotizacion();
    }

  }

  document
  .getElementById('exportarExcelBtn')
  .addEventListener('click', exportarPedidoExcelInternacional);

  function actualizarEstadoIngresado(tr){

    const ingresado = tr.querySelector('.ingresado-check').checked;
    const exportCheck = tr.querySelector('.export-check');

    if(ingresado){

      tr.classList.add('fila-ingresada');
      
      if(exportCheck){
        exportCheck.checked = false;
        exportCheck.style.display = 'none';
      }

    }else{

      tr.classList.remove('fila-ingresada');
      calcularFila(tr);

      if(exportCheck){
        exportCheck.style.display = '';
      }

    }

    actualizarEstadoExportacion();
  }

  document
  .getElementById('checkAllIngresado')
  .addEventListener('change', e=>{

    const checked = e.target.checked;

    document.querySelectorAll('#comprasBody tr').forEach(tr => {

      const check = tr.querySelector('.ingresado-check');

      if(!check) return;

      check.checked = checked;

      actualizarEstadoIngresado(tr);

    });

    actualizarEstadoExportacion();
    recalcularTotales();
    guardarCotizacion();
  });
});