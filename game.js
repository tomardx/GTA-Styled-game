'use strict';
/* ============================================================
   NEON RUSH — game.js : bike, physics, traffic, FX, HUD, loop
   ============================================================ */

/* ================= AUDIO ================= */
const Audio2 = {
  ready: false, muted: false,
  init() {
    if (this.ready) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = this.ctx = new AC();
      const master = this.master = ctx.createGain();
      master.gain.value = 0.5; master.connect(ctx.destination);

      // shared noise buffer
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      const mkNoise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

      // engine
      this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
      this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
      this.engLP = ctx.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.frequency.value = 500;
      this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
      this.osc1.connect(this.engLP); this.osc2.connect(this.engLP);
      this.engLP.connect(this.engGain); this.engGain.connect(master);
      this.osc1.start(); this.osc2.start();

      // wind
      this.windBP = ctx.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 500; this.windBP.Q.value = 0.5;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
      mkNoise().connect(this.windBP); this.windBP.connect(this.windGain); this.windGain.connect(master);

      // skid
      this.skidBP = ctx.createBiquadFilter(); this.skidBP.type = 'bandpass'; this.skidBP.frequency.value = 1050; this.skidBP.Q.value = 3;
      this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0;
      mkNoise().connect(this.skidBP); this.skidBP.connect(this.skidGain); this.skidGain.connect(master);

      // boost hiss
      this.boostHP = ctx.createBiquadFilter(); this.boostHP.type = 'highpass'; this.boostHP.frequency.value = 1400;
      this.boostGain = ctx.createGain(); this.boostGain.gain.value = 0;
      mkNoise().connect(this.boostHP); this.boostHP.connect(this.boostGain); this.boostGain.connect(master);

      this.ready = true;
    } catch (err) { /* audio unavailable */ }
  },
  resume() { if (this.ready && this.ctx.state === 'suspended') this.ctx.resume(); },
  update(speed, throttle, boosting, drifting, grounded) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const gear = Math.floor(speed / 19);
    const rpm = (speed - gear * 19) / 19;
    const f = 58 + rpm * 130 + gear * 12 + (boosting ? 26 : 0);
    this.osc1.frequency.setTargetAtTime(f, t, 0.03);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.engLP.frequency.setTargetAtTime(380 + speed * 34 + throttle * 300, t, 0.06);
    this.engGain.gain.setTargetAtTime((0.055 + 0.075 * Math.max(throttle, boosting ? 1 : 0)) * (grounded ? 1 : 0.75), t, 0.08);
    this.windBP.frequency.setTargetAtTime(400 + speed * 26, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.pow(speed / 105, 1.6) * 0.4, t, 0.1);
    this.skidGain.gain.setTargetAtTime(drifting && grounded ? 0.13 : 0, t, 0.05);
    this.boostGain.gain.setTargetAtTime(boosting ? 0.16 : 0, t, 0.08);
  },
  beep(f0, f1, dur, type, vol) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, freq, vol) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur + 0.02);
  },
  pickup() { this.beep(880, 1760, 0.14, 'sine', 0.22); },
  ring() { this.beep(622, 1244, 0.3, 'triangle', 0.3); this.beep(932, 1865, 0.3, 'triangle', 0.18); },
  hop() { this.beep(190, 90, 0.12, 'square', 0.1); },
  land() { this.noise(0.12, 900, 0.18); },
  trickLand() { this.beep(523, 1046, 0.18, 'triangle', 0.25); this.beep(784, 1568, 0.25, 'triangle', 0.2); },
  miniTurbo() { this.beep(330, 830, 0.18, 'sawtooth', 0.16); },
  nearMiss() { this.beep(1500, 900, 0.1, 'sine', 0.14); },
  crash(v) { this.noise(0.35, 420, Math.min(0.45, 0.2 + v * 0.3)); this.beep(140, 40, 0.3, 'square', 0.12); },
  backfire() { this.noise(0.07, 1200, 0.22); },
  toggleMute() {
    if (!this.ready) return;
    this.muted = !this.muted;
    this.master.gain.value = this.muted ? 0 : 0.5;
  },
};

