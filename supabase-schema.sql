-- ============================================================
-- Schéma Memero pour Supabase.
-- À exécuter une seule fois : Supabase → SQL Editor → colle tout
-- ce fichier → Run.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------------------------- Comptes ----------------------------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  email text,
  password_hash text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  avatar_url text,
  banned boolean not null default false,
  subscription jsonb not null default '{
    "tier": "free",
    "status": "inactive",
    "startedAt": null,
    "renewsAt": null,
    "provider": null,
    "providerTransactionId": null
  }'::jsonb,
  game jsonb not null default '{
    "gems": 0,
    "lives": {"count": 6, "lastLossAt": null},
    "streak": {"count": 0, "lastPlayAt": null},
    "lifetimeScore": 0,
    "inventory": {"multiplier": 0, "joker": 0},
    "chestsUnlocked": [],
    "chestsPending": []
  }'::jsonb,
  stats jsonb not null default '{"quizzesPlayed": 0}'::jsonb
);

create index if not exists users_username_lower_idx on users (lower(username));

-- ----------------------------- Quiz ------------------------------
create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references users(id) on delete set null,
  owner_username text,
  title text not null,
  difficulty text default 'normal',
  format text default 'pairs',
  raw text not null,
  config jsonb not null default '{}'::jsonb,
  language text,
  premium_only boolean not null default false,
  official boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Si la table "quizzes" existait déjà (créée avant l'ajout des quiz "officiels"),
-- cette ligne ajoute juste la colonne manquante sans rien casser. Sans danger
-- de la relancer même si la colonne existe déjà.
alter table quizzes add column if not exists official boolean not null default false;

create index if not exists quizzes_owner_idx on quizzes (owner_id);
create index if not exists quizzes_premium_idx on quizzes (premium_only);
create index if not exists quizzes_official_idx on quizzes (official);

-- Important : la "service role key" utilisée par le backend contourne RLS
-- de toute façon, mais on active RLS par bonnes pratiques (empêche tout
-- accès direct depuis le navigateur avec une clé publique, si jamais).
alter table users enable row level security;
alter table quizzes enable row level security;
