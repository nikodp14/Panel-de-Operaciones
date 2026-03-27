import express from "express";
import path from "path";
import multer from "multer";
import fs from "fs";
import { fileURLToPath } from "url";
import archiverPkg from "archiver";

function readJSONSafe(path, defaultValue) {
  try {
    if (!fs.existsSync(path)) {
      fs.writeFileSync(path, JSON.stringify(defaultValue, null, 2));
      return defaultValue;
    }

    return JSON.parse(fs.readFileSync(path, 'utf-8'));

  } catch (err) {
    console.error("Error leyendo JSON:", path, err);
    return defaultValue;
  }
}

function writeJSONSafe(path, data) {
  try {
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error escribiendo JSON:", path, err);
  }
}

function validarLastModified(lastModified) {
  if (!lastModified) return false;

  const fechaArchivo = new Date(Number(lastModified));
  const hoy = new Date();

  // 🔥 zona Chile
  const toCL = (d) =>
    new Date(d.toLocaleString("en-US", { timeZone: "America/Santiago" }));

  const f = toCL(fechaArchivo);
  const h = toCL(hoy);

  f.setHours(0,0,0,0);
  h.setHours(0,0,0,0);

  return f.getTime() === h.getTime();
}

function esArchivoDeHoy(filePath) {
  const stats = fs.statSync(filePath);

  const mtime = new Date(stats.mtime);

  const hoy = new Date();
  
  // 🔥 normalizar zona horaria
  const toCL = (d) => new Date(d.toLocaleString("en-US", { timeZone: "America/Santiago" }));

  const mtimeCL = toCL(mtime);
  const hoyCL = toCL(hoy);

  mtimeCL.setHours(0,0,0,0);
  hoyCL.setHours(0,0,0,0);

  return mtimeCL.getTime() === hoyCL.getTime();
}

const archiver = archiverPkg.default || archiverPkg;

const app = express();
app.use(express.json());
const DOLAR_FILE = "./data/dolar.json";

// asegurar carpeta data
const DATA_DIR = "./data";

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// asegurar archivo dolar.json
if (!fs.existsSync(DOLAR_FILE)) {
  fs.writeFileSync(DOLAR_FILE, "{}");
  await precargarDolar();
}

setTimeout(async () => {

  if (dolarCacheVacio()) {
    console.log("Cache de dólar vacío, intentando precargar histórico...");
    await precargarDolar();
  }

  await actualizarDolar();

},1000);

setInterval(async () => {

  await actualizarDolar();

}, 6 * 60 * 60 * 1000);

function dolarCacheVacio(){
  try{
    const data = JSON.parse(fs.readFileSync(DOLAR_FILE,"utf8"));
    return Object.keys(data).length === 0;
  }catch{
    return true;
  }
}

async function precargarDolar(){

  try{

    const yearActual = new Date().getFullYear();
    const yearAnterior = yearActual - 1;

    const dolarData = {};

    for(const year of [yearAnterior, yearActual]){

      const res = await fetch(`https://mindicador.cl/api/dolar/${year}`);

      if(!res.ok){
        console.warn("No se pudo obtener dolar año",year);
        continue;
      }

      const data = await res.json();

      data.serie.forEach(d => {

        const fecha = d.fecha.slice(0,10);
        dolarData[fecha] = d.valor;

      });

    }

    if(Object.keys(dolarData).length === 0){
      console.warn("No se pudo precargar dólar");
      return;
    }

    fs.writeFileSync(
      DOLAR_FILE,
      JSON.stringify(dolarData,null,2)
    );

    console.log("Histórico de dólar guardado");

  }catch(err){

    console.warn("Error precargando dólar:",err.message);

  }

}

const filePath = path.join(process.cwd(), 'data', 'correlativo-pedidos.json');

