/*
 * vus.js — Memoire locale des prospects deja sortis d'une recherche.
 *
 * But : deux recherches successives sur le meme metier ne doivent pas ressortir
 * les memes entreprises. On retient l'identifiant Google du lieu (place id), qui
 * est stable et unique, jamais le nom (deux entreprises peuvent le partager).
 *
 * 100 % local : rien ne quitte l'appareil, comme le reste de l'application.
 */

const LS_VUS = "radar_prospects_vus";
const LS_CURSEUR = "radar_curseur_villes";
const PLAFOND = 20000;   // au-dela, on oublie les plus anciens (FIFO)

function lire() {
  try {
    const brut = JSON.parse(localStorage.getItem(LS_VUS) || "[]");
    return Array.isArray(brut) ? brut : [];
  } catch (e) {
    return [];
  }
}

function ecrire(liste) {
  try {
    localStorage.setItem(LS_VUS, JSON.stringify(liste));
    return true;
  } catch (e) {
    // Quota du navigateur atteint : on retombe sur une memoire deux fois plus courte
    // plutot que de perdre la fonction entierement.
    try {
      localStorage.setItem(LS_VUS, JSON.stringify(liste.slice(-Math.floor(PLAFOND / 2))));
      return true;
    } catch (e2) {
      return false;
    }
  }
}

export const Vus = {
  // Ensemble des place ids deja sortis, pret pour un test d'appartenance.
  ensemble() {
    return new Set(lire());
  },

  nombre() {
    return lire().length;
  },

  // Ajoute les lieux d'une recherche. Renvoie le nombre reellement ajoute.
  ajouter(ids) {
    const liste = lire();
    const connus = new Set(liste);
    let ajoutes = 0;
    for (const id of ids) {
      if (!id || connus.has(id)) continue;
      connus.add(id);
      liste.push(id);
      ajoutes++;
    }
    ecrire(liste.length > PLAFOND ? liste.slice(-PLAFOND) : liste);
    return ajoutes;
  },

  vider() {
    try { localStorage.removeItem(LS_VUS); } catch (e) { /* rien a faire */ }
    try { localStorage.removeItem(LS_CURSEUR); } catch (e) { /* rien a faire */ }
  },

  // Curseur de balayage national : la prochaine recherche reprend la ou la
  // precedente s'est arretee, au lieu de reprendre les memes villes.
  curseur() {
    const n = parseInt(localStorage.getItem(LS_CURSEUR) || "0", 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  },

  poserCurseur(n) {
    try { localStorage.setItem(LS_CURSEUR, String(n)); } catch (e) { /* rien a faire */ }
  },
};
