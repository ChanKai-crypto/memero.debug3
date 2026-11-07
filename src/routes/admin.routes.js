const { hashPassword } = require("../utils/auth");
const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authenticate");
const requireAdmin = require("../middleware/requireAdmin");
const { toPublicUser, toPublicQuiz } = require("../utils/mappers");

const router = express.Router();

// Toutes les routes ci-dessous nécessitent d'être connecté ET administrateur.
router.use(authenticate(true), requireAdmin);

function isSuperadmin(user) {
  return !!user && !!user.protected;
}

// Un compte protégé (indicateur "protected" en base, mis en place via
// scripts/seedAdmin.js — voir supabase-schema.sql) reste un admin tout à
// fait normal pour le reste de l'app (même rôle "admin", donc tous les
// droits admin sans exception), mais ne peut être modifié — rôle,
// bannissement, mot de passe, suppression — que par lui-même ou par un
// autre compte protégé. Un admin "normal" ne peut pas y toucher.
function blockedFromModifyingSuperadmin(req, res, target) {
  if (target.protected && !isSuperadmin(req.user)) {
    res.status(403).json({ error: "Ce compte est protégé (Pilier) : seul un autre compte protégé peut le modifier." });
    return true;
  }
  return false;
}

// GET /api/admin/users
router.get("/users", async (req, res, next) => {
  try {
    const rows = await db.listUsers();
    res.json({ users: rows.map(toPublicUser) });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/users/:id/password  { newPassword }
// Sert de "mot de passe oublié" : sans service d'envoi d'email configuré,
// c'est l'admin qui fixe un nouveau mot de passe pour un compte bloqué,
// à communiquer ensuite au joueur par un autre moyen (message, en personne...).
router.patch("/users/:id/password", async (req, res, next) => {
  try {
    const target = await db.getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: "Compte introuvable." });
    if (blockedFromModifyingSuperadmin(req, res, target)) return;

    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 6 caractères." });
    }

    await db.updateUser(req.params.id, { password_hash: hashPassword(newPassword) });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/users/:id   { role?, subscriptionTier?, gems?, banned? }
router.patch("/users/:id", async (req, res, next) => {
  try {
    const target = await db.getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: "Compte introuvable." });
    if (blockedFromModifyingSuperadmin(req, res, target)) return;

    const { role, subscriptionTier, gems, banned } = req.body || {};
    const patch = {};

    if (role && ["user", "admin"].includes(role)) patch.role = role;
    if (subscriptionTier && ["free", "bas", "standard", "plus"].includes(subscriptionTier)) {
      patch.subscription = {
        ...target.subscription,
        tier: subscriptionTier,
        status: subscriptionTier === "free" ? "inactive" : "active",
      };
    }
    if (typeof gems === "number") {
      patch.game = { ...target.game, gems: Math.max(0, Math.round(gems)) };
    }
    if (typeof banned === "boolean") patch.banned = banned;

    const row = await db.updateUser(req.params.id, patch);
    res.json({ user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "Tu ne peux pas supprimer ton propre compte admin ici." });
    }
    const target = await db.getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: "Compte introuvable." });
    if (blockedFromModifyingSuperadmin(req, res, target)) return;

    await db.deleteUser(req.params.id, req.user.id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/playlists (tous, y compris privés, avec le propriétaire)
router.get("/playlists", async (req, res, next) => {
  try {
    const playlists = await db.listAllPlaylistsAdmin();
    res.json({ playlists });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/playlists/:id  { official?, guided?, learnSectionId?, learnSectionOrder? }
router.patch("/playlists/:id", async (req, res, next) => {
  try {
    const { official, guided, learnSectionId, learnSectionOrder } = req.body || {};
    const patch = {};
    if (typeof official === "boolean") patch.official = official;
    if (typeof guided === "boolean") patch.guided = guided;
    // Connecte ce parcours à une section Apprendre (string) ou le
    // déconnecte (null) — un parcours connecté disparaît de l'affichage
    // individuel et rejoint sa section à la place.
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "learnSectionId")) {
      patch.learnSectionId = learnSectionId || null;
    }
    // Position dans l'affichage de sa section (éditeur de mise en page).
    if (Number.isFinite(learnSectionOrder)) patch.learnSectionOrder = learnSectionOrder;
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "Au moins un champ 'official', 'guided', 'learnSectionId' ou 'learnSectionOrder' est requis." });
    }
    const result = await db.setPlaylistFields(req.params.id, patch);
    if (!result) return res.status(404).json({ error: "Parcours introuvable." });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// === Arbres (un par thème : sujet + style visuel) ===
// Fonds proposés pour un arbre (l'app les traduit en dégradés).
const LEARN_TREE_BACKGROUNDS = ["default", "foret", "ocean", "desert", "nuit", "aurore", "ardoise"];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Code de langue ISO 639-1 / 639-2 (2 ou 3 lettres), ou "" pour toutes les langues.
const LEARN_TREE_LANGUAGE_RE = /^([a-z]{2,3})?$/;

function validateTreeBody(body, partial) {
  const out = {};
  const b = body || {};
  if (b.name !== undefined || !partial) {
    if (!b.name || !String(b.name).trim()) return { error: "Le nom de l'arbre est requis." };
    out.name = String(b.name).trim().slice(0, 80);
  }
  if (b.subject !== undefined) out.subject = String(b.subject || "").trim().slice(0, 80);
  if (b.emoji !== undefined) {
    const e = String(b.emoji || "").trim();
    if (!e || e.length > 16) return { error: "Icône invalide." };
    out.emoji = e;
  }
  if (b.color !== undefined) {
    if (!HEX_COLOR.test(String(b.color))) return { error: "Couleur invalide (format #RRGGBB attendu)." };
    out.color = String(b.color);
  }
  if (b.background !== undefined) {
    if (!LEARN_TREE_BACKGROUNDS.includes(b.background)) return { error: "Fond invalide. Choisis parmi : " + LEARN_TREE_BACKGROUNDS.join(", ") };
    out.background = b.background;
  }
  // Langue des joueurs qui voient cet arbre ("" = toutes les langues).
  if (b.language !== undefined) {
    const l = String(b.language || "");
    if (!LEARN_TREE_LANGUAGE_RE.test(l)) return { error: "Langue invalide (code de 2 ou 3 lettres, ou vide pour toutes)." };
    out.language = l;
  }
  if (Number.isFinite(b.sortOrder)) out.sortOrder = b.sortOrder;
  return { patch: out };
}

// GET /api/admin/learn-trees
router.get("/learn-trees", async (req, res, next) => {
  try {
    const trees = await db.listLearnTrees();
    res.json({ trees, backgrounds: LEARN_TREE_BACKGROUNDS });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/learn-trees  { name, subject?, emoji?, color?, background?, sortOrder? }
router.post("/learn-trees", async (req, res, next) => {
  try {
    const v = validateTreeBody(req.body, false);
    if (v.error) return res.status(400).json({ error: v.error });
    const tree = await db.createLearnTree({ id: require("crypto").randomUUID(), ...v.patch });
    res.json(tree);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/learn-trees/:id  { name?, subject?, emoji?, color?, background?, sortOrder? }
router.patch("/learn-trees/:id", async (req, res, next) => {
  try {
    const v = validateTreeBody(req.body, true);
    if (v.error) return res.status(400).json({ error: v.error });
    const tree = await db.updateLearnTree(req.params.id, v.patch);
    if (!tree) return res.status(404).json({ error: "Arbre introuvable." });
    res.json(tree);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/learn-trees/:id — supprime aussi ses sections ; les
// parcours qu'elles contenaient ne sont pas supprimés (juste "hors section").
router.delete("/learn-trees/:id", async (req, res, next) => {
  try {
    await db.deleteLearnTree(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// === Sections (regroupent plusieurs parcours entiers, dans un arbre) ===
// Catégories prédéfinies que l'admin peut choisir en créant une section —
// chacune avec son émoticône fixe ; le nom affiché reste personnalisable.
const LEARN_SECTION_CATEGORIES = {
  premiers_pas: "👣",
  grammaire: "📐",
  conjugaison: "🔤",
  vocabulaire: "🏡",
  politesse: "🤝",
  ecoute: "👂",
  lecture: "📖",
};

// GET /api/admin/learn-sections
router.get("/learn-sections", async (req, res, next) => {
  try {
    const sections = await db.listLearnSections();
    res.json({ sections, categories: LEARN_SECTION_CATEGORIES });
  } catch (e) {
    next(e);
  }
});

// Icône libre d'une section (remplace celle de la catégorie si fournie) :
// utile pour les arbres dont le sujet n'est pas une langue.
function cleanEmoji(v) {
  const e = String(v || "").trim();
  return e && e.length <= 16 ? e : null;
}

// POST /api/admin/learn-sections  { treeId, category, name, emoji?, unlockThreshold?, sortOrder?, itemsPerRow? }
router.post("/learn-sections", async (req, res, next) => {
  try {
    const { treeId, category, name, emoji, unlockThreshold, sortOrder, itemsPerRow } = req.body || {};
    if (!treeId || !(await db.getLearnTree(String(treeId)))) {
      return res.status(400).json({ error: "Arbre introuvable : choisis l'arbre dans lequel créer la section." });
    }
    if (!category || !Object.prototype.hasOwnProperty.call(LEARN_SECTION_CATEGORIES, category)) {
      return res.status(400).json({ error: "Catégorie invalide. Choisis parmi : " + Object.keys(LEARN_SECTION_CATEGORIES).join(", ") });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Le nom de la section est requis." });
    }
    const section = await db.createLearnSection({
      id: require("crypto").randomUUID(),
      treeId: String(treeId),
      category,
      name: String(name).trim(),
      emoji: cleanEmoji(emoji) || LEARN_SECTION_CATEGORIES[category],
      itemsPerRow,
      unlockThreshold: unlockThreshold || { type: "count", value: 1 },
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    });
    res.json(section);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/learn-sections/:id  { treeId?, name?, category?, emoji?, unlockThreshold?, sortOrder?, itemsPerRow? }
router.patch("/learn-sections/:id", async (req, res, next) => {
  try {
    const { category, emoji, treeId } = req.body || {};
    const patch = { ...req.body };
    delete patch.emoji;
    if (category) {
      if (!Object.prototype.hasOwnProperty.call(LEARN_SECTION_CATEGORIES, category)) {
        return res.status(400).json({ error: "Catégorie invalide." });
      }
      patch.emoji = LEARN_SECTION_CATEGORIES[category];
    }
    if (emoji !== undefined) {
      const e = cleanEmoji(emoji);
      if (!e) return res.status(400).json({ error: "Icône invalide." });
      patch.emoji = e;
    }
    if (treeId !== undefined) {
      if (!treeId || !(await db.getLearnTree(String(treeId)))) return res.status(400).json({ error: "Arbre introuvable." });
      patch.treeId = String(treeId);
    }
    const section = await db.updateLearnSection(req.params.id, patch);
    if (!section) return res.status(404).json({ error: "Section introuvable." });
    res.json(section);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/learn-sections/:id
router.delete("/learn-sections/:id", async (req, res, next) => {
  try {
    await db.deleteLearnSection(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/playlists/:id
router.delete("/playlists/:id", async (req, res, next) => {
  try {
    const removed = await db.deletePlaylist(req.params.id, req.user.id);
    if (!removed) return res.status(404).json({ error: "Parcours introuvable." });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/quizzes (tous, y compris premiumOnly, sans restriction)
router.get("/quizzes", async (req, res, next) => {
  try {
    const rows = await db.listQuizzes();
    res.json({ quizzes: rows.map(toPublicQuiz) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/quizzes/:id
router.delete("/quizzes/:id", async (req, res, next) => {
  try {
    const existing = await db.getQuizById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Quiz introuvable." });
    await db.deleteQuiz(req.params.id, req.user.id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/quizzes/:id  { premiumOnly?, official? }
router.patch("/quizzes/:id", async (req, res, next) => {
  try {
    const existing = await db.getQuizById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Quiz introuvable." });

    const { premiumOnly, official } = req.body || {};
    const patch = { updated_at: new Date().toISOString() };
    if (typeof premiumOnly === "boolean") patch.premium_only = premiumOnly;
    if (typeof official === "boolean") patch.official = official;

    const row = await db.updateQuiz(req.params.id, patch);
    res.json({ quiz: toPublicQuiz(row) });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ Fonds
 * Fonds d'écran ajoutés par l'admin (image jpg/png envoyée en base64,
 * déjà redimensionnée par le site). Spécificités : rareté, prix, nombre
 * max de joueurs, période (toute l'année / chaque année du JJ/MM au JJ/MM /
 * entre deux dates), et ce qui se passe après la période.
 */
const G = require("../utils/game");
const { reloadCustomSkins } = require("../utils/customSkins");
const { publicSkin } = require("./skins.routes");
const RARITIES = ["commun", "rare", "epique", "legendaire"];
const MAX_IMAGE_CHARS = 2.6 * 1024 * 1024; // ~1,9 Mo d'image

function slugSkinId(name) {
  const base = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20) || "fond";
  return "c_" + base;
}
function cleanMD(v) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(v || "").trim());
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}
function cleanDate(v) {
  if (!v) return null;
  const t = new Date(v);
  return isNaN(t.getTime()) ? null : t.toISOString();
}

// GET /api/admin/skins : tous les fonds admin (même désactivés)
router.get("/skins", async (req, res, next) => {
  try {
    const list = await reloadCustomSkins();
    const now = new Date();
    res.json({ skins: list.map((c) => ({ ...publicSkin(c, now), active: c.active })) });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/skins : crée ou modifie un fond
// { id?, name, rarity, price?, maxOwners?, availType, from?, to?, startsAt?, endsAt?, afterEnd, inShop, inChests, active, image? }
router.post("/skins", async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: "Donne un nom au fond." });
    const existingList = await reloadCustomSkins();
    let id = b.id ? String(b.id) : null;
    const editing = id && existingList.some((c) => c.id === id);
    if (!editing) {
      const base = slugSkinId(name);
      id = base;
      const letters = "abcdefghijklmnopqrstuvwxyz";
      let n = 0;
      while (existingList.some((c) => c.id === id) || G.SKIN_BY_ID[id]) {
        id = base + "_" + letters[n % 26] + (n >= 26 ? letters[Math.floor(n / 26) % 26] : "");
        n++;
      }
    }
    if (!/^c_[a-z_]{1,28}$/.test(id)) return res.status(400).json({ error: "Identifiant de fond invalide." });
    const image = b.image ? String(b.image) : null;
    if (!editing && !image) return res.status(400).json({ error: "Ajoute une image (jpg ou png)." });
    if (image) {
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return res.status(400).json({ error: "L'image doit être un fichier jpg ou png." });
      if (image.length > MAX_IMAGE_CHARS) return res.status(413).json({ error: "Image trop lourde (2 Mo max)." });
    }
    const availType = ["always", "yearly", "dates"].includes(b.availType) ? b.availType : "always";
    const row = {
      id,
      name,
      rarity: RARITIES.includes(b.rarity) ? b.rarity : "commun",
      price: Number.isFinite(Number(b.price)) && b.price !== "" && b.price !== null ? Math.max(0, Math.round(Number(b.price))) : null,
      max_owners: Number(b.maxOwners) > 0 ? Math.round(Number(b.maxOwners)) : null,
      avail_type: availType,
      from_md: availType === "yearly" ? cleanMD(b.from) : null,
      to_md: availType === "yearly" ? cleanMD(b.to) : null,
      starts_at: availType === "dates" ? cleanDate(b.startsAt) : null,
      ends_at: availType === "dates" ? cleanDate(b.endsAt) : null,
      // Après la période (un fond obtenu n'est JAMAIS retiré aux joueurs) :
      after_end: ["reactivate", "change"].includes(b.afterEnd) ? b.afterEnd : "unavailable",
      react_at: b.afterEnd === "reactivate" ? cleanDate(b.reactAt) : null,
      after_price: b.afterEnd === "change" && b.afterPrice !== "" && b.afterPrice !== null && Number.isFinite(Number(b.afterPrice)) ? Math.max(0, Math.round(Number(b.afterPrice))) : null,
      after_rarity: b.afterEnd === "change" && RARITIES.includes(b.afterRarity) ? b.afterRarity : null,
      in_shop: b.inShop !== false,
      in_chests: b.inChests !== false,
      active: b.active !== false,
    };
    if (availType === "yearly" && (!row.from_md || !row.to_md)) return res.status(400).json({ error: "Indique le début et la fin de la période (JJ/MM)." });
    if (availType === "dates" && !row.starts_at && !row.ends_at) return res.status(400).json({ error: "Indique au moins une date de début ou de fin." });
    if (row.after_end === "reactivate" && !row.react_at) return res.status(400).json({ error: "Indique la date de réactivation." });
    if (image) row.image = image;
    if (!editing) {
      row.owners_count = 0;
      row.created_at = new Date().toISOString();
    }
    const saved = await db.upsertCustomSkin(row);
    await reloadCustomSkins();
    res.json({ skin: { ...publicSkin(saved, new Date()), active: saved.active } });
  } catch (e) {
    if (/custom_skins/.test(e.message || "")) return res.status(500).json({ error: "La table custom_skins n'existe pas encore : lance le fichier SQL de migration dans Supabase." });
    next(e);
  }
});

// DELETE /api/admin/skins/:id (copie gardée dans la corbeille)
router.delete("/skins/:id", async (req, res, next) => {
  try {
    await db.deleteCustomSkin(String(req.params.id), req.user.id);
    await reloadCustomSkins();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* -------------------------------------------------------------- Corbeille */
// GET /api/admin/trash : les 200 derniers éléments supprimés
router.get("/trash", async (req, res, next) => {
  try {
    const rows = await db.listTrash(200);
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        itemId: r.item_id,
        name: (r.data && (r.data.name || r.data.title || r.data.username)) || r.item_id,
        deletedBy: r.deleted_by,
        deletedAt: r.deleted_at,
        restoredAt: r.restored_at,
      })),
    });
  } catch (e) {
    if (/deleted_items/.test(e.message || "")) return res.json({ items: [], missingTable: true });
    next(e);
  }
});

// POST /api/admin/trash/:id/restore : remet l'élément en place
router.post("/trash/:id/restore", async (req, res, next) => {
  try {
    const item = await db.restoreTrash(req.params.id);
    if (!item) return res.status(404).json({ error: "Élément introuvable dans la corbeille." });
    if (item.kind === "custom_skin") await reloadCustomSkins();
    if (item.kind === "discount") await D.reloadDiscounts();
    res.json({ ok: true, kind: item.kind, itemId: item.item_id });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------- Réductions */
const D = require("../utils/discounts");
const PLAN_IDS = ["bas", "standard", "plus"];
const PACK_IDS = ["petit", "moyen", "grand", "mega"];
function pickList(v, allowed) {
  return Array.isArray(v) ? v.filter((x) => allowed.includes(x)) : [];
}

// GET /api/admin/discounts
router.get("/discounts", async (req, res, next) => {
  try {
    const list = await D.reloadDiscounts();
    const now = new Date();
    res.json({ discounts: list.map((d) => ({ ...D.publicDiscount(d, now), active: d.active, showCode: d.showCode, rawCode: d.code, maxUses: d.maxUses, usesCount: d.usesCount })) });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/discounts : crée ou modifie une réduction
router.post("/discounts", async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: "Donne un nom à la réduction." });
    const percent = Math.round(Number(b.percent));
    if (!(percent >= 1 && percent <= 90)) return res.status(400).json({ error: "La réduction doit être entre 1 et 90 %." });
    const t = b.targets || {};
    const targets = { plans: pickList(t.plans, PLAN_IDS), gems: pickList(t.gems, PACK_IDS), skins: pickList(t.skins, RARITIES) };
    if (!targets.plans.length && !targets.gems.length && !targets.skins.length) return res.status(400).json({ error: "Choisis au moins une chose à réduire." });
    const availType = ["always", "yearly", "dates"].includes(b.availType) ? b.availType : "always";
    const afterEnd = ["reactivate", "change"].includes(b.afterEnd) ? b.afterEnd : "unavailable";
    const duration = ["once", "repeating", "forever"].includes(b.duration) ? b.duration : "once";
    const code = b.showCode ? String(b.code || "").trim().toUpperCase() : "";
    if (b.showCode && !/^[A-Z0-9]{3,20}$/.test(code)) return res.status(400).json({ error: "Le code promo doit faire 3 à 20 lettres ou chiffres (ex. NOEL20)." });
    const row = {
      id: b.id ? String(b.id) : require("crypto").randomUUID(),
      name,
      percent,
      targets,
      max_uses: Number(b.maxUses) > 0 ? Math.round(Number(b.maxUses)) : null,
      avail_type: availType,
      from_md: availType === "yearly" ? cleanMD(b.from) : null,
      to_md: availType === "yearly" ? cleanMD(b.to) : null,
      starts_at: availType === "dates" ? cleanDate(b.startsAt) : null,
      ends_at: availType === "dates" ? cleanDate(b.endsAt) : null,
      after_end: afterEnd,
      react_at: afterEnd === "reactivate" ? cleanDate(b.reactAt) : null,
      after_percent: afterEnd === "change" && Number(b.afterPercent) >= 1 && Number(b.afterPercent) <= 90 ? Math.round(Number(b.afterPercent)) : null,
      duration,
      duration_months: duration === "repeating" ? Math.max(1, Math.min(36, Math.round(Number(b.durationMonths) || 1))) : null,
      show_code: !!b.showCode,
      code: code || null,
      extra_text: String(b.text || "").trim().slice(0, 200),
      active: b.active !== false,
    };
    if (availType === "yearly" && (!row.from_md || !row.to_md)) return res.status(400).json({ error: "Indique le début et la fin de la période (JJ/MM)." });
    if (availType === "dates" && !row.starts_at && !row.ends_at) return res.status(400).json({ error: "Indique au moins une date de début ou de fin." });
    if (afterEnd === "reactivate" && !row.react_at) return res.status(400).json({ error: "Indique la date de réactivation." });
    if (afterEnd === "change" && !row.after_percent) return res.status(400).json({ error: "Indique le nouveau pourcentage après la période." });
    if (!b.id) {
      row.uses_count = 0;
      row.created_at = new Date().toISOString();
      row.stripe_coupons = {};
    }
    const saved = await db.upsertDiscount(row);
    await D.reloadDiscounts();
    res.json({ discount: D.publicDiscount(saved, new Date()) });
  } catch (e) {
    if (/discounts/.test(e.message || "")) return res.status(500).json({ error: "La table discounts n'existe pas encore : lance le fichier SQL de migration dans Supabase." });
    next(e);
  }
});

// DELETE /api/admin/discounts/:id
router.delete("/discounts/:id", async (req, res, next) => {
  try {
    await db.deleteDiscount(String(req.params.id), req.user.id);
    await D.reloadDiscounts();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/* ---------------------------------------------------------------- Système
 * Vérifie la configuration (sans jamais renvoyer les valeurs secrètes) :
 * clés Stripe, prix de chaque offre, webhook, emails, tables Supabase.
 */
router.get("/system", async (req, res, next) => {
  try {
    const env = process.env;
    const has = (k) => !!(env[k] && String(env[k]).trim());
    const key = env.STRIPE_SECRET_KEY || "";
    const plans = {};
    [["bas", "PLUS"], ["standard", "MAX"], ["plus", "ULTRA"]].forEach(([tier, name]) => {
      plans[tier] = { month: has(`STRIPE_PRICE_${name}_MONTHLY`), year: has(`STRIPE_PRICE_${name}_YEARLY`) };
    });
    const gems = {};
    ["moyen", "grand", "mega"].forEach((p) => { gems[p] = has(`STRIPE_PRICE_GEMS_${p.toUpperCase()}`); });
    const tables = {};
    for (const tname of ["deleted_items", "custom_skins", "discounts"]) {
      const { error } = await db.supabase.from(tname).select("id").limit(1);
      tables[tname] = !error;
    }
    const { error: qtErr } = await db.supabase.from("custom_skins").select("react_at").limit(1);
    tables["custom_skins (colonnes 09/11)"] = !qtErr;
    res.json({
      backendVersion: require("../server.version"),
      uptimeSec: Math.round(process.uptime()),
      region: env.RENDER_REGION || null,
      stripe: {
        key: !key ? "absente" : key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : "inconnue",
        webhookSecret: has("STRIPE_WEBHOOK_SECRET"),
        plans,
        gems,
      },
      email: { resend: has("RESEND_API_KEY") },
      frontendUrl: env.FRONTEND_URL || null,
      tables,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
