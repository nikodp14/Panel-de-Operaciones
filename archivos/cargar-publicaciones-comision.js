const mlFileInput = document.getElementById('mlFile');
const analyzeBtn = document.getElementById('analyzeBtn');
const statusEl = document.getElementById('status');
const mlInfoEl = document.getElementById("mlInfo");

function normalizeHeader(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

(async () => {
  try {
    const res = await fetch('/api/odoo/variantes/info', { cache: 'no-store' });
    if (!res.ok) return;

    const info = await res.json();
    document.getElementById('odooInfo').innerText =
      `Utilizando Variantes Odoo el: ${new Date(info.uploadedAt).toLocaleString()}`;
  } catch {}
})();

function validarExcelPublicacionesML(rows) {
  const headerRow = rows[2] || [];
  const header = headerRow.map(h => normalizeHeader(h));

  const clavesML = [
    'numero de publicacion',
    'titulo',
    'variantes',
    'sku',
    'en mi deposito'
  ];

  const clavesNoML = [
    '# de venta',
    'fecha de venta',
    'total (clp)'
  ];

  const pareceML = clavesML.some(k => header.some(h => h.includes(k)));
  const pareceVentas = clavesNoML.some(k => header.some(h => h.includes(k)));

  return pareceML && !pareceVentas;
}

async function updateButtonState() {
  try {
    const hasLocalFile = mlFileInput.files && mlFileInput.files.length > 0;

    if (hasLocalFile) {
      analyzeBtn.disabled = false;
      return;
    }

    const infoRes = await fetch('/api/ml/comisiones/info', { cache: 'no-store' });
    analyzeBtn.disabled = !infoRes.ok;

  } catch {
    analyzeBtn.disabled = true;
  }
}

mlFileInput.addEventListener('change', updateButtonState);

async function uploadPublicacionesML(fileToUse) {

  const fd = new FormData();
  fd.append("archivo", fileToUse);

  const res = await fetch("/api/ml/comisiones", {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    throw new Error("No se pudo subir Publicaciones ML al servidor.");
  }

  return res.json();
}

async function fetchUltimasPublicacionesML() {
  const infoRes = await fetch("/api/ml/publicaciones/info", { cache: "no-store" });
  if (!infoRes.ok) return null;

  const info = await infoRes.json();

  const fileRes = await fetch("/api/ml/publicaciones/ultimo", { cache: "no-store" });
  if (!fileRes.ok) {
    throw new Error("No se pudo descargar Publicaciones ML.");
  }

  const buf = await fileRes.arrayBuffer();
  const file = new File([buf], info.file);

  return { file, info };
}

analyzeBtn.addEventListener('click', async () => {
  try {
    let fileToUse = null;

    if (mlFileInput.files.length) {
      fileToUse = mlFileInput.files[0];
    } else {
      const mlData = await fetchUltimasPublicacionesML();
      if (!mlData) {
        throw new Error('Aún no hay Publicaciones ML cargadas en el servidor.');
      }

      fileToUse = mlData.file;

      mlInfoEl.innerText =
        `Usando Publicaciones ML cargadas el: ${new Date(mlData.info.uploadedAt).toLocaleString()}`;
    }

    statusEl.textContent = 'Validando archivo de Publicaciones ML...';

    const buf = await fileToUse.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    const sheetName =
      wb.SheetNames.find(n => normalizeHeader(n).includes('publicaciones')) ||
      wb.SheetNames[0];

    const ws = wb.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

    if (!validarExcelPublicacionesML(rows)) {
      statusEl.textContent =
        '❌ El archivo seleccionado no corresponde a Publicaciones de MercadoLibre.';
      return;
    }

    statusEl.textContent = 'Subiendo archivo...';

    const uploadRes = await uploadPublicacionesML(fileToUse);

    mlInfoEl.innerText =
      `Publicaciones ML cargadas el: ${new Date(uploadRes.uploadedAt).toLocaleString()}`;

    statusEl.textContent = '✅ Archivo cargado correctamente.';

  } catch (error) {
    console.error(error);
    statusEl.textContent = `Error: ${error.message}`;
  }
});

updateButtonState();