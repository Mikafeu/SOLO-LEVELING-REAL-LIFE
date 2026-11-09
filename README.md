# Mon Système

Application personnelle style "Système" (Solo Leveling) : niveau, rang E→S, 5 stats
réalistes, série de jours actifs, quêtes du jour, historique, sauvegarde JSON.

PWA en HTML/CSS/JavaScript simple, sans framework, installable sur iPhone
(Safari → Partager → « Sur l'écran d'accueil ») et utilisable hors connexion.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `style.css` | Apparence (couleurs en haut du fichier) |
| `app.js` | Toute la logique : règles des stats (`RULES`), activités par défaut, écrans |
| `sw.js` | Service worker : hors connexion + mises à jour |
| `manifest.webmanifest`, `icons/` | Installation sur l'écran d'accueil |
| `tests/check-version.js` | Vérifie que la version est la même partout |

## Publier une mise à jour

1. Augmenter la version dans `app.js` (`APP_VERSION`), `sw.js` (`VERSION`)
   et `index.html` (les deux `?v=`).
2. `node tests/check-version.js`
3. Commit + push : l'iPhone récupère la nouvelle version à la prochaine ouverture
   (l'app se recharge toute seule une fois et affiche « Mise à jour installée »).

Les données restent dans le téléphone (localStorage, clé `monSysteme.save`)
et ne sont jamais envoyées sur Internet.
