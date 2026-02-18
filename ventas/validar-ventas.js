const mlInput = document.getElementById('mlVentasFile');
const odooInput = document.getElementById('odooVentasFile');
const analyzeBtn = document.getElementById('analyzeVentasBtn');
const statusEl = document.getElementById('statusVentas');
const resultsSection = document.getElementById('ventasResults');
const resultsBody = document.getElementById('ventasResultsBody');

function includesCancelOrReturn(estadoML) {
  const s = String(estadoML || '').toLowerCase();
  return s.includes('cancel') || s.includes('devol');
}

function updateBtn() {
  analyzeBtn.disabled = !(mlInput.files.length && odooInput.files.length);
}

function toNumberCLP(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return 0;
  const n = parseFloat(
    String(v)
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '')
  );
  return isNaN(n) ? 0 : n;
}

function calcularPrecioMostrado(totalCLP, ingresoEnvioCLP, costoEnvioCLP, estadoML) {
  const total = toNumberCLP(totalCLP);
  const ingreso = toNumberCLP(ingresoEnvioCLP);
  const costo = toNumberCLP(costoEnvioCLP); // si no es número → 0
  const estado = String(estadoML || '').toLowerCase();

  // 👉 NUEVA REGLA: si está cancelada y total = 0, mostrar 0 sin cálculo
  if (estado.includes('cancel') && total === 0) {
    return 0;
  }

  // Caso B: sin envío válido
  if (!(ingreso > 0)) {
    return Math.round(total / 1.19);
  }

  // Caso A: con envío válido y (ingreso + costo) > 0
  if ((ingreso + costo) > 0) {
    const base = total - (3000 * 1.19);
    return Math.round(base / 1.19);
  }

  // Fallback
  return Math.round(total / 1.19);
}

mlInput.addEventListener('change', updateBtn);
odooInput.addEventListener('change', updateBtn);

async function readRows(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
}

function excelDateToJSDate(serial) {
  // Excel epoch (1899-12-30)
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;                                        
  const date_info = new Date(utc_value * 1000);
  return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate());
}

function parseDate(value) {
  if (!value) return null;

  // Caso 1: número (serial Excel)
  if (typeof value === 'number') {
    const utc_days = Math.floor(value - 25569);
    const utc_value = utc_days * 86400;
    const date_info = new Date(utc_value * 1000);
    return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate());
  }

  const s = String(value).trim().toLowerCase();

  // Caso 2: formato español "16 de febrero de 2026 12:33 hs."
  const meses = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
    noviembre: 10, diciembre: 11
  };

  const matchEs = s.match(
    /^(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i
  );

  if (matchEs) {
    const day = parseInt(matchEs[1], 10);
    const monthName = matchEs[2];
    const year = parseInt(matchEs[3], 10);
    const hour = matchEs[4] ? parseInt(matchEs[4], 10) : 0;
    const minute = matchEs[5] ? parseInt(matchEs[5], 10) : 0;

    const month = meses[monthName];
    if (month === undefined) return null;

    return new Date(year, month, day, hour, minute);
  }

  // Caso 3: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);

  // Caso 4: DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}/.test(s)) {
    const [d, m, y] = s.split('-');
    return new Date(`${y}-${m}-${d}`);
  }

  // Fallback
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

function normVenta(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim().replace(/\s+/g, '');
}

const countersEl = document.getElementById('actionCounters');

function applyFilter(filter) {
  const rows = resultsBody.querySelectorAll('tr');

  rows.forEach(tr => {
    const obsCell = tr.querySelector('td:last-child');
    if (!obsCell) return;

    const obs = obsCell.textContent.trim();

    if (filter === 'TODOS') {
      tr.style.display = '';
    } else {
      tr.style.display = obs === filter ? '' : 'none';
    }
  });
}

