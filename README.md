# Memero — Backend

Petit serveur (Node.js + Express) qui stocke **vraiment** :

- les **comptes** (pseudo, mot de passe hashé, photo de profil, abonnement, gemmes, vies, série, statistiques),
- un **compte administrateur** (rôle `admin`, avec des routes réservées),
- les **quiz** (titre, format, difficulté, texte brut, configuration complète, langue, `premiumOnly`).

Les données sont stockées sur **[Supabase](https://supabase.com)** (base de
données Postgres gérée, **gratuite en continu** dans ses limites — contrairement
au disque persistant de Render, qui lui nécessite un plan payant). Le serveur
lui-même peut donc tourner sur le **plan gratuit de Render**, sans jamais perdre
de données, même si le service redémarre ou se met en veille.

> ⚠️ **Ce backend est un point de départ fonctionnel, pas encore prêt pour de
> vrais paiements.** L'abonnement s'active sans vérifier qu'un paiement a eu
> lieu (`POST /api/users/me/subscribe`). Avant de facturer de vrais
> utilisateurs, il faut brancher Google Play Billing / Stripe côté serveur
> (voir la fin de ce fichier).

## 1. Créer la base de données (Supabase, gratuit)

1. Va sur **[supabase.com](https://supabase.com)**, crée un compte gratuit.
2. Clique **New project**. Choisis un nom, un mot de passe de base de données
   (garde-le, pas besoin de le ressaisir ensuite), une région proche de toi.
   Attends ~2 minutes que le projet soit prêt.
3. Va dans **SQL Editor** (menu de gauche) → **New query**.
4. Ouvre le fichier `supabase-schema.sql` fourni dans ce dossier, copie tout
   son contenu, colle-le dans l'éditeur SQL de Supabase, clique **Run**.
   → Ça crée les deux tables (`users` et `quizzes`).
5. Va dans **Project Settings** (icône ⚙️) → **API**. Note deux valeurs :
   - **Project URL** (ressemble à `https://xxxxxxxxxxxx.supabase.co`)
   - **service_role** (sous "Project API keys" — clique "Reveal" pour la voir).
     ⚠️ Cette clé donne un accès total à la base : ne la partage jamais, ne la
     mets jamais dans le frontend.

## 2. Installation en local

```bash
cd memero-backend
npm install
cp .env.example .env
```

Ouvre `.env` et remplis :
- `JWT_SECRET` (génère-en un avec `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` (le compte admin)
- `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` (récupérés à l'étape 1)

Puis crée le compte administrateur et lance le serveur :

```bash
npm run seed:admin
npm start
```

Le serveur écoute par défaut sur `http://localhost:4000`.
Vérifie qu'il tourne : `curl http://localhost:4000/api/health`

## 3. Tester rapidement (avec curl)

**Créer un compte joueur :**
```bash
curl -X POST http://localhost:4000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"Alice","password":"motdepasse123"}'
```
→ tu reçois `{ "token": "...", "user": {...} }`. Garde le `token`.

**Se connecter en admin :**
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"TON_MOT_DE_PASSE_ADMIN"}'
```

**Publier un quiz (avec le token reçu) :**
```bash
curl -X POST http://localhost:4000/api/quizzes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TON_TOKEN" \
  -d '{"title":"Capitales","raw":"Paris\nFrance\nBerlin\nAllemagne","format":"pairs"}'
```

**Lister les comptes en tant qu'admin :**
```bash
curl http://localhost:4000/api/admin/users -H "Authorization: Bearer TOKEN_ADMIN"
```

## 4. Routes disponibles

| Méthode | Route                        | Rôle requis      | Description |
|---------|-------------------------------|-------------------|--------------|
| POST    | `/api/auth/signup`            | public            | Créer un compte |
| POST    | `/api/auth/login`             | public            | Se connecter |
| GET     | `/api/auth/me`                | connecté          | Profil actuel |
| PATCH   | `/api/users/me`                | connecté          | Modifier email / photo (PNG en base64) |
| PATCH   | `/api/users/me/game`           | connecté          | Synchroniser gemmes / vies / série / inventaire |
| POST    | `/api/users/me/subscribe`      | connecté          | Activer un palier d'abonnement (⚠️ démo, sans paiement réel) |
| GET     | `/api/quizzes`                 | public (optionnel)| Liste des quiz (les `premiumOnly` sont verrouillés si non-Premium) |
| GET     | `/api/quizzes/:id`              | public (optionnel)| Détail d'un quiz |
| POST    | `/api/quizzes`                  | connecté          | Publier un quiz |
| PUT     | `/api/quizzes/:id`               | propriétaire/admin| Modifier un quiz |
| DELETE  | `/api/quizzes/:id`               | propriétaire/admin| Supprimer un quiz |
| GET     | `/api/admin/users`               | **admin**         | Lister tous les comptes |
| PATCH   | `/api/admin/users/:id`            | **admin**         | Changer rôle / abonnement / gemmes / bannir |
| DELETE  | `/api/admin/users/:id`            | **admin**         | Supprimer un compte |
| GET     | `/api/admin/quizzes`              | **admin**         | Tous les quiz, y compris Premium |
| PATCH   | `/api/admin/quizzes/:id`           | **admin**         | Marquer un quiz Premium ou non |

## 5. Déployer sur le web (Render, plan gratuit — 0 €)

1. **Mets ce dossier sur GitHub** (n'ajoute pas `.env`, il est déjà ignoré par
   `.gitignore`).
2. Sur **[render.com](https://render.com)** : **New +** → **Web Service** →
   connecte/sélectionne ton dépôt GitHub (ou utilise "Public Git Repository"
   avec l'URL du dépôt si tu ne veux pas autoriser l'app GitHub de Render).
3. Configure :
   - **Runtime** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : `Free`
4. **Onglet Environment** → ajoute toutes les variables de ton `.env` :
   `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_EMAIL`,
   `CORS_ORIGIN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
5. **Pas besoin d'ajouter de disque** cette fois — les données vivent sur
   Supabase, pas sur Render. Clique **Create Web Service**.
6. Une fois "Live" affiché, ouvre l'onglet **Shell** du service et lance :
   ```bash
   npm run seed:admin
   ```
7. Teste : `https://ton-service.onrender.com/api/health`

### À savoir sur le plan gratuit de Render
- Le service se met en veille après ~15 minutes sans requête, et met environ
  1 minute à redémarrer à la requête suivante (normal, pas un bug).
- Comme les données sont sur Supabase (pas sur le disque de Render), **rien
  n'est perdu** pendant ces mises en veille/redémarrages, contrairement à
  l'ancienne version de ce backend (fichier JSON local).
- Si un jour tu veux éviter le temps de réveil, il suffira de passer le
  service Render sur un plan payant (Starter, 7 $/mois) — Supabase, lui,
  restera gratuit tel quel.

### Brancher ton app Memero (le fichier HTML) sur ce backend
Pour l'instant, `memero2_4.html` stocke tout dans `localStorage`, uniquement
sur l'appareil. Une prochaine étape consistera à remplacer ces accès par des
appels `fetch()` vers cette API (avec le `token` reçu à la connexion gardé
côté client). Dis-moi quand tu veux que je m'en occupe.

## 6. Aller plus loin (avant une vraie mise en production)

- **Paiement réel** :
  - *Android* : intègre **Google Play Billing** côté app (`MainActivity.java`),
    puis vérifie chaque achat côté serveur avec l'API Google Play Developer
    avant d'appeler en interne `/api/users/me/subscribe`.
  - *Web* : utilise **Stripe Checkout + Webhooks** ; le webhook Stripe
    (signé, vérifié côté serveur) doit déclencher la mise à jour de
    l'abonnement — jamais une simple requête venant du navigateur.
- **Sécurité** : ajoute un limiteur de requêtes (`express-rate-limit`) sur
  `/api/auth/*`, active les **Row Level Security policies** de Supabase si tu
  ajoutes un jour un accès direct depuis le frontend (actuellement tout passe
  par ce serveur avec la clé `service_role`, donc RLS n'est pas encore
  utilisée activement), et ne fais plus confiance aux valeurs de jeu envoyées
  par le client (`/me/game`) sans les recalculer/valider côté serveur.
- **Sauvegardes** : Supabase fait des sauvegardes automatiques sur les plans
  payants ; sur le plan gratuit, pense à exporter régulièrement tes tables
  (Table Editor → export CSV, ou `pg_dump`) si les données deviennent
  précieuses.
