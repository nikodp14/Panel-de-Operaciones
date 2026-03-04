import express from "express";
import path from "path";
import multer from "multer";
import fs from "fs";
import { fileURLToPath } from "url";
const app = express();

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

app.get("/api/debug-storage", (req, res) => {
  const dataPath = path.join(__dirname, "data");

  res.json({
    uploadDir: dataPath,
    exists: fs.existsSync(dataPath),
    files: fs.existsSync(dataPath)
      ? fs.readdirSync(dataPath)
      : []
  });
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

app.post("/api/ml/ventas/codigos", express.json(), (req, res) => {
  const { key, codigo, cambioProducto } = req.body;

  if (!key) {
    return res.status(400).json({ error: "key requerida (venta|publicacion)" });
  }

  let data = {};
  if (fs.existsSync(CODIGOS_ML_PATH)) {
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(CODIGOS_ML_PATH, "utf-8"));
    } catch {
      data = {};
    }
  }

  data[key] = {
    codigo: codigo || "",
    cambioProducto: !!cambioProducto,
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(CODIGOS_ML_PATH, JSON.stringify(data, null, 2));
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

app.post("/api/ml/ventas", upload.single("archivo"), (req, res) => {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const finalName = `ventas_ml_${ts}.xlsx`;
  const finalPath = path.join(UPLOAD_DIR, finalName);

  fs.renameSync(req.file.path, finalPath);

  const meta = { file: finalName, uploadedAt: now.toISOString() };
  fs.writeFileSync(
    path.join(UPLOAD_DIR, "ventas_ml_meta.json"),
    JSON.stringify(meta, null, 2)
  );

  res.json({ message: "Ventas ML cargadas correctamente", ...meta });
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

app.post("/api/odoo/ventas", upload.single("archivo"), (req, res) => {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const finalName = `ventas_odoo_${ts}.xlsx`;
  const finalPath = path.join(UPLOAD_DIR, finalName);

  fs.renameSync(req.file.path, finalPath);

  const meta = { file: finalName, uploadedAt: now.toISOString() };
  fs.writeFileSync(
    path.join(UPLOAD_DIR, "ventas_odoo_meta.json"),
    JSON.stringify(meta, null, 2)
  );

  res.json({ message: "Ventas Odoo cargadas correctamente", ...meta });
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

app.get("/ventas/validar-ventas.html", (req, res) => {
  renderWithSidebar(res, path.join(__dirname, "ventas", "validar-ventas.html"));
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

/* ============================
   Endpoints Variantes Odoo
============================ */

// Info del último archivo
app.get("/api/odoo/variantes/info", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "variantes_meta.json");
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No hay Variantes Odoo cargadas aún" });
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  res.json(meta);
});

// Descargar último archivo
app.get("/api/odoo/variantes/ultimo", (req, res) => {
  const metaPath = path.join(UPLOAD_DIR, "variantes_meta.json");
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

// Subir archivo
app.post("/api/odoo/variantes", upload.single("archivo"), (req, res) => {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");

  const timestamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const finalName = `variantes_odoo_${timestamp}.xlsx`;
  const finalPath = path.join(UPLOAD_DIR, finalName);

  fs.renameSync(req.file.path, finalPath);

  const meta = { file: finalName, uploadedAt: now.toISOString() };
  fs.writeFileSync(
    path.join(UPLOAD_DIR, "variantes_meta.json"),
    JSON.stringify(meta, null, 2)
  );

  res.json({
    message: "Variantes Odoo cargadas correctamente ✔",
    file: finalName,
    uploadedAt: meta.uploadedAt,
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