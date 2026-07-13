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
    uniforms: { uSunDir: { value: SUN_DIR } },
    vertexShader: 'varying vec3 vDir;\nvoid main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'varying vec3 vDir;',
      'uniform vec3 uSunDir;',
      'float hash21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }',
      'void main(){',
      '  vec3 d = normalize(vDir);',
      '  float h = d.y;',
      '  float sunD = max(dot(d, uSunDir), 0.0);',
      '  vec3 zen = vec3(0.045,0.012,0.13);',
      '  vec3 mid = vec3(0.21,0.05,0.31);',
      '  vec3 hor = vec3(0.86,0.22,0.42);',
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
{
  const { map, emis } = makeRoadTextures();
  const mat = new THREE.MeshStandardMaterial({
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

const buildingList = [];   // {x,z,w,d,h}
const spireBlock = { bx: 10, bz: 10 };

(function generateCity() {
  for (let bx = 0; bx < GRID; bx++) for (let bz = 0; bz < GRID; bz++) {
    if (bx === spireBlock.bx && bz === spireBlock.bz) continue;
    const cx = -HALF + bx * CELL + CELL / 2;
    const cz = -HALF + bz * CELL + CELL / 2;
    const d = Math.min(1, Math.hypot(cx, cz) / HALF);
    if (rng() < 0.045) continue;   // plaza
    const hMax = lerp(165, 24, Math.pow(d, 0.72));
    const roll = rng();
    let slots;
    if (roll < 0.28) slots = [[cx, cz, 60]];
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
      if (rng() < 0.06) h = Math.min(175, h * 1.7);   // occasional supertall
      buildingList.push({ x: px, z: pz, w, d: dp, h });
      addCollider(bx, bz, px - w / 2, px + w / 2, pz - dp / 2, pz + dp / 2, h + 0.5);
      if (h > 95) addGlow(px, h + 1.6, pz, 0xff3344, 5, 0.9);
    }
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
    dummy.position.set(b.x, 0.5 + b.h / 2, b.z);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    col.setHex(pick(FACADES)); mesh.setColorAt(i, col);
  });
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
})();

/* ---------- neon signs ---------- */
(() => {
  const signs = [];
  for (const b of buildingList) {
    if (b.h < 20 || rng() < 0.62) continue;
    const face = Math.floor(rng() * 4);   // 0:+x 1:-x 2:+z 3:-z
    const sw = R(4, 9), sh = R(2, 4.2);
    const sy = R(9, Math.min(b.h - 5, 46));
    let x = b.x, z = b.z, ry = 0;
    if (face === 0) { x += b.w / 2 + 0.25; ry = Math.PI / 2; }
    else if (face === 1) { x -= b.w / 2 + 0.25; ry = -Math.PI / 2; }
    else if (face === 2) { z += b.d / 2 + 0.25; ry = 0; }
    else { z -= b.d / 2 + 0.25; ry = Math.PI; }
    const color = pick(NEON);
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
    lampPos.push([cx + o, cz + o], [cx - o, cz - o]);
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
    addGlow(p[0], 7.1, p[1], 0xffb56a, 7, 0.55);
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

/* ---------- bake static glow points ---------- */
(() => {
  const n = staticGlow.size.length;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(staticGlow.pos), 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(staticGlow.col), 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(staticGlow.size), 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(staticGlow.alpha), 1));
  const mat = makePointsMaterial(glowTex);
  glowMaterials.push(mat);
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  void n;
})();

/* ---------- ground height (ramps) ---------- */
function groundHeightAt(x, z) {
  for (const r of ramps) {
    const dx = x - r.x, dz = z - r.z;
    const t = dx * r.dx + dz * r.dz;              // distance along ramp
    if (t < 0 || t > r.len) continue;
    const s = Math.abs(dx * r.dz - dz * r.dx);    // lateral distance
    if (s > r.w / 2) continue;
    return (t / r.len) * r.h;
  }
  return 0;
}

/* ---------- per-frame world animation ---------- */
function updateWorld(dt, t, focusX, focusZ) {
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
