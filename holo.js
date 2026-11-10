/* =========================================================
   HOLOGRAMME 3D DU CORPS — style laboratoire / Système
   Le corps tourne en boucle, en rayures lumineuses.
   Plus tu approches de ton objectif de poids, plus la
   silhouette s'affine (ventre, taille, poitrine, cuisses).
   ========================================================= */
import * as THREE from './vendor/three.module.min.js';

const S = {
  renderer: null, scene: null, camera: null, group: null,
  uniforms: null, canvas: null, container: null, ro: null,
  running: false, last: 0, slim: 0, slimTarget: 0, mode: 'now',
  failed: false, loading: null,
};

/* ---------- Lecture du modèle (format compact maison) ----------
   v2 : deux sculptures du même maillage — MAINTENANT et OBJECTIF. */
async function loadBodyGeometry() {
  const res = await fetch('assets/corps.bin');
  if (!res.ok) throw new Error('Modèle 3D introuvable');
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  const ver = dv.getUint32(4, true);
  const nVerts = dv.getUint32(8, true);
  const nIdx = dv.getUint32(12, true);
  const nParts = dv.getUint32(16, true);
  const mn = [dv.getFloat32(24, true), dv.getFloat32(28, true), dv.getFloat32(32, true)];
  const mx = [dv.getFloat32(36, true), dv.getFloat32(40, true), dv.getFloat32(44, true)];
  let off = 48 + nParts * 8;
  const deq = q => {
    const out = new Float32Array(nVerts * 3);
    for (let i = 0; i < nVerts * 3; i++) { const a = i % 3; out[i] = mn[a] + (q[i] / 65535) * (mx[a] - mn[a]); }
    return out;
  };
  const now = deq(new Uint16Array(buf, off, nVerts * 3));
  off += nVerts * 6;
  let goal = now;
  if (ver >= 2) { goal = deq(new Uint16Array(buf, off, nVerts * 3)); off += nVerts * 6; }
  const idx = ver >= 2 ? new Uint32Array(buf, off, nIdx) : new Uint16Array(buf, off, nIdx);

  // centre du torse (pour la rotation sur place)
  let cx = 0, cz = 0, n = 0;
  for (let i = 0; i < nVerts; i++) {
    const x = now[i * 3], y = now[i * 3 + 1], z = now[i * 3 + 2];
    if (y > 0.9 && y < 1.25 && Math.abs(x) < 0.17) { cx += x; cz += z; n++; }
  }
  cx = n ? cx / n : 0; cz = n ? cz / n : 0;
  for (const arr of [now, goal]) for (let i = 0; i < nVerts; i++) { arr[i * 3] -= cx; arr[i * 3 + 2] -= cz; }

  const index = new THREE.BufferAttribute(idx, 1);
  const normalsOf = pos => {
    const t = new THREE.BufferGeometry();
    t.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    t.setIndex(index);
    t.computeVertexNormals();
    return t.getAttribute('normal');
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(now, 3));
  g.setAttribute('normal', normalsOf(now));
  g.setAttribute('goalPos', new THREE.BufferAttribute(goal, 3));
  g.setAttribute('goalNormal', goal === now ? g.getAttribute('normal') : normalsOf(goal));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/* ---------- Shaders ---------- */
const MORPH = /* glsl */`
  uniform float uSlim;
  attribute vec3 goalPos;
  attribute vec3 goalNormal;
`;

const bodyVert = /* glsl */`
  ${MORPH}
  varying vec3 vN;
  varying vec3 vView;
  varying float vY;
  void main() {
    vec3 p = mix(position, goalPos, uSlim);
    vY = p.y;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = normalize(-mv.xyz);
    vN = normalize(normalMatrix * normalize(mix(normal, goalNormal, uSlim)));
    gl_Position = projectionMatrix * mv;
  }
`;

const bodyFrag = /* glsl */`
  uniform float uTime;
  uniform float uScan;
  uniform vec3 uColor;
  uniform vec3 uColor2;
  varying vec3 vN;
  varying vec3 vView;
  varying float vY;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vView);
    if (dot(n, v) < 0.0) n = -n;
    // éclairage de studio (fixe par rapport à la caméra) : fait ressortir gras et muscles
    vec3 L = normalize(vec3(-0.55, 0.65, 0.55));
    vec3 L2 = normalize(vec3(0.7, 0.1, 0.4));
    float diff = max(dot(n, L), 0.0);
    float fill = max(dot(n, L2), 0.0) * 0.35;
    float spec = pow(max(dot(reflect(-L, n), v), 0.0), 28.0) * 0.55;
    float fres = pow(1.0 - max(dot(n, v), 0.0), 2.4);
    // rayures horizontales qui montent doucement
    float s = fract(vY * 110.0 - uTime * 0.35);
    float stripe = smoothstep(0.0, 0.15, s) * smoothstep(0.75, 0.5, s);
    float beam = exp(-pow((vY - uScan) * 14.0, 2.0));
    float flicker = 0.96 + 0.04 * sin(uTime * 23.0 + vY * 40.0);
    float shade = 0.07 + 0.95 * diff + fill + spec;
    vec3 col = uColor * shade * (0.55 + 0.45 * stripe);
    col += uColor2 * fres * 0.75;
    col += vec3(0.6, 0.9, 1.0) * beam * 0.7;
    col *= flicker;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const pointsVert = /* glsl */`
  ${MORPH}
  uniform float uTime;
  uniform float uPixel;
  varying float vA;
  void main() {
    vec3 p = mix(position, goalPos, uSlim) + normalize(mix(normal, goalNormal, uSlim)) * 0.004;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vA = 0.35 + 0.65 * step(0.97, fract(sin(dot(position.xy, vec2(12.9898, 78.233))) * 43758.5453 + uTime * 0.15));
    gl_PointSize = 1.3 * uPixel;
    gl_Position = projectionMatrix * mv;
  }
`;
const pointsFrag = /* glsl */`
  uniform vec3 uColor;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = 1.0 - smoothstep(0.2, 0.5, length(c));
    gl_FragColor = vec4(uColor * d * vA * 0.7, d * vA * 0.7);
  }
