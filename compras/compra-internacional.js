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

    const fechaPedidoInput = document.getElementById('fechaPedido');
    const dolarLabel = document.getElementById('dolarCalculado');
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

    function renderCopiable(valor) {
      return `
        <div class="copiable-cell">
          <span class="copiable-value">${valor}</span>
          <span class="copiar-icon">📋</span>
        </div>
      `;
    }

    async function obtenerDolar(fecha) {

      try {

        const year = new Date(fecha).getFullYear();
        const res = await fetch(`https://mindicador.cl/api/dolar/${year}`);
        const data = await res.json();

        const serie = data.serie;

        const fechaBuscada = new Date(fecha);
        const fechaISO = fechaBuscada.toISOString().slice(0,10);

        // buscar valor exacto
        let registro = serie.find(d =>
          d.fecha.slice(0,10) === fechaISO
        );

        let esArrastrado = false;

        // si no existe (fin de semana) buscar último anterior
        if (!registro) {

          registro = serie.find(d =>
            new Date(d.fecha) <= fechaBuscada
          );

          esArrastrado = true;
        }

        if (!registro) {
          dolarLabel.textContent = 'No disponible';
          return;
        }

        const dolar = registro.valor;
        const dolarMas30 = dolar + 30;

        if (esArrastrado) {
          dolarLabel.textContent = `${dolarMas30.toFixed(2)} (último hábil)`;
        } else {
          dolarLabel.textContent = dolarMas30.toFixed(2);
        }

      } catch(err) {

        console.error(err);
        dolarLabel.textContent = 'Error';

      }

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
        name: String(r[2] || '').trim(),
        variant: String(r[5] || '').trim()
      })).filter(v => v.barcode);
    }
    
    function addRow() {
    const tr = document.createElement('tr');
    tr.dataset.rowid = crypto.randomUUID();

    tr.innerHTML = `
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
      <td class="ml-col numero-publicacion"></td>
      <td class="ml-col estado-publicacion"></td>
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
  }

  function recalcularTotales() {

    let totalCompra = 0;
    let totalOdoo = 0;

    document.querySelectorAll('#comprasBody tr:not(.sub-publicacion)').forEach(tr => {

      const cantidad = Number(tr.querySelector('.cantidad-input').value) || 0;
      const totalLinea = Number(tr.querySelector('.total-input').value) || 0;

      let precio = 0;
      if (cantidad > 0) {
        precio = totalLinea / cantidad;
      }

      const dolarCompra = Number(dolarLabel.textContent) || 0;

      // convertir USD → CLP
      const precioOdoo = precio * dolarCompra;
      // redondear al 990 hacia arriba
      const precioJumpsellerBase = precioOdoo * 1.8 * 1.19;
      const precioJumpseller =
        Math.ceil((precioJumpsellerBase - 990) / 1000) * 1000 + 990;
      const totalOdooLinea = cantidad * precioOdoo;

      tr.querySelector('.precio-usd').textContent = precio.toFixed(2);
      tr.querySelector('.precio-odoo').innerHTML = renderCopiable(precioOdoo.toFixed(0));      
      tr.querySelector('.total-odoo').textContent = totalOdooLinea.toFixed(0);
      tr.querySelector('.precio-jumpseller').innerHTML = renderCopiable(precioJumpseller.toFixed(0));

      totalCompra += totalLinea;
      totalOdoo += totalOdooLinea;

      const porcentajeTexto = tr.querySelector('.porcentaje-comision').textContent;
      const comision = Number(porcentajeTexto.replace('%','')) || 0;
      const envio = Number(tr.querySelector('.costo-envio-input')?.value) || 0;

      const precioML = calcularPrecioML(precioOdoo, comision, envio);

      const numeroPub =
        tr.querySelector('.numero-publicacion .copiable-value')?.textContent
        ?.trim()
        ?.toUpperCase() || '';
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

      precioMLEl.innerHTML = renderCopiable(precioML.toFixed(0));

      if (precioActualML && precioML > precioActualML) {
        precioMLEl.style.color = 'red';
        precioMLEl.style.fontWeight = '700';
      } else {
        precioMLEl.style.color = '';
        precioMLEl.style.fontWeight = '';
      }

      //console.log(precioActualML, precioML);
      // 🔥 Comparación
    });

    document.querySelectorAll('#comprasBody tr.sub-publicacion').forEach(tr => {

      const parent = document.querySelector(
        `tr[data-rowid="${tr.dataset.parent}"]`
      );

      if (!parent) return;

      const precioOdoo = Number(
        parent.querySelector('.precio-odoo .copiable-value')?.textContent || 0
      );

      const porcentajeTexto = tr.querySelector('.porcentaje-comision').textContent;
      const comision = Number(porcentajeTexto.replace('%','')) || 0;

      const envio = Number(tr.querySelector('.costo-envio-input')?.value) || 0;

      const precioML = calcularPrecioML(precioOdoo, comision, envio);

      const precioMLEl = tr.querySelector('.precio-ml');

      precioMLEl.innerHTML = renderCopiable(precioML.toFixed(0));

      const numeroPub =
        tr.querySelector('.numero-publicacion .copiable-value')?.textContent
        ?.trim()
        ?.toUpperCase() || '';

      const dataMap = comisionMapCache?.get(numeroPub);

      const precioActualML = dataMap?.precio || 0;

      if (precioActualML) {

        if (precioML > precioActualML) {
          precioMLEl.style.color = 'red';
          precioMLEl.style.fontWeight = '700';

        } else if (precioActualML > precioML) {
          precioMLEl.style.color = '#0a8f2f';
          precioMLEl.style.fontWeight = '700';

        } else {
          precioMLEl.style.color = '';
          precioMLEl.style.fontWeight = '';
        }
      }

    });

    totalConIvaFooter.textContent = (totalOdoo).toFixed(0);//(totalOdoo * 1.19).toFixed(0);
  }

  async function procesarPublicaciones(tr, barcodeRaw){

    const resultado = await obtenerComisionDesdeBarcode(barcodeRaw);

    const publicaciones = String(barcodeRaw || '')
      .split('/')
      .map(p => p.replace(/^MLC/i,'').split('-')[0].trim().toUpperCase())
      .filter(Boolean);

    const comisionMap = await loadComisionMap();

    const publicacionesValidas = publicaciones.filter(p => comisionMap.has(p));

    // eliminar sublíneas existentes
    document.querySelectorAll(`tr[data-parent="${tr.dataset.rowid}"]`)
      .forEach(r => r.remove());

    const filaPrincipal = tr;

    if(publicacionesValidas.length > 1){

      let insertAfter = filaPrincipal;

      publicacionesValidas.slice(1).forEach(pub => {

        const sub = document.createElement('tr');
        sub.classList.add('sub-publicacion');
        sub.dataset.parent = filaPrincipal.dataset.rowid;

        const data = comisionMap.get(pub);

        sub.innerHTML = `
          <td class="subproducto">
            ↳ publicación adicional
            <div class="subtitulo">${data?.titulo || ''}</div>
          </td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>

          <td class="ml-col numero-publicacion">
            ${renderCopiable(pub)}
          </td>

          <td class="ml-col estado-publicacion">
            ${data?.estado || ''}
          </td>

          <td class="ml-col precio-jumpseller"></td>

          <td class="ml-col">
            <input type="number" class="costo-envio-input" min="0" value="0">
          </td>

          <td class="ml-col porcentaje-comision">
            ${data?.comision || 0}%
          </td>

          <td class="ml-col precio-ml"></td>

          <td></td>
        `;

        insertAfter.parentNode.insertBefore(sub, insertAfter.nextSibling);
        insertAfter = sub;

      });
    }

    filaPrincipal.querySelector('.porcentaje-comision').textContent =
      resultado.comision + '%';

    const pub = (resultado.publicacion || '').toUpperCase().trim();

    filaPrincipal.querySelector('.numero-publicacion').innerHTML =
      renderCopiable(pub);
  }

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
      await procesarPublicaciones(tr, normalizedValue);

      guardarCotizacion();

      // 🔥 Limpiar si no coincide con barcode válido
      if (!variantesCache.some(v => v.barcode === normalizedValue)){
        nombreEl.textContent = '';
        varianteEl.textContent = '';
      }

      if (lowerValue.length < 3) {
        suggestions.innerHTML = '';
        suggestions.classList.add('hidden');
        return;
      }

      await loadVariantes();

      // 🔥 Autocompletar automático si coincide exactamente
      const exactMatch = variantesCache.find(v => v.barcode === normalizedValue);

      if (exactMatch) {
        nombreEl.textContent = exactMatch.name || '';
        varianteEl.textContent = exactMatch.variant || '';
        suggestions.innerHTML = '';
        suggestions.classList.add('hidden');
        return;
      }

      const matches = variantesCache
        .filter(v =>
          v.barcode.includes(normalizedValue) ||
          v.name.toLowerCase().includes(lowerValue)
        )
        .slice(0, 500);

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
    }

    if (
      e.target.classList.contains('cantidad-input') ||
      e.target.classList.contains('total-input') ||
      e.target.classList.contains('costo-envio-input') ||
      e.target.classList.contains('costo-envio-input-sub')
    ){
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

      const subEnvios = [...document.querySelectorAll(`tr[data-parent="${rowid}"]`)]
        .map(r => r.querySelector('.costo-envio-input')?.value || 0);

      lineas.push({
        barcode: tr.querySelector('.codigo-input')?.value || '',
        nombre: tr.querySelector('.nombre-valor')?.textContent || '',
        variante: tr.querySelector('.variante-valor')?.textContent || '',
        cantidad: tr.querySelector('.cantidad-input')?.value || 0,
        total: tr.querySelector('.total-input')?.value || 0,
        costoEnvio: tr.querySelector('.costo-envio-input')?.value || 0,
        subEnvios
      });

    });

    await fetch(`/api/cotizaciones-internacional/${cot}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha: fechaPedidoInput.value || '',
        lineas
      })
    });

  }

  async function cargarCotizacion() {
    const cot = obtenerClaveCotizacion();
    if (!cot) return;

    const res = await fetch(`/api/cotizaciones-internacional/${cot}`);
    const cotData = await res.json();

    if (cotData?.fecha) {
      fechaPedidoInput.value = cotData.fecha;
      obtenerDolar(cotData.fecha);
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
        tr.querySelector('.nombre-valor').textContent = l.nombre;
        tr.querySelector('.variante-valor').textContent = l.variante;

        await procesarPublicaciones(tr, barcode);

        if (l.subEnvios?.length) {

          const subs = document.querySelectorAll(
            `tr[data-parent="${tr.dataset.rowid}"]`
          );

          subs.forEach((sub,i)=>{
            const val = l.subEnvios[i];
            if (val !== undefined) {
              sub.querySelector('.costo-envio-input').value = val;
            }
          });

        }

        tr.querySelector('.cantidad-input').value = l.cantidad;
        tr.querySelector('.total-input').value = l.total;
        tr.querySelector('.costo-envio-input').value = l.costoEnvio || 0;
      })
    );

    recalcularTotales();
    guardarCotizacion();
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

  function calcularPrecioML(precioOdoo, comisionPercent, envio) {

    const comision = comisionPercent / 100;

    if (comision >= 1) return 0;

    const brutoNecesario = (((precioOdoo * 1.8)) * 1.19 + envio) / (1 - comision);

    //console.log(comision);

    // 🔵 redondear a 990
    const redondeado = Math.floor(brutoNecesario / 1000) * 1000 + 990;

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
});