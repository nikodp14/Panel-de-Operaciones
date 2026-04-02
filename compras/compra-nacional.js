document.addEventListener('DOMContentLoaded', async () => {

  const body = document.getElementById('comprasBody');
  const cotizacionInput = document.getElementById('cotizacionInput');
  const addBtn = document.getElementById('addRowBtn');
  const cargarBtn = document.getElementById('cargarCotBtn');

  const verCotizacionesBtn = document.getElementById('verCotizacionesBtn');
  const cotizacionesModal = document.getElementById('cotizacionesModal');
  const cotizacionesLista = document.getElementById('cotizacionesLista');
  const cerrarCotizaciones = document.getElementById('cerrarCotizaciones');

  const totalCompraFooter = document.getElementById('totalCompraFooter');
  const totalConIvaFooter = document.getElementById('totalConIvaFooter');

  const buscarProductoCot = document.getElementById('buscarProductoCot');
  const buscarProductoSug = document.getElementById('buscarProductoSug');

  let cacheCotizaciones = {};
  let filtroBusquedaCot = '';

  const DESCUENTO = 0.25;
  const IVA = 1.19;

  let variantesCache = [];
  let packSetCache = null;
  let jumpsellerPriceMapCache = null;
  let inputTimer = null;
  let bloqueado = false;

  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('nuevo-icon')) {

      const tr = e.target.closest('tr');
      const activo = tr.dataset.modoManual === 'true';

      const nuevoEstado = !activo;
      tr.dataset.modoManual = nuevoEstado ? 'true' : 'false';

      const input = tr.querySelector('.codigo-input');
      const nombreEl = tr.querySelector('.nombre-valor');
      const varianteEl = tr.querySelector('.variante-valor');
      const internalEl = tr.querySelector('.internal-valor');

      if (nuevoEstado) {

        nombreEl.textContent = '';
        varianteEl.textContent = '';
        internalEl.textContent = '';

        // 🔥 CLAVE: ejecutar lógica con lo que ya está escrito
        const valor = input.value.trim();

        if (valor) {
          aplicarLogicaCodigo(tr, valor);
        }
      }

      // 🎨 UI
      e.target.style.opacity = nuevoEstado ? '1' : '0.5';
      e.target.style.color = nuevoEstado ? '#0a8f2f' : '';

      // 🔥 DESACTIVAR → ejecutar lógica
      if (!nuevoEstado) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }

      guardarCotizacion();
    }
  });

  function aplicarBloqueo(estado){

    bloqueado = estado;

    const trs = document.querySelectorAll('#comprasBody tr');

    trs.forEach(tr => {

      // 🔥 todos los inputs excepto costo envío
      tr.querySelectorAll('input').forEach(input => {

        if (input.classList.contains('costo-envio-input')) {
          input.disabled = false; // 👈 siempre editable
        } else {
          input.disabled = estado;
        }

      });

      // 🔥 botones (delete, copiar, etc)
      tr.querySelectorAll('button').forEach(btn => {
        btn.disabled = estado;
      });

      // 🔥 iconos (opcional pero recomendable)
      tr.querySelectorAll('.nuevo-icon, .clear-icon').forEach(icon => {
        icon.style.pointerEvents = estado ? 'none' : '';
        icon.style.opacity = estado ? '0.3' : '';
      });

    });

    // 🔥 también bloquear controles superiores
    document.querySelectorAll(
      '#cotizacionInput, #descuentoGlobal, #addRowBtn, #exportarExcelBtn'
    ).forEach(el => {
      if(el) el.disabled = estado;
    });

    // texto botón
    const btn = document.getElementById('toggleLockBtn');
    btn.textContent = estado ? '🔓 Desbloquear' : '🔒 Bloquear';

  }

  document.getElementById('toggleLockBtn').addEventListener('click', () => {

    if (!bloqueado) {
      aplicarBloqueo(true);
      guardarCotizacion(); // 🔒 guardar estado
      return;
    }

    // 🔓 pedir clave para desbloquear
    const clave = prompt('Ingrese clave para desbloquear');

    if (clave === '4744') {
      aplicarBloqueo(false);
      guardarCotizacion(); // 🔓 guardar estado
    } else {
      alert('Clave incorrecta');
    }

  });

  function aplicarLogicaCodigo(tr, valor){

    const input = tr.querySelector('.codigo-input');
    const nombreEl = tr.querySelector('.nombre-valor');
    const varianteEl = tr.querySelector('.variante-valor');
    const internalEl = tr.querySelector('.internal-valor');

    const normalizedValue = String(valor || '').trim().toUpperCase();

    const matchUnico = buscarPorReferenciaInterna(normalizedValue);

    const modoManual = tr.dataset.modoManual === 'true';

    if (matchUnico && !modoManual) {

      // 🔥 setea barcode
      input.value = matchUnico.barcode;

      // 🔥 setea referencia interna visible
      const internal = matchUnico.default_code || '';
      const partes = internal.split('/');
      const codigoInterno = partes.length > 1 ? partes[1] : internal;

      internalEl.textContent = codigoInterno;

      nombreEl.textContent = matchUnico.name || '';
      varianteEl.textContent = matchUnico.variant || '';

    } else {

      // fallback (por si ya es barcode)
      input.value = normalizedValue;

      const info = variantesCache.find(v => v.barcode === normalizedValue);

      nombreEl.textContent = info?.name || '';
      varianteEl.textContent = info?.variant || '';
      internalEl.textContent = '';
    }

    if (matchUnico && modoManual) {

      nombreEl.textContent = '⚠ Producto ya existe';
      varianteEl.textContent = matchUnico.name || '';

      tr.classList.add('fila-warning');

    } else {
      tr.classList.remove('fila-warning');
    }
  }

  function buscarPorReferenciaInterna(valor){

    const v = valor.toUpperCase();

    const matches = variantesCache.filter(item => {

      const internal = item.default_code || '';
      const barcode = item.barcode || '';

      return (
        internal.includes(v) ||
        v.includes(internal) ||
        barcode === v
      );

    });

    if(matches.length === 1){
      return matches[0];
    }

    return null;
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
  
  const jumpsellerPriceMap = await loadJumpsellerPriceMap();

  function pintarAlertaPrecioJumpseller(el, precioActual){

    if(!el) return;

    // evitar duplicados
    el.querySelectorAll('.ml-alerta').forEach(e => e.remove());

    if(precioActual === 0){
      el.innerHTML += `
        <span class="ml-alerta" title="Precio Jumpseller no encontrado" style="margin-left:6px;cursor:help;">
          ⚠️
        </span>
      `;
    }
  }

  function pintarAlertaPrecioML(el, precioActual){

    if(!el) return;

    // evitar duplicados
    el.querySelectorAll('.ml-alerta').forEach(e => e.remove());

    if(precioActual === 0){
      el.innerHTML += `
        <span class="ml-alerta" title="Precio ML no encontrado" style="margin-left:6px;cursor:help;">
          ⚠️
        </span>
      `;
    }

  }

  function pintarComparacionPrecio(el, calculado, actual){

    if (!actual) return;

    if (calculado > actual){
      el.style.color = 'red';
      el.style.fontWeight = '700';
    }
    else if (actual > calculado){
      el.style.color = '#53c607';
      el.style.fontWeight = '700';
    }
    else{
      el.style.color = '';
      el.style.fontWeight = '';
    }
  }
  
  document.addEventListener('click', e => {
    // 🔥 limpiar input
    if (e.target.classList.contains('clear-icon')) {

      const row = e.target.closest('.codigo-row');
      if (!row) return;

      const tr = e.target.closest('tr');

      const input = row.querySelector('.codigo-input');
      const nombreEl = tr.querySelector('.nombre-valor');
      const varianteEl = tr.querySelector('.variante-valor');
      const internalEl = tr.querySelector('.internal-valor');
      const suggestions = tr.querySelector('.odoo-suggestions');

      // 🔥 limpiar todo
      input.value = '';
      nombreEl.textContent = '';
      varianteEl.textContent = '';
      internalEl.textContent = '';

      suggestions.innerHTML = '';
      suggestions.classList.add('hidden');

      // 🔥 limpiar ML también (muy importante)
      tr.querySelector('.porcentaje-comision').textContent = '0%';
      tr.querySelector('.numero-publicacion').innerHTML = '';
      tr.querySelector('.publicacion-jumpseller').innerHTML = '';

      guardarCotizacion();

      input.focus();

      document.querySelectorAll(`tr[data-parent="${tr.dataset.rowid}"]`).forEach(r => r.remove());

      tr.dataset.modoManual = 'false';
      tr.querySelector('.nuevo-icon').style.opacity = '0.5';
      tr.querySelector('.nuevo-icon').style.color = '';
    }

    if (!e.target.classList.contains('copiar-icon')) return;

    let valor = '';

    // 🔥 PRIORIDAD: data-copy
    valor = e.target.dataset.copy || '';

    // 🔹 fallback input (codigo)
    if (!valor) {
      const codigoRow = e.target.closest('.codigo-row');
      if (codigoRow) {
        const input = codigoRow.querySelector('.codigo-input');
        valor = input?.value || '';
      }
    }

    // 🔹 fallback legacy
    if (!valor) {
      const copiableCell = e.target.closest('.copiable-cell');
      if (copiableCell) {
        const el = copiableCell.querySelector('.copiable-value');

        if (el) {
          valor = el.tagName === 'INPUT'
            ? el.value
            : el.textContent;
        }
      }
    }

    copiarAlPortapapeles(valor.trim());

  });

  function formatearPedido(numero) {
    const n = Number(numero) || 0;
    return 'P' + String(n).padStart(5, '0');
  }

  function obtenerFechaActual() {
    const now = new Date();

    const d = String(now.getDate()).padStart(2,'0');
    const m = String(now.getMonth()+1).padStart(2,'0');
    const y = now.getFullYear();

    const h = String(now.getHours()).padStart(2,'0');
    const min = String(now.getMinutes()).padStart(2,'0');
    const s = String(now.getSeconds()).padStart(2,'0');

    return `${d}-${m}-${y} ${h}:${min}:${s}`;
  }

  async function exportarPedidoExcel(){

    const resPedido = await fetch('/api/pedidos/siguiente');
    const dataPedido = await resPedido.json();

    const refOrden = dataPedido.ref;
    const cotizacion = document.getElementById('cotizacionInput').value.trim();

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
      "Líneas del pedido/Precio unitario",
      "Referencia de proveedor"
    ]);

    const lineas = [];

    document.querySelectorAll('#comprasBody tr').forEach(tr => {

      const producto = tr.querySelector('.codigo-input')?.value || '';
      const cantidad = tr.querySelector('.cantidad-input')?.value || '';
      const precio = tr.querySelector('.precio-odoo .copiar-icon')?.dataset.copy || '0'

      if(!producto) return;

      lineas.push({cantidad, producto, precio});

    });

    lineas.forEach((l,i)=>{

      rows.push([
        i === 0 ? refOrden : "",
        i === 0 ? "Yamaimport S.A." : "",
        i === 0 ? "" : "",
        i === 0 ? fecha : "",
        l.cantidad,
        l.producto,
        l.precio,
        i === 0 ? cotizacion : ""
      ]);

    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "Pedido");

    XLSX.writeFile(wb, `pedido_${refOrden}.xlsx`);
  }

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

  function renderCopiable(valor, isLink = false, isPrice = false, isLinkMl = true) {

    const link = isLink && isLinkMl
      ? `https://articulo.mercadolibre.cl/MLC-${valor}`
      : isLink && !isLinkMl
        ? `https://demoto.jumpseller.com/admin/cl/products/?name=${valor}`
        : null;

    return `
      <div class="copiable-cell">
        ${
          isLink
            ? `<a href="${link}" target="_blank" class="copiable-link">${valor}</a>`
            : `<span>${isPrice ? '$' + Math.round(valor).toLocaleString('es-CL') : valor}</span>`
        }

        <!-- 🔥 botón copiar separado -->
        <span class="copiar-icon" data-copy="${valor}">📋</span>
      </div>
    `;
  }

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
      const keys = Object.values(r);
      keys.forEach(v => {
        if (v) {
          set.add(String(v).replace(/^MLC/i, '').trim());
        }
      });
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
          estado
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

    //console.log(comisionMap);
    //console.log(candidatos);

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
      default_code: String(r[0] || '').trim().toUpperCase(),
      name: String(r[2] || '').trim(),
      variant: String(r[5] || '').trim()
    })).filter(v => v.barcode || v.default_code);
  }
  
  function addRow() {
    const tr = document.createElement('tr');
    const descuentoGlobal = document.getElementById('descuentoGlobal').value || 30;

    tr.innerHTML = `
        <td style="display:none;">
          <input type="checkbox" class="export-check">
        </td>

        <td style="display:none;">
          <input type="checkbox" class="ingresado-check">
        </td>
      <td style="position: relative;">
        <div class="producto-comprar">
          <div class="codigo-row">
            <input type="text" class="codigo-input copiable-value" placeholder="Buscar producto..." />
            <span class="copiar-icon">📋</span>
            <span class="clear-icon">🧼</span>
            <span class="nuevo-icon" title="Nuevo producto">➕</span>
          </div>
          <div class="linea-internal">
            <span class="internal-valor"></span>
          </div>
          <div class="producto-info">
            <div class="linea-nombre">
              <span class="nombre-valor"></span>
            </div>
            <div class="linea-variante">
              <span class="variante-valor"></span>
            </div>
          </div>
        </div>

        <div class="odoo-suggestions hidden"></div>
      </td>
      <td>
        <input type="number" class="cantidad-input" min="0" value="0" />
      </td>
      <td>
        <input type="number" class="precio-neto-input" min="0" value="0" />
      </td>
      <td>
        <input type="number" class="precio-input" min="0" value="0" />
      </td>
      <td class="total-compra">0</td>
      <td class="col-descuento">
        <input type="number" class="descuento-input" value="${descuentoGlobal}" min="0" max="100" style="width:60px;">
      </td>
      <td class="precio-odoo">0</td>
      <td class="total-odoo">0</td>
      <td class="estado-publicacion"></td>
      <td class="publicacion-jumpseller"></td>
      <td class="ml-col precio-jumpseller">0</td>
      <td class="ml-col numero-publicacion"></td>
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
  }

  function recalcularTotales() {

    let totalCompra = 0;
    let totalOdoo = 0;

    document.querySelectorAll('#comprasBody tr').forEach(tr => {

      const cantidad = Number(tr.querySelector('.cantidad-input').value) || 0;
      const precio = Number(tr.querySelector('.precio-input').value) || 0;

      const totalLinea = cantidad * precio;

      const precioJumpseller = precio;

      const descInput = tr.querySelector('.descuento-input');
      const descuento = (Number(descInput?.value) || 0) / 100;

      const precioConDesc = precio * (1 - descuento);
      const precioSinIva = precioConDesc / IVA;

      const totalOdooLinea = cantidad * precioSinIva;

      tr.querySelector('.total-compra').textContent = '$ ' + Math.round(totalLinea.toFixed(0)).toLocaleString('es-CL');
      tr.querySelector('.precio-odoo').innerHTML = renderCopiable(precioSinIva.toFixed(0), false, true);
      tr.querySelector('.total-odoo').textContent = '$ ' + Math.round(totalOdooLinea.toFixed(0)).toLocaleString('es-CL');
      const numeroPub =
        tr.querySelector('.numero-publicacion .copiar-icon')?.dataset.copy
        ?.trim()
        ?.toUpperCase() || '';

      //console.log(numeroPub);

      const precioActualJumpseller = jumpsellerPriceMap?.get(numeroPub) || 0;

      const elJumpseller = tr.querySelector('.precio-jumpseller');

      elJumpseller.innerHTML = renderCopiable(precioJumpseller.toFixed(0), false, true);

      pintarComparacionPrecio(elJumpseller, precioJumpseller, precioActualJumpseller);
      pintarAlertaPrecioJumpseller(elJumpseller, precioActualJumpseller);

      totalCompra += totalLinea;
      totalOdoo += totalOdooLinea;

      const porcentajeTexto = tr.querySelector('.porcentaje-comision').textContent;
      const comision = Number(porcentajeTexto.replace('%','')) || 0;
      const envio = Number(
          (tr.querySelector('.costo-envio-input')?.value || '').replace(/\./g,'')
        ) || 0;

      const precioML = calcularPrecioML(precioSinIva, comision, envio);
      const dataMap = comisionMapCache?.get(numeroPub);

      const estado = dataMap?.estado || '';
      const estadoEl = tr.querySelector('.estado-publicacion');

      estadoEl.textContent = estado;

      if (estado.toLowerCase().includes('inactiva')) {
        estadoEl.style.color = 'red';
        estadoEl.style.fontWeight = '700';
      } else {
        estadoEl.style.color = '';
        estadoEl.style.fontWeight = '';
      }

      const precioActualML = dataMap?.precio || 0;

      const precioMLEl = tr.querySelector('.precio-ml');

      if (envio <= 0 || comision <= 0){
        precioMLEl.innerHTML =
          '<span style="color:#999;font-style:italic;">Complete costos ML</span>';

      } else {
        precioMLEl.innerHTML =
          renderCopiable(precioML.toFixed(0), false, true);

      }

      if (precioActualML) {

        if (precioML > precioActualML) {
          // 🔴 estamos más caros que ML
          precioMLEl.style.color = 'red';
          precioMLEl.style.fontWeight = '700';

        } else if (precioActualML > precioML) {
          // 🟢 ML está más caro que nuestro cálculo
          precioMLEl.style.color = '#88ef43';
          precioMLEl.style.fontWeight = '700';

        } else {
          // normal
          precioMLEl.style.color = '';
          precioMLEl.style.fontWeight = '';
        }
      }

      pintarAlertaPrecioML(precioMLEl, precioActualML);
    });

    totalCompraFooter.textContent = '$ ' + Math.round(totalCompra.toFixed(0)).toLocaleString('es-CL');
    totalConIvaFooter.textContent = '$ ' + Math.round((totalOdoo * 1.19).toFixed(0)).toLocaleString('es-CL');
  }

  body.addEventListener('input', async (e) => {
    if (e.target.classList.contains('descuento-input')){
      recalcularTotales();
      guardarCotizacion();
    }

    if (e.target.classList.contains('codigo-input')) {

      clearTimeout(inputTimer);

      inputTimer = setTimeout(async () => {
        const input = e.target;
        const tr = input.closest('tr');
        const suggestions = tr.querySelector('.odoo-suggestions');
        const nombreEl = tr.querySelector('.nombre-valor');
        const varianteEl = tr.querySelector('.variante-valor');

        const rawValue = input.value.trim();
        const normalizedValue = rawValue.toUpperCase();
        const lowerValue = rawValue.toLowerCase();
        const internalEl = tr.querySelector('.internal-valor');

        // 🔥 Obtener comisión ML desde barcode
        const resultado = await obtenerComisionDesdeBarcode(normalizedValue);
        tr.querySelector('.porcentaje-comision').textContent = resultado.comision + '%';
        tr.querySelector('.numero-publicacion').innerHTML = renderCopiable(resultado.publicacion, true);
        tr.querySelector('.publicacion-jumpseller').innerHTML = renderCopiable(resultado.publicacion, true, false);
        guardarCotizacion();

        // 🔥 Limpiar si no coincide con barcode válido
        if (!variantesCache.some(v => v.barcode === normalizedValue)){
          nombreEl.textContent = '';
          varianteEl.textContent = '';
        }

        await loadVariantes();

        const matchUnico = buscarPorReferenciaInterna(normalizedValue);

        const modoManual = tr.dataset.modoManual === 'true';

        if (matchUnico && !modoManual) {

          // 🔥 poner barcode en input
          input.value = matchUnico.barcode;

          // 🔥 mostrar referencia interna (parte después del /)
          const internal = matchUnico.default_code || '';
          const partes = internal.split('/');
          const codigoInterno = partes.length > 1 ? partes[1] : internal;

          internalEl.textContent = codigoInterno;

          nombreEl.textContent = matchUnico.name || '';
          varianteEl.textContent = matchUnico.variant || '';

          suggestions.innerHTML = '';
          suggestions.classList.add('hidden');

          guardarCotizacion();

          return;
        }

        if (!matchUnico) {
          internalEl.textContent = '';
        }

        if (lowerValue.length < 3) {
          suggestions.innerHTML = '';
          suggestions.classList.add('hidden');
          return;
        }

        await loadVariantes();

        // 🔥 Autocompletar automático si coincide exactamente
        const exactMatch = variantesCache.find(v =>
          v.barcode === normalizedValue ||
          v.default_code === normalizedValue
        );

        if (exactMatch) {
          nombreEl.textContent = exactMatch.name || '';
          varianteEl.textContent = exactMatch.variant || '';
          suggestions.innerHTML = '';
          suggestions.classList.add('hidden');
          return;
        }

        const matches = variantesCache
          .filter(v => {

            const barcode = v.barcode || '';
            const internal = v.default_code || '';

            return (
              barcode.includes(normalizedValue) ||
              internal.includes(normalizedValue) ||
              v.name.toLowerCase().includes(lowerValue)
            );
          })
          .slice(0, 500);

        if (!matches.length) {
          suggestions.innerHTML = '';
          suggestions.classList.add('hidden');
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
      }, 80);
    }

    // 🔵 NETO → CON IVA
    if (e.target.classList.contains('precio-neto-input')) {

      const tr = e.target.closest('tr');

      const neto = Number(e.target.value) || 0;
      const conIva = neto * IVA;

      const precioInput = tr.querySelector('.precio-input');

      // evitar loop infinito
      if (document.activeElement === e.target) {
        precioInput.value = Math.round(conIva);
      }

      recalcularTotales();
      guardarCotizacion();
    }


    // 🔵 CON IVA → NETO
    if (e.target.classList.contains('precio-input')) {

      const tr = e.target.closest('tr');

      const conIva = Number(e.target.value) || 0;
      const neto = conIva / IVA;

      const netoInput = tr.querySelector('.precio-neto-input');

      // evitar loop infinito
      if (document.activeElement === e.target) {
        netoInput.value = Math.round(neto);
      }

      recalcularTotales();
      guardarCotizacion();
    }

    if (e.target.classList.contains('cantidad-input') ||
        e.target.classList.contains('precio-input') ||
        e.target.classList.contains('costo-envio-input')){

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

    tr.querySelector('.porcentaje-comision').textContent = resultado.comision + '%';
    tr.querySelector('.numero-publicacion').innerHTML = renderCopiable(resultado.publicacion, true);
    tr.querySelector('.publicacion-jumpseller').innerHTML = renderCopiable(resultado.publicacion, true, false);
    nombreEl.textContent = info?.name || '';
    varianteEl.textContent = info?.variant || '';

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
    const cot = document.getElementById('cotizacionInput').value.trim();
    if (!cot) {
      alert('Debe ingresar N° de cotización');
      return;
    }
    addRow();
  });

  async function guardarCotizacion() {

    const cot = cotizacionInput.value.trim();
    if (!cot) return;

    const lineas = [];

    document.querySelectorAll('#comprasBody tr').forEach(tr => {
      lineas.push({
        barcode: tr.querySelector('.codigo-input')?.value || '',
        nombre: tr.querySelector('.nombre-valor')?.textContent || '',
        variante: tr.querySelector('.variante-valor')?.textContent || '',
        cantidad: tr.querySelector('.cantidad-input')?.value || 0,
        precio: tr.querySelector('.precio-input')?.value || 0,
        precioNeto: tr.querySelector('.precio-neto-input')?.value || 0,
        descuento: tr.querySelector('.descuento-input')?.value || 25,
        costoEnvio: tr.querySelector('.costo-envio-input')?.value || 0,
        modoManual: tr.dataset.modoManual === 'true'
      });
    });

    const descuentoGlobal =
      document.getElementById('descuentoGlobal')?.value || 30;

    await fetch(`/api/cotizaciones-nacional/${cot}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descuentoGlobal,
        bloqueado,
        lineas
      })
    });
  }

  async function cargarCotizacion() {

    const cot = cotizacionInput.value.trim();
    if (!cot) return;

    const res = await fetch(`/api/cotizaciones-nacional/${cot}`);
    const cotData = await res.json();
    const estabaBloqueado = !!cotData?.bloqueado;

    body.innerHTML = '';

    const descuentoInput = document.getElementById('descuentoGlobal');

    if (!cotData || !cotData.lineas || !cotData.lineas.length) {

      descuentoInput.value = 30;

      addRow();
      aplicarBloqueo(estabaBloqueado);

      return;
    }

    // 🔥 si existe → usar el guardado
    if (cotData.descuentoGlobal !== undefined) {
      descuentoInput.value = cotData.descuentoGlobal;
    }

    await loadVariantes();

    await Promise.all(
      cotData.lineas.map(async (l) => {

        addRow();
        const tr = body.lastElementChild;

        tr.dataset.modoManual = l.modoManual ? 'true' : 'false';

        const nuevoIcon = tr.querySelector('.nuevo-icon');

        if (l.modoManual) {
          nuevoIcon.style.opacity = '1';
          nuevoIcon.style.color = '#0a8f2f';
        } else {
          nuevoIcon.style.opacity = '0.5';
          nuevoIcon.style.color = '';
        }

        const barcode = l.barcode || '';

        aplicarLogicaCodigo(tr, barcode);

        const resultado = await obtenerComisionDesdeBarcode(barcode);

        tr.querySelector('.porcentaje-comision').textContent = resultado.comision + '%';
        tr.querySelector('.numero-publicacion').innerHTML = renderCopiable(resultado.publicacion, true);
        tr.querySelector('.publicacion-jumpseller').innerHTML = renderCopiable(resultado.publicacion, true, false, false);

        tr.querySelector('.cantidad-input').value = l.cantidad;
        tr.querySelector('.precio-input').value = l.precio;
        tr.querySelector('.precio-neto-input').value = l.precioNeto || 0;
        tr.querySelector('.descuento-input').value = l.descuento ?? 25;
        tr.querySelector('.costo-envio-input').value = l.costoEnvio || 0;

      })
    );

    recalcularTotales();
    aplicarBloqueo(estabaBloqueado);
    guardarCotizacion();
  }

  cargarBtn.addEventListener('click', async () => {
    await cargarCotizacion();
  });

  function calcularPrecioML(precioOdoo, comisionPercent, envio) {

    const comision = comisionPercent / 100;

    if (comision >= 1) return 0;

    const brutoNecesario = (((precioOdoo * 1.25)) * 1.19 + envio) / (1 - comision);

    //console.log(comision);

    // 🔵 redondear a 990
    const redondeado = Math.floor(brutoNecesario / 1000) * 1000 + 990;

    return redondeado;
  }

  document
    .getElementById('exportarExcelBtn')
    .addEventListener('click', exportarPedidoExcel);

    new Sortable(body, {
      animation: 150,
      ghostClass: 'dragging-row',

      filter: "input, textarea, select, button",
        preventOnFilter: false,

      onEnd: () => {
        recalcularTotales();
        guardarCotizacion();
      }
  });

  async function cargarListaCotizaciones(){

    const res = await fetch('/api/cotizaciones-nacional');
    const data = await res.json();

    cacheCotizaciones = data || {};

    const cotizaciones = Object.entries(cacheCotizaciones);

    const filtradas = cotizaciones.filter(([c,v]) => {
      return (v?.lineas?.length || 0) > 0;
    });

    // 🔥 ORDEN DESCENDENTE POR NÚMERO
    filtradas.sort((a,b)=> {
      const na = parseInt(a[0], 10);
      const nb = parseInt(b[0], 10);

      if (!isNaN(na) && !isNaN(nb)){
        return nb - na; // 🔥 descendente real
      }

      // fallback si algo no es número
      return String(b[0]).localeCompare(String(a[0]));
    });

    cotizacionesLista.innerHTML = filtradas.map(([c,v]) => `
      <div class="cotizacion-item" data-cot="${c}">
        <span class="cot-num">Cotización ${c}</span>
        <span class="cot-lineas">(${v?.lineas?.length || 0} líneas)</span>
      </div>
    `).join('');
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

    cotizacionInput.value = cot;

    cotizacionesModal.classList.add('hidden');

    await cargarCotizacion();

  });

  document.getElementById('descuentoGlobal').addEventListener('input', e => {

    const val = Number(e.target.value) || 0;

    document.querySelectorAll('.descuento-input').forEach(inp=>{
      inp.value = val;
    });

    recalcularTotales();
    guardarCotizacion();

  });

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

      if(exportCheck){
        exportCheck.style.display = '';
      }

    }

    actualizarEstadoExportacion();
  }

  body.addEventListener('change', (e) => {

    if (e.target.classList.contains('ingresado-check')) {

      const tr = e.target.closest('tr');

      actualizarEstadoIngresado(tr);

    }

  });

  buscarProductoCot.addEventListener('input', () => {

    const valor = buscarProductoCot.value.trim().toUpperCase();

    if (!valor){
      buscarProductoSug.classList.add('hidden');
      buscarProductoSug.innerHTML = '';
      return;
    }

    const resultados = [];

    Object.entries(cacheCotizaciones).forEach(([cot, data]) => {

      (data.lineas || []).forEach(linea => {

        const barcode = String(linea.barcode || '').toUpperCase();
        const internal = String(linea.internal || '').toUpperCase();

        if (
          barcode.includes(valor) ||
          internal.includes(valor)
        ){
          resultados.push({
            cotizacion: cot,
            linea
          });
        }

      });

    });

    if (!resultados.length){
      buscarProductoSug.classList.add('hidden');
      buscarProductoSug.innerHTML = '';
      return;
    }

    buscarProductoSug.innerHTML = resultados.slice(0,20).map(r => `
      <div class="suggestion-item" data-cot="${r.cotizacion}">
        <div><strong>Cot ${r.cotizacion}</strong></div>
        <div>${r.linea.internal || ''}</div>
        <div style="font-size:12px;color:#666;">
          ${r.linea.barcode || ''}
        </div>
      </div>
    `).join('');

    buscarProductoSug.classList.remove('hidden');

  });

  buscarProductoSug.addEventListener('click', async (e) => {

    const item = e.target.closest('.suggestion-item');
    if (!item) return;

    const cot = item.dataset.cot;

    cotizacionInput.value = cot;

    buscarProductoSug.classList.add('hidden');

    await cargarCotizacion();

  });
});