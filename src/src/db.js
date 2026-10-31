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
  const { data, error } = await supabase.from("users").select("*").ilike("email", email).maybeSingle();
  throwIfError(error, "getUserByEmail");
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

async function deleteUser(id) {
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
  };
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
async function deletePlaylist(playlistId) {
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
// écrivait tout le tableau JSON d'un coup) : upsert chaque parcours reçu,
// puis supprime ceux de ce compte qui ne sont plus dans la liste — c'est
// ainsi qu'une suppression faite localement (via le menu "..." d'un
// parcours) se répercute bien sur le serveur. Important : le champ
// "official" n'est JAMAIS pris depuis le client (un simple utilisateur ne
// doit jamais pouvoir se marquer lui-même "officiel") — on conserve
// toujours la valeur déjà en base, uniquement modifiable par l'admin via
// setPlaylistFields.
async function replaceUserPlaylists(userId, username, playlists) {
  const { data: existing, error: fetchErr } = await supabase
    .from("playlists")
    .select("id, official, path_type, sections, learn_section_id, learn_section_order")
    .eq("owner_id", userId);
  throwIfError(fetchErr, "replaceUserPlaylists:fetchExisting");
  const officialById = {};
  const sectionedById = {};
  const learnSectionById = {};
  const learnSectionOrderById = {};
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
  });

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
          created_at: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
          updated_at: new Date().toISOString(),
          path_type: preserved.pathType || "linear",
          sections: preserved.sections || [],
          learn_section_id: Object.prototype.hasOwnProperty.call(learnSectionById, p.id) ? learnSectionById[p.id] : null,
          learn_section_order: Object.prototype.hasOwnProperty.call(learnSectionOrderById, p.id) ? (learnSectionOrderById[p.id] || 0) : 0,
        };
      });
    const { error: upsertError } = await supabase.from("playlists").upsert(rows, { onConflict: "id" });
    throwIfError(upsertError, "replaceUserPlaylists:upsert");
  }

  let delQuery = supabase.from("playlists").delete().eq("owner_id", userId);
  if (incomingIds.length > 0) {
    delQuery = delQuery.not("id", "in", `(${incomingIds.map((id) => `"${id}"`).join(",")})`);
  }
  const { error: delError } = await delQuery;
  throwIfError(delError, "replaceUserPlaylists:delete");

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

async function deleteQuiz(id) {
  const { error } = await supabase.from("quizzes").delete().eq("id", id);
  throwIfError(error, "deleteQuiz");
}

async function listQuizzes() {
  const { data, error } = await supabase.from("quizzes").select("*").order("created_at", { ascending: false });
  throwIfError(error, "listQuizzes");
  return data;
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
async function deleteLearnTree(id) {
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
};
