/* =========================================================
   MON SYSTÈME — application personnelle style "Système"
   Tout est sauvegardé dans le téléphone (localStorage).
   ========================================================= */
'use strict';

/* ⚠️ À chaque mise à jour : augmenter ce numéro ICI, dans sw.js
   et dans index.html (?v=...). Le script tests/check-version.js vérifie. */
const APP_VERSION = '3.1.0';

const STORAGE_KEY = 'monSysteme.save';
const SCHEMA = 1;

/* ---------- Les 4 stats (la Progression est calculée à part) ---------- */
const STATS = [
  { key: 'physique', name: 'Physique', icon: '💪', desc: 'Tout le corps : force, énergie, endurance' },
  { key: 'concentration', name: 'Concentration', icon: '🎯', desc: 'Jugée sur ce que tu fais de tes journées' },
  { key: 'intelligence', name: 'Intelligence', icon: '🧠', desc: 'Savoir, réflexion, créativité' },
  { key: 'discipline', name: 'Discipline', icon: '⚔️', desc: 'Avancer, être régulier' },
];
const DEFAULT_START = '2026-12-01'; // jour 0 de l'aventure
const STAT_KEYS = STATS.map(s => s.key);
const MEAL_KEYS = ['matin', 'midi', 'soir', 'collation'];
const statByKey = Object.fromEntries(STATS.map(s => [s.key, s]));

/* ---------- Règles "réalistes" (réglables) ----------
   - Une stat va de 0 à 100. On démarre à 10.
   - Chaque jour, une stat travaillée monte un peu ; plus elle est haute,
     plus c'est dur de la monter (rendements décroissants).
   - En faire énormément le même jour ne sert presque à rien de plus.
   - Sans activité dans un domaine pendant plus de 3 jours, la stat baisse
     légèrement chaque jour (jamais sous 5).
   Exemple : 1 h de sport par jour ≈ +5 en Physique le 1er mois, ≈ 60 après 1 an. */
const RULES = {
  statStart: 10,
  statMin: 5,
  gainRate: 0.35,        // gain max par jour quand la stat est à 0
  daySaturation: 2,      // points/jour à partir desquels ça sature
  minutesPerPoint: 30,   // 30 min d'activité = 1 point d'effort
  donePoints: 1,         // "Fait" (sans durée) = 1 point (≈ 30 min)
  entryMaxMinutes: 240,  // une entrée compte au maximum 4 h
  regularityBonus: 0.5,  // chaque jour actif = bonus de Discipline
  decayGraceDays: 3,     // jours sans activité avant que ça baisse
  decayRate: 0.003,      // -0,3 % par jour d'inactivité ensuite
  doneXp: 25,            // XP pour "Fait"
  xpPerMinute: 1,        // XP par minute
};

const DIFFICULTIES = [
  { key: 'easy', label: 'Facile', mult: 0.8 },
  { key: 'normal', label: 'Normal', mult: 1 },
  { key: 'hard', label: 'Intense', mult: 1.3 },
];
const diffMult = k => (DIFFICULTIES.find(d => d.key === k) || DIFFICULTIES[1]).mult;

const RANKS = [
  { letter: 'E', minLevel: 1, title: 'Charisme de rang E' },
  { letter: 'D', minLevel: 10, title: 'Charisme de rang D' },
  { letter: 'C', minLevel: 20, title: 'Charisme de rang C' },
  { letter: 'B', minLevel: 35, title: 'Charisme de rang B' },
  { letter: 'A', minLevel: 50, title: 'Charisme de rang A' },
  { letter: 'S', minLevel: 70, title: 'Charisme de rang S' },
];

/* Ce que j'ai mal fait : retire de l'XP et fait baisser les stats concernées */
const DEFAULT_BAD = [
  { id: 'b-reseaux', name: 'TikTok / réseaux', icon: '📱', stats: ['concentration', 'discipline'] },
  { id: 'b-jeux', name: 'Jeux vidéo', icon: '🎮', stats: ['discipline', 'concentration'] },
  { id: 'b-series', name: 'Séries / YouTube', icon: '📺', stats: ['concentration', 'discipline'] },
  { id: 'b-procra', name: 'Procrastination', icon: '🛋️', stats: ['discipline'] },
  { id: 'b-malbouffe', name: 'Malbouffe', icon: '🍔', stats: ['physique', 'discipline'] },
  { id: 'b-tard', name: 'Couché tard', icon: '🌙', stats: ['physique', 'concentration'] },
  { id: 'b-soiree', name: 'Soirée / alcool', icon: '🍺', stats: ['physique', 'discipline'] },
];
const DEFAULT_ACTIVITIES = [
  { id: 'live', name: 'Live (Twitch/TikTok)', icon: '🎥', stats: ['concentration', 'discipline'], difficulty: 'normal' },
  { id: 'clips', name: 'Clips / montage', icon: '✂️', stats: ['intelligence', 'concentration'], difficulty: 'normal' },
  { id: 'sport', name: 'Sport', icon: '🏋️', stats: ['physique', 'discipline'], difficulty: 'normal' },
  { id: 'travail', name: 'Travail', icon: '💼', stats: ['discipline', 'physique'], difficulty: 'normal' },
  { id: 'lecture', name: 'Apprentissage / lecture', icon: '📚', stats: ['intelligence', 'concentration'], difficulty: 'normal' },
];

/* Types de « mal fait » : écrans (durée + heure), malbouffe (ce que j'ai mangé),
   coucher tard (heures), alcool (verres), temps perdu (durée) */
const BAD_KINDS = ['screen', 'food', 'sleep', 'alcohol', 'time'];

/* =========================================================
   Dates (toujours en heure locale, format AAAA-MM-JJ)
   ========================================================= */
const pad2 = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const daysBetween = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};
const todayKey = () => dateKey(new Date());
const mondayOf = k => { const d = parseKey(k); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return dateKey(d); };
const isValidKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && !isNaN(parseKey(k));

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const fmtDayLong = k => { const d = parseKey(k); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const fmtDayShort = k => { const d = parseKey(k); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
const fmtMinutes = m => {
  if (!m) return '';
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${pad2(r)}` : `${h} h`;
};
const fmtNum = n => Math.round(n).toLocaleString('fr-FR');
const fmtStat = v => v.toFixed(1).replace('.', ',');

/* =========================================================
   Données
   ========================================================= */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function freshState() {
  return {
    schema: SCHEMA,
    playerName: 'Charisme',
    createdAt: new Date().toISOString(),
    startDate: DEFAULT_START,
    lastExportAt: null,
    activities: DEFAULT_ACTIVITIES.map(a => ({ ...a, stats: [...a.stats] })),
    badActivities: DEFAULT_BAD.map(a => ({ ...a, stats: [...a.stats], u: 0 })),
    logs: [],
    body: { startWeight: 96.5, goalWeight: 86, goalFat: 14, goalMuscle: 43, goalDate: '2027-06-01', heightCm: 185, age: 21, sex: 'h', waistCm: null, neckCm: null, fatStart: 25, kcalTarget: null, wakeTime: '07:30' },
    weights: [],
    meals: [],
    journals: [],
    bilans: [],       // saisie du jour : ce que j'ai accompli / ce qui m'a fait perdre du temps
    questCfg: { pushups: 100, sport: 30, focus: 60, meals: 3, bilan: true, waste: 60 },
    reps: [],         // pompes (et autres répétitions) : { id, date, ts, n }
    customFoods: [],  // mes aliments (valeurs d'étiquette) : { id, name, per100:{kcal,p,g,l}, portion, ts, u }
    customExercises: [], // mes exercices : { id, nom, type, coef, ts, u }
    customJunk: [],   // mes produits de malbouffe : { id, e, nom, kcal, ts, u }
    seenReports: [],
    tombstones: {},   // id supprimé → date (pour propager les suppressions entre appareils)
    settingsAt: 0,    // dernière modif des réglages
    replacedAt: 0,    // dernière remise à zéro / import (remplace tout)
  };
}
const tomb = id => { if (id) state.tombstones[id] = Date.now(); };
const touchSettings = () => { state.settingsAt = Date.now(); };
/* l'ancienne stat "Progression" est devenue un calcul global : ses points vont à la Concentration */
const migrateStats = arr => [...new Set((Array.isArray(arr) ? arr : []).map(k => (k === 'progression' ? 'concentration' : k)).filter(k => STAT_KEYS.includes(k)))];

/* Nettoie / vérifie des données (au chargement et à l'import). */
function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Fichier illisible');
  if (!Array.isArray(raw.activities) || !Array.isArray(raw.logs)) throw new Error('Ce fichier ne ressemble pas à une sauvegarde du Système');
  const s = freshState();
  s.playerName = typeof raw.playerName === 'string' && raw.playerName.trim() ? raw.playerName.trim().slice(0, 40) : 'Charisme';
  if (s.playerName === 'Chasseur') s.playerName = 'Charisme';
  if (isValidKey(raw.startDate)) s.startDate = raw.startDate;
  s.seenReports = Array.isArray(raw.seenReports) ? raw.seenReports.filter(x => typeof x === 'string').slice(-48) : [];
  s.settingsAt = Number.isFinite(raw.settingsAt) ? raw.settingsAt : 0;
  s.replacedAt = Number.isFinite(raw.replacedAt) ? raw.replacedAt : 0;
  s.tombstones = {};
  if (raw.tombstones && typeof raw.tombstones === 'object') {
    const yearAgo = Date.now() - 400 * 86400000;
    for (const [k, v] of Object.entries(raw.tombstones)) if (typeof k === 'string' && Number.isFinite(v) && v > yearAgo) s.tombstones[k] = v;
  }
  s.createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : s.createdAt;
  s.lastExportAt = typeof raw.lastExportAt === 'string' ? raw.lastExportAt : null;
  s.activities = raw.activities
    .filter(a => a && typeof a.name === 'string')
    .map(a => ({
      id: typeof a.id === 'string' && a.id ? a.id : uid(),
      name: a.name.slice(0, 40),
      icon: typeof a.icon === 'string' && a.icon ? a.icon.slice(0, 8) : '⭐',
      stats: migrateStats(a.stats),
      difficulty: DIFFICULTIES.some(d => d.key === a.difficulty) ? a.difficulty : 'normal',
      u: Number.isFinite(a.u) ? a.u : 0,
    }));
  if (Array.isArray(raw.badActivities)) {
    s.badActivities = raw.badActivities.filter(a => a && typeof a.name === 'string').map(a => ({
      id: typeof a.id === 'string' && a.id ? a.id : uid(), name: a.name.slice(0, 40),
      icon: typeof a.icon === 'string' && a.icon ? a.icon.slice(0, 8) : '⛔', stats: migrateStats(a.stats), u: Number.isFinite(a.u) ? a.u : 0,
      kind: BAD_KINDS.includes(a.kind) ? a.kind : undefined,
    }));
  }
  s.logs = raw.logs
    .filter(l => l && isValidKey(l.date))
    .map(l => ({
      id: typeof l.id === 'string' && l.id ? l.id : uid(),
      date: l.date,
      ts: typeof l.ts === 'number' ? l.ts : parseKey(l.date).getTime(),
      activityId: typeof l.activityId === 'string' ? l.activityId : '',
      name: typeof l.name === 'string' ? l.name.slice(0, 60) : 'Activité',
      icon: typeof l.icon === 'string' ? l.icon.slice(0, 8) : '⭐',
      minutes: Number.isFinite(l.minutes) && l.minutes > 0 ? Math.min(Math.round(l.minutes), 24 * 60) : null,
      note: typeof l.note === 'string' ? l.note.slice(0, 280) : '',
      stats: migrateStats(l.stats),
      difficulty: DIFFICULTIES.some(d => d.key === l.difficulty) ? l.difficulty : 'normal',
      bad: l.bad === true,
      xp: Number.isFinite(l.xp) && (l.bad === true ? l.xp <= 0 : l.xp >= 0) ? Math.round(l.xp) : 0,
      quality: Number.isFinite(l.quality) && l.quality >= 0.3 && l.quality <= 2 ? l.quality : 1,
      verdict: typeof l.verdict === 'string' ? l.verdict.slice(0, 160) : '',
      ...cleanLogDetails(l),
    }));
  const okKg = v => Number.isFinite(v) && v >= 30 && v <= 300;
  const inR = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
  if (raw.body && typeof raw.body === 'object') {
    const rb = raw.body;
    if (okKg(rb.startWeight)) s.body.startWeight = rb.startWeight;
    if (okKg(rb.goalWeight)) s.body.goalWeight = rb.goalWeight;
    if (inR(rb.goalFat, 5, 40)) s.body.goalFat = rb.goalFat;
    if (inR(rb.goalMuscle, 20, 60)) s.body.goalMuscle = rb.goalMuscle;
    if (isValidKey(rb.goalDate)) s.body.goalDate = rb.goalDate;
    s.body.heightCm = inR(rb.heightCm, 120, 230) ? rb.heightCm : 185; // 1,85 m
    s.body.age = inR(rb.age, 10, 100) ? rb.age : 21;
    if (inR(rb.waistCm, 50, 200)) s.body.waistCm = rb.waistCm;
    if (inR(rb.neckCm, 25, 70)) s.body.neckCm = rb.neckCm;
    if (inR(rb.fatStart, 5, 60)) s.body.fatStart = rb.fatStart;
    if (inR(rb.kcalTarget, 1000, 6000)) s.body.kcalTarget = rb.kcalTarget;
    if (typeof rb.wakeTime === 'string' && /^\d{2}:\d{2}$/.test(rb.wakeTime)) s.body.wakeTime = rb.wakeTime;
  }
  s.weights = (Array.isArray(raw.weights) ? raw.weights : [])
    .filter(w => w && isValidKey(w.date) && okKg(w.kg))
    .map(w => ({
      id: typeof w.id === 'string' && w.id ? w.id : uid(), date: w.date, kg: Math.round(w.kg * 10) / 10, ts: Number.isFinite(w.ts) ? w.ts : 0,
      fat: inR(w.fat, 3, 70) ? w.fat : null, muscle: inR(w.muscle, 10, 80) ? w.muscle : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const num = v => (Number.isFinite(v) && v >= 0 ? v : 0);
  s.meals = (Array.isArray(raw.meals) ? raw.meals : [])
    .filter(m => m && isValidKey(m.date) && MEAL_KEYS.includes(m.meal) && typeof m.name === 'string')
    .map(m => ({
      id: typeof m.id === 'string' && m.id ? m.id : uid(), date: m.date, meal: m.meal, ts: num(m.ts),
      name: m.name.slice(0, 120), grams: Math.min(5000, num(m.grams)),
      kcal: num(m.kcal), p: num(m.p), g: num(m.g), l: num(m.l),
      src: typeof m.src === 'string' ? m.src.slice(0, 10) : 'manuel',
      ...(m.liq === true ? { liq: true } : {}),
    }));
  s.bilans = (Array.isArray(raw.bilans) ? raw.bilans : [])
    .filter(b => b && isValidKey(b.date) && (typeof b.good === 'string' || typeof b.bad === 'string'))
    .map(b => ({ id: typeof b.id === 'string' ? b.id : uid(), date: b.date, ts: Number.isFinite(b.ts) ? b.ts : 0,
      good: typeof b.good === 'string' ? b.good.slice(0, 1500) : '', bad: typeof b.bad === 'string' ? b.bad.slice(0, 1500) : '' }));
  if (raw.questCfg && typeof raw.questCfg === 'object') {
    const q = raw.questCfg;
    s.questCfg = {
      sport: inR(q.sport, 0, 600) ? q.sport : 30, focus: inR(q.focus, 0, 900) ? q.focus : 60,
      meals: inR(q.meals, 0, 4) ? q.meals : 3, bilan: q.bilan !== false, waste: inR(q.waste, 0, 600) ? q.waste : 60,
      pushups: inR(q.pushups, 0, 2000) ? q.pushups : 100,
    };
  }
  const n2 = v => (Number.isFinite(v) && v >= 0 && v <= 1000 ? Math.round(v * 10) / 10 : 0);
  s.customFoods = (Array.isArray(raw.customFoods) ? raw.customFoods : [])
    .filter(f => f && typeof f.name === 'string' && f.per100 && typeof f.per100 === 'object')
    .map(f => ({ id: typeof f.id === 'string' ? f.id : uid(), name: f.name.slice(0, 80), ts: Number.isFinite(f.ts) ? f.ts : 0, u: Number.isFinite(f.u) ? f.u : 0,
      per100: { kcal: n2(f.per100.kcal), p: n2(f.per100.p), g: n2(f.per100.g), l: n2(f.per100.l) },
      portion: Number.isFinite(f.portion) && f.portion > 0 && f.portion <= 2000 ? Math.round(f.portion) : null,
      grp: typeof f.grp === 'string' ? f.grp.slice(0, 40) : undefined, emoji: typeof f.emoji === 'string' ? f.emoji.slice(0, 8) : undefined }));
  s.customExercises = (Array.isArray(raw.customExercises) ? raw.customExercises : [])
    .filter(x => x && typeof x.nom === 'string' && ['nombre', 'charge', 'duree'].includes(x.type))
    .map(x => ({ id: typeof x.id === 'string' ? x.id : uid(), nom: x.nom.slice(0, 40), type: x.type, coef: inR(x.coef, 0.5, 10) ? x.coef : 1, ts: Number.isFinite(x.ts) ? x.ts : 0, u: Number.isFinite(x.u) ? x.u : 0 }));
  s.customJunk = (Array.isArray(raw.customJunk) ? raw.customJunk : [])
    .filter(x => x && typeof x.nom === 'string' && inR(x.kcal, 1, 5000))
    .map(x => ({ id: typeof x.id === 'string' ? x.id : uid(), e: typeof x.e === 'string' ? x.e.slice(0, 12) : 'autre', nom: x.nom.slice(0, 50), kcal: Math.round(x.kcal), ts: Number.isFinite(x.ts) ? x.ts : 0, u: Number.isFinite(x.u) ? x.u : 0 }));
  s.reps = (Array.isArray(raw.reps) ? raw.reps : [])
    .filter(r => r && isValidKey(r.date) && Number.isFinite(r.n) && r.n > 0 && r.n <= 1000)
    .map(r => ({ id: typeof r.id === 'string' ? r.id : uid(), date: r.date, ts: Number.isFinite(r.ts) ? r.ts : 0, n: Math.round(r.n) }));
  s.journals = (Array.isArray(raw.journals) ? raw.journals : [])
    .filter(j => j && isValidKey(j.date) && typeof j.text === 'string')
    .map(j => ({
      id: typeof j.id === 'string' ? j.id : uid(), date: j.date, text: j.text.slice(0, 1000), ts: Number.isFinite(j.ts) ? j.ts : 0,
      score: Number.isFinite(j.score) ? Math.max(-3, Math.min(3, j.score)) : 0,
      verdict: typeof j.verdict === 'string' ? j.verdict.slice(0, 300) : '',
    }));
  return s;
}

function loadState() {
  try {
    const txt = localStorage.getItem(STORAGE_KEY);
    if (!txt) return freshState();
    return sanitizeState(JSON.parse(txt));
  } catch (e) {
    console.error('Chargement impossible', e);
    // on garde une copie de secours au cas où
    try { const bad = localStorage.getItem(STORAGE_KEY); if (bad) localStorage.setItem(STORAGE_KEY + '.backup-' + Date.now(), bad); } catch (_) {}
    return freshState();
  }
}

let state = loadState();

function save(fromSync = false) {
  if (!fromSync && window.Sync) window.Sync.schedule();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error(e);
    toast('Sauvegarde impossible', "La mémoire du téléphone est pleine ou bloquée. Exporte ta sauvegarde.", 'warn');
  }
}

/* =========================================================
   Calculs : XP, niveau, rang, stats, série
   ========================================================= */
function entryXp(minutes, difficulty) {
  const base = minutes ? Math.min(minutes, RULES.entryMaxMinutes) * RULES.xpPerMinute : RULES.doneXp;
  return Math.max(1, Math.round(base * diffMult(difficulty)));
}
function entryPoints(log) {
  if (Number.isFinite(log.pts)) return log.pts * (log.quality || 1);
  const base = log.minutes ? Math.min(log.minutes, RULES.entryMaxMinutes) / RULES.minutesPerPoint : RULES.donePoints;
  return base * diffMult(log.difficulty) * (log.quality || 1);
}

/* XP nécessaire pour passer du niveau n au niveau n+1.
   Calibré "vraie vie" : avec ~2 h d'activité réelle par jour (≈ 150 XP),
   rang D (niv. 10) ≈ 3 mois, C (20) ≈ 1 an, B (35) ≈ 3 ans, A (50) ≈ 6 ans, S (70) ≈ 12 ans. */
const xpToNext = n => 200 + 250 * n;
const NUTRI_XP = 50; // journée de nutrition validée

function levelInfo(totalXp) {
  let level = 1, rest = totalXp;
  while (rest >= xpToNext(level)) { rest -= xpToNext(level); level++; }
  return { level, into: rest, need: xpToNext(level), total: totalXp };
}
function rankFor(level, gated = true) {
  let r = RANKS[0];
  for (const x of RANKS) if (level >= x.minLevel) r = x;
  if (!gated || (r.letter !== 'A' && r.letter !== 'S') || typeof rankGate !== 'function') return r;
  // A et S : il faut aussi la régularité sur des semaines ET un vrai changement physique
  const g = rankGate();
  if (r.letter === 'S' && !g.S.ok) r = RANKS.find(x => x.letter === 'A');
  if (r.letter === 'A' && !g.A.ok) return { ...RANKS.find(x => x.letter === 'B'), locked: 'A' };
  return r;
}
function gradeFor(v) {
  if (v >= 80) return 'S';
  if (v >= 65) return 'A';
  if (v >= 50) return 'B';
  if (v >= 35) return 'C';
  if (v >= 20) return 'D';
  return 'E';
}
/* Le corps compte aussi : chaque kg perdu vers l'objectif rapporte de l'XP, chaque kg repris en retire. */
const BODY_XP_PER_KG = 300;
const bodyXp = () => Math.round((state.body.startWeight - currentWeight()) * BODY_XP_PER_KG * (state.body.goalWeight <= state.body.startWeight ? 1 : -1));
/* XP des activités : le positif est plafonné par jour (règle n° 1), le négatif compte toujours */
let _logsXp = { k: '', v: 0, byDay: null };
function logsXp() {
  const k = state.logs.length + '|' + state.logs.reduce((s, l) => s + l.xp, 0);
  if (_logsXp.k === k) return _logsXp.v;
  const pos = new Map(); let neg = 0;
  for (const l of state.logs) { if (l.xp >= 0) pos.set(l.date, (pos.get(l.date) || 0) + l.xp); else neg += l.xp; }
  let v = neg;
  for (const x of pos.values()) v += Math.min(REGLAGES_RANGS.xpMaxParJour, x);
  _logsXp = { k, v, byDay: pos };
  return v;
}
const dayPosXp = d => { logsXp(); return _logsXp.byDay.get(d) || 0; };
const totalXp = () => Math.max(0, logsXp() + nutritionDays(todayKey()).size * NUTRI_XP + bodyXp() + questXp());

/* Recalcule les stats en "rejouant" chaque jour depuis la 1re donnée.
   Ainsi, supprimer une entrée corrige tout automatiquement.
   Garde aussi l'historique jour par jour (graphique, jour 0, bilans). */
let _seriesCache = { key: '', out: null };
function computeStats(logs, today) {
  const nd = nutritionDays(today);
  const key = today + '|' + logs.length + '|' + logs.reduce((s, l) => s + l.xp + (l.quality || 1), 0) + '|' + nd.size + '|' + state.journals.map(j => j.date + j.score).join(',') + '|' + state.bilans.map(b => b.date + b.ts).join(',') + '|' + questHistory(today).failed.size + '|' + state.startDate + '|' + state.reps.length + ':' + state.reps.reduce((t, r) => t + r.n, 0);
  if (logs === state.logs && _seriesCache.key === key) return _seriesCache.out;
  const values = {}, last = {};
  STAT_KEYS.forEach(k => { values[k] = RULES.statStart; last[k] = null; });
  const history = new Map(); // date → {stat: valeur}

  const byDay = new Map();
  let first = today;
  const goodDays = new Set();
  for (const l of logs) {
    if (l.date > today) continue;
    if (l.date < first) first = l.date;
    const o = byDay.get(l.date) || {};
    // ce que j'ai mal fait compte en négatif, et plus lourd (×1,25)
    const pts = entryPoints(l) * (l.bad ? -BAD_WEIGHT : 1);
    for (const k of l.stats) o[k] = (o[k] || 0) + pts;
    byDay.set(l.date, o);
    if (!l.bad) goodDays.add(l.date);
  }
  // pompes : 100 pompes ≈ 1 point de Physique et 0,4 de Discipline
  for (const r of state.reps) {
    if (r.date > today) continue;
    if (r.date < first) first = r.date;
    const o = byDay.get(r.date) || {};
    o.physique = (o.physique || 0) + r.n / 100;
    o.discipline = (o.discipline || 0) + (r.n / 100) * 0.4;
    byDay.set(r.date, o);
    goodDays.add(r.date);
  }
  // bonus de régularité : seulement les jours où le bien l'emporte (pas de bonus gratuit)
  for (const [d, o] of byDay) if (goodDays.has(d) && Object.values(o).reduce((a, v) => a + v, 0) >= 0) o.discipline = (o.discipline || 0) + RULES.regularityBonus;
  // journée de nutrition validée = 1 point de Discipline
  for (const d of nd) {
    const o = byDay.get(d) || {};
    o.discipline = (o.discipline || 0) + 1;
    byDay.set(d, o);
    if (d < first) first = d;
  }
  // journal du jour : la journée racontée est jugée (Concentration)
  const penalty = new Map();
  const bilanDates = new Set(state.bilans.map(b => b.date));
  for (const j of state.journals) {
    if (j.date > today || bilanDates.has(j.date)) continue; // le bilan du jour remplace l'ancien journal
    if (j.date < first) first = j.date;
    if (j.score > 0) {
      const o = byDay.get(j.date) || {};
      o.concentration = (o.concentration || 0) + j.score * 0.8;
      o.discipline = (o.discipline || 0) + 0.3;
      byDay.set(j.date, o);
    } else if (j.score < 0) penalty.set(j.date, -j.score);
  }
  // bilan du jour : gains ET pertes réels (pas de bonus gratuit si la journée est négative)
  const negDays = new Set();
  for (const b of state.bilans) {
    if (b.date > today) continue;
    if (b.date < first) first = b.date;
    const a = analyzeBilan(b, b.date);
    const o = byDay.get(b.date) || {};
    for (const k of STAT_KEYS) if (a.pts[k]) o[k] = (o[k] || 0) + a.pts[k];
    if (a.net < 0) { negDays.add(b.date); o.discipline = (o.discipline || 0) - RULES.regularityBonus; }
    byDay.set(b.date, o);
  }
  // quête quotidienne ratée = pénalité de Discipline
  for (const d of questHistory(today).failed) {
    const o = byDay.get(d) || {};
    o.discipline = (o.discipline || 0) - 2;
    byDay.set(d, o);
    if (d < first) first = d;
  }
  const start = state.startDate || first;
  if (start < first) first = start;

  let day = first, guard = 0;
  while (day <= today && guard++ < 40000) {
    const o = byDay.get(day);
    for (const k of STAT_KEYS) {
      const pts = o ? (o[k] || 0) : 0;
      if (pts > 0) {
        const eff = 1 - Math.exp(-pts / RULES.daySaturation);
        values[k] = Math.min(100, values[k] + RULES.gainRate * eff * (1 - values[k] / 100));
        last[k] = day;
      } else if (pts < 0) {
        // recul : plus rapide que la progression, et d'autant plus fort que la stat est haute
        const loss = Math.min(2, 0.12 * -pts * (0.5 + values[k] / 100));
        values[k] = Math.max(RULES.statMin, values[k] - loss);
      } else if (last[k] && daysBetween(last[k], day) > RULES.decayGraceDays) {
        values[k] = Math.max(RULES.statMin, values[k] * (1 - RULES.decayRate));
      }
    }
    if (penalty.has(day)) values.concentration = Math.max(RULES.statMin, values.concentration - 0.15 * penalty.get(day));
    history.set(day, { ...values });
    day = addDays(day, 1);
  }
  const base = { ...history.get(addDays(start, -1)) || Object.fromEntries(STAT_KEYS.map(k => [k, RULES.statStart])) };
  const out = { values, last, history, first, start, base };
  if (logs === state.logs) _seriesCache = { key, out };
  return out;
}
const powerOf = v => STAT_KEYS.reduce((s, k) => s + v[k], 0) / STAT_KEYS.length;

function activeDays() {
  return new Set(state.logs.filter(l => !l.bad).map(l => l.date));
}
function streakInfo(today) {
  const days = activeDays();
  let current = 0;
  let cursor = days.has(today) ? today : addDays(today, -1);
  while (days.has(cursor)) { current++; cursor = addDays(cursor, -1); }
  const sorted = [...days].sort();
  let best = 0, run = 0, prev = null;
  for (const d of sorted) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best, doneToday: days.has(today), totalDays: days.size };
}

/* =========================================================
   Petits outils d'interface
   ========================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, sub = '', kind = 'info') {
  const box = $('#toasts');
  box.innerHTML = ''; // une seule notification à la fois
  const el = document.createElement('div');
  el.className = 'toast';
  if (kind === 'warn') el.style.borderColor = 'rgba(255,200,87,.8)';
  el.innerHTML = `<div class="toast-tag">[SYSTÈME]</div><div class="toast-msg">${esc(msg)}</div>${sub ? `<div class="toast-sub">${esc(sub)}</div>` : ''}`;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 3200);
}

/* Fenêtre générique. buttons: [{label, value, cls}] → renvoie une promesse */
function openSheet({ tag = '[SYSTÈME]', title = '', body = '', buttons = [], center = false, onMount = null, cls = '' }) {
  return new Promise(resolve => {
    const root = $('#modal-root');
    const ov = document.createElement('div');
    ov.className = 'overlay' + (center ? ' center' : '');
    ov.innerHTML = `
      <div class="sheet ${cls}" role="dialog" aria-modal="true">
        ${center ? '' : '<div class="sheet-grab"></div>'}
        <div class="sheet-tag">${esc(tag)}</div>
        ${title ? `<div class="sheet-title">${esc(title)}</div>` : ''}
        <div class="sheet-body">${body}</div>
        ${buttons.length ? `<div class="stack" style="margin-top:16px">${buttons.map((b, i) => `<button type="button" class="btn block ${b.cls || ''}" data-btn="${i}">${esc(b.label)}</button>`).join('')}</div>` : ''}
      </div>`;
    let done = false;
    const close = value => {
      if (done) return;
      done = true;
      ov.remove();
      resolve(value);
    };
    ov.addEventListener('click', e => {
      if (e.target === ov) close(null);
      const b = e.target.closest('[data-btn]');
      if (b) close(buttons[+b.dataset.btn].value);
    });
    root.appendChild(ov);
    if (onMount) onMount(ov.querySelector('.sheet'), close);
  });
}
const confirmBox = (title, text, okLabel = 'Confirmer', danger = false) =>
  openSheet({
    title, center: true,
    body: `<p>${text}</p>`,
    buttons: [{ label: okLabel, value: true, cls: danger ? 'danger' : 'primary' }, { label: 'Annuler', value: false, cls: 'ghost' }],
  }).then(v => v === true);

/* Grande animation "[SYSTÈME]" : quête accomplie, journée jugée… */
function celebrate({ kind = 'win', title = '', icon = '', big = '', count = null, sub = '', chips = [], lines = [] }) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = `celebrate c-${kind}`;
    ov.innerHTML = `
      <div class="cel-rays"></div>
      <div class="cel-flash"></div>
      <div class="cel-parts">${Array.from({ length: 26 }, (_, i) => `<i style="--a:${(i * 360) / 26}deg;--d:${(i % 5) * 60}ms;--r:${110 + (i % 4) * 35}px"></i>`).join('')}</div>
      <div class="cel-box">
        <div class="cel-tag">[SYSTÈME]</div>
        ${icon ? `<div class="cel-icon">${esc(icon)}</div>` : ''}
        <div class="cel-title">${esc(title)}</div>
        <div class="cel-big">${esc(big)}</div>
        ${sub ? `<div class="cel-sub">${esc(sub)}</div>` : ''}
        ${chips.length ? `<div class="cel-chips">${chips.map((c, i) => { const neg = /[-−]\d/.test(c); return `<span class="${neg ? 'neg' : ''}" style="animation-delay:${450 + i * 120}ms">${neg ? '▼' : '▲'} ${esc(c)}</span>`; }).join('')}</div>` : ''}
        ${lines.map(l => `<div class="cel-line">${esc(l)}</div>`).join('')}
        <div class="cel-hint">Touche pour continuer</div>
      </div>`;
    document.body.appendChild(ov);
    const bigEl = ov.querySelector('.cel-big');
    if (count != null && bigEl) {
      const t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / 700);
        bigEl.textContent = `+${Math.round(count * (1 - Math.pow(1 - k, 3)))} XP`;
        if (k < 1 && ov.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      ov.classList.add('out');
      setTimeout(() => { ov.remove(); resolve(); }, 280);
    };
    setTimeout(() => ov.addEventListener('click', close), 350);
    setTimeout(close, lines.length ? 4200 : 2800);
  });
}

/* =========================================================
   EFFETS : sons, vibrations, chiffres qui défilent, flash
   ========================================================= */
const PREFS_KEY = 'monSysteme.prefs';
const prefs = (() => { try { return { sound: true, vibrate: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch (_) { return { sound: true, vibrate: true }; } })();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) {} };

let audioCtx = null;
function sfx(kind) {
  if (!prefs.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    const notes = {
      tap: [[880, 0, 0.05, 0.04]],
      open: [[520, 0, 0.08, 0.05], [780, 0.05, 0.1, 0.04]],
      success: [[660, 0, 0.09, 0.08], [880, 0.08, 0.1, 0.08], [1320, 0.16, 0.18, 0.07]],
      levelup: [[392, 0, 0.18, 0.1], [523, 0.12, 0.18, 0.1], [659, 0.24, 0.18, 0.1], [1047, 0.36, 0.5, 0.09]],
      fail: [[220, 0, 0.18, 0.09], [165, 0.14, 0.26, 0.09]],
      penalty: [[140, 0, 0.3, 0.12], [110, 0.25, 0.4, 0.12]],
    }[kind] || GAME_SOUNDS[kind] || [];
    for (const [f, at, dur, vol, type] of notes) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type || (kind === 'penalty' || kind === 'fail' ? 'sawtooth' : 'triangle');
      o.frequency.setValueAtTime(f, t0 + at);
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + at); o.stop(t0 + at + dur + 0.02);
    }
  } catch (_) {}
}
/* Vibration : navigator.vibrate (Android) ; sur iPhone (iOS 18+), un interrupteur caché déclenche le retour haptique */
let hapticLabel = null;
function haptic(times = 1) {
  if (!prefs.vibrate) return;
  if (navigator.vibrate) { navigator.vibrate(times > 1 ? [25, 50, 40, 50, 70] : 18); return; }
  try {
    if (!hapticLabel) {
      hapticLabel = document.createElement('label');
      hapticLabel.setAttribute('aria-hidden', 'true');
      hapticLabel.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;overflow:hidden;opacity:0';
      hapticLabel.innerHTML = '<input type="checkbox" switch>';
      document.body.appendChild(hapticLabel);
    }
    for (let k = 0; k < times; k++) setTimeout(() => hapticLabel.click(), k * 110);
  } catch (_) {}
}

/* Chiffres qui défilent : <b data-count-to="12.5" data-count-from="10" data-fmt="kg"> */
const FMT = { int: v => fmtNum(v), kg: v => fmtKg(v), pct: v => fmtPct(v), stat: v => fmtStat(v), lvl: v => String(Math.round(v)) };
function runCountUps(root = document) {
  root.querySelectorAll('[data-count-to]').forEach(el => {
    const to = +el.dataset.countTo, from = el.dataset.countFrom != null ? +el.dataset.countFrom : 0;
    const f = FMT[el.dataset.fmt] || FMT.int;
    if (!Number.isFinite(to) || !Number.isFinite(from) || from === to) { el.textContent = f(to); return; }
    const dur = +(el.dataset.dur || 900), t0 = performance.now();
    el.classList.add('counting');
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = f(from + (to - from) * e);
      if (k < 1 && el.isConnected) requestAnimationFrame(step); else { el.classList.remove('counting'); el.classList.add('flash'); }
    };
    el.textContent = f(from);
    requestAnimationFrame(step);
  });
  // barres : on part de l'ancienne largeur
  root.querySelectorAll('[data-w-from]').forEach(el => {
    const to = el.style.width;
    el.style.transition = 'none';
    el.style.width = el.dataset.wFrom + '%';
    void el.offsetWidth;
    el.style.transition = '';
    requestAnimationFrame(() => { el.style.width = to; el.parentElement.classList.add('flash'); });
  });
}
/* Valeurs affichées avant un changement (pour animer "avant → après") */
const anim = { prev: null };
function snapshotForAnim() {
  const lv = levelInfo(totalXp());
  const b = bodyProgress();
  anim.prev = { level: lv.level, into: lv.into, need: lv.need, pct: (lv.into / lv.need) * 100, total: lv.total, rank: rankFor(lv.level).letter, progress: b.progress * 100, kg: b.cur };
}
const cf = (key, fallback) => (anim.prev && anim.prev[key] != null ? anim.prev[key] : fallback);

/* =========================================================
   Navigation
   ========================================================= */
const TITLES = { home: 'Statut du joueur', today: 'Quêtes du jour', meals: 'Repas & nutrition', stats: 'Statistiques', history: 'Journal des quêtes', settings: 'Réglages' };
let currentTab = 'home';
const ui = { calMonth: null, selectedDay: null, holoMode: 'now', holoRank: null, day0: false, statsTab: 'stats', chartKey: 'power', chartTf: 'J', photoPose: 'face', mealDay: null, todayDay: null };
/* Jour affiché dans « Aujourd'hui » : aujourd'hui, ou un jour passé à compléter (30 jours max) */
const BACKFILL_DAYS = 30;
const todayView = () => (ui.todayDay && ui.todayDay < todayKey() && ui.todayDay >= addDays(todayKey(), -BACKFILL_DAYS) ? ui.todayDay : todayKey());

function go(tab) {
  if (tab !== currentTab) { sfx('open'); haptic(); }
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === tab));
  $('#topbar-title').textContent = TITLES[tab];
  render();
  window.scrollTo(0, 0);
}

function render() {
  const view = $('#view');
  const fn = { home: renderHome, today: renderToday, meals: renderMeals, stats: renderStatsTab, history: renderHistory, settings: renderSettings }[currentTab];
  view.innerHTML = fn();
  // entrée "hologramme" : les blocs apparaissent en cascade
  [...view.children].forEach((el, i) => { el.style.setProperty('--i', Math.min(i, 10)); el.classList.add('enter'); });
  if (currentTab === 'home') { mountHolo(); checkProgTier(progressionInfo(todayKey())); }
  runCountUps(view);
  anim.prev = null;
  scanSweep();
  applyTier();
  setProgTheme();
}

/* Affiche l'hologramme 3D dans l'Accueil (le module 3D se charge à part) */
function mountHolo() {
  const el = $('#holo');
  if (!el) return;
  const v = holoView();
  const go3d = () => window.Holo && window.Holo.mount(el, { progress: v.progress, tint: v.tint });
  if (window.Holo) go3d();
  else document.addEventListener('holo-ready', go3d, { once: true });
}

/* =========================================================
   Onglet 1 : Accueil
   ========================================================= */
function renderHome() {
  const today = todayKey();
  const xp = totalXp();
  const lv = levelInfo(xp);
  const rank = rankFor(lv.level);
  const st = computeStats(state.logs, today);
  const shown = ui.day0 ? st.base : st.values;
  const streak = streakInfo(today);
  const pct = Math.min(100, (lv.into / lv.need) * 100);
  const started = today >= st.start;
  const journal = state.journals.find(j => j.date === today);

  const statsHtml = `<div class="sring-grid">${STATS.map(s => {
    const v = shown[s.key];
    const diff = st.values[s.key] - st.base[s.key];
    const inactive = st.last[s.key] ? daysBetween(st.last[s.key], today) : null;
    const foot = ui.day0 ? 'Jour 0' : inactive === null ? 'Pas encore entraînée' : inactive > RULES.decayGraceDays ? `<span class="decay-warn">⚠ ${inactive} j sans · en baisse</span>` : inactive === 0 ? "Entraînée aujourd'hui" : `Il y a ${inactive} j`;
    return statRing(s, v, ui.day0 || !started ? null : diff, { deltaLabel: 'depuis J0', foot });
  }).join('')}</div>`;

  const daysSinceExport = state.lastExportAt ? daysBetween(dateKey(new Date(state.lastExportAt)), today) : null;
  const needReminder = state.logs.length >= 5 && (daysSinceExport === null || daysSinceExport >= 7);
  const prog = progressionInfo(today, st);

  return `
    ${ui.day0 ? `<div class="day0-banner">[SYSTÈME] ARCHIVE DU JOUR 0 · ${esc(fmtDayLong(st.start))} <button type="button" data-action="day0">Revenir</button></div>` : ''}
    ${renderBodyPanel(today)}

    <section class="panel player-card pc-${rank.letter}">
      <div class="aura" aria-hidden="true"><i></i></div>
      <div class="profile">
        <div class="rank-badge rank-${rank.letter} ${anim.prev && anim.prev.rank !== rank.letter ? 'flash rank-change' : ''}">${rank.letter}</div>
        <div class="profile-info">
          <div class="player-name">${esc(state.playerName)}</div>
          <div class="player-meta">${rank.title}</div>
          <div class="level-line"><span class="level-label">NIVEAU</span><span class="level-num" data-count-to="${lv.level}" data-count-from="${cf('level', lv.level)}" data-fmt="lvl">${lv.level}</span></div>
        </div>
      </div>
      <div class="rank-chips" role="group" aria-label="Voir mon corps à chaque rang">
        <span class="rank-chips-lab">Mon corps :</span>
        ${['E', 'D', 'C', 'B', 'A', 'S'].map(r => `<button type="button" class="rchip r-${r} ${ui.holoRank === r ? 'on' : ''} ${rank.letter === r ? 'mine' : ''}" data-rank-preview="${r}">${r}</button>`).join('')}
      </div>
      <div class="bar xp energy"><i class="xp-flow" aria-hidden="true"></i><span style="width:${pct}%" ${anim.prev ? `data-w-from="${anim.prev.level < lv.level ? 0 : anim.prev.level > lv.level ? 100 : anim.prev.pct}"` : ''}></span></div>
      <div class="bar-caption"><span>XP <b data-count-to="${lv.into}" data-count-from="${anim.prev && anim.prev.level === lv.level ? anim.prev.into : lv.into}">${fmtNum(lv.into)}</b> / ${fmtNum(lv.need)}</span><span>Total <b data-count-to="${xp}" data-count-from="${cf('total', xp)}">${fmtNum(xp)}</b></span></div>
      <div class="xp-split">Quêtes ${fmtNum(state.logs.reduce((t, l) => t + l.xp, 0))} · Nutrition ${fmtNum(nutritionDays(today).size * NUTRI_XP)} · Corps ${bodyXp() >= 0 ? '+' : ''}${fmtNum(bodyXp())} · Quête quotidienne ${questXp() >= 0 ? '+' : ''}${fmtNum(questXp())} XP</div>
    </section>

    ${renderNutritionCard(today)}

    <section class="panel">
      <div class="streak">
        <div class="streak-flame ${streak.current ? '' : 'off'}">🔥</div>
        <div>
          <div class="streak-num">${streak.current} jour${streak.current > 1 ? 's' : ''}</div>
          <div class="streak-text">${streak.current
            ? (streak.doneToday ? 'Série active — validée aujourd\'hui ✓' : 'Série en danger : fais une activité aujourd\'hui !')
            : 'Aucune série en cours. Une activité aujourd\'hui la lance.'}
            · Record : ${streak.best} j</div>
        </div>
      </div>
    </section>

    ${needReminder ? `
    <section class="panel reminder">
      <div class="panel-head"><div class="panel-title">Alerte du Système</div></div>
      <div class="small muted">${daysSinceExport === null ? "Tu n'as jamais exporté ta sauvegarde." : `Dernière sauvegarde exportée il y a ${daysSinceExport} jours.`} Pense à l'exporter pour ne jamais perdre ta progression.</div>
      <button class="btn block small" style="margin-top:12px" data-action="export">Exporter ma sauvegarde</button>
    </section>` : ''}

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Statistiques</div><button class="btn small ghost" data-go="stats">📈 Détails ›</button></div>
      ${statsHtml}
      <button type="button" class="btn block" style="margin-top:12px" data-goto-bilan="1">⚔ Ce que j'ai accompli / mal fait aujourd'hui</button>
    </section>

    ${renderProgression(prog, started, st)}

    <section class="panel">
      <div class="kpis">
        <div class="kpi"><b>${streak.totalDays}</b><span>jours actifs</span></div>
        <div class="kpi"><b>${state.logs.length}</b><span>quêtes</span></div>
        <div class="kpi"><b>${fmtNum(state.logs.reduce((s, l) => s + (l.minutes || 0), 0) / 60)}</b><span>heures</span></div>
      </div>
    </section>

    <button class="btn primary block" data-go="today">⚔ Enregistrer une quête</button>
  `;
}

const PROG_TF = [['J', 'Jour', 1], ['S', 'Semaine', 7], ['M', 'Mois', 30]];
const GRADE_ORDER = ['E', 'D', 'C', 'B', 'A', 'S'];
function renderProgression(prog, started, st) {
  const today = todayKey();
  const pc = v => Math.round(v * 100);
  const tf = PROG_TF.find(x => x[0] === (ui.progTf || 'S')) || PROG_TF[1];
  const from = addDays(today, -tf[2]);
  const old = from >= st.first ? progressionInfo(today, st, from) : null;
  const d = old ? prog.score - old.score : null;
  // mini courbe de la progression sur la période (et un peu avant)
  const nPts = Math.min(30, Math.max(2, tf[2] + 1));
  const stepDays = Math.max(1, Math.round(tf[2] / (nPts - 1)));
  const pts = [];
  for (let i = nPts - 1; i >= 0; i--) { const dd = addDays(today, -i * stepDays); if (dd >= st.first) pts.push(progressionInfo(today, st, dd).score); }
  let spark = '';
  if (pts.length >= 2) {
    const lo = Math.min(...pts) - 0.5, hi = Math.max(...pts) + 0.5, W = 300, H = 46;
    const path = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * W).toFixed(1)},${(H - ((v - lo) / (hi - lo)) * H).toFixed(1)}`).join(' ');
    spark = `<svg class="prog-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" pathLength="1"/></svg>`;
  }
  return `
    <section class="panel prog prog-${prog.grade}" id="prog">
      <div class="prog-head">
        <div><div class="panel-title">Progression</div>
        <div class="small muted" style="margin-top:4px">${started ? `Jour ${prog.day + 1} · calculée sur toute l'année depuis le jour 0` : `L'aventure commence le ${esc(fmtDayLong(st.start))}`}</div></div>
        <div class="prog-grade" data-grade="${prog.grade}">${prog.grade}</div>
      </div>
      <div class="prog-bar"><span style="width:${Math.max(2, prog.score)}%" data-w-from="${old ? Math.max(2, old.score) : 0}"></span><i></i>
        ${PROG_GRADES.slice(0, -1).map(([g, min]) => `<em class="tick ${prog.score >= min ? 'on' : ''}" style="left:${min}%"></em>`).join('')}</div>
      <div class="prog-ticks">${PROG_GRADES.slice(0, -1).map(([g, min]) => `<b class="${prog.score >= min ? 'on' : ''}" style="left:${min}%">${g}</b>`).join('')}</div>
      <div class="prog-cap"><span><b data-count-to="${prog.score}" data-count-from="${old ? old.score : 0}" data-fmt="stat" data-dur="1300">${fmtStat(prog.score)}</b> / 100</span><span>${prog.next ? `Rang ${prog.next[0]} à ${prog.next[1]}` : 'Rang maximal'}</span></div>
      <div class="seg prog-tf">${PROG_TF.map(([k, l]) => `<button type="button" class="${k === tf[0] ? 'on' : ''}" data-prog-tf="${k}">${l}</button>`).join('')}</div>
      <div class="prog-delta ${d == null ? '' : d > 0.05 ? 'up' : d < -0.05 ? 'down' : ''}">
        ${d == null ? `<span>Pas encore assez d'historique pour cette période.</span>` : `<b>${d >= 0 ? '▲ +' : '▼ '}<span data-count-to="${Math.abs(d)}" data-count-from="0" data-fmt="stat">${fmtStat(Math.abs(d))}</span></b><span>${tf[0] === 'J' ? "depuis hier" : tf[0] === 'S' ? 'en 7 jours' : 'en 30 jours'}${old && old.grade !== prog.grade ? ` · rang ${old.grade} → ${prog.grade}` : ''}</span>`}
      </div>
      ${spark}
      <div class="prog-parts">
        <span>📊 Stats ${prog.statGain >= 0 ? '+' : ''}${fmtStat(prog.statGain)} pts</span>
        <span>🧬 Corps ${pc(prog.parts.corps)} %</span>
        <span>🍽️ Nutrition ${pc(prog.parts.nutrition)} %</span>
      </div>
    </section>`;
}
/* Palier franchi (ou perdu) depuis la dernière visite : effet lumineux */
function checkProgTier(prog) {
  let lastG = null;
  try { lastG = localStorage.getItem('monSysteme.lastGrade'); } catch (_) {}
  try { localStorage.setItem('monSysteme.lastGrade', prog.grade); } catch (_) {}
  if (!lastG || lastG === prog.grade) return;
  const up = GRADE_ORDER.indexOf(prog.grade) > GRADE_ORDER.indexOf(lastG);
  const el = $('#prog');
  if (el) el.classList.add(up ? 'tier-up' : 'tier-down');
  setTimeout(() => celebrate({ kind: up ? 'win' : 'fail', title: up ? 'PALIER DE PROGRESSION FRANCHI' : 'PALIER DE PROGRESSION PERDU', big: `${lastG} → ${prog.grade}`,
    sub: up ? 'Ta progression globale monte en grade.' : 'Ta progression globale a reculé.' }), 900);
  if (up) { sfx('levelup'); haptic(2); } else { sfx('penalty'); haptic(2); }
}

/* =========================================================
   Onglet Statistiques : où tu te situes + graphique (portrait ou paysage)
   ========================================================= */
function renderStatsTab() {
  const today = todayKey();
  const st = computeStats(state.logs, today);
  const prog = progressionInfo(today, st);
  const lv = levelInfo(totalXp());
  const rank = rankFor(lv.level);
  const pNow = powerOf(st.values), p0 = powerOf(st.base);
  const monthAgo = st.history.get(addDays(today, -30));
  const pMonth = monthAgo ? powerOf(monthAgo) : null;
  let best = 0;
  for (const v of st.history.values()) best = Math.max(best, powerOf(v));
  const b = bodyProgress();
  const comp = composition(null);
  const sign = v => (v >= 0 ? '+' : '') + fmtStat(v);
  const card = (lab, val, sub, cls = '') => `<div class="sit ${cls}"><span>${lab}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  return `
    <section class="panel">
      <div class="panel-head"><div class="panel-title">Où tu te situes</div><div class="panel-sub">${today >= st.start ? `Jour ${prog.day + 1}` : 'Avant le jour 0'}</div></div>
      <div class="sit-grid">
        ${card('Puissance', fmtStat(pNow), `jour 0 : ${fmtStat(p0)} · record ${fmtStat(best)}`)}
        ${card('Depuis le jour 0', sign(pNow - p0), 'moyenne des 4 stats', pNow - p0 > 0.05 ? 'up' : pNow - p0 < -0.05 ? 'down' : '')}
        ${card('Sur 30 jours', pMonth == null ? '—' : sign(pNow - pMonth), pMonth == null ? 'pas encore de recul' : 'par rapport au mois dernier', pMonth != null && pNow - pMonth > 0.05 ? 'up' : pMonth != null && pNow - pMonth < -0.05 ? 'down' : '')}
        ${card('Progression', `${prog.grade} · ${prog.score.toFixed(0)}`, prog.next ? `rang ${prog.next[0]} à ${prog.next[1]}` : 'rang maximal', 'prog-' + prog.grade)}
        ${card('Charisme', `Rang ${rank.letter}`, `niveau ${lv.level}`)}
        ${card('Corps', `${fmtKg(b.cur)} kg`, `${fmtPct(comp.fat)} % graisse · ${Math.round(b.progress * 100)} % de l'objectif`)}
      </div>
      <div class="sring-grid" style="margin-top:14px">${STATS.map(s => statRing(s, st.values[s.key], st.values[s.key] - st.base[s.key], { deltaLabel: 'depuis J0' })).join('')}</div>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Graphique</div><button type="button" class="btn small" data-landscape="1">⟲ Paysage</button></div>
      ${renderChart(st, today, { maxJ: 45, maxM: 12 })}
      <p class="small faint" style="margin-bottom:0">Glisse le doigt sur le graphique pour voir chaque jour. Tourne ton téléphone ou touche « Paysage » pour le voir en grand.</p>
    </section>
    ${rankGateHtml()}`;
}

/* Vue paysage plein écran (fonctionne même si la rotation de l'écran est bloquée) */
function landscapeHtml() {
  const today = todayKey();
  const st = computeStats(state.logs, today);
  const vw = window.innerWidth, vh = window.innerHeight;
  const W = Math.max(vw, vh) - 48, H = Math.min(vw, vh) - 165;
  return `
    <div class="ls-head"><span class="sheet-tag">[SYSTÈME] STATISTIQUES</span><button type="button" class="icon-btn" data-landscape-close="1" aria-label="Fermer">✕</button></div>
    ${renderChart(st, today, { W, H: Math.max(140, H), maxJ: 120, minJ: 30, labels: 10, ypad: 0.3, maxBw: 9, PL: 16, PT: 16 })}`;
}
function openLandscape() {
  closeLandscape();
  const ov = document.createElement('div');
  ov.id = 'landscape';
  ov.className = 'landscape' + (window.innerHeight > window.innerWidth ? ' rot' : '');
  ov.innerHTML = `<div class="ls-inner">${landscapeHtml()}</div>`;
  document.body.appendChild(ov);
}
function refreshLandscape() {
  const ov = $('#landscape');
  if (ov) { ov.className = 'landscape' + (window.innerHeight > window.innerWidth ? ' rot' : ''); $('.ls-inner', ov).innerHTML = landscapeHtml(); }
}
function closeLandscape() { const ov = $('#landscape'); if (ov) ov.remove(); }
window.addEventListener('resize', () => { if ($('#landscape')) refreshLandscape(); else if (currentTab === 'stats') render(); });

/* ---------- Graphique façon trading (Jour / Mois / Année) ---------- */
const CHART_SERIES = [
  { key: 'power', label: 'Puissance' }, { key: 'physique', label: 'Physique' }, { key: 'concentration', label: 'Concentration' },
  { key: 'intelligence', label: 'Intelligence' }, { key: 'discipline', label: 'Discipline' }, { key: 'xp', label: 'XP' }, { key: 'poids', label: 'Poids' },
];
function dailySeries(key, st, today) {
  const out = [];
  if (key === 'xp') {
    const perDay = new Map();
    for (const l of state.logs) perDay.set(l.date, (perDay.get(l.date) || 0) + l.xp);
    for (const d of nutritionDays(today)) perDay.set(d, (perDay.get(d) || 0) + NUTRI_XP);
    let cum = 0;
    for (const d of st.history.keys()) { cum += perDay.get(d) || 0; out.push({ d, v: cum }); }
    return out;
  }
  if (key === 'poids') {
    if (!state.weights.length) return out;
    let cur = state.body.startWeight, i = 0;
    const ws = state.weights;
    let d = ws[0].date < st.first ? ws[0].date : st.first;
    while (d <= today) {
      while (i < ws.length && ws[i].date <= d) { cur = ws[i].kg; i++; }
      out.push({ d, v: cur });
      d = addDays(d, 1);
    }
    return out;
  }
  for (const [d, vals] of st.history) out.push({ d, v: key === 'power' ? powerOf(vals) : vals[key] });
  return out;
}
/* Vues : Jour (derniers jours), Semaine (7 jours), Mois (jours du mois), Année (mois de l'année).
   Les cases sans données restent vides (pas de faux zéros). */
const CHART_TF = [['J', 'Jour'], ['S', 'Semaine'], ['M', 'Mois'], ['A', 'Année']];
const CHARTS = {};
let chartSeq = 0;
function chartSlots(pts, tf, today, max, min) {
  const idx = new Map(pts.map((p, i) => [p.d, i]));
  const dayC = d => { if (!idx.has(d)) return null; const i = idx.get(d), v = pts[i].v, o = i ? pts[i - 1].v : v; return { o, c: v, h: Math.max(o, v), l: Math.min(o, v) }; };
  if (tf === 'S') return Array.from({ length: 7 }, (_, i) => { const d = addDays(today, i - 6); return { k: d, kind: 'd', c: dayC(d) }; });
  if (tf === 'M') {
    const ym = today.slice(0, 7), [y, m] = ym.split('-').map(Number), n = new Date(y, m, 0).getDate();
    return Array.from({ length: n }, (_, i) => { const d = `${ym}-${pad2(i + 1)}`; return { k: d, kind: 'd', c: d <= today ? dayC(d) : null }; });
  }
  if (tf === 'A') {
    const y = today.slice(0, 4);
    return Array.from({ length: 12 }, (_, i) => {
      const ym = `${y}-${pad2(i + 1)}`, ps = pts.filter(p => p.d.startsWith(ym));
      if (!ps.length) return { k: ym, kind: 'm', c: null };
      const i0 = pts.indexOf(ps[0]), o = i0 ? pts[i0 - 1].v : ps[0].v, vs = ps.map(p => p.v);
      return { k: ym, kind: 'm', c: { o, c: vs[vs.length - 1], h: Math.max(o, ...vs), l: Math.min(o, ...vs) } };
    });
  }
  // Jour : les derniers jours, avec un minimum de cases pour ne pas être trop « zoomé »
  const N = Math.max(min || 14, Math.min(max || 30, pts.length));
  return Array.from({ length: N }, (_, i) => { const d = addDays(today, i - N + 1); return { k: d, kind: 'd', c: dayC(d) }; });
}
function renderChart(st, today, opt = {}) {
  const key = ui.chartKey || 'power';
  const tf = CHART_TF.some(x => x[0] === ui.chartTf) ? ui.chartTf : 'J';
  const pts = dailySeries(key, st, today);
  const slots = chartSlots(pts, tf, today, opt.maxJ, opt.minJ);
  const filled = slots.map((s, i) => [s, i]).filter(([s]) => s.c);
  const inverse = key === 'poids';
  const head = `
    <div class="chart-keys">${CHART_SERIES.map(c => `<button type="button" class="chip small ${c.key === key ? 'on' : ''}" data-chart-key="${c.key}">${c.label}</button>`).join('')}</div>
    <div class="seg chart-tf">${CHART_TF.map(([k, l]) => `<button type="button" class="${k === tf ? 'on' : ''}" data-chart-tf="${k}">${l}</button>`).join('')}</div>`;
  if (!filled.length) return head + `<div class="empty"><span class="sys">[SYSTÈME]</span>Pas encore de données sur cette période. Le graphique se remplit jour après jour.</div>`;
  const W = opt.W || 340, H = opt.H || 190, PL = opt.PL || 6, PR = 44, PT = opt.PT || 10, PB = 22;
  let lo = Math.min(...filled.map(([s]) => s.c.l)), hi = Math.max(...filled.map(([s]) => s.c.h));
  if (hi - lo < 0.5) { hi += 0.25; lo -= 0.25; }
  const pad = (hi - lo) * (opt.ypad || 0.1); lo -= pad; hi += pad;
  const n = slots.length, step = (W - PL - PR) / n, bw = Math.max(2, Math.min(opt.maxBw || 18, step * 0.62));
  const Y = v => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const X = i => PL + step * i + step / 2;
  const fmtV = v => key === 'xp' ? fmtNum(v) : (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
  const lab = s => s.kind === 'm' ? MONTHS_SHORT[+s.k.slice(5) - 1] : tf === 'S' ? DAYS[parseKey(s.k).getDay()].slice(0, 3) + '.' : String(+s.k.slice(8));
  const every = Math.ceil(n / (opt.labels || 6));
  const body = slots.map((s, i) => {
    const x = X(i);
    const lbl = i % every === 0 || (tf === 'S') ? `<text x="${x}" y="${H - 6}" class="cx ${s.c ? '' : 'none'}">${lab(s)}</text>` : '';
    if (!s.c) return lbl;
    const c = s.c, up = inverse ? c.c <= c.o : c.c >= c.o;
    const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c));
    return `<g class="cdl ${up ? 'up' : 'down'}" style="animation-delay:${i * 25}ms">
      <line x1="${x}" x2="${x}" y1="${Y(c.h).toFixed(1)}" y2="${Y(c.l).toFixed(1)}"/>
      <rect x="${(x - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.5, y2 - y1).toFixed(1)}" rx="1.5"/>
      ${lbl}</g>`;
  }).join('');
  // courbe par morceaux continus (rien entre deux trous)
  const segs = [];
  let cur = [];
  slots.forEach((s, i) => { if (s.c) cur.push([X(i), Y(s.c.c)]); else if (cur.length) { segs.push(cur); cur = []; } });
  if (cur.length) segs.push(cur);
  const paths = segs.map(sg => sg.map(([x, y], j) => `${j ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  const areas = segs.filter(sg => sg.length > 1).map(sg => `${sg.map(([x, y], j) => `${j ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} L${sg[sg.length - 1][0].toFixed(1)},${H - PB} L${sg[0][0].toFixed(1)},${H - PB} Z`);
  const [lastS, lastI] = filled[filled.length - 1];
  const prevS = filled.length > 1 ? filled[filled.length - 2][0] : null;
  const last = lastS.c, ch = last.c - last.o, chPrev = prevS ? prevS.c.c - prevS.c.o : 0;
  const pctCh = last.o ? (ch / Math.abs(last.o)) * 100 : 0;
  const good = inverse ? ch < 0 : ch > 0;
  const better = prevS ? (inverse ? ch < chPrev : ch > chPrev) : false;
  const per = lastS.kind === 'm' ? 'ce mois-ci' : lastS.k === today ? "aujourd'hui" : 'au dernier jour noté';
  const perPrev = lastS.kind === 'm' ? 'le mois d’avant' : 'le jour d’avant';
  const grid = [0, 0.5, 1].map(f => { const v = lo + (hi - lo) * f; return `<line x1="${PL}" x2="${W - PR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="cg"/><text x="${W - PR + 4}" y="${(Y(v) + 3).toFixed(1)}" class="cy">${fmtV(v)}</text>`; }).join('');
  const cid = 'ch' + (++chartSeq);
  CHARTS[cid] = { slots, W, H, PL, PT, PB, step, key, tf, fmtV, hist: st.history, inverse, Y };
  Object.keys(CHARTS).slice(0, -8).forEach(k => delete CHARTS[k]);
  const dotR = n > 60 ? 1.4 : n > 40 ? 1.8 : 2.6;
  return head + `
    <div class="chart-sum ${good ? 'good' : Math.abs(ch) < 1e-9 ? '' : 'bad'}">
      <b>${fmtV(last.c)}</b> <span>${ch >= 0 ? '▲ +' : '▼ '}${fmtV(Math.abs(ch)) === '0,0' && key !== 'xp' ? Math.abs(ch).toFixed(2).replace('.', ',') : fmtV(Math.abs(ch))} (${pctCh >= 0 ? '+' : ''}${pctCh.toFixed(1).replace('.', ',')} %) ${per}</span>
    </div>
    <div class="chart-box">
      <svg class="chart" data-cid="${cid}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Graphique : glisse le doigt pour voir chaque point">
        <defs>
          <linearGradient id="clg-${cid}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#9a7bff"/><stop offset="1" stop-color="#38e0ff"/></linearGradient>
          <linearGradient id="cla-${cid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#7a6bff" stop-opacity=".35"/><stop offset="1" stop-color="#38c8ff" stop-opacity="0"/></linearGradient>
        </defs>
        ${grid}
        <line x1="${PL}" x2="${W - PR}" y1="${Y(last.c).toFixed(1)}" y2="${Y(last.c).toFixed(1)}" class="clast"/>
        ${body}
        ${areas.map(a => `<path class="carea" d="${a}" fill="url(#cla-${cid})"/>`).join('')}
        ${paths.map(p => `<path class="cline" d="${p}" pathLength="1" stroke="url(#clg-${cid})"/>`).join('')}
        ${filled.map(([s, i]) => `<circle class="cdot ${i === lastI ? 'last' : ''}" cx="${X(i).toFixed(1)}" cy="${Y(s.c.c).toFixed(1)}" r="${i === lastI ? 4 : dotR}" style="animation-delay:${(0.2 + (i / n) * 1.3).toFixed(2)}s"/>`).join('')}
        <line class="cscrub" x1="0" x2="0" y1="${PT}" y2="${H - PB}"/>
        <circle class="cscrub-dot" r="5" cx="-10" cy="-10"/>
      </svg>
      <div class="cbubble" hidden></div>
    </div>
    <div class="small ${better ? 'trend-up' : 'muted'}" style="margin-top:6px">${prevS ? (better ? `🔥 Tu te surpasses : mieux que ${perPrev}.` : `Moins bien que ${perPrev}. Le Système attend mieux.`) : 'Glisse le doigt sur le graphique pour voir chaque point.'}</div>`;
}
/* Doigt qui glisse : une bulle suit le doigt (jour, date, mois, année, valeurs) */
function chartScrub(svg, ev) {
  const ch = CHARTS[svg.dataset.cid];
  if (!ch) return;
  const r = svg.getBoundingClientRect();
  const rot = !!svg.closest('.landscape.rot'); // vue paysage tournée de 90°
  const lw = rot ? r.height : r.width, lh = rot ? r.width : r.height;
  const x = (rot ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width) * ch.W;
  const n = ch.slots.length;
  let i = Math.max(0, Math.min(n - 1, Math.floor((x - ch.PL) / ch.step)));
  if (!ch.slots[i].c) { let best = -1; for (let d = 1; d < n; d++) { if (i - d >= 0 && ch.slots[i - d].c) { best = i - d; break; } if (i + d < n && ch.slots[i + d].c) { best = i + d; break; } } if (best < 0) return; i = best; }
  const s = ch.slots[i], c = s.c, cx = ch.PL + ch.step * i + ch.step / 2, cy = ch.Y(c.c);
  const line = svg.querySelector('.cscrub'), dot = svg.querySelector('.cscrub-dot');
  line.setAttribute('x1', cx); line.setAttribute('x2', cx); line.classList.add('on');
  dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.classList.add('on');
  const d = s.kind === 'm' ? null : parseKey(s.k);
  const date = d ? `${capFirst(DAYS[d.getDay()])} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : `${capFirst(MONTHS[+s.k.slice(5) - 1])} ${s.k.slice(0, 4)}`;
  const delta = c.c - c.o;
  const label = (CHART_SERIES.find(x => x.key === ch.key) || {}).label || '';
  const vals = d && ch.hist && ch.hist.get(s.k) && ['power', 'physique', 'concentration', 'intelligence', 'discipline'].includes(ch.key)
    ? `<div class="cb-stats">${STATS.map(t => `<span style="color:${STAT_COL[t.key]}">${t.icon} ${fmtStat(ch.hist.get(s.k)[t.key])}</span>`).join('')}</div>` : '';
  const bub = svg.parentElement.querySelector('.cbubble');
  bub.innerHTML = `<div class="cb-date">${esc(date)}</div><div class="cb-val"><b>${ch.fmtV(c.c)}</b> ${esc(label)} <span class="${(ch.inverse ? delta < 0 : delta > 0) ? 'trend-up' : delta === 0 ? '' : 'trend-down'}">${delta >= 0 ? '▲ +' : '▼ −'}${ch.key !== 'xp' && Math.abs(delta) < 0.05 ? Math.abs(delta).toFixed(2).replace('.', ',') : ch.fmtV(Math.abs(delta))}</span></div>${s.kind === 'm' ? `<div class="cb-hl">plus haut ${ch.fmtV(c.h)} · plus bas ${ch.fmtV(c.l)}</div>` : ''}${vals}`;
  bub.hidden = false;
  const px = (cx / ch.W) * lw, bw = bub.offsetWidth || 180, boxW = svg.parentElement.clientWidth || lw;
  bub.style.left = Math.max(0, Math.min(boxW - bw, px - bw / 2)) + 'px';
  bub.style.top = Math.max(0, (cy / ch.H) * lh - bub.offsetHeight - 14) + 'px';
  if (chartScrub.last !== i) { chartScrub.last = i; if (navigator.vibrate) navigator.vibrate(4); }
}
function chartScrubEnd(svg) {
  setTimeout(() => {
    if (chartScrub.active) return;
    const box = svg && svg.parentElement;
    if (!box) return;
    box.querySelector('.cbubble').hidden = true;
    svg.querySelectorAll('.cscrub, .cscrub-dot').forEach(el => el.classList.remove('on'));
  }, 1800);
}
document.addEventListener('pointerdown', e => { const svg = e.target.closest && e.target.closest('svg.chart'); if (!svg) return; chartScrub.active = svg; chartScrub(svg, e); });
document.addEventListener('pointermove', e => { const svg = chartScrub.active || (e.pointerType === 'mouse' && e.target.closest && e.target.closest('svg.chart')); if (svg) chartScrub(svg, e); });
['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, () => { const svg = chartScrub.active; chartScrub.active = null; if (svg) chartScrubEnd(svg); }));

/* =========================================================
   CORPS : hologramme, poids, transformation, photos
   ========================================================= */
const fmtKg = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
const POSES = [
  { key: 'face', label: 'Face' },
  { key: 'profil', label: 'Profil' },
  { key: 'dos', label: 'Dos' },
];
const poseLabel = k => (POSES.find(p => p.key === k) || POSES[0]).label;

function currentWeight() {
  return state.weights.length ? state.weights[state.weights.length - 1].kg : state.body.startWeight;
}
function bodyProgress() {
  const start = state.body.startWeight, goal = state.body.goalWeight, cur = currentWeight();
  const span = goal - start;
  const progress = span === 0 ? 1 : Math.max(0, Math.min(1, (cur - start) / span));
  return { start, goal, cur, progress, lost: start - cur, left: Math.max(0, Math.abs(cur - goal)) };
}

/* Composition corporelle.
   Priorité : 1) valeurs de ta balance (pesée), 2) mensurations (formule US Navy),
   3) estimation à partir des photos de départ, ajustée quand le poids change
   (on considère qu'environ 75 % du poids perdu est de la graisse). */
const LEAN_MUSCLE = 0.53; // part de muscle squelettique dans la masse maigre (homme adulte, moyenne)
function composition(kg) {
  const b = state.body;
  const W = kg != null ? kg : currentWeight();
  const lastScale = [...state.weights].reverse().find(w => w.fat != null);
  let fat, src, muscle = null;
  if (kg == null && lastScale) {
    // on part de la dernière mesure de la balance, ajustée si le poids a bougé depuis
    const fm = lastScale.kg * lastScale.fat / 100 - 0.75 * (lastScale.kg - W);
    fat = (fm / W) * 100;
    muscle = lastScale.muscle;
    src = 'balance';
  } else if (b.heightCm && b.waistCm && b.neckCm && b.waistCm > b.neckCm) {
    const navy = 495 / (1.0324 - 0.19077 * Math.log10(b.waistCm - b.neckCm) + 0.15456 * Math.log10(b.heightCm)) - 450;
    const fm = (navy / 100) * currentWeight() - 0.75 * (currentWeight() - W);
    fat = (fm / W) * 100;
    src = 'mensurations';
  } else {
    const fm = b.startWeight * (b.fatStart / 100) - 0.75 * (b.startWeight - W);
    fat = (fm / W) * 100;
    src = 'estimation';
  }
  fat = Math.max(4, Math.min(60, fat));
  if (muscle == null) muscle = (100 - fat) * LEAN_MUSCLE;
  return { fat, muscle, src };
}
const fmtPct = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
const bmiLabel = b => (b < 18.5 ? 'maigre' : b < 25 ? 'normal' : b < 30 ? 'surpoids' : 'obésité');

/* Aperçu du corps par rang de Charisme, calculé selon TON objectif :
   E = départ, D/C/B = étapes, A = objectif atteint, S = au-delà (plus sec, plus musclé). */
const RANK_BODY = { E: 0, D: 0.25, C: 0.5, B: 0.75, A: 1, S: 1.3 };
const RANK_TINT = {
  E: ['#8fb0c8', '#d8ecff', '#a9c6dd'], D: ['#3fe0a0', '#c8ffe8', '#6fffc0'], C: ['#2fc4ff', '#9fe9ff', '#7fe0ff'],
  B: ['#4f7dff', '#b8ccff', '#8aa8ff'], A: ['#a77bff', '#e3d4ff', '#c4a6ff'], S: ['#ffc35a', '#fff0c0', '#ffd27a'],
};
function holoView() {
  const b = bodyProgress();
  if (ui.day0) {
    const comp = composition(b.start);
    comp.src = 'estimation';
    return { kind: 'day0', label: 'JOUR 0', progress: 0, kg: b.start, comp, tint: RANK_TINT.E };
  }
  if (ui.holoRank) {
    const r = ui.holoRank, p = RANK_BODY[r];
    const kg = r === 'S' ? b.goal : b.start - Math.min(1, p) * (b.start - b.goal);
    const c0 = composition(b.start), gf = state.body.goalFat, gm = state.body.goalMuscle;
    const t = Math.min(1, p);
    const comp = { fat: c0.fat + (gf - c0.fat) * t, muscle: c0.muscle + (gm - c0.muscle) * t, src: 'objectif' };
    if (r === 'S') { comp.fat = Math.max(7, gf - 4); comp.muscle = gm + 2; }
    return { kind: 'rank', rank: r, label: `RANG ${r}`, progress: p, kg, comp, tint: RANK_TINT[r] };
  }
  return { kind: 'now', label: '', progress: b.progress, kg: b.cur, comp: composition(null), tint: null };
}

function renderBodyPanel(today) {
  const b = bodyProgress();
  const v = holoView();
  const pct = Math.round(b.progress * 1000) / 10;
  const monthKey = today.slice(0, 7);
  const photoThisMonth = bodyPhotos().some(p => p.date.slice(0, 7) === monthKey);
  const lastW = state.weights[state.weights.length - 1];
  const sinceW = lastW ? daysBetween(lastW.date, today) : null;
  const done = b.progress >= 1;
  const comp = v.comp;
  const preview = v.kind !== 'now';
  const lost = b.start - v.kg;
  const rankDesc = v.kind === 'rank' ? (v.rank === 'S' ? 'Au-delà : physique de mannequin pro' : v.rank === 'A' ? `Objectif ${fmtKg(state.body.goalWeight)} kg · < ${state.body.goalFat + 1} % de graisse` : v.rank === 'E' ? 'Point de départ' : `${Math.round(RANK_BODY[v.rank] * 100)} % du chemin`) : '';
  return `
    <section class="panel lab ${v.kind === 'rank' ? 'rank-' + v.rank : ''}">
      <div class="lab-head">
        <span class="lab-tag">[SYSTÈME] ${v.kind === 'day0' ? 'ARCHIVE · JOUR 0' : v.kind === 'rank' ? 'SIMULATION · RANG ' + v.rank : 'SCAN CORPOREL'}</span>
        <span class="lab-live ${preview ? 'sim' : ''}"><i></i>${preview ? 'SIMULATION' : 'EN DIRECT'}</span>
      </div>
      <div class="holo-wrap ${preview ? 'preview' : ''}" ${v.tint ? `style="--tint:${v.tint[0]}"` : ''}>
        <div id="holo" class="holo"><div class="holo-loading">Initialisation du scan…</div></div>
        <span class="hc tl"></span><span class="hc tr"></span><span class="hc bl"></span><span class="hc br"></span>
        <div class="hud hud-left">
          <div><small>${v.kind === 'rank' ? 'POIDS VISÉ' : 'POIDS'}</small><b data-count-to="${v.kg}" data-count-from="${v.kind === 'now' ? cf('kg', v.kg) : v.kg}" data-fmt="kg">${fmtKg(v.kg)}</b><i>kg</i></div>
          <div><small>IMC</small><b>${fmtG(Math.round((v.kg / Math.pow(state.body.heightCm / 100, 2)) * 10) / 10)}</b><i>${bmiLabel(v.kg / Math.pow(state.body.heightCm / 100, 2))}</i></div>
          <div><small>GRAISSE${comp.src === 'balance' && !preview ? '' : ' ≈'}</small><b class="fat">${fmtPct(comp.fat)}</b><i>%</i></div>
        </div>
        <div class="hud hud-right">
          <div><small>PERDU</small><b class="${lost > 0 ? 'good' : ''}">${lost > 0 ? '−' : ''}${fmtKg(Math.abs(lost))}</b><i>kg</i></div>
          <div><small>RESTANT</small><b>${fmtKg(Math.max(0, v.kg - b.goal))}</b><i>kg</i></div>
          <div><small>MUSCLES${comp.src === 'balance' && !preview && state.weights.some(w => w.muscle != null) ? '' : ' ≈'}</small><b class="muscle">${fmtPct(comp.muscle)}</b><i>%</i></div>
        </div>
        <div class="hud-src">${v.kind === 'rank' ? esc(rankDesc.toUpperCase()) : v.kind === 'day0' ? esc(fmtDayLong(state.startDate).toUpperCase()) : comp.src === 'balance' ? 'SOURCE : BALANCE' : comp.src === 'mensurations' ? 'SOURCE : MENSURATIONS' : 'ESTIMATION · PHOTOS'}</div>
        ${v.kind === 'rank' ? `<div class="holo-rank-big">${v.rank}</div>` : ''}
        <div class="holo-mode">
          <button type="button" class="${v.kind === 'now' ? 'on' : ''}" data-holo-mode="now">Maintenant</button>
          <button type="button" class="${v.kind === 'rank' && v.rank === 'A' ? 'on' : ''}" data-rank-preview="A">Objectif ${fmtKg(b.goal)} kg</button>
          ${v.kind === 'rank' && v.rank !== 'A' ? `<button type="button" class="on">Rang ${v.rank}</button>` : ''}
        </div>
      </div>

      <div class="load ${done ? 'done' : ''}">
        <div class="load-top"><span>${done ? 'TRANSFORMATION TERMINÉE' : 'TRANSFORMATION EN COURS'}</span><b><span data-count-to="${pct}" data-count-from="${cf('progress', pct)}" data-fmt="pct">${String(pct).replace('.', ',')}</span> %</b></div>
        <div class="load-bar"><span style="width:${Math.max(pct, 1.5)}%" ${anim.prev ? `data-w-from="${Math.max(anim.prev.progress, 1.5)}"` : ''}></span></div>
        <div class="load-scale"><span>${fmtKg(b.start)} kg</span><span>${fmtKg(b.cur)} kg</span><span>${fmtKg(b.goal)} kg</span></div>
      </div>

      <div class="btn-row" style="margin-top:14px">
        <button class="btn" data-action="weigh">⚖️ Pesée</button>
        <button class="btn" data-action="photos">📷 Photos${bodyPhotos().length ? ` (${bodyPhotos().length})` : ''}</button>
      </div>
      ${!photoThisMonth ? `<div class="lab-note">📸 Photo du mois de ${MONTHS[+monthKey.slice(5) - 1]} pas encore faite : face, profil et dos.</div>` : ''}
      ${sinceW === null ? `<div class="lab-note">⚖️ Fais ta première pesée pour lancer la barre de transformation.</div>`
        : sinceW >= 7 ? `<div class="lab-note">⚖️ Dernière pesée il y a ${sinceW} jours.</div>` : ''}
    </section>`;
}

/* ---------- Pesée ---------- */
function weightChartSvg() {
  const pts = state.weights.slice(-30);
  if (pts.length < 2) return '';
  const W = 320, H = 120, P = 10;
  const vals = pts.map(p => p.kg).concat([state.body.goalWeight]);
  const lo = Math.min(...vals) - 0.5, hi = Math.max(...vals) + 0.5;
  const t0 = parseKey(pts[0].date).getTime(), t1 = parseKey(pts[pts.length - 1].date).getTime() || t0 + 1;
  const X = d => P + ((parseKey(d).getTime() - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const Y = v => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)},${Y(p.kg).toFixed(1)}`).join(' ');
  const gy = Y(state.body.goalWeight).toFixed(1);
  return `
    <svg class="wchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Courbe de poids">
      <line x1="0" x2="${W}" y1="${gy}" y2="${gy}" class="goal-line"/>
      <path d="${line}" class="w-line"/>
      ${pts.map(p => `<circle cx="${X(p.date).toFixed(1)}" cy="${Y(p.kg).toFixed(1)}" r="2.6" class="w-dot"/>`).join('')}
    </svg>
    <div class="small faint" style="display:flex;justify-content:space-between;margin-top:4px"><span>${fmtDayShort(pts[0].date)}</span><span style="color:var(--warn)">— objectif ${fmtKg(state.body.goalWeight)} kg</span><span>${fmtDayShort(pts[pts.length - 1].date)}</span></div>`;
}

function weighBody() {
  const list = state.weights.slice(-8).reverse();
  return `
    <label class="field"><span>Poids de ce matin (kg)</span>
      <input class="input" id="w-input" inputmode="decimal" placeholder="${fmtKg(currentWeight())}" autocomplete="off" style="font-size:28px;font-weight:800;text-align:center">
    </label>
    <div class="btn-row">
      <label class="field"><span>Graisse % (balance)</span><input class="input" id="w-fat" inputmode="decimal" placeholder="facultatif" autocomplete="off"></label>
      <label class="field"><span>Muscles % (balance)</span><input class="input" id="w-muscle" inputmode="decimal" placeholder="facultatif" autocomplete="off"></label>
    </div>
    <button type="button" class="btn primary block" data-w-save="1">Enregistrer la pesée</button>
    ${state.weights.length >= 2 ? `<div class="field" style="margin-top:18px"><span>Évolution</span>${weightChartSvg()}</div>` : ''}
    ${list.length ? `<div class="field" style="margin-top:14px"><span>Dernières pesées</span>
      ${list.map(w => `<div class="entry"><div class="entry-body"><div class="entry-title">${fmtKg(w.kg)} kg${w.fat != null ? ` · ${fmtPct(w.fat)} % graisse` : ''}${w.muscle != null ? ` · ${fmtPct(w.muscle)} % muscles` : ''}</div><div class="entry-meta">${esc(fmtDayLong(w.date))}</div></div><button type="button" class="icon-btn danger" data-w-del="${esc(w.id)}" aria-label="Supprimer">✕</button></div>`).join('')}
    </div>` : ''}`;
}

function openWeighSheet() {
  openSheet({
    tag: '[SYSTÈME] Pesée',
    title: '⚖️ Nouvelle pesée',
    body: `<div id="weigh-body">${weighBody()}</div>`,
    buttons: [{ label: 'Fermer', value: null, cls: 'ghost' }],
    onMount(sheet, close) {
      sheet.addEventListener('click', e => {
        if (e.target.closest('[data-w-save]')) {
          const raw = $('#w-input', sheet).value.replace(',', '.').trim();
          const kg = Math.round(parseFloat(raw) * 10) / 10;
          if (!Number.isFinite(kg) || kg < 30 || kg > 300) { toast('Poids invalide', 'Exemple : 95,8', 'warn'); return; }
          const opt = (id, a, b) => { const v = parseFloat($(id, sheet).value.replace(',', '.')); return Number.isFinite(v) && v >= a && v <= b ? Math.round(v * 10) / 10 : null; };
          close(null);
          addWeight(kg, opt('#w-fat', 3, 70), opt('#w-muscle', 10, 80));
          return;
        }
        const del = e.target.closest('[data-w-del]');
        if (del) {
          tomb(del.dataset.wDel);
          state.weights = state.weights.filter(w => w.id !== del.dataset.wDel);
          save();
          $('#weigh-body', sheet).innerHTML = weighBody();
          render();
        }
      });
    },
  });
}

const MILESTONES = [0.25, 0.5, 0.75, 1];
function addWeight(kg, fat = null, muscle = null) {
  const before = bodyProgress();
  const lvBefore = levelInfo(totalXp());
  snapshotForAnim();
  const date = todayKey();
  state.weights.filter(w => w.date === date).forEach(w => tomb(w.id)); // une pesée par jour
  state.weights = state.weights.filter(w => w.date !== date);
  state.weights.push({ id: uid(), date, kg, fat, muscle, ts: Date.now() });
  state.weights.sort((a, b) => a.date.localeCompare(b.date));
  save();
  const after = bodyProgress();
  render();
  const prev = state.weights.length >= 2 ? state.weights[state.weights.length - 2].kg : before.start;
  const d = kg - prev;
  const lvAfter = levelInfo(totalXp());
  const dxp = Math.round(-d * BODY_XP_PER_KG);
  toast('Pesée enregistrée', `${fmtKg(kg)} kg · ${Math.abs(d) < 0.05 ? 'stable' : (d < 0 ? '−' : '+') + fmtKg(Math.abs(d)) + ' kg'} · ${dxp >= 0 ? '+' : ''}${fmtNum(dxp)} XP · transformation ${Math.round(after.progress * 100)} %`, d > 0.05 ? 'warn' : 'info');
  if (d < -0.05) { sfx('success'); haptic(); } else if (d > 0.05) { sfx('fail'); haptic(2); }
  if (lvAfter.level > lvBefore.level) {
    const rb = rankFor(lvBefore.level), ra = rankFor(lvAfter.level);
    setTimeout(() => showLevelUp(lvAfter.level, ra.letter !== rb.letter ? ra : null), 1100);
  } else if (lvAfter.level < lvBefore.level) {
    setTimeout(() => { toast('Niveau perdu', `Niveau ${lvBefore.level} → ${lvAfter.level} : le poids est remonté.`, 'warn'); sfx('penalty'); haptic(2); }, 1000);
  }
  const crossed = MILESTONES.filter(m => before.progress < m && after.progress >= m).pop();
  if (crossed) {
    setTimeout(() => openSheet({
      center: true,
      tag: '[SYSTÈME] Alerte',
      body: `<div class="levelup"><div class="levelup-txt">${crossed === 1 ? 'OBJECTIF ATTEINT' : 'PALIER DE TRANSFORMATION'}</div>
        <div class="levelup-big">${Math.round(crossed * 100)} %</div>
        <p>${crossed === 1 ? `Tu as atteint ${fmtKg(state.body.goalWeight)} kg. Le Système te reconnaît.` : `Tu as parcouru ${Math.round(crossed * 100)} % du chemin vers ${fmtKg(state.body.goalWeight)} kg. Continue.`}</p></div>`,
      buttons: [{ label: 'Continuer', value: true, cls: 'primary' }],
    }), 500);
  }
}

/* ---------- Photos (stockées dans le téléphone, IndexedDB) ---------- */
let photos = []; // { id, kind: 'body'|'meal', date, pose, meal, kg, blob }
let photoTarget = null;
const bodyPhotos = () => photos.filter(p => p.kind !== 'meal');
const photoUrls = new Map();
const photoUrl = p => { if (!photoUrls.has(p.id)) photoUrls.set(p.id, URL.createObjectURL(p.blob)); return photoUrls.get(p.id); };

const PhotoDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('monSysteme', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('photos', mode);
      const out = fn(t.objectStore('photos'));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  all() { return this.tx('readonly', s => s.getAll()); },
  put(p) { return this.tx('readwrite', s => s.put(p)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
  clear() { return this.tx('readwrite', s => s.clear()); },
};

async function loadPhotos() {
  try {
    photos = ((await PhotoDB.all()) || []).filter(p => p && p.blob && isValidKey(p.date));
    photos.sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
  } catch (e) {
    console.warn('Photos indisponibles', e);
    photos = [];
  }
}

function blobToImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Image illisible')); };
    img.src = url;
  });
}
async function resizePhoto(file, max = 1400) {
  const img = await blobToImage(file);
  const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * r), h = Math.round(img.naturalHeight * r);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Conversion impossible')), 'image/jpeg', 0.85));
}

async function addPhotos(files) {
  let n = 0;
  for (const f of files) {
    try {
      const blob = await resizePhoto(f);
      const tg = photoTarget || { kind: 'body' };
      const p = tg.kind === 'meal'
        ? { id: uid(), kind: 'meal', meal: tg.meal, date: tg.date, ts: Date.now(), pose: 'face', kg: currentWeight(), blob }
        : { id: uid(), kind: 'body', date: todayKey(), ts: Date.now(), pose: ui.photoPose, kg: currentWeight(), blob };
      await PhotoDB.put(p);
      photos.push(p);
      n++;
    } catch (e) {
      console.error(e);
      toast('Photo ignorée', e.message || 'Format non pris en charge', 'warn');
    }
  }
  if (n) {
    toast('Archive mise à jour', `${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} · ${photoTarget && photoTarget.kind === 'meal' ? 'repas ' + mealLabel(photoTarget.meal).label : poseLabel(ui.photoPose)}`);
    refreshPhotoSheet();
    render();
  }
}

function photosBody() {
  const pose = ui.photoPose;
  const same = bodyPhotos().filter(p => p.pose === pose);
  const first = same[0], lastP = same[same.length - 1];
  const byMonth = new Map();
  [...bodyPhotos()].reverse().forEach(p => {
    const k = p.date.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(p);
  });
  const card = (p, label) => `
    <button type="button" class="cmp-card" data-photo="${esc(p.id)}">
      <img src="${photoUrl(p)}" alt="">
      <span><b>${label}</b> · ${esc(fmtDayShort(p.date))} · ${fmtKg(p.kg)} kg</span>
    </button>`;
  return `
    <div class="seg" style="margin-bottom:12px">
      ${POSES.map(p => `<button type="button" class="${p.key === pose ? 'on' : ''}" data-pose="${p.key}">${p.label}</button>`).join('')}
    </div>
    <button type="button" class="btn primary block" data-photo-add="1">📷 Ajouter une photo · ${poseLabel(pose)}</button>
    <p class="small faint" style="margin:8px 0 0">Prends-toi toujours au même endroit, même lumière, même distance : la comparaison sera plus parlante.</p>

    ${same.length >= 2 ? `
      <div class="field" style="margin-top:18px"><span>Avant / Maintenant · ${poseLabel(pose)}</span>
        <div class="cmp">${card(first, 'Avant')}${card(lastP, 'Maintenant')}</div>
        <div class="small center" style="margin-top:8px;color:var(--good)">${first.kg - lastP.kg > 0 ? `−${fmtKg(first.kg - lastP.kg)} kg entre ces deux photos` : 'Continue, la différence va apparaître.'}</div>
      </div>` : ''}

    <div class="field" style="margin-top:18px"><span>Archives</span>
      ${bodyPhotos().length ? [...byMonth].map(([k, list]) => `
        <div class="ph-month">${MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)}</div>
        <div class="ph-grid">${list.map(p => `
          <button type="button" class="ph" data-photo="${esc(p.id)}">
            <img src="${photoUrl(p)}" alt="" loading="lazy">
            <span>${poseLabel(p.pose)} · ${fmtKg(p.kg)}</span>
          </button>`).join('')}</div>`).join('')
        : `<div class="empty"><span class="sys">[SYSTÈME]</span>Aucune photo. Commence par face, profil et dos.</div>`}
    </div>`;
}

let photoSheet = null;
function refreshPhotoSheet() {
  if (photoSheet && photoSheet.isConnected) $('#photos-body', photoSheet).innerHTML = photosBody();
}

function openPhotosSheet() {
  openSheet({
    tag: '[SYSTÈME] Archives corporelles',
    title: '📷 Mes photos',
    body: `<div id="photos-body">${photosBody()}</div>`,
    buttons: [{ label: 'Fermer', value: null, cls: 'ghost' }],
    onMount(sheet) {
      photoSheet = sheet;
      sheet.addEventListener('click', e => {
        const pose = e.target.closest('[data-pose]');
        if (pose) { ui.photoPose = pose.dataset.pose; refreshPhotoSheet(); return; }
        if (e.target.closest('[data-photo-add]')) { photoTarget = { kind: 'body' }; $('#photo-file').click(); return; }
        const ph = e.target.closest('[data-photo]');
        if (ph) openPhotoViewer(ph.dataset.photo);
      });
    },
  });
}

function openPhotoViewer(id) {
  const p = photos.find(x => x.id === id);
  if (!p) return;
  openSheet({
    center: true,
    tag: `[SYSTÈME] ${p.kind === 'meal' ? 'Repas · ' + mealLabel(p.meal).label : poseLabel(p.pose)}`,
    body: `<img class="viewer-img" src="${photoUrl(p)}" alt="">
      <p class="center" style="margin:10px 0 0">${esc(fmtDayLong(p.date))} · <b style="color:var(--neon-2)">${fmtKg(p.kg)} kg</b></p>`,
    buttons: [{ label: 'Fermer', value: 'close', cls: 'primary' }, { label: 'Supprimer la photo', value: 'del', cls: 'danger' }],
  }).then(async v => {
    if (v !== 'del') return;
    if (!(await confirmBox('Supprimer cette photo ?', 'Elle sera effacée de ce téléphone.', 'Supprimer', true))) return;
    await PhotoDB.del(p.id).catch(() => {});
    photos = photos.filter(x => x.id !== p.id);
    if (photoUrls.has(p.id)) { URL.revokeObjectURL(photoUrls.get(p.id)); photoUrls.delete(p.id); }
    refreshPhotoSheet();
    render();
    toast('Photo supprimée');
  });
}

const blobToDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
async function dataUrlToBlob(u) { return (await fetch(u)).blob(); }

/* =========================================================
   NUTRITION : repas, calories, protéines, glucides, lipides
   Sources : table Ciqual 2020 (ANSES, embarquée, hors ligne)
             + Open Food Facts (produits de marque, en ligne)
   ========================================================= */
const MEALS = [
  { key: 'matin', label: 'Matin', icon: '🌅' },
  { key: 'midi', label: 'Midi', icon: '☀️' },
  { key: 'soir', label: 'Soir', icon: '🌙' },
  { key: 'collation', label: 'Collation', icon: '🍎' },
];
const mealLabel = k => (MEALS.find(m => m.key === k) || MEALS[0]);

/* --- objectifs du jour --- */
function nutritionTargets() {
  const b = state.body, W = currentWeight();
  let kcal = b.kcalTarget, auto = false, tdee = null;
  if (b.heightCm && b.age) {
    const bmr = 10 * W + 6.25 * b.heightCm - 5 * b.age + 5; // Mifflin-St Jeor (homme)
    tdee = bmr * 1.45; // activité modérée (sport + travail)
    if (!kcal) { kcal = Math.max(1600, Math.round((tdee - 500) / 10) * 10); auto = true; }
  }
  const known = !!kcal;
  if (!kcal) kcal = 2300;
  const p = Math.round(1.8 * b.goalWeight);
  const l = Math.round(0.8 * b.goalWeight);
  const g = Math.max(80, Math.round((kcal - p * 4 - l * 9) / 4));
  return { kcal, p, g, l, auto, known, tdee };
}
function dayTotals(date) {
  const t = { kcal: 0, p: 0, g: 0, l: 0, meals: new Set(), n: 0 };
  for (const m of state.meals) if (m.date === date) { t.kcal += m.kcal; t.p += m.p; t.g += m.g; t.l += m.l; t.meals.add(m.meal); t.n++; }
  return t;
}
/* Journée validée (jours terminés seulement) : 3 repas notés, calories entre
   objectif −400 et objectif +100, protéines ≥ 80 % de l'objectif. */
let _nutriCache = { key: '', set: new Set() };
function nutritionDays(today) {
  const key = today + '|' + state.meals.length + '|' + state.meals.reduce((s, m) => s + m.kcal, 0) + '|' + state.body.kcalTarget + '|' + state.body.heightCm + '|' + state.body.age;
  if (_nutriCache.key === key) return _nutriCache.set;
  const t = nutritionTargets();
  const dates = new Set(state.meals.map(m => m.date));
  const ok = new Set();
  for (const d of dates) {
    if (d >= today) continue;
    const x = dayTotals(d);
    const main = ['matin', 'midi', 'soir'].filter(k => x.meals.has(k)).length;
    if (main >= 3 && x.kcal >= t.kcal - 400 && x.kcal <= t.kcal + 100 && x.p >= t.p * 0.8) ok.add(d);
  }
  _nutriCache = { key, set: ok };
  return ok;
}

/* --- base Ciqual --- */
let ciqual = null, ciqualLoading = null;
const STOPW = new Set('de du des la le les l d au aux a en et avec sans un une g gr grammes gramme ml cl kg portion portions cuillere cuilleres bol verre tranche tranches morceau morceaux piece pieces j ai mange mangee manger pris prise bu avale que qui mon ma mes ce cette aussi encore ensuite matin midi soir aujourd hui dose doses scoop scoops mesure mesures bouteille bouteilles canette canettes tasse tasses gobelet gobelets peu beaucoup assiette assiettes part parts poignee poignees boite boites sachet sachets paquet paquets gros grosse'.split(' '));
/* Marques : reconnues (même mal écrites) pour chercher le produit, retirées pour la base générique */
const BRAND_FIX = [[/\b(10|dix|in|ine|inn)\s*shape\b/gi, 'InShape'], [/\btibo\s+InShape\b/gi, 'InShape'], [/\bmy\s*prot[eé]ine?\b/gi, 'MyProtein'], [/\bnutri\s*(and|&|et|n)\s*co\b/gi, 'Nutri&Co'],
  [/\bnutri\s*muscle\b/gi, 'Nutrimuscle'], [/\boptimum(\s*nutrition)?\b|\bgold\s*standard\b/gi, 'Optimum'], [/\bapplied(\s*nutrition)?\b/gi, 'Applied'], [/\bbiotech(\s*usa)?\b/gi, 'Biotech'],
  [/\bdomyos\b/gi, 'Decathlon'], [/\bfood\s*spring\b/gi, 'Foodspring'], [/\be\s*a\s*fit\b/gi, 'Eafit'], [/\bpro\s*zis\b/gi, 'Prozis']];
const BRANDS = /\b(inshape|myprotein|prozis|nutrimuscle|eafit|bulk|foodspring|nutri&co|nutriandco|optimum|scitec|biotech|olimp|decathlon|domyos|hsn|applied|dymatize|grenade|kelloggs?|danone|nestle|lindt|milka|haribo|bonduelle|herta|president|carrefour|auchan|leclerc|lidl|aldi|monoprix|alpro|oikos|siggi'?s?|lu|panzani|barilla|uncle bens?|fleury michon|marque repere|weider|isostar|ovomaltine|nesquik|kinder|ferrero|mcdo|mcdonald'?s?|kfc|burger king|subway|o'?tacos)\b/i;
const normTxt = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/[^a-z0-9]+/g, ' ').trim();
const stemW = w => (w.length > 3 ? w.replace(/(s|x)$/, '') : w);
const tokensOf = s => normTxt(s).split(' ').filter(w => w && !STOPW.has(w) && !/^\d+$/.test(w)).map(stemW);

function loadCiqual() {
  if (ciqual) return Promise.resolve(ciqual);
  if (!ciqualLoading) {
    ciqualLoading = fetch('data/ciqual.json').then(r => r.json()).then(d => {
      ciqual = d.concat(EXTRA_FOODS).map(f => ({ ...f, _t: tokensOf(f.n), _n: normTxt(f.n) }));
      return ciqual;
    }).catch(e => { ciqualLoading = null; throw e; });
  }
  return ciqualLoading;
}
/* Produits courants absents de Ciqual (valeurs pour 100 g ou 100 ml, étiquettes des fabricants) */
const EXTRA_FOODS = [
  { c: 'x1', n: 'Coca-Cola (canette 33 cl)', grp: 'boissons', kcal: 42, p: 0, g: 10.6, l: 0 },
  { c: 'x2', n: 'Coca-Cola zéro / light', grp: 'boissons', kcal: 0.3, p: 0, g: 0, l: 0 },
  { c: 'x3', n: 'Red Bull (canette 25 cl)', grp: 'boissons', kcal: 46, p: 0, g: 11, l: 0 },
  { c: 'x4', n: 'Monster Energy (canette 50 cl)', grp: 'boissons', kcal: 47, p: 0, g: 11, l: 0 },
  { c: 'x5', n: 'Whey protéine en poudre (moyenne)', grp: 'compléments', kcal: 380, p: 75, g: 8, l: 6 },
  { c: 'x6', n: 'Big Mac (McDonald\'s)', grp: 'fast food', kcal: 230, p: 11.9, g: 18.7, l: 11.4 },
  { c: 'x7', n: 'French tacos (moyenne, 1 viande, frites, sauce fromagère)', grp: 'fast food', kcal: 245, p: 10.5, g: 24, l: 12 },
  { c: 'x8', n: 'Fanta / Sprite / Ice Tea (sodas sucrés, moyenne)', grp: 'boissons', kcal: 30, p: 0, g: 7.5, l: 0 },
  { c: 'x9', n: 'Plat cuisiné maison (moyenne)', grp: 'plats composés', kcal: 150, p: 8, g: 15, l: 6 },
  { c: 'x10', n: 'Skyr / yaourt protéiné nature (type HiPro)', grp: 'produits laitiers frais et assimilés', kcal: 58, p: 10, g: 3.8, l: 0.2 },
];

/* Aliments courants : choix par défaut le plus probable (cuit, nature…) */
const FOOD_DEFAULTS = {
  'riz': 'Riz blanc, cuit, non salé', 'riz blanc': 'Riz blanc, cuit, non salé',
  'pate': 'Pâtes sèches standard, cuites, non salées', 'pates': 'Pâtes sèches standard, cuites, non salées',
  'oeuf': 'Oeuf, dur', 'oeuf dur': 'Oeuf, dur', 'oeuf plat': 'Oeuf, au plat, sans matière grasse',
  'banane': 'Banane, pulpe, crue', 'pomme': 'Pomme, pulpe et peau, crue',
  'poulet': 'Poulet, filet, sans peau, sauté/poêlé', 'blanc poulet': 'Poulet, filet, sans peau, sauté/poêlé', 'filet poulet': 'Poulet, filet, sans peau, sauté/poêlé',
  'pain': 'Pain, baguette, courante', 'baguette': 'Pain, baguette, courante',
  'steak': 'Boeuf, steak haché 15% MG, cuit', 'steak hache': 'Boeuf, steak haché 15% MG, cuit', 'boeuf': 'Boeuf, steak ou bifteck, grillé',
  'saumon': 'Saumon, cuit, sans précision (aliment moyen)', 'thon': 'Thon, au naturel, appertisé, égoutté',
  'lait': 'Lait demi-écrémé, UHT', 'pomme terre': "Pomme de terre, bouillie/cuite à l'eau", 'patate': "Pomme de terre, bouillie/cuite à l'eau",
  'frite': 'Frites de pommes de terre, surgelées, cuites en friteuse', 'avoine': 'Avoine, crue', 'flocon avoine': 'Avoine, crue',
  'yaourt': 'Yaourt, lait fermenté ou spécialité laitière, nature', 'fromage blanc': 'Fromage blanc nature, 3% MG environ',
  'huile': "Huile d'olive vierge extra", 'huile olive': "Huile d'olive vierge extra", 'lentille': "Lentille, bouillie/cuite à l'eau",
  'haricot vert': 'Haricot vert, cuit', 'brocoli': 'Brocoli, cuit', 'jambon': 'Jambon cuit, supérieur', 'emmental': 'Emmental ou emmenthal',
  'nutella': 'Pâte à tartiner chocolat et noisette', 'beurre': 'Beurre à 82% MG, doux', 'miel': 'Miel', 'sucre': 'Sucre blanc',
  'jus orange': "Jus d'orange, pur jus", 'amande': 'Amande (avec peau)', 'beurre cacahuete': "Beurre de cacahuète ou Pâte d'arachide",
  'viande': 'Viande cuite (aliment moyen)', 'viande hache': 'Boeuf, steak haché 15% MG, cuit', 'dinde': 'Dinde, escalope, sautée/poêlée',
  'escalope dinde': 'Dinde, escalope, sautée/poêlée', 'escalope': 'Dinde, escalope, sautée/poêlée', 'poulet roti': 'Poulet, viande et peau, rôti/cuit au four',
  'coca': 'Coca-Cola (canette 33 cl)', 'coca cola': 'Coca-Cola (canette 33 cl)', 'coca zero': 'Coca-Cola zéro / light', 'coca light': 'Coca-Cola zéro / light',
  'red bull': 'Red Bull (canette 25 cl)', 'redbull': 'Red Bull (canette 25 cl)', 'monster': 'Monster Energy (canette 50 cl)',
  'whey': 'Whey protéine en poudre (moyenne)', 'proteine': 'Whey protéine en poudre (moyenne)', 'shaker proteine': 'Whey protéine en poudre (moyenne)',
  'big mac': "Big Mac (McDonald's)", 'tacos': 'French tacos (moyenne, 1 viande, frites, sauce fromagère)', 'french tacos': 'French tacos (moyenne, 1 viande, frites, sauce fromagère)',
  'kebab': 'Sandwich grec ou Kebab, pita, crudités', 'grec': 'Sandwich grec ou Kebab, pita, crudités', 'sandwich grec': 'Sandwich grec ou Kebab, pita, crudités',
  'burger': 'Hamburger, provenant de fast food', 'hamburger': 'Hamburger, provenant de fast food', 'cheeseburger': 'Cheeseburger, provenant de fast food',
  'nugget': 'Volaille, croquette panée ou nuggets', 'pizza': 'Pizza au fromage ou Pizza margherita, préemballée', 'cookie': 'Cookie aux pépites de chocolat',
  'chip': 'Chips de pommes de terre nature ou aromatisées, standard', 'couscous': 'Graine de couscous (semoule de blé dur précuite), cuite, non salée',
  'semoule': 'Graine de couscous (semoule de blé dur précuite), cuite, non salée', 'fanta': 'Fanta / Sprite / Ice Tea (sodas sucrés, moyenne)',
  'sprite': 'Fanta / Sprite / Ice Tea (sodas sucrés, moyenne)', 'ice tea': 'Fanta / Sprite / Ice Tea (sodas sucrés, moyenne)', 'soda': 'Fanta / Sprite / Ice Tea (sodas sucrés, moyenne)',
  'pain mie': 'Pain de mie, complet', 'oeuf brouille': 'Oeuf, brouillé, avec matière grasse',
  'chocolat': 'Chocolat noir à moins de 70% de cacao, à croquer, tablette', 'chocolat noir': 'Chocolat noir à moins de 70% de cacao, à croquer, tablette',
  'chocolat lait': 'Chocolat au lait, tablette', 'thon': 'Thon, au naturel, appertisé, égoutté', 'mozzarella': 'Mozzarella au lait de vache',
  'gruyere': 'Gruyère', 'comte': 'Comté', 'ketchup': 'Ketchup, préemballé', 'mayonnaise': 'Mayonnaise (70% MG min.), préemballée', 'mayo': 'Mayonnaise (70% MG min.), préemballée',
  'tomate': 'Tomate, crue', 'carotte': 'Carotte, cuite', 'haricot rouge': "Haricot rouge, bouilli/cuit à l'eau", 'pois chiche': "Pois chiche, bouilli/cuit à l'eau",
  'quinoa': "Quinoa, bouilli/cuit à l'eau, non salé", 'patate douce': 'Patate douce, cuite', 'muesli': 'Muesli (aliment moyen)',
  'confiture': 'Confiture ou Marmelade, tout type de fruits (aliment moyen)', 'lait entier': 'Lait entier, UHT', 'cafe': 'Café, non instantané, non sucré, prêt à boire',
  'the': 'Thé infusé, non sucré', 'pate tartiner': 'Pâte à tartiner chocolat et noisette',
  'skyr': 'Skyr / yaourt protéiné nature (type HiPro)', 'yaourt proteine': 'Skyr / yaourt protéiné nature (type HiPro)', 'hipro': 'Skyr / yaourt protéiné nature (type HiPro)',
  'yaourt hipro': 'Skyr / yaourt protéiné nature (type HiPro)', 'fromage': 'Fromage (aliment moyen)', 'fromage rape': 'Emmental ou emmenthal râpé', 'gruyere rape': 'Emmental ou emmenthal râpé',
  'emmental rape': 'Emmental ou emmenthal râpé', 'salade': 'Salade verte, crue, sans assaisonnement', 'salade verte': 'Salade verte, crue, sans assaisonnement', 'salade tomate': 'Tomate, crue',
  'eau': 'Eau du robinet', 'eau robinet': 'Eau du robinet', 'eau plate': 'Eau minérale, plate (aliment moyen)', 'eau minerale': 'Eau minérale (aliment moyen)',
  'eau gazeuse': 'Eau minérale, gazeuse (aliment moyen)', 'eau petillante': 'Eau minérale, gazeuse (aliment moyen)', 'bouteille eau': 'Eau minérale, plate (aliment moyen)',
  'puree': 'Pomme de terre, purée (aliment moyen)', 'puree pomme terre': 'Pomme de terre, purée (aliment moyen)',
};
const COOKED_GROUPS = /pâtes|riz|céréales|viandes|poissons|œufs|légumineuses|légumes|pommes de terre/;

/* --- Protéines en poudre & produits sportifs ---
   Valeurs pour 100 g relevées sur les étiquettes / sites des marques (≈, selon le parfum).
   dose = poids d'une dose (g). */
const PROTEIN_TYPES = {
  whey:    { e: '💪', label: 'Whey classique', per100: { kcal: 390, p: 76, g: 8, l: 6 }, dose: 30 },
  isolate: { e: '💎', label: 'Whey isolate', per100: { kcal: 370, p: 88, g: 3, l: 1 }, dose: 25 },
  clear:   { e: '🧊', label: 'Clear whey', per100: { kcal: 340, p: 80, g: 4, l: 0.5 }, dose: 25 },
  native:  { e: '🥛', label: 'Whey native', per100: { kcal: 380, p: 80, g: 5, l: 5.5 }, dose: 30 },
  vegan:   { e: '🌱', label: 'Protéine vegan', per100: { kcal: 375, p: 72, g: 7, l: 7 }, dose: 30 },
  casein:  { e: '🌙', label: 'Caséine', per100: { kcal: 360, p: 78, g: 6, l: 2 }, dose: 30 },
  gainer:  { e: '🏋️', label: 'Gainer (prise de masse)', per100: { kcal: 385, p: 20, g: 68, l: 4 }, dose: 100 },
  bar:     { e: '🍫', label: 'Barre protéinée', per100: { kcal: 370, p: 32, g: 35, l: 13 }, dose: 60 },
  pancake: { e: '🥞', label: 'Pancakes protéinés', per100: { kcal: 375, p: 39, g: 40, l: 5 }, dose: 50 },
  spread:  { e: '🥜', label: 'Pâte à tartiner protéinée', per100: { kcal: 520, p: 20, g: 30, l: 36 }, dose: 15 },
  drink:   { e: '🥤', label: 'Boisson protéinée', per100: { kcal: 38, p: 8, g: 1, l: 0.2 }, dose: 330 },
};
/* [type, nom du produit, valeurs pour 100 g (null = moyenne du type), dose] */
const BRAND_PRODUCTS = {
  'InShape': [
    ['whey', 'Whey Protein', { kcal: 393, p: 76, g: 11, l: 5 }, 30],
    ['clear', 'Clear Whey', { kcal: 333, p: 78, g: 4.3, l: 0.6 }, 25],
    ['gainer', 'Gainer', null, 100],
    ['pancake', 'Pancakes protéinés', null, 50],
    ['drink', 'Clear Whey Drink (canette)', { kcal: 36, p: 8, g: 0.8, l: 0 }, 250],
    ['spread', 'Pâte à tartiner protéinée', null, 15],
  ],
  'MyProtein': [
    ['whey', 'Impact Whey Protein', { kcal: 400, p: 80, g: 6, l: 7 }, 25],
    ['isolate', 'Impact Whey Isolate', { kcal: 370, p: 90, g: 2.5, l: 0.5 }, 25],
    ['clear', 'Clear Whey Isolate', { kcal: 350, p: 80, g: 4, l: 0.2 }, 25],
    ['vegan', 'Vegan Protein Blend', { kcal: 375, p: 70, g: 9, l: 7 }, 30],
    ['casein', 'Caséine micellaire', null, 30],
    ['gainer', 'Weight Gainer', null, 100],
    ['bar', 'Barre protéinée (Layer bar)', null, 60],
  ],
  'Prozis': [
    ['whey', '100% Real Whey Protein', { kcal: 390, p: 75, g: 9, l: 6 }, 30],
    ['isolate', 'Whey Isolate', null, 25],
    ['clear', 'Clear Whey', null, 25],
    ['vegan', 'Protéine vegan', null, 30],
    ['gainer', 'Gainer', null, 100],
    ['bar', 'Barre protéinée', null, 60],
  ],
  'Nutrimuscle': [
    ['native', 'Whey native', { kcal: 378, p: 80, g: 4.6, l: 5 }, 30],
    ['isolate', 'Whey isolate native', { kcal: 365, p: 88, g: 2, l: 1 }, 25],
    ['casein', 'Caséine native', null, 30],
    ['vegan', 'Protéine de pois', null, 30],
  ],
  'Eafit': [
    ['whey', 'Pure Whey', { kcal: 380, p: 72, g: 10, l: 6 }, 30],
    ['isolate', 'Pure Isolate', null, 25],
    ['gainer', 'Mass Gainer', null, 100],
    ['bar', 'Barre protéinée', null, 60],
  ],
  'Foodspring': [
    ['whey', 'Whey Protein', { kcal: 380, p: 77, g: 6, l: 6 }, 30],
    ['clear', 'Clear Whey', null, 25],
    ['vegan', 'Vegan Protein', null, 30],
    ['bar', 'Barre protéinée', null, 60],
  ],
  'Optimum': [
    ['whey', 'Gold Standard 100% Whey', { kcal: 395, p: 79, g: 10, l: 5 }, 30],
    ['isolate', 'Gold Standard Isolate', null, 30],
    ['casein', 'Gold Standard Casein', null, 33],
    ['gainer', 'Serious Mass', { kcal: 375, p: 15, g: 75, l: 2 }, 100],
  ],
  'Bulk': [
    ['whey', 'Pure Whey Protein', { kcal: 400, p: 78, g: 5, l: 7 }, 30],
    ['isolate', 'Pure Whey Isolate', null, 25],
    ['clear', 'Clear Whey', null, 25],
    ['vegan', 'Vegan Protein', null, 30],
  ],
  'Nutri&Co': [
    ['native', 'Whey native', { kcal: 375, p: 80, g: 4, l: 4.5 }, 30],
    ['vegan', 'Protéine vegan', null, 30],
  ],
  'Decathlon': [
    ['whey', 'Whey Protein (Domyos)', { kcal: 380, p: 74, g: 9, l: 5.5 }, 30],
    ['isolate', 'Whey Isolate (Domyos)', null, 25],
    ['bar', 'Barre protéinée', null, 55],
  ],
  'Isostar': [['whey', 'Whey Protein', null, 30], ['bar', 'Barre protéinée', null, 55]],
  'Scitec': [['whey', '100% Whey Protein Professional', { kcal: 390, p: 73, g: 10, l: 6 }, 30], ['isolate', '100% Whey Isolate', null, 25]],
  'Biotech': [['isolate', 'Iso Whey Zero', { kcal: 370, p: 84, g: 3, l: 2 }, 25], ['whey', '100% Pure Whey', null, 28]],
  'HSN': [['whey', 'Evowhey', null, 30], ['isolate', 'Evolate (isolate)', null, 30]],
  'Applied': [['isolate', 'ISO-XP', { kcal: 370, p: 90, g: 1, l: 0.5 }, 25], ['clear', 'Clear Whey', null, 25]],
  'Dymatize': [['isolate', 'ISO 100', { kcal: 370, p: 86, g: 3, l: 1 }, 30], ['whey', 'Elite 100% Whey', null, 30]],
  'Olimp': [['whey', 'Whey Protein Complex', null, 30]],
  'Weider': [['whey', 'Premium Whey', null, 30]],
  'Grenade': [['bar', 'Barre Carb Killa', { kcal: 370, p: 34, g: 35, l: 13 }, 60]],
};
const brandKey = b => (b ? normTxt(b).replace(/ /g, '') : '');
const BRAND_KEYS = Object.fromEntries(Object.keys(BRAND_PRODUCTS).map(k => [brandKey(k), k]));
const catalogBrand = b => BRAND_KEYS[brandKey(b)] || null;
const PTYPE_RE = [
  ['clear', /\bclear\b/], ['isolate', /\biso(lat|late|lats|lates)?\b/], ['native', /\bnatives?\b/], ['vegan', /\bvegan|\bvegetal|\bproteine de pois/],
  ['casein', /\bcasein/], ['gainer', /\bgainer|\bprise de masse|\bmass\b/], ['bar', /\bbarres?\b/], ['pancake', /\bpancake/],
  ['spread', /\btartiner/], ['drink', /\bcanettes?\b|\bdrink\b/], ['whey', /\bwhey\b/],
];
const detectPType = n => (PTYPE_RE.find(([, re]) => re.test(n)) || [null])[0];
const FLAVORS = /\b(vanille|chocolat|choco|fraise|framboise|cookies?|caramel|banane|neutre|nature|peanut|butter|cacahuete|coco|pistache|saveur|gout|parfum|poudre|nutrition|en|au|aux|a|la|le|de|du|des|lait|eau|shakers?)\b/g;
/* Le texte parle-t-il d'un produit protéiné (whey, isolate…) ? "yaourt protéiné" non, "protéine chocolat" oui */
function isProteinText(n, brand) {
  if (catalogBrand(brand)) return true;
  if (/\b(whey|isolate?|isolat|clear whey|caseine?|gainer|shakers?)\b/.test(n)) return true;
  if (/\b(proteines?|prot|proteinee?s?)\b/.test(n)) {
    const rest = n.replace(/\b(proteines?|prot|proteinee?s?|dose|doses|scoop|scoops|mesure|mesures)\b/g, ' ').replace(FLAVORS, ' ').replace(/\d+/g, ' ').trim();
    return !rest || /^(barres?|pancakes?|pate a tartiner|tartiner)$/.test(rest);
  }
  return false;
}
function protFood(type, name, per100, dose, brand) {
  const T = PROTEIN_TYPES[type];
  return { id: 'p' + brandKey(brand || 'x') + '-' + type + '-' + normTxt(name).replace(/ /g, ''), name: brand ? `${name} — ${brand}` : name,
    short: name, sub: brand ? `${brand} · dose ${dose} g` : `≈ moyenne · dose ${dose} g`, emoji: T.e, src: brand ? 'marque' : 'type',
    per100: { ...(per100 || T.per100) }, portion: dose, ptype: type, grp: 'compléments' };
}
/* Liste des produits proposés pour un texte protéiné */
function protCands(query, brand) {
  const n = normTxt(query);
  const ptype = detectPType(n);
  const bk = catalogBrand(brand);
  let list = bk
    ? BRAND_PRODUCTS[bk].map(([t, nm, v, d]) => protFood(t, nm, v, d, bk))
    : Object.keys(PROTEIN_TYPES).map(t => protFood(t, PROTEIN_TYPES[t].label, null, PROTEIN_TYPES[t].dose, null));
  if (ptype) list.sort((a, b) => (b.ptype === ptype) - (a.ptype === ptype));
  else if (bk) list.sort((a, b) => (['whey', 'native'].includes(b.ptype)) - (['whey', 'native'].includes(a.ptype)));
  const confident = !!ptype && list.filter(f => f.ptype === ptype).length === 1 && (!!bk || ptype !== 'bar');
  return { list, confident, bk, ptype };
}

/* --- portions par défaut (quand rien n'est précisé) --- */
const GROUP_PORTION = [
  [/viandes|poissons|substitus/, 120], [/charcuteries/, 50], [/pâtes, riz|légumineuses|pommes de terre/, 200], [/légumes/, 150], [/^fruits$/, 130],
  [/produits laitiers frais|desserts|crèmes dessert/, 125], [/fromages/, 30], [/pains/, 60], [/viennoiseries/, 60], [/plats composés|salades composées/, 300],
  [/pizzas/, 150], [/sandwichs/, 250], [/soupes/, 300], [/boisson|laits|eaux/, 250], [/gâteaux/, 80],
  [/biscuits sucrés|biscuits apéritifs|barres/, 30], [/céréales de petit/, 40], [/chocolats|confiseries/, 30], [/sauces|condiments|confitures/, 20],
  [/huiles|beurres|margarines|matières grasses|sucres, miels/, 10], [/fruits à coque/, 30], [/œufs/, 55], [/glaces|desserts glacés|sorbets/, 100],
  [/compléments/, 30], [/fast food/, 250],
];
function defaultPortion(f) {
  if (f.portion) return f.portion;
  const grp = f.grp || '';
  if (/pâtes, riz/.test(grp) && /\bcru/.test(normTxt(f.name))) return 80;
  const m = GROUP_PORTION.find(([re]) => re.test(grp));
  return m ? m[1] : 100;
}
const EMOJIS = [
  [/^eau\b|\beau (minerale|de source|du robinet|gazeuse|plate)/, '💧'], [/whey|proteine|isolate|gainer/, '💪'], [/\briz\b/, '🍚'], [/pate|spaghetti|tagliatelle|lasagne|ravioli|nouille/, '🍝'], [/pizza/, '🍕'],
  [/burger|big mac|cheeseburger/, '🍔'], [/frite/, '🍟'], [/tacos|kebab|grec|wrap|sandwich/, '🌯'], [/poulet|dinde|volaille|nugget/, '🍗'],
  [/boeuf|steak|viande|veau|porc|agneau|jambon|saucisse|lardon|bacon/, '🥩'], [/saumon|thon|poisson|cabillaud|crevette|sardine|colin/, '🐟'],
  [/oeuf/, '🥚'], [/fromage|emmental|gruyere|comte|mozzarella|camembert/, '🧀'], [/yaourt|skyr|fromage blanc|lait|creme/, '🥛'],
  [/pain|baguette|croissant|brioche|viennois/, '🥖'], [/cereale|muesli|avoine|granola/, '🥣'], [/pomme de terre|patate|puree/, '🥔'],
  [/banane/, '🍌'], [/pomme/, '🍎'], [/orange|clementine|mandarine/, '🍊'], [/fraise|framboise|fruits rouges/, '🍓'], [/fruit|kiwi|poire|raisin|ananas|mangue/, '🍇'],
  [/salade|brocoli|haricot vert|courgette|epinard|legume|carotte|tomate|poivron/, '🥦'], [/lentille|pois chiche|haricot/, '🫘'],
  [/chocolat|nutella|pate a tartiner/, '🍫'], [/gateau|cookie|biscuit|patisserie|tarte/, '🍪'], [/glace|sorbet/, '🍨'], [/bonbon|confiserie/, '🍬'],
  [/coca|soda|fanta|sprite|ice tea|jus|red bull|monster|boisson/, '🥤'], [/cafe/, '☕'], [/the\b/, '🍵'], [/biere|vin\b|alcool/, '🍺'],
  [/huile|beurre|margarine/, '🫒'], [/amande|noix|cacahuete|noisette|pistache/, '🥜'], [/sauce|ketchup|mayo/, '🥫'], [/soupe|potage/, '🍲'], [/miel|sucre|confiture/, '🍯'],
];
const foodEmoji = f => f.emoji || (EMOJIS.find(([re]) => re.test(normTxt(f.name))) || [null, '🍽️'])[1];
/* "Riz blanc, cuit, non salé" → court "Riz blanc", détail "cuit, non salé" */
function splitName(f) {
  if (f.short) return { short: f.short, sub: f.sub || '' };
  const i = f.name.indexOf(', ');
  const short = i > 0 ? f.name.slice(0, i) : f.name;
  let sub = i > 0 ? f.name.slice(i + 2) : '';
  if (f.src === 'perso') sub = sub || '⭐ mon aliment';
  if (f.src === 'off') sub = sub || '🏷️ produit de marque';
  return { short: short.length > 46 ? short.slice(0, 44) + '…' : short, sub: sub.length > 44 ? sub.slice(0, 42) + '…' : sub };
}
/* Aliment inconnu : on choisit en touchant ce qui ressemble le plus */
const FOOD_CATS = [
  ['🥩', 'Viande', 'Viande cuite (aliment moyen)'], ['🐟', 'Poisson', 'Poisson cuit (aliment moyen)'], ['🍝', 'Pâtes / riz', 'Pâtes sèches standard, cuites, non salées'],
  ['🍲', 'Plat maison', 'Plat cuisiné maison (moyenne)'], ['🥔', 'Pommes de terre', 'Pomme de terre, cuite (aliment moyen)'], ['🥦', 'Légumes', 'Légume cuit (aliment moyen)'],
  ['🍎', 'Fruit', 'Fruit cru (aliment moyen)'], ['🥛', 'Yaourt / laitage', 'Yaourt, lait fermenté ou spécialité laitière, nature'], ['🧀', 'Fromage', 'Fromage (aliment moyen)'],
  ['🥖', 'Pain', 'Pain (aliment moyen)'], ['🥣', 'Céréales', 'Céréales pour petit déjeuner (aliment moyen)'], ['🍪', 'Gâteau', 'Gâteau (aliment moyen)'],
  ['🍫', 'Chocolat / sucré', 'Chocolat au lait, tablette'], ['🍔', 'Fast-food', 'Hamburger, provenant de fast food'], ['🍕', 'Pizza', 'Pizza au fromage ou Pizza margherita, préemballée'],
  ['🥤', 'Boisson sucrée', 'Fanta / Sprite / Ice Tea (sodas sucrés, moyenne)'], ['🍨', 'Dessert', 'Crème dessert, rayon frais ou appertisée (aliment moyen)'], ['💪', 'Protéine', null],
];

/* Mes aliments (valeurs saisies depuis l'étiquette) : cherchés en premier, avec la marque */
function searchCustom(query) {
  const q = tokensOf(query);
  if (!q.length || !state.customFoods.length) return [];
  const out = [];
  for (const f of state.customFoods) {
    const ft = tokensOf(f.name);
    let matched = 0;
    for (const w of q) if (ft.some(t => t === w || t.startsWith(w) || w.startsWith(t))) matched++;
    const cover = matched / q.length, back = matched / ft.length;
    if (cover >= 0.6 || back >= 0.8) out.push({ f, score: 300 + cover * 10 + back * 10, cover: Math.max(cover, back) });
  }
  return out.sort((a, b) => b.score - a.score);
}
const customFood = f => ({ id: 'u' + f.id, name: f.name, src: 'perso', per100: { ...f.per100 }, portion: f.portion, grp: f.grp || '', emoji: f.emoji });
function searchAll(query) {
  const custom = searchCustom(query).map(x => ({ food: customFood(x.f), cover: x.cover, score: x.score }));
  const generic = query.replace(new RegExp(BRANDS.source, 'gi'), ' ').replace(/\bnutrition\b/gi, ' ').trim();
  const base = searchCiqual(generic || query).map(x => ({ food: ciqualFood(x.f), cover: x.cover, score: x.score, def: x.def }));
  return custom.concat(base);
}
function searchCiqual(query, limit = 8) {
  if (!ciqual) return [];
  const q = tokensOf(query);
  if (!q.length) return [];
  const nq = normTxt(query);
  const wantsRaw = /\bcru/.test(nq);
  const def = FOOD_DEFAULTS[q.join(' ')];
  const zeroFat = /\b0\s*%/.test(query);
  const exacts = q.filter(w => w.length > 2).map(w => new RegExp(`(^| )${w}(s|x)?( |$)`));
  const res = [];
  for (const f of ciqual) {
    if (def && f.n === def) { res.push({ f, score: 1000, cover: 1, def: true }); continue; }
    let score = 0, matched = 0;
    q.forEach((w, i) => {
      let sc = 0;
      for (const t of f._t) {
        if (t === w) sc = Math.max(sc, 3);
        else if (t.startsWith(w) || (w.length > 4 && w.startsWith(t) && t.length > 3)) sc = Math.max(sc, 2);
      }
      if (!sc && w.length > 3 && f._n.includes(w)) sc = 1;
      if (sc) matched++;
      score += sc;
      if (i === 0 && f._t[0] === w) score += 2;
    });
    if (matched < Math.max(1, Math.ceil(q.length * 0.6))) continue;
    score += (matched / q.length) * 3 - f._t.length * 0.08;
    for (const re of exacts) if (re.test(f._n)) score += 1.5;
    if (!wantsRaw && COOKED_GROUPS.test(f.grp || '')) { if (/\bcuit/.test(f._n)) score += 1; if (/\bcru/.test(f._n)) score -= 0.6; }
    if (def && f.n === def) score += 100;
    if (zeroFat && /0% MG/.test(f.n)) score += 120 + (/nature/.test(f._n) ? 10 : 0) - f._t.length * 0.5;
    res.push({ f, score, cover: matched / q.length, def: !!def && f.n === def });
  }
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, limit);
}
const ciqualFood = f => ({ id: 'c' + f.c, name: f.n, src: 'ciqual', grp: f.grp || '', per100: { kcal: f.kcal || 0, p: f.p || 0, g: f.g || 0, l: f.l || 0 } });

/* --- Open Food Facts (marques) --- */
async function getJSON(url, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
function offFood(p) {
  const n = p.nutriments || {};
  const kcal = n['energy-kcal_100g'] != null ? n['energy-kcal_100g'] : (n['energy_100g'] != null ? n['energy_100g'] / 4.184 : null);
  if (kcal == null || !p.code) return null;
  const nom = p.product_name_fr || p.product_name || 'Produit sans nom';
  const brand = Array.isArray(p.brands) ? p.brands.join(', ') : (p.brands || '');
  return { id: 'o' + p.code, name: brand ? `${nom} — ${brand}` : nom, src: 'off', per100: { kcal: Math.round(kcal * 10) / 10, p: +n.proteins_100g || 0, g: +n.carbohydrates_100g || 0, l: +n.fat_100g || 0 } };
}
async function searchOFF(query, limit = 6) {
  const q = encodeURIComponent(query);
  const F = 'code,product_name,product_name_fr,brands,nutriments';
  const tries = [
    async () => (await getJSON(`https://search.openfoodfacts.org/search?q=${q}&langs=fr&page_size=${limit}&fields=${F}`)).hits,
    async () => (await getJSON(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&lc=fr&page_size=${limit}&fields=${F}`)).products,
  ];
  let err = null;
  for (const t of tries) {
    try { return ((await t()) || []).map(offFood).filter(Boolean); } catch (e) { err = e; }
  }
  throw err || new Error('Open Food Facts injoignable');
}

/* --- lecture du texte libre : "150 g riz, 2 oeufs, yaourt Danone 125 g" --- */
const PORTIONS = [
  [/\boeuf/, 55], [/\bbanane/, 120], [/\bpomme\b/, 150], [/\borange/, 150], [/\bkiwi/, 75], [/\bclementine|\bmandarine/, 60],
  [/\byaourt|\byogourt/, 125], [/\btranche.*jambon|\bjambon/, 40], [/\btranche/, 35], [/\bbaguette/, 250], [/\bcroissant/, 60],
  [/\bpain au chocolat|\bchocolatine/, 70], [/\bbiscuit|\bgateau sec/, 10], [/\bcarre/, 5], [/\bcuillere a soupe|\bc a s\b|\bcas\b/, 15],
  [/\bcuillere a cafe|\bc a c\b|\bcac\b/, 5], [/\bverre/, 200], [/\bbols?\b/, 250], [/\bcanette/, 330], [/\bbouteille/, 500],
  [/\bsteak|\bburger|\bhamburger/, 125], [/\bavocat/, 150], [/\btomate/, 120], [/\bpart\b.*pizza|\bpizza/, 150], [/\bsandwich/, 250],
  [/\bportion/, 30], [/\bcafe|\bthe\b/, 200], [/\bdose|\bscoop|\bmesure/, 30],
  [/\bcoca|\bfanta|\bsprite|\bice tea|\bsoda/, 330], [/\bred ?bull/, 250], [/\bmonster/, 500], [/\bwhey|\bproteine|\bshaker/, 30],
  [/\bbig mac/, 219], [/\btacos/, 430], [/\bkebab|\bgrec\b/, 350], [/\bburger|\bcheeseburger/, 120], [/\bnugget/, 17], [/\bcookie/, 30],
  [/\bpain de mie/, 25], [/\bpain\b/, 60], [/\bescalope/, 120], [/\bpizza/, 400], [/\bpaquet de chips|\bchips/, 45],
  [/\bassiette/, 300], [/\bpoignee/, 30], [/\bskyr|\bhipro/, 150], [/\brape/, 20], [/\bsalade/, 100], [/\bboite de thon|\bboite thon/, 140], [/\bfrite/, 150],
];
const WORDNUM = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, demi: 0.5, demie: 0.5 };
const UNIT = '(?:kg|kilos?|g|gr|grammes?|ml|cl|l|litres?)';
/* Découpe le texte en aliments, même sans virgules :
   "2 pains 50g viande 70g huile d'olive" ou "viande 50g, dinde 400g" */
function splitFoodText(text) {
  text = text.replace(/(\d)[.,](\d)/g, '$1\u2024$2'); // « 1,5 L » = 1,5 (et pas « 1 » puis « 5 L »)
  const t = text.replace(/\b(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\b(?=\s+[a-zà-ÿœ])/gi, w => String(WORDNUM[w.toLowerCase()]));
  const parts = t.split(/\n|,|;|\.|\+|\bet\b|\bavec\b|\bpuis\b|\bplus\b|\bensuite\b|\bapr[eè]s\b|\baccompagn[ée]e?s?\s+d[e']/i).map(x => x.trim()).filter(x => x.length > 1);
  const out = [];
  const qty = new RegExp(`\\d+(?:[.,\u2024]\\d+)?\\s*${UNIT}?(?![a-z%\\d])`, 'gi');
  for (const p of parts) {
    const ms = [...p.matchAll(qty)].filter(m => !/^\s*%/.test(p.slice(m.index + m[0].length)));
    if (ms.length <= 1) { out.push(p); continue; }
    const startsWithNumber = /^\s*\d/.test(p);
    let cuts = startsWithNumber ? ms.slice(1).map(m => m.index) : ms.slice(0, -1).map(m => m.index + m[0].length);
    let last = 0;
    for (const c of cuts) { const seg = p.slice(last, c).trim(); if (seg) out.push(seg); last = c; }
    const tail = p.slice(last).trim();
    if (tail) out.push(tail);
  }
  for (let k = 0; k < out.length; k++) out[k] = out[k].replace(/\u2024/g, '.');
  // un morceau sans mot ("125g") appartient à l'aliment d'avant
  const merged = [];
  for (const x of out) {
    if (!/[a-zà-ÿœ]{2,}/i.test(x.replace(new RegExp(`\\d+(?:[.,]\\d+)?\\s*${UNIT}\\b`, 'gi'), '')) && merged.length) merged[merged.length - 1] += ' ' + x;
    else merged.push(x);
  }
  return merged.filter(x => /[a-zà-ÿœ]/i.test(x));
}
function cleanFoodChunk(c) {
  let t = c;
  for (const [re, rep] of BRAND_FIX) t = t.replace(re, rep);
  t = t.replace(/\b(ce|cet|au|pour le|le|à|a)?\s*(matin|midi|soir|d[ée]jeuner|d[iî]ner|go[uû]ter|petit[- ]d[ée]j(euner)?)\b\s*,?/gi, ' ').replace(/\s+/g, ' ');
  return t.replace(/^\s*(et\s+)?(que\s+)?(j['’ ]?ai|jai|on a|je me suis fait|je me suis pris|je me suis enfil[ée])\s+(mang[ée]e?s?|pris|prise|bu|aval[ée]|eu|grignot[ée]|fait|enfil[ée])?\s*/i, '').trim();
}
function parseFoodText(text) {
  return splitFoodText(text).map(cleanFoodChunk).filter(c => /[a-zà-ÿœ]{2,}/i.test(c)).map(chunk => {
    const n = normTxt(chunk);
    let grams = null, name = chunk, estimated = false, count = 1, gramsSrc = null;
    const m = chunk.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(kg|kilos?|g|gr|grammes?|ml|cl|l|litres?)(?![a-z])`, 'i'));
    if (m) {
      const v = parseFloat(m[1].replace(',', '.'));
      const u = m[2].toLowerCase();
      grams = u.startsWith('k') ? v * 1000 : u === 'cl' ? v * 10 : (u === 'l' || u.startsWith('litre')) ? v * 1000 : v;
      name = chunk.replace(m[0], ' ');
      gramsSrc = 'text';
    } else {
      const c = n.match(/^(\d+(?:\.\d+)?)\b/) || n.match(/\b(\d+(?:\.\d+)?)\s*$/);
      count = c ? parseFloat(c[1]) : 1;
      const sing = n.replace(/([a-z]{3,})s\b/g, '$1');
      const portion = PORTIONS.find(([re]) => re.test(n) || re.test(sing));
      if (portion) { grams = Math.round(count * portion[1]); estimated = true; gramsSrc = 'table'; }
      if (c) name = chunk.replace(new RegExp('(^\\s*' + c[1].replace('.', '[.,]') + '|' + c[1].replace('.', '[.,]') + '\\s*$)'), ' ');
    }
    name = name.replace(/\b(de|du|des)\s*$/i, '').replace(/^\s*(des\b|du\b|de la\b|de\b|d['’])\s*/i, '').replace(/\s+/g, ' ').trim();
    const brand = (name.match(BRANDS) || [null])[0];
    return { text: chunk.trim(), query: name || chunk, grams: grams ? Math.round(grams) : null, estimated, count, brand, gramsSrc, unitless: !m };
  });
}

/* --- calculs --- */
const macroOf = (food, grams) => {
  const k = grams / 100;
  return { kcal: Math.round(food.per100.kcal * k), p: Math.round(food.per100.p * k * 10) / 10, g: Math.round(food.per100.g * k * 10) / 10, l: Math.round(food.per100.l * k * 10) / 10 };
};
const fmtG = v => (Math.round(v * 10) / 10).toString().replace('.', ',');

/* ---------- Carte "Nutrition du jour" (Accueil) ---------- */
function macroBars(t, tg) {
  const row = (lab, v, goal, unit, cls) => `
    <div class="macro ${cls}">
      <div class="macro-top"><span>${lab}</span><span><b>${fmtNum(v)}</b> / ${fmtNum(goal)} ${unit}</span></div>
      <div class="bar thin"><span style="width:${Math.min(100, (v / goal) * 100)}%"></span></div>
    </div>`;
  return row('Protéines', t.p, tg.p, 'g', 'mp') + row('Glucides', t.g, tg.g, 'g', 'mg') + row('Lipides', t.l, tg.l, 'g', 'ml');
}
function kcalRing(eaten, target) {
  const r = 46, c = 2 * Math.PI * r, f = Math.min(1, eaten / target);
  const over = eaten > target;
  return `
    <svg class="kring ${over ? 'over' : ''}" viewBox="0 0 110 110" aria-hidden="true">
      <circle cx="55" cy="55" r="${r}" class="kr-bg"/>
      <circle cx="55" cy="55" r="${r}" class="kr-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - f)).toFixed(1)}"/>
    </svg>`;
}
/* Ambiance de la journée selon ce que tu as mangé :
   low = pas assez mangé pour l'heure, ok = objectif atteint, over = dépassé, run = en cours */
function nutriStatus(date, t, tg) {
  const today = todayKey();
  const h = date < today ? 24 : new Date().getHours() + new Date().getMinutes() / 60;
  const expected = Math.max(0, Math.min(1, (h - 7) / 14)); // 7 h → 0 %, 21 h → 100 %
  if (t.kcal > tg.kcal + 100) return { k: 'over', icon: '⚠️', title: 'LIMITE DÉPASSÉE', msg: `${fmtNum(t.kcal - tg.kcal)} kcal au-dessus de l'objectif. Le Système te pénalise : pas de quête nutrition aujourd'hui.` };
  if (t.kcal >= tg.kcal - 300) {
    const pOk = t.p >= tg.p * 0.8;
    return { k: 'ok', icon: '🏆', title: pOk ? 'OBJECTIF DU JOUR ATTEINT' : 'CALORIES ATTEINTES', msg: pOk ? 'Calories et protéines dans la cible. Parfait, continue comme ça.' : `Calories bonnes, mais il manque ${fmtNum(tg.p * 0.8 - t.p)} g de protéines.` };
  }
  if (h >= 11 && t.kcal < tg.kcal * expected * 0.5) return { k: 'low', icon: '🥶', title: 'CARBURANT INSUFFISANT', msg: date < today ? 'Journée trop légère : le corps ne peut pas construire de muscle comme ça.' : "Tu n'as pas assez mangé pour l'heure. Mange un vrai repas, riche en protéines." };
  return { k: 'run', icon: '⚡', title: 'JOURNÉE EN COURS', msg: `Encore ${fmtNum(tg.kcal - t.kcal)} kcal à placer intelligemment.` };
}

/* Barre du bas : UNIQUEMENT calories consommées / objectif, avec remplissage animé */
function kcalBar(t, tg) {
  const pct = Math.min(100, (t.kcal / tg.kcal) * 100);
  const over = t.kcal > tg.kcal + 100;
  return `
    <div class="kbar ${over ? 'over' : t.kcal >= tg.kcal - 300 ? 'ok' : ''}">
      <div class="kbar-top"><b data-count-to="${Math.round(t.kcal)}" data-count-from="0" data-dur="1100">${fmtNum(t.kcal)}</b><span> / ${fmtNum(tg.kcal)} kcal</span></div>
      <div class="kbar-track"><span style="width:${pct}%" data-w-from="0"></span><i></i></div>
    </div>`;
}
function mealRowsHtml(date) {
  return MEALS.map((m, i) => {
    const items = state.meals.filter(x => x.date === date && x.meal === m.key);
    const kc = items.reduce((s, x) => s + x.kcal, 0);
    return `<div class="nmeal casc ${items.length ? 'done' : ''}" style="--j:${i}"><span>${m.icon} ${m.label}</span><b>${items.length ? fmtNum(kc) + ' kcal' : '—'}</b></div>`;
  }).join('');
}

function renderNutritionCard(today) {
  const t = dayTotals(today), tg = nutritionTargets();
  const ns = nutriStatus(today, t, tg);
  return `
    <section class="panel nut nut-${ns.k}">
      <div class="nut-fx" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="panel-head"><div class="panel-title">Nutrition du jour</div><button class="btn small ghost" data-go="meals">Ouvrir ›</button></div>
      <div class="nutri-macros top">${macroBars(t, tg)}</div>
      <div class="nut-status"><span class="nut-ico">${ns.icon}</span><div><b>${ns.title}</b><span>${esc(ns.msg)}</span></div></div>
      <div class="nmeals">${mealRowsHtml(today)}</div>
      ${kcalBar(t, tg)}
    </section>`;
}

/* ---------- Onglet Repas ---------- */
function renderMeals() {
  const today = todayKey();
  const day = ui.mealDay || today;
  const t = dayTotals(day), tg = nutritionTargets();
  const left = tg.kcal - t.kcal;
  const validated = nutritionDays(today).has(day);
  const ns = nutriStatus(day, t, tg);
  const mealPhotos = photos.filter(p => p.kind === 'meal' && p.date === day);
  return `
    <section class="panel nut nut-${ns.k}">
      <div class="nut-fx" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="cal-head" style="margin-bottom:12px">
        <button class="icon-btn" data-meal-day="-1" aria-label="Jour précédent">‹</button>
        <div class="center"><div class="cal-month date-glow">${day === today ? "Aujourd'hui · " + esc(fmtDayShort(day)) : esc(fmtDayLong(day))}</div>
          <div class="small muted">${validated ? '<span style="color:var(--good)">✓ Quête nutrition validée (+' + NUTRI_XP + ' XP)</span>' : day === today ? 'Quête : 3 repas, ≤ objectif, protéines ≥ 80 %' : 'Quête nutrition non validée'}</div></div>
        <button class="icon-btn" data-meal-day="1" aria-label="Jour suivant" ${day >= today ? 'disabled style="opacity:.3"' : ''}>›</button>
      </div>
      <div class="nutri-macros top">${macroBars(t, tg)}</div>
      <div class="nut-status"><span class="nut-ico">${ns.icon}</span><div><b>${ns.title}</b><span>${esc(ns.msg)}</span></div></div>
      ${kcalBar(t, tg)}
    </section>

    <button type="button" class="eat-cta enter" style="--i:1" data-add-food="${day === today ? guessMeal() : 'midi'}">
      <span class="eat-ico">🍽️</span><span class="eat-txt"><b>Qu'as-tu mangé ?</b><small>Écris comme tu parles · le Système calcule tout</small></span><span class="eat-plus">＋</span>
    </button>

    ${MEALS.map(m => {
      const items = state.meals.filter(x => x.date === day && x.meal === m.key).sort((a, b) => a.ts - b.ts);
      const ph = mealPhotos.filter(p => p.meal === m.key);
      const kc = items.reduce((s, x) => s + x.kcal, 0);
      return `
      <section class="panel">
        <div class="panel-head"><div class="panel-title">${m.icon} ${m.label}</div><div class="entry-xp" style="color:var(--neon-2)">${fmtNum(kc)} kcal</div></div>
        ${ph.length ? `<div class="meal-photos">${ph.map(p => `<button type="button" class="ph" data-photo="${esc(p.id)}"><img src="${photoUrl(p)}" alt=""></button>`).join('')}</div>` : ''}
        ${items.map((x, xi) => `
          <div class="entry casc" style="--j:${xi}">
            <div class="entry-body">
              <div class="entry-title">${esc(x.name)}</div>
              <div class="entry-meta">${x.grams ? fmtQty(x.grams, x.liq || isLiquid({ name: x.name })) + ' · ' : ''}P ${fmtG(x.p)} · G ${fmtG(x.g)} · L ${fmtG(x.l)}${x.src === 'off' || x.src === 'marque' ? ' · 🏷️' : x.src === 'perso' ? ' · ⭐' : ''}</div>
            </div>
            <div class="entry-xp" style="color:var(--text)">${fmtNum(x.kcal)}</div>
            <button class="icon-btn danger" data-del-food="${esc(x.id)}" aria-label="Supprimer">✕</button>
          </div>`).join('')}
        <div class="btn-row" style="margin-top:${items.length || ph.length ? 10 : 0}px">
          <button class="btn small" data-add-food="${m.key}">＋ Aliments</button>
          <button class="btn small" data-meal-photo="${m.key}">📷 Photo</button>
        </div>
      </section>`;
    }).join('')}
  `;
}

/* ---------- Boissons : quantités en litres (on garde 1 g ≈ 1 ml pour les calculs) ---------- */
const LIQUID_GRP = /boisson|^laits$|^eaux$/;
const LIQUID_NAME = /\b(eau|eaux|lait|jus|coca|cola|soda|sirop|the|cafe|biere|vin|smoothie|boisson|limonade|milkshake|kefir|red bull|monster|fanta|sprite|ice tea|nectar|cidre|champagne|whisky|vodka|rhum|pastis|orangina|oasis|perrier|badoit|lassi)\b/;
function isLiquid(f) {
  if (!f) return false;
  if (f.liq === true) return true;
  const n = normTxt(f.name || '');
  if (/\b(poudre|tablette|confiture|fromage|yaourt|glace|creme|pate|grains?)\b|chocolat au lait|riz au lait|pain au lait|cafe moulu/.test(n) && !/\bboisson/.test(n)) return false;
  if (f.ptype) return f.ptype === 'drink';
  if (f.grp) return LIQUID_GRP.test(f.grp);
  return LIQUID_NAME.test(n);
}
const fmtL = ml => `${(Math.round(ml) / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} L`;
const fmtQty = (g, liq) => (liq ? fmtL(g) : `${fmtNum(g)} g`);

/* ---------- Ajout d'aliments : on écrit comme on parle, on choisit en touchant ---------- */
const capFirst = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const guessMeal = () => { const h = new Date().getHours(); return h < 11 ? 'matin' : h < 15 ? 'midi' : h < 18 ? 'collation' : 'soir'; };
/* Grammes : texte ("150 g") > choix de l'utilisateur > dose du produit > portion habituelle */
function applyGrams(it) {
  const f = it.cands[it.sel];
  if (!f || it.gramsSrc === 'text' || it.gramsSrc === 'user') return;
  if (f.portion && it.unitless) { it.grams = Math.round(f.portion * (it.count || 1)); it.gramsSrc = 'food'; }
  else if (it.gramsSrc !== 'table') { it.grams = Math.round(defaultPortion(f) * (it.count || 1)); it.gramsSrc = 'food'; }
  it.estimated = true;
}
/* "grec frites", "steak frites" : inconnu en un seul mot → plusieurs aliments connus */
function splitCombo(p) {
  if (p.gramsSrc === 'text' || isProteinText(normTxt(p.query), p.brand) || searchAll(p.query).length) return [p];
  const tk = tokensOf(p.query);
  if (tk.length < 2) return [p];
  const keys = [];
  for (let i = 0; i < tk.length;) {
    let L = Math.min(3, tk.length - i);
    while (L > 0 && !FOOD_DEFAULTS[tk.slice(i, i + L).join(' ')]) L--;
    if (!L) return [p];
    keys.push(tk.slice(i, i + L).join(' '));
    i += L;
  }
  return keys.map(k => {
    const por = PORTIONS.find(([re]) => re.test(k));
    return { text: p.text, query: k, grams: por ? Math.round(por[1] * (p.count || 1)) : null, estimated: true, count: p.count || 1, brand: null, gramsSrc: por ? 'table' : null, unitless: true };
  });
}
function buildFoodItem(p) {
  const it = { ...p, cands: [], sel: -1, open: false, form: {}, kind: 'food', cover: 0 };
  const n = normTxt(p.query);
  const perso = searchCustom(p.query).filter(x => x.cover >= 0.8).map(x => customFood(x.f));
  if (isProteinText(n, p.brand)) {
    const pc = protCands(p.query, p.brand);
    Object.assign(it, { kind: 'prot', bk: pc.bk, cands: perso.concat(pc.list), sel: 0, open: !perso.length && !pc.confident, cover: 1 });
  } else {
    const r = searchAll(p.query);
    it.cands = r.map(x => x.food).slice(0, 10);
    if (r.length) {
      const top = r[0], second = r[1];
      it.sel = 0;
      it.cover = top.cover;
      const sure = top.food.src === 'perso' || top.def || (top.cover >= 0.99 && (!second || second.cover < top.cover || top.score - second.score >= 1.5));
      it.open = !sure;
    }
  }
  applyGrams(it);
  return it;
}
function recentFoods() {
  const seen = new Set(), out = [];
  for (const m of state.meals.slice().sort((a, b) => b.ts - a.ts)) {
    const k = normTxt(m.name);
    if (seen.has(k) || !(m.grams > 0)) continue;
    seen.add(k);
    const r = 100 / m.grams;
    out.push({ food: { id: 'r' + k.replace(/ /g, ''), name: m.name, src: m.src || 'ciqual', liq: m.liq || isLiquid({ name: m.name }), per100: { kcal: m.kcal * r, p: m.p * r, g: m.g * r, l: m.l * r } }, grams: m.grams });
    if (out.length >= 12) break;
  }
  return out;
}
function tileHtml(f, i, j, on) {
  const { short, sub } = splitName(f);
  const d = f.portion;
  const m = d ? macroOf(f, d) : null;
  return `<button type="button" class="ftile ${on ? 'on' : ''} casc" style="--j:${j}" data-pick="${i}:${j}">
      <span class="ft-emo">${foodEmoji(f)}</span>
      <span class="ft-name">${esc(short)}</span>
      ${sub ? `<span class="ft-sub">${esc(sub)}</span>` : ''}
      <span class="ft-val">${m ? `<b>${m.kcal}</b> kcal · <b>${fmtG(m.p)}</b> g prot.<small>${isLiquid(f) ? `pour ${fmtL(d)}` : `par dose de ${d} g`}</small>` : `<b>${Math.round(f.per100.kcal)}</b> kcal · <b>${fmtG(f.per100.p)}</b> g prot.<small>${isLiquid(f) ? 'pour 100 ml' : 'pour 100 g'}</small>`}</span>
      ${on ? '<span class="ft-check">✓</span>' : ''}
    </button>`;
}
function qtyHtml(it, i, f) {
  const g = it.grams || 0;
  let chips;
  if (isLiquid(f)) {
    const lv = g ? String(Math.round(g) / 1000).replace('.', ',') : '';
    chips = [250, 330, 500, 1000].map(v => [v, fmtL(v), '']);
    return `
      <div class="fqty">
        <button type="button" class="fq-btn" data-step="${i}:-1" aria-label="Moins">−</button>
        <label class="fq-box liq ${it.estimated ? 'est' : ''}"><input class="fq-val" data-grams="${i}" data-liq="1" inputmode="decimal" value="${lv}" placeholder="?"><span>L</span></label>
        <button type="button" class="fq-btn" data-step="${i}:1" aria-label="Plus">+</button>
      </div>
      <div class="fchips">${chips.map(([v, lab]) => `<button type="button" class="fchip ${v === g ? 'on' : ''}" data-setg="${i}:${v}">${lab}</button>`).join('')}</div>`;
  }
  if (f.portion) chips = [1, 2, 3].map(k => [Math.round(f.portion * k), `${k} dose${k > 1 ? 's' : ''}`, `${Math.round(f.portion * k)} g`]);
  else {
    const b = defaultPortion(f), r = b <= 30 ? 5 : 10;
    chips = [...new Set([0.5, 1, 1.5, 2].map(k => Math.max(r, Math.round((b * k) / r) * r)))].map(v => [v, `${v} g`, '']);
  }
  return `
      <div class="fqty">
        <button type="button" class="fq-btn" data-step="${i}:-1" aria-label="Moins">−</button>
        <label class="fq-box ${it.estimated ? 'est' : ''}"><input class="fq-val" data-grams="${i}" inputmode="decimal" value="${g || ''}" placeholder="?"><span>g</span></label>
        <button type="button" class="fq-btn" data-step="${i}:1" aria-label="Plus">+</button>
      </div>
      <div class="fchips">${chips.map(([v, lab, small]) => `<button type="button" class="fchip ${v === g ? 'on' : ''}" data-setg="${i}:${v}">${lab}${small ? `<small>${small}</small>` : ''}</button>`).join('')}</div>`;
}
function labelFormHtml(it, i) {
  const f = it.form || {};
  return `
      <div class="food-form">
        <div class="ff-title">[SYSTÈME] Valeurs de l'étiquette</div>
        <label class="field"><span>Nom</span><input class="input" data-ff="name" data-i="${i}" value="${esc(f.name != null ? f.name : capFirst(it.query))}"></label>
        <div class="seg ff-per">
          <button type="button" class="${f.per !== 'portion' ? 'on' : ''}" data-ffper="100" data-i="${i}">Pour 100 g</button>
          <button type="button" class="${f.per === 'portion' ? 'on' : ''}" data-ffper="portion" data-i="${i}">Par dose / portion</button>
        </div>
        ${f.per === 'portion' ? `<label class="field"><span>Une dose = combien de grammes ?</span><input class="input" data-ff="pg" data-i="${i}" inputmode="decimal" placeholder="ex. 30" value="${esc(f.pg || '')}"></label>` : ''}
        <div class="ff-grid">
          <label><span>Protéines (g)</span><input class="input" data-ff="p" data-i="${i}" inputmode="decimal" value="${esc(f.p || '')}"></label>
          <label><span>Glucides (g)</span><input class="input" data-ff="g" data-i="${i}" inputmode="decimal" value="${esc(f.g || '')}"></label>
          <label><span>Lipides (g)</span><input class="input" data-ff="l" data-i="${i}" inputmode="decimal" value="${esc(f.l || '')}"></label>
          <label><span>Calories</span><input class="input" data-ff="kcal" data-i="${i}" inputmode="decimal" placeholder="auto" value="${esc(f.kcal || '')}"></label>
        </div>
        <button type="button" class="btn primary block" data-ffok="${i}">✓ OK — calculer et retenir</button>
      </div>`;
}
function foodCardHtml(it, i) {
  const f = it.cands[it.sel];
  const mac = f && it.grams ? macroOf(f, it.grams) : null;
  const nm = f ? splitName(f) : null;
  const isProt = it.kind === 'prot';
  const cats = !it.cands.length || it.showCats;
  let body = '';
  if (it.open && it.cands.length) {
    const ask = isProt ? (it.bk ? `💪 Quelle protéine <b>${esc(it.bk)}</b> ?` : '💪 Quel type de protéine ? <span>(ou touche ta marque)</span>') : '👉 Lequel ? <span>Touche le bon</span>';
    body += `<div class="fc-ask">${ask}</div>
      ${isProt ? `<div class="fbrands">${['', ...Object.keys(BRAND_PRODUCTS)].map(b => `<button type="button" class="fchip ${b === (it.bk || '') ? 'on' : ''}" data-brand="${i}:${esc(b)}">${b ? esc(b) : 'Sans marque'}</button>`).join('')}</div>` : ''}
      <div class="tiles">${it.cands.slice(0, isProt ? 14 : 8).map((c, j) => tileHtml(c, i, j, j === it.sel)).join('')}
        ${navigator.onLine ? `<button type="button" class="ftile web" data-off="${i}"><span class="ft-emo">${it.loading ? '⟳' : '🔎'}</span><span class="ft-name">${it.loading ? 'Recherche…' : 'Chercher sur Internet'}</span><span class="ft-sub">autres produits de marque</span></button>` : ''}
        ${!isProt && !it.showCats ? `<button type="button" class="ftile web" data-cats="${i}"><span class="ft-emo">🧩</span><span class="ft-name">Pas dans la liste</span><span class="ft-sub">choisir le type d'aliment</span></button>` : ''}
      </div>`;
  }
  if (cats) {
    body += `<div class="fc-ask">${it.cands.length ? '🧩 C’est plutôt quel type ?' : `👉 Touche ce qui ressemble le plus${it.loading ? ' <span>(je cherche aussi sur Internet…)</span>' : ''}`}</div>
      <div class="tiles cats">${FOOD_CATS.map(([e, lab], k) => `<button type="button" class="ctile casc" style="--j:${k}" data-cat="${i}:${k}"><span>${e}</span>${esc(lab)}</button>`).join('')}</div>`;
  }
  return `
    <div class="fcard ${f ? (it.open ? 'choose' : 'ok') : 'unknown'} enter" style="--i:${Math.min(i, 6)}" data-row="${i}">
      <div class="fc-head">
        ${f ? `<span class="fc-emo">${foodEmoji(f)}</span>
        <div class="fc-main"><b>${esc(nm.short)}</b><span>${esc(nm.sub || '')}</span></div>
        <div class="fc-kcal"><b>${mac ? fmtNum(mac.kcal) : '–'}</b><span>kcal</span></div>`
        : `<span class="fc-emo">${it.loading ? '⟳' : '❓'}</span>
        <div class="fc-main"><b>${esc(capFirst(it.query))}</b><span>${it.loading ? 'Je cherche le produit…' : 'Je ne connais pas encore cet aliment'}</span></div>`}
        <button type="button" class="fc-x" data-rm="${i}" aria-label="Retirer">✕</button>
      </div>
      ${it.text && ![normTxt(it.query), normTxt(f ? f.name : ''), normTxt(nm ? nm.short : '')].includes(normTxt(it.text)) ? `<div class="fc-said">« ${esc(it.text)} »</div>` : ''}
      ${body}
      ${f ? `${qtyHtml(it, i, f)}
      <div class="fc-mac">${mac ? `<span class="mp">Prot. <b>${fmtG(mac.p)}</b> g</span><span class="mg">Gluc. <b>${fmtG(mac.g)}</b> g</span><span class="ml">Lip. <b>${fmtG(mac.l)}</b> g</span>` : '<span>Choisis la quantité</span>'}</div>
      ${it.estimated ? '<div class="fc-est">≈ quantité estimée — ajuste avec − / + si besoin</div>' : ''}` : ''}
      ${it.manual ? labelFormHtml(it, i) : ''}
      <div class="fc-actions">
        ${f && it.cands.length > 1 ? `<button type="button" class="flink" data-open="${i}">${it.open ? '✓ Garder ce choix' : '↻ Changer'}</button>` : ''}
        <button type="button" class="flink" data-manual="${i}">${it.manual ? '✕ Fermer l’étiquette' : '✎ J’ai l’étiquette'}</button>
      </div>
    </div>`;
}

function openFoodSheet(meal) {
  let mealSel = meal || guessMeal();
  const day = ui.mealDay || todayKey();
  let items = [];
  const recents = recentFoods();
  const EX = ['2 oeufs, une tranche de pain et un café', '150 g de riz, du poulet et des haricots verts', '1 dose de whey InShape avec 300 ml de lait', 'un grec frites et un coca', 'une assiette de pâtes bolognaise', '2 doses de clear whey MyProtein'];
  openSheet({
    tag: '[SYSTÈME] Journal alimentaire',
    cls: 'food-sheet',
    body: `
      <button type="button" class="fs-close" data-close="1" aria-label="Fermer">✕</button>
      <div class="fs-title">🍽️ Qu'as-tu mangé ?</div>
      <div class="fs-meals">${MEALS.map(m => `<button type="button" class="fchip ${m.key === mealSel ? 'on' : ''}" data-meal="${m.key}">${m.icon} ${m.label}</button>`).join('')}</div>
      <div class="fs-write">
        <textarea class="fs-text" id="food-text" rows="2" enterkeyhint="send" placeholder="Ex : ${esc(EX[Math.floor(Math.random() * EX.length)])}"></textarea>
        <button type="button" class="fs-go" data-analyse="1" aria-label="Analyser">⚡</button>
      </div>
      <div class="fs-hint">Écris comme tu parles, même sans les grammes. 🎤 Tu peux aussi dicter avec le micro du clavier.</div>
      ${recents.length ? `<div class="fs-sec">⏱ Déjà mangé · touche pour ajouter</div>
      <div class="fs-recents">${recents.map((r, k) => `<button type="button" class="rchip" data-recent="${k}"><span>${foodEmoji(r.food)}</span><b>${esc(splitName(r.food).short)}</b><small>${fmtQty(r.grams, r.food.liq)}</small></button>`).join('')}</div>` : ''}
      <div id="food-rows"></div>
      <div class="fs-foot" id="food-save" style="display:none">
        <div id="food-total"></div>
        <button type="button" class="btn primary block fs-add" data-food-save="1"></button>
      </div>`,
    onMount(sheet, close) {
      const readForm = i => {
        const it = items[i];
        if (!it) return;
        it.form = it.form || {};
        sheet.querySelectorAll(`[data-ff][data-i="${i}"]`).forEach(inp => { it.form[inp.dataset.ff] = inp.value; });
      };
      const draw = () => {
        items.forEach((it, i) => { if (it.manual) readForm(i); });
        $('#food-rows', sheet).innerHTML = items.map(foodCardHtml).join('');
        const ok = items.filter(it => it.cands[it.sel] && it.grams > 0);
        const todo = items.length - ok.length;
        $('#food-save', sheet).style.display = items.length ? '' : 'none';
        const tot = ok.reduce((t, it) => { const m = macroOf(it.cands[it.sel], it.grams); t.kcal += m.kcal; t.p += m.p; t.g += m.g; t.l += m.l; return t; }, { kcal: 0, p: 0, g: 0, l: 0 });
        $('#food-total', sheet).innerHTML = `
          <div class="ftot"><b>🔥 ${fmtNum(tot.kcal)} kcal</b><span class="mp">P ${fmtG(tot.p)} g</span><span class="mg">G ${fmtG(tot.g)} g</span><span class="ml">L ${fmtG(tot.l)} g</span></div>
          ${todo ? `<div class="ftodo">❓ ${todo} aliment${todo > 1 ? 's' : ''} à choisir (touche une case)</div>` : ''}`;
        const ml = mealLabel(mealSel);
        $('[data-food-save]', sheet).textContent = `✓ Ajouter ${ok.length > 1 ? `les ${ok.length} aliments ` : ''}${mealSel === 'collation' ? 'à la collation' : 'au ' + ml.label.toLowerCase()} ${ml.icon}`;
      };
      const searchBrand = async (it, auto = false) => {
        if (!navigator.onLine) { if (!auto) toast('Pas de connexion', 'La recherche sur Internet demande une connexion.', 'warn'); return; }
        it.loading = true; draw();
        try {
          const core = it.query.replace(new RegExp(BRANDS.source, 'gi'), ' ').replace(/\bnutrition\b/gi, ' ').replace(/\s+/g, ' ').trim();
          const tries = [...new Set([it.query, it.brand && core ? `${it.brand} ${core}` : null, it.brand && !core ? `${it.brand} whey` : null, it.query.replace(/\bnutrition\b/gi, ' ').replace(/\s+/g, ' ').trim()].filter(Boolean).map(x => x.trim()))];
          let res = [];
          for (const q of tries) { res = await searchOFF(q, 8); if (res.length) break; }
          if (it.brand && res.length) {
            const b = normJ(it.brand).trim();
            res.sort((x, y) => (normJ(y.name).includes(b) ? 1 : 0) - (normJ(x.name).includes(b) ? 1 : 0));
          }
          if (res.length) {
            const had = it.cands[it.sel];
            const perso = it.cands.filter(c => c.src === 'perso');
            const others = it.cands.filter(c => c.src !== 'perso' && c.src !== 'off');
            it.cands = [...perso, ...res, ...others];
            it.sel = perso.length || !had || !auto || it.brand ? 0 : it.cands.indexOf(had);
            it.open = true;
            applyGrams(it);
          } else if (!auto) toast('Rien trouvé sur Internet', 'Touche le type d’aliment le plus proche, ou « J’ai l’étiquette ».', 'warn');
        } catch (e) {
          if (!auto) toast('Recherche impossible', 'Internet ne répond pas : choisis une case.', 'warn');
        }
        it.loading = false;
        if (sheet.isConnected) draw();
      };
      const analyse = async () => {
        const ta = $('#food-text', sheet);
        const txt = ta.value.trim();
        if (!txt) { toast('Écris ce que tu as mangé', 'Ex : « 2 oeufs et un café » — ou touche un aliment déjà mangé.', 'warn'); ta.focus(); return; }
        try { await loadCiqual(); } catch (_) { toast('Base aliments indisponible', 'Réessaie avec Internet.', 'warn'); return; }
        const fresh = parseFoodText(txt).flatMap(splitCombo).map(buildFoodItem);
        if (!fresh.length) { toast('Je n’ai rien compris', 'Écris le nom des aliments, ex : « riz, poulet ».', 'warn'); return; }
        items = items.concat(fresh);
        ta.value = '';
        ta.blur();
        sfx('open'); haptic();
        draw();
        // produits de marque ou inconnus : recherche automatique sur Internet
        fresh.filter(it => !(it.cands[0] && it.cands[0].src === 'perso') && (!it.cands.length || (it.brand && !catalogBrand(it.brand)) || (it.kind === 'food' && it.cover < 0.6))).forEach(it => searchBrand(it, true));
        const first = $('#food-rows .fcard:nth-last-child(' + fresh.length + ')', sheet);
        if (first) setTimeout(() => first.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      };
      $('#food-text', sheet).addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); analyse(); } });
      const pair = s => { const [a, b] = s.split(':'); return [+a, b]; };
      sheet.addEventListener('click', async e => {
        const t = e.target;
        if (t.closest('[data-close]')) { close(null); return; }
        const mb = t.closest('[data-meal]');
        if (mb) { mealSel = mb.dataset.meal; sheet.querySelectorAll('[data-meal]').forEach(b => b.classList.toggle('on', b === mb)); haptic(); if (items.length) draw(); return; }
        if (t.closest('[data-analyse]')) { analyse(); return; }
        const rc = t.closest('[data-recent]');
        if (rc) {
          const r = recents[+rc.dataset.recent];
          items.push({ text: '', query: r.food.name, grams: r.grams, gramsSrc: 'user', estimated: false, count: 1, cands: [r.food], sel: 0, open: false, kind: 'food', form: {} });
          rc.classList.add('added');
          sfx('tap'); haptic(); draw();
          return;
        }
        const pk = t.closest('[data-pick]');
        if (pk) {
          const [i, j] = pair(pk.dataset.pick), it = items[i];
          it.sel = +j; it.open = false; it.showCats = false;
          applyGrams(it);
          sfx('tap'); haptic(); draw();
          return;
        }
        const op = t.closest('[data-open]');
        if (op) { const it = items[+op.dataset.open]; it.open = !it.open; it.showCats = false; haptic(); draw(); return; }
        const sc = t.closest('[data-cats]');
        if (sc) { items[+sc.dataset.cats].showCats = true; draw(); return; }
        const br = t.closest('[data-brand]');
        if (br) {
          const [i, b] = pair(br.dataset.brand), it = items[i];
          const pc = protCands(it.query, b || null);
          it.brand = b || null; it.bk = pc.bk;
          it.cands = it.cands.filter(c => c.src === 'perso').concat(pc.list);
          it.sel = it.cands.findIndex(c => c.src !== 'perso');
          it.open = true;
          if (it.gramsSrc === 'food') it.gramsSrc = null;
          applyGrams(it);
          haptic(); draw();
          return;
        }
        const ct = t.closest('[data-cat]');
        if (ct) {
          const [i, k] = pair(ct.dataset.cat), it = items[i];
          const [emo, lab, ref] = FOOD_CATS[+k];
          if (!ref) { // protéine
            const pc = protCands(it.query, it.brand);
            Object.assign(it, { kind: 'prot', bk: pc.bk, cands: pc.list, sel: 0, open: true, showCats: false });
            if (it.gramsSrc === 'food') it.gramsSrc = null;
            applyGrams(it); haptic(); draw();
            return;
          }
          const cf = ciqual && ciqual.find(x => x.n === ref);
          if (!cf) return;
          // retenu dans « Mes aliments » : la prochaine fois, il est reconnu tout de suite
          const name = capFirst(it.query).slice(0, 80);
          const mine = { id: uid(), name, ts: Date.now(), u: Date.now(), portion: null, grp: cf.grp || '', emoji: emo, per100: { kcal: cf.kcal || 0, p: cf.p || 0, g: cf.g || 0, l: cf.l || 0 } };
          state.customFoods.filter(x => normTxt(x.name) === normTxt(name)).forEach(x => tomb(x.id));
          state.customFoods = state.customFoods.filter(x => normTxt(x.name) !== normTxt(name)).concat(mine);
          save();
          const food = { ...customFood(mine), short: name, sub: `≈ ${lab.toLowerCase()} (valeurs moyennes)` };
          it.cands = [food, ...it.cands.filter(c => c.src !== 'perso')];
          it.sel = 0; it.open = false; it.showCats = false;
          if (it.gramsSrc === 'food') it.gramsSrc = null;
          applyGrams(it);
          sfx('tap'); haptic(); draw();
          return;
        }
        const st = t.closest('[data-step]');
        if (st) {
          const [i, dir] = pair(st.dataset.step), it = items[i], f = it.cands[it.sel];
          if (!f) return;
          const b = defaultPortion(f), step = isLiquid(f) ? 50 : f.portion || (b <= 30 ? 5 : b <= 100 ? 10 : 25);
          const cur = it.grams || 0;
          it.grams = Math.max(step, Math.min(5000, Math.round((cur + +dir * step) / step) * step || step));
          it.gramsSrc = 'user'; it.estimated = false;
          haptic(); draw();
          return;
        }
        const sg = t.closest('[data-setg]');
        if (sg) { const [i, v] = pair(sg.dataset.setg), it = items[i]; it.grams = +v; it.gramsSrc = 'user'; it.estimated = false; haptic(); draw(); return; }
        const off = t.closest('[data-off]');
        if (off) { searchBrand(items[+off.dataset.off]); return; }
        const man = t.closest('[data-manual]');
        if (man) { const i = +man.dataset.manual, it = items[i]; readForm(i); it.manual = !it.manual; draw(); return; }
        const per = t.closest('[data-ffper]');
        if (per) { const i = +per.dataset.i; readForm(i); items[i].form.per = per.dataset.ffper; draw(); return; }
        const okb = t.closest('[data-ffok]');
        if (okb) {
          const i = +okb.dataset.ffok, it = items[i];
          readForm(i);
          const f = it.form, num = v => { const x = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(x) && x >= 0 ? x : null; };
          const p = num(f.p) || 0, g = num(f.g) || 0, l = num(f.l) || 0;
          let kcal = num(f.kcal);
          if (kcal == null) kcal = 4 * p + 4 * g + 9 * l;
          if (!kcal && !p) { toast('Valeurs manquantes', 'Entre au moins les protéines ou les calories.', 'warn'); return; }
          let k = 1, portion = null;
          if (f.per === 'portion') {
            portion = num(f.pg);
            if (!portion) { toast('Dose manquante', 'Indique le poids d’une dose (ex. 30 g pour la whey).', 'warn'); return; }
            k = 100 / portion;
          }
          const name = (f.name || capFirst(it.query)).trim().slice(0, 80) || it.query;
          const cf = { id: uid(), name, ts: Date.now(), u: Date.now(), portion: portion ? Math.round(portion) : null,
            per100: { kcal: Math.round(kcal * k * 10) / 10, p: Math.round(p * k * 10) / 10, g: Math.round(g * k * 10) / 10, l: Math.round(l * k * 10) / 10 } };
          state.customFoods.filter(x => normTxt(x.name) === normTxt(name)).forEach(x => tomb(x.id));
          state.customFoods = state.customFoods.filter(x => normTxt(x.name) !== normTxt(name)).concat(cf);
          save();
          it.cands = [customFood(cf), ...it.cands.filter(c => c.src !== 'perso')];
          it.sel = 0; it.manual = false; it.open = false; it.showCats = false;
          if (portion && it.gramsSrc !== 'text' && it.gramsSrc !== 'user') { it.grams = Math.round(portion * (it.count || 1)); it.gramsSrc = 'food'; it.estimated = false; }
          else applyGrams(it);
          draw();
          sfx('success'); haptic();
          toast('Aliment retenu', `⭐ ${name} · ${Math.round(cf.per100.kcal)} kcal et ${fmtG(cf.per100.p)} g de protéines pour 100 g`);
          return;
        }
        const rm = t.closest('[data-rm]');
        if (rm) { items.splice(+rm.dataset.rm, 1); haptic(); draw(); return; }
        if (t.closest('[data-food-save]')) {
          const ok = items.filter(it => it.cands[it.sel] && it.grams > 0);
          if (!ok.length) { toast('Rien à ajouter', 'Touche une case pour choisir chaque aliment.', 'warn'); return; }
          const ml = mealLabel(mealSel);
          const now = Date.now();
          const qWas = dailyQuest(day).done;
          ok.forEach((it, k) => {
            const f = it.cands[it.sel];
            state.meals.push({ id: uid(), date: day, meal: mealSel, ts: now + k, name: f.name.slice(0, 120), grams: it.grams, ...macroOf(f, it.grams), src: f.src, ...(isLiquid(f) ? { liq: true } : {}) });
          });
          save();
          close(null);
          render();
          const kc = ok.reduce((s, it) => s + macroOf(it.cands[it.sel], it.grams).kcal, 0);
          const tt = dayTotals(day), tg = nutritionTargets();
          toast(`${ml.label} enregistré`, `+${fmtNum(kc)} kcal · reste ${fmtNum(tg.kcal - tt.kcal)} kcal aujourd'hui`);
          sfx('success'); haptic();
          if (day >= addDays(todayKey(), -BACKFILL_DAYS)) setTimeout(() => questCompletedCheck(qWas, day), 600);
        }
      });
      sheet.addEventListener('change', e => {
        const g = e.target.closest('[data-grams]');
        if (g) {
          let v = parseFloat(g.value.replace(',', '.'));
          // boisson : on tape des litres (0,5) ; un grand nombre (330) est compris en ml
          if (g.dataset.liq && Number.isFinite(v)) v = v <= 10 ? v * 1000 : v;
          const it = items[+g.dataset.grams]; it.grams = Number.isFinite(v) && v > 0 ? Math.min(5000, Math.round(v)) : null; it.gramsSrc = 'user'; it.estimated = false; draw();
        }
      });
      setTimeout(() => { const ta = $('#food-text', sheet); if (ta && !recents.length) ta.focus(); }, 300);
    },
  });
}

async function deleteFood(id) {
  const x = state.meals.find(m => m.id === id);
  if (!x) return;
  if (!(await confirmBox('Retirer cet aliment ?', `${esc(x.name)} — ${fmtNum(x.kcal)} kcal`, 'Retirer', true))) return;
  tomb(id);
  state.meals = state.meals.filter(m => m.id !== id);
  save();
  render();
}

/* =========================================================
   LE SYSTÈME JUGE : notes des quêtes, journée racontée, progression
   ========================================================= */
const normJ = s => ' ' + s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ') + ' ';
const NOTE_POS = [
  [/ sans (mon )?(tel|telephone|portable) /, 'sans téléphone', 0.12],
  [/ (intens|a fond|max|record|pr |depasse|explos|sprint|lourd|serie|reps|km |fractionn|hiit|transpir|mort)/, 'intense', 0.15],
  [/ (concentr|focus|productif|efficace|applique|serieux|discipline|deep work|pomodoro|zone )/, 'concentré', 0.12],
  [/ (fini|termine|boucle|publie|poste|livre|valide|reussi|objectif atteint)/, 'objectif accompli', 0.1],
  [/ (appris|compris|revis|lu |lecture|chapitre|cours|formation|tuto)/, 'apprentissage', 0.08],
  [/ (nouveau|premiere fois|progres|ameliore|mieux que)/, 'progrès', 0.08],
  [/ (viewer|abonne|vue|follow)/, 'résultats', 0.05],
];
const NOTE_NEG = [
  [/ (distrait|deconcentr|telephone|portable|scroll|insta|snap|netflix|youtube)/, 'distractions', -0.15],
  [/ (fatigu|crev|epuis|pas dormi|mal dormi|malade)/, 'fatigue', -0.08],
  [/ (pas motive|flemme|glande|procrastin|rien fait|nul |rate |bacle|abandonn|arrete tot|ecourte|pas fini)/, "manque d'engagement", -0.2],
  [/ (court|vite fait|leger|tranquille|pepere)/, 'séance légère', -0.08],
];
/* Note d'une quête → multiplicateur d'XP et de stats (0,6 à 1,5) */
function judgeNote(text) {
  if (!text || !text.trim()) return { mult: 1, tags: [], verdict: '' };
  let t = normJ(text);
  const tags = [];
  let sum = 0;
  for (const [re, tag, v] of NOTE_POS) if (re.test(t)) { sum += v; tags.push('+ ' + tag); t = t.replace(re, ' '); }
  for (const [re, tag, v] of NOTE_NEG) if (re.test(t)) { sum += v; tags.push('− ' + tag); }
  const mult = Math.round(Math.max(0.6, Math.min(1.5, 1 + sum)) * 100) / 100;
  const verdict = tags.length ? `Qualité ×${String(mult).replace('.', ',')} · ${tags.join(', ')}` : '';
  return { mult, tags, verdict };
}

/* Journée racontée → score de Concentration de −3 à +3 */
const DAY_FOCUS = [
  [/ (travail|bosse|boss|taf|boulot|chantier)/, 'travail'], [/ (revis|etudi|cours|lecture|lu |livre|appris|formation|tuto)/, 'apprentissage'],
  [/ (montage|monte|clip|edit|miniature)/, 'montage'], [/ (live|stream)/, 'live'], [/ (code|programm|projet|ecrit|script)/, 'projet'],
  [/ (sport|muscu|salle|course|couru|entrain|foot|boxe|natation)/, 'sport'], [/ (medit|lecture|focus|concentr|productif|pomodoro|deep work)/, 'focus'],
];
const DAY_DISTRACT = [
  [/ (scroll|reseaux|insta|instagram|snap|snapchat|facebook|twitter| x )/, 'réseaux'], [/ (regarde tiktok|scroll tiktok|sur tiktok|tiktok pendant)/, 'TikTok'],
  [/ (youtube|netflix|serie|film|anime)/, 'vidéos'], [/ (jeu|jeux|ps5|playstation|console|fortnite|fifa|valorant)/, 'jeux'],
  [/ (glande|rien fait|procrastin|traine|perdu du temps|dormi toute|sieste)/, 'temps perdu'], [/ (distrait|deconcentr|telephone|portable)/, 'distractions'],
];
function hoursIn(chunk) {
  let h = 0, found = false;
  const re = /(\d+(?:[.,]\d+)?)\s*(h|heures?|hr)\s*(\d{1,2})?|(\d+)\s*(min|minutes?|mn)/gi;
  let m;
  while ((m = re.exec(chunk))) {
    found = true;
    if (m[1]) h += parseFloat(m[1].replace(',', '.')) + (m[3] ? +m[3] / 60 : 0);
    else h += +m[4] / 60;
  }
  return found ? h : null;
}
function judgeDay(text) {
  const chunks = text.split(/[\n.;!?]+|,| puis | ensuite | apres | et /i).map(c => c.trim()).filter(Boolean);
  let focusH = 0, distH = 0;
  const focusTags = new Set(), distTags = new Set();
  for (const c of chunks) {
    const t = normJ(c);
    const h = hoursIn(c);
    const isLive = / (live|stream)/.test(t);
    const d = DAY_DISTRACT.filter(([re, tag]) => re.test(t) && !(isLive && tag === 'TikTok'));
    const f = DAY_FOCUS.filter(([re]) => re.test(t));
    if (d.length && !(/ sans /.test(t))) { distH += h != null ? h : 0.75; d.forEach(([, tag]) => distTags.add(tag)); }
    else if (f.length) { focusH += h != null ? h : 0.75; f.forEach(([, tag]) => focusTags.add(tag)); }
  }
  const t = normJ(text);
  let bonus = 0;
  if (/ (concentr|focus|productif|efficace|discipline)/.test(t)) bonus += 0.5;
  if (/ (distrait|procrastin|glande|rien fait|perdu du temps)/.test(t)) bonus -= 0.5;
  const raw = (focusH - 1.3 * distH) / 1.5 + bonus;
  const score = Math.max(-3, Math.min(3, Math.round(raw * 2) / 2));
  const grade = score >= 2.5 ? 'S' : score >= 1.5 ? 'A' : score >= 0.5 ? 'B' : score > -0.5 ? 'C' : score > -1.5 ? 'D' : 'E';
  const fh = Math.round(focusH * 10) / 10, dh = Math.round(distH * 10) / 10;
  const parts = [];
  if (focusTags.size) parts.push(`Focus ≈ ${String(fh).replace('.', ',')} h (${[...focusTags].join(', ')})`);
  if (distTags.size) parts.push(`Distractions ≈ ${String(dh).replace('.', ',')} h (${[...distTags].join(', ')})`);
  if (!parts.length) parts.push('Rien de mesurable : précise ce que tu as fait et combien de temps.');
  return { score, grade, focusH: fh, distH: dh, verdict: parts.join(' · ') };
}

function openJournalSheet() {
  const today = todayKey();
  const prev = state.journals.find(j => j.date === today);
  openSheet({
    tag: '[SYSTÈME] Rapport de journée',
    title: '🎯 Raconte ta journée',
    body: `
      <p class="small" style="margin-top:-6px">Écris ce que tu as fait aujourd'hui, avec les durées si possible. Le Système juge ta <b>Concentration</b> : le travail, l'apprentissage, le montage, les lives et le sport comptent pour ; les réseaux, les vidéos, les jeux et le temps perdu comptent contre.</p>
      <textarea class="input" id="journal-text" rows="6" placeholder="Ex : 3 h de montage concentré, 2 h de live, 1 h de salle, puis 1 h 30 à scroller sur Insta…">${prev ? esc(prev.text) : ''}</textarea>
      <button type="button" class="btn primary block" style="margin-top:12px" data-judge="1">⚖️ Faire juger ma journée</button>
      ${prev ? `<p class="small faint">Déjà jugée aujourd'hui (${prev.score > 0 ? '+' : ''}${String(prev.score).replace('.', ',')}). Renvoyer remplace le jugement.</p>` : ''}`,
    buttons: [{ label: 'Fermer', value: null, cls: 'ghost' }],
    onMount(sheet, close) {
      sheet.addEventListener('click', e => {
        if (!e.target.closest('[data-judge]')) return;
        const text = $('#journal-text', sheet).value.trim();
        if (text.length < 8) { toast('Trop court', 'Raconte un peu plus ta journée.', 'warn'); return; }
        const before = computeStats(state.logs, today).values.concentration;
        const j = judgeDay(text);
        state.journals.filter(x => x.date === today).forEach(x => tomb(x.id));
        state.journals = state.journals.filter(x => x.date !== today);
        state.journals.push({ id: uid(), date: today, ts: Date.now(), text: text.slice(0, 1000), score: j.score, verdict: j.verdict });
        save();
        close(null);
        render();
        const after = computeStats(state.logs, today).values.concentration;
        const d = after - before;
        celebrate({
          kind: j.score > 0 ? 'win' : j.score < 0 ? 'fail' : 'neutral',
          title: `JOURNÉE DE RANG ${j.grade}`,
          big: `${j.score > 0 ? '+' : ''}${String(j.score).replace('.', ',')}`,
          sub: `Concentration ${d >= 0 ? '+' : ''}${d.toFixed(2).replace('.', ',')}`,
          lines: [j.verdict],
        });
      });
    },
  });
}

/* Progression globale : stats + corps + nutrition, sur toute l'année */
const PROG_GRADES = [['S', 80], ['A', 62], ['B', 45], ['C', 30], ['D', 15], ['E', 0]];
function weightAt(date) {
  let w = state.body.startWeight;
  for (const x of state.weights) { if (x.date <= date) w = x.kg; else break; }
  return w;
}
/* Progression à une date donnée (pour comparer jour / semaine / mois) */
function progressionInfo(today, st, at) {
  st = st || computeStats(state.logs, today);
  at = at || today;
  const vals = at === today ? st.values : (st.history.get(at) || st.base);
  const gains = STAT_KEYS.map(k => vals[k] - st.base[k]);
  const statGain = gains.reduce((a, b) => a + b, 0) / gains.length;
  const b = state.body, span = b.goalWeight - b.startWeight;
  const bp = at === today ? bodyProgress().progress : (span === 0 ? 1 : Math.max(0, Math.min(1, (weightAt(at) - b.startWeight) / span)));
  const nd = nutritionDays(today);
  let ok = 0, n = 0;
  for (let i = 1; i <= 30; i++) { const d = addDays(at, -i); if (d < st.start) break; n++; if (nd.has(d)) ok++; }
  const nutri = n ? ok / n : 0;
  const parts = { stats: Math.min(1, Math.max(0, statGain) / 30), corps: bp, nutrition: nutri };
  const score = 100 * (0.4 * parts.stats + 0.35 * parts.corps + 0.25 * parts.nutrition);
  const grade = PROG_GRADES.find(([, min]) => score >= min)[0];
  const next = PROG_GRADES.slice().reverse().find(([, min]) => min > score);
  const day = daysBetween(st.start, at);
  return { score, grade, next, parts, statGain, day };
}

/* =========================================================
   BILAN DU JOUR : ce que j'ai accompli / ce qui m'a fait perdre du temps
   Calcul honnête : 30 min utiles = 1 point pour les stats concernées ;
   1 h perdue = −2,5 points (ça pèse plus lourd). Sans durée : 1 h par élément.
   Ce qui est déjà enregistré en quête n'est pas compté deux fois.
   ========================================================= */
const BIL_GOOD = [
  { re: / (sport|muscu|salle|course|couru|footing|jogging|run |velo|natation|boxe|foot|basket|pompes|abdos|entrain|cardio|marche|seance)/, label: 'Sport', w: { physique: 1, discipline: 0.5 }, act: /sport/ },
  { re: / (live|stream)/, label: 'Live', w: { concentration: 0.8, discipline: 0.6 }, act: /live/ },
  { re: / (clip|montage|monte|edit|miniature|tournage|filme)/, label: 'Clips / montage', w: { intelligence: 0.8, concentration: 0.6 }, act: /clip|montage/ },
  { re: / (lecture|lu |livre|appris|apprentissage|cours|revis|etudi|formation|tuto|anglais|langue|podcast)/, label: 'Apprentissage', w: { intelligence: 1, concentration: 0.5 }, act: /lecture|apprentissage/ },
  { re: / (travail|bosse|boulot|taf|chantier|job|shift)/, label: 'Travail', w: { discipline: 0.8, physique: 0.4 }, act: /travail/ },
  { re: / (code|programm|projet|business|entreprise|ecrit|script)/, label: 'Projet', w: { intelligence: 0.8, discipline: 0.6, concentration: 0.4 } },
  { re: / (medit|respiration|yoga)/, label: 'Méditation', w: { concentration: 1, discipline: 0.3 } },
  { re: / (dormi|sommeil|couche tot)/, label: 'Sommeil', w: { physique: 0.5, concentration: 0.3 } },
  { re: / (cuisine|meal prep|prepare mes repas)/, label: 'Cuisine', w: { discipline: 0.5, physique: 0.2 } },
  { re: / (menage|range|rangement)/, label: 'Rangement', w: { discipline: 0.5 } },
];
const BIL_BAD = [
  { re: / (tiktok|insta|instagram|snap|reseaux|scroll|facebook|twitter|reels|shorts)/, label: 'Réseaux / scroll', w: { concentration: 1, discipline: 0.7 } },
  { re: / (youtube|netflix|serie|film|anime|twitch)/, label: 'Vidéos / séries', w: { concentration: 0.8, discipline: 0.5 } },
  { re: / (jeu|jeux|ps5|playstation|console|fortnite|fifa|valorant|lol |gaming|warzone|cod )/, label: 'Jeux vidéo', w: { discipline: 0.8, concentration: 0.6 } },
  { re: / (procrastin|glande|rien fait|traine|perdu|flemme|sieste)/, label: 'Procrastination', w: { discipline: 1, concentration: 0.4 } },
  { re: / (fast ?food|mcdo|kfc|burger|kebab|tacos|pizza|bonbon|soda|malbouffe|grignot)/, label: 'Malbouffe', w: { physique: 1, discipline: 0.4 } },
  { re: / (couche tard|nuit blanche|pas dormi|mal dormi|insomnie)/, label: 'Sommeil raté', w: { physique: 0.8, concentration: 0.8 } },
  { re: / (alcool|soiree|biere|vodka|chicha|bu )/, label: 'Soirée / alcool', w: { physique: 1, discipline: 0.6, concentration: 0.4 } },
];
const BAD_WEIGHT = 1.25;
function splitItems(text) {
  return (text || '').split(/\n|,|;|\+|\bet\b|\bpuis\b|\bensuite\b|\bapres\b|\baprès\b/i).map(x => x.trim()).filter(x => x.length > 1);
}
function analyzeBilan(b, date) {
  const pts = Object.fromEntries(STAT_KEYS.map(k => [k, 0]));
  const items = [];
  // minutes déjà enregistrées en quêtes ce jour-là (pour ne pas compter deux fois)
  const questMin = {};
  for (const l of state.logs) if (l.date === date) questMin[normJ(l.name + ' ' + l.activityId)] = (questMin[normJ(l.name + ' ' + l.activityId)] || 0) + (l.minutes || 30);
  const used = {};
  const take = (cat, h) => {
    if (!cat.act) return h;
    let q = 0;
    for (const [name, m] of Object.entries(questMin)) if (cat.act.test(name)) q += m;
    const left = Math.max(0, q / 60 - (used[cat.label] || 0));
    const dup = Math.min(h, left);
    used[cat.label] = (used[cat.label] || 0) + dup;
    return h - dup;
  };
  for (const [list, sign, cats] of [[splitItems(b.good), 1, BIL_GOOD], [splitItems(b.bad), -1, BIL_BAD]]) {
    for (const text of list) {
      const t = normJ(text);
      const cat = cats.find(c => c.re.test(t)) || (sign > 0 ? { label: 'Autre effort', w: { discipline: 0.3 } } : { label: 'Temps perdu', w: { discipline: 0.6, concentration: 0.4 } });
      const h0 = hoursIn(text);
      const hours = h0 != null ? h0 : 1;
      const eff = sign > 0 ? take(cat, hours) : hours;
      const effect = {};
      for (const [k, w] of Object.entries(cat.w)) {
        const v = sign > 0 ? eff * 2 * w : -hours * 2 * BAD_WEIGHT * w;
        pts[k] += v; effect[k] = v;
      }
      items.push({ text, label: cat.label, sign, hours, counted: eff, guessed: h0 == null, effect });
    }
  }
  const net = Object.values(pts).reduce((a, v) => a + v, 0);
  const goodH = items.filter(i => i.sign > 0).reduce((a, i) => a + i.hours, 0);
  const badH = items.filter(i => i.sign < 0).reduce((a, i) => a + i.hours, 0);
  return { pts, items, net, goodH, badH };
}

/* Anneau de stat : plus la stat est haute, plus il grossit, brille et change de couleur */
const GRADE_COL = { E: '#8fb0c8', D: '#3fe0a0', C: '#2fc4ff', B: '#4f7dff', A: '#a77bff', S: '#ffc35a' };
/* Chaque stat a sa couleur ; un rond qui monte s'illumine, un rond qui baisse s'affaiblit */
const STAT_COL = { physique: '#ff5c7a', concentration: '#38c8ff', intelligence: '#a77bff', discipline: '#ffc857' };
function statTrend(key) {
  const today = todayKey(), st = computeStats(state.logs, today);
  const d = st.values[key] - (st.history.get(addDays(today, -7)) || st.base)[key];
  return d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat';
}
function statRing(s, v, delta, opts = {}) {
  const g = gradeFor(v), col = STAT_COL[s.key] || GRADE_COL[g];
  const trend = opts.trend || (ui.day0 ? 'flat' : statTrend(s.key));
  const size = Math.round(78 + v * 0.42);           // 82 px à 10, 120 px à 100
  const r = 42, c = 2 * Math.PI * r, off = c * (1 - v / 100);
  const glow = ((2 + v / 8) * (trend === 'up' ? 1.8 : trend === 'down' ? 0.45 : 1)).toFixed(1);
  const nParts = (v >= 80 ? 10 : v >= 65 ? 7 : v >= 50 ? 5 : v >= 35 ? 3 : 0) + (trend === 'up' ? 4 : 0);
  const parts = Array.from({ length: nParts }, (_, i) => `<i style="--a:${(i * 360) / nParts}deg;--t:${(3 + (i % 3)).toFixed(1)}s"></i>`).join('');
  return `
    <div class="sring g-${g} tr-${trend}" style="--col:${col};--size:${size}px;--glow:${glow}px">
      <div class="sring-wrap">
        ${parts ? `<div class="sring-orbit">${parts}</div>` : ''}
        <svg viewBox="0 0 100 100" class="sring-svg" aria-hidden="true">
          <circle cx="50" cy="50" r="${r}" class="sr-bg"/>
          <circle cx="50" cy="50" r="${r}" class="sr-fg" style="stroke-dasharray:${c.toFixed(1)};--c:${c.toFixed(1)};--off:${off.toFixed(1)}"/>
        </svg>
        <div class="sring-in"><b data-count-to="${v}" data-count-from="${opts.from != null ? opts.from : 0}" data-fmt="stat">${fmtStat(v)}</b><em>${g}</em></div>
      </div>
      <div class="sring-name">${s.icon} ${s.name}</div>
      ${delta != null ? `<div class="sring-delta ${delta > 0.05 ? 'trend-up' : delta < -0.05 ? 'trend-down' : ''}">${delta > 0.05 ? '▲ +' : delta < -0.05 ? '▼ ' : '= '}${fmtStat(delta)}${opts.deltaLabel ? ' ' + opts.deltaLabel : ''}</div>` : ''}
      ${opts.foot ? `<div class="sring-foot">${opts.foot}</div>` : ''}
    </div>`;
}

function renderBilanPanel(today) {
  const b = state.bilans.find(x => x.date === today) || { good: '', bad: '' };
  const has = !!state.bilans.find(x => x.date === today);
  let result = '';
  if (has) {
    const a = analyzeBilan(b, today);
    const st = computeStats(state.logs, today);
    const y = st.history.get(addDays(today, -1)) || st.base;
    const deltas = STAT_KEYS.map(k => ({ k, d: st.values[k] - y[k] }));
    const dPow = deltas.reduce((t, x) => t + x.d, 0) / STAT_KEYS.length;
    const fmtH = h => (Math.round(h * 10) / 10).toString().replace('.', ',') + ' h';
    result = `
      <div class="bil-verdict ${dPow > 0.005 ? 'up' : dPow < -0.005 ? 'down' : ''}">
        <b>${dPow > 0.005 ? '▲ TU AVANCES' : dPow < -0.005 ? '▼ TU RECULES' : '= SUR PLACE'}</b>
        <span>${fmtH(a.goodH)} utiles · ${fmtH(a.badH)} perdues · bilan ${a.net >= 0 ? '+' : ''}${fmtG(Math.round(a.net * 10) / 10)} pts</span>
      </div>
      <div class="bil-deltas">${deltas.map((x, i) => `<div class="casc" style="--j:${i}"><span>${statByKey[x.k].icon} ${statByKey[x.k].name}</span><b class="${x.d > 0.005 ? 'trend-up' : x.d < -0.005 ? 'trend-down' : ''}">${x.d >= 0 ? '+' : ''}${x.d.toFixed(2).replace('.', ',')}</b></div>`).join('')}</div>
      <div class="bil-items">${a.items.map((it, i) => `<div class="bil-item ${it.sign > 0 ? 'good' : 'bad'} casc" style="--j:${i + 4}">
        <span>${it.sign > 0 ? '✅' : '⛔'} ${esc(it.label)} · ${fmtH(it.hours)}${it.guessed ? ' (estimé)' : ''}${it.sign > 0 && it.counted < it.hours ? ` · ${fmtH(it.hours - it.counted)} déjà en quête` : ''}</span>
        <b>${Object.entries(it.effect).filter(([, v]) => Math.abs(v) > 0.01).map(([k, v]) => `${statByKey[k].icon}${v > 0 ? '+' : ''}${fmtG(Math.round(v * 10) / 10)}`).join(' ')}</b></div>`).join('')}</div>
      <p class="small faint" style="margin-bottom:0">Chiffres = points d'effort du jour (30 min utiles = 1 point ; 1 h perdue = −2,5). Les variations de stats suivent des rendements décroissants : monter est lent, reculer est rapide.</p>`;
  }
  return `
    <section class="panel bilan" id="bilan">
      <div class="panel-head"><div class="panel-title">Bilan du jour</div><div class="panel-sub date-glow">${esc(fmtDayShort(today))}</div></div>
      <label class="field"><span>✅ Ce que j'ai accompli aujourd'hui</span>
        <textarea class="input" id="bil-good" rows="3" placeholder="Ex : 1 h de sport, 2 h de live, 1 h 30 de clips, 30 min de lecture">${esc(b.good)}</textarea></label>
      <label class="field"><span>⛔ Ce qui m'a fait perdre du temps</span>
        <textarea class="input" id="bil-bad" rows="3" placeholder="Ex : 2 h de TikTok, 1 h de jeux vidéo, couché tard">${esc(b.bad)}</textarea></label>
      <button type="button" class="btn primary block" data-bilan="save">⚖️ ${has ? 'Recalculer mon bilan' : 'Calculer mon bilan'}</button>
      ${result}
    </section>`;
}

function saveBilan() {
  const today = todayKey();
  const good = ($('#bil-good') || {}).value || '', bad = ($('#bil-bad') || {}).value || '';
  if (!good.trim() && !bad.trim()) { toast('Rien à calculer', 'Écris au moins une ligne.', 'warn'); return; }
  const st0 = computeStats(state.logs, today);
  const p0 = powerOf(st0.values);
  const qWas = dailyQuest(today).done;
  state.bilans.filter(x => x.date === today).forEach(x => tomb(x.id));
  state.bilans = state.bilans.filter(x => x.date !== today);
  state.bilans.push({ id: uid(), date: today, ts: Date.now(), good: good.slice(0, 1500), bad: bad.slice(0, 1500) });
  save();
  const st1 = computeStats(state.logs, today);
  const dp = powerOf(st1.values) - p0;
  const a = analyzeBilan(state.bilans[state.bilans.length - 1], today);
  render();
  const el = $('#bilan'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const y = st1.history.get(addDays(today, -1)) || st1.base;
  const chips = STAT_KEYS.map(k => ({ k, d: st1.values[k] - y[k] })).filter(x => Math.abs(x.d) > 0.005).map(x => `${statByKey[x.k].name} ${x.d > 0 ? '+' : ''}${x.d.toFixed(2).replace('.', ',')}`);
  const up = a.net >= 0;
  if (up) { sfx('success'); haptic(); } else { sfx('fail'); haptic(2); }
  const neutral = Math.abs(a.net) < 0.05;
  celebrate({ kind: neutral ? 'neutral' : up ? 'win' : 'fail', title: neutral ? 'BILAN ÉQUILIBRÉ' : up ? 'BILAN POSITIF' : 'BILAN NÉGATIF', big: `${a.net >= 0 ? '+' : ''}${fmtG(Math.round(a.net * 10) / 10)} pts`,
    sub: neutral ? 'Rien de plus que tes quêtes déjà comptées.' : up ? 'Tu avances. Garde ce rythme.' : 'Plus de temps perdu que de temps utile : tes stats reculent.', chips,
    lines: [`Puissance ${dp >= 0 ? '+' : ''}${dp.toFixed(2).replace('.', ',')} par rapport à avant ce bilan`] }).then(() => questCompletedCheck(qWas));
}

/* =========================================================
   QUÊTE QUOTIDIENNE (objectifs du jour, automatiques)
   Accomplie = +100 XP. Ratée (jour terminé, depuis le jour 0) = PÉNALITÉ : −50 XP
   et −2 points de Discipline ce jour-là.
   ========================================================= */
const QUEST_XP = 100, QUEST_PENALTY_XP = 50;
const isPhysical = l => !l.bad && (l.activityId === 'sport' || /sport|muscu|course|salle|boxe|foot|cardio|natation/i.test(l.name) || (l.stats.includes('physique') && l.activityId !== 'travail' && !/travail/i.test(l.name)));
const isFocus = l => !l.bad && (['live', 'clips', 'lecture'].includes(l.activityId) || /live|clip|montage|lecture|apprenti|cours|projet/i.test(l.name) || ((l.stats.includes('intelligence') || l.stats.includes('concentration')) && !isPhysical(l)));
function questIndex() {
  const key = state.logs.length + '|' + state.meals.length + '|' + state.bilans.length + '|' + JSON.stringify(state.questCfg) + '|' + state.logs.reduce((t, l) => t + (l.minutes || 0), 0) + '|' + state.reps.length + ':' + state.reps.reduce((t, r) => t + r.n, 0);
  if (questIndex._k === key) return questIndex._v;
  const byDate = new Map();
  const get = d => { if (!byDate.has(d)) byDate.set(d, { phys: 0, focus: 0, waste: 0, pushups: 0, meals: new Set(), bilan: false }); return byDate.get(d); };
  for (const r of state.reps) get(r.date).pushups += r.n;
  for (const l of state.logs) {
    const o = get(l.date);
    if (l.bad) { if (!l.kind || l.kind === 'screen' || l.kind === 'time') o.waste += l.minutes || 30; }
    else if (isPhysical(l)) o.phys += l.minutes || 30; else if (isFocus(l)) o.focus += l.minutes || 30;
    if (Array.isArray(l.ex)) for (const e of l.ex) if (e.id === 'pompes') o.pushups += (e.reps || 0) * (e.sets || 1);
  }
  for (const m of state.meals) get(m.date).meals.add(m.meal);
  for (const b of state.bilans) get(b.date).bilan = true;
  questIndex._k = key; questIndex._v = byDate;
  return byDate;
}
function dailyQuest(date) {
  const cfg = state.questCfg;
  const o = questIndex().get(date) || { phys: 0, focus: 0, waste: 0, pushups: 0, meals: new Set(), bilan: false };
  const main = ['matin', 'midi', 'soir'].filter(k => o.meals.has(k)).length;
  const goals = [];
  if (cfg.pushups > 0) goals.push({ key: 'pushups', icon: '💪', label: `${cfg.pushups} pompes`, cur: o.pushups, target: cfg.pushups, unit: '', reps: true });
  if (cfg.sport > 0) goals.push({ key: 'sport', icon: '🏋️', label: 'Entraînement physique', cur: o.phys, target: cfg.sport, unit: 'min' });
  if (cfg.focus > 0) goals.push({ key: 'focus', icon: '🎯', label: 'Travail concentré', hint: 'live, clips, apprentissage', cur: o.focus, target: cfg.focus, unit: 'min' });
  if (cfg.meals > 0) goals.push({ key: 'meals', icon: '🍽️', label: 'Repas notés', cur: main, target: cfg.meals, unit: '' });
  if (cfg.bilan) goals.push({ key: 'waste', icon: '⛔', label: 'Temps perdu limité', hint: 'déclaré dans « mal fait »', cur: o.waste, target: cfg.waste, unit: 'min', max: true });
  goals.forEach(g => { g.done = g.max ? g.cur <= g.target : g.cur >= g.target; });
  return { goals, done: goals.length > 0 && goals.every(g => g.done), count: goals.filter(g => g.done).length };
}
/* jours passés (depuis le jour 0) : accomplis / ratés */
function questHistory(today) {
  const start = state.startDate;
  const key = today + '|' + start + '|' + (questIndex._k || '');
  questIndex();
  if (questHistory._k === today + '|' + start + '|' + questIndex._k) return questHistory._v;
  const done = new Set(), failed = new Set();
  if (start < today) {
    let d = start, guard = 0;
    while (d < today && guard++ < 4000) { (dailyQuest(d).done ? done : failed).add(d); d = addDays(d, 1); }
  }
  if (dailyQuest(today).done) done.add(today);
  questHistory._k = today + '|' + start + '|' + questIndex._k; questHistory._v = { done, failed };
  return questHistory._v;
}
const questXp = () => { const h = questHistory(todayKey()); return h.done.size * QUEST_XP - h.failed.size * QUEST_PENALTY_XP; };

/* Orbe d'XP qui s'envole vers la barre de niveau */
function flyXp(fromRect, xp) {
  const target = $('#xp-target .bar') || $('#xp-target');
  if (!fromRect || !target) return Promise.resolve();
  const tr = target.getBoundingClientRect();
  const orb = document.createElement('div');
  orb.className = 'xp-orb' + (xp < 0 ? ' neg' : '');
  orb.textContent = `${xp < 0 ? '−' : '+'}${Math.abs(xp)} XP`;
  const x0 = fromRect.left + fromRect.width / 2, y0 = fromRect.top + fromRect.height / 2;
  const x1 = tr.left + tr.width * 0.6, y1 = tr.top + tr.height / 2;
  orb.style.left = x0 + 'px'; orb.style.top = y0 + 'px';
  document.body.appendChild(orb);
  return new Promise(res => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      orb.style.transform = `translate(-50%, -50%) translate(${x1 - x0}px, ${y1 - y0}px) scale(.45)`;
      orb.style.opacity = '0.2';
    }));
    setTimeout(() => { orb.remove(); target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash'); sfx('tap'); res(); }, 760);
  });
}
function questCompletedCheck(wasDone, date = todayKey()) {
  const q = dailyQuest(date);
  if (!wasDone && q.done && date < todayKey()) {
    if (date < state.startDate) { toast('Quête complète', `${fmtDayShort(date)} : avant le jour 0, elle ne rapporte pas d'XP.`); return Promise.resolve(); }
    return celebrate({ kind: 'win', icon: '↺', title: '[QUÊTE QUOTIDIENNE] RATTRAPÉE', big: `+${QUEST_XP + QUEST_PENALTY_XP} XP`, count: QUEST_XP + QUEST_PENALTY_XP, sub: `${capFirst(fmtDayLong(date))} : pénalité annulée (+${QUEST_PENALTY_XP}) et récompense obtenue (+${QUEST_XP}).`, chips: q.goals.map(g => g.label) });
  }
  if (!wasDone && q.done) {
    return celebrate({ kind: 'win', icon: '!', title: '[QUÊTE QUOTIDIENNE] ACCOMPLIE', big: `+${QUEST_XP} XP`, count: QUEST_XP, sub: 'Préparation pour devenir plus fort : terminée.', chips: q.goals.map(g => g.label) });
  }
  return Promise.resolve();
}

function renderQuestWindow(today, day = today) {
  const past = day < today;
  const counts = day >= state.startDate;
  const q = dailyQuest(day);
  const h = questHistory(today);
  const yest = addDays(today, -1);
  const now = new Date();
  const minsLeft = (24 * 60) - (now.getHours() * 60 + now.getMinutes());
  const warn = !past && !q.done && now.getHours() >= 20;
  const failedPast = past && !q.done && counts;
  const lv = levelInfo(totalXp());
  return `
    <section class="panel mini-lvl" id="xp-target">
      <span class="ml-lab">NIVEAU</span><b class="ml-num">${lv.level}</b>
      <div class="bar xp energy"><i class="xp-flow" aria-hidden="true"></i><span style="width:${(lv.into / lv.need) * 100}%" ${anim.prev ? `data-w-from="${anim.prev.level < lv.level ? 0 : anim.prev.pct}"` : ''}></span></div>
      <span class="ml-xp">${fmtNum(lv.into)}/${fmtNum(lv.need)}</span>
    </section>

    ${!past && h.failed.has(yest) ? `<section class="panel penalty-banner"><b>⚠ PÉNALITÉ APPLIQUÉE</b><span>La quête quotidienne d'hier n'a pas été accomplie : −${QUEST_PENALTY_XP} XP et Discipline en baisse.</span><button type="button" class="btn small" style="margin-top:10px" data-today-goto="${yest}">↺ Oubli ? Rattraper hier</button></section>` : ''}
    <section class="panel quest-win ${q.done ? 'done' : ''} ${warn ? 'warn' : ''} ${failedPast ? 'failed' : ''}">
      <div class="qw-scan" aria-hidden="true"></div>
      <div class="qw-top"><span class="qw-bang">!</span><b class="qw-title">[QUÊTE QUOTIDIENNE]</b></div>
      <div class="qw-sub">${past ? `${esc(capFirst(fmtDayLong(day)))}${q.done ? ' · accomplie' : counts ? ' · à rattraper' : ' · avant le jour 0'}` : 'Préparation pour devenir plus fort'}</div>
      <div class="qw-goals">
        ${q.goals.map((g, i) => { const rr = goalRatio(g), gl = g.max ? 0 : Math.min(5, Math.floor(rr)), arm = g.key === 'pushups' ? pushArm(g.cur) : ''; return `
          <div class="qw-goal casc ${g.done ? 'done' : ''} ${g.max && !g.done ? 'over' : ''} ${(ui.justDone || []).includes(g.key) ? 'just' : ''} ${gl >= 2 ? 'gl gl' + gl : ''} ${arm ? 'has-arm' : ''} ${g.key === 'pushups' && g.cur >= 1000 ? 'p1000-ok' : ''}" style="--j:${i}" ${g.key === 'pushups' && g.cur >= 1000 ? `data-p1000="${day}" role="button"` : ''}>
            <span class="qw-ico ${arm ? 'arm' : ''}">${arm || g.icon}</span>
            <span class="qw-lab">${g.label}${g.hint ? `<small>${g.hint}</small>` : ''}${g.key === 'meals' && !g.done ? `<button type="button" class="qw-link" data-meals-for="${day}">＋ noter les repas ›</button>` : ''}</span>
            <b class="qw-val">${g.max ? `${fmtNum(g.cur)}/${g.target} min max` : g.unit ? `${fmtNum(Math.min(g.cur, 9999))}/${g.target} ${g.unit}` : g.reps ? `${fmtNum(g.cur)}/${g.target}` : `${Math.min(g.cur, g.target)}/${g.target}`}</b>
            <i class="qw-check" aria-hidden="true">${g.max && !g.done ? '✕' : '✓'}</i>
            <em class="qw-prog ${g.max ? 'max' : ''}" style="width:${g.max ? Math.min(100, (g.cur / Math.max(1, g.target)) * 100) : Math.min(100, (g.cur / g.target) * 100)}%"></em>
            ${g.key === 'pushups' && g.cur >= 1000 ? '<span class="qw-1000">🏆 1 000 POMPES · ouvrir ›</span>' : gl >= 2 ? `<span class="qw-over">×${gl}</span>` : ''}
          </div>
          ${g.reps ? `<div class="qw-reps casc" style="--j:${i}">${[5, 10, 20, 25].map(n => `<button type="button" data-reps="${n}">+${n}</button>`).join('')}<button type="button" class="undo" data-reps="undo" aria-label="Annuler la dernière série" ${state.reps.some(r => r.date === day) ? '' : 'disabled'}>↶</button></div>` : ''}`; }).join('')}
      </div>
      <div class="qw-reward">${q.done ? `✓ QUÊTE ACCOMPLIE${counts ? ` · +${QUEST_XP} XP obtenus` : ''}` : failedPast ? `✕ QUÊTE RATÉE · −${QUEST_PENALTY_XP} XP` : past ? 'Avant le jour 0 : pas de récompense' : `RÉCOMPENSE : +${QUEST_XP} XP`}</div>
      ${failedPast ? `<div class="qw-fix">↺ Oubli ? Ajoute ce que tu as fait ce jour-là : si la quête est complète, la pénalité est annulée et tu gagnes +${QUEST_XP + QUEST_PENALTY_XP} XP.</div>` : ''}
      ${q.done || past ? '' : `<div class="qw-pen ${warn ? 'on' : ''}">⚠ PÉNALITÉ si non accomplie avant minuit : −${QUEST_PENALTY_XP} XP, Discipline en baisse${warn ? ` · reste ${Math.floor(minsLeft / 60)} h ${pad2(minsLeft % 60)}` : ''}</div>`}
    </section>`;
}

/* =========================================================
   Onglet 2 : Aujourd'hui
   ========================================================= */
function entryHtml(l, withDelete = true) {
  const det = l.bad ? badDetail(l) : l.ex ? exDetail(l) : '';
  const meta = [det || (l.minutes ? fmtMinutes(l.minutes) : (l.bad ? '1 fois' : 'Fait ✓')), (l.bad ? '▼ ' : '') + l.stats.map(k => statByKey[k].name).join(' · ')].filter(Boolean).join(' — ');
  const pic = l.kind === 'food' && l.junk ? junkArt(l.junk.dessin || 'burger') : esc(l.icon);
  return `
    <div class="entry ${l.bad ? 'bad' : ''} ${l.id === ui.lastLogId ? 'fresh' : ''} ${l.quality > 1.05 ? 'q-up' : l.quality < 0.95 ? 'q-down' : ''} ${l.tier ? 'tier-' + l.tier : ''}">
      <div class="entry-emoji ${l.kind === 'food' ? 'art' : ''}">${pic}</div>
      <div class="entry-body">
        <div class="entry-title">${esc(l.name)}</div>
        <div class="entry-meta">${esc(meta)}</div>
        ${l.note ? `<div class="entry-note">“${esc(l.note)}”</div>` : ''}
        ${l.verdict ? `<div class="entry-verdict">⚖️ ${esc(l.verdict)}</div>` : ''}
      </div>
      <div class="entry-xp">${l.xp >= 0 ? '+' : '−'}${Math.abs(l.xp)} XP</div>
      ${withDelete ? `<button class="icon-btn danger" data-del-log="${esc(l.id)}" aria-label="Supprimer">✕</button>` : ''}
    </div>`;
}

function renderToday() {
  const today = todayKey();
  const day = todayView();
  const past = day < today;
  const minDay = addDays(today, -BACKFILL_DAYS);
  const logs = state.logs.filter(l => l.date === day).sort((a, b) => b.ts - a.ts);
  const xpDay = logs.reduce((s, l) => s + l.xp, 0);
  const nGood = logs.filter(l => !l.bad).length, nBad = logs.length - nGood;
  const wasted = logs.filter(l => l.bad).reduce((t, l) => t + (l.minutes || 30), 0);
  const badGrid = state.badActivities.map(a => `
    <button class="activity-btn bad" data-log-bad="${esc(a.id)}"><span class="ab-shine" aria-hidden="true"></span>
      <span class="activity-emoji">${esc(a.icon)}</span>
      <span>
        <span class="activity-name">${esc(a.name)}</span><br>
        <span class="activity-stats">▼ ${a.stats.length ? a.stats.map(k => statByKey[k].name).join(' + ') : 'Discipline'}</span>
      </span>
    </button>`).join('');

  const grid = state.activities.map(a => `
    <button class="activity-btn" data-log-activity="${esc(a.id)}"><span class="ab-shine" aria-hidden="true"></span>
      <span class="activity-emoji">${esc(a.icon)}</span>
      <span>
        <span class="activity-name">${esc(a.name)}</span><br>
        <span class="activity-stats">${a.stats.length ? a.stats.map(k => statByKey[k].name).join(' + ') : 'Aucune stat'}</span>
      </span>
    </button>`).join('');

  const missed = [];
  for (let d = addDays(today, -1); d >= minDay && d >= state.startDate && missed.length < 30; d = addDays(d, -1)) if (!dailyQuest(d).done) missed.push(d);
  return `
    <section class="panel day-nav ${past ? 'past' : ''}">
      <button class="icon-btn" data-today-day="-1" aria-label="Jour précédent" ${day <= minDay ? 'disabled style="opacity:.3"' : ''}>‹</button>
      <div class="center">
        <div class="cal-month date-glow">${past ? esc(capFirst(fmtDayLong(day))) : "Aujourd'hui · " + esc(fmtDayShort(today))}</div>
        <div class="small ${past ? 'dn-past' : 'muted'}">${past ? '↺ MODE RATTRAPAGE' : missed.length ? `⚠ ${missed.length} jour${missed.length > 1 ? 's' : ''} non validé${missed.length > 1 ? 's' : ''} · touche ‹ pour compléter` : 'Touche ‹ pour compléter un jour oublié'}</div>
      </div>
      <button class="icon-btn" data-today-day="1" aria-label="Jour suivant" ${past ? '' : 'disabled style="opacity:.3"'}>›</button>
      ${past ? `<button type="button" class="btn small block dn-back" data-today-day="0">⚔ Revenir à aujourd'hui</button>` : missed.length ? `<div class="dn-missed">${missed.slice(0, 7).map(d => `<button type="button" class="fchip" data-today-goto="${d}">${esc(fmtDayShort(d))}</button>`).join('')}</div>` : ''}
    </section>
    ${renderQuestWindow(today, day)}
    <section class="panel">
      <div class="day-summary">
        <div>
          <div class="date-glow big">${esc(fmtDayLong(day))}</div>
          <div class="small muted" style="margin-top:4px">${nGood} accomplie${nGood > 1 ? 's' : ''} · <span class="${nBad ? 'trend-down' : ''}">${nBad} mal fait${nBad > 1 ? 's' : ''}${wasted ? ` (${fmtMinutes(wasted)} perdues)` : ''}</span></div>
        </div>
        <div class="day-xp ${xpDay < 0 ? 'neg' : ''}">${xpDay >= 0 ? '+' : '−'}${fmtNum(Math.abs(xpDay))} XP</div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Qu'as-tu accompli ?</div></div>
      <div class="activity-grid">
        ${grid}
        <button class="activity-btn add" data-new-activity="1">＋ Nouvelle activité</button>
      </div>
    </section>

    <section class="panel bad-panel" id="bad-panel">
      <div class="panel-head"><div class="panel-title">Qu'as-tu mal fait ?</div></div>
      <p class="small muted" style="margin:-4px 0 12px">Sois honnête : chaque minute perdue retire de l'XP et fait baisser les stats concernées.</p>
      <div class="activity-grid">
        ${badGrid}
        <button class="activity-btn add bad" data-new-bad="1">＋ Autre</button>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">${past ? 'Journal de ce jour' : 'Journal du jour'}</div></div>
      ${logs.length ? logs.map((l, i) => entryHtml(l).replace('class="entry ', `style="--j:${i}" class="entry casc `)).join('') : `<div class="empty"><span class="sys">[SYSTÈME]</span>${past ? 'Rien ce jour-là. Ajoute ce que tu avais fait au-dessus.' : "Rien aujourd'hui. Choisis ce que tu as accompli ou mal fait au-dessus."}</div>`}
    </section>
  `;
}

/* Feuille d'enregistrement : choix de la durée = validation directe */
function openLogSheet(activity, bad = false) {
  const durations = [15, 30, 45, 60, 90, 120, 180, 240];
  let dayChoice = 'today';
  const viewDay = todayView();
  const pastView = viewDay < todayKey();
  const screen = bad && badKind(activity) === 'screen';
  const nowHM = (() => { const d = new Date(); return pad2(d.getHours()) + ':' + pad2(Math.floor(d.getMinutes() / 5) * 5); })();
  const body = `
    <div class="small ${bad ? 'trend-down' : 'muted'}" style="margin:-8px 0 14px">${bad ? '▼ Fait baisser : ' + activity.stats.map(k => statByKey[k].icon + ' ' + statByKey[k].name).join(', ') + ' · retire de l’XP' : activity.stats.length ? 'Fait monter : ' + activity.stats.map(k => statByKey[k].icon + ' ' + statByKey[k].name).join(', ') : "Ne fait monter aucune stat (modifiable dans Réglages)"}</div>
    ${pastView ? `<div class="log-day-fixed">↺ Pour le ${esc(fmtDayLong(viewDay))}</div>` : `<div class="seg" style="margin-bottom:14px">
      <button type="button" class="on" data-day="today">Aujourd'hui</button>
      <button type="button" data-day="yesterday">Hier</button>
    </div>`}
    ${screen ? `<label class="field t0-field"><span>Heure de début de la session</span>
      <input class="input" id="log-t0" type="time" value="${nowHM}">
      <small class="t0-hint" id="t0-hint"></small></label>` : ''}
    <label class="field"><span>${bad ? 'Petite note (facultatif)' : 'Note : le Système la lit et juge la qualité de ta séance'}</span>
      <input class="input" id="log-note" maxlength="280" placeholder="${bad ? 'Ex : scrollé au lit avant de dormir' : 'Ex : séance intense, record au développé couché'}" autocomplete="off">
    </label>
    <div class="field"><span>Durée — touche pour valider</span></div>
    <div class="dur-grid">
      ${durations.map(m => `<button type="button" class="btn" data-dur="${m}">${fmtMinutes(m)}</button>`).join('')}
      <button type="button" class="btn ${bad ? 'danger' : 'primary'}" data-dur="0">${bad ? '1 fois' : 'Fait ✓'}</button>
    </div>
    <div class="or-sep">AUTRE DURÉE</div>
    <div class="btn-row">
      <input class="input" id="log-custom" type="number" inputmode="numeric" min="1" max="1440" placeholder="minutes" style="flex:1">
      <button type="button" class="btn" data-dur="custom" style="flex:0 0 auto">Valider</button>
    </div>`;

  openSheet({
    tag: bad ? '[SYSTÈME] Temps perdu' : '[SYSTÈME] Nouvelle quête',
    title: `${activity.icon} ${activity.name}`,
    cls: bad ? 'sheet-bad' : '',
    body,
    buttons: [{ label: 'Annuler', value: null, cls: 'ghost' }],
    onMount(sheet, close) {
      const t0Hint = () => { const el = $('#t0-hint', sheet); if (!el) return; const m = screenMult($('#log-t0', sheet).value); el.textContent = m < 1 ? `🌙 Soirée : perte d’XP réduite (×${String(m).replace('.', ',')}). Le soir, tu as le droit de te détendre.` : `☀️ Avant ${REGLAGES_MAL.ecranHeureSoir} h : perte d’XP normale (×1). La journée, c’est le travail.`; el.className = 't0-hint ' + (m < 1 ? 'eve' : 'day'); };
      if (screen) { t0Hint(); $('#log-t0', sheet).addEventListener('input', t0Hint); }
      sheet.addEventListener('click', e => {
        const dayBtn = e.target.closest('[data-day]');
        if (dayBtn) {
          dayChoice = dayBtn.dataset.day;
          sheet.querySelectorAll('[data-day]').forEach(b => b.classList.toggle('on', b === dayBtn));
          return;
        }
        const d = e.target.closest('[data-dur]');
        if (!d) return;
        let minutes;
        if (d.dataset.dur === 'custom') {
          minutes = parseInt($('#log-custom', sheet).value, 10);
          if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
            toast('Durée invalide', 'Entre un nombre de minutes entre 1 et 1440.', 'warn');
            return;
          }
        } else {
          minutes = parseInt(d.dataset.dur, 10) || null;
        }
        const note = $('#log-note', sheet).value.trim();
        const date = pastView ? viewDay : dayChoice === 'yesterday' ? addDays(todayKey(), -1) : todayKey();
        const extra = screen ? { kind: 'screen', t0: $('#log-t0', sheet).value || nowHM } : {};
        close(null);
        addLog(activity, minutes, note, date, bad, extra);
      });
    },
  });
}

function addLog(activity, minutes, note, date, bad = false, extra = {}) {
  if (bad) return addBadLog(activity, minutes, note, date, extra);
  const today = todayKey();
  const before = levelInfo(totalXp());
  const statsBefore = computeStats(state.logs, today).values;
  const log = {
    id: uid(),
    date,
    ts: Date.now(),
    activityId: activity.id,
    name: activity.name,
    icon: activity.icon,
    minutes: minutes || null,
    note: note.slice(0, 280),
    stats: [...activity.stats],
    difficulty: activity.difficulty,
    xp: entryXp(minutes, activity.difficulty),
  };
  const j = judgeNote(note);
  log.quality = j.mult;
  log.verdict = j.verdict;
  log.xp = Math.max(1, Math.round(log.xp * j.mult));
  ui.lastLogId = log.id;
  const qBefore = dailyQuest(date);
  snapshotForAnim();
  state.logs.push(log);
  save();
  const after = levelInfo(totalXp());
  const statsAfter = computeStats(state.logs, today).values;
  const gains = STAT_KEYS
    .map(k => ({ k, d: statsAfter[k] - statsBefore[k] }))
    .filter(g => g.d >= 0.01)
    .map(g => `${statByKey[g.k].name} +${g.d.toFixed(2).replace('.', ',')}`);

  const qAfter = dailyQuest(date);
  ui.justDone = date !== todayView() ? [] : qAfter.goals.filter(g => g.done && !(qBefore.goals.find(x => x.key === g.key) || {}).done).map(g => g.key);
  render();
  ui.justDone = [];
  if (j.mult < 0.95) { sfx('fail'); haptic(2); } else { sfx('success'); haptic(); }
  flyXp(ui.tapRect, log.xp).then(() => celebrate({
    kind: j.mult < 0.95 ? 'fail' : 'win',
    title: j.mult < 0.95 ? 'QUÊTE VALIDÉE… DE JUSTESSE' : j.mult > 1.05 ? 'QUÊTE ACCOMPLIE · EXCELLENT' : 'QUÊTE ACCOMPLIE',
    icon: log.icon,
    big: `+${log.xp} XP`,
    count: log.xp,
    sub: `${log.name}${log.minutes ? ' · ' + fmtMinutes(log.minutes) : ''}`,
    chips: gains,
    lines: j.verdict ? ['Jugement du Système : ' + j.verdict] : [],
  })).then(() => questCompletedCheck(qBefore.done, date)).then(() => {
    const lvNow = levelInfo(totalXp());
    if (lvNow.level > before.level) {
      const rb = rankFor(before.level), ra = rankFor(lvNow.level);
      showLevelUp(lvNow.level, ra.letter !== rb.letter ? ra : null);
    }
  });
}

/* Ce que j'ai mal fait : −1 XP par minute (−25 XP pour "1 fois"), stats en baisse */
function addBadLog(activity, minutes, note, date, extra = {}) {
  const today = todayKey();
  const before = levelInfo(totalXp());
  const statsBefore = computeStats(state.logs, today).values;
  const log = {
    id: uid(), date, ts: Date.now(), activityId: activity.id, name: activity.name, icon: activity.icon,
    minutes: minutes || null, note: note.slice(0, 280), stats: [...activity.stats], difficulty: 'normal',
    bad: true, xp: -entryXp(minutes, 'normal'), quality: 1, verdict: '',
  };
  // écrans : perte réduite le soir (heure de début)
  if (extra.kind === 'screen') {
    log.kind = 'screen'; log.t0 = extra.t0; log.mult = screenMult(extra.t0);
    log.xp = -Math.max(1, Math.round(entryXp(minutes, 'normal') * log.mult));
    log.pts = (minutes ? Math.min(minutes, RULES.entryMaxMinutes) / RULES.minutesPerPoint : RULES.donePoints) * log.mult;
  } else if (extra.kind) Object.assign(log, extra);
  ui.lastLogId = log.id;
  const qBefore = dailyQuest(date);
  snapshotForAnim();
  state.logs.push(log);
  save();
  const statsAfter = computeStats(state.logs, today).values;
  const losses = STAT_KEYS.map(k => ({ k, d: statsAfter[k] - statsBefore[k] })).filter(g => g.d <= -0.01)
    .map(g => `${statByKey[g.k].name} ${g.d.toFixed(2).replace('.', ',')}`);
  const qAfter = dailyQuest(date);
  render();
  if (log.xp === 0) { sfx('success'); haptic(); toast(log.kind === 'sleep' ? 'Sommeil OK' : 'Noté', log.kind === 'sleep' ? 'Couché dans les temps : pas de perte d’XP.' : badDetail(log)); return; }
  sfx('penalty'); haptic(2);
  const lostGoal = qBefore.goals.some(g => g.key === 'waste' && g.done) && qAfter.goals.some(g => g.key === 'waste' && !g.done);
  flyXp(ui.tapRect, log.xp).then(() => celebrate({
    kind: 'fail',
    title: log.kind === 'food' ? 'MALBOUFFE' : log.kind === 'sleep' ? (log.xp < 0 ? 'COUCHÉ TROP TARD' : 'SOMMEIL OK') : log.kind === 'alcohol' ? 'ALCOOL' : 'TEMPS PERDU',
    icon: log.icon,
    big: log.xp < 0 ? `−${Math.abs(log.xp)} XP` : '0 XP',
    sub: `${log.name}${badDetail(log) ? ' · ' + badDetail(log) : log.minutes ? ' · ' + fmtMinutes(log.minutes) : ''}`,
    chips: losses,
    lines: [lostGoal ? `⚠ Limite de temps perdu dépassée : la quête quotidienne est compromise.` : 'Le Système enregistre tout. Rattrape-toi avec une vraie quête.'],
  })).then(() => {
    const lvNow = levelInfo(totalXp());
    if (lvNow.level < before.level) { toast('Niveau perdu', `Niveau ${before.level} → ${lvNow.level}`, 'warn'); sfx('penalty'); haptic(3); }
  });
}

/* LEVEL UP plein écran : flash, particules, texte qui explose, vibration */
function showLevelUp(level, newRank) {
  sfx('levelup'); haptic(3);
  const letters = 'LEVEL UP'.split('').map((c, i) => `<span style="--x:${Math.round(Math.random() * 300 - 150)}px;--y:${Math.round(Math.random() * 300 - 150)}px;--r:${Math.round(Math.random() * 120 - 60)}deg;--d:${i * 45}ms">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
  const parts = Array.from({ length: 48 }, (_, i) => `<i style="--a:${(i * 360) / 48 + Math.random() * 6}deg;--r:${140 + Math.random() * 220}px;--s:${(2 + Math.random() * 4).toFixed(1)}px;--d:${Math.round(Math.random() * 180)}ms"></i>`).join('');
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'lvlup';
    ov.innerHTML = `
      <div class="lv-flash"></div><div class="lv-ring"></div><div class="lv-ring r2"></div>
      <div class="lv-parts">${parts}</div>
      <div class="lv-box">
        <div class="lv-tag">[SYSTÈME]</div>
        <div class="lv-title">${letters}</div>
        <div class="lv-num"><small>NIVEAU</small><b data-count-to="${level}" data-count-from="${level - 1}" data-fmt="lvl" data-dur="1200">${level - 1}</b></div>
        ${newRank ? `<div class="lv-rank">NOUVEAU RANG · <b>${newRank.letter}</b><span>${esc(newRank.title)}</span></div>` : '<div class="lv-sub">Tes efforts réels paient. Continue.</div>'}
        <div class="cel-hint">Touche pour continuer</div>
      </div>`;
    document.body.appendChild(ov);
    setTimeout(() => runCountUps(ov), 650);
    let done = false;
    const close = () => { if (done) return; done = true; ov.classList.add('out'); setTimeout(() => { ov.remove(); resolve(); }, 350); };
    setTimeout(() => ov.addEventListener('click', close), 600);
    setTimeout(close, 4200);
  });
}

async function deleteLog(id) {
  const l = state.logs.find(x => x.id === id);
  if (!l) return;
  const ok = await confirmBox('Supprimer cette quête ?', `${esc(l.icon)} ${esc(l.name)} (${esc(fmtDayShort(l.date))}) — ${l.xp} XP seront retirés.`, 'Supprimer', true);
  if (!ok) return;
  tomb(id);
  state.logs = state.logs.filter(x => x.id !== id);
  save();
  render();
  toast('Quête supprimée', `−${l.xp} XP`);
}

/* =========================================================
   Onglet 3 : Historique
   ========================================================= */
/* ---------- Bilan du mois ---------- */
function monthReport(ym, today) {
  const st = computeStats(state.logs, today);
  const first = ym + '-01';
  const [y, m] = ym.split('-').map(Number);
  const lastDay = dateKey(new Date(y, m, 0));
  const end = lastDay < today ? lastDay : today;
  const logs = state.logs.filter(l => l.date >= first && l.date <= end);
  const nd = [...nutritionDays(today)].filter(d => d >= first && d <= end);
  const xp = logs.reduce((s, l) => s + l.xp, 0) + nd.length * NUTRI_XP;
  const byAct = new Map();
  for (const l of logs) {
    const k = l.activityId || l.name;
    const o = byAct.get(k) || { name: l.name, icon: l.icon, min: 0, n: 0 };
    o.min += l.minutes || 30; o.n++;
    byAct.set(k, o);
  }
  const acts = [...byAct.values()].sort((a, b) => b.min - a.min);
  const prevEnd = addDays(first, -1);
  const v0 = st.history.get(prevEnd) || st.base, v1 = st.history.get(end) || st.values;
  const statDiff = STAT_KEYS.map(k => ({ k, d: v1[k] - v0[k] }));
  const powerDiff = powerOf(v1) - powerOf(v0);
  const wIn = state.weights.filter(w => w.date >= first && w.date <= end);
  const wBefore = [...state.weights].reverse().find(w => w.date < first);
  const w0 = wBefore ? wBefore.kg : (wIn[0] ? wIn[0].kg : null);
  const w1 = wIn.length ? wIn[wIn.length - 1].kg : w0;
  const jr = state.journals.filter(j => j.date >= first && j.date <= end);
  const jAvg = jr.length ? jr.reduce((s, j) => s + j.score, 0) / jr.length : null;
  const progressed = powerDiff > 0.2 || (w0 != null && w1 != null && w1 < w0 - 0.2);
  return { ym, end, done: lastDay < today, xp, days: new Set(logs.map(l => l.date)).size, acts, statDiff, powerDiff, w0, w1, nd: nd.length, jAvg, progressed, empty: !logs.length && !wIn.length && !nd.length };
}
function renderMonthReport(ym, today) {
  const r = monthReport(ym, today);
  const [y, m] = ym.split('-').map(Number);
  if (r.empty) return `<section class="panel"><div class="panel-head"><div class="panel-title">Bilan de ${MONTHS[m - 1]}</div></div><div class="empty">Aucune donnée ce mois-ci.</div></section>`;
  const maxMin = Math.max(1, ...r.acts.map(a => a.min));
  return `
    <section class="panel report ${r.progressed ? 'rep-up' : 'rep-down'}">
      <div class="panel-head"><div class="panel-title">Bilan de ${MONTHS[m - 1]} ${y}${r.done ? '' : ' (en cours)'}</div></div>
      <div class="rep-verdict">${r.progressed ? '▲ TU AS PROGRESSÉ' : '▼ PAS DE PROGRESSION'}</div>
      <div class="kpis" style="margin:12px 0">
        <div class="kpi"><b>${fmtNum(r.xp)}</b><span>XP gagnés</span></div>
        <div class="kpi"><b>${r.days}</b><span>jours actifs</span></div>
        <div class="kpi"><b>${r.nd}</b><span>jours nutrition ✓</span></div>
      </div>
      <div class="field"><span>Temps passé</span>
        ${r.acts.length ? r.acts.map(a => `
          <div class="rep-act"><span>${esc(a.icon)} ${esc(a.name)}</span><b>${fmtMinutes(a.min)}</b></div>
          <div class="bar thin"><span style="width:${(a.min / maxMin) * 100}%"></span></div>`).join('') : '<div class="small muted">Aucune quête.</div>'}
      </div>
      <div class="field" style="margin-bottom:0"><span>Évolution du mois</span>
        <div class="rep-grid">
          ${r.statDiff.map(x => `<div><span>${statByKey[x.k].icon} ${statByKey[x.k].name}</span><b class="${x.d > 0.05 ? 'trend-up' : x.d < -0.05 ? 'trend-down' : ''}">${x.d >= 0 ? '+' : ''}${fmtStat(x.d)}</b></div>`).join('')}
          ${r.w0 != null ? `<div><span>⚖️ Poids</span><b class="${r.w1 < r.w0 ? 'trend-up' : r.w1 > r.w0 ? 'trend-down' : ''}">${fmtKg(r.w0)} → ${fmtKg(r.w1)} kg</b></div>` : ''}
          ${r.jAvg != null ? `<div><span>🎯 Journées jugées</span><b>${r.jAvg >= 0 ? '+' : ''}${r.jAvg.toFixed(1).replace('.', ',')} en moyenne</b></div>` : ''}
        </div>
      </div>
    </section>`;
}

/* À l'ouverture d'un nouveau mois : le bilan du mois précédent s'affiche une fois */
function maybeShowMonthReport() {
  const today = todayKey();
  const d = parseKey(today);
  const prev = dateKey(new Date(d.getFullYear(), d.getMonth() - 1, 1)).slice(0, 7);
  if (state.seenReports.includes(prev)) return;
  const r = monthReport(prev, today);
  if (r.empty) return;
  state.seenReports.push(prev);
  save();
  const [, m] = prev.split('-').map(Number);
  celebrate({
    kind: r.progressed ? 'win' : 'fail',
    title: `BILAN DE ${MONTHS[m - 1].toUpperCase()}`,
    big: `${fmtNum(r.xp)} XP`,
    sub: r.progressed ? 'Tu as progressé ce mois-ci.' : "Pas de progression ce mois-ci. Le Système attend mieux.",
    chips: r.acts.slice(0, 4).map(a => `${a.name} ${fmtMinutes(a.min)}`),
    lines: [r.w0 != null ? `Poids : ${fmtKg(r.w0)} → ${fmtKg(r.w1)} kg` : '', `${r.days} jours actifs · ${r.nd} jours de nutrition validés`].filter(Boolean),
  });
}

/* Jour positif (stats en hausse, quête accomplie) ou négatif (stats en baisse, pénalité) */
function dayMood(k, hst, qh) {
  const v = hst.history.get(k), p = hst.history.get(addDays(k, -1));
  let score = 0;
  if (v && p) score += powerOf(v) - powerOf(p);
  if (qh.done.has(k)) score += 0.05;
  if (qh.failed.has(k)) score -= 0.2;
  if (Math.abs(score) < 0.005) return '';
  return score > 0 ? 'pos' : 'neg';
}
function dayVerdictHtml(k, hst, qh) {
  if (k > todayKey()) return '';
  const v = hst.history.get(k), p = hst.history.get(addDays(k, -1));
  const d = v && p ? powerOf(v) - powerOf(p) : null;
  const bil = state.bilans.find(b => b.date === k);
  const parts = [];
  if (d != null) parts.push(`Puissance ${d >= 0 ? '+' : ''}${d.toFixed(2).replace('.', ',')}`);
  if (qh.done.has(k)) parts.push('✓ quête quotidienne');
  if (qh.failed.has(k)) parts.push('⚠ PÉNALITÉ');
  if (bil) { const a = analyzeBilan(bil, k); parts.push(`bilan ${a.net >= 0 ? '+' : ''}${fmtG(Math.round(a.net * 10) / 10)} pts`); }
  if (!parts.length) return '';
  const mood = dayMood(k, hst, qh);
  return `<div class="day-verdict ${mood ? 'm-' + mood : ''}">${mood === 'pos' ? '▲ JOUR POSITIF' : mood === 'neg' ? '▼ JOUR NÉGATIF' : '= JOUR NEUTRE'}<span>${parts.join(' · ')}</span></div>`;
}
function renderHistory() {
  const today = todayKey();
  const hst = computeStats(state.logs, today), qh = questHistory(today);
  if (!ui.calMonth) ui.calMonth = today.slice(0, 7);
  if (!ui.selectedDay) ui.selectedDay = today;
  const [y, m] = ui.calMonth.split('-').map(Number);

  const xpByDay = {};
  for (const l of state.logs) xpByDay[l.date] = (xpByDay[l.date] || 0) + l.xp;

  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const nbDays = new Date(y, m, 0).getDate();
  let cells = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < firstDow; i++) cells += `<div class="cal-day pad"></div>`;
  let monthXp = 0, monthDays = 0;
  for (let d = 1; d <= nbDays; d++) {
    const k = `${y}-${pad2(m)}-${pad2(d)}`;
    const xp = xpByDay[k] || 0;
    if (xp) { monthXp += xp; monthDays++; }
    const lv = !xp ? '' : xp < 60 ? 'lv1' : xp < 150 ? 'lv2' : xp < 300 ? 'lv3' : 'lv4';
    const mood = dayMood(k, hst, qh);
    const cls = ['cal-day', lv, mood ? 'm-' + mood : '', k === today ? 'today' : '', k === ui.selectedDay ? 'selected' : '', k > today ? 'future' : ''].join(' ');
    cells += `<button type="button" class="${cls}" style="--j:${d}" data-day-pick="${k}">${d}${xp ? `<small>${xp}</small>` : ''}</button>`;
  }

  const sel = ui.selectedDay;
  const selLogs = state.logs.filter(l => l.date === sel).sort((a, b) => a.ts - b.ts);
  const selXp = selLogs.reduce((s, l) => s + l.xp, 0);

  // Semaines (8 dernières, lundi → dimanche)
  const weeks = [];
  let wk = mondayOf(today);
  for (let i = 0; i < 8; i++) {
    const end = addDays(wk, 6);
    const wl = state.logs.filter(l => l.date >= wk && l.date <= end);
    weeks.push({ start: wk, end, xp: wl.reduce((s, l) => s + l.xp, 0), days: new Set(wl.map(l => l.date)).size });
    wk = addDays(wk, -7);
  }
  const maxW = Math.max(1, ...weeks.map(w => w.xp));

  const isCurrentMonth = ui.calMonth === today.slice(0, 7);

  return `
    <section class="panel">
      <div class="cal-head">
        <button class="icon-btn" data-cal="-1" aria-label="Mois précédent">‹</button>
        <div class="center">
          <div class="cal-month">${MONTHS[m - 1]} ${y}</div>
          <div class="small muted">${fmtNum(monthXp)} XP · ${monthDays} jour${monthDays > 1 ? 's' : ''} actif${monthDays > 1 ? 's' : ''}</div>
        </div>
        <button class="icon-btn" data-cal="1" aria-label="Mois suivant" ${isCurrentMonth ? 'disabled style="opacity:.3"' : ''}>›</button>
      </div>
      <div class="cal-grid">${cells}</div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div class="date-glow">${esc(fmtDayLong(sel))}</div>
        <div class="entry-xp">${fmtNum(selXp)} XP</div>
      </div>
      ${dayVerdictHtml(sel, hst, qh)}
      ${sel < today && sel >= addDays(today, -BACKFILL_DAYS) ? `<button type="button" class="btn small block" style="margin-bottom:10px" data-today-goto="${sel}">↺ Compléter ce jour (quêtes oubliées)</button>` : ''}
      ${selLogs.length ? selLogs.map((l, i) => entryHtml(l).replace('class="entry ', `style="--j:${i}" class="entry casc `)).join('') : `<div class="empty">Aucune quête ce jour-là.</div>`}
    </section>

    ${renderMonthReport(ui.calMonth, today)}

    <section class="panel">
      <div class="panel-head"><div class="panel-title">XP par semaine</div></div>
      ${weeks.map((w, i) => `
        <div class="week-row casc" style="--j:${i}">
          <div class="week-top">
            <span>${i === 0 ? 'Cette semaine' : i === 1 ? 'Semaine dernière' : `Sem. du ${fmtDayShort(w.start)}`}<span class="faint small"> · ${w.days} j actif${w.days > 1 ? 's' : ''}</span></span>
            <b>${fmtNum(w.xp)} XP</b>
          </div>
          <div class="bar thin"><span style="width:${(w.xp / maxW) * 100}%"></span></div>
        </div>`).join('')}
    </section>
  `;
}

/* =========================================================
   Onglet 4 : Réglages
   ========================================================= */
function renderSettings() {
  const lastExp = state.lastExportAt ? new Date(state.lastExportAt) : null;
  return `
    <section class="panel">
      <div class="panel-head"><div class="panel-title">Profil</div></div>
      <label class="field" style="margin-bottom:0"><span>Nom du joueur</span>
        <input class="input" id="player-name" maxlength="40" value="${esc(state.playerName)}" autocomplete="off">
      </label>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Objectif de poids</div></div>
      <div class="btn-row">
        <label class="field" style="margin-bottom:0"><span>Poids de départ (kg)</span>
          <input class="input" id="start-weight" inputmode="decimal" value="${fmtKg(state.body.startWeight)}" autocomplete="off">
        </label>
        <label class="field" style="margin-bottom:0"><span>Objectif (kg)</span>
          <input class="input" id="goal-weight" inputmode="decimal" value="${fmtKg(state.body.goalWeight)}" autocomplete="off">
        </label>
      </div>
      <div class="btn-row" style="margin-top:14px">
        <label class="field"><span>Graisse visée (%)</span><input class="input" data-body="goalFat" data-min="5" data-max="40" inputmode="decimal" value="${fmtG(state.body.goalFat)}"></label>
        <label class="field"><span>Muscles visés (%)</span><input class="input" data-body="goalMuscle" data-min="20" data-max="60" inputmode="decimal" value="${fmtG(state.body.goalMuscle)}"></label>
      </div>
      <div class="btn-row">
        <label class="field" style="margin-bottom:0"><span>Jour 0 (départ)</span><input class="input" type="date" data-date="startDate" value="${state.startDate}"></label>
        <label class="field" style="margin-bottom:0"><span>Date objectif</span><input class="input" type="date" data-date="goalDate" value="${state.body.goalDate}"></label>
      </div>
      ${goalPaceHtml()}
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Profil physique</div></div>
      <p class="small muted" style="margin-top:0">Sert à calculer ton objectif de calories et ton taux de graisse. Laisse vide ce que tu ne sais pas.</p>
      <div class="btn-row">
        <label class="field"><span>Taille (cm)</span><input class="input" data-body="heightCm" data-min="120" data-max="230" inputmode="decimal" value="${state.body.heightCm || ''}" placeholder="ex. 178"></label>
        <label class="field"><span>Âge</span><input class="input" data-body="age" data-min="10" data-max="100" inputmode="numeric" value="${state.body.age || ''}" placeholder="ex. 24"></label>
      </div>
      <div class="btn-row">
        <label class="field"><span>Tour de taille (cm, au nombril)</span><input class="input" data-body="waistCm" data-min="50" data-max="200" inputmode="decimal" value="${state.body.waistCm || ''}" placeholder="facultatif"></label>
        <label class="field"><span>Tour de cou (cm)</span><input class="input" data-body="neckCm" data-min="25" data-max="70" inputmode="decimal" value="${state.body.neckCm || ''}" placeholder="facultatif"></label>
      </div>
      <div class="btn-row">
        <label class="field" style="margin-bottom:0"><span>Graisse au départ (%)</span><input class="input" data-body="fatStart" data-min="5" data-max="60" inputmode="decimal" value="${fmtG(state.body.fatStart)}"></label>
        <label class="field" style="margin-bottom:0"><span>Objectif kcal (vide = auto)</span><input class="input" data-body="kcalTarget" data-min="1000" data-max="6000" inputmode="numeric" value="${state.body.kcalTarget || ''}" placeholder="${fmtNum(nutritionTargets().kcal)}"></label>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Quête quotidienne</div></div>
      <p class="small muted" style="margin-top:0">Objectifs du jour. Accomplie = +${QUEST_XP} XP ; ratée à minuit = −${QUEST_PENALTY_XP} XP et Discipline en baisse. Mets 0 pour retirer un objectif.</p>
      <div class="btn-row">
        <label class="field"><span>Pompes (nombre)</span><input class="input" data-quest="pushups" inputmode="numeric" value="${state.questCfg.pushups}"></label>
        <label class="field"><span>Sport (min)</span><input class="input" data-quest="sport" inputmode="numeric" value="${state.questCfg.sport}"></label>
      </div>
      <div class="btn-row">
        <label class="field"><span>Travail concentré (min)</span><input class="input" data-quest="focus" inputmode="numeric" value="${state.questCfg.focus}"></label>
      </div>
      <div class="btn-row">
        <label class="field" style="margin-bottom:0"><span>Repas notés (0 à 3)</span><input class="input" data-quest="meals" inputmode="numeric" value="${state.questCfg.meals}"></label>
        <label class="field" style="margin-bottom:0"><span>Temps perdu max (min)</span><input class="input" data-quest="waste" inputmode="numeric" value="${state.questCfg.waste}"></label>
      </div>
      <label class="field toggle" style="margin:12px 0 0"><span>Objectif « temps perdu limité »</span><input type="checkbox" data-quest="bilan" ${state.questCfg.bilan ? 'checked' : ''}></label>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Effets</div></div>
      <label class="field toggle"><span>🔊 Sons du Système</span><input type="checkbox" data-pref="sound" ${prefs.sound ? 'checked' : ''}></label>
      <label class="field toggle" style="margin-bottom:0"><span>📳 Vibrations (iPhone iOS 18+ et Android)</span><input type="checkbox" data-pref="vibrate" ${prefs.vibrate ? 'checked' : ''}></label>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Sommeil</div></div>
      <p class="small muted" style="margin:-4px 0 10px">Un adulte a besoin d'environ 7 à 9 h de sommeil. Heure de coucher conseillée = lever − ${REGLAGES_MAL.sommeilHeures} h : <b>${esc(fmtHm(minToHm(hmToMin(state.body.wakeTime || '07:30') - REGLAGES_MAL.sommeilHeures * 60)))}</b>.</p>
      <label class="field" style="margin-bottom:0"><span>Mon heure de lever habituelle</span><input class="input" type="time" data-wake="1" value="${esc(state.body.wakeTime || '07:30')}"></label>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Mes exercices & produits</div><div class="panel-sub">${state.customExercises.length + state.customJunk.length}</div></div>
      ${state.customExercises.map(x => `<div class="setting-activity"><div class="entry-emoji">⭐</div><div class="entry-body"><div class="entry-title">${esc(x.nom)}</div><div class="entry-meta">${x.type === 'charge' ? 'en kilos' : x.type === 'duree' ? 'durée' : 'au nombre'} · difficulté ×${fmtG(x.coef)}</div></div><button class="icon-btn danger" data-del-cex="${esc(x.id)}" aria-label="Supprimer">✕</button></div>`).join('')}
      ${state.customJunk.map(x => `<div class="setting-activity"><div class="entry-emoji art">${junkArt('burger')}</div><div class="entry-body"><div class="entry-title">${esc(x.nom)}</div><div class="entry-meta">${esc((MALBOUFFE_ENSEIGNES.find(e => e.id === x.e) || {}).nom || x.e)} · ${fmtNum(x.kcal)} kcal</div></div><button class="icon-btn danger" data-del-cjunk="${esc(x.id)}" aria-label="Supprimer">✕</button></div>`).join('')}
      ${state.customExercises.length + state.customJunk.length ? '' : '<p class="small muted" style="margin:0">Ajoute un exercice dans Aujourd\'hui → Sport (« Autre exercice »), ou un produit dans Malbouffe (« Mon produit »). Les coefficients et le tableau des fast-foods sont dans le fichier reglages.js.</p>'}
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Synchronisation</div></div>
      <div id="sync-panel">${syncPanelInner()}</div>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Sauvegarde</div></div>
      <p class="small muted" style="margin-top:0">Tes données sont dans ce téléphone. Exporte régulièrement un fichier (dans "Fichiers" ou iCloud Drive) pour ne jamais rien perdre.</p>
      <p class="small faint">Dernier export : ${lastExp ? `${lastExp.toLocaleDateString('fr-FR')} à ${lastExp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'jamais'}</p>
      <div class="stack">
        <button class="btn primary block" data-action="export">⬇ Exporter ma sauvegarde</button>
        <button class="btn block" data-action="import">⬆ Importer une sauvegarde</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Mes activités</div><div class="panel-sub">${state.activities.length}</div></div>
      ${state.activities.map(a => `
        <div class="setting-activity">
          <div class="entry-emoji">${esc(a.icon)}</div>
          <div class="entry-body">
            <div class="entry-title">${esc(a.name)}</div>
            <div class="entry-meta">${a.stats.length ? a.stats.map(k => statByKey[k].name).join(' + ') : 'Aucune stat'} · ${DIFFICULTIES.find(d => d.key === a.difficulty).label}</div>
          </div>
          <button class="icon-btn" data-edit-activity="${esc(a.id)}" aria-label="Modifier">✎</button>
        </div>`).join('') || '<div class="empty">Aucune activité.</div>'}
      <button class="btn block" style="margin-top:12px" data-new-activity="1">＋ Créer une activité</button>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Mes aliments</div><div class="panel-sub">${state.customFoods.length}</div></div>
      ${state.customFoods.length ? state.customFoods.slice().sort((a, b) => a.name.localeCompare(b.name)).map(f => `
        <div class="setting-activity">
          <div class="entry-emoji">⭐</div>
          <div class="entry-body">
            <div class="entry-title">${esc(f.name)}</div>
            <div class="entry-meta">${Math.round(f.per100.kcal)} kcal · P ${fmtG(f.per100.p)} · G ${fmtG(f.per100.g)} · L ${fmtG(f.per100.l)} pour 100 g${f.portion ? ` · portion ${f.portion} g` : ''}</div>
          </div>
          <button class="icon-btn danger" data-del-cfood="${esc(f.id)}" aria-label="Supprimer">✕</button>
        </div>`).join('') : '<p class="small muted" style="margin:0">Aucun pour l\'instant. Quand un aliment est introuvable dans Repas, touche « ✎ Étiquette » et entre ses valeurs : il sera gardé ici.</p>'}
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Ce que je fais mal</div><div class="panel-sub">${state.badActivities.length}</div></div>
      ${state.badActivities.map(a => `
        <div class="setting-activity">
          <div class="entry-emoji">${esc(a.icon)}</div>
          <div class="entry-body">
            <div class="entry-title">${esc(a.name)}</div>
            <div class="entry-meta trend-down">▼ ${a.stats.map(k => statByKey[k].name).join(' + ')}</div>
          </div>
          <button class="icon-btn" data-edit-bad="${esc(a.id)}" aria-label="Modifier">✎</button>
        </div>`).join('') || '<div class="empty">Aucune.</div>'}
      <button class="btn block" style="margin-top:12px" data-new-bad="1">＋ Ajouter une perte de temps</button>
    </section>

    <section class="panel">
      <details class="rules">
        <summary>Comment fonctionne le Système ?</summary>
        <ul>
          <li><b>XP</b> : 1 XP par minute (max 4 h par entrée). "Fait" sans durée = ${RULES.doneXp} XP. Facile ×0,8 · Intense ×1,3.</li>
          <li><b>Niveau</b> : chaque niveau demande plus d'XP que le précédent. Comme dans la vraie vie, ça prend du temps : avec ~2 h d'activité par jour, rang D ≈ 3 mois, C ≈ 1 an, B ≈ 3 ans, A ≈ 6 ans, S ≈ 12 ans.</li>
          <li><b>Rang</b> : E (niv. 1) → D (10) → C (20) → B (35) → A (50) → S (70).</li>
          <li><b>Nutrition</b> : une journée terminée avec 3 repas notés, calories entre objectif −400 et objectif +100, et protéines ≥ 80 % = +${NUTRI_XP} XP et +1 point de Discipline.</li>
          <li><b>Corps</b> : l'hologramme ne s'affine qu'avec ton vrai poids. Perte réaliste : 0,5 à 1 kg par semaine.</li>
          <li><b>Notes de quêtes</b> : le Système les lit. « Intense, record, concentré » = jusqu'à ×1,5 d'XP ; « distrait, fatigué, pas motivé » = jusqu'à ×0,6.</li>
          <li><b>Ce que j'ai mal fait</b> (onglet Aujourd'hui) : −1 XP par minute (−25 XP pour « 1 fois ») et les stats concernées baissent, plus fort que les gains (×1,25). Une journée où le mal l'emporte fait reculer tes stats et supprime le bonus de régularité.</li>
          <li><b>Poids</b> : chaque kg perdu vers l'objectif = +${BODY_XP_PER_KG} XP, chaque kg repris = −${BODY_XP_PER_KG} XP. Ton niveau suit ton corps.</li>
          <li><b>Quête quotidienne</b> : accomplie = +${QUEST_XP} XP ; ratée = PÉNALITÉ (−${QUEST_PENALTY_XP} XP, Discipline −2 points).</li>
          <li><b>Progression</b> : calculée sur toute l'année depuis le jour 0 : 40 % stats, 35 % corps (poids), 25 % nutrition (30 derniers jours).</li>
          <li><b>Rangs du corps</b> : E = départ, D/C/B = étapes, A = ton objectif (${fmtKg(state.body.goalWeight)} kg, < ${state.body.goalFat + 1} % de graisse), S = au-delà.</li>
          <li><b>Stats</b> (sur 100, départ à 10) : elles montent un peu chaque jour où tu travailles le domaine. Plus une stat est haute, plus elle monte lentement. En faire 6 h d'un coup n'apporte presque pas plus que 2 h : la régularité paie.</li>
          <li><b>Discipline</b> : gagne aussi un petit bonus chaque jour où tu fais au moins une activité.</li>
          <li><b>Baisse</b> : après ${RULES.decayGraceDays} jours sans rien dans un domaine, la stat baisse légèrement chaque jour.</li>
          <li><b>Repère</b> : 1 h de sport par jour ≈ +5 en Physique le premier mois, ≈ 60 au bout d'un an.</li>
        </ul>
      </details>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title" style="color:var(--bad)">Zone dangereuse</div></div>
      <button class="btn danger block" data-action="reset">Remettre à zéro</button>
    </section>
  `;
}

/* Rythme nécessaire pour atteindre l'objectif à la date voulue */
function goalPaceHtml() {
  const b = state.body, cur = currentWeight();
  const today = todayKey();
  const from = today > state.startDate ? today : state.startDate;
  const weeks = daysBetween(from, b.goalDate) / 7;
  if (weeks <= 0) return '<p class="small faint">La date objectif est passée.</p>';
  const toLose = cur - b.goalWeight;
  const fatNow = composition(null).fat;
  const fatToLose = (cur * fatNow) / 100 - (b.goalWeight * b.goalFat) / 100;
  const pace = toLose / weeks;
  const ok = pace <= 0.75;
  return `<p class="small ${ok ? 'muted' : 'decay-warn'}" style="margin-bottom:0">Objectif ${fmtKg(b.goalWeight)} kg à moins de ${fmtG(b.goalFat + 1)} % de graisse pour le ${esc(fmtDayLong(b.goalDate))} : ≈ ${fmtG(Math.round(weeks))} semaines, ${fmtKg(Math.max(0, toLose))} kg à perdre (≈ ${fmtKg(Math.max(0, fatToLose))} kg de graisse) → <b>${pace > 0 ? fmtG(Math.round(pace * 100) / 100) : '0'} kg/semaine</b>. ${ok ? 'Rythme réaliste ✓' : 'Rythme trop rapide : recule la date ou accepte un rythme plus lent.'}</p>`;
}

function openActivityEditor(activity, bad = false) {
  const isNew = !activity;
  const listKey = bad ? 'badActivities' : 'activities';
  const a = activity ? { ...activity, stats: [...activity.stats] } : { id: uid(), name: '', icon: bad ? '⛔' : '⭐', stats: [], difficulty: 'normal' };
  const body = `
    <div class="btn-row" style="gap:10px">
      <label class="field" style="flex:0 0 84px"><span>Icône</span>
        <input class="input center" id="act-icon" maxlength="8" value="${esc(a.icon)}" style="font-size:24px;padding:8px">
      </label>
      <label class="field" style="flex:1"><span>Nom</span>
        <input class="input" id="act-name" maxlength="40" value="${esc(a.name)}" placeholder="${bad ? 'Ex : Snapchat' : 'Ex : Méditation'}" autocomplete="off">
      </label>
    </div>
    <div class="field"><span>${bad ? 'Stats qui baissent' : 'Stats qui montent'}</span>
      <div class="chips">${STATS.map(s => `<button type="button" class="chip ${a.stats.includes(s.key) ? 'on' : ''}" data-stat="${s.key}">${s.icon} ${s.name}</button>`).join('')}</div>
    </div>
    <div class="field" ${bad ? 'hidden' : ''}><span>Intensité (multiplie l'XP et les gains)</span>
      <div class="seg">${DIFFICULTIES.map(d => `<button type="button" class="${a.difficulty === d.key ? 'on' : ''}" data-diff="${d.key}">${d.label}</button>`).join('')}</div>
    </div>
    <div class="stack" style="margin-top:6px">
      <button type="button" class="btn primary block" data-save="1">${isNew ? "Créer l'activité" : 'Enregistrer'}</button>
      ${isNew ? '' : '<button type="button" class="btn danger block" data-remove="1">Supprimer cette activité</button>'}
    </div>
    <p class="small faint">Modifier une activité ne change pas les quêtes déjà enregistrées.</p>`;

  openSheet({
    tag: (isNew ? '[SYSTÈME] Nouvelle ' : '[SYSTÈME] Modifier ') + (bad ? 'perte de temps' : 'activité'),
    cls: bad ? 'sheet-bad' : '',
    title: isNew ? 'Créer une activité' : a.name,
    body,
    buttons: [{ label: 'Annuler', value: null, cls: 'ghost' }],
    onMount(sheet, close) {
      sheet.addEventListener('click', async e => {
        const chip = e.target.closest('[data-stat]');
        if (chip) {
          const k = chip.dataset.stat;
          a.stats = a.stats.includes(k) ? a.stats.filter(x => x !== k) : [...a.stats, k];
          chip.classList.toggle('on');
          return;
        }
        const diff = e.target.closest('[data-diff]');
        if (diff) {
          a.difficulty = diff.dataset.diff;
          sheet.querySelectorAll('[data-diff]').forEach(b => b.classList.toggle('on', b === diff));
          return;
        }
        if (e.target.closest('[data-save]')) {
          a.name = $('#act-name', sheet).value.trim();
          a.icon = $('#act-icon', sheet).value.trim() || '⭐';
          if (!a.name) { toast('Nom manquant', "Donne un nom à l'activité.", 'warn'); return; }
          if (!a.stats.length) { toast('Aucune stat choisie', 'Choisis au moins une stat à faire monter.', 'warn'); return; }
          // on garde l'ordre officiel des stats
          a.stats = STAT_KEYS.filter(k => a.stats.includes(k));
          a.u = Date.now();
          if (bad) delete a.difficulty;
          a.u = Date.now();
          if (isNew) state[listKey].push(a);
          else state[listKey] = state[listKey].map(x => x.id === a.id ? a : x);
          save();
          close(null);
          render();
          toast(isNew ? 'Activité créée' : 'Activité modifiée', `${a.icon} ${a.name}`);
          return;
        }
        if (e.target.closest('[data-remove]')) {
          close(null);
          const ok = await confirmBox("Supprimer l'activité ?", `${esc(a.icon)} ${esc(a.name)} disparaîtra de la liste. Tes quêtes passées et ton XP sont conservés.`, 'Supprimer', true);
          if (!ok) return;
          tomb(a.id);
          state[listKey] = state[listKey].filter(x => x.id !== a.id);
          save();
          render();
          toast('Activité supprimée', a.name);
        }
      });
    },
  });
}

/* ---------- Export / Import ---------- */
async function exportSave() {
  const now = new Date();
  let photoData = [];
  try {
    photoData = await Promise.all(photos.map(async p => ({ id: p.id, kind: p.kind || 'body', meal: p.meal, date: p.date, ts: p.ts, pose: p.pose, kg: p.kg, image: await blobToDataUrl(p.blob) })));
  } catch (e) { console.warn('Photos non exportées', e); }
  const payload = { app: 'mon-systeme', appVersion: APP_VERSION, exportedAt: now.toISOString(), data: { ...state, lastExportAt: now.toISOString() }, photos: photoData };
  const json = JSON.stringify(payload, null, 2);
  const filename = `mon-systeme-sauvegarde-${dateKey(now)}.json`;
  let ok = false;
  try {
    const file = new File([json], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Sauvegarde Mon Système' });
      ok = true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // l'utilisateur a annulé
  }
  if (!ok) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    ok = true;
  }
  state.lastExportAt = now.toISOString();
  save();
  render();
  toast('Sauvegarde exportée', filename);
}

function importSave(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      const data = parsed && parsed.data ? parsed.data : parsed;
      const next = sanitizeState(data);
      const lv = levelInfo(next.logs.reduce((s, l) => s + l.xp, 0));
      const inPhotos = Array.isArray(parsed && parsed.photos) ? parsed.photos.filter(p => p && typeof p.image === 'string' && p.image.startsWith('data:image') && isValidKey(p.date)) : null;
      const ok = await confirmBox('Importer cette sauvegarde ?',
        `Joueur : <b>${esc(next.playerName)}</b> — niveau ${lv.level}, ${next.logs.length} quêtes, ${next.weights.length} pesées${inPhotos ? `, ${inPhotos.length} photos` : ''}.<br><br>Elle <b>remplacera</b> les données actuelles de ce téléphone.`,
        'Importer', false);
      if (!ok) return;
      state = next;
      state.replacedAt = Date.now();
      save();
      if (inPhotos) {
        await PhotoDB.clear().catch(() => {});
        photoUrls.forEach(u => URL.revokeObjectURL(u)); photoUrls.clear();
        photos = [];
        for (const p of inPhotos) {
          try {
            const rec = { id: typeof p.id === 'string' ? p.id : uid(), kind: p.kind === 'meal' ? 'meal' : 'body', meal: MEAL_KEYS.includes(p.meal) ? p.meal : 'midi', date: p.date, ts: +p.ts || Date.now(), pose: POSES.some(x => x.key === p.pose) ? p.pose : 'face', kg: +p.kg || next.body.startWeight, blob: await dataUrlToBlob(p.image) };
            await PhotoDB.put(rec);
            photos.push(rec);
          } catch (e) { console.warn('Photo non importée', e); }
        }
      }
      ui.calMonth = null; ui.selectedDay = null;
      render();
      toast('Sauvegarde importée', `Bon retour, ${state.playerName}.`);
    } catch (e) {
      toast('Import impossible', e.message || 'Fichier invalide', 'warn');
    }
  };
  reader.onerror = () => toast('Import impossible', 'Lecture du fichier échouée', 'warn');
  reader.readAsText(file);
}

async function resetAll() {
  const ok1 = await confirmBox('Tout remettre à zéro ?', "Niveau, XP, stats, historique, pesées, photos et activités personnalisées seront effacés de ce téléphone. Conseil : exporte ta sauvegarde avant.", 'Continuer', true);
  if (!ok1) return;
  const ok2 = await confirmBox('Dernière confirmation', "Cette action est <b>définitive</b>. Effacer toute ta progression ?", 'Oui, tout effacer', true);
  if (!ok2) return;
  const name = state.playerName, body = { ...state.body };
  state = freshState();
  state.replacedAt = Date.now();
  state.playerName = name;
  state.body = body;
  save();
  await PhotoDB.clear().catch(() => {});
  photoUrls.forEach(u => URL.revokeObjectURL(u)); photoUrls.clear();
  photos = [];
  ui.calMonth = null; ui.selectedDay = null;
  go('home');
  toast('Système réinitialisé', 'Une nouvelle aventure commence.');
}

/* =========================================================
   v3 · SURPASSEMENT : paliers de lumière, sons de jeu,
   sport par exercice, mauvaises habitudes plus justes
   ========================================================= */

/* ---------- Détails des entrées (vérifiés au chargement / à l'import) ---------- */
function cleanLogDetails(l) {
  const o = {};
  const fin = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
  const hm = v => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
  const TIERS = ['normal', 'fort', 'legendaire'];
  if (BAD_KINDS.includes(l.kind)) o.kind = l.kind;
  if (hm(l.t0)) o.t0 = l.t0;
  if (fin(l.mult, 0, 2)) o.mult = l.mult;
  if (fin(l.pts, 0, 50)) o.pts = l.pts;
  if (TIERS.includes(l.tier)) o.tier = l.tier;
  if (Array.isArray(l.ex)) o.ex = l.ex.filter(e => e && typeof e.nom === 'string').slice(0, 20).map(e => ({
    id: typeof e.id === 'string' ? e.id.slice(0, 40) : 'x', nom: e.nom.slice(0, 40), type: ['nombre', 'charge', 'duree'].includes(e.type) ? e.type : 'nombre',
    coef: fin(e.coef, 0, 20) ? e.coef : 1, reps: fin(e.reps, 0, 10000) ? Math.round(e.reps) : 0, sets: fin(e.sets, 0, 100) ? Math.round(e.sets) : 1,
    kg: fin(e.kg, 0, 1000) ? e.kg : 0, min: fin(e.min, 0, 1440) ? Math.round(e.min) : 0, xp: fin(e.xp, 0, 5000) ? Math.round(e.xp) : 0,
    tier: TIERS.includes(e.tier) ? e.tier : 'normal', rec: e.rec === true,
  }));
  if (l.junk && typeof l.junk === 'object') {
    const j = l.junk;
    o.junk = { e: String(j.e || 'autre').slice(0, 12), en: String(j.en || '').slice(0, 30), dessin: String(j.dessin || 'burger').slice(0, 12), kcal: fin(j.kcal, 0, 10000) ? Math.round(j.kcal) : 0,
      items: Array.isArray(j.items) ? j.items.slice(0, 12).map(x => ({ nom: String(x.nom || '').slice(0, 50), kcal: fin(x.kcal, 0, 5000) ? Math.round(x.kcal) : 0, q: fin(x.q, 1, 20) ? Math.round(x.q) : 1, dessin: String(x.dessin || '').slice(0, 12) })) : [] };
  }
  if (l.sleep && typeof l.sleep === 'object') {
    const s = l.sleep;
    o.sleep = { bed: hm(s.bed), wake: hm(s.wake), dur: fin(s.dur, 0, 1440) ? Math.round(s.dur) : 0, delay: fin(s.delay, -1440, 1440) ? Math.round(s.delay) : 0 };
  }
  if (fin(l.glasses, 1, 50)) o.glasses = Math.round(l.glasses);
  return o;
}

/* ---------- Ce que j'ai mal fait : quel type ? ---------- */
function badKind(a) {
  if (a.kind && BAD_KINDS.includes(a.kind)) return a.kind;
  const id = a.id || '', n = normTxt(a.name || '');
  if (/b-reseaux|b-jeux|b-series/.test(id) || /tiktok|insta|snap|reseau|jeu|youtube|netflix|serie|twitch|scroll|telephone|ecran/.test(n)) return 'screen';
  if (id === 'b-malbouffe' || /malbouffe|mcdo|fast|kebab|burger/.test(n)) return 'food';
  if (id === 'b-tard' || /couche|dormi|tard|sommeil/.test(n)) return 'sleep';
  if (id === 'b-soiree' || /alcool|soiree|biere|boire|verre/.test(n)) return 'alcohol';
  return 'time';
}
const hmToMin = hm => { const [h, m] = String(hm || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const minToHm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); };
const fmtHm = hm => (hm ? hm.replace(':', ' h ') : '?');
/* Écrans : avant 20 h = perte normale (×1) ; après 20 h (et la nuit jusqu'à 5 h) = ×0,5 */
function screenMult(t0) { const h = Math.floor(hmToMin(t0) / 60); return h >= REGLAGES_MAL.ecranHeureSoir || h < 5 ? REGLAGES_MAL.ecranCoefSoir : 1; }
function badDetail(l) {
  if (l.kind === 'screen') return `${l.minutes ? fmtMinutes(l.minutes) : '1 fois'}${l.t0 ? ' à ' + fmtHm(l.t0) : ''}${l.mult && l.mult < 1 ? ' · soirée ×' + String(l.mult).replace('.', ',') : ''}`;
  if (l.kind === 'food' && l.junk) return `${l.junk.items.map(x => (x.q > 1 ? x.q + '× ' : '') + x.nom).join(' + ')} · ${fmtNum(l.junk.kcal)} kcal`;
  if (l.kind === 'sleep' && l.sleep) return `couché à ${fmtHm(l.sleep.bed)} · ${fmtMinutes(l.sleep.dur) || '0 min'} de sommeil · ${l.sleep.delay > 0 ? fmtMinutes(l.sleep.delay) + ' de retard' : 'à l’heure'}`;
  if (l.kind === 'alcohol' && l.glasses) return `${l.glasses} verre${l.glasses > 1 ? 's' : ''}`;
  return '';
}
function exDetail(l) {
  const parts = (l.ex || []).map(e => e.type === 'charge' ? `${e.nom} ${e.sets}×${e.reps} à ${fmtG(e.kg)} kg` : e.type === 'duree' ? `${e.nom} ${fmtMinutes(e.min)}` : `${e.nom} ${e.sets > 1 ? e.sets + '×' + e.reps : e.reps}`);
  return parts.join(' · ') + (l.minutes ? ` · séance ${fmtMinutes(l.minutes)}` : '');
}
/* Choix du jour dans les fenêtres (Aujourd'hui / Hier, ou jour fixé en mode rattrapage) */
function sheetDayHtml(defYesterday = false) {
  const vd = todayView();
  if (vd < todayKey()) return `<div class="log-day-fixed">↺ Pour le ${esc(fmtDayLong(vd))}</div>`;
  return `<div class="seg" style="margin-bottom:14px"><button type="button" class="${defYesterday ? '' : 'on'}" data-day="today">Aujourd'hui</button><button type="button" class="${defYesterday ? 'on' : ''}" data-day="yesterday">Hier</button></div>`;
}
function sheetDay(sheet) {
  const vd = todayView();
  if (vd < todayKey()) return vd;
  const b = sheet.querySelector('[data-day].on');
  return b && b.dataset.day === 'yesterday' ? addDays(todayKey(), -1) : todayKey();
}
function sheetDayClick(sheet, e) {
  const b = e.target.closest('[data-day]');
  if (!b) return false;
  sheet.querySelectorAll('[data-day]').forEach(x => x.classList.toggle('on', x === b));
  return true;
}

/* =========================================================
   SURPASSEMENT DU JOUR → palier de lumière
   avancement = moyenne de (fait ÷ objectif) des quêtes du jour
   ========================================================= */
const goalRatio = g => (g.max ? (g.cur <= g.target ? 1 : Math.max(0, g.target / Math.max(1, g.cur))) : Math.max(0, g.cur / Math.max(1, g.target)));
function surpassInfo(date = todayKey()) {
  const q = dailyQuest(date);
  if (!q.goals.length) return { avg: 0, tier: 0, q };
  const avg = q.goals.reduce((s, g) => s + goalRatio(g), 0) / q.goals.length;
  let tier = 0;
  for (const p of REGLAGES_PALIERS) if (avg >= p.avancement - 1e-9) tier = Math.max(tier, p.n);
  if (tier >= 2 && !q.done) tier = 1; // palier 2 et + : toutes les quêtes doivent être faites
  return { avg, tier, q };
}
const TIER_KEY = 'monSysteme.palier';
let shownTier = null;
/* Le palier ne redescend pas dans la journée */
function dayTier() {
  const today = todayKey();
  const s = surpassInfo(today);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(TIER_KEY) || 'null'); } catch (_) {}
  const prev = saved && saved.d === today ? saved.t : 0;
  const tier = Math.max(prev, s.tier);
  if (!saved || saved.d !== today || saved.t !== tier) { try { localStorage.setItem(TIER_KEY, JSON.stringify({ d: today, t: tier })); } catch (_) {} }
  return { tier, s };
}
function applyTier() {
  const { tier, s } = dayTier();
  const root = document.documentElement;
  if (root.dataset.tier !== String(tier)) root.dataset.tier = tier;
  if (tier >= 6) ensureSparkles(); else removeSparkles();
  if (shownTier !== null && tier > shownTier) announceTier(tier, s);
  shownTier = tier;
}
/* attend que les grandes animations en cours soient finies */
function whenCalm(fn, wait = 300) {
  const go = () => (document.querySelector('.celebrate, .lvlup, .ultime, .p1000') ? setTimeout(go, 400) : fn());
  setTimeout(go, wait);
}
function announceTier(t, s) {
  whenCalm(() => {
    if (t === 6) return ultimateExplosion(s);
    if (t === 1) return toast('Palier 1 · En route', 'La moitié est faite. Continue.');
    if (t === 2) return; // la fenêtre « QUÊTE ACCOMPLIE » s'en charge
    tierBanner(t, s);
  }, 700);
}
function tierBanner(t, s) {
  const el = document.createElement('div');
  el.className = 'tier-banner tb-' + t;
  el.innerHTML = `<div class="tb-tag">[SYSTÈME] PALIER ${t}</div><b>${esc(REGLAGES_PALIERS[t].nom.toUpperCase())}</b><span>Avancement ${fmtNum(s.avg * 100)} % · ${t >= 5 ? 'la couleur du Système change' : t >= 4 ? 'tes quêtes brillent fort' : 'tes quêtes brillent'}</span>`;
  document.body.appendChild(el);
  sfx('g' + Math.min(5, t)); haptic(2);
  setTimeout(() => el.classList.add('out'), 2700);
  setTimeout(() => el.remove(), 3200);
}
/* MODE ULTIME : explosion de lumière (≈ 4 s), puis l'app reste très brillante mais lisible */
function ultimateExplosion(s) {
  const ov = document.createElement('div');
  ov.className = 'ultime';
  ov.innerHTML = `<div class="ul-flash"></div><div class="ul-rays"></div><div class="ul-rays r2"></div>
    <div class="ul-parts">${Array.from({ length: 64 }, (_, i) => `<i style="--a:${((i * 360) / 64 + Math.random() * 5).toFixed(1)}deg;--r:${(170 + Math.random() * 260) | 0}px;--d:${(Math.random() * 700) | 0}ms;--s:${(3 + Math.random() * 6).toFixed(1)}px"></i>`).join('')}</div>
    <div class="ul-box"><div class="ul-tag">[SYSTÈME] ALERTE</div><div class="ul-title">MODE ULTIME</div><div class="ul-big">+${fmtNum((s.avg - 1) * 100)} %</div><div class="ul-sub">Surpassement absolu. Le Système n'avait jamais vu ça.</div></div>`;
  document.body.appendChild(ov);
  sfx('ultime'); haptic(3); setTimeout(() => haptic(3), 1000);
  setTimeout(() => ov.classList.add('out'), 4000);
  setTimeout(() => ov.remove(), 4700);
}
function ensureSparkles() {
  if ($('#fx-sparkle')) return;
  const box = document.createElement('div');
  box.id = 'fx-sparkle';
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = Array.from({ length: 30 }, () => `<i style="left:${(Math.random() * 100).toFixed(1)}%;--d:${(Math.random() * 8).toFixed(2)}s;--t:${(6 + Math.random() * 6).toFixed(1)}s;--s:${(2 + Math.random() * 4).toFixed(1)}px;--x:${((Math.random() - 0.5) * 60) | 0}px"></i>`).join('');
  document.body.insertBefore(box, document.body.firstChild);
}
function removeSparkles() { const b = $('#fx-sparkle'); if (b) b.remove(); }

/* La couleur de toute l'app évolue avec la progression globale */
function setProgTheme() {
  try { const g = progressionInfo(todayKey()).grade; if (document.documentElement.dataset.prog !== g) document.documentElement.dataset.prog = g; } catch (_) {}
}

/* =========================================================
   SONS DE JEU (0,6 à 1,2 s) : progression par quart, validation, brillance
   ========================================================= */
const arpS = (base, steps, gap, last, vol, type = 'square') => steps.map((st, i) => [base * Math.pow(2, st / 12), i * gap, i === steps.length - 1 ? last : gap * 1.7, vol, type]);
const GAME_SOUNDS = {
  q0: arpS(330, [0, 3, 7], 0.12, 0.4, 0.05),
  q1: arpS(392, [0, 3, 7, 12], 0.11, 0.42, 0.055),
  q2: arpS(466, [0, 4, 7, 12, 16], 0.1, 0.45, 0.06),
  q3: arpS(523, [0, 4, 7, 12, 16, 19], 0.09, 0.5, 0.065),
  valid: [...arpS(523, [0, 4, 7, 12], 0.11, 0.12, 0.07), [1047, 0.46, 0.7, 0.07, 'square'], [1319, 0.46, 0.7, 0.05, 'triangle'], [1568, 0.46, 0.7, 0.05, 'triangle'], [523, 0.46, 0.7, 0.07, 'triangle']],
  x1: arpS(880, [0, 7, 12, 19], 0.08, 0.36, 0.045, 'triangle'),
  x2: arpS(988, [0, 7, 12, 19], 0.08, 0.36, 0.045, 'triangle'),
  x3: arpS(1109, [0, 7, 12, 19], 0.08, 0.38, 0.045, 'triangle'),
  x4: arpS(1245, [0, 7, 12, 19, 24], 0.075, 0.38, 0.045, 'triangle'),
  x5: arpS(1397, [0, 7, 12, 19, 24], 0.075, 0.4, 0.045, 'triangle'),
  g2: [...arpS(659, [0, 4, 7, 12, 16, 19, 24], 0.07, 0.45, 0.05), [330, 0, 0.6, 0.06, 'triangle']],
  g3: [...arpS(740, [0, 4, 7, 12, 16, 19, 24, 28], 0.065, 0.5, 0.05), [370, 0, 0.7, 0.07, 'triangle'], [1480, 0.55, 0.45, 0.03, 'sine']],
  g4: [...arpS(831, [0, 3, 7, 12, 15, 19, 24, 27, 31], 0.06, 0.55, 0.05), [208, 0, 0.9, 0.08, 'sawtooth'], [1661, 0.6, 0.5, 0.035, 'sine']],
  g5: [...arpS(988, [0, 4, 7, 11, 12, 16, 19, 23, 24, 28], 0.055, 0.6, 0.05), [247, 0, 1.1, 0.09, 'sawtooth'], [494, 0.55, 0.6, 0.06, 'square'], [1976, 0.6, 0.55, 0.035, 'sine']],
  fort: [...arpS(440, [0, 4, 7, 12, 16], 0.09, 0.5, 0.07), [220, 0, 0.8, 0.08, 'sawtooth']],
  legend: [...arpS(392, [0, 4, 7, 12, 16, 19, 24, 28, 31], 0.08, 0.6, 0.07), [196, 0, 1.2, 0.1, 'sawtooth'], [1568, 0.7, 0.5, 0.05, 'sine'], [2093, 0.75, 0.45, 0.04, 'sine']],
  ultime: [...arpS(523, [0, 4, 7, 12, 16, 19, 24, 28, 31, 36], 0.07, 0.8, 0.07), [131, 0, 1.6, 0.12, 'sawtooth'], [262, 0.3, 1.3, 0.08, 'square'], [2093, 0.8, 0.8, 0.05, 'sine'], [2637, 0.9, 0.7, 0.04, 'sine']],
};
/* son selon la progression d'une quête (ratio avant → après) */
function questSound(r0, r1) {
  if (r1 >= 1 && r0 < 1) return sfx('valid');
  const b0 = Math.floor(r0), b1 = Math.floor(r1);
  if (r1 >= 2 && b1 > b0) return sfx('g' + Math.min(5, b1));
  if (r1 < 1) return sfx('q' + Math.min(3, Math.floor(r1 * 4)));
  return sfx('x' + Math.min(5, Math.max(1, b1)));
}

/* =========================================================
   POMPES : bras qui évoluent (600 / 700 / 800) et page 1 000
   ========================================================= */
const ARM_PATH = 'M8 58 C8 44 14 34 24 30 C32 27 36 32 38 36 C40 30 40 22 38 16 C37 10 42 6 48 7 C55 8 58 14 56 20 C54 24 52 26 52 30 C54 40 56 50 50 56 C44 61 30 60 20 60 C14 60 10 60 8 58 Z';
function pushArm(n) {
  if (n < 600) return '';
  if (n < 700) return `<svg class="arm-svg a1" viewBox="0 0 64 64" aria-label="Bras d'alien"><defs><radialGradient id="ga1" cx="35%" cy="40%" r="70%"><stop offset="0" stop-color="#d4ffb0"/><stop offset=".5" stop-color="#4fe36b"/><stop offset="1" stop-color="#0a6b33"/></radialGradient></defs>
    <path d="${ARM_PATH}" fill="url(#ga1)" stroke="#caffb0" stroke-width="1.6"/>
    <path d="M16 46 C20 40 26 38 30 40 M40 24 C44 30 48 36 48 46" stroke="#1d8f45" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M44 6 L42 0 M50 6 L51 0 M56 10 L61 6" stroke="#eaffd8" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="25" cy="38" r="2.4" fill="#eaffd8"/><circle cx="31" cy="35" r="1.6" fill="#eaffd8"/></svg>`;
  if (n < 800) return `<svg class="arm-svg a2" viewBox="0 0 64 64" aria-label="Bras cybernétique"><defs><linearGradient id="ga2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3d4ff"/><stop offset=".45" stop-color="#8f5bff"/><stop offset="1" stop-color="#2a0f6b"/></linearGradient></defs>
    <path d="${ARM_PATH}" fill="url(#ga2)" stroke="#e3d4ff" stroke-width="1.6"/>
    <path d="M14 50 L34 50 M18 42 L36 42 M40 30 L54 30 M41 22 L55 22" stroke="#c9b6ff" stroke-width="1.2" opacity=".8"/>
    <path class="arm-bolt" d="M20 54 L26 46 L23 45 L30 36 M44 40 L48 33 L45 32 L50 24" stroke="#7fe0ff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle class="arm-core" cx="27" cy="37" r="4.2" fill="#7fe0ff"/></svg>`;
  return `<svg class="arm-svg a3" viewBox="0 0 64 64" aria-label="Bras légendaire"><defs><radialGradient id="ga3" cx="40%" cy="40%" r="75%"><stop offset="0" stop-color="#fffbe6"/><stop offset=".45" stop-color="#ffc35a"/><stop offset="1" stop-color="#b3420a"/></radialGradient></defs>
    <path class="arm-flame" d="M6 60 C2 46 6 30 14 24 C12 34 18 36 20 28 C24 16 34 8 46 2 C42 10 50 12 60 8 C56 18 62 26 60 40 C58 52 54 60 50 62 Z" fill="#ff7a1a" opacity=".55"/>
    <path d="${ARM_PATH}" fill="url(#ga3)" stroke="#fff3c4" stroke-width="1.8"/>
    <path class="arm-bolt" d="M16 52 L24 44 L20 43 L30 32 M42 40 L47 31 L43 30 L50 20" stroke="#ffffff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M30 6 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5z M58 46 l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1z" fill="#fff"/></svg>`;
}
function openPushupPage(day) {
  const n = (dailyQuest(day).goals.find(g => g.key === 'pushups') || {}).cur || 0;
  const d = parseKey(day);
  const ov = document.createElement('div');
  ov.className = 'p1000';
  ov.innerHTML = `
    <div class="p1-rays"></div><div class="p1-glow"></div>
    <div class="p1-parts">${Array.from({ length: 40 }, (_, i) => `<i style="--a:${(i * 9).toFixed(0)}deg;--r:${(150 + (i % 5) * 45)}px;--d:${(i % 8) * 120}ms"></i>`).join('')}</div>
    <button type="button" class="p1-close" aria-label="Fermer">✕</button>
    <div class="p1-box">
      <div class="p1-tag">[SYSTÈME] EXPLOIT</div>
      <div class="p1-arm">${pushArm(1000)}</div>
      <div class="p1-title">1 000 POMPES</div>
      <div class="p1-count"><b data-p1-count="${n}">0</b><span>pompes</span></div>
      <div class="p1-date">${esc(capFirst(DAYS[d.getDay()]))} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}</div>
      <div class="p1-msg">Moins de 1 % des gens en sont capables <em>(estimation)</em></div>
      <p class="p1-note">Aucune étude ne mesure combien de personnes peuvent faire 1 000 pompes en une journée : c'est une estimation. Repère : dans un sondage de 2021 (Gymless.org, adultes américains), 53,8 % ne dépassent pas 10 pompes d'affilée.</p>
    </div>`;
  document.body.appendChild(ov);
  sfx('ultime'); haptic(3);
  const b = ov.querySelector('[data-p1-count]'), t0 = performance.now();
  const stepC = now => { const k = Math.min(1, (now - t0) / 1800); b.textContent = fmtNum(n * (1 - Math.pow(1 - k, 3))); if (k < 1 && ov.isConnected) requestAnimationFrame(stepC); };
  requestAnimationFrame(stepC);
  const close = () => { ov.classList.add('out'); setTimeout(() => ov.remove(), 400); };
  ov.querySelector('.p1-close').addEventListener('click', close);
}

/* =========================================================
   RANGS A ET S : régularité sur des semaines + vrai changement physique
   ========================================================= */
let _recs = { k: '', v: null };
/* Records d'exercice (charge max, ou volume max d'une séance) et nombre de records battus */
function exerciseRecords() {
  const k = state.logs.length + '|' + state.logs.reduce((s, l) => s + (l.ex ? l.ex.length : 0), 0) + '|' + state.logs.reduce((s, l) => s + (l.xp || 0), 0);
  if (_recs.k === k) return _recs.v;
  const best = new Map();
  let beaten = 0;
  for (const l of state.logs.filter(x => x.ex).sort((a, b) => (a.date + a.ts).localeCompare(b.date + b.ts))) {
    for (const e of l.ex) {
      const m = exMetric(e);
      if (!(m > 0)) continue;
      if (best.has(e.id) && m > best.get(e.id)) beaten++;
      if (!best.has(e.id) || m > best.get(e.id)) best.set(e.id, m);
    }
  }
  _recs = { k, v: { best, beaten } };
  return _recs.v;
}
const exMetric = e => (e.type === 'charge' ? e.kg : e.type === 'duree' ? e.min : (e.reps || 0) * (e.sets || 1));
let _gate = { k: '', v: null };
function rankGate() {
  const today = todayKey();
  questIndex();
  const k = today + '|' + questIndex._k + '|' + state.weights.length + '|' + currentWeight() + '|' + state.startDate;
  if (_gate.k === k) return _gate.v;
  const recs = exerciseRecords().beaten;
  const body = bodyProgress().progress;
  const v = {};
  for (const L of ['A', 'S']) {
    const R = REGLAGES_RANGS[L];
    let solid = 0;
    for (let w = 0; w < R.semaines; w++) {
      let n = 0;
      for (let d = 1; d <= 7; d++) { const day = addDays(today, -(w * 7 + d)); if (day >= state.startDate && dailyQuest(day).done) n++; }
      if (n >= R.joursParSemaine) solid++;
    }
    v[L] = { ok: solid >= R.semainesSolides && body >= R.corps && recs >= R.records, solid, body, recs, R };
  }
  _gate = { k, v };
  return v;
}
function rankGateHtml() {
  const g = rankGate();
  const row = (L) => { const x = g[L], R = x.R; return `
    <div class="gate ${x.ok ? 'ok' : ''}"><b>Rang ${L} ${x.ok ? '✓' : '🔒'}</b>
      <span>${x.solid >= R.semainesSolides ? '✓' : '·'} Régularité : ${x.solid}/${R.semainesSolides} semaines solides (≥ ${R.joursParSemaine} jours de quête sur ${R.semaines} semaines)</span>
      <span>${x.body >= R.corps ? '✓' : '·'} Corps : ${Math.round(x.body * 100)} % / ${Math.round(R.corps * 100)} % de l'objectif de poids</span>
      <span>${x.recs >= R.records ? '✓' : '·'} Records d'exercice battus : ${x.recs}/${R.records}</span></div>`; };
  return `
    <section class="panel">
      <div class="panel-head"><div class="panel-title">Rangs A et S</div><div class="panel-sub">très durs</div></div>
      <p class="small muted" style="margin:-4px 0 10px">En plus du niveau (A = 50, S = 70), il faut un vrai changement sur plusieurs mois. L'XP des activités est plafonnée à ${REGLAGES_RANGS.xpMaxParJour} par jour : une seule grosse journée ne suffit jamais.</p>
      ${row('A')}${row('S')}
    </section>`;
}

/* =========================================================
   SPORT : je choisis (ou j'écris) l'exercice, avec la bonne unité
   ========================================================= */
function allExercises() {
  const mine = state.customExercises.map(x => ({ id: 'u' + x.id, nom: x.nom, icone: '⭐', type: x.type, coef: x.coef, standard: 1, mine: true,
    fort: x.type === 'charge' ? 100 : x.type === 'duree' ? 60 : Math.max(10, Math.round(225 / x.coef)), legendaire: x.type === 'charge' ? 200 : x.type === 'duree' ? 120 : Math.max(30, Math.round(750 / x.coef)) }));
  return REGLAGES_EXERCICES.concat(mine);
}
const TIER_LABEL = { normal: 'Normal', fort: 'Fort 🔥', legendaire: 'LÉGENDAIRE 👑' };
const TIER_RANK = { normal: 0, fort: 1, legendaire: 2 };
/* XP = base × coefficient × volume^0,6 (rendement décroissant), seuils d'animation */
function exCalc(ex, r, bw, best) {
  const S = REGLAGES_SPORT;
  let pts, metric, tier = 'normal', mult = 1;
  if (ex.type === 'charge') {
    const V = (r.reps || 0) * (r.sets || 0), rel = (r.kg || 0) / bw / (ex.standard || 1);
    pts = ex.coef * (0.5 + 1.5 * Math.min(2.5, rel)) * V;
    metric = r.kg || 0;
    if (metric >= ex.legendaire) tier = 'legendaire'; else if (metric >= ex.fort) tier = 'fort';
    mult = metric >= 300 ? 1.5 : metric >= 200 ? 1.25 : metric >= 100 ? 1.1 : 1; // 100, 200, 300 kg : chaque palier rapporte plus
    if (!V) pts = 0;
  } else if (ex.type === 'duree') {
    metric = r.min || 0;
    pts = (ex.coef * metric) / 2;
    if (metric >= ex.legendaire) tier = 'legendaire'; else if (metric >= ex.fort) tier = 'fort';
  } else {
    metric = (r.reps || 0) * (r.sets || 0);
    pts = ex.coef * metric;
    if (metric >= ex.legendaire) tier = 'legendaire'; else if (metric >= ex.fort) tier = 'fort';
  }
  const rec = best != null && metric > best && metric > 0;
  if (rec && tier !== 'legendaire') tier = ex.type === 'charge' && metric >= ex.fort ? 'legendaire' : tier === 'normal' ? 'fort' : 'legendaire';
  const xp = pts > 0 ? Math.min(S.xpMaxExercice, Math.round(S.base * Math.pow(pts, S.puissance) * mult)) : 0;
  return { pts, xp, tier, rec, metric };
}
function openExerciseSheet(activity) {
  const exs = allExercises();
  const bw = currentWeight();
  const recs = exerciseRecords().best;
  let rows = [], minutes = 0, custom = false;
  const rowHtml = (r, i) => {
    const ex = r.ex, c = exCalc(ex, r, bw, recs.has(ex.id) ? recs.get(ex.id) : null);
    const stp = (f, v, lab, step) => `<div class="exf"><span>${lab}</span><div class="exs"><button type="button" data-exs="${i}:${f}:-${step}">−</button><input inputmode="decimal" data-exi="${i}:${f}" value="${v || ''}" placeholder="0"><button type="button" data-exs="${i}:${f}:${step}">+</button></div></div>`;
    const fields = ex.type === 'charge' ? stp('kg', r.kg, 'Charge (kg)', 2.5) + stp('sets', r.sets, 'Séries', 1) + stp('reps', r.reps, 'Répétitions', 1)
      : ex.type === 'duree' ? stp('min', r.min, 'Minutes', 5) : stp('sets', r.sets, 'Séries', 1) + stp('reps', r.reps, 'Répétitions', 1);
    const vol = ex.type === 'charge' ? `${fmtG(r.kg || 0)} kg = ${fmtG(Math.round(((r.kg || 0) / bw) * 100) / 100)}× ton poids · ${(r.sets || 0) * (r.reps || 0)} répétitions` : ex.type === 'duree' ? `${r.min || 0} min` : `${(r.sets || 0) * (r.reps || 0)} répétitions`;
    return `<div class="exrow t-${c.tier} enter" style="--i:${i}">
      <div class="exr-head"><span class="exr-ico">${esc(ex.icone)}</span><b>${esc(ex.nom)}</b><small>×${fmtG(ex.coef)}</small><button type="button" class="fc-x" data-exrm="${i}" aria-label="Retirer">✕</button></div>
      <div class="exr-fields">${fields}</div>
      <div class="exr-sum"><span>${vol}</span><span class="exr-tier">${c.rec ? '🏆 RECORD · ' : ''}${TIER_LABEL[c.tier]}</span><b>+${c.xp} XP</b></div>
    </div>`;
  };
  openSheet({
    tag: '[SYSTÈME] Séance de sport',
    title: `${activity.icon} Qu'as-tu fait ?`,
    cls: 'ex-sheet',
    body: `
      ${sheetDayHtml()}
      <div id="ex-rows"></div>
      <div class="field" style="margin-top:10px"><span>＋ Ajoute tes exercices (plus c'est dur, plus ça rapporte)</span></div>
      <div class="ex-pick">${exs.map(ex => `<button type="button" class="ex-chip" data-exadd="${esc(ex.id)}"><span>${esc(ex.icone)}</span>${esc(ex.nom)}<small>×${fmtG(ex.coef)}${ex.type === 'charge' ? ' · kg' : ex.type === 'duree' ? ' · min' : ''}</small></button>`).join('')}
        <button type="button" class="ex-chip add" data-excustom="1"><span>＋</span>Autre exercice<small>je l'écris</small></button></div>
      <div id="ex-custom"></div>
      <div class="field" style="margin-top:12px"><span>Durée de la séance</span></div>
      <div class="ex-durs">${[0, 20, 30, 45, 60, 90, 120].map(m => `<button type="button" class="fchip ${m === 0 ? 'on' : ''}" data-exdur="${m}">${m ? fmtMinutes(m) : '—'}</button>`).join('')}</div>
      <label class="field" style="margin-top:10px"><span>Note (le Système juge la qualité)</span><input class="input" id="ex-note" maxlength="280" placeholder="Ex : séance intense, record au développé couché"></label>
      <div class="fs-foot" id="ex-foot"><div id="ex-total"></div><button type="button" class="btn primary block fs-add" data-exsave="1">✓ Valider la séance</button></div>`,
    onMount(sheet, close) {
      const draw = () => {
        $('#ex-rows', sheet).innerHTML = rows.map(rowHtml).join('');
        const calc = rows.map(r => exCalc(r.ex, r, bw, recs.has(r.ex.id) ? recs.get(r.ex.id) : null));
        const xp = rows.length ? calc.reduce((s, c) => s + c.xp, 0) + Math.round(minutes * REGLAGES_SPORT.xpParMinute) : minutes ? entryXp(minutes, activity.difficulty) : 0;
        const top = calc.reduce((t, c) => (TIER_RANK[c.tier] > TIER_RANK[t] ? c.tier : t), 'normal');
        $('#ex-total', sheet).innerHTML = rows.length || minutes ? `<div class="ftot"><b>+${fmtNum(xp)} XP</b><span>${rows.length} exercice${rows.length > 1 ? 's' : ''}${minutes ? ' · ' + fmtMinutes(minutes) : ''}</span><span class="exr-tier t-${top}">${TIER_LABEL[top]}</span></div>` : '<div class="ftodo">Touche un exercice ou une durée.</div>';
      };
      const customForm = () => `
        <div class="food-form ex-form">
          <div class="ff-title">[SYSTÈME] Nouvel exercice</div>
          <label class="field"><span>Nom</span><input class="input" id="exc-nom" maxlength="40" placeholder="Ex : Front lever"></label>
          <div class="seg" id="exc-type"><button type="button" class="on" data-exct="nombre">Au nombre</button><button type="button" data-exct="charge">En kilos</button><button type="button" data-exct="duree">Durée</button></div>
          <div class="field" style="margin-top:10px"><span>Difficulté</span></div>
          <div class="ex-durs" id="exc-coef">${[[1, 'Facile ×1'], [1.5, '×1,5'], [2.5, 'Dur ×2,5'], [4, 'Très dur ×4'], [5, 'Extrême ×5']].map(([c, l], i) => `<button type="button" class="fchip ${i === 1 ? 'on' : ''}" data-excc="${c}">${l}</button>`).join('')}</div>
          <button type="button" class="btn primary block" style="margin-top:10px" data-excok="1">✓ Ajouter cet exercice</button>
        </div>`;
      draw();
      sheet.addEventListener('click', e => {
        if (sheetDayClick(sheet, e)) return;
        const t = e.target;
        const add = t.closest('[data-exadd]');
        if (add) { const ex = exs.find(x => x.id === add.dataset.exadd); if (ex) { rows.push({ ex, sets: ex.type === 'duree' ? 0 : 3, reps: ex.type === 'charge' ? 8 : ex.type === 'duree' ? 0 : 10, kg: ex.type === 'charge' ? Math.round(bw * (ex.standard || 1) * 0.5 / 2.5) * 2.5 : 0, min: ex.type === 'duree' ? 30 : 0 }); sfx('tap'); haptic(); draw(); const last = sheet.querySelector('.exrow:last-child'); if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' }); } return; }
        if (t.closest('[data-excustom]')) { custom = !custom; $('#ex-custom', sheet).innerHTML = custom ? customForm() : ''; if (custom) $('#exc-nom', sheet).focus(); return; }
        const ct = t.closest('[data-exct]'); if (ct) { sheet.querySelectorAll('[data-exct]').forEach(b => b.classList.toggle('on', b === ct)); return; }
        const cc = t.closest('[data-excc]'); if (cc) { sheet.querySelectorAll('[data-excc]').forEach(b => b.classList.toggle('on', b === cc)); return; }
        if (t.closest('[data-excok]')) {
          const nom = $('#exc-nom', sheet).value.trim();
          if (!nom) { toast('Nom manquant', 'Écris le nom de l’exercice.', 'warn'); return; }
          const x = { id: uid(), nom: nom.slice(0, 40), type: sheet.querySelector('[data-exct].on').dataset.exct, coef: +sheet.querySelector('[data-excc].on').dataset.excc, ts: Date.now(), u: Date.now() };
          state.customExercises.push(x); save();
          const ex = allExercises().find(y => y.id === 'u' + x.id);
          exs.push(ex);
          rows.push({ ex, sets: ex.type === 'duree' ? 0 : 3, reps: ex.type === 'charge' ? 8 : ex.type === 'duree' ? 0 : 10, kg: ex.type === 'charge' ? 20 : 0, min: ex.type === 'duree' ? 30 : 0 });
          custom = false; $('#ex-custom', sheet).innerHTML = '';
          const pick = $('.ex-pick', sheet);
          pick.insertAdjacentHTML('afterbegin', `<button type="button" class="ex-chip" data-exadd="${esc(ex.id)}"><span>⭐</span>${esc(ex.nom)}<small>×${fmtG(ex.coef)}</small></button>`);
          toast('Exercice ajouté', `⭐ ${x.nom} est gardé dans ta liste.`);
          draw(); return;
        }
        const st = t.closest('[data-exs]');
        if (st) { const [i, f, d] = st.dataset.exs.split(':'); const r = rows[+i]; r[f] = Math.max(0, Math.round(((r[f] || 0) + +d) * 10) / 10); haptic(); draw(); return; }
        const rm = t.closest('[data-exrm]'); if (rm) { rows.splice(+rm.dataset.exrm, 1); draw(); return; }
        const du = t.closest('[data-exdur]'); if (du) { minutes = +du.dataset.exdur; sheet.querySelectorAll('[data-exdur]').forEach(b => b.classList.toggle('on', b === du)); haptic(); draw(); return; }
        if (t.closest('[data-exsave]')) {
          const ok = rows.filter(r => exMetric({ type: r.ex.type, kg: r.kg, min: r.min, reps: r.reps, sets: r.sets }) > 0);
          if (!ok.length && !minutes) { toast('Rien à valider', 'Ajoute un exercice ou la durée de la séance.', 'warn'); return; }
          const date = sheetDay(sheet), note = $('#ex-note', sheet).value.trim();
          close(null);
          addExerciseLog(activity, ok, minutes, note, date, bw, recs);
        }
      });
      sheet.addEventListener('change', e => {
        const inp = e.target.closest('[data-exi]');
        if (!inp) return;
        const [i, f] = inp.dataset.exi.split(':');
        const v = parseFloat(inp.value.replace(',', '.'));
        rows[+i][f] = Number.isFinite(v) && v >= 0 ? Math.min(f === 'kg' ? 1000 : 10000, v) : 0;
        draw();
      });
    },
  });
}
function addExerciseLog(activity, rows, minutes, note, date, bw, recs) {
  const today = todayKey();
  const before = levelInfo(totalXp());
  const statsBefore = computeStats(state.logs, today).values;
  const ex = rows.map(r => {
    const c = exCalc(r.ex, r, bw, recs.has(r.ex.id) ? recs.get(r.ex.id) : null);
    return { id: r.ex.id, nom: r.ex.nom, type: r.ex.type, coef: r.ex.coef, reps: Math.round(r.reps || 0), sets: Math.round(r.sets || 1), kg: r.kg || 0, min: Math.round(r.min || 0), xp: c.xp, tier: c.tier, rec: c.rec, pts: c.pts };
  });
  const j = judgeNote(note);
  let xp = ex.length ? ex.reduce((s, e) => s + e.xp, 0) + Math.round((minutes || 0) * REGLAGES_SPORT.xpParMinute) : entryXp(minutes, activity.difficulty);
  xp = Math.max(1, Math.round(xp * j.mult));
  const tier = ex.reduce((t, e) => (TIER_RANK[e.tier] > TIER_RANK[t] ? e.tier : t), 'normal');
  const pts = ex.length ? ex.reduce((s, e) => s + Math.min(4, e.pts / 100), 0) + (minutes || 0) / RULES.minutesPerPoint : null;
  const log = {
    id: uid(), date, ts: Date.now(), activityId: activity.id, name: ex.length === 1 ? `Sport · ${ex[0].nom}` : ex.length ? 'Séance de sport' : activity.name, icon: activity.icon,
    minutes: minutes || null, note: note.slice(0, 280), stats: [...activity.stats], difficulty: activity.difficulty, xp, quality: j.mult, verdict: j.verdict,
    ex: ex.map(({ pts: _p, ...e }) => e), tier,
  };
  if (pts != null) log.pts = Math.min(50, pts);
  ui.lastLogId = log.id;
  const qBefore = dailyQuest(date);
  const pg0 = qBefore.goals.find(g => g.key === 'pushups');
  snapshotForAnim();
  state.logs.push(log);
  save();
  const qAfter = dailyQuest(date);
  const pg1 = qAfter.goals.find(g => g.key === 'pushups');
  ui.justDone = date !== todayView() ? [] : qAfter.goals.filter(g => g.done && !(qBefore.goals.find(x => x.key === g.key) || {}).done).map(g => g.key);
  render();
  ui.justDone = [];
  const statsAfter = computeStats(state.logs, today).values;
  const gains = STAT_KEYS.map(k => ({ k, d: statsAfter[k] - statsBefore[k] })).filter(g => g.d >= 0.01).map(g => `${statByKey[g.k].name} +${g.d.toFixed(2).replace('.', ',')}`);
  const recsTxt = ex.filter(e => e.rec).map(e => `🏆 Record : ${e.nom}`);
  const capped = dayPosXp(date) > REGLAGES_RANGS.xpMaxParJour;
  const lines = [...recsTxt, ...(j.verdict ? ['Jugement du Système : ' + j.verdict] : []), ...(capped ? [`Plafond du jour atteint (${REGLAGES_RANGS.xpMaxParJour} XP) : le reste ne compte pas pour le niveau.`] : [])];
  let anim;
  if (tier === 'legendaire') {
    sfx('legend'); haptic(3);
    anim = celebrate({ kind: 'legend', title: 'EXPLOIT LÉGENDAIRE', icon: '👑', big: `+${xp} XP`, count: xp, sub: exDetail(log), chips: gains, lines });
  } else if (tier === 'fort') {
    sfx('fort'); haptic(2);
    anim = flyXp(ui.tapRect, xp).then(() => celebrate({ kind: 'win', title: 'SÉANCE PUISSANTE', icon: '🔥', big: `+${xp} XP`, count: xp, sub: exDetail(log), chips: gains, lines }));
  } else {
    sfx('success'); haptic();
    anim = flyXp(ui.tapRect, xp).then(() => toast(`Séance validée · +${xp} XP`, lines[0] || exDetail(log)));
  }
  anim.then(() => questCompletedCheck(qBefore.done, date)).then(() => {
    if (pg0 && pg1 && pg0.cur < 1000 && pg1.cur >= 1000) openPushupPage(date);
    const lvNow = levelInfo(totalXp());
    if (lvNow.level > before.level) { const rb = rankFor(before.level), ra = rankFor(lvNow.level); showLevelUp(lvNow.level, ra.letter !== rb.letter ? ra : null); }
  });
}

/* =========================================================
   MALBOUFFE : enseigne → produit → extras, calories, dessin animé
   ========================================================= */
const JUNK_ART = {
  burger: `<svg viewBox="0 0 48 48"><path d="M6 20 C6 8 42 8 42 20 Z" fill="#f2a53a" stroke="#7a3d0a" stroke-width="1.5"/><circle cx="16" cy="14" r="1" fill="#fff6d6"/><circle cx="24" cy="12" r="1" fill="#fff6d6"/><circle cx="31" cy="15" r="1" fill="#fff6d6"/><path d="M5 21 Q12 26 18 21 Q24 26 30 21 Q36 26 43 21 L43 24 L5 24 Z" fill="#5fd35a"/><rect x="5" y="24" width="38" height="6" rx="3" fill="#7a3d1a"/><path d="M6 30 L42 30 L38 34 L10 34 Z" fill="#ffd23f"/><path d="M6 35 L42 35 C42 41 6 41 6 35 Z" fill="#e8962e" stroke="#7a3d0a" stroke-width="1.5"/></svg>`,
  frites: `<svg viewBox="0 0 48 48"><g fill="#ffd23f" stroke="#b07a00" stroke-width="1"><rect x="14" y="6" width="4" height="22" rx="1"/><rect x="19" y="3" width="4" height="25" rx="1"/><rect x="24" y="5" width="4" height="23" rx="1"/><rect x="29" y="8" width="4" height="20" rx="1"/><rect x="34" y="10" width="3.5" height="18" rx="1"/></g><path d="M10 20 L38 20 L35 44 L13 44 Z" fill="#e4002b" stroke="#7a0016" stroke-width="1.5"/><path d="M18 30 Q24 36 30 30" stroke="#ffd23f" stroke-width="2.5" fill="none"/></svg>`,
  boisson: `<svg viewBox="0 0 48 48"><path d="M27 2 L31 2 L28 12" stroke="#fff" stroke-width="2" fill="none"/><path d="M12 12 L36 12 L32 45 L16 45 Z" fill="#e4002b" stroke="#7a0016" stroke-width="1.5"/><rect x="10" y="9" width="28" height="5" rx="2" fill="#f4f4f4"/><path d="M15 24 Q24 30 34 22" stroke="#fff" stroke-width="2" fill="none"/></svg>`,
  nuggets: `<svg viewBox="0 0 48 48"><path d="M6 26 L42 26 L38 44 L10 44 Z" fill="#ffc72c" stroke="#9a6a00" stroke-width="1.5"/><g fill="#e6a03c" stroke="#8a4f0a" stroke-width="1.3"><ellipse cx="15" cy="22" rx="7" ry="5.5"/><ellipse cx="28" cy="19" rx="8" ry="6"/><ellipse cx="37" cy="24" rx="6" ry="5"/></g></svg>`,
  kebab: `<svg viewBox="0 0 48 48"><path d="M8 40 L24 4 L40 40 Z" fill="#f3d7a1" stroke="#9a6a2a" stroke-width="1.5"/><path d="M14 30 L24 10 L34 30 Z" fill="#9a4f1f"/><path d="M13 32 Q24 26 35 32" stroke="#5fd35a" stroke-width="3" fill="none"/><path d="M15 36 Q24 31 33 36" stroke="#e8402e" stroke-width="2.5" fill="none"/><path d="M14 40 Q24 36 34 40" stroke="#fff" stroke-width="2" fill="none"/></svg>`,
  wrap: `<svg viewBox="0 0 48 48"><rect x="6" y="14" width="36" height="22" rx="11" fill="#f3d7a1" stroke="#9a6a2a" stroke-width="1.5"/><path d="M36 16 C46 20 46 30 36 34" fill="#9a4f1f"/><path d="M38 20 Q42 25 38 30" stroke="#5fd35a" stroke-width="2.5" fill="none"/><path d="M12 25 L30 25" stroke="#d6b27a" stroke-width="1.5"/></svg>`,
  pizza: `<svg viewBox="0 0 48 48"><path d="M24 44 L4 8 Q24 0 44 8 Z" fill="#ffcf5a" stroke="#a0640a" stroke-width="1.5"/><path d="M6 10 Q24 3 42 10" stroke="#d9822b" stroke-width="4" fill="none"/><g fill="#d62f2f"><circle cx="18" cy="16" r="3.5"/><circle cx="29" cy="15" r="3.5"/><circle cx="24" cy="27" r="3.5"/></g></svg>`,
  sauce: `<svg viewBox="0 0 48 48"><rect x="10" y="14" width="28" height="24" rx="4" fill="#f4f4f4" stroke="#999" stroke-width="1.5"/><path d="M12 18 L36 18 L36 24 Q24 30 12 24 Z" fill="#e8402e"/></svg>`,
  dessert: `<svg viewBox="0 0 48 48"><path d="M12 22 L36 22 L32 44 L16 44 Z" fill="#f4f4f4" stroke="#999" stroke-width="1.5"/><path d="M10 22 C10 8 38 8 38 22 Z" fill="#fff7e6" stroke="#c9a46a" stroke-width="1.5"/><path d="M14 16 Q24 22 34 14" stroke="#7a3d1a" stroke-width="3" fill="none"/><circle cx="24" cy="7" r="3" fill="#e4002b"/></svg>`,
};
const junkArt = d => `<span class="jart j-${esc(d)}">${JUNK_ART[d] || JUNK_ART.burger}</span>`;
function junkProducts(e) {
  const mine = state.customJunk.filter(x => x.e === e).map(x => ({ e, nom: x.nom, kcal: x.kcal, dessin: 'burger', src: 'mon produit', mine: x.id }));
  return MALBOUFFE_PRODUITS.filter(p => p.e === e && !mine.some(m => normTxt(m.nom) === normTxt(p.nom))).concat(mine);
}
function openJunkSheet(activity) {
  let en = 'mcdo';
  const picks = new Map();   // "e|nom" → { p, q }
  const extras = new Map();  // extra id → index de taille
  let addMeal = true, form = false;
  const ens = id => MALBOUFFE_ENSEIGNES.find(x => x.id === id) || MALBOUFFE_ENSEIGNES[MALBOUFFE_ENSEIGNES.length - 1];
  const items = () => [...[...picks.values()].map(x => ({ nom: x.p.nom, kcal: x.p.kcal, q: x.q, dessin: x.p.dessin, src: x.p.src, e: x.p.e })),
    ...[...extras.entries()].map(([id, i]) => { const x = MALBOUFFE_EXTRAS.find(y => y.id === id); const t = x.tailles[i]; return { nom: `${x.nom}${x.tailles.length > 1 ? ' ' + t.t.toLowerCase() : ''}`, kcal: t.kcal, q: 1, dessin: x.dessin, src: t.src }; })];
  openSheet({
    tag: '[SYSTÈME] Malbouffe',
    title: `${activity.icon} Qu'as-tu mangé ?`,
    cls: 'junk-sheet',
    body: `${sheetDayHtml()}
      <div class="j-ens" id="j-ens"></div>
      <div id="j-prods"></div>
      <div class="field" style="margin-top:12px"><span>Extras (touche la taille)</span></div>
      <div id="j-extras"></div>
      <div id="j-form"></div>
      <div id="j-stage"></div>
      <label class="j-meal"><input type="checkbox" id="j-addmeal" checked> Ajouter aussi les calories à mes repas</label>
      <p class="small faint">✓ officiel = infos nutritionnelles de l'enseigne (sites France) · ≈ estimation = pas de valeur officielle trouvée. Les valeurs sont dans le fichier de réglages, et tu peux ajouter tes produits.</p>
      <div class="fs-foot"><div id="j-total"></div><button type="button" class="btn danger block fs-add" data-jsave="1">Valider (le Système retire de l'XP)</button></div>`,
    onMount(sheet, close) {
      const draw = () => {
        $('#j-ens', sheet).innerHTML = MALBOUFFE_ENSEIGNES.map(x => `<button type="button" class="j-en ${x.id === en ? 'on' : ''}" style="--bc:${x.couleur}" data-jen="${x.id}">${esc(x.nom)}</button>`).join('');
        $('#j-prods', sheet).innerHTML = `<div class="j-grid">${junkProducts(en).map((p, i) => { const k = p.e + '|' + p.nom, q = picks.has(k) ? picks.get(k).q : 0; return `
          <button type="button" class="jtile ${q ? 'on' : ''}" data-jp="${i}">${junkArt(p.dessin)}<b>${esc(p.nom)}</b><small>${fmtNum(p.kcal)} kcal</small><em class="${!/estimation/.test(p.src) && !p.mine ? 'off' : ''}">${/estimation/.test(p.src) ? '≈ estimation' : p.mine ? '⭐ mon produit' : /calculé/.test(p.src) ? '✓ calculé' : '✓ officiel'}</em>${q ? `<span class="jq">×${q}</span><span class="jm" data-jm="${i}">−</span>` : ''}</button>`; }).join('')}
          <button type="button" class="jtile add" data-jform="1"><span class="jart">＋</span><b>Mon produit</b><small>nom + kcal</small></button></div>`;
        $('#j-extras', sheet).innerHTML = MALBOUFFE_EXTRAS.map(x => `<div class="j-ex">${junkArt(x.dessin)}<b>${esc(x.nom)}</b><div class="j-sizes">${x.tailles.map((t, i) => `<button type="button" class="fchip ${extras.get(x.id) === i ? 'on' : ''}" data-jx="${x.id}:${i}">${esc(t.t)}<small>${t.kcal} kcal</small></button>`).join('')}</div></div>`).join('');
        const its = items(), kcal = its.reduce((s, x) => s + x.kcal * x.q, 0), loss = Math.round(kcal / REGLAGES_MAL.malbouffeKcalParXp);
        const firstEn = [...picks.values()][0];
        $('#j-stage', sheet).innerHTML = its.length ? `<div class="j-stage"><div class="j-en-name">${esc(ens(firstEn ? firstEn.p.e : en).nom)}</div><div class="j-prod-name">${esc(its.map(x => (x.q > 1 ? x.q + '× ' : '') + x.nom).join(' + '))}</div><div class="j-arts">${its.slice(0, 6).map((x, i) => `<span style="--i:${i}">${junkArt(x.dessin)}</span>`).join('')}</div></div>` : '';
        $('#j-total', sheet).innerHTML = its.length ? `<div class="ftot"><b>${fmtNum(kcal)} kcal</b><span class="trend-down">−${fmtNum(loss)} XP</span></div>` : '<div class="ftodo">Choisis l’enseigne puis ce que tu as mangé.</div>';
      };
      draw();
      $('#j-addmeal', sheet).addEventListener('change', e => { addMeal = e.target.checked; });
      sheet.addEventListener('click', e => {
        if (sheetDayClick(sheet, e)) return;
        const t = e.target;
        const eb = t.closest('[data-jen]'); if (eb) { en = eb.dataset.jen; haptic(); draw(); return; }
        const jm = t.closest('[data-jm]');
        if (jm) { e.stopPropagation(); const p = junkProducts(en)[+jm.dataset.jm], k = p.e + '|' + p.nom; const x = picks.get(k); if (x) { x.q--; if (x.q <= 0) picks.delete(k); } haptic(); draw(); return; }
        const jp = t.closest('[data-jp]');
        if (jp) { const p = junkProducts(en)[+jp.dataset.jp], k = p.e + '|' + p.nom; const x = picks.get(k) || { p, q: 0 }; x.q = Math.min(20, x.q + 1); picks.set(k, x); sfx('tap'); haptic(); draw(); return; }
        const jx = t.closest('[data-jx]');
        if (jx) { const [id, i] = jx.dataset.jx.split(':'); if (extras.get(id) === +i) extras.delete(id); else extras.set(id, +i); haptic(); draw(); return; }
        if (t.closest('[data-jform]')) {
          form = !form;
          $('#j-form', sheet).innerHTML = form ? `<div class="food-form"><div class="ff-title">[SYSTÈME] Mon produit · ${esc(ens(en).nom)}</div>
            <div class="ff-grid"><label><span>Nom</span><input class="input" id="jf-nom" maxlength="50"></label><label><span>Calories (kcal)</span><input class="input" id="jf-kcal" inputmode="numeric"></label></div>
            <button type="button" class="btn primary block" data-jfok="1">✓ Ajouter</button><p class="small faint" style="margin:6px 0 0">Même nom qu'un produit de la liste = tu remplaces sa valeur.</p></div>` : '';
          return;
        }
        if (t.closest('[data-jfok]')) {
          const nom = $('#jf-nom', sheet).value.trim(), kcal = parseInt($('#jf-kcal', sheet).value, 10);
          if (!nom || !(kcal > 0 && kcal <= 5000)) { toast('Produit incomplet', 'Écris le nom et les calories.', 'warn'); return; }
          state.customJunk.filter(x => x.e === en && normTxt(x.nom) === normTxt(nom)).forEach(x => tomb(x.id));
          state.customJunk = state.customJunk.filter(x => !(x.e === en && normTxt(x.nom) === normTxt(nom))).concat({ id: uid(), e: en, nom: nom.slice(0, 50), kcal, ts: Date.now(), u: Date.now() });
          save(); form = false; $('#j-form', sheet).innerHTML = '';
          toast('Produit ajouté', `${nom} · ${kcal} kcal`); draw(); return;
        }
        if (t.closest('[data-jsave]')) {
          const its = items();
          if (!its.length) { toast('Rien à valider', 'Touche ce que tu as mangé.', 'warn'); return; }
          const kcal = its.reduce((s, x) => s + x.kcal * x.q, 0);
          const firstP = [...picks.values()][0];
          const enO = ens(firstP ? firstP.p.e : en);
          const main = firstP ? firstP.p : null;
          const date = sheetDay(sheet);
          const extra = {
            kind: 'food', name: `${enO.nom} · ${main ? main.nom : its[0].nom}${its.length > 1 ? ' +' + (its.length - 1) : ''}`.slice(0, 60),
            xp: -Math.max(1, Math.round(kcal / REGLAGES_MAL.malbouffeKcalParXp)), pts: Math.min(20, kcal / 500),
            junk: { e: enO.id, en: enO.nom, dessin: main ? main.dessin : its[0].dessin, kcal, items: its.map(x => ({ nom: x.nom, kcal: x.kcal, q: x.q, dessin: x.dessin })) },
          };
          if (addMeal) {
            const meal = date === todayKey() ? guessMeal() : 'midi';
            its.forEach((x, k) => {
              const kc = x.kcal * x.q, cl = x.dessin === 'boisson' && (x.nom.match(/(\d+)\s*cl/) || [])[1];
              const drink = x.dessin === 'boisson';
              state.meals.push({ id: uid(), date, meal, ts: Date.now() + k, name: `${enO.nom} · ${x.q > 1 ? x.q + '× ' : ''}${x.nom}`.slice(0, 120), grams: cl ? cl * 10 * x.q : 0, kcal: kc,
                p: drink ? 0 : Math.round((kc * 0.15) / 4), g: drink ? Math.round(kc / 4) : Math.round((kc * 0.45) / 4), l: drink ? 0 : Math.round((kc * 0.4) / 9), src: 'fastfood', ...(drink ? { liq: true } : {}) });
            });
          }
          close(null);
          addBadLog(activity, null, '', date, extra);
        }
      });
    },
  });
}

/* =========================================================
   SE COUCHER TARD : heure de coucher conseillée = lever − 8 h
   ========================================================= */
function sleepCalc(bed, wake, habit) {
  const rec = hmToMin(habit) - REGLAGES_MAL.sommeilHeures * 60;
  const noon = m => (((m - 720) % 1440) + 1440) % 1440; // minutes depuis midi (gère minuit)
  const delay = noon(hmToMin(bed)) - noon(rec);
  let dur = (hmToMin(wake) - hmToMin(bed) + 1440) % 1440;
  if (!dur) dur = 1440;
  const d = delay - REGLAGES_MAL.sommeilToleranceMin;
  const loss = d > 0 ? Math.min(250, Math.round(0.4 * d + 15 * Math.pow(d / 60, 2))) : 0;
  return { rec: minToHm(rec), delay, dur, loss, pts: d > 0 ? Math.min(10, d / 60) : 0 };
}
function openSleepSheet(activity) {
  const habit = state.body.wakeTime || '07:30';
  const h = new Date().getHours();
  openSheet({
    tag: '[SYSTÈME] Sommeil',
    title: `${activity.icon} Couché tard ?`,
    body: `${sheetDayHtml(h < 15)}
      <div class="sleep-info">😴 Un adulte a besoin d'environ <b>7 à 9 h de sommeil</b>. « Tard » = après l'heure conseillée : ton lever habituel − 8 h.</div>
      <div class="ff-grid">
        <label><span>Lever habituel</span><input class="input" type="time" id="sl-habit" value="${habit}"></label>
        <label><span>Coucher conseillé</span><input class="input" id="sl-rec" disabled></label>
        <label><span>Je me suis couché à</span><input class="input" type="time" id="sl-bed" value="00:30"></label>
        <label><span>Je me suis levé à</span><input class="input" type="time" id="sl-wake" value="${habit}"></label>
      </div>
      <div id="sl-res"></div>
      <div class="fs-foot"><button type="button" class="btn danger block fs-add" data-slsave="1">Valider</button></div>`,
    onMount(sheet, close) {
      const upd = () => {
        const c = sleepCalc($('#sl-bed', sheet).value, $('#sl-wake', sheet).value, $('#sl-habit', sheet).value);
        $('#sl-rec', sheet).value = c.rec.replace(':', ' h ');
        $('#sl-res', sheet).innerHTML = `<div class="sleep-res ${c.loss ? 'bad' : 'ok'}">
          <div><span>Sommeil</span><b>${fmtMinutes(c.dur)}</b><small>${c.dur < 420 ? 'moins de 7 h' : c.dur > 540 ? 'plus de 9 h' : 'dans les 7-9 h'}</small></div>
          <div><span>Retard</span><b>${c.delay > 0 ? fmtMinutes(c.delay) : 'aucun'}</b><small>tolérance ${REGLAGES_MAL.sommeilToleranceMin} min</small></div>
          <div><span>Perte</span><b>${c.loss ? '−' + c.loss + ' XP' : '0 XP'}</b><small>${c.loss ? 'de plus en plus fort' : 'à l’heure ✓'}</small></div></div>`;
      };
      upd();
      sheet.addEventListener('input', upd);
      $('#sl-habit', sheet).addEventListener('change', e => { if (/^\d{2}:\d{2}$/.test(e.target.value)) { state.body.wakeTime = e.target.value; touchSettings(); save(); } });
      sheet.addEventListener('click', e => {
        if (sheetDayClick(sheet, e)) return;
        if (!e.target.closest('[data-slsave]')) return;
        const bed = $('#sl-bed', sheet).value, wake = $('#sl-wake', sheet).value;
        if (!bed || !wake) { toast('Heures manquantes', 'Indique l’heure de coucher et de lever.', 'warn'); return; }
        const c = sleepCalc(bed, wake, $('#sl-habit', sheet).value);
        const date = sheetDay(sheet);
        close(null);
        addBadLog(activity, null, '', date, { kind: 'sleep', xp: -c.loss, pts: c.pts, sleep: { bed, wake, dur: c.dur, delay: c.delay } });
      });
    },
  });
}

/* =========================================================
   ALCOOL : au nombre de verres
   ========================================================= */
const alcoholLoss = n => { let s = 0; for (let i = 0; i < n; i++) s += REGLAGES_MAL.alcoolXpParVerre + REGLAGES_MAL.alcoolXpEnPlus * i; return s; };
function openAlcoholSheet(activity) {
  let n = 1;
  openSheet({
    tag: '[SYSTÈME] Alcool',
    title: `${activity.icon} Combien de verres ?`,
    body: `${sheetDayHtml(new Date().getHours() < 15)}
      <div class="alc-box"><button type="button" class="fq-btn" data-alc="-1">−</button><div class="alc-n"><b id="alc-n">1</b><span>verre</span></div><button type="button" class="fq-btn" data-alc="1">+</button></div>
      <div class="alc-glasses" id="alc-g"></div>
      <div class="ftot" id="alc-loss"></div>
      <div class="fs-foot"><button type="button" class="btn danger block fs-add" data-alcsave="1">Valider</button></div>`,
    onMount(sheet, close) {
      const upd = () => {
        $('#alc-n', sheet).textContent = n;
        $('#alc-n', sheet).nextElementSibling.textContent = n > 1 ? 'verres' : 'verre';
        $('#alc-g', sheet).innerHTML = Array.from({ length: Math.min(n, 15) }, (_, i) => `<span style="--i:${i}">🍺</span>`).join('');
        $('#alc-loss', sheet).innerHTML = `<b class="trend-down">−${alcoholLoss(n)} XP</b><span>chaque verre coûte un peu plus que le précédent</span>`;
      };
      upd();
      sheet.addEventListener('click', e => {
        if (sheetDayClick(sheet, e)) return;
        const b = e.target.closest('[data-alc]');
        if (b) { n = Math.max(1, Math.min(30, n + +b.dataset.alc)); haptic(); upd(); return; }
        if (!e.target.closest('[data-alcsave]')) return;
        const date = sheetDay(sheet);
        close(null);
        addBadLog(activity, null, '', date, { kind: 'alcohol', xp: -alcoholLoss(n), pts: Math.min(15, n * 0.5), glasses: n });
      });
    },
  });
}

/* ---------- Démarrage : palier, couleur ---------- */
function initSurpass() {
  applyTier();
  setProgTheme();
}

/* =========================================================
   Événements (un seul écouteur pour toute l'app)
   ========================================================= */
document.addEventListener('click', e => {
  const t = e.target;
  const tab = t.closest('.tab');
  if (tab) { if (tab.dataset.tab === 'today' && currentTab === 'today') ui.todayDay = null; return go(tab.dataset.tab); }
  if (t.closest('#day0-btn')) {
    ui.day0 = !ui.day0;
    ui.holoRank = null;
    if (currentTab !== 'home') go('home'); else { render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    $('#day0-btn').classList.toggle('on', ui.day0);
    if (ui.day0) toast('Archive du jour 0', fmtDayLong(state.startDate));
    return;
  }

  const goBtn = t.closest('[data-go]');
  if (goBtn) return go(goBtn.dataset.go);

  const act = t.closest('[data-log-activity]');
  if (act) {
    ui.tapRect = act.getBoundingClientRect();
    sfx('tap'); haptic();
    const a = state.activities.find(x => x.id === act.dataset.logActivity);
    if (a && a.id === 'sport') openExerciseSheet(a);
    else if (a) openLogSheet(a);
    return;
  }
  const repBtn = t.closest('#view [data-reps]');
  if (repBtn && !repBtn.disabled) {
    const today = todayView();
    const qWas = dailyQuest(today);
    const wasDone = (qWas.goals.find(g => g.key === 'pushups') || {}).done;
    if (repBtn.dataset.reps === 'undo') {
      const last = state.reps.filter(r => r.date === today).sort((a, b) => b.ts - a.ts)[0];
      if (!last) return;
      tomb(last.id);
      state.reps = state.reps.filter(r => r.id !== last.id);
      sfx('tap');
    } else {
      state.reps.push({ id: uid(), date: today, ts: Date.now(), n: +repBtn.dataset.reps });
      haptic();
    }
    save();
    const q = dailyQuest(today);
    const pg0 = qWas.goals.find(g => g.key === 'pushups'), pg1 = q.goals.find(g => g.key === 'pushups');
    if (pg0 && pg1 && repBtn.dataset.reps !== 'undo') questSound(goalRatio(pg0), goalRatio(pg1));
    const hit1000 = pg0 && pg1 && pg0.cur < 1000 && pg1.cur >= 1000;
    if (hit1000) setTimeout(() => openPushupPage(today), 900);
    else if (pg0 && pg1 && [600, 700, 800].some(n => pg0.cur < n && pg1.cur >= n)) toast(pg1.cur >= 800 ? 'Bras légendaire' : pg1.cur >= 700 ? 'Nouveau bras débloqué' : 'Bras d’alien débloqué', `${pg1.cur} pompes : ton bras évolue.`);
    applyTier();
    const nowDone = (q.goals.find(g => g.key === 'pushups') || {}).done;
    if (q.done && !qWas.done) { snapshotForAnim(); ui.justDone = ['pushups']; render(); ui.justDone = []; questCompletedCheck(false, today); return; }
    // mise à jour de la seule fenêtre de quête (pas de ré-animation de tout l'écran)
    const wrap = document.createElement('div');
    ui.justDone = !wasDone && nowDone ? ['pushups'] : [];
    wrap.innerHTML = renderQuestWindow(todayKey(), today);
    ui.justDone = [];
    const nu = wrap.querySelector('.quest-win'), old = $('#view .quest-win');
    if (nu && old) { nu.classList.add('no-open'); old.replaceWith(nu); }
    if (!wasDone && nowDone) { haptic(2); toast('Pompes terminées', `${q.goals.find(g => g.key === 'pushups').cur} pompes ${today < todayKey() ? 'le ' + fmtDayShort(today) : "aujourd'hui"}. Objectif atteint.`); }
    return;
  }
  const dcx = t.closest('#view [data-del-cex], #view [data-del-cjunk]');
  if (dcx) {
    const isEx = !!dcx.dataset.delCex, id = dcx.dataset.delCex || dcx.dataset.delCjunk;
    confirmBox('Supprimer ?', 'Il ne sera plus proposé. Ce qui est déjà noté ne change pas.', 'Supprimer', true).then(ok => {
      if (!ok) return;
      tomb(id);
      if (isEx) state.customExercises = state.customExercises.filter(x => x.id !== id); else state.customJunk = state.customJunk.filter(x => x.id !== id);
      save(); render();
    });
    return;
  }
  const dcf = t.closest('#view [data-del-cfood]');
  if (dcf) {
    const f = state.customFoods.find(x => x.id === dcf.dataset.delCfood);
    if (f) confirmBox('Supprimer cet aliment ?', `⭐ ${esc(f.name)} ne sera plus proposé. Les repas déjà notés ne changent pas.`, 'Supprimer', true).then(ok => { if (ok) { tomb(f.id); state.customFoods = state.customFoods.filter(x => x.id !== f.id); save(); render(); } });
    return;
  }
  const lb = t.closest('[data-log-bad]');
  if (lb) {
    const a = state.badActivities.find(x => x.id === lb.dataset.logBad);
    ui.tapRect = lb.getBoundingClientRect();
    sfx('tap'); haptic();
    if (a) { const k = badKind(a); if (k === 'food') openJunkSheet(a); else if (k === 'sleep') openSleepSheet(a); else if (k === 'alcohol') openAlcoholSheet(a); else openLogSheet(a, true); }
    return;
  }
  if (t.closest('#view [data-new-bad]')) return openActivityEditor(null, true);
  const eb = t.closest('[data-edit-bad]');
  if (eb) return openActivityEditor(state.badActivities.find(x => x.id === eb.dataset.editBad), true);
  if (t.closest('#view [data-new-activity]')) return openActivityEditor(null);
  const ed = t.closest('[data-edit-activity]');
  if (ed) return openActivityEditor(state.activities.find(x => x.id === ed.dataset.editActivity));

  const del = t.closest('#view [data-del-log]');
  if (del) return deleteLog(del.dataset.delLog);

  const day = t.closest('[data-day-pick]');
  if (day) { ui.selectedDay = day.dataset.dayPick; return render(); }

  const cal = t.closest('[data-cal]');
  if (cal && !cal.disabled) {
    const [y, m] = ui.calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(cal.dataset.cal), 1);
    ui.calMonth = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    return render();
  }

  const tdn = t.closest('#view [data-today-day]');
  if (tdn && !tdn.disabled) {
    const step = +tdn.dataset.todayDay;
    const next = step === 0 ? null : addDays(todayView(), step);
    ui.todayDay = next && next < todayKey() ? next : null;
    sfx('tap'); haptic(); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const tdg = t.closest('[data-today-goto]');
  if (tdg) { ui.todayDay = tdg.dataset.todayGoto; sfx('tap'); haptic(); if (currentTab !== 'today') go('today'); else { render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } return; }
  const mfor = t.closest('#view [data-meals-for]');
  if (mfor) { const d = mfor.dataset.mealsFor; ui.mealDay = d < todayKey() ? d : null; return go('meals'); }
  const md = t.closest('#view [data-meal-day]');
  if (md && !md.disabled) { ui.mealDay = addDays(ui.mealDay || todayKey(), +md.dataset.mealDay); if (ui.mealDay >= todayKey()) ui.mealDay = null; return render(); }
  const af = t.closest('#view [data-add-food]');
  if (af) { loadCiqual().catch(() => {}); return openFoodSheet(af.dataset.addFood); }
  const mp = t.closest('#view [data-meal-photo]');
  if (mp) { photoTarget = { kind: 'meal', meal: mp.dataset.mealPhoto, date: ui.mealDay || todayKey() }; return $('#photo-file').click(); }
  const dfo = t.closest('#view [data-del-food]');
  if (dfo) return deleteFood(dfo.dataset.delFood);
  const vph = t.closest('#view [data-photo]');
  if (vph) return openPhotoViewer(vph.dataset.photo);

  const hm = t.closest('#view [data-holo-mode]');
  if (hm) { ui.holoMode = 'now'; ui.holoRank = null; ui.day0 = false; return render(); }
  const rp = t.closest('#view [data-rank-preview]');
  if (rp) {
    ui.holoRank = ui.holoRank === rp.dataset.rankPreview && !rp.closest('.holo-mode') ? null : rp.dataset.rankPreview;
    ui.day0 = false;
    render();
    const lab = $('#view .lab');
    if (lab && !rp.closest('.holo-mode')) lab.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const ck = t.closest('[data-chart-key]');
  if (ck) { ui.chartKey = ck.dataset.chartKey; render(); return refreshLandscape(); }
  const ctf = t.closest('[data-chart-tf]');
  if (ctf) { ui.chartTf = ctf.dataset.chartTf; render(); return refreshLandscape(); }
  if (t.closest('[data-landscape]')) return openLandscape();
  if (t.closest('[data-landscape-close]')) return closeLandscape();

  const ptf = t.closest('#view [data-prog-tf]');
  if (ptf) {
    ui.progTf = ptf.dataset.progTf;
    const today = todayKey(), st = computeStats(state.logs, today);
    const el = $('#prog');
    if (el) {
      const wrap = document.createElement('div');
      wrap.innerHTML = renderProgression(progressionInfo(today, st), today >= st.start, st).trim();
      const nu = wrap.firstElementChild;
      nu.classList.add('switch');
      el.replaceWith(nu);
      runCountUps(nu);
      sfx('tap'); haptic();
    }
    return;
  }
  if (t.closest('#view [data-bilan="save"]')) return saveBilan();
  if (t.closest('#view [data-goto-bilan]')) { go('today'); return; }
  const sy = t.closest('#view [data-sync]');
  if (sy) {
    const k = sy.dataset.sync;
    if (k === 'now') { window.Sync.now().then(() => toast(window.Sync.status === 'ok' ? 'Synchronisé' : 'Synchronisation impossible', window.Sync.status === 'ok' ? 'Téléphone et ordinateur sont à jour.' : window.Sync.lastError, window.Sync.status === 'ok' ? 'info' : 'warn')); return; }
    if (k === 'off') { confirmBox('Désactiver la synchronisation ?', 'Tes données restent dans cet appareil, elles ne seront simplement plus envoyées ni reçues.', 'Désactiver', true).then(ok => { if (ok) { window.Sync.disable(); render(); } }); return; }
    if (k === 'enable') {
      const tok = ($('#sync-token') || {}).value || '';
      if (!/^(ghp_|github_pat_)[A-Za-z0-9_]{20,}$/.test(tok.trim())) { toast('Jeton invalide', 'Il doit commencer par ghp_ (ou github_pat_).', 'warn'); return; }
      sy.disabled = true; sy.textContent = '⟳ Connexion à GitHub…';
      window.Sync.enable(tok).then(() => { render(); toast('Synchronisation activée', 'Fais pareil sur ton autre appareil avec le même jeton.'); })
        .catch(e => { render(); toast('Activation impossible', e.message, 'warn'); });
      return;
    }
  }
  const action = t.closest('#view [data-action]');
  if (action) {
    const a = action.dataset.action;
    if (a === 'weigh') return openWeighSheet();
    if (a === 'journal') return openJournalSheet();
    if (a === 'day0') { ui.day0 = false; return render(); }
    if (a === 'photos') return openPhotosSheet();
    if (a === 'export') return exportSave();
    if (a === 'import') return $('#import-file').click();
    if (a === 'reset') return resetAll();
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'player-name') {
    state.playerName = e.target.value.trim().slice(0, 40) || 'Charisme';
    touchSettings();
    save();
    toast('Profil mis à jour', state.playerName);
  }
  if (e.target.id === 'start-weight' || e.target.id === 'goal-weight') {
    const kg = Math.round(parseFloat(e.target.value.replace(',', '.')) * 10) / 10;
    const key = e.target.id === 'start-weight' ? 'startWeight' : 'goalWeight';
    if (!Number.isFinite(kg) || kg < 30 || kg > 300) {
      toast('Poids invalide', 'Exemple : 86', 'warn');
      e.target.value = fmtKg(state.body[key]);
      return;
    }
    state.body[key] = kg;
    touchSettings();
    save();
    e.target.value = fmtKg(kg);
    toast('Objectif mis à jour', `${fmtKg(state.body.startWeight)} kg → ${fmtKg(state.body.goalWeight)} kg`);
  }
  if (e.target.dataset && e.target.dataset.pref) {
    prefs[e.target.dataset.pref] = e.target.checked;
    savePrefs();
    if (e.target.checked) { sfx('success'); haptic(); }
    return;
  }
  if (e.target.dataset && e.target.dataset.wake) {
    if (/^\d{2}:\d{2}$/.test(e.target.value)) { state.body.wakeTime = e.target.value; touchSettings(); save(); render(); toast('Heure de lever enregistrée', `Coucher conseillé : ${fmtHm(minToHm(hmToMin(e.target.value) - REGLAGES_MAL.sommeilHeures * 60))}`); }
    return;
  }
  if (e.target.dataset && e.target.dataset.quest) {
    const k = e.target.dataset.quest;
    if (k === 'bilan') state.questCfg.bilan = e.target.checked;
    else {
      const max = { pushups: 2000, sport: 600, focus: 900, meals: 3, waste: 600 }[k];
      const v = Math.round(parseFloat(e.target.value.replace(',', '.')));
      if (!Number.isFinite(v) || v < 0 || v > max) { toast('Valeur invalide', `Entre 0 et ${max}.`, 'warn'); e.target.value = state.questCfg[k]; return; }
      state.questCfg[k] = v;
    }
    touchSettings(); save();
    toast('Quête quotidienne mise à jour');
    return;
  }
  if (e.target.dataset && e.target.dataset.date) {
    const v = e.target.value;
    if (!isValidKey(v)) { toast('Date invalide'); return; }
    if (e.target.dataset.date === 'startDate') state.startDate = v; else state.body.goalDate = v;
    touchSettings();
    save();
    toast('Date enregistrée', fmtDayLong(v));
    render();
    return;
  }
  if (e.target.dataset && e.target.dataset.body) {
    const key = e.target.dataset.body, raw = e.target.value.trim();
    if (!raw && key !== 'fatStart') { state.body[key] = null; touchSettings(); save(); toast('Profil mis à jour'); return; }
    const v = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(v) || v < +e.target.dataset.min || v > +e.target.dataset.max) {
      toast('Valeur invalide', `Entre ${e.target.dataset.min} et ${e.target.dataset.max}.`, 'warn');
      e.target.value = state.body[key] || '';
      return;
    }
    state.body[key] = Math.round(v * 10) / 10;
    touchSettings();
    save();
    toast('Profil mis à jour', key === 'kcalTarget' || key === 'heightCm' || key === 'age' ? `Objectif : ${fmtNum(nutritionTargets().kcal)} kcal/jour` : '');
  }
  if (e.target.id === 'photo-file' && e.target.files && e.target.files.length) {
    addPhotos([...e.target.files]);
    e.target.value = '';
  }
  if (e.target.id === 'import-file' && e.target.files && e.target.files[0]) {
    importSave(e.target.files[0]);
    e.target.value = '';
  }
});

// Si l'app reste ouverte après minuit, on rafraîchit l'affichage au retour
let lastRenderDay = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && todayKey() !== lastRenderDay) {
    lastRenderDay = todayKey();
    ui.selectedDay = null; ui.calMonth = null;
    render();
  }
});

/* =========================================================
   SYNCHRONISATION téléphone ↔ ordinateur ↔ site
   Une copie de la sauvegarde est rangée dans un Gist SECRET de ton compte
   GitHub. Chaque appareil fusionne ses changements avec ceux des autres.
   Le jeton reste dans l'appareil (jamais dans la sauvegarde exportée).
   ========================================================= */
const SYNC_KEY = 'monSysteme.sync';
const GIST_DESC = 'Mon Système — sauvegarde synchronisée (ne pas supprimer)';
const GIST_FILE = 'mon-systeme.json';

/* Fusion de deux sauvegardes : rien ne se perd, les suppressions suivent. */
function mergeStates(a, b, preferB = false) {
  if ((a.replacedAt || 0) !== (b.replacedAt || 0)) {
    // une remise à zéro / un import plus récent remplace tout ce qui est plus ancien
    const newer = (a.replacedAt || 0) > (b.replacedAt || 0) ? a : b;
    const older = newer === a ? b : a;
    const keep = (arr, t) => arr.filter(x => (x.ts || x.u || 0) > newer.replacedAt && !t[x.id]);
    const out = JSON.parse(JSON.stringify(newer));
    // on garde quand même ce que l'autre appareil a ajouté APRÈS la remise à zéro
    for (const k of ['logs', 'meals', 'weights', 'journals', 'bilans', 'reps', 'customFoods', 'customExercises', 'customJunk']) {
      const ids = new Set(out[k].map(x => x.id));
      out[k] = out[k].concat(keep(older[k], out.tombstones).filter(x => !ids.has(x.id)));
    }
    return out;
  }
  const t = { ...a.tombstones };
  for (const [k, v] of Object.entries(b.tombstones || {})) t[k] = Math.max(t[k] || 0, v);
  const stamp = x => x.u || x.ts || 0;
  const union = (x, y) => {
    const m = new Map();
    for (const it of x.concat(y)) {
      if (t[it.id]) continue;
      const cur = m.get(it.id);
      if (!cur || stamp(it) > stamp(cur)) m.set(it.id, it);
    }
    return [...m.values()];
  };
  const oneByDate = arr => {
    const m = new Map();
    for (const it of arr) { const cur = m.get(it.date); if (!cur || stamp(it) >= stamp(cur)) m.set(it.date, it); }
    return [...m.values()];
  };
  const settingsFrom = preferB || (b.settingsAt || 0) > (a.settingsAt || 0) ? b : a;
  return {
    ...a,
    playerName: settingsFrom.playerName,
    startDate: settingsFrom.startDate,
    body: { ...settingsFrom.body },
    questCfg: { ...(settingsFrom.questCfg || a.questCfg) },
    settingsAt: Math.max(a.settingsAt || 0, b.settingsAt || 0),
    replacedAt: a.replacedAt || 0,
    createdAt: [a.createdAt, b.createdAt].filter(Boolean).sort()[0] || a.createdAt,
    lastExportAt: [a.lastExportAt, b.lastExportAt].filter(Boolean).sort().pop() || null,
    seenReports: [...new Set([...(a.seenReports || []), ...(b.seenReports || [])])],
    tombstones: t,
    activities: union(a.activities, b.activities),
    badActivities: union(a.badActivities || [], b.badActivities || []),
    logs: union(a.logs, b.logs).sort((x, y) => x.ts - y.ts),
    meals: union(a.meals, b.meals),
    weights: oneByDate(union(a.weights, b.weights)).sort((x, y) => x.date.localeCompare(y.date)),
    journals: oneByDate(union(a.journals, b.journals)),
    bilans: oneByDate(union(a.bilans || [], b.bilans || [])),
    reps: union(a.reps || [], b.reps || []),
    customFoods: union(a.customFoods || [], b.customFoods || []),
    customExercises: union(a.customExercises || [], b.customExercises || []),
    customJunk: union(a.customJunk || [], b.customJunk || []),
  };
}

window.Sync = (() => {
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}') || {}; } catch (_) { cfg = {}; }
  let timer = null, running = null, status = cfg.token ? 'idle' : 'off', lastError = '';
  const saveCfg = () => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)); } catch (_) {} };
  const setStatus = (st, err = '') => {
    status = st; lastError = err;
    const el = $('#sync-dot');
    if (el) { el.className = 'sync-dot s-' + st; el.title = st === 'error' ? err : st === 'ok' ? 'Synchronisé' : st === 'busy' ? 'Synchronisation…' : ''; }
    if (currentTab === 'settings' && $('#sync-panel')) $('#sync-panel').innerHTML = syncPanelInner();
  };
  const api = async (path, opt = {}) => {
    const r = await fetch('https://api.github.com' + path, {
      ...opt,
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...(opt.headers || {}) },
    });
    if (r.status === 401 || r.status === 403) throw new Error('Jeton GitHub refusé (vérifie qu’il a le droit « gist »).');
    if (!r.ok) throw new Error('GitHub a répondu ' + r.status);
    return r.json();
  };
  const readGist = async id => {
    const g = await api('/gists/' + id);
    const f = g.files && g.files[GIST_FILE];
    if (!f) return null;
    let txt = f.content;
    if (f.truncated && f.raw_url) txt = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
    return txt;
  };
  const findGist = async () => {
    for (let page = 1; page <= 5; page++) {
      const list = await api(`/gists?per_page=100&page=${page}`);
      const g = list.find(x => x.description === GIST_DESC && x.files && x.files[GIST_FILE]);
      if (g) return g.id;
      if (list.length < 100) break;
    }
    return null;
  };
  const payload = () => JSON.stringify({ app: 'mon-systeme', appVersion: APP_VERSION, syncedAt: new Date().toISOString(), data: state });

  async function run() {
    if (!cfg.token) return;
    if (!navigator.onLine) { setStatus('offline'); return; }
    setStatus('busy');
    try {
      if (!cfg.gistId) cfg.gistId = await findGist();
      if (!cfg.gistId) {
        const g = await api('/gists', { method: 'POST', body: JSON.stringify({ description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: payload() } } }) });
        cfg.gistId = g.id;
        cfg.joined = true;
      } else {
        const txt = await readGist(cfg.gistId);
        let remote = null;
        if (txt) { const parsed = JSON.parse(txt); remote = sanitizeState(parsed.data || parsed); }
        const before = JSON.stringify(state);
        if (remote) {
          // un appareil neuf (vide) qui rejoint reprend tout du cloud ; sinon on fusionne
          const fresh = !cfg.joined && !state.logs.length && !state.meals.length && !state.weights.length && !state.journals.length;
          state = sanitizeState(fresh ? remote : mergeStates(state, remote, !cfg.joined));
          cfg.joined = true;
          save(true);
          if (JSON.stringify(state) !== before) render();
        }
        await api('/gists/' + cfg.gistId, { method: 'PATCH', body: JSON.stringify({ files: { [GIST_FILE]: { content: payload() } } }) });
      }
      cfg.lastSync = Date.now();
      saveCfg();
      setStatus('ok');
    } catch (e) {
      console.warn('Synchronisation', e);
      if (/refusé/.test(e.message)) cfg.gistId = cfg.gistId || null;
      setStatus(navigator.onLine ? 'error' : 'offline', e.message || 'Erreur');
    }
  }
  const now = () => { if (!running) running = run().finally(() => { running = null; }); return running; };
  return {
    get enabled() { return !!cfg.token; },
    get status() { return status; },
    get lastError() { return lastError; },
    get lastSync() { return cfg.lastSync || null; },
    now,
    schedule() { if (!cfg.token) return; clearTimeout(timer); timer = setTimeout(now, 2500); },
    async enable(token) {
      cfg = { token: token.trim() };
      saveCfg();
      setStatus('busy');
      await now();
      if (status === 'error') { const err = lastError; cfg = {}; saveCfg(); setStatus('off'); throw new Error(err); }
    },
    disable() { cfg = {}; saveCfg(); setStatus('off'); },
    refreshDot() { setStatus(status, lastError); },
  };
})();

function syncPanelInner() {
  const S = window.Sync;
  if (!S.enabled) return `
    <p class="small muted" style="margin-top:0">Pour retrouver les <b>mêmes données</b> sur ton téléphone, ton ordinateur et le site, active la synchronisation <b>sur chaque appareil</b> avec le même jeton GitHub.</p>
    <ol class="small muted sync-steps">
      <li>Ouvre <a href="https://github.com/settings/tokens/new?scopes=gist&description=Mon%20Syst%C3%A8me" target="_blank" rel="noopener">ce lien GitHub</a> (connecté à ton compte).</li>
      <li>« Expiration » : choisis <b>No expiration</b>. La case <b>gist</b> est déjà cochée.</li>
      <li>Tout en bas : <b>Generate token</b>, puis copie le code qui commence par <b>ghp_</b>.</li>
      <li>Colle-le ici, puis touche <b>Activer</b>. Refais la même chose sur l'autre appareil.</li>
    </ol>
    <input class="input" id="sync-token" type="password" placeholder="ghp_…" autocomplete="off" autocapitalize="off" spellcheck="false">
    <button type="button" class="btn primary block" style="margin-top:10px" data-sync="enable">☁️ Activer la synchronisation</button>
    <p class="small faint" style="margin-bottom:0">Le jeton ne donne accès qu'à tes « gists » et reste dans cet appareil. Ne le partage avec personne. Les photos restent dans chaque appareil (utilise Exporter / Importer pour elles).</p>`;
  const ago = S.lastSync ? Math.round((Date.now() - S.lastSync) / 60000) : null;
  return `
    <div class="sync-state s-${S.status}">
      <b>${S.status === 'ok' ? '✓ Synchronisé' : S.status === 'busy' ? '⟳ Synchronisation…' : S.status === 'offline' ? '⚠ Hors connexion' : S.status === 'error' ? '⚠ Erreur' : '☁️ Activée'}</b>
      <span>${S.status === 'error' ? esc(S.lastError) : ago === null ? '' : ago < 1 ? "Dernière synchro : à l'instant" : `Dernière synchro : il y a ${ago} min`}</span>
    </div>
    <div class="btn-row" style="margin-top:10px">
      <button type="button" class="btn" data-sync="now">⟳ Synchroniser</button>
      <button type="button" class="btn ghost" data-sync="off">Désactiver ici</button>
    </div>
    <p class="small faint" style="margin-bottom:0">Tout se synchronise tout seul : à l'ouverture de l'app et quelques secondes après chaque changement.</p>`;
}

/* =========================================================
   Hors connexion + mises à jour automatiques (service worker)
   ========================================================= */
function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // une nouvelle version vient de s'installer → on recharge une fois
    if (!hadController || refreshing) return;
    refreshing = true;
    sessionStorage.setItem('monSysteme.updated', '1');
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(err => console.warn('Service worker non enregistré', err));
}

/* =========================================================
   Démarrage
   ========================================================= */
function buildParticles() {
  const bg = $('#fx-bg');
  if (!bg || bg.childElementCount) return;
  const n = window.innerWidth < 500 ? 26 : 40;
  let html = '';
  for (let i = 0; i < n; i++) {
    const size = (1.5 + Math.random() * 3).toFixed(1);
    const violet = Math.random() < 0.35;
    html += `<i style="left:${(Math.random() * 100).toFixed(1)}%;width:${size}px;height:${size}px;--d:${(16 + Math.random() * 22).toFixed(1)}s;--delay:-${(Math.random() * 30).toFixed(1)}s;--x:${(Math.random() * 60 - 30).toFixed(0)}px;--c:${violet ? '#a78bff' : '#5fd4ff'}"></i>`;
  }
  bg.innerHTML = html;
}
function scanSweep() {
  const sc = $('#fx-scan');
  if (!sc) return;
  sc.classList.remove('go'); void sc.offsetWidth; sc.classList.add('go');
}

async function start() {
  buildParticles();
  $('#app-version').textContent = APP_VERSION;
  initSurpass();
  if (!localStorage.getItem(STORAGE_KEY)) save();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  render();
  await loadPhotos();
  if (photos.length) render();
  setTimeout(maybeShowMonthReport, 900);
  window.Sync.refreshDot();
  if (window.Sync.enabled) window.Sync.now();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && window.Sync.enabled) window.Sync.now(); });
  window.addEventListener('online', () => { if (window.Sync.enabled) window.Sync.now(); });
  try {
    if (sessionStorage.getItem('monSysteme.updated')) {
      sessionStorage.removeItem('monSysteme.updated');
      toast('Mise à jour installée', `Version ${APP_VERSION}`);
    }
  } catch (_) {}
  setupServiceWorker();
}

start();
