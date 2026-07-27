/* ============================================================
   modules.js — modules payants en OPTION (achat unique, independant).
   Pour l'instant : "Recherche de prospects" (10 €).

   Meme mecanique de securite que la licence de l'appli (licence.js) :
   la cle est une SIGNATURE ECDSA P-256, mais du sujet "recherche:<email>"
   (au lieu de l'e-mail seul). Meme paire de cles, donc un seul secret
   vendeur. La cle privee n'est JAMAIS dans l'app : l'app ne fait que
   verifier. Debloquer le module ne debloque pas l'appli, et inversement.
   ============================================================ */
import { verifSubject, toast } from "./licence.js";

// Page d'achat du module seul (le client possede deja l'appli, ou l'achetera
// a part). Le tunnel envoie la cle par e-mail automatiquement.
const LIEN_ACHAT_MODULE = "https://generationapp.fr/applications/radar-google/acheter/?produit=module";

const normEmail = (e) => (e || "").trim().toLowerCase();
const esc = (s) => { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };

// Definition d'un module : sa cle de stockage, le prefixe de sujet signe, son prix.
function makeModule({ storeKey, sujetPrefixe, prix, nom, evenement }) {
  let state = { email: null, key: null };
  let verified = false;

  const sujet = (email) => sujetPrefixe + normEmail(email);

  function load() {
    try { state = JSON.parse(localStorage.getItem(storeKey)) || {}; } catch (e) { state = {}; }
    if (!state || typeof state !== "object") state = {};
  }
  function save() { try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch (e) {} }

  async function activate(email, keyStr) {
    const ok = await verifSubject(sujet(email), keyStr);
    if (ok) { state.email = normEmail(email); state.key = (keyStr || "").trim(); save(); verified = true; window.dispatchEvent(new Event(evenement)); }
    return ok;
  }

  return {
    PRIX: prix,
    NOM: nom,
    async init() {
      load();
      verified = (state.key && state.email) ? await verifSubject(sujet(state.email), state.key) : false;
      return verified;
    },
    isUnlocked() { return verified; },
    unlockedEmail() { return verified ? state.email : null; },
    activate,
    openActivate() { this.openSheet(false); },

    // Ecran d'activation / paywall du module. isPaywall=true quand l'essai est epuise.
    openSheet(isPaywall) {
      const back = document.createElement("div");
      back.className = "rlic-back";
      const close = () => back.remove();

      if (verified) {
        back.innerHTML = `<div class="rlic-sheet">
          <h3>&#10003; Module ${esc(nom)} actif</h3>
          <div class="rlic-ok">Le module <b>${esc(nom)}</b> est débloqué à vie pour <b>${esc(state.email || "")}</b>. Merci !</div>
          <div class="rlic-row"><button class="rlic-btn primary" data-close>Fermer</button></div>
          <div class="rlic-version" id="rlic-version">Radar Google v2</div>
        </div>`;
        document.body.appendChild(back);
        wire(back, close);
        return;
      }

      const banner = isPaywall
        ? `<div class="rlic-info">Tu as utilisé ta <b>recherche gratuite</b>. Pour rechercher autant de prospects que tu veux, débloque le module <b>${esc(nom)} à vie pour ${esc(prix)}</b> (paiement unique, aucun abonnement).</div>`
        : `<p class="rlic-hint">Débloque le module <b>${esc(nom)} à vie pour ${esc(prix)}</b> : paiement unique, aucun abonnement. La clé arrive par e-mail juste après le paiement.</p>`;

      back.innerHTML = `<div class="rlic-sheet">
        <h3>&#128269; ${isPaywall ? "Debloque la Recherche a vie" : "Activer le module Recherche"}</h3>
        ${banner}
        <div class="rlic-row"><a class="rlic-btn primary rlic-buy" href="${LIEN_ACHAT_MODULE}" target="_blank" rel="noopener">Acheter le module — ${esc(prix)}</a></div>
        <p class="rlic-sep">Déjà acheté ? Saisis ton e-mail et ta clé ci-dessous.</p>
        <p class="rlic-hint">La clé est liée à ton e-mail : elle marche sur tous tes appareils, même après une réinstallation. (Le module est indépendant de l'appli : c'est un achat séparé.)</p>
        <label class="rlic-field"><span class="lab">E-mail d'achat</span>
          <input type="email" id="mod-email" placeholder="Ton e-mail d'achat" autocomplete="email" autocapitalize="off" spellcheck="false"></label>
        <label class="rlic-field"><span class="lab">Clé du module</span>
          <input type="text" id="mod-key" placeholder="Colle ta clé ici" autocomplete="off"></label>
        <div id="mod-status" class="rlic-status"></div>
        <div class="rlic-row">
          <button class="rlic-btn ghost" data-close>${isPaywall ? "Plus tard" : "Fermer"}</button>
          <button class="rlic-btn primary" id="mod-activate">Activer ma clé</button>
        </div>
        <div class="rlic-version" id="rlic-version">Radar Google v2</div>
      </div>`;
      document.body.appendChild(back);
      wire(back, close);

      if (state.email) back.querySelector("#mod-email").value = state.email;
      back.querySelector("#mod-activate").addEventListener("click", async () => {
        const email = back.querySelector("#mod-email").value.trim();
        const k = back.querySelector("#mod-key").value.trim();
        const st = back.querySelector("#mod-status");
        if (!email) { st.textContent = "Saisis ton e-mail d'achat."; return; }
        if (!k) { st.textContent = "Colle ta clé du module."; return; }
        st.textContent = "Verification…";
        const ok = await activate(email, k);
        if (ok) { close(); toast("✓ Module Recherche débloqué, merci !"); }
        else { st.textContent = "❌ E-mail ou clé incorrects."; }
      });
    },
  };
}

function wire(back, close) {
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  back.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  // mode vendeur accessible aussi depuis la version de cet ecran
  import("./vendeur.js").then((m) => m.Vendeur.bindLongPress(back.querySelector("#rlic-version"))).catch(() => {});
}

export const Recherche = makeModule({
  storeKey: "radar.mod.recherche",
  sujetPrefixe: "recherche:",
  prix: "10 €",
  nom: "Recherche de prospects",
  evenement: "radar-module-change",
});