/* ================= PARTICLES ================= */
const PSYS = (() => {
  const N = 380;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
  const col = new Float32Array(N * 3), size = new Float32Array(N);
  const alpha = new Float32Array(N);
  const life = new Float32Array(N), age = new Float32Array(N);
  const grow = new Float32Array(N), grav = new Float32Array(N);
  const baseA = new Float32Array(N), baseS = new Float32Array(N);
  let cursor = 0;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = makePointsMaterial(particleTex);
  glowMaterials.push(mat);
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return {
    spawn(x, y, z, vx, vy, vz, lf, sz, gr, r, g, b, a, gv) {
      const i = cursor; cursor = (cursor + 1) % N;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
      life[i] = lf; age[i] = 0; baseS[i] = sz; grow[i] = gr;
      baseA[i] = a; grav[i] = gv || 0;
    },
    update(dt) {
      for (let i = 0; i < N; i++) {
        if (age[i] >= life[i]) { alpha[i] = 0; continue; }
        age[i] += dt;
        const t = Math.min(1, age[i] / life[i]);
        vel[i * 3 + 1] -= grav[i] * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        alpha[i] = baseA[i] * (1 - t);
        size[i] = baseS[i] * (1 + grow[i] * t);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    },
  };
})();

/* ================= TRAIL RIBBON ================= */
class Trail {
  constructor(n, width, colorHex) {
    this.n = n; this.w = width;
    this.pts = [];   // {x,y,z,a}
    const verts = n * 4;
    this.posArr = new Float32Array(verts * 3);
    this.aArr = new Float32Array(verts);
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 4, b = (i + 1) * 4;
      idx.push(a, b, a + 1, a + 1, b, b + 1);         // vertical strip
      idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3); // horizontal strip
    }
    const geo = this.geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.aArr, 1));
    geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(colorHex) } },
      vertexShader: 'attribute float aAlpha; varying float vA;\nvoid main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA;\nvoid main(){ gl_FragColor = vec4(uColor * vA, 1.0); }',
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  push(x, y, z, intensity) {
    this.pts.push({ x, y, z, a: intensity });
    if (this.pts.length > this.n) this.pts.shift();
  }
  update() {
    const pts = this.pts, n = this.n, w = this.w;
    for (let i = 0; i < n; i++) {
      const p = pts[Math.min(i, pts.length - 1)] || { x: 0, y: -100, z: 0, a: 0 };
      const q = pts[Math.min(i + 1, pts.length - 1)] || p;
      let sx = q.x - p.x, sz = q.z - p.z;
      const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
      const fade = pts.length > 1 ? i / (pts.length - 1) : 0;
      const a = p.a * fade;
      const o = i * 12;
      // vertical pair
      this.posArr[o] = p.x; this.posArr[o + 1] = p.y - w; this.posArr[o + 2] = p.z;
      this.posArr[o + 3] = p.x; this.posArr[o + 4] = p.y + w; this.posArr[o + 5] = p.z;
      // horizontal pair (perpendicular to path)
      this.posArr[o + 6] = p.x - sz * w; this.posArr[o + 7] = p.y; this.posArr[o + 8] = p.z + sx * w;
      this.posArr[o + 9] = p.x + sz * w; this.posArr[o + 10] = p.y; this.posArr[o + 11] = p.z - sx * w;
      const ao = i * 4;
      this.aArr[ao] = this.aArr[ao + 1] = this.aArr[ao + 2] = this.aArr[ao + 3] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}
const trail = new Trail(56, 0.32, 0x5df3ff);

/* ================= BIKE MODEL ================= */
const matCache = {};
function mkMat(color, emissive, rough, metal) {
  const key = color + '_' + (emissive || 0) + '_' + rough;
  if (!matCache[key]) {
    matCache[key] = new THREE.MeshStandardMaterial({
      color, roughness: rough !== undefined ? rough : 0.5,
      metalness: metal !== undefined ? metal : 0.55,
      emissive: emissive || 0x000000,
      emissiveIntensity: emissive ? 1.6 : 0,
    });
  }
  return matCache[key];
}
function bx(parent, w, h, d, color, x, y, z, opts) {
  opts = opts || {};
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mkMat(color, opts.emissive, opts.rough, opts.metal));
  m.position.set(x, y, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  m.castShadow = true;
  parent.add(m);
  return m;
}

const bikeGroup = new THREE.Group();
bikeGroup.scale.setScalar(1.15);
const leanGroup = new THREE.Group();
bikeGroup.add(leanGroup);
scene.add(bikeGroup);

const BODY_PINK = 0xff2d6f, DARK = 0x16121e, CYAN = 0x3af2ff;
let rearWheel, frontWheel, forkGroup, riderGroup, flames = [], headSpot;
(() => {
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = mkMat(0x0c0c12, 0, 0.85, 0.2);
  const ringGeo = new THREE.TorusGeometry(0.23, 0.028, 6, 24);
  ringGeo.rotateY(Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: CYAN });

  rearWheel = new THREE.Mesh(wheelGeo, wheelMat);
  rearWheel.position.set(0, 0.34, -0.78); rearWheel.castShadow = true;
  leanGroup.add(rearWheel);
  const rring = new THREE.Mesh(ringGeo, ringMat); rearWheel.add(rring);

  // swingarm + body
  bx(leanGroup, 0.1, 0.1, 0.7, DARK, 0, 0.4, -0.45);
  bx(leanGroup, 0.4, 0.3, 1.0, BODY_PINK, 0, 0.72, -0.05, { rough: 0.32, metal: 0.7 });          // tank
  bx(leanGroup, 0.34, 0.16, 0.62, BODY_PINK, 0, 0.86, -0.58, { rough: 0.32, metal: 0.7, rx: 0.22 }); // tail
  bx(leanGroup, 0.3, 0.12, 0.4, DARK, 0, 0.84, -0.25);                                          // seat
  bx(leanGroup, 0.05, 0.05, 0.5, CYAN, 0.21, 0.72, 0, { emissive: CYAN });                      // side strips
  bx(leanGroup, 0.05, 0.05, 0.5, CYAN, -0.21, 0.72, 0, { emissive: CYAN });
  bx(leanGroup, 0.36, 0.3, 0.42, DARK, 0, 0.52, 0.02);                                          // engine block
  bx(leanGroup, 0.34, 0.28, 0.35, BODY_PINK, 0, 0.78, 0.42, { rough: 0.32, metal: 0.7, rx: -0.3 }); // front fairing
  // windshield
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x88c8ff, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  ws.position.set(0, 0.98, 0.5); ws.rotation.x = -0.5;
  leanGroup.add(ws);
  // exhausts
  for (const sx of [-0.13, 0.13]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.5, 8), mkMat(0x2c2c38, 0, 0.3, 0.9));
    ex.rotation.x = Math.PI / 2; ex.position.set(sx, 0.45, -0.65); ex.castShadow = true;
    leanGroup.add(ex);
  }
  // tail light
  bx(leanGroup, 0.2, 0.07, 0.05, 0xff2030, 0, 0.92, -0.88, { emissive: 0xff2030 });

  // front fork assembly (steers)
  forkGroup = new THREE.Group();
  forkGroup.position.set(0, 0.95, 0.48);
  forkGroup.rotation.x = 0.32;
  leanGroup.add(forkGroup);
  for (const sx of [-0.09, 0.09]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 8), mkMat(0xb8b8cc, 0, 0.25, 0.95));
    tube.position.set(sx, -0.38, 0); tube.castShadow = true;
    forkGroup.add(tube);
  }
  bx(forkGroup, 0.52, 0.05, 0.06, DARK, 0, 0.06, 0);   // handlebar
  bx(forkGroup, 0.08, 0.05, 0.05, 0x444455, 0.28, 0.06, 0);
  bx(forkGroup, 0.08, 0.05, 0.05, 0x444455, -0.28, 0.06, 0);
  // headlight
  bx(forkGroup, 0.18, 0.12, 0.06, 0xfff3d0, 0, -0.06, 0.14, { emissive: 0xfff3d0 });
  frontWheel = new THREE.Mesh(wheelGeo, wheelMat);
  frontWheel.position.set(0, -0.65, 0.2); frontWheel.castShadow = true;
  forkGroup.add(frontWheel);
  const fring = new THREE.Mesh(ringGeo, ringMat); frontWheel.add(fring);

  // rider
  riderGroup = new THREE.Group();
  riderGroup.position.set(0, 0.9, -0.3);
  leanGroup.add(riderGroup);
  bx(riderGroup, 0.3, 0.24, 0.3, 0x1c1c2a, 0, 0.1, 0);                      // hips
  bx(riderGroup, 0.32, 0.5, 0.24, 0x24243c, 0, 0.4, 0.16, { rx: 0.75 });    // torso leaning forward
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), mkMat(0x18182a, 0, 0.25, 0.8));
  helmet.position.set(0, 0.62, 0.42); helmet.castShadow = true;
  riderGroup.add(helmet);
  bx(riderGroup, 0.2, 0.05, 0.02, CYAN, 0, 0.62, 0.56, { emissive: CYAN }); // visor
  bx(riderGroup, 0.09, 0.4, 0.09, 0x24243c, 0.24, 0.36, 0.42, { rx: 1.15 }); // arms
  bx(riderGroup, 0.09, 0.4, 0.09, 0x24243c, -0.24, 0.36, 0.42, { rx: 1.15 });
  bx(riderGroup, 0.11, 0.34, 0.13, 0x1c1c2a, 0.17, -0.05, 0.12, { rx: 0.8 }); // thighs
  bx(riderGroup, 0.11, 0.34, 0.13, 0x1c1c2a, -0.17, -0.05, 0.12, { rx: 0.8 });

  // boost flames
  const flameGeo = new THREE.ConeGeometry(0.075, 0.6, 8);
  flameGeo.rotateX(-Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x7df6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const sx of [-0.13, 0.13]) {
    const fl = new THREE.Mesh(flameGeo, flameMat);
    fl.position.set(sx, 0.45, -1.05); fl.visible = false;
    leanGroup.add(fl); flames.push(fl);
  }

  // headlight spot + underglow
  headSpot = new THREE.SpotLight(0xfff2cc, 2.2, 70, 0.42, 0.55, 1.4);
  headSpot.position.set(0, 1.0, 0.6);
  bikeGroup.add(headSpot);
  const spotTarget = new THREE.Object3D(); spotTarget.position.set(0, 0, 40);
  bikeGroup.add(spotTarget); headSpot.target = spotTarget;
  const under = new THREE.PointLight(0xff2d95, 1.4, 11, 2);
  under.position.set(0, 0.3, 0);
  bikeGroup.add(under);
})();

