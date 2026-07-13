'use strict';
/* ============================================================
   NEON RUSH — open-world stunt motorcycle
   world.js : renderer, sky, procedural city
   ============================================================ */

/* ---------- error trap (also used by headless tests) ---------- */
window.addEventListener('error', (e) => {
  let el = document.getElementById('errlog');
  if (!el) {
    el = document.createElement('div'); el.id = 'errlog';
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:999;color:#ff7788;font:12px monospace;max-width:90vw;white-space:pre-wrap;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent += (e.message || e.type) + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno + '\n';
});

/* ---------- utils ---------- */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rng = mulberry32(20260713);
const R = (a, b) => a + rng() * (b - a);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

/* ---------- world constants ---------- */
const CELL = 96, ROADW = 18, GRID = 22;
const WORLD = CELL * GRID, HALF = WORLD / 2;   // 2112 m square
const SIDE = CELL - ROADW;                     // 78 m parcels

/* ---------- renderer / scene / camera ---------- */
const canvas3d = document.getElementById('c3d');
const renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0x38123f);
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.00215);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.4, 8000);
camera.position.set(0, 60, -300);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (window.onGameResize) window.onGameResize();
});

/* ---------- lights ---------- */
const SUN_DIR = new THREE.Vector3(0.5, 0.17, -0.85).normalize();
const sun = new THREE.DirectionalLight(0xffa068, 1.05);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -130; sun.shadow.camera.right = 130;
sun.shadow.camera.top = 130; sun.shadow.camera.bottom = -130;
sun.shadow.camera.near = 20; sun.shadow.camera.far = 1400;
sun.shadow.bias = -0.0007;
scene.add(sun); scene.add(sun.target);

const hemi = new THREE.HemisphereLight(0x5a2f8a, 0x150a24, 0.72);
scene.add(hemi);

/* ---------- generated textures ---------- */
function makeGlowTexture(sharp) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(sharp ? 0.25 : 0.12, 'rgba(255,255,255,' + (sharp ? 0.85 : 0.45) + ')');
  grad.addColorStop(0.55, 'rgba(255,255,255,' + (sharp ? 0.22 : 0.12) + ')');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}
const glowTex = makeGlowTexture(false);
const particleTex = makeGlowTexture(true);

function makeRoadTextures() {
  const W = 256, H = 512;                       // covers 18m x 36m
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#17131f'; g.fillRect(0, 0, W, H);
  // asphalt speckle
  for (let i = 0; i < 2600; i++) {
    const v = 18 + Math.random() * 26;
    g.fillStyle = 'rgba(' + (v + 6) + ',' + v + ',' + (v + 14) + ',0.5)';
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  const e = document.createElement('canvas'); e.width = W; e.height = H;
  const ge = e.getContext('2d');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  function line(ctx, x, w, col, dash) {
    ctx.fillStyle = col;
    if (!dash) { ctx.fillRect(x - w / 2, 0, w, H); return; }
    for (let y = 0; y < H; y += 128) ctx.fillRect(x - w / 2, y + 20, w, 72);
  }
  // edge lines (pink) + dashed center (warm)
  line(g, 14, 4, '#7e2c56', false);  line(ge, 14, 4, '#b13a6e', false);
  line(g, W - 14, 4, '#7e2c56', false); line(ge, W - 14, 4, '#b13a6e', false);
  line(g, W / 2, 5, '#8a7340', true); line(ge, W / 2, 5, '#c9a75a', true);
  const map = new THREE.CanvasTexture(c);
  const emis = new THREE.CanvasTexture(e);
  for (const t of [map, emis]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  map.encoding = THREE.sRGBEncoding;
  return { map, emis };
}

/* ---------- sky ---------- */
const sky = (() => {
  const geo = new THREE.SphereGeometry(3800, 32, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: SUN_DIR },
      uZen: { value: new THREE.Color(0.045, 0.012, 0.13) },
      uMid: { value: new THREE.Color(0.21, 0.05, 0.31) },
      uHor: { value: new THREE.Color(0.86, 0.22, 0.42) },
    },
    vertexShader: 'varying vec3 vDir;\nvoid main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'varying vec3 vDir;',
      'uniform vec3 uSunDir;',
      'uniform vec3 uZen; uniform vec3 uMid; uniform vec3 uHor;',
      'float hash21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }',
      'void main(){',
      '  vec3 d = normalize(vDir);',
      '  float h = d.y;',
      '  float sunD = max(dot(d, uSunDir), 0.0);',
      '  vec3 zen = uZen;',
      '  vec3 mid = uMid;',
      '  vec3 hor = uHor;',
      '  vec3 col = mix(mid, zen, smoothstep(0.07, 0.52, h));',
      '  col = mix(hor, col, smoothstep(-0.02, 0.17, h));',
      '  col += vec3(1.0,0.42,0.16) * pow(sunD, 5.0) * 0.33 * smoothstep(-0.06, 0.1, h);',
      '  float disc = smoothstep(0.9962, 0.997, sunD);',
      '  float stripeMask = smoothstep(0.06, -0.015, h - uSunDir.y);',
      '  float stripes = mix(1.0, 0.4 + 0.6*step(0.0, sin(h*240.0)), stripeMask);',
      '  vec3 sunCol = mix(vec3(1.0,0.22,0.5), vec3(1.0,0.86,0.42), smoothstep(uSunDir.y-0.05, uSunDir.y+0.05, h));',
      '  col = mix(col, sunCol*1.6*stripes, disc);',
      '  col += sunCol * pow(sunD, 30.0) * 0.5;',
      '  float star = step(0.9974, hash21(floor(d.xz/max(h,0.09)*140.0))) * smoothstep(0.13, 0.4, h);',
      '  col += vec3(0.75,0.82,1.0) * star * 0.9;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1000; m.frustumCulled = false;
  scene.add(m);
  return m;
})();

/* ---------- ground ---------- */
{
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000),
    new THREE.MeshStandardMaterial({ color: 0x0b0714, roughness: 1, metalness: 0 })
  );
  g.rotation.x = -Math.PI / 2; g.position.y = -0.03; g.receiveShadow = true;
  scene.add(g);
}

/* ---------- roads (2 instanced strips) ---------- */
let roadMat;
{
  const { map, emis } = makeRoadTextures();
  const mat = roadMat = new THREE.MeshStandardMaterial({
    map, emissiveMap: emis, emissive: 0xffffff, emissiveIntensity: 0.55,
    roughness: 0.92, metalness: 0,
  });
  const geo = new THREE.PlaneGeometry(ROADW, WORLD);
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * WORLD / 36);

  const dummy = new THREE.Object3D();
  const zRoads = new THREE.InstancedMesh(geo, mat, GRID + 1);
  for (let k = 0; k <= GRID; k++) {
    dummy.position.set(-HALF + k * CELL, 0.05, 0); dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix(); zRoads.setMatrixAt(k, dummy.matrix);
  }
  zRoads.receiveShadow = true; scene.add(zRoads);

  const xRoads = new THREE.InstancedMesh(geo, mat, GRID + 1);
  for (let k = 0; k <= GRID; k++) {
    dummy.position.set(0, 0.12, -HALF + k * CELL); dummy.rotation.set(0, Math.PI / 2, 0);
    dummy.updateMatrix(); xRoads.setMatrixAt(k, dummy.matrix);
  }
  xRoads.receiveShadow = true; scene.add(xRoads);
}

/* ---------- sidewalk parcels ---------- */
{
  const geo = new THREE.BoxGeometry(SIDE + 2, 0.5, SIDE + 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x231a31, roughness: 0.95 });
  const mesh = new THREE.InstancedMesh(geo, mat, GRID * GRID);
  const dummy = new THREE.Object3D();
  let n = 0;
  for (let bx = 0; bx < GRID; bx++) for (let bz = 0; bz < GRID; bz++) {
    dummy.position.set(-HALF + bx * CELL + CELL / 2, 0.25, -HALF + bz * CELL + CELL / 2);
    dummy.updateMatrix(); mesh.setMatrixAt(n++, dummy.matrix);
  }
  mesh.receiveShadow = true; scene.add(mesh);
}