function buildPills(items) {
  if (!countersEl) return;

  const counts = items.reduce((acc, r) => {
    acc[r.obs] = (acc[r.obs] || 0) + 1;
    acc.TODOS = (acc.TODOS || 0) + 1;
    return acc;
  }, {});

  countersEl.innerHTML = '';

  const pillsOrder = ['TODOS', 'REGISTRAR VENTA', 'ENTREGAR', 'DEVOLVER'];

  pillsOrder.forEach(k => {
    const pill = document.createElement('span');
    pill.className = 'pill' + (k === 'TODOS' ? ' active' : '');
    pill.dataset.filter = k;
    pill.textContent = `${k} (${counts[k] || 0})`;

    pill.onclick = () => {
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      applyFilter(k);
    };

    countersEl.appendChild(pill);
  });

  countersEl.classList.remove('hidden');
}

analyzeBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Procesando archivos...';
  resultsBody.innerHTML = '';
  resultsSection.classList.add('hidden');

  try {
    const [mlRows, odooRows] = await Promise.all([
      readRows(mlInput.files[0]),
      readRows(odooInput.files[0]),
    ]);

    // Saltamos encabezados (asumimos fila 1 es header)
    const START_ROW = 6;

    const mlData = mlRows.slice(START_ROW);
    const odooData = odooRows.slice(0);
    //console.log(odooData);

    const cutoff = new Date('2026-02-17');

    // Set con las ventas registradas en Odoo (col G -> index 6)
    const odooSet = new Set(
      odooData
        .map(r => normVenta(r[6]))  // Col G
        .filter(Boolean)
    );

    const observaciones = [];

    for (const r of mlData) {
      const ventaML = normVenta(r[0]);   // Col A (# de venta)
      const fecha = parseDate(r[1]);     // Col B (Fecha de venta)
      const estadoML = String(r[2] || ''); // Col C (Estado ML)

      const totalCLPraw = r[12];         // Col M
      const ingresoEnvioCLP = r[9]; // Col J
      const costoEnvioCLP = r[10];  // Col K
      const totalCLP = typeof totalCLPraw === 'number'
        ? totalCLPraw
        : parseFloat(String(totalCLPraw || '').replace(/\./g, '').replace(',', '.'));

      const precioMostrado = calcularPrecioMostrado(
        totalCLP,
        ingresoEnvioCLP,
        costoEnvioCLP,
        estadoML
      ); 

      if (!ventaML || !fecha) continue;
      if (fecha < cutoff) continue;

      if (isNaN(totalCLP) || !(totalCLP > 0 || totalCLP === 0)) continue;

      const existeEnOdoo = odooSet.has(ventaML);

      // Cantidad de entrega desde Odoo (col H -> índice 7)
      const qtyEntrega = Number(
        (odooData.find(x => normVenta(x[6]) === ventaML) || [])[7] || 0
      );

      let obs = null;

      // 1) Registrar venta
      if (!existeEnOdoo && totalCLP > 0) {
        obs = 'REGISTRAR VENTA';
      }

      // 2) Entregar
      if (existeEnOdoo && totalCLP > 0 && qtyEntrega === 0 && !includesCancelOrReturn(estadoML)) {
        obs = 'ENTREGAR';
      }

      // 3) Devolver
      if ((totalCLP >= 0) && includesCancelOrReturn(estadoML) && qtyEntrega > 0) {
        obs = 'DEVOLVER';
      }

      if (obs) {
        observaciones.push({ r, obs, precioMostrado });
      }
    }

    if (!observaciones.length) {
      statusEl.textContent = 'No se encontraron observaciones 🎉';
      return;
    }

    for (const item of observaciones) {
      const r = item.r;
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${r[0]}</td>
        <td>${r[1]}</td>
        <td>${r[2]}</td>
        <td>${item.precioMostrado.toLocaleString('es-CL')}</td>
        <td>${item.obs}</td>
      `;

      resultsBody.appendChild(tr);
    }

    buildPills(observaciones);

    resultsSection.classList.remove('hidden');
    statusEl.textContent = `Se encontraron ${observaciones.length} observaciones.`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Error procesando los archivos. Revisa el formato.';
  }
});