function leerCorrelativo() {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ ultimo: 0 }, null, 2));
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function guardarCorrelativo(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

app.get('/api/pedidos/siguiente', (req, res) => {

  const data = leerCorrelativo();

  data.ultimo += 1;

  guardarCorrelativo(data);

  const numero = data.ultimo;

  const ref = 'N' + String(numero).padStart(5, '0');

  res.json({ numero, ref });

});

app.post('/api/contador-internacional', (req, res) => {

  const filePath = './data/contador-internacional.json';

  let data = { ultimo: 0 };

  try {
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error('Error leyendo contador:', err);
  }

  data.ultimo = (data.ultimo || 0) + 1;

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  res.json({ numero: data.ultimo });

});

app.get("/api/dolar", (req,res)=>{

  const fecha = req.query.fecha;

  if(!fecha){
    return res.status(400).json({
      error:"Debe enviar ?fecha=YYYY-MM-DD"
    });
  }

  const cache = JSON.parse(
    fs.readFileSync(DOLAR_FILE,"utf8")
  );

  // 🔹 si existe exacta
  if(cache[fecha]){
    return res.json({valor:cache[fecha]});
  }

  // 🔹 buscar último día anterior disponible
  const fechas = Object.keys(cache).sort().reverse();

  const encontrada = fechas.find(f => f <= fecha);

  if(encontrada){

    const diff =
      (new Date(fecha) - new Date(encontrada)) /
      (1000 * 60 * 60 * 24);

    if(diff > 3){
      return res.status(500).json({
        error: "dolar desactualizado"
      });
    }

    return res.json({
      valor: cache[encontrada],
      fechaUsada: encontrada
    });
  }

  res.status(404).json({
    error:"No hay dólar disponible"
  });

});

app.get('/api/estado/odoo-ventas', (req, res) => {

  const estado = readJSONSafe('data/estado-odoo.json', {
    pendienteVentasOdoo: false
  });

  res.json(estado);
});

app.post('/api/estado/odoo-ventas', (req, res) => {

  const { pendienteVentasOdoo } = req.body;

  writeJSONSafe('data/estado-odoo.json', {
    pendienteVentasOdoo
  });

  res.json({ ok: true });
});

async function actualizarDolar(){

  try{

    const cache = JSON.parse(
      fs.readFileSync(DOLAR_FILE,"utf8")
    );

    const year = new Date().getFullYear();

    const res = await fetch(`https://mindicador.cl/api/dolar/${year}`);

    if(!res.ok) return;

    const data = await res.json();

    let actualizado = false;

    data.serie.forEach(d => {

      const fecha = d.fecha.slice(0,10);

      if(!cache[fecha]){
        cache[fecha] = d.valor;
        actualizado = true;
      }

    });

    if(actualizado){

      fs.writeFileSync(
        DOLAR_FILE,
        JSON.stringify(cache,null,2)
      );

      console.log("Histórico de dólar actualizado");

    }

  }catch(err){

    console.warn("No se pudo actualizar dólar:",err.message);

  }

}

// __dirname en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Carpeta data
const UPLOAD_DIR = path.join(__dirname, "data");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const upload = multer({ dest: UPLOAD_DIR });

// ============================
// Persistencia de códigos por Venta ML
// ============================

const CODIGOS_ML_PATH = path.join(UPLOAD_DIR, "ventas_ml_codigos.json");
const CODIGOS_JUMPSELLER_PATH = path.join(UPLOAD_DIR, "ventas_jumpseller_codigos.json");

let lastScan = null;

app.post('/api/scanner', express.json(), (req, res) => {

  const code = req.body.code || req.body.barcode || req.body.text;

  if (!code) {
    return res.status(400).json({ error: 'No code' });
  }

  lastScan = {
    code,
    ts: Date.now()
  };

  res.json({ ok: true });
});

app.get('/api/scanner/last', (req, res) => {

  if (!lastScan) {
    return res.json({ code: null });
  }

  const scan = lastScan;

  // 🔹 consumir escaneo (evita repetir el último)
  lastScan = null;

  res.json(scan);

});

app.get('/api/data/download', (req, res) => {

  console.log("🔥 Descargando data.zip...");

  const dirPath = path.join(__dirname, 'data');

  if (!fs.existsSync(dirPath)) {
    console.log("❌ Carpeta data no existe");
    return res.status(404).json({ error: 'Carpeta data no existe' });
  }

  const zipPath = path.join(__dirname, 'data.zip');

  const archive = archiver('zip', { zlib: { level: 9 } });
  const output = fs.createWriteStream(zipPath);

  output.on('close', () => {
    console.log("✅ ZIP creado, enviando...");
    res.download(zipPath, 'data.zip', () => {
      fs.unlinkSync(zipPath); // 🔥 borra el zip después
    });
  });

  archive.on('error', err => {
    console.error("❌ Error ZIP:", err);
    res.status(500).send('Error creando ZIP');
  });

  archive.pipe(output);
  archive.directory(dirPath, false);
  archive.finalize();

});

app.get("/api/ml/ventas/codigos", (req, res) => {
  if (!fs.existsSync(CODIGOS_ML_PATH)) {
    return res.json({});
  }
  
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(CODIGOS_ML_PATH, "utf-8"));
  } catch {
    data = {};
  }
  res.json(data);
});

