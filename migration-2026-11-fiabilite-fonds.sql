-- =====================================================================
-- Memerro — migration du 8 novembre 2026
-- À lancer UNE fois dans Supabase : SQL Editor > New query > coller > Run.
-- Sans danger : ne supprime rien, peut être relancé plusieurs fois.
-- =====================================================================

-- 1) Corbeille : copie de TOUT ce qui est supprimé (quiz, parcours, arbres,
--    sections, fonds, comptes), restaurable depuis le panneau admin.
create table if not exists public.deleted_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  item_id text not null,
  data jsonb not null,
  deleted_by text,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz
);
create index if not exists deleted_items_deleted_at_idx on public.deleted_items (deleted_at desc);
create index if not exists deleted_items_item_idx on public.deleted_items (kind, item_id);
alter table public.deleted_items enable row level security;

-- 2) Fonds ajoutés depuis le panneau admin
create table if not exists public.custom_skins (
  id text primary key check (id ~ '^c_[a-z_]{1,28}$'),
  name text not null,
  rarity text not null default 'commun' check (rarity in ('commun','rare','epique','legendaire')),
  price integer check (price is null or price >= 0),
  max_owners integer check (max_owners is null or max_owners > 0),
  owners_count integer not null default 0,
  avail_type text not null default 'always' check (avail_type in ('always','yearly','dates')),
  from_md text,
  to_md text,
  starts_at timestamptz,
  ends_at timestamptz,
  after_end text not null default 'keep' check (after_end in ('keep','remove')),
  in_shop boolean not null default true,
  in_chests boolean not null default true,
  active boolean not null default true,
  image text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.custom_skins enable row level security;

-- 3) (rappel de la migration précédente, sans effet si déjà faite)
alter table public.playlists add column if not exists question_types jsonb;