/* ---------- static glow points (lamps, signs, beacons...) ---------- */
const staticGlow = { pos: [], col: [], size: [], alpha: [] };
function addGlow(x, y, z, color, size, alpha) {
  staticGlow.pos.push(x, y, z);
  const c = new THREE.Color(color);
  staticGlow.col.push(c.r, c.g, c.b);
  staticGlow.size.push(size); staticGlow.alpha.push(alpha);
}

function makePointsMaterial(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uPxScale: { value: 1 } },
    vertexShader: [
      'attribute vec3 aColor; attribute float aSize; attribute float aAlpha;',
      'varying vec3 vColor; varying float vAlpha;',
      'void main(){',
      '  vColor = aColor; vAlpha = aAlpha;',
      '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
      '  float pxScale = uPxScale;',
      '  gl_PointSize = clamp(aSize * pxScale / max(-mv.z, 0.5), 0.0, 900.0);',
      '  gl_Position = projectionMatrix * mv;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D uTex;',
      'varying vec3 vColor; varying float vAlpha;',
      'void main(){',
      '  vec4 t = texture2D(uTex, gl_PointCoord);',
      '  gl_FragColor = vec4(vColor * vAlpha, 1.0) * t;',
      '}',
    ].join('\n'),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
}
const glowMaterials = [];
function updatePxScale() {
  const s = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  for (const m of glowMaterials) m.uniforms.uPxScale.value = s;
}

/* ---------- buildings ---------- */
const blockColliders = new Map();   // "bx,bz" -> [{x0,x1,z0,z1,h}]
function addCollider(bx, bz, x0, x1, z0, z1, h) {
  const key = bx + ',' + bz;
  if (!blockColliders.has(key)) blockColliders.set(key, []);
  blockColliders.get(key).push({ x0, x1, z0, z1, h: h || 999 });
}
function getCollidersNear(x, z) {
  const bx = Math.floor((x + HALF) / CELL), bz = Math.floor((z + HALF) / CELL);
  const out = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const c = blockColliders.get((bx + i) + ',' + (bz + j));
    if (c) for (const b of c) out.push(b);
  }
  return out;
}

const FACADES = [0x1a1228, 0x1d1132, 0x241533, 0x141b2d, 0x261326, 0x181d38, 0x201827];
const NEON = [0xff2d95, 0x00e5ff, 0xffe14d, 0x7cff4d, 0xff6a3d, 0xb967ff, 0x4dc3ff];

/* ---- districts ---- */
const DISTRICTS = {
  downtown:   { hMul: 1.3,  plaza: 0.03,  facades: [0x1a1228, 0x1d1132, 0x241533, 0x141b2d, 0x181d38], neon: NEON, lamp: 0xff9de0, signK: 1.0 },
  mid:        { hMul: 1.0,  plaza: 0.045, facades: FACADES, neon: NEON, lamp: 0xffb56a, signK: 0.72 },
  industrial: { hMul: 0.32, plaza: 0.1,   facades: [0x241a14, 0x2a1d10, 0x201812, 0x1c1a16, 0x262016], neon: [0xff6a3d, 0xffae3d, 0xff3d3d], lamp: 0xff8c3a, signK: 0.3 },
  waterfront: { hMul: 0.45, plaza: 0.12,  facades: [0x14202d, 0x18283a, 0x122431, 0x1a2a3a], neon: [0x00e5ff, 0x4dc3ff, 0x7cff4d], lamp: 0x7fdcff, signK: 0.65 },
  hills:      { hMul: 0.55, plaza: 0.08,  facades: [0x2a2030, 0x322435, 0x282033, 0x252031], neon: [0xffe14d, 0xff9a00, 0xff6a3d], lamp: 0xffd9a0, signK: 0.5 },
};
function districtAt(bx, bz) {
  if (bx <= 2) return 'waterfront';
  if (bx >= GRID - 3) return 'industrial';
  if (bz >= GRID - 4 && bx > 4 && bx < GRID - 5) return 'hills';
  if (Math.hypot(bx - GRID / 2 + 0.5, bz - GRID / 2 + 0.5) < 4.5) return 'downtown';
  return 'mid';
}

/* ---- hidden alleys: rows of blocks split to leave a lane through the middle ---- */
const ALLEYS = [
  { axis: 'x', bz: 6, b0: 3, b1: 8 },
  { axis: 'x', bz: 14, b0: 12, b1: 17 },
  { axis: 'z', bx: 9, b0: 2, b1: 6 },
  { axis: 'z', bx: 16, b0: 10, b1: 15 },
];
function alleyThrough(bx, bz) {
  for (const a of ALLEYS) {
    if (a.axis === 'x' && a.bz === bz && bx >= a.b0 && bx <= a.b1) return a;
    if (a.axis === 'z' && a.bx === bx && bz >= a.b0 && bz <= a.b1) return a;
  }
  return null;
}

/* ---- rooftop stunt zone blocks (industrial): uniform warehouses ---- */
const STUNT_BLOCKS = [[19, 8], [20, 8], [19, 9], [20, 9]];
const isStuntBlock = (bx, bz) => STUNT_BLOCKS.some((s) => s[0] === bx && s[1] === bz);

const waterParcels = [];
const antennaSpots = [];

const buildingList = [];   // {x,z,w,d,h,fc,dd[,y0]}
const spireBlock = { bx: 10, bz: 10 };

(function generateCity() {
  for (let bx = 0; bx < GRID; bx++) for (let bz = 0; bz < GRID; bz++) {
    if (bx === spireBlock.bx && bz === spireBlock.bz) continue;
    if (isStuntBlock(bx, bz)) continue;
    const cx = -HALF + bx * CELL + CELL / 2;
    const cz = -HALF + bz * CELL + CELL / 2;
    const dd = districtAt(bx, bz);
    const D = DISTRICTS[dd];
    // waterfront canals: some west parcels become water
    if (dd === 'waterfront' && bx === 0 && rng() < 0.65) {
      waterParcels.push({ x: cx, z: cz });
      continue;
    }
    const dCore = Math.min(1, Math.hypot(cx, cz) / HALF);
    if (rng() < D.plaza) continue;   // plaza
    const hMax = lerp(165, 24, Math.pow(dCore, 0.72)) * D.hMul;
    const alley = alleyThrough(bx, bz);
    const roll = rng();
    let slots;
    if (alley) {
      slots = alley.axis === 'x'
        ? [[cx, cz - 21, 62, 26], [cx, cz + 21, 62, 26]]
        : [[cx - 21, cz, 26, 62], [cx + 21, cz, 26, 62]];
    } else if (roll < 0.28) slots = [[cx, cz, 60]];
    else if (roll < 0.72) {
      const ax = rng() < 0.5;
      slots = ax ? [[cx - 18, cz, 30, 62], [cx + 18, cz, 30, 62]]
                 : [[cx, cz - 18, 62, 30], [cx, cz + 18, 62, 30]];
    } else {
      slots = [[cx - 18, cz - 18, 30, 30], [cx + 18, cz - 18, 30, 30],
               [cx - 18, cz + 18, 30, 30], [cx + 18, cz + 18, 30, 30]];
    }
    for (const s of slots) {
      const maxW = s[2], maxD = s[3] !== undefined ? s[3] : s[2];
      const w = R(maxW * 0.55, maxW * 0.92), dp = R(maxD * 0.55, maxD * 0.92);
      const px = s[0] + R(-2, 2), pz = s[1] + R(-2, 2);
      let h = Math.max(11, hMax * R(0.3, 1.0));
      if (rng() < (dd === 'downtown' ? 0.08 : 0.05)) h = Math.min(178, h * 1.7);   // supertall
      buildingList.push({ x: px, z: pz, w, d: dp, h, fc: pick(D.facades), dd });
      addCollider(bx, bz, px - w / 2, px + w / 2, pz - dp / 2, pz + dp / 2, h + 0.5);
      if (h > 95) addGlow(px, h + 1.6, pz, 0xff3344, 5, 0.9);
      // setback crown segment on tall towers
      if (h > 88 && rng() < 0.4) {
        const cw = w * R(0.45, 0.62), cd2 = dp * R(0.45, 0.62), ch = h * R(0.18, 0.3);
        buildingList.push({ x: px, z: pz, w: cw, d: cd2, h: ch, y0: h + 0.5, fc: pick(D.facades), dd });
        addCollider(bx, bz, px - cw / 2, px + cw / 2, pz - cd2 / 2, pz + cd2 / 2, h + 0.5 + ch);
      }
      if (h > 105 && rng() < 0.7) antennaSpots.push([px + R(-4, 4), h + 0.5, pz + R(-4, 4), R(5, 11)]);
    }
  }
  // stunt-zone warehouses: uniform rooftops for the roof run
  for (const sb of STUNT_BLOCKS) {
    const cx = -HALF + sb[0] * CELL + CELL / 2;
    const cz = -HALF + sb[1] * CELL + CELL / 2;
    buildingList.push({ x: cx, z: cz, w: 64, d: 64, h: 16, fc: 0x241a14, dd: 'industrial' });
    addCollider(sb[0], sb[1], cx - 32, cx + 32, cz - 32, cz + 32, 16.5);
  }
})();

