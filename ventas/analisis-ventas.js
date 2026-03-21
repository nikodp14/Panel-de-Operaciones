let variantesCache = [];
const FECHA_MIN = new Date('2024-01-01');
const EXCLUIR_PRODUCTOS = [
  'envío santiago',
  'envío regiones'
];
let publicacionesMap = new Map();

async function loadPublicacionesML(){

  if (publicacionesMap.size) return;

  const res = await fetch('/api/ml/publicaciones/ultimo', { cache:'no-store' });
  const buf = await res.arrayBuffer();

  const wb = XLSX.read(buf, { type: 'array' });

  const sheetName =
    wb.SheetNames.find(n => n.toLowerCase().includes('publicaciones')) ||
    wb.SheetNames[0];

  const ws = wb.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(ws, {
    defval: '',
    range: 2 // 🔥 CLAVE (igual que validar-ml)
  });

  rows.forEach(r => {

    const pub = String(r['Número de publicación'] || '')
      .replace('MLC','')
      .replace(/\D/g,'')
      .trim();

    const title = String(r['Título'] || '').trim();

    if (pub && title && !publicacionesMap.has(pub)) {
      publicacionesMap.set(pub, title);
    }

  });
}

function obtenerPublicacionesDesdeBarcode(barcodeRaw){

  return String(barcodeRaw || '')
    .split('/')
    .map(p =>
      p
        .replace(/^MLC/i,'')
        .split('-')[0]
        .trim()
        .toUpperCase()
    )
    .filter(p => /^\d+$/.test(p)); // 🔥 SOLO números
}

function renderCopiable(texto){

  return `
    <span class="copiable" data-copy="${texto}">
      ${texto}
      <span class="copy-icon">📋</span>
    </span>
  `;
}

function parseFecha(fechaRaw){

  if (!fechaRaw) return null;

  // 🔥 CASO 1: Excel serial number
  if (!isNaN(fechaRaw)) {

    const excelDate = Number(fechaRaw);

    // Excel base: 1899-12-30
    const fecha = new Date((excelDate - 25569) * 86400 * 1000);

    return fecha;
  }

  let fechaStr = String(fechaRaw).trim();

  // 🔥 CASO 2: formato Odoo con espacio
  if (fechaStr.includes(' ')) {
    fechaStr = fechaStr.replace(' ', 'T');
  }

  const date = new Date(fechaStr);

  if (isNaN(date.getTime())) return null;

  return date;
}

