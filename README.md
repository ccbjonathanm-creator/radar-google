# Radar Google (PWA)

Version PWA installable de l'outil de phoning Radar Google (avant : script Python `enrichir.py` + `.bat`).
Analyse la presence Google de prospects (fiche, note, avis, position indicative, site web) et prepare
les appels : angle de vente + accroche a lire, tableau de bord a recherche instantanee.

100 % navigateur, aucun serveur. Installable sur PC et mobile. Fonctionne hors-ligne (sauf les appels
Google/Groq, qui ont besoin d'internet).

## Modele de cles (BYOK)

Chaque utilisateur colle SES propres cles dans l'ecran Reglages ; elles restent sur l'appareil
(`localStorage`), rien n'est envoye ailleurs.

- **Google Places (New)** : obligatoire. A creer sur Google Cloud Console, API "Places API (New)".
- **Groq** : optionnelle (accroche reformulee par l'IA). Gratuite sur console.groq.com/keys.

Sans cle Groq, l'accroche est generee par regles (toujours utile).

## Structure

- `index.html` — l'app (3 ecrans : Reglages / Import / Tableau de bord).
- `css/style.css` — theme HUD cyan.
- `js/csv.js` — lecture CSV + detection auto des colonnes + dedoublonnage (portage du Python).
- `js/moteur.js` — Google Places, match tel/nom, angle + accroche par regles, Groq.
- `js/app.js` — orchestration UI, progression, rendu du tableau de bord.
- `manifest.webmanifest`, `sw.js`, `install-pwa.js`, `icons/` — coquille PWA.
- `make_icons.py` — genere les icones (outil de dev, ne pas deployer).

## Deploiement (GitHub Pages)

Copier tout SAUF `make_icons.py` et `README.md` dans le dossier du repo GitHub Pages, commit + push.
Necessite HTTPS pour l'installation (un `file://` ne s'installe pas).

## Fidelite au script Python

Le moteur reprend fidelement `enrichir.py` : memes mots-cles de detection de colonnes, meme
normalisation des telephones (France +33 -> 0, 9 derniers chiffres), meme logique de match
(telephone d'abord, puis recoupement du nom), memes regles d'angle/accroche, meme prompt Groq,
meme tri par priorite (les plus "vendables" en haut), meme export CSV.