const buildingMesh = (() => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.28 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vWPos;\nvarying vec3 vWNormal;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        'vec4 nwp = vec4(objectNormal, 0.0);',
        '#ifdef USE_INSTANCING',
        '  nwp = instanceMatrix * nwp;',
        '#endif',
        'vWNormal = normalize((modelMatrix * nwp).xyz);',
        'vec4 pwp = vec4(transformed, 1.0);',
        '#ifdef USE_INSTANCING',
        '  pwp = instanceMatrix * pwp;',
        '#endif',
        'vWPos = (modelMatrix * pwp).xyz;',
      ].join('\n')
    );
    shader.fragmentShader = 'varying vec3 vWPos;\nvarying vec3 vWNormal;\n' + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      [
        '#include <emissivemap_fragment>',
        '{',
        '  vec3 an = abs(vWNormal);',
        '  float wallX = step(0.6, an.x);',
        '  float wall = max(wallX, step(0.6, an.z)) * (1.0 - step(0.6, an.y));',
        '  vec2 wc = wallX > 0.5 ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y);',
        '  vec2 cs = vec2(3.1, 3.7);',
        '  vec2 id = floor(wc / cs);',
        '  vec2 fr = fract(wc / cs);',
        '  float win = step(0.24, fr.x) * step(fr.x, 0.76) * step(0.28, fr.y) * step(fr.y, 0.74);',
        '  float hsh = fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453);',
        '  float on = step(0.66, hsh);',
        '  float warm = step(0.5, fract(hsh * 7.7));',
        '  vec3 wcol = mix(vec3(0.3, 0.85, 1.0), vec3(1.0, 0.68, 0.34), warm);',
        '  totalEmissiveRadiance += wcol * (win * on * wall * (0.7 + 0.9 * fract(hsh * 3.3)));',
        '}',
      ].join('\n')
    );
  };
  const mesh = new THREE.InstancedMesh(geo, mat, buildingList.length);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  buildingList.forEach((b, i) => {
    dummy.position.set(b.x, (b.y0 !== undefined ? b.y0 : 0.5) + b.h / 2, b.z);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    col.setHex(b.fc !== undefined ? b.fc : pick(FACADES)); mesh.setColorAt(i, col);
  });
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
})();

/* ---------- neon signs ---------- */
(() => {
  const signs = [];
  for (const b of buildingList) {
    const D = DISTRICTS[b.dd] || DISTRICTS.mid;
    if (b.h < 20 || b.y0 !== undefined || rng() < 1 - 0.38 * D.signK) continue;
    const face = Math.floor(rng() * 4);   // 0:+x 1:-x 2:+z 3:-z
    let sw = R(4, 9), sh = R(2, 4.2);
    if (rng() < 0.3) { const t = sw; sw = sh * 1.4; sh = Math.min(t * 1.2, b.h - 14); }   // vertical banner
    const sy = R(9, Math.min(b.h - 5, 46));
    let x = b.x, z = b.z, ry = 0;
    if (face === 0) { x += b.w / 2 + 0.25; ry = Math.PI / 2; }
    else if (face === 1) { x -= b.w / 2 + 0.25; ry = -Math.PI / 2; }
    else if (face === 2) { z += b.d / 2 + 0.25; ry = 0; }
    else { z -= b.d / 2 + 0.25; ry = Math.PI; }
    const color = pick(D.neon);
    signs.push({ x, y: sy, z, ry, sw, sh, color });
    const c = new THREE.Color(color);
    addGlow(x + Math.sin(ry) * 0.8, sy, z + Math.cos(ry) * 0.8, color, sw * 1.6, 0.4);
    void c;
  }
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: true });
  const mesh = new THREE.InstancedMesh(geo, mat, signs.length);
  const dummy = new THREE.Object3D(); const col = new THREE.Color();
  signs.forEach((s, i) => {
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(0, s.ry, 0);
    dummy.scale.set(s.sw, s.sh, 1);
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    col.setHex(s.color).multiplyScalar(1.6); mesh.setColorAt(i, col);
  });
  scene.add(mesh);
})();

/* ---------- street lamps ---------- */
(() => {
  const lampPos = [];
  for (let bx = 0; bx < GRID; bx++) for (let bz = 0; bz < GRID; bz++) {
    const cx = -HALF + bx * CELL + CELL / 2;
    const cz = -HALF + bz * CELL + CELL / 2;
    const o = SIDE / 2 - 1.2;
    const lc = DISTRICTS[districtAt(bx, bz)].lamp;
    lampPos.push([cx + o, cz + o, lc], [cx - o, cz - o, lc]);
  }
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.14, 6.6, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2438, roughness: 0.7, metalness: 0.6 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampPos.length);
  const headGeo = new THREE.SphereGeometry(0.28, 8, 6);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffc98a });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampPos.length);
  const dummy = new THREE.Object3D();
  lampPos.forEach((p, i) => {
    dummy.position.set(p[0], 3.8, p[1]); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
    dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p[0], 7.1, p[1]);
    dummy.updateMatrix(); heads.setMatrixAt(i, dummy.matrix);
    addGlow(p[0], 7.1, p[1], p[2], 7, 0.55);
  });
  scene.add(poles); scene.add(heads);
})();

/* ---------- ramps + stunt rings ---------- */
const ramps = [];   // {x,z,dx,dz,len,w,h}
const rings = [];   // {x,y,z,mesh,cd}
(() => {
  const rampGroup = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b1e42, roughness: 0.6, metalness: 0.3 });
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2d95 });
  const ringGeo = new THREE.TorusGeometry(3.4, 0.28, 10, 36);

  function wedgeGeo(len, w, h) {
    // low end at z=0, high end at z=len, height h; width w along x
    const hw = w / 2;
    const v = [
      // top slope
      -hw, 0, 0,  hw, 0, 0,  hw, h, len,
      -hw, 0, 0,  hw, h, len,  -hw, h, len,
      // back (high end)
      -hw, 0, len,  -hw, h, len,  hw, h, len,
      -hw, 0, len,  hw, h, len,  hw, 0, len,
      // left side
      -hw, 0, 0,  -hw, h, len,  -hw, 0, len,
      // right side
      hw, 0, 0,  hw, 0, len,  hw, h, len,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }

  const usedRoads = new Set();
  let placed = 0, guard = 0;
  while (placed < 16 && guard++ < 300) {
    const axis = rng() < 0.5 ? 'x' : 'z';
    const k = Math.floor(R(2, GRID - 1));
    const seg = Math.floor(R(2, GRID - 1));
    const key = axis + k + '_' + seg;
    if (usedRoads.has(key)) continue;
    usedRoads.add(key);
    const roadC = -HALF + k * CELL;
    const along = -HALF + seg * CELL + CELL / 2 + R(-14, 14);
    const dir = rng() < 0.5 ? 1 : -1;
    const len = 16, w = 7.4, h = R(3.6, 4.6);
    let x, z, dx, dz;
    if (axis === 'x') { x = along; z = roadC; dx = dir; dz = 0; }
    else { x = roadC; z = along; dx = 0; dz = dir; }
    ramps.push({ x, z, dx, dz, len, w, h });

    const mesh = new THREE.Mesh(wedgeGeo(len, w, h), bodyMat);
    mesh.position.set(x, 0.02, z);
    mesh.rotation.y = Math.atan2(dx, dz);
    mesh.castShadow = true; mesh.receiveShadow = true;
    rampGroup.add(mesh);
    // neon edge rails on the slope
    for (const sideX of [-w / 2, w / 2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, Math.hypot(len, h)), edgeMat);
      rail.position.set(sideX, h / 2 + 0.1, len / 2);
      rail.rotation.x = -Math.atan2(h, len);
      mesh.add(rail);
    }
    addGlow(x + dx * len * 0.7, h * 0.8, z + dz * len * 0.7, 0x00e5ff, 6, 0.4);

    // stunt ring past the ramp lip
    if (placed % 2 === 0) {
      const rx = x + dx * (len + 26), rz = z + dz * (len + 26), ryy = 9.5;
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(rx, ryy, rz);
      ring.rotation.y = Math.atan2(dx, dz);
      rampGroup.add(ring);
      rings.push({ x: rx, y: ryy, z: rz, mesh: ring, cd: 0 });
      addGlow(rx, ryy, rz, 0xff2d95, 11, 0.4);
    }
    placed++;
  }
  scene.add(rampGroup);
})();

