/*
 * app.js — Orchestration de l'interface Radar Google (PWA).
 * Navigation entre Reglages / Import / Tableau de bord, enrichissement avec progression.
 */
import { parseCSV, lireProspects, colonnesTexteLibres } from "./csv.js";
import { enrichir, trierParPriorite, fichesVersCSV, placesRecherche, rechercherProspects, raisonGoogle } from "./moteur.js";
import { Licence } from "./licence.js";
import { Vendeur } from "./vendeur.js";
import { Trial, TrialRecherche } from "./trial.js";
import { Recherche } from "./modules.js";
import { Vus } from "./vus.js";
import { texteProche, confirmerColonneVille } from "./proches.js";
import { reconnaitreDepartement, communesDuDepartement } from "./zones.js";
import { Listes, dateLisible } from "./listes.js";

const LS_GOOGLE = "radar_cle_google";
const LS_GROQ = "radar_cle_groq";

const $ = (id) => document.getElementById(id);
const vues = {
  reglages: $("vue-reglages"),
  import: $("vue-import"),
  recherche: $("vue-recherche"),
  dashboard: $("vue-dashboard"),
};

let prospectsCharges = null;   // { prospects, mapping, entetes }
let fiches = null;             // resultats enrichis
let enCours = false;
let rechercheEnCours = false;

