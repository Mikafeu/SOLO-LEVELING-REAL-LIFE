/* =========================================================
   MUSIQUE DU SYSTÈME — 7 boucles chiptune (style jeu vidéo rétro)
   Musiques ORIGINALES, composées pour cette app et jouées en direct
   par le navigateur (WebAudio) : aucun fichier audio, aucun droit d'auteur.
   Licence : CC0 / domaine public (libre de droits).
   Les boucles tournent sans fin (séquenceur continu → aucune coupure),
   et passent d'un palier à l'autre avec un fondu enchaîné de 1,5 s.
   ========================================================= */
const Musique = (() => {
  const FADE = 1.5;            // fondu enchaîné (secondes)
  const LOOKAHEAD = 0.18;      // programmation en avance (secondes)
  let ctx = null, master = null, noiseBuf = null, timer = null;
  let enabled = true, volume = 0.5, unlocked = false, tier = 0;
  let cur = null;              // morceau en cours { theme, gain, step, t }
  const old = [];              // morceaux en train de s'éteindre

  const midi = m => 440 * Math.pow(2, (m - 69) / 12);
  // accords : [fondamentale (midi), 'm' mineur | 'M' majeur]
  const TONES = { m: [0, 3, 7, 10], M: [0, 4, 7, 11] };

  /* Les 7 thèmes. pat : 16 pas par mesure (doubles croches).
     k = grosse caisse, s = caisse claire, h = charleston, o = charley ouvert.
     arp : indices de notes de l'accord (-1 = silence), bass : demi-tons (null = silence),
     lead : demi-tons au-dessus de la fondamentale (null = silence). */
  const THEMES = [
    { name: 'Éveil', bpm: 84, prog: [[57, 'm'], [53, 'M'], [48, 'M'], [55, 'M']], pad: 0.05,
      arp: [0, -1, 1, -1, 2, -1, 1, -1, 3, -1, 2, -1, 1, -1, 2, -1], arpWave: 'triangle', arpVol: 0.05, arpOct: 12,
      bass: [0, null, null, null, null, null, null, null, 0, null, null, null, null, null, null, null], bassVol: 0.06, bassWave: 'triangle',
      drums: { h: '..........x.....' }, drumVol: 0.25 },
    { name: 'En route', bpm: 104, prog: [[57, 'm'], [53, 'M'], [48, 'M'], [55, 'M']], pad: 0.035,
      arp: [0, 1, 2, 1, 3, 2, 1, 2, 0, 1, 2, 1, 3, 2, 1, 2], arpWave: 'square', arpVol: 0.028, arpOct: 12,
      bass: [0, null, 0, null, 12, null, 0, null, 0, null, 0, null, 12, null, 7, null], bassVol: 0.07, bassWave: 'triangle',
      drums: { h: '..x...x...x...x.', k: 'x.......x.......' }, drumVol: 0.35 },
    { name: 'Chasse', bpm: 118, prog: [[57, 'm'], [53, 'M'], [48, 'M'], [55, 'M']], pad: 0.03,
      arp: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3], arpWave: 'square', arpVol: 0.03, arpOct: 12,
      bass: [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 0, 12, 7, 12], bassVol: 0.075, bassWave: 'square',
      lead: [12, null, null, null, 15, null, 14, null, 12, null, null, null, 10, null, 7, null], leadVol: 0.03, leadWave: 'triangle',
      drums: { k: 'x...x...x...x...', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' }, drumVol: 0.4 },
    { name: 'Éveil du chasseur', bpm: 126, prog: [[50, 'm'], [46, 'M'], [48, 'M'], [45, 'm']], pad: 0.03,
      arp: [0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3, 2, 1, 2, 3], arpWave: 'square', arpVol: 0.03, arpOct: 12,
      bass: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 7, 0, 12, 10], bassVol: 0.075, bassWave: 'square',
      lead: [12, null, 15, null, 19, null, 17, 15, 14, null, 12, null, 10, 12, 14, null], leadVol: 0.034, leadWave: 'square',
      drums: { k: 'x...x...x...x.x.', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' }, drumVol: 0.42 },
    { name: 'Donjon épique', bpm: 136, prog: [[52, 'm'], [48, 'M'], [50, 'M'], [47, 'M']], pad: 0.035,
      arp: [0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3, 3, 2, 1, 0], arpWave: 'square', arpVol: 0.028, arpOct: 24,
      bass: [0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 7, 19, 10, 22], bassVol: 0.08, bassWave: 'sawtooth',
      lead: [19, null, 19, 17, 19, null, 22, null, 24, null, 22, 19, 17, null, 15, 17], leadVol: 0.034, leadWave: 'sawtooth',
      drums: { k: 'x..x..x.x..x..x.', s: '....x.......x..x', h: 'x.xxx.xxx.xxx.xx', o: '......x.......x.' }, drumVol: 0.45 },
    { name: 'Monarque', bpm: 148, prog: [[54, 'm'], [50, 'M'], [52, 'M'], [49, 'M']], pad: 0.035,
      arp: [0, 1, 2, 3, 2, 3, 2, 1, 0, 1, 2, 3, 2, 3, 2, 1], arpWave: 'square', arpVol: 0.03, arpOct: 24,
      bass: [0, 0, 12, 0, 0, 12, 0, 12, 0, 0, 12, 0, 0, 12, 7, 12], bassVol: 0.08, bassWave: 'sawtooth',
      lead: [24, 22, 19, 22, 24, null, 27, null, 26, 24, 22, 19, 22, null, 19, 17], leadVol: 0.034, leadWave: 'square', lead2: 7,
      drums: { k: 'x.x.x.x.x.x.x.x.', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx', o: '..x...x...x...x.' }, drumVol: 0.47 },
    { name: 'ULTIME', bpm: 160, prog: [[55, 'm'], [51, 'M'], [53, 'M'], [50, 'M']], pad: 0.04,
      arp: [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 1, 2, 3], arpWave: 'square', arpVol: 0.032, arpOct: 24,
      bass: [0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 7, 19, 10, 22], bassVol: 0.085, bassWave: 'sawtooth',
      lead: [24, 27, 31, 27, 24, 27, 31, 34, 31, 29, 27, 26, 27, 26, 22, 26], leadVol: 0.036, leadWave: 'sawtooth', lead2: 12,
      drums: { k: 'x.x.x.x.x.x.x.xx', s: '....x..x....x.xx', h: 'xxxxxxxxxxxxxxxx', o: 'x.......x.......' }, drumVol: 0.5, crash: true },
  ];

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? volume : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function tone(out, freq, t, dur, type, vol, slide) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(out, t, dur, vol, hp) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t); s.stop(t + dur + 0.02);
  }
  function playStep(tr, t) {
    const th = tr.theme, i = tr.step % 16, bar = Math.floor(tr.step / 16) % th.prog.length;
    const [root, q] = th.prog[bar], tones = TONES[q];
    const sp = 60 / th.bpm / 4;
    const out = tr.gain;
    if (i === 0 && th.pad) for (const k of [0, 1, 2]) tone(out, midi(root + tones[k]), t, sp * 15.5, 'triangle', th.pad);
    const a = th.arp[i];
    if (a >= 0) tone(out, midi(root + th.arpOct + tones[a]), t, sp * 0.9, th.arpWave, th.arpVol);
    const b = th.bass[i];
    if (b != null) tone(out, midi(root - 12 + b), t, sp * 1.6, th.bassWave, th.bassVol);
    if (th.lead) {
      const l = th.lead[i];
      if (l != null) {
        tone(out, midi(root + l), t, sp * 1.8, th.leadWave, th.leadVol);
        if (th.lead2) tone(out, midi(root + l + th.lead2), t, sp * 1.8, 'square', th.leadVol * 0.55);
      }
    }
    const dv = th.drumVol, dr = th.drums || {};
    if (dr.k && dr.k[i] === 'x') tone(out, 150, t, 0.16, 'sine', 0.55 * dv * 2, 40);
    if (dr.s && dr.s[i] === 'x') noise(out, t, 0.12, 0.32 * dv, 1200);
    if (dr.h && dr.h[i] === 'x') noise(out, t, 0.035, 0.12 * dv, 7000);
    if (dr.o && dr.o[i] === 'x') noise(out, t, 0.16, 0.1 * dv, 6000);
    if (th.crash && i === 0 && bar === 0) noise(out, t, 1.1, 0.16 * dv, 4500);
  }
  function tick() {
    if (!ctx) return;
    const until = ctx.currentTime + LOOKAHEAD;
    for (const tr of [cur, ...old]) {
      if (!tr) continue;
      while (tr.t < until) {
        if (!tr.dying || tr.t < tr.endAt) playStep(tr, tr.t);
        tr.t += 60 / tr.theme.bpm / 4;
        tr.step++;
      }
    }
    for (let i = old.length - 1; i >= 0; i--) if (ctx.currentTime > old[i].endAt + 0.3) { try { old[i].gain.disconnect(); } catch (_) {} old.splice(i, 1); }
  }
  function startTheme(n, fade) {
    if (!ensure()) return;
    const now = ctx.currentTime;
    if (cur) {
      cur.dying = true; cur.endAt = now + FADE;
      cur.gain.gain.cancelScheduledValues(now);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, now);
      cur.gain.gain.linearRampToValueAtTime(0.0001, now + FADE);
      old.push(cur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(fade ? 0.0001 : 1, now);
    if (fade) g.gain.linearRampToValueAtTime(1, now + FADE);
    g.connect(master);
    cur = { theme: THEMES[n], gain: g, step: 0, t: now + 0.05, n };
    if (!timer) timer = setInterval(tick, 30);
  }
  function stopAll() {
    if (timer) { clearInterval(timer); timer = null; }
    for (const tr of [cur, ...old]) if (tr) { try { tr.gain.disconnect(); } catch (_) {} }
    cur = null; old.length = 0;
  }

  return {
    themes: THEMES.map(t => t.name),
    get tier() { return tier; },
    get playing() { return !!cur && enabled && unlocked; },
    /* Sur iPhone, le son ne peut démarrer qu'après un premier toucher */
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (!unlocked) { unlocked = true; if (enabled) startTheme(tier, true); }
    },
    setTier(n) {
      n = Math.max(0, Math.min(THEMES.length - 1, n | 0));
      if (n === tier && cur) return;
      tier = n;
      if (unlocked && enabled) startTheme(tier, true);
    },
    setEnabled(on) {
      enabled = !!on;
      if (!ctx) { if (enabled && unlocked) startTheme(tier, true); return; }
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(enabled ? volume : 0.0001, now + 0.4);
      if (enabled && unlocked && !cur) startTheme(tier, true);
      if (!enabled) setTimeout(() => { if (!enabled) stopAll(); }, 500);
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (ctx && enabled) { const now = ctx.currentTime; master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(volume, now); }
    },
    /* appli en arrière-plan : on met en pause (batterie) */
    pause() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && unlocked && enabled && ctx.state === 'suspended') ctx.resume(); },
  };
})();