/* ---------- collectible orbs ---------- */
const ORB_COUNT = 96;
const orbs = [];   // {x,z,y,phase,active}
const orbMesh = (() => {
  for (let c = 0; c < 16; c++) {
    const axis = rng() < 0.5 ? 'x' : 'z';
    const k = Math.floor(R(1, GRID));
    const roadC = -HALF + k * CELL;
    const start = R(-HALF + 40, HALF - 120);
    const lane = R(-5.5, 5.5);
    for (let i = 0; i < 6; i++) {
      const along = start + i * 9;
      const x = axis === 'x' ? along : roadC + lane;
      const z = axis === 'x' ? roadC + lane : along;
      orbs.push({ x, z, y: 1.3, phase: R(0, TAU), active: true });
    }
  }
  const geo = new THREE.IcosahedronGeometry(0.5, 0);
  const mat = new THREE.MeshBasicMaterial({ color: 0x35f6ff });
  const mesh = new THREE.InstancedMesh(geo, mat, ORB_COUNT);
  scene.add(mesh);
  return mesh;
})();

/* orb glows: dynamic small points */
const orbGlow = (() => {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(ORB_COUNT * 3);
  const col = new Float32Array(ORB_COUNT * 3);
  const size = new Float32Array(ORB_COUNT);
  const alpha = new Float32Array(ORB_COUNT);
  orbs.forEach((o, i) => {
    pos.set([o.x, o.y, o.z], i * 3);
    col.set([0.2, 0.95, 1.0], i * 3);
    size[i] = 3.6; alpha[i] = 0.55;
  });
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = makePointsMaterial(glowTex);
  glowMaterials.push(mat);
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return pts;
})();

/* ---------- boundary walls ---------- */
const wallTexes = [];
(() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,229,255,0.9)'; g.lineWidth = 3;
  g.strokeRect(1, 1, 126, 126);
  g.strokeStyle = 'rgba(255,45,149,0.5)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
  const geo = new THREE.PlaneGeometry(WORLD, 30);
  const H = 15;
  const defs = [
    [0, H, -HALF, 0], [0, H, HALF, Math.PI],
    [-HALF, H, 0, Math.PI / 2], [HALF, H, 0, -Math.PI / 2],
  ];
  for (const d of defs) {
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(WORLD / 16, 30 / 16);
    wallTexes.push(tex);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, color: 0x88ddff,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(d[0], d[1], d[2]); m.rotation.y = d[3];
    scene.add(m);
  }
})();

/* ---------- the Spire (central landmark) ---------- */
const spireRings = [];
(() => {
  const cx = -HALF + spireBlock.bx * CELL + CELL / 2;
  const cz = -HALF + spireBlock.bz * CELL + CELL / 2;
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 8.5, 210, 8),
    new THREE.MeshStandardMaterial({ color: 0x141022, roughness: 0.5, metalness: 0.7 })
  );
  body.position.y = 105.5; body.castShadow = true;
  g.add(body);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
  [[58, 13], [116, 10.5], [170, 8]].forEach((rr) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr[1], 0.5, 8, 40), ringMat);
    ring.position.y = rr[0]; ring.rotation.x = Math.PI / 2;
    g.add(ring); spireRings.push(ring);
  });
  g.position.set(cx, 0, cz);
  scene.add(g);
  addCollider(spireBlock.bx, spireBlock.bz, cx - 9, cx + 9, cz - 9, cz + 9, 210);
  addGlow(cx, 213, cz, 0xff3344, 14, 1.0);
  addGlow(cx, 116, cz, 0x00e5ff, 26, 0.35);
})();

/* ---------- extra rideable surfaces ---------- */
const decks = [];        // {x0,x1,z0,z1,y} flat rideable tops (overpasses, tunnel roofs, roof bridges)
const roadStrips = [];   // {x0,x1,z0,z1} lanes with road grip (alleys)
function onRoadStrip(x, z) {
  for (const s of roadStrips) if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) return true;
  return false;
}
function addColliderSpan(x0, x1, z0, z1, h) {
  const b0x = Math.max(0, Math.floor((x0 + HALF) / CELL)), b1x = Math.min(GRID - 1, Math.floor((x1 + HALF) / CELL));
  const b0z = Math.max(0, Math.floor((z0 + HALF) / CELL)), b1z = Math.min(GRID - 1, Math.floor((z1 + HALF) / CELL));
  for (let bx = b0x; bx <= b1x; bx++) for (let bz = b0z; bz <= b1z; bz++) addCollider(bx, bz, x0, x1, z0, z1, h);
}
function wedgeGeoG(len, w, h) {
  const hw = w / 2;
  const v = [
    -hw, 0, 0, hw, 0, 0, hw, h, len,
    -hw, 0, 0, hw, h, len, -hw, h, len,
    -hw, 0, len, -hw, h, len, hw, h, len,
    -hw, 0, len, hw, h, len, hw, 0, len,
    -hw, 0, 0, -hw, h, len, -hw, 0, len,
    hw, 0, 0, hw, 0, len, hw, h, len,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
const structBodyMat = new THREE.MeshStandardMaterial({ color: 0x2b1e42, roughness: 0.6, metalness: 0.3 });
const structDarkMat = new THREE.MeshStandardMaterial({ color: 0x1c1430, roughness: 0.7, metalness: 0.3 });
const structEdgeMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
const structWarmMat = new THREE.MeshBasicMaterial({ color: 0xff9a3d });
function buildRamp(grp, x, z, dx, dz, len, w, h, y0, edgeMat) {
  ramps.push({ x, z, dx, dz, len, w, h, y0: y0 || 0 });
  const mesh = new THREE.Mesh(wedgeGeoG(len, w, h), structBodyMat);
  mesh.position.set(x, (y0 || 0) + 0.02, z);
  mesh.rotation.y = Math.atan2(dx, dz);
  mesh.castShadow = true; mesh.receiveShadow = true;
  grp.add(mesh);
  for (const sideX of [-w / 2, w / 2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, Math.hypot(len, h)), edgeMat || structEdgeMat);
    rail.position.set(sideX, h / 2 + 0.1, len / 2);
    rail.rotation.x = -Math.atan2(h, len);
    mesh.add(rail);
  }
  return mesh;
}

/* ---------- overpasses (ramp - deck - ramp over an intersection) ---------- */
(() => {
  const defs = [
    { i: 5, k: 11, axis: 'z' },
    { i: 16, k: 7, axis: 'z' },
    { i: 11, k: 16, axis: 'x' },
    { i: 7, k: 5, axis: 'x' },
  ];
  const H = 6.2, RAMP = 20, DECK = 26, W = 10;
  const grp = new THREE.Group();
  const pillarGeo = new THREE.CylinderGeometry(0.5, 0.6, H, 8);
  for (const o of defs) {
    const x = -HALF + o.i * CELL, z = -HALF + o.k * CELL;
    const dx = o.axis === 'x' ? 1 : 0, dz = o.axis === 'z' ? 1 : 0;
    for (const s of [-1, 1]) {
      buildRamp(grp,
        x + dx * s * (DECK / 2 + RAMP), z + dz * s * (DECK / 2 + RAMP),
        -dx * s, -dz * s, RAMP, W, H, 0);
    }
    decks.push(o.axis === 'x'
      ? { x0: x - DECK / 2, x1: x + DECK / 2, z0: z - W / 2, z1: z + W / 2, y: H }
      : { x0: x - W / 2, x1: x + W / 2, z0: z - DECK / 2, z1: z + DECK / 2, y: H });
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(dx ? DECK : W, 0.5, dz ? DECK : W), structBodyMat);
    deck.position.set(x, H - 0.25, z);
    deck.castShadow = true; deck.receiveShadow = true;
    grp.add(deck);
    for (const rs of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(dx ? DECK : 0.2, 0.2, dz ? DECK : 0.2), structEdgeMat);
      rail.position.set(x + (1 - dx) * rs * (W / 2 - 0.2), H + 0.35, z + (1 - dz) * rs * (W / 2 - 0.2));
      grp.add(rail);
    }
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const px = x + dx * a * (DECK / 2 - 2) + (1 - dx) * b * (W / 2 - 0.8);
      const pz = z + dz * a * (DECK / 2 - 2) + (1 - dz) * b * (W / 2 - 0.8);
      const pil = new THREE.Mesh(pillarGeo, structDarkMat);
      pil.position.set(px, H / 2, pz);
      grp.add(pil);
      addColliderSpan(px - 0.6, px + 0.6, pz - 0.6, pz + 0.6, H - 0.6);
    }
    addGlow(x, H + 1.4, z, 0x00e5ff, 9, 0.5);
  }
  scene.add(grp);
})();

