const fileInput = document.getElementById('ventasOdooFile');
const uploadBtn = document.getElementById('uploadVentasOdooBtn');
const statusEl = document.getElementById('ventasOdooStatus');
const infoEl = document.getElementById('ventasOdooInfo');

fileInput.addEventListener('change', () => {
  uploadBtn.disabled = !fileInput.files.length;
});

uploadBtn.addEventListener('click', async () => {
  const fd = new FormData();
  fd.append('archivo', fileInput.files[0]);

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
