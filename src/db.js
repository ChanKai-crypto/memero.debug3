/**
 * Couche d'acces aux donnees, branchee sur Supabase (Postgres).
 * Toutes les fonctions gardent la meme signature que la version MySQL :
 * aucun fichier de routes n'a besoin de changer si on rebascule un jour.
 */
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "\u274c SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent etre definies (voir .env.example)."
  );
}

function throwIfError(error, context) {
  if (error) {
    const err = new Error(`[${context}] ${error.message}`);
    err.cause = error;
    throw err;
  }
}

/* -------------------------------- Corbeille ---------------------------------
 * Avant TOUTE suppression (quiz, parcours, arbre, section, compte), une copie
 * complète est rangée dans la table deleted_items : rien n'est jamais perdu
 * définitivement, un admin peut tout restaurer (voir /api/admin/trash).
 * Si la table n'existe pas encore (migration pas lancée), la suppression
 * continue normalement.
 */
async function trash(kind, rows, deletedBy) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  if (!list.length) return;
  const { error } = await supabase.from("deleted_items").insert(
    list.map((r) => ({ kind, item_id: String(r.id), data: r, deleted_by: deletedBy || null }))
  );
  if (error) console.warn(`[corbeille] copie impossible (${kind}) : ${error.message}`);
}

async function listTrash(limit) {
  const { data, error } = await supabase
    .from("deleted_items")
    .select("id, kind, item_id, data, deleted_by, deleted_at, restored_at")
    .order("deleted_at", { ascending: false })
    .limit(limit || 200);
  throwIfError(error, "listTrash");
  return data || [];
}

const TRASH_TABLE = { quiz: "quizzes", playlist: "playlists", learn_tree: "learn_trees", learn_section: "learn_sections", custom_skin: "custom_skins", user: "users", discount: "discounts" };
async function restoreTrash(trashId) {
  const { data: item, error } = await supabase.from("deleted_items").select("*").eq("id", trashId).maybeSingle();
  throwIfError(error, "restoreTrash:get");
  if (!item) return null;
  const table = TRASH_TABLE[item.kind];
  if (!table) throw new Error("Ce type d'élément ne peut pas être restauré automatiquement.");
  const { error: upErr } = await supabase.from(table).upsert(item.data, { onConflict: "id" });
  throwIfError(upErr, "restoreTrash:upsert");
  await supabase.from("deleted_items").update({ restored_at: new Date().toISOString() }).eq("id", trashId);
  if (item.kind === "quiz" || item.kind === "playlist") await refreshHiddenQuizzes();
  return item;
}