app.get("/api/jumpseller/ventas/codigos", (req, res) => {
  if (!fs.existsSync(CODIGOS_JUMPSELLER_PATH)) {
    return res.json({});
  }
  
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(CODIGOS_JUMPSELLER_PATH, "utf-8"));
  } catch {
    data = {};
  }
  res.json(data);
});

app.post("/api/ml/ventas/codigos", express.json(), (req, res) => {
  const { key, codigo, escaneado, cambioProducto } = req.body;
  if (!key) {
    return res.status(400).json({ error: "key requerida (venta|publicacion)" });
  }

  let data = {};
  if (fs.existsSync(CODIGOS_ML_PATH)) {
    try {
      data = JSON.parse(fs.readFileSync(CODIGOS_ML_PATH, "utf-8"));
    } catch {
      data = {};
    }
  }

  data[key] = {
    ...(data[key] || {}),
    codigo: codigo ?? data[key]?.codigo ?? "",
    escaneado: escaneado ?? data[key]?.escaneado ?? null,
    cambioProducto: cambioProducto ?? data[key]?.cambioProducto ?? false,
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(CODIGOS_ML_PATH, JSON.stringify(data, null, 2));
  res.json({ ok: true });
});

app.post("/api/jumpseller/ventas/codigos", express.json(), (req, res) => {
  const { key, codigo, escaneado, cambioProducto, envioManual } = req.body;
  if (!key) {
    return res.status(400).json({ error: "key requerida (venta|publicacion)" });
  }

  let data = {};
  if (fs.existsSync(CODIGOS_JUMPSELLER_PATH)) {
    try {
      data = JSON.parse(fs.readFileSync(CODIGOS_JUMPSELLER_PATH, "utf-8"));
    } catch {
      data = {};
    }
  }

  data[key] = {
    ...(data[key] || {}),
    codigo: codigo ?? data[key]?.codigo ?? "",
    escaneado: escaneado ?? data[key]?.escaneado ?? null,
    cambioProducto: cambioProducto ?? data[key]?.cambioProducto ?? false,
    envioManual: envioManual ?? data[key]?.envioManual ?? 0,
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(CODIGOS_JUMPSELLER_PATH, JSON.stringify(data, null, 2));
  res.json({ ok: true });
});

// ============================
// Ventas ML (persistente para Validar Ventas)
// ============================

app.get("/api/ml/ventas/info", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "ventas_ml_meta.json");

  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Ventas ML cargadas aún" });
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));

  res.json(meta);
});

app.get("/api/jumpseller/ventas/info", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "ventas_jumpseller_meta.json");
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Ventas Jumpseller cargadas aún" });
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  res.json(meta);
});

app.get("/api/ml/ventas/ultimo", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "ventas_ml_meta.json");
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Ventas ML cargadas aún" });
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const filePath = path.join(UPLOAD_DIR, meta.file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Archivo no encontrado en disco" });
  }
  res.sendFile(filePath);
});