/* ================= TRAFFIC ================= */
const CARS = 60;
const cars = [];
let carBodies, carCabins, carLights;
(() => {
  const CAR_COLORS = [0x8a2242, 0x22406a, 0x555f6e, 0x6a4a22, 0x2a5a44, 0x4a2a6a, 0x777788, 0x993322];
  for (let i = 0; i < CARS; i++) {
    const axis = rng() < 0.5 ? 'x' : 'z';
    const k = Math.floor(R(1, GRID));
    cars.push({
      axis, road: -HALF + k * CELL,
      sign: rng() < 0.5 ? 1 : -1,
      s: R(-HALF + 20, HALF - 20),
      speed: R(11, 19), nm: 0,
      color: pick(CAR_COLORS),
    });
  }
  const bodyGeo = new THREE.BoxGeometry(1.9, 0.6, 4.5);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.6 });
  carBodies = new THREE.InstancedMesh(bodyGeo, bodyMat, CARS);
  carBodies.castShadow = true;
  const c = new THREE.Color();
  cars.forEach((car, i) => { c.setHex(car.color); carBodies.setColorAt(i, c); });
  scene.add(carBodies);

  const cabGeo = new THREE.BoxGeometry(1.7, 0.55, 2.1);
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x0e1018, roughness: 0.2, metalness: 0.8 });
  carCabins = new THREE.InstancedMesh(cabGeo, cabMat, CARS);
  scene.add(carCabins);

  const liteGeo = new THREE.BoxGeometry(0.32, 0.16, 0.08);
  const liteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  carLights = new THREE.InstancedMesh(liteGeo, liteMat, CARS * 4);
  cars.forEach((car, i) => {
    c.setHex(0xffeecc); carLights.setColorAt(i * 4, c); carLights.setColorAt(i * 4 + 1, c);
    c.setHex(0xff2222); carLights.setColorAt(i * 4 + 2, c); carLights.setColorAt(i * 4 + 3, c);
  });
  scene.add(carLights);
})();

const carDummy = new THREE.Object3D();
const liteOffsets = [
  new THREE.Vector3(0.6, 0.72, 2.26), new THREE.Vector3(-0.6, 0.72, 2.26),
  new THREE.Vector3(0.6, 0.68, -2.26), new THREE.Vector3(-0.6, 0.68, -2.26),
];
const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpV = new THREE.Vector3();
function updateTraffic(dt) {
  cars.forEach((car, i) => {
    car.s += car.speed * car.sign * dt;
    if (car.s > HALF - 6) car.s = -HALF + 6;
    if (car.s < -HALF + 6) car.s = HALF - 6;
    if (car.nm > 0) car.nm -= dt;
    let x, z, yaw;
    if (car.axis === 'x') { x = car.s; z = car.road - 5.2 * car.sign; yaw = car.sign > 0 ? Math.PI / 2 : -Math.PI / 2; }
    else { x = car.road - 5.2 * car.sign; z = car.s; yaw = car.sign > 0 ? 0 : Math.PI; }
    car.x = x; car.z = z;
    car.hx = car.axis === 'x' ? 2.5 : 1.15;
    car.hz = car.axis === 'x' ? 1.15 : 2.5;
    carDummy.position.set(x, 0.65, z);
    carDummy.rotation.set(0, yaw, 0);
    carDummy.updateMatrix();
    carBodies.setMatrixAt(i, carDummy.matrix);
    carDummy.position.y = 1.15; carDummy.updateMatrix();
    carCabins.setMatrixAt(i, carDummy.matrix);
    carDummy.position.y = 0; carDummy.updateMatrix();
    for (let l = 0; l < 4; l++) {
      tmpM2.makeTranslation(liteOffsets[l].x, liteOffsets[l].y, liteOffsets[l].z);
      tmpM.multiplyMatrices(carDummy.matrix, tmpM2);
      carLights.setMatrixAt(i * 4 + l, tmpM);
    }
  });
  carBodies.instanceMatrix.needsUpdate = true;
  carCabins.instanceMatrix.needsUpdate = true;
  carLights.instanceMatrix.needsUpdate = true;
}

