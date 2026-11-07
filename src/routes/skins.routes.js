// Fonds ajoutés par l'admin : catalogue public + images.
const express = require("express");
const db = require("../db");
const G = require("../utils/game");

const router = express.Router();

function publicSkin(c, now) {
  const eff = G.customEffective(c, now);
  return {
    id: c.id,
    name: c.name,
    rarity: eff.r,
    baseRarity: c.r,
    price: eff.price,
    basePrice: c.price,
    changed: eff.changed,
    phase: eff.phase,
    reactAt: c.reactAt,
    afterPrice: c.afterPrice,
    afterRarity: c.afterRarity,
    maxOwners: c.maxOwners,
    ownersCount: c.ownersCount,
    left: c.maxOwners ? Math.max(0, c.maxOwners - (c.ownersCount || 0)) : null,
    avail: c.avail,
    afterEnd: c.afterEnd,
    inShop: c.inShop,
    inChests: c.inChests,
    inWindow: G.customInWindow(c, now),
    usable: true,
    obtainable: eff.obtainable,
    image: `/api/skins/${encodeURIComponent(c.id)}/image?v=${c.version || 0}`,
  };
}

// GET /api/skins : tous les fonds admin actifs (sans les images)
router.get("/", (req, res) => {
  const now = new Date();
  res.set("Cache-Control", "no-cache");
  res.json({ skins: G.getCustomSkins().filter((c) => c.active).map((c) => publicSkin(c, now)) });
});

// GET /api/skins/:id/image : l'image du fond (jpg/png)
router.get("/:id/image", async (req, res, next) => {
  try {
    const id = String(req.params.id || "");
    if (!/^c_[a-z_]{1,28}$/.test(id)) return res.status(400).end();
    const row = await db.getCustomSkinImage(id);
    const m = row && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(row.image || "");
    if (!m) return res.status(404).end();
    res.set("Content-Type", m[1]);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(Buffer.from(m[2], "base64"));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
module.exports.publicSkin = publicSkin;
