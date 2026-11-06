-- Memerro — novembre 2026 : types de questions par parcours.
-- (Les fonds d'écran, le coffre journalier et les plafonds de coffres sont
-- stockés dans la colonne JSON « game » des comptes : aucune colonne à créer.)
alter table public.playlists add column if not exists question_types jsonb;
