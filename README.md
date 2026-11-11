# Mon Système

Application personnelle style "Système" (Solo Leveling) : niveau, rang E→S, 5 stats
v2.0 : interface « Système » (particules, verre dépoli, néon, entrées hologramme, sons et
vibrations), niveau lié au poids, quête quotidienne avec pénalité, bilan du jour qui fait
monter OU baisser les stats, stats en anneaux, LEVEL UP plein écran.
4 stats réalistes + Progression globale, jour 0 (1er décembre), notes et journées jugées,
scan corporel 3D sculpté (actuel → objectif, aperçu par rang E→S), repas et nutrition
(Ciqual + Open Food Facts) avec ambiances, graphique façon trading (jour/mois/année),
bilan mensuel, historique, sauvegarde JSON.
v2.4 : repas en langage naturel (« un grec frites et un coca »), choix en cases à toucher,
catalogue des protéines de marque (InShape, MyProtein, Prozis, Nutrimuscle…), aliments
inconnus classés d'un geste et retenus dans « Mes aliments ».

PWA en HTML/CSS/JavaScript simple, sans framework, installable sur iPhone
(Safari → Partager → « Sur l'écran d'accueil ») et utilisable hors connexion.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `style.css` | Apparence (couleurs en haut du fichier) |
| `app.js` | Toute la logique : règles des stats (`RULES`), activités par défaut, écrans |
| `holo.js` | Hologramme 3D du corps (three.js) : rotation, rayures, affinage vers l'objectif |
| `assets/corps.bin` | Modèle 3D du corps (format compact), ajusté aux photos |
| `tools/sculpter_corps.py` | Recrée `corps.bin` : proportions des photos (`ajuster_corps.py`), maillage affiné, puis sculptures MAINTENANT et OBJECTIF (`sculpture.py`) |
| `data/ciqual.json` | Table Ciqual 2020 (ANSES) : 3 092 aliments, valeurs pour 100 g |
| `vendor/three.module.min.js` | Moteur 3D three.js (licence MIT, `vendor/three-LICENSE.txt`) |
| `sw.js` | Service worker : hors connexion + mises à jour |
| `manifest.webmanifest`, `icons/` | Installation sur l'écran d'accueil |
| `tests/check-version.js` | Vérifie que la version est la même partout |

## Publier une mise à jour

1. Augmenter la version dans `app.js` (`APP_VERSION`), `sw.js` (`VERSION`)
   et `index.html` (les `?v=`).
2. `node tests/check-version.js`
3. Commit + push : l'iPhone récupère la nouvelle version à la prochaine ouverture
   (l'app se recharge toute seule une fois et affiche « Mise à jour installée »).

Synchronisation entre appareils (facultative) : Réglages → Synchronisation, avec un
jeton GitHub limité aux gists. La sauvegarde est rangée dans un gist secret
(« Mon Système — sauvegarde synchronisée ») et fusionnée à chaque ouverture et après
chaque changement (suppressions propagées, réglages les plus récents gagnants).
Les photos ne sont pas synchronisées.

Les données restent dans le téléphone (localStorage, clé `monSysteme.save` ;
photos dans IndexedDB, base `monSysteme`) et ne sont jamais envoyées sur Internet.
L'export JSON contient aussi les pesées et les photos.
