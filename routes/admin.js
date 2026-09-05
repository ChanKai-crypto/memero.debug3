const express = require("express");
const { db, save } = require("../lib/db");
const { requireAuth, requireAdmin, publicUser } = require("../lib/auth");

const router = express.Router();

// Liste des comptes (réservé aux admins) — utile pour choisir qui promouvoir.
router.get("/admin/users", requireAuth, requireAdmin, (req, res) => {
  res.json(Object.values(db.users).map(publicUser));
});

router.post("/admin/promote", requireAuth, requireAdmin, (req, res) => {
  const username = String((req.body && req.body.username) || "").trim();
  const user = db.users[username];
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
  user.isAdmin = true;
  save();
  res.json(publicUser(user));
});

router.post("/admin/demote", requireAuth, requireAdmin, (req, res) => {
  const username = String((req.body && req.body.username) || "").trim();
  const user = db.users[username];
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
  if (username === req.user.username) {
    return res.status(400).json({ error: "Impossible de te retirer ton propre statut Admin ici." });
  }
  user.isAdmin = false;
  save();
  res.json(publicUser(user));
});

module.exports = router;
