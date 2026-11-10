/* =========================================================
   MON SYSTÈME — application personnelle style "Système"
   Tout est sauvegardé dans le téléphone (localStorage).
   ========================================================= */
'use strict';

/* ⚠️ À chaque mise à jour : augmenter ce numéro ICI, dans sw.js
   et dans index.html (?v=...). Le script tests/check-version.js vérifie. */
const APP_VERSION = '1.3.0';

const STORAGE_KEY = 'monSysteme.save';
const SCHEMA = 1;

/* ---------- Les 5 stats ---------- */
const STATS = [
  { key: 'physique', name: 'Physique', icon: '💪', desc: 'Corps, énergie, endurance' },
  { key: 'concentration', name: 'Concentration', icon: '🎯', desc: 'Rester focus longtemps' },
  { key: 'intelligence', name: 'Intelligence', icon: '🧠', desc: 'Savoir, réflexion, créativité' },
  { key: 'progression', name: 'Progression', icon: '📈', desc: "Capacité à m'améliorer" },
  { key: 'discipline', name: 'Discipline', icon: '⚔️', desc: 'Avancer, être régulier' },
];
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

const DEFAULT_ACTIVITIES = [
  { id: 'live', name: 'Live (Twitch/TikTok)', icon: '🎥', stats: ['concentration', 'discipline'], difficulty: 'normal' },
  { id: 'clips', name: 'Clips / montage', icon: '✂️', stats: ['intelligence', 'progression'], difficulty: 'normal' },
  { id: 'sport', name: 'Sport', icon: '🏋️', stats: ['physique', 'discipline'], difficulty: 'normal' },
  { id: 'travail', name: 'Travail', icon: '💼', stats: ['discipline', 'physique'], difficulty: 'normal' },
  { id: 'lecture', name: 'Apprentissage / lecture', icon: '📚', stats: ['intelligence', 'progression'], difficulty: 'normal' },
];

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
    playerName: 'Chasseur',
    createdAt: new Date().toISOString(),
    lastExportAt: null,
    activities: DEFAULT_ACTIVITIES.map(a => ({ ...a, stats: [...a.stats] })),
    logs: [],
    body: { startWeight: 96.5, goalWeight: 86, heightCm: null, age: null, waistCm: null, neckCm: null, fatStart: 25, kcalTarget: null },
    weights: [],
    meals: [],
  };
}

