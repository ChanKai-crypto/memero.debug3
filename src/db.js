/**
 * Couche d'accès aux données, branchée sur Supabase (Postgres géré, gratuit
 * en continu dans ses limites — contrairement au disque de Render qui,
 * lui, nécessite un plan payant).
 *
 * Toutes les fonctions sont asynchrones (elles font un vrai appel réseau).
 * Elles utilisent la "service role key" de Supabase, qui contourne les
 * règles de sécurité au niveau des lignes (RLS) : c'est volontaire, car
 * c'est CE serveur qui doit décider seul qui a le droit de faire quoi
 * (voir les middlewares authenticate / requireAdmin). Cette clé ne doit
 * JAMAIS être envoyée au navigateur/à l'app — uniquement utilisée ici,
 * côté serveur.
 *
 * Avant de t'en servir : crée les tables avec le script
 * `supabase-schema.sql` fourni à la racine du projet (Supabase → SQL
 * Editor → colle le contenu → Run), puis renseigne SUPABASE_URL et
 * SUPABASE_SERVICE_ROLE_KEY dans ton .env / tes variables Render.
 */
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "❌ SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies (voir .env.example)."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function throwIfError(error, context) {
  if (error) {
    const err = new Error(`[supabase] ${context} : ${error.message}`);
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
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .ilike("username", username)
    .maybeSingle();
  throwIfError(error, "getUserByUsername");
  return data;
}

async function createUser(user) {
  const { data, error } = await supabase.from("users").insert(user).select().single();
  throwIfError(error, "createUser");
  return data;
}

/** patch = objet partiel des colonnes à mettre à jour */
async function updateUser(id, patch) {
  const { data, error } = await supabase
    .from("users")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  throwIfError(error, "updateUser");
  return data;
}

async function deleteUser(id) {
  const { error } = await supabase.from("users").delete().eq("id", id);
  throwIfError(error, "deleteUser");
}

async function listUsers() {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("created_at", { ascending: true });
  throwIfError(error, "listUsers");
  return data;
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
  const { data, error } = await supabase
    .from("quizzes")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  throwIfError(error, "updateQuiz");
  return data;
}

async function deleteQuiz(id) {
  const { error } = await supabase.from("quizzes").delete().eq("id", id);
  throwIfError(error, "deleteQuiz");
}

async function listQuizzes() {
  const { data, error } = await supabase
    .from("quizzes")
    .select("*")
    .order("created_at", { ascending: false });
  throwIfError(error, "listQuizzes");
  return data;
}

module.exports = {
  supabase,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  deleteUser,
  listUsers,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  listQuizzes,
};
