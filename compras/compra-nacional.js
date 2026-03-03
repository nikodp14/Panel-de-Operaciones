document.addEventListener('DOMContentLoaded', async () => {

    const body = document.getElementById('comprasBody');
    const cotizacionInput = document.getElementById('cotizacionInput');
    const addBtn = document.getElementById('addRowBtn');
    const cargarBtn = document.getElementById('cargarCotBtn');

    const totalCompraFooter = document.getElementById('totalCompraFooter');
    const totalConIvaFooter = document.getElementById('totalConIvaFooter');

    const DESCUENTO = 0.25;
    const IVA = 1.19;

    let variantesCache = [];

    let packSetCache = null;

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

      const res = await fetch('/api/ml/publicaciones/ultimo', { cache: 'no-store' });
      const buf = await res.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });

      const sheetName =
        wb.SheetNames.find(n => n.toLowerCase().includes('publicaciones')) ||
        wb.SheetNames[0];

      const ws = wb.Sheets[sheetName];

      const rows = XLSX.utils.sheet_to_json(ws, {
        defval: '',
        range: 2
      });

      const map = new Map();

      rows.forEach(r => {
        const pub = String(r['Número de publicación'] || '')
          .replace(/^MLC/i, '')
          .trim();

        const comision = Number(
          String(r[Object.keys(r)[13]] || '') // columna N (index 13)
            .replace('%','')
        ) || 0;

        if (pub) {
          map.set(pub, comision);
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
      .map(p => p.replace(/^MLC/i,'').trim())
      .filter(Boolean);

    // Buscar cuál existe en publicaciones ML
    const candidatos = partes.filter(p => comisionMap.has(p));

    if (!candidatos.length) return 0;

    // Quitar los que son pack
    const individuales = candidatos.filter(p => !packSet.has(p));

    const final = individuales.length ? individuales[0] : candidatos[0];

    return comisionMap.get(final) || 0;
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
        barcode: String(r[1] || '').trim(),
        name: String(r[2] || '').trim(),
        variant: String(r[5] || '').trim()
      })).filter(v => v.barcode);
    }
    
    function addRow() {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td style="position: relative;">
        <div class="producto-comprar">
          <input type="text" class="codigo-input" placeholder="Buscar producto..." />

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
        <input type="number" class="precio-input" min="0" value="0" />
      </td>
      <td class="total-compra">0</td>
      <td class="precio-odoo">0</td>
      <td class="total-odoo">0</td>
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

      const precioConDesc = precio * (1 - DESCUENTO);
      const precioSinIva = precioConDesc / IVA;

      const totalOdooLinea = cantidad * precioSinIva;

      tr.querySelector('.total-compra').textContent = totalLinea.toFixed(0);
      tr.querySelector('.precio-odoo').textContent = precioSinIva.toFixed(0);
      tr.querySelector('.total-odoo').textContent = totalOdooLinea.toFixed(0);

      totalCompra += totalLinea;
      totalOdoo += totalOdooLinea;
    });

    totalCompraFooter.textContent = totalCompra.toFixed(0);
    totalConIvaFooter.textContent = (totalOdoo * 1.19).toFixed(0);
  }

  body.addEventListener('input', async (e) => {

    if (e.target.classList.contains('codigo-input')) {

    const input = e.target;
    const tr = input.closest('tr');
    const suggestions = tr.querySelector('.odoo-suggestions');
    const nombreEl = tr.querySelector('.nombre-valor');
    const varianteEl = tr.querySelector('.variante-valor');

    const value = input.value.trim();
    const lowerValue = value.toLowerCase();

    // 🔥 Obtener comisión ML desde barcode
    const comision = await obtenerComisionDesdeBarcode(value);
    tr.querySelector('.porcentaje-comision').textContent = comision + '%';

    // 🔥 Limpiar si no coincide con barcode válido
    if (!variantesCache.some(v => v.barcode === value)) {
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
    const exactMatch = variantesCache.find(v => v.barcode === value);

    if (exactMatch) {
      nombreEl.textContent = exactMatch.name || '';
      varianteEl.textContent = exactMatch.variant || '';
      suggestions.innerHTML = '';
      suggestions.classList.add('hidden');
      return;
    }

      const matches = variantesCache
        .filter(v =>
          v.barcode.toLowerCase().includes(value) ||
          v.name.toLowerCase().includes(value)
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

    if (e.target.classList.contains('cantidad-input') ||
        e.target.classList.contains('precio-input')) {

      recalcularTotales();
    }

    guardarCotizacion();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.odoo-suggestions')
        .forEach(el => el.classList.add('hidden'));
    }
  });

  body.addEventListener('click', (e) => {

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
    nombreEl.textContent = info?.name || '';
    varianteEl.textContent = info?.variant || '';

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

  function guardarCotizacion() {
    const cot = cotizacionInput.value.trim();
    if (!cot) return; // 🔥 Si no hay número, no guardamos

    const lineas = [];

    document.querySelectorAll('#comprasBody tr').forEach(tr => {
      lineas.push({
        barcode: tr.querySelector('.codigo-input')?.value || '',
        nombre: tr.querySelector('.nombre-valor')?.textContent || '',
        variante: tr.querySelector('.variante-valor')?.textContent || '',
        cantidad: tr.querySelector('.cantidad-input')?.value || 0,
        precio: tr.querySelector('.precio-input')?.value || 0,
        costoEnvio: tr.querySelector('.costo-envio-input')?.value || 0
      });
    });

    const data = JSON.parse(localStorage.getItem('comprasCotizaciones') || '{}');
    data[cot] = { lineas };

    localStorage.setItem('comprasCotizaciones', JSON.stringify(data));
  }

  function cargarCotizacion() {
    const cot = cotizacionInput.value.trim();
    if (!cot) return;

    const data = JSON.parse(localStorage.getItem('comprasCotizaciones') || '{}');
    const cotData = data[cot];

    body.innerHTML = '';

    if (!cotData) {
      // 🔥 Si no existe, simplemente dejamos tabla vacía
      addRow(); // permitimos empezar
      return;
    }

    cotData.lineas.forEach(l => {
      addRow();
      const tr = body.lastElementChild;

      tr.querySelector('.codigo-input').value = l.barcode;
      tr.querySelector('.nombre-valor').textContent = l.nombre;
      tr.querySelector('.variante-valor').textContent = l.variante;
      tr.querySelector('.cantidad-input').value = l.cantidad;
      tr.querySelector('.precio-input').value = l.precio;
      tr.querySelector('.costo-envio-input').value = l.costoEnvio || 0;
    });

    recalcularTotales();
  }

  cargarBtn.addEventListener('click', () => {
    cargarCotizacion();
  });
});