app.get("/api/jumpseller/ventas/ultimo", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "ventas_jumpseller_meta.json");
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Ventas Jumpseller cargadas aún" });
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const filePath = path.join(UPLOAD_DIR, meta.file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Archivo no encontrado en disco" });
  }
  res.sendFile(filePath);
});

app.post("/api/ml/ventas", upload.single("archivo"), (req, res) => {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const finalName = `ventas_ml_${ts}.xlsx`;
  const finalPath = path.join(UPLOAD_DIR, finalName);

  const { lastModified } = req.body;

  if (!validarLastModified(lastModified)) {

    fs.unlinkSync(finalPath);

    return res.status(400).json({
      error: "El archivo de Ventas ML no es del día"
    });
  }

  fs.renameSync(req.file.path, finalPath);

  const meta = { file: finalName, uploadedAt: now.toISOString() };
  fs.writeFileSync(
    path.join(UPLOAD_DIR, "ventas_ml_meta.json"),
    JSON.stringify(meta, null, 2)
  );

  res.json({ message: "Ventas ML cargadas correctamente", ...meta });
});

app.post("/api/jumpseller/ventas", upload.single("archivo"), (req, res) => {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const finalName = `ventas_jumpseller_${ts}.xlsx`;
  const finalPath = path.join(UPLOAD_DIR, finalName);

  fs.renameSync(req.file.path, finalPath);

  const meta = { file: finalName, uploadedAt: now.toISOString() };
  fs.writeFileSync(
    path.join(UPLOAD_DIR, "ventas_jumpseller_meta.json"),
    JSON.stringify(meta, null, 2)
  );

  res.json({ message: "Ventas Jumpseller cargadas correctamente", ...meta });
});

// ============================
// Ventas Odoo (persistente)
// ============================
app.get("/odoo/ventas-odoo.html", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "odoo", "ventas-odoo.html"));
});

app.get("/archivos/cargar-publicaciones-comision.html", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "archivos", "cargar-publicaciones-comision.html"));
});

app.get("/odoo/stock-odoo.html", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "odoo", "stock-odoo.html"));
});

app.get("/compras/compra-nacional.html", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "compras", "compra-nacional.html"));
});

app.get("/compras/verificador-codigos.html", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "compras", "verificador-codigos.html"));
});

app.get("/compras/compra-internacional.html", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "compras", "compra-internacional.html"));
});

app.get("/api/odoo/ventas/info", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "ventas_odoo_meta.json");
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Ventas Odoo cargadas aún" });
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  res.json(meta);
});

app.get("/api/odoo/ventas/ultimo", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "ventas_odoo_meta.json");
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Ventas Odoo cargadas aún" });
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const filePath = path.join(UPLOAD_DIR, meta.file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Archivo no encontrado en disco" });
  }
  res.sendFile(filePath);
});

app.get("/api/ml/ventas/correlativo", (req, res) => {

  try {
    const dataDir = path.join(process.cwd(), 'data');
    const filePath = path.join(dataDir, 'correlativo.json');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify({ correlativo: 1 }, null, 2));
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    res.json(data);

  } catch (err) {
    console.error("Error correlativo:", err);
    res.status(500).json({ error: "Error correlativo" });
  }

});

app.post("/api/ml/ventas/correlativo", (req, res) => {

  try {
    const dataDir = path.join(process.cwd(), 'data');
    const filePath = path.join(dataDir, 'correlativo.json');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(
      filePath,
      JSON.stringify(req.body, null, 2)
    );

    res.json({ ok: true });

  } catch (err) {
    console.error("Error guardando correlativo:", err);
    res.status(500).json({ error: "Error guardando correlativo" });
  }

});

