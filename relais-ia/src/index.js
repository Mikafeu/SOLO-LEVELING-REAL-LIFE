/* =========================================================
   Relais IA de « Mon Système » (Cloudflare Worker)
   - Garde la clé API Claude (secret ANTHROPIC_API_KEY) : elle n'est
     jamais envoyée au téléphone.
   - N'accepte que l'app (origine autorisée + code d'accès secret).
   - Limite le nombre d'analyses par jour (compteur Durable Object).
   - Découpe un plat en ingrédients avec Claude Haiku 5.5 (le modèle
     actuel le moins cher), réponse en JSON strict (structured outputs).
   ========================================================= */
import Anthropic from '@anthropic-ai/sdk';
import { DurableObject } from 'cloudflare:workers';

const MODELE = 'claude-haiku-5-5';

/* Réponse imposée (JSON strict) : valeurs pour la quantité de chaque ingrédient */
const NOMBRE = { type: 'number' };
const SCHEMA = {
  type: 'object',
  properties: {
    nom: { type: 'string' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nom: { type: 'string' },
          grammes: NOMBRE,
          kcal: NOMBRE,
          prot: NOMBRE,
          lip: NOMBRE,
          gluc: NOMBRE,
          source: { type: 'string', enum: ['ciqual', 'estimation'] },
        },
        required: ['nom', 'grammes', 'kcal', 'prot', 'lip', 'gluc', 'source'],
        additionalProperties: false,
      },
    },
    total: {
      type: 'object',
      properties: { grammes: NOMBRE, kcal: NOMBRE, prot: NOMBRE, lip: NOMBRE, gluc: NOMBRE },
      required: ['grammes', 'kcal', 'prot', 'lip', 'gluc'],
      additionalProperties: false,
    },
  },
  required: ['nom', 'ingredients', 'total'],
  additionalProperties: false,
};

const CONSIGNES = `Tu aides une application française de suivi nutritionnel.
On te donne ce qu'une personne a mangé (un aliment ou un plat, parfois complexe).
Découpe-le en ingrédients simples, avec un poids réaliste en grammes pour chacun.
- Si la quantité n'est pas précisée, prends une portion standard d'un restaurant ou d'un snack en France.
- Si un poids ou un nombre est donné (« 160 g », « 2 viandes »), respecte-le.
- Nomme les ingrédients simplement, en français, comme dans la table Ciqual de l'ANSES (ex. « Frites de pommes de terre, cuites », « Poulet, filet, grillé », « Sauce fromagère », « Galette de blé (tortilla) »).
- Pour chaque ingrédient, donne kcal, protéines (prot), lipides (lip) et glucides (gluc) pour SON poids, d'après Ciqual quand tu connais la valeur (source « ciqual »), sinon une estimation (source « estimation »).
- Vérifie que kcal ≈ 4 × prot + 9 × lip + 4 × gluc.
- « total » est la somme des ingrédients. « nom » est un nom court du plat, en français.
- Si le texte n'est pas un aliment, renvoie une liste d'ingrédients vide et un total à 0.`;

/* Lecture d'une capture d'écran d'une appli de nutrition (bilan de la journée) */
const VAL = { type: 'object', properties: { kcal: NOMBRE, prot: NOMBRE, gluc: NOMBRE, lip: NOMBRE }, required: ['kcal', 'prot', 'gluc', 'lip'], additionalProperties: false };
const SCHEMA_SCREEN = {
  type: 'object',
  properties: {
    lisible: { type: 'boolean' },
    consomme: VAL,
    objectifs: VAL,
    objectifs_visibles: { type: 'boolean' },
    appli: { type: 'string' },
    date: { type: 'string' },
  },
  required: ['lisible', 'consomme', 'objectifs', 'objectifs_visibles', 'appli', 'date'],
  additionalProperties: false,
};
const CONSIGNES_SCREEN = `Tu lis une capture d'écran d'une application de suivi nutritionnel (MyFitnessPal, Yazio, FatSecret, Lifesum, etc.) qui montre le bilan d'UNE journée.
Relève exactement les chiffres affichés, sans rien inventer :
- « consomme » : ce qui a été mangé sur la journée : kcal, protéines (prot), glucides (gluc), lipides (lip) en grammes.
- « objectifs » : les objectifs de la journée affichés par l'appli pour ces 4 valeurs. Si un objectif n'est pas visible, mets 0. « objectifs_visibles » = true seulement si au moins l'objectif de calories est lu.
- Attention aux pièges : « restant / remaining » n'est PAS le consommé ; « brûlé / exercise » ne se retire pas. Si l'appli affiche « 120 / 170 g », 120 est le consommé et 170 l'objectif.
- « appli » : le nom de l'application si tu le reconnais, sinon "". « date » : la date affichée (AAAA-MM-JJ) si visible, sinon "".
- « lisible » = false si l'image n'est pas un bilan nutritionnel (et mets tout à 0).`;