/* ------------------------- Fonds ajoutés par l'admin ------------------------- */
function toCustomSkin(row) {
  if (!row) return null;
  return {
    id: row.id,
    custom: true,
    name: row.name || row.id,
    r: row.rarity || "commun",
    price: Number.isFinite(row.price) ? row.price : null,
    maxOwners: Number.isFinite(row.max_owners) && row.max_owners > 0 ? row.max_owners : null,
    ownersCount: Number.isFinite(row.owners_count) ? row.owners_count : 0,
    avail: {
      type: row.avail_type || "always",
      from: row.from_md || null,
      to: row.to_md || null,
      startsAt: row.starts_at || null,
      endsAt: row.ends_at || null,
    },
    // Les anciennes valeurs "keep"/"remove" deviennent "unavailable" (un fond obtenu n'est jamais perdu).
    afterEnd: ["reactivate", "change"].includes(row.after_end) ? row.after_end : "unavailable",
    reactAt: row.react_at || null,
    afterPrice: Number.isFinite(row.after_price) ? row.after_price : null,
    afterRarity: row.after_rarity || null,
    inShop: row.in_shop !== false,
    inChests: row.in_chests !== false,
    active: row.active !== false,
    version: row.updated_at ? new Date(row.updated_at).getTime() : 0,
  };
}
const CUSTOM_SKIN_COLS = "id, name, rarity, price, max_owners, owners_count, avail_type, from_md, to_md, starts_at, ends_at, after_end, react_at, after_price, after_rarity, in_shop, in_chests, active, created_at, updated_at";
const CUSTOM_SKIN_COLS_V1 = "id, name, rarity, price, max_owners, owners_count, avail_type, from_md, to_md, starts_at, ends_at, after_end, in_shop, in_chests, active, created_at, updated_at";
async function listCustomSkins() {
  let { data, error } = await supabase.from("custom_skins").select(CUSTOM_SKIN_COLS).order("created_at", { ascending: true });
  if (error && /react_at|after_price|after_rarity/.test(error.message || "")) {
    // Migration du 9/11 pas encore lancée : on lit sans les nouvelles colonnes.
    ({ data, error } = await supabase.from("custom_skins").select(CUSTOM_SKIN_COLS_V1).order("created_at", { ascending: true }));
  }
  if (error) {
    // Table pas encore créée : aucun fond admin, sans planter le serveur.
    if (/custom_skins/.test(error.message || "")) return [];
    throwIfError(error, "listCustomSkins");
  }
  return (data || []).map(toCustomSkin);
}
async function getCustomSkinImage(id) {
  const { data, error } = await supabase.from("custom_skins").select("image, updated_at").eq("id", id).maybeSingle();
  throwIfError(error, "getCustomSkinImage");
  return data;
}
async function upsertCustomSkin(row) {
  let { data, error } = await supabase.from("custom_skins").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "id" }).select(CUSTOM_SKIN_COLS).single();
  if (error && /react_at|after_price|after_rarity|after_end_check/.test(error.message || "")) {
    const old = { ...row };
    delete old.react_at; delete old.after_price; delete old.after_rarity;
    old.after_end = "keep";
    ({ data, error } = await supabase.from("custom_skins").upsert({ ...old, updated_at: new Date().toISOString() }, { onConflict: "id" }).select(CUSTOM_SKIN_COLS_V1).single());
  }
  throwIfError(error, "upsertCustomSkin");
  return toCustomSkin(data);
}
async function deleteCustomSkin(id, deletedBy) {
  const { data: before } = await supabase.from("custom_skins").select("*").eq("id", id);
  await trash("custom_skin", before || [], deletedBy);
  const { error } = await supabase.from("custom_skins").delete().eq("id", id);
  throwIfError(error, "deleteCustomSkin");
}
async function incrementCustomSkinOwners(id) {
  const { data } = await supabase.from("custom_skins").select("owners_count").eq("id", id).maybeSingle();
  if (!data) return;
  await supabase.from("custom_skins").update({ owners_count: (data.owners_count || 0) + 1 }).eq("id", id);
}

/* -------------------------------- Réductions -------------------------------- */
function toDiscount(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || "Réduction",
    percent: Number(row.percent) || 0,
    targets: row.targets || {},
    maxUses: Number.isFinite(row.max_uses) && row.max_uses > 0 ? row.max_uses : null,
    usesCount: Number.isFinite(row.uses_count) ? row.uses_count : 0,
    avail: { type: row.avail_type || "always", from: row.from_md || null, to: row.to_md || null, startsAt: row.starts_at || null, endsAt: row.ends_at || null },
    afterEnd: ["reactivate", "change"].includes(row.after_end) ? row.after_end : "unavailable",
    reactAt: row.react_at || null,
    afterPercent: Number.isFinite(row.after_percent) ? row.after_percent : null,
    duration: row.duration || "once",
    durationMonths: Number.isFinite(row.duration_months) ? row.duration_months : null,
    showCode: !!row.show_code,
    code: row.code || null,
    text: row.extra_text || "",
    active: row.active !== false,
    stripeCoupons: row.stripe_coupons || {},
  };
}
async function listDiscounts() {
  const { data, error } = await supabase.from("discounts").select("*").order("created_at", { ascending: true });
  if (error) {
    if (/discounts/.test(error.message || "")) return [];
    throwIfError(error, "listDiscounts");
  }
  return (data || []).map(toDiscount);
}
async function upsertDiscount(row) {
  const { data, error } = await supabase.from("discounts").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "id" }).select("*").single();
  throwIfError(error, "upsertDiscount");
  return toDiscount(data);
}
async function updateDiscount(id, patch) {
  const { error } = await supabase.from("discounts").update(patch).eq("id", id);
  throwIfError(error, "updateDiscount");
}
async function deleteDiscount(id, deletedBy) {
  const { data: before } = await supabase.from("discounts").select("*").eq("id", id);
  await trash("discount", before || [], deletedBy);
  const { error } = await supabase.from("discounts").delete().eq("id", id);
  throwIfError(error, "deleteDiscount");
}
async function incrementDiscountUses(id) {
  const { data } = await supabase.from("discounts").select("uses_count").eq("id", id).maybeSingle();
  if (!data) return;
  await supabase.from("discounts").update({ uses_count: (data.uses_count || 0) + 1 }).eq("id", id);
}

/* ------------------------------- Utilisateurs ------------------------------- */

