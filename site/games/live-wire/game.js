/**
 * Live Wire - a steady-hand arcade game for the arcade.
 *
 * You are a spark of current riding the copper traces of a failing
 * mainframe. Hold and drag (or use the arrow keys) to carry the spark
 * from the START pad to the FINISH pad without drifting off the trace
 * or clipping a live component. Three fuses, five boards, one steady
 * hand.
 *
 * Vanilla JS, no dependencies. Everything is drawn on a canvas; sound
 * is synthesised with the Web Audio API.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  Tiny helpers
   * ------------------------------------------------------------------ */

  var TAU = Math.PI * 2;
  var W = 960;
  var H = 600;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function dist(ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function angDiff(a, b) {
    var d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function el(id) {
    return document.getElementById(id);
  }

  /* ------------------------------------------------------------------ *
   *  DOM
   * ------------------------------------------------------------------ */

  var canvas = el("game");
  var ctx = canvas.getContext("2d");
  var overlay = el("overlay");
  var panelTitle = el("panel-title");
  var panelBody = el("panel-body");
  var panelList = el("panel-list");
  var panelKeys = el("panel-keys");
  var btnStart = el("btn-start");
  var btnSound = el("btn-sound");
  var btnRestart = el("btn-restart");
  var hudBoard = el("hud-board");
  var hudScore = el("hud-score");
  var hudFuses = el("hud-fuses");
  var hudMult = el("hud-mult");

  /* ------------------------------------------------------------------ *
   *  Audio - all synthesised, created lazily on first gesture
   * ------------------------------------------------------------------ */

  var AC = null;
  var master = null;
  var humOsc = null;
  var humGain = null;
  var noiseBuf = null;
  var muted = false;

  function initAudio() {
    if (AC) {
      if (AC.state === "suspended") AC.resume();
      return;
    }
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    AC = new Ctor();
    master = AC.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(AC.destination);

    // the tracing hum: a low sawtooth whose pitch follows your speed
    humOsc = AC.createOscillator();
    humOsc.type = "sawtooth";
    humOsc.frequency.value = 70;
    var humFilter = AC.createBiquadFilter();
    humFilter.type = "lowpass";
    humFilter.frequency.value = 420;
    humGain = AC.createGain();
    humGain.gain.value = 0;
    humOsc.connect(humFilter);
    humFilter.connect(humGain);
    humGain.connect(master);
    humOsc.start();

    // reusable noise burst for shorts
    var len = Math.floor(AC.sampleRate * 0.3);
    noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    var data = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
  }

  function blip(freq, dur, type, vol, slideTo, when) {
    if (!AC || muted) return;
    var t = (when || AC.currentTime) + 0.0001;
    var o = AC.createOscillator();
    var g = AC.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function sndShort() {
    if (!AC || muted) return;
    var t = AC.currentTime;
    var src = AC.createBufferSource();
    src.buffer = noiseBuf;
    var bp = AC.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 320;
    bp.Q.value = 0.8;
    var g = AC.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t);
    blip(200, 0.32, "square", 0.28, 38, t);
  }

  function sndPickup() {
    if (!AC || muted) return;
    var t = AC.currentTime;
    blip(880, 0.09, "sine", 0.22, null, t);
    blip(1318, 0.12, "sine", 0.2, null, t + 0.07);
  }

  function sndClear() {
    if (!AC || muted) return;
    var t = AC.currentTime;
    var notes = [523, 659, 784, 1046];
    for (var i = 0; i < notes.length; i++) {
      blip(notes[i], 0.16, "triangle", 0.2, null, t + i * 0.09);
    }
  }

  function sndLose() {
    if (!AC || muted) return;
    var t = AC.currentTime;
    var notes = [330, 262, 196, 131];
    for (var i = 0; i < notes.length; i++) {
      blip(notes[i], 0.22, "square", 0.14, null, t + i * 0.16);
    }
  }

  function sndClick() {
    blip(620, 0.05, "square", 0.1);
  }

  function sndStep() {
    blip(1046, 0.06, "sine", 0.08);
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = muted ? 0 : 0.5;
    btnSound.classList.toggle("off", muted);
    btnSound.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
  }

  function updateHum(speed, onTrace, playing) {
    if (!humGain) return;
    var t = AC.currentTime;
    var target = playing && onTrace ? 0.018 + speed * 0.05 : 0.003;
    humGain.gain.setTargetAtTime(target, t, 0.09);
    humOsc.frequency.setTargetAtTime(70 + speed * 170, t, 0.09);
  }

  /* ------------------------------------------------------------------ *
   *  Boards
   *
   *  Each board is a hand-authored spline. Hazards are anchored to the
   *  path itself (a fraction t along it plus a perpendicular offset),
   *  so placements stay sane wherever the spline wanders.
   * ------------------------------------------------------------------ */

  var BOARDS = [
    {
      name: "Signal Bus",
      corridor: 26,
      par: 26,
      pts: [
        [60, 110],
        [210, 82],
        [350, 152],
        [500, 102],
        [640, 168],
        [706, 292],
        [618, 392],
        [470, 372],
        [376, 272],
        [268, 312],
        [218, 432],
        [330, 512],
        [500, 534],
        [680, 500],
        [852, 528],
      ],
      rotors: [{ t: 0.3, side: -1 }],
      flares: [{ t: 0.56 }, { t: 0.8, phase: 0.5 }],
      bugs: [],
      charges: [
        { t: 0.14, side: -1 },
        { t: 0.43, side: 1 },
        { t: 0.68, side: -1 },
      ],
    },
    {
      name: "River Run",
      corridor: 23,
      par: 34,
      pts: [
        [80, 90],
        [300, 70],
        [560, 120],
        [800, 90],
        [880, 200],
        [760, 290],
        [520, 270],
        [280, 310],
        [150, 400],
        [300, 490],
        [560, 470],
        [760, 420],
        [880, 520],
      ],
      rotors: [
        { t: 0.18, side: 1, spd: 1.4 },
        { t: 0.62, side: -1, spd: -1.7, arms: 4 },
      ],
      flares: [{ t: 0.36 }, { t: 0.52, phase: 0.33 }, { t: 0.86, phase: 0.66 }],
      bugs: [{ lo: 0.66, hi: 0.78, spd: 46 }],
      charges: [
        { t: 0.1, side: -1 },
        { t: 0.3, side: 1 },
        { t: 0.58, side: -1 },
        { t: 0.76, side: 1 },
      ],
    },
    {
      name: "Core Spiral",
      corridor: 21,
      par: 42,
      pts: [
        [130, 300],
        [200, 160],
        [360, 100],
        [540, 120],
        [680, 210],
        [700, 340],
        [600, 440],
        [440, 450],
        [330, 370],
        [340, 260],
        [440, 200],
        [560, 230],
        [590, 320],
        [520, 380],
        [445, 350],
        [450, 290],
      ],
      rotors: [
        { t: 0.14, side: -1, spd: 1.8, rOut: 84 },
        { t: 0.52, side: 1, spd: -1.5 },
      ],
      flares: [{ t: 0.24 }, { t: 0.44, phase: 0.5 }, { t: 0.78, phase: 0.25 }],
      bugs: [
        { lo: 0.3, hi: 0.42, spd: 52 },
        { lo: 0.62, hi: 0.74, spd: -58 },
      ],
      charges: [
        { t: 0.08, side: 1 },
        { t: 0.34, side: -1 },
        { t: 0.58, side: 1 },
        { t: 0.84, side: -1 },
      ],
    },
    {
      name: "Storm Track",
      corridor: 19,
      par: 48,
      pts: [
        [110, 520],
        [260, 460],
        [220, 360],
        [380, 320],
        [420, 220],
        [300, 160],
        [430, 90],
        [600, 110],
        [640, 210],
        [790, 240],
        [820, 350],
        [680, 400],
        [700, 500],
        [850, 530],
      ],
      rotors: [
        { t: 0.2, side: -1, spd: 2, arms: 2 },
        { t: 0.55, side: 1, spd: -2.2 },
        { t: 0.86, side: -1, spd: 1.6, arms: 4 },
      ],
      flares: [
        { t: 0.12, phase: 0.2 },
        { t: 0.38 },
        { t: 0.64, phase: 0.6 },
        { t: 0.94, phase: 0.4 },
      ],
      bugs: [
        { lo: 0.28, hi: 0.4, spd: 62 },
        { lo: 0.7, hi: 0.82, spd: -66 },
      ],
      charges: [
        { t: 0.06, side: 1 },
        { t: 0.24, side: -1 },
        { t: 0.46, side: 1 },
        { t: 0.68, side: -1 },
        { t: 0.9, side: 1 },
      ],
    },
    {
      name: "Motherboard Gauntlet",
      corridor: 17,
      par: 60,
      pts: [
        [70, 80],
        [260, 95],
        [450, 70],
        [650, 110],
        [830, 90],
        [890, 220],
        [820, 330],
        [860, 470],
        [720, 540],
        [540, 500],
        [380, 550],
        [200, 510],
        [100, 400],
        [170, 290],
        [300, 230],
        [430, 280],
        [520, 380],
        [650, 450],
        [800, 430],
      ],

      rotors: [
        { t: 0.16, side: 1, spd: 2.2, arms: 2 },
        { t: 0.44, side: -1, spd: -1.9 },
        { t: 0.74, side: 1, spd: 2.4, rOut: 80 },
      ],
      flares: [
        { t: 0.1 },
        { t: 0.3, phase: 0.4 },
        { t: 0.56, phase: 0.15 },
        { t: 0.9, phase: 0.55 },
      ],
      bugs: [
        { lo: 0.2, hi: 0.32, spd: 64 },
        { lo: 0.5, hi: 0.62, spd: -70 },
        { lo: 0.8, hi: 0.92, spd: 60 },
      ],
      charges: [
        { t: 0.07, side: -1 },
        { t: 0.22, side: 1 },
        { t: 0.4, side: -1 },
        { t: 0.6, side: 1 },
        { t: 0.78, side: -1 },
        { t: 0.95, side: 1 },
      ],
    },
  ];

  /* ------------------------------------------------------------------ *
   *  Path construction
   * ------------------------------------------------------------------ */

  function crPoint(p0, p1, p2, p3, t) {
    var t2 = t * t;
    var t3 = t2 * t;
    return {
      x:
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      y:
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    };
  }

  function buildBoard(def, index) {
    var seg = 22;
    var pts = def.pts;
    var ext = [pts[0]].concat(pts, [pts[pts.length - 1]]);
    var samples = [];
    for (var i = 0; i < ext.length - 3; i++) {
      for (var j = 0; j < seg; j++) {
        samples.push(
          crPoint(ext[i], ext[i + 1], ext[i + 2], ext[i + 3], j / seg),
        );
      }
    }
    samples.push({ x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] });

    var n = samples.length;

    // perpendicular normals for anchoring hazards beside the trace
    var normals = [];
    for (var k = 0; k < n; k++) {
      var a = samples[Math.max(0, k - 1)];
      var b = samples[Math.min(n - 1, k + 1)];
      var tx = b.x - a.x;
      var ty = b.y - a.y;
      var tl = Math.sqrt(tx * tx + ty * ty) || 1;
      normals.push({ x: -ty / tl, y: tx / tl });
    }

    function anchor(t, side, off) {
      var i2 = clamp(Math.round(t * (n - 1)), 0, n - 1);
      var s = samples[i2];
      var nm = normals[i2];
      var o = off === undefined ? 0 : off;
      return { x: s.x + nm.x * side * o, y: s.y + nm.y * side * o };
    }

    var rng = mulberry32(index * 99991 + 7);

    var rotors = def.rotors.map(function (r) {
      var rIn = r.rIn || 26;
      var rOut = r.rOut || 95;
      var arms = r.arms || 3;
      return {
        c: anchor(r.t, r.side || 1, (rIn + rOut) / 2),
        rIn: rIn,
        rOut: rOut,
        arms: arms,
        spd: (r.spd || 1.3) * (Math.PI / 2),
        phase: rng() * TAU,
        halfW: 0.16,
      };
    });

    var flares = def.flares.map(function (f) {
      return {
        p: anchor(f.t, f.side || 1, 0),
        r: 15,
        blast: 44,
        rate: 2.4,
        duty: 0.24,
        phase: f.phase || 0,
        lastCycle: -1,
      };
    });

    var bugs = def.bugs.map(function (bg) {
      return {
        lo: Math.round(bg.lo * (n - 1)),
        hi: Math.round(bg.hi * (n - 1)),
        pos: Math.round(((bg.lo + bg.hi) / 2) * (n - 1)),
        dir: bg.spd > 0 ? 1 : -1,
        spd: Math.abs(bg.spd),
        r: 12,
      };
    });

    var charges = def.charges.map(function (c, ci) {
      return {
        p: anchor(c.t, c.side, BOARDS[index].corridor + 20),
        taken: false,
        seed: ci * 1.7 + index,
      };
    });

    var checkpoints = [];
    [0, 0.18, 0.36, 0.54, 0.72, 0.88].forEach(function (f) {
      checkpoints.push(Math.floor(f * (n - 1)));
    });

    return {
      def: def,
      index: index,
      samples: samples,
      normals: normals,
      n: n,
      rotors: rotors,
      flares: flares,
      bugs: bugs,
      charges: charges,
      checkpoints: checkpoints,
      corridor: def.corridor,
    };
  }

  /* ------------------------------------------------------------------ *
   *  Game state
   * ------------------------------------------------------------------ */

  var GRACE = 0.38; // seconds you may hover off the trace before shorting
  var KEY_SPEED = 300;

  var G = {
    state: "menu", // menu | playing | paused | boardclear | gameover | victory
    boardIx: 0,
    board: null,
    bg: null,

    px: 0,
    py: 0,
    tx: 0,
    ty: 0,
    best: 0,
    credited: 0,
    ck: 0,
    mult: 1,
    nextMultAt: 0,
    fuses: 3,
    score: 0,
    elapsed: 0,
    anim: 0,

    graceT: 0,
    invuln: 0,
    needRegrab: false,
    shake: 0,
    flashRed: 0,
    flashWhite: 0,

    trail: [],
    rings: [],
    parts: [],

    dragging: false,
    pointerId: -1,
    keys: {},
  };

  function nearestSample(x, y) {
    var s = G.board.samples;
    var bi = 0;
    var bd = Infinity;
    for (var i = 0; i < s.length; i++) {
      var dx = s[i].x - x;
      var dy = s[i].y - y;
      var d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return { i: bi, d: Math.sqrt(bd) };
  }

  function samplePos(i) {
    var s = G.board.samples[clamp(Math.round(i), 0, G.board.n - 1)];
    return { x: s.x, y: s.y };
  }

  /* ---------------------------- run control ------------------------ */

  function startRun() {
    initAudio();
    G.score = 0;
    G.fuses = 3;
    G.boardIx = 0;
    loadBoard(0);
    G.state = "playing";
    hideOverlay();
    syncHud(true);
  }

  function loadBoard(ix) {
    G.boardIx = ix;
    G.board = buildBoard(BOARDS[ix], ix);
    buildBackground(G.board);
    var p0 = samplePos(0);
    G.px = p0.x;
    G.py = p0.y;
    G.tx = p0.x;
    G.ty = p0.y;
    G.best = 0;
    G.credited = 0;
    G.ck = 0;
    G.mult = 1;
    G.nextMultAt = G.board.n * 0.12;
    G.elapsed = 0;
    G.graceT = 0;
    G.invuln = 1.2;
    G.needRegrab = false;
    G.shake = 0;
    G.flashRed = 0;
    G.flashWhite = 0;
    G.trail.length = 0;
    G.rings.length = 0;
    G.parts.length = 0;
    G.dragging = false;
    G.pointerId = -1;
  }

  function advance(i) {
    if (i <= G.best) return;
    G.best = i;
    if (G.credited < G.best) {
      G.score += (G.best - G.credited) * G.mult;
      G.credited = G.best;
    }
    var cks = G.board.checkpoints;
    for (var k = 0; k < cks.length; k++) {
      if (cks[k] <= G.best) G.ck = Math.max(G.ck, cks[k]);
    }
    if (G.mult < 8 && G.best >= G.nextMultAt) {
      G.mult++;
      G.nextMultAt = G.best + G.board.n * 0.12;
      sndStep();
    }
    hudDirty = true;
  }

  function doShort() {
    sndShort();
    G.fuses--;
    G.mult = 1;
    G.nextMultAt = G.board.n * 0.12;
    G.shake = 0.42;
    G.flashRed = 0.65;
    burst(G.px, G.py, 26, "#ff6a4a", "#ffd98a");
    G.rings.push({ x: G.px, y: G.py, t: 0, col: "255,93,93" });
    hudDirty = true;
    if (G.fuses <= 0) {
      G.state = "gameover";
      updateHum(0, false, false);
      sndLose();
      showPanel(
        "SHORTED OUT",
        "The last fuse blows and the rack goes dark.<br><br>" +
          "You reached <b>Board " +
          (G.boardIx + 1) +
          " \u00b7 " +
          BOARDS[G.boardIx].name +
          "</b> with a final score of <b>" +
          G.score +
          "</b>.",
        null,
        "Try again \u25b8",
        "lose",
      );
      return true;
    }
    var p = samplePos(G.ck);
    G.px = p.x;
    G.py = p.y;
    G.tx = p.x;
    G.ty = p.y;
    G.graceT = 0;
    G.invuln = 1.4;
    G.needRegrab = G.dragging;
    G.best = Math.min(G.best, G.ck);
    return true;
  }

  function finishBoard() {
    var par = BOARDS[G.boardIx].par;
    var bonus = 300 + Math.max(0, Math.round((par - G.elapsed) * 8));
    G.score += bonus;
    var restored = G.fuses < 3;
    if (restored) G.fuses++;
    hudDirty = true;
    updateHum(0, false, false);
    var last = G.boardIx >= BOARDS.length - 1;
    if (last) {
      G.state = "victory";
      sndClear();
      var rank =
        G.score >= 22000
          ? "MASTER OF CURRENT"
          : G.score >= 15000
            ? "TRACEWRIGHT"
            : G.score >= 8000
              ? "JOURNEYMAN LINEMAN"
              : "APPRENTICE LINEMAN";
      showPanel(
        "MAINFRAME RESTORED",
        "Every board traced, every fuse spent wisely.<br><br>" +
          "Final score <b>" +
          G.score +
          "</b> with " +
          G.fuses +
          " fuse" +
          (G.fuses === 1 ? "" : "s") +
          " to spare.<br>Rank: <b>" +
          rank +
          "</b>",
        null,
        "Run it again \u25b8",
        "win",
      );
    } else {
      G.state = "boardclear";
      sndClear();
      showPanel(
        "BOARD CLEAR",
        BOARDS[G.boardIx].name +
          " traced in " +
          G.elapsed.toFixed(1) +
          "s.<br>Board bonus <b>+" +
          bonus +
          "</b>" +
          (restored ? " \u00b7 fuse restored \u25cf" : "") +
          "<br>Total <b>" +
          G.score +
          "</b>",
        null,
        "Next board \u25b8",
        "",
      );
    }
  }

  /* ------------------------------ input ---------------------------- */

  function canvasPos(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * W) / r.width,
      y: ((e.clientY - r.top) * H) / r.height,
    };
  }

  canvas.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    if (G.state !== "playing") return;
    G.dragging = true;
    G.pointerId = e.pointerId;
    G.needRegrab = false;
    var p = canvasPos(e);
    G.tx = p.x;
    G.ty = p.y;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!G.dragging || e.pointerId !== G.pointerId) return;
    var p = canvasPos(e);
    G.tx = p.x;
    G.ty = p.y;
  });

  function releasePointer(e) {
    if (e.pointerId !== G.pointerId) return;
    G.dragging = false;
    G.pointerId = -1;
  }
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  window.addEventListener("keydown", function (e) {
    var k = e.key;
    var lk = k === " " ? "space" : k.length === 1 ? k.toLowerCase() : k;
    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].indexOf(k) >= 0
    ) {
      e.preventDefault();
    }
    if (lk === "m") {
      setMuted(!muted);
      return;
    }
    if (lk === "r") {
      sndClick();
      startRun();
      return;
    }
    if (lk === "p" || k === "Escape") {
      togglePause();
      return;
    }
    if (k === "Enter" || lk === "space") {
      if (G.state !== "playing") {
        primaryAction();
        return;
      }
    }
    G.keys[lk] = true;
  });

  window.addEventListener("keyup", function (e) {
    var k = e.key;
    G.keys[k === " " ? "space" : k.length === 1 ? k.toLowerCase() : k] = false;
  });

  function keyAxis() {
    var L = G.keys["a"] || G.keys["arrowleft"] ? -1 : 0;
    var R = G.keys["d"] || G.keys["arrowright"] ? 1 : 0;
    var U = G.keys["w"] || G.keys["arrowup"] ? -1 : 0;
    var D = G.keys["s"] || G.keys["arrowdown"] ? 1 : 0;
    return { x: L + R, y: U + D };
  }

  function togglePause() {
    if (G.state === "playing") {
      G.state = "paused";
      updateHum(0, false, false);
      showPanel(
        "PAUSED",
        "The current holds steady.<br>Press <b>P</b> or the button to resume.",
        null,
        "Resume \u25b8",
        "",
      );
    } else if (G.state === "paused") {
      G.state = "playing";
      hideOverlay();
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && G.state === "playing") togglePause();
    if (!document.hidden && AC && AC.state === "suspended") AC.resume();
  });

  /* --------------------------- simulation -------------------------- */

  function hitHazard(x, y) {
    var b = G.board;
    var i;
    for (i = 0; i < b.rotors.length; i++) {
      var ro = b.rotors[i];
      var rr = dist(x, y, ro.c.x, ro.c.y);
      if (rr > ro.rIn - 6 && rr < ro.rOut + 6) {
        var ang = Math.atan2(y - ro.c.y, x - ro.c.x);
        for (var a = 0; a < ro.arms; a++) {
          var aa = ro.phase + G.anim * ro.spd + (a * TAU) / ro.arms;
          if (Math.abs(angDiff(ang, aa)) < ro.halfW) return true;
        }
      }
    }
    for (i = 0; i < b.flares.length; i++) {
      var fl = b.flares[i];
      if (flareDanger(fl) && dist(x, y, fl.p.x, fl.p.y) < fl.blast) {
        return true;
      }
    }
    for (i = 0; i < b.bugs.length; i++) {
      var bg = b.bugs[i];
      var sp = samplePos(bg.pos);
      if (dist(x, y, sp.x, sp.y) < bg.r + 7) return true;
    }
    return false;
  }

  function flarePhase(fl) {
    return (G.anim / fl.rate + fl.phase) % 1;
  }

  function flareDanger(fl) {
    return flarePhase(fl) < fl.duty;
  }

  function burst(x, y, count, colA, colB) {
    for (var i = 0; i < count; i++) {
      var a = Math.random() * TAU;
      var sp = 60 + Math.random() * 220;
      G.parts.push({
        x: x,
        y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.5,
        max: 0.9,
        col: Math.random() < 0.5 ? colA : colB,
      });
    }
  }

  function moveAndCollide(dt) {
    var desired = { x: G.px, y: G.py };

    if (G.dragging && !G.needRegrab) {
      desired.x = G.tx;
      desired.y = G.ty;
    } else {
      var ax = keyAxis();
      if (ax.x !== 0 || ax.y !== 0) {
        var l = Math.sqrt(ax.x * ax.x + ax.y * ax.y);
        desired.x += (ax.x / l) * KEY_SPEED * dt;
        desired.y += (ax.y / l) * KEY_SPEED * dt;
        G.tx = desired.x;
        G.ty = desired.y;
      }
    }

    // smooth chase towards the pointer, then walk the move in small
    // steps so a fast swipe cannot tunnel through a rotor blade
    var k = 1 - Math.exp(-dt * 26);
    var nx = G.px + (desired.x - G.px) * k;
    var ny = G.py + (desired.y - G.py) * k;
    var md = dist(G.px, G.py, nx, ny);

    if (md < 0.01) {
      // standing still: only hazards can hurt
      if (G.invuln <= 0 && hitHazard(G.px, G.py)) doShort();
      return;
    }

    var steps = Math.max(1, Math.ceil(md / 7));
    var dtMicro = dt / steps;
    var ox = G.px;
    var oy = G.py;

    for (var st = 1; st <= steps; st++) {
      G.px = ox + ((nx - ox) * st) / steps;
      G.py = oy + ((ny - oy) * st) / steps;

      var q = nearestSample(G.px, G.py);
      if (q.d <= G.board.corridor) {
        if (q.i > G.best) advance(q.i);
        G.graceT = 0;
      } else {
        G.graceT += dtMicro;
        if (G.graceT > GRACE && G.invuln <= 0) {
          doShort();
          return;
        }
      }
      if (G.invuln <= 0 && hitHazard(G.px, G.py)) {
        doShort();
        return;
      }
    }

    if (G.best >= G.board.n - 6) finishBoard();
  }

  function step(dt) {
    G.anim += dt;

    if (G.invuln > 0) G.invuln -= dt;
    if (G.shake > 0) G.shake -= dt;
    if (G.flashRed > 0) G.flashRed -= dt * 1.6;

    moveAndCollide(dt);

    // solder bugs crawl their stretch of trace
    var b = G.board;
    for (var i = 0; i < b.bugs.length; i++) {
      var bg = b.bugs[i];
      bg.pos += bg.dir * bg.spd * dt * 0.12;
      if (bg.pos >= bg.hi) {
        bg.pos = bg.hi;
        bg.dir = -1;
      }
      if (bg.pos <= bg.lo) {
        bg.pos = bg.lo;
        bg.dir = 1;
      }
    }

    // pickups
    for (var c = 0; c < b.charges.length; c++) {
      var ch = b.charges[c];
      if (!ch.taken && dist(G.px, G.py, ch.p.x, ch.p.y) < 22) {
        ch.taken = true;
        G.score += 300;
        hudDirty = true;
        G.rings.push({ x: ch.p.x, y: ch.p.y, t: 0, col: "89,214,255" });
        burst(ch.p.x, ch.p.y, 10, "#59d6ff", "#ffd98a");
        sndPickup();
      }
    }

    // trail
    var sp = dist(G.px, G.py, G.tx, G.ty);
    if (sp > 2 && G.trail.length < 90) {
      G.trail.push({
        x: G.px,
        y: G.py,
        life: 0.5,
        max: 0.5,
        size: 3 + Math.min(6, sp / 40),
      });
    }
    for (var t = G.trail.length - 1; t >= 0; t--) {
      G.trail[t].life -= dt;
      if (G.trail[t].life <= 0) G.trail.splice(t, 1);
    }
    for (var p2 = G.parts.length - 1; p2 >= 0; p2--) {
      var pt = G.parts[p2];
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.92;
      pt.vy *= 0.92;
      if (pt.life <= 0) G.parts.splice(p2, 1);
    }
    for (var r = G.rings.length - 1; r >= 0; r--) {
      G.rings[r].t += dt;
      if (G.rings[r].t > 0.6) G.rings.splice(r, 1);
    }

    updateHum(clamp(sp / 300, 0, 1), G.graceT <= 0, true);

    // flare cycle bookkeeping (for the pop ring when a flare fires)
    for (var f = 0; f < b.flares.length; f++) {
      var fl = b.flares[f];
      var cyc = Math.floor(G.anim / fl.rate + fl.phase);
      if (flareDanger(fl) && cyc !== fl.lastCycle) {
        fl.lastCycle = cyc;
        G.rings.push({
          x: fl.p.x,
          y: fl.p.y,
          t: 0,
          col: "255,120,80",
          rMax: fl.blast + 14,
        });
      }
    }

    if (G.flashWhite > 0) G.flashWhite -= dt * 2;
  }

  /* ---------------------------- rendering -------------------------- */

  function buildBackground(board) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var bg = document.createElement("canvas");
    bg.width = W * dpr;
    bg.height = H * dpr;
    var g = bg.getContext("2d");
    g.scale(dpr, dpr);

    g.fillStyle = "#060a11";
    g.fillRect(0, 0, W, H);

    // faint dot grid
    g.fillStyle = "rgba(89,214,255,0.045)";
    for (var gx = 24; gx < W; gx += 32) {
      for (var gy = 24; gy < H; gy += 32) {
        g.fillRect(gx, gy, 1.5, 1.5);
      }
    }

    // decorative dead traces, seeded so a board always looks the same
    var rng = mulberry32(board.index * 40503 + 11);
    g.strokeStyle = "rgba(89,214,255,0.06)";
    g.lineWidth = 2;
    g.lineCap = "round";
    for (var wl = 0; wl < 42; wl++) {
      var x = rng() * W;
      var y = rng() * H;
      g.beginPath();
      g.moveTo(x, y);
      var segs = 2 + Math.floor(rng() * 4);
      for (var sgi = 0; sgi < segs; sgi++) {
        var horiz = rng() < 0.5;
        var len = 30 + rng() * 120;
        if (horiz) x += (rng() < 0.5 ? -1 : 1) * len;
        else y += (rng() < 0.5 ? -1 : 1) * len;
        g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = "rgba(89,214,255,0.09)";
      g.beginPath();
      g.arc(x, y, 3, 0, TAU);
      g.fill();
    }

    // the dormant trace
    var s = board.samples;
    g.lineJoin = "round";
    g.lineCap = "round";
    g.strokeStyle = "rgba(122,84,38,0.55)";
    g.lineWidth = Math.max(8, board.corridor * 0.55);
    tracePath(g, s, 0, s.length - 1);
    g.stroke();
    g.strokeStyle = "rgba(20,16,8,0.9)";
    g.lineWidth = Math.max(3, board.corridor * 0.18);
    tracePath(g, s, 0, s.length - 1);
    g.stroke();

    // pads
    drawPad(g, s[0], "#59d6ff", "START");
    drawPad(g, s[s.length - 1], "#ffd98a", "FINISH");

    // vignette
    var vg = g.createRadialGradient(
      W / 2,
      H / 2,
      H / 3,
      W / 2,
      H / 2,
      H / 1.05,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);

    g.fillStyle = "rgba(216,228,240,0.07)";
    g.font = "bold 26px 'Courier New', monospace";
    g.textAlign = "right";
    g.fillText(board.def.name.toUpperCase(), W - 18, H - 16);
    g.textAlign = "left";

    G.bg = bg;
    G.bgDpr = dpr;
  }

  function tracePath(g, s, from, to) {
    g.beginPath();
    g.moveTo(s[from].x, s[from].y);
    for (var i = from + 1; i <= to; i++) g.lineTo(s[i].x, s[i].y);
  }

  function drawPad(g, p, col, label) {
    g.save();
    g.strokeStyle = col;
    g.globalAlpha = 0.9;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(p.x, p.y, 16, 0, TAU);
    g.stroke();
    g.globalAlpha = 0.35;
    g.beginPath();
    g.arc(p.x, p.y, 24, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = col;
    g.font = "bold 11px 'Courier New', monospace";
    g.textAlign = "center";
    g.fillText(label, p.x, p.y - 30);
    g.restore();
  }

  function drawRotor(g, ro) {
    var cx = ro.c.x;
    var cy = ro.c.y;
    g.save();
    // swept ring guide
    g.strokeStyle = "rgba(159,182,204,0.14)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, (ro.rIn + ro.rOut) / 2, 0, TAU);
    g.stroke();

    // arms
    for (var a = 0; a < ro.arms; a++) {
      var ang = ro.phase + G.anim * ro.spd + (a * TAU) / ro.arms;
      var ca = Math.cos(ang);
      var sa = Math.sin(ang);
      var grad = g.createLinearGradient(
        cx + ca * ro.rIn,
        cy + sa * ro.rIn,
        cx + ca * ro.rOut,
        cy + sa * ro.rOut,
      );
      grad.addColorStop(0, "rgba(159,182,204,0.9)");
      grad.addColorStop(1, "rgba(255,93,93,0.95)");
      g.strokeStyle = grad;
      g.lineWidth = 9;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(cx + ca * ro.rIn, cy + sa * ro.rIn);
      g.lineTo(cx + ca * ro.rOut, cy + sa * ro.rOut);
      g.stroke();
    }

    // hub
    g.fillStyle = "#101a28";
    g.strokeStyle = "#9fb6cc";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, ro.rIn - 6, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = "#ff5d5d";
    g.beginPath();
    g.arc(cx, cy, 4, 0, TAU);
    g.fill();
    g.restore();
  }

  function drawFlare(g, fl) {
    var ph = flarePhase(fl);
    var danger = flareDanger(fl);
    var warm = clamp(ph / fl.duty, 0, 1);
    g.save();
    // housing
    g.fillStyle = "#101a28";
    g.strokeStyle = danger ? "#ffb46a" : "#77879b";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(fl.p.x, fl.p.y, fl.r + 4, 0, TAU);
    g.fill();
    g.stroke();
    // charge arc: fills as the flare arms itself
    g.strokeStyle = danger ? "#ff5d5d" : "rgba(89,214,255,0.85)";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(fl.p.x, fl.p.y, fl.r - 2, -Math.PI / 2, -Math.PI / 2 + TAU * ph);
    g.stroke();
    // core
    var core = g.createRadialGradient(fl.p.x, fl.p.y, 1, fl.p.x, fl.p.y, fl.r);
    core.addColorStop(
      0,
      danger ? "#ffffff" : "rgba(255,217,138," + (0.25 + warm * 0.4) + ")",
    );
    core.addColorStop(1, "rgba(255,93,93,0)");
    g.fillStyle = core;
    g.beginPath();
    g.arc(fl.p.x, fl.p.y, fl.r, 0, TAU);
    g.fill();
    if (danger) {
      g.globalAlpha = 0.5;
      g.strokeStyle = "#ff7850";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(fl.p.x, fl.p.y, fl.blast, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
    }
    g.restore();
  }

  function drawBug(g, bg) {
    var sp = samplePos(bg.pos);
    var wob = Math.sin(G.anim * 18 + bg.lo) * 2;
    g.save();
    g.translate(sp.x, sp.y);
    g.rotate(wob / 6);
    g.strokeStyle = "rgba(255,93,200,0.8)";
    g.lineWidth = 2;
    for (var l = 0; l < 4; l++) {
      var lx = -8 + l * 5;
      var ly = Math.sin(G.anim * 22 + l * 2) * 4;
      g.beginPath();
      g.moveTo(lx, -6);
      g.lineTo(lx, ly - 10);
      g.moveTo(lx, 6);
      g.lineTo(lx, -ly + 10);
      g.stroke();
    }
    var grad = g.createRadialGradient(0, -2, 1, 0, 0, bg.r);
    grad.addColorStop(0, "#ffd6f4");
    grad.addColorStop(0.5, "#ff5dc8");
    grad.addColorStop(1, "rgba(255,93,200,0.1)");
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(0, 0, bg.r, bg.r * 0.75, 0, 0, TAU);
    g.fill();
    g.fillStyle = "#2b0a20";
    g.beginPath();
    g.arc(4, -2, 2.4, 0, TAU);
    g.arc(4, 3, 2.4, 0, TAU);
    g.fill();
    g.restore();
  }

  function drawCharge(g, ch) {
    var bob = Math.sin(G.anim * 3 + ch.seed) * 4;
    var x = ch.p.x;
    var y = ch.p.y + bob;
    g.save();
    g.translate(x, y);
    g.rotate(G.anim * 0.8 + ch.seed);
    var glow = g.createRadialGradient(0, 0, 1, 0, 0, 20);
    glow.addColorStop(0, "rgba(255,217,138,0.5)");
    glow.addColorStop(1, "rgba(255,217,138,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, 0, 20, 0, TAU);
    g.fill();
    g.fillStyle = "#ffd98a";
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(6, -2);
    g.lineTo(2, -2);
    g.lineTo(7, 8);
    g.lineTo(-4, 2);
    g.lineTo(0, 2);
    g.lineTo(-5, -4);
    g.closePath();
    g.fill();
    g.restore();
  }

  function render(dt) {
    if (!G.board) return;
    ctx.save();

    ctx.clearRect(0, 0, W, H);

    if (G.shake > 0) {
      var m = G.shake * 14;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }

    if (G.bg) ctx.drawImage(G.bg, 0, 0, W, H);

    var b = G.board;
    var s = b.samples;

    // energised portion of the trace
    var upto = Math.max(1, G.best);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(232,162,75,0.16)";
    ctx.lineWidth = 16;
    tracePath(ctx, s, 0, upto);
    ctx.stroke();
    ctx.strokeStyle = "rgba(232,162,75,0.5)";
    ctx.lineWidth = 8;
    tracePath(ctx, s, 0, upto);
    ctx.stroke();
    ctx.strokeStyle = "#ffd98a";
    ctx.lineWidth = 3;
    tracePath(ctx, s, 0, upto);
    ctx.stroke();

    // finish pad pulse
    var fp = s[s.length - 1];
    var pulse = 24 + Math.sin(G.anim * 5) * 5;
    ctx.strokeStyle = "rgba(255,217,138,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(fp.x, fp.y, pulse, 0, TAU);
    ctx.stroke();

    // hazards & things
    var i;
    for (i = 0; i < b.charges.length; i++) {
      if (!b.charges[i].taken) drawCharge(ctx, b.charges[i]);
    }
    for (i = 0; i < b.rotors.length; i++) drawRotor(ctx, b.rotors[i]);
    for (i = 0; i < b.flares.length; i++) drawFlare(ctx, b.flares[i]);
    for (i = 0; i < b.bugs.length; i++) drawBug(ctx, b.bugs[i]);

    // rings
    for (i = 0; i < G.rings.length; i++) {
      var rg = G.rings[i];
      var rt = rg.t / 0.6;
      ctx.strokeStyle = "rgba(" + rg.col + "," + (1 - rt) * 0.8 + ")";
      ctx.lineWidth = 3 * (1 - rt) + 1;
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, 6 + rt * (rg.rMax || 46), 0, TAU);
      ctx.stroke();
    }

    // particles
    ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < G.parts.length; i++) {
      var pa = G.parts[i];
      ctx.globalAlpha = clamp(pa.life / pa.max, 0, 1);
      ctx.fillStyle = pa.col;
      ctx.beginPath();
      ctx.arc(pa.x, pa.y, 2.4, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // trail
    for (i = 0; i < G.trail.length; i++) {
      var tr = G.trail[i];
      var ta = tr.life / tr.max;
      ctx.fillStyle = "rgba(255,217,138," + ta * 0.35 + ")";
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, tr.size * ta, 0, TAU);
      ctx.fill();
    }

    // the spark
    var blink = G.invuln > 0 && Math.floor(G.anim * 12) % 2 === 0;
    if (!blink) {
      var sg = ctx.createRadialGradient(G.px, G.py, 1, G.px, G.py, 18);
      sg.addColorStop(0, "#ffffff");
      sg.addColorStop(0.35, "#ffe9b8");
      sg.addColorStop(1, "rgba(255,169,64,0)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(G.px, G.py, 18, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#fffdf5";
      ctx.beginPath();
      ctx.arc(G.px, G.py, 4.5, 0, TAU);
      ctx.fill();
    }
    if (G.graceT > 0) {
      var gp = clamp(G.graceT / GRACE, 0, 1);
      ctx.strokeStyle = "rgba(255,93,93," + 0.4 + gp * 0.6 + ")";
      ctx.lineWidth = 2 + gp * 2;
      ctx.beginPath();
      ctx.arc(G.px, G.py, 12 + gp * 12, 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";

    // damage / success flashes
    if (G.flashRed > 0) {
      ctx.fillStyle = "rgba(255,60,40," + clamp(G.flashRed, 0, 1) * 0.28 + ")";
      ctx.fillRect(0, 0, W, H);
    }
    if (G.flashWhite > 0) {
      ctx.fillStyle =
        "rgba(200,240,255," + clamp(G.flashWhite, 0, 1) * 0.3 + ")";
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();

    if (hudDirty) syncHud(false);
  }

  /* -------------------------------- HUD ---------------------------- */

  var hudDirty = true;

  function syncHud(force) {
    if (!force && !hudDirty) return;
    hudDirty = false;
    hudBoard.textContent =
      "Board " +
      (G.boardIx + 1) +
      " \u00b7 " +
      (BOARDS[G.boardIx] ? BOARDS[G.boardIx].name : "");
    hudScore.textContent = String(G.score);
    hudFuses.textContent =
      "\u25cf".repeat(Math.max(0, G.fuses)) +
      "\u25cb".repeat(Math.max(0, 3 - G.fuses));
    hudMult.textContent = "\u00d7" + G.mult;
    hudMult.classList.toggle("hot", G.mult >= 4);
  }

  /* ------------------------------- panels -------------------------- */

  function showPanel(title, bodyHtml, listHtml, ctaLabel, cls) {
    panelTitle.textContent = title;
    panelTitle.className = "panel-title" + (cls ? " " + cls : "");
    panelBody.innerHTML = bodyHtml;
    if (listHtml) {
      panelList.innerHTML = listHtml;
      panelList.style.display = "";
    } else {
      panelList.style.display = "none";
    }
    panelKeys.style.display = G.state === "menu" ? "" : "none";
    btnStart.innerHTML = ctaLabel;
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function primaryAction() {
    sndClick();
    switch (G.state) {
      case "menu":
      case "gameover":
      case "victory":
        startRun();
        break;
      case "boardclear":
        loadBoard(G.boardIx + 1);
        G.state = "playing";
        hideOverlay();
        syncHud(true);
        break;
      case "paused":
        togglePause();
        break;
      default:
        break;
    }
  }

  btnStart.addEventListener("click", primaryAction);
  btnRestart.addEventListener("click", function () {
    sndClick();
    startRun();
  });
  btnSound.addEventListener("click", function () {
    initAudio();
    setMuted(!muted);
    if (!muted) sndClick();
  });

  /* ------------------------------ boot ----------------------------- */

  function fitCanvas() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (G.board && (!G.bg || G.bgDpr !== dpr)) buildBackground(G.board);
  }
  window.addEventListener("resize", fitCanvas);

  fitCanvas();
  G.board = buildBoard(BOARDS[0], 0);
  buildBackground(G.board);
  var bootPad = samplePos(0);
  G.px = bootPad.x;
  G.py = bootPad.y;
  G.state = "menu";
  showPanel(
    "LIVE WIRE",
    "You are a spark of current loose in a failing mainframe. " +
      "Carry yourself down the copper traces from START to FINISH " +
      "on all five boards. You have three fuses for the whole run.",
    "<li><b>Hold &amp; drag</b> anywhere - the spark chases your pointer</li>" +
      "<li>Arrows / WASD nudge the spark if you prefer keys</li>" +
      "<li>Off the copper for a heartbeat means a <b>short</b> - a fuse blows</li>" +
      "<li>Time the <b>rotor arms</b>, <b>flare capacitors</b> and <b>solder bugs</b></li>" +
      "<li>Unbroken distance raises your voltage multiplier - shorts reset it</li>",
    "Power up \u25b8",
    "",
  );

  var last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (G.state === "playing") {
      step(dt);
    } else if (G.state !== "paused") {
      // keep ambient motion alive behind menus
      G.anim += dt;
    }
    render(dt);
  }
  requestAnimationFrame(frame);
})();
