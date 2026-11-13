/* =========================================================
   MON SYSTÈME — FICHIER DE RÉGLAGES
   Tout ce qui est ici peut être modifié sans toucher au reste :
   coefficients des exercices, seuils d'animation, pertes d'XP,
   paliers de surpassement, tableau des fast-foods.
   (Après une modification : changer la version dans sw.js.)
   ========================================================= */

/* ---------- Règle n° 1 : les rangs A et S restent très durs ----------
   - L'XP gagnée par jour avec les activités est plafonnée (un seul jour
     exceptionnel ne suffit pas).
   - Pour passer A ou S, il faut aussi de la régularité sur plusieurs
     semaines ET un vrai changement physique. */
const REGLAGES_RANGS = {
  xpMaxParJour: 600,            // XP positive maximum par jour (activités + exercices)
  A: { semaines: 12, joursParSemaine: 5, semainesSolides: 10, corps: 0.5, records: 3 },
  S: { semaines: 26, joursParSemaine: 5, semainesSolides: 22, corps: 0.9, records: 8 },
  // semaines : période regardée · semainesSolides : semaines avec au moins
  // joursParSemaine quêtes du jour accomplies · corps : part de l'objectif de
  // poids atteinte (0,5 = 50 %) · records : records d'exercice battus
};

/* ---------- Surpassement : paliers de lumière ----------
   avancement = moyenne de (fait ÷ objectif) des quêtes du jour
   surpassement = avancement − 100 % */
const REGLAGES_PALIERS = [
  { n: 0, nom: 'Début de journée', avancement: 0 },
  { n: 1, nom: 'En route', avancement: 0.5 },
  { n: 2, nom: 'Quêtes accomplies', avancement: 1 },
  { n: 3, nom: 'Surpassement +30 %', avancement: 1.3 },
  { n: 4, nom: 'Surpassement +90 %', avancement: 1.9 },
  { n: 5, nom: 'Surpassement +200 %', avancement: 3 },
  { n: 6, nom: 'ULTIME · +400 %', avancement: 5 },
];

/* ---------- Sport : exercices ----------
   type 'nombre' : répétitions × séries · type 'charge' : kilos × répétitions × séries
   coef : difficulté (×1 machine facile … ×5 muscle-up)
   Pour les charges, la difficulté dépend aussi de la charge ÷ ton poids de corps,
   comparée à « standard » (charge ÷ poids d'un pratiquant avancé).
   fort / legendaire : seuils d'animation (répétitions totales, ou kg pour les charges) */
const REGLAGES_EXERCICES = [
  { id: 'pompes', nom: 'Pompes', icone: '💪', type: 'nombre', coef: 1.5, fort: 150, legendaire: 500 },
  { id: 'squat-pdc', nom: 'Squats (poids du corps)', icone: '🦵', type: 'nombre', coef: 1.5, fort: 200, legendaire: 600 },
  { id: 'abdos', nom: 'Abdos / gainage (répétitions)', icone: '🔥', type: 'nombre', coef: 1, fort: 200, legendaire: 600 },
  { id: 'tractions', nom: 'Tractions', icone: '🧗', type: 'nombre', coef: 2.5, fort: 40, legendaire: 150 },
  { id: 'dips', nom: 'Dips', icone: '🤸', type: 'nombre', coef: 2.5, fort: 60, legendaire: 200 },
  { id: 'pompes-poirier', nom: 'Pompes en poirier', icone: '🙃', type: 'nombre', coef: 4, fort: 25, legendaire: 80 },
  { id: 'pompes-une-main', nom: 'Pompes à une main', icone: '☝️', type: 'nombre', coef: 4, fort: 25, legendaire: 80 },
  { id: 'muscle-up', nom: 'Muscle-up', icone: '⚡', type: 'nombre', coef: 5, fort: 15, legendaire: 100 },
  { id: 'machine', nom: 'Machine guidée', icone: '⚙️', type: 'charge', coef: 1, standard: 1, fort: 100, legendaire: 200 },
  { id: 'souleve-terre', nom: 'Soulevé de terre', icone: '🏋️', type: 'charge', coef: 2, standard: 2, fort: 150, legendaire: 200 },
  { id: 'squat-barre', nom: 'Squat (barre)', icone: '🏋️', type: 'charge', coef: 2, standard: 1.75, fort: 120, legendaire: 180 },
  { id: 'developpe-couche', nom: 'Développé couché', icone: '🏋️', type: 'charge', coef: 2, standard: 1.25, fort: 100, legendaire: 140 },
  { id: 'developpe-militaire', nom: 'Développé militaire', icone: '🏋️', type: 'charge', coef: 2, standard: 0.8, fort: 60, legendaire: 90 },
  { id: 'rowing', nom: 'Rowing barre', icone: '🏋️', type: 'charge', coef: 1.5, standard: 1, fort: 90, legendaire: 130 },
  { id: 'course', nom: 'Course / cardio (durée seulement)', icone: '🏃', type: 'duree', coef: 1, fort: 60, legendaire: 120 },
];
/* XP d'un exercice = base × coefficient × volume^puissance (rendement décroissant :
   les premières répétitions rapportent plus que la 300e) + XP de la durée de séance */