`;

const floorVert = /* glsl */`
  varying vec2 vP;
  void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const floorFrag = /* glsl */`
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vP;
  float ring(float r, float at, float w) { return smoothstep(w, 0.0, abs(r - at)); }
  void main() {
    float r = length(vP);
    float ang = atan(vP.y, vP.x);
    vec2 g = abs(fract(vP * 6.0) - 0.5);
    float grid = smoothstep(0.47, 0.5, max(g.x, g.y)) * 0.35;
    float r1 = ring(r, 0.42, 0.012);
    float dash = step(0.5, fract(ang * 24.0 / 6.2832 + uTime * 0.12));
    float r2 = ring(r, 0.52, 0.01) * dash;
    float dash2 = step(0.7, fract(ang * 6.0 / 6.2832 - uTime * 0.07));
    float r3 = ring(r, 0.62, 0.02) * dash2;
    float pulse = ring(r, mod(uTime * 0.35, 1.0) * 0.9, 0.03) * (1.0 - mod(uTime * 0.35, 1.0));
    float disc = exp(-r * r * 9.0) * 0.55;
    float a = (grid + r1 * 1.2 + r2 + r3 * 0.8 + pulse * 0.8 + disc) * smoothstep(1.1, 0.35, r);
    gl_FragColor = vec4(uColor * a, a);
  }
`;

const partVert = /* glsl */`
  attribute vec3 seed;
  uniform float uTime;
  uniform float uPixel;
  varying float vA;
  void main() {
    float h = mod(seed.y + uTime * (0.08 + seed.z * 0.1), 2.1);
    float ang = seed.x * 6.2832 + uTime * 0.2;
    float rad = 0.25 + seed.z * 0.45;
    vec3 p = vec3(cos(ang) * rad, h, sin(ang) * rad);
    vA = smoothstep(0.0, 0.3, h) * smoothstep(2.1, 1.2, h);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (2.0 + seed.z * 2.5) * uPixel;
    gl_Position = projectionMatrix * mv;
  }
`;
const partFrag = /* glsl */`
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float d = 1.0 - smoothstep(0.0, 0.5, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(uColor * d * vA * 0.8, d * vA * 0.8);
  }
`;

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