// 🔹 Cargar productos Odoo (igual que ya usas)
async function loadVariantes() {
  if (variantesCache.length) return;

  const res = await fetch('/api/odoo/variantes/ultimo');
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

// 🔹 Normalizar variante (usa MISMA lógica que validar ventas)
function normalizarVariante(v) {
  return String(v || '')
    .toLowerCase()
    .replace('fibra de carbono', 'fibra carbono')
    .trim();
}

function formatearMes(mesStr){
  // mesStr: "2024-03"
  const [year, month] = mesStr.split('-');
  return `${month}-${year}`;
}

// 🔹 Calcular mejor periodo
function calcularMejorPeriodo(ventasPorMes){

  const mesesOrdenados = Object.keys(ventasPorMes).sort();

  if (!mesesOrdenados.length) {
    return { ventas: 0, meses: 1, label: '' };
  }

  let mejor = {
    ventas: 0,
    meses: 1,
    label: ''
  };

  // 🔹 evaluar 1 mes
  mesesOrdenados.forEach(m => {
    const v = ventasPorMes[m];

    if (v > mejor.ventas) {
      mejor = {
        ventas: v,
        meses: 1,
        label: formatearMes(m)
      };
    }
  });

  // 🔹 si el mejor es 1 → evaluar ventanas de 2 meses
  if (mejor.ventas === 1) {

    for (let i = 0; i < mesesOrdenados.length - 1; i++) {

      const m1 = mesesOrdenados[i];
      const m2 = mesesOrdenados[i+1];

      const suma =
        (ventasPorMes[m1] || 0) +
        (ventasPorMes[m2] || 0);

      if (suma > mejor.ventas) {
        mejor = {
          ventas: suma,
          meses: 2,
          label: `${formatearMes(m1)} a ${formatearMes(m2)}`
        };
      }
    }
  }

  return mejor;
}

// 🔹 Procesar archivo ventas
async function procesarBuffer(buf){

  await Promise.all([
    loadVariantes(),
    loadPublicacionesML()
  ]);

  const productosMap = new Map();

  variantesCache.forEach(v => {
    productosMap.set(v.barcode, v);
  });

  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const grupos = new Map();
  let ultimaFechaValida = null;

  rows.forEach(r => {
    console.log(r);
    const barcode = String(r['Líneas de la orden/Producto/Código de barras'] || '')
      .trim().toUpperCase();

    const cantidad = Number(r['Líneas de la orden/Cantidad de entrega'] || 0);
    
    // 🔥 ignorar líneas sin venta real
    if (cantidad <= 0) return;

    let fechaRaw = String(r['Fecha de creación'] || '').trim();

    const nombreProducto = String(r['Líneas de la orden/Producto'] || '')
      .toLowerCase()
      .trim();

    // 🔥 excluir productos no válidos
    if (EXCLUIR_PRODUCTOS.some(p => nombreProducto.includes(p))) {
      return;
    }

    // 🔥 si viene vacía → usar última válida
    if (fechaRaw) {
      ultimaFechaValida = parseFecha(fechaRaw);
    }

    // 🔥 parsear
    let fechaObj = null;

    // 🔹 si viene fecha → parsear
    if (fechaRaw) {
      fechaObj = parseFecha(fechaRaw);

      if (fechaObj) {
        ultimaFechaValida = fechaObj;
      }
    }

    // 🔹 si no viene → usar última válida
    if (!fechaObj) {
      fechaObj = ultimaFechaValida;
    }

    // 🔹 si aún no hay → ignorar
    if (!fechaObj || isNaN(fechaObj.getTime())) return;

    // 🔹 filtro fecha mínima
    if (fechaObj <= FECHA_MIN) return;

    const fecha = fechaObj.toISOString().slice(0,10);
    // 🔥 si aún así no hay fecha → ignorar

    if (!barcode || !productosMap.has(barcode)) return;

    const prod = productosMap.get(barcode);

    const varianteNorm = normalizarVariante(prod.variant);

    const key = `${prod.name}__${varianteNorm}`;

    if (!grupos.has(key)) {
      const pubs = obtenerPublicacionesDesdeBarcode(barcode);

      grupos.set(key, {
        producto: prod.name,
        variante: prod.variant,
        barcode,
        publicaciones: pubs,
        publicacionesData: pubs.map(p => ({
          codigo: p,
          titulo: publicacionesMap.get(p) || ''
        })),
        ventasPorMes: {}
      });
    }

    const grupo = grupos.get(key);

    const mes = fecha.slice(0,7);

    grupo.ventasPorMes[mes] =
      (grupo.ventasPorMes[mes] || 0) + cantidad;
  });

  return Array.from(grupos.values())
    .map(g => ({
      ...g,
      ...calcularMejorPeriodo(g.ventasPorMes)
    }))
    .sort((a,b) => b.ventas - a.ventas);
}

// 🔹 Render
function renderTabla(lista) {

  const body = document.getElementById('analisisBody');
  body.innerHTML = '';

  lista.forEach(g => {

    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>
        <div>${g.producto}</div>
        <div style="color:#666;font-size:12px;">${g.variante}</div>
      </td>
      <td>
        ${g.ventas} 
        (${g.meses} mes${g.meses>1?'es':''}${g.label ? ', ' + g.label : ''})
      </td>
      <td>${renderCopiable(g.barcode)}</td>
      <td>
        ${g.publicacionesData.map(p => `
          <div style="margin-bottom:4px;">
            ${renderCopiable('MLC' + p.codigo)}
            <div style="font-size:11px;color:#666;">
              ${p.titulo}
            </div>
          </div>
        `).join('')}
      </td>
    `;

    body.appendChild(tr);
  });
}

// 🔹 Exportar
function exportar() {

  const rows = [];

  rows.push(['Producto','Ventas','Código']);

  document.querySelectorAll('#analisisBody tr').forEach(tr => {

    const tds = tr.querySelectorAll('td');

    rows.push([
      tds[0].innerText,
      tds[1].innerText,
      tds[2].innerText
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, ws, 'Analisis');

  XLSX.writeFile(wb, 'analisis.xlsx');
}

// 🔹 Input file automático
document.addEventListener('DOMContentLoaded', async () => {

  const res = await fetch('/api/odoo/ventas/ultimo', { cache:'no-store' });

  if (!res.ok) {
    alert('No se pudo cargar archivo de ventas');
    return;
  }

  const buf = await res.arrayBuffer();

  const data = await procesarBuffer(buf);

  renderTabla(data);

  document
    .getElementById('exportarBtn')
    .addEventListener('click', exportar);
});

document.addEventListener('click', e => {

  const el = e.target.closest('.copiable');
  if (!el) return;

  const texto = el.dataset.copy;

  navigator.clipboard.writeText(texto);

  // feedback visual
  el.classList.add('copied');

  setTimeout(() => {
    el.classList.remove('copied');
  }, 800);
});