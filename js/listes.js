/*
 * listes.js — Memoire des listes deja produites.
 *
 * Chaque analyse ou recherche a coute des appels Google. Fermer l'onglet ne
 * doit pas obliger a les repayer : le resultat est garde sur l'appareil et se
 * rouvre d'un clic, sans le moindre appel reseau.
 *
 * 100 % local, comme le reste : rien ne part ailleurs.
 */

const LS_LISTES = "radar_listes";
const MAX_LISTES = 10;

function lireTout() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_LISTES) || "[]");
    return Array.isArray(d) ? d : [];
  } catch (e) {
    return [];
  }
}

// Ecrit en abandonnant les plus anciennes si le navigateur refuse (quota plein).
// Renvoie le nombre de listes finalement conservees, ou -1 si rien n'a pu etre
// enregistre : dans ce cas l'appelant doit le DIRE, pas faire comme si.
function ecrire(listes) {
  let essai = listes.slice(0, MAX_LISTES);
  while (essai.length) {
    try {
      localStorage.setItem(LS_LISTES, JSON.stringify(essai));
      return essai.length;
    } catch (e) {
      essai = essai.slice(0, essai.length - 1);   // on sacrifie la plus ancienne
    }
  }
  try { localStorage.removeItem(LS_LISTES); } catch (e) { /* rien a faire */ }
  return -1;
}

function identifiant(listes) {
  let n = 1;
  const pris = new Set(listes.map((l) => l.id));
  while (pris.has("l" + n)) n++;
  return "l" + n;
}

export const Listes = {
  // Resume des listes, la plus recente en tete. Sans les fiches (leger).
  resumes() {
    return lireTout().map((l) => ({
      id: l.id, titre: l.titre, date: l.date,
      nombre: (l.fiches || []).length, origine: l.origine,
    }));
  },

  // Enregistre une liste. Renvoie {ok, conservees} pour que l'appelant puisse
  // prevenir honnetement si le navigateur n'a pas voulu de tout.
  enregistrer(fiches, titre, origine) {
    if (!fiches || !fiches.length) return { ok: false, conservees: 0 };
    const listes = lireTout();
    const entree = {
      id: identifiant(listes),
      titre: titre || "Liste",
      origine: origine || "",
      date: new Date().toISOString(),
      fiches,
    };
    const n = ecrire([entree].concat(listes));
    return { ok: n > 0, conservees: n < 0 ? 0 : n };
  },

  charger(id) {
    const l = lireTout().find((x) => x.id === id);
    return l ? l.fiches : null;
  },

  supprimer(id) {
    ecrire(lireTout().filter((x) => x.id !== id));
  },

  vider() {
    try { localStorage.removeItem(LS_LISTES); } catch (e) { /* rien a faire */ }
  },

  // Poids approximatif occupe sur l'appareil, en Ko.
  poidsKo() {
    try { return Math.round((localStorage.getItem(LS_LISTES) || "").length / 1024); }
    catch (e) { return 0; }
  },
};

// Date lisible : "27/07/2026 à 18:42".
export function dateLisible(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}
