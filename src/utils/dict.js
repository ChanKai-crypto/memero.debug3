/**
 * « IA dictionnaire » locale : traductions et vérification de réponses à
 * partir des dictionnaires libres rangés dans data/dicts (construits par
 * scripts/build-dicts.py). Aucun service externe : tout tourne sur le
 * serveur, à partir des fichiers du dépôt GitHub.
 *
 * L'anglais sert de langue pivot : fr→ru = fr→en puis en→ru.
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "..", "data", "dicts");
const LANGS = ["fr", "en", "es", "ru", "ar", "zh"];
const MAX = 8;
const cache = {};

const ARTICLES = {
  en: ["to ", "a ", "an ", "the "],
  fr: ["le ", "la ", "les ", "l'", "un ", "une ", "des ", "se ", "s'"],
  es: ["el ", "la ", "los ", "las ", "un ", "una ", "se "],
};

/** Même normalisation que scripts/build-dicts.py (à garder synchronisées). */
function norm(s, lang) {
  let t = String(s == null ? "" : s).normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/’/g, "'");
  t = t.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  t = t.replace(/[^\p{L}\p{N}_' -]+/gu, " ");
  t = t.replace(/\s+/g, " ").replace(/^[ '-]+|[ '-]+$/g, "");
  for (const a of ARTICLES[lang] || []) {
    if (t.startsWith(a) && t.length > a.length + 1) { t = t.slice(a.length); break; }
  }
  return t.trim();
}

function load(from, to) {
  const key = `${from}-${to}`;
  if (key in cache) return cache[key];
  const file = path.join(DIR, `${key}.json`);
  try {
    cache[key] = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    cache[key] = null; // paire absente : on renverra simplement « rien trouvé »
  }
  return cache[key];
}

function lookup(word, from, to) {
  const d = load(from, to);
  if (!d) return [];
  return d[norm(word, from)] || [];
}

/** Traductions de `word` de la langue `from` vers `to` (les plus probables d'abord). */
function translate(word, from, to) {
  if (!LANGS.includes(from) || !LANGS.includes(to)) return [];
  if (from === to) return [String(word)];
  if (from === "en" || to === "en") return lookup(word, from, to).slice(0, MAX);
  const out = [];
  const seen = new Set();
  // Pivot par l'anglais : on garde l'ordre (sens principal d'abord).
  const ens = lookup(word, from, "en").slice(0, 4);
  for (let round = 0; round < 3 && out.length < MAX; round++) {
    for (const en of ens) {
      const t = lookup(en, "en", to)[round];
      if (!t) continue;
      const k = norm(t, to);
      if (!seen.has(k)) { seen.add(k); out.push(t); }
      if (out.length >= MAX) break;
    }
  }
  return out;
}

/** Langues dans lesquelles `word` est connu du dictionnaire. */
function detect(word) {
  return LANGS.filter((l) => (l === "en" ? !!lookup(word, "en", "fr").length || !!lookup(word, "en", "zh").length : !!lookup(word, l, "en").length));
}

/**
 * Mots anglais « proches » : le mot lui-même + ce qu'on retrouve en faisant
 * l'aller-retour par le russe et le français (house → дом → home…).
 * Sert à reconnaître les synonymes ; volontairement limité pour rester fiable.
 */
function expandEn(words) {
  const out = new Set();
  for (const w of words.slice(0, 4)) {
    const k = norm(w, "en");
    if (!k) continue;
    out.add(k);
    for (const via of ["ru", "fr"]) {
      for (const x of lookup(w, "en", via).slice(0, 2)) {
        for (const back of lookup(x, via, "en").slice(0, 3)) out.add(norm(back, "en"));
      }
    }
  }
  return [...out].filter(Boolean);
}

/** Toutes les façons acceptables de dire `word` (langue `from`) en langue `to`. */
function acceptable(word, from, to) {
  const set = new Set();
  if (from === to) return set;
  const ens = from === "en" ? [word] : lookup(word, from, "en").slice(0, 4);
  const pivots = expandEn(ens);
  for (const e of pivots) {
    if (to === "en") set.add(e);
    else for (const t of lookup(e, "en", to).slice(0, 6)) set.add(norm(t, to));
  }
  if (from !== "en") for (const t of translate(word, from, to)) set.add(norm(t, to));
  return set;
}

/**
 * La réponse tapée `given` est-elle juste, même si ce n'est pas exactement
 * la réponse attendue ? Juste si :
 *   • c'est une autre traduction de la question (ex. « maison » → « home »
 *     au lieu de « house ») ;
 *   • ou c'est un synonyme de la réponse attendue (même sens via l'anglais).
 */
function check({ question, expected, given, langs }) {
  const g = String(given || "").trim();
  if (!g) return { ok: false };
  const tryLangs = (Array.isArray(langs) ? langs : []).filter((l) => LANGS.includes(l));
  const fromCands = tryLangs.length ? tryLangs : detect(question);
  const toCands = tryLangs.length ? tryLangs : detect(expected).concat(detect(given));
  for (const from of fromCands) {
    for (const to of new Set(toCands)) {
      if (to === from) continue;
      const ng = norm(g, to);
      if (ng && acceptable(question, from, to).has(ng)) return { ok: true, via: "translation", from, to };
    }
  }
  // Synonyme de la réponse attendue, dans sa propre langue.
  for (const l of new Set(tryLangs.length ? tryLangs : detect(expected))) {
    const ng = norm(g, l), ne = norm(expected, l);
    if (!ng || ng === ne) continue;
    const ens = l === "en" ? [expected] : lookup(expected, l, "en").slice(0, 3);
    const pivots = expandEn(ens);
    const syn = new Set(l === "en" ? pivots : pivots.flatMap((e) => lookup(e, "en", l).slice(0, 6).map((t) => norm(t, l))));
    if (syn.has(ng)) return { ok: true, via: "synonym", lang: l };
  }
  return { ok: false };
}

module.exports = { LANGS, norm, translate, check, detect };