app.post("/api/odoo/ventas", upload.single("archivo"), (req, res) => {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const finalName = `ventas_odoo_${ts}.xlsx`;
  const finalPath = path.join(UPLOAD_DIR, finalName);
  const { lastModified } = req.body;

  if (!validarLastModified(lastModified)) {

    fs.unlinkSync(finalPath);

    return res.status(400).json({
      error: "El archivo de Ventas Odoo no es del día"
    });
  }

  fs.renameSync(req.file.path, finalPath);

  if (!esArchivoDeHoy(finalPath)) {

    fs.unlinkSync(finalPath);

    return res.status(400).json({
      error: "El archivo de Ventas Odoo no es del día"
    });
  }

  const meta = { file: finalName, uploadedAt: now.toISOString() };
  fs.writeFileSync(
    path.join(UPLOAD_DIR, "ventas_odoo_meta.json"),
    JSON.stringify(meta, null, 2)
  );

  res.json({ message: "Ventas Odoo cargadas correctamente", ...meta });
});

app.post('/api/odoo/stock', upload.single('archivo'), (req, res) => {

  const filePath = path.join(UPLOAD_DIR, 'stock-odoo.xlsx');
  const { lastModified } = req.body;

  if (!validarLastModified(lastModified)) {

    fs.unlinkSync(filePath);

    return res.status(400).json({
      error: "El archivo de Stock Odoo no es del día"
    });
  }

  fs.renameSync(req.file.path, filePath);

  // 🔥 VALIDACIÓN
  if (!esArchivoDeHoy(filePath)) {

    fs.unlinkSync(filePath);

    return res.status(400).json({
      error: "El archivo de Stock Odoo no es del día"
    });
  }

  const info = {
    uploadedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(UPLOAD_DIR, 'stock-odoo-info.json'),
    JSON.stringify(info, null, 2)
  );

  res.json({
    message: 'Stock Odoo cargado correctamente',
    uploadedAt: info.uploadedAt
  });
});

app.get("/scanner", (req, res) => {
  res.sendFile(path.join(__dirname, "scanner","scanner-bridge.html"));
});

app.get('/api/odoo/stock/info', (req, res) => {

  const infoPath = path.join(UPLOAD_DIR, 'stock-odoo-info.json');

  if (!fs.existsSync(infoPath)) {
    return res.status(404).json({ message: 'No hay archivo cargado' });
  }

  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  res.json(info);
});

app.get('/api/odoo/stock/ultimo', (req, res) => {

  const filePath = path.join(UPLOAD_DIR, 'stock-odoo.xlsx');

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'No hay stock Odoo cargado' });
  }

  res.sendFile(filePath);

});

// ...

function renderWithSidebar(res, filePath) {
  const html = fs.readFileSync(filePath, "utf-8");
  const sidebar = fs.readFileSync(path.join(__dirname, "partials", "sidebar.html"), "utf-8");
  const out = html.replace('<div id="__SIDEBAR__"></div>', sidebar);
  res.send(out);
}

app.get("/", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "index.html"));
});

app.get("/validar-ml/validar-ml.html", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "validar-ml", "validar-ml.html"));
});

app.get("/ventas/validar-ventas-ml.html", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "ventas", "validar-ventas-ml.html"));
});

app.get("/ventas/validar-ventas-jumpseller.html", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "ventas", "validar-ventas-jumpseller.html"));
});

app.get("/ventas/validar-ventas-particulares.html", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "ventas", "validar-ventas-particulares.html"));
});

app.get("/ventas/analisis-ventas.html", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "ventas", "analisis-ventas.html"));
});


app.get("/odoo/variantes.html", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "odoo", "variantes.html"));
});

// Archivos estáticos
app.use(express.static(path.join(__dirname)));

// ============================
// Publicaciones ML (persistente)
// ============================

app.get("/api/ml/publicaciones/info", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "publicaciones_ml_meta.json");
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Publicaciones ML cargadas aún" });
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  res.json(meta);
});

app.get("/api/ml/publicaciones/ultimo", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "publicaciones_ml_meta.json");
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Publicaciones ML cargadas aún" });
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const filePath = path.join(UPLOAD_DIR, meta.file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Archivo no encontrado en disco" });
  }
  res.sendFile(filePath);
});

