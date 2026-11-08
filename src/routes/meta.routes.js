// Informations publiques légères sur le contenu du serveur.
const express = require("express");
const db = require("../db");

const router = express.Router();
let cache = null, cacheAt = 0;

// GET /api/meta/languages : les langues dans lesquelles il existe déjà du
// contenu (quiz, parcours publics, arbres). Sert au choix « Ma langue ».
router.get("/languages", async (req, res, next) => {
  try {
    if (!cache || Date.now() - cacheAt > 5 * 60 * 1000) {
      const set = new Set();
      const add = (rows, cols) => (rows || []).forEach((r) => cols.forEach((c) => { const v = r && r[c]; if (v && /^[a-z]{2,3}$/.test(String(v))) set.add(String(v)); }));
      const [q, p, t] = await Promise.all([
        db.supabase.from("quizzes").select("language, instruction_language").limit(10000),
        db.supabase.from("playlists").select("language, instruction_language").eq("private", false).limit(10000),
        db.supabase.from("learn_trees").select("language").limit(1000),
      ]);
      add(q.data, ["language", "instruction_language"]);
      add(p.data, ["language", "instruction_language"]);
      add(t.data, ["language"]);
      cache = Array.from(set).sort();
      cacheAt = Date.now();
    }
    res.set("Cache-Control", "public, max-age=300");
    res.json({ languages: cache });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
