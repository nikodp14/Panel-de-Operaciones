document.addEventListener('DOMContentLoaded', () => {
  const mlInput = document.getElementById('mlVentasFile');
  const analyzeBtn = document.getElementById('analyzeVentasBtn');
  const statusEl = document.getElementById('statusVentas');
  const resultsSection = document.getElementById('ventasResults');
  const resultsBody = document.getElementById('ventasResultsBody');
  const odooVentasInfo = document.getElementById('odooVentasInfo');
  const mlVentasInfo = document.getElementById('mlVentasInfo');

  async function loadOdooInfo() {
    try {
      const res = await fetch('/api/odoo/ventas/info');
      if (!res.ok) throw new Error('No hay Ventas ML cargadas aún');
      const json = await res.json();
      odooVentasInfo.textContent =
        `Usando Ventas Odoo cargadas el: ${new Date(json.uploadedAt).toLocaleString('es-CL')}`;
    } catch {
      odooVentasInfo.textContent =
        'No hay Ventas Odoo cargadas. Ve al menú "Ventas Odoo" para subir el archivo.';
    }
  }

  loadOdooInfo();

  function includesCancelOrReturn(estadoML) {
    const s = String(estadoML || '').toLowerCase();
    return s.includes('cancel') || s.includes('devol');
  }

  async function updateAnalyzeAvailability() {
    try {
      const res = await fetch('/api/ml/ventas/info', { cache: 'no-store' }); // 👈
      analyzeBtn.disabled = !res.ok;
    } catch {
      analyzeBtn.disabled = true;
    }
  }

  updateAnalyzeAvailability();

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

  function resetResultadosUI() {
    // 🧹 Limpiar resultados anteriores
    resultsBody.innerHTML = '';
    resultsSection.classList.add('hidden');

    // 🧹 Limpiar contadores/pills
    const countersEl = document.getElementById('actionCounters');
    if (countersEl) {
      countersEl.innerHTML = '';
      countersEl.classList.add('hidden');
    }

    // 🧹 Limpiar mensajes de estado
    statusEl.textContent = '';
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
      const obsCell = tr.querySelector('.obs-cell');
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

  async function runValidacionVentas() {
    const codigosRes = await fetch('/api/ml/ventas/codigos');
    const codigosPorVenta = await codigosRes.json();

    statusEl.textContent = 'Procesando archivos...';
    resultsBody.innerHTML = '';
    resultsSection.classList.add('hidden');

    try {
      const mlRes = await fetch('/api/ml/ventas/ultimo');
      if (!mlRes.ok) {
        throw new Error('No hay Ventas ML cargadas. Sube el archivo primero.');
      }
      const mlBuf = await mlRes.arrayBuffer();
      const wbML = XLSX.read(mlBuf, { type: 'array' });
      const wsML = wbML.Sheets[wbML.SheetNames[0]];
      const mlRows = XLSX.utils.sheet_to_json(wsML, { header: 1, raw: false });

      // === Odoo ===
      const odooRes = await fetch('/api/odoo/ventas/ultimo');
      if (!odooRes.ok) {
        throw new Error('No hay Ventas Odoo cargadas. Ve al menú "Ventas Odoo" y sube el archivo.');
      }
      const odooBuf = await odooRes.arrayBuffer();
      const wbOdoo = XLSX.read(odooBuf, { type: 'array' });
      const wsOdoo = wbOdoo.Sheets[wbOdoo.SheetNames[0]];
      const odooRows = XLSX.utils.sheet_to_json(wsOdoo, { header: 1, raw: false });

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

      const odooQtyByVenta = new Map();
      for (const row of odooData) {
        const v = normVenta(row[6]); // Col G
        const q = Number(row[7] || 0); // Col H
        if (v) {
          odooQtyByVenta.set(v, (odooQtyByVenta.get(v) || 0) + q);
        }
      }

      for (const r of mlData) {
        const ventaML = String(r[0] || '').trim(); // Col A (# de venta)
        const codigoPersistido = codigosPorVenta[ventaML]?.codigo || '';
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
        const qtyEntrega = odooQtyByVenta.get(ventaML) || 0;

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
          observaciones.push({ r, obs, precioMostrado, codigoPersistido });
        }
      }

      if (!observaciones.length) {
        statusEl.textContent = 'No se encontraron observaciones 🎉';
        return;
      }

      for (const item of observaciones) {
        const obs = item.obs;
        const pubML = String(item.r[16] || '').trim(); // Col Q

        const isRegistrar = obs === 'REGISTRAR VENTA';

        const tr = document.createElement('tr');
        const tituloPub = String(item.r[18] || '').trim();  // Col S
        let variante = String(item.r[19] || '').trim();    // Col T

        // Normalización de variante
        const varianteNorm = variante.toLowerCase();
        const tituloNorm = tituloPub.toLowerCase();

        const variantesIgnorar = ['original', 'aluminio', 'ambos lados'];

        let mostrarVariante = variante &&
          varianteNorm !== tituloNorm &&
          !variantesIgnorar.includes(varianteNorm);

        if (mostrarVariante) {
          variante = variante.replace(/color:/i, '').trim();
        }

        const pubMLSinMLC = pubML.replace(/^MLC/i, '');

        const mostrarInfoProducto = (item.obs === 'REGISTRAR VENTA' || item.obs === 'ENTREGAR');

        tr.innerHTML = `
          <td>${item.r[0]}</td>
          <td>${item.r[1]}</td>
          <td>${item.r[2]}</td>
          <td>
            ${mostrarInfoProducto
              ? `
                <div class="producto-despachar">
                  <div class="linea-pubml">
                    <span class="pubml-tag">${pubMLSinMLC}</span>
                  </div>

                  <div class="linea-titulo">
                    <span class="titulo-pub">${tituloPub}</span>
                  </div>
                  <div>
                    ${mostrarVariante ? `<span class="variante-pub">(${variante})</span>` : ``}
                  </div>

                  ${item.obs === 'REGISTRAR VENTA'
                    ? `
                      <input
                        type="text"
                        class="codigo-input"
                        placeholder="Ingrese código"
                        data-pubml="${pubMLSinMLC}"
                        data-venta="${String(item.r[0] || '').trim()}"
                        value="${item.codigoPersistido || ''}"
                      />
                    `
                    : ``}
                </div>
              `
              : `—`}
          </td>
          <td>
            ${isRegistrar
              ? `<input type="checkbox" class="cambio-checkbox" />`
              : `—`}
          </td>
          <td>${item.precioMostrado.toLocaleString('es-CL')}</td>
          <td class="obs-cell">${item.obs}</td>
        `;

        resultsBody.appendChild(tr);

        // 👉 Revalidar automáticamente al renderizar (si hay código persistido)
        if (isRegistrar && item.codigoPersistido) {
          const input = tr.querySelector('.codigo-input');
          const obsCell = tr.querySelector('.obs-cell');
          const checkbox = tr.querySelector('.cambio-checkbox');

          const pubML = input.dataset.pubml;
          const valor = item.codigoPersistido || '';

          if (!(checkbox && checkbox.checked)) {
            if (!valor.includes(pubML)) {
              obsCell.textContent = 'PRODUCTO A DESPACHAR INCORRECTO';
              obsCell.style.color = 'red';
            } else {
              obsCell.textContent = 'REGISTRAR VENTA';
              obsCell.style.color = '';
            }
          } else {
            obsCell.textContent = 'REGISTRAR VENTA';
            obsCell.style.color = '';
          }
        }
      }

      buildPills(observaciones);

      resultsSection.classList.remove('hidden');
      statusEl.textContent = `Se encontraron ${observaciones.length} observaciones.`;
    } catch (err) {
      console.error(err);
      statusEl.textContent = err.message || 'Error procesando los archivos. Revisa el formato.';
    }
  };

  resultsBody.addEventListener('change', (e) => {
    if (!e.target.classList.contains('cambio-checkbox')) return;

    const checkbox = e.target;
    const tr = checkbox.closest('tr');
    const obsCell = tr.querySelector('.obs-cell');
    const input = tr.querySelector('.codigo-input');

    if (checkbox.checked) {
      obsCell.textContent = 'REGISTRAR VENTA';
      obsCell.style.color = '';
    } else if (input) {
      const pubML = input.dataset.pubml;
      const valor = input.value || '';

      if (!valor) {
        obsCell.textContent = 'REGISTRAR VENTA';
        obsCell.style.color = '';
      } else if (!valor.includes(pubML)) {
        obsCell.textContent = 'PRODUCTO A DESPACHAR INCORRECTO';
        obsCell.style.color = 'red';
      } else {
        obsCell.textContent = 'REGISTRAR VENTA';
        obsCell.style.color = '';
      }
    }
  });

  async function loadMlInfo() {
    try {
      const res = await fetch('/api/ml/ventas/info', { cache: 'no-store' }); // 👈
      if (!res.ok) throw new Error('No hay Ventas ML cargadas aún');
      const json = await res.json();
      mlVentasInfo.textContent =
        `Usando Ventas ML cargadas el: ${new Date(json.uploadedAt).toLocaleString('es-CL')}`;
    } catch {
      mlVentasInfo.textContent =
        'No hay Ventas ML cargadas aún. Ve al menú "Ventas ML" para cargar el archivo.';
    }
  }

  loadMlInfo();

  let saveTimeout;

  resultsBody.addEventListener('input', (e) => {
    if (!e.target.classList.contains('codigo-input')) return;

    const input = e.target;
    const tr = input.closest('tr');
    const obsCell = tr.querySelector('.obs-cell');
    const checkbox = tr.querySelector('.cambio-checkbox');

    const pubML = input.dataset.pubml;   // # publicación ML sin MLC
    const ventaML = input.dataset.venta; // # venta ML
    const valor = input.value || '';

    // 1) Validación visual (si no hay cambio de producto)
    if (!(checkbox && checkbox.checked)) {
      if (!valor) {
        // 👈 Campo vacío: estado neutral (no error)
        obsCell.textContent = 'REGISTRAR VENTA';
        obsCell.style.color = '';
      } else if (!valor.includes(pubML)) {
        obsCell.textContent = 'PRODUCTO A DESPACHAR INCORRECTO';
        obsCell.style.color = 'red';
      } else {
        obsCell.textContent = 'REGISTRAR VENTA';
        obsCell.style.color = '';
      }
    }

    // 2) Persistencia (debounce)
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      await fetch('/api/ml/ventas/codigos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ventaML, codigo: valor })
      });
    }, 500);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadMlInfo();
      updateAnalyzeAvailability();
    }
  });

  function validarExcelVentasML(file, rows) {
    // Heurísticas típicas del Excel de Ventas ML
    // Ajusta estos textos a los encabezados reales de tu archivo de ML
    const header = (rows[5] || rows[0] || []).join(' ').toLowerCase(); // tu ML parte desde fila 6
    const tieneVenta = header.includes('venta') || header.includes('# venta') || header.includes('n° venta');
    const tieneEstado = header.includes('estado');
    const tieneFecha = header.includes('fecha');

    // ML suele tener columnas: Venta, Fecha, Estado, Producto, Precio, Envío, etc.
    return tieneVenta && tieneEstado && tieneFecha;
  }

  analyzeBtn.addEventListener('click', async () => {
    try {
      resetResultadosUI();
      // 1) Validar que el archivo seleccionado sea Ventas ML (si hay archivo)
      if (mlInput.files.length) {
        const file = mlInput.files[0];
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

        if (!validarExcelVentasML(file, rows)) {
          statusEl.textContent = '❌ El archivo seleccionado no parece ser Ventas ML. Revisa que descargaste el Excel correcto desde MercadoLibre.';
          return;
        }

        // 2) Subir Ventas ML (solo si pasa validación)
        const fd = new FormData();
        fd.append('archivo', file);

        statusEl.textContent = 'Subiendo Ventas ML...';
        const up = await fetch('/api/ml/ventas', { method: 'POST', body: fd });
        if (!up.ok) {
          const t = await up.text();
          throw new Error('Error subiendo Ventas ML: ' + t);
        }
      }

      // 3) Validar contra el último Ventas ML persistido
      await runValidacionVentas();

      // 4) Refrescar info
      await loadMlInfo();
      await updateAnalyzeAvailability();

    } catch (e) {
      console.error(e);
      statusEl.textContent = e.message || 'Error al subir/validar Ventas ML';
    }
  });

  mlInput.addEventListener('pointerdown', resetResultadosUI);
  mlInput.addEventListener('change', resetResultadosUI);

  let lastFileValue = mlInput.value;

  setInterval(() => {
    if (mlInput.value !== lastFileValue) {
      lastFileValue = mlInput.value;

      // Si quedó vacío (el usuario borró el archivo con la "x")
      if (!mlInput.value) {
        resetResultadosUI();
      }
    }
  }, 300);
});