/* ================= INPUT ================= */
const keys = {};
const pressed = {};
const KEYMAP = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd' };
window.addEventListener('keydown', (e) => {
  let k = e.key.toLowerCase();
  if (k === ' ') k = 'space';
  if (KEYMAP[k]) k = KEYMAP[k];
  if (['w', 'a', 's', 'd', 'space', 'shift', 'q', 'e'].includes(k)) e.preventDefault();
  if (!keys[k]) pressed[k] = true;
  keys[k] = true;
  handleMetaKeys(k, e);
});
window.addEventListener('keyup', (e) => {
  let k = e.key.toLowerCase();
  if (k === ' ') k = 'space';
  if (KEYMAP[k]) k = KEYMAP[k];
  keys[k] = false;
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

/* ================= GAME STATE ================= */
const B = {
  x: -5, y: 0, z: -420,
  vy: 0, speed: 0,
  velAngle: 0, bikeYaw: 0,
  driftOffset: 0, drift: 0, driftTime: 0,
  grounded: true, airTime: 0, rampRise: 0,
  spinVel: 0, trickAccum: 0,
  wobble: 0, wheelRot: 0,
  boost: 60, boosting: false, boostK: 0,
  lean: 0, pitch: 0, accelSmooth: 0,
};
let score = 0, chain = 0, comboTimer = 0;
let best = 0;
try { best = parseInt(localStorage.getItem('neonrush_best') || '0', 10) || 0; } catch (err) { }
let gameState = 'title';   // title | play | pause
let shakeT = 0;
let elapsed = 0;
const DEMO = /autostart/.test(location.search);

const angleDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

/* ================= HUD ================= */
const $ = (id) => document.getElementById(id);
const elSpd = $('spd'), elBoostBar = $('boostbar'), elScore = $('score'),
  elBest = $('best'), elCombo = $('combo'), elComboBar = $('combobar'),
  elPopups = $('popups'), elOverlay = $('overlay'), elOvTitle = $('ovtitle'),
  elOvSub = $('ovsub'), elHint = $('hint');
elBest.textContent = 'BEST ' + best.toLocaleString();

function popup(text, color, big) {
  const d = document.createElement('div');
  d.className = 'pop' + (big ? ' big' : '');
  d.textContent = text;
  d.style.color = color;
  d.style.textShadow = '0 0 12px ' + color + ', 0 0 40px ' + color;
  elPopups.appendChild(d);
  while (elPopups.children.length > 4) elPopups.removeChild(elPopups.firstChild);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 1100);
}
function mult() { return Math.min(10, 1 + Math.floor(chain / 2)); }
function addScore(base, label, color, big) {
  const m = mult();
  score += base * m;
  chain++; comboTimer = 5;
  popup(label + '  +' + (base * m).toLocaleString(), color, big);
}
function breakCombo() {
  chain = 0; comboTimer = 0;
}

/* ================= FX OVERLAY (speed lines) ================= */
const fxCanvas = $('fx');
const fxCtx = fxCanvas.getContext('2d');
function sizeFx() { fxCanvas.width = window.innerWidth; fxCanvas.height = window.innerHeight; }
sizeFx();
window.onGameResize = () => { sizeFx(); updatePxScale(); };

function drawFx(speedK, boostK) {
  const w = fxCanvas.width, h = fxCanvas.height;
  fxCtx.clearRect(0, 0, w, h);
  const f = Math.max(0, speedK - 0.45) * 1.8 + boostK * 0.7;
  if (f < 0.05 || gameState !== 'play') return;
  const cx = w / 2, cy = h / 2;
  const n = Math.floor(10 + f * 26);
  fxCtx.save();
  fxCtx.translate(cx, cy);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const r0 = (0.32 + Math.random() * 0.3) * Math.min(w, h);
    const len = (30 + Math.random() * 160) * f;
    fxCtx.strokeStyle = 'rgba(' + (boostK > 0.4 ? '150,240,255' : '255,220,255') + ',' + (Math.random() * 0.4 * f).toFixed(3) + ')';
    fxCtx.lineWidth = 1 + Math.random() * 1.6;
    fxCtx.beginPath();
    fxCtx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    fxCtx.lineTo(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len));
    fxCtx.stroke();
  }
  fxCtx.restore();
}

/* ================= MINIMAP ================= */
const mapCanvas = $('map');
const mapCtx = mapCanvas.getContext('2d');
const mapBase = document.createElement('canvas');
mapBase.width = mapBase.height = 170;
(() => {
  const g = mapBase.getContext('2d');
  const sc = 170 / WORLD;
  g.fillStyle = '#120a20'; g.fillRect(0, 0, 170, 170);
  g.strokeStyle = '#332450'; g.lineWidth = Math.max(1.4, ROADW * sc);
  for (let k = 0; k <= GRID; k++) {
    const p = (k * CELL) * sc;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 170); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(170, p); g.stroke();
  }
  g.strokeStyle = '#ff2d95'; g.lineWidth = 2;
  g.strokeRect(1, 1, 168, 168);
  // ramps
  g.fillStyle = '#00e5ff';
  for (const r of ramps) {
    g.fillRect((r.x + HALF) * sc - 1.5, (r.z + HALF) * sc - 1.5, 3, 3);
  }
})();
const w2m = (v) => (v + HALF) * (170 / WORLD);
function drawMinimap() {
  mapCtx.clearRect(0, 0, 170, 170);
  mapCtx.drawImage(mapBase, 0, 0);
  mapCtx.fillStyle = '#49f8ff';
  for (const o of orbs) if (o.active) mapCtx.fillRect(w2m(o.x) - 1, w2m(o.z) - 1, 2, 2);
  mapCtx.fillStyle = '#ffaa44';
  for (const c of cars) mapCtx.fillRect(w2m(c.x || 0) - 1, w2m(c.z || 0) - 1, 2, 2);
  // player arrow
  const px = w2m(B.x), pz = w2m(B.z);
  mapCtx.save();
  mapCtx.translate(px, pz);
  mapCtx.rotate(-B.velAngle);
  mapCtx.fillStyle = '#ffffff';
  mapCtx.shadowColor = '#ff2d95'; mapCtx.shadowBlur = 6;
  mapCtx.beginPath();
  mapCtx.moveTo(0, 5); mapCtx.lineTo(-3.4, -4); mapCtx.lineTo(3.4, -4);
  mapCtx.closePath(); mapCtx.fill();
  mapCtx.restore();
}

