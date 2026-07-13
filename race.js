'use strict';
/* ============================================================
   NEON RUSH — race.js : race mode + rival AI
   Loaded after game.js; exposes window.Race, called via hooks.
   ============================================================ */
(() => {

  const rrng = mulberry32(90210);
  const RR = (a, b) => a + rrng() * (b - a);

  /* ================= ROUTES ================= */
  // Loops of grid intersections (i,k); consecutive corners share an axis, so
  // every edge runs along a real road and the loop is traversable by construction.
  const ROUTE_DEFS = [
    {
      name: 'DOWNTOWN SPRINT', color: 0x00e5ff, css: '#00e5ff', laps: 2, pace: 37,
      corners: [[8, 8], [14, 8], [14, 11], [12, 11], [12, 14], [8, 14]],
    },
    {
      name: 'HARBOR RUN', color: 0xffe14d, css: '#ffe14d', laps: 2, pace: 39,
      corners: [[2, 4], [6, 4], [6, 9], [9, 9], [9, 13], [2, 13]],
    },
    {
      name: 'CITY TOUR', color: 0xff2d95, css: '#ff2d95', laps: 1, pace: 41,
      corners: [[3, 3], [18, 3], [18, 10], [13, 10], [13, 18], [6, 18], [6, 12], [3, 12]],
    },
  ];
  const nodePos = (c) => ({ x: -HALF + c[0] * CELL, z: -HALF + c[1] * CELL });

  const routes = ROUTE_DEFS.map((def, ri) => {
    const n = def.corners.length;
    const raw = [];
    for (let i = 0; i < n; i++) {
      const prev = nodePos(def.corners[(i - 1 + n) % n]);
      const cur = nodePos(def.corners[i]);
      const next = nodePos(def.corners[(i + 1) % n]);
      let inX = cur.x - prev.x, inZ = cur.z - prev.z;
      const inL = Math.hypot(inX, inZ) || 1; inX /= inL; inZ /= inL;
      let outX = next.x - cur.x, outZ = next.z - cur.z;
      const outL = Math.hypot(outX, outZ) || 1; outX /= outL; outZ /= outL;
      // approach, apex (cut slightly inside), exit
      raw.push(new THREE.Vector3(cur.x - inX * 15, 0, cur.z - inZ * 15));
      raw.push(new THREE.Vector3(cur.x + (outX - inX) * 3.2, 0, cur.z + (outZ - inZ) * 3.2));
      raw.push(new THREE.Vector3(cur.x + outX * 15, 0, cur.z + outZ * 15));
      // midpoints on long straights keep the spline snug to the road
      const straight = Math.hypot(next.x - cur.x, next.z - cur.z);
      const mids = Math.floor(straight / 60);
      for (let m = 1; m <= mids; m++) {
        raw.push(new THREE.Vector3(
          cur.x + outX * (15 + (straight - 30) * m / (mids + 1)), 0,
          cur.z + outZ * (15 + (straight - 30) * m / (mids + 1))));
      }
    }
    const curve = new THREE.CatmullRomCurve3(raw, true, 'catmullrom', 0.4);
    const len = curve.getLength();
    const N = Math.max(64, Math.ceil(len / 3));
    const pts = curve.getSpacedPoints(N);   // N+1 points, last == first
    pts.pop();
    // checkpoints at the corner nodes, located on the sampled line
    const cps = def.corners.map((c) => {
      const p = nodePos(c);
      let bi = 0, bd = 1e9;
      pts.forEach((q, qi) => {
        const d = (q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z);
        if (d < bd) { bd = d; bi = qi; }
      });
      return { x: pts[bi].x, z: pts[bi].z, t: bi * len / N, i: bi };
    });
    return { def, ri, pts, len, seg: len / N, cps, gateT: cps[0].t };
  });

  function lineAt(route, t) {
    t = ((t % route.len) + route.len) % route.len;
    const i = Math.floor(t / route.seg) % route.pts.length;
    return route.pts[i];
  }
  function dirAt(route, t) {
    const a = lineAt(route, t), b = lineAt(route, t + route.seg * 2);
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }

  /* ================= GATES + CHECKPOINT MARKERS ================= */
  const nextCpMarker = (() => {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(6.5, 0.3, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    m.visible = false;
    scene.add(m);
    return m;
  })();

  for (const route of routes) {
    const g0 = route.cps[0];
    const d = dirAt(route, g0.t);
    const px = -d.z, pz = d.x;   // perpendicular
    const grp = new THREE.Group();
    const pyGeo = new THREE.BoxGeometry(0.7, 7.5, 0.7);
    const pyMat = new THREE.MeshBasicMaterial({ color: route.def.color });
    for (const s of [-8, 8]) {
      const py = new THREE.Mesh(pyGeo, pyMat);
      py.position.set(g0.x + px * s, 3.75, g0.z + pz * s);
      grp.add(py);
      addGlow(g0.x + px * s, 7.8, g0.z + pz * s, route.def.color, 10, 0.8);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(16.7, 0.5, 0.5), pyMat);
    bar.position.set(g0.x, 7.4, g0.z);
    bar.rotation.y = Math.atan2(px, pz);
    grp.add(bar);
    // small markers on every checkpoint
    const cpGeo = new THREE.BoxGeometry(0.4, 2.6, 0.4);
    const cpMat = new THREE.MeshBasicMaterial({ color: route.def.color, transparent: true, opacity: 0.55 });
    for (let ci = 1; ci < route.cps.length; ci++) {
      const cp = route.cps[ci];
      const cd = dirAt(route, cp.t);
      for (const s of [-7.5, 7.5]) {
        const m = new THREE.Mesh(cpGeo, cpMat);
        m.position.set(cp.x - cd.z * s, 1.3, cp.z + cd.x * s);
        grp.add(m);
      }
    }
    scene.add(grp);
    route.gateGroup = grp;
  }
  if (typeof bakeStaticGlow === 'function') bakeStaticGlow();   // include gate glows

  /* ================= RIVALS ================= */
  const RIVAL_DEFS = [
    { name: 'VYPER', color: 0x36ff8f, css: '#36ff8f', personality: 'aggressive' },
    { name: 'HALO', color: 0x4dc3ff, css: '#4dc3ff', personality: 'defensive' },
    { name: 'JINX', color: 0xb967ff, css: '#b967ff', personality: 'trickster' },
    { name: 'ONYX', color: 0xff8a2a, css: '#ff8a2a', personality: 'steady' },
  ];

  function makeRacerBike(color, accent) {
    const g = new THREE.Group();
    g.scale.setScalar(1.15);
    const lean = new THREE.Group();
    g.add(lean);
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = mkMat(0x0c0c12, 0, 0.85, 0.2);
    const wr = new THREE.Mesh(wheelGeo, wheelMat);
    wr.position.set(0, 0.34, -0.78); wr.castShadow = true; lean.add(wr);
    const wf = new THREE.Mesh(wheelGeo, wheelMat);
    wf.position.set(0, 0.34, 0.72); wf.castShadow = true; lean.add(wf);
    bx(lean, 0.4, 0.3, 1.0, color, 0, 0.72, -0.05, { rough: 0.32, metal: 0.7 });        // tank
    bx(lean, 0.34, 0.16, 0.62, color, 0, 0.86, -0.58, { rough: 0.32, metal: 0.7, rx: 0.22 });
    bx(lean, 0.3, 0.12, 0.4, 0x16121e, 0, 0.84, -0.25);                                 // seat
    bx(lean, 0.05, 0.05, 0.5, accent, 0.21, 0.72, 0, { emissive: accent });
    bx(lean, 0.05, 0.05, 0.5, accent, -0.21, 0.72, 0, { emissive: accent });
    bx(lean, 0.36, 0.3, 0.42, 0x16121e, 0, 0.52, 0.02);                                 // engine
    bx(lean, 0.34, 0.28, 0.35, color, 0, 0.78, 0.42, { rough: 0.32, metal: 0.7, rx: -0.3 });
    bx(lean, 0.18, 0.12, 0.06, 0xfff3d0, 0, 0.86, 0.6, { emissive: 0xfff3d0 });         // headlight
    bx(lean, 0.2, 0.07, 0.05, 0xff2030, 0, 0.92, -0.88, { emissive: 0xff2030 });        // tail
    // rider
    bx(lean, 0.3, 0.24, 0.3, 0x1c1c2a, 0, 1.0, -0.3);
    bx(lean, 0.32, 0.5, 0.24, 0x24243c, 0, 1.28, -0.12, { rx: 0.75 });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), mkMat(color, 0, 0.25, 0.8));
    helmet.position.set(0, 1.5, 0.12); helmet.castShadow = true;
    lean.add(helmet);
    bx(lean, 0.2, 0.05, 0.02, accent, 0, 1.5, 0.27, { emissive: accent });              // visor
    return { group: g, lean, wheels: [wr, wf] };
  }
  window.makeRacerBike = makeRacerBike;

  const rivals = RIVAL_DEFS.map((def, i) => {
    const model = makeRacerBike(def.color, def.color);
    scene.add(model.group);
    const r = {
      def, model,
      route: routes[i % routes.length],
      t: RR(0, 1000), lat: RR(-3, 3), latT: 0,
      speed: 13, x: 0, z: 0, y: 0, yaw: 0, prevYaw: 0, lean: 0, wheelRot: 0,
      mode: 'ambient',
      prog: 0, finishDist: 0, finished: false, finishTime: 0, lap: 1,
      stunT: 0, spinT: 0, spinA: 0, scrT: 0, shieldT: 0, odT: 0,
      perk: null, perkCd: RR(2, 8), fireCd: RR(2, 5), rubber: 1,
    };
    r.wrapper = {
      get x() { return r.x; }, get z() { return r.z; },
      kind: 'rival', name: def.name,
      shielded: () => r.shieldT > 0,
      stun(s) { r.stunT = Math.max(r.stunT, s); },
      scramble(s) { r.scrT = Math.max(r.scrT, s); },
      spinOut() { if (r.shieldT <= 0) r.spinT = Math.max(r.spinT, 1.1); },
      steal(f) { const st = r.speed * f; r.speed -= st; return st; },
      onBump(nx, nz) { r.lat += (nx * -Math.cos(r.yaw) + nz * Math.sin(r.yaw)) > 0 ? -1.2 : 1.2; },
    };
    return r;
  });

  // shield bubbles for rivals (one shared pool of meshes)
  const rivalShields = rivals.map((r) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd84d, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    m.position.y = 0.8; m.visible = false;
    r.model.group.add(m);
    return m;
  });

  /* ================= RACE STATE ================= */
  const race = {
    state: 'idle',      // idle | countdown | racing | post
    route: null,
    cdT: 0, cdShown: 9,
    time: 0,
    pT: 0, pIdx: 0, pProg: 0, pFinishDist: 0, pLap: 1,
    cpNext: 1, wrongT: 0, wrongCd: 0,
    place: 1, postT: 0, lastResetT: -9,
    standings: [],
  };
  const REWARDS = [3000, 2000, 1200, 800, 500];

  const elRaceHud = $('racehud'), elRacePos = $('racepos'),
    elRaceLap = $('racelap'), elRaceTime = $('racetime'), elBoard = $('board');

  function fmtTime(t) {
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function projectPlayer(route) {
    // local search around the previous index for the nearest line sample
    const N = route.pts.length;
    let bi = race.pIdx, bd = 1e18;
    for (let o = -30; o <= 60; o++) {
      const i = ((race.pIdx + o) % N + N) % N;
      const p = route.pts[i];
      const d = (p.x - B.x) * (p.x - B.x) + (p.z - B.z) * (p.z - B.z);
      if (d < bd) { bd = d; bi = i; }
    }
    race.pIdx = bi;
    return bi * route.seg;
  }

  function startCountdown(route) {
    race.state = 'countdown';
    race.route = route;
    race.cdT = 3.2; race.cdShown = 9;
    race.time = 0;
    // player start slot: just behind the gate, right lane
    const gT = route.gateT;
    const d = dirAt(route, gT);
    race.startX = route.cps[0].x - d.x * 8 + -d.z * 2.5;
    race.startZ = route.cps[0].z - d.z * 8 + d.x * 2.5;
    race.startYaw = Math.atan2(d.x, d.z);
    // rivals to slots
    rivals.forEach((r, i) => {
      r.route = route;
      r.mode = 'race';
      const back = 8 + Math.floor(i / 2) * 6;
      const side = (i % 2 === 0 ? -2.5 : 2.5);
      r.t = ((gT - back) % route.len + route.len) % route.len;
      const p = lineAt(route, r.t), dd = dirAt(route, r.t);
      r.lat = clamp(side + (i >= 2 ? -side * 2 : 0), -5, 5);
      r.x = p.x + -dd.z * r.lat; r.z = p.z + dd.x * r.lat;
      r.yaw = Math.atan2(dd.x, dd.z);
      r.speed = 0;
      r.prog = 0; r.lap = 1;
      r.finished = false; r.finishTime = 0;
      r.finishDist = back + route.def.laps * route.len;
      r.stunT = r.spinT = r.scrT = r.shieldT = r.odT = 0; r.spinA = 0;
      r.perk = null; r.perkCd = RR(3, 7); r.fireCd = RR(2, 5);
    });
    race.pFinishDist = 8 + route.def.laps * route.len;
    race.pProg = 0;
    race.pIdx = route.cps[0].i;
    race.cpNext = 1;
    race.pLap = 1; race.wrongT = 0;
    popup(route.def.name, route.def.css, true);
    Audio2.beep(440, 440, 0.2, 'square', 0.2);
  }

  function endRace(aborted) {
    race.state = aborted ? 'idle' : 'post';
    race.postT = 5;
    nextCpMarker.visible = false;
    elRaceHud.style.display = 'none';
    elBoard.style.display = 'none';
    if (window.Ghost && aborted) Ghost.onAbort();
    if (aborted) {
      rivals.forEach((r, i) => { r.mode = 'ambient'; r.route = routes[i % routes.length]; r.speed = 13; });
      popup('RACE ABANDONED', '#888', false);
    }
  }

  function finishRace() {
    let place = 1;
    for (const r of rivals) if (r.finished && r.finishTime < race.time) place++;
    race.place = place;
    const reward = REWARDS[place - 1] || 400;
    addScore(reward, 'P' + place + ' FINISH', place === 1 ? '#ffe14d' : '#9fe8ff', true);
    popup(fmtTime(race.time), '#fff', false);
    if (place === 1) Audio2.ring(); else Audio2.trickLand();
    if (window.Ghost) Ghost.onFinish(race.time, place);
    endRace(false);
  }

  /* ================= AI ================= */
  function playerRelation(r) {
    const dx = B.x - r.x, dz = B.z - r.z;
    const dist = Math.hypot(dx, dz);
    const ang = Math.abs(angleDiff(Math.atan2(dx, dz), r.yaw));
    return { dist, ang, ahead: ang < 1.2, behind: ang > 1.9 };
  }

  function aiFirePerk(r) {
    const rel = playerRelation(r);
    const pers = r.def.personality;
    const k = r.perk;
    let fire = false;
    if (k === 'overdrive') fire = r.rubber > 1.02 || pers === 'steady';
    else if (k === 'emp') fire = rel.ahead && rel.dist < 32 && rel.ang < 0.6;
    else if (k === 'flare') fire = rel.ahead && rel.dist > 12 && rel.dist < 75;
    else if (k === 'slick') fire = rel.behind && rel.dist < 26;
    else if (k === 'shield') fire = pers === 'defensive' ? rel.dist < 14 : rel.dist < 8;
    else if (k === 'magnet') fire = rel.ahead && rel.dist > 8 && rel.dist < 50;
    else if (k === 'dash') fire = r.stunT > 0 || r.rubber > 1.05 || pers === 'trickster';
    // personality eagerness
    const eager = pers === 'aggressive' ? 1 : pers === 'trickster' ? 0.8 : pers === 'defensive' ? 0.6 : 0.4;
    if (!fire || Math.random() > eager) return;
    if (k === 'overdrive') { r.odT = 4; }
    else if (k === 'emp') { fireEMPfrom(r.x, r.z, r.yaw, r.wrapper); }
    else if (k === 'flare') { spawnFlare(r.x, 1.2, r.z, r.yaw, playerTarget, r.wrapper); }
    else if (k === 'slick') { dropSlickAt(r.x - Math.sin(r.yaw) * 2.5, r.z - Math.cos(r.yaw) * 2.5, r.wrapper); }
    else if (k === 'shield') { r.shieldT = 5; }
    else if (k === 'magnet') {
      if (rel.dist < 50) { const st = playerSteal(0.22); r.speed += st * 0.8 + 4; }
    } else if (k === 'dash') {
      r.t += 15; r.prog += 15;
      for (let j = 0; j < 8; j++) {
        PSYS.spawn(r.x, r.y + 0.6, r.z, R(-1, 1), R(0, 1.5), R(-1, 1), 0.4, 0.5, 1.5, 0.24, 1.0, 0.78, 0.8, 0);
      }
    }
    r.perk = null;
    r.fireCd = r.def.personality === 'aggressive' ? RR(2.5, 4) : RR(4, 7);
  }

  function updateRival(r, dt, racing) {
    // status effects
    r.stunT = Math.max(0, r.stunT - dt);
    r.scrT = Math.max(0, r.scrT - dt);
    r.shieldT = Math.max(0, r.shieldT - dt);
    r.odT = Math.max(0, r.odT - dt);
    if (r.spinT > 0) {
      r.spinT -= dt;
      r.spinA += 8 * dt * Math.min(1, r.spinT + 0.4);
      r.speed -= r.speed * 2.5 * dt;
    } else if (Math.abs(r.spinA % TAU) > 0.05) {
      r.spinA = lerp(r.spinA, Math.round(r.spinA / TAU) * TAU, 1 - Math.exp(-4 * dt));
    }

    const route = r.route;
    // pace
    let target;
    if (!racing) {
      target = 13;
    } else {
      const dirNow = dirAt(route, r.t + 6);
      const dirFar = dirAt(route, r.t + 24);
      const turn = Math.abs(angleDiff(Math.atan2(dirFar.x, dirFar.z), Math.atan2(dirNow.x, dirNow.z)));
      const cornerK = clamp(1 - turn * 0.5, 0.42, 1);
      r.rubber = clamp(1 + (race.pProg - r.prog) * 0.0011, 0.86, 1.12);
      target = route.def.pace * cornerK * r.rubber * (r.odT > 0 ? 1.35 : 1);
      target = Math.min(target, 54);
    }
    if (r.stunT > 0) target *= 0.2;
    if (r.scrT > 0) target *= 0.75;
    r.speed += clamp(target - r.speed, -34 * dt, 15 * dt);
    const adv = Math.max(0, r.speed) * dt;
    r.t += adv;
    if (racing) r.prog += adv;
    if (r.t >= route.len) r.t -= route.len;

    // lane: personality line + scramble wobble + avoidance
    let latT = r.def.personality === 'aggressive' ? Math.sin(r.t * 0.02) * 3
      : r.def.personality === 'trickster' ? Math.sin(elapsed * 0.7 + r.t * 0.01) * 4 : 0;
    if (r.scrT > 0) latT = Math.sin(elapsed * 7 + r.t) * 5;
    // dodge slicks (defensive & steady read the road)
    if (racing && (r.def.personality === 'defensive' || r.def.personality === 'steady')) {
      for (const s of getSlicks()) {
        const dx = s.x - r.x, dz = s.z - r.z;
        const d = Math.hypot(dx, dz);
        if (d < 26 && Math.abs(angleDiff(Math.atan2(dx, dz), r.yaw)) < 0.5) {
          const side = (dx * -Math.cos(r.yaw) + dz * Math.sin(r.yaw)) > 0 ? -1 : 1;
          latT += side * 4;
        }
      }
    }
    // separation from other racers + the player
    for (const o of rivals) {
      if (o === r) continue;
      const dx = o.x - r.x, dz = o.z - r.z;
      if (dx * dx + dz * dz < 42) latT += ((r.lat - o.lat) >= 0 ? 1 : -1) * 2.4;
    }
    if (r.def.personality !== 'aggressive') {
      const dx = B.x - r.x, dz = B.z - r.z;
      if (dx * dx + dz * dz < 30) latT += ((dx * -Math.cos(r.yaw) + dz * Math.sin(r.yaw)) > 0 ? -1 : 1) * 2.5;
    }
    r.lat = lerp(r.lat, clamp(latT, -6, 6), 1 - Math.exp(-2.2 * dt));

    // slick hits
    if (r.spinT <= 0 && r.shieldT <= 0) {
      for (const s of getSlicks()) {
        if (s.owner === r.wrapper && s.age < 1.4) continue;
        const dx = r.x - s.x, dz = r.z - s.z;
        if (dx * dx + dz * dz < 5.3) { r.spinT = 1.1; break; }
      }
    }

    // pose
    const p = lineAt(route, r.t), d = dirAt(route, r.t);
    r.x = p.x + -d.z * r.lat;
    r.z = p.z + d.x * r.lat;
    const gy = groundAt(r.x, r.z, r.y);
    r.y = Math.abs(gy - r.y) > 4 ? gy : lerp(r.y, gy, 1 - Math.exp(-9 * dt));
    const wantYaw = Math.atan2(d.x, d.z);
    const dYaw = clamp(angleDiff(wantYaw, r.yaw), -3 * dt, 3 * dt);
    r.yaw += dYaw;
    r.lean = lerp(r.lean, clamp(-dYaw / Math.max(dt, 0.001) * 0.24 * clamp(r.speed / 30, 0, 1), -0.6, 0.6), 1 - Math.exp(-7 * dt));
    r.wheelRot += r.speed / 0.34 * dt;
    r.model.group.position.set(r.x, r.y + 0.07, r.z);
    r.model.group.rotation.y = r.yaw + r.spinA;
    r.model.lean.rotation.z = r.lean;
    for (const w of r.model.wheels) w.rotation.x = r.wheelRot;

    // perks
    if (racing) {
      r.perkCd -= dt;
      if (!r.perk && r.perkCd <= 0) {
        r.perkCd = RR(6, 11);
        if (Math.random() < 0.45) r.perk = PERK_KINDS[Math.floor(Math.random() * PERK_KINDS.length)];
      }
      r.fireCd -= dt;
      if (r.perk && r.fireCd <= 0) aiFirePerk(r);
      // race finish
      if (!r.finished && r.prog >= r.finishDist) {
        r.finished = true;
        r.finishTime = race.time;
      }
    }
  }

  /* ================= UPDATE ================= */
  function update(dt) {
    const racing = race.state === 'racing';
    for (const r of rivals) updateRival(r, dt, racing && r.mode === 'race');
    rivals.forEach((r, i) => {
      rivalShields[i].visible = r.shieldT > 0;
      if (rivalShields[i].visible) rivalShields[i].material.opacity = 0.18 + Math.sin(elapsed * 8) * 0.05;
    });

    if (gameState !== 'play') return;

    if (race.state === 'idle') {
      // gate proximity starts a race
      for (const route of routes) {
        const g = route.cps[0];
        const dx = B.x - g.x, dz = B.z - g.z;
        if (dx * dx + dz * dz < 81 && B.y < 4) { startCountdown(route); break; }
      }
    } else if (race.state === 'countdown') {
      race.cdT -= dt;
      // hold the player on the start slot
      B.speed *= 0.8;
      B.x = lerp(B.x, race.startX, 1 - Math.exp(-6 * dt));
      B.z = lerp(B.z, race.startZ, 1 - Math.exp(-6 * dt));
      B.velAngle = B.bikeYaw = race.startYaw;
      const n = Math.ceil(race.cdT);
      if (n < race.cdShown && n > 0) {
        race.cdShown = n;
        popup(String(n), '#ffe14d', true);
        Audio2.beep(520, 520, 0.16, 'square', 0.22);
      }
      if (race.cdT <= 0) {
        race.state = 'racing';
        race.time = 0;
        popup('GO!', '#7cff4d', true);
        Audio2.beep(780, 1560, 0.3, 'square', 0.26);
        elRaceHud.style.display = 'block';
        elBoard.style.display = 'block';
        if (window.Ghost) Ghost.onRaceStart(race.route.ri, race.route.def.laps, race.route.def.name);
      }
    } else if (race.state === 'racing') {
      race.time += dt;
      const route = race.route;
      const t = projectPlayer(route);
      // unwrapped progress
      let delta = t - race.pT;
      if (delta > route.len / 2) delta -= route.len;
      if (delta < -route.len / 2) delta += route.len;
      race.pT = t;
      race.pProg += delta;
      // wrong way detection
      if (delta < -0.1 && B.speed > 6) race.wrongT += dt; else race.wrongT = Math.max(0, race.wrongT - dt * 2);
      race.wrongCd -= dt;
      if (race.wrongT > 1.6 && race.wrongCd <= 0) { popup('WRONG WAY!', '#ff5566', false); race.wrongCd = 1.4; }
      // checkpoints (pure feedback; ranking uses pProg)
      const cp = route.cps[race.cpNext % route.cps.length];
      const dx = B.x - cp.x, dz = B.z - cp.z;
      if (dx * dx + dz * dz < 196) {
        race.cpNext++;
        if (race.cpNext % route.cps.length === 1 && race.cpNext > 1) {
          race.pLap = Math.min(route.def.laps, race.pLap + 1);
        }
        addScore(50, 'CHECKPOINT', route.def.css, false);
        Audio2.beep(880, 1320, 0.12, 'sine', 0.18);
        if (window.Ghost) Ghost.onCheckpoint(race.cpNext, race.time);
      }
      const ncp = route.cps[race.cpNext % route.cps.length];
      nextCpMarker.visible = true;
      nextCpMarker.position.set(ncp.x, 3.2 + Math.sin(elapsed * 4) * 0.4, ncp.z);
      const nd = dirAt(route, ncp.t);
      nextCpMarker.rotation.y = Math.atan2(nd.x, nd.z);
      nextCpMarker.material.color.setHex(route.def.color);
      nextCpMarker.scale.setScalar(1 + Math.sin(elapsed * 5) * 0.06);
      if (window.Ghost) Ghost.tick(race.time);
      // standings
      const rows = [{ name: 'YOU', css: '#ff5fb0', prog: race.pProg, fin: false, ft: 0 }];
      for (const r of rivals) rows.push({ name: r.def.name, css: r.def.css, prog: r.prog, fin: r.finished, ft: r.finishTime });
      rows.sort((a, b) => (a.fin && b.fin) ? a.ft - b.ft : (a.fin ? -1 : b.fin ? 1 : b.prog - a.prog));
      race.standings = rows;
      const myPlace = rows.findIndex((r) => r.name === 'YOU') + 1;
      race.place = myPlace;
      elRacePos.textContent = 'P' + myPlace;
      elRaceLap.textContent = 'LAP ' + race.pLap + '/' + route.def.laps;
      elRaceTime.textContent = fmtTime(race.time);
      let bhtml = '';
      rows.forEach((r, i) => {
        const gap = i === 0 ? '' : '+' + Math.round(rows[0].prog - r.prog) + 'm';
        bhtml += '<div class="row"><span style="color:' + r.css + '">P' + (i + 1) + ' ' + r.name + '</span><span class="gap">' + (r.fin ? fmtTime(r.ft) : gap) + '</span></div>';
      });
      elBoard.innerHTML = bhtml;
      // finish
      if (race.pProg >= race.pFinishDist) finishRace();
    } else if (race.state === 'post') {
      race.postT -= dt;
      if (race.postT <= 0) {
        race.state = 'idle';
        rivals.forEach((r, i) => { r.mode = 'ambient'; r.route = routes[i % routes.length]; r.speed = 13; });
      }
    }
  }

  /* ================= PUBLIC API ================= */
  window.Race = {
    update,
    get state() { return race.state; },
    get activeRoute() { return race.state === 'racing' || race.state === 'countdown' ? race.route : null; },
    get cpNext() { return race.cpNext; },
    routes,
    getTargets() { return rivals.map((r) => r.wrapper); },
    getColliders() {
      return rivals.map((r) => ({ x: r.x, z: r.z, y: r.y, onBump: r.wrapper.onBump }));
    },
    getRivalStates() { return rivals; },
    randomRoutePoint() {
      const route = race.route || routes[Math.floor(Math.random() * routes.length)];
      const t = Math.random() * route.len;
      const p = lineAt(route, t), d = dirAt(route, t);
      const lat = -4 + Math.random() * 8;
      return { x: p.x + -d.z * lat, z: p.z + d.x * lat };
    },
    tryCollectOrb(o) {
      for (const r of rivals) {
        if (r.perk || r.mode !== 'race') continue;
        const dx = o.x - r.x, dz = o.z - r.z;
        if (dx * dx + dz * dz < 9) {
          r.perk = o.kind;
          o.active = false; o.respawn = 16;
          return true;
        }
      }
      return false;
    },
    onReset() {
      if (race.state === 'countdown') { endRace(true); return true; }
      if (race.state !== 'racing') return false;
      // double-tap R abandons; single R recovers to the last checkpoint
      if (elapsed - race.lastResetT < 1.2) { endRace(true); race.lastResetT = -9; return true; }
      race.lastResetT = elapsed;
      const route = race.route;
      const prev = route.cps[(race.cpNext - 1 + route.cps.length) % route.cps.length];
      const d = dirAt(route, prev.t);
      B.x = prev.x; B.z = prev.z; B.y = 0; B.vy = 0;
      B.speed = 0; B.velAngle = B.bikeYaw = Math.atan2(d.x, d.z);
      B.drift = 0; B.crashT = 0; B.grounded = true;
      race.pIdx = prev.i; race.pT = prev.t;
      popup('BACK ON TRACK (R×2 QUITS)', '#aaa', false);
      return true;
    },
  };
})();
