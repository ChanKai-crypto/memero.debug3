-- =====================================================================
-- Memerro — migration du 9 novembre 2026 (fonds + réductions)
-- À lancer UNE fois dans Supabase : SQL Editor > New query > coller > Run.
-- Sans danger : ne supprime aucune donnée, peut être relancé.
-- (Lance d'abord migration-2026-11-fiabilite-fonds.sql si ce n'est pas fait.)
-- =====================================================================

-- 1) Fonds : nouvelles options "après la période"
--    unavailable = plus disponible (les joueurs qui l'ont le gardent)
--    reactivate  = redevient disponible à une date
--    change      = reste disponible avec un autre prix / une autre rareté
alter table public.custom_skins drop constraint if exists custom_skins_after_end_check;
alter table public.custom_skins add column if not exists react_at timestamptz;
alter table public.custom_skins add column if not exists after_price integer;
alter table public.custom_skins add column if not exists after_rarity text;
update public.custom_skins set after_end = 'unavailable' where after_end in ('keep', 'remove');
alter table public.custom_skins alter column after_end set default 'unavailable';
alter table public.custom_skins add constraint custom_skins_after_end_check
  check (after_end in ('unavailable', 'reactivate', 'change', 'keep', 'remove'));

-- 2) Réductions
create table if not exists public.discounts (
  id text primary key,
  name text not null,
  percent integer not null check (percent between 1 and 90),
  targets jsonb not null default '{}'::jsonb,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses_count integer not null default 0,
  avail_type text not null default 'always' check (avail_type in ('always','yearly','dates')),
  from_md text,
  to_md text,
  starts_at timestamptz,
  ends_at timestamptz,
  after_end text not null default 'unavailable' check (after_end in ('unavailable','reactivate','change')),
  react_at timestamptz,
  after_percent integer check (after_percent is null or after_percent between 1 and 90),
  duration text not null default 'once' check (duration in ('once','repeating','forever')),
  duration_months integer,
  show_code boolean not null default false,
  code text,
  extra_text text,
  active boolean not null default true,
  stripe_coupons jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.discounts enable row level security;
