/**
 * Règles de jeu vérifiées CÔTÉ SERVEUR (le navigateur ne peut plus tricher) :
 *   - plafonds de coffres (par jour / par semaine), toutes sources confondues
 *   - coffre journalier (série de jours)
 *   - ouverture des coffres (gemmes, objets, fonds d'écran)
 *   - fonds d'écran à collectionner, Boutique du jour, fonds de saison
 *
 * ⚠️ Le catalogue des fonds et l'algorithme « fonds du jour » doivent rester
 * IDENTIQUES à ceux du site (script « memerro-skins-daily » dans index.html),
 * sinon le site et le serveur n'afficheraient pas les mêmes fonds du jour.
 */

const TIMEZONE = "Europe/Paris";

// Multiplicateurs par abonnement (mêmes valeurs que TIERS côté site)
const TIER_MULT = {
  free: { gain: 1, item: 1 },
  bas: { gain: 1.5, item: 2 },
  standard: { gain: 3, item: 3 },
  plus: { gain: 4, item: 4 },
};

const CHEST_TIERS = ["base", "rare", "epic", "legendaire"];
const CHEST_REWARDS = {
  base: { gemsMin: 20, gemsMax: 60, itemChance: 0.3, itemMax: 1 },
  rare: { gemsMin: 80, gemsMax: 180, itemChance: 0.5, itemMax: 2 },
  epic: { gemsMin: 250, gemsMax: 500, itemChance: 0.7, itemMax: 3 },
  legendaire: { gemsMin: 800, gemsMax: 1500, itemChance: 1, itemMax: 5 },
};
// Coffres gagnés en jouant (score de fin de partie + niveaux officiels)
const DAILY_CAP = { base: 10, rare: 4, epic: 2 };
const LEGENDARY_WEEKLY_CAP = 1;
// Coffres « à vie » quand le score cumulé franchit un palier (une seule fois chacun)
const LIFETIME_THRESHOLDS = { base: 50000, rare: 500000, epic: 1000000, legendaire: 10000000 };
const MAX_PENDING = 60; // un compte ne peut pas stocker plus de coffres non ouverts

/* --------------------------------------------------------------- dates */
function parisYMD(d) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d || new Date());
  const [y, m, day] = s.split("-").map(Number);
  return { y, m, d: day };
}
function dayIndex(date) {
  const p = parisYMD(date);
  return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
}
function weekIndex(date) {
  // semaines commençant le lundi (jour 0 = jeudi 1er janvier 1970)
  return Math.floor((dayIndex(date) + 3) / 7);
}

/* --------------------------------------------------------------- fonds */
const RARITY = {
  commun: { price: 300, w: 6, rank: 0 },
  rare: { price: 800, w: 3, rank: 1 },
  epique: { price: 1800, w: 1.5, rank: 2 },
  legendaire: { price: 4000, w: 0.6, rank: 3 },
};
const CHEST_MAX_RANK = { base: 0, rare: 1, epic: 2, legendaire: 3 };
const CHEST_SKIN_CHANCE = { base: 0.06, rare: 0.15, epic: 0.35, legendaire: 0.8 };
const STARTER_SKINS = ["none", "nature"];
// Fonds qui existaient (gratuits) avant la collection : un joueur garde celui qu'il utilisait.
const LEGACY_SKINS = ["espace", "nature", "ciel", "lagune", "coucher", "aurore", "volcan", "desert"];
// MÊME ORDRE et MÊMES raretés que sur le site.
const SKINS = [
  { id: "none", r: "commun" },
  { id: "nature", r: "commun" },
  { id: "ciel", r: "commun" },
  { id: "lagune", r: "commun" },
  { id: "glacier", r: "commun" },
  { id: "desert", r: "rare" },
  { id: "coucher", r: "rare" },
  { id: "espace", r: "rare" },
  { id: "bonbon", r: "rare" },
  { id: "aurore", r: "epique" },
  { id: "volcan", r: "epique" },
  { id: "neon", r: "epique" },
  { id: "galaxie", r: "legendaire" },
  { id: "or", r: "legendaire" },
  { id: "halloween", r: "epique", season: [10, 15, 11, 2] },
  { id: "noel", r: "epique", season: [12, 1, 12, 31] },
  { id: "nouvel_an", r: "legendaire", season: [12, 26, 1, 7] },
  { id: "valentin", r: "rare", season: [2, 7, 2, 16] },
  { id: "paques", r: "rare", season: [3, 25, 4, 21] },
  { id: "ete", r: "rare", season: [6, 21, 8, 31] },
];
const SKIN_BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]));

