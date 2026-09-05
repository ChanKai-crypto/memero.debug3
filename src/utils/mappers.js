/** Transforme une ligne "users" de Supabase en objet sûr à renvoyer au client. */
function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    avatarUrl: row.avatar_url,
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
    premiumOnly: row.premium_only,
    official: row.official,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { toPublicUser, toPublicQuiz };
