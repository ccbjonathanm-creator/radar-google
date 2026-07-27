/*
 * zones.js — Comprendre la zone tapee par l'utilisateur.
 *
 * "Chalon-sur-Saone" est une ville : une seule requete suffit.
 * "Saone-et-Loire" ou "71" est un DEPARTEMENT : une requete unique ne
 * rapporterait qu'une soixantaine de resultats pour 563 communes. Il faut le
 * balayer commune par commune, des plus peuplees aux plus petites.
 *
 * La liste des communes n'est pas embarquee (35 000 entrees) : elle est
 * demandee a l'API Decoupage administratif de l'Etat (geo.api.gouv.fr),
 * gratuite, sans cle, HORS quota Google, puis gardee sur l'appareil.
 */
import { DEPARTEMENTS } from "./departements.js";

const LS_COMMUNES = "radar_communes_dep";

function normaliser(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Renvoie {code, nom} si le texte designe un departement, sinon null.
export function reconnaitreDepartement(texte) {
  const t = (texte || "").trim();
  if (!t) return null;
  const brut = t.toUpperCase().replace(/\s/g, "");
  // Par le numero : 71, 2A, 974... (on refuse les nombres qui ne sont pas un code)
  const parCode = DEPARTEMENTS.find((d) => d.c === brut || d.c === brut.padStart(2, "0"));
  if (parCode) return { code: parCode.c, nom: parCode.n };
  // Par le nom, insensible aux accents, tirets et espaces
  const n = normaliser(t);
  const parNom = DEPARTEMENTS.find((d) => normaliser(d.n) === n);
  return parNom ? { code: parNom.c, nom: parNom.n } : null;
}

function cache() {
  try { return JSON.parse(localStorage.getItem(LS_COMMUNES) || "{}") || {}; }
  catch (e) { return {}; }
}

// Communes d'un departement, de la plus peuplee a la plus petite : c'est la ou
// il y a des entreprises, donc le meilleur rendement par appel Google.
export async function communesDuDepartement(code) {
  const c = cache();
  if (Array.isArray(c[code])) return c[code];
  const url = `https://geo.api.gouv.fr/departements/${encodeURIComponent(code)}`
    + "/communes?fields=nom,population&format=json";
  let noms = null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;                    // echec : on ne memorise rien
    const d = await r.json();
    if (!Array.isArray(d) || !d.length) return null;
    noms = d.slice()
      .sort((a, b) => (b.population || 0) - (a.population || 0))
      .map((x) => x.nom);
  } catch (e) {
    return null;                               // hors ligne : on reessaiera
  }
  try {
    const maj = cache();
    maj[code] = noms;
    localStorage.setItem(LS_COMMUNES, JSON.stringify(maj));
  } catch (e) { /* quota plein : on se passe du cache */ }
  return noms;
}
