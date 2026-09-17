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
  getUserByEmail,
  createUser,
  updateUser,
  deleteUser,
  listUsers,
  getUserByStripeCustomerId,
  listLeaderboard,
  listOfficialScores,
  listPublicPlaylists,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  listQuizzes,
};