app.get("/api/jumpseller/publicaciones/ultimo", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "publicaciones_jumpseller_meta.json");
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Publicaciones Jumpseller cargadas aún" });
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const filePath = path.join(UPLOAD_DIR, meta.file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Archivo no encontrado en disco" });
  }
  res.sendFile(filePath);
});

// ============================
// Jumpseller Productos (persistente)
// ============================

app.get("/api/jumpseller/productos/info", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "productos_jumpseller_meta.json");

  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Productos Jumpseller cargados aún" });
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  res.json(meta);
});

app.get("/api/jumpseller/productos/ultimo", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "productos_jumpseller_meta.json");

  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Productos Jumpseller cargados aún" });
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const filePath = path.join(UPLOAD_DIR, meta.file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Archivo no encontrado en disco" });
  }

  res.sendFile(filePath);
});

app.post("/api/jumpseller/productos", upload.single("archivo"), (req, res) => {
  const now = new Date();

  const pad = (n) => n.toString().padStart(2, "0");
  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const finalName = `productos_jumpseller_${ts}.xlsx`;
  const finalPath = path.join(UPLOAD_DIR, finalName);

  fs.renameSync(req.file.path, finalPath);

  const meta = {
    file: finalName,
    uploadedAt: now.toISOString()
  };

  fs.writeFileSync(
    path.join(UPLOAD_DIR, "productos_jumpseller_meta.json"),
    JSON.stringify(meta, null, 2)
  );

  res.json({
    message: "Productos Jumpseller cargados correctamente",
    ...meta
  });
});

app.get("/api/jumpseller/productos/ultimo", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "productos_jumpseller_meta.json");
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Productos Jumpseller cargados aún" });
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const filePath = path.join(UPLOAD_DIR, meta.file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Archivo no encontrado en disco" });
  }
  res.sendFile(filePath);
});

app.post("/api/ml/publicaciones", upload.single("archivo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se recibió ningún archivo (campo 'archivo')" });
  }

  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");

  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const finalName = `publicaciones_ml_${ts}.xlsx`;
  const finalPath = path.join(UPLOAD_DIR, finalName);

  fs.renameSync(req.file.path, finalPath);

  const meta = { file: finalName, uploadedAt: now.toISOString() };
  fs.writeFileSync(
    path.join(UPLOAD_DIR, "publicaciones_ml_meta.json"),
    JSON.stringify(meta, null, 2)
  );

  res.json({
    message: "Publicaciones ML cargadas correctamente ✔",
    file: finalName,
    uploadedAt: meta.uploadedAt,
  });
});

app.post("/api/jumpseller/publicaciones", upload.single("archivo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se recibió ningún archivo (campo 'archivo')" });
  }

  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");

  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const finalName = `publicaciones_jumpseller_${ts}.xlsx`;
  const finalPath = path.join(UPLOAD_DIR, finalName);

  fs.renameSync(req.file.path, finalPath);

  const meta = { file: finalName, uploadedAt: now.toISOString() };
  fs.writeFileSync(
    path.join(UPLOAD_DIR, "publicaciones_jumpseller_meta.json"),
    JSON.stringify(meta, null, 2)
  );

  res.json({
    message: "Publicaciones Jumpseller cargadas correctamente ✔",
    file: finalName,
    uploadedAt: meta.uploadedAt,
  });
});

app.post("/api/jumpseller/productos", upload.single("archivo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se recibió ningún archivo (campo 'archivo')" });
  }

  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");

  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const finalName = `productos_jumpseller_${ts}.xlsx`;
  const finalPath = path.join(UPLOAD_DIR, finalName);

  fs.renameSync(req.file.path, finalPath);

  const meta = { file: finalName, uploadedAt: now.toISOString() };
  fs.writeFileSync(
    path.join(UPLOAD_DIR, "productos_jumpseller_meta.json"),
    JSON.stringify(meta, null, 2)
  );

  res.json({
    message: "Productos Jumpseller cargadas correctamente ✔",
    file: finalName,
    uploadedAt: meta.uploadedAt,
  });
});

/* ============================
   Endpoints Variantes Odoo
============================ */

// ============================
// Variantes Odoo (persistente)
// ============================

