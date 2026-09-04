require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/users.routes");
const quizRoutes = require("./routes/quizzes.routes");
const adminRoutes = require("./routes/admin.routes");
const leaderboardRoutes = require("./routes/leaderboard.routes");

const app = express();

const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(
  cors({
    origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((s) => s.trim()),
  })
);
app.use(express.json({ limit: "3mb" })); // 3mb pour laisser passer les photos de profil en base64

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "memero-backend", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/leaderboard", leaderboardRoutes);

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
