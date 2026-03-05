const fileInput = document.getElementById('stockOdooFile');
const uploadBtn = document.getElementById('uploadStockOdooBtn');
const statusEl = document.getElementById('stockOdooStatus');
const infoEl = document.getElementById('stockOdooInfo');

fileInput.addEventListener('change', () => {
  uploadBtn.disabled = !fileInput.files.length;
});

uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  const header = (rows[0] || []).join(' ').toLowerCase();

  const isStockOdoo =
    header.includes('ubicación') ||
    header.includes('producto') ||
    header.includes('cantidad');

  if (!isStockOdoo) {
    statusEl.textContent = '❌ Este archivo no parece ser Stock Odoo.';
    return;
  }

  const fd = new FormData();
  fd.append('archivo', file);

  statusEl.textContent = 'Subiendo archivo...';

  const res = await fetch('/api/odoo/stock', {
    method: 'POST',
    body: fd
  });

  const json = await res.json();

  statusEl.textContent = json.message || 'Archivo cargado';
  infoEl.textContent = `Última carga: ${new Date(json.uploadedAt).toLocaleString('es-CL')}`;
});

async function loadInfo() {
  try {
    const res = await fetch('/api/odoo/stock/info');
    const json = await res.json();

    infoEl.textContent =
      `Última carga: ${new Date(json.uploadedAt).toLocaleString('es-CL')}`;
  } catch {
    infoEl.textContent =
      'Aún no se ha cargado ningún archivo de Stock Odoo.';
  }
}

loadInfo();