async function getUserById(id) {
  const { data, error } = await supabase.from("users").select("*").eq("id", id).maybeSingle();
  throwIfError(error, "getUserById");
  return data;
}

async function getUserByUsername(username) {
  const { data, error } = await supabase.from("users").select("*").ilike("username", username).maybeSingle();
  throwIfError(error, "getUserByUsername");
  return data;
}

// Version "publique" : ne sélectionne QUE la photo de profil, jamais le
// reste de la ligne (mot de passe haché, email, id client Stripe...).
// Utilisée par la route publique GET /api/users/:username/avatar, pour
// afficher la photo d'un auteur de quiz ou d'un propriétaire de parcours
// sans jamais exposer d'informations sensibles sur ce compte.
async function getUserAvatarByUsername(username) {
  const { data, error } = await supabase.from("users").select("avatar_url").ilike("username", username).maybeSingle();
  throwIfError(error, "getUserAvatarByUsername");
  return data ? data.avatar_url : null;
}

async function getUserByEmail(email) {
  // Plusieurs comptes avec la même adresse (anciens doublons) : on prend le
  // plus ancien au lieu de planter (« JSON object requested, multiple rows »).
  const { data: rows, error } = await supabase
    .from("users")
    .select("*")
    .ilike("email", email)
    .order("created_at", { ascending: true })
    .limit(1);
  throwIfError(error, "getUserByEmail");
  const data = (rows && rows[0]) || null;
  return data;
}

async function createUser(user) {
  const { data, error } = await supabase.from("users").insert(user).select().single();
  throwIfError(error, "createUser");
  return data;
}

async function updateUser(id, patch) {
  const { data, error } = await supabase.from("users").update(patch).eq("id", id).select().single();
  throwIfError(error, "updateUser");
  return data;
}

async function deleteUser(id, deletedBy) {
  const { data: u } = await supabase.from("users").select("*").eq("id", id);
  await trash("user", u || [], deletedBy);
  const { data: pls } = await supabase.from("playlists").select("*").eq("owner_id", id);
  await trash("playlist", pls || [], deletedBy);
  const { error } = await supabase.from("users").delete().eq("id", id);
  throwIfError(error, "deleteUser");
}

async function listUsers() {
  const { data, error } = await supabase.from("users").select("*").order("created_at", { ascending: true });
  throwIfError(error, "listUsers");
  return data;
}

async function getUserByStripeCustomerId(customerId) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  throwIfError(error, "getUserByStripeCustomerId");
  return data;
}

async function listLeaderboard(limit) {
  const { data, error } = await supabase.from("users").select("username, avatar_url, game").limit(1000);
  throwIfError(error, "listLeaderboard");
  return (data || [])
    .map((u) => ({
      username: u.username,
      avatarUrl: u.avatar_url,
      lifetimeScore: (u.game && u.game.lifetimeScore) || 0,
    }))
    .sort((a, b) => b.lifetimeScore - a.lifetimeScore)
    .slice(0, limit || 20);
}

async function listOfficialScores(limit) {
  const { data, error } = await supabase.from("users").select("username, history").limit(1000);
  throwIfError(error, "listOfficialScores");
  const out = [];
  (data || []).forEach((u) => {
    (Array.isArray(u.history) ? u.history : []).forEach((h) => {
      if (h && h.official && Number.isFinite(h.score) && h.score > 0) {
        out.push({
          username: u.username,
          quizTitle: h.title || "Quiz",
          quizId: h.id || null,
          score: h.score,
          date: h.date || null,
        });
      }
    });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, limit || 50);
}

/* ------------------------------- Parcours -----------------------------------
   Désormais une vraie table dédiée ("playlists"), plus un tableau JSON
   imbriqué dans users.playlists. Avantage concret : supprimer un parcours,
   le marquer officiel, etc. est maintenant un DELETE/UPDATE direct par id,
   exactement comme pour les quiz — fini le "retrouver le propriétaire
   parmi tous les comptes puis réécrire tout son tableau", qui était fragile
   et à l'origine du bouton Supprimer qui ne faisait rien côté admin. */

function toPublicPlaylist(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    quizIds: Array.isArray(row.quiz_ids) ? row.quiz_ids : [],
    private: !!row.private,
    guided: !!row.guided,
    official: !!row.official,
    language: row.language || undefined,
    instructionLanguage: row.instruction_language || undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    owner: row.owner_username || undefined,
    // Section Apprendre à laquelle ce parcours est connecté (null = pas
    // connecté, s'affiche normalement comme un parcours individuel).
    learnSectionId: row.learn_section_id || null,
    // Position de ce parcours dans l'affichage de sa section (0 = en
    // premier) — réglée depuis l'éditeur de mise en page.
    learnSectionOrder: Number.isFinite(row.learn_section_order) ? row.learn_section_order : 0,
    // Unités personnalisées du parcours (vide = 1 quiz = 1 unité).
    units: Array.isArray(row.units) ? row.units : [],
    // Types de questions imposés par le parcours (null = types d'origine)
    questionTypes: row.question_types && typeof row.question_types === "object" ? row.question_types : undefined,
  };
}

