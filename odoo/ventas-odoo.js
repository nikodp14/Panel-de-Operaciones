const fileInput = document.getElementById('ventasOdooFile');
const uploadBtn = document.getElementById('uploadVentasOdooBtn');
const statusEl = document.getElementById('ventasOdooStatus');
const infoEl = document.getElementById('ventasOdooInfo');

fileInput.addEventListener('change', () => {
  uploadBtn.disabled = !fileInput.files.length;
});

uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  // 1️⃣ Validación rápida del Excel
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Ajusta estos textos a lo que realmente trae tu Excel de Odoo
  const header = (rows[0] || []).join(' ').toLowerCase();
  const isVentasOdoo =
    header.includes('pedido') ||
    header.includes('cliente') ||
    header.includes('fecha') ||
    header.includes('total');

  if (!isVentasOdoo) {
    statusEl.textContent = '❌ Este archivo no parece ser Ventas Odoo.';
    return;
  }

  // 2️⃣ Subir si pasa validación
  const fd = new FormData();
  fd.append('archivo', file);

  statusEl.textContent = 'Subiendo archivo...';
  const res = await fetch('/api/odoo/ventas', { method: 'POST', body: fd });
  const json = await res.json();

  statusEl.textContent = json.message || 'Archivo cargado';
  infoEl.textContent = `Última carga: ${new Date(json.uploadedAt).toLocaleString('es-CL')}`;
});

async function loadInfo() {
  try {
    const res = await fetch('/api/odoo/ventas/info');
    const json = await res.json();
    infoEl.textContent = `Última carga: ${new Date(json.uploadedAt).toLocaleString('es-CL')}`;
  } catch {
    infoEl.textContent = 'Aún no se ha cargado ningún archivo de Ventas Odoo.';
  }
}

loadInfo();
