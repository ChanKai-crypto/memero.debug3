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

// Quiz individuels à masquer de la liste publique /api/quizzes : ceux
// qui appartiennent à un parcours à la fois GUIDÉ et OFFICIEL. Dans ce
// cas précis, le quiz ne doit plus apparaître tout seul dans la rubrique
// Quiz — on ne doit le trouver qu'à l'intérieur du parcours lui-même.
// Même règle déjà appliquée côté client (getQuizIdsHiddenByGuidedOfficialPlaylists).
async function getQuizIdsHiddenByOfficialGuidedPlaylists() {
  const { data, error } = await supabase
    .from("playlists")
    .select("quiz_ids")
    .eq("guided", true)
    .eq("official", true);
  throwIfError(error, "getQuizIdsHiddenByOfficialGuidedPlaylists");
  const hidden = new Set();
  (data || []).forEach((row) => {
    (Array.isArray(row.quiz_ids) ? row.quiz_ids : []).forEach((qid) => hidden.add(qid));
  });
  return hidden;
}

// Vue admin : TOUS les parcours (y compris privés), avec le pseudo du
// propriétaire — utilisé par le panneau d'administration.
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
  allowed.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("playlists")
    .update(allowed)
    .eq("id", playlistId)
    .select()
    .maybeSingle();
  throwIfError(error, "setPlaylistFields");
  if (!data) return null;
  return { playlist: toPublicPlaylist(data), ownerUsername: data.owner_username };
}

// Supprime un parcours — un DELETE direct par id, maintenant que les
// parcours ont leur propre table. Renvoie false si aucun parcours avec cet
// id n'existe (rien à faire), true si la suppression a bien eu lieu.
async function deletePlaylist(playlistId) {
  const { data, error } = await supabase.from("playlists").delete().eq("id", playlistId).select();
  throwIfError(error, "deletePlaylist");
  return (data || []).length > 0;
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
    .select("id, official")
    .eq("owner_id", userId);
  throwIfError(fetchErr, "replaceUserPlaylists:fetchExisting");
  const officialById = {};
  (existing || []).forEach((row) => { officialById[row.id] = row.official; });

  const incomingIds = playlists.map((p) => p.id).filter(Boolean);

  if (playlists.length > 0) {
    const rows = playlists
      .filter((p) => p && p.id)
      .map((p) => ({
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
      }));
    const { error: upsertError } = await supabase.from("playlists").upsert(rows, { onConflict: "id" });
    throwIfError(upsertError, "replaceUserPlaylists:upsert");
  }

  let delQuery = supabase.from("playlists").delete().eq("owner_id", userId);
  if (incomingIds.length > 0) {
    delQuery = delQuery.not("id", "in", `(${incomingIds.map((id) => `"${id}"`).join(",")})`);
  }
  const { error: delError } = await delQuery;
  throwIfError(delError, "replaceUserPlaylists:delete");

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
  deletePlaylist,
  getQuizIdsHiddenByOfficialGuidedPlaylists,
  getUserPlaylists,
  replaceUserPlaylists,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  listQuizzes,
};