// Types de questions d'un parcours : {mode:"single", format} | {mode:"mix", formats, weights}
const QT_FORMATS = ["pairs", "classic", "classic4", "classic3", "flashcard", "truefalse", "textfind", "puzzle", "blank", "match"];
const QT_MIX = ["auto", "flashcard", "truefalse", "textfind", "puzzle", "blank", "match"];
function cleanQuestionTypes(qt) {
  if (!qt || typeof qt !== "object") return null;
  if (qt.mode === "single" && QT_FORMATS.includes(qt.format)) return { mode: "single", format: qt.format };
  if (qt.mode === "mix" && Array.isArray(qt.formats)) {
    const formats = qt.formats.filter((f, i, a) => QT_MIX.includes(f) && a.indexOf(f) === i);
    if (!formats.length) return null;
    const weights = {};
    formats.forEach((f) => {
      const w = Number(qt.weights && qt.weights[f]);
      weights[f] = Number.isFinite(w) ? Math.max(0, Math.min(100, w)) : 50;
    });
    return { mode: "mix", formats, weights };
  }
  return null;
}

// Unités d'un parcours : [{ id, name, items: [{ q: quizId, l: indexDuNiveau }] }]
function cleanUnits(units) {
  if (!Array.isArray(units)) return [];
  return units.slice(0, 60).map((u, i) => ({
    id: String((u && u.id) || "u" + i).slice(0, 40),
    name: String((u && u.name) || "").slice(0, 80),
    items: (Array.isArray(u && u.items) ? u.items : []).slice(0, 400)
      .filter((it) => it && it.q != null && Number.isFinite(Number(it.l)))
      .map((it) => ({ q: String(it.q).slice(0, 80), l: Math.max(0, Math.floor(Number(it.l))) })),
  }));
}

async function listPublicPlaylists() {
  const { data, error } = await supabase
    .from("playlists")
    .select("*")
    .eq("private", false)
    .order("created_at", { ascending: false })
    .limit(2000);
  throwIfError(error, "listPublicPlaylists");
  return (data || []).map(toPublicPlaylist);
}

// Ensemble des id de quiz qui composent au moins un parcours OFFICIEL.
// Ces quiz ne doivent plus apparaître seuls dans la rubrique Quiz : on ne
// les trouve que dans leur parcours. Ils continuent pourtant d'exister
// (jouables via le parcours) — ils sont simplement "cachés" (colonne
// quizzes.hidden), jamais supprimés.
async function getQuizIdsInOfficialPlaylists() {
  const { data, error } = await supabase.from("playlists").select("quiz_ids").eq("official", true);
  throwIfError(error, "getQuizIdsInOfficialPlaylists");
  const ids = new Set();
  (data || []).forEach((row) => {
    (Array.isArray(row.quiz_ids) ? row.quiz_ids : []).forEach((qid) => ids.add(String(qid)));
  });
  return ids;
}

// Recalcule la colonne quizzes.hidden à partir des parcours officiels :
// caché = appartient à au moins un parcours officiel. À rappeler après
// toute modification de parcours (création, suppression, passage en
// officiel ou retrait). Idempotent : on ne touche que les lignes dont
// l'état change réellement.
async function refreshHiddenQuizzes() {
  const shouldHide = await getQuizIdsInOfficialPlaylists();
  const { data, error } = await supabase.from("quizzes").select("id, hidden");
  throwIfError(error, "refreshHiddenQuizzes:list");
  const toHide = [];
  const toShow = [];
  (data || []).forEach((q) => {
    const want = shouldHide.has(String(q.id));
    if (want && !q.hidden) toHide.push(q.id);
    else if (!want && q.hidden) toShow.push(q.id);
  });
  if (toHide.length) {
    const { error: e1 } = await supabase.from("quizzes").update({ hidden: true }).in("id", toHide);
    throwIfError(e1, "refreshHiddenQuizzes:hide");
  }
  if (toShow.length) {
    const { error: e2 } = await supabase.from("quizzes").update({ hidden: false }).in("id", toShow);
    throwIfError(e2, "refreshHiddenQuizzes:show");
  }
  return { hidden: toHide.length, shown: toShow.length };
}

