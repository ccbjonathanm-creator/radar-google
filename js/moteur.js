/*
 * moteur.js — Enrichissement d'un prospect via Google Places + regles d'angle/accroche + Groq.
 * Portage fidele du script Python enrichir.py, cote navigateur (fetch, BYOK).
 */
import { sansAccents, normaliserTel } from "./csv.js";
import { VILLES_FRANCE } from "./villes.js";

// ---------------------------------------------------------------------------
// Google Places (New)
// ---------------------------------------------------------------------------

export async function placesRecherche(requete, cle) {
  const champs = "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber," +
    "places.websiteUri,places.rating,places.userRatingCount,places.primaryTypeDisplayName," +
    "places.googleMapsUri";
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": cle,
      "X-Goog-FieldMask": champs,
    },
    body: JSON.stringify({ textQuery: requete, languageCode: "fr", regionCode: "FR", maxResultCount: 3 }),
  });
  if (!r.ok) {
    const e = new Error("HTTP " + r.status);
    e.code = r.status;
    e.corps = await r.text().catch(() => "");
    throw e;
  }
  const data = await r.json();
  return data.places || [];
}

// Recherche paginee (module Recherche de prospects) : renvoie une page de lieux
// + le jeton de page suivant. Le field mask inclut nextPageToken (top-level).
export async function placesRecherchePage(requete, cle, pageToken) {
  const champs = "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber," +
    "places.websiteUri,places.rating,places.userRatingCount,places.primaryTypeDisplayName," +
    "places.googleMapsUri,places.businessStatus,nextPageToken";
  const body = { textQuery: requete, languageCode: "fr", regionCode: "FR", pageSize: 20 };
  if (pageToken) body.pageToken = pageToken;
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": cle, "X-Goog-FieldMask": champs },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = new Error("HTTP " + r.status);
    e.code = r.status;
    e.corps = await r.text().catch(() => "");
    throw e;
  }
  const data = await r.json();
  return { places: data.places || [], nextPageToken: data.nextPageToken || "" };
}

// Google renvoie toujours la raison exacte du refus dans le corps de la reponse.
// La cacher derriere un code nu ("erreur API 429") ne laisse aucune prise a
// l'utilisateur : on la remonte telle quelle.
export function raisonGoogle(e) {
  try {
    const j = JSON.parse(e.corps || "");
    const m = j && j.error && j.error.message;
    if (m) return String(m);
  } catch (x) { /* corps non JSON : on retombe sur le message generique */ }
  if (e.code === 429) return "Quota Google dépassé. Trop d'appels sur la période, ou crédit gratuit du mois épuisé.";
  if (e.code === 403) return "Clé refusée. Vérifie que « Places API (New) » est activée et que la facturation est liée au projet.";
  if (e.code === 400) return "Requête refusée par Google (clé ou paramètre incorrect).";
  return "Google n'a pas donné de raison.";
}

export async function placesAvis(placeId, cle) {
  const url = `https://places.googleapis.com/v1/places/${placeId}?languageCode=fr&regionCode=FR`;
  const r = await fetch(url, { method: "GET", headers: { "X-Goog-Api-Key": cle, "X-Goog-FieldMask": "reviews" } });
  if (!r.ok) return [];
  const data = await r.json();
  return data.reviews || [];
}

export async function placesClassement(requete, placeId, cle) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": cle,
      "X-Goog-FieldMask": "places.id",
    },
    body: JSON.stringify({ textQuery: requete, languageCode: "fr", regionCode: "FR", maxResultCount: 20 }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  const places = data.places || [];
  for (let i = 0; i < places.length; i++) {
    if (places[i].id === placeId) return i + 1;
  }
  return null;
}

export function choisirMatch(prospect, resultats) {
  if (!resultats || !resultats.length) return [null, "aucun"];
  const telP = prospect.tel_norm;
  // 1) match telephone (le plus fiable)
  if (telP) {
    for (const p of resultats) {
      const telG = normaliserTel(p.nationalPhoneNumber || "");
      if (telG && telG === telP) return [p, "confirme"];
    }
  }
  // 2) match par recoupement du nom
  const cible = sansAccents(prospect.entite);
  const motsCible = new Set(cible.replace(/-/g, " ").split(/\s+/).filter((m) => m.length > 2));
  for (const p of resultats) {
    const nomg = sansAccents((p.displayName && p.displayName.text) || "");
    const motsG = new Set(nomg.replace(/-/g, " ").split(/\s+/).filter((m) => m.length > 2));
    for (const m of motsCible) {
      if (motsG.has(m)) return [p, "probable"];
    }
  }
  return [null, "aucun"];
}

