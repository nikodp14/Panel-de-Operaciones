// ===============================
// VERIFICADOR DE ETIQUETAS (LIVIANO)
// ===============================

document.addEventListener("DOMContentLoaded", () => {

  const barcodeInput = document.getElementById("barcodeInput");
  const textCodeInput = document.getElementById("textCodeInput");
  const resultadoCheck = document.getElementById("resultadoCheck");
  const filesInput = document.getElementById("filesInput");
  const statusEl = document.getElementById("statusVentas");
  const esLocal = location.hostname === "localhost";
  let scanStartTime = 0;
  let scanLength = 0;
  let scanTimer;

  barcodeInput.addEventListener("input", () => {

    const now = Date.now();

    // inicio de lectura
    if (scanLength === 0) {
      scanStartTime = now;
    }

    scanLength++;

    clearTimeout(scanTimer);

    scanTimer = setTimeout(() => {

      const duration = Date.now() - scanStartTime;

      const esScanner = duration < 150 && scanLength >= 6;

      if (esScanner) {
        // ✅ SOLO si es scanner
        textCodeInput.focus();
        textCodeInput.select();
      } else {
        // ❌ humano → limpiar
        barcodeInput.value = "";
      }

      // reset
      scanLength = 0;
      scanStartTime = 0;

    }, 100);
  });

  filesInput.addEventListener("change", async () => {

    const files = Array.from(filesInput.files);
    if (!files.length) return;

    statusEl.textContent = "Subiendo archivo...";

    for (const file of files) {

      const formData = new FormData();
      formData.append("archivo", file);
      formData.append("lastModified", file.lastModified);

      const name = file.name.toLowerCase();

      if (!name.includes("product.product")) continue;

      await fetch("/api/odoo/variantes", {
        method: "POST",
        body: formData
      });
    }

    statusEl.textContent = "Archivo cargado ✅";

    // 🔥 recargar cache
    await loadVariantesOdoo();

    filesInput.value = "";

  });

  if (!barcodeInput || !textCodeInput || !resultadoCheck) {
    console.warn("Inputs no encontrados en el DOM");
    return;
  }

  let variantesOdooCache = [];

  // ===============================
  // HELPERS
  // ===============================

  function normCodigo(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/\.0$/, '');
  }

  function codigoCoincideConEscaneo(codigoEsperado, escaneado) {

    const esperado = normCodigo(codigoEsperado);
    const scan = normCodigo(escaneado);

    if (!esperado || !scan) return false;

    // exacto
    if (esperado === scan) return true;

    // parcial
    if (esperado.includes(scan) || scan.includes(esperado)) {
      return true;
    }

    // buscar en variantes Odoo
    const matches = variantesOdooCache.filter(v => {
      const barcode = normCodigo(v.barcode);
      const internal = normCodigo(v.default_code);

      return (
        (barcode && (barcode.includes(scan) || scan.includes(barcode)) && barcode.includes(esperado)) ||
        (internal && (internal.includes(scan) || scan.includes(internal)) && internal.includes(esperado))
      );
    });

    return matches.length === 1;
  }

  // ===============================
  // CARGAR VARIANTES ODOO
  // ===============================

  async function loadVariantesOdoo() {
    try {
      const res = await fetch('/api/odoo/variantes/ultimo', { cache: 'no-store' });

      if (!res.ok) {
        resultadoCheck.innerHTML = "⚠️ No hay variantes cargadas";
        resultadoCheck.style.color = "orange";
        return;
      }

      const buf = await res.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];

      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      variantesOdooCache = rows.slice(1).map(r => ({
        barcode: r[1],
        default_code: r[0]
      })).filter(v => v.barcode || v.default_code);

      console.log("Variantes cargadas:", variantesOdooCache.length);

    } catch (err) {
      console.error(err);
      resultadoCheck.innerHTML = "❌ Error cargando variantes";
      resultadoCheck.style.color = "red";
    }
  }

  // ===============================
  // VALIDACIÓN
  // ===============================

  function mostrarResultado(ok) {
    document.body.style.background = ok ? "#06b741" : "#c90000";
  }

  function resetUI() {
    barcodeInput.value = "";
    textCodeInput.value = "";
    resultadoCheck.innerHTML = "";
    document.body.style.background = "";
    barcodeInput.focus();
  }

  function intentarValidacion() {

    const barcode = barcodeInput.value.trim();
    const textCode = textCodeInput.value.trim();

    if (!barcode || !textCode) return;

    const ok = codigoCoincideConEscaneo(textCode, barcode);

    mostrarResultado(ok);

    setTimeout(resetUI, 4000);
  }

  barcodeInput.addEventListener("input", intentarValidacion);
  textCodeInput.addEventListener("input", intentarValidacion);

  // ===============================
  // INIT
  // ===============================

  loadVariantesOdoo();

  setTimeout(() => {
    barcodeInput.focus();
  }, 300);

});