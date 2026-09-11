# memero-backend

Backend (comptes, quiz communautaires, progression, panneau admin) pour l'app Memero. Écrit en Node.js/Express, sans base de données externe à provisionner (stockage dans un simple fichier JSON) : déployable en un clic sur Render, Railway, Fly.io, etc.

**Aucune modification du HTML n'est nécessaire.** L'app Memero appelle déjà ce contrat d'API exactement tel quel (voir le bloc "Pont vers un backend" dans le fichier HTML). Il suffit de démarrer ce serveur, de renseigner son adresse dans l'app (Compte → Serveur), et tout se synchronise automatiquement.

## Démarrage local

```bash
npm install
cp .env.example .env      # puis édite JWT_SECRET dans .env
npm start                 # démarre sur http://localhost:3000
```

Dans l'app (dans un navigateur, ou dans l'APK une fois rebuild avec ce même HTML) : Compte → Serveur → renseigne `http://localhost:3000` (ou l'adresse publique une fois déployé) → Enregistrer.

## Créer le premier compte administrateur

```bash
node scripts/seedAdmin.js <pseudo> <mot-de-passe>
```

- Si `<pseudo>` n'existe pas encore : il est créé directement avec le rôle admin.
- S'il existe déjà : il est promu admin et son mot de passe est réinitialisé (utile si oublié).

Une fois connecté avec ce compte dans l'app, un bouton **🛠 Administration** apparaît dans l'écran Compte (gestion des comptes et des quiz).

## Déployer sur Render (gratuit)

1. Pousse ce dossier sur un dépôt GitHub.
2. Sur [render.com](https://render.com) : New → Blueprint → sélectionne le dépôt. Le fichier `render.yaml` fourni configure tout automatiquement (JWT_SECRET généré, build/start command).
3. Une fois déployé, note l'URL publique (`https://ton-service.onrender.com`).
4. Dans l'app, Compte → Serveur → colle cette URL.
5. Crée ton compte admin en te connectant au Shell Render du service (Dashboard → ton service → Shell) :
   ```bash
   node scripts/seedAdmin.js <pseudo> <mot-de-passe>
   ```

⚠️ **Persistance sur le plan gratuit Render** : le disque d'un service gratuit est éphémère — son contenu (donc `data/db.json`, donc tous les comptes et quiz) est perdu à chaque redéploiement, mais **pas** à chaque mise en veille pour inactivité. Pour une vraie persistance long terme :
- ajoute un [Persistent Disk](https://render.com/docs/disks) Render (plan payant) monté sur `data/`, ou
- remplace `src/db.js` par un vrai client de base de données (Postgres, etc.) — toute l'app passe uniquement par `readDb()` / `writeDb()` / `transact()`, donc le changement reste isolé à ce seul fichier.

## Contrat d'API (résumé)

| Méthode | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | non | ping |
| POST | `/api/auth/signup` | non | `{username,password}` → `{token,user}` |
| POST | `/api/auth/login` | non | `{username,password}` → `{token,user}` |
| GET | `/api/auth/me` | oui | `{user}` |
| PATCH | `/api/users/me/password` | oui | `{currentPassword,newPassword}` |
| DELETE | `/api/users/me` | oui | `{password}` — supprime le compte et ses quiz |
| PATCH | `/api/users/me/game` | oui | `{gems?,lives?,streak?,lifetimeScore?,inventory?,chestsUnlocked?,chestsPending?}` |
| POST | `/api/users/me/history` | oui | ajoute une entrée d'historique de partie |
| GET/PUT | `/api/users/me/playlists` | oui | `{playlists:[...]}` |
| GET | `/api/quizzes` | optionnelle | liste publique (quiz Premium masqués si compte non éligible) |
| POST | `/api/quizzes` | oui | publie un quiz pour le compte connecté |
| PUT/DELETE | `/api/quizzes/:id` | oui (propriétaire ou admin) | modifie/supprime |
| GET | `/api/admin/users` | admin | liste des comptes |
| PATCH/DELETE | `/api/admin/users/:id` | admin | rôle, bannissement, suppression |
| PATCH | `/api/admin/users/:id/password` | admin | réinitialise un mot de passe |
| GET | `/api/admin/quizzes` | admin | liste tous les quiz |
| PATCH/DELETE | `/api/admin/quizzes/:id` | admin | Officiel/Premium, suppression |

## Structure

```
memero-backend/
├── server.js              # point d'entrée Express
├── src/
│   ├── db.js               # stockage JSON fichier (lecture/écriture/transaction atomiques)
│   ├── auth.js              # hash mot de passe, JWT, middlewares requireAuth/requireAdmin
│   └── routes/
│       ├── auth.js          # signup/login/me
│       ├── users.js         # password, delete, game, history, playlists
│       ├── quizzes.js       # CRUD quiz communautaires
│       └── admin.js         # gestion comptes + quiz (rôle admin)
├── scripts/
│   └── seedAdmin.js         # crée/promeut un compte admin en ligne de commande
└── render.yaml              # config de déploiement Render en un clic
```
