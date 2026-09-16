-- ============================================================
-- Schema Supabase (Postgres) pour le backend Memerro.
-- A executer une seule fois : Supabase -> SQL Editor -> New query ->
-- coller ce fichier entier -> Run.
-- Sans danger de le relancer plus tard (tout est en IF NOT EXISTS) :
-- ca ne touchera jamais aux donnees deja presentes.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  email text,
  password_hash text not null,
  role text not null default 'user',
  avatar_url text,
  banned boolean not null default false,
  subscription jsonb not null default '{"tier":"free","status":"active","startedAt":null,"renewsAt":null,"provider":null,"providerTransactionId":null}'::jsonb,
  game jsonb not null default '{"gems":0,"lives":{"count":6,"lastLossAt":null},"streak":{"count":0,"lastPlayAt":null},"lifetimeScore":0,"inventory":{"multiplier":0,"joker":0},"chestsUnlocked":[],"chestsPending":[]}'::jsonb,
  stats jsonb not null default '{"quizzesPlayed": 0}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  playlists jsonb not null default '[]'::jsonb,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references users(id) on delete set null,
  owner_username text,
  title text,
  difficulty text,
  format text,
  raw text,
  config jsonb,
  language text,
  premium_only boolean not null default false,
  official boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Colonnes ajoutees apres la creation initiale : sans danger a relancer
-- meme si elles existent deja.
alter table users add column if not exists history jsonb not null default '[]'::jsonb;
alter table users add column if not exists playlists jsonb not null default '[]'::jsonb;
alter table users add column if not exists stripe_customer_id text;
alter table users add column if not exists stripe_subscription_id text;
alter table quizzes add column if not exists official boolean not null default false;

-- Verification d'email : ajoutees pour le flux "verifie ton email" du front.
alter table users add column if not exists email_verified boolean not null default false;
alter table users add column if not exists email_verification_code text;
alter table users add column if not exists email_verification_expires_at timestamptz;
alter table users add column if not exists email_verification_last_sent_at timestamptz;

-- Langue d'explication du quiz (distincte de la langue principale "language").
alter table quizzes add column if not exists instruction_language text;

create index if not exists users_username_lower_idx on users (lower(username));
create index if not exists users_stripe_customer_idx on users (stripe_customer_id);
create index if not exists quizzes_owner_idx on quizzes (owner_id);
