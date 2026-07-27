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
  "Strasbourg", "Bordeaux", "Lille", "Rennes", "Reims", "Toulon", "Saint-Étienne",
  "Le Havre", "Dijon", "Grenoble", "Angers", "Villeurbanne", "Nîmes",
  "Clermont-Ferrand", "Aix-en-Provence", "Le Mans", "Brest", "Tours", "Amiens",
  "Limoges", "Annecy", "Perpignan", "Boulogne-Billancourt", "Metz", "Besançon",
  "Orléans", "Rouen", "Mulhouse", "Caen", "Nancy", "Argenteuil", "Montreuil",
  "Roubaix", "Tourcoing", "Nanterre", "Avignon", "Créteil", "Dunkerque",
  "Poitiers", "Versailles", "Courbevoie", "Colombes", "Asnières-sur-Seine",
  "Saint-Denis", "Aulnay-sous-Bois", "Rueil-Malmaison", "Pau", "Antibes",
  "Béziers", "La Rochelle", "Saint-Maur-des-Fossés", "Cannes", "Calais",
  "Mérignac", "Drancy", "Saint-Nazaire", "Villeneuve-d'Ascq", "Levallois-Perret",
  "Noisy-le-Grand", "Neuilly-sur-Seine", "Antony", "La Seyne-sur-Mer", "Sarcelles",
  "Issy-les-Moulineaux", "Cholet", "Pessac", "Vénissieux", "Chelles", "Pantin",
  "Fréjus", "Arles", "Bayonne", "Sartrouville", "Narbonne", "Massy", "Meaux",
  "Brive-la-Gaillarde", "Saint-Malo", "Aubagne", "Salon-de-Provence", "Vincennes",
  "Alès", "Grasse", "Rezé", "Roanne", "Cherbourg-en-Cotentin", "Lens", "Douai",
  "Valenciennes", "Béthune", "Boulogne-sur-Mer", "Compiègne", "Soissons",
  "Saint-Germain-en-Laye", "Montélimar", "Thionville", "Haguenau", "Saint-Louis",
  "Annemasse", "Chalon-sur-Saône", "Le Creusot", "Montluçon", "Vichy", "Dieppe",
  "Saint-Quentin", "Cambrai", "Maubeuge", "Sète", "Carpentras", "Manosque",
  "Istres", "Martigues", "Aubenas", "Romans-sur-Isère", "Bourgoin-Jallieu",
  "Villefranche-sur-Saône", "Oyonnax", "Dole", "Pontarlier", "Sens", "Nogent-sur-Marne",

  // --- Prefectures de departement (couverture complete du territoire) ---
  "Bourg-en-Bresse", "Laon", "Moulins", "Digne-les-Bains", "Gap", "Privas",
  "Charleville-Mézières", "Foix", "Troyes", "Carcassonne", "Rodez", "Aurillac",
  "Angoulême", "Bourges", "Tulle", "Saint-Brieuc", "Guéret", "Périgueux",
  "Valence", "Évreux", "Chartres", "Quimper", "Ajaccio", "Bastia", "Auch",
  "Châteauroux", "Lons-le-Saunier", "Mont-de-Marsan", "Blois", "Le Puy-en-Velay",
  "Cahors", "Agen", "Mende", "Saint-Lô", "Châlons-en-Champagne", "Chaumont",
  "Laval", "Bar-le-Duc", "Vannes", "Nevers", "Beauvais", "Alençon", "Arras",
  "Tarbes", "Colmar", "Vesoul", "Mâcon", "Chambéry", "Melun", "Niort", "Albi",
  "Montauban", "La Roche-sur-Yon", "Épinal", "Auxerre", "Belfort", "Évry",
  "Bobigny", "Pontoise", "Cergy",

  // --- Outre-mer ---
  "Basse-Terre", "Pointe-à-Pitre", "Fort-de-France", "Cayenne",
  "Saint-Denis La Réunion", "Saint-Pierre La Réunion", "Mamoudzou",
];

// Dedoublonnage en conservant l'ordre (les grandes villes restent en tete).
export const VILLES_FRANCE = BRUT.filter((v, i) => BRUT.indexOf(v) === i);
