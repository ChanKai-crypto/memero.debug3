-- ============================================================
-- Migration "Arbres" (octobre 2026)
-- Hiérarchie : Arbre → Sections → Parcours → Quiz → Niveaux.
--
-- • Crée la table learn_trees (un arbre par thème : sujet + style visuel).
-- • Rattache chaque section à un arbre (learn_sections.tree_id).
-- • Range les sections déjà existantes dans un premier arbre
--   « Arbre principal » pour que rien ne disparaisse de l'app.
--
-- Sans danger à relancer : tout est en "if not exists", rien n'est
-- supprimé. Les anciennes colonnes playlists.path_type / playlists.sections
-- (mode "parcours par sections", retiré de l'app) sont laissées en place.
--
-- Marche à suivre : Supabase → SQL Editor → New query → colle tout → Run.
-- ============================================================

create table if not exists learn_trees (
  id          text primary key,
  name        text not null,
  subject     text not null default '',
  emoji       text not null default '🌳',
  color       text not null default '#3b82f6',
  background  text not null default 'default',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Au cas où la table des sections n'aurait jamais été créée sur ce projet.
create table if not exists learn_sections (
  id               text primary key,
  category         text not null,
  name             text not null,
  emoji            text not null default '📘',
  unlock_threshold jsonb not null default '{"type":"count","value":1}'::jsonb,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table learn_sections add column if not exists items_per_row integer not null default 2;
alter table learn_sections add column if not exists tree_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'learn_sections_tree_id_fkey') then
    alter table learn_sections
      add constraint learn_sections_tree_id_fkey
      foreign key (tree_id) references learn_trees(id) on delete cascade;
  end if;
end $$;
create index if not exists learn_sections_tree_id_idx on learn_sections(tree_id);

-- Colonnes des parcours utilisées par les sections (déjà présentes
-- normalement ; ajoutées seulement si elles manquent).
alter table playlists add column if not exists learn_section_id text;
alter table playlists add column if not exists learn_section_order integer not null default 0;

-- Range les sections existantes (sans arbre) dans un premier arbre.
insert into learn_trees (id, name, subject, emoji, sort_order)
select 'arbre-principal', 'Arbre principal', 'Général', '🌳', 0
where not exists (select 1 from learn_trees)
  and exists (select 1 from learn_sections where tree_id is null);

update learn_sections
set tree_id = (select id from learn_trees order by sort_order, created_at limit 1)
where tree_id is null
  and exists (select 1 from learn_trees);

-- Vérification : chaque section doit maintenant avoir un tree_id.
select s.name as section, t.name as arbre
from learn_sections s left join learn_trees t on t.id = s.tree_id
order by t.sort_order, s.sort_order;
