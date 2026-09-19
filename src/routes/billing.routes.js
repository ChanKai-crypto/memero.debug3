const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authenticate");
const { stripe, priceIdForTier, tierForPriceId } = require("../utils/stripe");

const router = express.Router();

function frontendUrl() {
  return (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
}

// POST /api/billing/checkout   { tier: "bas" | "standard" | "plus" }
// Crée une session de paiement Stripe et renvoie son URL : le client doit
// rediriger le navigateur vers cette URL (window.location.href = url).
// Rien n'est activé ici — c'est le webhook plus bas qui confirme le paiement.
router.post("/checkout", authenticate(true), async (req, res, next) => {
  try {
    if (!stripe) return res.status(503).json({ error: "Paiement non configuré côté serveur (STRIPE_SECRET_KEY manquante)." });

    const { tier } = req.body || {};
    const priceId = priceIdForTier(tier);
    if (!priceId) {
      return res.status(400).json({ error: "Palier d'abonnement invalide ou non configuré (STRIPE_PRICE_...)." });
    }

    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email || undefined,
        metadata: { memero_user_id: req.user.id, memero_username: req.user.username },
      });
      customerId = customer.id;
      await db.updateUser(req.user.id, { stripe_customer_id: customerId });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: req.user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { memero_user_id: req.user.id, memero_tier: tier },
      },
      success_url: `${frontendUrl()}/?checkout=success`,
      cancel_url: `${frontendUrl()}/?checkout=cancel`,
      // "Managed Payments" (Stripe) exige un code de taxe par produit, ce
      // qu'on ne gère pas ici — on le désactive pour cette session, comme
      // suggéré par Stripe lui-même en cas d'erreur "product tax code is
      // missing". À retirer si un jour la taxation est configurée dans le
      // dashboard Stripe (Settings > Tax).
      managed_payments: { enabled: false },
    });

    res.json({ url: session.url });
  } catch (e) {
    next(e);
  }
});

// POST /api/billing/portal
// Crée un lien vers le "Portail client" Stripe (page hébergée par Stripe où
// le joueur peut voir sa facture, changer de carte, ou résilier lui-même).
router.post("/portal", authenticate(true), async (req, res, next) => {
  try {
    if (!stripe) return res.status(503).json({ error: "Paiement non configuré côté serveur." });
    if (!req.user.stripe_customer_id) {
      return res.status(400).json({ error: "Ce compte n'a pas encore d'abonnement Stripe associé." });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.stripe_customer_id,
      return_url: `${frontendUrl()}/`,
    });

    res.json({ url: session.url });
  } catch (e) {
    next(e);
  }
});

// POST /api/billing/webhook
// Appelé directement par Stripe (jamais par l'app). Doit recevoir le corps
// BRUT (non parsé en JSON) pour vérifier la signature — voir server.js, qui
// monte cette route avec express.raw() avant le express.json() global.
router.post("/webhook", async (req, res) => {
  if (!stripe) return res.status(503).end();

  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (e) {
    console.error("[stripe webhook] signature invalide :", e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    switch (event.type) {
      // Paiement initial confirmé : on active l'abonnement.
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const subscriptionId = session.subscription;
        if (userId && subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
          const tier = tierForPriceId(priceId) || "bas";
          await db.updateUser(userId, {
            stripe_subscription_id: subscriptionId,
            subscription: {
              tier,
              status: "active",
              startedAt: new Date().toISOString(),
              renewsAt: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
              provider: "stripe",
              providerTransactionId: subscriptionId,
            },
          });
        }
        break;
      }

      // Renouvellement, changement de palier, ou passage en échec de paiement.
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const user = await db.getUserByStripeCustomerId(sub.customer);
        if (user) {
          const priceId = sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
          const tier = tierForPriceId(priceId) || user.subscription.tier;
          const active = sub.status === "active" || sub.status === "trialing";
          await db.updateUser(user.id, {
            subscription: {
              ...user.subscription,
              tier: active ? tier : "free",
              status: active ? "active" : "inactive",
              renewsAt: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
              provider: "stripe",
              providerTransactionId: sub.id,
            },
          });
        }
        break;
      }

      // Résiliation définitive (via le portail Stripe, ou après plusieurs
      // échecs de paiement) : retour au palier gratuit.
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const user = await db.getUserByStripeCustomerId(sub.customer);
        if (user) {
          await db.updateUser(user.id, {
            subscription: {
              tier: "free",
              status: "inactive",
              startedAt: null,
              renewsAt: null,
              provider: "stripe",
              providerTransactionId: null,
            },
          });
        }
        break;
      }

      default:
        // Autres événements Stripe : ignorés volontairement.
        break;
    }
    res.json({ received: true });
  } catch (e) {
    console.error("[stripe webhook] erreur de traitement :", e.message);
    res.status(500).end();
  }
});

module.exports = router;
