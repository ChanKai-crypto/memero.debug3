const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/playlists
// Public : l'annuaire de tous les parcours marqués publics, tous comptes
// confondus. Ceux marqués privés (private: true) ne sont jamais renvoyés
// ici, quel que soit le compte qui interroge (y compris son propriétaire —
// il les retrouve via son propre compte, pas via cette route).
router.get("/", async (req, res, next) => {
  try {
    const playlists = await db.listPublicPlaylists();
    res.json({ playlists });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
