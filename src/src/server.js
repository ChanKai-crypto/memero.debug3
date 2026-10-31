require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { authLimiter, generalLimiter } = require("./middleware/rateLimit");

const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/users.routes");
const quizRoutes = require("./routes/quizzes.routes");
const adminRoutes = require("./routes/admin.routes");
const leaderboardRoutes = require("./routes/leaderboard.routes");
const billingRoutes = require("./routes/billing.routes");
const playlistsRoutes = require("./routes/playlists.routes");

const app = express();

// Render (et la plupart des hébergeurs) placent le serveur derrière un
// proxy inverse : sans ce réglage, express-rate-limit verrait l'IP du
// proxy pour TOUT LE MONDE (la même pour chaque visiteur), et limiterait
// tout le monde ensemble au lieu de chacun séparément.
app.set("trust proxy", 1);

const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(
  cors({
    origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((s) => s.trim()),
  })
);

// ⚠️ Le webhook Stripe a besoin du corps BRUT (non parsé en JSON) pour
// vérifier la signature d'authenticité — il doit donc être monté AVANT le
// express.json() global ci-dessous, avec son propre middleware express.raw().
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "3mb" })); // 3mb pour laisser passer les photos de profil en base64

// Pages légales (Conditions d'utilisation / Politique de confidentialité,
// FR et EN) : fichiers HTML statiques, accessibles par exemple à
// https://ton-service.onrender.com/legal/terms-fr.html — c'est vers ces
// adresses que pointe la case à cocher obligatoire de l'inscription côté
// app. Pas besoin de passer par une route API pour ça : ce sont de simples
// pages à consulter dans un navigateur.
app.use("/legal", express.static(path.join(__dirname, "../public/legal")));

// Limite générale sur toute l'API (voir middleware/rateLimit.js), puis une
// limite plus stricte spécifiquement sur les routes d'authentification
// (connexion, inscription, mot de passe oublié), où la force brute est le
// vrai risque.
app.use("/api", generalLimiter);
app.use("/api/auth", authLimiter);

// Marqueur de version : change à chaque livraison du backend, pour
// pouvoir vérifier EN UNE SECONDE si le serveur en ligne tourne bien sur
// la dernière version livrée (au lieu de deviner) — ouvre simplement
// https://ton-service.onrender.com/api/health dans un navigateur et
// compare "backendVersion" à la valeur indiquée dans la réponse de Claude.
const BACKEND_VERSION = "2026-09-28-1";

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "memero-backend", backendVersion: BACKEND_VERSION, time: new Date().toISOString() });
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
