/**
 * Envoi d'email pour le code de vérification à l'inscription.
 *
 * Deux façons de l'envoyer, utilisées dans cet ordre de priorité :
 *
 * 1. Gmail (via nodemailer + mot de passe d'application) — si GMAIL_USER
 *    et GMAIL_APP_PASSWORD sont définies. C'est la méthode recommandée ici :
 *    - GMAIL_USER=memerro65@gmail.com (ou l'adresse Gmail que tu utilises)
 *    - GMAIL_APP_PASSWORD= un "mot de passe d'application" généré depuis
 *      https://myaccount.google.com/apppasswords (nécessite la validation
 *      en 2 étapes activée sur ce compte Gmail — Google ne permet plus
 *      d'utiliser le mot de passe normal du compte pour ça).
 *
 * 2. Resend (https://resend.com) — si RESEND_API_KEY est définie à la
 *    place. Utile si tu préfères un service dédié à l'envoi transactionnel
 *    plutôt qu'un compte Gmail personnel.
 *
 * Si NI L'UN NI L'AUTRE n'est configuré, l'email n'est pas envoyé — le
 * code est alors seulement visible dans les logs du serveur (Render →
 * Logs), à titre de secours pour le développement. Le code n'est PLUS
 * jamais renvoyé au front (voir routes/auth.routes.js) : la personne doit
 * recevoir son code uniquement par email, nulle part ailleurs dans l'app.
 */

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || (GMAIL_USER ? `Memerro <${GMAIL_USER}>` : "Memerro <onboarding@resend.dev>");

let gmailTransporter = null;
function getGmailTransporter() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  if (!gmailTransporter) {
    // require() fait ici (pas en haut du fichier) : si nodemailer n'est
    // pas installé et que Gmail n'est pas configuré, le reste du serveur
    // continue de fonctionner normalement (repli sur Resend, ou sur les
    // logs) au lieu de planter au démarrage.
    const nodemailer = require("nodemailer");
    gmailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
  }
  return gmailTransporter;
}

function buildMessage(to, code) {
  const subject = "Ton code de vérification Memerro";
  const text = `Ton code de vérification est : ${code}\n\nIl expire dans 15 minutes. Si tu n'es pas à l'origine de cette demande, ignore cet email.`;
  const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;">Vérifie ton email</h2>
      <p style="color:#555;line-height:1.5;">Voici ton code de vérification Memerro :</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:6px;background:#f4f4f4;padding:16px;text-align:center;border-radius:12px;margin:16px 0;">${code}</div>
      <p style="color:#888;font-size:13px;">Ce code expire dans 15 minutes. Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.</p>
    </div>`;
  return { subject, text, html };
}

/**
 * Envoie un email de vérification. Renvoie { sent: boolean }. Le code
 * n'est plus jamais renvoyé dans la réponse HTTP (voir les routes) : en
 * cas d'échec, il reste uniquement visible dans les logs serveur.
 */
async function sendVerificationEmail(to, code) {
  const { subject, text, html } = buildMessage(to, code);

  const transporter = getGmailTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({ from: EMAIL_FROM, to, subject, text, html });
      return { sent: true };
    } catch (e) {
      console.error("[email] Échec d'envoi via Gmail :", e.message);
      console.warn(`⚠️  Code de vérification pour ${to} (envoi Gmail échoué) : ${code} (valable 15 min).`);
      return { sent: false };
    }
  }

  if (RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text, html }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[email] Échec d'envoi Resend (${res.status}) :`, body);
        console.warn(`⚠️  Code de vérification pour ${to} (envoi Resend échoué) : ${code} (valable 15 min).`);
        return { sent: false };
      }
      return { sent: true };
    } catch (e) {
      console.error("[email] Erreur d'envoi Resend :", e.message);
      console.warn(`⚠️  Code de vérification pour ${to} (envoi Resend échoué) : ${code} (valable 15 min).`);
      return { sent: false };
    }
  }

  console.warn(
    `⚠️  Aucun envoi d'email configuré (ni GMAIL_USER, ni RESEND_API_KEY) : email non envoyé. Code de vérification pour ${to} : ${code} (valable 15 min).`
  );
  return { sent: false };
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // code à 6 chiffres
}

module.exports = { sendVerificationEmail, generateCode };