app.get("/api/odoo/variantes/info", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "variantes_odoo_meta.json");

  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Variantes Odoo cargadas aún" });
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  res.json(meta);
});

app.get("/api/odoo/variantes/ultimo", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "variantes_odoo_meta.json");

  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Variantes Odoo cargadas aún" });
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const filePath = path.join(UPLOAD_DIR, meta.file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Archivo no encontrado en disco" });
  }

  res.sendFile(filePath);
});

app.post("/api/odoo/variantes", upload.single("archivo"), (req, res) => {

  const now = new Date();

  const pad = (n) => n.toString().padStart(2, "0");
  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const finalName = `variantes_odoo_${ts}.xlsx`;
  const finalPath = path.join(UPLOAD_DIR, finalName);

  const { lastModified } = req.body;

  if (!validarLastModified(lastModified)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({
      error: "El archivo de Variantes Odoo no es del día"
    });
  }

  fs.renameSync(req.file.path, finalPath);

  const meta = {
    file: finalName,
    uploadedAt: now.toISOString()
  };

  fs.writeFileSync(
    path.join(UPLOAD_DIR, "variantes_odoo_meta.json"),
    JSON.stringify(meta, null, 2)
  );

  res.json({
    message: "Variantes Odoo cargadas correctamente",
    ...meta
  });
});

/* ============================
   Configuración (persistente)
============================ */

// Info del último archivo
app.get("/api/configuracion/info", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "configuracion_meta.json");
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Configuración cargada aún" });
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  res.json(meta);
});

// Descargar último archivo
app.get("/api/configuracion/ultimo", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "configuracion_meta.json");
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Configuración cargada aún" });
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const filePath = path.join(UPLOAD_DIR, meta.file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Archivo no encontrado en disco" });
  }
  res.sendFile(filePath);
});

// Subir archivo
app.post("/api/configuracion", upload.single("archivo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se recibió ningún archivo (campo 'archivo')" });
  }

  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");

  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const finalName = `configuracion_${ts}.xlsx`;
  const finalPath = path.join(UPLOAD_DIR, finalName);

  fs.renameSync(req.file.path, finalPath);

  const meta = { file: finalName, uploadedAt: now.toISOString() };
  fs.writeFileSync(
    path.join(UPLOAD_DIR, "configuracion_meta.json"),
    JSON.stringify(meta, null, 2)
  );

  res.json({
    message: "Configuración cargada correctamente ✔",
    file: finalName,
    uploadedAt: meta.uploadedAt,
  });
});

const cotizacionesPath = path.join(UPLOAD_DIR, 'cotizaciones-internacional.json');

app.get('/api/cotizaciones-internacional/:cot', (req, res) => {

  const cot = req.params.cot;

  if (!fs.existsSync(cotizacionesPath)) {
    return res.json(null);
  }

  const data = JSON.parse(fs.readFileSync(cotizacionesPath, 'utf8'));

  res.json(data[cot] || null);
});

app.post('/api/cotizaciones-internacional/:cot', (req, res) => {

  const cot = req.params.cot;
  const body = req.body;

  let data = {};

  try {
    data = JSON.parse(fs.readFileSync(cotizacionesPath, "utf8"));
  } catch {
    data = {};
  }

  data[cot] = body;

  fs.writeFileSync(cotizacionesPath, JSON.stringify(data, null, 2));

  res.json({ ok: true });
});

app.get('/api/cotizaciones-internacional', (req, res) => {

  if (!fs.existsSync(cotizacionesPath)) {
    return res.json({});
  }

  let data = {};

  try {
    data = JSON.parse(fs.readFileSync(cotizacionesPath, "utf8"));
  } catch {
    data = {};
  }

  res.json(data);

});

const cotizacionesNacionalPath = path.join(UPLOAD_DIR, 'cotizaciones-nacional.json');

app.get('/api/cotizaciones-nacional/:cot', (req, res) => {

  const cot = req.params.cot;

  if (!fs.existsSync(cotizacionesNacionalPath)) {
    return res.json(null);
  }

  const data = JSON.parse(fs.readFileSync(cotizacionesNacionalPath, 'utf8'));

  res.json(data[cot] || null);
});

