/* =========================================================
   MON SYSTÈME — application personnelle style "Système"
   Tout est sauvegardé dans le téléphone (localStorage).
   ========================================================= */
'use strict';

/* ⚠️ À chaque mise à jour : augmenter ce numéro ICI, dans sw.js
   et dans index.html (?v=...). Le script tests/check-version.js vérifie. */
const APP_VERSION = '1.1.0';

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
  { letter: 'E', minLevel: 1, title: 'Chasseur de rang E' },
  { letter: 'D', minLevel: 10, title: 'Chasseur de rang D' },
  { letter: 'C', minLevel: 20, title: 'Chasseur de rang C' },
  { letter: 'B', minLevel: 35, title: 'Chasseur de rang B' },
  { letter: 'A', minLevel: 50, title: 'Chasseur de rang A' },
  { letter: 'S', minLevel: 70, title: 'Chasseur de rang S' },
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
    body: { startWeight: 96.5, goalWeight: 86 },
    weights: [],
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
  if (raw.body && typeof raw.body === 'object') {
    if (okKg(raw.body.startWeight)) s.body.startWeight = raw.body.startWeight;
    if (okKg(raw.body.goalWeight)) s.body.goalWeight = raw.body.goalWeight;
  }
  s.weights = (Array.isArray(raw.weights) ? raw.weights : [])
    .filter(w => w && isValidKey(w.date) && okKg(w.kg))
    .map(w => ({ id: typeof w.id === 'string' && w.id ? w.id : uid(), date: w.date, kg: Math.round(w.kg * 10) / 10 }))
    .sort((a, b) => a.date.localeCompare(b.date));
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

/* XP nécessaire pour passer du niveau n au niveau n+1 */
const xpToNext = n => Math.round(100 * Math.pow(n, 1.5));

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
const totalXp = () => state.logs.reduce((s, l) => s + l.xp, 0);

/* Recalcule les stats en "rejouant" chaque jour depuis la 1re activité.
   Ainsi, supprimer une entrée corrige tout automatiquement. */
function computeStats(logs, today) {
  const values = {}, last = {}, weekAgo = {};
  STAT_KEYS.forEach(k => { values[k] = RULES.statStart; last[k] = null; weekAgo[k] = RULES.statStart; });
  if (!logs.length) return { values, last, weekAgo };

  const byDay = new Map();
  let first = today;
  for (const l of logs) {
    if (l.date > today) continue;
    if (l.date < first) first = l.date;
    const o = byDay.get(l.date) || {};
    const pts = entryPoints(l);
    for (const k of l.stats) o[k] = (o[k] || 0) + pts;
    byDay.set(l.date, o);
  }
  for (const o of byDay.values()) o.discipline = (o.discipline || 0) + RULES.regularityBonus;

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
const TITLES = { home: 'Statut du joueur', today: 'Quêtes du jour', history: 'Journal des quêtes', settings: 'Réglages' };
let currentTab = 'home';
const ui = { calMonth: null, selectedDay: null, holoMode: 'now', photoPose: 'face' };

function go(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === tab));
  $('#topbar-title').textContent = TITLES[tab];
  render();
  window.scrollTo(0, 0);
}

function render() {
  const view = $('#view');
  const fn = { home: renderHome, today: renderToday, history: renderHistory, settings: renderSettings }[currentTab];
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

function renderBodyPanel(today) {
  const b = bodyProgress();
  const pct = Math.round(b.progress * 1000) / 10;
  const monthKey = today.slice(0, 7);
  const photoThisMonth = photos.some(p => p.date.slice(0, 7) === monthKey);
  const lastW = state.weights[state.weights.length - 1];
  const sinceW = lastW ? daysBetween(lastW.date, today) : null;
  const goalMode = ui.holoMode === 'goal';
  const done = b.progress >= 1;
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
        </div>
        <div class="hud hud-right">
          <div><small>PERDU</small><b class="${b.lost > 0 ? 'good' : ''}">${b.lost > 0 ? '−' : ''}${fmtKg(Math.abs(b.lost))}</b><i>kg</i></div>
          <div><small>RESTANT</small><b>${fmtKg(b.left)}</b><i>kg</i></div>
        </div>
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
        <button class="btn" data-action="photos">📷 Photos${photos.length ? ` (${photos.length})` : ''}</button>
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
    <button type="button" class="btn primary block" data-w-save="1">Enregistrer la pesée</button>
    ${state.weights.length >= 2 ? `<div class="field" style="margin-top:18px"><span>Évolution</span>${weightChartSvg()}</div>` : ''}
    ${list.length ? `<div class="field" style="margin-top:14px"><span>Dernières pesées</span>
      ${list.map(w => `<div class="entry"><div class="entry-body"><div class="entry-title">${fmtKg(w.kg)} kg</div><div class="entry-meta">${esc(fmtDayLong(w.date))}</div></div><button type="button" class="icon-btn danger" data-w-del="${esc(w.id)}" aria-label="Supprimer">✕</button></div>`).join('')}
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
          close(null);
          addWeight(kg);
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
function addWeight(kg) {
  const before = bodyProgress();
  const date = todayKey();
  state.weights = state.weights.filter(w => w.date !== date); // une pesée par jour
  state.weights.push({ id: uid(), date, kg });
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
let photos = []; // { id, date, pose, kg, blob }
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
      const p = { id: uid(), date: todayKey(), ts: Date.now(), pose: ui.photoPose, kg: currentWeight(), blob };
      await PhotoDB.put(p);
      photos.push(p);
      n++;
    } catch (e) {
      console.error(e);
      toast('Photo ignorée', e.message || 'Format non pris en charge', 'warn');
    }
  }
  if (n) {
    toast('Archive mise à jour', `${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} · ${poseLabel(ui.photoPose)}`);
    refreshPhotoSheet();
    render();
  }
}

function photosBody() {
  const pose = ui.photoPose;
  const same = photos.filter(p => p.pose === pose);
  const first = same[0], lastP = same[same.length - 1];
  const byMonth = new Map();
  [...photos].reverse().forEach(p => {
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
      ${photos.length ? [...byMonth].map(([k, list]) => `
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
        if (e.target.closest('[data-photo-add]')) { $('#photo-file').click(); return; }
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
    tag: `[SYSTÈME] ${poseLabel(p.pose)}`,
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
          <li><b>Niveau</b> : chaque niveau demande plus d'XP que le précédent.</li>
          <li><b>Rang</b> : E (niv. 1) → D (10) → C (20) → B (35) → A (50) → S (70).</li>
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
    photoData = await Promise.all(photos.map(async p => ({ id: p.id, date: p.date, ts: p.ts, pose: p.pose, kg: p.kg, image: await blobToDataUrl(p.blob) })));
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
            const rec = { id: typeof p.id === 'string' ? p.id : uid(), date: p.date, ts: +p.ts || Date.now(), pose: POSES.some(x => x.key === p.pose) ? p.pose : 'face', kg: +p.kg || next.body.startWeight, blob: await dataUrlToBlob(p.image) };
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
