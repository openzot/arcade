/*
 * Spanwright — bolt timber beams into trusses over five flood-torn gaps,
 * then wave the valley school bus across. Strained members glow red and snap.
 *
 * Vanilla canvas + Web Audio. No dependencies, no network.
 */
(() => {
  "use strict";

  /* ---------- tiny helpers ---------- */

  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

  /* ---------- tuning ---------- */

  const W = 960;
  const H = 600;
  const RIVER_Y = H - 52;
  const GRID = 15;
  const SNAP_R = 27;
  const MIN_LEN = 26;
  const MAX_LEN = 175;
  const COST_PER = 30;

  const FIXED_DT = 1 / 60;
  const SUBSTEPS = 2;
  const ITER = 8;
  const STIFF = 0.32;
  const DAMP = 0.991;
  const G_JOINT = 1350;

  // Force model (static truss resolution, in "bus weights")
  const BUS_TOTAL = 1; // whole bus, shared across its wheels
  const SELF_W = 0.05; // each joint's own timber weight
  const VIS_SAG = 26000; // cosmetic dip accel fed into the verlet pass
  const F_MAX = 2.0; // axial force a timber carries before snapping
  const SNAP_FAST = 1.45; // instant snap above this
  const CREAK_AT = 0.55;
  const RESID_TOL = 0.75; // node equilibrium impossibility threshold

  const G_BUS = 2300;
  const BUS_SPEED = 108;
  const WHEELBASE = 22;
  const WHEEL_R = 11;
  const DECK_MAX_SLOPE = 0.58; // tan(~30deg)

  /* ---------- levels ---------- */

  const LEVELS = [
    {
      name: "The Culvert",
      blurb: "A short gap. Learn the craft: deck first, then brace it.",
      padL: { x: 330, y: 330 },
      padR: { x: 600, y: 330 },
      anchors: [
        [330, 330],
        [600, 330],
      ],
      budget: 30,
      par: 24,
    },
    {
      name: "Millrace Pillar",
      blurb:
        "Wider water - but the old millstone pier still stands mid-stream.",
      padL: { x: 300, y: 330 },
      padR: { x: 660, y: 330 },
      anchors: [
        [300, 330],
        [480, 430],
        [660, 330],
      ],
      budget: 36,
      par: 27,
    },
    {
      name: "High Bank",
      blurb: "The far side sheared higher. Your road has to climb.",
      padL: { x: 315, y: 365 },
      padR: { x: 645, y: 310 },
      anchors: [
        [315, 365],
        [645, 310],
      ],
      budget: 42,
      par: 31,
    },
    {
      name: "Setback",
      blurb: "Both edges crumbled. Sound stone sits back from the drop.",
      padL: { x: 300, y: 330 },
      padR: { x: 665, y: 330 },
      anchors: [
        [238, 338],
        [362, 400],
        [600, 400],
        [724, 338],
      ],
      budget: 56,
      par: 41,
    },
    {
      name: "The Last Crossing",
      blurb: "The widest cut of the five - and one stubborn spire to lean on.",
      padL: { x: 250, y: 340 },
      padR: { x: 715, y: 340 },
      anchors: [
        [250, 340],
        [480, 256],
        [715, 340],
      ],
      budget: 44,
      par: 30,
    },
  ];

  /* ---------- dom ---------- */

  const canvas = $("#game");
  const ctx = canvas.getContext("2d");
  const el = {
    level: $("#chip-level"),
    timber: $("#chip-timber"),
    state: $("#chip-state"),
    stars: $("#chip-stars"),
    toast: $("#toast"),
    test: $("#btn-test"),
    undo: $("#btn-undo"),
    clear: $("#btn-clear"),
    restart: $("#btn-restart"),
    pauseBtn: $("#btn-pause"),
    sound: $("#btn-sound"),
    ovTitle: $("#ov-title"),
    ovWin: $("#ov-win"),
    ovFail: $("#ov-fail"),
    ovDone: $("#ov-done"),
    ovPause: $("#ov-pause"),
    start: $("#btn-start"),
    wipe: $("#btn-wipe"),
    winLede: $("#win-lede"),
    winStars: $("#win-stars"),
    winStats: $("#win-stats"),
    next: $("#btn-next"),
    replay: $("#btn-replay"),
    failLede: $("#fail-lede"),
    failHint: $("#fail-hint"),
    backPlan: $("#btn-back-plan"),
    retry: $("#btn-retry"),
    doneStars: $("#done-stars"),
    doneNote: $("#done-note"),
    again: $("#btn-again"),
    resume: $("#btn-resume"),
  };

  /* ---------- audio ---------- */

  const Sfx = {
    ac: null,
    master: null,
    noiseBuf: null,
    engineOsc: null,
    engineGain: null,
    lastCreak: 0,
    muted: false,

    unlock() {
      if (this.ac) {
        if (this.ac.state === "suspended") this.ac.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(this.ac.destination);
      const len = this.ac.sampleRate;
      this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    },

    setMuted(m) {
      this.muted = m;
      if (this.master)
        this.master.gain.setTargetAtTime(
          m ? 0 : 0.85,
          this.ac.currentTime,
          0.02
        );
    },

    tone(freq, dur, type, vol, slideTo, when) {
      if (!this.ac || this.muted) return;
      const t0 = this.ac.currentTime + (when || 0);
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = type || "triangle";
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo)
        o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    },

    noise(dur, vol, freqLo, freqHi, type, when) {
      if (!this.ac || this.muted) return;
      const t0 = this.ac.currentTime + (when || 0);
      const src = this.ac.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = this.ac.createBiquadFilter();
      f.type = type || "bandpass";
      f.frequency.setValueAtTime(freqHi, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(30, freqLo), t0 + dur);
      f.Q.value = 0.9;
      const g = this.ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    },

    place() {
      this.tone(190, 0.07, "square", 0.12, 95);
      this.noise(0.05, 0.08, 500, 1600);
    },
    knock() {
      this.tone(120, 0.09, "square", 0.12, 60);
    },
    bad() {
      this.tone(82, 0.09, "sawtooth", 0.08, 70);
    },
    ui() {
      this.tone(520, 0.04, "triangle", 0.06);
    },
    creak(intensity) {
      const now = performance.now();
      if (now - this.lastCreak < 360) return;
      this.lastCreak = now;
      this.tone(95, 0.3, "sawtooth", 0.05 + intensity * 0.07, 62);
      this.noise(0.22, 0.03 + intensity * 0.04, 300, 900);
    },
    snap() {
      this.noise(0.13, 0.3, 350, 2400);
      this.tone(70, 0.16, "square", 0.2, 38);
    },
    splash() {
      this.noise(0.6, 0.4, 120, 900, "lowpass");
      this.tone(180, 0.4, "sine", 0.1, 50);
    },
    thud() {
      this.tone(85, 0.1, "sine", 0.16, 45);
      this.noise(0.08, 0.1, 120, 400, "lowpass");
    },
    win() {
      const notes = [523, 659, 784, 1047];
      notes.forEach((n, i) =>
        this.tone(n, 0.24, "triangle", 0.14, null, i * 0.09)
      );
    },
    fanfare() {
      const seq = [392, 523, 659, 784, 659, 784, 1047];
      seq.forEach((n, i) =>
        this.tone(n, 0.22, "triangle", 0.13, null, i * 0.11)
      );
    },

    engineStart() {
      if (!this.ac || this.engineOsc) return;
      this.engineOsc = this.ac.createOscillator();
      this.engineGain = this.ac.createGain();
      this.engineOsc.type = "sawtooth";
      this.engineOsc.frequency.value = 52;
      this.engineGain.gain.value = 0.0001;
      this.engineOsc.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
      this.engineGain.gain.setTargetAtTime(
        this.muted ? 0 : 0.028,
        this.ac.currentTime,
        0.1
      );
    },
    engineSet(speed) {
      if (!this.engineOsc) return;
      this.engineOsc.frequency.setTargetAtTime(
        46 + speed * 0.34,
        this.ac.currentTime,
        0.06
      );
    },
    engineStop() {
      if (!this.engineOsc) return;
      const o = this.engineOsc;
      const g = this.engineGain;
      g.gain.setTargetAtTime(0.0001, this.ac.currentTime, 0.06);
      setTimeout(() => {
        try {
          o.stop();
        } catch (e) {
          /* already stopped */
        }
      }, 260);
      this.engineOsc = null;
      this.engineGain = null;
    },
  };

  /* ---------- persistence ---------- */

  const SAVE_KEY = "spanwright-progress-v1";

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (!v || typeof v !== "object") return null;
      return {
        lvl: clamp(v.lvl | 0, 0, LEVELS.length - 1),
        stars: Array.isArray(v.stars) ? v.stars : [],
      };
    } catch (e) {
      return null;
    }
  }

  function writeSave() {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ lvl: save.lvl, stars: save.stars })
      );
    } catch (e) {
      /* private mode etc. */
    }
  }

  const save = loadSave() || { lvl: 0, stars: [] };

  /* ---------- state ---------- */

  let levelIndex = clamp(save.lvl, 0, LEVELS.length - 1);
  let phase = "title"; // title | build | test | won | lost | done
  let paused = false;

  // build-phase canonical structures
  let joints = []; // {x,y,pin}
  let beams = []; // {a,b,rest}
  let undoStack = [];

  // physics copies (only valid during test)
  let pjoints = [];
  let pbeams = [];
  let stress = []; // smoothed |force|/F_MAX per live beam
  let nodeLoad = []; // bus weight routed onto each joint this frame

  let budgetUsed = 0;

  const bus = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    wheelRot: 0,
    speed: 0,
    grounded: false,
    stuckT: 0,
    state: "idle", // idle | run | fall | done | lost
    bobT: 0,
    offscreenHandled: false,
  };

  let particles = [];
  let shake = 0;
  let selectedBeam = -1;
  let selectedT = 0;
  let pendingStart = -1; // joint index for keyboard building
  let cursor = { x: 0, y: 0 };
  let dragFrom = -1;
  let dragPt = null;
  let hoverJoint = -1;
  let toastTimer = 0;
  let hintedBrace = false;
  let time = 0;
  let rain = [];

  /* ---------- level setup ---------- */

  function level() {
    return LEVELS[levelIndex];
  }

  function costOf(len) {
    return Math.max(1, Math.round(len / COST_PER));
  }

  function loadLevel(i) {
    levelIndex = clamp(i, 0, LEVELS.length - 1);
    const lv = level();
    joints = lv.anchors.map(([x, y]) => ({ x, y, pin: true }));
    beams = [];
    undoStack = [];
    budgetUsed = 0;
    selectedBeam = -1;
    pendingStart = -1;
    dragFrom = -1;
    dragPt = null;
    particles = [];
    shake = 0;
    hintedBrace = false;
    bus.state = "idle";
    bus.offscreenHandled = false;
    Sfx.engineStop();
    paused = false;
    phase = "build";
    hideOverlays();
    cursor.x = lv.padL.x;
    cursor.y = lv.padL.y;
    refreshHud();
    refreshToolbar();
    if (!(save.stars[levelIndex] > 0))
      toast("Drag from a steel anchor to lay your first beam.", false, 3000);
  }

  function budgetLeft() {
    return level().budget - budgetUsed;
  }

  function jointAt(x, y, rad) {
    let best = -1;
    let bd = rad * rad;
    for (let i = 0; i < joints.length; i++) {
      const d = (joints[i].x - x) ** 2 + (joints[i].y - y) ** 2;
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  function snapPoint(x, y) {
    const ji = jointAt(x, y, SNAP_R);
    if (ji >= 0) return { x: joints[ji].x, y: joints[ji].y, joint: ji };
    const gx = clamp(Math.round(x / GRID) * GRID, GRID, W - GRID);
    const gy = clamp(Math.round(y / GRID) * GRID, GRID, RIVER_Y - GRID);
    const near = jointAt(gx, gy, 9);
    if (near >= 0) return { x: joints[near].x, y: joints[near].y, joint: near };
    return { x: gx, y: gy, joint: -1 };
  }

  function hasBeam(a, b) {
    return beams.some(
      (bm) => (bm.a === a && bm.b === b) || (bm.a === b && bm.b === a)
    );
  }

  function tryPlace(ai, pt, silent) {
    const A = joints[ai];
    let bi = pt.joint;
    if (bi < 0) {
      if (
        pt.x < GRID ||
        pt.x > W - GRID ||
        pt.y < GRID ||
        pt.y > RIVER_Y - GRID
      )
        return fail("That spot is no good.", silent);
      if (dist(A.x, A.y, pt.x, pt.y) < 9) return fail(null, silent);
      joints.push({ x: pt.x, y: pt.y, pin: false });
      bi = joints.length - 1;
    }
    if (bi === ai) return fail(null, silent);
    if (hasBeam(ai, bi)) return fail("Already braced there.", silent);
    const len = dist(A.x, A.y, joints[bi].x, joints[bi].y);
    if (len < MIN_LEN) return fail("Too short to matter.", silent);
    if (len > MAX_LEN) return fail("Longer than any plank you have.", silent);
    const cost = costOf(len);
    if (cost > budgetLeft()) return fail("Not enough timber left.", silent);
    beams.push({ a: ai, b: bi, rest: len });
    budgetUsed += cost;
    undoStack.push({ t: "add", b: beams[beams.length - 1], cost });
    selectedBeam = -1;
    Sfx.place();
    refreshHud();
    refreshToolbar();
    return true;
  }

  function fail(msg, silent) {
    if (msg && !silent) {
      toast(msg, true, 1400);
      Sfx.bad();
    }
    return false;
  }

  function removeBeam(idx, pushUndo) {
    const bm = beams[idx];
    if (!bm) return;
    beams.splice(idx, 1);
    budgetUsed = Math.max(0, budgetUsed - costOf(bm.rest));
    if (pushUndo) undoStack.push({ t: "del", b: bm });
    selectedBeam = -1;
    Sfx.knock();
    refreshHud();
    refreshToolbar();
  }

  function beamNear(x, y, rad) {
    let best = -1;
    let bd = rad * rad;
    for (let i = 0; i < beams.length; i++) {
      const bm = beams[i];
      const ax = joints[bm.a].x;
      const ay = joints[bm.a].y;
      const bx = joints[bm.b].x;
      const by = joints[bm.b].y;
      const dx = bx - ax;
      const dy = by - ay;
      const L2 = dx * dx + dy * dy || 1;
      let t = ((x - ax) * dx + (y - ay) * dy) / L2;
      t = clamp(t, 0, 1);
      const px = ax + dx * t;
      const py = ay + dy * t;
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  function doUndo() {
    const act = undoStack.pop();
    if (!act) {
      Sfx.bad();
      return;
    }
    if (act.t === "add") {
      const i = beams.indexOf(act.b);
      if (i >= 0) {
        beams.splice(i, 1);
        budgetUsed = Math.max(0, budgetUsed - act.cost);
      }
    } else if (act.t === "del") {
      beams.push(act.b);
      budgetUsed += costOf(act.b.rest);
    } else if (act.t === "clear") {
      act.items.forEach((bm) => {
        beams.push(bm);
        budgetUsed += costOf(bm.rest);
      });
    }
    selectedBeam = -1;
    pendingStart = -1;
    Sfx.knock();
    refreshHud();
    refreshToolbar();
  }

  function doClear() {
    if (!beams.length) return;
    undoStack.push({ t: "clear", items: beams.slice() });
    beams = [];
    budgetUsed = 0;
    selectedBeam = -1;
    pendingStart = -1;
    Sfx.knock();
    refreshHud();
    refreshToolbar();
  }

  /* ---------- test phase ---------- */

  function startTest() {
    if (!beams.length) {
      toast("Lay some timber first - the bus will not swim.", true, 2200);
      Sfx.bad();
      return;
    }
    // prune to pinned + referenced joints, remapping indices
    const used = new Set();
    beams.forEach((b) => {
      used.add(b.a);
      used.add(b.b);
    });
    const map = new Map();
    pjoints = [];
    joints.forEach((j, i) => {
      if (j.pin || used.has(i)) {
        map.set(i, pjoints.length);
        pjoints.push({ x: j.x, y: j.y, px: j.x, py: j.y, pin: j.pin });
      }
    });
    pbeams = beams.map((b) => ({
      a: map.get(b.a),
      b: map.get(b.b),
      rest: b.rest,
      live: true,
    }));
    stress = new Array(pbeams.length).fill(0);
    nodeLoad = new Array(pjoints.length).fill(0);

    phase = "test";
    selectedBeam = -1;
    pendingStart = -1;
    dragFrom = -1;
    dragPt = null;
    const lv = level();
    bus.x = Math.max(46, lv.padL.x - 58);
    bus.y = lv.padL.y - WHEEL_R;
    bus.vx = 0;
    bus.vy = 0;
    bus.angle = 0;
    bus.speed = 0;
    bus.wheelRot = 0;
    bus.grounded = true;
    bus.stuckT = 0;
    bus.state = "run";
    bus.bobT = 0;
    bus.offscreenHandled = false;
    particles = [];
    shake = 0;
    Sfx.unlock();
    Sfx.engineStart();
    setStatus("TESTING", "test");
    refreshHud();
    refreshToolbar();
  }

  function backToPlan() {
    Sfx.engineStop();
    phase = "build";
    bus.state = "idle";
    pjoints = [];
    pbeams = [];
    particles = [];
    shake = 0;
    refreshHud();
    refreshToolbar();
  }

  function retryTest() {
    hideOverlays();
    startTest();
  }

  /* ---------- verlet motion (feel) ---------- */

  function physStep(dt) {
    const sub = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      for (let i = 0; i < pjoints.length; i++) {
        const j = pjoints[i];
        if (j.pin) continue;
        const vx = (j.x - j.px) * DAMP;
        const vy = (j.y - j.py) * DAMP;
        j.px = j.x;
        j.py = j.y;
        j.x += vx;
        j.y += vy + (G_JOINT + nodeLoad[i] * VIS_SAG) * sub * sub;
      }
      for (let it = 0; it < ITER; it++) {
        for (let k = 0; k < pbeams.length; k++) {
          const bm = pbeams[k];
          if (!bm.live) continue;
          const A = pjoints[bm.a];
          const B = pjoints[bm.b];
          let dx = B.x - A.x;
          let dy = B.y - A.y;
          const d = Math.hypot(dx, dy) || 0.0001;
          const diff = ((d - bm.rest) / d) * STIFF * 0.5;
          dx *= diff;
          dy *= diff;
          if (!A.pin) {
            A.x += dx;
            A.y += dy;
          }
          if (!B.pin) {
            B.x -= dx;
            B.y -= dy;
          }
        }
      }
    }
  }

  /* ---------- static force resolution ---------- */

  // Solve the pin-jointed truss for member axial forces with a damped
  // least-squares fit:  minimize ||A f - b||^2 + lambda |f|^2.
  // Structurally impossible layouts (a flat unsupported deck) leave a large
  // residual, which is treated as an overload.
  function solveForces() {
    const n = pjoints.length;
    const m = pbeams.length;
    const freeOf = new Int32Array(n).fill(-1);
    let nf = 0;
    for (let i = 0; i < n; i++)
      if (!pjoints[i].pin && (nodeLoad[i] !== 0 || touchesBeam(i)))
        freeOf[i] = nf++;

    const rows = nf * 2;
    if (rows === 0 || m === 0) {
      stress.fill(0);
      return;
    }

    // b = load vector
    const b = new Float64Array(rows);
    for (let i = 0; i < n; i++) {
      const fi = freeOf[i];
      if (fi < 0) continue;
      b[fi * 2] = 0;
      b[fi * 2 + 1] = nodeLoad[i] + SELF_W;
    }

    // A: each beam contributes its unit direction at both end rows
    const dirs = [];
    const A = new Float64Array(m * rows);
    for (let k = 0; k < m; k++) {
      const bm = pbeams[k];
      const P = pjoints[bm.a];
      const Q = pjoints[bm.b];
      const len = Math.hypot(Q.x - P.x, Q.y - P.y) || 1;
      const ux = (Q.x - P.x) / len;
      const uy = (Q.y - P.y) / len;
      dirs.push([ux, uy]);
      const fa = freeOf[bm.a];
      const fb = freeOf[bm.b];
      if (fa >= 0) {
        A[k * rows + fa * 2] = ux;
        A[k * rows + fa * 2 + 1] = uy;
      }
      if (fb >= 0) {
        A[k * rows + fb * 2] -= ux;
        A[k * rows + fb * 2 + 1] -= uy;
      }
    }

    // normal equations: (AtA + lam I) f = Atb
    const AtA = new Float64Array(m * m);
    const Atb = new Float64Array(m);
    for (let r = 0; r < m; r++) {
      for (let c = r; c < m; c++) {
        let s = 0;
        for (let q = 0; q < rows; q++) s += A[r * rows + q] * A[c * rows + q];
        AtA[r * m + c] = s;
        AtA[c * m + r] = s;
      }
      let sb = 0;
      for (let q = 0; q < rows; q++) sb += A[r * rows + q] * b[q];
      Atb[r] = sb;
    }
    const lam = 1e-3;
    for (let r = 0; r < m; r++) AtA[r * m + r] += lam;

    const f = solveLinear(AtA, Atb, m);

    // per-beam instantaneous stress + node residuals
    const resid = new Float64Array(rows);
    for (let k = 0; k < m; k++) {
      const bm = pbeams[k];
      if (!bm.live) continue;
      const fk = f[k];
      const fa = freeOf[bm.a];
      const fb = freeOf[bm.b];
      if (fa >= 0) {
        resid[fa * 2] += dirs[k][0] * fk;
        resid[fa * 2 + 1] += dirs[k][1] * fk;
      }
      if (fb >= 0) {
        resid[fb * 2] -= dirs[k][0] * fk;
        resid[fb * 2 + 1] -= dirs[k][1] * fk;
      }
    }
    let worstResid = 0;
    for (let q = 1; q < rows; q += 2) {
      const rx = resid[q - 1];
      const ry = resid[q] - (b[q] || 0);
      void rx;
      const mag = Math.hypot(resid[q - 1], ry);
      if (mag > worstResid) worstResid = mag;
    }

    for (let k = 0; k < m; k++) {
      const bm = pbeams[k];
      if (!bm.live) continue;
      const inst = Math.abs(f[k]) / F_MAX;
      stress[k] = lerp(stress[k], inst, 0.28);
      if (inst > CREAK_AT) Sfx.creak(Math.min(1, inst - CREAK_AT));
      const broken =
        inst > SNAP_FAST ||
        (stress[k] > 1 && Math.abs(f[k]) > 1e9) || // singular blow-up
        (worstResid > RESID_TOL &&
          (bm.a === heaviestTouch(worstResidJoint(rows, resid, freeOf)) ||
            bm.b === heaviestTouch(worstResidJoint(rows, resid, freeOf))));
      if (inst > SNAP_FAST || (worstResid > RESID_TOL && stress[k] > 0.8)) {
        snapBeam(k);
      } else if (broken) {
        snapBeam(k);
      }
    }
  }

  function heaviestTouch() {
    return -1; // placeholder, replaced below
  }

  function worstResidJoint(rows, resid, freeOf) {
    const f = solveLinear(AtA, Atb, m);

    // per-beam instantaneous force + node residuals
    const resid = new Float64Array(rows);
    for (let k = 0; k < m; k++) {
      if (!pbeams[k].live) continue;
      const fa = freeOf[pbeams[k].a];
      const fb = freeOf[pbeams[k].b];
      if (fa >= 0) {
        resid[fa * 2] += dirs[k][0] * f[k];
        resid[fa * 2 + 1] += dirs[k][1] * f[k];
      }
      if (fb >= 0) {
        resid[fb * 2] -= dirs[k][0] * f[k];
        resid[fb * 2 + 1] -= dirs[k][1] * f[k];
      }
    }
    let worstResid = 0;
    for (let q = 0; q < rows; q++) {
      const mag = Math.abs(resid[q]);
      if (mag > worstResid) worstResid = mag;
    }
    // vertical residual is what matters; horizontal self-balance is fine
    for (let i = 0; i < n; i++) {
      const fi = freeOf[i];
      if (fi >= 0) resid[fi * 2] = 0; // ignore horizontal component
    }

    for (let k = 0; k < m; k++) {
      const bm = pbeams[k];
      if (!bm.live) continue;
      const inst = Math.abs(f[k]) / F_MAX;
      stress[k] = lerp(stress[k], inst, 0.28);
      if (inst > CREAK_AT) Sfx.creak(Math.min(1, inst - CREAK_AT));
      const snap =
        inst > SNAP_FAST || (worstResid > RESID_TOL && stress[k] > 0.8);
      if (snap) snapBeam(k);
    }
  }
  function supportAt(wx, wheelBottom, tol) {
    let best = null;
    let bestY = Infinity;
    const lv = level();
    const scan = (ax, ay, bx, by, isGround) => {
      const dx = bx - ax;
      const dy = by - ay;
      if (Math.abs(dx) < 0.001) return;
      const slope = dy / dx;
      if (!isGround && Math.abs(slope) > DECK_MAX_SLOPE) return;
      const minX = Math.min(ax, bx) - 2;
      const maxX = Math.max(ax, bx) + 2;
      if (wx < minX || wx > maxX) return;
      const sy = ay + slope * (wx - ax);
      if (sy < wheelBottom - 12) return; // surface is above the wheel
      if (sy < bestY) {
        bestY = sy;
        best = { y: sy, ax, ay, bx, by, ground: !!isGround };
      }
    };
    scan(-40, lv.padL.y, lv.padL.x, lv.padL.y, true);
    scan(lv.padR.x, lv.padR.y, W + 40, lv.padR.y, true);
    for (let k = 0; k < pbeams.length; k++) {
      const bm = pbeams[k];
      if (!bm.live) continue;
      const A = pjoints[bm.a];
      const B = pjoints[bm.b];
      scan(A.x, A.y, B.x, B.y, false);
    }
    if (best && tol !== undefined && best.y > wheelBottom + tol) return null;
    return best;
  }

  function routeWheelLoad(seg, half) {
    if (!seg || seg.ground) return;
    const dx = seg.bx - seg.ax;
    const dy = seg.by - seg.ay;
    const L2 = dx * dx + dy * dy || 1;
    let t = ((bus.x - seg.ax) * dx + (bus.y + WHEEL_R - seg.ay) * dy) / L2;
    t = clamp(t, 0, 1);
    for (let k = 0; k < pbeams.length; k++) {
      const bm = pbeams[k];
      if (!bm.live) continue;
      const A = pjoints[bm.a];
      const B = pjoints[bm.b];
      const fwd =
        Math.abs(A.x - seg.ax) < 0.5 &&
        Math.abs(A.y - seg.ay) < 0.5 &&
        Math.abs(B.x - seg.bx) < 0.5 &&
        Math.abs(B.y - seg.by) < 0.5;
      const rev =
        Math.abs(B.x - seg.ax) < 0.5 &&
        Math.abs(B.y - seg.ay) < 0.5 &&
        Math.abs(A.x - seg.bx) < 0.5 &&
        Math.abs(A.y - seg.by) < 0.5;
      if (fwd) {
        nodeLoad[bm.a] += half * (1 - t);
        nodeLoad[bm.b] += half * t;
        return;
      }
      if (rev) {
        nodeLoad[bm.b] += half * (1 - t);
        nodeLoad[bm.a] += half * t;
        return;
      }
    }
  }

  function busStep(dt) {
    const rx = bus.x - WHEELBASE;
    const fx = bus.x + WHEELBASE;

    if (bus.state === "fall") {
      bus.vy += G_BUS * dt;
      bus.y += bus.vy * dt;
      bus.x += bus.vx * dt;
      bus.vx *= 0.995;
      bus.angle += 1.1 * dt;
      const rb = bus.y + WHEEL_R;
      const landTol = Math.max(16, bus.vy * dt + 6);
      const rs = supportAt(rx, rb, landTol);
      const fs = supportAt(fx, rb, landTol);
      if (rs && fs && Math.abs(rs.y - fs.y) < 26) {
        bus.y = (rs.y + fs.y) / 2 - WHEEL_R;
        bus.vy = 0;
        bus.vx = Math.max(bus.vx, 20);
        bus.state = "run";
        bus.grounded = true;
        puff(bus.x, bus.y + WHEEL_R);
        Sfx.thud();
        shake = Math.min(9, shake + 4);
      }
      if (bus.y > RIVER_Y + 14) crash();
      return;
    }

    if (bus.state === "done") {
      bus.speed = lerp(bus.speed, 132, 1 - Math.exp(-dt * 2));
      bus.x += bus.speed * dt;
      bus.angle = lerp(bus.angle, 0, 1 - Math.exp(-dt * 4));
      bus.wheelRot += (bus.speed * dt) / WHEEL_R;
      if (bus.x > W + 120 && !bus.offscreenHandled) {
        bus.offscreenHandled = true;
        onWon();
      }
      return;
    }

    if (bus.state !== "run") return;

    const rb = bus.y + WHEEL_R;
    const rs = supportAt(rx, rb);
    const fs = supportAt(fx, rb);

    if (rs && fs) {
      const ry = rs.y - WHEEL_R;
      const fy = fs.y - WHEEL_R;
      const ny = (ry + fy) / 2;
      const grade = (fy - ry) / (WHEELBASE * 2);
      if (Math.abs(ny - bus.y) > 30) {
        bus.grounded = false;
        bus.state = "fall";
        bus.vy = Math.max(20, bus.speed * grade * 30);
        bus.vx = Math.max(bus.speed * 0.7, 26);
        return;
      }
      bus.y = ny;
      bus.angle = Math.atan2(fy - ry, WHEELBASE * 2);
      const uphill = -grade; // negative grade = climbing
      const factor = clamp(1 - uphill * 2.1, 0.16, 1.35);
      const target = BUS_SPEED * factor;
      bus.speed = lerp(bus.speed, target, 1 - Math.exp(-dt * 1.6));
      bus.x += bus.speed * dt;
      bus.wheelRot += (bus.speed * dt) / WHEEL_R;
      bus.bobT += dt * bus.speed * 0.05;
      bus.grounded = true;
      bus.stuckT = bus.speed < 8 ? bus.stuckT + dt : 0;
      if (bus.stuckT > 2.4 && bus.stuckT < 100) {
        setStatus("STALLED", "bad");
        toast("Grade too steep - rebuild with a gentler road.", true, 2400);
        bus.stuckT = 999;
      }
      routeWheelLoad(fs, BUS_TOTAL * 0.25);
      routeWheelLoad(rs, BUS_TOTAL * 0.25);
      if (fx >= level().padR.x + 16) {
        bus.state = "done";
        setStatus("ACROSS!", "");
        Sfx.win();
      }
    } else {
      bus.grounded = false;
      bus.state = "fall";
      bus.vy = Math.max(bus.vy, bus.speed * 0.12);
      bus.vx = Math.max(bus.speed * 0.72, 26);
    }
    Sfx.engineSet(bus.state === "run" ? bus.speed : 30);
  }

  function crash() {
    bus.state = "lost";
    Sfx.engineStop();
    Sfx.splash();
    splashFx(bus.x, RIVER_Y + 4);
    shake = 10;
    setStatus("SPLASH!", "bad");
    setTimeout(() => {
      if (phase === "test") onLost();
    }, 1100);
  }

  /* ---------- outcomes ---------- */

  const FAIL_HINTS = [
    "Triangles spread the load. A lone flat plank folds like paper.",
    "Shorten the unsupported stretch - more joints, shorter spans.",
    "Lean on the terrain: pillars, spires and setbacks are free strength.",
    "Amber means creaking. Red means swimming.",
  ];

  function onLost() {
    phase = "lost";
    el.failLede.textContent =
      "The valley bus takes a dip. The gang fishes it out with horses.";
    el.failHint.textContent =
      FAIL_HINTS[(Math.random() * FAIL_HINTS.length) | 0];
    show(el.ovFail);
    refreshToolbar();
  }

  function starString(n) {
    let s = "";
    for (let i = 0; i < 3; i++) s += i < n ? "\u2605" : "\u2606";
    return s;
  }

  function pickWinLine(stars) {
    if (stars === 3) return "Textbook trusswork. The inspector whistles.";
    if (stars === 2) return "Solid span. A little fat on the timber, though.";
    return "It held. Nobody asked what it cost... out loud.";
  }

  function onWon() {
    const used = budgetUsed;
    const par = level().par;
    const stars = used <= par ? 3 : used <= Math.ceil(par * 1.25) ? 2 : 1;
    if ((save.stars[levelIndex] | 0) < stars) save.stars[levelIndex] = stars;
    const done = levelIndex >= LEVELS.length - 1;
    save.lvl = done ? levelIndex : levelIndex + 1;
    writeSave();
    phase = "won";
    const total = save.stars.reduce((a, b) => a + (b | 0), 0);
    if (done) {
      el.doneStars.textContent =
        starString(stars) + "   \u2022   " + total + "/15 overall";
      el.doneNote.textContent =
        "Every crossing rigged. The inspector counted " +
        total +
        " star" +
        (total === 1 ? "" : "s") +
        " of spare timber - go make him happier.";
      show(el.ovDone);
      Sfx.fanfare();
    } else {
      el.winStars.textContent = starString(stars);
      el.winStats.textContent =
        "Timber used " +
        used +
        " of " +
        level().budget +
        " \u00b7 three-star par " +
        par;
      el.winLede.textContent = pickWinLine(stars);
      show(el.ovWin);
    }
    refreshHud();
    refreshToolbar();
  }

  /* ---------- particles ---------- */

  function splinters(x, y) {
    for (let i = 0; i < 14; i++)
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 220,
        vy: -Math.random() * 170 - 30,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 9,
        life: 0.9 + Math.random() * 0.5,
        t: 0,
        kind: "splinter",
        size: 3 + Math.random() * 5,
      });
  }

  function splashFx(x, y) {
    for (let i = 0; i < 26; i++)
      particles.push({
        x: x + (Math.random() - 0.5) * 40,
        y,
        vx: (Math.random() - 0.5) * 190,
        vy: -Math.random() * 300 - 60,
        life: 1 + Math.random() * 0.4,
        t: 0,
        kind: "spray",
        size: 2 + Math.random() * 3,
      });
  }

  function puff(x, y) {
    for (let i = 0; i < 8; i++)
      particles.push({
        x: x + (Math.random() - 0.5) * 30,
        y: y - Math.random() * 6,
        vx: (Math.random() - 0.5) * 60,
        vy: -Math.random() * 40,
        life: 0.5 + Math.random() * 0.3,
        t: 0,
        kind: "dust",
        size: 4 + Math.random() * 6,
      });
  }

  function stepParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += (p.kind === "spray" ? 900 : p.kind === "dust" ? -30 : 800) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.rot !== undefined) p.rot += p.vr * dt;
      if (p.kind === "spray" && p.y > RIVER_Y + 10) particles.splice(i, 1);
    }
  }

  /* ---------- rendering ---------- */

  let viewScale = 1;
  let lastW = 0;

  function resizeIfNeeded() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width && Math.abs(rect.width - lastW) > 0.5) {
      lastW = rect.width;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      viewScale = canvas.width / W;
    }
  }

  const ridgePath = (() => {
    const far = new Path2D();
    far.moveTo(0, 210);
    for (let x = 0; x <= W; x += 24)
      far.lineTo(x, 205 + Math.sin(x * 0.011) * 34 + Math.sin(x * 0.037 + 2) * 14);
    far.lineTo(W, H);
    far.lineTo(0, H);
    far.closePath();
    const near = new Path2D();
    near.moveTo(0, 268);
    for (let x = 0; x <= W; x += 20)
      near.lineTo(x, 268 + Math.sin(x * 0.017 + 5) * 26 + Math.sin(x * 0.05 + 1) * 9);
    near.lineTo(W, H);
    near.lineTo(0, H);
    near.closePath();
    return { far, near };
  })();

  function initRain() {
    rain = [];
    for (let i = 0; i < 70; i++)
      rain.push({
        x: Math.random() * W,
        y: Math.random() * H,
        v: 380 + Math.random() * 260,
        l: 7 + Math.random() * 9,
      });
  }

  function drawSky(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1a2130");
    g.addColorStop(0.45, "#2b3a49");
    g.addColorStop(0.75, "#4a5a63");
    g.addColorStop(1, "#6b6a58");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const mx = W - 150;
    const my = 92;
    const halo = ctx.createRadialGradient(mx, my, 6, mx, my, 90);
    halo.addColorStop(0, "rgba(240,235,215,0.32)");
    halo.addColorStop(1, "rgba(240,235,215,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(mx - 95, my - 95, 190, 190);
    ctx.fillStyle = "#efe9d8";
    ctx.beginPath();
    ctx.arc(mx, my, 17, 0, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(43,58,73,0.55)";
    ctx.beginPath();
    ctx.arc(mx - 6, my - 4, 4, 0, 7);
    ctx.arc(mx + 5, my + 6, 3, 0, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(30,40,52,0.85)";
    ctx.fill(ridgePath.far);
    ctx.fillStyle = "rgba(22,30,40,0.95)";
    ctx.fill(ridgePath.near);
    ctx.strokeStyle = "rgba(200,214,228,0.13)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const r of rain) {
      const yy = (r.y + t * r.v) % (H + 40);
      const xx = (((r.x - t * 60) % W) + W) % W;
      ctx.moveTo(xx, yy - r.l);
      ctx.lineTo(xx + 3, yy);
    }
    ctx.stroke();
  }

  function drawRiver(t) {
    const g = ctx.createLinearGradient(0, RIVER_Y, 0, H);
    g.addColorStop(0, "#274248");
    g.addColorStop(1, "#152a33");
    ctx.fillStyle = g;
    ctx.fillRect(0, RIVER_Y, W, H - RIVER_Y);
    ctx.strokeStyle = "rgba(210,225,230,0.16)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
      const yy = RIVER_Y + 8 + ((i * 37) % (H - RIVER_Y - 14));
      const xx = ((i * 173 + t * (26 + (i % 5) * 14)) % (W + 120)) - 60;
      ctx.moveTo(xx, yy);
      ctx.lineTo(xx + 26 + (i % 4) * 10, yy);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(238,232,212,0.10)";
    ctx.beginPath();
    ctx.ellipse(W - 150, RIVER_Y + 22, 46, 7, 0, 0, 7);
    ctx.fill();
  }

  function drawBank(x0, x1, topY, dir) {
    ctx.fillStyle = "#20262e";
    ctx.beginPath();
    ctx.moveTo(x0, topY);
    ctx.lineTo(x1, topY);
    const innerX = dir < 0 ? x1 - 34 : x1 + 34;
    ctx.lineTo(innerX, topY + 52);
    ctx.lineTo(dir < 0 ? x0 + 10 : x1 - 10, RIVER_Y + 6);
    ctx.lineTo(dir < 0 ? x0 : x1, RIVER_Y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0 + 6, topY + 30);
    ctx.lineTo(x0 + (x1 - x0) * 0.55, topY + 34);
    ctx.stroke();
    ctx.strokeStyle = "#4c6b3c";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x0, topY);
    ctx.lineTo(x1, topY);
    ctx.stroke();
  }

  function drawPad(px, py, side) {
    ctx.fillStyle = "#6e4a26";
    const w = 44;
    const x = side < 0 ? px - w : px;
    ctx.fillRect(x, py - 3, w, 7);
    ctx.fillStyle = "#59391c";
    for (let i = 1; i < 4; i++) ctx.fillRect(x + (w / 4) * i, py - 3, 2, 7);
    ctx.fillStyle = "#3a3f47";
    ctx.fillRect(side < 0 ? px - 10 : px + 4, py - 22, 6, 20);
    ctx.fillRect(side < 0 ? px - 13 : px + 1, py - 25, 12, 4);
  }

  function anchorOnBank(ax) {
    const lv = level();
    return ax <= lv.padL.x + 1 || ax >= lv.padR.x - 1;
  }

  function drawAnchorTerrain() {
    const lv = level();
    for (const [ax, ay] of lv.anchors) {
      if (anchorOnBank(ax)) continue;
      // rock tooth / spire holding this anchor
      const h = RIVER_Y + 6 - ay;
      const baseW = clamp(h * 0.42, 26, 64);
      ctx.fillStyle = "#232a33";
      ctx.beginPath();
      ctx.moveTo(ax - baseW, RIVER_Y + 6);
      ctx.lineTo(ax - baseW * 0.45, ay + h * 0.35);
      ctx.lineTo(ax - 11, ay + 6);
      ctx.lineTo(ax + 9, ay + 4);
      ctx.lineTo(ax + baseW * 0.5, ay + h * 0.42);
      ctx.lineTo(ax + baseW, RIVER_Y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax - baseW * 0.3, ay + h * 0.5);
      ctx.lineTo(ax - 6, ay + h * 0.18);
      ctx.stroke();
      ctx.strokeStyle = "#4c6b3c";
      ctx.beginPath();
      ctx.moveTo(ax - 12, ay + 5);
      ctx.lineTo(ax + 10, ay + 3);
      ctx.stroke();
    }
  }

  function label(text, x, y, color) {
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = "rgba(18,22,28,0.85)";
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 10, w, 20, 9);
    ctx.fill();
    ctx.fillStyle = color || "#f2ead4";
    ctx.fillText(text, x, y + 0.5);
  }

  function drawBeams() {
    ctx.lineCap = "round";
    for (let k = 0; k < beams.length; k++) {
      const bm = beams[k];
      const A = joints[bm.a];
      const B = joints[bm.b];
      const sel = k === selectedBeam;
      ctx.strokeStyle = sel ? "#e8c56a" : "#6e4a24";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
      ctx.strokeStyle = sel ? "#f4df9a" : "#b5793a";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = "rgba(78,50,24,0.5)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(lerp(A.x, B.x, 0.2), lerp(A.y, B.y, 0.2));
      ctx.lineTo(lerp(A.x, B.x, 0.8), lerp(A.y, B.y, 0.8));
      ctx.stroke();
    }
    if (selectedBeam >= 0 && beams[selectedBeam]) {
      const bm = beams[selectedBeam];
      const A = joints[bm.a];
      const B = joints[bm.b];
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = "#ffdf8a";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y - 9);
      ctx.lineTo(B.x, B.y - 9);
      ctx.stroke();
      ctx.setLineDash([]);
      label(
        "tap again to remove",
        (A.x + B.x) / 2,
        (A.y + B.y) / 2 - 16,
        "#ffe9ad"
      );
    }
  }

  function beamDegree(ji) {
    let n = 0;
    for (const bm of beams) if (bm.a === ji || bm.b === ji) n++;
    return n;
  }

  function drawJoints() {
    for (let i = 0; i < joints.length; i++) {
      const j = joints[i];
      if (!j.pin && beamDegree(i) === 0) continue;
      if (j.pin) {
        ctx.fillStyle = "#8b95a2";
        ctx.beginPath();
        ctx.roundRect(j.x - 9, j.y - 9, 18, 18, 4);
        ctx.fill();
        ctx.fillStyle = "#59636f";
        ctx.beginPath();
        ctx.roundRect(j.x - 9, j.y - 2, 18, 11, 3);
        ctx.fill();
      }
      ctx.fillStyle = j.pin ? "#cfd6de" : "#33291c";
      ctx.beginPath();
      ctx.arc(j.x, j.y, j.pin ? 5.5 : 5, 0, 7);
      ctx.fill();
      ctx.fillStyle = j.pin ? "#f4f7fa" : "rgba(255,240,200,0.5)";
      ctx.beginPath();
      ctx.arc(j.x - 1.6, j.y - 1.6, 1.6, 0, 7);
      ctx.fill();
    }
  }

  function checkGhost(ai, pt) {
    const A = joints[ai];
    if (pt.joint === ai) return { ok: false };
    const len = dist(A.x, A.y, pt.x, pt.y);
    if (pt.joint >= 0 && hasBeam(ai, pt.joint)) return { ok: false, why: "braced" };
    if (len < MIN_LEN) return { ok: false, why: "too short" };
    if (len > MAX_LEN) return { ok: false, why: "plank too long" };
    const cost = costOf(len);
    if (cost > budgetLeft()) return { ok: false, why: "no timber" };
    return { ok: true, cost };
  }

  function drawGhosts() {
    if (phase !== "build") return;
    if (hoverJoint >= 0) {
      const j = joints[hoverJoint];
      ctx.strokeStyle = "rgba(255,223,138,0.85)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(j.x, j.y, 9, 0, 7);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(245,240,225,0.75)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 8, 0, 7);
    ctx.moveTo(cursor.x - 13, cursor.y);
    ctx.lineTo(cursor.x - 4, cursor.y);
    ctx.moveTo(cursor.x + 4, cursor.y);
    ctx.lineTo(cursor.x + 13, cursor.y);
    ctx.moveTo(cursor.x, cursor.y - 13);
    ctx.lineTo(cursor.x, cursor.y - 4);
    ctx.moveTo(cursor.x, cursor.y + 4);
    ctx.lineTo(cursor.x, cursor.y + 13);
    ctx.stroke();

    let from = -1;
    let pt = null;
    if (dragFrom >= 0) {
      from = dragFrom;
      pt = dragPt;
    } else if (pendingStart >= 0) {
      from = pendingStart;
      pt = snapPoint(cursor.x, cursor.y);
    }
    if (from >= 0 && pt) {
      const ok = checkGhost(from, pt);
      const A = joints[from];
      ctx.setLineDash([7, 6]);
      ctx.strokeStyle = ok.ok
        ? "rgba(146,220,146,0.95)"
        : "rgba(235,110,100,0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ok.ok ? "#9edc9e" : "#eb6e64";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, 7);
      ctx.fill();
      const mx = (A.x + pt.x) / 2;
      const my = (A.y + pt.y) / 2 - 16;
      if (ok.ok) label(ok.cost + " timber", mx, my, "#d7f2cf");
      else if (ok.why) label(ok.why, mx, my, "#ffd9d3");
    }
  }

  function wheel(wx) {
    ctx.save();
    ctx.translate(wx, 0);
    ctx.rotate(bus.wheelRot);
    ctx.fillStyle = "#171a1f";
    ctx.beginPath();
    ctx.arc(0, 0, WHEEL_R, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#b9bec6";
    ctx.beginPath();
    ctx.arc(0, 0, 4.6, 0, 7);
    ctx.fill();
    ctx.strokeStyle = "#4a4f57";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-WHEEL_R + 2, 0);
    ctx.lineTo(WHEEL_R - 2, 0);
    ctx.moveTo(0, -WHEEL_R + 2);
    ctx.lineTo(0, WHEEL_R - 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBus() {
    if (phase !== "test" && phase !== "won" && phase !== "lost") return;
    const bob = bus.state === "run" ? Math.sin(bus.bobT * 6) * 0.7 : 0;
    ctx.save();
    ctx.translate(bus.x, bus.y + bob);
    ctx.rotate(bus.angle);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, WHEEL_R + 4, 36, 5, 0, 0, 7);
    ctx.fill();
    if (bus.state === "run" || bus.state === "done") {
      const hg = ctx.createLinearGradient(34, -12, 130, -12);
      hg.addColorStop(0, "rgba(255,240,190,0.2)");
      hg.addColorStop(1, "rgba(255,240,190,0)");
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.moveTo(34, -16);
      ctx.lineTo(132, -30);
      ctx.lineTo(132, 6);
      ctx.lineTo(34, -4);
      ctx.closePath();
      ctx.fill();
    }
    wheel(-WHEELBASE);
    wheel(WHEELBASE);
    ctx.fillStyle = "#e8a13c";
    ctx.beginPath();
    ctx.roundRect(-36, -30, 72, 26, 5);
    ctx.fill();
    ctx.fillStyle = "#f4e6c4";
    ctx.beginPath();
    ctx.roundRect(-36, -30, 72, 6, [5, 5, 0, 0]);
    ctx.fill();
    ctx.fillStyle = "#4a5a68";
    ctx.fillRect(-36, -12, 72, 4);
    ctx.fillStyle = "#9db6bd";
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.roundRect(-30 + i * 15, -25, 11, 9, 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.roundRect(22, -25, 10, 12, 2);
    ctx.fill();
    ctx.strokeStyle = "#7c5a22";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-36.5, -30.5, 73, 27);
    ctx.fillStyle = "#3c3428";
    ctx.beginPath();
    ctx.arc(-24, -18, 2.4, 0, 7);
    ctx.arc(-9, -18, 2.4, 0, 7);
    ctx.arc(6, -18, 2.4, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#fff3c9";
    ctx.beginPath();
    ctx.arc(35, -8, 2.4, 0, 7);
    ctx.fill();
    ctx.restore();
  }

  function drawPhysBeams() {
    ctx.lineCap = "round";
    for (let k = 0; k < pbeams.length; k++) {
      const bm = pbeams[k];
      if (!bm.live) continue;
      const A = pjoints[bm.a];
      const B = pjoints[bm.b];
      ctx.strokeStyle = "#6e4a24";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
      ctx.strokeStyle = "#b5793a";
      ctx.lineWidth = 6;
      ctx.stroke();
      const s = clamp(stress[k], 0, 1.2);
      if (s > 0.28) {
        const heat = clamp((s - 0.28) / 0.72, 0, 1);
        const r = Math.round(lerp(181, 245, heat));
        const g2 = Math.round(lerp(121, 74, heat));
        const b2 = Math.round(lerp(58, 58, heat));
        ctx.strokeStyle =
          "rgba(" +
          r +
          "," +
          g2 +
          "," +
          b2 +
          "," +
          (0.35 + heat * 0.6).toFixed(2) +
          ")";
        ctx.lineWidth = 7;
        ctx.stroke();
      }
    }
  }

  function drawPhysJoints() {
    for (const j of pjoints) {
      if (j.y > H + 60) continue; // snapped-off debris already out of sight
      ctx.fillStyle = j.pin ? "#cfd6de" : "#33291c";
      ctx.beginPath();
      ctx.arc(j.x, j.y, j.pin ? 5.5 : 5, 0, 7);
      ctx.fill();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = clamp(1 - p.t / p.life, 0, 1);
      if (p.kind === "splinter") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = "rgba(139,94,46," + a.toFixed(2) + ")";
        ctx.fillRect(-p.size / 2, -1.4, p.size, 2.8);
        ctx.restore();
      } else if (p.kind === "spray") {
        ctx.fillStyle = "rgba(205,228,232," + (a * 0.9).toFixed(2) + ")";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, 7);
        ctx.fill();
      } else {
        ctx.fillStyle = "rgba(180,168,140," + (a * 0.5).toFixed(2) + ")";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + p.t), 0, 7);
        ctx.fill();
      }
    }
  }

  function render(t) {
    resizeIfNeeded();
    ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
    if (shake > 0.2)
      ctx.translate(
        (Math.random() - 0.5) * shake,
        (Math.random() - 0.5) * shake
      );
    drawSky(t);
    const lv = level();
    drawRiver(t);
    drawBank(-20, lv.padL.x + 6, lv.padL.y, -1);
    drawBank(lv.padR.x - 6, W + 20, lv.padR.y, 1);
    drawAnchorTerrain();
    drawPad(lv.padL.x, lv.padL.y, -1);
    drawPad(lv.padR.x, lv.padR.y, 1);
    if (phase === "test" || phase === "lost") {
      drawPhysBeams();
      drawPhysJoints();
    } else {
      drawBeams();
      drawJoints();
    }
    drawBus();
    drawParticles();
    drawGhosts();
    const vg = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.42,
      W / 2,
      H / 2,
      H * 0.95
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(8,10,14,0.4)");
    ctx.fillStyle = vg;
    ctx.fillRect(-20, -20, W + 40, H + 40);
  }

  /* ---------- hud / ui ---------- */

  function refreshHud() {
    const lv = level();
    el.level.textContent = "Crossing " + (levelIndex + 1) + " \u00b7 " + lv.name;
    const left = budgetLeft();
    el.timber.innerHTML = "&#9632; " + left + " timber";
    el.timber.classList.toggle("low", left <= Math.ceil(lv.budget * 0.2));
    const total = save.stars.reduce((a, b) => a + (b | 0), 0);
    el.stars.innerHTML = "&#9733; " + total + "/" + LEVELS.length * 3;
  }

  function setStatus(txt, cls) {
    el.state.textContent = txt;
    el.state.className = "chip state" + (cls ? " " + cls : "");
  }

  function refreshToolbar() {
    el.undo.disabled = undoStack.length === 0 || phase !== "build";
    el.clear.disabled = beams.length === 0 || phase !== "build";
    el.restart.disabled = phase === "title";
    el.test.disabled = phase !== "build" && phase !== "test";
    el.test.innerHTML =
      phase === "test" ? "&#9664; Back to plan" : "&#9654; Test span";
    el.pauseBtn.textContent = paused ? "Resume" : "Pause";
    el.sound.setAttribute("aria-pressed", String(!Sfx.muted));
    el.sound.textContent = Sfx.muted ? "Muted" : "Sound";
  }

  function toast(msg, warn, ms) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    el.toast.classList.toggle("warn", !!warn);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), ms || 1900);
  }

  const OVERLAYS = () => [
    el.ovTitle,
    el.ovWin,
    el.ovFail,
    el.ovDone,
    el.ovPause,
  ];

  function show(node) {
    OVERLAYS().forEach((n) => n.setAttribute("hidden", ""));
    node.removeAttribute("hidden");
  }

  function hideOverlays() {
    OVERLAYS().forEach((n) => n.setAttribute("hidden", ""));
  }

  function openTitle() {
    phase = "title";
    const cont = save.lvl > 0 || save.stars.some((s) => (s | 0) > 0);
    const lvl = clamp(save.lvl, 0, LEVELS.length - 1);
    el.start.textContent = cont
      ? "Continue \u2014 crossing " + (lvl + 1)
      : "Take the job";
    el.wipe.classList.toggle("hidden", !cont);
    show(el.ovTitle);
    setStatus("", "");
    refreshHud();
    refreshToolbar();
  }

  /* ---------- input ---------- */

  function toWorld(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }

  let downPt = null;
  let moved = false;

  canvas.addEventListener("pointerdown", (e) => {
    if (phase !== "build") return;
    Sfx.unlock();
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    const p = toWorld(e);
    downPt = p;
    moved = false;
    const ji = jointAt(p.x, p.y, SNAP_R);
    if (ji >= 0) {
      dragFrom = ji;
      dragPt = snapPoint(p.x, p.y);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (phase !== "build") return;
    const p = toWorld(e);
    cursor.x = p.x;
    cursor.y = p.y;
    hoverJoint = jointAt(p.x, p.y, SNAP_R);
    if (dragFrom >= 0) {
      dragPt = snapPoint(p.x, p.y);
      if (downPt && dist(downPt.x, downPt.y, p.x, p.y) > 6) moved = true;
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (phase !== "build") return;
    const p = toWorld(e);
    if (dragFrom >= 0) {
      const pt = snapPoint(p.x, p.y);
      tryPlace(dragFrom, pt, false);
      dragFrom = -1;
      dragPt = null;
    } else if (downPt && !moved) {
      const bi = beamNear(p.x, p.y, 14);
      if (bi >= 0 && bi === selectedBeam) removeBeam(bi, true);
      else if (bi >= 0) {
        selectedBeam = bi;
        selectedT = time;
        Sfx.ui();
      } else selectedBeam = -1;
    }
    downPt = null;
  });

  canvas.addEventListener("pointercancel", () => {
    dragFrom = -1;
    dragPt = null;
    downPt = null;
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const keys = {};

  window.addEventListener("keydown", (e) => {
    if (e.key === "m" || e.key === "M") {
      toggleSound();
      return;
    }
    // resume from the pause card with P
    if (
      (e.key === "p" || e.key === "P") &&
      !el.ovPause.hasAttribute("hidden")
    ) {
      e.preventDefault();
      togglePause();
      return;
    }
    const overlayOpen = OVERLAYS().some((n) => !n.hasAttribute("hidden"));
    if (overlayOpen) {
      if (
        (e.key === "Enter" || e.key === " ") &&
        !el.ovTitle.hasAttribute("hidden")
      ) {
        e.preventDefault();
        el.start.click();
      }
      return;
    }
    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)
    )
      e.preventDefault();

    switch (e.key) {
      case " ":
      case "t":
      case "T":
        if (!keys[e.key]) {
          Sfx.unlock();
          if (phase === "build") startTest();
          else if (phase === "test") backToPlan();
        }
        break;
      case "z":
      case "Z":
        if (phase === "build" && !keys[e.key]) doUndo();
        break;
      case "c":
      case "C":
        if (phase === "build" && !keys[e.key]) doClear();
        break;
      case "r":
      case "R":
        if (!keys[e.key]) {
          Sfx.ui();
          loadLevel(levelIndex);
        }
        break;
      case "p":
      case "P":
        if (!keys[e.key]) togglePause();
        break;
      case "Escape":
        if (phase === "build") {
          if (pendingStart >= 0) pendingStart = -1;
          else selectedBeam = -1;
        }
        break;
      case "Enter":
        keyboardPlace();
        break;
      case "x":
      case "X":
      case "Backspace":
        if (phase === "build" && !keys[e.key]) {
          const bi = beamNear(cursor.x, cursor.y, 18);
          if (bi >= 0) removeBeam(bi, true);
          else Sfx.bad();
        }
        break;
      case "ArrowLeft":
        cursor.x = clamp(cursor.x - GRID * (e.shiftKey ? 3 : 1), GRID, W - GRID);
        break;
      case "ArrowRight":
        cursor.x = clamp(
          cursor.x + GRID * (e.shiftKey ? 3 : 1),
          GRID,
          W - GRID
        );
        break;
      case "ArrowUp":
        cursor.y = clamp(
          cursor.y - GRID * (e.shiftKey ? 3 : 1),
          GRID,
          RIVER_Y - GRID
        );
        break;
      case "ArrowDown":
        cursor.y = clamp(
          cursor.y + GRID * (e.shiftKey ? 3 : 1),
          GRID,
          RIVER_Y - GRID
        );
        break;
    }
    keys[e.key] = true;
  });

  window.addEventListener("keyup", (e) => {
    keys[e.key] = false;
  });

  function keyboardPlace() {
    if (phase !== "build") return;
    if (pendingStart < 0) {
      const ji = jointAt(cursor.x, cursor.y, SNAP_R);
      if (ji >= 0) {
        pendingStart = ji;
        Sfx.ui();
      } else {
        toast("Put the cursor on a joint or anchor first.", true, 1500);
        Sfx.bad();
      }
    } else {
      const pt = snapPoint(cursor.x, cursor.y);
      const ok = tryPlace(pendingStart, pt, false);
      if (ok) pendingStart = pt.joint >= 0 ? pt.joint : -1;
    }
  }

  /* ---------- buttons ---------- */

  el.test.addEventListener("click", () => {
    Sfx.unlock();
    Sfx.ui();
    if (phase === "build") startTest();
    else if (phase === "test") backToPlan();
  });
  el.undo.addEventListener("click", () => {
    if (phase === "build") doUndo();
  });
  el.clear.addEventListener("click", () => {
    if (phase === "build") doClear();
  });
  el.restart.addEventListener("click", () => {
    Sfx.ui();
    loadLevel(levelIndex);
  });
  el.pauseBtn.addEventListener("click", togglePause);
  el.sound.addEventListener("click", toggleSound);
  el.start.addEventListener("click", () => {
    Sfx.unlock();
    Sfx.ui();
    loadLevel(clamp(save.lvl, 0, LEVELS.length - 1));
  });
  el.wipe.addEventListener("click", () => {
    save.lvl = 0;
    save.stars = [];
    writeSave();
    Sfx.knock();
    loadLevel(0);
    toast("Fresh ledger. Crossing 1 it is.", false, 2000);
  });
  el.next.addEventListener("click", () => {
    Sfx.ui();
    loadLevel(levelIndex + 1);
  });
  el.replay.addEventListener("click", () => {
    Sfx.ui();
    loadLevel(levelIndex);
  });
  el.backPlan.addEventListener("click", () => {
    Sfx.ui();
    backToPlan();
  });
  el.retry.addEventListener("click", () => {
    Sfx.ui();
    retryTest();
  });
  el.again.addEventListener("click", () => {
    Sfx.ui();
    loadLevel(0);
  });
  el.resume.addEventListener("click", () => {
    togglePause();
  });

  function togglePause() {
    if (
      phase === "title" ||
      phase === "won" ||
      phase === "lost" ||
      phase === "done"
    )
      return;
    paused = !paused;
    if (paused) show(el.ovPause);
    else {
      el.ovPause.setAttribute("hidden", "");
      lastFrame = performance.now();
    }
    Sfx.ui();
    refreshToolbar();
  }

  function toggleSound() {
    Sfx.unlock();
    Sfx.setMuted(!Sfx.muted);
    try {
      localStorage.setItem("spanwright-mute", Sfx.muted ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
    refreshToolbar();
  }

  try {
    Sfx.muted = localStorage.getItem("spanwright-mute") === "1";
  } catch (e) {
    /* ignore */
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (phase === "build" || phase === "test") && !paused)
      togglePause();
  });

  /* ---------- main loop ---------- */

  let lastFrame = performance.now();
  let acc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (dt > 0.1) dt = 0.1;
    if (!paused) {
      time += dt;
      acc += dt;
      while (acc >= FIXED_DT) {
        acc -= FIXED_DT;
        update(FIXED_DT);
      }
      stepParticles(dt);
      shake = Math.max(0, shake - dt * 26);
      if (selectedBeam >= 0 && time - selectedT > 3.2) selectedBeam = -1;
    }
    render(time);
  }

  function update(dt) {
    if (phase !== "test") return;
    nodeLoad.fill(0);
    busStep(dt); // moves the bus, routes its weight onto joints
    physStep(dt); // cosmetic sag/wobble
    solveForces(); // static truss analysis -> stress colours + breaks
  }

  /* ---------- debug hook (only when #debug is in the URL) ---------- */

  if (/debug/.test(location.hash)) {
    window.__spanwright = {
      phase: () => phase,
      level: () => levelIndex,
      budgetLeft: () => budgetLeft(),
      beamCount: () => beams.filter((b, i) => pbeams[i] === undefined || true)
        .length,
      liveCount: () => pbeams.filter((b) => b.live).length,
      bus: () => ({ x: bus.x, y: bus.y, state: bus.state, speed: bus.speed }),
      strains: () => stress.slice(),
      place: (x1, y1, x2, y2) => {
        const a = jointAt(x1, y1, SNAP_R);
        if (a < 0) return "no joint at start";
        return tryPlace(a, snapPoint(x2, y2), true) ? "ok" : "rejected";
      },
      start: () => startTest(),
      plan: () => backToPlan(),
      load: (i) => loadLevel(i),
    };
  }

  /* ---------- boot ---------- */

  initRain();
  openTitle();
  resizeIfNeeded();
  window.addEventListener("resize", resizeIfNeeded);
  requestAnimationFrame(frame);
})();
