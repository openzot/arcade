/* Topping Out — a barn-raising crane game for the arcade.
   Run the trolley, pay out the rope, and loose each swinging timber
   over its chalk mark. Five walls between dawn and sundown.
   Everything lives in this one classic script, wrapped in an IIFE. */
(function () {
  "use strict";

  /* ── dom ─────────────────────────────────────────────── */
  var cvs = document.getElementById("game");
  var ctx = cvs.getContext("2d");
  var hudDay = document.getElementById("hud-day");
  var hudStack = document.getElementById("hud-stack");
  var hudScore = document.getElementById("hud-score");
  var hudWind = document.getElementById("hud-wind");
  var hudLives = document.getElementById("hud-lives");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ov-title");
  var ovText = document.getElementById("ov-text");
  var ovBtn = document.getElementById("ov-btn");
  var btnSound = document.getElementById("btn-sound");
  var btnPause = document.getElementById("btn-pause");
  var btnRestart = document.getElementById("btn-restart");

  /* ── tiny helpers ────────────────────────────────────── */
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function rand(a, b) {
    return a + Math.random() * (b - a);
  }
  function blurActive() {
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  }

  /* ── audio: synthesised, nothing fetched ─────────────── */
  var audioCtx = null;
  var master = null;
  var muted = false;

  function initAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) {
      try {
        audioCtx = new AC();
        master = audioCtx.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(audioCtx.destination);
      } catch (err) {
        audioCtx = null;
      }
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!audioCtx || muted) return;
    var t0 = audioCtx.currentTime + (delay || 0);
    var o = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo)
      o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function noise(dur, vol, fc, q, delay) {
    if (!audioCtx || muted) return;
    var t0 = audioCtx.currentTime + (delay || 0);
    var n = Math.floor(audioCtx.sampleRate * dur);
    var buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
    var d = buf.getChannelData(0);
    var i;
    for (i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    var src = audioCtx.createBufferSource();
    src.buffer = buf;
    var f = audioCtx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = fc;
    f.Q.value = q || 1;
    var g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
  }

  var sThunk = function () {
    tone(95, 0.13, "triangle", 0.5, 55);
    noise(0.07, 0.28, 320, 1);
  };
  var sSet = function () {
    tone(300, 0.09, "square", 0.15);
    noise(0.05, 0.14, 520, 1);
  };
  var sPerfect = function () {
    tone(660, 0.14, "sine", 0.24);
    tone(880, 0.16, "sine", 0.2, undefined, 0.06);
    tone(1320, 0.18, "sine", 0.13, undefined, 0.12);
  };
  var sBreak = function () {
    noise(0.22, 0.5, 850, 0.8);
    tone(72, 0.22, "sawtooth", 0.3, 38);
  };
  var sCreak = function () {
    tone(150 + rand(-20, 20), 0.28, "sawtooth", 0.05, 195);
  };
  var sTick = function () {
    tone(1050, 0.04, "square", 0.07);
  };
  var sWhoosh = function () {
    noise(0.14, 0.1, 600, 1);
  };
  var sCheer = function () {
    noise(0.9, 0.26, 1100, 0.6);
    tone(392, 0.5, "triangle", 0.11, undefined, 0.05);
    tone(494, 0.5, "triangle", 0.11, undefined, 0.16);
    tone(587, 0.6, "triangle", 0.11, undefined, 0.27);
  };
  var sFail = function () {
    tone(220, 0.35, "triangle", 0.2, 140);
    tone(160, 0.5, "triangle", 0.18, 90, 0.2);
  };

  /* ── constants ───────────────────────────────────────── */
  var W = 960;
  var H = 540;
  var GROUND = 478;
  var FOUND = { x: 250, y: 452, w: 460, h: 26 };
  var JIB_Y = 96;
  var ANCHOR_Y = JIB_Y + 14;
  var MAST_X = 100;
  var TX_MIN = 200;
  var TX_MAX = 770;
  var CABLE_MIN = 70;
  var CABLE_MAX = 290;
  var GRAV = 1500;
  var TH = 26;
  var LONG = 104;
  var SHORT = 56;

  var WIND_NAMES = ["calm", "light breeze", "freshening", "gusty", "hard blow"];

  var DAYS = [
    {
      label: "Dawn",
      wind: 0,
      time: 90,
      rows: [
        ["L", "L", "L"],
        ["L", "L", "L"],
      ],
    },
    {
      label: "Morning",
      wind: 6,
      time: 85,
      rows: [["L", "L", "L", "L"], ["S", "L", "S"], ["L"]],
    },
    {
      label: "High Noon",
      wind: 12,
      time: 82,
      rows: [
        ["L", "L", "L", "L"],
        ["S", "L", "S", "L", "S"],
        ["S", "S"],
      ],
    },
    {
      label: "Afternoon",
      wind: 18,
      time: 80,
      rows: [
        ["L", "L", "L", "L"],
        ["L", "S", "L", "L"],
        ["S", "L", "S"],
        ["S"],
      ],
    },
    {
      label: "Sundown Run",
      wind: 26,
      time: 78,
      rows: [
        ["L", "L", "L", "L"],
        ["L", "L", "L", "L"],
        ["L", "S", "L"],
        ["S", "S"],
        ["S"],
      ],
    },
  ];

  /* ── state ───────────────────────────────────────────── */
  var state = "menu"; /* menu | play | daydone | fail | won */
  var paused = false;
  var dayIdx = 0;
  var day = DAYS[0];
  var slots = [];
  var built = [];
  var score = 0;
  var dayScoreStart = 0;
  var lives = 3;
  var timeLeft = 90;
  var tx = 480;
  var tvx = 0;
  var cable = 190;
  var th = 0.1;
  var om = 0;
  var carrying = true;
  var free = null;
  var respawn = 0;
  var elapsed = 0;
  var shake = 0;
  var cheerT = 0;
  var doneT = 0;
  var overlayPending = false;
  var lastTick = -1;

  var parts = [];
  var floats = [];
  var tumble = [];

  var clouds = [
    { x: 120, y: 84, s: 1.3, v: 9 },
    { x: 420, y: 130, s: 0.9, v: 13 },
    { x: 700, y: 66, s: 1.1, v: 7 },
    { x: 880, y: 150, s: 0.7, v: 16 },
  ];

  var keys = { left: false, right: false, up: false, down: false };

  /* ── layout / day setup ──────────────────────────────── */
  function layoutDay(d) {
    slots = [];
    var r, row, widths, gap, total, sx, y, cx, i;
    for (r = 0; r < d.rows.length; r++) {
      row = d.rows[r];
      widths = row.map(function (c) {
        return c === "L" ? LONG : SHORT;
      });
      gap = 6;
      total = gap * (widths.length - 1);
      for (i = 0; i < widths.length; i++) total += widths[i];
      sx = FOUND.x + (FOUND.w - total) / 2;
      y = FOUND.y - (r + 1) * TH;
      cx = sx;
      for (i = 0; i < widths.length; i++) {
        slots.push({
          x: cx,
          y: y,
          w: widths[i],
          h: TH,
          cx: cx + widths[i] / 2,
        });
        cx += widths[i] + gap;
      }
    }
    built = [];
  }

  function setupDay(i) {
    dayIdx = i;
    day = DAYS[i];
    layoutDay(day);
    lives = 3;
    timeLeft = day.time;
    lastTick = -1;
    tx = (TX_MIN + TX_MAX) / 2;
    tvx = 0;
    cable = 190;
    th = rand(-0.12, 0.12);
    om = 0;
    carrying = true;
    free = null;
    respawn = 0;
    cheerT = 0;
    doneT = 0;
    overlayPending = false;
    dayScoreStart = score;
    syncHud(true);
  }

  function startGame() {
    score = 0;
    setupDay(0);
    state = "play";
    paused = false;
    hideOverlay();
  }

  function retryDay() {
    score = dayScoreStart;
    setupDay(dayIdx);
    state = "play";
    hideOverlay();
  }

  function nextDay() {
    if (dayIdx >= DAYS.length - 1) {
      showWin();
      return;
    }
    setupDay(dayIdx + 1);
    state = "play";
    hideOverlay();
  }

  function fullReset(toMenu) {
    score = 0;
    parts.length = 0;
    floats.length = 0;
    tumble.length = 0;
    free = null;
    paused = false;
    setupDay(0);
    if (toMenu) {
      state = "menu";
      showMenu();
    } else {
      state = "play";
      hideOverlay();
    }
  }

  /* ── overlay plumbing ────────────────────────────────── */
  var ovAction = null;

  function showOverlay(title, html, btnLabel, fn) {
    ovTitle.textContent = title;
    ovText.innerHTML = html;
    ovBtn.textContent = btnLabel;
    ovAction = fn;
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
    ovAction = null;
    blurActive();
  }

  function overlayVisible() {
    return !overlay.classList.contains("hidden");
  }

  function showMenu() {
    showOverlay(
      "Topping Out",
      '<p class="big">Five walls between dawn and sundown.</p>' +
        "<p>Run the trolley, pay out the rope, and loose each swinging timber " +
        "over its chalk mark. The swing is yours to spend.</p>" +
        "<ul>" +
        "<li>&#8592; &#8594; run the trolley along the jib</li>" +
        "<li>&#8593; &#8595; haul in or pay out the cable</li>" +
        "<li>Space / Enter / DROP lets the load go</li>" +
        "</ul>" +
        '<p class="fine">Dead-centre drops pay triple. Miss the chalk and you ' +
        "smash timber &mdash; three breaks and the crew down tools. Watch the " +
        "pennant on the jib: the wind picks up all week.</p>",
      "Raise the walls",
      function () {
        hideOverlay();
        startGame();
      },
    );
  }

  function showDayDone() {
    var bonus = Math.ceil(timeLeft) * 2;
    var last = dayIdx >= DAYS.length - 1;
    var html =
      '<p class="big">The ' +
      day.label.toLowerCase() +
      " wall stands.</p>" +
      "<p>Timbers set " +
      built.length +
      " / " +
      slots.length +
      " &middot; Sun bonus +" +
      bonus +
      "</p>" +
      "<p>Total score <span class='big'>" +
      score +
      "</span></p>";
    if (last) {
      showWin();
    } else {
      showOverlay("Wall raised!", html, "Next day", function () {
        hideOverlay();
        nextDay();
      });
    }
  }

  function showWin() {
    state = "won";
    showOverlay(
      "Barn raised!",
      '<p class="big">Five walls. One barn. Not a soul crushed.</p>' +
        "<p>Final score <span class='big'>" +
        score +
        "</span></p>" +
        '<p class="fine">The crew signs the ridge beam. You get the first ' +
        "slice of pie at the dance tonight.</p>",
      "Build it again",
      function () {
        hideOverlay();
        startGame();
      },
    );
  }

  function endFail(title, body) {
    state = "fail";
    sFail();
    showOverlay(title, body, "Retry day " + (dayIdx + 1), function () {
      hideOverlay();
      retryDay();
    });
  }

  function pauseGame() {
    if (state !== "play" || paused) return;
    paused = true;
    showOverlay(
      "Paused",
      "<p>The crew leans on their mauls.</p>",
      "Resume",
      function () {
        paused = false;
        hideOverlay();
      },
    );
  }

  function resumeGame() {
    paused = false;
    hideOverlay();
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    btnSound.textContent = "Sound: " + (muted ? "off" : "on");
  }

  /* ── hud ─────────────────────────────────────────────── */
  var hudCache = {};
  function setChip(el, key, txt) {
    if (hudCache[key] !== txt) {
      hudCache[key] = txt;
      el.textContent = txt;
    }
  }
  function syncHud(force) {
    if (force) hudCache = {};
    setChip(hudDay, "day", "Day " + (dayIdx + 1) + " \u00b7 " + day.label);
    setChip(hudStack, "stack", built.length + " / " + slots.length + " set");
    setChip(hudScore, "score", "Score " + score);
    var wi = Math.min(WIND_NAMES.length - 1, Math.floor(day.wind / 6));
    setChip(hudWind, "wind", "Wind: " + WIND_NAMES[wi]);
    setChip(
      hudLives,
      "lives",
      lives > 0 ? new Array(lives + 1).join("|") : "\u2013",
    );
  }

  /* ── fx ──────────────────────────────────────────────── */
  function dust(x, y, n, cols) {
    var i;
    for (i = 0; i < n; i++) {
      parts.push({
        x: x + rand(-8, 8),
        y: y,
        vx: rand(-130, 130),
        vy: rand(-260, -40),
        g: 760,
        life: rand(0.4, 0.9),
        t: 0,
        size: rand(2, 5),
        col: cols[(Math.random() * cols.length) | 0],
      });
    }
  }
  function sparkle(x, y) {
    var i;
    for (i = 0; i < 12; i++) {
      parts.push({
        x: x + rand(-20, 20),
        y: y + rand(-8, 8),
        vx: rand(-50, 50),
        vy: rand(-140, -30),
        g: -60,
        life: rand(0.4, 0.8),
        t: 0,
        size: rand(1.5, 3.5),
        col: "#ffd97a",
      });
    }
  }
  function confetti() {
    var cols = ["#e07b39", "#f2cc5c", "#7fa650", "#c9563c", "#f5ead6"];
    var i;
    for (i = 0; i < 30; i++) {
      parts.push({
        x: rand(FOUND.x, FOUND.x + FOUND.w),
        y: rand(FOUND.y - 140, FOUND.y - 40),
        vx: rand(-110, 110),
        vy: rand(-330, -140),
        g: 420,
        life: rand(0.8, 1.5),
        t: 0,
        size: rand(2.5, 5),
        col: cols[(Math.random() * cols.length) | 0],
      });
    }
  }
  function float(txt, x, y, col, big) {
    floats.push({
      txt: txt,
      x: x,
      y: y,
      t: 0,
      life: 1.1,
      col: col || "#f5ead6",
      big: !!big,
    });
  }

  /* ── core mechanics ──────────────────────────────────── */
  function supportTopFor(l, r) {
    var top = FOUND.y;
    var i, b, ov;
    for (i = 0; i < built.length; i++) {
      b = built[i];
      ov = Math.min(r, b.x + b.w) - Math.max(l, b.x);
      if (ov > 8 && b.y < top) top = b.y;
    }
    return top;
  }
  /* chalk mark where the current swing will put the load down */
  function predictLanding() {
    if (!carrying || state !== "play") return null;
    var slot = slots[built.length];
    var w = slot ? slot.w : LONG;
    var hw = w / 2;
    var hx = tx + Math.sin(th) * cable;
    var hy = ANCHOR_Y + Math.cos(th) * cable;
    var y0 = hy + 16;
    var vx0 = tvx + om * cable * Math.cos(th);
    var vy0 = -Math.sin(th) * om * cable + 30;
    var supY = supportTopFor(hx - hw, hx + hw);
    var dy = supY - y0;
    var t = 0;
    if (dy > 4) {
      t = (-vy0 + Math.sqrt(Math.max(0, vy0 * vy0 + 2 * GRAV * dy))) / GRAV;
    }
    var x = hx + vx0 * t + 0.5 * day.wind * 4 * t * t;
    return { x: clamp(x, 12, W - 12), y: supY };
  }

  function tryRelease() {
    if (state !== "play" || paused || !carrying) return;
    carrying = false;
    var hx = tx + Math.sin(th) * cable;
    var hy = ANCHOR_Y + Math.cos(th) * cable;
    var len = slots[built.length] ? slots[built.length].w : LONG;
    free = {
      x: hx,
      y: hy + 16,
      w: len,
      h: TH,
      vx: tvx + om * cable * Math.cos(th),
      vy: -Math.sin(th) * om * cable + 30,
      rot: th,
      vr: om * 0.6,
    };
    sWhoosh();
  }

  function breakLoad(msg) {
    lives--;
    shake = 7;
    sBreak();
    dust(free.x, free.y, 14, ["#8a6236", "#6e4a28", "#b98a4f"]);
    tumble.push({
      x: free.x,
      y: free.y,
      w: free.w,
      h: TH,
      vx: (free.vx >= 0 ? 1 : -1) * rand(90, 190),
      vy: -160,
      rot: free.rot,
      vr: rand(3, 7) * (free.vx >= 0 ? 1 : -1),
      life: 1.4,
    });
    float(msg, free.x, free.y - 20, "#ff9d6b", true);
    free = null;
    syncHud();
    if (lives <= 0) {
      endFail(
        "Three timbers shy",
        "Three timbers cracked. The foreman calls it before somebody loses a boot.",
      );
    } else {
      respawn = 0.9;
    }
  }

  function landLoad() {
    var supY = supportTopFor(free.x - free.w / 2, free.x + free.w / 2);
    if (free.y + free.h / 2 < supY) return false;
    free.y = supY - free.h / 2;
    var slot = slots[built.length];
    var err = Math.abs(free.x - slot.cx);
    var off;
    if (err <= 14) {
      off = 0;
      built.push({ x: slot.x, y: slot.y, w: slot.w, h: TH });
      score += 60;
      float("TRUE! +60", slot.cx, slot.y - 16, "#ffd97a", true);
      sparkle(slot.cx, slot.y + TH / 2);
      sPerfect();
      shake = 2;
    } else if (err <= 42) {
      off = clamp(free.x - slot.cx, -12, 12);
      built.push({ x: slot.x + off, y: slot.y, w: slot.w, h: TH });
      score += 25;
      float("Set. +25", slot.cx, slot.y - 16, "#f1e4cd");
      sThunk();
      sSet();
      shake = 3;
    } else {
      var miss =
        err > 150
          ? "Clean miss!"
          : free.x > slot.cx
            ? "Wide right!"
            : "Wide left!";
      breakLoad(miss);
      return true;
    }
    dust(free.x, supY, 6, ["#c9b28a", "#8a6236"]);
    free = null;
    syncHud();
    if (built.length === slots.length) {
      dayComplete();
    } else {
      respawn = 0.55;
    }
    return true;
  }

  function smashInto(b, idx) {
    built.splice(idx, 1);
    tumble.push({
      x: b.x + b.w / 2,
      y: b.y + TH / 2,
      w: b.w,
      h: TH,
      vx: (free.x < b.x + b.w / 2 ? -1 : 1) * rand(120, 210),
      vy: -220,
      rot: 0,
      vr: rand(3, 8),
      life: 1.4,
    });
    dust(b.x + b.w / 2, b.y + TH / 2, 12, ["#8a6236", "#6e4a28"]);
    breakLoad("Took one out!");
  }

  function dayComplete() {
    state = "daydone";
    cheerT = 0.0001;
    doneT = 1.7;
    overlayPending = true;
    var bonus = Math.ceil(timeLeft) * 2;
    score += bonus;
    float("Sun bonus +" + bonus, 480, 250, "#ffd97a", true);
    sCheer();
    confetti();
    syncHud();
  }

  /* ── update ──────────────────────────────────────────── */
  function update(dt) {
    elapsed += dt;

    var i;
    for (i = 0; i < clouds.length; i++) {
      clouds[i].x += clouds[i].v * dt;
      if (clouds[i].x > W + 90) clouds[i].x = -90;
    }

    for (i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.t += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.t >= p.life) parts.splice(i, 1);
    }
    for (i = floats.length - 1; i >= 0; i--) {
      var fl = floats[i];
      fl.t += dt;
      fl.y -= 32 * dt;
      if (fl.t >= fl.life) floats.splice(i, 1);
    }
    for (i = tumble.length - 1; i >= 0; i--) {
      var tb = tumble[i];
      tb.life -= dt;
      tb.vy += 900 * dt;
      tb.x += tb.vx * dt;
      tb.y += tb.vy * dt;
      tb.rot += tb.vr * dt;
      if (tb.life <= 0 || tb.y > H + 60) tumble.splice(i, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - 22 * dt);
    if (cheerT > 0) cheerT = Math.min(cheerT + dt, 4);

    if (state === "menu") {
      th = Math.sin(elapsed * 0.9) * 0.16;
      tx = 480 + Math.sin(elapsed * 0.23) * 170;
      return;
    }

    if (state === "daydone" && overlayPending) {
      doneT -= dt;
      if (doneT <= 0) {
        overlayPending = false;
        if (dayIdx >= DAYS.length - 1) {
          showWin();
        } else {
          showDayDone();
        }
      }
    }

    if (state !== "play" || paused) return;

    /* sundown clock */
    timeLeft -= dt;
    var secs = Math.ceil(timeLeft);
    if (secs <= 10 && secs !== lastTick && secs > 0) {
      lastTick = secs;
      sTick();
    }
    if (timeLeft <= 0) {
      timeLeft = 0;
      endFail(
        "Sundown",
        "The light went before the last timber set. Chalk keeps till tomorrow.",
      );
      return;
    }

    /* trolley */
    var ax = 0;
    if (keys.left) ax -= 1;
    if (keys.right) ax += 1;
    ax *= 900;
    tvx += ax * dt;
    tvx *= Math.max(0, 1 - 2.6 * dt);
    tx += tvx * dt;
    if (tx < TX_MIN) {
      tx = TX_MIN;
      tvx = 0;
    }
    if (tx > TX_MAX) {
      tx = TX_MAX;
      tvx = 0;
    }

    /* cable */
    if (keys.up) cable -= 150 * dt;
    if (keys.down) cable += 150 * dt;
    cable = clamp(cable, CABLE_MIN, CABLE_MAX);

    /* pendulum */
    var windSway = day.wind * 0.0035 * Math.sin(elapsed * 0.9);
    var thAcc =
      -(GRAV / cable) * Math.sin(th) -
      1.2 * om -
      (ax / cable) * Math.cos(th) +
      windSway;
    om += thAcc * dt;
    th += om * dt;
    if (th > 1.45) {
      th = 1.45;
      om *= -0.3;
    }
    if (th < -1.45) {
      th = -1.45;
      om *= -0.3;
    }
    if (Math.abs(om) > 1.7 && Math.random() < dt * 2) sCreak();

    /* respawn the next hanging load */
    if (!carrying && !free && respawn > 0) {
      respawn -= dt;
      if (respawn <= 0) {
        carrying = true;
        om *= 0.5;
        syncHud();
      }
    }

    /* free flight */
    if (free) {
      free.vy += GRAV * dt;
      free.vx += day.wind * 4 * dt;
      free.x += free.vx * dt;
      free.y += free.vy * dt;
      free.rot += free.vr * dt;
      free.vr *= Math.max(0, 1 - 0.8 * dt);

      if (free.x < -60 || free.x > W + 60) {
        breakLoad("Lost over the edge!");
        return;
      }

      var hw = free.w / 2;
      var hh = free.h / 2;
      for (i = 0; i < built.length; i++) {
        var b = built[i];
        var ix = Math.min(free.x + hw, b.x + b.w) - Math.max(free.x - hw, b.x);
        var iy = Math.min(free.y + hh, b.y + TH) - Math.max(free.y - hh, b.y);
        if (ix > 4 && iy > 4) {
          if (ix > hw * 0.85 && free.vy > 40) {
            smashInto(b, i);
          } else {
            if (free.x < b.x + b.w / 2) {
              free.x = b.x - hw - 1;
              free.vx = -Math.abs(free.vx) * 0.4 - 60;
            } else {
              free.x = b.x + b.w + hw + 1;
              free.vx = Math.abs(free.vx) * 0.4 + 60;
            }
            free.vy *= 0.55;
            free.vr *= -0.5;
            sThunk();
            shake = 3;
          }
          break;
        }
      }
      if (free) landLoad();
    }
  }

  /* ── drawing ─────────────────────────────────────────── */
  function drawTimber(cx, cy, w, rot, alpha) {
    ctx.save();
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.fillStyle = "#b98a4f";
    ctx.fillRect(-w / 2, -TH / 2, w, TH);
    ctx.strokeStyle = "#7c5527";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-w / 2, -TH / 2, w, TH);
    ctx.strokeStyle = "rgba(110,74,40,0.65)";
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 5, -4);
    ctx.lineTo(w / 2 - 5, -4);
    ctx.moveTo(-w / 2 + 8, 5);
    ctx.lineTo(w / 2 - 8, 5);
    ctx.stroke();
    ctx.fillStyle = "#5d3f22";
    ctx.fillRect(-w / 2 + 3, -2, 3, 3);
    ctx.fillRect(w / 2 - 6, -2, 3, 3);
    ctx.restore();
  }

  function drawCraneAndLoad() {
    /* guy ropes */
    ctx.strokeStyle = "rgba(40,26,14,0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(MAST_X, JIB_Y);
    ctx.lineTo(26, GROUND);
    ctx.moveTo(830, JIB_Y);
    ctx.lineTo(884, GROUND);
    ctx.stroke();

    /* mast */
    ctx.strokeStyle = "#5d3f22";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(MAST_X - 14, GROUND);
    ctx.lineTo(MAST_X, JIB_Y);
    ctx.lineTo(MAST_X + 14, GROUND);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(MAST_X - 9, GROUND - 90);
    ctx.lineTo(MAST_X + 9, GROUND - 140);
    ctx.moveTo(MAST_X + 9, GROUND - 90);
    ctx.lineTo(MAST_X - 9, GROUND - 140);
    ctx.stroke();

    /* jib lattice */
    ctx.fillStyle = "#6e4a28";
    ctx.fillRect(58, JIB_Y - 5, 772, 9);
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    var x0;
    for (x0 = 70; x0 < 820; x0 += 46) {
      ctx.moveTo(x0, JIB_Y + 4);
      ctx.lineTo(x0 + 46, JIB_Y - 4);
    }
    ctx.stroke();

    /* pennant showing the wind */
    var wnd = day.wind;
    var flap = Math.sin(elapsed * (6 + wnd * 0.25)) * (2 + wnd * 0.14);
    var plen = 10 + wnd * 1.1;
    ctx.fillStyle = "#e07b39";
    ctx.beginPath();
    ctx.moveTo(830, JIB_Y - 4);
    ctx.lineTo(830 + plen, JIB_Y - 4 + flap * 0.4);
    ctx.lineTo(830, JIB_Y + 4);
    ctx.closePath();
    ctx.fill();

    /* trolley */
    ctx.fillStyle = "#3b2c1c";
    ctx.beginPath();
    ctx.arc(tx - 14, JIB_Y + 1, 5, 0, Math.PI * 2);
    ctx.arc(tx + 14, JIB_Y + 1, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5d3f22";
    ctx.fillRect(tx - 20, JIB_Y + 6, 40, 14);

    /* rope + hook (+ hanging or free load) */
    if (carrying) {
      var slot = slots[built.length];
      ctx.save();
      ctx.translate(tx, ANCHOR_Y);
      ctx.rotate(th);
      ctx.strokeStyle = "#b08d5f";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, cable);
      ctx.stroke();
      ctx.strokeStyle = "#8a6236";
      ctx.beginPath();
      ctx.arc(0, cable + 5, 4, 0, Math.PI * 2);
      ctx.stroke();
      var lw = slot ? slot.w : LONG;
      drawTimber(0, cable + 16 + TH / 2, lw, 0);
      ctx.restore();
    } else {
      ctx.strokeStyle = "#b08d5f";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(tx, ANCHOR_Y);
      ctx.lineTo(tx, ANCHOR_Y + 20);
      ctx.stroke();
      ctx.strokeStyle = "#8a6236";
      ctx.beginPath();
      ctx.arc(tx, ANCHOR_Y + 25, 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (free) {
      drawTimber(free.x, free.y, free.w, free.rot);
    }
  }

  function drawScene() {
    ctx.save();
    if (shake > 0) {
      ctx.translate(rand(-shake, shake), rand(-shake, shake));
    }

    /* sky */
    var sky = ctx.createLinearGradient(0, 0, 0, H * 0.85);
    sky.addColorStop(0, "#472a54");
    sky.addColorStop(0.55, "#c96a4f");
    sky.addColorStop(0.88, "#f2b06a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    /* sun */
    var u = clamp(1 - timeLeft / day.time, 0, 1);
    var sunX = 110 + 740 * u;
    var sunY = 185 - 125 * Math.sin(Math.PI * u);
    var glow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 64);
    glow.addColorStop(0, "rgba(255,236,170,0.95)");
    glow.addColorStop(1, "rgba(255,236,170,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 66, sunY - 66, 132, 132);
    ctx.fillStyle = "#ffe9b0";
    ctx.beginPath();
    ctx.arc(sunX, sunY, 17, 0, Math.PI * 2);
    ctx.fill();

    /* clouds */
    ctx.fillStyle = "rgba(255,240,225,0.16)";
    var ci, c;
    for (ci = 0; ci < clouds.length; ci++) {
      c = clouds[ci];
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 44 * c.s, 12 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(
        c.x + 26 * c.s,
        c.y - 7 * c.s,
        30 * c.s,
        10 * c.s,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    /* hills + field */
    ctx.fillStyle = "#3d4a2a";
    ctx.beginPath();
    ctx.ellipse(240, 470, 340, 62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#33401f";
    ctx.beginPath();
    ctx.ellipse(760, 480, 360, 58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#57652f";
    ctx.fillRect(0, 430, W, H - 430);
    ctx.fillStyle = "#495627";
    ctx.fillRect(0, 502, W, H - 502);

    /* foundation stones */
    ctx.fillStyle = "#8d8577";
    ctx.fillRect(FOUND.x - 12, FOUND.y, FOUND.w + 24, FOUND.h + 14);
    ctx.strokeStyle = "#6f6759";
    ctx.lineWidth = 2;
    ctx.beginPath();
    var sx2;
    for (sx2 = FOUND.x + 40; sx2 < FOUND.x + FOUND.w; sx2 += 46) {
      ctx.moveTo(sx2, FOUND.y);
      ctx.lineTo(sx2 - 6, FOUND.y + FOUND.h + 14);
    }
    ctx.moveTo(FOUND.x - 12, FOUND.y + 18);
    ctx.lineTo(FOUND.x + FOUND.w + 12, FOUND.y + 18);
    ctx.stroke();
    ctx.fillStyle = "#9a927f";
    ctx.fillRect(FOUND.x - 12, FOUND.y, FOUND.w + 24, 4);

    /* crane behind the wall */
    drawCraneAndLoad();

    /* chalk blueprint ghosts */
    var i, s;
    for (i = built.length; i < slots.length; i++) {
      s = slots[i];
      var front = i === built.length;
      ctx.setLineDash([7, 6]);
      ctx.lineDashOffset = front ? -(elapsed * 26) % 13 : 0;
      ctx.strokeStyle = front
        ? "rgba(255,222,150," +
          (0.65 + 0.3 * Math.sin(elapsed * 5)).toFixed(2) +
          ")"
        : "rgba(245,236,214,0.35)";
      ctx.lineWidth = front ? 2.5 : 1.5;
      if (front && carrying) {
        ctx.fillStyle = "rgba(255,222,150,0.10)";
        ctx.fillRect(s.x + 1.5, s.y + 1.5, s.w - 3, s.h - 3);
      }
      ctx.strokeRect(s.x + 1.5, s.y + 1.5, s.w - 3, s.h - 3);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    /* dropped chevron above the current target */
    if (state === "play" && carrying && slots[built.length]) {
      var tgt = slots[built.length];
      var cy2 = tgt.y - 24 + Math.sin(elapsed * 5) * 4;
      ctx.fillStyle = "rgba(255,217,122,0.92)";
      ctx.beginPath();
      ctx.moveTo(tgt.cx - 9, cy2 - 10);
      ctx.lineTo(tgt.cx + 9, cy2 - 10);
      ctx.lineTo(tgt.cx, cy2);
      ctx.closePath();
      ctx.fill();
    }

    /* landing predictor chalk mark */
    var pred = predictLanding();
    if (pred) {
      ctx.strokeStyle = "rgba(255,222,150,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pred.x - 8, pred.y - 14);
      ctx.lineTo(pred.x + 8, pred.y - 2);
      ctx.moveTo(pred.x + 8, pred.y - 14);
      ctx.lineTo(pred.x - 8, pred.y - 2);
      ctx.stroke();
    }

    /* the wall so far */
    for (i = 0; i < built.length; i++) {
      var b = built[i];
      drawTimber(b.x + b.w / 2, b.y + TH / 2, b.w, 0);
    }

    /* tumbling wreckage */
    for (i = 0; i < tumble.length; i++) {
      var tb = tumble[i];
      drawTimber(tb.x, tb.y, tb.w, tb.rot, clamp(tb.life, 0, 1));
    }

    /* spectators */
    drawSpectator(736, GROUND);
    drawSpectator(768, GROUND);

    /* particles */
    for (i = 0; i < parts.length; i++) {
      var p = parts[i];
      ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    /* floating messages */
    ctx.textAlign = "center";
    for (i = 0; i < floats.length; i++) {
      var fl = floats[i];
      ctx.globalAlpha = clamp(1 - fl.t / fl.life, 0, 1);
      ctx.font = (fl.big ? "700 21px" : "600 15px") + " system-ui, sans-serif";
      ctx.fillStyle = fl.col;
      ctx.fillText(fl.txt, fl.x, fl.y);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawSpectator(x, base) {
    ctx.strokeStyle = "#2f2317";
    ctx.fillStyle = "#2f2317";
    ctx.lineWidth = 3;
    var cheering = cheerT > 0;
    var armY = cheering
      ? base - 58 + Math.sin(elapsed * 10 + x) * 4
      : base - 36;
    ctx.beginPath();
    ctx.moveTo(x - 6, base);
    ctx.lineTo(x, base - 22);
    ctx.lineTo(x + 6, base);
    ctx.moveTo(x, base - 22);
    ctx.lineTo(x, base - 46);
    ctx.moveTo(x, base - 40);
    ctx.lineTo(x - 9, armY);
    ctx.moveTo(x, base - 40);
    ctx.lineTo(x + 9, armY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, base - 53, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 10, base - 57);
    ctx.lineTo(x + 10, base - 57);
    ctx.stroke();
  }

  /* ── input ───────────────────────────────────────────── */
  window.addEventListener("keydown", function (e) {
    initAudio();
    var k = e.key;
    if (
      k === "ArrowLeft" ||
      k === "a" ||
      k === "A" ||
      k === "ArrowRight" ||
      k === "d" ||
      k === "D" ||
      k === "ArrowUp" ||
      k === "w" ||
      k === "W" ||
      k === "ArrowDown" ||
      k === "s" ||
      k === "S"
    ) {
      if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = true;
      if (k === "ArrowRight" || k === "d" || k === "D") keys.right = true;
      if (k === "ArrowUp" || k === "w" || k === "W") keys.up = true;
      if (k === "ArrowDown" || k === "s" || k === "S") keys.down = true;
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (k === " " || k === "Enter") {
      e.preventDefault();
      if (overlayVisible()) {
        ovBtn.click();
      } else {
        tryRelease();
      }
    } else if (k === "p" || k === "P") {
      if (paused) resumeGame();
      else pauseGame();
    } else if (k === "m" || k === "M") {
      toggleMute();
    } else if (k === "r" || k === "R") {
      fullReset(true);
    }
  });

  window.addEventListener("keyup", function (e) {
    var k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = false;
    if (k === "ArrowRight" || k === "d" || k === "D") keys.right = false;
    if (k === "ArrowUp" || k === "w" || k === "W") keys.up = false;
    if (k === "ArrowDown" || k === "s" || k === "S") keys.down = false;
  });

  function bindHold(id, prop) {
    var el = document.getElementById(id);
    function dn(e) {
      e.preventDefault();
      initAudio();
      keys[prop] = true;
    }
    function up() {
      keys[prop] = false;
    }
    el.addEventListener("pointerdown", dn);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
  }
  bindHold("tb-left", "left");
  bindHold("tb-right", "right");
  bindHold("tb-up", "up");
  bindHold("tb-down", "down");

  document.getElementById("tb-drop").addEventListener("click", function () {
    initAudio();
    tryRelease();
  });

  cvs.addEventListener("pointerdown", function () {
    initAudio();
    if (state === "play" && !paused) tryRelease();
  });

  ovBtn.addEventListener("click", function () {
    initAudio();
    blurActive();
    var f = ovAction;
    if (f) f();
  });

  btnPause.addEventListener("click", function () {
    if (paused) resumeGame();
    else pauseGame();
  });
  btnSound.addEventListener("click", function () {
    initAudio();
    toggleMute();
  });
  btnRestart.addEventListener("click", function () {
    fullReset(true);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state === "play" && !paused) pauseGame();
  });

  /* ── main loop ───────────────────────────────────────── */
  var lastTs = performance.now();
  function loop(ts) {
    var dt = Math.min((ts - lastTs) / 1000, 0.033);
    lastTs = ts;
    update(dt);
    drawScene();
    syncHud(false);
    requestAnimationFrame(loop);
  }

  fullReset(true);
  requestAnimationFrame(loop);
})();
