/* Floodline — outrun the rising flood up a slot canyon.
   Vanilla JS, no dependencies. Wrapped in an IIFE; nothing leaks global. */
(function () {
  "use strict";

  /* ---------- constants ---------- */

  var T = 32; // tile size, world px
  var VIEW_W = 480;
  var VIEW_H = 640;
  var COLS = 15;

  var GRAVITY = 1250;
  var JUMP_V = -438;
  var RUN_ACCEL = 1500;
  var RUN_MAX = 178;
  var FRICTION = 1800;
  var AIR_DRAG = 260;
  var COYOTE = 0.09;
  var BUFFER = 0.12;
  var CRUMBLE_SHAKE = 0.5;

  var FLOOD_DELAY = 2.6;
  var SURGE_DUR = 2.3;
  var SURGE_MULT = 1.8;
  var WARN_LEAD = 1.15;

  var LEVELS = [
    {
      name: "Wash Arroyo",
      rows: [
        "#.............#",
        "#....EEEEE....#",
        "#....EEEEE....#",
        "#...########..#",
        "####..........#",
        "#....*........#",
        "#.....###.....#",
        "#.............#",
        "#..%%%........#",
        "#.......*.....#",
        "#......###....#",
        "#.............#",
        "#...###.......#",
        "#........*....#",
        "#.......%%%...#",
        "#.............#",
        "#....###......#",
        "#.............#",
        "#.###.........#",
        "#.....*.......#",
        "#....%%%......#",
        "#.............#",
        "#........###..#",
        "#.............#",
        "#.....###.....#",
        "#.............#",
        "#..%%%........#",
        "#.......*.....#",
        "#......###....#",
        "#....*........#",
        "#...###.......#",
        "#.............#",
        "#.......%%%...#",
        "#......S......#",
        "###############",
        "###############",
      ],
    },
    {
      name: "Hollow Narrows",
      rows: [
        "#.............#",
        "#....EEEEE....#",
        "#....EEEEE....#",
        "#...########..#",
        "####..........#",
        "#.............#",
        "#...###.......#",
        "#.............#",
        "#....%%%......#",
        "#.....*.......#",
        "#........###..#",
        "#.............#",
        "#.....%%%.....#",
        "#..*..........#",
        "#.###.........#",
        "#.............#",
        "#.....###.....#",
        "#.............#",
        "#..%%%........#",
        "#.............#",
        "#......###....#",
        "#.......*.....#",
        "#..........%%%#",
        "#.............#",
        "#.......%%%...#",
        "#........*....#",
        "#...###.......#",
        "#.............#",
        "####..........#",
        "#.....*.......#",
        "#....%%%......#",
        "#.............#",
        "#........###..#",
        "#.........*...#",
        "#.....%%%.....#",
        "#.............#",
        "#..###........#",
        "#...*.........#",
        "#......%%%....#",
        "#......S......#",
        "###############",
        "###############",
      ],
    },
    {
      name: "Chimney Rim",
      rows: [
        "#.............#",
        "#....EEEEE....#",
        "#....EEEEE....#",
        "#...########..#",
        "####..........#",
        "#.............#",
        "#...%%%.......#",
        "#.............#",
        "#.......###...#",
        "#........*....#",
        "#....%%%......#",
        "#.............#",
        "####..........#",
        "#.............#",
        "#....###......#",
        "#.............#",
        "#........%%%..#",
        "#.........*...#",
        "#.....###.....#",
        "#.............#",
        "#.%%%.........#",
        "#..*..........#",
        "#.....%%%.....#",
        "#.............#",
        "#..###........#",
        "#.............#",
        "#......%%%....#",
        "#.......*.....#",
        "#..........####",
        "#.............#",
        "#.......###...#",
        "#........*....#",
        "#...%%%.......#",
        "#.............#",
        "####..........#",
        "#.....*.......#",
        "#....%%%......#",
        "#.............#",
        "#........%%%..#",
        "#.........*...#",
        "#....###......#",
        "#.............#",
        "#.###.........#",
        "#..*..........#",
        "#.....%%%.....#",
        "#......S......#",
        "###############",
        "###############",
      ],
    },
  ];

  var FLOOD_CFG = [
    { rate: 24, surges: [] },
    { rate: 29, surges: [18] },
    { rate: 33, surges: [16, 34] },
  ];

  var ROMAN = ["I", "II", "III"];
  var TOTAL_SHARDS = LEVELS.reduce(function (n, lv, i) {
    return n + lv.rows.join("").split("*").length - 1;
  }, 0);

  /* ---------- dom ---------- */

  function $(id) {
    return document.getElementById(id);
  }

  var canvas = $("game");
  var ctx = canvas.getContext("2d");
  var hudLevel = $("hud-level");
  var hudShards = $("hud-shards");
  var hudTime = $("hud-time");
  var stormNote = $("storm-note");
  var gaugeYou = $("gauge-you");
  var gaugeFlood = $("gauge-flood");
  var badgePause = $("badge-pause");
  var veil = $("veil");
  var panels = {
    title: $("panel-title"),
    clear: $("panel-clear"),
    over: $("panel-over"),
    win: $("panel-win"),
  };

  /* ---------- audio ---------- */

  var audioCtx = null;
  var masterGain = null;
  var muted = false;
  try {
    muted = localStorage.getItem("floodline-mute") === "1";
  } catch (e) {
    muted = false;
  }

  function ensureAudio() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = muted ? 0 : 0.45;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function tone(type, f0, f1, dur, vol, delay) {
    var ac = ensureAudio();
    if (!ac) return;
    var t0 = ac.currentTime + (delay || 0);
    var osc = ac.createOscillator();
    var g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  var sfx = {
    jump: function () {
      tone("square", 200, 330, 0.13, 0.16);
    },
    land: function () {
      tone("triangle", 130, 55, 0.08, 0.14);
    },
    shard: function () {
      tone("sine", 920, 1420, 0.16, 0.18);
      tone("sine", 1380, 1860, 0.2, 0.1, 0.07);
    },
    crumble: function () {
      tone("sawtooth", 95, 45, 0.28, 0.17);
    },
    warn: function () {
      tone("sine", 60, 52, 0.85, 0.22);
    },
    surge: function () {
      tone("square", 44, 38, 0.55, 0.16);
    },
    splash: function () {
      tone("sawtooth", 320, 42, 0.5, 0.3);
      tone("square", 1900, 240, 0.32, 0.09);
    },
    clear: function () {
      tone("sine", 523, 523, 0.14, 0.16);
      tone("sine", 659, 659, 0.14, 0.16, 0.09);
      tone("sine", 784, 784, 0.22, 0.18, 0.18);
    },
    win: function () {
      var seq = [392, 523, 659, 784, 1046];
      for (var i = 0; i < seq.length; i++) {
        tone("sine", seq[i], seq[i], 0.2, 0.16, i * 0.11);
      }
    },
    over: function () {
      tone("sawtooth", 220, 108, 0.55, 0.18);
      tone("sawtooth", 164, 80, 0.75, 0.14, 0.18);
    },
  };

  function setMuted(m) {
    muted = m;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.45;
    try {
      localStorage.setItem("floodline-mute", muted ? "1" : "0");
    } catch (e) {
      /* private mode */
    }
    $("btn-sound").style.opacity = muted ? "0.45" : "1";
  }

  /* ---------- state ---------- */

  var state = "title"; // title | play | clear | over | win
  var paused = false;
  var levelIdx = 0;
  var grid = [];
  var levelH = 0; // px
  var levelRows = 0;
  var exitRects = [];
  var shardList = []; // {r,c,x,y,taken}
  var crumbles = {}; // idx -> {ph:'idle'|'shake'|'gone', t}
  var spawnCell = null;

  var player = null;
  var floodY = 0;
  var camY = 0;
  var shake = 0;
  var levelTime = 0;
  var stormClock = 0; // whole-run timer, keeps running across retries
  var totalShardsGot = 0;
  var levelShardsGot = 0;

  var particles = [];
  var trail = [];
  var waterSeed = Math.random() * 100;

  function makePlayer(cellR, cellC) {
    return {
      x: cellC * T + T / 2,
      y: (cellR + 1) * T, // feet position
      vx: 0,
      vy: 0,
      w: 18,
      h: 40,
      dir: 1,
      grounded: false,
      coyote: 0,
      buffer: 0,
      squash: 1,
      runPhase: 0,
      dead: false,
    };
  }

  function parseLevel(i) {
    var lv = LEVELS[i];
    grid = lv.rows.slice();
    levelRows = grid.length;
    levelH = levelRows * T;
    exitRects = [];
    shardList = [];
    crumbles = {};
    spawnCell = null;
    for (var r = 0; r < levelRows; r++) {
      for (var c = 0; c < COLS; c++) {
        var ch = grid[r].charAt(c);
        if (ch === "S") spawnCell = { r: r, c: c };
        if (ch === "E") exitRects.push({ x: c * T, y: r * T, w: T, h: T });
        if (ch === "*")
          shardList.push({
            r: r,
            c: c,
            x: c * T + T / 2,
            y: r * T + T / 2,
            taken: false,
          });
        if (ch === "%") crumbles[r * COLS + c] = { ph: "idle", t: 0 };
      }
    }
  }

  function startLevel(i) {
    levelIdx = i;
    parseLevel(i);
    particles = [];
    trail = [];
    player = makePlayer(spawnCell.r, spawnCell.c);
    floodY = levelH + T * 1.2;
    camY = Math.max(0, levelH - VIEW_H);
    shake = 0;
    levelTime = 0;
    levelShardsGot = 0;
    state = "play";
    paused = false;
    showPanel(null);
    badgePause.hidden = true;
    hudLevel.innerHTML = ROMAN[i] + " &middot; " + LEVELS[i].name;
    updateShardHud();
    stormNote.textContent = "storm building upstream";
    stormNote.style.color = "";
  }

  function resetRun() {
    stormClock = 0;
    totalShardsGot = 0;
    startLevel(0);
  }

  /* ---------- helpers ---------- */

  function crumbleState(c, r) {
    var st = crumbles[r * COLS + c];
    return st ? st.ph : "idle";
  }

  function solid(c, r) {
    if (c < 0 || c >= COLS) return true; // canyon walls beyond the map
    if (r < 0 || r >= levelRows) return false;
    var ch = grid[r].charAt(c);
    if (ch === "#") return true;
    if (ch === "%") return crumbleState(c, r) !== "gone";
    return false;
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function fmtTime(t) {
    var m = Math.floor(t / 60);
    var s = t - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
  }

  function showPanel(name) {
    veil.classList.toggle("show", !!name);
    for (var k in panels) panels[k].hidden = k !== name;
  }

  function burst(x, y, n, colors, speed, life, grav) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = speed * (0.35 + Math.random() * 0.65);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - speed * 0.4,
        life: life * (0.6 + Math.random() * 0.6),
        age: 0,
        size: 1.5 + Math.random() * 2.5,
        color: colors[(Math.random() * colors.length) | 0],
        grav: grav,
      });
    }
  }

  /* ---------- input ---------- */

  var keys = { left: false, right: false, jump: false };

  function pressJump() {
    keys.jump = true;
    if (player) player.buffer = BUFFER;
    ensureAudio();
  }

  window.addEventListener("keydown", function (e) {
    var code = e.code;
    if (
      code === "ArrowLeft" ||
      code === "ArrowRight" ||
      code === "ArrowUp" ||
      code === "ArrowDown" ||
      code === "Space"
    ) {
      e.preventDefault();
    }
    if (e.repeat) return;
    if (code === "ArrowLeft" || code === "KeyA") keys.left = true;
    else if (code === "ArrowRight" || code === "KeyD") keys.right = true;
    else if (
      code === "ArrowUp" ||
      code === "KeyW" ||
      code === "Space" ||
      code === "KeyZ"
    ) {
      pressJump();
    } else if (code === "KeyP") togglePause();
    else if (code === "KeyM") setMuted(!muted);
    else if (code === "KeyR") {
      if (state === "play" || state === "over" || state === "clear")
        startLevel(levelIdx);
    } else if (code === "Enter" && state === "title") beginFromTitle();
  });

  window.addEventListener("keyup", function (e) {
    var code = e.code;
    if (code === "ArrowLeft" || code === "KeyA") keys.left = false;
    else if (code === "ArrowRight" || code === "KeyD") keys.right = false;
    else if (
      code === "ArrowUp" ||
      code === "KeyW" ||
      code === "Space" ||
      code === "KeyZ"
    ) {
      keys.jump = false;
    }
  });

  function bindPad(id, down, up) {
    var el = $(id);
    el.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      el.classList.add("pressed");
      down();
    });
    function release(e) {
      el.classList.remove("pressed");
      if (up) up();
    }
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("pointerleave", release);
  }

  bindPad(
    "key-left",
    function () {
      keys.left = true;
    },
    function () {
      keys.left = false;
    },
  );
  bindPad(
    "key-right",
    function () {
      keys.right = true;
    },
    function () {
      keys.right = false;
    },
  );
  bindPad("key-jump", pressJump, function () {
    keys.jump = false;
  });

  /* ---------- buttons ---------- */

  function beginFromTitle() {
    ensureAudio();
    resetRun();
  }

  $("btn-start").addEventListener("click", beginFromTitle);
  $("btn-next").addEventListener("click", function () {
    startLevel(levelIdx + 1);
  });
  $("btn-retry").addEventListener("click", function () {
    startLevel(levelIdx);
  });
  $("btn-again").addEventListener("click", resetRun);
  $("btn-sound").addEventListener("click", function () {
    setMuted(!muted);
  });
  $("btn-restart").addEventListener("click", function () {
    if (state !== "title") startLevel(levelIdx);
  });
  $("btn-pause").addEventListener("click", togglePause);

  function togglePause() {
    if (state !== "play") return;
    paused = !paused;
    badgePause.hidden = !paused;
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state === "play" && !paused) togglePause();
  });

  setMuted(muted);

  /* ---------- simulation ---------- */

  function updatePlayer(dt) {
    var p = player;

    // horizontal
    var want = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (want !== 0) {
      p.vx += want * RUN_ACCEL * dt;
      p.vx = clamp(p.vx, -RUN_MAX, RUN_MAX);
      p.dir = want;
    } else {
      var drag = (p.grounded ? FRICTION : AIR_DRAG) * dt;
      if (Math.abs(p.vx) <= drag) p.vx = 0;
      else p.vx -= Math.sign(p.vx) * drag;
    }

    // jump timing
    p.buffer -= dt;
    p.coyote -= dt;
    if (p.buffer > 0 && (p.grounded || p.coyote > 0)) {
      p.vy = JUMP_V;
      p.grounded = false;
      p.coyote = 0;
      p.buffer = 0;
      p.squash = 1.25;
      sfx.jump();
      burst(p.x, p.y, 4, ["#c99b6d", "#a97c50"], 40, 0.35, 300);
    }

    // variable gravity: releasing early cuts the jump
    var g = GRAVITY;
    if (p.vy < 0 && !keys.jump) g *= 1.9;
    p.vy += g * dt;
    p.vy = clamp(p.vy, -900, 900);

    // --- horizontal sweep ---
    p.x += p.vx * dt;
    var half = p.w / 2;
    var top = p.y - p.h + 2;
    var bot = p.y - 2;
    if (p.vx > 0) {
      var cR = Math.floor((p.x + half) / T);
      for (var rr = Math.floor(top / T); rr <= Math.floor(bot / T); rr++) {
        if (solid(cR, rr)) {
          p.x = cR * T - half - 0.01;
          p.vx = 0;
          break;
        }
      }
    } else if (p.vx < 0) {
      var cL = Math.floor((p.x - half) / T);
      for (var rl = Math.floor(top / T); rl <= Math.floor(bot / T); rl++) {
        if (solid(cL, rl)) {
          p.x = (cL + 1) * T + half + 0.01;
          p.vx = 0;
          break;
        }
      }
    }
    p.x = clamp(p.x, half + 1, VIEW_W - half - 1);

    // --- vertical sweep ---
    var prevGrounded = p.grounded;
    p.y += p.vy * dt;
    p.grounded = false;
    var cs0 = Math.floor((p.x - half + 2) / T);
    var cs1 = Math.floor((p.x + half - 2) / T);
    if (p.vy >= 0) {
      var footRow = Math.floor(p.y / T);
      for (var cf = cs0; cf <= cs1; cf++) {
        if (solid(cf, footRow)) {
          p.y = footRow * T;
          if (!prevGrounded && p.vy > 240) {
            sfx.land();
            p.squash = 0.72;
            burst(p.x, p.y, 5, ["#c99b6d", "#8a5f3c"], 36, 0.3, 380);
          }
          p.vy = 0;
          p.grounded = true;
          triggerCrumbles(cs0, cs1, footRow);
          break;
        }
      }
    } else {
      var headRow = Math.floor((p.y - p.h) / T);
      for (var ch = cs0; ch <= cs1; ch++) {
        if (solid(ch, headRow)) {
          p.y = (headRow + 1) * T + p.h;
          p.vy = 0;
          break;
        }
      }
    }
    if (p.grounded) {
      p.coyote = COYOTE;
      // standing on a shaking ledge keeps it trembling
      triggerCrumbles(cs0, cs1, Math.floor((p.y + 2) / T));
    }

    p.squash += (1 - p.squash) * Math.min(1, dt * 10);
    if (Math.abs(p.vx) > 20 && p.grounded) {
      p.runPhase += Math.abs(p.vx) * dt * 0.09;
    }

    // scarf trail
    trail.unshift({ x: p.x - p.dir * 6, y: p.y - p.h * 0.72 });
    if (trail.length > 10) trail.pop();
  }

  function triggerCrumbles(c0, c1, row) {
    for (var c = c0; c <= c1; c++) {
      var st = crumbles[row * COLS + c];
      if (st && st.ph === "idle") {
        st.ph = "shake";
        st.t = CRUMBLE_SHAKE;
      }
    }
  }

  function updateCrumbles(dt) {
    for (var key in crumbles) {
      var st = crumbles[key];
      if (st.ph !== "shake") continue;
      st.t -= dt;
      if (st.t <= 0) {
        st.ph = "gone";
        var idx = +key;
        var r = Math.floor(idx / COLS);
        var c = idx % COLS;
        sfx.crumble();
        burst(
          c * T + T / 2,
          r * T + T / 2,
          9,
          ["#a05a32", "#7c3d20", "#c98a54"],
          70,
          0.55,
          420,
        );
      }
    }
  }

  function updateShards() {
    var p = player;
    for (var i = 0; i < shardList.length; i++) {
      var s = shardList[i];
      if (s.taken) continue;
      var dx = p.x - s.x;
      var dy = p.y - p.h / 2 - s.y;
      if (dx * dx + dy * dy < 26 * 26) {
        s.taken = true;
        levelShardsGot++;
        sfx.shard();
        burst(s.x, s.y, 10, ["#ffd479", "#fff3cf", "#e8a05c"], 90, 0.5, 60);
        updateShardHud();
      }
    }
  }

  function updateShardHud() {
    var got = totalShardsGot + levelShardsGot;
    hudShards.innerHTML = "&#10022; " + got + "/" + TOTAL_SHARDS;
  }

  function floodSurge() {
    var cfg = FLOOD_CFG[levelIdx];
    var t = levelTime - FLOOD_DELAY;
    for (var i = 0; i < cfg.surges.length; i++) {
      var s0 = cfg.surges[i];
      if (t >= s0 - WARN_LEAD && t < s0) return "warn";
      if (t >= s0 && t < s0 + SURGE_DUR) return "surge";
    }
    return "none";
  }

  function updateFlood(dt) {
    if (levelTime < FLOOD_DELAY) return;
    var cfg = FLOOD_CFG[levelIdx];
    var ph = floodSurge();
    var mult = ph === "surge" ? SURGE_MULT : 1;
    floodY -= cfg.rate * mult * dt;
    if (ph === "surge") {
      shake = Math.max(shake, 3.2);
      if (Math.random() < dt * 22) {
        particles.push({
          x: Math.random() * VIEW_W,
          y: floodY + 4,
          vx: (Math.random() - 0.5) * 30,
          vy: -60 - Math.random() * 70,
          life: 0.5,
          age: 0,
          size: 2,
          color: "#9fdbe0",
          grav: 500,
        });
      }
    }
    var capY = 3 * T + 2; // laps at the lip of the rim, never drowns it
    if (floodY < capY) floodY = capY;
  }

  function checkDeathAndExit() {
    var p = player;
    // drowned?
    if (p.y - p.h > floodY + 6) {
      die();
      return;
    }
    // reached the rim?
    for (var i = 0; i < exitRects.length; i++) {
      var e = exitRects[i];
      if (
        p.x + p.w / 2 > e.x &&
        p.x - p.w / 2 < e.x + e.w &&
        p.y > e.y &&
        p.y - p.h < e.y + e.h
      ) {
        clearLevel();
        return;
      }
    }
  }

  function die() {
    if (state !== "play") return;
    state = "over";
    sfx.splash();
    sfx.over();
    var p = player;
    burst(p.x, floodY, 26, ["#9fdbe0", "#5db4bb", "#e8f6f2"], 170, 0.8, 520);
    showPanel("over");
    $("over-stats").innerHTML =
      ROMAN[levelIdx] +
      " &middot; " +
      LEVELS[levelIdx].name +
      "<br>" +
      fmtTime(stormClock) +
      " into the storm &middot; &#10022; " +
      (totalShardsGot + levelShardsGot) +
      " shards carried";
    stormNote.textContent = "the narrows close over";
    stormNote.style.color = "#7fd8de";
  }

  function clearLevel() {
    state = "clear";
    sfx.clear();
    totalShardsGot += levelShardsGot;
    levelShardsGot = 0;
    var last = levelIdx === LEVELS.length - 1;
    if (last) {
      state = "win";
      sfx.win();
      var best = null;
      try {
        best = JSON.parse(localStorage.getItem("floodline-best") || "null");
      } catch (e) {
        best = null;
      }
      if (!best || stormClock < best.t) {
        best = { t: stormClock, s: totalShardsGot };
        try {
          localStorage.setItem("floodline-best", JSON.stringify(best));
        } catch (e) {
          /* private mode */
        }
        $("win-best").textContent =
          "A record run, cut into the canyon wall: " + fmtTime(best.t);
      } else {
        $("win-best").textContent =
          "Best descent of this storm: " +
          fmtTime(best.t) +
          " &middot; &#10022; " +
          best.s;
      }
      $("win-stats").innerHTML =
        "&#10022; " +
        totalShardsGot +
        " / " +
        TOTAL_SHARDS +
        " sun shards<br>storm outrun in " +
        fmtTime(stormClock);
      showPanel("win");
      stormNote.textContent = "sun-warmed stone at last";
      stormNote.style.color = "#ffd479";
    } else {
      $("clear-title").textContent = "Rim of the " + LEVELS[levelIdx].name;
      $("clear-stats").innerHTML =
        "&#10022; " +
        levelShardsGotNow() +
        "<br>wall climbed in " +
        fmtTime(levelTime) +
        " &middot; storm clock " +
        fmtTime(stormClock);
      $("clear-note").textContent =
        "Below, the next narrows already echo with the flood.";
      showPanel("clear");
      stormNote.textContent = "higher ground — briefly";
    }
  }

  function levelShardsGotNow() {
    // shards gathered on the wall just cleared were already banked
    return (
      "&#10022; " + totalShardsGot + " / " + TOTAL_SHARDS + " shards so far"
    );
  }

  /* ---------- rendering ---------- */

  var bgPattern = null;

  function buildBg() {
    bgPattern = document.createElement("canvas");
    bgPattern.width = VIEW_W;
    bgPattern.height = VIEW_H;
    var b = bgPattern.getContext("2d");
    b.fillStyle = "rgba(58,26,13,0.5)";
    b.fillRect(0, 0, VIEW_W, VIEW_H);
    for (var i = 0; i < 7; i++) {
      var x = 20 + i * 72 + ((i * 37) % 23);
      var w = 46 + ((i * 53) % 38);
      b.fillStyle = "rgba(30,12,6," + (0.25 + (i % 3) * 0.09) + ")";
      b.beginPath();
      b.moveTo(x, VIEW_H);
      b.lineTo(x + w * 0.2, 60 + ((i * 31) % 120));
      b.quadraticCurveTo(
        x + w * 0.5,
        20 + ((i * 17) % 60),
        x + w,
        90 + ((i * 41) % 140),
      );
      b.lineTo(x + w, VIEW_H);
      b.closePath();
      b.fill();
    }
    for (var yS = 0; yS < VIEW_H; yS += 26) {
      b.fillStyle = "rgba(20,8,4,0.16)";
      b.fillRect(0, yS + ((yS * 7) % 9), VIEW_W, 3);
    }
  }

  function hash2(r, c) {
    var h = (r * 73856093) ^ (c * 19349663);
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }

  function drawTile(r, c) {
    var ch = grid[r].charAt(c);
    if (ch !== "#" && ch !== "%") return;
    var x = c * T;
    var y = r * T - camY;
    if (y < -T || y > VIEW_H + T) return;
    var jx = 0;
    if (ch === "%") {
      var st = crumbles[r * COLS + c];
      if (st.ph === "gone") return;
      if (st.ph === "shake") jx = Math.sin(st.t * 62) * (2.4 - st.t * 2);
    }
    var hv = hash2(r, c);
    if (ch === "#") {
      var shade = 26 + hv * 14;
      ctx.fillStyle =
        "rgb(" +
        ((168 + shade * 0.6) | 0) +
        "," +
        ((86 + shade * 0.5) | 0) +
        "," +
        ((48 + shade * 0.3) | 0) +
        ")";
      ctx.fillRect(x, y, T, T);
      // strata banding
      if (hv > 0.72) {
        ctx.fillStyle = "rgba(94,42,20,0.35)";
        ctx.fillRect(x, y + T * 0.62, T, T * 0.38);
      } else if (hv < 0.16) {
        ctx.fillStyle = "rgba(232,160,92,0.14)";
        ctx.fillRect(x, y, T, T * 0.4);
      }
      if (!solid(c, r - 1)) {
        ctx.fillStyle = "#eda366";
        ctx.fillRect(x, y, T, 3);
        ctx.fillStyle = "rgba(58,24,10,0.5)";
        ctx.fillRect(x, y + 3, T, 2);
      }
      if (!solid(c, r + 1)) {
        ctx.fillStyle = "rgba(24,9,4,0.55)";
        ctx.fillRect(x, y + T - 3, T, 3);
      }
    } else {
      // crumbling slab
      ctx.fillStyle = jx ? "#c98552" : "#b06f3e";
      ctx.fillRect(x + 2 + jx, y + 5, T - 4, T - 12);
      ctx.fillStyle = "#eda366";
      ctx.fillRect(x + 2 + jx, y + 5, T - 4, 3);
      ctx.strokeStyle = "rgba(52,22,9,0.85)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x + 8 + jx, y + 7);
      ctx.lineTo(x + 13 + jx, y + 15);
      ctx.lineTo(x + 9 + jx, y + 21);
      ctx.moveTo(x + 22 + jx, y + 6);
      ctx.lineTo(x + 19 + jx, y + 14);
      ctx.lineTo(x + 24 + jx, y + 22);
      ctx.stroke();
    }
  }

  function drawExitGlow() {
    for (var i = 0; i < exitRects.length; i++) {
      var e = exitRects[i];
      var y = e.y - camY;
      if (y < -T || y > VIEW_H + T) continue;
      var pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.004 + i);
      var grad = ctx.createLinearGradient(0, y - T, 0, y + T);
      grad.addColorStop(0, "rgba(255,222,150," + 0.32 * pulse + ")");
      grad.addColorStop(1, "rgba(255,222,150,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(e.x, y - T, e.w, T * 2);
    }
  }

  function drawShards(tNow) {
    for (var i = 0; i < shardList.length; i++) {
      var s = shardList[i];
      if (s.taken) continue;
      var y = s.y - camY;
      if (y < -30 || y > VIEW_H + 30) continue;
      var bob = Math.sin(tNow * 0.003 + i * 1.7) * 3;
      ctx.save();
      ctx.translate(s.x, y + bob);
      ctx.rotate(tNow * 0.0016 + i);
      ctx.fillStyle = "#ffd479";
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(6.5, 0);
      ctx.lineTo(0, 9);
      ctx.lineTo(-6.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(1.5, -2.5, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawWater(tNow) {
    var surf = floodY - camY;
    if (surf > VIEW_H + 20) return;
    if (surf < -20) surf = -20;
    var ph = state === "play" ? floodSurge() : "none";
    var amp = ph === "surge" ? 6 : 3;
    // body
    var grad = ctx.createLinearGradient(0, surf, 0, VIEW_H);
    grad.addColorStop(0, "rgba(38,132,140,0.82)");
    grad.addColorStop(0.4, "rgba(20,84,96,0.88)");
    grad.addColorStop(1, "rgba(6,38,48,0.95)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, surf, VIEW_W, VIEW_H - surf);
    // surface line(s)
    ctx.save();
    ctx.lineWidth = 2.5;
    for (var layer = 0; layer < 2; layer++) {
      ctx.strokeStyle =
        layer === 0 ? "rgba(190,240,242,0.9)" : "rgba(127,216,222,0.45)";
      ctx.beginPath();
      for (var x = 0; x <= VIEW_W; x += 8) {
        var yy =
          surf +
          layer * 5 +
          Math.sin(x * 0.03 + tNow * 0.005 + layer * 2 + waterSeed) * amp +
          Math.sin(x * 0.011 - tNow * 0.0023) * amp * 0.6;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
    // drifting foam flecks
    ctx.fillStyle = "rgba(210,245,245,0.5)";
    for (var f = 0; f < 14; f++) {
      var fx = (f * 137 + tNow * (0.03 + (f % 3) * 0.012)) % VIEW_W;
      var fy = surf + 8 + ((f * 53) % 40) + Math.sin(tNow * 0.004 + f) * 3;
      ctx.fillRect(fx, Math.min(fy, VIEW_H - 4), 3, 2);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPlayer() {
    var p = player;
    if (!p) return;
    var sx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    var sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    var px = p.x + sx;
    var py = p.y - camY + sy;
    var sq = p.squash;
    var bodyH = p.h * sq;
    var bodyW = p.w * (2 - sq);

    // scarf ribbon
    if (trail.length > 2) {
      ctx.strokeStyle = "rgba(245,230,200,0.9)";
      ctx.lineCap = "round";
      for (var i = 1; i < trail.length; i++) {
        ctx.lineWidth = Math.max(1, 5.5 - i * 0.55);
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x + sx, trail[i - 1].y - camY + sy);
        ctx.lineTo(trail[i].x + sx, trail[i].y - camY + sy);
        ctx.stroke();
      }
    }

    // legs
    var stepping =
      p.grounded && Math.abs(p.vx) > 20 ? Math.sin(p.runPhase) * 5 : 0;
    ctx.fillStyle = "#20343c";
    ctx.fillRect(px - 6, py - 10, 5, 10 + stepping * 0.4);
    ctx.fillRect(px + 1, py - 10, 5, 10 - stepping * 0.4);

    // body capsule
    var grd = ctx.createLinearGradient(
      px - bodyW / 2,
      py - bodyH,
      px + bodyW / 2,
      py,
    );
    grd.addColorStop(0, "#3d6472");
    grd.addColorStop(1, "#27424c");
    ctx.fillStyle = grd;
    roundRect(px - bodyW / 2, py - bodyH, bodyW, bodyH - 8, 8);
    ctx.fill();
    // head
    ctx.fillStyle = "#e8b98a";
    ctx.beginPath();
    ctx.arc(px + p.dir * 2, py - bodyH + 2, 8, 0, Math.PI * 2);
    ctx.fill();
    // eye
    ctx.fillStyle = "#1c1210";
    ctx.beginPath();
    ctx.arc(px + p.dir * 5, py - bodyH + 1, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawParticles() {
    var jx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    var jy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    for (var i = 0; i < particles.length; i++) {
      var q = particles[i];
      var a = 1 - q.age / q.life;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      ctx.fillRect(
        q.x + jx - q.size / 2,
        q.y - camY + jy - q.size / 2,
        q.size,
        q.size,
      );
    }
    ctx.globalAlpha = 1;
  }

  function render(tNow) {
    // sky, tinted by altitude
    var altFrac = levelH ? clamp(camY / Math.max(1, levelH - VIEW_H), 0, 1) : 0;
    var topCol = mixColor([28, 14, 8], [247, 217, 168], altFrac);
    var botCol = mixColor([87, 32, 15], [232, 160, 92], altFrac);
    var sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    sky.addColorStop(0, rgbStr(topCol));
    sky.addColorStop(1, rgbStr(botCol));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // parallax far wall
    if (bgPattern) {
      var off1 = (camY * 0.25) % VIEW_H;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(bgPattern, 0, off1 - VIEW_H);
      ctx.drawImage(bgPattern, 0, off1);
      ctx.globalAlpha = 0.3;
      var off2 = (camY * 0.5) % VIEW_H;
      ctx.drawImage(bgPattern, 0, off2 - VIEW_H);
      ctx.drawImage(bgPattern, 0, off2);
      ctx.globalAlpha = 1;
    }

    // visible tiles
    var r0 = Math.max(0, Math.floor(camY / T) - 1);
    var r1 = Math.min(levelRows - 1, Math.floor((camY + VIEW_H) / T) + 1);
    for (var r = r0; r <= r1; r++) {
      for (var c = 0; c < COLS; c++) drawTile(r, c);
    }

    drawExitGlow();
    drawShards(tNow);
    drawWater(tNow);
    drawParticles();

    if (player && state !== "over") drawPlayer();

    // vignette + surge pulse
    var vg = ctx.createRadialGradient(
      VIEW_W / 2,
      VIEW_H / 2,
      VIEW_H * 0.42,
      VIEW_W / 2,
      VIEW_H / 2,
      VIEW_H * 0.78,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(10,4,2,0.42)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (state === "play") {
      var ph = floodSurge();
      if (ph === "surge" || ph === "warn") {
        var inten =
          ph === "surge" ? 0.22 : 0.12 * (0.5 + 0.5 * Math.sin(tNow * 0.02));
        ctx.fillStyle = "rgba(255,90,50," + inten.toFixed(3) + ")";
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      }
    }
  }

  function mixColor(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  }

  function rgbStr(v) {
    return "rgb(" + (v[0] | 0) + "," + (v[1] | 0) + "," + (v[2] | 0) + ")";
  }

  /* ---------- hud sync ---------- */

  var lastTimeText = "";

  function syncHud() {
    var txt = fmtTime(stormClock);
    if (txt !== lastTimeText) {
      lastTimeText = txt;
      hudTime.textContent = txt;
    }
    if (levelH) {
      gaugeYou.style.bottom =
        (clamp(player.y / levelH, 0, 1) * 100).toFixed(1) + "%";
      gaugeFlood.style.bottom =
        (clamp(floodY / levelH, 0, 1) * 100).toFixed(1) + "%";
    }
    var ph = state === "play" ? floodSurge() : "none";
    if (ph !== notePhase) {
      notePhase = ph;
      if (ph === "warn") {
        stormNote.textContent = "SURGE COMING — CLIMB";
        stormNote.style.color = "#ffb36b";
      } else if (ph === "surge") {
        stormNote.textContent = "the narrows ROAR";
        stormNote.style.color = "#ff7a4d";
      } else {
        stormNote.textContent = "storm building upstream";
        stormNote.style.color = "";
      }
    }
  }

  var notePhase = "none";

  /* ---------- main loop ---------- */

  var lastTs = 0;

  function frame(ts) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.045, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    var tNow = ts;

    if (state === "play" && !paused && !document.hidden) {
      levelTime += dt;
      stormClock += dt;
      shake = Math.max(0, shake - dt * 9);
      updatePlayer(dt);
      updateCrumbles(dt);
      updateShards();
      updateFlood(dt);
      checkDeathAndExit();
      // camera follows upward progress
      var target = clamp(player.y - VIEW_H * 0.62, 0, levelH - VIEW_H);
      camY += (target - camY) * Math.min(1, dt * 8);
      if (camY > levelH - VIEW_H) camY = levelH - VIEW_H;
      syncHud();
    }

    // particles always tick (even on death splash)
    for (var i = particles.length - 1; i >= 0; i--) {
      var q = particles[i];
      q.age += dt;
      q.vy += q.grav * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.age >= q.life) particles.splice(i, 1);
    }

    render(tNow);
  }

  /* ---------- boot ---------- */

  function fitCanvas() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = VIEW_W * dpr;
    canvas.height = VIEW_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", fitCanvas);
  fitCanvas();
  buildBg();
  startLevelPreview();

  function startLevelPreview() {
    // dress the background behind the title panel with level one's floor
    parseLevel(0);
    player = makePlayer(spawnCell.r, spawnCell.c);
    floodY = levelH + T;
    camY = levelH - VIEW_H;
    state = "title";
    showPanel("title");
  }

  // tiny debug hook for automated tests (?debug)
  if (/\bdebug\b/.test(location.search)) {
    window.__floodline = {
      state: function () {
        return {
          mode: state,
          paused: paused,
          level: levelIdx,
          playerX: player ? player.x : 0,
          playerY: player ? player.y : 0,
          floodY: floodY,
          time: stormClock,
          shards: totalShardsGot + levelShardsGot,
        };
      },
      warp: function (r, c) {
        if (player) {
          player.x = c * T + T / 2;
          player.y = r * T;
          player.vy = 0;
        }
      },
      setFlood: function (y) {
        floodY = y;
      },
      setMode: function (m) {
        state = m;
      },
    };
  }

  requestAnimationFrame(frame);
})();
