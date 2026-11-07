// Réductions en cours (affichées sur le site).
const express = require("express");
const D = require("../utils/discounts");

const router = express.Router();

// GET /api/discounts : réductions actives maintenant
router.get("/", (req, res) => {
  const now = new Date();
  res.set("Cache-Control", "no-cache");
  res.json({ discounts: D.getDiscounts().map((d) => D.publicDiscount(d, now)).filter((d) => d.on) });
});

module.exports = router;
