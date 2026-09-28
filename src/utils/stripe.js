/**
 * Client Stripe partagé. Toute la logique de paiement (créer une session de
 * paiement, vérifier un webhook) passe par cet objet.
 *
 * STRIPE_SECRET_KEY doit être la clé "secrète" (jamais la clé publique),
 * trouvable sur https://dashboard.stripe.com/apikeys — commence par
 * sk_test_... en mode test, sk_live_... une fois prêt à encaisser pour de vrai.
 */
const Stripe = require("stripe");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.warn(
    "⚠️  STRIPE_SECRET_KEY non définie : les routes de paiement renverront une erreur tant qu'elle n'est pas configurée."
  );
}

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

/** tier ("bas" | "standard" | "plus") -> ID du Price Stripe correspondant. */
function priceIdForTier(tier) {
  const map = {
    bas: process.env.STRIPE_PRICE_BAS,
    standard: process.env.STRIPE_PRICE_STANDARD,
    plus: process.env.STRIPE_PRICE_PLUS,
  };
  return map[tier] || null;
}

/** ID du Price Stripe -> tier ("bas" | "standard" | "plus" | null). */
function tierForPriceId(priceId) {
  if (priceId === process.env.STRIPE_PRICE_BAS) return "bas";
  if (priceId === process.env.STRIPE_PRICE_STANDARD) return "standard";
  if (priceId === process.env.STRIPE_PRICE_PLUS) return "plus";
  return null;
}

/**
 * Packs de gemmes en vente dans la boutique (paiement unique, pas un
 * abonnement). Chaque pack a son propre Price Stripe (créé en mode "one
 * time", pas "recurring") — voir .env.example pour la liste des variables
 * à configurer. Le nombre de gemmes de chaque pack est défini ICI (pas dans
 * Stripe, qui ne connaît que le prix) : Stripe ne fait que confirmer le
 * paiement, c'est ce fichier qui décide combien de gemmes ça vaut.
 */
const GEM_PACKS = {
  petit: { gems: 500, envVar: "STRIPE_PRICE_GEMS_PETIT" },
  moyen: { gems: 1200, envVar: "STRIPE_PRICE_GEMS_MOYEN" },
  grand: { gems: 3000, envVar: "STRIPE_PRICE_GEMS_GRAND" },
  mega: { gems: 7000, envVar: "STRIPE_PRICE_GEMS_MEGA" },
};

/** id de pack ("petit"|"moyen"|"grand"|"mega") -> ID du Price Stripe. */
function priceIdForGemPack(packId) {
  const pack = GEM_PACKS[packId];
  if (!pack) return null;
  return process.env[pack.envVar] || null;
}

/** id de pack -> nombre de gemmes accordées. */
function gemsForPack(packId) {
  const pack = GEM_PACKS[packId];
  return pack ? pack.gems : 0;
}

/** ID du Price Stripe -> id de pack ("petit"|"moyen"|"grand"|"mega"|null). */
function packIdForPriceId(priceId) {
  for (const id of Object.keys(GEM_PACKS)) {
    if (priceId === process.env[GEM_PACKS[id].envVar]) return id;
  }
  return null;
}

module.exports = { stripe, priceIdForTier, tierForPriceId, GEM_PACKS, priceIdForGemPack, gemsForPack, packIdForPriceId };
