/** Transforme une ligne "users" de Supabase en objet sûr à renvoyer au client. */
function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    emailVerified: !!row.email_verified,
    role: row.role,
    protected: !!row.protected,
    createdAt: row.created_at,
    avatarUrl: row.avatar_url,
    // Langue du joueur (choisie dans ses Paramètres) : il ne voit que les
    // quiz, parcours et arbres de cette langue.
    preferredLanguage: row.preferred_language || "fr",
    banned: row.banned,
    subscription: row.subscription,
    game: row.game,
    stats: row.stats,
    history: row.history || [],
    playlists: row.playlists || [],
  };
}

/** Transforme une ligne "quizzes" de Supabase en objet à renvoyer au client. */
function toPublicQuiz(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerUsername: row.owner_username,
    title: row.title,
    difficulty: row.difficulty,
    format: row.format,
    raw: row.raw,
    config: row.config,
    language: row.language,
    instructionLanguage: row.instruction_language || row.language,
    premiumOnly: row.premium_only,
    official: row.official,
    hidden: !!row.hidden,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { toPublicUser, toPublicQuiz };