/* ================= PHYSICS HELPERS ================= */
function roofHeightAt(x, z, y) {
  let h = 0;
  for (const b of getCollidersNear(x, z)) {
    if (b.h > 400) continue;
    if (x > b.x0 + 0.3 && x < b.x1 - 0.3 && z > b.z0 + 0.3 && z < b.z1 - 0.3 && y >= b.h - 0.8) {
      if (b.h > h) h = b.h;
    }
  }
  return h;
}
function groundAt(x, z, y) {
  return Math.max(groundHeightAt(x, z), roofHeightAt(x, z, y));
}

function collideWorld(dt) {
  const r = 0.9;
  // buildings
  for (const b of getCollidersNear(B.x, B.z)) {
    if (B.y >= b.h - 0.6) continue;   // above roof
    const cx = clamp(B.x, b.x0, b.x1), cz = clamp(B.z, b.z0, b.z1);
    let dx = B.x - cx, dz = B.z - cz;
    let d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    let d = Math.sqrt(d2), nx, nz;
    if (d < 0.001) {
      // center inside box: push along smallest penetration axis
      const pL = B.x - b.x0, pR = b.x1 - B.x, pB = B.z - b.z0, pT = b.z1 - B.z;
      const m = Math.min(pL, pR, pB, pT);
      nx = m === pL ? -1 : m === pR ? 1 : 0;
      nz = m === pB ? -1 : m === pT ? 1 : 0;
      B.x += nx * (m + r); B.z += nz * (m + r);
    } else {
      nx = dx / d; nz = dz / d;
      B.x += nx * (r - d); B.z += nz * (r - d);
    }
    hitResponse(nx, nz);
  }
  // cars
  for (const c of cars) {
    const ex = c.hx + r, ez = c.hz + r;
    if (Math.abs(B.x - c.x) < ex && Math.abs(B.z - c.z) < ez && B.y < 1.6) {
      const pX = ex - Math.abs(B.x - c.x), pZ = ez - Math.abs(B.z - c.z);
      let nx = 0, nz = 0;
      if (pX < pZ) { nx = Math.sign(B.x - c.x) || 1; B.x += nx * pX; }
      else { nz = Math.sign(B.z - c.z) || 1; B.z += nz * pZ; }
      hitResponse(nx, nz);
      c.nm = 6;
    }
  }
  // boundary walls
  const lim = HALF - 1.5;
  if (Math.abs(B.x) > lim) { B.x = Math.sign(B.x) * lim; hitResponse(-Math.sign(B.x), 0); }
  if (Math.abs(B.z) > lim) { B.z = Math.sign(B.z) * lim; hitResponse(0, -Math.sign(B.z)); }
}

function hitResponse(nx, nz) {
  const vx = Math.sin(B.velAngle) * B.speed, vz = Math.cos(B.velAngle) * B.speed;
  const vn = vx * nx + vz * nz;
  if (vn >= 0) return;
  const impact = -vn;
  const sx = vx - nx * vn, sz = vz - nz * vn;
  const sl = Math.hypot(sx, sz);
  if (sl > 1) {
    B.velAngle = Math.atan2(sx, sz);
    B.speed = sl;
  } else {
    B.speed = Math.min(B.speed, 1);
  }
  B.speed *= Math.max(0.2, 1 - impact * 0.018);
  if (impact > 9) {
    shakeT = Math.min(1, 0.25 + impact * 0.012);
    Audio2.crash(impact / 40);
    breakCombo();
    if (B.drift) { B.drift = 0; B.driftTime = 0; }
    B.wobble = Math.min(1, impact * 0.03);
    // sparks
    for (let i = 0; i < 14; i++) {
      PSYS.spawn(B.x - nx * 0.5, B.y + 0.5 + Math.random() * 0.5, B.z - nz * 0.5,
        nx * R(2, 9) + R(-4, 4), R(1, 7), nz * R(2, 9) + R(-4, 4),
        R(0.25, 0.6), R(0.18, 0.4), 1.5, 1.0, 0.7, 0.25, 0.9, 22);
    }
    if (impact > 25) popup('CRASH', '#ff5566', false);
  }
}

/* ================= DRIFT / TRICKS ================= */
function startDrift(dir) {
  B.drift = dir; B.driftTime = 0;
  Audio2.beep(240, 420, 0.1, 'sawtooth', 0.1);
}
function endDrift(cancel) {
  if (!cancel && B.driftTime > 0.75) {
    const superD = B.driftTime > 1.7;
    const pts = Math.round(B.driftTime * 15) * 10;
    addScore(pts, superD ? 'SUPER DRIFT' : 'DRIFT BOOST', superD ? '#ff5fb0' : '#6ff7ff', superD);
    B.speed += superD ? 10 : 5;
    B.boost = Math.min(100, B.boost + (superD ? 20 : 9));
    Audio2.miniTurbo();
    shakeT = Math.max(shakeT, superD ? 0.28 : 0.15);
  }
  B.drift = 0; B.driftTime = 0;
}

function onLand() {
  const wasAir = B.airTime;
  const diff = angleDiff(B.bikeYaw, B.velAngle);
  const off = Math.abs(diff);
  const clean = off < 0.72;
  const backwards = off > 2.5;
  if (B.trickAccum > 2.6 && clean) {
    const halfSpins = Math.max(1, Math.round(B.trickAccum / Math.PI));
    const deg = halfSpins * 180;
    addScore(250 * halfSpins, deg >= 720 ? deg + '°!! INSANE' : deg + '° SPIN', '#ff9df0', deg >= 540);
    B.boost = Math.min(100, B.boost + 8 + 6 * halfSpins);
    Audio2.trickLand();
  } else if (wasAir > 1.0 && clean) {
    addScore(150, 'BIG AIR', '#7cf6ff', false);
    B.boost = Math.min(100, B.boost + 10);
    Audio2.trickLand();
  }
  if (backwards) {
    B.speed *= 0.25; B.wobble = 1; shakeT = Math.max(shakeT, 0.5);
    Audio2.crash(0.4); popup('WIPEOUT', '#ff5566', true); breakCombo();
  } else if (!clean) {
    B.speed *= 0.62; B.wobble = 0.7; shakeT = Math.max(shakeT, 0.25);
    Audio2.land();
  } else if (wasAir > 0.35) {
    Audio2.land();
    // landing dust
    for (let i = 0; i < 8; i++) {
      PSYS.spawn(B.x + R(-0.5, 0.5), B.y + 0.15, B.z + R(-0.5, 0.5),
        R(-3, 3), R(0.5, 2), R(-3, 3), R(0.3, 0.6), R(0.5, 0.9), 2.5,
        0.65, 0.45, 0.75, 0.35, 4);
    }
  }
  B.velAngle = B.bikeYaw = B.velAngle + (clean ? clamp(diff, -0.35, 0.35) : 0);
  B.trickAccum = 0; B.spinVel = 0; B.airTime = 0;
  B.grounded = true; B.vy = 0;
  if ((keys.q || keys.e) && B.speed > 15 && !backwards) startDrift(keys.q ? 1 : -1);
}