app.post('/api/cotizaciones-nacional/:cot', (req, res) => {

  const cot = req.params.cot;
  const body = req.body;

  let data = {};

  try {
    data = JSON.parse(fs.readFileSync(cotizacionesNacionalPath, "utf8"));
  } catch {
    data = {};
  }

  data[cot] = body;

  fs.writeFileSync(cotizacionesNacionalPath, JSON.stringify(data, null, 2));

  res.json({ ok: true });
});

/* ============================
   Ventas particulares
============================ */

const ventasParticularesPath =
  path.join(UPLOAD_DIR, 'ventas_particulares.json');


app.get('/api/ventas-particulares', (req,res)=>{

  if(!fs.existsSync(ventasParticularesPath)){
    return res.json([]);
  }

  try{
    const data = JSON.parse(
      fs.readFileSync(ventasParticularesPath,'utf8')
    );
    res.json(data);
  }catch{
    res.json([]);
  }

});


app.post('/api/ventas-particulares', (req,res)=>{

  const body = req.body || [];

  fs.writeFileSync(
    ventasParticularesPath,
    JSON.stringify(body,null,2)
  );

  res.json({ok:true});

});

app.get('/api/debug/data-files', (req, res) => {

  const dir = path.join(__dirname, 'data');

  try {

    const files = fs.readdirSync(dir);

    const result = files.map(f => {

      const full = path.join(dir, f);
      const stat = fs.statSync(full);

      return {
        name: f,
        size: stat.size,
        modified: stat.mtime
      };

    });

    res.json(result);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }

});

app.get('/api/debug/data-files/:name', (req, res) => {

  const filePath = path.join(__dirname, 'data', req.params.name);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Archivo no encontrado');
  }

  res.download(filePath);

});

app.get('/api/debug/codigos', (req, res) => {

  const ml = fs.existsSync(CODIGOS_ML_PATH)
    ? JSON.parse(fs.readFileSync(CODIGOS_ML_PATH))
    : {};

  const jumpseller = fs.existsSync(CODIGOS_JUMPSELLER_PATH)
    ? JSON.parse(fs.readFileSync(CODIGOS_JUMPSELLER_PATH))
    : {};

  res.json({ ml, jumpseller });

});

app.get('/api/cotizaciones-nacional', (req, res) => {

  if (!fs.existsSync(cotizacionesNacionalPath)) {
    return res.json({});
  }

  let data = {};

  try {
    data = JSON.parse(fs.readFileSync(cotizacionesNacionalPath, "utf8"));
  } catch {
    data = {};
  }

  res.json(data);

});

app.post("/api/ml/comisiones", upload.single("archivo"), (req, res) => {

  const filePath = path.join(UPLOAD_DIR, "ml_comisiones.xlsx");

  fs.renameSync(req.file.path, filePath);

  const info = {
    uploadedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(UPLOAD_DIR, "ml_comisiones_info.json"),
    JSON.stringify(info, null, 2)
  );

  res.json({
    message: "Archivo de comisiones cargado",
    uploadedAt: info.uploadedAt
  });

});

app.get("/api/ml/comisiones/ultimo", (req, res) => {

  const filePath = path.join(UPLOAD_DIR, "ml_comisiones.xlsx");

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "No hay archivo de comisiones cargado" });
  }

  res.sendFile(filePath);

});

app.get("/api/ml/comisiones/info", (req, res) => {

  const infoPath = path.join(UPLOAD_DIR, "ml_comisiones_info.json");

  if (!fs.existsSync(infoPath)) {
    return res.status(404).json({ error: "No hay archivo de comisiones cargado" });
  }

  const info = JSON.parse(fs.readFileSync(infoPath,"utf8"));

  res.json(info);

});

/* ============================
   Rutas SPA / Fallback
============================ */

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API endpoint no encontrado" });
  }
  renderWithSidebar(res, path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});