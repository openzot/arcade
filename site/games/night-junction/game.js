/* Night Junction - a real-time railway dispatch game for the arcade.
   You are the signalman in a storm-lit mountain junction box. Steam trains
   roll in from the west, each flying a colour and a shape; flip the three
   track levers so every train is parked at its matching station without a
   rear-end collision, an occupied-platform meet, or a run off the unfinished
   east line. Deliver twelve trains to end the shift. */
(function () {
  "use strict";

  /* ================= dom ================= */

  var cvs = document.getElementById("board");
  var ctx = cvs.getContext("2d");
  var elScore = document.getElementById("hud-score");
  var elDone = document.getElementById("hud-done");
  var elGoal = document.getElementById("hud-goal");
  var elCombo = document.getElementById("hud-combo");
  var elComboV = document.getElementById("hud-combo-v");
  var elLanterns = document.getElementById("hud-lanterns");
  var overlay = document.getElementById("overlay");
  var card = document.getElementById("overlay-card");
  var btnSound = document.getElementById("btn-sound");
  var btnPause = document.getElementById("btn-pause");
  var btnRestart = document.getElementById("btn-restart");

  /* ================= utils ================= */

  var TAU = Math.PI * 2;
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function rand(a, b) {
    return a + Math.random() * (b - a);
  }
  function randi(n) {
    return (Math.random() * n) | 0;
  }
  function dist(ax, ay, bx, by) {
    var dx = bx - ax,
      dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
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

  /* ================= audio (Web Audio, synthesised) ================= */

  var actx = null;
  var master = null;
  var muted = false;

  function ensureAudio() {
    try {
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
        master = actx.createGain();
        master.gain.value = 0.24;
        master.connect(actx.destination);
      }
      if (actx.state === "suspended") actx.resume();
    } catch (e) {
      actx = null;
    }
  }

  function tone(freq, opt) {
    if (!actx || muted) return;
    opt = opt || {};
    var dur = opt.dur || 0.15;
    var t0 = actx.currentTime + (opt.delay || 0);
    try {
      var o = actx.createOscillator();
      var g = actx.createGain();
      o.type = opt.type || "sine";
      o.frequency.setValueAtTime(Math.max(30, freq), t0);
      if (opt.slide)
        o.frequency.exponentialRampToValueAtTime(
          Math.max(30, opt.slide),
          t0 + dur,
        );
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(opt.vol || 0.2, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    } catch (e) {
      /* audio best-effort */
    }
  }

  function rumble(dur, vol, freq) {
    if (!actx || muted) return;
    try {
      var n = Math.floor(actx.sampleRate * dur);
      var buf = actx.createBuffer(1, n, actx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      var src = actx.createBufferSource();
      src.buffer = buf;
      var f = actx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = freq || 140;
      var g = actx.createGain();
      var t0 = actx.currentTime;
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t0);
    } catch (e) {
      /* ignore */
    }
  }

  var sfx = {
    tick: function () {
      tone(700, { dur: 0.055, type: "square", vol: 0.12 });
      tone(1050, { dur: 0.04, type: "square", vol: 0.06, delay: 0.03 });
    },
    horn: function () {
      tone(196, { dur: 0.3, type: "sawtooth", vol: 0.07 });
      tone(247, { dur: 0.3, type: "sawtooth", vol: 0.055 });
    },
    chime: function (mult) {
      var notes = [523, 659, 784, 988, 1175];
      var n = notes[clamp(mult - 1, 0, 4)];
      tone(n, { dur: 0.16, type: "triangle", vol: 0.22 });
      tone(n * 1.5, { dur: 0.22, type: "triangle", vol: 0.13, delay: 0.07 });
    },
    bad: function () {
      tone(230, { dur: 0.28, type: "square", vol: 0.16, slide: 105 });
    },
    crash: function () {
      rumble(0.55, 0.5, 160);
      tone(70, { dur: 0.45, type: "sine", vol: 0.35, slide: 38 });
    },
    lost: function () {
      tone(180, { dur: 0.5, type: "sawtooth", vol: 0.14, slide: 60 });
    },
    win: function () {
      [659, 784, 988, 1319].forEach(function (f, i) {
        tone(f, { dur: 0.22, type: "triangle", vol: 0.2, delay: i * 0.13 });
      });
    },
    loseTune: function () {
      [392, 311, 233].forEach(function (f, i) {
        tone(f, { dur: 0.34, type: "triangle", vol: 0.18, delay: i * 0.22 });
      });
    },
    thunder: function () {
      rumble(1.7, 0.14, 95);
    },
  };

  /* ================= track geometry ================= */

  var W = 1000;
  var H = 640;
  var GOAL = 12;
  var LIVES = 3;

  /* Edges are polylines in world coordinates. `to` is the node at the end.
     Spurs carry a station index; exits lead off-board. */
  var E = {
    feederA: {
      pts: [
        [-60, 150],
        [128, 150],
        [214, 320],
      ],
      to: "J0",
    },
    feederB: {
      pts: [
        [-60, 490],
        [128, 490],
        [214, 320],
      ],
      to: "J0",
    },
    trunk1: {
      pts: [
        [214, 320],
        [352, 320],
      ],
      to: "W1",
    },
    spur1: {
      pts: [
        [352, 320],
        [352, 112],
        [484, 112],
      ],
      to: "ST1",
      station: 0,
    },
    exit1: {
      pts: [
        [484, 112],
        [770, 118],
        [1075, 128],
      ],
      to: null,
    },
    trunk2: {
      pts: [
        [352, 320],
        [566, 320],
      ],
      to: "W2",
    },
    spur2: {
      pts: [
        [566, 320],
        [566, 532],
        [700, 532],
      ],
      to: "ST2",
      station: 1,
    },
    exit2: {
      pts: [
        [700, 532],
        [940, 538],
        [1075, 542],
      ],
      to: null,
    },
    trunk3: {
      pts: [
        [566, 320],
        [772, 320],
      ],
      to: "W3",
    },
    spur3: {
      pts: [
        [772, 320],
        [772, 208],
        [884, 208],
      ],
      to: "ST3",
      station: 2,
    },
    exit3: {
      pts: [
        [884, 208],
        [1075, 216],
      ],
      to: null,
    },
    trunk4: {
      pts: [
        [772, 320],
        [1085, 320],
      ],
      to: "END",
    },
  };

  var NODES = {
    J0: { x: 214, y: 320 },
    W1: { x: 352, y: 320, outs: ["spur1", "trunk2"], sel: 1, flip: 0 },
    W2: { x: 566, y: 320, outs: ["spur2", "trunk3"], sel: 1, flip: 0 },
    W3: { x: 772, y: 320, outs: ["spur3", "trunk4"], sel: 1, flip: 0 },
    ST1: { station: 0 },
    ST2: { station: 1 },
    ST3: { station: 2 },
    END: { end: true },
  };
  var SWITCHES = ["W1", "W2", "W3"];
  var J0X = NODES.J0.x;
  var J0Y = NODES.J0.y;

  var STATIONS = [
    {
      name: "AMBER",
      color: "#ffb454",
      lite: "#ffd9a0",
      dark: "#8a5a1c",
      shape: "disc",
    },
    {
      name: "TEAL",
      color: "#3fd8c4",
      lite: "#a8f2e6",
      dark: "#1a6d62",
      shape: "tri",
    },
    {
      name: "ROSE",
      color: "#ff6d84",
      lite: "#ffb3bf",
      dark: "#8a3040",
      shape: "sq",
    },
  ];

  Object.keys(E).forEach(function (id) {
    var e = E[id];
    e.segs = [];
    e.total = 0;
    for (var i = 0; i < e.pts.length - 1; i++) {
      var ax = e.pts[i][0],
        ay = e.pts[i][1],
        bx = e.pts[i + 1][0],
        by = e.pts[i + 1][1];
      var len = dist(ax, ay, bx, by);
      e.segs.push({ ax: ax, ay: ay, bx: bx, by: by, len: len, cum: e.total });
      e.total += len;
    }
  });

  function pointAt(edgeId, s) {
    var e = E[edgeId];
    s = clamp(s, 0, e.total);
    for (var i = 0; i < e.segs.length; i++) {
      var g = e.segs[i];
      if (s <= g.cum + g.len || i === e.segs.length - 1) {
        var t = g.len ? (s - g.cum) / g.len : 0;
        return {
          x: g.ax + (g.bx - g.ax) * t,
          y: g.ay + (g.by - g.ay) * t,
          a: Math.atan2(g.by - g.ay, g.bx - g.ax),
        };
      }
    }
    return { x: e.pts[0][0], y: e.pts[0][1], a: 0 };
  }

  function edgeAngle(edgeId) {
    var g = E[edgeId].segs[0];
    return Math.atan2(g.by - g.ay, g.bx - g.ax);
  }

  /* ================= state ================= */

  var state = "menu"; // menu | running | paused | ending | won | lost
  var trains = [];
  var parts = [];
  var floats = [];
  var rain = [];
  var pending = null; // { t, col, feeder } next inbound train
  var autoSpawn = true; // scheduled arrivals; the #debug hook can disable it
  var score = 0,
    delivered = 0,
    misroutes = 0,
    crashes = 0,
    escapes = 0,
    combo = 0,
    bestCombo = 0,
    lanterns = LIVES;

  var elapsed = 0;
  var shake = 0;
  var flashA = 0;
  var boltT = rand(7, 14);
  var endT = 0;
  var loseCause = "";
  var uid = 0;

  var stars = [];
  var patches = [];
  var clouds = [
    { x: 120, y: 46, w: 190, h: 26, v: 7 },
    { x: 520, y: 28, w: 240, h: 22, v: 5 },
    { x: 820, y: 58, w: 200, h: 24, v: 9 },
  ];

  (function scenery() {
    var rng = mulberry32(20260822);
    for (var i = 0; i < 70; i++)
      stars.push({
        x: rng() * W,
        y: rng() * 92,
        r: 0.5 + rng() * 1.1,
        ph: rng() * TAU,
      });
    for (var j = 0; j < 11; j++)
      patches.push({
        x: rng() * W,
        y: 130 + rng() * 470,
        rx: 50 + rng() * 110,
        ry: 22 + rng() * 40,
        c: rng() > 0.5 ? "#0d1a25" : "#0c1722",
        rot: rng() * TAU,
      });
    for (var k = 0; k < 110; k++)
      rain.push({
        x: rng() * (W + 200) - 100,
        y: rng() * H,
        len: 10 + rng() * 14,
        v: 420 + rng() * 260,
        a: 0.08 + rng() * 0.14,
      });
  })();

  function spdBase() {
    return 78 + delivered * 3.4;
  }
  function spawnInt() {
    return Math.max(3.4, 8.4 - delivered * 0.42);
  }
  function dwellLen() {
    return Math.max(2.4, 5.2 - delivered * 0.22);
  }

  function makePending(t) {
    return { t: t, col: randi(3), feeder: randi(2) };
  }

  function resetRun() {
    trains.length = 0;
    parts.length = 0;
    floats.length = 0;
    score = 0;
    delivered = 0;
    misroutes = 0;
    crashes = 0;
    escapes = 0;
    combo = 0;
    bestCombo = 0;
    lanterns = LIVES;
    shake = 0;
    flashA = 0;
    endT = 0;
    loseCause = "";
    SWITCHES.forEach(function (id) {
      NODES[id].sel = 1;
      NODES[id].flip = 0;
    });
    pending = makePending(1.5);
    state = "running";
    hideCard();
    syncHUD();
  }

  /* ================= trains ================= */

  function spawnTrain(feeder, col) {
    var t = {
      id: uid++,
      edge: feeder ? "feederB" : "feederA",
      s: 6,
      col: col,
      phase: "run",
      st: -1,
      dwellT: 0,
      spd: spdBase() * rand(0.92, 1.1),
      dead: false,
      x: -60,
      y: feeder ? 490 : 150,
      ang: 0,
    };
    trains.push(t);
    sfx.horn();
  }

  function feederBlocked(f) {
    var fid = f ? "feederB" : "feederA";
    for (var i = 0; i < trains.length; i++) {
      var t = trains[i];
      if (t.phase !== "run") continue;
      if (t.edge === fid && t.s < E[fid].total - 26) return true;
      if (dist(t.x, t.y, J0X, J0Y) < 130) return true;
    }
    return false;
  }

  function arrive(t, nodeId) {
    var idx = NODES[nodeId].station;
    var e = E[t.edge];
    t.st = idx;
    t.phase = "dwell";
    t.dwellT = dwellLen();
    t.s = e.total;
    var p = pointAt(t.edge, t.s);
    t.x = p.x;
    t.y = p.y;
    t.ang = p.a;
    if (idx === t.col) {
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      var mult = Math.min(combo, 5);
      var pts = 100 * mult;
      score += pts;
      delivered++;
      floats.push({
        x: t.x,
        y: t.y - 26,
        txt: "+" + pts,
        col: STATIONS[idx].color,
        t: 1.15,
      });
      burst(t.x, t.y, STATIONS[idx].color, 14);
      sfx.chime(mult);
      if (delivered >= GOAL && state === "running") {
        state = "ending";
        endT = 1.05;
        sfx.win();
      }
    } else {
      misroutes++;
      combo = 0;
      score = Math.max(0, score - 30);
      floats.push({
        x: t.x,
        y: t.y - 26,
        txt: "-30 WRONG YARD",
        col: "#ff8484",
        t: 1.25,
      });
      shake = Math.max(shake, 4);
      sfx.bad();
    }
    syncHUD();
  }

  function escapeTrain(t) {
    t.dead = true;
    escapes++;
    lanterns--;
    combo = 0;
    floats.push({
      x: 980,
      y: 300,
      txt: "LOST IN THE STORM",
      col: "#ff8484",
      t: 1.4,
    });
    shake = Math.max(shake, 7);
    sfx.lost();
    syncHUD();
    if (lanterns <= 0)
      gameOver("A train ran off the unfinished east line into the storm.");
  }

  function advance(t, dt) {
    if (t.dead) return;
    if (t.phase === "dwell") {
      t.dwellT -= dt;
      if (t.dwellT <= 0) {
        t.edge = "exit" + (t.st + 1);
        t.s = 0;
        t.phase = "run";
      }
      return;
    }

    t.s += t.spd * dt;
    var guard = 0;
    while (guard++ < 8) {
      var e = E[t.edge];
      if (t.s < e.total) break;
      var nid = e.to;
      if (nid === "J0") {
        t.s -= e.total;
        t.edge = "trunk1";
      } else if (NODES[nid] && NODES[nid].outs) {
        var node = NODES[nid];
        t.s -= e.total;
        node.flip = 1;
        t.edge = node.outs[node.sel];
      } else if (NODES[nid] && NODES[nid].station !== undefined) {
        arrive(t, nid);
        return;
      } else if (nid === "END") {
        escapeTrain(t);
        return;
      } else {
        // exit edges run off-board: the train is clear, despawn it
        t.dead = true;
        return;
      }
    }
    var p = pointAt(t.edge, t.s);
    t.x = p.x;
    t.y = p.y;
    t.ang = p.a;
  }
  function collideCheck() {
    var hit = null;
    for (var i = 0; i < trains.length && !hit; i++) {
      for (var j = i + 1; j < trains.length; j++) {
        var a = trains[i],
          b = trains[j];
        if (a.dead || b.dead) continue;
        if (dist(a.x, a.y, b.x, b.y) < 27) {
          hit = [a, b];
          break;
        }
      }
    }
    if (hit) {
      hit[0].dead = true;
      hit[1].dead = true;
      boom((hit[0].x + hit[1].x) / 2, (hit[0].y + hit[1].y) / 2);
      crashes++;
      lanterns--;
      combo = 0;
      floats.push({
        x: hit[0].x,
        y: hit[0].y - 24,
        txt: "COLLISION!",
        col: "#ffab6b",
        t: 1.3,
      });
      shake = 13;
      sfx.crash();
      syncHUD();
      if (lanterns <= 0)
        gameOver("Two engines met metal-to-metal in the dark.");
    }
    trains = trains.filter(function (t) {
      return !t.dead;
    });
  }
  function gameOver(cause) {
    if (state === "lost" || state === "won" || state === "ending") return;
    state = "lost";
    loseCause = cause;

    lanterns = 0;
    syncHUD();
    sfx.loseTune();
    setTimeout(function () {
      if (state === "lost") showEnd(false);
    }, 750);
  }

  /* ================= effects ================= */

  function burst(x, y, col, n) {
    for (var i = 0; i < n; i++) {
      var a = rand(0, TAU),
        v = rand(40, 170);
      parts.push({
        x: x,
        y: y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: rand(0.4, 0.85),
        max: 0.85,
        sz: rand(1.6, 3.4),
        col: col,
        kind: "spark",
      });
    }
  }

  function boom(x, y) {
    burst(x, y, "#ffab6b", 16);
    burst(x, y, "#ffd166", 8);
    for (var i = 0; i < 10; i++) {
      var a = rand(0, TAU),
        v = rand(30, 110);
      parts.push({
        x: x,
        y: y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: rand(0.6, 1.1),
        max: 1.1,
        sz: rand(2.5, 5),
        col: "#5b6880",

        kind: "debris",
      });
    }
  }

  function updateParts(dt) {
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        parts.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      var damp = 1 - 2.4 * dt;
      p.vx *= damp;
      p.vy *= damp;
    }
    for (var j = floats.length - 1; j >= 0; j--) {
      var f = floats[j];
      f.t -= dt;
      f.y -= 26 * dt;
      if (f.t <= 0) floats.splice(j, 1);
    }
  }

  function updateAmbient(dt) {
    elapsed += dt;
    for (var i = 0; i < rain.length; i++) {
      var r = rain[i];
      r.y += r.v * dt;
      r.x -= r.v * 0.24 * dt;
      if (r.y > H + 20) {
        r.y = -20;
        r.x = rand(-100, W + 100);
      }
    }
    boltT -= dt;
    if (boltT <= 0) {
      boltT = rand(8, 17);
      flashA = 0.38;
      sfx.thunder();
    }
    flashA = Math.max(0, flashA - dt * 1.05);
    shake = Math.max(0, shake - dt * 26);
    for (var c = 0; c < clouds.length; c++) {
      clouds[c].x += clouds[c].v * dt;
      if (clouds[c].x - clouds[c].w > W + 40) clouds[c].x = -clouds[c].w - 40;
    }
  }

  function updateGame(dt) {
    SWITCHES.forEach(function (id) {
      NODES[id].flip = Math.max(0, NODES[id].flip - dt * 3.4);
    });

    if (state === "running" && autoSpawn) {
      pending.t -= dt;
      if (pending.t <= 0) {
        if (!feederBlocked(pending.feeder) && trains.length < 7) {
          spawnTrain(pending.feeder, pending.col);
          pending = makePending(spawnInt());
        } else {
          pending.t = 0.45;
        }
      }
    }

    for (var i = trains.length - 1; i >= 0; i--) {
      advance(trains[i], dt);
      if (trains[i].dead) trains.splice(i, 1);
    }
    if (state === "running") collideCheck();

    if (state === "ending") {
      endT -= dt;
      if (endT <= 0) {
        state = "won";
        showEnd(true);
      }
    }
  }

  /* ================= hud ================= */

  function syncHUD() {
    elScore.textContent = String(score);
    elDone.textContent = String(delivered);
    elGoal.textContent = String(GOAL);
    if (combo >= 2) {
      elCombo.hidden = false;
      elComboV.textContent = "×" + Math.min(combo, 5);
    } else {
      elCombo.hidden = true;
    }
    var html = "";
    for (var i = 0; i < LIVES; i++)
      html +=
        '<span class="lantern' + (i >= lanterns ? " out" : "") + '"></span>';
    elLanterns.innerHTML = html;
  }

  /* ================= overlay cards ================= */

  function showCard(html) {
    card.innerHTML = html;
    overlay.hidden = false;
    var b = card.querySelector("button.primary");
    if (b) b.focus();
  }

  function hideCard() {
    overlay.hidden = true;
  }

  function statsBlock() {
    return (
      '<div class="stats">' +
      "<span>Score<b>" +
      score +
      "</b></span>" +
      "<span>Delivered<b>" +
      delivered +
      "/" +
      GOAL +
      "</b></span>" +
      "<span>Best chain<b>×" +
      Math.min(bestCombo, 5) +
      "</b></span>" +
      "</div>"
    );
  }

  function showMenu() {
    showCard(
      "<h2>Night Junction</h2>" +
        '<p class="sub">Storm shift at the mountain signal box. Deliver ' +
        GOAL +
        " trains and keep your lanterns burning.</p>" +
        '<ul class="howto">' +
        "<li>Steam trains roll in from the west, each flying a <b>colour &amp; shape</b>.</li>" +
        "<li><b>Tap a lever</b> — or press <b>1&thinsp;2&thinsp;3</b> — to set the points before a train reaches them.</li>" +
        "<li>Park each train at its <b>matching station</b>. Back-to-back deliveries chain up to <b>×5</b> score.</li>" +
        "<li>A station that is already occupied is a crash waiting to happen. Stagger arrivals.</li>" +
        "<li>The east line is unfinished — anything run past the last lever is <b>lost</b>.</li>" +
        "<li>You hold <b>three lanterns</b>. When they all go dark, the shift is over.</li>" +
        "</ul>" +
        '<button class="primary" data-act="start">Start shift</button>',
    );
  }

  function showPauseCard() {
    showCard(
      "<h2>Paused</h2>" +
        '<p class="sub">The storm can wait. The trains cannot.</p>' +
        '<div class="stats"><span>Score<b>' +
        score +
        "</b></span><span>Delivered<b>" +
        delivered +
        "/" +
        GOAL +
        "</b></span></div>" +
        '<button class="primary" data-act="resume">Resume</button>' +
        '<button class="ghost" data-act="restart">Restart</button>',
    );
  }

  function showEnd(win) {
    var title = win
      ? '<h2 class="win">Shift Complete</h2><p class="sub">The last lamp burns steady. Fine signalling on a foul night.</p>'
      : '<h2 class="lost">Shift Over</h2><p class="sub">' +
        loseCause +
        " The box goes quiet.</p>";
    showCard(
      title +
        statsBlock() +
        '<button class="primary" data-act="restart">' +
        (win ? "Run it again" : "Try again") +
        "</button>",
    );
  }

  card.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!b) return;
    ensureAudio();
    var act = b.getAttribute("data-act");
    if (act === "start" || act === "restart") resetRun();
    else if (act === "resume") togglePause();
  });

  /* ================= input ================= */

  function canvasWorld(ev) {
    var rect = cvs.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * W,
      y: ((ev.clientY - rect.top) / rect.height) * H,
    };
  }

  function toggleSwitch(id) {
    var n = NODES[id];
    n.sel = n.sel ^ 1;
    n.flip = 1;
    sfx.tick();
  }

  cvs.addEventListener("pointerdown", function (ev) {
    ensureAudio();
    if (state !== "running" && state !== "paused") return;
    var p = canvasWorld(ev);
    for (var i = 0; i < SWITCHES.length; i++) {
      var id = SWITCHES[i],
        n = NODES[id];
      if (dist(p.x, p.y, n.x, n.y) < 36) {
        toggleSwitch(id);
        ev.preventDefault();
        return;
      }
    }
  });

  cvs.addEventListener("pointermove", function (ev) {
    var p = canvasWorld(ev);
    var hover = false;
    for (var i = 0; i < SWITCHES.length; i++) {
      var n = NODES[SWITCHES[i]];
      if (dist(p.x, p.y, n.x, n.y) < 36) hover = true;
    }
    cvs.style.cursor = hover ? "pointer" : "default";
  });

  function togglePause() {
    if (state === "running") {
      state = "paused";
      showPauseCard();
    } else if (state === "paused") {
      state = "running";
      hideCard();
    }
  }

  window.addEventListener("keydown", function (ev) {
    var k = ev.key;
    var handled = true;
    if (k === "1" || k === "2" || k === "3") {
      ensureAudio();
      if (state === "running" || state === "paused")
        toggleSwitch(SWITCHES[Number(k) - 1]);
    } else if (k === "p" || k === "P") {
      ensureAudio();
      togglePause();
    } else if (k === "r" || k === "R") {
      ensureAudio();
      resetRun();
    } else if (k === "m" || k === "M") {
      muted = !muted;
      btnSound.classList.toggle("muted", muted);
    } else if (k === "Enter" || k === " ") {
      if (!overlay.hidden) {
        var b = card.querySelector("button.primary");
        if (b) {
          ensureAudio();
          b.click();
          ev.preventDefault();
          return;
        }
      }
      handled = false;
    } else {
      handled = false;
    }
    if (handled) ev.preventDefault();
  });

  btnSound.addEventListener("click", function () {
    muted = !muted;
    btnSound.classList.toggle("muted", muted);
    if (!muted) ensureAudio();
  });
  btnPause.addEventListener("click", function () {
    ensureAudio();
    togglePause();
  });
  btnRestart.addEventListener("click", function () {
    ensureAudio();
    resetRun();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state === "running") togglePause();
  });

  /* ================= rendering ================= */

  var SCALE = 1;
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var cw = cvs.clientWidth || W;
    cvs.width = Math.round(cw * dpr);
    cvs.height = Math.round(cw * (H / W) * dpr);
    SCALE = cvs.width / W;
  }
  window.addEventListener("resize", resize);

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  var skyGrad = null;
  var vigGrad = null;

  function drawBackdrop() {
    if (!skyGrad) {
      skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, "#0b1322");
      skyGrad.addColorStop(0.55, "#0d1626");
      skyGrad.addColorStop(1, "#091019");
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = 0.35 + 0.35 * Math.sin(elapsed * 1.7 + s.ph);
      ctx.globalAlpha = tw;
      ctx.fillStyle = "#cfe0ff";
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // moon with halo
    var mg = ctx.createRadialGradient(918, 54, 6, 918, 54, 64);
    mg.addColorStop(0, "rgba(214,228,255,0.32)");
    mg.addColorStop(1, "rgba(214,228,255,0)");
    ctx.fillStyle = mg;
    ctx.fillRect(850, 0, 140, 130);
    ctx.fillStyle = "#dbe6fb";
    ctx.beginPath();
    ctx.arc(918, 54, 17, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(160,178,214,0.5)";
    ctx.beginPath();
    ctx.arc(912, 50, 4, 0, TAU);
    ctx.arc(923, 59, 3, 0, TAU);
    ctx.fill();

    // distant ridge
    ctx.fillStyle = "#101b2d";
    ctx.beginPath();
    ctx.moveTo(0, 96);
    ctx.lineTo(90, 74);
    ctx.lineTo(210, 94);
    ctx.lineTo(360, 66);
    ctx.lineTo(520, 96);
    ctx.lineTo(680, 72);
    ctx.lineTo(840, 98);
    ctx.lineTo(W, 78);
    ctx.lineTo(W, 130);
    ctx.lineTo(0, 130);
    ctx.closePath();
    ctx.fill();

    for (var c = 0; c < clouds.length; c++) {
      var cl = clouds[c];
      ctx.fillStyle = "rgba(157,184,232,0.05)";
      ctx.beginPath();
      ctx.ellipse(cl.x, cl.y, cl.w / 2, cl.h, 0, 0, TAU);
      ctx.fill();
    }
  }

  function drawGround() {
    ctx.fillStyle = "#0a111c";
    ctx.fillRect(0, 108, W, H - 108);
    for (var i = 0; i < patches.length; i++) {
      var p = patches[i];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.rx, p.ry, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawTracks() {
    Object.keys(E).forEach(function (id) {
      var e = E[id];
      var owner = null;
      for (var i = 0; i < SWITCHES.length; i++) {
        if (NODES[SWITCHES[i]].outs.indexOf(id) >= 0)
          owner = NODES[SWITCHES[i]];
      }
      var active = owner ? owner.outs[owner.sel] === id : true;
      var path = new Path2D();
      path.moveTo(e.pts[0][0], e.pts[0][1]);
      for (var k = 1; k < e.pts.length; k++)
        path.lineTo(e.pts[k][0], e.pts[k][1]);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.strokeStyle = "#1a2537";
      ctx.lineWidth = 8;
      ctx.stroke(path);

      ctx.strokeStyle = "#141d2d";
      ctx.lineWidth = 5;
      ctx.setLineDash([3, 9]);
      ctx.stroke(path);
      ctx.setLineDash([]);

      ctx.strokeStyle = active
        ? "rgba(158,186,226,0.75)"
        : "rgba(110,132,168,0.28)";
      ctx.lineWidth = 2.4;
      ctx.stroke(path);
    });
  }

  function drawHazard() {
    ctx.save();
    ctx.translate(1022, 320);
    ctx.fillStyle = "rgba(255,209,102,0.10)";
    ctx.fillRect(-34, -52, 44, 104);
    ctx.strokeStyle = "rgba(255,209,102,0.55)";
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 7]);
    ctx.lineDashOffset = -(elapsed * 26) % 14;
    ctx.beginPath();
    ctx.moveTo(-12, -52);
    ctx.lineTo(-12, 52);
    ctx.stroke();
    ctx.setLineDash([]);
    // warning triangle
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-24, -66);
    ctx.lineTo(-14, -82);
    ctx.lineTo(-4, -66);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(-15.5, -77, 3, 6);
    ctx.fillRect(-15.5, -69.5, 3, 2.4);
    ctx.restore();
  }

  function drawLevers() {
    SWITCHES.forEach(function (id, i) {
      var n = NODES[id];
      var outAng = edgeAngle(n.outs[n.sel]);
      var toStation = n.outs[n.sel].indexOf("spur") === 0;

      // urgency pulse when a train is near
      if (state === "running") {
        for (var t = 0; t < trains.length; t++) {
          var tr = trains[t];
          if (tr.phase === "run" && dist(tr.x, tr.y, n.x, n.y) < 235) {
            var pu = 0.45 + 0.3 * Math.sin(elapsed * 8);
            ctx.strokeStyle = "rgba(255,209,102," + pu.toFixed(3) + ")";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(n.x, n.y, 21 + Math.sin(elapsed * 8) * 2.4, 0, TAU);
            ctx.stroke();
            break;
          }
        }
      }

      ctx.fillStyle = "#0e1624";
      ctx.strokeStyle = "#3c4f73";
      ctx.lineWidth = 2;
      var baseR = 15 * (1 + 0.22 * n.flip);
      ctx.beginPath();
      ctx.arc(n.x, n.y, baseR, 0, TAU);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = toStation ? "#ffd166" : "#7fd1ff";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      var tipR = baseR - 4.5;
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.lineTo(n.x + Math.cos(outAng) * tipR, n.y + Math.sin(outAng) * tipR);
      ctx.stroke();
      ctx.fillStyle = "#f2f7ff";
      ctx.beginPath();
      ctx.arc(
        n.x + Math.cos(outAng) * tipR,
        n.y + Math.sin(outAng) * tipR,
        3.4,
        0,
        TAU,
      );
      ctx.fill();

      ctx.fillStyle = "#8fa1bd";
      ctx.font = "700 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), n.x, n.y + 27);
    });
  }

  function glyph(x, y, shape, size, fill, stroke) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke || fill;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (shape === "disc") {
      ctx.arc(x, y, size, 0, TAU);
      ctx.fill();
    } else if (shape === "tri") {
      ctx.moveTo(x, y - size * 1.15);
      ctx.lineTo(x + size, y + size * 0.8);
      ctx.lineTo(x - size, y + size * 0.8);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.rect(x - size * 0.9, y - size * 0.9, size * 1.8, size * 1.8);
      ctx.fill();
    }
  }

  function drawStations() {
    STATIONS.forEach(function (st, idx) {
      var stopPt =
        E["spur" + (idx + 1)].pts[E["spur" + (idx + 1)].pts.length - 1];
      var sx = stopPt[0],
        sy = stopPt[1];

      // platform slab south of the track
      ctx.fillStyle = "#151f30";
      ctx.strokeStyle = "#2c3d5c";
      ctx.lineWidth = 1.5;
      rr(sx - 52, sy + 9, 104, 22, 7);
      ctx.fill();
      ctx.stroke();

      // name plate
      ctx.fillStyle = st.color;
      ctx.globalAlpha = 0.92;
      ctx.font = "700 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(st.name, sx + 8, sy + 43);
      ctx.globalAlpha = 1;

      glyph(sx - 38, sy + 20, st.shape, 6, st.color);

      // lamp post + bulb
      ctx.strokeStyle = "#3c4f73";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx + 44, sy + 9);
      ctx.lineTo(sx + 44, sy - 8);
      ctx.stroke();
      var occupied = false;
      for (var i = 0; i < trains.length; i++)
        if (trains[i].phase === "dwell" && trains[i].st === idx)
          occupied = true;
      var bulb = occupied ? "#ff5d5d" : st.color;
      ctx.fillStyle = bulb;
      ctx.shadowColor = bulb;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(sx + 44, sy - 11, 4.4, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  function drawTrain(t) {
    var st = STATIONS[t.col];
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.ang);

    // headlight cone
    var beam = ctx.createLinearGradient(20, 0, 108, 0);
    beam.addColorStop(0, "rgba(255,240,200,0.22)");
    beam.addColorStop(1, "rgba(255,240,200,0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(21, -4);
    ctx.lineTo(106, -17);
    ctx.lineTo(106, 17);
    ctx.lineTo(21, 4);
    ctx.closePath();
    ctx.fill();

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    rr(-23, -9, 47, 21, 8);
    ctx.fill();

    // body
    ctx.fillStyle = st.color;
    rr(-23, -10.5, 46, 21, 7);
    ctx.fill();
    // cab (rear)
    ctx.fillStyle = st.dark;
    rr(-23, -10.5, 9, 21, 7);
    ctx.fill();
    // roof stripe
    ctx.fillStyle = st.lite;
    rr(-12, -3.5, 26, 7, 3.5);
    ctx.fill();
    glyph(1, 0, st.shape, 3.6, st.dark);
    // windows
    ctx.fillStyle = "rgba(10,17,29,0.85)";
    rr(-19, -7.5, 5, 5, 1.6);
    ctx.fill();
    rr(8, -7.5, 5, 5, 1.6);
    ctx.fill();
    rr(8, 2.5, 5, 5, 1.6);
    ctx.fill();
    // chimney
    ctx.fillStyle = st.dark;
    ctx.beginPath();
    ctx.arc(14, 0, 3.2, 0, TAU);
    ctx.fill();

    // tail lights while dwelling
    if (t.phase === "dwell") {
      ctx.fillStyle = "#ff5d5d";
      ctx.shadowColor = "#ff5d5d";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(-21, -5.5, 1.9, 0, TAU);
      ctx.arc(-21, 5.5, 1.9, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // dwell countdown ring above
    if (t.phase === "dwell") {
      var total = dwellLen();
      var frac = clamp(t.dwellT / total, 0, 1);
      ctx.strokeStyle = "rgba(143,161,189,0.35)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(t.x, t.y - 30, 11, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = STATIONS[t.st].color;
      ctx.beginPath();
      ctx.arc(t.x, t.y - 30, 11, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
      ctx.stroke();
    }
  }

  function drawInboundPreview() {
    if (!pending || pending.t > 2.4 || state !== "running") return;
    if (Math.sin(elapsed * 11) < -0.25) return;
    var fy = pending.feeder ? 490 : 150;
    var col = STATIONS[pending.col].color;
    ctx.save();
    ctx.translate(16, fy);
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.arc(0, 0, 5.5, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    for (var k = 0; k < 2; k++) {
      ctx.beginPath();
      ctx.moveTo(9 + k * 7, -7);
      ctx.lineTo(15 + k * 7, 0);
      ctx.lineTo(9 + k * 7, 7);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawParticlesFloats() {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.col;
      if (p.kind === "debris") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.life * 7);
        ctx.fillRect(-p.sz / 2, -p.sz / 2, p.sz, p.sz);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.sz, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.font = "800 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (var j = 0; j < floats.length; j++) {
      var f = floats[j];
      ctx.globalAlpha = clamp(f.t, 0, 1);
      ctx.fillStyle = f.col;
      ctx.fillText(f.txt, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawWeatherFlash() {
    ctx.strokeStyle = "rgba(164,196,236,0.55)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (var i = 0; i < rain.length; i++) {
      var r = rain[i];
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - r.len * 0.24, r.y - r.len);
    }
    ctx.globalAlpha = 0.75;
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (flashA > 0.005) {
      ctx.fillStyle = "rgba(188,212,255," + (flashA * 0.5).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    if (!vigGrad) {
      vigGrad = ctx.createRadialGradient(
        W / 2,
        H / 2,
        H * 0.42,
        W / 2,
        H / 2,
        H * 0.86,
      );
      vigGrad.addColorStop(0, "rgba(0,0,10,0)");
      vigGrad.addColorStop(1, "rgba(0,0,10,0.42)");
    }
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, W, H);
  }

  function render() {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    if (shake > 0.1)
      ctx.translate(
        (Math.random() * 2 - 1) * shake * 0.6,
        (Math.random() * 2 - 1) * shake * 0.6,
      );
    drawBackdrop();
    drawGround();
    drawHazard();
    drawTracks();
    drawStations();
    drawLevers();
    drawInboundPreview();
    for (var i = 0; i < trains.length; i++) drawTrain(trains[i]);
    drawParticlesFloats();
    drawWeatherFlash();
  }

  /* ================= main loop ================= */

  var last = performance.now();

  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    updateAmbient(dt);
    if (state === "running" || state === "ending") updateGame(dt);
    render();
    requestAnimationFrame(frame);
  }

  /* ================= debug hook (only with #debug) ================= */

  if (String(location.hash).indexOf("debug") >= 0) {
    window.__NJ = {
      info: function () {
        return {
          state: state,
          score: score,
          delivered: delivered,
          lanterns: lanterns,
          combo: combo,
          misroutes: misroutes,
          switches: SWITCHES.map(function (id) {
            return NODES[id].sel;
          }),
          trains: trains.map(function (t) {
            return { e: t.edge, s: Math.round(t.s), col: t.col, ph: t.phase };
          }),
        };
      },
      spawn: function (col, feeder) {
        if (state === "running") spawnTrain(feeder | 0, col | 0);
      },
      setSwitch: function (i, sel) {
        NODES["W" + i].sel = sel ? 1 : 0;
      },
      setAuto: function (on) {
        autoSpawn = !!on;
        pending = makePending(9999);
      },
    };
  }

  /* ================= boot ================= */

  resize();
  syncHUD();
  showMenu();
  requestAnimationFrame(frame);
})();
