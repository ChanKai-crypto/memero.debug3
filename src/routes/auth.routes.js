const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authenticate");
const { hashPassword, verifyPassword, signToken } = require("../utils/auth");
const { toPublicUser } = require("../utils/mappers");
const { sendVerificationEmail, generateCode } = require("../utils/email");

const router = express.Router();

const VERIFICATION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // doit rester cohérent avec le cooldown du bouton côté front (30s)

function defaultSubscription() {
  return {
    tier: "free",
    status: "inactive",
    startedAt: null,
    renewsAt: null,
    provider: null,
    providerTransactionId: null,
  };
}

function defaultGame() {
  return {
    gems: 0,
    lives: { count: 6, lastLossAt: null },
    streak: { count: 0, lastPlayAt: null },
    lifetimeScore: 0,
    inventory: { multiplier: 0, joker: 0 },
    chestsUnlocked: [],
    chestsPending: [],
  };
}

// POST /api/auth/signup
router.post("/signup", async (req, res, next) => {
  try {
    const { username, password, email } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Pseudo et mot de passe requis." });
    }
    if (String(username).trim().length < 3) {
      return res.status(400).json({ error: "Le pseudo doit faire au moins 3 caractères." });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Le mot de passe doit faire au moins 6 caractères." });
    }

const existing = await db.getUserByUsername(username);
    if (existing) return res.status(409).json({ error: "Ce pseudo existe déjà." });

    const hasEmail = !!(email && String(email).trim());
    if (hasEmail) {
      const existingEmail = await db.getUserByEmail(String(email).trim());
      if (existingEmail) {
        return res.status(409).json({ error: "Cette adresse email est déjà utilisée par un autre compte." });
      }
    }

    const userPayload = {
      username,
      email: hasEmail ? String(email).trim() : null,
      password_hash: hashPassword(password),
      role: "user",
      subscription: defaultSubscription(),
      game: defaultGame(),
      stats: { quizzesPlayed: 0 },
      email_verified: false,
    };

    // Si une adresse email est fournie, on génère tout de suite un code de
    // vérification et on l'envoie — le front ouvre l'écran "Vérifie ton
    // email" juste après l'inscription (voir emailVerified:false ci-dessous).
    // Le code n'est jamais renvoyé au front : il doit arriver uniquement
    // par email (voir sendVerificationEmail, qui journalise en interne
    // côté serveur si l'envoi échoue, sans jamais exposer le code au client).
    if (hasEmail) {
      const code = generateCode();
      userPayload.email_verification_code = code;
      userPayload.email_verification_expires_at = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();
      userPayload.email_verification_last_sent_at = new Date().toISOString();
      await sendVerificationEmail(userPayload.email, code);
    }

    const row = await db.createUser(userPayload);

    const token = signToken(row);
    res.status(201).json({ token, user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/login
router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Pseudo et mot de passe requis." });
    }

    const row = await db.getUserByUsername(username);
    if (!row || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: "Pseudo ou mot de passe incorrect." });
    }
    if (row.banned) {
      return res.status(403).json({ error: "Ce compte a été suspendu." });
    }

    const token = signToken(row);
    res.json({ token, user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

// GET /api/auth/me
router.get("/me", authenticate(true), (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

// POST /api/auth/resend-verification
// Régénère un code et le renvoie à l'adresse email déjà enregistrée sur le
// compte connecté. Un cooldown serveur (indépendant de celui du bouton côté
// front) évite qu'un appel direct à l'API ne spamme la boîte mail.
router.post("/resend-verification", authenticate(true), async (req, res, next) => {
  try {
    if (!req.user.email) {
      return res.status(400).json({ error: "Aucune adresse email associée à ce compte." });
    }
    if (req.user.email_verified) {
      return res.json({ ok: true, alreadyVerified: true });
    }

    const lastSent = req.user.email_verification_last_sent_at
      ? new Date(req.user.email_verification_last_sent_at).getTime()
      : 0;
    if (Date.now() - lastSent < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: "Merci de patienter avant de redemander un code." });
    }

    const code = generateCode();
    await db.updateUser(req.user.id, {
      email_verification_code: code,
      email_verification_expires_at: new Date(Date.now() + VERIFICATION_TTL_MS).toISOString(),
      email_verification_last_sent_at: new Date().toISOString(),
    });

    const result = await sendVerificationEmail(req.user.email, code);
    res.json({ ok: true, sent: result.sent });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/verify-email   { code }
router.post("/verify-email", authenticate(true), async (req, res, next) => {
  try {
    if (req.user.email_verified) {
      return res.json({ ok: true, user: toPublicUser(req.user) });
    }

    const { code } = req.body || {};
    if (!code || !String(code).trim()) {
      return res.status(400).json({ error: "Code de vérification requis." });
    }
    if (!req.user.email_verification_code) {
      return res.status(400).json({ error: "Aucun code en attente. Demande un renvoi." });
    }
    const expiresAt = req.user.email_verification_expires_at
      ? new Date(req.user.email_verification_expires_at).getTime()
      : 0;
    if (Date.now() > expiresAt) {
      return res.status(400).json({ error: "Code expiré. Demande un renvoi." });
    }
    if (String(code).trim() !== String(req.user.email_verification_code)) {
      return res.status(400).json({ error: "Code invalide." });
    }

    const row = await db.updateUser(req.user.id, {
      email_verified: true,
      email_verification_code: null,
      email_verification_expires_at: null,
    });
    res.json({ ok: true, user: toPublicUser(row) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