/* ================= MAIN UPDATE ================= */
const tmpWorld = new THREE.Vector3();
let prevW = false, backfireT = 0;
function updateBike(dt) {
  const steer = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
  const throttle = keys.w ? 1 : (keys.s ? -1 : 0);
  const demoSteer = DEMO ? Math.sin(elapsed * 0.5) * 0.1 : 0;
  const st = DEMO ? demoSteer : steer;

  // --- boost
  B.boosting = keys.shift && B.boost > 0.5 && B.speed > 1 && throttle >= 0;
  if (B.boosting) B.boost = Math.max(0, B.boost - 25 * dt);
  B.boostK = lerp(B.boostK, B.boosting ? 1 : 0, 1 - Math.exp(-7 * dt));

  // --- longitudinal
  const top = B.boosting ? 105 : 74;
  if (throttle > 0 || B.boosting) {
    const a = (B.boosting ? 56 : 34) * clamp(1 - B.speed / top, -0.35, 1);
    B.speed += a * dt;
    B.accelSmooth = lerp(B.accelSmooth, a, 1 - Math.exp(-5 * dt));
  } else {
    B.accelSmooth = lerp(B.accelSmooth, 0, 1 - Math.exp(-5 * dt));
  }
  if (throttle < 0) B.speed = Math.max(B.speed - 62 * dt, -13);
  B.speed -= B.speed * 0.13 * dt;
  if (Math.abs(B.speed) < 0.15 && throttle === 0) B.speed = 0;

  // --- steering / drift
  if (B.grounded) {
    if (pressed.space) {
      B.vy = 8.8 + Math.abs(B.speed) * 0.02;
      B.grounded = false; B.airTime = 0;
      Audio2.hop();
      if (B.drift) endDrift(true);
    } else {
      // drift start
      if (!B.drift && B.speed > 15) {
        if (pressed.q) startDrift(1);
        else if (pressed.e) startDrift(-1);
      }
      if (B.drift) {
        const held = (B.drift === 1 && keys.q) || (B.drift === -1 && keys.e);
        if (!held) endDrift(false);
        else if (B.speed < 11) endDrift(true);
        else {
          B.driftTime += dt;
          const scale = clamp(B.speed / 30, 0.55, 1.15);
          B.velAngle += (B.drift * 1.55 + st * 0.9) * scale * dt;
          B.boost = Math.min(100, B.boost + 13 * dt);
          // tire smoke
          if (Math.random() < dt * 95) {
            leanGroup.updateMatrixWorld();
            tmpWorld.set(R(-0.4, 0.4), 0.2, -0.8).applyMatrix4(leanGroup.matrixWorld);
            const hot = B.driftTime > 1.7;
            PSYS.spawn(tmpWorld.x, tmpWorld.y, tmpWorld.z,
              R(-2, 2) - Math.sin(B.velAngle) * 2, R(0.5, 2.5), R(-2, 2) - Math.cos(B.velAngle) * 2,
              R(0.4, 0.8), R(0.5, 0.85), 3.2,
              hot ? 1.0 : 0.85, hot ? 0.45 : 0.5, hot ? 0.75 : 0.95, hot ? 0.6 : 0.35, 0);
          }
        }
      } else {
        const steerRate = lerp(2.25, 0.78, clamp((B.speed - 4) / 72, 0, 1));
        B.velAngle += st * steerRate * dt * (B.speed > 0.5 ? 1 : (B.speed < -0.5 ? -1 : 0));
      }
    }
    const targetOff = B.drift ? B.drift * (0.52 + (st * B.drift > 0 ? 0.2 : 0)) : 0;
    B.driftOffset = lerp(B.driftOffset, targetOff, 1 - Math.exp(-7 * dt));
    B.bikeYaw = B.velAngle + B.driftOffset;
  } else {
    // airborne — short grace window so drift-hops don't trigger spins
    B.airTime += dt;
    B.velAngle += st * 0.5 * dt;
    if ((keys.q || keys.e) && B.airTime > 0.22) B.spinVel = (keys.q ? 1 : -1) * 7.2;
    else B.spinVel *= Math.pow(0.0005, dt);
    B.bikeYaw += B.spinVel * dt;
    B.trickAccum += Math.abs(B.spinVel) * dt;
  }

  // --- vertical
  const ghNow = groundAt(B.x, B.z, B.y);
  if (B.grounded) {
    if (ghNow < B.y - 0.5) {
      B.grounded = false;
      B.vy = Math.max(0, B.rampRise);
      B.airTime = 0;
    } else {
      B.rampRise = clamp((ghNow - B.y) / Math.max(dt, 0.001), 0, 42);
      B.y = ghNow;
      B.vy = 0;
    }
  } else {
    B.vy -= 30 * dt;
    B.y += B.vy * dt;
    if (B.y <= ghNow + 0.02 && B.vy <= 0) { B.y = ghNow; onLand(); }
  }

  // --- move + collide (substepped)
  const dist = Math.abs(B.speed) * dt;
  const steps = 1 + Math.min(3, Math.floor(dist / 2.2));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    B.x += Math.sin(B.velAngle) * B.speed * sdt;
    B.z += Math.cos(B.velAngle) * B.speed * sdt;
    collideWorld(sdt);
  }

  // wobble decay
  B.wobble = Math.max(0, B.wobble - dt * 1.4);

  // --- pickups
  const pr = B.boosting ? 3.4 : 2.5;
  for (const o of orbs) {
    if (!o.active) continue;
    const dx = o.x - B.x, dz = o.z - B.z;
    if (dx * dx + dz * dz < pr * pr && Math.abs(o.y - B.y) < 3.2) {
      addScore(150, 'ORB', '#49f8ff', false);
      B.boost = Math.min(100, B.boost + 8);
      Audio2.pickup();
      for (let i = 0; i < 8; i++) {
        PSYS.spawn(o.x, o.y, o.z, R(-6, 6), R(-2, 7), R(-6, 6),
          R(0.25, 0.5), R(0.3, 0.5), 1.5, 0.3, 0.95, 1.0, 0.9, 6);
      }
      // respawn elsewhere
      const axis = Math.random() < 0.5 ? 'x' : 'z';
      const k = Math.floor(1 + Math.random() * (GRID - 1));
      const roadC = -HALF + k * CELL;
      const along = -HALF + 40 + Math.random() * (WORLD - 80);
      const lane = -5.5 + Math.random() * 11;
      o.x = axis === 'x' ? along : roadC + lane;
      o.z = axis === 'x' ? roadC + lane : along;
    }
  }
  for (const ring of rings) {
    if (ring.cd > 0) { ring.cd -= dt; continue; }
    const dx = ring.x - B.x, dz = ring.z - B.z, dy = ring.y - B.y;
    if (dx * dx + dz * dz + dy * dy < 12 && !B.grounded) {
      ring.cd = 4;
      addScore(400, 'THREAD THE RING', '#ff5fb0', true);
      B.boost = Math.min(100, B.boost + 22);
      Audio2.ring();
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * TAU;
        PSYS.spawn(ring.x + Math.cos(a) * 3.2, ring.y + Math.sin(a) * 3.2, ring.z,
          Math.cos(a) * 4, Math.sin(a) * 4, R(-2, 2),
          R(0.3, 0.7), R(0.3, 0.6), 2, 1.0, 0.4, 0.75, 0.9, 3);
      }
    }
  }
  // near-miss
  if (B.speed > 22) {
    for (const c of cars) {
      if (c.nm > 0) continue;
      const dx = c.x - B.x, dz = c.z - B.z;
      if (dx * dx + dz * dz < 18 && B.y < 2) {
        c.nm = 4;
        addScore(100, 'NEAR MISS', '#ffd76a', false);
        Audio2.nearMiss();
      }
    }
  }

  // combo timer
  if (comboTimer > 0) {
    comboTimer -= dt * (B.drift ? 0.25 : 1);
    if (comboTimer <= 0) breakCombo();
  }

  // --- visuals
  bikeGroup.position.set(B.x, B.y + 0.07, B.z);
  bikeGroup.rotation.y = B.bikeYaw;
  const spdK = clamp(B.speed / 40, 0, 1);
  const wob = Math.sin(elapsed * 26) * B.wobble * 0.22;
  const leanTarget = B.grounded ? -(st * spdK * 0.42 + B.driftOffset * 0.62) + wob : wob * 0.5;
  B.lean = lerp(B.lean, leanTarget, 1 - Math.exp(-8 * dt));
  const pitchTarget = B.grounded
    ? -B.accelSmooth * 0.006 - B.boostK * 0.1 + (throttle < 0 ? 0.07 : 0)
    : clamp(-B.vy * 0.024, -0.42, 0.32);
  B.pitch = lerp(B.pitch, pitchTarget, 1 - Math.exp(-6 * dt));
  leanGroup.rotation.z = B.lean;
  leanGroup.rotation.x = B.pitch;
  B.wheelRot += B.speed / 0.34 * dt;
  rearWheel.rotation.x = B.wheelRot;
  frontWheel.rotation.x = B.wheelRot;
  forkGroup.rotation.y = st * 0.3 * (1 - spdK * 0.6);
  riderGroup.rotation.x = B.boostK * 0.2;

  // flames
  for (const fl of flames) {
    fl.visible = B.boostK > 0.15;
    if (fl.visible) fl.scale.set(1, 1, 0.7 + B.boostK * (0.8 + Math.random() * 0.9));
  }
  // backfire pops on throttle release
  if (prevW && !keys.w && B.speed > 40) backfireT = 0.35;
  if (backfireT > 0) {
    backfireT -= dt;
    if (Math.random() < dt * 9) {
      Audio2.backfire();
      for (const fl of flames) { fl.visible = true; fl.scale.set(1.5, 1.5, 1.7); }
    }
  }
  prevW = keys.w;
  // boost exhaust sparks
  if (B.boostK > 0.3 && Math.random() < dt * 70) {
    leanGroup.updateMatrixWorld();
    tmpWorld.set(R(-0.15, 0.15), 0.45, -1.1).applyMatrix4(leanGroup.matrixWorld);
    PSYS.spawn(tmpWorld.x, tmpWorld.y, tmpWorld.z,
      -Math.sin(B.velAngle) * B.speed * 0.4 + R(-2, 2), R(-1, 2), -Math.cos(B.velAngle) * B.speed * 0.4 + R(-2, 2),
      R(0.15, 0.35), R(0.2, 0.4), 2, 0.45, 0.95, 1.0, 0.9, 0);
  }

  // trail
  leanGroup.updateMatrixWorld();
  tmpWorld.set(0, 0.55, -0.9).applyMatrix4(leanGroup.matrixWorld);
  const trailI = Math.max(B.boostK, B.drift ? 0.45 : 0) * clamp(B.speed / 20, 0, 1);
  trail.push(tmpWorld.x, tmpWorld.y, tmpWorld.z, trailI);
  trail.mat.uniforms.uColor.value.setHex(B.boostK > 0.4 ? 0x5df3ff : 0xff5fb0);
  trail.update();
}

