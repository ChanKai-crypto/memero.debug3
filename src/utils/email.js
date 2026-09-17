/**
 * Envoi d'email minimal, pour le code de vérification à l'inscription.
 *
 * Utilise Resend (https://resend.com) si RESEND_API_KEY est définie — un
 * service gratuit jusqu'à 3000 emails/mois, une seule clé API, pas de carte
 * bancaire requise pour démarrer. Aucune dépendance npm supplémentaire :
 * on appelle directement leur API REST avec fetch (disponible nativement
 * depuis Node 18, la version minimale déjà requise par ce projet).
 *
 * Si RESEND_API_KEY n'est pas définie, on n'échoue pas : le code est
 * simplement affiché dans les logs du serveur (pratique en développement,
 * ou le temps de configurer un vrai envoi). C'est pour ça que les routes
 * /api/auth/resend-verification et /api/auth/verify-email fonctionnent
 * même sans email configuré, avec le code visible dans les logs Render.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "Memerro <onboarding@resend.dev>";

/**
 * Envoie un email. Renvoie { sent: boolean, devCode?: string } — devCode
 * n'est renvoyé (utile pour du debug côté serveur) que si l'envoi réel n'a
 * pas pu avoir lieu faute de configuration.
 */
async function sendVerificationEmail(to, code) {
  const subject = "Ton code de vérification Memerro";
  const text = `Ton code de vérification est : ${code}\n\nIl expire dans 15 minutes. Si tu n'es pas à l'origine de cette demande, ignore cet email.`;
  const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;">Vérifie ton email</h2>
      <p style="color:#555;line-height:1.5;">Voici ton code de vérification Memerro :</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:6px;background:#f4f4f4;padding:16px;text-align:center;border-radius:12px;margin:16px 0;">${code}</div>
      <p style="color:#888;font-size:13px;">Ce code expire dans 15 minutes. Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.</p>
    </div>`;

  if (!RESEND_API_KEY) {
    console.warn(
      `⚠️  RESEND_API_KEY non définie : email non envoyé. Code de vérification pour ${to} : ${code} (valable 15 min).`
    );
    return { sent: false, devCode: code };
  }

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
      return { sent: false, devCode: code };
    }
    return { sent: true };
  } catch (e) {
    console.error("[email] Erreur d'envoi :", e.message);
    return { sent: false, devCode: code };
  }
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // code à 6 chiffres
}

module.exports = { sendVerificationEmail, generateCode };
