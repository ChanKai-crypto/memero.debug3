const express = require("express");
const path = require("path");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const quizzesRoutes = require("./routes/quizzes");
const playlistsRoutes = require("./routes/playlists");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json({ limit: "2mb" }));

// CORS "fait maison" : autorise l'app Memero (servie depuis n'importe
// quelle origine — fichier local, GitHub Pages, autre domaine...) à
// appeler ce serveur.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, name: "memero-backend", time: Date.now() });
});

app.use("/api", authRoutes);
app.use("/api", adminRoutes);
app.use("/api", quizzesRoutes);
app.use("/api", playlistsRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Route inconnue." });
});

// Gestionnaire d'erreurs générique (évite qu'une exception dans une route
// ne fasse planter tout le serveur).
app.use((err, req, res, next) => {
  console.error("[memero-backend] Erreur :", err);
  res.status(500).json({ error: "Erreur serveur." });
});

app.listen(PORT, () => {
  console.log(`Memero backend démarré sur http://localhost:${PORT}`);
  console.log(`  -> Renseigne cette adresse dans l'app, dans Compte > Serveur.`);
});
