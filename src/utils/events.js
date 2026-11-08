/**
 * Mises à jour en direct (Server-Sent Events).
 *
 * Chaque site ouvert garde une connexion /api/events. Dès qu'une
 * modification réussit sur le serveur (quiz, parcours, arbres, profil,
 * fonds, réductions…), on prévient tout de suite les sites concernés :
 *  - les changements publics vont à tout le monde ;
 *  - les changements d'un compte (ses parcours, son profil) ne vont
 *    qu'aux appareils connectés à CE compte.
 * Le site qui a fait la modification est reconnu (en-tête X-Client-Id)
 * et n'est pas prévenu de son propre changement.
 *
 * Le message ne contient que le TYPE de changement : le site relit
 * ensuite les données par les routes habituelles (mêmes droits, rien
 * de privé ne circule ici).
 */
const { verifyToken } = require("./auth");

const clients = new Set(); // { res, userId, cid }
const MAX_CLIENTS = 2000;

function send(c, data) {
  try { c.res.write("data: " + JSON.stringify(data) + "\n\n"); } catch (e) { /* connexion fermée */ }
}

function publish(type, { userId = null, origin = null } = {}) {
  const data = { type, at: Date.now() };
  if (userId) data.scope = "user";
  for (const c of clients) {
    if (origin && c.cid === origin) continue;
    if (userId && String(c.userId) !== String(userId)) continue;
    send(c, data);
  }
}

function publishUser(userId, type, origin) {
  if (userId) publish(type, { userId, origin });
}

/** GET /api/events — jeton dans "Authorization: Bearer …" (jamais dans l'adresse), X-Client-Id */
function stream(req, res) {
  if (clients.size >= MAX_CLIENTS) return res.status(503).end();
  let userId = null;
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) {
    try { userId = verifyToken(token).sub || null; } catch (e) { userId = null; }
  }
  const cid = String(req.get("x-client-id") || "").slice(0, 64);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders && res.flushHeaders();
  res.write("retry: 3000\n\n");
  const c = { res, userId, cid };
  clients.add(c);
  send(c, { type: "hello", user: !!userId });
  // Battement régulier : garde la connexion ouverte à travers les proxys.
  const beat = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 25000);
  req.on("close", () => { clearInterval(beat); clients.delete(c); });
}

/**
 * Middleware : après toute modification réussie (POST/PUT/PATCH/DELETE),
 * en déduit qui prévenir à partir de l'adresse appelée.
 */
function notifier(req, res, next) {
  if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") return next();
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    const p = (req.originalUrl || "").split("?")[0];
    const origin = req.get("x-client-id") || null;
    const me = req.user && req.user.id;
    const all = (t) => publish(t, { origin });
    if (p.startsWith("/api/quizzes")) { all("quizzes"); return; }
    if (p.startsWith("/api/users/me/playlists")) { publishUser(me, "playlists", origin); all("public-playlists"); return; }
    if (p === "/api/users/me" && req.method === "DELETE") { all("quizzes"); all("public-playlists"); return; }
    if (p.startsWith("/api/users/me") || p.startsWith("/api/billing/sync")) { publishUser(me, "profile", origin); return; }
    if (p.startsWith("/api/admin/")) {
      const m = p.match(/^\/api\/admin\/users\/([^/]+)/);
      if (m) { publishUser(m[1], "profile"); all("quizzes"); all("public-playlists"); return; }
      if (/^\/api\/admin\/(learn-trees|learn-sections)/.test(p)) { all("learn"); return; }
      if (p.startsWith("/api/admin/skins")) { all("skins"); return; }
      if (p.startsWith("/api/admin/discounts")) { all("discounts"); return; }
      // parcours, quiz, corbeille… : tout le contenu public peut avoir changé
      all("quizzes"); all("public-playlists"); all("learn");
    }
  });
  next();
}

module.exports = { publish, publishUser, stream, notifier, _clients: clients };
