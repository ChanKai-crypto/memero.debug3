const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/leaderboard?limit=20
// Public : classement des joueurs par score cumulé (game.lifetimeScore).
router.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const board = await db.listLeaderboard(limit);
    res.json({ leaderboard: board });
  } catch (e) {
    next(e);
  }
});

// GET /api/leaderboard/official?limit=50
// Public : meilleurs scores individuels réalisés sur des quiz officiels,
// tous joueurs et tous quiz confondus (une ligne par partie jouée, pas par
// joueur — un même joueur peut apparaître plusieurs fois s'il a plusieurs
// bons scores sur des quiz officiels différents).
router.get("/official", async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const board = await db.listOfficialScores(limit);
    res.json({ leaderboard: board });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