// ---------------------------------------------------------------------------
// Angle de vente (regles) + accroche
// ---------------------------------------------------------------------------

function textePosition(fiche) {
  const pos = fiche.position;
  const req = fiche.position_req || "sa catégorie";
  if (pos == null) {
    if (fiche.position_faite) return `Hors du top 20 pour "${req}" : quasi introuvable dans les recherches.`;
    return "";
  }
  if (pos <= 3) return `Déjà dans le top 3 pour "${req}" : le protéger et gagner en avis/photos.`;
  if (pos <= 10) return `Position ${pos} pour "${req}" : proche du top 3, un vrai gain à aller chercher.`;
  return `Position ${pos} pour "${req}" : loin des 3 premiers qui captent les appels.`;
}

export function angleRegles(fiche) {
  if (!fiche.trouve) {
    return "INVISIBLE sur Google Maps. Ses clients ne le trouvent pas quand ils cherchent. " +
      "Argument : créer sa fiche = exister sur Google.";
  }
  const pts = [];
  const tp = textePosition(fiche);
  if (tp) pts.push(tp);
  if (!fiche.site) {
    pts.push("Fiche Google mais AUCUN site web : capter les clients qui veulent en savoir plus (avis, horaires, contact).");
  }
  const note = fiche.note;
  const avis = fiche.avis;
  if (typeof note === "number" && note && note < 4.0) {
    pts.push(`Note faible (${note}) : soigner l'e-réputation, répondre aux avis, faire remonter la note.`);
  }
  if (typeof avis === "number" && avis < 10) {
    pts.push(`Peu d'avis (${avis}) : peu de preuve sociale, facile à booster avec une stratégie d'avis.`);
  }
  if (!pts.length) {
    pts.push(`Bonne fiche (${note}*, ${avis} avis) : proposer d'optimiser (photos, posts, SEO local) pour passer devant les concurrents.`);
  }
  return pts.join(" ");
}

export function accrocheRegles(fiche) {
  const nom = (fiche.entite || "").trim();
  const appel = nom ? nom : "vous";
  const pos = fiche.position;
  const req = fiche.position_req;
  if (!fiche.trouve) {
    return `Bonjour, ${appel} ? Je vous appelle parce qu'en cherchant votre activité sur Google Maps, ` +
      "je ne vous trouve pas du tout. Vos clients non plus. On peut régler ça ensemble en quelques jours.";
  }
  if (pos && pos > 3 && req) {
    return `Bonjour, ${appel} ? Quand je tape "${req}" sur Google, vous sortez en position ${pos}. ` +
      "Ce sont les 3 premiers qui reçoivent les appels. J'appelle justement pour vous aider à remonter.";
  }
  if (!fiche.site) {
    return `Bonjour, ${appel} ? Je vois votre fiche Google mais aucun site web derrière. ` +
      "Les clients qui veulent vérifier avant d'appeler vous zappent. C'est ce point que je viens vous proposer de corriger.";
  }
  const note = fiche.note;
  if (typeof note === "number" && note && note < 4.0) {
    return `Bonjour, ${appel} ? Je regarde votre fiche Google, votre note est à ${note}. ` +
      "Ça fait hésiter des clients avant même de vous appeler. J'appelle pour vous aider à la faire remonter.";
  }
  return `Bonjour, ${appel} ? Votre présence Google est déjà correcte, et c'est justement pour ça que je vous appelle : ` +
    "avec quelques réglages vous pouvez passer devant vos concurrents locaux.";
}

// ---------------------------------------------------------------------------
// Groq (accroche reformulee) — optionnel
// ---------------------------------------------------------------------------

