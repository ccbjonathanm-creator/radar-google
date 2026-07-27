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
  societe: ["entite", "company", "societe", "entreprise", "raison", "enseigne",
            "etablissement", "denomination", "structure", "organisation", "ese",
            "business", "commerce", "magasin", "boutique", "cabinet", "agence"],
  tel:     ["phone", "telephone", "mobile", "portable", "tel", "gsm", "fixe",
            "numero", "num", "contact"],
  ville:   ["city", "ville", "commune", "localite", "town", "municipalite", "bourg"],
  // Le code postal leve l'ambiguite des homonymes : il y a un Marmagne dans le
  // Cher et un autre en Saone-et-Loire, a 200 km l'un de l'autre.
  cp:      ["code_postal", "codepostal", "zip", "postcode", "cp", "postal"],
  email:   ["email", "courriel", "mail", "e_mail"],
  site:    ["company_website", "website", "site_web", "site_internet", "site", "web", "url"],
  profil:  ["crm_url", "crm", "linkedin", "profil"],
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

// ---------------------------------------------------------------------------
// Detection par le CONTENU
//
// Les noms de colonnes varient d'un fichier a l'autre, et certains fichiers
// n'ont carrement pas de ligne d'en-tete. On regarde donc ce qu'il y a DEDANS :
// un numero de telephone, un e-mail ou un code postal se reconnaissent tout
// seuls, quel que soit le titre de la colonne.
// ---------------------------------------------------------------------------

const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const RE_CP = /^\d{5}$/;
const RE_URL = /^(https?:\/\/|www\.)/i;

function ressembleTel(v) {
  const d = String(v).replace(/\D/g, "");
  if (d.length < 9 || d.length > 15) return false;
  if (RE_CP.test(String(v).trim())) return false;      // 5 chiffres = code postal
  return /^(0|33|0033|\+33)/.test(String(v).replace(/[\s.\-()]/g, "")) || d.length === 9;
}

// Profil de chaque colonne sur un echantillon de lignes.
function profilerColonnes(lignes, debut) {
  const nbCol = Math.max(...lignes.map((l) => l.length));
  const echantillon = lignes.slice(debut, debut + 60);
  const cols = [];
  for (let i = 0; i < nbCol; i++) {
    const vals = echantillon.map((l) => (l[i] || "").trim()).filter(Boolean);
    const n = vals.length || 1;
    const part = (f) => vals.filter(f).length / n;
    cols.push({
      i,
      remplies: vals.length,
      email: part((v) => RE_EMAIL.test(v)),
      tel: part(ressembleTel),
      cp: part((v) => RE_CP.test(v)),
      url: part((v) => RE_URL.test(v)),
      texte: part((v) => /[A-Za-zÀ-ÿ]{3}/.test(v) && !/^\d/.test(v)),
      distincts: new Set(vals.map((v) => v.toLowerCase())).size / n,
      longueur: vals.reduce((s, v) => s + v.length, 0) / n,
    });
  }
  return cols;
}

// Complete un mapping incomplet en s'appuyant sur le contenu des colonnes.
export function completerParContenu(mapping, lignes, debut) {
  const cols = profilerColonnes(lignes, debut);
  const pris = new Set(Object.values(mapping));
  const libre = (c) => !pris.has(c.i) && c.remplies > 0;
  const poser = (champ, col) => {
    if (mapping[champ] !== undefined || !col) return;
    mapping[champ] = col.i;
    pris.add(col.i);
  };
  const meilleur = (test, seuil) => {
    const cand = cols.filter(libre).filter((c) => test(c) >= seuil)
      .sort((a, b) => test(b) - test(a));
    return cand[0];
  };

  // Du plus reconnaissable au moins reconnaissable.
  poser("email", meilleur((c) => c.email, 0.5));
  poser("tel", meilleur((c) => c.tel, 0.5));
  poser("cp", meilleur((c) => c.cp, 0.7));
  poser("site", meilleur((c) => c.url, 0.5));

  // Le nom de l'entreprise : la colonne de texte dont les valeurs sont le plus
  // souvent differentes d'une ligne a l'autre (une ville se repete, pas une
  // raison sociale), et la plus longue a egalite.
  if (mapping.societe === undefined && mapping.nom === undefined) {
    const s = cols.filter(libre).filter((c) => c.texte >= 0.7)
      .sort((a, b) => (b.distincts - a.distincts) || (b.longueur - a.longueur))[0];
    poser("societe", s);
  }

  // ⚠ On NE DEVINE PAS la ville ici. Une colonne de texte quelconque ("BTP",
  // "Secteur", "Zone") passerait pour une ville et partirait telle quelle dans
  // la requete Google : une ville fausse est pire qu'une ville absente. Les
  // colonnes candidates sont renvoyees, a charge de les faire confirmer par le
  // geocodeur (voir colonnesTexteLibres / proches.js).
  return mapping;
}

