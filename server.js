require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./src/routes/auth");
const userRoutes = require("./src/routes/users");
const quizRoutes = require("./src/routes/quizzes");
const adminRoutes = require("./src/routes/admin");

const app = express();

// L'app Memero appelle ce serveur depuis une WebView Android (origine "null")
// et potentiellement depuis un navigateur classique : pas de cookies utilisés
// (authentification par jeton Bearer), donc autoriser toutes les origines est
// sûr ici et évite les soucis de CORS spécifiques à file:// / capacitor://.
app.use(cors());
app.use(express.json({ limit: "2mb" })); // quiz longs (raw) possibles

app.get("/", (req, res) => {
  res.json({ name: "memero-backend", status: "ok" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/admin", adminRoutes);

// 404 générique pour toute route /api/* non reconnue
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Route inconnue." });
});

// Gestionnaire d'erreurs générique : toujours renvoyer du JSON, jamais de page HTML
// (le client attend systématiquement res.json() côté app).
app.use((err, req, res, next) => {
  console.error("[memero-backend] erreur non gérée :", err);
  res.status(500).json({ error: "Erreur serveur." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[memero-backend] démarré sur le port ${PORT}`);
});

module.exports = app;
