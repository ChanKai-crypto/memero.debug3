/**
 * Crée (ou met à jour) le compte administrateur à partir des variables
 * d'environnement ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_EMAIL.
 *
 * Utilisation :
 *   npm run seed:admin
 */
require("dotenv").config();
const db = require("../src/db");
const { hashPassword } = require("../src/utils/auth");

const username = process.env.ADMIN_USERNAME || "admin";
const password = process.env.ADMIN_PASSWORD;
const email = process.env.ADMIN_EMAIL || null;

async function main() {
  if (!password) {
    console.error("❌ Définis ADMIN_PASSWORD dans ton .env avant de lancer ce script.");
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("❌ ADMIN_PASSWORD doit faire au moins 6 caractères.");
    process.exit(1);
  }

  const existing = await db.getUserByUsername(username);

  if (existing) {
    await db.updateUser(existing.id, {
      password_hash: hashPassword(password),
      role: "admin",
      email: email || existing.email,
    });
    console.log(`✅ Compte admin existant "${username}" mis à jour (mot de passe/rôle).`);
  } else {
    await db.createUser({
      username,
      email,
      password_hash: hashPassword(password),
      role: "admin",
      subscription: {
        tier: "plus",
        status: "active",
        startedAt: new Date().toISOString(),
        renewsAt: null,
        provider: "admin",
        providerTransactionId: null,
      },
      game: {
        gems: 0,
        lives: { count: 6, lastLossAt: null },
        streak: { count: 0, lastPlayAt: null },
        lifetimeScore: 0,
        inventory: { multiplier: 0, joker: 0 },
        chestsUnlocked: [],
        chestsPending: [],
      },
      stats: { quizzesPlayed: 0 },
    });
    console.log(`✅ Compte administrateur "${username}" créé.`);
  }

  console.log("   Pense à changer le mot de passe si tu utilises encore la valeur par défaut !");
}

main().catch((e) => {
  console.error("❌ Erreur :", e.message);
  process.exit(1);
});