function inSeason(skin, date) {
  if (!skin.season) return true;
  const p = parisYMD(date);
  const v = p.m * 100 + p.d;
  const a = skin.season[0] * 100 + skin.season[1];
  const b = skin.season[2] * 100 + skin.season[3];
  return a <= b ? v >= a && v <= b : v >= a || v <= b;
}

function weightedPick(arr, rnd) {
  const tot = arr.reduce((a, x) => a + x.w, 0);
  let r = (rnd || Math.random)() * tot;
  for (let i = 0; i < arr.length; i++) {
    if (r < arr[i].w) return arr[i].s;
    r -= arr[i].w;
  }
  return arr.length ? arr[arr.length - 1].s : null;
}
// Générateur pseudo-aléatoire : copie EXACTE de celui du site.
function seeded(seed) {
  return function () {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}
/** Les fonds en vente aujourd'hui (identiques pour tous) : 3 fonds + ceux de la saison en cours. */
function skinsOfDay(date) {
  const rnd = seeded(dayIndex(date) * 7919 + 17);
  let pool = SKINS.filter((s) => s.id !== "none" && !s.season && STARTER_SKINS.indexOf(s.id) === -1).map((s) => ({ s, w: RARITY[s.r].w }));
  const out = [];
  while (out.length < 3 && pool.length) {
    const p = weightedPick(pool, rnd);
    out.push(p);
    pool = pool.filter((x) => x.s !== p);
  }
  SKINS.forEach((s) => {
    if (s.season && inSeason(s, date)) out.unshift(s);
  });
  return out;
}

function ownedSkins(game) {
  const inv = (game && game.inventory) || {};
  const set = new Set(STARTER_SKINS);
  (Array.isArray(inv.skins) ? inv.skins : []).forEach((id) => {
    if (SKIN_BY_ID[id]) set.add(id);
  });
  return Array.from(set);
}

function rollSkinDrop(tier, owned, rnd) {
  const r = rnd || Math.random;
  const chance = CHEST_SKIN_CHANCE[tier] || 0;
  const max = CHEST_MAX_RANK[tier];
  if (max === undefined || r() >= chance) return null;
  const pool = SKINS.filter((s) => s.id !== "none" && inSeason(s) && owned.indexOf(s.id) === -1 && RARITY[s.r].rank <= max).map((s) => ({
    s,
    w: RARITY[s.r].w * (s.season ? 2.5 : 1),
  }));
  const pick = weightedPick(pool, r);
  return pick ? pick.id : null;
}

/* --------------------------------------------------------------- coffres */
function countTiers(list) {
  const c = { base: 0, rare: 0, epic: 0, legendaire: 0 };
  (Array.isArray(list) ? list : []).forEach((t) => {
    if (c[t] !== undefined) c[t]++;
  });
  return c;
}

/** Ledger serveur des coffres gagnés en jouant (jour / semaine). */
function freshLedger(game, now) {
  const today = dayIndex(now);
  const week = weekIndex(now);
  const l = Object.assign({ day: today, base: 0, rare: 0, epic: 0, week, legendaire: 0 }, (game && game.chestLedger) || {});
  if (l.day !== today) Object.assign(l, { day: today, base: 0, rare: 0, epic: 0 });
  if (l.week !== week) Object.assign(l, { week, legendaire: 0 });
  return l;
}

/**
 * Le site envoie sa liste de coffres non ouverts. On n'accepte un NOUVEAU
 * coffre que s'il reste de la place dans les plafonds du jour/de la semaine,
 * ou s'il correspond à un palier de score cumulé franchi pour la 1re fois.
 * Les coffres disparus (ouverts) sont simplement retirés.
 */
function reconcilePending(serverGame, clientPending, clientUnlocked, lifetimeScore, now) {
  const before = Array.isArray(serverGame.chestsPending) ? serverGame.chestsPending.filter((t) => CHEST_TIERS.includes(t)) : [];
  const want = countTiers(clientPending);
  const have = countTiers(before);
  const ledger = freshLedger(serverGame, now);
  const unlocked = Array.isArray(serverGame.chestsUnlocked) ? serverGame.chestsUnlocked.slice() : [];

  // paliers de score cumulé franchis pour la première fois
  const lifetimeBonus = { base: 0, rare: 0, epic: 0, legendaire: 0 };
  (Array.isArray(clientUnlocked) ? clientUnlocked : []).forEach((t) => {
    if (LIFETIME_THRESHOLDS[t] !== undefined && unlocked.indexOf(t) === -1 && lifetimeScore >= LIFETIME_THRESHOLDS[t]) {
      unlocked.push(t);
      lifetimeBonus[t]++;
    }
  });

  const result = [];
  let refused = 0;
  CHEST_TIERS.forEach((t) => {
    const keep = Math.min(have[t], want[t]); // coffres déjà connus du serveur et toujours là
    let add = Math.max(0, want[t] - have[t]);
    let granted = 0;
    // d'abord les paliers de score cumulé
    const fromLifetime = Math.min(add, lifetimeBonus[t]);
    granted += fromLifetime;
    add -= fromLifetime;
    // puis les plafonds du jour / de la semaine
    if (add > 0) {
      const room = t === "legendaire" ? Math.max(0, LEGENDARY_WEEKLY_CAP - ledger.legendaire) : Math.max(0, (DAILY_CAP[t] || 0) - (ledger[t] || 0));
      const ok = Math.min(add, room);
      if (t === "legendaire") ledger.legendaire += ok;
      else ledger[t] = (ledger[t] || 0) + ok;
      granted += ok;
      refused += add - ok;
    }
    for (let i = 0; i < keep + granted; i++) result.push(t);
  });
  return { pending: result.slice(0, MAX_PENDING), ledger, unlocked, refused };
}

/** Coffre journalier : base le 1er jour, RARE à partir de 2 jours d'affilée, rien le jour d'un retour après un jour manqué. */
function evaluateDailyChest(game, now) {
  const today = dayIndex(now);
  const st = Object.assign({}, (game && game.dailyChest) || {});
  if (st.last === today) return { already: true, state: st };
  let result;
  if (typeof st.last !== "number") {
    st.run = 1;
    result = "base";
  } else {
    const gap = today - st.last;
    if (gap <= 0) return { already: true, state: st };
    if (gap === 1) {
      st.run = (st.run || 0) + 1;
      result = st.run >= 2 ? "rare" : "base";
    } else {
      st.run = 0;
      result = "missed";
    }
  }
  st.last = today;
  st.lastResult = result;
  return { already: false, result, run: st.run || 0, state: st };
}

/** Ouvre un coffre : gemmes, objets (multiplicateur / joker) et peut-être un fond manquant. */
function openChestRewards(tier, subscriptionTier, owned, rnd) {
  const r = rnd || Math.random;
  const conf = CHEST_REWARDS[tier] || CHEST_REWARDS.base;
  const mult = TIER_MULT[subscriptionTier] || TIER_MULT.free;
  const gems = Math.round((conf.gemsMin + r() * (conf.gemsMax - conf.gemsMin)) * mult.gain);
  const items = [];
  if (r() < conf.itemChance) {
    const n = Math.round((1 + Math.floor(r() * conf.itemMax)) * mult.item);
    const kind = r() < 0.5 ? "multiplier" : "joker";
    items.push({ kind, n });
  }
  const skin = rollSkinDrop(tier, owned, r);
  return { gems, items, skin };
}

function activeTier(user) {
  const sub = user && user.subscription;
  if (!sub || sub.status === "inactive") return "free";
  return TIER_MULT[sub.tier] ? sub.tier : "free";
}

/** Nombre max de parcours personnels : gratuit 4, Plus/Max 40, Ultra illimité (admins aussi). */
function playlistLimitFor(user) {
  if (user && user.role === "admin") return Infinity;
  const t = activeTier(user);
  if (t === "plus") return Infinity;
  if (t === "bas" || t === "standard") return 40;
  return 4;
}

module.exports = {
  CHEST_TIERS,
  RARITY,
  SKINS,
  SKIN_BY_ID,
  STARTER_SKINS,
  LEGACY_SKINS,
  dayIndex,
  inSeason,
  skinsOfDay,
  ownedSkins,
  reconcilePending,
  freshLedger,
  evaluateDailyChest,
  openChestRewards,
  activeTier,
  playlistLimitFor,
  countTiers,
};
