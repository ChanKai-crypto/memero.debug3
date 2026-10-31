const express = require("express");
const dict = require("../utils/dict");

const router = express.Router();

// GET /api/dict/languages — langues couvertes par les dictionnaires.
router.get("/languages", (req, res) => {
  res.json({ languages: dict.LANGS });
});

// POST /api/dict/translate  { from, to, words: ["chat", "chien", ...] }
// → { results: { chat: ["cat"], chien: ["dog"], ... } } (liste vide = pas trouvé)
router.post("/translate", (req, res) => {
  const { from, to, words } = req.body || {};
  if (!dict.LANGS.includes(from) || !dict.LANGS.includes(to)) {
    return res.status(400).json({ error: "Langues prises en charge : " + dict.LANGS.join(", ") });
  }
  const list = (Array.isArray(words) ? words : []).map((w) => String(w || "").trim()).filter(Boolean).slice(0, 300);
  const results = {};
  for (const w of list) results[w] = dict.translate(w, from, to);
  res.json({ results });
});

// POST /api/dict/check  { question, expected, given, langs?: ["fr","zh"] }
// → { ok: true|false, via?: "translation"|"synonym" }
router.post("/check", (req, res) => {
  const { question, expected, given, langs } = req.body || {};
  if (!question || !given) return res.json({ ok: false });
  res.json(dict.check({ question: String(question).slice(0, 200), expected: String(expected || "").slice(0, 200), given: String(given).slice(0, 200), langs }));
});

module.exports = router;
