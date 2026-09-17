-- ============================================================
-- Migration pour un projet Supabase DÉJÀ créé (tables users/quizzes
-- existantes). Ajoute uniquement ce qui manque encore : langue
-- d'explication des quiz + vérification d'email + quelques colonnes
-- plus anciennes, au cas où elles auraient été oubliées aussi.
--
-- 100% sans danger à lancer, même plusieurs fois, même si certaines
-- colonnes existent déjà : tout est en "if not exists", rien n'écrase
-- ni ne supprime de données existantes.
--
-- Marche à suivre :
-- 1. Supabase → ton projet → SQL Editor (menu de gauche) → New query
-- 2. Colle TOUT ce fichier
-- 3. Run (bouton en bas à droite, ou Ctrl/Cmd + Entrée)
-- 4. La dernière requête du fichier affiche la liste des colonnes de
--    "quizzes" : vérifie que "instruction_language" apparaît bien
--    dans le résultat — c'est la confirmation que ça a marché.
-- ============================================================

alter table quizzes add column if not exists instruction_language text;
alter table quizzes add column if not exists official boolean not null default false;

alter table users add column if not exists history jsonb not null default '[]'::jsonb;
alter table users add column if not exists playlists jsonb not null default '[]'::jsonb;
alter table users add column if not exists stripe_customer_id text;
alter table users add column if not exists stripe_subscription_id text;
alter table users add column if not exists email_verified boolean not null default false;
alter table users add column if not exists email_verification_code text;
alter table users add column if not exists email_verification_expires_at timestamptz;
alter table users add column if not exists email_verification_last_sent_at timestamptz;

create index if not exists users_username_lower_idx on users (lower(username));
create index if not exists users_stripe_customer_idx on users (stripe_customer_id);
create index if not exists quizzes_owner_idx on quizzes (owner_id);

-- Vérification : doit afficher une ligne "instruction_language" (et les
-- autres colonnes ci-dessus) dans le résultat, tout en bas de l'écran
-- après avoir cliqué Run.
select column_name, data_type
from information_schema.columns
where table_name in ('users', 'quizzes')
order by table_name, column_name;
