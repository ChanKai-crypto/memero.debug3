const rateLimit = require("express-rate-limit");

/**
 * Limite de débit sur les routes sensibles à la force brute (connexion,
 * inscription, mot de passe oublié) : au-delà de 10 tentatives en 15
 * minutes depuis la même IP, bloque avec une erreur claire plutôt que de
 * laisser un script essayer des milliers de mots de passe par seconde.
 *
 * Volontairement plus strict que la limite générale ci-dessous : ces
 * routes n'ont normalement besoin que de quelques tentatives par personne
 * réelle en 15 minutes.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives. Réessaie dans quelques minutes." },
});

/**
 * Limite générale, plus permissive, appliquée à toute l'API : protège
 * contre un script qui bombarderait le serveur de requêtes (scraping
 * agressif, bug côté client qui boucle...), sans gêner un usage normal.
 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes. Réessaie dans un instant." },
});

module.exports = { authLimiter, generalLimiter };
