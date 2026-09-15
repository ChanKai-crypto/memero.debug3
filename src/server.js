require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/users.routes");
const quizRoutes = require("./routes/quizzes.routes");
const adminRoutes = require("./routes/admin.routes");
const leaderboardRoutes = require("./routes/leaderboard.routes");
const billingRoutes = require("./routes/billing.routes");
const playlistsRoutes = require("./routes/playlists.routes");

const app = express();

const corsOrigin = process.env.CORS_ORIGIN || "*";
const corsOptions = {
  origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((s) => s.trim()),
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ⚠️ Le webhook Stripe a besoin du corps BRUT (non parsé en JSON) pour
// vérifier la signature d'authenticité — il doit donc être monté AVANT le
// express.json() global ci-dessous, avec son propre middleware express.raw().
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "3mb" })); // 3mb pour laisser passer les photos de profil en base64

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "memero-backend", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/playlists", playlistsRoutes);

// 404 générique pour toute route API inconnue
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Route API inconnue." });
});

// Gestion d'erreur générique (évite de crasher le process sur une erreur non prévue)
app.use((err, req, res, next) => {
  console.error("[server] Erreur non gérée :", err);
  res.status(500).json({ error: "Erreur serveur." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Memero backend démarré sur le port ${PORT}`);
});

module.exports = app;
