# Memerro — Backend

Petit serveur (Node.js + Express) qui stocke **vraiment** :

- les **comptes** (pseudo, mot de passe hashé, photo de profil, abonnement, gemmes, vies, série, statistiques),
- un **compte administrateur** (rôle `admin`, avec des routes réservées),
- les **quiz** (titre, format, difficulté, texte brut, configuration complète, langue, `premiumOnly`, `official`).

Les données sont stockées sur **Supabase** (Postgres géré, gratuit), et le
serveur est pensé pour être déployé sur **Render** (gratuit).

Les abonnements sont **réellement facturés via Stripe** (voir la section
Stripe plus bas) : l'abonnement ne s'active que lorsque Stripe confirme le
paiement via un webhook signé, jamais sur simple requête du navigateur.

## 1. Créer le projet Supabase

1. Crée un compte gratuit sur [supabase.com](https://supabase.com) → **New project**.
2. Une fois prêt : **SQL Editor** → **New query** → colle tout le contenu de
   `supabase-schema.sql` (fourni dans ce dossier) → **Run**.
3. **Project Settings** → **API** → note :
   - **Project URL** → `SUPABASE_URL`
   - **service_role** (clique "Reveal") → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ secret, ne jamais l'exposer côté client)

## 2. Installation en local (optionnel, pour tester avant de déployer)

```bash
cd memero-backend
npm install
cp .env.example .env
```

Remplis `.env` avec `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, et les
deux valeurs Supabase de l'étape 1. Puis :

```bash
npm run seed:admin
npm start
```

Vérifie : `curl http://localhost:4000/api/health`

## 3. Déployer sur Render (gratuit)

1. Mets ce dossier sur GitHub (crée un dépôt, uploade tous les fichiers).
2. Sur [render.com](https://render.com) → **New** → **Web Service** → connecte le dépôt.
3. Réglages :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Plan** : Free
4. **Environment** → ajoute toutes les variables de `.env.example` (avec tes
   vraies valeurs Supabase, `JWT_SECRET`, `ADMIN_*`, `CORS_ORIGIN`, et les
   `STRIPE_*` / `FRONTEND_URL` si tu utilises déjà Stripe).
5. **Deploy**. Une fois en ligne, onglet **Shell** → lance :
   ```bash
   npm run seed:admin
   ```
6. Teste : `https://ton-service.onrender.com/api/health`

⚠️ Sur le plan gratuit, Render met le service en veille après une période
d'inactivité : le premier appel après une pause peut prendre 30-50 secondes
le temps qu'il se réveille — c'est normal, pas une panne.

### Brancher ton app Memerro (le fichier HTML) sur ce backend
Deux façons de faire, et il te faut la première pour que **tout le monde**
(pas seulement toi) voie le contenu partagé :

1. **Pour tous les visiteurs (obligatoire)** : ouvre `index.html`, cherche
   `DEFAULT_BACKEND_URL` (juste avant `seedDefaultBackendUrl`), et remplace
   la valeur par l'adresse Render de ton service (ex.
   `https://ton-service.onrender.com`), puis redéploie sur Netlify. C'est ce
   qui est mis automatiquement dans le stockage local de chaque nouveau
   visiteur — sans ça, Découvrir restera vide pour tout le monde sauf toi.
2. **Juste pour toi, en test** (ou pour pointer vers un autre serveur sans
   retoucher au HTML) : ouvre l'app → **Compte** → **⚙ Paramètres du
   compte** → section **Serveur** (visible seulement une fois connecté en
   admin), et renseigne l'adresse Render. Ce réglage est propre à ton
   navigateur : il ne change rien pour les autres visiteurs.

## 4. Déployer le frontend (le fichier HTML) sur Netlify

1. Après avoir mis à jour `DEFAULT_BACKEND_URL` (étape ci-dessus), va sur
   [netlify.com](https://netlify.com) → **Add new site** → **Deploy manually**,
   puis glisse-dépose simplement `index.html` (Netlify accepte un fichier
   unique aussi bien qu'un dossier).
2. Une fois en ligne, note l'adresse Netlify (ex. `https://ton-site.netlify.app`)
   et renseigne-la dans `FRONTEND_URL` côté backend (Render → Environment) —
   c'est là que Stripe renvoie le joueur après un paiement.
3. Mets aussi cette même adresse dans `CORS_ORIGIN` côté backend (au lieu de
   `*`) une fois que tout fonctionne, pour que seul ton site puisse appeler
   l'API depuis un navigateur.

## 5. Routes disponibles

| Méthode | Route                        | Rôle requis      | Description |
|---------|-------------------------------|-------------------|--------------|
| POST    | `/api/auth/signup`            | public            | Créer un compte (envoie un code de vérification si un email est fourni) |
| POST    | `/api/auth/login`             | public            | Se connecter |
| GET     | `/api/auth/me`                | connecté          | Profil actuel |
| POST    | `/api/auth/resend-verification` | connecté        | Renvoie un nouveau code de vérification par email |
| POST    | `/api/auth/verify-email`      | connecté          | Valide le code et confirme l'adresse email |
| PATCH   | `/api/users/me`                | connecté          | Modifier email / photo (PNG en base64) — changer d'email redemande une vérification |
| PATCH   | `/api/users/me/password`       | connecté          | Changer son mot de passe (avec l'actuel) |
| DELETE  | `/api/users/me`                | connecté          | Supprimer définitivement son propre compte |
| PATCH   | `/api/users/me/game`           | connecté          | Synchroniser gemmes / vies / série / inventaire |
| POST    | `/api/users/me/subscribe`      | connecté          | ⚠️ Réservé démo/tests internes — voir section Stripe pour l'activation réelle |
| POST    | `/api/users/me/history`        | connecté          | Ajouter une entrée à l'historique de parties |
| GET/PUT | `/api/users/me/playlists`      | connecté          | Lire/remplacer ses parcours |
| GET     | `/api/quizzes`                 | public (optionnel)| Liste des quiz (les `premiumOnly` sont verrouillés si non-Premium) |
| GET     | `/api/quizzes/:id`              | public (optionnel)| Détail d'un quiz |
| POST    | `/api/quizzes`                  | connecté          | Publier un quiz |
| PUT     | `/api/quizzes/:id`               | propriétaire/admin| Modifier un quiz (met à jour, ne duplique pas) |
| DELETE  | `/api/quizzes/:id`               | propriétaire/admin| Supprimer un quiz |
| GET     | `/api/leaderboard?limit=20`      | public            | Classement des joueurs par score cumulé |
| GET     | `/api/leaderboard/official?limit=50` | public        | Meilleurs scores sur les quiz officiels |
| GET     | `/api/playlists`                 | public            | Annuaire de tous les parcours marqués publics (tous comptes) |
| GET     | `/api/admin/users`               | **admin**         | Lister tous les comptes |
| PATCH   | `/api/admin/users/:id`            | **admin**         | Changer rôle / abonnement / gemmes / bannir |
| PATCH   | `/api/admin/users/:id/password`   | **admin**         | Réinitialiser le mot de passe d'un compte ("mot de passe oublié") |
| DELETE  | `/api/admin/users/:id`            | **admin**         | Supprimer un compte |
| GET     | `/api/admin/quizzes`              | **admin**         | Tous les quiz, y compris Premium |
| PATCH   | `/api/admin/quizzes/:id`           | **admin**         | Marquer un quiz Officiel/Premium ou non |
| POST    | `/api/billing/checkout`           | connecté          | Crée une session de paiement Stripe pour un palier d'abonnement |
| POST    | `/api/billing/portal`             | connecté          | Ouvre le portail Stripe (facture, carte, résiliation) |
| POST    | `/api/billing/webhook`            | Stripe uniquement | Confirme le paiement et active l'abonnement (jamais appelé par l'app) |

## 6. Stripe (paiement réel des abonnements)

1. Crée un compte sur [stripe.com](https://stripe.com) (mode **Test** pour essayer sans vrai argent).
2. **Developers → API keys** → copie la **Secret key** dans `STRIPE_SECRET_KEY`.
3. Crée 3 **Products** (Premium bas / standard / plus), chacun avec un **Price**
   récurrent mensuel. Copie chaque ID (`price_...`) dans `STRIPE_PRICE_BAS`,
   `STRIPE_PRICE_STANDARD`, `STRIPE_PRICE_PLUS`.
4. **Developers → Webhooks → Add endpoint** : URL = `https://ton-service.onrender.com/api/billing/webhook`,
   événements à écouter : `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Copie le **Signing secret** dans `STRIPE_WEBHOOK_SECRET`.
5. Renseigne `FRONTEND_URL` (l'adresse de ton site) — Stripe y renvoie le joueur après paiement.

## 7. Sécurité et bonnes pratiques

- La clé `SUPABASE_SERVICE_ROLE_KEY` donne un accès total à la base : ne la
  mets jamais dans le frontend ni dans un dépôt public.
- Ajoute un limiteur de requêtes (`express-rate-limit`) sur `/api/auth/*`
  si le site devient public, pour limiter les tentatives de connexion en force brute.

## 8. Vérification d'email (Resend)

À l'inscription (si un email est fourni), un code à 6 chiffres est généré et
envoyé, et le front ouvre automatiquement l'écran "Vérifie ton email".

- **Sans configuration** : le code n'est pas envoyé par email, seulement
  affiché dans les logs du serveur (Render → onglet **Logs**) — pratique
  pour tester le flux sans compte email tiers.
- **Pour un vrai envoi** : crée un compte gratuit sur
  [resend.com](https://resend.com) (3000 emails/mois gratuits, aucune carte
  bancaire), **API Keys → Create API Key**, colle la clé dans
  `RESEND_API_KEY` (Render → Environment). Garde `EMAIL_FROM` tel quel
  (`onboarding@resend.dev`) tant que tu n'as pas connecté ton propre nom de
  domaine sur Resend — sinon les emails partiront de ton adresse une fois le
  domaine vérifié côté Resend.
- Le code expire au bout de 15 minutes ; le bouton "Renvoyer" est limité à
  un envoi toutes les 30 secondes (protection anti-spam côté serveur, en plus
  du délai déjà affiché côté app).

