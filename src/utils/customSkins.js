// Charge en mémoire les fonds ajoutés depuis le panneau admin (table
// custom_skins) et les rafraîchit toutes les minutes.
const db = require("../db");
const G = require("./game");

let timer = null;
async function reloadCustomSkins() {
  try {
    G.setCustomSkins(await db.listCustomSkins());
  } catch (e) {
    console.warn("[fonds admin] rechargement impossible :", e.message);
  }
  return G.getCustomSkins();
}
function startCustomSkinsRefresh() {
  reloadCustomSkins();
  if (!timer) {
    timer = setInterval(reloadCustomSkins, 60 * 1000);
    if (timer.unref) timer.unref();
  }
}
module.exports = { reloadCustomSkins, startCustomSkinsRefresh };
