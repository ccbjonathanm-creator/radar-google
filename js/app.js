/*
 * app.js — Orchestration de l'interface Radar Google (PWA).
 * Navigation entre Reglages / Import / Tableau de bord, enrichissement avec progression.
 */
import { parseCSV, lireProspects } from "./csv.js";
import { enrichir, trierParPriorite, fichesVersCSV, placesRecherche } from "./moteur.js";
import { Licence } from "./licence.js";
import { Vendeur } from "./vendeur.js";

const LS_GOOGLE = "radar_cle_google";
const LS_GROQ = "radar_cle_groq";

const $ = (id) => document.getElementById(id);
const vues = {
  reglages: $("vue-reglages"),
  import: $("vue-import"),
  dashboard: $("vue-dashboard"),
};

let prospectsCharges = null;   // { prospects, mapping, entetes }
let fiches = null;             // resultats enrichis
let enCours = false;

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
    msg.textContent = "La cle Google Places est obligatoire.";
    return;
  }
  $("btn-tester").disabled = true;
  msg.className = "msg-test";
  msg.textContent = "Test de la cle Google en cours...";
  try {
    await placesRecherche("plombier Paris", google);
    localStorage.setItem(LS_GOOGLE, google);
    localStorage.setItem(LS_GROQ, groq);
    msg.className = "msg-test ok";
    msg.textContent = "Cle valide, enregistree. ✅";
    setTimeout(router, 700);
  } catch (e) {
    msg.className = "msg-test ko";
    if (e.code === 403) msg.textContent = "Cle refusee (403). Verifie que \"Places API (New)\" est activee et que la cle n'a pas de restriction bloquante.";
    else if (e.code === 400) msg.textContent = "Requete refusee (400). La cle semble incorrecte.";
    else msg.textContent = "Echec du test : " + (e.message || e) + ". Cle non enregistree.";
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

function chargerFichier(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const lignes = parseCSV(String(reader.result));
      const res = lireProspects(lignes);
      if (!res.prospects.length) {
        afficherLimite("Aucun prospect exploitable trouve dans ce fichier. Verifie qu'il contient bien une colonne nom/societe et telephone.");
        return;
      }
      prospectsCharges = res;
      $("nom-fichier").textContent = `${file.name} — ${res.prospects.length} prospects uniques detectes`;
      const cols = Object.entries(res.mapping).map(([k, v]) => `${k}→${res.entetes[v]}`).join(", ");
      afficherLimite("Colonnes detectees : " + (cols || "aucune (verifie le format du CSV)"), cols ? "info" : "warn");
      $("btn-analyser").disabled = false;
    } catch (err) {
      afficherLimite("Fichier illisible : " + (err.message || err));
    }
  };
  reader.onerror = () => afficherLimite("Impossible de lire le fichier.");
  reader.readAsText(file, "utf-8");
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
  // Garde licence : 1 liste gratuite, puis mur payant.
  if (!Licence.guard()) return;
  const opts = {
    avis: $("opt-avis").checked,
    position: $("opt-position").checked,
    ia: $("opt-ia").checked && !!cles.groq,
  };
  if ($("opt-ia").checked && !cles.groq) {
    afficherLimite("Accroche IA demandee mais aucune cle Groq : l'accroche sera generee par regles (toujours utile). Ajoute une cle Groq dans Reglages pour l'IA.", "warn");
  }

  enCours = true;
  $("btn-analyser").disabled = true;
  $("zone-progress").classList.remove("hidden");
  const barre = $("prog-barre");
  const txt = $("prog-txt");
  const total = prospectsCharges.prospects.length;
  const out = [];

  for (let i = 0; i < total; i++) {
    const p = prospectsCharges.prospects[i];
    txt.textContent = `Interrogation de Google... ${i + 1}/${total} — ${p.entite}`;
    const f = await enrichir(p, cles, opts);
    out.push(f);
    barre.style.width = Math.round(((i + 1) / total) * 100) + "%";
    await pause(120); // menage l'API, comme le script Python
  }

  fiches = trierParPriorite(out);
  enCours = false;
  txt.textContent = "Termine.";
  Licence.consommerListe(); // 1 liste gratuite consommee (sans effet si deja licencie)
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
  console.log(`Bilan : ${trouves}/${fs.length} fiches trouvees, ${sansFiche} sans fiche, ${sansSite} sans site.`);
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
  if (f.confiance === "confirme") return '<span class="statut ok">&#9989; Fiche trouvee</span>';
  return '<span class="statut conf">&#9888; A confirmer</span>';
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
    kpis += `<div class="kpi" style="color:var(--red)"><b>Pas de fiche Google detectee</b></div>`;
  }
  let neg = "";
  if (f.avis_negatifs && f.avis_negatifs.length) {
    neg = '<div class="neg"><b style="font-size:13px;color:var(--red)">Avis negatifs :</b>' +
      f.avis_negatifs.map((a) => `<div class="a">${a.note}&#11088; ${esc(a.texte)}</div>`).join("") + "</div>";
  }
  let actions = "";
  if (f.trouve && f.google_url) actions += `<a class="btn b1" href="${esc(f.google_url)}" target="_blank" rel="noopener">Ouvrir la fiche Google</a>`;
  actions += `<a class="btn b2" href="${rechManuelle}" target="_blank" rel="noopener">Recherche Google manuelle</a>`;
  if (f.site) actions += `<a class="btn b2" href="${esc(f.site)}" target="_blank" rel="noopener">Son site</a>`;
  if (f.profil) actions += `<a class="btn b2" href="${esc(f.profil)}" target="_blank" rel="noopener">Sa fiche pro</a>`;

  let accroche = "";
  if (f.accroche) {
    accroche = `<div class="accroche"><div class="acc-lab">&#128172; A dire au decrochage
        <button class="copier" data-txt="${esc(f.accroche)}">Copier</button></div>
      <div class="acc-txt">${esc(f.accroche)}</div></div>`;
  }
  return `<div class="fiche">
    <div class="haut"><div><p class="titre">${nom}</p><div class="ville">${esc(f.ville || "")} ${f.type ? ("&middot; " + esc(f.type)) : ""}</div></div>${statut(f)}</div>
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
// Licence : badge d'etat + acces vendeur
// ---------------------------------------------------------------------------
function majBadgeLicence() {
  const b = $("lic-badge");
  if (!b) return;
  if (Licence.isLicensed()) {
    b.innerHTML = `&#10003; <b>Version complete</b> — debloquee a vie (${escTexte(Licence.licensedEmail() || "")}).`;
  } else {
    const reste = Licence.listesGratuitesRestantes();
    const dispo = reste > 0
      ? `Version d'essai : <b>1 liste gratuite</b> disponible.`
      : `Essai termine. Analyse illimitee avec la licence a vie (${escTexte(Licence.PRIX)}).`;
    b.innerHTML = `${dispo} <span class="lien" id="lien-licence">J'ai une cle, l'activer</span>`;
    const l = $("lien-licence");
    if (l) l.addEventListener("click", () => Licence.openActivate());
  }
}
function escTexte(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

window.addEventListener("radar-licence-change", majBadgeLicence);
// acces au mode vendeur depuis la ligne de version en bas de l'ecran Import
Vendeur.bindLongPress($("rlic-version-footer"));

// ---------------------------------------------------------------------------
// Service worker + demarrage
// ---------------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
Licence.init().then(() => { majBadgeLicence(); router(); });
