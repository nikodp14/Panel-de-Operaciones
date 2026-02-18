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
  fs.mkdirSync(UPLOAD_DIR);
}

const upload = multer({ dest: UPLOAD_DIR });

// Archivos estáticos
app.use(express.static(__dirname));

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
   Rutas SPA / Fallback
============================ */

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(3000, () => {
  console.log("Servidor OK en puerto 3000");
});
