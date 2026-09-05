const express = require("express");
const { db, save } = require("../lib/db");
const { requireAuth } = require("../lib/auth");

const router = express.Router();

// Les parcours sont privés : on ne renvoie que ceux du compte connecté
// (ou tous, si Admin, pour modération).
router.get("/playlists", requireAuth, (req, res) => {
  const mine = db.playlists.filter((p) => p.owner === req.user.username || req.user.isAdmin);
  res.json(mine);
});

router.post("/playlists", requireAuth, (req, res) => {
  const name = String((req.body && req.body.name) || "Nouveau parcours").slice(0, 120);
  const mineCount = db.playlists.filter((p) => p.owner === req.user.username).length;
  const limit = req.user.premiumMode ? 40 : 4;
  if (mineCount >= limit) {
    return res.status(403).json({ error: `Limite de ${limit} parcours atteinte.` });
  }
  const playlist = {
    id: "pl" + Date.now() + Math.floor(Math.random() * 1000),
    name,
    owner: req.user.username,
    quizIds: [],
    createdAt: Date.now(),
  };
  db.playlists.push(playlist);
  save();
  res.status(201).json(playlist);
});

// Remplace en bloc TOUS les parcours du compte connecté (utilisé par la
// synchronisation automatique du frontend). Les parcours des autres
// comptes ne sont jamais touchés par cet appel.
router.put("/playlists", requireAuth, (req, res) => {
  const incoming = Array.isArray(req.body && req.body.playlists) ? req.body.playlists : [];
  const limit = req.user.premiumMode ? 40 : 4;
  const mine = incoming.slice(0, limit).map((p) => ({
    id: String(p.id || ("pl" + Date.now() + Math.floor(Math.random() * 1000))),
    name: String(p.name || "Parcours").slice(0, 120),
    owner: req.user.username,
    quizIds: Array.isArray(p.quizIds) ? p.quizIds.map(String) : [],
    createdAt: p.createdAt || Date.now(),
  }));
  db.playlists = db.playlists.filter((p) => p.owner !== req.user.username).concat(mine);
  save();
  res.json(mine);
});

function findOwnedPlaylist(req, res) {
  const playlist = db.playlists.find((p) => p.id === req.params.id);
  if (!playlist) { res.status(404).json({ error: "Parcours introuvable." }); return null; }
  if (playlist.owner !== req.user.username && !req.user.isAdmin) {
    res.status(403).json({ error: "Ce parcours ne t'appartient pas." }); return null;
  }
  return playlist;
}

router.delete("/playlists/:id", requireAuth, (req, res) => {
  const playlist = findOwnedPlaylist(req, res);
  if (!playlist) return;
  db.playlists = db.playlists.filter((p) => p.id !== req.params.id);
  save();
  res.json({ ok: true });
});

router.post("/playlists/:id/quizzes", requireAuth, (req, res) => {
  const playlist = findOwnedPlaylist(req, res);
  if (!playlist) return;
  const quizId = String((req.body && req.body.quizId) || "");
  if (quizId && playlist.quizIds.indexOf(quizId) === -1) playlist.quizIds.push(quizId);
  save();
  res.json(playlist);
});

router.delete("/playlists/:id/quizzes/:quizId", requireAuth, (req, res) => {
  const playlist = findOwnedPlaylist(req, res);
  if (!playlist) return;
  playlist.quizIds = playlist.quizIds.filter((id) => id !== req.params.quizId);
  save();
  res.json(playlist);
});

module.exports = router;
