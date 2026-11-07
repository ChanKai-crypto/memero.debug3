/**
 * Réductions créées depuis le panneau admin (table discounts).
 *
 * Une réduction a les mêmes "spécificités" qu'un fond :
 *   percent (1-90 %), cibles (abonnements, packs de gemmes, fonds par rareté),
 *   maxUses (nombre max de personnes), période (toute l'année / chaque année
 *   JJ/MM → JJ/MM / entre deux dates), après la période (indisponible /
 *   réactivée à une date / "change" vers un autre %), texte affiché en plus,
 *   code promo affiché seulement si l'admin le décide.
 *
 * Abonnements et packs de gemmes : un coupon Stripe est créé automatiquement
 * (une fois par pourcentage) et appliqué tout seul au paiement — le joueur
 * voit juste le prix réduit. Fonds : réduction en gemmes, gérée ici.
 */
const db = require("../db");
const G = require("./game");
const { stripe } = require("./stripe");

let LIST = [];
let timer = null;

function setDiscounts(list) {
  LIST = Array.isArray(list) ? list : [];
}
function getDiscounts() {
  return LIST;
}
async function reloadDiscounts() {
  try {
    setDiscounts(await db.listDiscounts());
  } catch (e) {
    console.warn("[réductions] rechargement impossible :", e.message);
  }
  return LIST;
}
function startDiscountsRefresh() {
  reloadDiscounts();
  if (!timer) {
    timer = setInterval(reloadDiscounts, 60 * 1000);
    if (timer.unref) timer.unref();
  }
}

/** État de la réduction maintenant : active ? quel pourcentage ? */
function effective(d, date) {
  const st = G.periodState(d, date);
  const percent = st.changed && Number.isFinite(d.afterPercent) && d.afterPercent > 0 ? d.afterPercent : d.percent;
  const full = Number.isFinite(d.maxUses) && d.maxUses > 0 && (d.usesCount || 0) >= d.maxUses;
  return { ...st, percent, on: !!d.active && st.on && !full && percent > 0, full };
}

/** kind : "plan" (id = bas|standard|plus) | "gems" (id = pack) | "skin" (id = rareté) */
function targets(d, kind, id) {
  const t = d.targets || {};
  const list = kind === "plan" ? t.plans : kind === "gems" ? t.gems : kind === "skin" ? t.skins : null;
  return Array.isArray(list) && (list.includes(id) || list.includes("*"));
}

/** Meilleure réduction active pour cet article (ou null). */
function bestFor(kind, id, date) {
  let best = null;
  LIST.forEach((d) => {
    if (!targets(d, kind, id)) return;
    const e = effective(d, date);
    if (!e.on) return;
    if (!best || e.percent > best.percent) best = { discount: d, percent: e.percent };
  });
  return best;
}

function applyGems(price, percent) {
  if (!percent) return price;
  return Math.max(0, Math.round((price * (100 - percent)) / 100 / 10) * 10);
}

/** Coupon Stripe correspondant (créé une seule fois par % / durée). */
async function ensureCoupon(d, percent) {
  if (!stripe) return null;
  const duration = ["once", "repeating", "forever"].includes(d.duration) ? d.duration : "once";
  const months = duration === "repeating" ? Math.max(1, d.durationMonths || 1) : null;
  const key = `${percent}|${duration}|${months || ""}`;
  const map = { ...(d.stripeCoupons || {}) };
  if (map[key]) return map[key];
  const coupon = await stripe.coupons.create({
    percent_off: percent,
    duration,
    ...(months ? { duration_in_months: months } : {}),
    name: String(d.name || "Réduction Memerro").slice(0, 40),
    metadata: { memerro_discount_id: String(d.id) },
  });
  map[key] = coupon.id;
  d.stripeCoupons = map;
  await db.updateDiscount(d.id, { stripe_coupons: map });
  return coupon.id;
}

/** Code promo Stripe affiché (seulement si l'admin a choisi d'en montrer un). */
async function ensurePromotionCode(d, couponId) {
  if (!stripe || !d.showCode || !d.code) return null;
  const map = { ...(d.stripeCoupons || {}) };
  const key = "promo|" + couponId;
  if (map[key]) return map[key];
  let promo;
  try {
    promo = await stripe.promotionCodes.create({ coupon: couponId, code: d.code });
  } catch (e) {
    // API Stripe récente : nouveau format
    promo = await stripe.promotionCodes.create({ promotion: { type: "coupon", coupon: couponId }, code: d.code });
  }
  map[key] = promo.id;
  d.stripeCoupons = map;
  await db.updateDiscount(d.id, { stripe_coupons: map });
  return promo.id;
}

/**
 * Paramètres à ajouter à une session Stripe Checkout :
 *  - mode automatique : discounts: [{ coupon }]  (prix réduit direct)
 *  - mode code affiché : allow_promotion_codes   (le joueur tape le code)
 */
async function checkoutParams(kind, id) {
  const best = bestFor(kind, id);
  if (!best || !stripe) return { params: {}, discountId: null };
  try {
    const couponId = await ensureCoupon(best.discount, best.percent);
    if (best.discount.showCode && best.discount.code) {
      await ensurePromotionCode(best.discount, couponId);
      return { params: { allow_promotion_codes: true }, discountId: best.discount.id, percent: best.percent };
    }
    return { params: { discounts: [{ coupon: couponId }] }, discountId: best.discount.id, percent: best.percent };
  } catch (e) {
    console.warn("[réductions] coupon Stripe impossible :", e.message);
    return { params: {}, discountId: null };
  }
}

async function noteUse(discountId) {
  if (!discountId) return;
  await db.incrementDiscountUses(discountId);
  const d = LIST.find((x) => String(x.id) === String(discountId));
  if (d) d.usesCount = (d.usesCount || 0) + 1;
}

/** Version publique (pour l'affichage sur le site). */
function publicDiscount(d, date) {
  const e = effective(d, date);
  return {
    id: d.id,
    name: d.name,
    percent: e.percent,
    basePercent: d.percent,
    changed: e.changed,
    phase: e.phase,
    on: e.on,
    full: e.full,
    targets: d.targets || {},
    avail: d.avail,
    afterEnd: d.afterEnd,
    reactAt: d.reactAt,
    afterPercent: d.afterPercent,
    endsAt: d.avail && d.avail.type === "dates" && !e.changed ? d.avail.endsAt : null,
    left: d.maxUses ? Math.max(0, d.maxUses - (d.usesCount || 0)) : null,
    text: d.text || "",
    code: d.showCode && d.code ? d.code : null,
    duration: d.duration,
    durationMonths: d.durationMonths,
  };
}

module.exports = {
  setDiscounts,
  getDiscounts,
  reloadDiscounts,
  startDiscountsRefresh,
  effective,
  bestFor,
  applyGems,
  checkoutParams,
  noteUse,
  publicDiscount,
};
