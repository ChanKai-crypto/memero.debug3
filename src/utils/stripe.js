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

/**
 * tier interne + interval ("year" | "month") -> ID du Price Stripe.
 * Les codes internes restent "bas" / "standard" / "plus" (enregistrés dans
 * les comptes), mais les variables Render portent les noms commerciaux :
 *   bas      = Memerro Plus  -> STRIPE_PRICE_PLUS_MONTHLY  / STRIPE_PRICE_PLUS_YEARLY
 *   standard = Memerro Max   -> STRIPE_PRICE_MAX_MONTHLY   / STRIPE_PRICE_MAX_YEARLY
 *   plus     = Memerro Ultra -> STRIPE_PRICE_ULTRA_MONTHLY / STRIPE_PRICE_ULTRA_YEARLY
 */
const TIER_ENV = { bas: "PLUS", standard: "MAX", plus: "ULTRA" };
function priceIdForTier(tier, interval) {
  const name = TIER_ENV[tier];
  if (!name) return null;
  return process.env["STRIPE_PRICE_" + name + (interval === "month" ? "_MONTHLY" : "_YEARLY")] || null;
}

/** ID du Price Stripe (mensuel OU annuel) -> tier ("bas" | "standard" | "plus" | null). */
function tierForPriceId(priceId) {
  if (!priceId) return null;
  for (const tier of ["bas", "standard", "plus"]) {
    if (priceId === priceIdForTier(tier, "year") || priceId === priceIdForTier(tier, "month")) return tier;
  }
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
  mega: { gems: 6500, envVar: "STRIPE_PRICE_GEMS_MEGA" },
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
