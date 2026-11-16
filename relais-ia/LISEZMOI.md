# Relais IA de « Mon Système »

Ce petit serveur (un *Cloudflare Worker*) garde ta clé API Claude **en sécurité** :
la clé reste chez Cloudflare, elle n'est **jamais** dans l'app ni sur ton téléphone.
L'app lui envoie seulement le texte du plat ; il demande à Claude de le découper
en ingrédients et renvoie le résultat.

- Modèle : **Claude Haiku 5.5** (`claude-haiku-5-5`), le modèle Claude actuel le moins cher
  (0,10 $ par million de mots-jetons lus, 0,50 $ par million écrits).
- Coût : environ **0,001 $ par analyse**. Avec la limite de **30 analyses par jour**,
  le maximum possible est d'environ **1 $ par mois**.
- Protections : seule l'app (adresse `https://mikafeu.github.io`) est acceptée, il faut
  ton **code d'accès** secret, et le nombre d'analyses par jour est limité.

## Mise en place (une seule fois, environ 10 minutes, depuis un navigateur)

1. **Clé API Claude**
   - Va sur <https://console.anthropic.com>, crée un compte, ajoute quelques euros de crédit.
   - Menu **API Keys** → **Create Key** → copie la clé (elle commence par `sk-ant-`).
   - Conseil : dans **Limits**, mets une limite de dépense mensuelle (par exemple 5 $).

2. **Compte Cloudflare** (gratuit) : <https://dash.cloudflare.com/sign-up>

3. **Créer le relais depuis GitHub**
   - Dans Cloudflare : **Workers & Pages** → **Créer** → **Importer un dépôt** (Import a repository).
   - Connecte GitHub et choisis le dépôt **SOLO-LEVELING-REAL-LIFE**.
   - Nom du projet : `relais-ia-mon-systeme`
   - **Dossier racine (Root directory)** : `relais-ia`
   - Laisse la commande de déploiement par défaut (`npx wrangler deploy`) → **Déployer**.

4. **Ajouter les deux secrets**
   - Ouvre le Worker → **Paramètres** → **Variables et secrets** → **Ajouter**.
   - Type **Secret**, nom `ANTHROPIC_API_KEY`, valeur : ta clé `sk-ant-…`
   - Type **Secret**, nom `CODE_ACCES`, valeur : un mot de passe que tu inventes
     (au moins 16 caractères, par exemple `Monarque-des-Ombres-2027!`).
   - Enregistre (le Worker redémarre tout seul).

5. **Copier l'adresse du relais** : elle ressemble à
   `https://relais-ia-mon-systeme.TON-COMPTE.workers.dev`

6. **Dans l'app** : Réglages → **Analyse IA des plats** → colle l'adresse et ton code
   d'accès → **Tester**. C'est prêt.

## Changer la limite par jour

Dans le fichier `relais-ia/wrangler.toml`, ligne `MAX_PAR_JOUR = "30"`. Après la
modification, Cloudflare redéploie tout seul.

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/index.js` | Le relais : vérifications, compteur par jour, appel à Claude (SDK officiel `@anthropic-ai/sdk`) |
| `wrangler.toml` | Réglages Cloudflare (nom, limite par jour, compteur) |
| `package.json` | Dépendances (SDK Anthropic, outil de déploiement Wrangler) |