/* ================= CAMERA ================= */
const camPos = new THREE.Vector3(0, 6, -430);
const camLook = new THREE.Vector3(0, 1, 0);
function updateCamera(dt) {
  if (gameState === 'title') {
    const t = elapsed * 0.06;
    const cx = -48 + Math.cos(t) * 300, cz = -48 + Math.sin(t) * 300;
    camPos.lerp(tmpV.set(cx, 130 + Math.sin(elapsed * 0.11) * 40, cz), 1 - Math.exp(-1.2 * dt));
    camera.position.copy(camPos);
    camera.lookAt(-48, 70, -48);
    camera.fov = lerp(camera.fov, 62, 0.05);
    camera.updateProjectionMatrix();
    return;
  }
  const spdK = clamp(B.speed / 105, 0, 1);
  const camAngle = B.velAngle + B.driftOffset * 0.25;
  const dist = 6.2 + spdK * 3.4;
  const height = 2.5 + spdK * 1.0 + clamp(B.y * 0.06, 0, 3);
  const dx = Math.sin(camAngle), dz = Math.cos(camAngle);
  tmpV.set(B.x - dx * dist, B.y + height, B.z - dz * dist);
  const kxz = 1 - Math.exp(-9 * dt), ky = 1 - Math.exp(-5.5 * dt);
  camPos.x = lerp(camPos.x, tmpV.x, kxz);
  camPos.z = lerp(camPos.z, tmpV.z, kxz);
  camPos.y = lerp(camPos.y, tmpV.y, ky);
  // keep camera above ground/ramps
  const cg = groundAt(camPos.x, camPos.z, camPos.y) + 1.1;
  if (camPos.y < cg) camPos.y = cg;

  const shake = shakeT * 0.5 + spdK * spdK * 0.05 + B.boostK * 0.08;
  camera.position.set(
    camPos.x + (Math.random() - 0.5) * shake,
    camPos.y + (Math.random() - 0.5) * shake * 0.6,
    camPos.z + (Math.random() - 0.5) * shake
  );
  camLook.lerp(tmpV.set(B.x + dx * 7, B.y + 1.1, B.z + dz * 7), 1 - Math.exp(-11 * dt));
  camera.lookAt(camLook);
  camera.rotateZ(-B.lean * 0.22);
  const fovT = 72 + spdK * 16 + B.boostK * 9;
  camera.fov = lerp(camera.fov, fovT, 1 - Math.exp(-5 * dt));
  camera.updateProjectionMatrix();
  shakeT = Math.max(0, shakeT - dt * 2.2);
}

