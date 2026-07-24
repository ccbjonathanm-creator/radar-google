/*
 * csv.js — Lecture du CSV de prospects (export Flunter ou autre) dans le navigateur.
 * Portage fidele de la partie "lecture + detection colonnes + dedoublonnage" du script Python.
 */

// Pour chaque champ logique, mots-cles cherches dans l'en-tete (minuscules, sans accents).
// L'ordre compte : le 1er mot-cle est prioritaire.
const MOTS_CLES = {
  prenom:  ["first_name", "firstname", "prenom"],
  nom:     ["last_name", "lastname", "surname", "nom"],
  societe: ["company", "societe", "entreprise", "raison", "enseigne"],
  tel:     ["phone", "telephone", "mobile", "portable", "tel"],
  ville:   ["city", "ville", "commune", "localite"],
  email:   ["email", "courriel", "mail"],
  site:    ["company_website", "website", "site_web", "site_internet"],
  profil:  ["crm_url", "crm", "linkedin", "profil", "fiche"],
};

const REMP_ACCENTS = {
  "à":"a","â":"a","ä":"a","é":"e","è":"e","ê":"e","ë":"e","î":"i","ï":"i",
  "ô":"o","ö":"o","ù":"u","û":"u","ü":"u","ç":"c",
};

export function sansAccents(s) {
  s = (s || "").toLowerCase();
  let out = "";
  for (const c of s) out += (REMP_ACCENTS[c] || c);
  return out;
}

export function normaliserTel(t) {
  if (!t) return "";
  let chiffres = String(t).replace(/\D/g, "");
  // France : +33 6 -> 06 ; on garde les 9 derniers chiffres comme cle.
  if (chiffres.startsWith("33") && chiffres.length >= 11) {
    chiffres = "0" + chiffres.slice(2);
  }
  return chiffres.length >= 9 ? chiffres.slice(-9) : chiffres;
}

// -- Parseur CSV robuste : gere guillemets, sauts de ligne dans les champs,
//    et detecte le separateur (, ; ou tabulation).
function detecterSeparateur(texte) {
  const premiere = texte.split(/\r?\n/, 1)[0] || "";
  const compte = (sep) => (premiere.match(new RegExp("\\" + sep, "g")) || []).length;
  const virg = compte(",");
  const pv = compte(";");
  const tab = (premiere.match(/\t/g) || []).length;
  if (pv >= virg && pv >= tab) return ";";
  if (tab > virg) return "\t";
  return ",";
}

export function parseCSV(texte) {
  // Retire un BOM eventuel.
  if (texte.charCodeAt(0) === 0xFEFF) texte = texte.slice(1);
  const sep = detecterSeparateur(texte);
  const lignes = [];
  let champ = "";
  let ligne = [];
  let dansGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (dansGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') { champ += '"'; i++; }
        else dansGuillemets = false;
      } else champ += c;
    } else {
      if (c === '"') dansGuillemets = true;
      else if (c === sep) { ligne.push(champ); champ = ""; }
      else if (c === "\n") { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ""; }
      else if (c === "\r") { /* ignore, gere par \n */ }
      else champ += c;
    }
  }
  // dernier champ / derniere ligne
  if (champ.length > 0 || ligne.length > 0) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

export function detecterColonnes(entetes) {
  const norm = entetes.map((e) => sansAccents(e || ""));
  const mapping = {};
  for (const [champ, cles] of Object.entries(MOTS_CLES)) {
    let best = null; // [score, index]
    for (let i = 0; i < norm.length; i++) {
      const e = norm[i];
      let meilleur = 0;
      cles.forEach((c, rang) => {
        if (e.includes(c)) {
          const score = cles.length - rang;
          if (score > meilleur) meilleur = score;
        }
      });
      if (meilleur && (best === null || meilleur > best[0])) best = [meilleur, i];
    }
    if (best) mapping[champ] = best[1];
  }
  return mapping;
}

// Lit les lignes deja parsees -> liste de prospects uniques + mapping + entetes.
export function lireProspects(lignes) {
  if (!lignes || !lignes.length) throw new Error("CSV vide.");
  const entetes = lignes[0];
  const mapping = detecterColonnes(entetes);

  const val = (ligne, champ) => {
    const i = mapping[champ];
    if (i === undefined || i >= ligne.length) return "";
    return (ligne[i] || "").trim();
  };

  const prospects = [];
  const vus = new Set();
  for (let r = 1; r < lignes.length; r++) {
    const ligne = lignes[r];
    if (!ligne.some((x) => x && x.trim())) continue;
    const prenom = val(ligne, "prenom");
    const nom = val(ligne, "nom");
    const societe = val(ligne, "societe");
    const tel = val(ligne, "tel");
    const ville = val(ligne, "ville");
    const email = val(ligne, "email");
    const profil = val(ligne, "profil");

    const nomComplet = [prenom, nom].filter(Boolean).join(" ").trim();
    const entite = societe || nomComplet;
    if (!entite && !tel) continue;

    const cle = normaliserTel(tel) || entite.toLowerCase();
    if (vus.has(cle)) continue;
    vus.add(cle);

    prospects.push({
      entite,
      personne: nomComplet,
      societe,
      tel,
      tel_norm: normaliserTel(tel),
      ville,
      email,
      profil,
    });
  }
  return { prospects, mapping, entetes };
}