const REGLAGES_SPORT = { base: 7, puissance: 0.6, xpParMinute: 0.5, xpMaxExercice: 450 };

/* ---------- Ce que j'ai fait de mal ---------- */
const REGLAGES_MAL = {
  ecranHeureSoir: 20,          // à partir de 20 h, la perte d'XP des écrans est réduite
  ecranCoefSoir: 0.5,          // ×0,5 après 20 h (×1 avant)
  malbouffeKcalParXp: 12,      // 1 XP perdue pour 12 kcal de malbouffe
  sommeilHeures: 8,            // heure de coucher conseillée = lever − 8 h
  sommeilToleranceMin: 30,     // aucun malus jusqu'à 30 min de retard
  alcoolXpParVerre: 15,        // 1er verre : −15 XP, puis de plus en plus (+5 par verre)
  alcoolXpEnPlus: 5,
};

/* ---------- Malbouffe : enseignes, produits, extras ----------
   kcal = valeur pour le produit entier. src = d'où vient la valeur :
   - « mcdonalds.fr », « burgerking.fr », « PDF Quick » : infos nutritionnelles officielles (France)
   - « calculé » : déduit d'une valeur officielle (ex. menu − burger)
   - « estimation » : pas de valeur officielle trouvée
   Tu peux ajouter tes propres produits dans l'app (Ce que j'ai mal fait → Malbouffe). */
