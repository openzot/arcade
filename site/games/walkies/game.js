/* Walkies! — an untangle puzzle about dog leads.
   Drag walkers, dogs and lampposts until no line crosses another. */
(function () {
  "use strict";

  /* ---------- tiny helpers ---------- */

  var $ = function (id) {
    return document.getElementById(id);
  };
  var clamp = function (v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  };

  function makeRng(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  var REDUCED =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- level data ----------
     Node types: 'p' person, 'd' dog, 's' stationary-looking post.
     Every layout below is a hand-placed PLANAR embedding (verified by a
     scratch script before shipping): this is the solution you drag toward. */
  var LEVELS =
    /*LEVELS-BEGIN*/
    [
      {
        name: "First Morning",
        seed: 50,

        nodes: [
          { x: 330, y: 210, t: "p", name: "Ada" },
          { x: 570, y: 210, t: "p", name: "Ben" },
          { x: 300, y: 420, t: "d", name: "Biscuit" },
          { x: 600, y: 420, t: "d", name: "Waffle" },
          { x: 450, y: 315, t: "s", name: "Old Lamp" },
        ],
        edges: [
          [0, 2],
          [1, 3],
          [0, 4],
          [1, 4],
        ],
      },
      {
        name: "By the Bandstand",
        seed: 43,
        nodes: [
          { x: 450, y: 310, t: "s", name: "Bandstand Lamp" },
          { x: 255, y: 165, t: "p", name: "Cleo" },
          { x: 645, y: 165, t: "d", name: "Mabel" },
          { x: 645, y: 455, t: "p", name: "Ravi" },
          { x: 255, y: 455, t: "d", name: "Nugget" },
        ],
        edges: [
          [0, 1],
          [1, 2],
          [2, 0],
          [0, 3],
          [3, 4],
          [4, 0],
        ],
      },
      {
        name: "Four Friends",
        seed: 33,
        nodes: [
          { x: 450, y: 130, t: "p", name: "Ada" },
          { x: 235, y: 455, t: "p", name: "Ben" },
          { x: 665, y: 455, t: "p", name: "Cleo" },
          { x: 450, y: 340, t: "d", name: "Captain" },
        ],
        edges: [
          [0, 1],
          [0, 2],
          [0, 3],
          [1, 2],
          [1, 3],
          [2, 3],
        ],
      },
      {
        name: "Round the Fountain",
        seed: 53,
        nodes: [
          { x: 450, y: 125, t: "p", name: "Ada" },
          { x: 272, y: 432, t: "p", name: "Ben" },
          { x: 628, y: 432, t: "p", name: "Cleo" },
          { x: 450, y: 235, t: "s", name: "Fountain" },
          { x: 368, y: 377, t: "d", name: "Captain" },
          { x: 532, y: 377, t: "d", name: "Truffle" },
        ],
        edges: [
          [0, 1],
          [1, 2],
          [2, 0],
          [3, 4],
          [4, 5],
          [5, 3],
          [0, 3],
          [1, 4],
          [2, 5],
        ],
      },

      {
        name: "The Gossip Wheel",
        seed: 18,
        nodes: [
          { x: 450, y: 135, t: "p", name: "Ada" },
          { x: 668, y: 266, t: "d", name: "Biscuit" },
          { x: 562, y: 479, t: "p", name: "Ben" },
          { x: 338, y: 479, t: "d", name: "Waffle" },
          { x: 232, y: 266, t: "p", name: "Cleo" },
          { x: 450, y: 325, t: "s", name: "Old Lamp" },
        ],
        edges: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [4, 0],
          [5, 0],
          [5, 1],
          [5, 2],
          [5, 3],
          [5, 4],
        ],
      },
      {
        name: "Market Square",
        seed: 16,
        nodes: [
          { x: 250, y: 175, t: "p", name: "Ada" },
          { x: 650, y: 175, t: "p", name: "Ben" },
          { x: 650, y: 465, t: "p", name: "Cleo" },
          { x: 250, y: 465, t: "p", name: "Dee" },
          { x: 370, y: 255, t: "d", name: "Biscuit" },
          { x: 530, y: 255, t: "d", name: "Mabel" },
          { x: 530, y: 395, t: "d", name: "Nugget" },
          { x: 370, y: 395, t: "d", name: "Pretzel" },
        ],
        edges: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
          [4, 5],
          [5, 6],
          [6, 7],
          [7, 4],
          [0, 4],
          [1, 5],
          [2, 6],
          [3, 7],
        ],
      },
      {
        name: "The Maypole",
        seed: 9,

        nodes: [
          { x: 450, y: 125, t: "p", name: "Ada" },
          { x: 627, y: 432, t: "p", name: "Ben" },
          { x: 272, y: 432, t: "p", name: "Cleo" },
          { x: 537, y: 280, t: "d", name: "Biscuit" },
          { x: 450, y: 430, t: "d", name: "Mabel" },
          { x: 363, y: 280, t: "d", name: "Truffle" },
        ],
        edges: [
          [0, 1],
          [1, 2],
          [2, 0],
          [3, 4],
          [4, 5],
          [5, 3],
          [0, 3],
          [0, 5],
          [1, 4],
          [1, 3],
          [2, 5],
          [2, 4],
        ],
      },
      {
        name: "The Whole Parade",
        seed: 58,
        nodes: [
          { x: 450, y: 115, t: "p", name: "Ada" },
          { x: 654, y: 264, t: "d", name: "Biscuit" },
          { x: 576, y: 504, t: "p", name: "Ben" },
          { x: 324, y: 504, t: "d", name: "Waffle" },
          { x: 246, y: 264, t: "p", name: "Cleo" },
          { x: 512, y: 245, t: "d", name: "Mabel" },
          { x: 550, y: 362, t: "p", name: "Otto" },
          { x: 450, y: 435, t: "d", name: "Nugget" },
          { x: 350, y: 298, t: "p", name: "Dee" },
          { x: 388, y: 245, t: "d", name: "Pretzel" },
        ],
        edges: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [4, 0],
          [5, 6],
          [6, 7],
          [7, 8],
          [8, 9],
          [9, 5],
          [0, 5],
          [0, 9],
          [1, 6],
          [1, 5],
          [2, 7],
          [2, 6],
          [3, 8],
          [3, 7],
          [4, 9],
          [4, 8],
        ],
      },
    ];

  /*LEVELS-END*/ var PARK_NAMES = LEVELS.map(function (l) {
    return l.name;
  });

  /* ---------- world constants ---------- */

  var W = 900;
  var H = 600;
  var MARG = { x0: 78, x1: 822, y0: 112, y1: 528 };

  var SHIRTS = [
    "#c96f4a",
    "#5f8fb4",
    "#8a7fb8",
    "#c9a23f",
    "#4f9c86",
    "#b45f7d",
  ];
  var FURS = ["#8a6a48", "#4c4a48", "#c8a468", "#9a9c9e", "#6b4f3a"];

  /* ---------- audio (all synthesised) ---------- */

  var Snd = (function () {
    var ctx = null;
    var master = null;
    var muted = false;

    function init() {
      if (ctx || typeof window === "undefined") return;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(ctx.destination);
      } catch (err) {
        ctx = null;
      }
    }

    function resume() {
      if (ctx && ctx.state === "suspended") ctx.resume().catch(function () {});
    }

    function suspend() {
      if (ctx && ctx.state === "running") ctx.suspend().catch(function () {});
    }

    function tone(freq, dur, type, vol, glideTo) {
      if (!ctx || muted) return;
      try {
        var t = ctx.currentTime;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = type || "sine";
        osc.frequency.setValueAtTime(freq, t);
        if (glideTo) {
          osc.frequency.exponentialRampToValueAtTime(
            Math.max(30, glideTo),
            t + dur,
          );
        }
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + dur + 0.05);
      } catch (err) {
        /* never let sound break play */
      }
    }

    function tick() {
      if (!ctx || muted) return;
      try {
        var t = ctx.currentTime;
        var len = Math.ceil(ctx.sampleRate * 0.06);
        var buf = ctx.createBuffer(1, len, ctx.sampleRate);
        var data = buf.getChannelData(0);
        for (var i = 0; i < len; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
        }
        var src = ctx.createBufferSource();
        src.buffer = buf;
        var bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1700;
        bp.Q.value = 1.1;
        var gain = ctx.createGain();
        gain.gain.value = 0.5;
        src.connect(bp);
        bp.connect(gain);
        gain.connect(master);
        src.start(t);
      } catch (err) {
        /* ignore */
      }
    }

    function chord() {
      var notes = [523, 659, 784, 1046];
      for (var i = 0; i < notes.length; i++) {
        (function (n, delay) {
          if (!ctx) return;
          var when = ctx.currentTime + delay;
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(n, when);
          gain.gain.setValueAtTime(0.0001, when);
          gain.gain.exponentialRampToValueAtTime(0.16, when + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.5);
          osc.connect(gain);
          gain.connect(master);
          osc.start(when);
          osc.stop(when + 0.6);
        })(notes[i], i * 0.09);
      }
      setTimeout(function () {
        tone(300, 0.09, "square", 0.1, 190);
      }, 480);
      setTimeout(function () {
        tone(340, 0.09, "square", 0.1, 210);
      }, 640);
    }

    function chirp() {
      var notes = [1568, 1760, 2093, 2349];
      var f = notes[Math.floor(Math.random() * notes.length)];
      tone(f, 0.09, "sine", 0.05, f * 0.82);
      setTimeout(function () {
        tone(f * 1.12, 0.07, "sine", 0.04, f);
      }, 120);
    }

    function setMuted(m) {
      muted = m;
      if (master) master.gain.value = muted ? 0 : 0.5;
    }

    return {
      init: init,
      resume: resume,
      suspend: suspend,
      tone: tone,
      tick: tick,
      chord: chord,
      chirp: chirp,
      setMuted: setMuted,
      isMuted: function () {
        return muted;
      },
    };
  })();

  /* ---------- persistence ---------- */

  var SAVE_KEY = "walkies.save.v1";
  var SV = { u: 0, b: {} };

  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && typeof data === "object") {
          SV.u = clamp(data.u | 0, 0, LEVELS.length - 1);
          SV.b = data.b && typeof data.b === "object" ? data.b : {};
        }
      }
    } catch (err) {
      SV.u = 0;
      SV.b = {};
    }
  }

  function writeSave() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(SV));
    } catch (err) {
      /* private mode etc. — play on without saving */
    }
  }

  /* ---------- geometry ---------- */

  function orient(ax, ay, bx, by, cx, cy) {
    var v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    return v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0;
  }

  function onSeg(ax, ay, bx, by, px, py) {
    return (
      px >= Math.min(ax, bx) - 1e-9 &&
      px <= Math.max(ax, bx) + 1e-9 &&
      py >= Math.min(ay, by) - 1e-9 &&
      py <= Math.max(ay, by) + 1e-9
    );
  }

  function isEnd(ax, ay, bx, by, px, py) {
    return (
      (Math.abs(px - ax) < 1e-9 && Math.abs(py - ay) < 1e-9) ||
      (Math.abs(px - bx) < 1e-9 && Math.abs(py - by) < 1e-9)
    );
  }

  function segX(p, q, r, s) {
    var o1 = orient(p.x, p.y, q.x, q.y, r.x, r.y);
    var o2 = orient(p.x, p.y, q.x, q.y, s.x, s.y);
    var o3 = orient(r.x, r.y, s.x, s.y, p.x, p.y);
    var o4 = orient(r.x, r.y, s.x, s.y, q.x, q.y);
    if (
      o1 !== 0 &&
      o2 !== 0 &&
      o3 !== 0 &&
      o4 !== 0 &&
      o1 !== o2 &&
      o3 !== o4
    ) {
      var den = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
      if (den === 0) return null;
      var t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / den;
      return { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) };
    }
    if (
      o1 === 0 &&
      onSeg(p.x, p.y, q.x, q.y, r.x, r.y) &&
      !isEnd(p.x, p.y, q.x, q.y, r.x, r.y)
    ) {
      return { x: r.x, y: r.y };
    }
    if (
      o2 === 0 &&
      onSeg(p.x, p.y, q.x, q.y, s.x, s.y) &&
      !isEnd(p.x, p.y, q.x, q.y, s.x, s.y)
    ) {
      return { x: s.x, y: s.y };
    }
    if (
      o3 === 0 &&
      onSeg(r.x, r.y, s.x, s.y, p.x, p.y) &&
      !isEnd(r.x, r.y, s.x, s.y, p.x, p.y)
    ) {
      return { x: p.x, y: p.y };
    }
    if (
      o4 === 0 &&
      onSeg(r.x, r.y, s.x, s.y, q.x, q.y) &&
      !isEnd(r.x, r.y, s.x, s.y, q.x, q.y)
    ) {
      return { x: q.x, y: q.y };
    }
    return null;
  }

  function countCrossings(nodes, edges) {
    var pts = [];
    for (var i = 0; i < edges.length; i++) {
      for (var j = i + 1; j < edges.length; j++) {
        var e1 = edges[i];
        var e2 = edges[j];
        if (
          e1[0] === e2[0] ||
          e1[0] === e2[1] ||
          e1[1] === e2[0] ||
          e1[1] === e2[1]
        ) {
          continue;
        }
        var hit = segX(nodes[e1[0]], nodes[e1[1]], nodes[e2[0]], nodes[e2[1]]);
        if (hit) pts.push(hit);
      }
    }
    return pts;
  }

  /* ---------- state ---------- */

  var canvas = $("game");
  var ctx = canvas.getContext("2d");

  var view = { s: 1, ox: 0, oy: 0, w: 900, h: 600, dpr: 1 };

  var S = {
    mode: "title",
    lvl: 0,
    nodes: [],
    edges: [],
    sol: [],
    scr: [],
    moves: 0,
    undo: [],
    sel: -1,
    drag: null,
    kbd: null,
    crossPts: [],
    crossCount: 0,
    prevCross: -1,
    celebT: 0,
    particles: [],
    time: 0,
    chirpIn: 7,
    savedThisRun: false,
  };

  /* ---------- layout / fit ---------- */

  function resize() {
    var rect = canvas.getBoundingClientRect();
    view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    view.s = Math.min(view.w / W, view.h / H);
    view.ox = (view.w - W * view.s) / 2;
    view.oy = (view.h - H * view.s) / 2;
  }

  function eventWorld(ev) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left - view.ox) / view.s,
      y: (ev.clientY - rect.top - view.oy) / view.s,
    };
  }

  function screenPos(n) {
    return { x: view.ox + n.x * view.s, y: view.oy + n.y * view.s };
  }

  /* ---------- level plumbing ---------- */

  function edgeKind(a, b) {
    var ta = a.t;
    var tb = b.t;
    if (ta === "s" || tb === "s") {
      return ta === "d" || tb === "d" ? "tie" : "hello";
    }
    if (ta === "d" && tb === "d") return "sniff";
    if (ta === "d" || tb === "d") return "lead";
    return "hello";
  }

  function scrambleInto(target, source, seed) {
    var rng = makeRng(seed);
    for (var i = 0; i < source.length; i++) {
      var placed = false;
      var nx = source[i].x;
      var ny = source[i].y;
      for (var attempt = 0; attempt < 60 && !placed; attempt++) {
        nx = clamp(source[i].x + (rng() * 2 - 1) * 280, MARG.x0, MARG.x1);
        ny = clamp(source[i].y + (rng() * 2 - 1) * 230, MARG.y0, MARG.y1);
        placed = true;
        for (var j = 0; j < i; j++) {
          if (Math.hypot(nx - target[j].x, ny - target[j].y) < 54) {
            placed = false;
            break;
          }
        }
      }
      target[i].x = nx;
      target[i].y = ny;
    }
  }

  function prepare(lvl) {
    var L = LEVELS[lvl];
    S.lvl = lvl;
    S.sol = L.nodes.map(function (n) {
      return { x: n.x, y: n.y, t: n.t, name: n.name };
    });
    S.nodes = L.nodes.map(function (n) {
      return { x: n.x, y: n.y, t: n.t, name: n.name };
    });
    scrambleInto(S.nodes, S.sol, L.seed);
    S.scr = S.nodes.map(function (n) {
      return { x: n.x, y: n.y };
    });
    S.edges = L.edges.map(function (pair, k) {
      var a = S.nodes[pair[0]];
      var b = S.nodes[pair[1]];
      return {
        a: pair[0],
        b: pair[1],
        kind: edgeKind(a, b),
        slack: REDUCED ? 1 : 0,
        sagSign: (pair[0] * 7 + pair[1] * 13) % 2 === 0 ? 1 : -1,
        sagAmt: 8 + ((pair[0] + pair[1] * 3) % 4) * 3,
        flash: 0,
      };
    });
    S.moves = 0;
    S.undo = [];
    S.sel = -1;
    S.drag = null;
    S.kbd = null;
    S.particles = [];
    S.savedThisRun = false;
    S.crossPts = countCrossings(S.nodes, L.edges);
    S.crossCount = S.crossPts.length;
    S.prevCross = S.crossCount;
  }

  function startLevel(lvl) {
    prepare(lvl);
    S.mode = "playing";
    hideOverlay("ov-title");
    hideOverlay("ov-cleared");
    hideOverlay("ov-pause");
    hideOverlay("ov-finale");
    refreshHud();
    var dogs = [];
    for (var i = 0; i < S.nodes.length; i++) {
      if (S.nodes[i].t === "d") dogs.push(S.nodes[i].name);
    }
    showToast(PARK_NAMES[lvl] + " — out with " + dogs.join(", "));
  }

  function resetLevel() {
    if (S.mode !== "playing" && S.mode !== "paused") return;
    for (var i = 0; i < S.nodes.length; i++) {
      S.nodes[i].x = S.scr[i].x;
      S.nodes[i].y = S.scr[i].y;
    }
    S.moves = 0;
    S.undo = [];
    S.sel = -1;
    S.kbd = null;
    S.drag = null;
    recompute(false);
    refreshHud();
    showToast("Park reset. Deep breath.");
  }

  function doUndo() {
    if (S.mode !== "playing" || !S.undo.length) return;
    kbdCommit();
    var step = S.undo.pop();
    S.nodes[step.i].x = step.x;
    S.nodes[step.i].y = step.y;
    recompute(false);
    refreshHud();
    Snd.tone(240, 0.08, "triangle", 0.1);
  }

  function recompute(silent) {
    var pts = countCrossings(S.nodes, activeEdges());
    var before = S.crossCount;
    S.crossPts = pts;
    S.crossCount = pts.length;
    if (!silent && S.prevCross >= 0) {
      if (S.crossCount < before && S.crossCount > 0) Snd.tick();
      else if (S.crossCount > before) Snd.tone(120, 0.14, "sine", 0.14, 85);
    }
    S.prevCross = S.crossCount;
    if (S.crossCount === 0 && S.mode === "playing") beginCelebrate();
    refreshHud();
  }

  function activeEdges() {
    var out = [];
    for (var i = 0; i < S.edges.length; i++)
      out.push([S.edges[i].a, S.edges[i].b]);
    return out;
  }

  /* ---------- win flow ---------- */

  function bonesFor(moves, ic) {
    if (moves <= ic + 1) return 3;
    if (moves <= ic + 5) return 2;
    return 1;
  }

  function beginCelebrate() {
    S.mode = "celebrate";
    S.celebT = 0;
    S.sel = -1;
    S.drag = null;
    var ic = S.scr ? countCrossings(scrNodes(), activeEdges()).length : 0;
    var bones = bonesFor(S.moves, ic);
    var rec = SV.b[S.lvl];
    if (!rec || S.moves < rec.m || bones > rec.b) {
      SV.b[S.lvl] = {
        m: Math.min(rec ? rec.m : 9999, S.moves),
        b: Math.max(rec ? rec.b : 0, bones),
      };
    }
    if (S.lvl === SV.u && SV.u < LEVELS.length - 1) SV.u = S.lvl + 1;
    writeSave();
    Snd.chord();
    spawnLeaves();
    refreshHud();
  }

  function scrNodes() {
    // the scrambled snapshot the level started from — par is measured on it
    var fake = [];
    for (var i = 0; i < S.scr.length; i++)
      fake.push({ x: S.scr[i].x, y: S.scr[i].y });
    return fake;
  }

  function showCleared() {
    S.mode = "cleared";
    var rec = SV.b[S.lvl] || { m: S.moves, b: 1 };
    $("clr-detail").textContent =
      "\u201C" +
      PARK_NAMES[S.lvl] +
      "\u201D untangled in " +
      S.moves +
      (S.moves === 1 ? " drag" : " drags") +
      ". Best: " +
      rec.m +
      ".";
    var flavour = [
      "Every tail is wagging.",
      "Someone fetches a celebratory stick.",
      "A pigeon applauds from a safe distance.",
      "The lamppost has seen nothing worse.",
      "Leads lie flat as Sunday pancakes.",
    ];
    $("clr-flavour").textContent =
      flavour[S.lvl % flavour.length] + "  (+" + rec.b + " \uD83D\uDC3E)";
    if (S.lvl === LEVELS.length - 1) {
      $("btn-next").textContent = "See the morning total";
    } else {
      $("btn-next").textContent = "Next park";
    }
    showOverlay("ov-cleared");
  }

  function showFinale() {
    var bones = 0;
    var moves = 0;
    for (var i = 0; i < LEVELS.length; i++) {
      if (SV.b[i]) {
        bones += SV.b[i].b;
        moves += SV.b[i].m;
      }
    }
    $("fin-detail").textContent =
      bones +
      " of " +
      LEVELS.length * 3 +
      " paws earned across " +
      moves +
      " drags. The park is officially knot-free.";
    S.mode = "finale";
    showOverlay("ov-finale");
  }

  function nextPark() {
    kbdCommit();
    if (S.lvl < LEVELS.length - 1) {
      startLevel(S.lvl + 1);
    } else {
      hideOverlay("ov-cleared");
      showFinale();
    }
  }

  /* ---------- overlays, hud, toast ---------- */

  function showOverlay(id) {
    $(id).classList.remove("hidden");
  }

  function hideOverlay(id) {
    $(id).classList.add("hidden");
  }

  function refreshHud() {
    $("chip-park").textContent =
      "Park " + (S.lvl + 1) + " \u00B7 " + PARK_NAMES[S.lvl];
    var chip = $("chip-cross");
    if (S.crossCount === 0) {
      chip.textContent = "all clear!";
      chip.classList.add("clear");
      chip.classList.remove("warn");
    } else {
      chip.textContent =
        S.crossCount + (S.crossCount === 1 ? " tangle" : " tangles");
      chip.classList.add("warn");
      chip.classList.remove("clear");
    }
    $("chip-moves").textContent =
      S.moves + (S.moves === 1 ? " drag" : " drags");
    var bones = 0;
    for (var i = 0; i < LEVELS.length; i++) {
      if (SV.b[i]) bones += SV.b[i].b;
    }
    $("chip-bones").textContent = bones + "/" + LEVELS.length * 3 + " paws";
    $("btn-undo").disabled = !S.undo.length || S.mode !== "playing";
  }

  var toastTimer = null;
  function showToast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.add("hidden");
    }, 2200);
  }

  /* ---------- title grid ---------- */

  function buildGrid() {
    var grid = $("lv-grid");
    grid.innerHTML = "";
    var solvedAll = SV.u >= LEVELS.length - 1 && SV.b[LEVELS.length - 1];
    for (var i = 0; i < LEVELS.length; i++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lv-btn" + (i === S.lvl ? " current" : "");
      var locked = i > SV.u;
      btn.disabled = locked;
      var sub;
      if (locked) sub = "locked";
      else if (SV.b[i])
        sub =
          "best " +
          SV.b[i].m +
          " \u00B7 " +
          new Array(SV.b[i].b + 1).join("\uD83D\uDC3E");
      else sub = "fresh snow";
      btn.innerHTML =
        "<b>" +
        (i + 1) +
        "</b> " +
        LEVELS[i].name +
        "<small>" +
        sub +
        "</small>";
      (function (idx) {
        btn.addEventListener("click", function () {
          Snd.init();
          Snd.resume();
          startLevel(idx);
        });
      })(i);
      grid.appendChild(btn);
    }
    var start = $("btn-start");
    if (solvedAll) start.textContent = "Walk them again";
    else
      start.textContent =
        "Start park " + (Math.min(SV.u, LEVELS.length - 1) + 1);
  }

  function openTitle() {
    prepare(Math.min(SV.u, LEVELS.length - 1));
    S.mode = "title";
    buildGrid();
    showOverlay("ov-title");
    hideOverlay("ov-cleared");
    hideOverlay("ov-pause");
    hideOverlay("ov-finale");
    refreshHud();
  }

  /* ---------- pause ---------- */

  function setPaused(on) {
    if (on && S.mode === "playing") {
      S.mode = "paused";
      kbdCommit();
      showOverlay("ov-pause");
      Snd.suspend();
      syncSoundButtons();
    } else if (!on && S.mode === "paused") {
      S.mode = "playing";
      hideOverlay("ov-pause");
      Snd.resume();
    }
  }

  function toggleMute() {
    Snd.init();
    Snd.setMuted(!Snd.isMuted());
    try {
      localStorage.setItem("walkies.muted", Snd.isMuted() ? "1" : "0");
    } catch (err) {
      /* fine */
    }
    syncSoundButtons();
    if (!Snd.isMuted()) Snd.resume();
  }

  function syncSoundButtons() {
    var label = Snd.isMuted() ? "Sound: off" : "Sound: on";
    $("btn-p-sound").textContent = label;
    $("btn-sound").innerHTML = Snd.isMuted() ? "&#9834; Off" : "&#9834; On";
  }

  /* ---------- input: pointer ---------- */

  function pickNode(wx, wy) {
    var best = -1;
    var bestD = 34 / view.s;
    for (var i = 0; i < S.nodes.length; i++) {
      var d = Math.hypot(wx - S.nodes[i].x, wy - S.nodes[i].y);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  canvas.addEventListener("pointerdown", function (ev) {
    Snd.init();
    Snd.resume();
    if (S.mode !== "playing") return;
    var w = eventWorld(ev);
    var i = pickNode(w.x, w.y);
    if (i < 0) return;
    ev.preventDefault();
    kbdCommit();
    var n = S.nodes[i];
    S.drag = {
      i: i,
      gx: w.x - n.x,
      gy: w.y - n.y,
      sx: n.x,
      sy: n.y,
      moved: false,
    };
    S.undo.push({ i: i, x: n.x, y: n.y });
    S.sel = i;
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch (err) {
      /* older browsers */
    }
    canvas.classList.add("dragging");
    Snd.tone(392, 0.07, "triangle", 0.12);
  });

  canvas.addEventListener("pointermove", function (ev) {
    if (!S.drag || S.mode !== "playing") return;
    var w = eventWorld(ev);
    var n = S.nodes[S.drag.i];
    n.x = clamp(w.x - S.drag.gx, MARG.x0, MARG.x1);
    n.y = clamp(w.y - S.drag.gy, MARG.y0, MARG.y1);
    if (!S.drag.moved && Math.hypot(n.x - S.drag.sx, n.y - S.drag.sy) > 5) {
      S.drag.moved = true;
    }
    recompute(false);
  });

  function endDrag() {
    if (!S.drag) return;
    var drag = S.drag;
    S.drag = null;
    canvas.classList.remove("dragging");
    if (drag.moved) {
      S.moves++;
      Snd.tone(262, 0.09, "triangle", 0.12);
    } else {
      S.undo.pop();
    }
    refreshHud();
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("contextmenu", function (ev) {
    ev.preventDefault();
  });

  /* ---------- input: keyboard ---------- */

  function kbdCommit() {
    if (!S.kbd) return;
    var d = S.kbd;
    S.kbd = null;
    clearTimeout(d.timer);
    var n = S.nodes[d.i];
    if (Math.hypot(n.x - d.x, n.y - d.y) > 4) {
      S.moves++;
      Snd.tone(262, 0.09, "triangle", 0.12);
    } else {
      S.undo.pop();
    }
    refreshHud();
  }

  function nudge(dx, dy) {
    if (S.mode !== "playing" || S.sel < 0) return;
    var n = S.nodes[S.sel];
    if (!S.kbd) {
      S.undo.push({ i: S.sel, x: n.x, y: n.y });
      S.kbd = {
        i: S.sel,
        x: n.x,
        y: n.y,
        timer: setTimeout(kbdCommit, 700),
      };
    }
    n.x = clamp(n.x + dx, MARG.x0, MARG.x1);
    n.y = clamp(n.y + dy, MARG.y0, MARG.y1);
    recompute(false);
  }

  function cycleSelect() {
    if (S.mode !== "playing") return;
    kbdCommit();
    if (!S.nodes.length) return;
    S.sel = (S.sel + 1) % S.nodes.length;
    Snd.tone(520, 0.05, "square", 0.05);
  }

  document.addEventListener("keydown", function (ev) {
    var tag = (ev.target && ev.target.tagName) || "";
    if (tag === "BUTTON" && (ev.key === "Enter" || ev.key === " ")) {
      return; // let focused buttons behave normally
    }
    var k = ev.key.toLowerCase();
    if (k === "tab") {
      ev.preventDefault();
      cycleSelect();
      return;
    }
    if (k === "enter" || k === " ") {
      if (S.mode === "playing") {
        ev.preventDefault();
        cycleSelect();
      }
      return;
    }
    if (
      k === "arrowleft" ||
      k === "arrowright" ||
      k === "arrowup" ||
      k === "arrowdown"
    ) {
      ev.preventDefault();
      var step = ev.shiftKey ? 26 : 9;
      if (k === "arrowleft") nudge(-step, 0);
      if (k === "arrowright") nudge(step, 0);
      if (k === "arrowup") nudge(0, -step);
      if (k === "arrowdown") nudge(0, step);
      return;
    }
    if (k === "u" || k === "z") {
      ev.preventDefault();
      doUndo();
      return;
    }
    if (k === "r") {
      ev.preventDefault();
      kbdCommit();
      resetLevel();
      return;
    }
    if (k === "m") {
      ev.preventDefault();
      toggleMute();
      return;
    }
    if (k === "p" || k === "escape") {
      ev.preventDefault();
      if (S.mode === "playing" || S.mode === "paused")
        setPaused(S.mode === "playing");
    }
  });

  /* ---------- buttons ---------- */

  function wire(id, fn) {
    $(id).addEventListener("click", function () {
      Snd.init();
      Snd.tone(500, 0.05, "square", 0.05);
      fn();
    });
  }

  wire("btn-start", function () {
    Snd.resume();
    startLevel(Math.min(SV.u, LEVELS.length - 1));
  });
  wire("btn-next", nextPark);
  wire("btn-again", function () {
    startLevel(S.lvl);
  });
  wire("btn-clr-menu", openTitle);
  wire("btn-resume", function () {
    setPaused(false);
  });
  wire("btn-p-reset", function () {
    resetLevel();
    setPaused(false);
  });
  wire("btn-p-menu", openTitle);
  wire("btn-p-sound", toggleMute);
  wire("btn-again-all", function () {
    startLevel(0);
  });
  wire("btn-fin-menu", openTitle);
  wire("btn-undo", doUndo);
  wire("btn-reset", resetLevel);
  wire("btn-pause", function () {
    if (S.mode === "playing" || S.mode === "paused") {
      setPaused(S.mode === "playing");
    }
  });
  wire("btn-sound", toggleMute);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      setPaused(true);
      Snd.suspend();
    } else if (S.mode === "paused") {
      Snd.resume();
    }
  });

  window.addEventListener("resize", function () {
    resize();
  });

  /* ---------- confetti ---------- */

  function spawnLeaves() {
    if (REDUCED) return;
    var colors = ["#7fae62", "#c9a23f", "#b45f7d", "#5f8fb4"];
    for (var i = 0; i < 42; i++) {
      S.particles.push({
        x: 100 + Math.random() * 700,
        y: -20 - Math.random() * 140,
        vx: (Math.random() - 0.5) * 36,
        vy: 60 + Math.random() * 70,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 5,
        c: colors[i % colors.length],
        life: 3.2,
      });
    }
  }

  /* ---------- drawing ---------- */

  var bg = document.createElement("canvas");
  bg.width = W;
  bg.height = H;

  function paintBackground() {
    var g = bg.getContext("2d");
    var rng = makeRng(424242);
    var grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#a8cf89");
    grad.addColorStop(1, "#8dbb6f");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // mow stripes
    g.fillStyle = "rgba(255,255,255,0.05)";
    for (var y = 0; y < H; y += 64) {
      g.fillRect(0, y, W, 32);
    }

    // gravel paths
    g.strokeStyle = "#d9cba6";
    g.lineCap = "round";
    g.lineWidth = 46;
    g.beginPath();
    g.moveTo(-20, 520);
    g.quadraticCurveTo(230, 430, 430, 500);
    g.quadraticCurveTo(650, 570, 920, 470);
    g.stroke();
    g.lineWidth = 34;
    g.beginPath();
    g.moveTo(120, -20);
    g.quadraticCurveTo(160, 200, 90, 420);
    g.stroke();

    // pond
    g.fillStyle = "#8fc0d4";
    g.beginPath();
    g.ellipse(790, 118, 92, 58, -0.35, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#7aa9bd";
    g.lineWidth = 5;
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.beginPath();
    g.ellipse(768, 104, 34, 12, -0.4, 0, Math.PI * 2);
    g.fill();

    // shrubs around the rim
    function bush(bx, by, r, col) {
      g.fillStyle = col;
      g.beginPath();
      g.arc(bx, by, r, 0, Math.PI * 2);
      g.arc(bx + r * 0.9, by + r * 0.25, r * 0.72, 0, Math.PI * 2);
      g.arc(bx - r * 0.85, by + r * 0.3, r * 0.66, 0, Math.PI * 2);
      g.fill();
    }
    var spots = [
      [60, 60],
      [180, 40],
      [860, 260],
      [40, 300],
      [870, 420],
      [500, 60],
      [700, 40],
      [40, 540],
      [880, 560],
    ];
    for (var i = 0; i < spots.length; i++) {
      bush(
        spots[i][0],
        spots[i][1],
        22 + rng() * 16,
        i % 2 ? "#5d8f4c" : "#6da057",
      );
    }

    // benches along the main path
    function bench(bxx, byy, ang) {
      g.save();
      g.translate(bxx, byy);
      g.rotate(ang);
      g.fillStyle = "#8a6a48";
      g.fillRect(-26, -6, 52, 10);
      g.fillStyle = "#75593c";
      g.fillRect(-22, 4, 5, 8);
      g.fillRect(17, 4, 5, 8);
      g.restore();
    }
    bench(240, 468, 0.25);
    bench(620, 522, -0.18);

    // scattered flowers
    for (var f = 0; f < 60; f++) {
      var fx = 30 + rng() * (W - 60);
      var fy = 30 + rng() * (H - 60);
      g.fillStyle =
        rng() > 0.5 ? "rgba(255,255,255,0.5)" : "rgba(255, 224, 130, 0.6)";
      g.beginPath();
      g.arc(fx, fy, 2 + rng() * 1.6, 0, Math.PI * 2);
      g.fill();
    }
  }

  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.arcTo(x + w, y, x + w, y + r, r);
    c.lineTo(x + w, y + h - r);
    c.arcTo(x + w, y + h, x + w - r, y + h, r);
    c.lineTo(x + r, y + h);
    c.arcTo(x, y + h, x, y + h - r, r);
    c.lineTo(x, y + r);
    c.arcTo(x, y, x + r, y, r);
    c.closePath();
  }

  var CROSS_HIT = {}; // "i_j" -> intersection point
  var CROSS_EDGE = []; // per-edge boolean

  function rebuildCrossSet() {
    CROSS_HIT = {};
    for (var i = 0; i < S.edges.length; i++) {
      CROSS_EDGE[i] = false;
    }
    for (var a = 0; a < S.edges.length; a++) {
      for (var b = a + 1; b < S.edges.length; b++) {
        var e1 = S.edges[a];
        var e2 = S.edges[b];
        if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) {
          continue;
        }
        var hit = segX(
          S.nodes[e1.a],
          S.nodes[e1.b],
          S.nodes[e2.a],
          S.nodes[e2.b],
        );
        if (hit) {
          CROSS_HIT[a + "_" + b] = hit;
          CROSS_EDGE[a] = true;
          CROSS_EDGE[b] = true;
        }
      }
    }
  }

  function isEdgeCrossed(i) {
    return CROSS_EDGE[i] === true;
  }

  function draw() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.s, view.s);

    ctx.drawImage(bg, 0, 0);

    rebuildCrossSet();

    var celebrating = S.mode === "celebrate";

    // edges
    for (var i = 0; i < S.edges.length; i++) {
      var e = S.edges[i];
      var na = S.nodes[e.a];
      var nb = S.nodes[e.b];
      var crossed = CROSS_EDGE[i] === true;
      var styles = {
        lead: { col: "#7a4f2b", w: 3.4 },
        tie: { col: "#7a4f2b", w: 3.4 },
        hello: { col: "#5f7386", w: 2.2, dash: [8, 8] },
        sniff: { col: "#a76a8c", w: 2.2, dash: [3, 6] },
      };
      var st = styles[e.kind] || styles.hello;
      var col = st.col;
      var lw = st.w;
      if (crossed) {
        col = "#cf3f54";
        lw = st.w + 0.6;
      }
      if (celebrating) {
        var pulse = Math.max(0, Math.sin(S.time * 6 - i * 0.7));
        if (pulse > 0.4) col = "#2f8f57";
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.setLineDash(st.dash || []);
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      if (crossed || e.slack < 0.05) {
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
      } else {
        var mx = (na.x + nb.x) / 2;
        var my = (na.y + nb.y) / 2;
        var dx = nb.x - na.x;
        var dy = nb.y - na.y;
        var len = Math.hypot(dx, dy) || 1;
        var sag = e.sagAmt * e.slack * e.sagSign;
        ctx.moveTo(na.x, na.y);
        ctx.quadraticCurveTo(
          mx - (dy / len) * sag,
          my + (dx / len) * sag,
          nb.x,
          nb.y,
        );
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // crossing markers
    for (var ck = 0; ck < S.crossPts.length; ck++) {
      var pt = S.crossPts[ck];
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      crossMark(pt.x, pt.y, 6);
      ctx.strokeStyle = "#cf3f54";
      ctx.lineWidth = 2.4;
      crossMark(pt.x, pt.y, 6);
    }

    // nodes: posts behind, then people & dogs by depth
    var order = [];
    for (var n = 0; n < S.nodes.length; n++) {
      order.push(n);
    }
    order.sort(function (a, b) {
      var ta = S.nodes[a].t === "s" ? 0 : 1;
      var tb = S.nodes[b].t === "s" ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return S.nodes[a].y - S.nodes[b].y;
    });

    for (var oi = 0; oi < order.length; oi++) {
      var idx = order[oi];
      var node = S.nodes[idx];
      var bob = REDUCED
        ? 0
        : Math.sin(S.time * 2.1 + idx * 1.7) * (node.t === "d" ? 2 : 1);
      drawShadow(node.x, node.y, node.t);
      if (node.t === "s") drawPost(node, bob);
      else if (node.t === "p") drawPerson(node, idx, bob);
      else drawDog(node, idx, bob, celebrating);
      if (S.sel === idx && S.mode === "playing") {
        ctx.strokeStyle = "rgba(47, 107, 69, 0.9)";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -S.time * 22;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
    }
  }

  function crossMark(x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
  }

  function drawShadow(x, y, t) {
    ctx.fillStyle = "rgba(40, 60, 35, 0.22)";
    ctx.beginPath();
    ctx.ellipse(
      x,
      y + (t === "s" ? 4 : 16),
      t === "s" ? 12 : 14,
      5,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  function drawPost(node, bob) {
    var x = node.x;
    var y = node.y + bob;
    ctx.strokeStyle = "#5d4a37";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 44);
    ctx.stroke();
    ctx.strokeStyle = "#4a3a2b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 9, y - 30);
    ctx.lineTo(x + 9, y - 30);
    ctx.stroke();
    var glow = ctx.createRadialGradient(x, y - 50, 2, x, y - 50, 14);
    glow.addColorStop(0, "rgba(255, 216, 138, 0.95)");
    glow.addColorStop(1, "rgba(255, 216, 138, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y - 50, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd98a";
    ctx.beginPath();
    ctx.arc(x, y - 50, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#4a3a2b";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawPerson(node, idx, bob) {
    var x = node.x;
    var y = node.y + bob;
    ctx.fillStyle = SHIRTS[idx % SHIRTS.length];
    rr(ctx, x - 12, y - 12, 24, 28, 11);
    ctx.fill();
    ctx.fillStyle = "#e9c49c";
    ctx.beginPath();
    ctx.arc(x, y - 20, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4a3a2b";
    ctx.beginPath();
    ctx.arc(x, y - 24, 9, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#33413a";
    ctx.beginPath();
    ctx.arc(x - 3, y - 19, 1.2, 0, Math.PI * 2);
    ctx.arc(x + 3, y - 19, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDog(node, idx, bob, celebrating) {
    var x = node.x;
    var hop = 0;
    if (celebrating && !REDUCED) {
      var phase = clamp(S.time * 2.4 - idx * 0.25, 0, 1);
      hop = -Math.sin(phase * Math.PI) * 14;
    }
    var y = node.y + bob + hop;
    var fur = FURS[idx % FURS.length];

    // tail
    ctx.strokeStyle = fur;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    var wag = REDUCED ? 0.4 : Math.sin(S.time * 6 + idx) * 0.45;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 2);
    ctx.lineTo(x + 17, y - 4 + wag * 8);
    ctx.stroke();

    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(x, y, 14, 9.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // head
    ctx.beginPath();
    ctx.arc(x - 11, y - 6, 7.5, 0, Math.PI * 2);
    ctx.fill();
    // ears
    ctx.beginPath();
    ctx.moveTo(x - 16, y - 11);
    ctx.lineTo(x - 13, y - 18);
    ctx.lineTo(x - 10, y - 11);
    ctx.closePath();
    ctx.moveTo(x - 9, y - 12);
    ctx.lineTo(x - 5, y - 17);
    ctx.lineTo(x - 4, y - 10);
    ctx.closePath();
    ctx.fill();
    // nose
    ctx.fillStyle = "#2e2a26";
    ctx.beginPath();
    ctx.arc(x - 18, y - 6, 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(51, 65, 58, 0.72)";
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(node.name || "Dog", x, y + 26);
  }

  function drawParticles(dt) {
    for (var i = S.particles.length - 1; i >= 0; i--) {
      var p = S.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        S.particles.splice(i, 1);
        continue;
      }
      p.vy += 26 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.ellipse(0, 0, 7, 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  /* ---------- main loop ---------- */

  var lastTs = 0;

  function frame(ts) {
    var dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    if (!document.hidden) {
      S.time += dt;

      // relax / tighten the leads
      for (var i = 0; i < S.edges.length; i++) {
        var e = S.edges[i];
        var target = isEdgeCrossed(i) ? 0 : 1;
        if (REDUCED) e.slack = 1;
        else e.slack += (target - e.slack) * Math.min(1, dt * 7);
      }

      if (S.mode === "playing" && !Snd.isMuted()) {
        S.chirpIn -= dt;
        if (S.chirpIn <= 0) {
          S.chirpIn = 6 + Math.random() * 9;
          Snd.chirp();
        }
      }

      if (S.mode === "celebrate") {
        S.celebT += dt;
        if (S.celebT >= 1.15) showCleared();
      }

      draw();
      if (S.particles.length) drawParticles(dt);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- tiny debug hook for automated tests ---------- */

  window.__walkies = {
    version: 1,
    mode: function () {
      return S.mode;
    },
    level: function () {
      return S.lvl;
    },
    crossings: function () {
      return S.crossCount;
    },
    moves: function () {
      return S.moves;
    },
    nodeScreen: function (i) {
      return screenPos(S.nodes[i]);
    },
    forceSolve: function () {
      for (var i = 0; i < S.nodes.length; i++) {
        S.nodes[i].x = S.sol[i].x;
        S.nodes[i].y = S.sol[i].y;
      }
      recompute(true);
    },
    goto: function (i) {
      startLevel(clamp(i, 0, LEVELS.length - 1));
    },
  };

  /* ---------- boot ---------- */

  loadSave();
  try {
    if (localStorage.getItem("walkies.muted") === "1") Snd.setMuted(true);
  } catch (err) {
    /* fine */
  }
  paintBackground();
  resize();
  openTitle();
  syncSoundButtons();
  requestAnimationFrame(frame);
})();