function entetes(origine) {
  return {
    'Access-Control-Allow-Origin': origine,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Code-Acces',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  };
}
const repondre = (origine, statut, corps) => new Response(JSON.stringify(corps), { status: statut, headers: entetes(origine) });

/* Compteur d'appels par jour (un seul objet, toujours cohérent) */
export class Compteur extends DurableObject {
  async prendre(jour, max) {
    const cle = 'n:' + jour;
    const n = (await this.ctx.storage.get(cle)) || 0;
    if (n >= max) return { ok: false, n, max };
    await this.ctx.storage.put(cle, n + 1);
    // ménage : on oublie les anciens jours
    const tous = await this.ctx.storage.list({ prefix: 'n:' });
    for (const k of tous.keys()) if (k !== cle) await this.ctx.storage.delete(k);
    return { ok: true, n: n + 1, max };
  }
  async lire(jour) {
    return (await this.ctx.storage.get('n:' + jour)) || 0;
  }
}

export default {
  async fetch(request, env) {
    const origineAutorisee = env.ORIGINE_AUTORISEE || 'https://mikafeu.github.io';
    const origine = request.headers.get('Origin') || '';
    const ok = origine === origineAutorisee;
    const o = origineAutorisee; // on ne répond jamais pour une autre origine
    if (request.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: entetes(o) });
    if (request.method !== 'POST') return repondre(o, 405, { erreur: 'methode' });
    if (!ok) return repondre(o, 403, { erreur: 'origine' });
    if (!env.CODE_ACCES || request.headers.get('X-Code-Acces') !== env.CODE_ACCES) return repondre(o, 401, { erreur: 'code' });
    if (!env.ANTHROPIC_API_KEY) return repondre(o, 500, { erreur: 'cle_absente' });

    let corps;
    try { corps = await request.json(); } catch (_) { return repondre(o, 400, { erreur: 'json' }); }
    const max = Math.max(1, Math.min(500, parseInt(env.MAX_PAR_JOUR || '30', 10) || 30));
    const jour = new Date().toISOString().slice(0, 10);
    const compteur = env.COMPTEUR.get(env.COMPTEUR.idFromName('global'));

    // simple lecture du quota (ne compte pas)
    if (corps && corps.quota) return repondre(o, 200, { utilises: await compteur.lire(jour), max });

    // capture d'écran du bilan de la journée (image en base64)
    const TYPES_IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
    if (corps && typeof corps.image === 'string') {
      if (!TYPES_IMAGE.includes(corps.type) || corps.image.length < 100 || corps.image.length > 7_000_000) return repondre(o, 400, { erreur: 'image' });
      const qi = await compteur.prendre(jour, max);
      if (!qi.ok) return repondre(o, 429, { erreur: 'limite', utilises: qi.n, max });
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
      try {
        const reponse = await client.messages.create({
          model: MODELE,
          max_tokens: 2000,
          system: CONSIGNES_SCREEN,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA_SCREEN } },
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: corps.type, data: corps.image } },
            { type: 'text', text: 'Voici le bilan nutritionnel de ma journée. Relève les chiffres.' },
          ] }],
        });
        if (reponse.stop_reason === 'refusal') return repondre(o, 422, { erreur: 'refus', utilises: qi.n, max });
        if (reponse.stop_reason === 'max_tokens') return repondre(o, 502, { erreur: 'tronque', utilises: qi.n, max });
        const bloc = reponse.content.find(b => b.type === 'text');
        const bilan = JSON.parse(bloc ? bloc.text : '{}');
        return repondre(o, 200, { bilan, modele: MODELE, utilises: qi.n, max });
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) return repondre(o, 500, { erreur: 'cle_invalide' });
        if (e instanceof Anthropic.RateLimitError) return repondre(o, 503, { erreur: 'surcharge' });
        if (e instanceof Anthropic.APIConnectionError) return repondre(o, 504, { erreur: 'connexion' });
        if (e instanceof Anthropic.APIError) return repondre(o, 502, { erreur: 'api', statut: e.status });
        if (e instanceof SyntaxError) return repondre(o, 502, { erreur: 'json_ia' });
        return repondre(o, 500, { erreur: 'inconnue' });
      }
    }

    const texte = typeof corps.texte === 'string' ? corps.texte.trim().slice(0, 200) : '';
    if (texte.length < 2) return repondre(o, 400, { erreur: 'texte' });

    const q = await compteur.prendre(jour, max);
    if (!q.ok) return repondre(o, 429, { erreur: 'limite', utilises: q.n, max });

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 45_000 });
    try {
      const reponse = await client.messages.create({
        model: MODELE,
        max_tokens: 4000,
        system: CONSIGNES,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: texte }],
      });
      if (reponse.stop_reason === 'refusal') return repondre(o, 422, { erreur: 'refus', utilises: q.n, max });
      if (reponse.stop_reason === 'max_tokens') return repondre(o, 502, { erreur: 'tronque', utilises: q.n, max });
      const bloc = reponse.content.find(b => b.type === 'text');
      const plat = JSON.parse(bloc ? bloc.text : '{}');
      return repondre(o, 200, { plat, modele: MODELE, utilises: q.n, max });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return repondre(o, 500, { erreur: 'cle_invalide' });
      if (e instanceof Anthropic.RateLimitError) return repondre(o, 503, { erreur: 'surcharge' });
      if (e instanceof Anthropic.APIConnectionError) return repondre(o, 504, { erreur: 'connexion' });
      if (e instanceof Anthropic.APIError) return repondre(o, 502, { erreur: 'api', statut: e.status });
      if (e instanceof SyntaxError) return repondre(o, 502, { erreur: 'json_ia' });
      return repondre(o, 500, { erreur: 'inconnue' });
    }
  },
};
