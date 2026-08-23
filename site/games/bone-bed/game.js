/* Bone Bed — excavate a buried fossil without cracking it.
   Pick bites fast but damages bone; brush is slow but safe; probes ghost
   hidden bones through the rock. Free and clean every bone to win. */
(function () {
  "use strict";

  // ---------- constants ----------
  var COLS = 18;
  var ROWS = 13;
  var CELL = 48; // logical px per cell
  var VIEW_W = COLS * CELL;
  var VIEW_H = ROWS * CELL;
  var PICK_RATE = 7.5; // matrix units per second
  var BRUSH_DIG_RATE = 2.6;
  var BRUSH_CLEAN_RATE = 90; // percent per second on exposed bone
  var HURT_TICK = 0.35; // seconds between pick damage ticks on bone
  var HURT_DAMAGE = 4; // integrity lost per crack
  var PROBE_MAX = 5;
  var PROBE_RADIUS = 2.4; // cells
  var PROBE_FADE = 5.0; // seconds a probe ghost lasts

  var BAND_COLORS = ["#b3895a", "#9c7044", "#7f5632", "#684227"];
  var CAVITY = "#211509";
  var BONE_FILL = "#f2e6cd";
  var CRACK_COLOR = "#7c4630";

  // ---------- dom ----------
  var canvas = document.getElementById("dig");
  var ctx = canvas.getContext("2d");
  var overlayEl = document.getElementById("overlay");
  var panels = {
    intro: document.getElementById("panel-intro"),
    pause: document.getElementById("panel-pause"),
    win: document.getElementById("panel-win"),
    lose: document.getElementById("panel-lose"),
  };
  var integrityBar = document.getElementById("integrity-bar");
  var probePipsEl = document.getElementById("probe-pips");
  var clockEl = document.getElementById("clock-value");
  var toolBtns = {
    pick: document.getElementById("tool-pick"),
    brush: document.getElementById("tool-brush"),
    probe: document.getElementById("tool-probe"),
  };
  var soundBtn = document.getElementById("btn-sound");

  // ---------- helpers ----------
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function mix(c1, c2, t) {
    var a = parseInt(c1.slice(1), 16);
    var b = parseInt(c2.slice(1), 16);
    var r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
    var g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
    var bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
    return "rgb(" + r + "," + g + "," + bl + ")";
  }

  function bandOf(y) {
    return y < 4 ? 0 : y < 8 ? 1 : y < 11 ? 2 : 3;
  }

  function fmtTime(s) {
    var m = Math.floor(s / 60);
    var ss = Math.floor(s % 60);
    return m + ":" + (ss < 10 ? "0" : "") + ss;
  }

  // ---------- audio ----------
  var audio = {
    ctx: null,
    master: null,
    muted: false,
    ensure: function () {
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    },
    setMuted: function (m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.5;
      soundBtn.classList.toggle("muted", m);
    },
    tone: function (freq, endFreq, dur, type, vol) {
      var ac = this.ensure();
      if (!ac) return;
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, ac.currentTime);
      if (endFreq)
        o.frequency.exponentialRampToValueAtTime(endFreq, ac.currentTime + dur);
      g.gain.setValueAtTime(vol, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g);
      g.connect(this.master);
      o.start();
      o.stop(ac.currentTime + dur + 0.02);
    },
    noise: function (dur, cutoff, vol, type) {
      var ac = this.ensure();
      if (!ac) return;
      var n = Math.max(1, Math.floor(ac.sampleRate * dur));
      var buf = ac.createBuffer(1, n, ac.sampleRate);
      var dta = buf.getChannelData(0);
      for (var i = 0; i < n; i++) dta[i] = Math.random() * 2 - 1;
      var src = ac.createBufferSource();
      src.buffer = buf;
      var f = ac.createBiquadFilter();
      f.type = type || "lowpass";
      f.frequency.value = cutoff;
      var g = ac.createGain();
      g.gain.setValueAtTime(vol, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start();
    },
    pickHit: function () {
      this.tone(130 + Math.random() * 90, 70, 0.07, "square", 0.12);
      this.noise(0.05, 2200, 0.06, "highpass");
    },
    brushSwish: function () {
      this.noise(0.09, 850, 0.045, "bandpass");
    },
    crack: function () {
      this.noise(0.22, 420, 0.4, "lowpass");
      this.tone(82, 44, 0.22, "sine", 0.3);
    },
    probe: function () {
      this.tone(620, 990, 0.26, "sine", 0.16);
      this.tone(310, 495, 0.26, "sine", 0.08);
    },
    chime: function () {
      this.tone(880, 0, 0.12, "triangle", 0.12);
      var self = this;
      setTimeout(function () {
        self.tone(1318, 0, 0.16, "triangle", 0.1);
      }, 90);
    },
    win: function () {
      var self = this;
      [523, 659, 784, 1047].forEach(function (f, i) {
        setTimeout(function () {
          self.tone(f, 0, 0.22, "triangle", 0.16);
        }, i * 120);
      });
    },
    lose: function () {
      this.tone(200, 70, 0.7, "sawtooth", 0.18);
      this.noise(0.5, 300, 0.2, "lowpass");
    },
  };

  // ---------- field ----------
  // The specimen: a long-necked sauropod, stamped into a boolean mask.
  var boneMask = new Uint8Array(COLS * ROWS);

  function stampEllipse(cx, cy, rx, ry) {
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var dx = (x + 0.5 - cx) / rx;
        var dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) boneMask[y * COLS + x] = 1;
      }
    }
  }

  function stampLine(x1, y1, x2, y2, w1, w2) {
    var steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 6) + 1;
    for (var s = 0; s <= steps; s++) {
      var t = s / steps;
      var px = x1 + (x2 - x1) * t;
      var py = y1 + (y2 - y1) * t;
      var r = (w1 + (w2 - w1) * t) / 2;
      for (var y = Math.floor(py - r - 1); y <= py + r + 1; y++) {
        for (var x = Math.floor(px - r - 1); x <= px + r + 1; x++) {
          if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
          var dx = x + 0.5 - px;
          var dy = y + 0.5 - py;
          if (dx * dx + dy * dy <= r * r) boneMask[y * COLS + x] = 1;
        }
      }
    }
  }

  function buildMask() {
    boneMask.fill(0);
    stampEllipse(2.4, 2.1, 2.1, 1.7); // skull
    stampLine(3.2, 2.6, 6.4, 6.0, 2.0, 2.4); // neck
    stampEllipse(7.5, 7.7, 3.4, 2.15); // body
    stampLine(10.4, 7.1, 16.0, 3.5, 2.0, 0.9); // tail
    stampLine(4.6, 9.2, 4.6, 12.2, 1.9, 1.9); // front leg
    stampLine(8.8, 9.2, 8.8, 12.2, 1.9, 1.9); // rear leg
    boneMask[1 * COLS + 2] = 0; // eye notch in the skull
  }

  var field;

  function newField() {
    buildMask();
    var rng = mulberry32((Math.random() * 0xffffffff) | 0);
    field = {
      depth: new Float32Array(COLS * ROWS),
      maxDepth: new Float32Array(COLS * ROWS),
      bone: new Uint8Array(boneMask),
      clean: new Float32Array(COLS * ROWS),
      cracks: new Uint8Array(COLS * ROWS),
      speck: [],
      boneCount: 0,
    };
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var i = y * COLS + x;
        var base = 1.8 + bandOf(y) * 0.38;
        field.maxDepth[i] = base + rng() * 0.7;
        field.depth[i] = field.maxDepth[i];
        if (field.bone[i]) field.boneCount++;
        var dots = [];
        for (var k = 0; k < 5; k++) {
          dots.push({
            dx: rng(),
            dy: rng(),
            r: 1 + rng() * 2.2,
            a: 0.12 + rng() * 0.22,
            light: rng() > 0.5,
          });
        }
        field.speck.push(dots);
      }
    }
  }

  // ---------- state ----------
  var state;

  function newState() {
    return {
      mode: "intro", // intro | playing | paused | won | lost
      tool: "pick",
      time: 0,
      integrity: 100,
      probes: PROBE_MAX,
      workX: -1,
      workY: -1,
      working: false,
      hoverX: -1,
      hoverY: -1,
      hurtTimer: 0,
      brushSfxTimer: 0,
      shake: 0,
      particles: [],
      probesCast: [], // {cx, cy, age, cells:[i...]}
    };
  }

  function resetGame(startPlaying) {
    newField();
    state = newState();
    if (startPlaying) state.mode = "playing";
    syncTools();
    syncHud(true);
  }

  // ---------- canvas sizing ----------
  function fitCanvas() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(VIEW_W * dpr);
    canvas.height = Math.round(VIEW_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------- input ----------
  function cellFromEvent(e) {
    var rect = canvas.getBoundingClientRect();
    var x = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
    var y = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS);
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
    return { x: x, y: y };
  }

  var activePointer = null;

  canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  canvas.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    audio.ensure();
    var c = cellFromEvent(e);
    if (!c || state.mode !== "playing") return;
    activePointer = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* older browsers */
    }
    state.working = true;
    state.workX = c.x;
    state.workY = c.y;
    if (state.tool === "probe") castProbe(c.x, c.y);
  });

  canvas.addEventListener("pointermove", function (e) {
    var c = cellFromEvent(e);
    if (c) {
      state.hoverX = c.x;
      state.hoverY = c.y;
    } else {
      state.hoverX = -1;
      state.hoverY = -1;
    }
    if (activePointer !== null && e.pointerId === activePointer && c) {
      state.workX = c.x;
      state.workY = c.y;
    }
  });

  function releasePointer(e) {
    if (activePointer === null || e.pointerId !== activePointer) return;
    activePointer = null;
    state.working = false;
    state.hurtTimer = 0;
  }

  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);

  function selectTool(t) {
    if (state.mode === "intro" || state.mode === "won" || state.mode === "lost")
      return;
    if (t === "probe" && state.probes <= 0) return;
    state.tool = t;
    syncTools();
  }

  Object.keys(toolBtns).forEach(function (t) {
    toolBtns[t].addEventListener("click", function () {
      audio.ensure();
      selectTool(t);
    });
  });

  document.addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    if (k === "1") selectTool("pick");
    else if (k === "2") selectTool("brush");
    else if (k === "3") selectTool("probe");
    else if (k === "m") audio.setMuted(!audio.muted);
    else if (k === "r") {
      resetGame(true);
      showPanel(null);
    } else if (k === "p" || k === "escape") {
      if (state.mode === "playing") pauseGame();
      else if (state.mode === "paused") resumeGame();
    } else if (k === "enter" || k === " ") {
      if (state.mode === "intro") {
        e.preventDefault();
        startGame();
      } else if (state.mode === "paused") {
        resumeGame();
      } else if (state.mode === "won" || state.mode === "lost") {
        resetGame(true);
        showPanel(null);
      }
      if (state.mode === "playing") e.preventDefault();
    }
  });

  document.getElementById("btn-start").addEventListener("click", function () {
    audio.ensure();
    startGame();
  });
  document.getElementById("btn-resume").addEventListener("click", resumeGame);
  document.getElementById("btn-again").addEventListener("click", function () {
    resetGame(true);
    showPanel(null);
  });
  document.getElementById("btn-retry").addEventListener("click", function () {
    resetGame(true);
    showPanel(null);
  });
  document.getElementById("btn-restart").addEventListener("click", function () {
    resetGame(true);
    showPanel(null);
  });
  document.getElementById("btn-pause").addEventListener("click", function () {
    if (state.mode === "playing") pauseGame();
    else if (state.mode === "paused") resumeGame();
  });
  soundBtn.addEventListener("click", function () {
    audio.ensure();
    audio.setMuted(!audio.muted);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state.mode === "playing") pauseGame();
  });

  function startGame() {
    resetGame(true);
    showPanel(null);
  }

  function pauseGame() {
    if (state.mode !== "playing") return;
    state.mode = "paused";
    state.working = false;
    showPanel("pause");
  }

  function resumeGame() {
    if (state.mode !== "paused") return;
    state.mode = "playing";
    showPanel(null);
  }

  function showPanel(name) {
    Object.keys(panels).forEach(function (key) {
      panels[key].classList.toggle("hidden", key !== name);
    });
    overlayEl.classList.toggle("gone", !name);
  }

  function syncTools() {
    Object.keys(toolBtns).forEach(function (t) {
      toolBtns[t].setAttribute(
        "aria-pressed",
        state.tool === t ? "true" : "false",
      );
      if (t === "probe") toolBtns.probe.disabled = state.probes <= 0;
    });
  }

  var lastClockText = "";
  var lastBarWidth = -1;
  var lastPipKey = "";

  function syncHud(force) {
    var clockText = fmtTime(state.time);
    if (clockText !== lastClockText || force) {
      clockEl.textContent = clockText;
      lastClockText = clockText;
    }
    var w = Math.round(clamp(state.integrity, 0, 100));
    if (w !== lastBarWidth || force) {
      integrityBar.style.width = w + "%";
      integrityBar.classList.toggle("hurt", w < 45);
      lastBarWidth = w;
    }
    var key = "";
    for (var i = 0; i < PROBE_MAX; i++) key += i < state.probes ? "1" : "0";
    if (key !== lastPipKey || force) {
      var html = "";
      for (var j = 0; j < PROBE_MAX; j++) {
        html +=
          "<span" + (j < state.probes ? "" : ' class="spent"') + ">●</span>";
      }
      probePipsEl.innerHTML = html;
      lastPipKey = key;
      toolBtns.probe.disabled = state.probes <= 0;
      if (state.tool === "probe" && state.probes <= 0) selectTool("pick");
    }
  }

  // ---------- mechanics ----------
  function castProbe(cx, cy) {
    if (state.probes <= 0) return;
    state.probes--;
    audio.probe();
    var cells = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (!field.bone[y * COLS + x]) continue;
        if (field.depth[y * COLS + x] <= 0) continue;
        var d = Math.hypot(x + 0.5 - (cx + 0.5), y + 0.5 - (cy + 0.5));
        if (d <= PROBE_RADIUS) cells.push(y * COLS + x);
      }
    }
    state.probesCast.push({ cx: cx, cy: cy, age: 0, cells: cells });
    if (cells.length) spawnSparkle(cx, cy, 6, "#9fe0ff");
    syncTools();
  }

  function spawnDebris(x, y, n) {
    for (var i = 0; i < n; i++) {
      state.particles.push({
        x: (x + Math.random()) * CELL,
        y: (y + Math.random()) * CELL,
        vx: (Math.random() - 0.5) * 90,
        vy: -30 - Math.random() * 80,
        life: 0.5 + Math.random() * 0.4,
        age: 0,
        size: 2 + Math.random() * 3,
        color: Math.random() > 0.4 ? "#a97e52" : "#6d4a2c",
      });
    }
  }

  function spawnSparkle(x, y, n, color) {
    for (var i = 0; i < n; i++) {
      var ang = Math.random() * Math.PI * 2;
      var sp = 20 + Math.random() * 70;
      state.particles.push({
        x: (x + 0.5) * CELL,
        y: (y + 0.5) * CELL,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 30,
        life: 0.5 + Math.random() * 0.5,
        age: 0,
        size: 1.5 + Math.random() * 2.5,
        color: color,
      });
    }
  }

  function crackBone(i, x, y) {
    field.cracks[i]++;
    state.integrity = clamp(state.integrity - HURT_DAMAGE, 0, 100);
    state.shake = 0.4;
    audio.crack();
    spawnDebris(x, y, 8);
    if (state.integrity <= 0) loseGame();
  }

  function applyPick(dt) {
    var x = state.workX;
    var y = state.workY;
    if (x < 0 || y < 0) return;
    var i = y * COLS + x;
    if (field.depth[i] > 0) {
      field.depth[i] = Math.max(0, field.depth[i] - PICK_RATE * dt);
      if (Math.random() < dt * 14) spawnDebris(x, y, 1);
      if (Math.random() < dt * 9) audio.pickHit();
    } else if (field.bone[i]) {
      state.hurtTimer += dt;
      if (state.hurtTimer >= HURT_TICK) {
        state.hurtTimer = 0;
        crackBone(i, x, y);
      }
    }
  }

  function applyBrush(dt) {
    var x = state.workX;
    var y = state.workY;
    if (x < 0 || y < 0) return;
    var i = y * COLS + x;
    if (field.depth[i] > 0) {
      field.depth[i] = Math.max(0, field.depth[i] - BRUSH_DIG_RATE * dt);
      if (Math.random() < dt * 6) spawnDebris(x, y, 1);
    } else if (field.bone[i] && field.clean[i] < 100) {
      var before = field.clean[i];
      field.clean[i] = Math.min(100, field.clean[i] + BRUSH_CLEAN_RATE * dt);
      if (before < 100 && field.clean[i] >= 100) {
        audio.chime();
        spawnSparkle(x, y, 8, "#fff3cf");
      }
    }
    state.brushSfxTimer -= dt;
    if (state.brushSfxTimer <= 0) {
      state.brushSfxTimer = 0.13;
      audio.brushSwish();
    }
  }

  function checkWin() {
    if (state.integrity <= 0) return;
    for (var i = 0; i < COLS * ROWS; i++) {
      if (field.bone[i] && (field.depth[i] > 0 || field.clean[i] < 100)) return;
    }
    winGame();
  }

  function gradeFor(integrity, time) {
    if (integrity >= 96 && time < 170) return "S";
    if (integrity >= 88) return "A";
    if (integrity >= 74) return "B";
    return "C";
  }

  function winGame() {
    state.mode = "won";
    state.working = false;
    var g = gradeFor(state.integrity, state.time);
    document.getElementById("win-summary").textContent =
      "Skeleton recovered: " +
      field.boneCount +
      " bones clean, fossil intact at " +
      Math.round(state.integrity) +
      "%, in " +
      fmtTime(state.time) +
      ".";
    document.getElementById("win-grade").textContent = "Field grade: " + g;
    showPanel("win");
    audio.win();
  }

  function loseGame() {
    state.mode = "lost";
    state.working = false;
    showPanel("lose");
    audio.lose();
  }

  // ---------- update ----------
  function update(dt) {
    state.time += dt;
    state.shake = Math.max(0, state.shake - dt * 1.6);
    if (state.working) {
      if (state.tool === "pick") applyPick(dt);
      else if (state.tool === "brush") applyBrush(dt);
    }
    for (var i = state.particles.length - 1; i >= 0; i--) {
      var p = state.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        state.particles.splice(i, 1);
        continue;
      }
      p.vy += 260 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (var q = state.probesCast.length - 1; q >= 0; q--) {
      state.probesCast[q].age += dt;
      if (state.probesCast[q].age > PROBE_FADE) state.probesCast.splice(q, 1);
    }
    checkWin();
  }

  // ---------- render ----------
  function drawBoneBlock(px, py, alpha, clean, cracks, seed) {
    var rng = mulberry32(seed * 7919 + 13);
    ctx.globalAlpha = alpha;
    var inset = 4;
    var r = 9;
    var x = px + inset;
    var y = py + inset;
    var w = CELL - inset * 2;
    var h = CELL - inset * 2;
    ctx.fillStyle = BONE_FILL;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y + 1.5);
    ctx.lineTo(x + w - r, y + 1.5);
    ctx.stroke();
    ctx.strokeStyle = "rgba(120,90,50,0.35)";
    ctx.beginPath();
    ctx.moveTo(x + r, y + h - 1.5);
    ctx.lineTo(x + w - r, y + h - 1.5);
    ctx.stroke();
    if (clean < 100) {
      ctx.globalAlpha = alpha * (1 - clean / 100) * 0.45;
      ctx.fillStyle = "#a98f66";

      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = CRACK_COLOR;
    ctx.lineWidth = 2;
    for (var c = 0; c < cracks; c++) {
      var sx = x + w * (0.25 + rng() * 0.5);
      var sy = y + h * (0.2 + rng() * 0.6);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      var cx2 = sx;
      var cy2 = sy;
      for (var sgi = 0; sgi < 3; sgi++) {
        cx2 += (rng() - 0.5) * w * 0.5;
        cy2 += (rng() - 0.5) * h * 0.5;
        ctx.lineTo(clamp(cx2, x, x + w), clamp(cy2, y, y + h));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    var shakeX = state.shake ? (Math.random() - 0.5) * 7 * state.shake : 0;
    var shakeY = state.shake ? (Math.random() - 0.5) * 7 * state.shake : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    ctx.clearRect(-8, -8, VIEW_W + 16, VIEW_H + 16);
    ctx.fillStyle = "#160d07";
    ctx.fillRect(-8, -8, VIEW_W + 16, VIEW_H + 16);

    var x;
    var y;
    for (y = 0; y < ROWS; y++) {
      for (x = 0; x < COLS; x++) {
        var i = y * COLS + x;
        var px = x * CELL;
        var py = y * CELL;
        if (field.depth[i] > 0) {
          var f = field.depth[i] / field.maxDepth[i];
          var col = mix(BAND_COLORS[bandOf(y)], "#2b1c10", (1 - f) * 0.9);
          ctx.fillStyle = col;
          ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
          var dots = field.speck[i];
          for (var k = 0; k < dots.length; k++) {
            var dspot = dots[k];
            ctx.globalAlpha = dspot.a * (0.35 + 0.65 * f);
            ctx.fillStyle = dspot.light ? "#e0bd85" : "#3a2716";
            ctx.fillRect(
              px + 2 + dspot.dx * (CELL - 5),
              py + 2 + dspot.dy * (CELL - 5),
              dspot.r,
              dspot.r,
            );
          }
          ctx.globalAlpha = 1;
        } else if (!field.bone[i]) {
          ctx.fillStyle = CAVITY;
          ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
        }
        if (field.bone[i] && field.depth[i] < 1.2) {
          var alpha = clamp(1 - field.depth[i] / 1.2, 0.12, 1);
          drawBoneBlock(px, py, alpha, field.clean[i], field.cracks[i], i);
        }
      }
    }

    for (var qi = 0; qi < state.probesCast.length; qi++) {
      var pr = state.probesCast[qi];
      var fade = 1 - pr.age / PROBE_FADE;
      ctx.strokeStyle = "rgba(159,224,255," + (0.75 * fade).toFixed(3) + ")";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      for (var ci = 0; ci < pr.cells.length; ci++) {
        var cellIdx = pr.cells[ci];
        var gx = (cellIdx % COLS) * CELL;
        var gy = Math.floor(cellIdx / COLS) * CELL;
        ctx.strokeRect(gx + 4, gy + 4, CELL - 8, CELL - 8);
      }
      ctx.setLineDash([]);
      ctx.strokeStyle =
        "rgba(159,224,255," + (0.5 * fade * fade).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(
        (pr.cx + 0.5) * CELL,
        (pr.cy + 0.5) * CELL,
        8 + pr.age * 90,
        0,
        7,
      );
      ctx.stroke();
    }

    for (var pi = 0; pi < state.particles.length; pi++) {
      var pt = state.particles[pi];
      ctx.globalAlpha = 1 - pt.age / pt.life;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    if (
      state.mode === "playing" &&
      state.hoverX >= 0 &&
      state.tool !== "probe"
    ) {
      ctx.strokeStyle = "rgba(255,214,140,0.85)";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        state.hoverX * CELL + 2,
        state.hoverY * CELL + 2,
        CELL - 4,
        CELL - 4,
      );
    }

    ctx.restore();
  }

  // ---------- main loop ----------
  var lastTs = 0;

  function frame(ts) {
    var dt = Math.min(0.05, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    if (state.mode === "playing") update(dt);
    else {
      for (var i = state.particles.length - 1; i >= 0; i--) {
        var p = state.particles[i];
        p.age += dt;
        if (p.age >= p.life) state.particles.splice(i, 1);
      }
      state.shake = Math.max(0, state.shake - dt * 1.6);
    }
    render();
    syncHud(false);
    requestAnimationFrame(frame);
  }

  // ---------- boot ----------
  fitCanvas();
  window.addEventListener("resize", fitCanvas);
  resetGame(false);
  showPanel("intro");
  requestAnimationFrame(frame);

  // Optional debug handle for automated tests only.
  if (window.location.hash === "#debug") {
    window.__bonebed = {
      state: function () {
        return state;
      },
      field: function () {
        return field;
      },
      forceWin: winGame,
      forceLose: loseGame,
      finishDig: function () {
        for (var i = 0; i < COLS * ROWS; i++) {
          if (field.bone[i]) field.depth[i] = 0;
        }
      },
    };
  }
})();