/* ---------- tunnels (neon-lit shells over road segments, rideable roofs) ---------- */
(() => {
  const defs = [
    { axis: 'z', i: 15, k0: 5, k1: 8 },
    { axis: 'x', k: 4, i0: 10, i1: 13 },
  ];
  const grp = new THREE.Group();
  for (const t of defs) {
    let x0, x1, z0, z1;
    if (t.axis === 'z') {
      const xc = -HALF + t.i * CELL;
      x0 = xc - 9.6; x1 = xc + 9.6;
      z0 = -HALF + t.k0 * CELL + 14; z1 = -HALF + t.k1 * CELL - 14;
    } else {
      const zc = -HALF + t.k * CELL;
      z0 = zc - 9.6; z1 = zc + 9.6;
      x0 = -HALF + t.i0 * CELL + 14; x1 = -HALF + t.i1 * CELL - 14;
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const L = t.axis === 'z' ? z1 - z0 : x1 - x0;
    // side walls
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(t.axis === 'z' ? 1 : L, 5, t.axis === 'z' ? L : 1), structDarkMat);
      const wx = t.axis === 'z' ? cx + s * 8.6 : cx;
      const wz = t.axis === 'z' ? cz : cz + s * 8.6;
      wall.position.set(wx, 2.5, wz);
      wall.castShadow = true; wall.receiveShadow = true;
      grp.add(wall);
      if (t.axis === 'z') addColliderSpan(wx - 0.5, wx + 0.5, z0, z1, 5.2);
      else addColliderSpan(x0, x1, wz - 0.5, wz + 0.5, 5.2);
    }
    // roof (rideable)
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(t.axis === 'z' ? 19.5 : L, 0.6, t.axis === 'z' ? L : 19.5), structBodyMat);
    roof.position.set(cx, 5.7, cz);
    roof.castShadow = true; roof.receiveShadow = true;
    grp.add(roof);
    decks.push(t.axis === 'z'
      ? { x0: cx - 9.75, x1: cx + 9.75, z0, z1, y: 6.0 }
      : { x0, x1, z0: cz - 9.75, z1: cz + 9.75, y: 6.0 });
    // interior glow strips
    const n = Math.floor(L / 14);
    for (let gI = 0; gI <= n; gI++) {
      const a = (t.axis === 'z' ? z0 : x0) + gI * 14 + 7;
      for (const s of [-1, 1]) {
        const gx = t.axis === 'z' ? cx + s * 7.9 : a;
        const gz = t.axis === 'z' ? a : cz + s * 7.9;
        addGlow(gx, 3.7, gz, 0xff9a3d, 5, 0.5);
      }
    }
    // entrance markers
    for (const e of [[x0, cz, t.axis === 'x'], [x1, cz, t.axis === 'x'], [cx, z0, t.axis === 'z'], [cx, z1, t.axis === 'z']]) {
      if (!e[2]) continue;
      addGlow(t.axis === 'z' ? cx : e[0], 6.6, t.axis === 'z' ? e[1] : cz, 0x00e5ff, 8, 0.7);
    }
  }
  scene.add(grp);
})();

/* ---------- alley floors + grip strips ---------- */
(() => {
  const grp = new THREE.Group();
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x141a16, roughness: 0.85, metalness: 0.05, emissive: 0x0a2a14, emissiveIntensity: 0.25 });
  for (const a of ALLEYS) {
    let x0, x1, z0, z1;
    if (a.axis === 'x') {
      const cz = -HALF + a.bz * CELL + CELL / 2;
      x0 = -HALF + a.b0 * CELL + 9; x1 = -HALF + (a.b1 + 1) * CELL - 9;
      z0 = cz - 4.5; z1 = cz + 4.5;
    } else {
      const cx = -HALF + a.bx * CELL + CELL / 2;
      z0 = -HALF + a.b0 * CELL + 9; z1 = -HALF + (a.b1 + 1) * CELL - 9;
      x0 = cx - 4.5; x1 = cx + 4.5;
    }
    roadStrips.push({ x0, x1, z0, z1 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.12, z1 - z0), floorMat);
    floor.position.set((x0 + x1) / 2, 0.56, (z0 + z1) / 2);
    floor.receiveShadow = true;
    grp.add(floor);
    // breadcrumb glows so explorers can read the lane
    const L = a.axis === 'x' ? x1 - x0 : z1 - z0;
    for (let d = 12; d < L; d += 26) {
      const gx = a.axis === 'x' ? x0 + d : (x0 + x1) / 2;
      const gz = a.axis === 'x' ? (z0 + z1) / 2 : z0 + d;
      addGlow(gx, 1.1, gz, 0x7cff4d, 3.4, 0.4);
    }
  }
  scene.add(grp);
})();

/* ---------- rooftop stunt zone (warehouse roof run) ---------- */
(() => {
  const grp = new THREE.Group();
  const roofY = 16.5;
  const cxs = STUNT_BLOCKS.map((b) => -HALF + b[0] * CELL + CELL / 2);
  const czs = STUNT_BLOCKS.map((b) => -HALF + b[1] * CELL + CELL / 2);
  const ringGeo = new THREE.TorusGeometry(3.4, 0.28, 10, 36);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2d95 });
  // access mega-ramp from the road west of block (19,8)
  const xr = -HALF + 19 * CELL;
  const cz8 = -HALF + 8 * CELL + CELL / 2;
  buildRamp(grp, xr - 8, cz8, 1, 0, 24, 9, roofY, 0, structWarmMat);
  addGlow(xr - 8, 3, cz8, 0xff9a3d, 10, 0.8);
  // roof bridges across the roads between the four warehouses
  const xRoad = -HALF + 20 * CELL, zRoad = -HALF + 9 * CELL;
  const cz9 = -HALF + 9 * CELL + CELL / 2;
  const cx19 = -HALF + 19 * CELL + CELL / 2, cx20 = -HALF + 20 * CELL + CELL / 2;
  const bridges = [
    { x0: xRoad - 17, x1: xRoad + 17, z0: cz8 - 5, z1: cz8 + 5 },
    { x0: xRoad - 17, x1: xRoad + 17, z0: cz9 - 5, z1: cz9 + 5 },
    { x0: cx19 - 5, x1: cx19 + 5, z0: zRoad - 17, z1: zRoad + 17 },
    { x0: cx20 - 5, x1: cx20 + 5, z0: zRoad - 17, z1: zRoad + 17 },
  ];
  for (const b of bridges) {
    decks.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, y: roofY });
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, 0.5, b.z1 - b.z0), structBodyMat);
    m.position.set((b.x0 + b.x1) / 2, roofY - 0.25, (b.z0 + b.z1) / 2);
    m.castShadow = true;
    grp.add(m);
  }
  // rooftop kicker ramps + rings over the crossings
  buildRamp(grp, cx19 + 6, cz8, 1, 0, 10, 6, 3, roofY, structWarmMat);
  buildRamp(grp, cx20 - 6, cz9, -1, 0, 10, 6, 3, roofY, structWarmMat);
  buildRamp(grp, cx19, cz8 + 8, 0, 1, 10, 6, 3, roofY, structWarmMat);
  const ringSpots = [[xRoad, roofY + 7, cz8], [cx19, roofY + 7, zRoad], [xRoad, roofY + 7, cz9]];
  for (const rs of ringSpots) {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(rs[0], rs[1], rs[2]);
    ring.rotation.y = rs[0] === xRoad ? Math.PI / 2 : 0;
    grp.add(ring);
    rings.push({ x: rs[0], y: rs[1], z: rs[2], mesh: ring, cd: 0 });
    addGlow(rs[0], rs[1], rs[2], 0xff2d95, 11, 0.4);
  }
  // perimeter rails on the roof edges
  for (let i = 0; i < STUNT_BLOCKS.length; i++) {
    for (const s of [-1, 1]) {
      const railX = new THREE.Mesh(new THREE.BoxGeometry(63, 0.16, 0.16), structWarmMat);
      railX.position.set(cxs[i], roofY + 0.4, czs[i] + s * 31.5);
      grp.add(railX);
      const railZ = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 63), structWarmMat);
      railZ.position.set(cxs[i] + s * 31.5, roofY + 0.4, czs[i]);
      grp.add(railZ);
    }
    addGlow(cxs[i], roofY + 2, czs[i], 0xffae3d, 9, 0.5);
  }
  scene.add(grp);
})();

