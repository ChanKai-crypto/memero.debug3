-- ============================================================
-- Migration "Langue du joueur" (novembre 2026)
-- Enregistre la langue choisie par chaque joueur dans ses Paramètres :
-- il ne voit que les quiz, parcours et arbres de cette langue, et les
-- admins la voient dans le panneau d'administration.
-- Sans danger à relancer (if not exists), rien n'est supprimé.
-- ============================================================

alter table users add column if not exists preferred_language text not null default 'fr';
alter table learn_trees add column if not exists language text not null default '';
