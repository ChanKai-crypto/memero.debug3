const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authenticate");
const { toPublicUser } = require("../utils/mappers");
const { hashPassword, verifyPassword } = require("../utils/auth");
const { sendVerificationEmail, generateCode } = require("../utils/email");
const requireAdmin = require("../middleware/requireAdmin");
const G = require("../utils/game");
const D = require("../utils/discounts");

const router = express.Router();

const VALID_TIERS = ["free", "bas", "standard", "plus"];

// GET /api/users/:username/avatar
// Public (pas besoin d'être connecté) : la photo de profil d'un compte,
// et rien d'autre — utilisée pour afficher l'avatar d'un auteur de quiz ou
// d'un propriétaire de parcours, y compris pour quelqu'un qui n'est pas
// soi-même connecté sur cet appareil.
router.get("/:username/avatar", async (req, res, next) => {
  try {
    const avatarUrl = await db.getUserAvatarByUsername(req.params.username);
    res.json({ avatarUrl: avatarUrl || null });
  } catch (e) {
    next(e);
  }
});

// GET /api/users/me
router.get("/me", authenticate(true), (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

// PATCH /api/users/me  { email?, avatarUrl? }
router.patch("/me", authenticate(true), async (req, res, next) => {
  try {
const { email, avatarUrl, preferredLanguage } = req.body || {};
    const patch = {};

    if (typeof email === "string") {
      const trimmed = email.trim();
      // Changer d'adresse (ou en retirer une) invalide la vérification en
      // cours : une nouvelle adresse n'a jamais été prouvée. Un nouveau code
      // est envoyé tout de suite si l'adresse n'est pas vide.
      if (trimmed !== (req.user.email || "")) {
        if (trimmed) {
          const existingEmail = await db.getUserByEmail(trimmed);
          if (existingEmail && existingEmail.id !== req.user.id) {
            return res.status(409).json({ error: "Cette adresse email est déjà utilisée par un autre compte." });
          }
        }
        patch.email = trimmed || null;
        patch.email_verified = false;
        if (trimmed) {
          const code = generateCode();
          patch.email_verification_code = code;
          patch.email_verification_expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          patch.email_verification_last_sent_at = new Date().toISOString();
          await sendVerificationEmail(trimmed, code);
        } else {
          patch.email_verification_code = null;
          patch.email_verification_expires_at = null;
        }
      }
    }
    if (typeof avatarUrl === "string") {
      if (avatarUrl.length > 3_000_000) {
        return res.status(413).json({ error: "Image trop lourde (max ~2 Mo)." });
      }
      if (avatarUrl && !avatarUrl.startsWith("data:image/png")) {
        return res.status(400).json({ error: "Seules les images PNG sont acceptées." });
      }
      patch.avatar_url = avatarUrl || null;
    }

    // Langue du joueur : code ISO de 2 ou 3 lettres (fr, en, fa, ...).
    if (preferredLanguage !== undefined) {
      const l = String(preferredLanguage || "").trim().toLowerCase();
      if (!/^[a-z]{2,3}$/.test(l)) return res.status(400).json({ error: "Langue invalide (code de 2 ou 3 lettres)." });
      patch.preferred_language = l;
    }

    if (!Object.keys(patch).length) return res.json({ user: toPublicUser(req.user) });
    const row = await db.updateUser(req.user.id, patch);
    res.json({ user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// PATCH /me/game
// ⚠️ Démo : le client envoie l'état de jeu calculé de son côté. Avant une
// vraie mise en production, recalcule/valide ces valeurs côté serveur —
// la vraie protection nécessiterait de recalculer le score à partir des
// réponses brutes, pas de faire confiance à ce que le client rapporte.
//
// En attendant, garde-fou ci-dessous : un bond de gemmes ou de score trop
// important en un seul appel (ex. un appel direct à l'API mettant gems à
// 999999999 d'un coup) ne se contente plus d'être refusé — la valeur
// concernée est remise à ZÉRO, comme dissuasion plus forte qu'un simple
// rejet silencieux, et l'incident est journalisé côté serveur pour qu'un
// admin puisse le repérer. Ça n'empêche pas un grignotage lent (petits
// ajouts répétés dans les limites), seulement le cas extrême d'un bond.
/* ---------------------------------------------------------------- anti-triche
 * Les gemmes et le score sont calculés par le site, puis envoyés ici. Pour
 * qu'un tricheur ne puisse pas répéter l'envoi à l'infini, chaque compte a
 * un BUDGET PAR JOUR (heure de Paris) en plus de la limite par envoi :
 *  - gemmes gagnées via la synchro : en vrai, on ne gagne en jouant que
 *    +1 gemme par nouveau quiz officiel terminé (les coffres, la boutique et
 *    les achats Stripe passent directement par le serveur, hors budget).
 *  - score : plafond d'un niveau Expert par envoi, budget large par jour.
 *  - objets (multiplicateurs / jokers) : chaque objet doit être "payé" par
 *    des gemmes dépensées dans le même envoi (≥ 400 gemmes / objet).
 * Au-delà : la hausse est simplement LIMITÉE (rien n'est remis à zéro) et
 * l'incident est noté sur le compte, visible dans le panneau admin.
 */
const MAX_GEMS_DELTA_PER_SYNC = 300;
const DAILY_GEMS_FROM_SYNC = 300;
const MAX_SCORE_DELTA_PER_SYNC = 10_000_000_000; // plafond d'un niveau Expert
const DAILY_SCORE_FROM_SYNC = 50_000_000_000;
const MIN_GEMS_PER_ITEM = 400; // prix le plus bas d'un objet en boutique (450) avec une marge
const DAILY_OFFICIAL_HISTORY = 300; // résultats de quiz officiels enregistrés par jour
const MAX_HISTORY_SCORE = 10_000_000_000;

function acBucket(game) {
  const day = G.dayIndex(new Date());
  const ac = game.ac && typeof game.ac === "object" ? { ...game.ac } : {};
  if (ac.day !== day) {
    ac.day = day;
    ac.gems = 0;
    ac.score = 0;
    ac.hist = 0;
  }
  if (!Array.isArray(ac.flags)) ac.flags = [];
  if (!Number.isFinite(ac.total)) ac.total = 0;
  game.ac = ac;
  return ac;
}
function acFlag(ac, user, kind, asked, allowed) {
  ac.total += 1;
  ac.flags = ac.flags.concat([{ at: new Date().toISOString(), kind, asked, allowed }]).slice(-20);
  console.warn(`⚠️  [anti-triche] ${user.username} (${user.id}) : ${kind} demandé +${asked}, accepté +${allowed}.`);
}
// Numéro de version de l'état de jeu : augmente à CHAQUE changement fait
// par le serveur lui-même (achat de gemmes via Stripe, coffre ouvert,
// coffre journalier, fond acheté…). Si le site renvoie un état basé sur
// une version plus ancienne, ses gemmes / coffres / objets sont ignorés
// (sinon il écraserait, par exemple, des gemmes tout juste achetées).
function bumpRev(game) {
  game.rev = (Number.isFinite(game.rev) ? game.rev : 0) + 1;
  return game;
}
const MAX_ITEMS_DELTA_PER_SYNC = 10; // multiplicateurs / jokers achetés en boutique entre deux synchronisations

router.patch("/me/game", authenticate(true), async (req, res, next) => {
  try {
    const {
      gems,
      lives,
      streak,
      lifetimeScore,
      inventory,
      chestsUnlocked,
      chestsPending,
      chestDailyCounts,
      chestWeeklyLegendary,
      levelProgress,
      playlistProgress,
      stats,
      rev,
    } = req.body || {};
    const current = req.user;
    const game = { ...current.game };
    let anomalyDetected = false;
    const serverRev = Number.isFinite(game.rev) ? game.rev : 0;
    // rev absent = ancien site : on reste tolérant (comportement d'avant)
    const stale = typeof rev === "number" && rev < serverRev;

    const ac = acBucket(game);
    let gemsSpent = 0;
    if (typeof gems === "number" && !stale) {
      const nextGems = Math.max(0, Math.round(gems));
      const currentGems = Number.isFinite(game.gems) ? game.gems : 0;
      const delta = nextGems - currentGems;
      if (delta > 0) {
        const allowed = Math.max(0, Math.min(delta, MAX_GEMS_DELTA_PER_SYNC, DAILY_GEMS_FROM_SYNC - ac.gems));
        if (allowed < delta) {
          acFlag(ac, current, "gemmes", delta, allowed);
          anomalyDetected = true;
        }
        ac.gems += allowed;
        game.gems = currentGems + allowed;
      } else {
        gemsSpent = -delta;
        game.gems = nextGems;
      }
    }
    if (lives && typeof lives === "object") game.lives = { ...game.lives, ...lives };
    if (streak && typeof streak === "object") game.streak = { ...game.streak, ...streak };
    if (typeof lifetimeScore === "number") {
      const nextScore = Math.max(0, Math.round(lifetimeScore));
      const currentScore = Number.isFinite(game.lifetimeScore) ? game.lifetimeScore : 0;
      const delta = nextScore - currentScore;
      // Le score total ne baisse jamais par la synchro (un vieil appareil ne peut pas l'écraser).
      if (delta > 0) {
        const allowed = Math.max(0, Math.min(delta, MAX_SCORE_DELTA_PER_SYNC, DAILY_SCORE_FROM_SYNC - ac.score));
        if (allowed < delta) {
          acFlag(ac, current, "score", delta, allowed);
          anomalyDetected = true;
        }
        ac.score += allowed;
        game.lifetimeScore = currentScore + allowed;
      }
    }
    // Objets : les fonds d'écran ne s'obtiennent QUE par le serveur (coffres,
    // boutique) ; multiplicateurs/jokers : hausse limitée par synchronisation.
    if (inventory && typeof inventory === "object" && !stale) {
      const inv = { ...(game.inventory || {}) };
      // Chaque nouvel objet doit avoir été payé en gemmes dans ce même envoi.
      let paidItems = Math.floor(gemsSpent / MIN_GEMS_PER_ITEM);
      ["multiplier", "joker"].forEach((k) => {
        if (!Number.isFinite(inventory[k])) return;
        const cur = Number.isFinite(inv[k]) ? inv[k] : 0;
        const next = Math.max(0, Math.round(inventory[k]));
        if (next <= cur) { inv[k] = next; return; }
        const allowed = Math.max(0, Math.min(next - cur, MAX_ITEMS_DELTA_PER_SYNC, paidItems));
        paidItems -= allowed;
        if (allowed < next - cur) {
          acFlag(ac, current, k === "joker" ? "jokers" : "multiplicateurs", next - cur, allowed);
          anomalyDetected = true;
        }
        inv[k] = cur + allowed;
      });
      game.inventory = inv;
    }
    // Coffres : plafonds vérifiés ici, toutes sources confondues.
    if (Array.isArray(chestsPending) && !stale) {
      const r = G.reconcilePending(game, chestsPending, chestsUnlocked, Number.isFinite(game.lifetimeScore) ? game.lifetimeScore : 0, new Date());
      game.chestsPending = r.pending;
      game.chestLedger = r.ledger;
      game.chestsUnlocked = r.unlocked;
      if (r.refused > 0) console.warn(`[coffres] ${r.refused} coffre(s) refusé(s) (plafond atteint) pour ${current.username}`);
    }
    if (chestDailyCounts && typeof chestDailyCounts === "object") game.chestDailyCounts = chestDailyCounts;
    if (chestWeeklyLegendary && typeof chestWeeklyLegendary === "object") game.chestWeeklyLegendary = chestWeeklyLegendary;
    // Progression (niveaux, parcours) : n'était jamais enregistrée avant.
    if (levelProgress && typeof levelProgress === "object" && JSON.stringify(levelProgress).length < 400000) game.levelProgress = levelProgress;
    if (playlistProgress && typeof playlistProgress === "object" && JSON.stringify(playlistProgress).length < 100000) game.playlistProgress = playlistProgress;

    const patch = { game };
    if (stats && typeof stats === "object") patch.stats = { ...current.stats, ...stats };

    const row = await db.updateUser(req.user.id, patch);
    res.json({ user: toPublicUser(row), anomalyDetected, staleRev: stale });
  } catch (e) {
    next(e);
  }
});

// POST /api/users/me/daily-chest
// Coffre journalier calculé par le serveur (heure de Paris) : coffre de
// base le 1er jour, coffre RARE à partir de 2 jours d'affilée, et aucun
// coffre le jour où l'on revient après avoir manqué un jour.
router.post("/me/daily-chest", authenticate(true), async (req, res, next) => {
  try {
    const game = { ...req.user.game };
    const d = G.evaluateDailyChest(game, new Date());
    if (d.already) return res.json({ result: null, run: d.state.run || 0, user: toPublicUser(req.user) });
    game.dailyChest = d.state;
    if (d.result === "base" || d.result === "rare") {
      const pending = Array.isArray(game.chestsPending) ? game.chestsPending.slice() : [];
      pending.push(d.result);
      game.chestsPending = pending.slice(0, 60);
    }
    bumpRev(game);
    const row = await db.updateUser(req.user.id, { game });
    res.json({ result: d.result, run: d.run, user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// POST /api/users/me/chests/open  { tier }
// Ouvre un coffre EN ATTENTE : c'est le serveur qui tire les gemmes, les
// objets et l'éventuel fond d'écran (jamais un fond déjà possédé).
router.post("/me/chests/open", authenticate(true), async (req, res, next) => {
  try {
    const tier = String((req.body && req.body.tier) || "");
    if (!G.CHEST_TIERS.includes(tier)) return res.status(400).json({ error: "Coffre invalide." });
    const game = { ...req.user.game };
    const pending = Array.isArray(game.chestsPending) ? game.chestsPending.slice() : [];
    const idx = pending.indexOf(tier);
    if (idx === -1) return res.status(409).json({ error: "Tu n'as pas ce coffre.", user: toPublicUser(req.user) });
    pending.splice(idx, 1);
    const owned = G.ownedSkins(game);
    const r = G.openChestRewards(tier, G.activeTier(req.user), owned);
    const inv = { ...(game.inventory || {}) };
    r.items.forEach((it) => {
      inv[it.kind] = (Number.isFinite(inv[it.kind]) ? inv[it.kind] : 0) + it.n;
    });
    if (r.skin) {
      inv.skins = owned.concat([r.skin]);
      if (G.customById(r.skin)) { await db.incrementCustomSkinOwners(r.skin); G.customById(r.skin).ownersCount++; }
    }
    game.inventory = inv;
    game.gems = (Number.isFinite(game.gems) ? game.gems : 0) + r.gems;
    game.chestsPending = pending;
    bumpRev(game);
    const row = await db.updateUser(req.user.id, { game });
    res.json({ result: { gems: r.gems, items: r.items, skin: r.skin }, user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// GET /api/users/skins/today  (public) : les fonds en vente aujourd'hui
router.get("/skins/today", (req, res) => {
  const now = new Date();
  res.json({
    day: G.dayIndex(now),
    skins: G.skinsOfDay(now).map((s) => {
      const r = s.custom ? G.customEffective(s, now).r : s.r;
      const base = G.skinPrice(s, now);
      const best = D.bestFor("skin", r, now);
      return { id: s.id, rarity: r, basePrice: base, price: best ? D.applyGems(base, best.percent) : base, discount: best ? best.percent : 0, custom: !!s.custom };
    }),
  });
});

// POST /api/users/me/skins/buy  { skinId }
router.post("/me/skins/buy", authenticate(true), async (req, res, next) => {
  try {
    const id = String((req.body && req.body.skinId) || "");
    const skin = G.skinById(id);
    if (!skin) return res.status(400).json({ error: "Fond inconnu." });
    if (!G.skinsOfDay(new Date()).some((s) => s.id === id)) return res.status(409).json({ error: "Ce fond n'est pas en vente aujourd'hui." });
    const game = { ...req.user.game };
    const owned = G.ownedSkins(game);
    if (owned.indexOf(id) !== -1) return res.status(409).json({ error: "Tu as déjà ce fond.", user: toPublicUser(req.user) });
    if (skin.custom && G.customSoldOut(skin)) return res.status(409).json({ error: "Ce fond est épuisé.", user: toPublicUser(req.user) });
    const effR = skin.custom ? G.customEffective(skin).r : skin.r;
    const best = D.bestFor("skin", effR);
    const price = best ? D.applyGems(G.skinPrice(skin), best.percent) : G.skinPrice(skin);
    const gems = Number.isFinite(game.gems) ? game.gems : 0;
    if (gems < price) return res.status(402).json({ error: "Pas assez de gemmes.", user: toPublicUser(req.user) });
    game.gems = gems - price;
    game.inventory = { ...(game.inventory || {}), skins: owned.concat([id]) };
    bumpRev(game);
    const row = await db.updateUser(req.user.id, { game });
    if (skin.custom) { await db.incrementCustomSkinOwners(id); skin.ownersCount = (skin.ownersCount || 0) + 1; }
    if (best) await D.noteUse(best.discount.id);
    res.json({ ok: true, skinId: id, user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// POST /api/users/me/skins/init  { current }
// Une seule fois par compte : les fonds de départ, plus le fond que le
// joueur utilisait déjà (parmi les 8 anciens fonds gratuits).
router.post("/me/skins/init", authenticate(true), async (req, res, next) => {
  try {
    const game = { ...req.user.game };
    if (game.skinsInit) return res.json({ user: toPublicUser(req.user) });
    const owned = G.ownedSkins(game);
    const cur = String((req.body && req.body.current) || "");
    if (G.LEGACY_SKINS.indexOf(cur) !== -1 && owned.indexOf(cur) === -1) owned.push(cur);
    game.inventory = { ...(game.inventory || {}), skins: owned };
    game.skinsInit = true;
    bumpRev(game);
    const row = await db.updateUser(req.user.id, { game });
    res.json({ user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// POST /api/users/me/subscribe  { tier: "bas"|"standard"|"plus"|"free" }
// ⚠️ DÉMO SANS PAIEMENT : voir README, section "Aller plus loin" pour
// brancher une vraie vérification Google Play Billing / Stripe.
// ⚠️ Réservé aux ADMINS : sans ça, n'importe qui pouvait s'offrir
// Memerro Ultra gratuitement avec un simple appel à l'API. Les vrais
// abonnements passent par Stripe (/api/billing/checkout + webhook).
router.post("/me/subscribe", authenticate(true), requireAdmin, async (req, res, next) => {
  try {
    const { tier } = req.body || {};
    if (!VALID_TIERS.includes(tier)) {
      return res.status(400).json({ error: "Palier d'abonnement invalide." });
    }

    const now = new Date().toISOString();
    const subscription = {
      ...req.user.subscription,
      tier,
      status: tier === "free" ? "inactive" : "active",
      startedAt: tier === "free" ? null : now,
      renewsAt: null,
      provider: "demo",
      providerTransactionId: null,
    };

    const patch = { subscription };
    if (tier === "plus") {
      patch.game = {
        ...req.user.game,
        lives: { count: 6, lastLossAt: null },
      };
    }

    const row = await db.updateUser(req.user.id, patch);
    res.json({ user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// POST /api/users/me/history  (une entrée d'historique de partie)
router.post("/me/history", authenticate(true), async (req, res, next) => {
  try {
    const raw = req.body || {};
    if (!raw || typeof raw !== "object") {
      return res.status(400).json({ error: "Entrée d'historique invalide." });
    }
    // Seuls les champs connus sont gardés, avec des valeurs plausibles.
    const num = (v, max) => (Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : null);
    const entry = {
      id: raw.id != null ? String(raw.id).slice(0, 80) : null,
      title: String(raw.title || "Quiz").slice(0, 150),
      username: req.user.username,
      date: Number.isFinite(raw.date) ? raw.date : Date.now(),
      score: num(raw.score, MAX_HISTORY_SCORE) || 0,
      correct: num(raw.correct, 100000),
      wrong: num(raw.wrong, 100000),
      avgResponseMs: num(raw.avgResponseMs, 3600000),
      durationMs: num(raw.durationMs, 86400000 * 3),
      masteryPct: num(raw.masteryPct, 100),
      totalQuestions: num(raw.totalQuestions, 100000),
      official: false,
      receivedAt: new Date().toISOString(),
    };
    // "Officiel" (classement des quiz officiels) : vérifié par le serveur,
    // jamais cru sur parole, et limité en nombre par jour.
    const game = { ...(req.user.game || {}) };
    const ac = acBucket(game);
    if (raw.official && entry.id) {
      const quiz = await db.getQuizById(entry.id).catch(() => null);
      if (quiz && quiz.official) {
        if (ac.hist < DAILY_OFFICIAL_HISTORY) {
          entry.official = true;
          ac.hist += 1;
        } else {
          acFlag(ac, req.user, "résultats officiels", 1, 0);
        }
      }
    }
    const history = Array.isArray(req.user.history) ? req.user.history.slice() : [];
    history.push(entry);
    if (history.length > 500) history.splice(0, history.length - 500);

    const row = await db.updateUser(req.user.id, { history, game });
    res.status(201).json({ user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// GET /api/users/me/playlists
router.get("/me/playlists", authenticate(true), async (req, res, next) => {
  try {
    const playlists = await db.getUserPlaylists(req.user.id);
    res.json({ playlists });
  } catch (e) {
    next(e);
  }
});

// PUT /api/users/me/playlists  { playlists: [...] }
router.put("/me/playlists", authenticate(true), async (req, res, next) => {
  try {
    const { playlists, deletedIds } = req.body || {};
    if (!Array.isArray(playlists)) {
      return res.status(400).json({ error: "playlists doit être un tableau." });
    }
    // Limite par abonnement : gratuit 4, Plus/Max 40, Ultra illimité.
    // On ne supprime jamais rien : on refuse seulement d'en AJOUTER au-delà.
    const limit = G.playlistLimitFor(req.user);
    if (playlists.length > limit) {
      const existing = await db.getUserPlaylists(req.user.id);
      if (playlists.length > Math.max(limit, existing.length)) {
        return res.status(403).json({ error: `Limite de ${limit} parcours atteinte pour ton abonnement.`, limit });
      }
    }
    const updated = await db.replaceUserPlaylists(req.user.id, req.user.username, playlists, Array.isArray(deletedIds) ? deletedIds : []);
    res.json({ playlists: updated });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/users/me/password  { currentPassword, newPassword }
router.patch("/me/password", authenticate(true), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Mot de passe actuel et nouveau mot de passe requis." });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 6 caractères." });
    }
    if (!verifyPassword(currentPassword, req.user.password_hash)) {
      return res.status(401).json({ error: "Mot de passe actuel incorrect." });
    }

    await db.updateUser(req.user.id, { password_hash: hashPassword(newPassword) });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/users/me  { password }  (le compte doit confirmer son mot de passe)
router.delete("/me", authenticate(true), async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password || !verifyPassword(password, req.user.password_hash)) {
      return res.status(401).json({ error: "Mot de passe incorrect." });
    }
    await db.deleteUser(req.user.id, req.user.id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

module.exports = router;