/* ---------- waterfront: water parcels + palms ---------- */
(() => {
  if (waterParcels.length) {
    const geo = new THREE.BoxGeometry(SIDE + 2, 0.3, SIDE + 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0a2a3a, roughness: 0.1, metalness: 0.85,
      emissive: 0x0a3346, emissiveIntensity: 0.45,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, waterParcels.length);
    const dummy = new THREE.Object3D();
    waterParcels.forEach((w, i) => {
      dummy.position.set(w.x, 0.42, w.z);
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      addGlow(w.x, 1.4, w.z, 0x1a7a9a, 9, 0.22);
    });
    scene.add(mesh);
  }
  // palms along the waterfront sidewalks
  const spots = [];
  for (let bx = 0; bx <= 2; bx++) for (let bz = 0; bz < GRID; bz++) {
    if (districtAt(bx, bz) !== 'waterfront' || rng() < 0.35) continue;
    const cx = -HALF + bx * CELL + CELL / 2;
    const cz = -HALF + bz * CELL + CELL / 2;
    const o = SIDE / 2 - 3;
    spots.push([cx + R(-o, o), cz - o], [cx + R(-o, o), cz + o]);
  }
  if (spots.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 5, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.9 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const headGeo = new THREE.ConeGeometry(1.7, 1.4, 7);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x1a4a2a, roughness: 0.8, emissive: 0x0a2a12, emissiveIntensity: 0.5 });
    const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);
    const dummy = new THREE.Object3D();
    spots.forEach((p, i) => {
      dummy.position.set(p[0], 3, p[1]); dummy.rotation.set(0, 0, R(-0.08, 0.08));
      dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p[0], 5.6, p[1]);
      dummy.updateMatrix(); heads.setMatrixAt(i, dummy.matrix);
    });
    scene.add(trunks); scene.add(heads);
  }
})();

/* ---------- industrial props: shipping containers (rideable tops) ---------- */
(() => {
  const list = [];
  const COLS = [0xa04020, 0x3a6a8a, 0x8a8a30, 0x3a8a4a];
  for (let bx = GRID - 3; bx < GRID; bx++) for (let bz = 0; bz < GRID; bz++) {
    if (districtAt(bx, bz) !== 'industrial' || isStuntBlock(bx, bz) || rng() < 0.5) continue;
    const cx = -HALF + bx * CELL + CELL / 2;
    const cz = -HALF + bz * CELL + CELL / 2;
    const n = Math.floor(R(2, 5));
    for (let i = 0; i < n; i++) {
      const ox = cx + R(-24, 24), oz = cz + R(-24, 24);
      let clear = true;
      for (const b of getCollidersNear(ox, oz)) {
        if (ox > b.x0 - 4 && ox < b.x1 + 4 && oz > b.z0 - 4 && oz < b.z1 + 4) { clear = false; break; }
      }
      if (!clear) continue;
      const along = rng() < 0.5;
      const stack = rng() < 0.3 ? 2 : 1;
      list.push([ox, oz, along, stack, COLS[Math.floor(rng() * COLS.length)]]);
      const ex = along ? 3.3 : 1.5, ez = along ? 1.5 : 3.3;
      addCollider(bx, bz, ox - ex, ox + ex, oz - ez, oz + ez, 0.5 + 2.6 * stack);
    }
  }
  if (!list.length) return;
  let count = 0;
  for (const c of list) count += c[3];
  const geo = new THREE.BoxGeometry(2.5, 2.6, 6.2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.45 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let idx = 0;
  for (const c of list) {
    for (let s = 0; s < c[3]; s++) {
      dummy.position.set(c[0], 0.5 + 1.3 + s * 2.6, c[1]);
      dummy.rotation.set(0, (c[2] ? Math.PI / 2 : 0) + R(-0.08, 0.08), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix(); mesh.setMatrixAt(idx, dummy.matrix);
      col.setHex(c[4]); mesh.setColorAt(idx, col);
      idx++;
    }
  }
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
})();

/* ---------- downtown antennas ---------- */
(() => {
  if (!antennaSpots.length) return;
  const geo = new THREE.CylinderGeometry(0.1, 0.16, 1, 5);
  const mat = new THREE.MeshBasicMaterial({ color: 0x333344 });
  const mesh = new THREE.InstancedMesh(geo, mat, antennaSpots.length);
  const dummy = new THREE.Object3D();
  antennaSpots.forEach((a, i) => {
    dummy.position.set(a[0], a[1] + a[3] / 2, a[2]);
    dummy.scale.set(1, a[3], 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    addGlow(a[0], a[1] + a[3], a[2], 0xff3344, 3, 0.7);
  });
  scene.add(mesh);
})();

/* ---------- bake static glow points (rebuildable — race.js adds gate glows) ---------- */
let staticGlowPts = null;
const staticGlowMat = makePointsMaterial(glowTex);
glowMaterials.push(staticGlowMat);
function bakeStaticGlow() {
  if (staticGlowPts) {
    scene.remove(staticGlowPts);
    staticGlowPts.geometry.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(staticGlow.pos), 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(staticGlow.col), 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(staticGlow.size), 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(staticGlow.alpha), 1));
  staticGlowPts = new THREE.Points(geo, staticGlowMat);
  staticGlowPts.frustumCulled = false;
  scene.add(staticGlowPts);
}
bakeStaticGlow();

/* ---------- ground height (ramps, decks, sidewalk curbs) ---------- */
function groundHeightAt(x, z, y) {
  const yy = y === undefined ? 0 : y;
  let g = 0;
  // sidewalk curb: block interiors sit 0.5m above the road
  const ux = (x + HALF) % CELL, uz = (z + HALF) % CELL;
  const du = Math.min(Math.abs(ux), CELL - Math.abs(ux));
  const dv = Math.min(Math.abs(uz), CELL - Math.abs(uz));
  if (Math.min(du, dv) > ROADW / 2 && Math.abs(x) < HALF && Math.abs(z) < HALF) g = 0.5;
  for (const r of ramps) {
    if (r.y0 > 0 && yy < r.y0 - 1.6) continue;   // elevated ramps only count near their level
    const dx = x - r.x, dz = z - r.z;
    const t = dx * r.dx + dz * r.dz;              // distance along ramp
    if (t < 0 || t > r.len) continue;
    const s = Math.abs(dx * r.dz - dz * r.dx);    // lateral distance
    if (s > r.w / 2) continue;
    const h = (r.y0 || 0) + (t / r.len) * r.h;
    if (h > g) g = h;
  }
  for (const d of decks) {
    if (yy < d.y - 2.5) continue;                 // pass under freely
    if (x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1 && d.y > g) g = d.y;
  }
  return g;
}

/* ---------- prerendered world map (minimap base) ---------- */
const worldMapScale = 1024 / WORLD;   // base px per meter
const worldMapCanvas = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const s = worldMapScale;
  const DC = { downtown: '#1e1134', mid: '#160e24', industrial: '#201510', waterfront: '#0e1a26', hills: '#1e1626' };
  for (let bx = 0; bx < GRID; bx++) for (let bz = 0; bz < GRID; bz++) {
    g.fillStyle = DC[districtAt(bx, bz)];
    g.fillRect(bx * CELL * s, bz * CELL * s, CELL * s + 1, CELL * s + 1);
  }
  g.fillStyle = '#0d3346';
  for (const w of waterParcels) {
    g.fillRect((w.x + HALF - SIDE / 2) * s, (w.z + HALF - SIDE / 2) * s, SIDE * s, SIDE * s);
  }
  g.strokeStyle = '#3a2a58';
  g.lineWidth = Math.max(2, ROADW * s);
  for (let k = 0; k <= GRID; k++) {
    const p = k * CELL * s;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(1024, p); g.stroke();
  }
  // alleys (faint green lanes)
  g.strokeStyle = '#2e4a30'; g.lineWidth = 3;
  for (const a of roadStrips) {
    g.beginPath();
    g.moveTo((a.x0 + HALF) * s, ((a.z0 + a.z1) / 2 + HALF) * s);
    g.lineTo((a.x1 + HALF) * s, ((a.z0 + a.z1) / 2 + HALF) * s);
    if (a.x1 - a.x0 < a.z1 - a.z0) {
      g.moveTo(((a.x0 + a.x1) / 2 + HALF) * s, (a.z0 + HALF) * s);
      g.lineTo(((a.x0 + a.x1) / 2 + HALF) * s, (a.z1 + HALF) * s);
    }
    g.stroke();
  }
  // decks (overpasses, tunnel roofs, bridges)
  g.fillStyle = '#3a5a7a';
  for (const d of decks) {
    g.fillRect((d.x0 + HALF) * s, (d.z0 + HALF) * s, (d.x1 - d.x0) * s, (d.z1 - d.z0) * s);
  }
  // ramps
  g.fillStyle = '#00e5ff';
  for (const r of ramps) {
    g.fillRect((r.x + HALF) * s - 2, (r.z + HALF) * s - 2, 4, 4);
  }
  // stunt zone outline
  g.strokeStyle = '#ff9a3d'; g.lineWidth = 3;
  g.strokeRect((19 * CELL) * s, (8 * CELL) * s, 2 * CELL * s, 2 * CELL * s);
  // spire
  g.fillStyle = '#ff2d95';
  g.beginPath();
  g.arc((spireBlock.bx * CELL + CELL / 2) * s, (spireBlock.bz * CELL + CELL / 2) * s, 5, 0, TAU);
  g.fill();
  return c;
})();