// Vue admin : TOUS les parcours (y compris privés), avec le pseudo du
// propriétaire — utilisé par le panneau d'administration.
// Parcours affichés dans l'onglet Apprendre : tous les parcours officiels
// rangés dans une section, MÊME s'ils sont privés — c'est l'admin qui les a
// placés là, ils doivent donc être visibles par tous les joueurs (sinon un
// parcours privé de l'admin n'apparaîtrait jamais dans Apprendre).
async function listLearnPlaylists() {
  const { data, error } = await supabase
    .from("playlists")
    .select("*")
    .eq("official", true)
    .not("learn_section_id", "is", null)
    .order("learn_section_order", { ascending: true });
  throwIfError(error, "listLearnPlaylists");
  return (data || []).map(toPublicPlaylist);
}

async function listAllPlaylistsAdmin() {
  const { data, error } = await supabase
    .from("playlists")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(2000);
  throwIfError(error, "listAllPlaylistsAdmin");
  return (data || []).map((row) => ({ ...toPublicPlaylist(row), ownerUsername: row.owner_username }));
}

// Marque (ou démarque) un parcours comme officiel/guidé. Renvoie null si
// aucun parcours avec cet id n'existe.
async function setPlaylistFields(playlistId, patch) {
  const allowed = {};
  if (typeof patch.official === "boolean") allowed.official = patch.official;
  if (typeof patch.guided === "boolean") allowed.guided = patch.guided;
  // Connecte (ou déconnecte, avec null) ce parcours à une section
  // Apprendre — un parcours connecté disparaît de l'affichage individuel
  // et rejoint sa section à la place.
  if (Object.prototype.hasOwnProperty.call(patch, "learnSectionId")) {
    allowed.learn_section_id = patch.learnSectionId || null;
  }
  if (Number.isFinite(patch.learnSectionOrder)) allowed.learn_section_order = patch.learnSectionOrder;
  allowed.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("playlists")
    .update(allowed)
    .eq("id", playlistId)
    .select()
    .maybeSingle();
  throwIfError(error, "setPlaylistFields");
  if (!data) return null;
  await refreshHiddenQuizzes();
  return { playlist: toPublicPlaylist(data), ownerUsername: data.owner_username };
}

// Supprime un parcours — un DELETE direct par id, maintenant que les
// parcours ont leur propre table. Renvoie false si aucun parcours avec cet
// id n'existe (rien à faire), true si la suppression a bien eu lieu.
async function deletePlaylist(playlistId, deletedBy) {
  const { data: before } = await supabase.from("playlists").select("*").eq("id", playlistId);
  await trash("playlist", before || [], deletedBy);
  const { data, error } = await supabase.from("playlists").delete().eq("id", playlistId).select();
  throwIfError(error, "deletePlaylist");
  const removed = (data || []).length > 0;
  if (removed) await refreshHiddenQuizzes();
  return removed;
}

// Les parcours D'UN compte précis (pour que ce compte les retrouve sur un
// autre appareil).
async function getUserPlaylists(userId) {
  const { data, error } = await supabase
    .from("playlists")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });
  throwIfError(error, "getUserPlaylists");
  return (data || []).map(toPublicPlaylist);
}

