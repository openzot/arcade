/*
 * Song Cylinder - a music-box workshop for the arcade.
 *
 * Six tunes wait on the patron's card. Press brass pins into the turning
 * cylinder's hole grid so the barrel plucks the steel comb through each
 * commissioned tune, spend scarce winds to hear the patron's original,
 * and present the finished work before the bench candle burns down.
 *
 * Everything lives in this one classic script, wrapped in one IIFE.
 * All art is drawn on one canvas; all sound is synthesised with Web Audio.
 */
(function () {
  "use strict";

  /* ---------------- helpers ---------------- */

  function $(id) {
    return document.getElementById(id);
  }
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  /* ---------------- dom ---------------- */

  var cvs = $("bench");
  var ctx = cvs.getContext("2d");
  var tuneChip = $("tuneChip");
  var scoreChip = $("scoreChip");
  var demoBtn = $("demoBtn");
  var presentBtn = $("presentBtn");
  var soundBtn = $("soundBtn");
  var pauseBtn = $("pauseBtn");
  var restartBtn = $("restartBtn");
  var helpBtn = $("helpBtn");
  var veil = $("veil");
  var panels = {
    start: $("panelStart"),
    result: $("panelResult"),
    end: $("panelEnd"),
    pause: $("panelPause"),
  };
  var startBtn = $("startBtn");
  var nextBtn = $("nextBtn");
  var againBtn = $("againBtn");
  var resumeBtn = $("resumeBtn");
  var resultTitle = $("resultTitle");
  var resultLede = $("resultLede");
  var resultStats = $("resultStats");
  var endTitle = $("endTitle");
  var endLede = $("endLede");
  var endStats = $("endStats");

  /* ---------------- tuning data ---------------- */

  // Ten tines: C-major pentatonic across two octaves, low row 0 .. high row 9.
  var TINES = [
    { n: "C4", f: 261.63 },
    { n: "D4", f: 293.66 },
    { n: "E4", f: 329.63 },
    { n: "G4", f: 392.0 },
    { n: "A4", f: 440.0 },
    { n: "C5", f: 523.25 },
    { n: "D5", f: 587.33 },
    { n: "E5", f: 659.26 },
    { n: "G5", f: 783.99 },
    { n: "A5", f: 880.0 },
  ];

  /*
   * Each tune: name, steps (columns), tempo ms per step, pass threshold,
   * candle seconds, and notes as [column, [rows]] pairs. Original melodies,
   * written for the pentatonic comb so an improvising hand still sounds sweet.
   */
  var TUNES = [
    {
      name: "The Apprentice's Eight",
      steps: 8,
      tempo: 340,
      thr: 0.7,
      candle: 75,
      notes: [
        [0, [2]],
        [1, [3]],
        [2, [4]],
        [3, [5]],
        [4, [4]],
        [5, [3]],
        [6, [2]],
        [7, [1]],
      ],
    },
    {
      name: "Windmill Waltz",
      steps: 12,
      tempo: 320,
      thr: 0.72,
      candle: 85,
      notes: [
        [0, [4]],
        [1, [5]],
        [2, [6]],
        [3, [5]],
        [4, [4]],
        [5, [3]],
        [6, [2]],
        [7, [3]],
        [8, [4]],
        [9, [3]],
        [10, [2]],
        [11, [1]],
      ],
    },
    {
      name: "Brass & Snow",
      steps: 16,
      tempo: 300,
      thr: 0.75,
      candle: 95,
      notes: [
        [0, [2]],
        [1, [3]],
        [2, [4]],
        [3, [5]],
        [4, [4]],
        [5, [3]],
        [6, [2]],
        [8, [1]],
        [9, [2]],
        [10, [3]],
        [11, [2]],
        [12, [1]],
        [13, [0]],
        [15, [2]],
      ],
    },
    {
      name: "The Patron's Entry",
      steps: 20,
      tempo: 280,
      thr: 0.78,
      candle: 110,
      notes: [
        [0, [4]],
        [1, [4]],
        [2, [5]],
        [3, [6]],
        [4, [5]],
        [5, [4]],
        [6, [2]],
        [7, [3]],
        [8, [2]],
        [10, [1]],
        [11, [2]],
        [12, [3]],
        [13, [4]],
        [14, [3]],
        [15, [2]],
        [16, [1]],
        [17, [3]],
        [18, [4]],
        [19, [2, 6]],
      ],
    },
    {
      name: "The Clockwork Wren",
      steps: 26,
      tempo: 260,
      thr: 0.8,
      candle: 120,
      notes: [
        [0, [7]],
        [1, [6]],
        [2, [7]],
        [3, [8]],
        [4, [7]],
        [5, [6]],
        [6, [5]],
        [7, [6]],
        [8, [7]],
        [9, [6]],
        [10, [5]],
        [12, [4]],
        [13, [5]],
        [14, [6]],
        [15, [7]],
        [16, [8]],
        [17, [9]],
        [18, [8]],
        [19, [7]],
        [20, [6]],
        [21, [5]],
        [22, [4]],
        [23, [3]],
        [24, [2]],
        [25, [4]],
      ],
    },
    {
      name: "Midnight Demonstration",
      steps: 32,
      tempo: 240,
      thr: 0.82,
      candle: 140,
      notes: [
        [0, [4]],
        [2, [5]],
        [4, [6]],
        [5, [5]],
        [6, [4]],
        [8, [3]],
        [10, [4]],
        [12, [5]],
        [13, [4]],
        [14, [3]],
        [16, [2]],
        [18, [3]],
        [20, [2]],
        [21, [3]],
        [22, [4]],
        [23, [3]],
        [24, [2]],
        [25, [1]],
        [26, [2]],
        [27, [3]],
        [28, [2]],
        [29, [1]],
        [30, [0, 4]],
      ],
    },
  ];

  var WINDS_PER_TUNE = 2;

  /* ---------------- geometry ---------------- */

  var W = 960;
  var H = 600;
  var GUTTER = 150;
  var GRID_R = 910;
  var ROWS = 10;
  var GY = 142;
  var CELL_H = 37;
  var CARD_Y = 12;
  var CARD_H = 112;
  var CARD_W = 720;
  var CRANK = { x: 892, y: 556, r: 27 };

  function geom() {
    var t = TUNES[state.tune];
    var cellW = Math.min(46, (GRID_R - GUTTER) / t.steps);
    var gw = cellW * t.steps;
    return {
      cellW: cellW,
      gx: GUTTER + (GRID_R - GUTTER - gw) / 2,
      gy: GY,
      gw: gw,
      gh: CELL_H * ROWS,
    };
  }

  function colAt(x, g) {
    var c = Math.floor((x - g.gx) / g.cellW);
    return c >= 0 && c < TUNES[state.tune].steps ? c : -1;
  }
  function rowAt(y, g) {
    var r = ROWS - 1 - Math.floor((y - g.gy) / CELL_H);
    return r >= 0 && r < ROWS ? r : -1;
  }
  function colX(c, g) {
    return g.gx + (c + 0.5) * g.cellW;
  }
  function rowY(r, g) {
    return g.gy + (ROWS - 1 - r + 0.5) * CELL_H;
  }

  /* ---------------- state ---------------- */

  var state = null;
  var helpMode = false;

  function freshState() {
    return {
      phase: "title", // title | play | end
      tune: 0,
      score: 0,
      passed: 0,
      pins: {}, // "col:row" -> true
      cursor: { c: 0, r: 4 },
      mode: "edit", // edit | try | demo | sweep | judged
      winds: WINDS_PER_TUNE,
      timeLeft: 0,
      playCol: -1,
      playT: 0,
      crankA: 0,
      fx: [],
      sweepMarks: null,
      lastResult: null,
      paused: false,
      muted: false,
      shakeT: 0,
    };
  }

  function startTune(i) {
    var t = TUNES[i];
    state.tune = i;
    state.pins = {};
    state.cursor.c = 0;
    state.cursor.r = 4;
    state.mode = "edit";
    state.winds = WINDS_PER_TUNE;
    state.timeLeft = t.candle * 1000;
    state.playCol = -1;
    state.playT = 0;
    state.fx = [];
    state.sweepMarks = null;
    state.paused = false;
    buildCard();
    syncHud();
  }

  function newShift() {
    state = freshState();
    helpMode = false;
    startBtn.textContent = START_LABEL;
    state.phase = "play";
    startTune(0);
    hideVeil();
    pauseBtn.textContent = "pause";
  }

  /* ---------------- audio ---------------- */

  var actx = null;
  var master = null;

  function ensureAudio() {
    if (actx) {
      if (actx.state === "suspended") {
        actx.resume();
      }
      return actx;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      return null;
    }
    try {
      actx = new AC();
      master = actx.createGain();
      master.gain.value = 0.9;
      master.connect(actx.destination);
    } catch (e) {
      actx = null;
    }
    return actx;
  }

  function applyMute() {
    if (master) {
      master.gain.value = state.muted ? 0 : 0.9;
    }
    soundBtn.textContent = state.muted ? "sound: off" : "sound: on";
  }

  // A music-box pluck: triangle fundamental plus bright, slightly detuned
  // partials, decaying like a struck tine.
  function pluck(row, when, vol, tail) {
    var a = ensureAudio();
    if (!a || state.muted) {
      return;
    }
    var f = TINES[row].f;
    var t = Math.max(a.currentTime + 0.001, when);
    var parts = [
      { m: 1, g: 1, type: "triangle" },
      { m: 3.01, g: 0.22, type: "sine" },
      { m: 5.4, g: 0.07, type: "sine" },
    ];
    var env = a.createGain();
    var lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.min(12000, f * 8);
    lp.Q.value = 0.5;
    env.connect(lp);
    lp.connect(master);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + tail);
    for (var i = 0; i < parts.length; i++) {
      var o = a.createOscillator();
      o.type = parts[i].type;
      o.frequency.value = f * parts[i].m * (1 + rand(-0.0012, 0.0012));
      var og = a.createGain();
      og.gain.value = parts[i].g;
      o.connect(og);
      og.connect(env);
      o.start(t);
      o.stop(t + tail + 0.05);
    }
  }

  function blip(freq, vol, dur) {
    var a = ensureAudio();
    if (!a || state.muted) {
      return;
    }
    var t = a.currentTime + 0.001;
    var o = a.createOscillator();
    var g = a.createGain();
    o.type = "square";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  function thud(down) {
    var a = ensureAudio();
    if (!a || state.muted) {
      return;
    }
    var t = a.currentTime;
    var o = a.createOscillator();
    var g = a.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(down ? 130 : 170, t);
    o.frequency.exponentialRampToValueAtTime(down ? 62 : 96, t + 0.32);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.4);
  }

  function fanfare(good) {
    var rows = good ? [0, 2, 4, 5, 7, 9] : [4, 1, 0];
    for (var i = 0; i < rows.length; i++) {
      pluck(
        rows[i],
        actx ? actx.currentTime + 0.01 + i * (good ? 0.09 : 0.14) : 0,
        0.4,
        1.1,
      );
    }
  }

  function ratchet() {
    for (var i = 0; i < 7; i++) {
      var d = 0.04 * i * (1 - i * 0.04);
      setTimeout(function () {
        blip(340, 0.06, 0.03);
      }, d * 1000);
    }
  }

  /* ---------------- offscreen caches ---------------- */

  var wood = document.createElement("canvas");
  wood.width = W;
  wood.height = H;
  (function paintWood() {
    var c = wood.getContext("2d");
    var grad = c.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#38271b");
    grad.addColorStop(0.55, "#2c1e14");
    grad.addColorStop(1, "#201409");
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(12,6,3,0.28)";
    for (var i = 0; i < 42; i++) {
      c.lineWidth = rand(0.6, 2.2);
      c.beginPath();
      var y = rand(0, H);
      c.moveTo(-10, y);
      c.bezierCurveTo(
        W * 0.3,
        y + rand(-9, 9),
        W * 0.7,
        y + rand(-9, 9),
        W + 10,
        y + rand(-14, 14),
      );
      c.stroke();
    }
    var v = c.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.35,
      W / 2,
      H / 2,
      H * 0.95,
    );
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.5)");
    c.fillStyle = v;
    c.fillRect(0, 0, W, H);
    c.fillStyle = "#86652f";
    var screws = [
      [18, 18],
      [W - 18, 18],
      [18, H - 18],
      [W - 18, H - 18],
    ];
    screws.forEach(function (p) {
      c.beginPath();
      c.arc(p[0], p[1], 5, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "rgba(0,0,0,0.5)";
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(p[0] - 3, p[1]);
      c.lineTo(p[0] + 3, p[1]);
      c.stroke();
    });
  })();

  var cardCache = document.createElement("canvas");
  cardCache.width = CARD_W;
  cardCache.height = CARD_H;

  function buildCard() {
    var t = TUNES[state.tune];
    var c = cardCache.getContext("2d");
    cardCache.width = CARD_W; // clears
    var h = CARD_H;
    c.save();
    c.translate(CARD_W / 2, h / 2);
    c.rotate(-0.006);
    c.shadowColor = "rgba(0,0,0,0.45)";
    c.shadowBlur = 12;
    c.fillStyle = "#efe1bf";
    c.fillRect(-CARD_W / 2, -h / 2, CARD_W, h);
    c.shadowColor = "transparent";
    c.strokeStyle = "rgba(122,84,40,0.45)";
    c.lineWidth = 1;
    c.strokeRect(-CARD_W / 2 + 5, -h / 2 + 5, CARD_W - 10, h - 10);
    c.fillStyle = "#54381c";
    c.font = "italic 15px Georgia, serif";
    c.textAlign = "left";
    c.fillText(
      "the patron's card \u2014 '" + t.name + "' \u2014 " + t.steps + " beats",
      -CARD_W / 2 + 14,
      -h / 2 + 22,
    );
    c.textAlign = "right";
    c.fillStyle = "#7a4a12";
    c.fillText(
      "pass \u2265 " + Math.round(t.thr * 100) + "%",
      CARD_W / 2 - 14,
      -h / 2 + 22,
    );
    var chartX = -CARD_W / 2 + 14;
    var chartY = -h / 2 + 32;
    var cw = Math.min(21, (CARD_W - 28) / t.steps);
    var chh = Math.min(11, (h - 44) / ROWS);
    c.strokeStyle = "rgba(122,84,40,0.22)";
    c.lineWidth = 0.6;
    for (var s = 0; s < t.steps; s++) {
      for (var r = 0; r < ROWS; r++) {
        c.strokeRect(
          chartX + s * cw,
          chartY + (ROWS - 1 - r) * chh,
          cw - 1,
          chh - 1,
        );
      }
    }
    c.fillStyle = "#2f2317";
    t.notes.forEach(function (nt) {
      nt[1].forEach(function (row) {
        var x = chartX + nt[0] * cw + (cw - 1) / 2;
        var y = chartY + (ROWS - 1 - row) * chh + (chh - 1) / 2;
        c.beginPath();
        c.arc(x, y, Math.min(cw, chh) * 0.32, 0, Math.PI * 2);
        c.fill();
      });
    });
    c.restore();
  }

  /* ---------------- actions ---------------- */

  var START_LABEL = "trim the wick & begin";

  function key(c, r) {
    return c + ":" + r;
  }

  function addFx(type, x, y, color) {
    state.fx.push({
      type: type,
      x: x,
      y: y,
      t0: performance.now(),
      color: color,
    });
  }

  var flashText = "";
  var flashUntil = 0;

  function say(msg) {
    flashText = msg;
    flashUntil = performance.now() + 1800;
  }

  function togglePin(c, r) {
    if (state.mode !== "edit") {
      return;
    }
    var k = key(c, r);
    var g = geom();
    if (state.pins[k]) {
      delete state.pins[k];
      blip(210, 0.05, 0.04);
    } else {
      state.pins[k] = true;
      pluck(r, 0, 0.34, 0.55);
      addFx("ring", colX(c, g), rowY(r, g), "#ffd98a");
    }
  }

  function beginTry() {
    if (!playingEdit()) {
      return;
    }
    if (Object.keys(state.pins).length === 0) {
      say("Pin something on the barrel first.");
      return;
    }
    ensureAudio();
    state.mode = "try";
    state.playT = 0;
    state.playCol = -1;
  }

  function beginDemo() {
    if (!playingEdit()) {
      return;
    }
    if (state.winds <= 0) {
      say("Both winds are spent.");
      return;
    }
    state.winds--;
    ratchet();
    state.mode = "demo";
    state.playT = -650; // a beat of winding before the barrel turns
    state.playCol = -1;
    syncHud();
  }

  function playingEdit() {
    return state.phase === "play" && !state.paused && state.mode === "edit";
  }

  function targetMap() {
    var map = {};
    TUNES[state.tune].notes.forEach(function (nt) {
      nt[1].forEach(function (r) {
        map[key(nt[0], r)] = true;
      });
    });
    return map;
  }

  function evaluate() {
    var tgt = targetMap();
    var matched = 0;
    var mineCount = 0;
    var k;
    for (k in state.pins) {
      mineCount++;
      if (tgt[k]) {
        matched++;
      }
    }
    var targetCount = Object.keys(tgt).length;
    var extras = mineCount - matched;
    return {
      matched: matched,
      target: targetCount,
      extras: extras,
      acc: clamp((matched - 0.4 * extras) / targetCount, 0, 1),
      pass: false,
    };
  }

  function judge() {
    if (!playingEdit()) {
      return;
    }
    if (Object.keys(state.pins).length === 0) {
      say("Pin something on the barrel first.");
      return;
    }
    var tgt = targetMap();
    var res = evaluate();
    res.pass = res.acc >= TUNES[state.tune].thr;
    var marks = {};
    var k;
    for (k in tgt) {
      marks[k] = state.pins[k] ? "hit" : "miss";
    }
    for (k in state.pins) {
      if (!tgt[k]) {
        marks[k] = "extra";
      }
    }
    state.lastResult = res;
    state.sweepMarks = marks;
    state.mode = "sweep";
    state.playT = 0;
    state.playCol = -1;
    ensureAudio();
  }

  function finishJudge() {
    var res = state.lastResult;
    state.mode = "judged";
    if (res.pass) {
      var pts =
        Math.round(600 * res.acc) +
        Math.round((state.timeLeft / 1000) * 3) +
        (res.extras === 0 && res.matched === res.target ? 300 : 0);
      state.score += pts;
      state.passed++;
      thud(false);
      setTimeout(function () {
        fanfare(true);
      }, 120);
      showResult(true, pts);
    } else {
      thud(true);
      state.shakeT = 500;
      setTimeout(function () {
        fanfare(false);
      }, 200);
      showResult(false, 0);
    }
    syncHud();
  }

  function pct(v) {
    return Math.round(v * 100) + "%";
  }

  function showResult(pass, pts) {
    var t = TUNES[state.tune];
    var res = state.lastResult;
    if (pass) {
      resultTitle.textContent = "The patron nods \u2014 '" + t.name + "'";
      resultLede.textContent =
        "The little box sings it back true. He winds it twice more, then pays.";
      resultStats.innerHTML =
        "accuracy <b>" +
        pct(res.acc) +
        "</b> (needed " +
        pct(t.thr) +
        ")<br>matched <b>" +
        res.matched +
        "</b> of " +
        res.target +
        " pins, " +
        res.extras +
        " spare<br>candlelight bonus &middot; earned <b>+" +
        pts +
        "</b><br>shift score <b>" +
        state.score +
        "</b>";
      nextBtn.textContent =
        state.tune + 1 < TUNES.length
          ? "next tune \u2192"
          : "close the shop \u2192";
    } else {
      resultTitle.textContent = "The patron frowns \u2014 '" + t.name + "'";
      resultLede.textContent =
        state.timeLeft <= 0
          ? "Eight o'clock struck before the cylinder was ready. He takes his card and goes."
          : "Wrong notes where the card wants none. He sets down his hat and leaves.";
      resultStats.innerHTML =
        "accuracy <b>" +
        pct(res.acc) +
        "</b>, but the card asked for " +
        pct(t.thr) +
        "<br>matched " +
        res.matched +
        " of " +
        res.target +
        ", with " +
        res.extras +
        " spare pin" +
        (res.extras === 1 ? "" : "s") +
        "<br>shift score <b>" +
        state.score +
        "</b> over " +
        state.passed +
        " passed tune" +
        (state.passed === 1 ? "" : "s");
      nextBtn.textContent = "see the account \u2192";
    }
    showVeil("result");
  }

  function afterResult() {
    hideVeil();
    if (state.lastResult.pass) {
      if (state.tune + 1 < TUNES.length) {
        startTune(state.tune + 1);
      } else {
        showEnd(true);
      }
    } else {
      showEnd(false);
    }
  }

  function showEnd(win) {
    state.phase = "end";
    var t = TUNES[state.tune];
    if (win) {
      endTitle.textContent = "The workshop makes its name";
      endLede.textContent =
        "Six tunes, six nodding hearings. By morning there is a queue in the snow, and every box sings.";
    } else {
      endTitle.textContent = "The demonstration ends early";
      endLede.textContent =
        "'" +
        t.name +
        "' went badly, and word travels. The stove burns low tonight.";
    }
    endStats.innerHTML =
      "tunes passed <b>" +
      state.passed +
      " of " +
      TUNES.length +
      "</b><br>final score <b>" +
      state.score +
      "</b>";
    showVeil("end");
  }

  /* ---------------- hud & veil ---------------- */

  function syncHud() {
    var t = TUNES[state.tune];
    tuneChip.textContent =
      "tune " + (state.tune + 1) + " of " + TUNES.length + " \u2014 " + t.name;
    scoreChip.textContent = "score " + state.score;
    demoBtn.disabled = !(playingEdit() && state.winds > 0);
    presentBtn.disabled = !playingEdit();
    demoBtn.textContent = "\u266a wind demo (" + state.winds + ")";
  }

  function veilOpen() {
    return veil.style.display !== "none" && veil.style.display !== "";
  }

  function showVeil(which) {
    Object.keys(panels).forEach(function (k) {
      panels[k].classList.toggle("hidden", k !== which);
    });
    veil.style.display = "flex";
  }

  function hideVeil() {
    Object.keys(panels).forEach(function (k) {
      panels[k].classList.add("hidden");
    });
    veil.style.display = "none";
  }

  function setPaused(p) {
    if (state.phase !== "play" || p === state.paused) {
      return;
    }
    if (p) {
      if (veilOpen()) {
        return;
      }
      if (state.mode !== "edit") {
        state.mode = "edit"; // cancel any running barrel
        state.playCol = -1;
      }
      state.paused = true;
      showVeil("pause");
    } else {
      if (helpMode) {
        closeHelp();
        return;
      }
      var blocked =
        !panels.result.classList.contains("hidden") ||
        !panels.end.classList.contains("hidden");
      if (blocked) {
        return; // those panels have their own way forward
      }
      state.paused = false;
      hideVeil();
    }
    pauseBtn.textContent = state.paused ? "resume" : "pause";
    syncHud();
  }

  function openHelp() {
    if (state.phase !== "play" || veilOpen()) {
      return;
    }
    helpMode = true;
    if (!state.paused) {
      state.paused = true;
      pauseBtn.textContent = "resume";
      if (state.mode !== "edit") {
        state.mode = "edit";
      }
      syncHud();
    }
    startBtn.textContent = "back to work";
    showVeil("start");
  }

  function closeHelp() {
    helpMode = false;
    startBtn.textContent = START_LABEL;
    state.paused = false;
    pauseBtn.textContent = "pause";
    hideVeil();
    syncHud();
  }

  /* ---------------- input ---------------- */

  function canvasXY(ev) {
    var rect = cvs.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * W,
      y: ((ev.clientY - rect.top) / rect.height) * H,
    };
  }

  cvs.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    if (state.phase !== "play" || state.paused || veilOpen()) {
      return;
    }
    var p = canvasXY(ev);
    var g = geom();
    var c = colAt(p.x, g);
    var r = rowAt(p.y, g);
    if (c >= 0 && r >= 0) {
      state.cursor.c = c;
      state.cursor.r = r;
      togglePin(c, r);
      return;
    }
    var dx = p.x - CRANK.x;
    var dy = p.y - CRANK.y;
    if (dx * dx + dy * dy <= (CRANK.r + 10) * (CRANK.r + 10)) {
      beginTry();
    }
  });

  document.addEventListener("keydown", function (ev) {
    var k = ev.key;
    if (veilOpen()) {
      var pauseOpen = !panels.pause.classList.contains("hidden");
      if (k === "Enter") {
        ev.preventDefault();
        if (!panels.start.classList.contains("hidden")) {
          ensureAudio();
          if (state.phase === "title") {
            newShift();
          } else {
            closeHelp();
          }
        } else if (!panels.result.classList.contains("hidden")) {
          afterResult();
        } else if (!panels.end.classList.contains("hidden")) {
          newShift();
        } else if (pauseOpen) {
          setPaused(false);
        }
      } else if ((k === "p" || k === "P") && pauseOpen) {
        setPaused(false);
      }
      return;
    }

    if (
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === "ArrowUp" ||
      k === "ArrowDown" ||
      k === " "
    ) {
      ev.preventDefault();
    }
    if (k === "m" || k === "M") {
      state.muted = !state.muted;
      ensureAudio();
      applyMute();
      return;
    }
    if (k === "r" || k === "R") {
      newShift();
      return;
    }
    if (k === "?" || k === "h" || k === "H") {
      openHelp();
      return;
    }
    if (k === "p" || k === "P") {
      setPaused(!state.paused);
      return;
    }
    if (k === "ArrowLeft") {
      state.cursor.c = Math.max(0, state.cursor.c - 1);
    } else if (k === "ArrowRight") {
      state.cursor.c = Math.min(
        TUNES[state.tune].steps - 1,
        state.cursor.c + 1,
      );
    } else if (k === "ArrowUp") {
      state.cursor.r = Math.min(ROWS - 1, state.cursor.r + 1);
    } else if (k === "ArrowDown") {
      state.cursor.r = Math.max(0, state.cursor.r - 1);
    } else if (k === " ") {
      togglePin(state.cursor.c, state.cursor.r);
    } else if (k === "Enter") {
      ev.preventDefault(); // keep a focused button from firing too
      judge();
    } else if (k === "d" || k === "D") {
      beginDemo();
    } else if (k === "t" || k === "T") {
      beginTry();
    }
  });

  startBtn.addEventListener("click", function () {
    ensureAudio();
    if (state.phase === "title") {
      newShift();
    } else {
      closeHelp();
    }
  });
  nextBtn.addEventListener("click", afterResult);
  againBtn.addEventListener("click", newShift);
  resumeBtn.addEventListener("click", function () {
    setPaused(false);
  });
  demoBtn.addEventListener("click", beginDemo);
  presentBtn.addEventListener("click", judge);
  restartBtn.addEventListener("click", newShift);
  pauseBtn.addEventListener("click", function () {
    setPaused(!state.paused);
  });
  soundBtn.addEventListener("click", function () {
    state.muted = !state.muted;
    ensureAudio();
    applyMute();
  });
  helpBtn.addEventListener("click", openHelp);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      setPaused(true);
    }
  });

  /* ---------------- update ---------------- */

  function update(dt) {
    if (state.phase !== "play" || state.paused) {
      return;
    }
    var t = TUNES[state.tune];

    // The candle burns whenever you work.
    state.timeLeft -= dt;
    if (state.timeLeft <= 0 && state.mode === "edit") {
      state.timeLeft = 0;
      state.lastResult = evaluate();
      state.lastResult.pass = false;
      state.mode = "judged";
      thud(true);
      showResult(false, 0);
      syncHud();
      return;
    }

    if (
      state.mode === "try" ||
      state.mode === "demo" ||
      state.mode === "sweep"
    ) {
      var speed = state.mode === "sweep" ? 95 : t.tempo;
      if (state.mode === "demo" && state.playT < 0) {
        state.playT += dt;
        state.crankA -= dt * 0.02; // winding backwards
        if (state.playT >= 0) {
          state.playT = 0;
        }
        return;
      }
      var prev = state.playT;
      state.playT += dt;
      state.crankA += (dt / 1000) * Math.PI * 2;
      var prevCol = Math.floor(prev / speed);
      var curCol = Math.floor(state.playT / speed);
      if (curCol !== prevCol && curCol >= 0 && curCol < t.steps) {
        fireColumn(curCol);
      }
      if (state.playT >= t.steps * speed + 260) {
        if (state.mode === "sweep") {
          finishJudge();
        } else {
          state.mode = "edit";
          state.playCol = -1;
          syncHud();
        }
      }
    }
    if (flashText && performance.now() > flashUntil) {
      flashText = "";
    }
    if (state.shakeT > 0) {
      state.shakeT -= dt;
    }
  }

  function fireColumn(col) {
    state.playCol = col;
    var g = geom();
    if (state.mode === "demo") {
      TUNES[state.tune].notes.forEach(function (nt) {
        if (nt[0] === col) {
          nt[1].forEach(function (r) {
            pluck(r, 0, 0.4, 1.15);
            addFx("ring", colX(col, g), rowY(r, g), "#ffe9b3");
          });
        }
      });
      return;
    }
    var fired = false;
    for (var r = 0; r < ROWS; r++) {
      if (state.pins[key(col, r)]) {
        pluck(r, 0, 0.42, 1.05);
        addFx("ring", colX(col, g), rowY(r, g), "#ffd98a");
        fired = true;
      }
    }
    if (state.mode === "sweep" && state.sweepMarks) {
      for (var rr = 0; rr < ROWS; rr++) {
        var mk = state.sweepMarks[key(col, rr)];
        if (mk === "miss") {
          addFx("miss", colX(col, g), rowY(rr, g), "#d0553f");
        } else if (mk === "extra") {
          addFx("extra", colX(col, g), rowY(rr, g), "#d99a2b");
        }
      }
    }
    if (fired && state.mode === "try") {
      blip(1500, 0.015, 0.02);
    }
  }

  /* ---------------- drawing ---------------- */

  function draw(now) {
    var g = geom();
    var t = TUNES[state.tune];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (state.shakeT > 0) {
      var sh = (state.shakeT / 500) * 5;
      ctx.translate(rand(-sh, sh), rand(-sh, sh));
    }
    ctx.drawImage(wood, 0, 0);

    drawCard();
    drawCandle(now);
    drawGrid(g, t);
    drawPlayhead(g, t);
    drawFx(now);
    drawLabels(g);
    drawBottom();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawCard() {
    ctx.save();
    ctx.translate(W / 2, CARD_Y + CARD_H / 2);
    ctx.rotate(-0.006);
    ctx.drawImage(cardCache, -CARD_W / 2, -CARD_H / 2);
    ctx.restore();
  }

  function drawCandle(now) {
    var t = TUNES[state.tune];
    var frac = clamp(state.timeLeft / (t.candle * 1000), 0, 1);
    var cx = 928;
    var baseY = CARD_Y + 106;
    var stickH = 14 + 76 * frac;
    ctx.fillStyle = "#d8c49a";
    ctx.fillRect(cx - 6, baseY - stickH, 12, stickH);
    ctx.fillStyle = "#b7a077";
    ctx.fillRect(cx + 2, baseY - stickH, 4, stickH);
    ctx.fillStyle = "#8a6a2f";
    ctx.fillRect(cx - 13, baseY, 26, 6);
    ctx.fillRect(cx - 9, baseY + 6, 18, 5);
    var urgency = frac < 0.25 ? 1.7 : 1;
    var fl = 9 + Math.sin(now / 90) * 2.2 * urgency + rand(-1, 1) * urgency;
    var fy = baseY - stickH - fl * 0.6;
    var fg = ctx.createRadialGradient(cx, fy, 1, cx, fy, fl * 2.1);
    fg.addColorStop(0, "rgba(255,236,170,0.95)");
    fg.addColorStop(0.4, "rgba(255,176,64,0.55)");
    fg.addColorStop(1, "rgba(255,120,30,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(cx, fy, fl * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffdf9a";
    ctx.beginPath();
    ctx.ellipse(
      cx,
      baseY - stickH - fl * 0.55,
      3.2,
      fl * 0.75,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  function drawGrid(g, t) {
    var bg = ctx.createLinearGradient(0, g.gy, 0, g.gy + g.gh);
    bg.addColorStop(0, "#6d5124");
    bg.addColorStop(0.5, "#57401d");
    bg.addColorStop(1, "#453216");
    ctx.fillStyle = bg;
    roundRect(g.gx - 10, g.gy - 10, g.gw + 20, g.gh + 20, 14);
    ctx.fill();
    ctx.strokeStyle = "#8a6a2f";
    ctx.lineWidth = 2;
    roundRect(g.gx - 10, g.gy - 10, g.gw + 20, g.gh + 20, 14);
    ctx.stroke();

    if (state.mode !== "edit") {
      var sheen = ((performance.now() / 6) % (g.gw + 300)) - 150;
      var sg = ctx.createLinearGradient(sheen - 60, 0, sheen + 60, 0);
      sg.addColorStop(0, "rgba(255,230,160,0)");
      sg.addColorStop(0.5, "rgba(255,230,160,0.09)");
      sg.addColorStop(1, "rgba(255,230,160,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(g.gx - 10, g.gy - 10, g.gw + 20, g.gh + 20);
    }

    var holeR = Math.min(9, g.cellW * 0.22);
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < t.steps; c++) {
        var hx = colX(c, g);
        var hy = rowY(r, g);
        ctx.fillStyle = "rgba(24,14,6,0.82)";
        ctx.beginPath();
        ctx.arc(hx, hy, holeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,220,150,0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(hx, hy, holeR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    var nowMs = performance.now();
    for (var k in state.pins) {
      var pr = k.split(":");
      var pc = +pr[0];
      var prow = +pr[1];
      var px = colX(pc, g);
      var py = rowY(prow, g);
      var mark = state.sweepMarks ? state.sweepMarks[k] : null;
      var rad = Math.min(10.5, g.cellW * 0.26);
      var pg = ctx.createRadialGradient(
        px - rad * 0.4,
        py - rad * 0.5,
        1,
        px,
        py,
        rad,
      );
      pg.addColorStop(0, "#ffe9ae");
      pg.addColorStop(1, "#b8862e");
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(50,30,8,0.7)";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (mark === "hit") {
        ring(px, py, rad + 3 + Math.sin(nowMs / 150) * 1.5, "#9fd06a", 2.4);
      } else if (mark === "extra") {
        cross(px, py, rad + 2, "#e0a83a");
      }
    }

    if (state.phase === "play" && state.mode === "edit" && !state.paused) {
      var cxp = colX(state.cursor.c, g);
      var cyp = rowY(state.cursor.r, g);
      var pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      ctx.strokeStyle = "rgba(255,235,180," + (0.45 + pulse * 0.5) + ")";
      ctx.lineWidth = 2;
      roundRect(
        cxp - g.cellW / 2 + 3,
        cyp - CELL_H / 2 + 4,
        g.cellW - 6,
        CELL_H - 8,
        8,
      );
      ctx.stroke();
    }
  }

  function drawPlayhead(g, t) {
    if (state.mode === "edit" || state.mode === "judged") {
      return;
    }
    var speed = state.mode === "sweep" ? 95 : t.tempo;
    var pos = state.playT / speed;
    if (pos < -0.02 || pos > t.steps + 0.4) {
      return;
    }
    var x = g.gx + clamp(pos, 0, t.steps) * g.cellW;
    ctx.strokeStyle =
      state.mode === "demo" ? "rgba(255,225,150,0.9)" : "rgba(190,235,150,0.9)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, g.gy - 14);
    ctx.lineTo(x, g.gy + g.gh + 14);
    ctx.stroke();
    var nxt = Math.ceil(pos);
    if (nxt > pos && nxt < t.steps) {
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(colX(nxt, g), g.gy - 6);
      ctx.lineTo(colX(nxt, g), g.gy + g.gh + 6);
      ctx.stroke();
    }
  }

  function drawFx(now) {
    state.fx = state.fx.filter(function (f) {
      var age = now - f.t0;
      var life = f.type === "miss" || f.type === "extra" ? 1400 : 520;
      if (age > life) {
        return false;
      }
      var k = age / life;
      if (f.type === "ring") {
        ring(f.x, f.y, 6 + k * 26, f.color, 2.4 * (1 - k));
      } else if (f.type === "miss") {
        ctx.globalAlpha = Math.min(1, k * 3) * (1 - k * 0.4);
        ghost(f.x, f.y, "#c8503a");
        ctx.globalAlpha = 1;
      } else if (f.type === "extra") {
        if (k < 0.4) {
          cross(f.x, f.y - 14, 6, f.color);
        }
      }
      return true;
    });
  }

  function ghost(x, y, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function ring(x, y, rad, color, lw) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw || 2;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.stroke();
  }

  function cross(x, y, s, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s);
    ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s);
    ctx.lineTo(x - s, y + s);
    ctx.stroke();
  }

  function drawLabels(g) {
    ctx.font = "italic 12px Georgia, serif";
    ctx.textAlign = "right";
    var nowMs = performance.now();
    for (var r = 0; r < ROWS; r++) {
      var y = rowY(r, g);
      var hot = false;
      for (var i = 0; i < state.fx.length; i++) {
        var f = state.fx[i];
        if (
          f.type === "ring" &&
          Math.abs(f.y - y) < CELL_H / 2 &&
          nowMs - f.t0 < 300
        ) {
          hot = true;
          break;
        }
      }
      ctx.fillStyle = hot ? "#e8c06a" : "#7a5a28";
      ctx.fillRect(GUTTER - 26, y - 2, 20, 4);
      ctx.fillStyle = hot ? "#ffe9ae" : "#b98f4b";
      ctx.fillText(TINES[r].n, GUTTER - 32, y + 4);
    }
    ctx.fillStyle = "rgba(138,106,47,0.5)";
    ctx.fillRect(GUTTER - 30, g.gy - 10, 6, g.gh + 20);
    ctx.textAlign = "left";
  }

  function drawBottom() {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 528, W, 3);

    ctx.font = "italic 15px Georgia, serif";
    ctx.textAlign = "left";
    var msg = flashText;
    if (!msg) {
      if (state.mode === "edit") {
        msg = "Set pins to match the card \u2014 tap holes, or arrows + space.";
      } else if (state.mode === "try") {
        msg = "Your barrel is playing\u2026 listen close.";
      } else if (state.mode === "demo") {
        msg = "The patron's original, straight off his own cylinder\u2026";
      } else if (state.mode === "sweep") {
        msg = "Judging the work \u2014 gold holds, red ghosts want pins\u2026";
      } else {
        msg = "";
      }
    }
    ctx.fillStyle = flashText ? "#ffdf9a" : "#d9c393";
    ctx.fillText(msg, 24, 562);

    var secs = Math.max(0, Math.ceil(state.timeLeft / 1000));
    ctx.font = "13px Georgia, serif";
    ctx.fillStyle = secs <= 15 ? "#ff9d7a" : "#b98f4b";
    ctx.textAlign = "center";
    ctx.fillText(
      "candle " +
        Math.floor(secs / 60) +
        ":" +
        String(secs % 60).padStart(2, "0"),
      928,
      585,
    );

    // crank
    ctx.save();
    ctx.translate(CRANK.x, CRANK.y);
    ctx.fillStyle = "#3a2917";
    ctx.beginPath();
    ctx.arc(0, 0, CRANK.r + 6, 0, Math.PI * 2);
    ctx.fill();
    var cg = ctx.createRadialGradient(-6, -8, 2, 0, 0, CRANK.r);
    cg.addColorStop(0, "#e8c06a");
    cg.addColorStop(1, "#7a5a28");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(0, 0, CRANK.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#4a3010";
    ctx.lineWidth = 2;
    ctx.stroke();
    var a = state.crankA;
    ctx.strokeStyle = "#f0dfae";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * (CRANK.r - 6), Math.sin(a) * (CRANK.r - 6));
    ctx.stroke();
    ctx.fillStyle = "#ffe9ae";
    ctx.beginPath();
    ctx.arc(
      Math.cos(a) * (CRANK.r - 6),
      Math.sin(a) * (CRANK.r - 6),
      5.5,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();

    ctx.font = "italic 12px Georgia, serif";
    ctx.fillStyle = "#b98f4b";
    ctx.textAlign = "center";
    ctx.fillText(
      playingEdit() ? "tap to try your barrel (T)" : "the crank rests",
      CRANK.x,
      CRANK.y + CRANK.r + 22,
    );

    // winds gauge beside the crank
    for (var i = 0; i < WINDS_PER_TUNE; i++) {
      var wx = CRANK.x - 96 - i * 28;
      var wy = CRANK.y;
      ctx.strokeStyle = i < state.winds ? "#e8c06a" : "rgba(200,170,110,0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(wx, wy, 9, -Math.PI * 0.5, Math.PI * 1.25);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + 7, wy - 7);
      ctx.stroke();
    }
    ctx.fillText("winds", CRANK.x - 110, CRANK.y + CRANK.r + 22);
    ctx.textAlign = "left";
  }

  function roundRect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  /* ---------------- main loop ---------------- */

  var lastFrame = performance.now();

  function frame(now) {
    var dt = Math.min(50, now - lastFrame);
    lastFrame = now;
    update(dt);
    draw(now);
    requestAnimationFrame(frame);
  }

  /* ---------------- boot ---------------- */

  state = freshState();
  buildCard();
  syncHud();
  showVeil("start");
  requestAnimationFrame(frame);
})();
