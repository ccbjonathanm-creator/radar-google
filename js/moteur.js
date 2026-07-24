/*
 * moteur.js — Enrichissement d'un prospect via Google Places + regles d'angle/accroche + Groq.
 * Portage fidele du script Python enrichir.py, cote navigateur (fetch, BYOK).
 */
import { sansAccents, normaliserTel } from "./csv.js";

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
  const req = fiche.position_req || "sa categorie";
  if (pos == null) {
    if (fiche.position_faite) return `Hors du top 20 pour "${req}" : quasi introuvable dans les recherches.`;
    return "";
  }
  if (pos <= 3) return `Deja dans le top 3 pour "${req}" : le proteger et gagner en avis/photos.`;
  if (pos <= 10) return `Position ${pos} pour "${req}" : proche du top 3, un vrai gain a aller chercher.`;
  return `Position ${pos} pour "${req}" : loin des 3 premiers qui captent les appels.`;
}

export function angleRegles(fiche) {
  if (!fiche.trouve) {
    return "INVISIBLE sur Google Maps. Ses clients ne le trouvent pas quand ils cherchent. " +
      "Argument : creer sa fiche = exister sur Google.";
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
    pts.push(`Note faible (${note}) : soigner l'e-reputation, repondre aux avis, faire remonter la note.`);
  }
  if (typeof avis === "number" && avis < 10) {
    pts.push(`Peu d'avis (${avis}) : peu de preuve sociale, facile a booster avec une strategie d'avis.`);
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
    return `Bonjour, ${appel} ? Je vous appelle parce qu'en cherchant votre activite sur Google Maps, ` +
      "je ne vous trouve pas du tout. Vos clients non plus. On peut regler ca ensemble en quelques jours.";
  }
  if (pos && pos > 3 && req) {
    return `Bonjour, ${appel} ? Quand je tape "${req}" sur Google, vous sortez en position ${pos}. ` +
      "Ce sont les 3 premiers qui recoivent les appels. J'appelle justement pour vous aider a remonter.";
  }
  if (!fiche.site) {
    return `Bonjour, ${appel} ? Je vois votre fiche Google mais aucun site web derriere. ` +
      "Les clients qui veulent verifier avant d'appeler vous zappent. C'est ce point que je viens vous proposer de corriger.";
  }
  const note = fiche.note;
  if (typeof note === "number" && note && note < 4.0) {
    return `Bonjour, ${appel} ? Je regarde votre fiche Google, votre note est a ${note}. ` +
      "Ca fait hesiter des clients avant meme de vous appeler. J'appelle pour vous aider a la faire remonter.";
  }
  return `Bonjour, ${appel} ? Votre presence Google est deja correcte, et c'est justement pour ca que je vous appelle : ` +
    "avec quelques reglages vous pouvez passer devant vos concurrents locaux.";
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
    contexte += ` Position dans les resultats pour "${fiche.position_req}": ${fiche.position}e.`;
  } else if (fiche.position_faite && fiche.trouve) {
    contexte += ` Position pour "${fiche.position_req}": hors du top 20.`;
  }
  if (fiche.avis_negatifs && fiche.avis_negatifs.length) {
    const extraits = fiche.avis_negatifs.slice(0, 3).map((a) => a.texte.slice(0, 160)).join(" | ");
    contexte += ` Avis negatifs recents: ${extraits}`;
  }
  const prompt = "Tu aides un commercial francais qui vend par telephone l'amelioration de la presence Google " +
    "(fiche, position, avis, site) a des professionnels. Redige la phrase d'ouverture qu'il lira " +
    "quand le prospect decroche : 2 phrases max, commence par 'Bonjour', naturelle, directe, " +
    "appuie-toi sur son point faible concret (position, avis, site manquant). " +
    "N'utilise AUCUN champ a remplir ni crochet type [nom] ou [votre nom] : le commercial se " +
    "presentera lui-meme, va droit au motif de l'appel apres 'Bonjour'. Tout en francais. " +
    "Reponds UNIQUEMENT par un JSON valide de la forme {\"accroche\": \"...\"}. " + contexte;
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
  let resultats;
  try {
    resultats = await placesRecherche(requete, cles.google);
  } catch (e) {
    if (e.code) fiche.angle = `[erreur API ${e.code}]`;
    else fiche.angle = `[erreur reseau : ${e.message}]`;
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
