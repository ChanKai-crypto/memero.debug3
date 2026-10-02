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

async function listPublicPlaylists() {
  const { data, error } = await supabase.from("users").select("username, playlists").limit(1000);
  throwIfError(error, "listPublicPlaylists");
  const out = [];
  (data || []).forEach((u) => {
    (Array.isArray(u.playlists) ? u.playlists : []).forEach((p) => {
      if (p && !p.private) out.push({ ...p, owner: p.owner || u.username });
    });
  });
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// Vue admin : TOUS les parcours (y compris privés), avec le pseudo du
// propriétaire — utilisé par le panneau d'administration pour pouvoir
// marquer un parcours comme officiel.
// Quiz individuels à masquer de la liste publique /api/quizzes : ceux
// qui appartiennent à un parcours à la fois GUIDÉ et OFFICIEL. Dans ce
// cas précis, le quiz ne doit plus apparaître tout seul dans la rubrique
// Quiz — on ne doit le trouver qu'à l'intérieur du parcours lui-même.
// Même règle déjà appliquée côté client (getQuizIdsHiddenByGuidedOfficialPlaylists),
// répliquée ici pour que ce soit vrai même pour un client qui n'a pas
// encore synchronisé ses parcours localement.
async function getQuizIdsHiddenByOfficialGuidedPlaylists() {
  const { data, error } = await supabase.from("users").select("playlists").limit(1000);
  throwIfError(error, "getQuizIdsHiddenByOfficialGuidedPlaylists");
  const hidden = new Set();
  (data || []).forEach((u) => {
    (Array.isArray(u.playlists) ? u.playlists : []).forEach((p) => {
      if (p && p.guided && p.official && Array.isArray(p.quizIds)) {
        p.quizIds.forEach((qid) => hidden.add(qid));
      }
    });
  });
  return hidden;
}

async function listAllPlaylistsAdmin() {
  const { data, error } = await supabase.from("users").select("username, playlists").limit(1000);
  throwIfError(error, "listAllPlaylistsAdmin");
  const out = [];
  (data || []).forEach((u) => {
    (Array.isArray(u.playlists) ? u.playlists : []).forEach((p) => {
      if (p) out.push({ ...p, ownerUsername: u.username });
    });
  });
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// Marque (ou démarque) un parcours comme officiel. Les parcours vivant
// dans le tableau JSON "playlists" de leur propriétaire (pas leur propre
// table), il faut d'abord retrouver CE propriétaire avant de patcher son
// tableau. Renvoie null si aucun parcours avec cet id n'existe.
async function setPlaylistFields(playlistId, patch) {
  const { data, error } = await supabase.from("users").select("id, username, playlists").limit(1000);
  throwIfError(error, "setPlaylistFields:list");
  const owner = (data || []).find(
    (u) => Array.isArray(u.playlists) && u.playlists.some((p) => p && p.id === playlistId)
  );
  if (!owner) return null;
  const updatedPlaylists = owner.playlists.map((p) =>
    p && p.id === playlistId ? { ...p, ...patch } : p
  );
  const { data: updatedRow, error: updateError } = await supabase
    .from("users")
    .update({ playlists: updatedPlaylists })
    .eq("id", owner.id)
    .select()
    .single();
  throwIfError(updateError, "setPlaylistFields:update");
  const playlist = (updatedRow.playlists || []).find((p) => p && p.id === playlistId);
  return { playlist, ownerUsername: owner.username };
}

// Supprime un parcours. Même principe que setPlaylistFields : retrouve
// d'abord le propriétaire (le parcours vit dans SON tableau JSON, pas dans
// une table à lui), puis réécrit ce tableau sans l'entrée concernée.
// Renvoie false si aucun parcours avec cet id n'existe (rien à faire),
// true si la suppression a bien eu lieu.
async function deletePlaylist(playlistId) {
  const { data, error } = await supabase.from("users").select("id, playlists").limit(1000);
  throwIfError(error, "deletePlaylist:list");
  const owner = (data || []).find(
    (u) => Array.isArray(u.playlists) && u.playlists.some((p) => p && p.id === playlistId)
  );
  if (!owner) return false;
  const remainingPlaylists = owner.playlists.filter((p) => !(p && p.id === playlistId));
  const { error: updateError } = await supabase
    .from("users")
    .update({ playlists: remainingPlaylists })
    .eq("id", owner.id);
  throwIfError(updateError, "deletePlaylist:update");
  return true;
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
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  listQuizzes,
};