const MALBOUFFE_ENSEIGNES = [
  { id: 'mcdo', nom: 'McDonald\'s', couleur: '#ffc72c' },
  { id: 'bk', nom: 'Burger King', couleur: '#ff8732' },
  { id: 'quick', nom: 'Quick', couleur: '#e4002b' },
  { id: 'kfc', nom: 'KFC', couleur: '#e4002b' },
  { id: 'kebab', nom: 'Kebab / tacos', couleur: '#d98b3a' },
  { id: 'autre', nom: 'Autre', couleur: '#8f7bff' },
];
const MALBOUFFE_PRODUITS = [
  // McDonald's France — fiches produit mcdonalds.fr (kcal par produit)
  { e: 'mcdo', nom: 'Big Mac', kcal: 530, dessin: 'burger', src: 'mcdonalds.fr' },
  { e: 'mcdo', nom: 'CBO', kcal: 659, dessin: 'burger', src: 'mcdonalds.fr' },
  { e: 'mcdo', nom: 'Big Tasty (1 steak)', kcal: 706, dessin: 'burger', src: 'mcdonalds.fr' },
  { e: 'mcdo', nom: 'Big Tasty (2 steaks)', kcal: 961, dessin: 'burger', src: 'mcdonalds.fr' },
  { e: 'mcdo', nom: 'McChicken', kcal: 434, dessin: 'burger', src: 'mcdonalds.fr' },
  { e: 'mcdo', nom: 'Cheeseburger', kcal: 300, dessin: 'burger', src: 'mcdonalds.fr' },
  { e: 'mcdo', nom: 'Chicken McNuggets ×4', kcal: 174, dessin: 'nuggets', src: 'mcdonalds.fr' },
  { e: 'mcdo', nom: 'Chicken McNuggets ×6', kcal: 262, dessin: 'nuggets', src: 'calculé (boîte de 20 = 872 kcal)' },
  { e: 'mcdo', nom: 'Chicken McNuggets ×20', kcal: 872, dessin: 'nuggets', src: 'mcdonalds.fr' },
  { e: 'mcdo', nom: 'Hamburger', kcal: 255, dessin: 'burger', src: 'estimation' },
  { e: 'mcdo', nom: 'Filet-O-Fish', kcal: 330, dessin: 'burger', src: 'estimation' },
  // Burger King France — burgerking.fr
  { e: 'bk', nom: 'Whopper', kcal: 629, dessin: 'burger', src: 'burgerking.fr' },
  { e: 'bk', nom: 'Veggie Whopper', kcal: 595, dessin: 'burger', src: 'burgerking.fr' },
  { e: 'bk', nom: 'Double Whopper Cheese', kcal: 934, dessin: 'burger', src: 'calculé (menu burgerking.fr 1 244 kcal − frites − Coca zéro)' },
  { e: 'bk', nom: 'Double Steakhouse', kcal: 1134, dessin: 'burger', src: 'burgerking.fr' },
  { e: 'bk', nom: 'Cheeseburger', kcal: 305, dessin: 'burger', src: 'estimation' },
  { e: 'bk', nom: 'Chicken (tenders / nuggets ×6)', kcal: 280, dessin: 'nuggets', src: 'estimation' },
  // Quick France — PDF nutritionnel officiel (assets.quick.fr)
  { e: 'quick', nom: 'Giant', kcal: 547, dessin: 'burger', src: 'PDF Quick' },
  { e: 'quick', nom: 'Long Bacon', kcal: 573, dessin: 'burger', src: 'PDF Quick' },
  { e: 'quick', nom: 'Suprême Bacon', kcal: 958, dessin: 'burger', src: 'PDF Quick' },
  { e: 'quick', nom: 'Cheeseburger', kcal: 300, dessin: 'burger', src: 'estimation' },
  // KFC France — aucune valeur officielle vérifiée : estimations
  { e: 'kfc', nom: 'Tenders ×3', kcal: 440, dessin: 'nuggets', src: 'estimation' },
  { e: 'kfc', nom: 'Tenders ×5', kcal: 730, dessin: 'nuggets', src: 'estimation' },
  { e: 'kfc', nom: 'Boxmaster Original', kcal: 686, dessin: 'wrap', src: 'estimation' },
  { e: 'kfc', nom: 'Tower (Cheese & Bacon)', kcal: 706, dessin: 'burger', src: 'estimation' },
  { e: 'kfc', nom: 'Bucket (6 pièces de poulet)', kcal: 1500, dessin: 'nuggets', src: 'estimation' },
  // Kebab / tacos — moyennes (table Ciqual de l'ANSES × portion habituelle)
  { e: 'kebab', nom: 'Sandwich kebab / grec', kcal: 815, dessin: 'kebab', src: 'estimation (Ciqual, 350 g)' },
  { e: 'kebab', nom: 'Assiette kebab frites', kcal: 1100, dessin: 'kebab', src: 'estimation' },
  { e: 'kebab', nom: 'French tacos (1 viande)', kcal: 1050, dessin: 'wrap', src: 'estimation (430 g)' },
  { e: 'kebab', nom: 'French tacos XL (2-3 viandes)', kcal: 1600, dessin: 'wrap', src: 'estimation' },
  // Autre
  { e: 'autre', nom: 'Burger (moyenne)', kcal: 550, dessin: 'burger', src: 'estimation' },
  { e: 'autre', nom: 'Pizza entière', kcal: 1000, dessin: 'pizza', src: 'estimation' },
  { e: 'autre', nom: 'Part de pizza', kcal: 280, dessin: 'pizza', src: 'estimation' },
  { e: 'autre', nom: 'Sandwich / panini', kcal: 550, dessin: 'wrap', src: 'estimation' },
];
/* Extras : frites, boisson, sauce… avec leur taille */
const MALBOUFFE_EXTRAS = [
  { id: 'frites', nom: 'Frites', dessin: 'frites', tailles: [
    { t: 'Petite', kcal: 230, src: 'estimation' },
    { t: 'Moyenne', kcal: 328, src: 'mcdonalds.fr (BK ≈ 309 calculé)' },
    { t: 'Grande', kcal: 434, src: 'mcdonalds.fr' } ] },
  { id: 'soda', nom: 'Coca / soda', dessin: 'boisson', tailles: [
    { t: '25 cl', kcal: 105, src: 'étiquette Coca-Cola : 42 kcal / 100 ml' },
    { t: '40 cl', kcal: 168, src: 'étiquette Coca-Cola : 42 kcal / 100 ml' },
    { t: '50 cl', kcal: 210, src: 'étiquette Coca-Cola : 42 kcal / 100 ml' } ] },
  { id: 'zero', nom: 'Coca zéro / eau', dessin: 'boisson', tailles: [{ t: 'Toutes', kcal: 1, src: 'étiquette' }] },
  { id: 'sauce', nom: 'Sauce (sachet)', dessin: 'sauce', tailles: [
    { t: '1 sachet', kcal: 100, src: 'estimation' }, { t: '2 sachets', kcal: 200, src: 'estimation' } ] },
  { id: 'dessert', nom: 'Dessert glacé (McFlurry, sundae…)', dessin: 'dessert', tailles: [
    { t: 'Normal', kcal: 300, src: 'estimation' } ] },
];
