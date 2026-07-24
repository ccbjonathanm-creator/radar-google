/* ============================================================
   trial.js — compteur d'essai gratuit cote serveur (Cloudflare Worker).
   But : reinstaller / vider le cache / changer de navigateur ne redonne PAS
   la liste gratuite. Le compteur vit sur le Worker, indexe par l'e-mail
   (hache cote serveur). Radar = 1 liste gratuite (mode "uses", limit 1).
   Repli honnete : si le Worker est injoignable, on laisse passer (fail-open)
   pour ne pas bloquer quelqu'un de legitime ; on ne decompte simplement pas.
   ============================================================ */
const WORKER = "https://resolv-trials.contactweb71.workers.dev";
const APP = "radar";
const EKEY = "radar.trial_email";

let email = null;
let usesLeft = null;   // null = inconnu (pas interroge / hors-ligne)
let limit = 1;

const norm = (e) => (e || "").trim().toLowerCase();

async function api(path) {
  const r = await fetch(WORKER + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app: APP, email }),
  });
  if (!r.ok) throw new Error("HTTP_" + r.status);
  return r.json();
}

export const Trial = {
  load() { try { email = localStorage.getItem(EKEY) || null; } catch (e) { email = null; } },
  hasEmail() { return !!email; },
  getEmail() { return email; },
  setEmail(e) { email = norm(e); try { localStorage.setItem(EKEY, email); } catch (_) {} },
  valid(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm(e)); },

  // Interroge le compteur SANS consommer. Renvoie l'objet ou null (hors-ligne).
  async status() {
    if (!email) return null;
    try { const j = await api("/api/status"); usesLeft = j.usesLeft; limit = j.limit; return j; }
    catch (e) { return null; }
  },
  // Consomme la liste gratuite. Fail-open (allowed:true, offline:true) si Worker injoignable.
  async consume() {
    if (!email) return { allowed: false, noEmail: true };
    try { const j = await api("/api/consume"); usesLeft = j.usesLeft; limit = j.limit; return j; }
    catch (e) { return { allowed: true, offline: true }; }
  },
  get usesLeft() { return usesLeft; },
  get limit() { return limit; },
};
