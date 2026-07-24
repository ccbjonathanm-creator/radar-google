/* ============================================================
   trial.js — compteur d'essai gratuit cote serveur (Cloudflare Worker).
   But : reinstaller / vider le cache / changer de navigateur ne redonne PAS
   l'essai. Le compteur vit sur le Worker, indexe par l'e-mail (hache cote
   serveur). Repli honnete : si le Worker est injoignable, on laisse passer
   (fail-open) pour ne pas bloquer quelqu'un de legitime ; on ne decompte pas.

   Deux compteurs, meme e-mail (l'identite du client) :
     - Trial          -> app "radar"           : 1 liste analysee gratuite.
     - TrialRecherche  -> app "radar-recherche" : 1 recherche de prospects gratuite (module).
   L'e-mail est partage (une seule saisie au demarrage) : on le lit toujours
   depuis localStorage pour que les deux compteurs voient la meme adresse.
   ============================================================ */
const WORKER = "https://resolv-trials.contactweb71.workers.dev";
const EKEY = "radar.trial_email";   // e-mail partage par les deux compteurs

const norm = (e) => (e || "").trim().toLowerCase();
function lireEmail() { try { return localStorage.getItem(EKEY) || null; } catch (e) { return null; } }

// Fabrique un compteur d'essai pour une "app" donnee du Worker partage.
function makeTrial(app) {
  let usesLeft = null;   // null = inconnu (pas interroge / hors-ligne)
  let limit = 1;

  async function api(path) {
    const email = lireEmail();
    const r = await fetch(WORKER + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app, email }),
    });
    if (!r.ok) throw new Error("HTTP_" + r.status);
    return r.json();
  }

  return {
    load() { /* l'e-mail est lu a la demande depuis localStorage */ },
    hasEmail() { return !!lireEmail(); },
    getEmail() { return lireEmail(); },
    setEmail(e) { try { localStorage.setItem(EKEY, norm(e)); } catch (_) {} },
    valid(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm(e)); },

    // Interroge le compteur SANS consommer. Renvoie l'objet ou null (hors-ligne).
    async status() {
      if (!lireEmail()) return null;
      try { const j = await api("/api/status"); usesLeft = j.usesLeft; limit = j.limit; return j; }
      catch (e) { return null; }
    },
    // Consomme un essai. Fail-open (allowed:true, offline:true) si Worker injoignable.
    async consume() {
      if (!lireEmail()) return { allowed: false, noEmail: true };
      try { const j = await api("/api/consume"); usesLeft = j.usesLeft; limit = j.limit; return j; }
      catch (e) { return { allowed: true, offline: true }; }
    },
    get usesLeft() { return usesLeft; },
    get limit() { return limit; },
  };
}

export const Trial = makeTrial("radar");
export const TrialRecherche = makeTrial("radar-recherche");
