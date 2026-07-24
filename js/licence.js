/* ============================================================
   licence.js — 1 liste gratuite puis cle de licence a vie.
   Securite : la cle de licence est une SIGNATURE ECDSA P-256 de
   l'E-MAIL de l'acheteur (normalise). Elle marche sur n'importe
   quel appareil et survit a une reinstallation (le client ressaisit
   son e-mail + sa cle). La cle privee n'est JAMAIS dans l'app
   (seul le vendeur peut signer). L'app ne fait que verifier.
   ============================================================ */

// Cle PUBLIQUE de verification (la privee reste chez le vendeur, dans secrets/radar-licence-vendeur.json).
const PUB = { kty: "EC", crv: "P-256",
  x: "Qz7n-MCqv0_yycdl_bxzvoo4zsn7z2ioGyo-8exfFaE",
  y: "ypDSAMbv2P3_gf1C8YkBygW4i6pb5wMINBElVTooT9I" };

const LKEY = "radar.lic";        // stocke a part : survit a un reset des reglages
export const PRIX = "10 €"; // <-- PRIX AFFICHE AU CLIENT. A ajuster librement.
// L'essai gratuit (1 liste) est compte cote SERVEUR par e-mail (voir trial.js),
// pas ici : reinstaller ne le remet donc pas a zero. licence.js ne gere que la
// licence PAYANTE (verification de la signature).

let state = null;
let verified = false;

const normEmail = (e) => (e || "").trim().toLowerCase();

function load() {
  try { state = JSON.parse(localStorage.getItem(LKEY)); } catch (e) { state = null; }
  if (!state || typeof state !== "object") { state = { email: null, key: null }; save(); }
}
function save() { try { localStorage.setItem(LKEY, JSON.stringify(state)); } catch (e) {} }

function b64urlToBuf(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s); const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

// Verifie une signature ECDSA P-256 (cle PUBLIQUE integree) d'un SUJET quelconque.
// Reutilise par les modules payants (ex. "recherche:<email>") pour rester sur la
// meme paire de cles que la licence de l'appli. Exporte pour js/modules.js.
export async function verifSubject(subject, keyB64) {
  try {
    const pub = await crypto.subtle.importKey("jwk", PUB, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const sig = b64urlToBuf((keyB64 || "").trim());
    const data = new TextEncoder().encode(String(subject || ""));
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, data);
  } catch (e) { return false; }
}

// Licence de l'appli : le sujet signe est simplement l'e-mail normalise.
function verify(keyB64, email) {
  return verifSubject(normEmail(email), keyB64);
}

async function activate(email, keyStr) {
  const ok = await verify(keyStr, email);
  if (ok) { state.email = normEmail(email); state.key = (keyStr || "").trim(); save(); verified = true; }
  return ok;
}

export const Licence = {
  async init() {
    load();
    verified = (state.key && state.email) ? await verify(state.key, state.email) : false;
    return verified;
  },
  isLicensed() { return verified; },
  licensedEmail() { return verified ? state.email : null; },
  activate,
  PRIX,
  openActivate() { this.openSheet(false); },

  // Ecran d'activation. isPaywall=true quand l'essai gratuit est epuise.
  openSheet(isPaywall) {
    const back = document.createElement("div");
    back.className = "rlic-back";
    const close = () => back.remove();

    if (verified) {
      back.innerHTML = `<div class="rlic-sheet">
        <h3>&#10003; Version complete active</h3>
        <div class="rlic-ok">Radar Google est debloque a vie sur cet appareil pour <b>${esc(state.email || "")}</b>. Merci !</div>
        <div class="rlic-row"><button class="rlic-btn primary" data-close>Fermer</button></div>
        <div class="rlic-version" id="rlic-version">Radar Google v1</div>
      </div>`;
      document.body.appendChild(back);
      wire(back, close);
      return;
    }

    const banner = isPaywall
      ? `<div class="rlic-info">Tu as utilise ta <b>liste gratuite</b>. Pour analyser autant de listes que tu veux, debloque Radar Google <b>a vie pour ${esc(PRIX)}</b> (paiement unique, aucun abonnement).</div>`
      : `<p class="rlic-hint">Tu as achete Radar Google ? Saisis ton e-mail d'achat et la cle qu'on t'a envoyee pour debloquer l'appli a vie.</p>`;

    back.innerHTML = `<div class="rlic-sheet">
      <h3>&#128274; ${isPaywall ? "Debloque Radar Google a vie" : "Activer ma licence"}</h3>
      ${banner}
      <p class="rlic-hint">La cle est liee a ton e-mail : elle marche sur tous tes appareils, meme apres une reinstallation.</p>
      <label class="rlic-field"><span class="lab">E-mail d'achat</span>
        <input type="email" id="rlic-email" placeholder="Ton e-mail d'achat" autocomplete="email" autocapitalize="off" spellcheck="false"></label>
      <label class="rlic-field"><span class="lab">Cle de licence</span>
        <input type="text" id="rlic-key" placeholder="Colle ta cle ici" autocomplete="off"></label>
      <div id="rlic-status" class="rlic-status"></div>
      <div class="rlic-row">
        <button class="rlic-btn ghost" data-close>${isPaywall ? "Plus tard" : "Fermer"}</button>
        <button class="rlic-btn primary" id="rlic-activate">Activer ma cle</button>
      </div>
      <div class="rlic-version" id="rlic-version">Radar Google v1</div>
    </div>`;
    document.body.appendChild(back);
    wire(back, close);

    if (state.email) back.querySelector("#rlic-email").value = state.email;
    back.querySelector("#rlic-activate").addEventListener("click", async () => {
      const email = back.querySelector("#rlic-email").value.trim();
      const k = back.querySelector("#rlic-key").value.trim();
      const st = back.querySelector("#rlic-status");
      if (!email) { st.textContent = "Saisis ton e-mail d'achat."; return; }
      if (!k) { st.textContent = "Colle ta cle de licence."; return; }
      st.textContent = "Verification…";
      const ok = await activate(email, k);
      if (ok) { close(); toast("✓ Debloque a vie, merci !"); window.dispatchEvent(new Event("radar-licence-change")); }
      else { st.textContent = "❌ E-mail ou cle incorrects."; }
    });
  },
};

function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

function wire(back, close) {
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  back.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  // mode vendeur : appui long / 5 taps sur la version
  import("./vendeur.js").then((m) => m.Vendeur.bindLongPress(back.querySelector("#rlic-version"))).catch(() => {});
}

// Petit toast autonome.
export function toast(msg) {
  let t = document.getElementById("rlic-toast");
  if (!t) { t = document.createElement("div"); t.id = "rlic-toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), 2200);
}
