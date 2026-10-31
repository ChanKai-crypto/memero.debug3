-- ============================================================
-- Migration "Unités de parcours" (novembre 2026)
-- Permet d'organiser librement les niveaux d'un parcours en unités
-- (au lieu de « 1 quiz = 1 unité »).
-- Format : [{ "id": "...", "name": "...", "items": [{ "q": "<id du quiz>", "l": <index du niveau> }] }]
-- Sans danger à relancer, rien n'est supprimé.
-- ============================================================

alter table playlists add column if not exists units jsonb not null default '[]'::jsonb;
