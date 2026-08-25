/* Stone Fold — walk chalk lines into open bracken and home again to raise
   dry-stone walls. Every pocket the bull isn't in falls to your fold.
   Five fells, three caps, one Herdwick bull with opinions. */
(function () {
  "use strict";

  /* ---------- constants ---------- */

  var COLS = 72;
  var ROWS = 46;
  var CELL = 12;
  var W = COLS * CELL; // 864
  var H = ROWS * CELL; // 552
  var OPEN = 0;
  var WALL = 1;
  var TRAIL = 2;

  var FELLS = [
    {
      name: "Scout Scar",
      target: 58,
      bulls: 1,
      speed: 58,
      note: "One young bull, dozy after the mart. Find your rhythm.",
    },
    {
      name: "Herdwick Rise",
      target: 64,
      bulls: 2,
      speed: 74,
      note: "A second beast has found the gap in the dyke.",
    },
    {
      name: "Gorse Bank",
      target: 68,
      bulls: 2,
      speed: 84,
      note: "They run the slope together. Cut them apart.",
    },
    {
      name: "Black Dub",
      target: 74,
      bulls: 3,
      speed: 94,
      note: "Three now, and the bog steams at dusk. Mind your chalk.",
    },
    {
      name: "High Fold",
      target: 78,
      bulls: 3,
      speed: 104,
      note: "The last fell. The old bull remembers every waller.",
    },
  ];
  var ROMAN = ["I", "II", "III", "IV", "V"];
  var STEP = 0.088; // seconds per player cell
  var BULL_R = 5;

  /* ---------- dom ---------- */

  var cv = document.getElementById("fold");
  var ctx = cv.getContext("2d");
  var boardEl = document.getElementById("board");
  var overlayEl = document.getElementById("overlay");
  var screens = {
    title: document.getElementById("screen-title"),
    intro: document.getElementById("screen-intro"),
    pause: document.getElementById("screen-pause"),
    over: document.getElementById("screen-over"),
    win: document.getElementById("screen-win"),
  };
  var hud = {
    fell: document.getElementById("hud-fell"),
    fill: document.getElementById("hud-fill"),
    mark: document.getElementById("hud-mark"),
    goal: document.getElementById("hud-goal"),
    lives: document.getElementById("hud-lives"),
    score: document.getElementById("hud-score"),
  };
  var introTitle = document.getElementById("intro-title");
  var introLede = document.getElementById("intro-lede");
  var introNote = document.getElementById("intro-note");
  var overLine = document.getElementById("over-line");
  var overTally = document.getElementById("over-tally");
  var winTally = document.getElementById("win-tally");
  var btnSound = document.getElementById("btn-sound");

  /* ---------- audio (synthesised, lazy) ---------- */

  var actx = null;
  var master = null;
  var muted = false;

  function ensureAudio() {
    if (actx || muted === null) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = 0.4;
      master.connect(actx.destination);
    } catch (err) {
      actx = null;
    }
  }

  function tone(freq, dur, type, vol, glide, when) {
    if (!actx || muted) return;
    var t0 = actx.currentTime + (when || 0);
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, t0);
    if (glide)
      o.frequency.exponentialRampToValueAtTime(Math.max(30, glide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function puff(dur, vol, cut, when) {
    if (!actx || muted) return;
    var t0 = actx.currentTime + (when || 0);
    var n = Math.floor(actx.sampleRate * dur);
    var buf = actx.createBuffer(1, n, actx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = actx.createBufferSource();
    src.buffer = buf;
    var f = actx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cut || 800;
    var g = actx.createGain();
    g.gain.value = vol || 0.2;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
  }

  var sfx = {
    start: function () {
      tone(392, 0.09, "triangle", 0.3);
      tone(523, 0.12, "triangle", 0.3, 0, 0.09);
    },
    capture: function () {
      puff(0.16, 0.16, 1100);
      tone(330, 0.07, "triangle", 0.18);
      tone(440, 0.09, "triangle", 0.18, 0, 0.05);
    },
    bigfold: function () {
      tone(392, 0.09, "square", 0.14);
      tone(494, 0.09, "square", 0.14, 0, 0.09);
      tone(587, 0.16, "square", 0.14, 0, 0.18);
    },
    death: function () {
      tone(190, 0.42, "sawtooth", 0.4, 52);
      puff(0.3, 0.3, 320);
    },
    levelup: function () {
      tone(523, 0.1, "triangle", 0.28);
      tone(659, 0.1, "triangle", 0.28, 0, 0.11);
      tone(784, 0.18, "triangle", 0.28, 0, 0.22);
    },
    win: function () {
      var notes = [523, 659, 784, 659, 1046];
      for (var i = 0; i < notes.length; i++)
        tone(notes[i], 0.16, "triangle", 0.28, 0, i * 0.13);
    },
    tick: function () {
      tone(720, 0.03, "square", 0.05);
    },
  };

  /* ---------- helpers ---------- */

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var grid = new Uint8Array(COLS * ROWS);

  function gi(x, y) {
    return y * COLS + x;
  }

  function cellAt(x, y) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return WALL;
    return grid[gi(x, y)];
  }

  function cellAtPx(px, py) {
    return cellAt(Math.floor(px / CELL), Math.floor(py / CELL));
  }

  /* ---------- game state ---------- */

  var state = "title"; // title | play | dead | pause | over | win
  var level = 0;
  var lives = 3;
  var score = 0;
  var best = 0;
  var walledInside = 0;
  var interiorTotal = (COLS - 2) * (ROWS - 2);

  var player = {
    x: 0,
    y: 0, // cell
    fx: 0,
    fy: 0, // render position, px
    dir: null, // {dx,dy}
    trail: false,
    invuln: 0,
    stepT: 0,
    walkPhase: 0,
  };
  var bulls = [];
  var particles = [];
  var floats = [];
  var deadT = 0;

  try {
    best = parseInt(localStorage.getItem("stone-fold-best") || "0", 10) || 0;
  } catch (err) {
    best = 0;
  }

  /* ---------- offscreen layers ---------- */

  var bgCv = document.createElement("canvas");
  bgCv.width = W;
  bgCv.height = H;
  var bgCtx = bgCv.getContext("2d");

  var wallCv = document.createElement("canvas");
  wallCv.width = W;
  wallCv.height = H;
  var wallCtx = wallCv.getContext("2d");

  var vig = null;

  function makeVignette() {
    vig = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.36,
      W / 2,
      H / 2,
      H * 0.78,
    );
    vig.addColorStop(0, "rgba(10,7,4,0)");
    vig.addColorStop(1, "rgba(10,7,4,0.44)");
  }

  /* ---------- level building ---------- */

  function paintBackground(rng) {
    bgCtx.fillStyle = "#77592b";
    bgCtx.fillRect(0, 0, W, H);
    var cols = ["#64491f", "#84683a", "#8f7440", "#59421c", "#9c8046"];
    for (var i = 0; i < 3000; i++) {
      bgCtx.fillStyle = cols[(rng() * cols.length) | 0];
      bgCtx.globalAlpha = 0.35 + rng() * 0.4;
      var x = rng() * W;
      var y = rng() * H;
      bgCtx.fillRect(x, y, 1.6 + rng() * 3.2, 1.2 + rng() * 1.6);
    }
    bgCtx.globalAlpha = 1;
    // gorse tufts
    for (var g = 0; g < 90; g++) {
      var gx = rng() * W;
      var gy = rng() * H;
      bgCtx.fillStyle = "#b9962f";
      for (var d = 0; d < 3; d++) {
        bgCtx.fillRect(gx + (rng() * 6 - 3), gy + (rng() * 4 - 2), 2, 2);
      }
      bgCtx.fillStyle = "#6d5a22";
      bgCtx.fillRect(gx + 1, gy + 2, 2, 2);
    }
    // dry-stone border
    bgCtx.fillStyle = "#6e675a";
    bgCtx.fillRect(0, 0, W, CELL);
    bgCtx.fillRect(0, H - CELL, W, CELL);
    bgCtx.fillRect(0, 0, CELL, H);
    bgCtx.fillRect(W - CELL, 0, CELL, H);
    bgCtx.strokeStyle = "#57524a";
    bgCtx.lineWidth = 1;
    for (var b = 0; b < W; b += CELL * 2) {
      bgCtx.strokeRect(b + 0.5, 0.5, CELL * 2 - 1, CELL - 1);
      bgCtx.strokeRect(b + CELL + 0.5, H - CELL + 0.5, CELL * 2 - 1, CELL - 1);
    }
    for (var c = 0; c < H; c += CELL * 2) {
      bgCtx.strokeRect(0.5, c + 0.5, CELL - 1, CELL * 2 - 1);
      bgCtx.strokeRect(W - CELL + 0.5, c + CELL + 0.5, CELL - 1, CELL * 2 - 1);
    }
    bgCtx.fillStyle = "rgba(255,240,210,0.12)";
    bgCtx.fillRect(CELL, CELL, W - CELL * 2, 1);
  }

  function paintRock(cx, cy) {
    var x = cx * CELL;
    var y = cy * CELL;
    bgCtx.fillStyle = "#7d786c";
    roundRect(bgCtx, x + 0.5, y + 0.5, CELL - 1, CELL - 1, 4);
    bgCtx.fill();
    bgCtx.fillStyle = "#989384";
    bgCtx.fillRect(x + 2, y + 2, 4, 2);
    bgCtx.fillStyle = "#555046";
    bgCtx.fillRect(x + 3, y + CELL - 4, CELL - 7, 2);
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function buildLevel(idx) {
    var cfg = FELLS[idx];
    var rng = mulberry32(1337 + idx * 7919);
    grid.fill(OPEN);
    for (var x = 0; x < COLS; x++) {
      grid[gi(x, 0)] = WALL;
      grid[gi(x, ROWS - 1)] = WALL;
    }
    for (var y = 0; y < ROWS; y++) {
      grid[gi(0, y)] = WALL;
      grid[gi(COLS - 1, y)] = WALL;
    }
    paintBackground(rng);
    wallCtx.clearRect(0, 0, W, H);

    // scattered rock outcrops (safe ground that also shapes the chase)
    var rocks = 4 + ((rng() * 3) | 0);
    for (var r = 0; r < rocks; r++) {
      var rx = 6 + ((rng() * (COLS - 14)) | 0);
      var ry = 6 + ((rng() * (ROWS - 14)) | 0);
      var size = 2 + ((rng() * 3) | 0);
      for (var s = 0; s < size; s++) {
        var ox = rx + ((rng() * 3) | 0) - 1;
        var oy = ry + ((rng() * 3) | 0) - 1;
        if (
          ox > 1 &&
          oy > 1 &&
          ox < COLS - 2 &&
          oy < ROWS - 2 &&
          grid[gi(ox, oy)] === OPEN
        ) {
          grid[gi(ox, oy)] = WALL;
          paintRock(ox, oy);
        }
      }
    }
    walledInside = 0;
    for (var wx = 1; wx < COLS - 1; wx++) {
      for (var wy = 1; wy < ROWS - 1; wy++) {
        if (grid[gi(wx, wy)] === WALL) walledInside++;
      }
    }

    player.x = COLS >> 1;
    player.y = 0;
    player.fx = (player.x + 0.5) * CELL;
    player.fy = (player.y + 0.5) * CELL;
    player.dir = null;
    player.trail = false;
    player.invuln = 0;
    player.stepT = 0;
    player.walkPhase = 0;

    bulls.length = 0;
    for (var i = 0; i < cfg.bulls; i++) spawnBull(cfg.speed + i * 6, rng);

    particles.length = 0;
    floats.length = 0;
    updateHud();
  }

  function spawnBull(speed, rng) {
    var bx = 0;
    var by = 0;
    var tries = 0;
    do {
      bx = 2 + ((rng() * (COLS - 4)) | 0);
      by = 4 + ((rng() * (ROWS - 8)) | 0);
      tries++;
    } while (
      (Math.abs(bx - player.x) + Math.abs(by - player.y) < 20 ||
        cellAt(bx, by) !== OPEN) &&
      tries < 400
    );
    var ang = ((rng() * 4) | 0) * (Math.PI / 2) + Math.PI / 4;
    var sp = speed * (0.9 + rng() * 0.25);
    bulls.push({
      x: (bx + 0.5) * CELL,
      y: (by + 0.5) * CELL,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      cruise: sp,
      top: sp * 1.22,
      snort: rng() * 4,
    });
  }

  /* ---------- input ---------- */

  var kbStack = []; // most recent key last
  var swDir = null; // persistent swipe direction
  var padDir = null; // held touch pad

  var KEYMAP = {
    ArrowUp: "n",
    KeyW: "n",
    ArrowDown: "s",
    KeyS: "s",
    ArrowLeft: "w",
    KeyA: "w",
    ArrowRight: "e",
    KeyD: "e",
  };
  var DIRV = {
    n: { dx: 0, dy: -1 },
    s: { dx: 0, dy: 1 },
    w: { dx: -1, dy: 0 },
    e: { dx: 1, dy: 0 },
  };

  function activeDir() {
    if (kbStack.length) return DIRV[kbStack[kbStack.length - 1]];
    if (padDir) return DIRV[padDir];
    if (swDir) return DIRV[swDir];
    return null;
  }

  function stopMoving() {
    swDir = null;
    padDir = null;
  }

  window.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var code = e.code;
    if (KEYMAP[code]) {
      e.preventDefault();
      ensureAudio();
      var k = KEYMAP[code];
      if (kbStack[kbStack.length - 1] !== k) kbStack.push(k);
      maybeAdvanceOverlay(k);
      return;
    }
    if (code === "Space" || code === "Enter") {
      e.preventDefault();
      ensureAudio();
      pressPrimary();
      return;
    }
    if (/^F\d/.test(code)) return;
    switch (code) {
      case "KeyP":
        togglePause();
        break;
      case "KeyM":
        toggleMute();
        break;
      case "KeyR":
        if (state !== "title") restartShift();
        break;
      default:
        maybeAdvanceOverlay(code);
    }
  });

  window.addEventListener("keyup", function (e) {
    var k = KEYMAP[e.code];
    if (!k) return;
    for (var i = kbStack.length - 1; i >= 0; i--) {
      if (kbStack[i] === k) kbStack.splice(i, 1);
    }
  });

  function maybeAdvanceOverlay() {
    if (overlayVisible()) pressPrimary();
  }

  function overlayVisible() {
    return state !== "play" && state !== "dead";
  }

  function pressPrimary() {
    if (state === "title") {
      startShift();
    } else if (state === "intro") {
      beginLevel();
    } else if (state === "pause") {
      resume();
    } else if (state === "over" || state === "win") {
      restartShift();
    }
  }

  // pointer swipes on the canvas steer the walker hands-free
  var swipeAnchor = null;
  cv.addEventListener("pointerdown", function (e) {
    ensureAudio();
    if (overlayVisible()) return;
    swipeAnchor = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  });
  cv.addEventListener("pointermove", function (e) {
    if (!swipeAnchor) return;
    var dx = e.clientX - swipeAnchor.x;
    var dy = e.clientY - swipeAnchor.y;
    if (Math.abs(dx) < 22 && Math.abs(dy) < 22) return;
    swDir =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : dy > 0 ? "s" : "n";
    swipeAnchor = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  });
  window.addEventListener("pointerup", function () {
    swipeAnchor = null;
  });

  function bindPad(id, dir) {
    var el = document.getElementById(id);
    el.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      ensureAudio();
      el.classList.add("hot");
      if (dir === null) {
        stopMoving();
        player.dir = null;
      } else {
        padDir = dir;
        maybeAdvanceOverlay(dir);
      }
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
      el.addEventListener(ev, function () {
        el.classList.remove("hot");
        if (padDir === dir) padDir = null;
      });
    });
  }
  bindPad("pad-up", "n");
  bindPad("pad-down", "s");
  bindPad("pad-left", "w");
  bindPad("pad-right", "e");
  bindPad("pad-stop", null);

  document.addEventListener("contextmenu", function (e) {
    if (e.target && e.target.tagName === "CANVAS") e.preventDefault();
  });

  /* ---------- overlays & flow ---------- */

  function showScreen(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].hidden = k !== name;
    });
    overlayEl.style.display = name ? "flex" : "none";
  }

  function hideOverlay() {
    overlayEl.style.display = "none";
    Object.keys(screens).forEach(function (k) {
      screens[k].hidden = true;
    });
  }

  function startShift() {
    ensureAudio();
    sfx.start();
    score = 0;
    lives = 3;
    level = 0;
    showIntro();
  }

  function showIntro() {
    state = "intro";
    var cfg = FELLS[level];
    introTitle.textContent =
      "Fell " + ROMAN[level] + " of V \u2014 " + cfg.name;
    introLede.textContent = "Close " + cfg.target + "% of the bracken.";
    introNote.textContent = cfg.note;
    showScreen("intro");
    updateHud();
  }

  function beginLevel() {
    buildLevel(level);
    hideOverlay();
    state = "play";
    sfx.tick();
  }

  function restartShift() {
    ensureAudio();
    score = 0;
    lives = 3;
    level = 0;
    showIntro();
  }

  function togglePause() {
    if (state === "play") {
      state = "pause";
      showScreen("pause");
    } else if (state === "pause") {
      resume();
    }
  }

  function resume() {
    hideOverlay();
    state = "play";
  }

  function toggleMute() {
    muted = !muted;
    btnSound.innerHTML = muted ? "&#9834; off" : "&#9834; on";
  }

  document.getElementById("btn-start").addEventListener("click", startShift);
  document.getElementById("btn-next").addEventListener("click", beginLevel);
  document.getElementById("btn-resume").addEventListener("click", resume);
  document
    .getElementById("btn-restart-p")
    .addEventListener("click", restartShift);
  document
    .getElementById("btn-restart-o")
    .addEventListener("click", restartShift);
  document
    .getElementById("btn-restart-w")
    .addEventListener("click", restartShift);
  document.getElementById("btn-pause").addEventListener("click", togglePause);
  btnSound.addEventListener("click", function () {
    ensureAudio();
    toggleMute();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state === "play") togglePause();
  });

  function saveBest() {
    if (score > best) {
      best = score;
      try {
        localStorage.setItem("stone-fold-best", String(best));
      } catch (err) {
        /* private mode, no matter */
      }
    }
  }

  /* ---------- simulation ---------- */

  function update(dt) {
    if (state === "dead") {
      deadT -= dt;
      updateParticles(dt);
      if (deadT <= 0) respawn();
      return;
    }
    if (state !== "play") return;

    player.invuln = Math.max(0, player.invuln - dt);
    player.dir = activeDir();

    player.stepT += dt;
    while (player.stepT >= STEP) {
      player.stepT -= STEP;
      stepPlayer();
      if (state !== "play") break;
    }
    player.fx += ((player.x + 0.5) * CELL - player.fx) * Math.min(1, dt * 26);
    player.fy += ((player.y + 0.5) * CELL - player.fy) * Math.min(1, dt * 26);
    if (player.dir) player.walkPhase += dt * 11;

    for (var i = 0; i < bulls.length; i++) moveBull(bulls[i], dt);
    updateParticles(dt);
  }

  function stepPlayer() {
    var d = player.dir;
    if (!d) return;
    var nx = player.x + d.dx;
    var ny = player.y + d.dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return; // stay on the map
    var t = cellAt(nx, ny);
    if (t === TRAIL) {
      player.x = nx;
      player.y = ny;
      return;
    }
    if (t === WALL) {
      // stone is the waller's highway - stroll it freely; arriving from a
      // chalk run sets the fold
      player.x = nx;
      player.y = ny;
      if (player.trail) capture();
      return;
    }
    // open bracken ahead
    if (player.invuln > 0 && !player.trail) return; // no chalk while ghosted
    if (!player.trail) {
      player.trail = true;
      sfx.tick();
    }
    grid[gi(nx, ny)] = TRAIL;
    player.x = nx;
    player.y = ny;
  }

  function capture() {
    var label = new Int16Array(COLS * ROWS).fill(-1);
    var comps = [];
    var i;
    var x;
    var y;
    for (y = 1; y < ROWS - 1; y++) {
      for (x = 1; x < COLS - 1; x++) {
        var id = gi(x, y);
        if (grid[id] !== OPEN || label[id] !== -1) continue;
        var comp = { cells: [], bull: false };
        var queue = [id];
        label[id] = comps.length;
        while (queue.length) {
          var cur = queue.pop();
          comp.cells.push(cur);
          var cx = cur % COLS;
          var cy = (cur / COLS) | 0;
          for (var b = 0; b < bulls.length; b++) {
            if (
              Math.floor(bulls[b].x / CELL) === cx &&
              Math.floor(bulls[b].y / CELL) === cy
            )
              comp.bull = true;
          }
          var nb = [
            [cx - 1, cy],
            [cx + 1, cy],
            [cx, cy - 1],
            [cx, cy + 1],
          ];
          for (var n = 0; n < 4; n++) {
            var ax = nb[n][0];
            var ay = nb[n][1];
            if (ax < 0 || ay < 0 || ax >= COLS || ay >= ROWS) continue;
            var aid = gi(ax, ay);
            if (grid[aid] === OPEN && label[aid] === -1) {
              label[aid] = comps.length;
              queue.push(aid);
            }
          }
        }
        comps.push(comp);
      }
    }

    // a bull whose nose is over a chalk line must not be entombed by the
    // setting stone - leave its cell open and let it walk out
    var bullCells = {};
    for (var b = 0; b < bulls.length; b++) {
      var bcx = Math.floor(bulls[b].x / CELL);
      var bcy = Math.floor(bulls[b].y / CELL);
      bullCells[bcx + "," + bcy] = true;
    }

    function bullOn(id) {
      return bullCells[(id % COLS) + "," + ((id / COLS) | 0)];
    }

    var gained = 0;
    var trailCells = [];
    for (var c = 0; c < comps.length; c++) {
      if (comps[c].bull) continue;
      for (i = 0; i < comps[c].cells.length; i++) {
        if (bullOn(comps[c].cells[i])) continue;
        grid[comps[c].cells[i]] = WALL;
        gained++;
      }
    }
    for (i = 0; i < grid.length; i++) {
      if (grid[i] === TRAIL) {
        if (bullOn(i)) continue;
        grid[i] = WALL;
        trailCells.push(i);
        gained++;
      }
    }

    player.trail = false;

    if (gained > 0) {
      walledInside += gained;
      score += gained * 5;
      paintCapture(comps, trailCells);

      sfx.capture();
      if (gained >= 120) {
        score += 300;
        floats.push({
          text: "BIG FOLD +300",
          x: player.fx,
          y: player.fy - 14,
          life: 1.6,
        });
        sfx.bigfold();
      }
    }

    var cfg = FELLS[level];
    var pct = (walledInside / interiorTotal) * 100;
    if (pct >= cfg.target) {
      score += 400 + level * 200 + lives * 150;
      if (level >= FELLS.length - 1) {
        winGame();
      } else {
        sfx.levelup();
        level++;
        showIntro();
      }
    }
    updateHud();
  }

  function paintCapture(comps, trailCells) {
    for (var c = 0; c < comps.length; c++) {
      if (comps[c].bull) continue;
      for (var i = 0; i < comps[c].cells.length; i++) {
        var id = comps[c].cells[i];
        drawPastureCell(id % COLS, (id / COLS) | 0);
      }
    }
    for (var t = 0; t < trailCells.length; t++) {
      var tid = trailCells[t];
      drawPastureCell(tid % COLS, (tid / COLS) | 0);
    }
  }

  var pastureShades = ["#7b9155", "#759052", "#81985d", "#71904f"];

  function drawPastureCell(x, y) {
    var px = x * CELL;
    var py = y * CELL;
    wallCtx.fillStyle = pastureShades[(x * 7 + y * 13) & 3];
    wallCtx.fillRect(px, py, CELL, CELL);
    if ((x * 31 + y * 17) % 7 === 0) {
      wallCtx.fillStyle = "rgba(228,222,180,0.35)";
      wallCtx.fillRect(px + 3, py + 5, 2, 1);
    }
    // stone face where pasture meets open bracken
    wallCtx.fillStyle = "#5a5142";
    if (cellAt(x, y - 1) === OPEN) wallCtx.fillRect(px, py, CELL, 2.5);
    if (cellAt(x, y + 1) === OPEN)
      wallCtx.fillRect(px, py + CELL - 2.5, CELL, 2.5);
    if (cellAt(x - 1, y) === OPEN) wallCtx.fillRect(px, py, 2.5, CELL);
    if (cellAt(x + 1, y) === OPEN)
      wallCtx.fillRect(px + CELL - 2.5, py, 2.5, CELL);
    if ((x * 11 + y * 3) % 5 === 0) {
      wallCtx.fillStyle = "#6d6452";
      wallCtx.fillRect(px + 4, py + 4, 3, 2);
    }
  }

  function moveBull(b, dt) {
    var pdx = player.fx - b.x;
    var pdy = player.fy - b.y;
    var pdist = Math.hypot(pdx, pdy) || 0.001;

    // pace: dawdle-proof cruising, a burst when you are far away
    var want = pdist > 320 ? b.top : b.cruise;
    var mag = Math.hypot(b.vx, b.vy);
    if (mag < 1) {
      // never let the run die - pick a fresh heading
      var na = Math.random() * Math.PI * 2;
      b.vx = Math.cos(na) * want;
      b.vy = Math.sin(na) * want;
    } else {
      // steer: bend the run toward the waller from afar; up close commit to
      // a straight line he can actually dodge. speed always settles to pace.
      var rate = pdist > 260 ? 1.0 : pdist > 140 ? 0.45 : 0;
      if (rate > 0 && state === "play") {
        var turn = Math.atan2(pdy, pdx) - Math.atan2(b.vy, b.vx);
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        var step = Math.max(-rate * dt, Math.min(rate * dt, turn));
        var ang = Math.atan2(b.vy, b.vx) + step;
        b.vx = Math.cos(ang) * want;
        b.vy = Math.sin(ang) * want;
      } else {
        var k = 1 - Math.exp(-dt * 3);
        var cur = mag || 1;
        var nw = cur + (want - cur) * k;
        b.vx = (b.vx / cur) * nw;
        b.vy = (b.vy / cur) * nw;
      }
    }

    var steps = Math.min(
      48,
      Math.max(
        1,
        Math.ceil(((Math.abs(b.vx) + Math.abs(b.vy)) * dt) / (CELL / 3)),
      ),
    );
    var sdt = dt / steps;
    for (var s = 0; s < steps; s++) {
      // horizontal leg
      var nx = b.x + b.vx * sdt;
      var sx = nx + Math.sign(b.vx) * BULL_R;
      if (
        cellAtPx(sx, b.y - BULL_R * 0.7) === WALL ||
        cellAtPx(sx, b.y + BULL_R * 0.7) === WALL
      ) {
        b.vx = -b.vx;
        skid(b); // never the same lane twice
      } else {
        b.x = nx;
      }
      // vertical leg
      var ny = b.y + b.vy * sdt;
      var sy = ny + Math.sign(b.vy) * BULL_R;
      if (
        cellAtPx(b.x - BULL_R * 0.7, sy) === WALL ||
        cellAtPx(b.x + BULL_R * 0.7, sy) === WALL
      ) {
        b.vy = -b.vy;
        skid(b);
      } else {
        b.y = ny;
      }
    }
    b.snort -= dt;

    // bull meets chalk
    if (cellAtPx(b.x, b.y) === TRAIL) {
      killPlayer();
      return;
    }
    // bull meets waller
    if (pdist < 12) {
      killPlayer();
      return;
    }
  }

  // glance off the stone: keep the speed, swing the heading a little
  function skid(b) {
    var mag = Math.hypot(b.vx, b.vy);
    var ang = Math.atan2(b.vy, b.vx) + (Math.random() - 0.5) * 0.5;
    b.vx = Math.cos(ang) * mag;
    b.vy = Math.sin(ang) * mag;
  }

  function killPlayer() {
    if (player.invuln > 0 || state !== "play") return;
    lives--;
    state = "dead";
    deadT = 0.95;
    sfx.death();
    boardEl.classList.remove("shake");
    void boardEl.offsetWidth;
    boardEl.classList.add("shake");
    for (var i = 0; i < 14; i++) {
      particles.push({
        x: player.fx,
        y: player.fy,
        vx: Math.random() * 160 - 80,
        vy: Math.random() * -130 - 30,
        life: 0.7 + Math.random() * 0.3,
        col: "#c0562e",
        s: 3,
      });
    }
    updateHud();
    if (lives <= 0) {
      state = "over";
      saveBest();
      overLine.textContent =
        level === 0
          ? "Not one fell closed. The bracken laughs."
          : level >= 3
            ? "So close to High Fold. The bull tipped his horns to you."
            : "Your last cap went into the beck.";
      overTally.textContent = score + " pts \u00b7 best " + best;
      showScreen("over");
    }
  }

  function respawn() {
    for (var i = 0; i < grid.length; i++) {
      if (grid[i] === TRAIL) grid[i] = OPEN;
    }
    player.trail = false;
    player.x = COLS >> 1;
    player.y = 0;
    player.fx = (player.x + 0.5) * CELL;
    player.fy = (player.y + 0.5) * CELL;
    player.dir = null;

    stopMoving();
    kbStack.length = 0;
    player.invuln = 1.9;
    player.stepT = 0;
    state = "play";
  }

  function winGame() {
    state = "win";
    saveBest();
    winTally.textContent =
      score +
      " pts \u00b7 best " +
      best +
      " \u00b7 " +
      lives +
      " cap" +
      (lives === 1 ? "" : "s") +
      " kept";
    showScreen("win");
    sfx.win();
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
    }
    for (var f = floats.length - 1; f >= 0; f--) {
      floats[f].life -= dt;
      floats[f].y -= dt * 16;
      if (floats[f].life <= 0) floats.splice(f, 1);
    }
  }

  /* ---------- hud ---------- */

  function updateHud() {
    var cfg = FELLS[level];
    hud.fell.textContent = "Fell " + ROMAN[level];
    var pct = Math.min(100, (walledInside / interiorTotal) * 100);
    hud.fill.style.width = pct.toFixed(1) + "%";
    hud.mark.style.left = cfg.target + "%";
    hud.goal.textContent = Math.floor(pct) + "% of " + cfg.target + "%";
    hud.score.textContent = score + " pts";
    var caps = hud.lives.querySelectorAll(".cap");
    for (var i = 0; i < caps.length; i++) {
      caps[i].classList.toggle("lost", i >= lives);
    }
  }

  /* ---------- rendering ---------- */

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bgCv, 0, 0);
    ctx.drawImage(wallCv, 0, 0);

    // chalk trail
    ctx.fillStyle = "rgba(245,239,220,0.88)";
    for (var i = 0; i < grid.length; i++) {
      if (grid[i] === TRAIL) {
        var x = i % COLS;
        var y = (i / COLS) | 0;
        ctx.fillRect(x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6);
      }
    }

    // dusk vignette
    if (vig) {
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);
    }

    // particles
    for (var p = 0; p < particles.length; p++) {
      var pt = particles[p];
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.col;
      ctx.fillRect(pt.x - pt.s / 2, pt.y - pt.s / 2, pt.s, pt.s);
    }
    ctx.globalAlpha = 1;

    for (var b = 0; b < bulls.length; b++) drawBull(bulls[b]);
    drawPlayer();

    // floating scores
    ctx.font = 'bold 15px "Courier New", monospace';
    ctx.textAlign = "center";
    for (var f = 0; f < floats.length; f++) {
      ctx.globalAlpha = Math.min(1, floats[f].life);
      ctx.fillStyle = "#20180c";
      ctx.fillText(floats[f].text, floats[f].x + 1, floats[f].y + 1);
      ctx.fillStyle = "#f2e6bd";
      ctx.fillText(floats[f].text, floats[f].x, floats[f].y);
    }
    ctx.globalAlpha = 1;

    // death flash
    if (state === "dead") {
      ctx.fillStyle = "rgba(192,86,46," + Math.max(0, deadT * 0.4) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawBull(b) {
    var bob = Math.sin(performance.now() / 90 + b.snort * 7) * 1.1;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + 6, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(b.x, b.y + bob);
    var ang = Math.atan2(b.vy, b.vx);
    ctx.rotate(ang);
    // body
    ctx.fillStyle = "#46331f";
    ctx.beginPath();
    ctx.ellipse(-2, 0, 8, 5.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // head
    ctx.fillStyle = "#3a2917";
    ctx.beginPath();
    ctx.arc(6.5, 0, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#cbb894";
    ctx.beginPath();
    ctx.ellipse(9.6, 0, 2.4, 1.9, 0, 0, Math.PI * 2);
    ctx.fill();
    // horns
    ctx.strokeStyle = "#e8dcc3";
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(6, -3);
    ctx.quadraticCurveTo(9, -6.5, 11.5, -4.5);
    ctx.moveTo(6, 3);
    ctx.quadraticCurveTo(9, 6.5, 11.5, 4.5);
    ctx.stroke();
    // tail
    ctx.strokeStyle = "#46331f";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-9, -1);
    ctx.lineTo(-12, -3 + Math.sin(performance.now() / 70 + b.snort) * 1.6);
    ctx.stroke();
    ctx.restore();

    // red glint when it smells you
    var dx = player.fx - b.x;
    var dy = player.fy - b.y;
    if (dx * dx + dy * dy < 90 * 90 && state === "play") {
      ctx.fillStyle = "#ffdf9e";
      ctx.fillRect(
        b.x + Math.cos(Math.atan2(dy, dx)) * 5 - 1,
        b.y + Math.sin(Math.atan2(dy, dx)) * 5 - 1,
        2,
        2,
      );
    }
  }

  function drawPlayer() {
    if (state === "over" && lives <= 0) return;
    var x = player.fx;
    var y = player.fy;
    var blink = player.invuln > 0 && Math.floor(player.invuln * 9) % 2 === 0;
    ctx.globalAlpha = blink ? 0.35 : 1;

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(x, y + 6.5, 5.5, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();

    var swing = player.dir ? Math.sin(player.walkPhase) * 2 : 0;
    // legs
    ctx.strokeStyle = "#2c2620";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x - 1.6, y + 2);
    ctx.lineTo(x - 1.6 + swing, y + 6.4);
    ctx.moveTo(x + 1.6, y + 2);
    ctx.lineTo(x + 1.6 - swing, y + 6.4);
    ctx.stroke();
    // coat
    ctx.fillStyle = "#3f5d7a";
    roundRect(ctx, x - 4, y - 3, 8, 6.4, 2.4);
    ctx.fill();
    // head
    ctx.fillStyle = "#e3c39c";
    ctx.beginPath();
    ctx.arc(x, y - 5.4, 2.8, 0, Math.PI * 2);
    ctx.fill();
    // flat cap
    ctx.fillStyle = "#26221c";
    ctx.beginPath();
    ctx.ellipse(x, y - 6.8, 3.6, 1.7, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(x - 3.6, y - 7, 5.2, 1.2);
    // chalk bag on the hip
    ctx.fillStyle = "#d8cdb2";
    ctx.fillRect(x + 2.6, y + 0.4, 2.6, 3);
    ctx.globalAlpha = 1;
  }

  /* ---------- boot & loop ---------- */

  makeVignette();
  buildLevel(0);
  showScreen("title");
  updateHud();

  var last = performance.now();
  function frame(ts) {
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
