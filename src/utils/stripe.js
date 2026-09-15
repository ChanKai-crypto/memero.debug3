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

module.exports = { stripe, priceIdForTier, tierForPriceId };