/* ---------- lighting presets (dusk / night / rain) ---------- */
const LIGHT_PRESETS = {
  dusk: {
    zen: [0.045, 0.012, 0.13], mid: [0.21, 0.05, 0.31], hor: [0.86, 0.22, 0.42],
    fog: 0x38123f, fogDen: 0.00215, sun: 0xffa068, sunI: 1.05,
    hemiSky: 0x5a2f8a, hemiGnd: 0x150a24, hemiI: 0.72,
    expo: 1.12, rain: 0, roadRough: 0.92, roadColor: 0xffffff, roadEmis: 0.55,
  },
  night: {
    zen: [0.008, 0.004, 0.03], mid: [0.03, 0.015, 0.09], hor: [0.16, 0.05, 0.22],
    fog: 0x140a24, fogDen: 0.0028, sun: 0x6a5aff, sunI: 0.35,
    hemiSky: 0x2a1a4a, hemiGnd: 0x0a0614, hemiI: 0.55,
    expo: 1.22, rain: 0, roadRough: 0.92, roadColor: 0xffffff, roadEmis: 0.85,
  },
  rain: {
    zen: [0.02, 0.02, 0.05], mid: [0.06, 0.05, 0.12], hor: [0.22, 0.12, 0.28],
    fog: 0x1c1430, fogDen: 0.0034, sun: 0x8a7aa8, sunI: 0.5,
    hemiSky: 0x3a2a5a, hemiGnd: 0x0e0a18, hemiI: 0.6,
    expo: 1.15, rain: 1, roadRough: 0.25, roadColor: 0x8a8aa0, roadEmis: 0.75,
  },
};
function prepPreset(p) {
  return {
    zen: new THREE.Color(p.zen[0], p.zen[1], p.zen[2]),
    mid: new THREE.Color(p.mid[0], p.mid[1], p.mid[2]),
    hor: new THREE.Color(p.hor[0], p.hor[1], p.hor[2]),
    fog: new THREE.Color(p.fog), sun: new THREE.Color(p.sun),
    hemiSky: new THREE.Color(p.hemiSky), hemiGnd: new THREE.Color(p.hemiGnd),
    roadColor: new THREE.Color(p.roadColor),
    fogDen: p.fogDen, sunI: p.sunI, hemiI: p.hemiI, expo: p.expo,
    rain: p.rain, roadRough: p.roadRough, roadEmis: p.roadEmis,
  };
}
const LIGHT_ORDER = ['dusk', 'night', 'rain'];
const lightTargets = {};
for (const k of LIGHT_ORDER) lightTargets[k] = prepPreset(LIGHT_PRESETS[k]);
let lightCur = 'dusk';
let rainK = 0;
function cycleLighting() {
  lightCur = LIGHT_ORDER[(LIGHT_ORDER.indexOf(lightCur) + 1) % LIGHT_ORDER.length];
  return lightCur;
}
function applyLighting(dt) {
  const t = lightTargets[lightCur];
  const k = 1 - Math.exp(-1.4 * dt);
  const u = sky.material.uniforms;
  u.uZen.value.lerp(t.zen, k);
  u.uMid.value.lerp(t.mid, k);
  u.uHor.value.lerp(t.hor, k);
  scene.fog.color.lerp(t.fog, k);
  scene.fog.density = lerp(scene.fog.density, t.fogDen, k);
  sun.color.lerp(t.sun, k);
  sun.intensity = lerp(sun.intensity, t.sunI, k);
  hemi.color.lerp(t.hemiSky, k);
  hemi.groundColor.lerp(t.hemiGnd, k);
  hemi.intensity = lerp(hemi.intensity, t.hemiI, k);
  renderer.toneMappingExposure = lerp(renderer.toneMappingExposure, t.expo, k);
  roadMat.roughness = lerp(roadMat.roughness, t.roadRough, k);
  roadMat.color.lerp(t.roadColor, k);
  roadMat.emissiveIntensity = lerp(roadMat.emissiveIntensity, t.roadEmis, k);
  rainK = lerp(rainK, t.rain, k);
}

/* ---------- rain streaks ---------- */
const rainFx = (() => {
  const N = 700;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const alpha = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = R(-32, 32); pos[i * 3 + 1] = R(0, 28); pos[i * 3 + 2] = R(-32, 32);
    col.set([0.5, 0.62, 0.85], i * 3);
    size[i] = R(1.1, 1.9); alpha[i] = 0.4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = makePointsMaterial(particleTex);
  glowMaterials.push(mat);
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.visible = false;
  scene.add(pts);
  return { pts, pos, N, geo };
})();
function updateRain(dt) {
  rainFx.pts.visible = rainK > 0.03;
  if (!rainFx.pts.visible) return;
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  const p = rainFx.pos;
  for (let i = 0; i < rainFx.N; i++) {
    p[i * 3 + 1] -= 36 * dt;
    if (p[i * 3 + 1] < cy - 6 ||
        Math.abs(p[i * 3] - cx) > 34 || Math.abs(p[i * 3 + 2] - cz) > 34) {
      p[i * 3] = cx + R(-30, 30);
      p[i * 3 + 1] = cy + R(6, 24);
      p[i * 3 + 2] = cz + R(-30, 30);
    }
  }
  rainFx.geo.attributes.position.needsUpdate = true;
}

