/**
 * Crée (ou retrouve) dans Stripe tous les produits/prix de Memerro, plus le
 * webhook vers Render, puis affiche les variables à coller dans Render.
 *
 * Utilisation (depuis le dossier du backend, après `npm install`) :
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-setup.js
 *   (Windows PowerShell : $env:STRIPE_SECRET_KEY="sk_test_xxx"; node scripts/stripe-setup.js)
 *
 * Optionnel : WEBHOOK_URL=https://ton-service.onrender.com/api/billing/webhook
 * Relançable sans risque : rien n'est créé en double (repérage par lookup_key).
 */
const Stripe = require("stripe");

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) { console.error("❌ Donne ta clé : STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.js"); process.exit(1); }
const stripe = new Stripe(KEY);
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://memero-debug3.onrender.com/api/billing/webhook";

// Mêmes prix que ceux affichés dans index.html (montants en centimes).
const ITEMS = [
  { env: "STRIPE_PRICE_PLUS_YEARLY",     lookup: "memerro_premium_bas_year",      name: "Memerro Plus",      desc: "1 vie toutes les 1 h 30, gains ×1,5",    amount: 11199, recurring: { interval: "year" } },
  { env: "STRIPE_PRICE_MAX_YEARLY",  lookup: "memerro_premium_standard_year", name: "Memerro Max", desc: "1 vie toutes les 10 min, gains ×3",      amount: 12399, recurring: { interval: "year" } },
  { env: "STRIPE_PRICE_ULTRA_YEARLY", lookup: "memerro_premium_plus_year",     name: "Memerro Ultra",     desc: "Vies illimitées, gains ×4",              amount: 18099, recurring: { interval: "year" } },
  { env: "STRIPE_PRICE_PLUS_MONTHLY",      lookup: "memerro_premium_bas_month",      name: "Memerro Plus",      desc: "1 vie toutes les 1 h 30, gains ×1,5", amount: 1199, recurring: { interval: "month" } },
  { env: "STRIPE_PRICE_MAX_MONTHLY", lookup: "memerro_premium_standard_month", name: "Memerro Max", desc: "1 vie toutes les 10 min, gains ×3",   amount: 1299, recurring: { interval: "month" } },
  { env: "STRIPE_PRICE_ULTRA_MONTHLY",    lookup: "memerro_premium_plus_month",     name: "Memerro Ultra",     desc: "Vies illimitées, gains ×4",           amount: 1899, recurring: { interval: "month" } },
  { env: "STRIPE_PRICE_GEMS_MOYEN", lookup: "memerro_gems_1200",            name: "1 200 gemmes",             desc: "Pack de gemmes Memerro",                 amount: 599 },
  { env: "STRIPE_PRICE_GEMS_GRAND", lookup: "memerro_gems_3000",            name: "3 000 gemmes",             desc: "Pack de gemmes Memerro (+36 %)",         amount: 1099 },
  { env: "STRIPE_PRICE_GEMS_MEGA",  lookup: "memerro_gems_6500",            name: "6 500 gemmes",             desc: "Pack de gemmes Memerro (+55 %)",         amount: 2099 },
];

async function ensurePrice(it) {
  const found = await stripe.prices.list({ lookup_keys: [it.lookup], active: true, limit: 1 });
  if (found.data[0]) {
    if (found.data[0].unit_amount === it.amount) return { id: found.data[0].id, created: false };
    // Prix changé : on crée un nouveau prix et on lui transfère le lookup_key.
  }
  // Mensuel et annuel d'une même formule partagent le même produit Stripe.
  const productKey = it.env.replace(/_(MONTHLY|YEARLY)$/, "");
  let product = found.data[0] ? { id: found.data[0].product } : null;
  if (!product) {
    const search = await stripe.products.search({ query: `metadata['memerro']:'${productKey}'` }).catch(() => ({ data: [] }));
    product = search.data[0] || await stripe.products.create({ name: it.name, description: it.desc, metadata: { memerro: productKey } });
  }
  const price = await stripe.prices.create({
    product: product.id, currency: "eur", unit_amount: it.amount,
    lookup_key: it.lookup, transfer_lookup_key: true,
    ...(it.recurring ? { recurring: it.recurring } : {}),
  });
  return { id: price.id, created: true };
}

async function ensureWebhook() {
  const events = ["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted"];
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = list.data.find((w) => w.url === WEBHOOK_URL);
  if (existing) {
    await stripe.webhookEndpoints.update(existing.id, { enabled_events: events });
    return { secret: null, existing: true };
  }
  const wh = await stripe.webhookEndpoints.create({ url: WEBHOOK_URL, enabled_events: events, description: "Memerro (Render)" });
  return { secret: wh.secret, existing: false };
}

(async () => {
  const mode = KEY.startsWith("sk_live_") ? "LIVE (vrais paiements)" : "TEST";
  console.log(`\nStripe en mode ${mode}\n`);
  const lines = [];
  for (const it of ITEMS) {
    const r = await ensurePrice(it);
    console.log(`${r.created ? "✅ créé   " : "↺ existant"}  ${it.name.padEnd(26)} ${(it.amount / 100).toFixed(2).replace(".", ",")} €${it.recurring ? (it.recurring.interval === "month" ? "/mois" : "/an") : ""}`);
    lines.push(`${it.env}=${r.id}`);
  }
  const wh = await ensureWebhook();
  console.log(wh.existing ? `↺ webhook déjà présent : ${WEBHOOK_URL}` : `✅ webhook créé : ${WEBHOOK_URL}`);
  lines.push(wh.secret ? `STRIPE_WEBHOOK_SECRET=${wh.secret}` : `# STRIPE_WEBHOOK_SECRET : déjà configuré (Stripe ne le réaffiche pas — voir Dashboard > Webhooks > ton endpoint > « Signing secret »)`);
  console.log("\n===== À coller dans Render (Environment > Add from .env) =====\n");
  console.log(`STRIPE_SECRET_KEY=${KEY}`);
  console.log(lines.join("\n"));
  console.log("\n==============================================================\n");
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
