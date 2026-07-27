/*
 * villes.js — Zones balayees par la recherche "toute la France".
 *
 * Composition : les grandes agglomerations d'abord (le plus d'entreprises par
 * appel, donc le meilleur rendement), puis les 101 prefectures de departement,
 * ce qui garantit qu'aucun departement n'est laisse de cote, DOM compris.
 *
 * Google interroge "<metier> <ville>" : un nom de commune suffit, pas besoin du
 * departement. Les doublons sont retires au chargement.
 */

const BRUT = [
  // --- Grandes agglomerations ---
  "Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Montpellier",
  "Strasbourg", "Bordeaux", "Lille", "Rennes", "Reims", "Toulon", "Saint-Etienne",
  "Le Havre", "Dijon", "Grenoble", "Angers", "Villeurbanne", "Nimes",
  "Clermont-Ferrand", "Aix-en-Provence", "Le Mans", "Brest", "Tours", "Amiens",
  "Limoges", "Annecy", "Perpignan", "Boulogne-Billancourt", "Metz", "Besancon",
  "Orleans", "Rouen", "Mulhouse", "Caen", "Nancy", "Argenteuil", "Montreuil",
  "Roubaix", "Tourcoing", "Nanterre", "Avignon", "Creteil", "Dunkerque",
  "Poitiers", "Versailles", "Courbevoie", "Colombes", "Asnieres-sur-Seine",
  "Saint-Denis", "Aulnay-sous-Bois", "Rueil-Malmaison", "Pau", "Antibes",
  "Beziers", "La Rochelle", "Saint-Maur-des-Fosses", "Cannes", "Calais",
  "Merignac", "Drancy", "Saint-Nazaire", "Villeneuve-d'Ascq", "Levallois-Perret",
  "Noisy-le-Grand", "Neuilly-sur-Seine", "Antony", "La Seyne-sur-Mer", "Sarcelles",
  "Issy-les-Moulineaux", "Cholet", "Pessac", "Venissieux", "Chelles", "Pantin",
  "Frejus", "Arles", "Bayonne", "Sartrouville", "Narbonne", "Massy", "Meaux",
  "Brive-la-Gaillarde", "Saint-Malo", "Aubagne", "Salon-de-Provence", "Vincennes",
  "Ales", "Grasse", "Reze", "Roanne", "Cherbourg-en-Cotentin", "Lens", "Douai",
  "Valenciennes", "Bethune", "Boulogne-sur-Mer", "Compiegne", "Soissons",
  "Saint-Germain-en-Laye", "Montelimar", "Thionville", "Haguenau", "Saint-Louis",
  "Annemasse", "Chalon-sur-Saone", "Le Creusot", "Montlucon", "Vichy", "Dieppe",
  "Saint-Quentin", "Cambrai", "Maubeuge", "Sete", "Carpentras", "Manosque",
  "Istres", "Martigues", "Aubenas", "Romans-sur-Isere", "Bourgoin-Jallieu",
  "Villefranche-sur-Saone", "Oyonnax", "Dole", "Pontarlier", "Sens", "Nogent-sur-Marne",

  // --- Prefectures de departement (couverture complete du territoire) ---
  "Bourg-en-Bresse", "Laon", "Moulins", "Digne-les-Bains", "Gap", "Privas",
  "Charleville-Mezieres", "Foix", "Troyes", "Carcassonne", "Rodez", "Aurillac",
  "Angouleme", "Bourges", "Tulle", "Saint-Brieuc", "Gueret", "Perigueux",
  "Valence", "Evreux", "Chartres", "Quimper", "Ajaccio", "Bastia", "Auch",
  "Chateauroux", "Lons-le-Saunier", "Mont-de-Marsan", "Blois", "Le Puy-en-Velay",
  "Cahors", "Agen", "Mende", "Saint-Lo", "Chalons-en-Champagne", "Chaumont",
  "Laval", "Bar-le-Duc", "Vannes", "Nevers", "Beauvais", "Alencon", "Arras",
  "Tarbes", "Colmar", "Vesoul", "Macon", "Chambery", "Melun", "Niort", "Albi",
  "Montauban", "La Roche-sur-Yon", "Epinal", "Auxerre", "Belfort", "Evry",
  "Bobigny", "Pontoise", "Cergy",

  // --- Outre-mer ---
  "Basse-Terre", "Pointe-a-Pitre", "Fort-de-France", "Cayenne",
  "Saint-Denis La Reunion", "Saint-Pierre La Reunion", "Mamoudzou",
];

// Dedoublonnage en conservant l'ordre (les grandes villes restent en tete).
export const VILLES_FRANCE = BRUT.filter((v, i) => BRUT.indexOf(v) === i);
