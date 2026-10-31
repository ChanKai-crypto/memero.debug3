-- ============================================================
-- Migration "Langue des arbres" (octobre 2026)
-- Ajoute à chaque arbre la langue des joueurs qui le voient.
-- '' (vide) = visible quelle que soit la langue du joueur.
--
-- Sans danger à relancer (if not exists), rien n'est supprimé.
-- Marche à suivre : Supabase → SQL Editor → New query → colle tout → Run.
-- ============================================================

alter table learn_trees add column if not exists language text not null default '';