// Colonnes de texte encore libres : candidates possibles pour la ville, a
// confirmer contre un vrai referentiel de communes avant d'etre retenues.
export function colonnesTexteLibres(mapping, lignes, debut) {
  const pris = new Set(Object.values(mapping));
  return profilerColonnes(lignes, debut)
    .filter((c) => !pris.has(c.i) && c.remplies > 0 && c.texte >= 0.7 && c.longueur < 40)
    .map((c) => c.i);
}

// Une premiere ligne qui contient deja une donnee (telephone, e-mail, code
// postal) n'est pas un en-tete : le fichier commence directement par les
// donnees, et tout doit alors etre devine par le contenu.
export function aUneLigneEntete(lignes) {
  const p = lignes[0] || [];
  const donnees = p.filter((v) => {
    const s = (v || "").trim();
    return s && (RE_EMAIL.test(s) || RE_CP.test(s) || ressembleTel(s) || RE_URL.test(s));
  }).length;
  return donnees === 0;
}

// Reconnait un fichier deja produit par Radar (export "CSV enrichi").
export function estExportRadar(entetes) {
  const norm = entetes.map(normEntete);
  return norm.includes("entite") && (norm.includes("accroche") || norm.includes("fiche google"));
}

// Lit les lignes deja parsees -> liste de prospects uniques + mapping + entetes.
// mappingForce : correspondance imposee (correction manuelle), utilisee telle quelle.
// graine : correspondance PARTIELLE posee avant la detection par le contenu,
//          typiquement la colonne ville une fois confirmee par le geocodeur.
export function lireProspects(lignes, mappingForce, graine) {
  if (!lignes || !lignes.length) throw new Error("CSV vide.");
  const avecEntete = aUneLigneEntete(lignes);
  const debut = avecEntete ? 1 : 0;
  // Sans ligne d'en-tete, on fabrique des libelles pour que l'utilisateur
  // puisse quand meme designer les colonnes a la main.
  const entetes = avecEntete
    ? lignes[0]
    : (lignes[0] || []).map((v, i) => `Colonne ${i + 1}`);

  let mapping;
  if (mappingForce) {
    mapping = { ...mappingForce };                 // choix explicite de l'utilisateur
  } else {
    mapping = avecEntete ? detecterColonnes(entetes) : {};
    // La ville confirmee est posee AVANT : sa colonne est ainsi retiree du jeu,
    // et le nom de l'entreprise sera cherche parmi les colonnes restantes.
    if (graine) for (const [k, v] of Object.entries(graine)) if (v != null) mapping[k] = v;
    completerParContenu(mapping, lignes, debut);   // ce que le nom n'a pas donne
  }

  const val = (ligne, champ) => {
    const i = mapping[champ];
    if (i === undefined || i >= ligne.length) return "";
    return (ligne[i] || "").trim();
  };

  const prospects = [];
  const vus = new Set();
  let sansNom = 0;   // lignes ecartees faute de nom exploitable
  for (let r = debut; r < lignes.length; r++) {
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
  return { prospects, mapping, entetes, sansNom, avecEntete, lignes,
           exportRadar: avecEntete && estExportRadar(entetes) };
}