/* ================= GAME FLOW ================= */
function startGame() {
  gameState = 'play';
  elOverlay.classList.add('hidden');
  elHint.classList.add('show');
  setTimeout(() => elHint.classList.remove('show'), 9000);
  Audio2.init(); Audio2.resume();
}
function pauseGame() {
  gameState = 'pause';
  elOvTitle.textContent = 'PAUSED';
  elOvSub.innerHTML = 'PRESS <b>ESC</b> OR <b>ENTER</b> TO RESUME';
  elOverlay.classList.remove('hidden');
}
function resumeGame() {
  gameState = 'play';
  elOverlay.classList.add('hidden');
  Audio2.resume();
}
function resetBike() {
  const kx = Math.round((B.x + HALF) / CELL), kz = Math.round((B.z + HALF) / CELL);
  const xr = -HALF + clamp(kx, 0, GRID) * CELL, zr = -HALF + clamp(kz, 0, GRID) * CELL;
  if (Math.abs(B.x - xr) < Math.abs(B.z - zr)) {
    B.x = xr; B.velAngle = Math.abs(angleDiff(B.velAngle, 0)) < Math.PI / 2 ? 0 : Math.PI;
  } else {
    B.z = zr; B.velAngle = Math.abs(angleDiff(B.velAngle, Math.PI / 2)) < Math.PI / 2 ? Math.PI / 2 : -Math.PI / 2;
  }
  B.bikeYaw = B.velAngle; B.speed = 0; B.vy = 0; B.y = 0;
  B.drift = 0; B.driftOffset = 0; B.trickAccum = 0; B.grounded = true;
}

function handleMetaKeys(k, e) {
  if (k === 'enter') {
    if (gameState === 'title') startGame();
    else if (gameState === 'pause') resumeGame();
  }
  if (k === 'escape') {
    if (gameState === 'play') pauseGame();
    else if (gameState === 'pause') resumeGame();
  }
  if (k === 'm') { Audio2.init(); Audio2.toggleMute(); popup(Audio2.muted ? 'MUTED' : 'SOUND ON', '#aaa', false); }
  if (k === 'r' && gameState === 'play') { resetBike(); popup('RESET', '#aaa', false); }
  if (gameState === 'title' && (k === 'space' || k === 'w')) startGame();
}
elOverlay.addEventListener('click', () => {
  if (gameState === 'title') startGame();
  else if (gameState === 'pause') resumeGame();
});

/* ================= HUD UPDATE ================= */
let hudTick = 0;
function updateHUD(dt) {
  hudTick += dt;
  elSpd.textContent = Math.abs(Math.round(B.speed * 3.6));
  elBoostBar.style.width = B.boost.toFixed(1) + '%';
  elBoostBar.classList.toggle('full', B.boost > 97);
  elBoostBar.classList.toggle('active', B.boosting);
  elScore.textContent = score.toLocaleString();
  if (score > best) {
    best = score;
    elBest.textContent = 'BEST ' + best.toLocaleString();
    try { localStorage.setItem('neonrush_best', String(best)); } catch (err) { }
  }
  if (chain > 1) {
    elCombo.style.display = 'block';
    elCombo.firstChild.textContent = 'x' + mult() + ' COMBO';
    elComboBar.style.width = (comboTimer / 5 * 100) + '%';
  } else {
    elCombo.style.display = 'none';
  }
}

/* ================= MAIN LOOP ================= */
let lastT = performance.now();
if (DEMO) {
  startGame();
  keys.w = true;
  B.speed = 62; B.boost = 100;
  setTimeout(() => { keys.shift = true; }, 600);
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  if (dt <= 0) dt = 0.016;
  elapsed += dt;

  if (gameState === 'play') {
    if (DEMO) keys.w = true;
    updateBike(dt);
    updateTraffic(dt);
    PSYS.update(dt);
    updateHUD(dt);
    drawMinimap();
    Audio2.update(Math.abs(B.speed), keys.w ? 1 : 0, B.boosting, !!B.drift, B.grounded);
  } else if (gameState === 'title') {
    updateTraffic(dt);
    PSYS.update(dt);
  }
  updateWorld(dt, elapsed, B.x, B.z);
  updateCamera(dt);
  updatePxScale();
  drawFx(clamp(B.speed / 105, 0, 1), B.boostK);
  for (const k in pressed) delete pressed[k];
  renderer.render(scene, camera);
}
updatePxScale();
requestAnimationFrame(frame);
