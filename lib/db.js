// Petite base de données "fait maison" basée sur un simple fichier JSON.
// Suffisant pour un projet perso / une petite communauté ; pas de
// dépendance native à compiler, donc `npm install` fonctionne partout.
//
// Structure du fichier data/db.json :
// {
//   "users": { "<username>": { username, passwordHash, salt, isAdmin,
//                               premiumMode, tier, gems, lives, streak,
//                               history: [...], createdAt } },
//   "tokens": { "<token>": "<username>" },
//   "quizzes": [ { id, title, author, difficulty, format, raw, config,
//                  language, premiumOnly, official, difficultyOverrides,
//                  formatOverrides, createdAt, updatedAt } ],
//   "playlists": [ { id, name, owner, quizIds: [...], createdAt } ]
// }

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const EMPTY_DB = { users: {}, tokens: {}, quizzes: [], playlists: [] };

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY_DB, null, 2));
  }
}

function load() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Object.assign({}, EMPTY_DB, parsed);
  } catch (e) {
    console.error("[memero-backend] Impossible de lire data/db.json, on repart d'une base vide.", e);
    return JSON.parse(JSON.stringify(EMPTY_DB));
  }
}

let cache = load();
let saveTimer = null;

function persist() {
  fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2));
}

// Sauvegarde regroupée (debounce) pour éviter d'écrire le fichier à
// chaque micro-changement si plusieurs requêtes arrivent d'un coup.
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { persist(); } catch (e) { console.error("[memero-backend] Erreur de sauvegarde :", e); }
  }, 50);
}

module.exports = {
  get db() { return cache; },
  save: scheduleSave,
  saveNow: persist,
};