// Remplace l'ensemble des parcours D'UN compte par la liste envoyée par le
// client (même contrat que l'ancien PUT /api/users/me/playlists, qui
// écrivait tout le tableau JSON d'un coup) : upsert chaque parcours reçu.
// Les suppressions ne passent QUE par deletedIds (ids explicitement
// supprimés par le joueur), jamais par "absent de la liste". Important : le champ
// "official" n'est JAMAIS pris depuis le client (un simple utilisateur ne
// doit jamais pouvoir se marquer lui-même "officiel") — on conserve
// toujours la valeur déjà en base, uniquement modifiable par l'admin via
// setPlaylistFields.
async function replaceUserPlaylists(userId, username, playlists, deletedIds) {
  // La colonne « units » arrive avec migration-2026-11-unites-parcours.sql :
  // tant qu'elle n'existe pas, on continue de synchroniser sans elle.
  let hasUnits = true;
  let { data: existing, error: fetchErr } = await supabase
    .from("playlists")
    .select("id, official, path_type, sections, learn_section_id, learn_section_order, units")
    .eq("owner_id", userId);
  if (fetchErr && /units/i.test(fetchErr.message || "")) {
    hasUnits = false;
    ({ data: existing, error: fetchErr } = await supabase
      .from("playlists")
      .select("id, official, path_type, sections, learn_section_id, learn_section_order")
      .eq("owner_id", userId));
  }
  throwIfError(fetchErr, "replaceUserPlaylists:fetchExisting");
  const officialById = {};
  const sectionedById = {};
  const learnSectionById = {};
  const learnSectionOrderById = {};
  const unitsById = {};
  (existing || []).forEach((row) => {
    officialById[row.id] = row.official;
    // Réglage "parcours par sections" : réservé aux admins (panneau
    // admin, pas la synchronisation normale depuis l'app) — préservé ici
    // exactement comme "official" juste au-dessus, sinon la moindre
    // synchronisation classique d'un parcours de ce propriétaire
    // écraserait silencieusement sa configuration par sections.
    sectionedById[row.id] = { pathType: row.path_type, sections: row.sections };
    // Idem pour la connexion à une section Apprendre et sa position.
    learnSectionById[row.id] = row.learn_section_id;
    learnSectionOrderById[row.id] = row.learn_section_order;
    unitsById[row.id] = row.units;
  });

  // Un parcours qui appartient à QUELQU'UN D'AUTRE (ex. parcours public
  // copié avec le même id) ne doit jamais être "volé" par l'upsert : sinon
  // il disparaissait du compte de son vrai propriétaire.
  const candidateIds = playlists.map((p) => p && p.id).filter(Boolean).map(String);
  const ownIds = new Set((existing || []).map((r) => String(r.id)));
  const foreign = new Set();
  const unknown = candidateIds.filter((id) => !ownIds.has(id));
  if (unknown.length) {
    const { data: others } = await supabase.from("playlists").select("id, owner_id").in("id", unknown);
    (others || []).forEach((r) => {
      if (String(r.owner_id) !== String(userId)) foreign.add(String(r.id));
    });
  }
  playlists = playlists.filter((p) => p && p.id && !foreign.has(String(p.id)));
  const incomingIds = playlists.map((p) => p.id).filter(Boolean);

  if (playlists.length > 0) {
    const rows = playlists
      .filter((p) => p && p.id)
      .map((p) => {
        const preserved = sectionedById[p.id] || { pathType: "linear", sections: [] };
        return {
          id: p.id,
          owner_id: userId,
          owner_username: username || null,
          name: p.name || "Nouveau parcours",
          quiz_ids: Array.isArray(p.quizIds) ? p.quizIds : [],
          private: !!p.private,
          guided: !!p.guided,
          official: Object.prototype.hasOwnProperty.call(officialById, p.id) ? !!officialById[p.id] : false,
          language: p.language || null,
          instruction_language: p.instructionLanguage || null,
          ...(hasUnits ? { units: Array.isArray(p.units) ? cleanUnits(p.units) : (unitsById[p.id] || []) } : {}),
          question_types: cleanQuestionTypes(p.questionTypes),
          created_at: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
          updated_at: new Date().toISOString(),
          path_type: preserved.pathType || "linear",
          sections: preserved.sections || [],
          learn_section_id: Object.prototype.hasOwnProperty.call(learnSectionById, p.id) ? learnSectionById[p.id] : null,
          learn_section_order: Object.prototype.hasOwnProperty.call(learnSectionOrderById, p.id) ? (learnSectionOrderById[p.id] || 0) : 0,
        };
      });
    let { error: upsertError } = await supabase.from("playlists").upsert(rows, { onConflict: "id" });
    // Colonne « question_types » pas encore créée (migration-2026-11-skins-coffres.sql) :
    // on synchronise quand même, sans ce champ.
    if (upsertError && /question_types/i.test(upsertError.message || "")) {
      rows.forEach((r) => delete r.question_types);
      ({ error: upsertError } = await supabase.from("playlists").upsert(rows, { onConflict: "id" }));
    }
    throwIfError(upsertError, "replaceUserPlaylists:upsert");
  }

  // ⚠️ AVANT : tout parcours absent de la liste envoyée était SUPPRIMÉ.
  // Un appareil neuf (liste locale vide) effaçait donc tous les parcours du
  // compte. Désormais on ne supprime QUE les parcours explicitement
  // supprimés par le joueur (deletedIds), et une copie part en corbeille.
  const toDelete = (Array.isArray(deletedIds) ? deletedIds : [])
    .map(String)
    .filter((id) => id && incomingIds.indexOf(id) === -1);
  if (toDelete.length) {
    const { data: doomed } = await supabase.from("playlists").select("*").eq("owner_id", userId).in("id", toDelete);
    await trash("playlist", doomed || [], userId);
    const { error: delError } = await supabase.from("playlists").delete().eq("owner_id", userId).in("id", toDelete);
    throwIfError(delError, "replaceUserPlaylists:delete");
  }

  await refreshHiddenQuizzes();
  return getUserPlaylists(userId);
}