export async function conseilIA(fiche, cle) {
  if (!cle) return null;
  let contexte = `Prospect: ${fiche.entite}, ville ${fiche.ville}. ` +
    `Fiche Google: ${fiche.trouve ? "oui" : "NON"}. ` +
    `Note: ${fiche.note}. Nombre d'avis: ${fiche.avis}. ` +
    `Site web: ${fiche.site ? "oui" : "NON"}.`;
  if (fiche.position) {
    contexte += ` Position dans les résultats pour "${fiche.position_req}": ${fiche.position}e.`;
  } else if (fiche.position_faite && fiche.trouve) {
    contexte += ` Position pour "${fiche.position_req}": hors du top 20.`;
  }
  if (fiche.avis_negatifs && fiche.avis_negatifs.length) {
    const extraits = fiche.avis_negatifs.slice(0, 3).map((a) => a.texte.slice(0, 160)).join(" | ");
    contexte += ` Avis négatifs récents: ${extraits}`;
  }
  const prompt = "Tu aides un commercial français qui vend par téléphone l'amélioration de la présence Google " +
    "(fiche, position, avis, site) à des professionnels. Rédige la phrase d'ouverture qu'il lira " +
    "quand le prospect décroche : 2 phrases max, commence par 'Bonjour', naturelle, directe, " +
    "appuie-toi sur son point faible concret (position, avis, site manquant). " +
    "N'utilise AUCUN champ à remplir ni crochet type [nom] ou [votre nom] : le commercial se " +
    "présentera lui-même, va droit au motif de l'appel après 'Bonjour'. Tout en français. " +
    "Réponds UNIQUEMENT par un JSON valide de la forme {\"accroche\": \"...\"}. " + contexte;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cle },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 200,
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const brut = (data.choices[0].message.content || "").trim();
    const obj = JSON.parse(brut);
    return { accroche: (obj.accroche || "").trim() };
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Enrichissement d'un prospect
// ---------------------------------------------------------------------------

export async function enrichir(prospect, cles, opts) {
  opts = opts || {};
  const entite = prospect.entite;
  const ville = prospect.ville;
  const requete = `${entite} ${ville}`.trim();
  const fiche = {
    ...prospect,
    trouve: false, confiance: "aucun", note: "", avis: "",
    site: "", google_url: "", adresse: "", type: "",
    avis_negatifs: [], angle: "", accroche: "",
    position: null, position_req: "", position_faite: false,
  };
  // Sans nom d'entreprise, la requete se reduirait a la ville : Google repondrait
  // sur la ville elle-meme et on conclurait a tort "invisible sur Google Maps".
  if (!entite) {
    fiche.erreur = true;
    fiche.codeErreur = 0;
    fiche.raisonErreur = "Ligne sans nom d'entreprise : rien à chercher.";
    fiche.angle = "[ligne ignorée] Aucun nom d'entreprise dans le fichier, impossible d'interroger Google.";
    return fiche;
  }
  let resultats;
  try {
    resultats = await placesRecherche(requete, cles.google);
  } catch (e) {
    fiche.codeErreur = e.code || 0;
    fiche.raisonErreur = raisonGoogle(e);
    if (e.code) fiche.angle = `[erreur API ${e.code}] ${fiche.raisonErreur}`;
    else fiche.angle = `[erreur réseau : ${e.message}]`;
    fiche.erreur = true;
    return fiche;
  }

  const [place, confiance] = choisirMatch(prospect, resultats);
  fiche.confiance = confiance;
  if (place) {
    fiche.trouve = true;
    fiche.note = place.rating != null ? place.rating : "";
    fiche.avis = place.userRatingCount != null ? place.userRatingCount : 0;
    fiche.site = place.websiteUri || "";
    fiche.google_url = place.googleMapsUri || "";
    fiche.adresse = place.formattedAddress || "";
    fiche.type = (place.primaryTypeDisplayName && place.primaryTypeDisplayName.text) || "";
    if (opts.avis && place.id) {
      try {
        const avis = await placesAvis(place.id, cles.google);
        for (const a of avis) {
          const noteA = a.rating != null ? a.rating : 5;
          if (noteA <= 3) {
            const txt = (a.text && a.text.text) || (a.originalText && a.originalText.text) || "";
            if (txt) fiche.avis_negatifs.push({ note: noteA, texte: txt.slice(0, 280) });
          }
        }
      } catch (e) { /* ignore */ }
    }
    if (opts.position && place.id && fiche.type && ville) {
      const reqPos = `${fiche.type} ${ville}`.trim();
      fiche.position_req = reqPos;
      fiche.position_faite = true;
      try {
        fiche.position = await placesClassement(reqPos, place.id, cles.google);
      } catch (e) {
        fiche.position_faite = false;
      }
    }
  }

  fiche.angle = angleRegles(fiche);
  fiche.accroche = accrocheRegles(fiche);
  if (opts.ia && cles.groq) {
    const ia = await conseilIA(fiche, cles.groq);
    if (ia && ia.accroche) fiche.accroche = ia.accroche;
  }
  return fiche;
}