/* ---------- Mise en place ---------- */
async function init() {
  const canvas = document.createElement('canvas');
  canvas.className = 'holo-canvas';
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch (e) {
    S.failed = true;
    throw e;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 50);
  camera.position.set(0, 1.25, 4.9);
  camera.lookAt(0, 0.9, 0);

  const uniforms = {
    uTime: { value: 0 },
    uScan: { value: 0 },
    uSlim: { value: 0 },
    uPixel: { value: renderer.getPixelRatio() },
    uColor: { value: new THREE.Color(0x2fc4ff) },
    uColor2: { value: new THREE.Color(0x9fe9ff) },
  };

  const geo = await loadBodyGeometry();
  const group = new THREE.Group();

  // 1) passe de profondeur invisible : seule la surface avant est dessinée ensuite
  const depthMat = new THREE.ShaderMaterial({ uniforms, vertexShader: bodyVert, fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }', side: THREE.DoubleSide, colorWrite: false });
  const depthMesh = new THREE.Mesh(geo, depthMat);
  depthMesh.renderOrder = 0;
  group.add(depthMesh);
  // 2) le corps lumineux, éclairé (relief visible)
  const bodyMat = new THREE.ShaderMaterial({ uniforms, vertexShader: bodyVert, fragmentShader: bodyFrag, side: THREE.DoubleSide, transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, blending: THREE.AdditiveBlending });
  const bodyMesh = new THREE.Mesh(geo, bodyMat);
  bodyMesh.renderOrder = 1;
  group.add(bodyMesh);

  // nuage de points sur la peau (1 point sur 3)
  const STEP = 5;
  const pick = name => {
    const a = geo.getAttribute(name), cnt = Math.floor(a.count / STEP), out = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) { out[i * 3] = a.getX(i * STEP); out[i * 3 + 1] = a.getY(i * STEP); out[i * 3 + 2] = a.getZ(i * STEP); }
    return new THREE.BufferAttribute(out, 3);
  };
  const pg = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'goalPos', 'goalNormal']) pg.setAttribute(name, pick(name));
  const pts = new THREE.Points(pg, new THREE.ShaderMaterial({ uniforms, vertexShader: pointsVert, fragmentShader: pointsFrag, ...additive }));
  pts.renderOrder = 2;
  group.add(pts);
  scene.add(group);

  // anneau de scan
  const scanRing = new THREE.Mesh(
    new THREE.RingGeometry(0.36, 0.375, 96),
    new THREE.MeshBasicMaterial({ color: 0x7fe0ff, side: THREE.DoubleSide, opacity: 0.8, ...additive })
  );
  scanRing.rotation.x = -Math.PI / 2;
  scene.add(scanRing);

  // plateforme du labo
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 2.4),
    new THREE.ShaderMaterial({ uniforms, vertexShader: floorVert, fragmentShader: floorFrag, side: THREE.DoubleSide, ...additive })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.005;
  scene.add(floor);

  // particules qui montent
  const N = 140;
  const seeds = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) seeds[i] = Math.random() * (i % 3 === 1 ? 2.1 : 1);
  const partGeo = new THREE.BufferGeometry();
  partGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  partGeo.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
  const parts = new THREE.Points(partGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: partVert, fragmentShader: partFrag, ...additive }));
  parts.frustumCulled = false;
  scene.add(parts);

  Object.assign(S, { renderer, scene, camera, group, uniforms, canvas, scanRing });
}

function resize() {
  if (!S.container || !S.renderer) return;
  const w = S.container.clientWidth, h = S.container.clientHeight;
  if (!w || !h) return;
  S.renderer.setSize(w, h, false);
  S.camera.aspect = w / h;
  S.camera.updateProjectionMatrix();
}

function frame(now) {
  if (!S.running) return;
  requestAnimationFrame(frame);
  if (!S.canvas.isConnected || document.visibilityState !== 'visible') return;
  const t = now / 1000;
  const dt = Math.min(0.05, S.last ? t - S.last : 0.016);
  S.last = t;
  S.uniforms.uTime.value = t;
  const scan = 0.05 + (Math.sin(t * 0.9) * 0.5 + 0.5) * 1.75;
  S.uniforms.uScan.value = scan;
  S.scanRing.position.y = scan;
  S.scanRing.material.opacity = 0.35 + 0.45 * Math.abs(Math.cos(t * 0.9));
  S.slim += (S.slimTarget - S.slim) * Math.min(1, dt * 3);
  S.uniforms.uSlim.value = S.slim;
  S.group.rotation.y += dt * 0.55;
  S.renderer.render(S.scene, S.camera);
}

/* ---------- API utilisée par app.js ---------- */
const Holo = {
  /* container : élément où afficher ; progress : 0 → 1 vers l'objectif */
  async mount(container, { progress = 0, mode = 'now', tint = null } = {}) {
    S.container = container;
    S.mode = mode;
    if (mode === 'goal') progress = 1;
    S.slimTarget = Math.max(0, Math.min(1.35, progress));
    if (S.failed) return Holo.fallback(container);
    try {
      if (!S.renderer) {
        if (!S.loading) S.loading = init();
        await S.loading;
      }
    } catch (e) {
      console.warn('Hologramme indisponible', e);
      S.failed = true;
      return Holo.fallback(container);
    }
    if (S.container !== container) return; // l'écran a changé entre-temps
    container.appendChild(S.canvas);
    container.classList.add('ready');
    if (S.ro) S.ro.disconnect();
    S.ro = new ResizeObserver(resize);
    S.ro.observe(container);
    resize();
    const t = tint || (mode === 'goal' ? ['#ffc35a', '#fff0c0', '#ffd27a'] : ['#2fc4ff', '#9fe9ff', '#7fe0ff']);
    S.uniforms.uColor.value.set(t[0]);
    S.uniforms.uColor2.value.set(t[1]);
    S.scanRing.material.color.set(t[2]);
    if (!S.running) { S.running = true; S.last = 0; requestAnimationFrame(frame); }
  },
  setProgress(progress, mode) {
    S.mode = mode || S.mode;
    S.slimTarget = S.mode === 'goal' ? 1 : Math.max(0, Math.min(1, progress));
  },
  fallback(container) {
    container.classList.add('ready', 'fallback');
    container.insertAdjacentHTML('beforeend', '<div class="holo-fallback">[SYSTÈME] Affichage 3D indisponible sur cet appareil.</div>');
  },
};

window.Holo = Holo;
document.dispatchEvent(new Event('holo-ready'));
