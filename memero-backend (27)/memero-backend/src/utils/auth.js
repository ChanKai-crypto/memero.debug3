const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Pas de valeur de secours ici : une clé secrète manquante DOIT bloquer le
// démarrage du serveur, jamais se rabattre silencieusement sur une valeur
// connue de tous (visible dans ce code source, donc dans n'importe quel
// dépôt public ou privé) — sans quoi n'importe qui pourrait fabriquer un
// faux jeton de connexion valide pour n'importe quel compte, y compris
// admin, simplement en connaissant cette valeur par défaut.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET manquante : définis cette variable d'environnement (une longue chaîne aléatoire) avant de démarrer le serveur. Ne jamais utiliser de valeur par défaut ici : n'importe qui la connaissant pourrait se faire passer pour n'importe quel compte."
  );
}
const TOKEN_EXPIRES_IN = "30d";

// bcrypt : 12 tours de salage (contre 10 avant) — un bon compromis actuel
// entre robustesse et temps de calcul (chaque tour double le temps de
// calcul nécessaire pour un mot de passe donné, y compris pour un
// attaquant qui aurait mis la main sur la base de données).
const BCRYPT_ROUNDS = 12;

function hashPassword(plain) {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRES_IN }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
