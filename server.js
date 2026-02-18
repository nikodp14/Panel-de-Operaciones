import express from "express";
import path from "path";

const app = express();
const __dirname = new URL('.', import.meta.url).pathname;

app.use(express.static(__dirname));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(3000, () => {
  console.log("Servidor OK en puerto 3000");
});