/* ---------------------------------- Quiz ------------------------------------ */

async function getQuizById(id) {
  const { data, error } = await supabase.from("quizzes").select("*").eq("id", id).maybeSingle();
  throwIfError(error, "getQuizById");
  return data;
}

async function createQuiz(quiz) {
  const { data, error } = await supabase.from("quizzes").insert(quiz).select().single();
  throwIfError(error, "createQuiz");
  return data;
}

async function updateQuiz(id, patch) {
  const { data, error } = await supabase.from("quizzes").update(patch).eq("id", id).select().single();
  throwIfError(error, "updateQuiz");
  return data;
}

async function deleteQuiz(id, deletedBy) {
  const { data: before } = await supabase.from("quizzes").select("*").eq("id", id);
  await trash("quiz", before || [], deletedBy);
  const { error } = await supabase.from("quizzes").delete().eq("id", id);
  throwIfError(error, "deleteQuiz");
}

async function listQuizzes() {
  // Supabase renvoie au maximum 1000 lignes par requête : au-delà, des quiz
  // "disparaissaient" de la liste (et le site les croyait supprimés).
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("quizzes")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    throwIfError(error, "listQuizzes");
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

// === Arbres (un par thème : sujet + style visuel) ===
// Hiérarchie : Arbre → Sections → Parcours → Quiz → Niveaux.
// Un arbre regroupe des sections (learn_sections.tree_id) ; supprimer un
// arbre supprime ses sections (on delete cascade), et les parcours de ces
// sections redeviennent simplement "hors section" (on delete set null).
function toPublicLearnTree(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    subject: row.subject || "",
    emoji: row.emoji || "🌳",
    color: row.color || "#3b82f6",
    background: row.background || "default",
    language: row.language || "",
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}
async function listLearnTrees() {
  const { data, error } = await supabase.from("learn_trees").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true });
  throwIfError(error, "listLearnTrees");
  return (data || []).map(toPublicLearnTree);
}
async function getLearnTree(id) {
  const { data, error } = await supabase.from("learn_trees").select("*").eq("id", id).maybeSingle();
  throwIfError(error, "getLearnTree");
  return toPublicLearnTree(data);
}
async function createLearnTree(tree) {
  const row = {
    id: tree.id,
    name: tree.name,
    subject: tree.subject || "",
    emoji: tree.emoji || "🌳",
    color: tree.color || "#3b82f6",
    background: tree.background || "default",
    sort_order: Number.isFinite(tree.sortOrder) ? tree.sortOrder : 0,
    updated_at: new Date().toISOString(),
  };
  // Langue des joueurs (colonne ajoutée par migration-2026-10-langue-arbres.sql) :
  // envoyée seulement si elle est renseignée.
  if (tree.language) row.language = tree.language;
  const { data, error } = await supabase.from("learn_trees").insert(row).select().maybeSingle();
  throwIfError(error, "createLearnTree");
  return toPublicLearnTree(data);
}
async function updateLearnTree(id, patch) {
  const allowed = {};
  if (typeof patch.name === "string" && patch.name.trim()) allowed.name = patch.name.trim();
  if (typeof patch.subject === "string") allowed.subject = patch.subject.trim();
  if (typeof patch.emoji === "string" && patch.emoji.trim()) allowed.emoji = patch.emoji.trim();
  if (typeof patch.color === "string") allowed.color = patch.color;
  if (typeof patch.background === "string") allowed.background = patch.background;
  if (typeof patch.language === "string") allowed.language = patch.language;
  if (Number.isFinite(patch.sortOrder)) allowed.sort_order = patch.sortOrder;
  allowed.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from("learn_trees").update(allowed).eq("id", id).select().maybeSingle();
  throwIfError(error, "updateLearnTree");
  return toPublicLearnTree(data);
}
async function deleteLearnTree(id, deletedBy) {
  const { data: t } = await supabase.from("learn_trees").select("*").eq("id", id);
  await trash("learn_tree", t || [], deletedBy);
  const { data: secs } = await supabase.from("learn_sections").select("*").eq("tree_id", id);
  await trash("learn_section", secs || [], deletedBy);
  const { error } = await supabase.from("learn_trees").delete().eq("id", id);
  throwIfError(error, "deleteLearnTree");
  return true;
}

