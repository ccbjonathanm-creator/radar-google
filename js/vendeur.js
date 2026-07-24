/* ============================================================
   vendeur.js — generateur de cles de licence INTEGRE (mode vendeur)
   Cache derriere un appui long (ou 5 taps) sur le numero de version.
   La cle privee n'est JAMAIS dans le code : le vendeur la colle une
   fois, elle est chiffree (AES-GCM + passphrase, PBKDF2) et gardee
   sur son seul appareil.

   signerEmail() est aussi exporte pour une future generation
   automatique des cles a l'achat (site / Worker).
   ============================================================ */
import { toast } from "./licence.js";

const VKEY = "radar.vendeur";   // blob chiffre {salt, iv, ct}
let privInMemory = null;        // cle privee dechiffree, memoire de session seulement

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
const b64url = (buf) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const esc = (s) => { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };

function hasKey() { try { return !!localStorage.getItem(VKEY); } catch (e) { return false; } }

async function deriveKey(pass, salt) {
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function storePriv(jwkStr, pass) {
  JSON.parse(jwkStr); // valide le JSON
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(jwkStr));
  localStorage.setItem(VKEY, JSON.stringify({ salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
}

async function unlockPriv(pass) {
  const blob = JSON.parse(localStorage.getItem(VKEY));
  const key = await deriveKey(pass, unb64(blob.salt));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return new TextDecoder().decode(pt); // throw si mauvaise passphrase
}

// signe l'e-mail normalise (doit correspondre EXACTEMENT a licence.js : trim + minuscules)
export async function signerEmail(jwkStr, email) {
  const jwk = JSON.parse(jwkStr);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const em = (email || "").trim().toLowerCase();
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(em));
  return b64url(new Uint8Array(sig));
}

function open() {
  const back = document.createElement("div"); back.className = "rlic-back";
  back.innerHTML = `<div class="rlic-sheet"><div id="v-body"></div></div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  const body = back.querySelector("#v-body");
  if (privInMemory) return viewGenerate(body, close);
  if (hasKey()) return viewUnlock(body, close);
  return viewSetup(body, close);
}

function viewSetup(body, close) {
  body.innerHTML = `
    <h3>&#128273; Mode vendeur — installation</h3>
    <p class="rlic-hint">Colle ta cle privee de signature (JWK, depuis secrets/radar-licence-vendeur.json). Elle sera chiffree et gardee sur ce seul appareil, jamais en clair, jamais dans le code.</p>
    <label class="rlic-field"><span class="lab">Cle privee (JWK)</span>
      <textarea id="v-priv" rows="4" placeholder='{"kty":"EC","d":"...","x":"...","y":"...","crv":"P-256"}'></textarea></label>
    <label class="rlic-field"><span class="lab">Choisis une passphrase</span>
      <input type="password" id="v-pass" placeholder="mot de passe vendeur"></label>
    <div id="v-status" class="rlic-status"></div>
    <div class="rlic-row"><button class="rlic-btn ghost" data-close>Annuler</button><button class="rlic-btn primary" id="v-save">Enregistrer (chiffre)</button></div>`;
  body.querySelector("[data-close]").addEventListener("click", close);
  body.querySelector("#v-save").addEventListener("click", async () => {
    const priv = body.querySelector("#v-priv").value.trim();
    const pass = body.querySelector("#v-pass").value;
    const st = body.querySelector("#v-status");
    if (!priv || !pass) { st.textContent = "Cle privee et passphrase requises."; return; }
    try { await storePriv(priv, pass); privInMemory = priv; toast("Cle vendeur enregistree 🔒"); viewGenerate(body, close); }
    catch (e) { st.textContent = "Cle privee invalide (JSON incorrect)."; }
  });
}

function viewUnlock(body, close) {
  body.innerHTML = `
    <h3>&#128273; Mode vendeur</h3>
    <p class="rlic-hint">Deverrouille ta cle de signature pour generer une licence.</p>
    <label class="rlic-field"><span class="lab">Passphrase vendeur</span>
      <input type="password" id="v-pass" placeholder="mot de passe vendeur"></label>
    <div id="v-status" class="rlic-status"></div>
    <div class="rlic-row"><button class="rlic-btn ghost" id="v-forget">Oublier la cle</button><button class="rlic-btn primary" id="v-unlock">Deverrouiller</button></div>`;
  body.querySelector("#v-forget").addEventListener("click", () => {
    if (confirm("Supprimer la cle vendeur de cet appareil ?")) { localStorage.removeItem(VKEY); privInMemory = null; close(); toast("Cle vendeur supprimee"); }
  });
  body.querySelector("#v-unlock").addEventListener("click", async () => {
    const pass = body.querySelector("#v-pass").value; const st = body.querySelector("#v-status");
    if (!pass) { st.textContent = "Entre ta passphrase."; return; }
    st.textContent = "Deverrouillage…";
    try { privInMemory = await unlockPriv(pass); viewGenerate(body, close); }
    catch (e) { st.textContent = "❌ Passphrase incorrecte."; }
  });
}

function viewGenerate(body, close) {
  body.innerHTML = `
    <h3>&#128273; Generer une licence</h3>
    <p class="rlic-hint">Entre l'e-mail que le client t'a communique a l'achat. La cle sera liee a cet e-mail (valable sur tous ses appareils).</p>
    <label class="rlic-field"><span class="lab">E-mail du client</span>
      <input type="email" id="v-email" placeholder="ex. client@mail.com" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <div class="rlic-row"><button class="rlic-btn primary" id="v-gen">Generer la cle</button></div>
    <div id="v-out" class="rlic-out" style="display:none"></div>
    <div class="rlic-row"><button class="rlic-btn ghost" data-close>Fermer</button></div>`;
  body.querySelector("[data-close]").addEventListener("click", close);
  body.querySelector("#v-gen").addEventListener("click", async () => {
    const email = body.querySelector("#v-email").value.trim();
    const out = body.querySelector("#v-out");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { out.style.display = "block"; out.textContent = "Entre un e-mail valide."; return; }
    try {
      const licence = await signerEmail(privInMemory, email);
      out.style.display = "block";
      out.innerHTML = `<div class="rlic-hint" style="margin-bottom:6px">Cle pour <b>${esc(email.toLowerCase())}</b> (copiee) — envoie e-mail + cle au client :</div>
        <div class="rlic-key">${esc(licence)}</div>`;
      if (navigator.clipboard) navigator.clipboard.writeText(licence);
      toast("Cle generee et copiee");
    } catch (e) { out.style.display = "block"; out.textContent = "Erreur : " + e.message; }
  });
}

function bindLongPress(el) {
  if (!el) return;
  el.style.touchAction = "manipulation";
  el.style.userSelect = "none";
  el.style.webkitUserSelect = "none";
  el.style.cursor = "default";
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  let timer = null;
  const start = () => { clearTimeout(timer); timer = setTimeout(open, 800); };
  const cancel = () => { clearTimeout(timer); };
  el.addEventListener("pointerdown", start);
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
  let taps = 0, tapTimer = null;
  el.addEventListener("click", () => {
    taps++; clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { taps = 0; }, 800);
    if (taps >= 5) { taps = 0; clearTimeout(tapTimer); open(); }
  });
}

export const Vendeur = { open, bindLongPress, hasKey, signerEmail };