/* Nettoie / vérifie des données (au chargement et à l'import). */
function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Fichier illisible');
  if (!Array.isArray(raw.activities) || !Array.isArray(raw.logs)) throw new Error('Ce fichier ne ressemble pas à une sauvegarde du Système');
  const s = freshState();
  s.playerName = typeof raw.playerName === 'string' && raw.playerName.trim() ? raw.playerName.trim().slice(0, 40) : 'Chasseur';
  s.createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : s.createdAt;
  s.lastExportAt = typeof raw.lastExportAt === 'string' ? raw.lastExportAt : null;
  s.activities = raw.activities
    .filter(a => a && typeof a.name === 'string')
    .map(a => ({
      id: typeof a.id === 'string' && a.id ? a.id : uid(),
      name: a.name.slice(0, 40),
      icon: typeof a.icon === 'string' && a.icon ? a.icon.slice(0, 8) : '⭐',
      stats: (Array.isArray(a.stats) ? a.stats : []).filter(k => STAT_KEYS.includes(k)),
      difficulty: DIFFICULTIES.some(d => d.key === a.difficulty) ? a.difficulty : 'normal',
    }));
  s.logs = raw.logs
    .filter(l => l && isValidKey(l.date))
    .map(l => ({
      id: typeof l.id === 'string' && l.id ? l.id : uid(),
      date: l.date,
      ts: typeof l.ts === 'number' ? l.ts : parseKey(l.date).getTime(),
      activityId: typeof l.activityId === 'string' ? l.activityId : '',
      name: typeof l.name === 'string' ? l.name.slice(0, 40) : 'Activité',
      icon: typeof l.icon === 'string' ? l.icon.slice(0, 8) : '⭐',
      minutes: Number.isFinite(l.minutes) && l.minutes > 0 ? Math.min(Math.round(l.minutes), 24 * 60) : null,
      note: typeof l.note === 'string' ? l.note.slice(0, 280) : '',
      stats: (Array.isArray(l.stats) ? l.stats : []).filter(k => STAT_KEYS.includes(k)),
      difficulty: DIFFICULTIES.some(d => d.key === l.difficulty) ? l.difficulty : 'normal',
      xp: Number.isFinite(l.xp) && l.xp >= 0 ? Math.round(l.xp) : 0,
    }));
  const okKg = v => Number.isFinite(v) && v >= 30 && v <= 300;
  const inR = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
  if (raw.body && typeof raw.body === 'object') {
    const rb = raw.body;
    if (okKg(rb.startWeight)) s.body.startWeight = rb.startWeight;
    if (okKg(rb.goalWeight)) s.body.goalWeight = rb.goalWeight;
    if (inR(rb.heightCm, 120, 230)) s.body.heightCm = rb.heightCm;
    if (inR(rb.age, 10, 100)) s.body.age = rb.age;
    if (inR(rb.waistCm, 50, 200)) s.body.waistCm = rb.waistCm;
    if (inR(rb.neckCm, 25, 70)) s.body.neckCm = rb.neckCm;
    if (inR(rb.fatStart, 5, 60)) s.body.fatStart = rb.fatStart;
    if (inR(rb.kcalTarget, 1000, 6000)) s.body.kcalTarget = rb.kcalTarget;
  }
  s.weights = (Array.isArray(raw.weights) ? raw.weights : [])
    .filter(w => w && isValidKey(w.date) && okKg(w.kg))
    .map(w => ({
      id: typeof w.id === 'string' && w.id ? w.id : uid(), date: w.date, kg: Math.round(w.kg * 10) / 10,
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

function save() {
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
  const base = log.minutes ? Math.min(log.minutes, RULES.entryMaxMinutes) / RULES.minutesPerPoint : RULES.donePoints;
  return base * diffMult(log.difficulty);
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
function rankFor(level) {
  let r = RANKS[0];
  for (const x of RANKS) if (level >= x.minLevel) r = x;
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
const totalXp = () => state.logs.reduce((s, l) => s + l.xp, 0) + nutritionDays(todayKey()).size * NUTRI_XP;

/* Recalcule les stats en "rejouant" chaque jour depuis la 1re activité.
   Ainsi, supprimer une entrée corrige tout automatiquement. */
function computeStats(logs, today) {
  const values = {}, last = {}, weekAgo = {};
  STAT_KEYS.forEach(k => { values[k] = RULES.statStart; last[k] = null; weekAgo[k] = RULES.statStart; });

  const byDay = new Map();
  let first = today;
  if (!logs.length && !nutritionDays(today).size) return { values, last, weekAgo };
  for (const l of logs) {
    if (l.date > today) continue;
    if (l.date < first) first = l.date;
    const o = byDay.get(l.date) || {};
    const pts = entryPoints(l);
    for (const k of l.stats) o[k] = (o[k] || 0) + pts;
    byDay.set(l.date, o);
  }
  for (const o of byDay.values()) o.discipline = (o.discipline || 0) + RULES.regularityBonus;
  // journée de nutrition validée = 1 point de Discipline
  for (const d of nutritionDays(today)) {
    const o = byDay.get(d) || {};
    o.discipline = (o.discipline || 0) + 1;
    byDay.set(d, o);
    if (d < first) first = d;
  }

  const weekAgoKey = addDays(today, -7);
  let day = first;
  let guard = 0;
  if (weekAgoKey < first) STAT_KEYS.forEach(k => { weekAgo[k] = RULES.statStart; });
  while (day <= today && guard++ < 40000) {
    const o = byDay.get(day);
    for (const k of STAT_KEYS) {
      const pts = o ? (o[k] || 0) : 0;
      if (pts > 0) {
        const eff = 1 - Math.exp(-pts / RULES.daySaturation);
        values[k] = Math.min(100, values[k] + RULES.gainRate * eff * (1 - values[k] / 100));
        last[k] = day;
      } else if (last[k] && daysBetween(last[k], day) > RULES.decayGraceDays) {
        values[k] = Math.max(RULES.statMin, values[k] * (1 - RULES.decayRate));
      }
    }
    if (day === weekAgoKey) STAT_KEYS.forEach(k => { weekAgo[k] = values[k]; });
    day = addDays(day, 1);
  }
  return { values, last, weekAgo };
}

function activeDays() {
  return new Set(state.logs.map(l => l.date));
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
function openSheet({ tag = '[SYSTÈME]', title = '', body = '', buttons = [], center = false, onMount = null }) {
  return new Promise(resolve => {
    const root = $('#modal-root');
    const ov = document.createElement('div');
    ov.className = 'overlay' + (center ? ' center' : '');
    ov.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true">
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

/* =========================================================
   Navigation
   ========================================================= */
const TITLES = { home: 'Statut du joueur', today: 'Quêtes du jour', meals: 'Repas & nutrition', history: 'Journal des quêtes', settings: 'Réglages' };
let currentTab = 'home';
const ui = { calMonth: null, selectedDay: null, holoMode: 'now', photoPose: 'face', mealDay: null };

function go(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === tab));
  $('#topbar-title').textContent = TITLES[tab];
  render();
  window.scrollTo(0, 0);
}

function render() {
  const view = $('#view');
  const fn = { home: renderHome, today: renderToday, meals: renderMeals, history: renderHistory, settings: renderSettings }[currentTab];
  view.innerHTML = fn();
  view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
  if (currentTab === 'home') mountHolo();
}

/* Affiche l'hologramme 3D dans l'Accueil (le module 3D se charge à part) */
function mountHolo() {
  const el = $('#holo');
  if (!el) return;
  const go3d = () => window.Holo && window.Holo.mount(el, { progress: bodyProgress().progress, mode: ui.holoMode });
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
  const { values, last, weekAgo } = computeStats(state.logs, today);
  const st = streakInfo(today);
  const pct = Math.min(100, (lv.into / lv.need) * 100);

  const statsHtml = STATS.map(s => {
    const v = values[s.key];
    const diff = v - weekAgo[s.key];
    const inactive = last[s.key] ? daysBetween(last[s.key], today) : null;
    let foot;
    if (inactive === null) foot = `<span>Pas encore entraînée</span>`;
    else if (inactive > RULES.decayGraceDays) foot = `<span class="decay-warn">⚠ Inactive depuis ${inactive} j · en baisse</span>`;
    else if (inactive === 0) foot = `<span>Entraînée aujourd'hui</span>`;
    else foot = `<span>Dernière fois il y a ${inactive} j</span>`;
    const trend = Math.abs(diff) < 0.05 ? `<span>= sur 7 j</span>`
      : diff > 0 ? `<span class="trend-up">▲ +${fmtStat(diff)} sur 7 j</span>`
      : `<span class="trend-down">▼ ${fmtStat(diff)} sur 7 j</span>`;
    return `
      <div class="stat">
        <div class="stat-row">
          <div class="stat-icon">${s.icon}</div>
          <div class="stat-name">${s.name}<small>${s.desc}</small></div>
          <div class="stat-value">${fmtStat(v)}</div>
          <div class="stat-grade">${gradeFor(v)}</div>
        </div>
        <div class="bar thin"><span style="width:${v}%"></span></div>
        <div class="stat-foot">${foot}${trend}</div>
      </div>`;
  }).join('');

  const daysSinceExport = state.lastExportAt ? daysBetween(dateKey(new Date(state.lastExportAt)), today) : null;
  const needReminder = state.logs.length >= 5 && (daysSinceExport === null || daysSinceExport >= 7);

  return `
    ${renderBodyPanel(today)}

    <section class="panel">
      <div class="profile">
        <div class="rank-badge rank-${rank.letter}">${rank.letter}</div>
        <div class="profile-info">
          <div class="player-name">${esc(state.playerName)}</div>
          <div class="player-meta">${rank.title}</div>
          <div class="level-line"><span class="level-label">NIVEAU</span><span class="level-num">${lv.level}</span></div>
        </div>
      </div>
      <div class="bar xp"><span style="width:${pct}%"></span></div>
      <div class="bar-caption"><span>XP ${fmtNum(lv.into)} / ${fmtNum(lv.need)}</span><span>Total ${fmtNum(xp)}</span></div>
    </section>

    ${renderNutritionCard(today)}

    <section class="panel">
      <div class="streak">
        <div class="streak-flame ${st.current ? '' : 'off'}">🔥</div>
        <div>
          <div class="streak-num">${st.current} jour${st.current > 1 ? 's' : ''}</div>
          <div class="streak-text">${st.current
            ? (st.doneToday ? 'Série active — validée aujourd\'hui ✓' : 'Série en danger : fais une activité aujourd\'hui !')
            : 'Aucune série en cours. Une activité aujourd\'hui la lance.'}
            · Record : ${st.best} j</div>
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
      <div class="panel-head">
        <div class="panel-title">Statistiques</div>
        <div class="panel-sub">sur 100</div>
      </div>
      ${statsHtml}
    </section>

    <section class="panel">
      <div class="kpis">
        <div class="kpi"><b>${st.totalDays}</b><span>jours actifs</span></div>
        <div class="kpi"><b>${state.logs.length}</b><span>quêtes</span></div>
        <div class="kpi"><b>${fmtNum(state.logs.reduce((s, l) => s + (l.minutes || 0), 0) / 60)}</b><span>heures</span></div>
      </div>
    </section>

    <button class="btn primary block" data-go="today">⚔ Enregistrer une quête</button>
  `;
}

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

function renderBodyPanel(today) {
  const b = bodyProgress();
  const pct = Math.round(b.progress * 1000) / 10;
  const monthKey = today.slice(0, 7);
  const photoThisMonth = bodyPhotos().some(p => p.date.slice(0, 7) === monthKey);
  const lastW = state.weights[state.weights.length - 1];
  const sinceW = lastW ? daysBetween(lastW.date, today) : null;
  const goalMode = ui.holoMode === 'goal';
  const done = b.progress >= 1;
  const comp = composition(goalMode ? b.goal : null);
  return `
    <section class="panel lab">
      <div class="lab-head">
        <span class="lab-tag">[SYSTÈME] SCAN CORPOREL</span>
        <span class="lab-live"><i></i>EN DIRECT</span>
      </div>
      <div class="holo-wrap ${goalMode ? 'goal' : ''}">
        <div id="holo" class="holo"><div class="holo-loading">Initialisation du scan…</div></div>
        <span class="hc tl"></span><span class="hc tr"></span><span class="hc bl"></span><span class="hc br"></span>
        <div class="hud hud-left">
          <div><small>${goalMode ? 'CIBLE' : 'POIDS'}</small><b>${fmtKg(goalMode ? b.goal : b.cur)}</b><i>kg</i></div>
          <div><small>DÉPART</small><b>${fmtKg(b.start)}</b><i>kg</i></div>
          <div><small>GRAISSE${comp.src === 'balance' ? '' : ' ≈'}</small><b class="fat">${fmtPct(comp.fat)}</b><i>%</i></div>
        </div>
        <div class="hud hud-right">
          <div><small>PERDU</small><b class="${b.lost > 0 ? 'good' : ''}">${b.lost > 0 ? '−' : ''}${fmtKg(Math.abs(b.lost))}</b><i>kg</i></div>
          <div><small>RESTANT</small><b>${fmtKg(b.left)}</b><i>kg</i></div>
          <div><small>MUSCLES${comp.src === 'balance' && state.weights.some(w => w.muscle != null) ? '' : ' ≈'}</small><b class="muscle">${fmtPct(comp.muscle)}</b><i>%</i></div>
        </div>
        <div class="hud-src">${goalMode ? 'COMPOSITION VISÉE' : comp.src === 'balance' ? 'SOURCE : BALANCE' : comp.src === 'mensurations' ? 'SOURCE : MENSURATIONS' : 'ESTIMATION · PHOTOS'}</div>
        <div class="holo-mode">
          <button type="button" class="${goalMode ? '' : 'on'}" data-holo-mode="now">Maintenant</button>
          <button type="button" class="${goalMode ? 'on' : ''}" data-holo-mode="goal">Objectif ${fmtKg(b.goal)} kg</button>
        </div>
      </div>

      <div class="load ${done ? 'done' : ''}">
        <div class="load-top"><span>${done ? 'TRANSFORMATION TERMINÉE' : 'TRANSFORMATION EN COURS'}</span><b>${String(pct).replace('.', ',')} %</b></div>
        <div class="load-bar"><span style="width:${Math.max(pct, 1.5)}%"></span></div>
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
  const date = todayKey();
  state.weights = state.weights.filter(w => w.date !== date); // une pesée par jour
  state.weights.push({ id: uid(), date, kg, fat, muscle });
  state.weights.sort((a, b) => a.date.localeCompare(b.date));
  save();
  const after = bodyProgress();
  render();
  const prev = state.weights.length >= 2 ? state.weights[state.weights.length - 2].kg : before.start;
  const d = kg - prev;
  toast('Pesée enregistrée', `${fmtKg(kg)} kg · ${Math.abs(d) < 0.05 ? 'stable' : (d < 0 ? '−' : '+') + fmtKg(Math.abs(d)) + ' kg'} · transformation ${Math.round(after.progress * 100)} %`);
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
const STOPW = new Set('de du des la le les l d au aux a en et avec sans un une g gr grammes gramme ml cl kg portion portions cuillere cuilleres bol verre tranche tranches morceau morceaux piece pieces j ai mange manger pris'.split(' '));
const normTxt = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/[^a-z0-9]+/g, ' ').trim();
const stemW = w => (w.length > 3 ? w.replace(/(s|x)$/, '') : w);
const tokensOf = s => normTxt(s).split(' ').filter(w => w && !STOPW.has(w) && !/^\d+$/.test(w)).map(stemW);

function loadCiqual() {
  if (ciqual) return Promise.resolve(ciqual);
  if (!ciqualLoading) {
    ciqualLoading = fetch('data/ciqual.json').then(r => r.json()).then(d => {
      ciqual = d.map(f => ({ ...f, _t: tokensOf(f.n), _n: normTxt(f.n) }));
      return ciqual;
    }).catch(e => { ciqualLoading = null; throw e; });
  }
  return ciqualLoading;
}
/* Aliments courants : choix par défaut le plus probable (cuit, nature…) */
const FOOD_DEFAULTS = {
  'riz': 'Riz blanc, cuit, non salé', 'riz blanc': 'Riz blanc, cuit, non salé',
  'pate': 'Pâtes sèches standard, cuites, non salées', 'pates': 'Pâtes sèches standard, cuites, non salées',
  'oeuf': 'Oeuf, dur', 'oeuf dur': 'Oeuf, dur', 'oeuf au plat': 'Oeuf, au plat, sans matière grasse',
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
};
const COOKED_GROUPS = /pâtes|riz|céréales|viandes|poissons|œufs|légumineuses|légumes|pommes de terre/;

function searchCiqual(query, limit = 8) {
  if (!ciqual) return [];
  const q = tokensOf(query);
  if (!q.length) return [];
  const nq = normTxt(query);
  const wantsRaw = /\bcru/.test(nq);
  const def = FOOD_DEFAULTS[q.join(' ')];
  const exacts = q.filter(w => w.length > 2).map(w => new RegExp(`(^| )${w}(s|x)?( |$)`));
  const res = [];
  for (const f of ciqual) {
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
    res.push({ f, score, cover: matched / q.length });
  }
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, limit);
}
const ciqualFood = f => ({ id: 'c' + f.c, name: f.n, src: 'ciqual', per100: { kcal: f.kcal || 0, p: f.p || 0, g: f.g || 0, l: f.l || 0 } });

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
  [/\bcuillere a cafe|\bc a c\b|\bcac\b/, 5], [/\bverre/, 200], [/\bbol/, 250], [/\bcanette/, 330], [/\bbouteille/, 500],
  [/\bsteak|\bburger|\bhamburger/, 125], [/\bavocat/, 150], [/\btomate/, 120], [/\bpart\b.*pizza|\bpizza/, 150], [/\bsandwich/, 250],
  [/\bportion/, 30], [/\bcafe|\bthe\b/, 200],
];
const WORDNUM = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, demi: 0.5, 'demie': 0.5 };
function parseFoodText(text) {
  return text
    .split(/\n|,|;|\+|\bet\b|\bavec\b/i)
    .map(x => x.trim())
    .filter(x => x.length > 1)
    .map(chunk => {
      const n = normTxt(chunk);
      let grams = null, name = chunk;
      const m = chunk.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|gr|grammes?|ml|cl|l|litres?)\b/i);
      if (m) {
        const v = parseFloat(m[1].replace(',', '.'));
        const u = m[2].toLowerCase();
        grams = u.startsWith('k') ? v * 1000 : u === 'cl' ? v * 10 : (u === 'l' || u.startsWith('litre')) ? v * 1000 : v;
        name = chunk.replace(m[0], ' ');
      } else {
        const c = n.match(/^(\d+(?:\.\d+)?|un|une|deux|trois|quatre|cinq|six|demi|demie)\b/);
        const count = c ? (WORDNUM[c[1]] || parseFloat(c[1])) : 1;
        const portion = PORTIONS.find(([re]) => re.test(n));
        if (portion) grams = Math.round(count * portion[1]);
        if (c) name = chunk.replace(new RegExp('^\\s*' + c[1].replace('.', '[.,]'), 'i'), ' ');
      }
      name = name.replace(/\b(de|d'|du|des)\s*$/i, '').replace(/^\s*(de|d'|du|des)\s+/i, '').replace(/\s+/g, ' ').trim();
      return { text: chunk, query: name || chunk, grams: grams ? Math.round(grams) : null };
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
function renderNutritionCard(today) {
  const t = dayTotals(today), tg = nutritionTargets();
  const left = tg.kcal - t.kcal;
  return `
    <section class="panel">
      <div class="panel-head"><div class="panel-title">Nutrition du jour</div><button class="btn small ghost" data-go="meals">Ouvrir ›</button></div>
      <div class="nutri-top">
        <div class="kring-wrap">${kcalRing(t.kcal, tg.kcal)}<div class="kring-txt"><b>${fmtNum(Math.abs(left))}</b><span>${left >= 0 ? 'restantes' : 'en trop'}</span></div></div>
        <div class="nutri-macros">${macroBars(t, tg)}</div>
      </div>
      <div class="small faint" style="margin-top:8px">${fmtNum(t.kcal)} / ${fmtNum(tg.kcal)} kcal${tg.known ? '' : ' · objectif provisoire : renseigne ta taille et ton âge dans Réglages'}</div>
      <button class="btn block" style="margin-top:12px" data-go="meals">🍽️ Ajouter ce que j'ai mangé</button>
    </section>`;
}

/* ---------- Onglet Repas ---------- */
function renderMeals() {
  const today = todayKey();
  const day = ui.mealDay || today;
  const t = dayTotals(day), tg = nutritionTargets();
  const left = tg.kcal - t.kcal;
  const validated = nutritionDays(today).has(day);
  const mealPhotos = photos.filter(p => p.kind === 'meal' && p.date === day);
  return `
    <section class="panel">
      <div class="cal-head" style="margin-bottom:12px">
        <button class="icon-btn" data-meal-day="-1" aria-label="Jour précédent">‹</button>
        <div class="center"><div class="cal-month">${day === today ? "Aujourd'hui" : esc(fmtDayLong(day))}</div>
          <div class="small muted">${validated ? '<span style="color:var(--good)">✓ Quête nutrition validée (+' + NUTRI_XP + ' XP)</span>' : day === today ? 'Quête : 3 repas, ≤ objectif, protéines ≥ 80 %' : 'Quête nutrition non validée'}</div></div>
        <button class="icon-btn" data-meal-day="1" aria-label="Jour suivant" ${day >= today ? 'disabled style="opacity:.3"' : ''}>›</button>
      </div>
      <div class="nutri-top">
        <div class="kring-wrap">${kcalRing(t.kcal, tg.kcal)}<div class="kring-txt"><b>${fmtNum(Math.abs(left))}</b><span>${left >= 0 ? 'kcal restantes' : 'kcal en trop'}</span></div></div>
        <div class="nutri-macros">${macroBars(t, tg)}</div>
      </div>
      <div class="small faint" style="margin-top:8px">${fmtNum(t.kcal)} kcal mangées · objectif ${fmtNum(tg.kcal)} kcal${tg.auto ? ' (calculé pour perdre ≈ 0,5 kg/semaine)' : ''}</div>
    </section>

    ${MEALS.map(m => {
      const items = state.meals.filter(x => x.date === day && x.meal === m.key).sort((a, b) => a.ts - b.ts);
      const ph = mealPhotos.filter(p => p.meal === m.key);
      const kc = items.reduce((s, x) => s + x.kcal, 0);
      return `
      <section class="panel">
        <div class="panel-head"><div class="panel-title">${m.icon} ${m.label}</div><div class="entry-xp" style="color:var(--neon-2)">${fmtNum(kc)} kcal</div></div>
        ${ph.length ? `<div class="meal-photos">${ph.map(p => `<button type="button" class="ph" data-photo="${esc(p.id)}"><img src="${photoUrl(p)}" alt=""></button>`).join('')}</div>` : ''}
        ${items.map(x => `
          <div class="entry">
            <div class="entry-body">
              <div class="entry-title">${esc(x.name)}</div>
              <div class="entry-meta">${fmtNum(x.grams)} g · P ${fmtG(x.p)} · G ${fmtG(x.g)} · L ${fmtG(x.l)}${x.src === 'off' ? ' · 🏷️' : ''}</div>
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

/* ---------- Ajout d'aliments ---------- */
function foodRowHtml(it, i) {
  const opts = it.cands.map((c, j) => `<option value="${j}" ${j === it.sel ? 'selected' : ''}>${c.src === 'off' ? '🏷️ ' : ''}${esc(c.name)} · ${Math.round(c.per100.kcal)} kcal/100 g</option>`).join('');
  const food = it.cands[it.sel];
  const mac = food && it.grams ? macroOf(food, it.grams) : null;
  return `
    <div class="food-row" data-row="${i}">
      <div class="food-q">“${esc(it.text)}”</div>
      ${it.cands.length ? `<select class="input food-sel" data-sel="${i}">${opts}</select>` : `<div class="small decay-warn">${it.loading ? 'Recherche…' : 'Aucun aliment trouvé.'}</div>`}
      <div class="food-line">
        <input class="input food-g" data-grams="${i}" inputmode="decimal" placeholder="grammes" value="${it.grams || ''}">
        <span class="food-mac">${mac ? `<b>${mac.kcal} kcal</b> · P ${fmtG(mac.p)} · G ${fmtG(mac.g)} · L ${fmtG(mac.l)}` : '<span class="decay-warn">Indique les grammes</span>'}</span>
      </div>
      <div class="food-actions">
        <button type="button" class="btn small ghost" data-off="${i}">🏷️ Chercher la marque</button>
        <button type="button" class="btn small ghost" data-rm="${i}">Retirer</button>
      </div>
    </div>`;
}

function openFoodSheet(meal) {
  const ml = mealLabel(meal);
  const day = ui.mealDay || todayKey();
  let items = [];
  openSheet({
    tag: `[SYSTÈME] ${ml.label}`,
    title: `${ml.icon} Qu'as-tu mangé ?`,
    body: `
      <label class="field"><span>Écris tout, avec les grammes. Pour un produit de marque, mets la marque.</span>
        <textarea class="input" id="food-text" rows="3" placeholder="Ex : 150 g riz, 120 g poulet, 2 oeufs, yaourt Skyr Siggi's 150 g"></textarea>
      </label>
      <button type="button" class="btn primary block" data-analyse="1">🔍 Analyser</button>
      <div id="food-rows"></div>
      <div id="food-save" style="display:none;margin-top:12px">
        <div class="small muted center" id="food-total"></div>
        <button type="button" class="btn primary block" style="margin-top:8px" data-food-save="1">Ajouter au repas</button>
      </div>
      <p class="small faint">Valeurs : table Ciqual (ANSES) et Open Food Facts pour les marques (nécessite Internet).</p>`,
    buttons: [{ label: 'Fermer', value: null, cls: 'ghost' }],
    onMount(sheet, close) {
      const draw = () => {
        $('#food-rows', sheet).innerHTML = items.map(foodRowHtml).join('');
        const ok = items.filter(it => it.cands[it.sel] && it.grams > 0);
        $('#food-save', sheet).style.display = items.length ? '' : 'none';
        const tot = ok.reduce((s, it) => s + macroOf(it.cands[it.sel], it.grams).kcal, 0);
        $('#food-total', sheet).textContent = `${ok.length} aliment${ok.length > 1 ? 's' : ''} · ${fmtNum(tot)} kcal`;
      };
      const searchBrand = async (it, auto = false) => {
        if (!navigator.onLine) { if (!auto) toast('Pas de connexion', 'La recherche de marques demande Internet.', 'warn'); return; }
        it.loading = true; draw();
        try {
          const res = await searchOFF(it.query);
          if (res.length) { it.cands = [...res, ...it.cands.filter(c => c.src !== 'off')]; it.sel = 0; }
          else if (!auto) toast('Marque introuvable', 'Essaie avec le nom exact du produit.', 'warn');
        } catch (e) {
          if (!auto) toast('Recherche impossible', 'Open Food Facts ne répond pas.', 'warn');
        }
        it.loading = false;
        if (sheet.isConnected) draw();
      };
      sheet.addEventListener('click', async e => {
        if (e.target.closest('[data-analyse]')) {
          const txt = $('#food-text', sheet).value.trim();
          if (!txt) { toast('Rien à analyser', 'Écris ce que tu as mangé.', 'warn'); return; }
          try { await loadCiqual(); } catch (_) { toast('Base aliments indisponible', 'Réessaie avec Internet.', 'warn'); return; }
          const parsed = parseFoodText(txt);
          const fresh = parsed.map(p => {
            const r = searchCiqual(p.query);
            return { ...p, cands: r.map(x => ciqualFood(x.f)), sel: 0, cover: r.length ? r[0].cover : 0 };
          });
          items = items.concat(fresh);
          $('#food-text', sheet).value = '';
          draw();
          // produit probablement de marque (mots inconnus de la base) → recherche automatique
          fresh.filter(it => it.cover < 1 || !it.cands.length).forEach(it => searchBrand(it, true));
          return;
        }
        const off = e.target.closest('[data-off]');
        if (off) { searchBrand(items[+off.dataset.off]); return; }
        const rm = e.target.closest('[data-rm]');
        if (rm) { items.splice(+rm.dataset.rm, 1); draw(); return; }
        if (e.target.closest('[data-food-save]')) {
          const ok = items.filter(it => it.cands[it.sel] && it.grams > 0);
          if (!ok.length) { toast('Rien à ajouter', 'Indique au moins un aliment avec ses grammes.', 'warn'); return; }
          const now = Date.now();
          ok.forEach((it, k) => {
            const f = it.cands[it.sel];
            state.meals.push({ id: uid(), date: day, meal, ts: now + k, name: f.name.slice(0, 120), grams: it.grams, ...macroOf(f, it.grams), src: f.src });
          });
          save();
          close(null);
          render();
          const kc = ok.reduce((s, it) => s + macroOf(it.cands[it.sel], it.grams).kcal, 0);
          const t = dayTotals(day), tg = nutritionTargets();
          toast(`${ml.label} enregistré`, `+${fmtNum(kc)} kcal · reste ${fmtNum(tg.kcal - t.kcal)} kcal aujourd'hui`);
        }
      });
      sheet.addEventListener('change', e => {
        const s = e.target.closest('[data-sel]');
        if (s) { items[+s.dataset.sel].sel = +s.value; draw(); }
        const g = e.target.closest('[data-grams]');
        if (g) { const v = parseFloat(g.value.replace(',', '.')); items[+g.dataset.grams].grams = Number.isFinite(v) && v > 0 ? Math.min(5000, Math.round(v)) : null; draw(); }
      });
    },
  });
}

async function deleteFood(id) {
  const x = state.meals.find(m => m.id === id);
  if (!x) return;
  if (!(await confirmBox('Retirer cet aliment ?', `${esc(x.name)} — ${fmtNum(x.kcal)} kcal`, 'Retirer', true))) return;
  state.meals = state.meals.filter(m => m.id !== id);
  save();
  render();
}

/* =========================================================
   Onglet 2 : Aujourd'hui
   ========================================================= */
function entryHtml(l, withDelete = true) {
  const meta = [l.minutes ? fmtMinutes(l.minutes) : 'Fait ✓', l.stats.map(k => statByKey[k].name).join(' · ')].filter(Boolean).join(' — ');
  return `
    <div class="entry">
      <div class="entry-emoji">${esc(l.icon)}</div>
      <div class="entry-body">
        <div class="entry-title">${esc(l.name)}</div>
        <div class="entry-meta">${esc(meta)}</div>
        ${l.note ? `<div class="entry-note">“${esc(l.note)}”</div>` : ''}
      </div>
      <div class="entry-xp">+${l.xp} XP</div>
      ${withDelete ? `<button class="icon-btn danger" data-del-log="${esc(l.id)}" aria-label="Supprimer">✕</button>` : ''}
    </div>`;
}

function renderToday() {
  const today = todayKey();
  const logs = state.logs.filter(l => l.date === today).sort((a, b) => b.ts - a.ts);
  const xpDay = logs.reduce((s, l) => s + l.xp, 0);

  const grid = state.activities.map(a => `
    <button class="activity-btn" data-log-activity="${esc(a.id)}">
      <span class="activity-emoji">${esc(a.icon)}</span>
      <span>
        <span class="activity-name">${esc(a.name)}</span><br>
        <span class="activity-stats">${a.stats.length ? a.stats.map(k => statByKey[k].name).join(' + ') : 'Aucune stat'}</span>
      </span>
    </button>`).join('');

  return `
    <section class="panel">
      <div class="day-summary">
        <div>
          <div class="panel-title">${esc(fmtDayLong(today))}</div>
          <div class="small muted" style="margin-top:4px">${logs.length} quête${logs.length > 1 ? 's' : ''} accomplie${logs.length > 1 ? 's' : ''}</div>
        </div>
        <div class="day-xp">+${fmtNum(xpDay)} XP</div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Qu'as-tu accompli ?</div></div>
      <div class="activity-grid">
        ${grid}
        <button class="activity-btn add" data-new-activity="1">＋ Nouvelle activité</button>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">Journal du jour</div></div>
      ${logs.length ? logs.map(l => entryHtml(l)).join('') : `<div class="empty"><span class="sys">[SYSTÈME]</span>Aucune quête aujourd'hui. Choisis une activité au-dessus.</div>`}
    </section>
  `;
}

/* Feuille d'enregistrement : choix de la durée = validation directe */
function openLogSheet(activity) {
  const durations = [15, 30, 45, 60, 90, 120, 180, 240];
  let dayChoice = 'today';
  const body = `
    <div class="small muted" style="margin:-8px 0 14px">${activity.stats.length ? 'Fait monter : ' + activity.stats.map(k => statByKey[k].icon + ' ' + statByKey[k].name).join(', ') : "Ne fait monter aucune stat (modifiable dans Réglages)"}</div>
    <div class="seg" style="margin-bottom:14px">
      <button type="button" class="on" data-day="today">Aujourd'hui</button>
      <button type="button" data-day="yesterday">Hier</button>
    </div>
    <label class="field"><span>Petite note (facultatif)</span>
      <input class="input" id="log-note" maxlength="280" placeholder="Ex : 5 km, chapitre 3, 120 viewers…" autocomplete="off">
    </label>
    <div class="field"><span>Durée — touche pour valider</span></div>
    <div class="dur-grid">
      ${durations.map(m => `<button type="button" class="btn" data-dur="${m}">${fmtMinutes(m)}</button>`).join('')}
      <button type="button" class="btn primary" data-dur="0">Fait ✓</button>
    </div>
    <div class="or-sep">AUTRE DURÉE</div>
    <div class="btn-row">
      <input class="input" id="log-custom" type="number" inputmode="numeric" min="1" max="1440" placeholder="minutes" style="flex:1">
      <button type="button" class="btn" data-dur="custom" style="flex:0 0 auto">Valider</button>
    </div>`;

  openSheet({
    tag: '[SYSTÈME] Nouvelle quête',
    title: `${activity.icon} ${activity.name}`,
    body,
    buttons: [{ label: 'Annuler', value: null, cls: 'ghost' }],
    onMount(sheet, close) {
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
        const date = dayChoice === 'yesterday' ? addDays(todayKey(), -1) : todayKey();
        close(null);
        addLog(activity, minutes, note, date);
      });
    },
  });
}

function addLog(activity, minutes, note, date) {
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
  state.logs.push(log);
  save();
  const after = levelInfo(totalXp());
  const statsAfter = computeStats(state.logs, today).values;
  const gains = STAT_KEYS
    .map(k => ({ k, d: statsAfter[k] - statsBefore[k] }))
    .filter(g => g.d >= 0.01)
    .map(g => `${statByKey[g.k].name} +${g.d.toFixed(2).replace('.', ',')}`);

  render();
  toast('Quête accomplie', `+${log.xp} XP${gains.length ? ' · ' + gains.join(' · ') : ''}`);
  if (after.level > before.level) {
    const rb = rankFor(before.level), ra = rankFor(after.level);
    setTimeout(() => showLevelUp(after.level, ra.letter !== rb.letter ? ra : null), 500);
  }
}

function showLevelUp(level, newRank) {
  openSheet({
    center: true,
    tag: '[SYSTÈME] Alerte',
    body: `
      <div class="levelup">
        <div class="levelup-txt">NIVEAU SUPÉRIEUR</div>
        <div class="levelup-big">${level}</div>
        <p>Tu as atteint le niveau ${level}.${newRank ? `<br><b style="color:#fff">Nouveau rang : ${newRank.letter}</b> — ${newRank.title}.` : ''}</p>
      </div>`,
    buttons: [{ label: 'Continuer', value: true, cls: 'primary' }],
  });
}

async function deleteLog(id) {
  const l = state.logs.find(x => x.id === id);
  if (!l) return;
  const ok = await confirmBox('Supprimer cette quête ?', `${esc(l.icon)} ${esc(l.name)} (${esc(fmtDayShort(l.date))}) — ${l.xp} XP seront retirés.`, 'Supprimer', true);
  if (!ok) return;
  state.logs = state.logs.filter(x => x.id !== id);
  save();
  render();
  toast('Quête supprimée', `−${l.xp} XP`);
}

/* =========================================================
   Onglet 3 : Historique
   ========================================================= */
function renderHistory() {
  const today = todayKey();
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
    const cls = ['cal-day', lv, k === today ? 'today' : '', k === ui.selectedDay ? 'selected' : '', k > today ? 'future' : ''].join(' ');
    cells += `<button type="button" class="${cls}" data-day-pick="${k}">${d}${xp ? `<small>${xp}</small>` : ''}</button>`;
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
        <div class="panel-title">${esc(fmtDayLong(sel))}</div>
        <div class="entry-xp">${fmtNum(selXp)} XP</div>
      </div>
      ${selLogs.length ? selLogs.map(l => entryHtml(l)).join('') : `<div class="empty">Aucune quête ce jour-là.</div>`}
    </section>

    <section class="panel">
      <div class="panel-head"><div class="panel-title">XP par semaine</div></div>
      ${weeks.map((w, i) => `
        <div class="week-row">
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
      <details class="rules">
        <summary>Comment fonctionne le Système ?</summary>
        <ul>
          <li><b>XP</b> : 1 XP par minute (max 4 h par entrée). "Fait" sans durée = ${RULES.doneXp} XP. Facile ×0,8 · Intense ×1,3.</li>
          <li><b>Niveau</b> : chaque niveau demande plus d'XP que le précédent. Comme dans la vraie vie, ça prend du temps : avec ~2 h d'activité par jour, rang D ≈ 3 mois, C ≈ 1 an, B ≈ 3 ans, A ≈ 6 ans, S ≈ 12 ans.</li>
          <li><b>Rang</b> : E (niv. 1) → D (10) → C (20) → B (35) → A (50) → S (70).</li>
          <li><b>Nutrition</b> : une journée terminée avec 3 repas notés, calories entre objectif −400 et objectif +100, et protéines ≥ 80 % = +${NUTRI_XP} XP et +1 point de Discipline.</li>
          <li><b>Corps</b> : l'hologramme ne s'affine qu'avec ton vrai poids. Perte réaliste : 0,5 à 1 kg par semaine.</li>
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

function openActivityEditor(activity) {
  const isNew = !activity;
  const a = activity ? { ...activity, stats: [...activity.stats] } : { id: uid(), name: '', icon: '⭐', stats: [], difficulty: 'normal' };
  const body = `
    <div class="btn-row" style="gap:10px">
      <label class="field" style="flex:0 0 84px"><span>Icône</span>
        <input class="input center" id="act-icon" maxlength="8" value="${esc(a.icon)}" style="font-size:24px;padding:8px">
      </label>
      <label class="field" style="flex:1"><span>Nom</span>
        <input class="input" id="act-name" maxlength="40" value="${esc(a.name)}" placeholder="Ex : Méditation" autocomplete="off">
      </label>
    </div>
    <div class="field"><span>Stats qui montent</span>
      <div class="chips">${STATS.map(s => `<button type="button" class="chip ${a.stats.includes(s.key) ? 'on' : ''}" data-stat="${s.key}">${s.icon} ${s.name}</button>`).join('')}</div>
    </div>
    <div class="field"><span>Intensité (multiplie l'XP et les gains)</span>
      <div class="seg">${DIFFICULTIES.map(d => `<button type="button" class="${a.difficulty === d.key ? 'on' : ''}" data-diff="${d.key}">${d.label}</button>`).join('')}</div>
    </div>
    <div class="stack" style="margin-top:6px">
      <button type="button" class="btn primary block" data-save="1">${isNew ? "Créer l'activité" : 'Enregistrer'}</button>
      ${isNew ? '' : '<button type="button" class="btn danger block" data-remove="1">Supprimer cette activité</button>'}
    </div>
    <p class="small faint">Modifier une activité ne change pas les quêtes déjà enregistrées.</p>`;

  openSheet({
    tag: isNew ? '[SYSTÈME] Nouvelle activité' : "[SYSTÈME] Modifier l'activité",
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
          if (isNew) state.activities.push(a);
          else state.activities = state.activities.map(x => x.id === a.id ? a : x);
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
          state.activities = state.activities.filter(x => x.id !== a.id);
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
   Événements (un seul écouteur pour toute l'app)
   ========================================================= */
document.addEventListener('click', e => {
  const t = e.target;
  const tab = t.closest('.tab');
  if (tab) return go(tab.dataset.tab);

  const goBtn = t.closest('[data-go]');
  if (goBtn) return go(goBtn.dataset.go);

  const act = t.closest('[data-log-activity]');
  if (act) {
    const a = state.activities.find(x => x.id === act.dataset.logActivity);
    if (a) openLogSheet(a);
    return;
  }
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
  if (hm) { ui.holoMode = hm.dataset.holoMode; return render(); }

  const action = t.closest('#view [data-action]');
  if (action) {
    const a = action.dataset.action;
    if (a === 'weigh') return openWeighSheet();
    if (a === 'photos') return openPhotosSheet();
    if (a === 'export') return exportSave();
    if (a === 'import') return $('#import-file').click();
    if (a === 'reset') return resetAll();
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'player-name') {
    state.playerName = e.target.value.trim().slice(0, 40) || 'Chasseur';
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
    save();
    e.target.value = fmtKg(kg);
    toast('Objectif mis à jour', `${fmtKg(state.body.startWeight)} kg → ${fmtKg(state.body.goalWeight)} kg`);
  }
  if (e.target.dataset && e.target.dataset.body) {
    const key = e.target.dataset.body, raw = e.target.value.trim();
    if (!raw && key !== 'fatStart') { state.body[key] = null; save(); toast('Profil mis à jour'); return; }
    const v = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(v) || v < +e.target.dataset.min || v > +e.target.dataset.max) {
      toast('Valeur invalide', `Entre ${e.target.dataset.min} et ${e.target.dataset.max}.`, 'warn');
      e.target.value = state.body[key] || '';
      return;
    }
    state.body[key] = Math.round(v * 10) / 10;
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
async function start() {
  $('#app-version').textContent = APP_VERSION;
  if (!localStorage.getItem(STORAGE_KEY)) save();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  render();
  await loadPhotos();
  if (photos.length) render();
  try {
    if (sessionStorage.getItem('monSysteme.updated')) {
      sessionStorage.removeItem('monSysteme.updated');
      toast('Mise à jour installée', `Version ${APP_VERSION}`);
    }
  } catch (_) {}
  setupServiceWorker();
}

start();