// === Sections (regroupent plusieurs parcours entiers, dans un arbre) ===
// Les anciennes colonnes playlists.path_type / playlists.sections (ancien
// mode "parcours par sections", supprimé) restent en base mais ne sont
// plus exposées ni modifiables.
function toPublicLearnSection(row) {
  if (!row) return null;
  return {
    id: row.id,
    treeId: row.tree_id || null,
    category: row.category,
    name: row.name,
    emoji: row.emoji,
    unlockThreshold: row.unlock_threshold || { type: "count", value: 1 },
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 0,
    // Nombre de cases affichées par ligne pour cette section (1 à 3) —
    // réglé depuis l'éditeur de mise en page du panneau admin.
    itemsPerRow: Number.isFinite(row.items_per_row) ? row.items_per_row : 2,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}
async function listLearnSections() {
  const { data, error } = await supabase.from("learn_sections").select("*").order("sort_order", { ascending: true });
  throwIfError(error, "listLearnSections");
  return (data || []).map(toPublicLearnSection);
}
async function createLearnSection(section) {
  const row = {
    id: section.id,
    tree_id: section.treeId || null,
    category: section.category,
    name: section.name,
    emoji: section.emoji,
    unlock_threshold: section.unlockThreshold || { type: "count", value: 1 },
    sort_order: Number.isFinite(section.sortOrder) ? section.sortOrder : 0,
    items_per_row: [1, 2, 3].includes(section.itemsPerRow) ? section.itemsPerRow : 2,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("learn_sections").insert(row).select().maybeSingle();
  throwIfError(error, "createLearnSection");
  return toPublicLearnSection(data);
}
async function updateLearnSection(id, patch) {
  const allowed = {};
  if (typeof patch.name === "string" && patch.name.trim()) allowed.name = patch.name.trim();
  if (typeof patch.treeId === "string" && patch.treeId) allowed.tree_id = patch.treeId;
  if (typeof patch.category === "string") allowed.category = patch.category;
  if (typeof patch.emoji === "string") allowed.emoji = patch.emoji;
  if (patch.unlockThreshold && typeof patch.unlockThreshold === "object") allowed.unlock_threshold = patch.unlockThreshold;
  if (Number.isFinite(patch.sortOrder)) allowed.sort_order = patch.sortOrder;
  if ([1, 2, 3].includes(patch.itemsPerRow)) allowed.items_per_row = patch.itemsPerRow;
  allowed.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from("learn_sections").update(allowed).eq("id", id).select().maybeSingle();
  throwIfError(error, "updateLearnSection");
  return toPublicLearnSection(data);
}
async function deleteLearnSection(id) {
  // Les parcours qui y étaient connectés redeviennent automatiquement
  // visibles individuellement (learn_section_id repasse à NULL via la
  // contrainte "on delete set null" posée dans la migration).
  const { data: sec } = await supabase.from("learn_sections").select("*").eq("id", id);
  await trash("learn_section", sec || [], arguments[1]);
  const { error } = await supabase.from("learn_sections").delete().eq("id", id);
  throwIfError(error, "deleteLearnSection");
  return true;
}

module.exports = {
  supabase,
  getUserById,
  getUserByUsername,
  getUserAvatarByUsername,
  getUserByEmail,
  createUser,
  updateUser,
  deleteUser,
  listUsers,
  getUserByStripeCustomerId,
  listLeaderboard,
  listOfficialScores,
  listPublicPlaylists,
  listAllPlaylistsAdmin,
  setPlaylistFields,
  listLearnTrees,
  listLearnPlaylists,
  getLearnTree,
  createLearnTree,
  updateLearnTree,
  deleteLearnTree,
  listLearnSections,
  createLearnSection,
  updateLearnSection,
  deleteLearnSection,
  deletePlaylist,
  getQuizIdsInOfficialPlaylists,
  refreshHiddenQuizzes,
  getUserPlaylists,
  replaceUserPlaylists,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  listQuizzes,
  listTrash,
  restoreTrash,
  listCustomSkins,
  getCustomSkinImage,
  upsertCustomSkin,
  deleteCustomSkin,
  incrementCustomSkinOwners,
  listDiscounts,
  upsertDiscount,
  updateDiscount,
  deleteDiscount,
  incrementDiscountUses,
};