// ---------------------------------------------------------------------------
// Cles
// ---------------------------------------------------------------------------
function lireCles() {
  return {
    google: (localStorage.getItem(LS_GOOGLE) || "").trim(),
    groq: (localStorage.getItem(LS_GROQ) || "").trim(),
  };
}
function aUneCleGoogle() {
  return !!lireCles().google;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function montrer(nom) {
  for (const [k, el] of Object.entries(vues)) el.classList.toggle("hidden", k !== nom);
  $("btn-nouvelle").hidden = (nom !== "dashboard");
  window.scrollTo(0, 0);
}

function router() {
  if (!aUneCleGoogle()) {
    $("btn-annuler-reglages").hidden = true;
    montrer("reglages");
  } else if (fiches) {
    montrer("dashboard");
  } else {
    montrer("import");
  }
}

// ---------------------------------------------------------------------------
// Ecran Reglages
// ---------------------------------------------------------------------------
$("btn-reglages").addEventListener("click", () => {
  const c = lireCles();
  $("in-google").value = c.google;
  $("in-groq").value = c.groq;
  $("msg-test").textContent = "";
  $("msg-test").className = "msg-test";
  $("btn-annuler-reglages").hidden = !aUneCleGoogle();
  montrer("reglages");
});

$("btn-annuler-reglages").addEventListener("click", router);

$("btn-tester").addEventListener("click", async () => {
  const google = $("in-google").value.trim();
  const groq = $("in-groq").value.trim();
  const msg = $("msg-test");
  if (!google) {
    msg.className = "msg-test ko";
    msg.textContent = "La clé Google Places est obligatoire.";
    return;
  }
  $("btn-tester").disabled = true;
  msg.className = "msg-test";
  msg.textContent = "Test de la clé Google en cours...";
  try {
    await placesRecherche("plombier Paris", google);
    localStorage.setItem(LS_GOOGLE, google);
    localStorage.setItem(LS_GROQ, groq);
    msg.className = "msg-test ok";
    msg.textContent = "Clé valide, enregistrée. ✅";
    setTimeout(router, 700);
  } catch (e) {
    msg.className = "msg-test ko";
    if (e.code === 403) msg.textContent = "Clé refusée (403). Vérifie que \"Places API (New)\" est activée et que la clé n'a pas de restriction bloquante.";
    else if (e.code === 400) msg.textContent = "Requête refusée (400). La clé semble incorrecte.";
    else msg.textContent = "Échec du test : " + (e.message || e) + ". Clé non enregistrée.";
  } finally {
    $("btn-tester").disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Ecran Import
// ---------------------------------------------------------------------------
const dropzone = $("dropzone");
const fileInput = $("file-input");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("survol"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("survol"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("survol");
  if (e.dataTransfer.files && e.dataTransfer.files[0]) chargerFichier(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files[0]) chargerFichier(fileInput.files[0]);
});

// Champs proposes a la correction manuelle, dans l'ordre d'importance.
const CHAMPS_COLONNES = [
  ["societe", "Nom de l'entreprise"],
  ["ville", "Ville"],
  ["cp", "Code postal"],
  ["tel", "Téléphone"],
  ["email", "E-mail"],
  ["prenom", "Prénom"],
  ["nom", "Nom de famille"],
  ["site", "Site web"],
];

// Tableau de correspondance modifiable : c'est le filet quand la detection
// automatique se trompe, et la preuve visible de ce qu'elle a compris.
function rendreColonnes(res) {
  const bloc = $("bloc-colonnes");
  const zone = $("colonnes");
  if (!res || !res.entetes) { bloc.hidden = true; return; }
  bloc.hidden = false;
  const options = (sel) => ['<option value="">— aucune —</option>']
    .concat(res.entetes.map((e, i) =>
      `<option value="${i}"${sel === i ? " selected" : ""}>${echapper(e || ("Colonne " + (i + 1)))}</option>`))
    .join("");
  zone.innerHTML = CHAMPS_COLONNES.map(([champ, libelle]) => `
    <label class="champ">
      <span class="lab">${libelle}</span>
      <select class="col-select" data-champ="${champ}">${options(res.mapping[champ])}</select>
    </label>`).join("");
}

$("colonnes").addEventListener("change", (e) => {
  const sel = e.target.closest(".col-select");
  if (!sel || !prospectsCharges) return;
  const mapping = {};
  for (const s of $("colonnes").querySelectorAll(".col-select")) {
    if (s.value !== "") mapping[s.getAttribute("data-champ")] = parseInt(s.value, 10);
  }
  const res = lireProspects(prospectsCharges.lignes, mapping);
  res.nomFichier = prospectsCharges.nomFichier;
  prospectsCharges = res;
  $("nom-fichier").textContent = `${res.nomFichier} — ${res.prospects.length} prospects uniques détectés`;
  $("btn-analyser").disabled = !res.prospects.length;
  afficherLimite(res.prospects.length
    ? `Correspondance mise à jour : ${res.prospects.length} prospect(s) exploitables.`
    : "Avec ces colonnes, aucune ligne n'a de nom d'entreprise exploitable.",
    res.prospects.length ? "info" : "warn");
});

function chargerFichier(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const lignes = parseCSV(String(reader.result));
      let res = lireProspects(lignes);

      // La ville n'est jamais devinee : si elle manque, on demande au geocodeur
      // de confirmer qu'une colonne contient bien de vraies communes.
      if (res.mapping.ville === undefined) {
        const debut = res.avecEntete ? 1 : 0;
        let candidats = colonnesTexteLibres(res.mapping, lignes, debut);
        // Sans ligne de titres, la colonne prise pour le nom de l'entreprise
        // n'est qu'une supposition statistique : elle doit concourir aussi,
        // sinon une colonne de communes reste etiquetee "entreprise".
        if (!res.avecEntete && res.mapping.societe !== undefined) {
          candidats = candidats.concat([res.mapping.societe]);
        }
        const col = await confirmerColonneVille(lignes, debut, candidats);
        if (col != null) res = lireProspects(lignes, null, { ville: col });
      }
      if (res.exportRadar) {
        afficherLimite("Ce fichier est déjà un résultat Radar (colonnes « angle » et « accroche » présentes). "
          + "Le repasser dans l'analyse ne t'apprendra rien de plus et consommera ton quota Google pour rien. "
          + "Tu peux quand même lancer l'analyse si tu veux rafraîchir les notes et les avis.", "warn");
      }
      if (!res.prospects.length) {
        const pourquoi = res.sansNom
          ? `Les ${res.sansNom} lignes lues n'ont aucun nom d'entreprise exploitable. Radar cherche des établissements : il lui faut une colonne société, entreprise, enseigne ou entité.`
          : "Aucun prospect exploitable trouvé dans ce fichier. Vérifie qu'il contient bien une colonne nom ou société.";
        afficherLimite(pourquoi);
        return;
      }
      prospectsCharges = res;
      prospectsCharges.nomFichier = file.name;
      rendreColonnes(res);
      $("nom-fichier").textContent = `${file.name} — ${res.prospects.length} prospects uniques détectés`;
      let info = res.avecEntete
        ? "Colonnes reconnues automatiquement."
        : "Ce fichier n'a pas de ligne de titres : les colonnes ont été reconnues d'après leur contenu.";
      if (res.sansNom) info += ` ${res.sansNom} ligne(s) écartée(s), sans nom d'entreprise.`;
      if (res.mapping.ville === undefined) {
        info += " ⚠ Aucune colonne ville trouvée : indique-la ci-dessous, la recherche sera bien plus précise.";
      }
      if (!res.exportRadar) afficherLimite(info, res.mapping.ville !== undefined ? "info" : "warn");
      $("btn-analyser").disabled = false;
    } catch (err) {
      afficherLimite("Fichier illisible : " + (err.message || err));
    }
  };
  reader.onerror = () => afficherLimite("Impossible de lire le fichier.");
  reader.readAsText(file, "utf-8");
}

// ---------------------------------------------------------------------------
// Listes enregistrees : une analyse deja payee ne doit jamais etre refaite
// ---------------------------------------------------------------------------
function rendreListes() {
  const bloc = $("bloc-listes");
  const zone = $("listes");
  const resumes = Listes.resumes();
  bloc.hidden = !resumes.length;
  if (!resumes.length) { zone.innerHTML = ""; return; }
  const ko = Listes.poidsKo();
  $("listes-poids").textContent = ko ? `${ko} Ko sur cet appareil` : "";
  zone.innerHTML = resumes.map((l) => `
    <div class="opt-row liste-ligne" data-id="${l.id}">
      <span class="txt">
        <span class="ot">${echapper(l.titre)}</span>
        <span class="od">${l.nombre} prospect(s) &middot; ${dateLisible(l.date)}</span>
      </span>
      <button class="head-btn liste-ouvrir" data-id="${l.id}">Ouvrir</button>
      <button class="head-btn liste-suppr" data-id="${l.id}" aria-label="Supprimer cette liste">✕</button>
    </div>`).join("");
}

function echapper(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("listes").addEventListener("click", (e) => {
  const ouvrir = e.target.closest(".liste-ouvrir");
  const suppr = e.target.closest(".liste-suppr");
  if (ouvrir) {
    const f = Listes.charger(ouvrir.getAttribute("data-id"));
    if (!f) { afficherLimite("Cette liste n'est plus lisible, elle a été supprimée.", "warn"); rendreListes(); return; }
    fiches = f;                       // aucun appel reseau : tout vient de l'appareil
    prospectsCharges = null;
    $("bilan-recherche").hidden = true;
    rendreDashboard();
    montrer("dashboard");
    return;
  }
  if (suppr) {
    Listes.supprimer(suppr.getAttribute("data-id"));
    rendreListes();
  }
});

// Enregistre le resultat qui vient d'etre produit, et le dit si ca a echoue.
function enregistrerListe(resultats, titre, origine) {
  const r = Listes.enregistrer(resultats, titre, origine);
  rendreListes();
  if (!r.ok) {
    afficherLimite("La liste n'a pas pu être enregistrée sur cet appareil (mémoire du navigateur pleine). "
      + "Exporte le CSV avant de fermer la page, sinon le résultat sera perdu.", "warn");
  }
}

function afficherLimite(texte, type) {
  const z = $("zone-limite");
  z.textContent = texte;
  z.classList.remove("hidden");
  // couleur : warn (ambre, defaut) ou info (neutre)
  z.style.background = type === "info" ? "#0e1626" : "#3a2a10";
  z.style.color = type === "info" ? "#8aa0c0" : "#ffc24b";
  z.style.borderColor = type === "info" ? "#22304a" : "#7a5a1f";
}

$("btn-analyser").addEventListener("click", lancerAnalyse);

async function lancerAnalyse() {
  if (enCours || !prospectsCharges) return;
  const cles = lireCles();
  if (!cles.google) { router(); return; }
  // Garde d'acces : licence payante, sinon 1 liste d'essai comptee cote serveur.
  const autorise = await autoriserAnalyse();
  if (!autorise) return;
  const opts = {
    avis: $("opt-avis").checked,
    position: $("opt-position").checked,
    ia: $("opt-ia").checked && !!cles.groq,
  };
  if ($("opt-ia").checked && !cles.groq) {
    afficherLimite("Accroche IA demandée mais aucune clé Groq : l'accroche sera générée par règles (toujours utile). Ajoute une clé Groq dans Réglages pour l'IA.", "warn");
  }

  enCours = true;
  $("btn-analyser").disabled = true;
  $("bilan-recherche").hidden = true;   // bilan propre au module Recherche
  $("zone-progress").classList.remove("hidden");
  const barre = $("prog-barre");
  const txt = $("prog-txt");
  const total = prospectsCharges.prospects.length;
  const out = [];

  // Quota Google : inutile de bruler toute la liste en erreur. Au 3e refus
  // d'affilee on s'arrete et on montre la raison exacte donnee par Google.
  let quotaSuite = 0;
  let arret = "";
  for (let i = 0; i < total; i++) {
    const p = prospectsCharges.prospects[i];
    txt.textContent = `Interrogation de Google... ${i + 1}/${total} — ${p.entite}`;
    const f = await enrichir(p, cles, opts);
    out.push(f);
    barre.style.width = Math.round(((i + 1) / total) * 100) + "%";
    if (f.codeErreur === 429 || f.codeErreur === 403) {
      quotaSuite++;
      if (quotaSuite >= 3) {
        arret = `Analyse arrêtée à la ligne ${i + 1} sur ${total}. Google refuse les appels : ${f.raisonErreur}`;
        break;
      }
    } else if (!f.erreur) {
      quotaSuite = 0;
    }
    await pause(120); // menage l'API, comme le script Python
  }
  if (arret) afficherLimite(arret, "warn");

  fiches = trierParPriorite(out);
  enCours = false;
  txt.textContent = "Terminé.";
  enregistrerListe(fiches, prospectsCharges.nomFichier || "Fichier importé", "import");
  if (!Licence.isLicensed()) await Trial.consume(); // consomme la liste gratuite (serveur)
  majBadgeLicence();
  bilanConsole(fiches);
  rendreDashboard();
  montrer("dashboard");
  // reset de la zone progress pour une prochaine liste
  barre.style.width = "0%";
  $("zone-progress").classList.add("hidden");
}

function pause(ms) { return new Promise((r) => setTimeout(r, ms)); }

function bilanConsole(fs) {
  const trouves = fs.filter((f) => f.trouve).length;
  const sansSite = fs.filter((f) => f.trouve && !f.site).length;
  const sansFiche = fs.filter((f) => !f.trouve).length;
  console.log(`Bilan : ${trouves}/${fs.length} fiches trouvées, ${sansFiche} sans fiche, ${sansSite} sans site.`);
}

// ---------------------------------------------------------------------------
// Nouvelle liste
// ---------------------------------------------------------------------------
$("btn-nouvelle").addEventListener("click", () => {
  prospectsCharges = null;
  fiches = null;
  $("nom-fichier").textContent = "";
  $("zone-limite").classList.add("hidden");
  $("btn-analyser").disabled = true;
  fileInput.value = "";
  montrer("import");
});

// ---------------------------------------------------------------------------
// Module Recherche de prospects (option payante independante)
// ---------------------------------------------------------------------------
$("btn-recherche").addEventListener("click", ouvrirRecherche);
$("btn-vers-recherche").addEventListener("click", ouvrirRecherche);
$("btn-recherche-retour").addEventListener("click", () => montrer("import"));
$("btn-rechercher").addEventListener("click", () => {
  // Filet de securite : toute erreur inattendue devient un message visible
  // (au lieu d'un "rien ne se passe" si un fichier est en cache incoherent).
  Promise.resolve().then(lancerRecherche).catch((e) => {
    rechercheEnCours = false;
    $("btn-rechercher").disabled = false;
    $("r-progress").classList.add("hidden");
    afficherLimiteR("Erreur inattendue : " + ((e && e.message) ? e.message : e) +
      ". Ferme et rouvre l'appli pour recharger la dernière version.", "warn");
  });
});

function ouvrirRecherche() {
  if (!aUneCleGoogle()) {          // la recherche a besoin de la cle Google
    $("btn-annuler-reglages").hidden = false;
    montrer("reglages");
    return;
  }
  majBadgeModule();
  majEtatVus();
  montrer("recherche");
}

// Compteur de la memoire des prospects deja sortis.
function majEtatVus() {
  const el = $("r-vus-etat");
  if (!el) return;
  const n = Vus.nombre();
  el.textContent = n
    ? `${n} prospect(s) déjà sortis lors de tes recherches précédentes : ils seront écartés.`
    : "Aucun prospect en mémoire pour l'instant.";
}

$("btn-vider-vus").addEventListener("click", () => {
  const n = Vus.nombre();
  if (!n) { afficherLimiteR("La mémoire est déjà vide.", "info"); return; }
  Vus.vider();
  majEtatVus();
  afficherLimiteR(`Mémoire vidée : ${n} prospect(s) oubliés. Ils pourront ressortir.`, "info");
});

// La ville n'a plus de sens quand on balaie la France entiere.
$("r-national").addEventListener("change", () => {
  const on = $("r-national").checked;
  $("r-ville").disabled = on;
  $("r-ville").placeholder = on
    ? "Balayage national : ce champ est ignoré"
    : "ex. Chalon-sur-Saône, Mâcon, Le Creusot...";
});

function afficherLimiteR(texte, type) {
  const z = $("r-limite");
  z.textContent = texte;
  z.classList.remove("hidden");
  z.style.background = type === "info" ? "#0e1626" : "#3a2a10";
  z.style.color = type === "info" ? "#8aa0c0" : "#ffc24b";
  z.style.borderColor = type === "info" ? "#22304a" : "#7a5a1f";
}

// Garde d'acces a une recherche : module debloque, sinon 1 recherche d'essai (serveur).
async function autoriserRecherche() {
  if (Recherche.isUnlocked()) return true;
  if (!TrialRecherche.hasEmail()) {
    await showStartGate();          // collecte l'e-mail partage
    if (Recherche.isUnlocked()) return true;
    if (!TrialRecherche.hasEmail()) return false;
  }
  await TrialRecherche.status();
  majBadgeModule();
  if (TrialRecherche.usesLeft === 0) { Recherche.openSheet(true); return false; }
  return true; // > 0, ou null (hors-ligne) = fail-open
}

async function lancerRecherche() {
  if (rechercheEnCours) return;
  const cles = lireCles();
  if (!cles.google) { montrer("reglages"); return; }
  const metier = $("r-metier").value.trim();
  const ville = $("r-ville").value.trim();
  const national = $("r-national").checked;
  if (national && !metier) {
    afficherLimiteR("Pour balayer toute la France, indique au moins un métier.", "warn"); return;
  }
  if (!national && !metier && !ville) {
    afficherLimiteR("Indique au moins un métier et une ville.", "warn"); return;
  }
  $("r-limite").classList.add("hidden");

  const autorise = await autoriserRecherche();
  if (!autorise) return;

  // Un departement tape dans le champ zone ("71", "Saône-et-Loire") ne peut pas
  // se traiter par une requete unique : Google plafonnerait a ~60 resultats pour
  // des centaines de communes. On balaie donc ses communes, les plus peuplees
  // d'abord. La liste vient de l'API de l'Etat, gratuite et hors quota Google.
  let zones = null, cleCurseur = "france", dep = null;
  if (!national) {
    dep = reconnaitreDepartement(ville);
    if (dep) {
      $("r-prog-txt").textContent = `Département ${dep.nom} reconnu, récupération de ses communes...`;
      $("r-progress").classList.remove("hidden");
      zones = await communesDuDepartement(dep.code);
      if (!zones) {
        $("r-progress").classList.add("hidden");
        afficherLimiteR(`Impossible de récupérer les communes de ${dep.nom} (service de l'État injoignable). `
          + "Réessaie, ou indique une ville précise.", "warn");
        return;
      }
      cleCurseur = "dep:" + dep.code;
    }
  }

  const filtres = {
    metier, ville, national, zones,
    exclureIds: $("r-exclure-vus").checked ? Vus.ensemble() : new Set(),
    departVille: Vus.curseur(cleCurseur),
    presenceWeb: $("r-presence").value,
    note: $("r-note").value,
    avis: $("r-avis").value,
    avecTel: $("r-avec-tel").checked,
    exclureFermes: $("r-exclure-fermes").checked,
    tri: $("r-tri").value,
    max: $("r-max").value,
  };
  rechercheEnCours = true;
  $("btn-rechercher").disabled = true;
  $("r-progress").classList.remove("hidden");
  const txt = $("r-prog-txt");
  const barre = $("r-prog-barre");
  txt.textContent = "Interrogation de Google Maps...";
  barre.style.width = "15%";

  let resultats, meta;
  try {
    const r = await rechercherProspects(filtres, cles.google, (n, zone) => {
      txt.textContent = zone && national
        ? `${n} prospect(s) trouvé(s)... (${zone})`
        : `${n} prospect(s) trouvé(s)...`;
      const cible = parseInt(filtres.max, 10) || 20;
      barre.style.width = Math.min(90, 15 + Math.round(75 * n / cible)) + "%";
    });
    resultats = r.fiches;
    meta = r.meta;
  } catch (e) {
    rechercheEnCours = false;
    $("btn-rechercher").disabled = false;
    $("r-progress").classList.add("hidden");
    barre.style.width = "0%";
    const msg = e.code ? `Google a répondu ${e.code} : ${raisonGoogle(e)}` : (e.message || String(e));
    afficherLimiteR("Échec de la recherche. " + msg, "warn");
    return;
  }

  barre.style.width = "100%";
  rechercheEnCours = false;
  $("btn-rechercher").disabled = false;
  $("r-progress").classList.add("hidden");
  barre.style.width = "0%";

  // Memoire : on retient ce qui vient de sortir, et ou le balayage s'est arrete.
  Vus.ajouter(resultats.map((f) => f.place_id).filter(Boolean));
  if (meta.balayage) Vus.poserCurseur(cleCurseur, meta.prochainDepart);
  majEtatVus();

  if (!resultats.length) {
    const pourquoi = meta.ignores
      ? `Aucun NOUVEAU prospect : les ${meta.ignores} trouvés étaient déjà sortis lors de tes recherches précédentes. `
        + "Décoche « ne pas ressortir les prospects déjà vus », ou vide la mémoire."
      : "Aucun prospect trouvé pour ces critères. Élargis la zone ou retire des filtres.";
    afficherLimiteR(pourquoi, "warn");
    return;
  }
  // La recherche a produit des resultats : on consomme l'essai (si pas de licence module).
  if (!Recherche.isUnlocked()) await TrialRecherche.consume();
  majBadgeModule();

  // Bilan honnete de ce qui a ete balaye, y compris ce qui a ete abandonne.
  const bilan = [];
  if (meta.balayage) bilan.push(`${meta.zonesBalayees} commune(s) balayée(s) sur ${meta.zonesTotal}`);
  if (meta.ignores) bilan.push(`${meta.ignores} prospect(s) écarté(s) car déjà sortis`);
  if (meta.plafondAtteint) {
    bilan.push(`arrêt à la limite de ${meta.appels} appels Google pour préserver ton quota : `
      + `${resultats.length} trouvés sur les ${meta.cible} demandés. Relance pour continuer le balayage`);
  }
  const zoneBilan = $("bilan-recherche");
  zoneBilan.textContent = bilan.length ? bilan.join(" — ") + "." : "";
  zoneBilan.hidden = !bilan.length;

  // Les resultats sont deja des fiches enrichies -> directement dans le tableau de bord.
  fiches = resultats;
  prospectsCharges = null;
  const titre = national
    ? `${metier || "recherche"} — toute la France`
    : dep ? `${metier || "recherche"} — ${dep.nom} (${dep.code})`
    : [metier, ville].filter(Boolean).join(" — ");
  enregistrerListe(fiches, titre, "recherche");
  bilanConsole(fiches);
  rendreDashboard();
  montrer("dashboard");
}

// Badge d'etat du module (essai / licence) sur l'ecran de recherche.
function majBadgeModule() {
  const b = $("mod-badge");
  if (!b) return;
  if (Recherche.isUnlocked()) {
    b.innerHTML = `&#10003; <b>Module Recherche</b> — débloqué à vie (${escTexte(Recherche.unlockedEmail() || "")}).`;
    return;
  }
  const left = TrialRecherche.usesLeft; // null = inconnu (hors-ligne)
  const dispo = left === 0
    ? `Essai terminé. Recherche illimitée avec le module à vie (${escTexte(Recherche.PRIX)}).`
    : `Version d'essai : <b>1 recherche gratuite</b>.`;
  b.innerHTML = `${dispo} <span class="lien" id="lien-module">J'ai une clé, l'activer</span>`;
  const l = $("lien-module");
  if (l) l.addEventListener("click", () => Recherche.openActivate());
}
window.addEventListener("radar-module-change", majBadgeModule);

// ---------------------------------------------------------------------------
// Tableau de bord (rendu identique au script Python)
// ---------------------------------------------------------------------------
const q = $("q");
const liste = $("liste");
const compte = $("compte");

$("btn-toggle-obj").addEventListener("click", () => $("obj").classList.toggle("on"));
$("btn-export").addEventListener("click", exporterCSV);
q.addEventListener("input", rendreDashboard);

function norm(s) { return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
function surligne(txt, mots) {
  let t = esc(txt);
  mots.forEach((m) => {
    if (m.length > 1) t = t.replace(new RegExp("(" + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi"), "<mark>$1</mark>");
  });
  return t;
}
function statut(f) {
  if (!f.trouve) return '<span class="statut non">&#10060; AUCUNE fiche Google</span>';
  if (f.confiance === "confirme") return '<span class="statut ok">&#9989; Fiche trouvée</span>';
  return '<span class="statut conf">&#9888; À confirmer</span>';
}
function couleurNote(n) {
  if (n === "") return "";
  n = parseFloat(n);
  if (n < 3.5) return "color:var(--red)";
  if (n < 4.2) return "color:var(--amber)";
  return "color:var(--green)";
}

function carte(f, mots) {
  const nom = surligne(f.entite, mots);
  const rechManuelle = "https://www.google.com/search?q=" + encodeURIComponent((f.entite + " " + (f.ville || "")).trim());
  let kpis = "";
  if (f.trouve) {
    kpis += `<div class="kpi">Note <b style="${couleurNote(f.note)}">${f.note || "?"}</b> &#11088;</div>`;
    kpis += `<div class="kpi">Avis <b>${f.avis !== "" ? f.avis : "?"}</b></div>`;
    kpis += `<div class="kpi">Site web <b style="${f.site ? "color:var(--green)" : "color:var(--red)"}">${f.site ? "OUI" : "NON"}</b></div>`;
    if (f.position_faite) {
      let pv, pc;
      if (f.position == null) { pv = "hors top 20"; pc = "color:var(--red)"; }
      else if (f.position <= 3) { pv = f.position + "e"; pc = "color:var(--green)"; }
      else if (f.position <= 10) { pv = f.position + "e"; pc = "color:var(--amber)"; }
      else { pv = f.position + "e"; pc = "color:var(--red)"; }
      kpis += `<div class="kpi" title="Position indicative pour &quot;${esc(f.position_req)}&quot;">Position Google <b style="${pc}">${pv}</b></div>`;
    }
  } else {
    kpis += `<div class="kpi" style="color:var(--red)"><b>Pas de fiche Google détectée</b></div>`;
  }
  let neg = "";
  if (f.avis_negatifs && f.avis_negatifs.length) {
    neg = '<div class="neg"><b style="font-size:13px;color:var(--red)">Avis négatifs :</b>' +
      f.avis_negatifs.map((a) => `<div class="a">${a.note}&#11088; ${esc(a.texte)}</div>`).join("") + "</div>";
  }
  let actions = "";
  if (f.trouve && f.google_url) actions += `<a class="btn b1" href="${esc(f.google_url)}" target="_blank" rel="noopener">Ouvrir la fiche Google</a>`;
  actions += `<a class="btn b2" href="${rechManuelle}" target="_blank" rel="noopener">Recherche Google manuelle</a>`;
  if (f.site) actions += `<a class="btn b2" href="${esc(f.site)}" target="_blank" rel="noopener">Son site</a>`;
  if (f.profil) actions += `<a class="btn b2" href="${esc(f.profil)}" target="_blank" rel="noopener">Sa fiche pro</a>`;

  // Rattachement geographique : utile quand le prospect est dans un village
  // dont personne ne situe le nom. Rien affiche s'il est deja dans la ville.
  const proche = texteProche(f);

  let accroche = "";
  if (f.accroche) {
    accroche = `<div class="accroche"><div class="acc-lab">&#128172; À dire au décrochage
        <button class="copier" data-txt="${esc(f.accroche)}">Copier</button></div>
      <div class="acc-txt">${esc(f.accroche)}</div></div>`;
  }
  return `<div class="fiche">
    <div class="haut"><div><p class="titre">${nom}</p><div class="ville">${esc(f.ville || "")} ${f.type ? ("&middot; " + esc(f.type)) : ""}${proche ? (" &middot; " + esc(proche)) : ""}</div></div>${statut(f)}</div>
    <div class="lignes">${kpis}</div>
    <div class="angle">&#127919; ${esc(f.angle)}</div>
    ${accroche}
    ${neg}
    <div class="actions">${actions}</div>
    <div class="meta">${f.tel ? ("&#128222; " + esc(f.tel)) : ""}${f.email ? ("&#9993; " + esc(f.email)) : ""}${f.adresse ? ("&#128205; " + esc(f.adresse)) : ""}</div>
  </div>`;
}

function rendreDashboard() {
  if (!fiches) return;
  const t = norm(q.value.trim());
  const mots = t.split(/\s+/).filter(Boolean);
  let res = fiches;
  if (t) {
    res = fiches.filter((f) =>
      norm(f.entite + " " + f.ville + " " + f.tel).includes(t) ||
      mots.every((m) => norm(f.entite + " " + f.ville).includes(m)));
  }
  compte.textContent = res.length + " / " + fiches.length + " prospects";
  if (!res.length) { liste.innerHTML = '<div class="vide">Aucun prospect ne correspond.</div>'; return; }
  liste.innerHTML = res.slice(0, 60).map((f) => carte(f, t ? mots : [])).join("");
}

// Copie (delegation d'evenement sur la liste).
liste.addEventListener("click", (e) => {
  const btn = e.target.closest(".copier");
  if (!btn) return;
  const t = btn.getAttribute("data-txt") || "";
  const done = () => { const o = btn.textContent; btn.textContent = "Copie !"; setTimeout(() => (btn.textContent = o), 1200); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopie(t, done));
  } else fallbackCopie(t, done);
});
function fallbackCopie(t, done) {
  const a = document.createElement("textarea");
  a.value = t; document.body.appendChild(a); a.select();
  try { document.execCommand("copy"); } catch (e) { /* ignore */ }
  a.remove(); done();
}

function exporterCSV() {
  if (!fiches) return;
  const blob = new Blob([fichesVersCSV(fiches)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "prospects_enrichis.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Licence + essai (serveur) : badge, garde, ecran e-mail, acces vendeur
// ---------------------------------------------------------------------------
function majBadgeLicence() {
  const b = $("lic-badge");
  if (!b) return;
  if (Licence.isLicensed()) {
    b.innerHTML = `&#10003; <b>Version complète</b> — débloquée à vie (${escTexte(Licence.licensedEmail() || "")}).`;
    return;
  }
  const left = Trial.usesLeft; // null = inconnu (hors-ligne) -> on n'affiche pas "termine"
  const dispo = left === 0
    ? `Essai terminé. Analyse illimitée avec la licence à vie (${escTexte(Licence.PRIX)}).`
    : `Version d'essai : <b>1 liste gratuite</b>.`;
  b.innerHTML = `${dispo} <span class="lien" id="lien-licence">J'ai une clé, l'activer</span>`;
  const l = $("lien-licence");
  if (l) l.addEventListener("click", () => Licence.openActivate());
}
function escTexte(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

// Garde d'acces a une analyse : licence, sinon 1 liste d'essai (compteur serveur).
async function autoriserAnalyse() {
  if (Licence.isLicensed()) return true;
  if (!Trial.hasEmail()) {
    await showStartGate();
    if (Licence.isLicensed()) return true;
    if (!Trial.hasEmail()) return false;
  }
  await Trial.status();
  majBadgeLicence();
  if (Trial.usesLeft === 0) { Licence.openSheet(true); return false; }
  return true; // > 0, ou null (hors-ligne) = fail-open
}

// Ecran e-mail au 1er lancement (parite avec Resolv). Non annulable, sauf "j'ai deja une cle".
// Renvoie une promesse resolue quand l'e-mail est saisi OU la licence activee.
function showStartGate() {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "rlic-back";
    back.innerHTML = `<div class="rlic-sheet">
      <h3>&#128225; Bienvenue sur Radar Google</h3>
      <p class="rlic-hint">Entre ton e-mail pour activer ta <b>liste d'essai gratuite</b>. Il sert juste à garder le compte de ton essai (jamais partagé, jamais de spam) et, plus tard, à retrouver ta licence.</p>
      <label class="rlic-field"><span class="lab">Ton e-mail</span>
        <input type="email" id="sg-email" placeholder="ton@email.fr" autocomplete="email" autocapitalize="off" spellcheck="false"></label>
      <div id="sg-status" class="rlic-status"></div>
      <div class="rlic-row">
        <button class="rlic-btn ghost" id="sg-licence">J'ai déjà une clé</button>
        <button class="rlic-btn primary" id="sg-ok">Continuer</button>
      </div>
      <div class="rlic-version" id="rlic-version">Radar Google v2</div>
    </div>`;
    document.body.appendChild(back);
    // acces vendeur depuis la version de cet ecran aussi
    Vendeur.bindLongPress(back.querySelector("#rlic-version"));

    const finir = () => { back.remove(); window.removeEventListener("radar-licence-change", onLic); resolve(); };
    const onLic = () => { if (Licence.isLicensed()) finir(); };
    window.addEventListener("radar-licence-change", onLic);

    back.querySelector("#sg-licence").addEventListener("click", () => Licence.openActivate());
    back.querySelector("#sg-ok").addEventListener("click", async () => {
      const e = back.querySelector("#sg-email").value.trim();
      const st = back.querySelector("#sg-status");
      if (!Trial.valid(e)) { st.textContent = "Entre un e-mail valide."; return; }
      Trial.setEmail(e);
      st.textContent = "Activation de l'essai…";
      await Trial.status();
      finir();
    });
  });
}

window.addEventListener("radar-licence-change", majBadgeLicence);
// acces au mode vendeur depuis la ligne de version (ecran Import + ecran Recherche)
Vendeur.bindLongPress($("rlic-version-footer"));
Vendeur.bindLongPress($("rlic-version-recherche"));

// ---------------------------------------------------------------------------
// Service worker + demarrage
// ---------------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  // Recharge une fois quand une nouvelle version prend la main (evite le code perime).
  let recharge = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!recharge) { recharge = true; location.reload(); }
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => reg.update()).catch(() => {});
  });
}
(async () => {
  // Les listes deja produites ne dependent ni de la licence ni du reseau :
  // on les affiche AVANT toute attente, sinon elles restent invisibles tant que
  // l'ecran d'e-mail du demarrage n'est pas passe.
  rendreListes();
  Trial.load();
  await Licence.init();
  await Recherche.init();
  // e-mail demande au demarrage (comme Resolv), sauf si deja licencie ou deja saisi
  if (!Licence.isLicensed() && !Trial.hasEmail()) await showStartGate();
  if (!Licence.isLicensed() && Trial.hasEmail()) await Trial.status();
  majBadgeLicence();
  router();
})();
