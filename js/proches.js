/*
 * proches.js — "De quelle grande ville depend ce prospect ?"
 *
 * Un prospect installe dans un village ne parle a personne : ni au commercial
 * qui appelle, ni au chef qui relit la liste. On rattache donc chaque prospect
 * a la grande ville la plus proche, avec la distance.
 *
 * Deux sources de position, dans cet ordre :
 *   1. la fiche Google du prospect (precise, et SANS appel supplementaire :
 *      la position voyage dans la reponse deja demandee) ;
 *   2. a defaut, le nom de sa commune, resolu par le geocodeur de l'Etat
 *      (api-adresse.data.gouv.fr). Gratuit, sans cle, et surtout SANS toucher
 *      au quota Google. Chaque commune n'est demandee qu'une fois, le resultat
 *      est garde sur l'appareil.
 */
import { GRANDES_VILLES } from "./villes.js";

const LS_GEO = "radar_communes_geo";
// En deca, c'est la meme localite : le rattachement n'apprendrait rien.
const SEUIL_KM = 2;

// Comparaison de noms de communes, insensible aux accents, casse et traits d'union.
function memeCommune(a, b) {
  const n = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
  return !!a && !!b && n(a) === n(b);
}

// Distance orthodromique (formule de haversine), en kilometres.
export function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Grande ville la plus proche d'un point. Renvoie null si le point est aberrant.
export function villeProche(lat, lon) {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  let meilleure = null;
  for (const v of GRANDES_VILLES) {
    const d = distanceKm(lat, lon, v.lat, v.lon);
    if (!meilleure || d < meilleure.km) meilleure = { ville: v.n, km: d, pop: v.pop };
  }
  if (!meilleure) return null;
  return { ville: meilleure.ville, km: Math.round(meilleure.km), pop: meilleure.pop,
           dedans: meilleure.km <= SEUIL_KM };
}

// ---------------------------------------------------------------------------
// Geocodage d'une commune par son nom (gratuit, base BAN de l'Etat)
// ---------------------------------------------------------------------------

function cache() {
  try { return JSON.parse(localStorage.getItem(LS_GEO) || "{}") || {}; }
  catch (e) { return {}; }
}

function garder(cle, valeur) {
  try {
    const c = cache();
    c[cle] = valeur;
    localStorage.setItem(LS_GEO, JSON.stringify(c));
  } catch (e) { /* quota du navigateur : on se passe du cache */ }
}

// Renvoie {lat, lon, pop, nom} ou null. Une commune inconnue est memorisee
// comme telle pour ne pas etre redemandee a chaque analyse.
export async function geocoderCommune(nom, cp) {
  const codePostal = String(cp || "").replace(/\D/g, "").slice(0, 5);
  const cle = (nom || "").trim().toLowerCase() + (codePostal ? "|" + codePostal : "");
  if (!cle || cle.startsWith("|")) return null;
  const c = cache();
  if (Object.prototype.hasOwnProperty.call(c, cle)) return c[cle];

  // Sans code postal, un nom de commune peut etre ambigu (Marmagne existe dans
  // le Cher ET en Saone-et-Loire) : quand le CSV le fournit, on s'en sert.
  let url = "https://api-adresse.data.gouv.fr/search/?type=municipality&limit=1&q="
    + encodeURIComponent(nom);
  if (codePostal.length === 5) url += "&postcode=" + codePostal;
  let res = null;
  try {
    let r = await fetch(url);
    if (!r.ok && r.status === 429) {          // trop d'appels rapproches : une seule reprise
      await new Promise((s) => setTimeout(s, 600));
      r = await fetch(url);
    }
    // ⚠ Ne JAMAIS memoriser un echec. Un refus temporaire (limite de debit sur
    // une longue liste, coupure reseau) serait retenu comme "commune
    // introuvable" pour toujours, et le prospect resterait sans rattachement.
    if (!r.ok) return null;
    const d = await r.json();
    const f = (d.features || [])[0];
    if (f && f.geometry && f.geometry.coordinates) {
      res = {
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        pop: (f.properties && f.properties.population) || 0,
        nom: (f.properties && f.properties.name) || nom,
      };
    }
  } catch (e) {
    return null;          // hors ligne : on n'enregistre rien, on reessaiera
  }
  // Ici le service a repondu : soit une commune, soit "aucun resultat" pour de
  // bon. Les deux se memorisent, c'est une reponse et non une panne.
  garder(cle, res);
  return res;
}

// Phrase courte affichee sur la carte du prospect.
// "de" + nom de ville, en francais correct : du Creusot, du Havre, du Mans,
// des Sables-d'Olonne, de La Rochelle, d'Auxerre, de Chalon-sur-Saone.
export function deVille(nom) {
  if (!nom) return "";
  if (nom.startsWith("Le ")) return "du " + nom.slice(3);
  if (nom.startsWith("Les ")) return "des " + nom.slice(4);
  if (/^[AEIOUYÀÂÉÈÊËÎÏÔÖÙÛÜ]/.test(nom)) return "d'" + nom;
  return "de " + nom;
}

export function texteProche(fiche) {
  if (!fiche || !fiche.ville_proche) return "";
  // Le prospect EST dans la grande ville : le lui dire n'apprend rien.
  if (fiche.proche_dedans || memeCommune(fiche.ville, fiche.ville_proche)) return "";
  return `à ${fiche.proche_km} km ${deVille(fiche.ville_proche)}`;
}
