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

module.exports = router;
