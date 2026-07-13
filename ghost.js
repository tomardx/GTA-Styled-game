'use strict';
/* ============================================================
   NEON RUSH — ghost.js : ghost replay (record / race / share)
   Loaded after race.js; exposes window.Ghost.
   ============================================================ */
(() => {

  const HZ = 20, STEP = 1 / HZ;
  const KEY = (ri) => 'neonrush_ghost_' + ri;
  const KEY_IMP = (ri) => 'neonrush_ghost_imp_' + ri;

  /* ---------- encoding: Int16 deltas (cm / millirad), base64 ---------- */
  function encodeSamples(sm) {
    const n = sm.x.length;
    const a = new Int16Array(n * 5);
    let qx = 0, qy = 0, qz = 0, qw = 0;
    for (let i = 0; i < n; i++) {
      const tx = Math.round(sm.x[i] * 100), ty = Math.round(sm.y[i] * 100), tz = Math.round(sm.z[i] * 100);
      const tw = Math.round(sm.yaw[i] * 1000);
      if (i === 0) { qx = tx; qy = ty; qz = tz; qw = tw; a.set([0, 0, 0, 0, Math.round(sm.lean[i] * 1000)], 0); continue; }
      a[i * 5] = clamp(tx - qx, -32000, 32000);
      a[i * 5 + 1] = clamp(ty - qy, -32000, 32000);
      a[i * 5 + 2] = clamp(tz - qz, -32000, 32000);
      a[i * 5 + 3] = clamp(tw - qw, -32000, 32000);
      a[i * 5 + 4] = Math.round(sm.lean[i] * 1000);
      qx += a[i * 5]; qy += a[i * 5 + 1]; qz += a[i * 5 + 2]; qw += a[i * 5 + 3];
    }
    const bytes = new Uint8Array(a.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 4096) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    }
    return btoa(s);
  }
  function decodeSamples(b64, start) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    const a = new Int16Array(bytes.buffer);
    const n = Math.floor(a.length / 5);
    const out = { n, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), yaw: new Float32Array(n), lean: new Float32Array(n) };
    let qx = Math.round(start[0] * 100), qy = Math.round(start[1] * 100), qz = Math.round(start[2] * 100), qw = Math.round(start[3] * 1000);
    for (let i = 0; i < n; i++) {
      if (i > 0) { qx += a[i * 5]; qy += a[i * 5 + 1]; qz += a[i * 5 + 2]; qw += a[i * 5 + 3]; }
      out.x[i] = qx / 100; out.y[i] = qy / 100; out.z[i] = qz / 100;
      out.yaw[i] = qw / 1000; out.lean[i] = a[i * 5 + 4] / 1000;
    }
    return out;
  }

  function loadGhost(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (!j || !j.data || !j.start) return null;
      j.samples = decodeSamples(j.data, j.start);
      return j;
    } catch (err) { return null; }
  }
  function saveGhost(key, g) {
    try { localStorage.setItem(key, JSON.stringify(g)); return true; } catch (err) { return false; }
  }

  /* ---------- ghost bikes ---------- */
  function makeGhostBike(color) {
    const model = makeRacerBike(color, color);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    model.group.traverse((o) => { if (o.isMesh) o.material = mat; });
    model.group.visible = false;
    scene.add(model.group);
    return model;
  }
  const ownGhostBike = makeGhostBike(0x5df3ff);
  const impGhostBike = makeGhostBike(0xff8a2a);

  /* ---------- state ---------- */
  const rec = { on: false, route: -1, next: 0, cps: [], x: [], y: [], z: [], yaw: [], lean: [] };
  const play = { own: null, imp: null, time: 0, active: false };

  function startPlayback(ri) {
    play.own = loadGhost(KEY(ri));
    play.imp = loadGhost(KEY_IMP(ri));
    play.active = !!(play.own || play.imp);
    play.time = 0;
    ownGhostBike.group.visible = false;
    impGhostBike.group.visible = false;
    if (play.own) popup('GHOST: ' + fmtT(play.own.time), '#5df3ff', false);
    if (play.imp) popup('RIVAL GHOST: ' + fmtT(play.imp.time), '#ff8a2a', false);
  }
  function fmtT(t) {
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function poseGhost(model, g, t) {
    const sm = g.samples;
    if (!sm || sm.n < 2) { model.group.visible = false; return; }
    const f = clamp(t / STEP, 0, sm.n - 1.001);
    const i0 = Math.floor(f), i1 = Math.min(sm.n - 1, i0 + 1), k = f - i0;
    model.group.visible = t <= g.time + 1;
    model.group.position.set(
      lerp(sm.x[i0], sm.x[i1], k),
      lerp(sm.y[i0], sm.y[i1], k) + 0.07,
      lerp(sm.z[i0], sm.z[i1], k));
    let dy = sm.yaw[i1] - sm.yaw[i0];
    if (dy > Math.PI) dy -= TAU; if (dy < -Math.PI) dy += TAU;
    model.group.rotation.y = sm.yaw[i0] + dy * k;
    model.lean.rotation.z = lerp(sm.lean[i0], sm.lean[i1], k);
  }

  /* ---------- hooks (called by race.js / game.js) ---------- */
  window.Ghost = {
    onRaceStart(ri, laps, name) {
      rec.on = true; rec.route = ri; rec.next = 0; rec.cps = [];
      rec.x = []; rec.y = []; rec.z = []; rec.yaw = []; rec.lean = [];
      rec.laps = laps; rec.name = name;
      startPlayback(ri);
    },
    tick(t) {
      if (rec.on && t >= rec.next) {
        rec.next += STEP;
        rec.x.push(B.x); rec.y.push(B.y); rec.z.push(B.z);
        rec.yaw.push(B.bikeYaw); rec.lean.push(B.lean);
      }
      play.time = t;
    },
    onCheckpoint(cpIdx, t) {
      if (rec.on) rec.cps.push(+t.toFixed(2));
      if (play.own && play.own.cps && play.own.cps[rec.cps.length - 1] !== undefined) {
        const diff = t - play.own.cps[rec.cps.length - 1];
        popup((diff <= 0 ? '' : '+') + diff.toFixed(1) + 's vs ghost', diff <= 0 ? '#7cff4d' : '#ff8a5a', false);
      }
    },
    onFinish(time, place) {
      if (!rec.on) return;
      rec.on = false;
      const prev = loadGhost(KEY(rec.route));
      if (!prev || time < prev.time) {
        const g = {
          v: 1, route: rec.route, name: rec.name, time: +time.toFixed(2),
          date: new Date().toISOString().slice(0, 10),
          hz: HZ, laps: rec.laps, cps: rec.cps,
          start: [rec.x[0] || 0, rec.y[0] || 0, rec.z[0] || 0, rec.yaw[0] || 0],
          data: encodeSamples(rec),
        };
        if (saveGhost(KEY(rec.route), g)) popup('GHOST SAVED — NEW BEST', '#5df3ff', false);
      }
      ownGhostBike.group.visible = false;
      impGhostBike.group.visible = false;
      play.active = false;
    },
    onAbort() {
      rec.on = false;
      play.active = false;
      ownGhostBike.group.visible = false;
      impGhostBike.group.visible = false;
    },
    update() {
      if (!play.active || !window.Race || Race.state !== 'racing') {
        if (Race && Race.state !== 'racing') {
          ownGhostBike.group.visible = false;
          impGhostBike.group.visible = false;
        }
        return;
      }
      if (play.own) poseGhost(ownGhostBike, play.own, play.time);
      if (play.imp) poseGhost(impGhostBike, play.imp, play.time);
    },
  };

  /* ---------- export / import UI (pause menu) ---------- */
  const btns = $('ghostbtns');
  if (typeof pauseGame === 'function') {
    const _pause = pauseGame, _resume = resumeGame, _start = startGame;
    pauseGame = function () { _pause(); if (btns) btns.style.display = 'flex'; };
    resumeGame = function () { _resume(); if (btns) btns.style.display = 'none'; };
    startGame = function () { _start(); if (btns) btns.style.display = 'none'; };
  }
  const bExp = $('gexp'), bImp = $('gimp');
  if (bExp) bExp.addEventListener('click', (e) => {
    e.stopPropagation();
    const all = [];
    for (let ri = 0; ri < 3; ri++) {
      try {
        const raw = localStorage.getItem(KEY(ri));
        if (raw) all.push(JSON.parse(raw));
      } catch (err) { }
    }
    if (!all.length) { popup('NO GHOSTS SAVED YET', '#888', false); return; }
    const blob = new Blob([JSON.stringify({ neonrush: 1, ghosts: all })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'neon-rush-ghosts.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  let fileInput = null;
  if (bImp) bImp.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.json,application/json';
      fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const j = JSON.parse(rd.result);
            const list = j.ghosts || (j.route !== undefined ? [j] : []);
            let n = 0;
            for (const g of list) {
              if (g && g.data && g.start && g.route >= 0 && g.route < 3) {
                saveGhost(KEY_IMP(g.route), g);
                n++;
              }
            }
            popup(n ? n + ' GHOST(S) IMPORTED' : 'NO VALID GHOSTS IN FILE', n ? '#ff8a2a' : '#888', false);
          } catch (err) { popup('IMPORT FAILED', '#ff5566', false); }
          fileInput.value = '';
        };
        rd.readAsText(f);
      });
    }
    fileInput.click();
  });
})();
