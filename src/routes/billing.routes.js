const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authenticate");
const requireAdmin = require("../middleware/requireAdmin");
const { stripe, priceIdForTier, tierForPriceId, priceIdForGemPack, gemsForPack, packIdForPriceId } = require("../utils/stripe");

const D = require("../utils/discounts");

const router = express.Router();

function frontendUrl() {
  return (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
}

/**
 * Relit l'abonnement directement chez Stripe et corrige le compte si besoin.
 * Filet de sécurité si un webhook a été perdu (serveur endormi, erreur...) :
 * le site l'appelle au retour du paiement et une fois par session.
 * Ne touche jamais à un abonnement offert par un admin (provider ≠ stripe).
 */
async function syncSubscriptionFromStripe(user) {
  if (!user || !user.stripe_customer_id) return { user, changed: false };
  const subs = await stripe.subscriptions.list({ customer: user.stripe_customer_id, status: "all", limit: 20 });
  const rank = { plus: 3, standard: 2, bas: 1 };
  let best = null;
  (subs.data || []).forEach((sub) => {
    if (sub.status !== "active" && sub.status !== "trialing" && sub.status !== "past_due") return;
    const priceId = sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
    const tier = tierForPriceId(priceId);
    if (!tier) return;
    if (!best || (rank[tier] || 0) > (rank[best.tier] || 0)) best = { sub, tier };
  });
  const cur = user.subscription || {};
  let next = null;
  if (best) {
    const renewsAt = best.sub.current_period_end ? new Date(best.sub.current_period_end * 1000).toISOString() : null;
    if (cur.tier !== best.tier || cur.status !== "active" || cur.providerTransactionId !== best.sub.id) {
      next = {
        ...cur,
        tier: best.tier,
        status: "active",
        startedAt: cur.startedAt || new Date().toISOString(),
        renewsAt,
        provider: "stripe",
        providerTransactionId: best.sub.id,
      };
    }
  } else if (cur.provider === "stripe" && cur.status === "active") {
    next = { tier: "free", status: "inactive", startedAt: null, renewsAt: null, provider: "stripe", providerTransactionId: null };
  }
  if (!next) return { user, changed: false };
  const row = await db.updateUser(user.id, { subscription: next, ...(best ? { stripe_subscription_id: best.sub.id } : {}) });
  return { user: row, changed: true };
}

// POST /api/billing/sync : resynchronise l'abonnement avec Stripe.
router.post("/sync", authenticate(true), async (req, res, next) => {
  try {
    const { toPublicUser } = require("../utils/mappers");
    const r = await syncSubscriptionFromStripe(req.user);
    res.json({ changed: r.changed, user: toPublicUser(r.user) });
  } catch (e) {
    next(e);
  }
});

// POST /api/billing/checkout   { tier: "bas" | "standard" | "plus", interval: "month" | "year" (défaut) }
// Crée une session de paiement Stripe et renvoie son URL : le client doit
// rediriger le navigateur vers cette URL (window.location.href = url).
// Rien n'est activé ici — c'est le webhook plus bas qui confirme le paiement.
//
// Ouvert à tous les comptes connectés (authenticate(true) : il faut un compte).
router.post("/checkout", authenticate(true), async (req, res, next) => {
  try {
    if (!stripe) return res.status(503).json({ error: "Paiement non configuré côté serveur (STRIPE_SECRET_KEY manquante)." });

    const { tier } = req.body || {};
    const interval = (req.body && req.body.interval) === "month" ? "month" : "year";
    const priceId = priceIdForTier(tier, interval);
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

    // Réduction en cours sur cette offre : appliquée automatiquement.
    const disc = await D.checkoutParams("plan", tier);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: req.user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      ...disc.params,
      metadata: { memero_user_id: req.user.id, memero_tier: tier, ...(disc.discountId ? { memerro_discount_id: String(disc.discountId) } : {}) },
      subscription_data: {
        metadata: { memero_user_id: req.user.id, memero_tier: tier, memero_interval: interval },
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

// POST /api/billing/checkout-gems   { packId: "petit" | "moyen" | "grand" | "mega" }
// Comme /checkout, mais en paiement unique (mode "payment", pas "subscription") :
// achat ponctuel d'un pack de gemmes, pas un abonnement récurrent.
// Ouvert à tous les comptes connectés.
router.post("/checkout-gems", authenticate(true), async (req, res, next) => {
  try {
    if (!stripe) return res.status(503).json({ error: "Paiement non configuré côté serveur (STRIPE_SECRET_KEY manquante)." });

    const { packId } = req.body || {};
    const priceId = priceIdForGemPack(packId);
    if (!priceId) {
      return res.status(400).json({ error: "Pack de gemmes invalide ou non configuré (STRIPE_PRICE_GEMS_...)." });
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

    const disc = await D.checkoutParams("gems", packId);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      client_reference_id: req.user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      ...disc.params,
      // Un paiement unique n'a pas d'objet "subscription" pour porter des
      // métadonnées côté Stripe : on les met directement sur la session,
      // relues dans le webhook ci-dessous pour savoir quel pack créditer.
      metadata: { memero_user_id: req.user.id, memero_gem_pack: packId, ...(disc.discountId ? { memerro_discount_id: String(disc.discountId) } : {}) },
      success_url: `${frontendUrl()}/?checkout=success`,
      cancel_url: `${frontendUrl()}/?checkout=cancel`,
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
      // Paiement initial confirmé : on active l'abonnement, OU on crédite un
      // pack de gemmes si c'est un paiement unique (mode "payment").
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.client_reference_id;
        // Réduction utilisée : on la compte (limite "nombre max de personnes").
        const usedDiscount = session.metadata && session.metadata.memerro_discount_id;
        const discounted = session.total_details && session.total_details.amount_discount > 0;
        if (usedDiscount && discounted) {
          try { await D.noteUse(usedDiscount); } catch (e) { console.warn("[réductions] comptage impossible :", e.message); }
        }

        if ("payment" === session.mode) {
          // Achat ponctuel de gemmes (pas d'abonnement) : on lit le pack
          // depuis les métadonnées de la session (posées à la création,
          // voir /checkout-gems ci-dessus) et on crédite le compte.
          const packId = session.metadata && session.metadata.memero_gem_pack;
          const gemsToAdd = gemsForPack(packId);
          if (userId && gemsToAdd > 0) {
            const user = await db.getUserById(userId);
            // Stripe peut renvoyer le même événement plusieurs fois : on note
            // les sessions déjà créditées pour ne jamais créditer deux fois.
            const paid = (user && user.game && Array.isArray(user.game.paidSessions)) ? user.game.paidSessions : [];
            if (user && paid.indexOf(session.id) === -1) {
              const currentGems = (user.game && Number.isFinite(user.game.gems)) ? user.game.gems : 0;
              await db.updateUser(userId, {
                // rev + 1 : le site saura que ses gemmes locales sont périmées
                // et ne pourra plus écraser les gemmes tout juste achetées.
                game: {
                  ...user.game,
                  gems: currentGems + gemsToAdd,
                  paidSessions: paid.concat([session.id]).slice(-50),
                  rev: (Number.isFinite(user.game && user.game.rev) ? user.game.rev : 0) + 1,
                },
              });
            }
          }
          break;
        }

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