// ---------------------------------------------------------------------------
// Module Recherche de prospects : construire des fiches par filtres Google
// ---------------------------------------------------------------------------

// Un lieu Google renvoye par la recherche EST deja une fiche enrichie : on le
// convertit directement au meme format que enrichir(), pret pour le tableau de bord.
export function placeVersFiche(place, ville) {
  const nom = (place.displayName && place.displayName.text) || "";
  const tel = place.nationalPhoneNumber || "";
  const fiche = {
    entite: nom, personne: "", societe: nom,
    place_id: place.id || "",     // sert a ne pas ressortir deux fois le meme pro
    tel, tel_norm: normaliserTel(tel),
    ville: ville || "", email: "", profil: "",
    trouve: true, confiance: "confirme",
    note: place.rating != null ? place.rating : "",
    avis: place.userRatingCount != null ? place.userRatingCount : 0,
    site: place.websiteUri || "",
    google_url: place.googleMapsUri || "",
    adresse: place.formattedAddress || "",
    type: (place.primaryTypeDisplayName && place.primaryTypeDisplayName.text) || "",
    avis_negatifs: [], position: null, position_req: "", position_faite: false,
    angle: "", accroche: "",
  };
  fiche.angle = angleRegles(fiche);
  fiche.accroche = accrocheRegles(fiche);
  return fiche;
}

// Construit le predicat de filtrage cote client a partir des criteres choisis.
// filtres : { presenceWeb, note, avis, avecTel, exclureFermes }.
function construirePredicat(f) {
  return (p) => {
    // Presence web
    if (f.presenceWeb === "sans" && p.websiteUri) return false;
    if (f.presenceWeb === "avec" && !p.websiteUri) return false;
    // Note Google (buckets)
    const r = p.rating != null ? p.rating : null;
    if (f.note === "sans" && r != null) return false;
    if (f.note === "faible" && !(r != null && r <= 3.5)) return false;
    if (f.note === "moyenne" && !(r != null && r > 3.5 && r < 4.3)) return false;
    if (f.note === "bonne" && !(r != null && r >= 4.3)) return false;
    // Nombre d'avis (buckets)
    const n = p.userRatingCount != null ? p.userRatingCount : 0;
    if (f.avis === "aucun" && n !== 0) return false;
    if (f.avis === "moins10" && !(n < 10)) return false;
    if (f.avis === "moins50" && !(n < 50)) return false;
    if (f.avis === "plus50" && !(n >= 50)) return false;
    // Joignable par telephone
    if (f.avecTel && !p.nationalPhoneNumber) return false;
    // Etablissement ferme (definitif ou temporaire)
    if (f.exclureFermes && p.businessStatus && p.businessStatus !== "OPERATIONAL") return false;
    return true;
  };
}

function valNote(f) { return typeof f.note === "number" ? f.note : -1; }
function valAvis(f) { return typeof f.avis === "number" ? f.avis : 0; }

// Applique le tri demande (defaut = priorite de vente).
function trierResultats(fiches, tri) {
  if (tri === "note_asc") return fiches.slice().sort((a, b) => valNote(a) - valNote(b));
  if (tri === "note_desc") return fiches.slice().sort((a, b) => valNote(b) - valNote(a));
  if (tri === "avis_asc") return fiches.slice().sort((a, b) => valAvis(a) - valAvis(b));
  if (tri === "avis_desc") return fiches.slice().sort((a, b) => valAvis(b) - valAvis(a));
  return trierParPriorite(fiches);
}

// Plafond dur d'appels Google pour une recherche. Sans lui, un metier rare
// combine a un filtre severe balaierait les 190 villes pour rien et viderait le
// quota. Ce qui a ete abandonne est remonte dans le bilan, jamais tu en silence.
const PLAFOND_APPELS = 80;

// Balaye UNE zone (jusqu'a 3 pages Google, soit ~60 lieux) et empile ce qui passe
// les filtres. Renvoie le nombre d'appels consommes.
async function balayerZone(ctx, ville) {
  const requete = `${ctx.metier} ${ville}`.trim();
  let token = "";
  let appels = 0;
  for (let page = 0; page < 3; page++) {
    if (ctx.appels + appels >= PLAFOND_APPELS) break;
    const { places, nextPageToken } = await placesRecherchePage(requete, ctx.cle, token);
    appels++;
    for (const p of places) {
      if (!p.id || ctx.dejaVus.has(p.id)) continue;
      ctx.dejaVus.add(p.id);              // evite aussi les doublons entre villes voisines
      if (ctx.exclus.has(p.id)) { ctx.ignores++; continue; }
      if (!ctx.passe(p)) continue;
      ctx.fiches.push(placeVersFiche(p, ville));
      if (ctx.fiches.length >= ctx.cible) break;
    }
    if (ctx.onProgress) ctx.onProgress(ctx.fiches.length, ville);
    if (ctx.fiches.length >= ctx.cible || !nextPageToken) break;
    token = nextPageToken;
    await new Promise((r) => setTimeout(r, 350)); // le jeton de page a besoin d'un court delai
  }
  return appels;
}

