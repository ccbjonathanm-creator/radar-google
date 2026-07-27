/*
 * csv.js — Lecture du CSV de prospects (export Flunter ou autre) dans le navigateur.
 * Portage fidele de la partie "lecture + detection colonnes + dedoublonnage" du script Python.
 */

// Pour chaque champ logique, mots-cles cherches dans l'en-tete (minuscules, sans accents).
// L'ordre compte : le 1er mot-cle est prioritaire.
// "entite" est en tete de societe : c'est le nom de colonne que Radar EXPORTE.
// L'application doit savoir relire son propre fichier.
const MOTS_CLES = {
  prenom:  ["first_name", "firstname", "prenom"],
  nom:     ["last_name", "lastname", "surname", "nom"],
  societe: ["entite", "company", "societe", "entreprise", "raison", "enseigne"],
  tel:     ["phone", "telephone", "mobile", "portable", "tel"],
  ville:   ["city", "ville", "commune", "localite"],
  // Le code postal leve l'ambiguite des homonymes : il y a un Marmagne dans le
  // Cher et un autre en Saone-et-Loire, a 200 km l'un de l'autre.
  cp:      ["code_postal", "codepostal", "zip", "postcode", "cp"],
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

// Normalise un en-tete : minuscules, sans accents, ponctuation -> espaces.
// "Nom de famille" -> "nom de famille" ; "company_website" -> "company website".
function normEntete(s) {
  return sansAccents(s || "").replace(/[^a-z0-9]+/g, " ").trim();
}

// Force d'une correspondance entre un en-tete et un mot-cle.
// On refuse volontairement la correspondance "au milieu d'un mot" : c'est elle qui
// faisait capturer la colonne "Prenom" par le mot-cle "nom" (-> "Frederic Frederic").
function forceMatch(entete, motCle) {
  const cle = normEntete(motCle);
  if (!cle || !entete) return 0;
  if (entete === cle) return 100;                       // en-tete identique au mot-cle
  const motsCle = cle.split(" ");
  const mots = entete.split(" ");
  if (motsCle.length > 1) {
    // mot-cle compose : il doit apparaitre tel quel dans l'en-tete
    return (" " + entete + " ").includes(" " + cle + " ") ? 80 : 0;
  }
  return mots.includes(cle) ? 60 : 0;                   // mot entier uniquement
}

export function detecterColonnes(entetes) {
  const norm = entetes.map(normEntete);
  // 1) tous les rapprochements possibles, avec leur force
  const candidats = [];
  for (const [champ, cles] of Object.entries(MOTS_CLES)) {
    for (let i = 0; i < norm.length; i++) {
      let meilleur = 0;
      cles.forEach((c, rang) => {
        const f = forceMatch(norm[i], c);
        // bonus de rang : a force egale, le 1er mot-cle de la liste l'emporte
        if (f) meilleur = Math.max(meilleur, f + (cles.length - rang));
      });
      if (meilleur) candidats.push({ champ, col: i, force: meilleur });
    }
  }
  // 2) attribution du plus sur au moins sur, une colonne ne servant qu'une fois
  candidats.sort((a, b) => b.force - a.force || a.col - b.col);
  const mapping = {};
  const colsPrises = new Set();
  for (const c of candidats) {
    if (mapping[c.champ] !== undefined || colsPrises.has(c.col)) continue;
    mapping[c.champ] = c.col;
    colsPrises.add(c.col);
  }
  return mapping;
}

// Reconnait un fichier deja produit par Radar (export "CSV enrichi").
export function estExportRadar(entetes) {
  const norm = entetes.map(normEntete);
  return norm.includes("entite") && (norm.includes("accroche") || norm.includes("fiche google"));
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
  let sansNom = 0;   // lignes ecartees faute de nom exploitable
  for (let r = 1; r < lignes.length; r++) {
    const ligne = lignes[r];
    if (!ligne.some((x) => x && x.trim())) continue;
    const prenom = val(ligne, "prenom");
    const nom = val(ligne, "nom");
    const societe = val(ligne, "societe");
    const tel = val(ligne, "tel");
    const ville = val(ligne, "ville");
    const cp = val(ligne, "cp");
    const email = val(ligne, "email");
    const profil = val(ligne, "profil");

    // Prenom et nom peuvent pointer la meme colonne sur un CSV ambigu : on ne
    // repete pas deux fois le meme mot ("Frederic Frederic").
    const morceaux = [prenom, nom].filter(Boolean);
    const nomComplet = (morceaux[0] === morceaux[1] ? [morceaux[0]] : morceaux).join(" ").trim();
    const entite = societe || nomComplet;
    // Sans nom, la requete envoyee a Google se reduirait a la ville : elle ne
    // designe personne, et le diagnostic qui en sortirait serait faux.
    if (!entite) { sansNom++; continue; }

    const cle = normaliserTel(tel) || entite.toLowerCase();
    if (vus.has(cle)) continue;
    vus.add(cle);

    prospects.push({
      entite,
      cp,
      personne: nomComplet,
      societe,
      tel,
      tel_norm: normaliserTel(tel),
      ville,
      email,
      profil,
    });
  }
  return { prospects, mapping, entetes, sansNom, exportRadar: estExportRadar(entetes) };
}