/* ---------- wet-road glow smears (fake planar reflections) ---------- */
const smearFx = (() => {
  const n = staticGlow.size.length;
  if (!n) return null;
  // two crossed vertical quads, uv.y fades the streak upward
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
    0, 0, -0.5, 0, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5,
  ], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const aCol = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = staticGlow.alpha[i];
    aCol[i * 3] = staticGlow.col[i * 3] * a;
    aCol[i * 3 + 1] = staticGlow.col[i * 3 + 1] * a;
    aCol[i * 3 + 2] = staticGlow.col[i * 3 + 2] * a;
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 0 } },
    vertexShader: [
      'attribute vec3 aCol; varying vec3 vC; varying float vY;',
      'void main(){ vC = aCol; vY = uv.y;',
      '  vec4 p = instanceMatrix * vec4(position, 1.0);',
      '  gl_Position = projectionMatrix * modelViewMatrix * p; }',
    ].join('\n'),
    fragmentShader: [
      'uniform float uFade; varying vec3 vC; varying float vY;',
      'void main(){ float f = (1.0 - vY); gl_FragColor = vec4(vC * f * f * uFade * 0.55, 1.0); }',
    ].join('\n'),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 3));
  const dummy = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const x = staticGlow.pos[i * 3], y = staticGlow.pos[i * 3 + 1], z = staticGlow.pos[i * 3 + 2];
    const s = staticGlow.size[i];
    dummy.position.set(x, 0.08, z);
    dummy.scale.set(s * 0.55, Math.min(9, y * 0.55), s * 0.55);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.frustumCulled = false; mesh.visible = false;
  scene.add(mesh);
  return { mesh, mat };
})();

/* ---------- post pipeline: bloom + speed warp + chromatic aberration ---------- */
const POST = (() => {
  let enabled = true, failed = false;
  let W = window.innerWidth, H = window.innerHeight;
  let sceneRT, brightRT, blurA, blurB;
  function mkRT(w, h, depth) {
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: !!depth,
    });
  }
  function alloc() {
    sceneRT = mkRT(W, H, true);
    sceneRT.texture.encoding = THREE.sRGBEncoding;
    brightRT = mkRT(W >> 1, H >> 1);
    blurA = mkRT(W >> 2, H >> 2);
    blurB = mkRT(W >> 2, H >> 2);
  }
  try { alloc(); } catch (err) { failed = true; }
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
  quad.frustumCulled = false;
  quadScene.add(quad);
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const brightMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null } },
    vertexShader: VS,
    fragmentShader: [
      'uniform sampler2D uTex; varying vec2 vUv;',
      'void main(){',
      '  vec3 c = texture2D(uTex, vUv).rgb;',
      '  float l = dot(c, vec3(0.299, 0.587, 0.114));',
      '  gl_FragColor = vec4(c * smoothstep(0.6, 0.95, l), 1.0);',
      '}',
    ].join('\n'),
    depthWrite: false, depthTest: false,
  });
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } },
    vertexShader: VS,
    fragmentShader: [
      'uniform sampler2D uTex; uniform vec2 uDir; varying vec2 vUv;',
      'void main(){',
      '  vec3 a = texture2D(uTex, vUv).rgb * 0.227;',
      '  a += texture2D(uTex, vUv + uDir * 1.384).rgb * 0.316;',
      '  a += texture2D(uTex, vUv - uDir * 1.384).rgb * 0.316;',
      '  a += texture2D(uTex, vUv + uDir * 3.230).rgb * 0.07;',
      '  a += texture2D(uTex, vUv - uDir * 3.230).rgb * 0.07;',
      '  gl_FragColor = vec4(a, 1.0);',
      '}',
    ].join('\n'),
    depthWrite: false, depthTest: false,
  });
  const combineMat = new THREE.ShaderMaterial({
    uniforms: { uScene: { value: null }, uBloom: { value: null }, uWarp: { value: 0 } },
    vertexShader: VS,
    fragmentShader: [
      'uniform sampler2D uScene; uniform sampler2D uBloom; uniform float uWarp;',
      'varying vec2 vUv;',
      'void main(){',
      '  vec2 c = vUv - 0.5;',
      '  float r = length(c);',
      '  float ab = 0.0035 * (r + uWarp * 0.5);',
      '  vec3 col;',
      '  col.g = texture2D(uScene, vUv).g;',
      '  col.r = texture2D(uScene, vUv + c * ab).r;',
      '  col.b = texture2D(uScene, vUv - c * ab).b;',
      '  if (uWarp > 0.01) {',       // radial motion blur toward screen center
      '    vec2 stp = c * uWarp * 0.05;',
      '    vec3 acc = col;',
      '    acc += texture2D(uScene, vUv - stp).rgb;',
      '    acc += texture2D(uScene, vUv - stp * 2.0).rgb;',
      '    acc += texture2D(uScene, vUv - stp * 3.0).rgb;',
      '    col = mix(col, acc * 0.25, clamp(uWarp * r * 2.6, 0.0, 0.8));',
      '  }',
      '  col += texture2D(uBloom, vUv).rgb * 0.85;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
    depthWrite: false, depthTest: false,
  });
  function draw(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }
  return {
    isOn: () => enabled && !failed,
    toggle() { enabled = !enabled; return enabled && !failed; },
    resize(w, h) {
      if (failed) return;
      W = w; H = h;
      sceneRT.dispose(); brightRT.dispose(); blurA.dispose(); blurB.dispose();
      try { alloc(); } catch (err) { failed = true; }
    },
    render(warp) {
      if (!enabled || failed) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }
      try {
        renderer.setRenderTarget(sceneRT);
        renderer.render(scene, camera);
        brightMat.uniforms.uTex.value = sceneRT.texture;
        draw(brightMat, brightRT);
        blurMat.uniforms.uTex.value = brightRT.texture;
        blurMat.uniforms.uDir.value.set(1 / Math.max(1, W >> 2), 0);
        draw(blurMat, blurA);
        blurMat.uniforms.uTex.value = blurA.texture;
        blurMat.uniforms.uDir.value.set(0, 1 / Math.max(1, H >> 2));
        draw(blurMat, blurB);
        combineMat.uniforms.uScene.value = sceneRT.texture;
        combineMat.uniforms.uBloom.value = blurB.texture;
        combineMat.uniforms.uWarp.value = warp;
        draw(combineMat, null);
      } catch (err) {
        failed = true;
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      }
    },
  };
})();

/* ---------- per-frame world animation ---------- */
function updateWorld(dt, t, focusX, focusZ) {
  applyLighting(dt);
  updateRain(dt);
  if (smearFx) {
    smearFx.mesh.visible = rainK > 0.03;
    smearFx.mat.uniforms.uFade.value = rainK;
  }
  sky.position.copy(camera.position);
  sun.position.set(focusX + SUN_DIR.x * 700, SUN_DIR.y * 700, focusZ + SUN_DIR.z * 700);
  sun.target.position.set(focusX, 0, focusZ);
  sun.target.updateMatrixWorld();
  for (const tex of wallTexes) tex.offset.y = -t * 0.12;
  spireRings.forEach((r, i) => { r.rotation.z = t * (0.25 + i * 0.12); });

  // orb spin + bob
  const dummy = new THREE.Object3D();
  const posAttr = orbGlow.geometry.attributes.position;
  orbs.forEach((o, i) => {
    if (!o.active) {
      dummy.position.set(0, -50, 0); dummy.scale.set(0.001, 0.001, 0.001);
    } else {
      const y = o.y + Math.sin(t * 2.2 + o.phase) * 0.25;
      dummy.position.set(o.x, y, o.z);
      dummy.rotation.set(0, t * 2 + o.phase, 0.5);
      dummy.scale.set(1, 1, 1);
      posAttr.setXYZ(i, o.x, y, o.z);
    }
    dummy.updateMatrix(); orbMesh.setMatrixAt(i, dummy.matrix);
  });
  orbMesh.instanceMatrix.needsUpdate = true;
  posAttr.needsUpdate = true;
}