// Recherche de prospects par filtres.
// filtres = { metier, ville, national, exclureIds, presenceWeb, note, avis,
//             avecTel, exclureFermes, tri, max }.
// onProgress(nbTrouves, villeEnCours) est appele apres chaque page.
// Renvoie { fiches, meta } — meta sert a dire honnetement ce qui a ete balaye.
export async function rechercherProspects(filtres, cle, onProgress) {
  const metier = (filtres.metier || "").trim();
  const ville = (filtres.ville || "").trim();
  const national = !!filtres.national;
  if (!metier && !ville && !national) throw new Error("Indique au moins un métier ou une ville.");
  if (national && !metier) throw new Error("Pour balayer la France, indique au moins un métier.");
  const cible = Math.min(Math.max(parseInt(filtres.max, 10) || 20, 1), 200);

  const ctx = {
    metier, cle, cible, onProgress,
    passe: construirePredicat(filtres),
    exclus: filtres.exclureIds instanceof Set ? filtres.exclureIds : new Set(),
    dejaVus: new Set(),
    fiches: [],
    ignores: 0,        // deja sortis lors d'une recherche precedente
    appels: 0,
  };

  // Zones a balayer : une seule ville, ou la France entiere en repartant de la
  // ou la recherche precedente s'est arretee (curseur), pour explorer du neuf.
  let zones = [ville];
  let depart = 0;
  if (national) {
    const n = VILLES_FRANCE.length;
    depart = ((parseInt(filtres.departVille, 10) || 0) % n + n) % n;
    zones = VILLES_FRANCE.slice(depart).concat(VILLES_FRANCE.slice(0, depart));
  }

  let zonesBalayees = 0;
  for (const z of zones) {
    if (ctx.fiches.length >= ctx.cible || ctx.appels >= PLAFOND_APPELS) break;
    ctx.appels += await balayerZone(ctx, z);
    zonesBalayees++;
  }

  const meta = {
    national,
    zonesBalayees,
    zonesTotal: zones.length,
    appels: ctx.appels,
    ignores: ctx.ignores,
    cible,
    plafondAtteint: ctx.appels >= PLAFOND_APPELS && ctx.fiches.length < cible,
    // ou reprendre au prochain coup : juste apres la derniere ville balayee
    prochainDepart: national ? (depart + zonesBalayees) % VILLES_FRANCE.length : 0,
  };
  return { fiches: trierResultats(ctx.fiches, filtres.tri), meta };
}

// Tri : les plus "vendables" en haut.
export function trierParPriorite(fiches) {
  const priorite = (f) => {
    let s = 0;
    if (!f.trouve) s += 100;
    const pos = f.position;
    if (f.position_faite && pos == null) s += 60;
    else if (typeof pos === "number" && pos > 3) s += 30 + Math.min(pos, 20);
    if (f.trouve && !f.site) s += 50;
    const n = f.note;
    if (typeof n === "number" && n && n < 4) s += 20;
    return s;
  };
  return fiches.slice().sort((a, b) => priorite(b) - priorite(a));
}

// Export CSV (memes colonnes que le script Python).
export function fichesVersCSV(fiches) {
  const lignes = [[
    "entite","ville","tel","email","fiche_google","confiance","note","avis","position",
    "site_web","google_url","angle","accroche",
  ]];
  for (const x of fiches) {
    const pos = x.position ? x.position : (x.position_faite ? "hors top 20" : "");
    lignes.push([
      x.entite, x.ville, x.tel, x.email,
      x.trouve ? "oui" : "non", x.confiance, x.note, x.avis, pos,
      x.site, x.google_url, x.angle, x.accroche || "",
    ]);
  }
  const esc = (v) => {
    v = v == null ? "" : String(v);
    if (/[",\n;]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  };
  return "﻿" + lignes.map((l) => l.map(esc).join(",")).join("\r\n");
}
