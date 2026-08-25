/* Shear Line — a lock-picking game for the arcade.
   Slide a pick under each pin, lift it to its own hidden shear height,
   and feather the torsion before the closing bell.
   Everything lives in this one classic script, wrapped in an IIFE. */

(function () {
  "use strict";

  /* ── dom ─────────────────────────────────────────────────── */

  var cvs = document.getElementById("game");
  var ctx = cvs.getContext("2d");
  var wrap = cvs.parentElement;
  var hudLock = document.getElementById("hud-lock");
  var hudPins = document.getElementById("hud-pins");
  var hudClock = document.getElementById("hud-clock");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ov-title");
  var ovBody = document.getElementById("ov-body");
  var ovBtn = document.getElementById("ov-btn");
  var btnSound = document.getElementById("btn-sound");
  var btnPause = document.getElementById("btn-pause");
  var btnRestart = document.getElementById("btn-restart");
  var torsionPad = document.getElementById("torsion-pad");

  /* ── tiny helpers ────────────────────────────────────────── */

  var TAU = Math.PI * 2;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function shuffle(arr) {
    var i, j, t;
    for (i = arr.length - 1; i > 0; i--) {
      j = (Math.random() * (i + 1)) | 0;
      t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return ((s / 60) | 0) + ":" + ("0" + (s % 60)).slice(-2);
  }

  /* ── palette ─────────────────────────────────────────────── */

  var C = {
    woodDark: "#241a10",
    woodLite: "#382a19",
    plate: "#6e5324",
    plateHi: "#c79b47",
    plateDk: "#3f2f12",
    steel: "#9aa3ad",
    steelDk: "#5c646d",
    steelHi: "#d7dee5",
    brassPin: "#d8a84e",
    brassPinHi: "#f6dc9a",
    paperDim: "#c9bb9c",
    danger: "#e06a4a",
    okGlow: "rgba(159,199,106,",
  };

  /* ── lock geometry (logical 720x520) ─────────────────────── */

  var W = 720;
  var H = 520;
  var CHAMBER_XS = [160, 235, 310, 385, 460];
  var CHAMBER_W = 30; // half-width of contact
  var BIBLE_TOP = 96;
  var SHEAR_Y = 200; // the shear line
  var SEAT_Y = 300; // key-pin bottoms at rest
  var KEYWAY_Y = 352; // pick shaft line
  var MAX_LIFT = 80;

  var LOCK_NAMES = [
    "the garden gate",
    "granny\u2019s writing slope",
    "the pawnbroker\u2019s strongbox",
    "the vestry cupboard",
    "the magistrate\u2019s cabinet",
  ];
  var LOCK_TOL = [11, 9, 8, 7, 6];

  var START_TIME = 150;
  var SLIP_COST = 2;
  var SET_HOLD = 0.09; // seconds of torsion needed while floating
  var STRAIN_LIMIT = 2.6; // seconds at full bind before a strain slip
  var OVERSHOOT_FACTOR = 2.2;

  /* ── state ───────────────────────────────────────────────── */

  var mode = "title"; // title | playing | open | paused | won | lost
  var prevMode = "playing";

  var lockIndex = 0;
  var clock = START_TIME;
  var pins = []; // {len, need, raise, set, felt}
  var order = []; // binding order
  var binderAt = 0;
  var tol = LOCK_TOL[0];
  var lockName = LOCK_NAMES[0];
  var slipsThisLock = 0;
  var flawlessLocks = 0;
  var sessionBest = 0;

  var pickX = CHAMBER_XS[0];
  var lift = 0;
  var pointerDown = false;
  var pointerId = null;
  var keys = { left: false, right: false, up: false, down: false };
  var torsionPadHeld = false;
  var spaceHeld = false;
  var torsion = 0; // eased 0..1
  var torsionLatched = false; // wait for release after a strain slip
  var strain = 0;
  var setCharge = 0; // 0..1 while committing a pin
  var camAngle = 0; // rendered plug rotation
  var openT = 0;
  var shake = 0;
  var flashRed = 0;
  var flashGold = 0;
  var eventText = "";
  var eventAge = 99;
  var tickCooldown = 0;
  var motes = [];
  var sparks = [];

  var viewScale = 1;

  /* ── audio ───────────────────────────────────────────────── */

  var ac = null;
  var masterGain = null;
  var muted = false;

  function ensureAudio() {
    if (muted) return null;
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = ac.createGain();
        masterGain.gain.value = 0.5;
        masterGain.connect(ac.destination);
      } catch (e) {
        ac = null;
      }
    }
    if (ac && ac.state === "suspended") ac.resume();
    return ac;
  }

  function tone(type, f0, f1, dur, vol, delay) {
    if (!ensureAudio()) return;
    var t0 = ac.currentTime + (delay || 0);
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0)
      o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(masterGain);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, hp) {
    if (!ensureAudio()) return;
    var n = (ac.sampleRate * dur) | 0;
    var buf = ac.createBuffer(1, n, ac.sampleRate);
    var d = buf.getChannelData(0);
    var i;
    for (i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = ac.createBufferSource();
    src.buffer = buf;
    var g = ac.createGain();
    g.gain.value = vol;
    var f = ac.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hp || 900;
    src.connect(f);
    f.connect(g);
    g.connect(masterGain);
    src.start();
  }

  function sTick(closeness) {
    tone("square", 800 + closeness * 1600, 800 + closeness * 1600, 0.03, 0.045);
  }

  function sDull() {
    tone("sine", 130, 110, 0.05, 0.06);
  }

  function sSet() {
    tone("triangle", 240, 150, 0.09, 0.22);
    noise(0.07, 0.16, 1400);
    tone("sine", 660, 660, 0.12, 0.05, 0.03);
  }

  function sSlip() {
    tone("sawtooth", 160, 70, 0.22, 0.16);
    noise(0.16, 0.12, 500);
  }

  function sOpen() {
    tone("triangle", 523, 523, 0.22, 0.12, 0);
    tone("triangle", 659, 659, 0.24, 0.12, 0.11);
    tone("triangle", 784, 784, 0.34, 0.13, 0.22);
    noise(0.25, 0.08, 300);
  }

  function sBell(wins) {
    tone("sine", wins ? 880 : 660, wins ? 880 : 660, 0.9, 0.16);
    tone("sine", wins ? 1320 : 663, wins ? 1320 : 663, 0.7, 0.06);
    if (wins) tone("sine", 880, 880, 0.9, 0.13, 0.45);
  }

  /* ── run setup ───────────────────────────────────────────── */

  function newRun() {
    lockIndex = 0;
    clock = START_TIME;
    flawlessLocks = 0;
    sessionBest = 0;
    newLock();
  }

  function newLock() {
    var lens = [];
    var i;
    for (i = 0; i < 5; i++) lens.push(rand(35, 85));
    pins = [];
    for (i = 0; i < 5; i++) {
      pins.push({
        len: lens[i],
        need: 100 - lens[i], // lift required to bring the top to the shear line
        raise: 0,
        prevRaise: 0,
        set: false,
        felt: false,
        floatLatch: false,
      });
    }
    order = shuffle([0, 1, 2, 3, 4]);

    binderAt = 0;
    tol = LOCK_TOL[lockIndex];
    lockName = LOCK_NAMES[lockIndex];
    slipsThisLock = 0;
    torsion = 0;
    torsionLatched = false;
    strain = 0;
    setCharge = 0;
    camAngle = 0;
    openT = 0;
    lift = 0;
    buildPinDots();
    updateHud();
  }

  function buildPinDots() {
    hudPins.innerHTML = "";
    var i;
    for (i = 0; i < 5; i++) {
      var dot = document.createElement("i");
      hudPins.appendChild(dot);
    }
  }

  function updateHud() {
    hudLock.textContent =
      "Lock " + (lockIndex + 1) + " of 5 \u2014 " + lockName;
    var dots = hudPins.children;
    var i;
    for (i = 0; i < dots.length; i++) {
      dots[i].className = pins[i] && pins[i].set ? "set" : "";
    }
    hudClock.textContent = "Bell in " + fmtTime(clock);
    hudClock.className = clock <= 15 ? "low" : "";
  }

  /* ── events on the bench ─────────────────────────────────── */

  function say(text) {
    eventText = text;
    eventAge = 0;
  }

  function spawnSparks(x, y, n, gold) {
    var i;
    for (i = 0; i < n; i++) {
      sparks.push({
        x: x,
        y: y,
        vx: rand(-70, 70),
        vy: rand(-160, -40),
        life: rand(0.3, 0.7),
        age: 0,
        gold: !!gold,
      });
    }
  }

  function slipPenalty(reason, bx, by) {
    clock -= SLIP_COST;
    slipsThisLock++;
    shake = 0.55;
    flashRed = 1;
    sSlip();
    say(reason + " \u2014 two seconds gone");
    if (bx !== undefined) spawnSparks(bx, by, 8, false);
  }

  /* ── per-frame logic ─────────────────────────────────────── */

  function engagedChamber() {
    var best = -1;
    var bd = 27;
    var i;
    for (i = 0; i < 5; i++) {
      var d = Math.abs(CHAMBER_XS[i] - pickX);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  function update(dt) {
    var i;

    /* input-driven pick position */
    if (keys.left || keys.right) {
      pickX += (keys.right ? 1 : -1) * 270 * dt;
    }
    if (!pointerDown) {
      if (keys.up || keys.down) {
        lift += (keys.up ? 1 : -1) * 95 * dt;
      } else {
        lift -= lift * 6 * dt;
        if (lift < 1.5) lift = 0;
      }
    } else {
      /* pointer keeps lift absolute (set in pointermove) */
    }
    pickX = clamp(pickX, CHAMBER_XS[0] - 30, CHAMBER_XS[4] + 30);
    lift = clamp(lift, 0, MAX_LIFT);

    /* torsion easing */
    var wantTorsion = (torsionPadHeld || spaceHeld) && !torsionLatched;
    if (wantTorsion) {
      torsion += dt * 4.5;
      if (torsion > 1) torsion = 1;
    } else {
      torsion -= dt * 6.5;
      if (torsion < 0) torsion = 0;
      if (torsion < 0.25) torsionLatched = false;
    }
    torsionPad.className = torsion > 0.15 ? "held" : "";

    /* strain: leaning on the plug too long binds it */
    if (torsion > 0.86 && wantTorsion) {
      strain += dt;
      if (strain >= STRAIN_LIMIT) {
        strain = 0;
        torsionLatched = true;
        slipPenalty("The plug binds \u2014 ease off");
      }
    } else {
      strain = Math.max(0, strain - dt * 2);
    }

    /* pins */
    var eng = engagedChamber();
    var bi = order[binderAt];
    var floating = false;
    var closeness = 0;

    for (i = 0; i < 5; i++) {
      var p = pins[i];
      if (p.set) {
        p.raise = p.need;
        continue;
      }
      p.prevRaise = p.raise;
      if (i === eng && i === bi) {
        var target = lift;
        /* the float latches once felt and holds while you stay near it */
        if (!p.floatLatch && Math.abs(p.raise - p.need) <= tol)
          p.floatLatch = true;
        if (
          p.floatLatch &&
          (Math.abs(p.raise - p.need) > tol * 2 || lift < p.need - tol * 2)
        ) {
          p.floatLatch = false;
        }
        if (p.floatLatch) {
          /* magnetic settle onto the sweet spot */
          p.raise += (p.need - p.raise) * clamp(dt * 9, 0, 1);
          floating = true;
          closeness = 1 - Math.abs(p.raise - p.need) / tol;
          p.felt = true;
        } else {
          var dir = p.need > target ? 1 : -1;
          var resist = 0.55 + closenessHint(p, target);
          /* feathering: creep slower as the pick nears the sweet spot */
          var rate = Math.abs(p.raise - p.need) < tol * 2 ? 120 : 260;
          p.raise +=
            dir * clamp(Math.abs(target - p.raise), 0, rate * dt * resist);
          if (p.raise > MAX_LIFT) p.raise = MAX_LIFT;
          if (Math.abs(target - p.raise) < 7)
            p.felt = p.felt || Math.abs(p.need - p.raise) < tol * 1.6;
        }
      } else if (i === eng) {
        /* not the binder: it budges, then pushes back */
        p.floatLatch = false;
        p.raise += (Math.min(lift * 0.18, 7) - p.raise) * clamp(dt * 10, 0, 1);
      } else {
        p.floatLatch = false;
        p.raise -= p.raise * 8 * dt;
        if (p.raise < 0.5) p.raise = 0;
      }
    }
    /* probing ticks */
    tickCooldown -= dt;
    if (eng === bi && tickCooldown <= 0) {
      var p2 = pins[bi];
      var near = clamp(1 - Math.abs(p2.raise - p2.need) / 26, 0, 1);
      if (near > 0.05) {
        sTick(near);
        tickCooldown = floating ? 0.14 : clamp(0.3 - near * 0.22, 0.08, 0.3);
      } else if (lift > 6 && tickCooldown <= 0) {
        sDull();
        tickCooldown = 0.22;
      }
    }

    /* committing a pin */

    if (floating && torsion > 0.45 && !torsionLatched) {
      setCharge += dt / SET_HOLD;
      if (setCharge >= 1) commitPin(bi);
    } else {
      setCharge = 0;
    }

    /* overshoot under pressure: the pin drops, but only strain costs time */
    var bp = pins[bi];
    if (
      eng === bi &&
      torsion > 0.45 &&
      !bp.set &&
      bp.prevRaise <= bp.need + tol * OVERSHOOT_FACTOR &&
      bp.raise > bp.need + tol * OVERSHOOT_FACTOR
    ) {
      bp.floatLatch = false;
      bp.raise = 0;
      slipsThisLock++;
      shake = 0.45;
      sSlip();
      spawnSparks(CHAMBER_XS[bi], SHEAR_Y + 40, 6, false);
      say("Pin " + ordinal(bi + 1) + " drops \u2014 pried too far");
    }

    /* clock */
    clock -= dt;
    if (clock <= 0) {
      clock = 0;
      lose();
      return;
    }

    /* ambience: motes are spawned here, moved once in the main loop */
    if (motes.length < 26 && Math.random() < dt * 3) {
      motes.push({
        x: rand(0, W),
        y: H + 6,
        vy: -rand(4, 12),
        vx: rand(-3, 3),
        a: rand(0.05, 0.2),
        r: rand(0.6, 1.8),
      });
    }

    shake = Math.max(0, shake - dt * 2.4);
    flashRed = Math.max(0, flashRed - dt * 2.2);
    flashGold = Math.max(0, flashGold - dt * 2);
    eventAge += dt;

    updateHud();
  }

  function closenessHint(p, target) {
    return clamp(1 - Math.abs(p.need - target) / 30, 0, 1) * 0.45;
  }

  function ordinal(n) {
    return ["one", "two", "three", "four", "five"][n - 1] || n;
  }

  function commitPin(bi) {
    var p = pins[bi];
    p.set = true;
    p.raise = p.need;
    setCharge = 0;
    binderAt++;
    flashGold = 1;
    sSet();
    spawnSparks(CHAMBER_XS[bi], SHEAR_Y + 30, 12, true);
    if (binderAt >= 5) {
      say("All five shears \u2014 the plug turns");
      openLock();
    } else {
      say("Pin " + ordinal(bi + 1) + " shears true");
    }
  }

  function openLock() {
    mode = "open";
    openT = 0;
    sOpen();
  }

  function finishOpen() {
    if (slipsThisLock === 0) flawlessLocks++;
    lockIndex++;
    if (lockIndex >= 5) {
      win();
    } else {
      mode = "playing";
      newLock();
      say("Lock " + (lockIndex + 1) + ": " + lockName);
    }
  }

  function scoreNow() {
    return Math.ceil(clock) * 10 + flawlessLocks * 40;
  }

  function win() {
    mode = "won";
    sessionBest = Math.max(sessionBest, scoreNow());
    sBell(true);
    showOverlay(
      "Five locks turned",
      '<p class="scoreline">Score ' +
        scoreNow() +
        ' <span class="subline">(&ldquo;' +
        fmtTime(clock) +
        '" on the bell, ' +
        flawlessLocks +
        " flawless)</span></p>" +
        '<p class="subline">Best tonight: ' +
        sessionBest +
        ". The customers sleep easier.</p>",
      "Another night",
    );
  }

  function lose() {
    mode = "lost";
    sBell(false);
    showOverlay(
      "The closing bell",
      "<p>The shop door chimes behind the last customer.</p>" +
        '<p class="subline">' +
        lockIndex +
        " of 5 locks gave in tonight" +
        (sessionBest > 0 ? " \u2014 best score so far: " + sessionBest : "") +
        ".</p>",
      "Try another night",
    );
  }

  /* ── rendering ───────────────────────────────────────────── */

  function fit() {
    var cssW = wrap.clientWidth || 720;
    var scale = cssW / W;
    var dpr = window.devicePixelRatio || 1;
    cvs.style.width = cssW + "px";
    cvs.style.height = H * scale + "px";
    cvs.width = Math.round(W * scale * dpr);
    cvs.height = Math.round(H * scale * dpr);
    viewScale = scale * dpr;
  }

  function render(t) {
    ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
    var sx = 0;
    var sy = 0;
    if (shake > 0) {
      sx = rand(-1, 1) * shake * 7;
      sy = rand(-1, 1) * shake * 5;
    }
    ctx.translate(sx, sy);

    drawBench(t);

    ctx.save();
    ctx.translate(0, 0);
    drawLockBody();
    drawCam();
    drawPins(t);
    drawShearLine(t);
    drawPick(t);
    drawSparks();
    drawMotes();
    drawCharge(t);
    drawEventText();
    drawFlashes();
    ctx.restore();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawBench(t) {
    /* wood */
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.woodLite);
    g.addColorStop(0.55, C.woodDark);
    g.addColorStop(1, "#17100a");
    ctx.fillStyle = g;
    ctx.fillRect(-10, -10, W + 20, H + 20);

    /* grain */
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1;
    var i;
    for (i = 0; i < 14; i++) {
      ctx.beginPath();
      var yy = 20 + i * 36;
      ctx.moveTo(0, yy);
      for (var xx = 0; xx <= W; xx += 48) {
        ctx.lineTo(xx, yy + Math.sin(xx * 0.021 + i * 2.4) * 4);
      }
      ctx.stroke();
    }

    /* lamp pool */
    var lg = ctx.createRadialGradient(W / 2, 90, 40, W / 2, 250, 420);
    lg.addColorStop(0, "rgba(255,196,110,0.16)");
    lg.addColorStop(1, "rgba(255,170,80,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);

    /* vignette */
    var vg = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.42,
      W / 2,
      H / 2,
      H * 0.95,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
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

  function drawLockBody() {
    var bx = 118;
    var bw = 392;

    /* bible (top block) */
    var bg = ctx.createLinearGradient(0, BIBLE_TOP, 0, SHEAR_Y);
    bg.addColorStop(0, "#494f57");
    bg.addColorStop(1, "#333941");
    ctx.fillStyle = bg;
    roundRect(bx, BIBLE_TOP, bw, SHEAR_Y - BIBLE_TOP, 6);
    ctx.fill();

    /* plug */
    var pg = ctx.createLinearGradient(0, SHEAR_Y, 0, 320);
    pg.addColorStop(0, "#5a4318");
    pg.addColorStop(1, C.plateDk);
    ctx.fillStyle = pg;
    roundRect(bx, SHEAR_Y, bw, 320 - SHEAR_Y, 6);
    ctx.fill();

    /* brass trim around the join */
    ctx.strokeStyle = "rgba(216,168,78,0.55)";
    ctx.lineWidth = 1.5;
    roundRect(bx, BIBLE_TOP, bw, 320 - BIBLE_TOP, 6);
    ctx.stroke();

    /* screws */
    ctx.fillStyle = C.brassPinHi;
    var screws = [
      [bx + 14, BIBLE_TOP + 12],
      [bx + bw - 14, BIBLE_TOP + 12],
      [bx + 14, 308],
      [bx + bw - 14, 308],
    ];
    var s;
    for (s = 0; s < screws.length; s++) {
      ctx.beginPath();
      ctx.arc(screws[s][0], screws[s][1], 3.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(screws[s][0] - 2, screws[s][1]);
      ctx.lineTo(screws[s][0] + 2, screws[s][1]);
      ctx.stroke();
    }

    /* chambers */
    var i;
    for (i = 0; i < 5; i++) {
      var cx = CHAMBER_XS[i];
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(cx - 13, BIBLE_TOP + 8, 26, SHEAR_Y - BIBLE_TOP - 8);
      ctx.fillRect(cx - 13, SHEAR_Y, 26, SEAT_Y - SHEAR_Y);
    }

    /* keyway slot */
    ctx.fillStyle = "rgba(10,6,3,0.9)";
    roundRect(138, 332, 352, 38, 17);
    ctx.fill();
    ctx.strokeStyle = "rgba(216,168,78,0.3)";
    ctx.lineWidth = 1;
    roundRect(138, 332, 352, 38, 17);
    ctx.stroke();

    /* felt notches: remembered heights scratched on the plug face */
    for (i = 0; i < 5; i++) {
      if (!pins[i]) continue;
      if (pins[i].felt || pins[i].set) {
        var ny = clamp(SEAT_Y - pins[i].need, SHEAR_Y + 8, SEAT_Y + 10);
        ctx.strokeStyle = pins[i].set
          ? "rgba(246,220,154,0.8)"
          : "rgba(216,168,78,0.42)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(CHAMBER_XS[i] - 15, ny);
        ctx.lineTo(CHAMBER_XS[i] + 15, ny);
        ctx.stroke();
      }
    }

    /* label engraved on the plug */
    ctx.fillStyle = "rgba(230,205,150,0.28)";
    ctx.font = "italic 12px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText(lockName.toUpperCase(), bx + bw / 2, 315);
  }

  function drawPins(t) {
    var i;
    for (i = 0; i < 5; i++) {
      var p = pins[i];
      if (!p) continue;
      var cx = CHAMBER_XS[i];
      var isBinder = order[binderAt] === i && binderAt < 5;

      /* driver pin rides the key pin; at the shear it sits flush */
      var kpBottom = SEAT_Y - p.raise;
      var kpTop = kpBottom - p.len;
      var drvH = 42;
      var drvBottom = Math.min(kpTop, SHEAR_Y + drvH);
      var drvTop = drvBottom - drvH;
      if (p.set) drvBottom = SHEAR_Y;
      var dg = ctx.createLinearGradient(cx - 10, 0, cx + 10, 0);
      dg.addColorStop(0, "#6d757e");
      dg.addColorStop(0.5, C.steel);
      dg.addColorStop(1, "#565d66");
      ctx.fillStyle = dg;
      ctx.fillRect(cx - 10, drvTop, 20, drvBottom - drvTop);

      /* spring stacks down onto the driver */
      var springBot = drvTop - 3 - torsion * 3;
      var springTop = BIBLE_TOP + 6;
      ctx.strokeStyle = C.steelDk;
      ctx.lineWidth = 2;
      ctx.beginPath();
      var zig = (springBot - springTop) / 6;
      var yy;
      for (yy = 0; yy < 6; yy++) {
        var sy2 = springTop + yy * zig;
        ctx.lineTo(cx + (yy % 2 ? 7 : -7), sy2);
      }
      ctx.lineTo(cx, springBot);
      ctx.stroke();

      /* key pin */
      var kg = ctx.createLinearGradient(cx - 11, 0, cx + 11, 0);
      kg.addColorStop(0, "#9a7628");
      kg.addColorStop(0.45, C.brassPinHi);
      kg.addColorStop(1, "#8a6a30");
      ctx.fillStyle = kg;
      roundRect(cx - 11, kpTop, 22, p.len, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(60,40,10,0.7)";
      ctx.lineWidth = 1;
      roundRect(cx - 11, kpTop, 22, p.len, 5);
      ctx.stroke();

      /* the float halo */

      if (
        isBinder &&
        !p.set &&
        Math.abs(p.raise - p.need) <= tol &&
        mode === "playing"
      ) {
        var pul = 0.55 + 0.45 * Math.sin(t * 0.009);
        ctx.fillStyle = "rgba(246,220,154," + (0.16 + 0.14 * pul) + ")";
        ctx.beginPath();
        ctx.arc(cx, kpTop + p.len * 0.4, 26 + pul * 4, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "rgba(246,220,154," + (0.5 + 0.3 * pul) + ")";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 16, kpTop);
        ctx.lineTo(cx + 16, kpTop);
        ctx.stroke();
      }

      /* set marker */
      if (p.set) {
        ctx.fillStyle = "rgba(159,199,106,0.9)";
        ctx.beginPath();
        ctx.moveTo(cx, SHEAR_Y - 16);
        ctx.lineTo(cx - 5, SHEAR_Y - 24);
        ctx.lineTo(cx + 5, SHEAR_Y - 24);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawShearLine(t) {
    var anyFloat = false;
    var i;
    for (i = 0; i < 5; i++) {
      if (
        pins[i] &&
        !pins[i].set &&
        order[binderAt] === i &&
        Math.abs(pins[i].raise - pins[i].need) <= tol
      )
        anyFloat = true;
    }
    ctx.save();
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -(t * 0.02) % 13;
    ctx.strokeStyle = anyFloat
      ? "rgba(246,220,154,0.95)"
      : "rgba(216,168,78,0.4)";
    ctx.lineWidth = anyFloat ? 2 : 1.2;
    ctx.shadowColor = "rgba(246,220,154,0.8)";
    ctx.shadowBlur = anyFloat ? 8 : 0;
    ctx.beginPath();
    ctx.moveTo(122, SHEAR_Y);
    ctx.lineTo(506, SHEAR_Y);
    ctx.stroke();
    ctx.restore();
  }

  function drawPick(t) {
    var eng = engagedChamber();
    var tipX = pickX;
    var jit = torsion * 1.6;
    var shaftY = KEYWAY_Y + Math.sin(t * 0.05) * jit;

    /* shaft entering from the right */
    var sg = ctx.createLinearGradient(0, shaftY - 5, 0, shaftY + 5);
    sg.addColorStop(0, C.steelHi);
    sg.addColorStop(0.5, C.steel);
    sg.addColorStop(1, C.steelDk);
    ctx.strokeStyle = sg;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(700, shaftY + 6);
    ctx.lineTo(tipX + 26, shaftY);
    /* gentle hook up to the engaged pin's underside */
    var contactY =
      eng >= 0 ? SEAT_Y - (pins[eng] ? pins[eng].raise : 0) + 3 : SEAT_Y;
    ctx.quadraticCurveTo(tipX + 2, shaftY, tipX, contactY);
    ctx.stroke();

    /* tip nub */
    ctx.fillStyle = C.steelHi;
    ctx.beginPath();
    ctx.arc(tipX, contactY, 3.4, 0, TAU);

    /* handle grip */
    ctx.strokeStyle = "#7c3f22";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(700, shaftY + 6);
    ctx.lineTo(664, shaftY + 6);
    ctx.stroke();
  }

  function drawCam() {
    var cx = 585;
    var cy = 208;
    var ang = camAngle + torsion * 0.16;

    /* stem linking body to cam */
    ctx.strokeStyle = C.steelDk;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(510, cy);
    ctx.lineTo(cx, cy);
    ctx.stroke();

    /* bolt rail above */
    var slide = camAngle * 1.6;
    ctx.fillStyle = C.steel;
    roundRect(cx - 34 + slide, cy - 92, 68, 16, 5);
    ctx.fill();
    ctx.fillStyle = C.steelDk;
    roundRect(cx + 26 + slide, cy - 74, 26, 12, 4);
    ctx.fill();

    /* cam disc */
    var cg = ctx.createRadialGradient(cx - 12, cy - 14, 6, cx, cy, 48);
    cg.addColorStop(0, "#b98f3e");
    cg.addColorStop(1, "#5c4517");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, cy, 46, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(216,168,78,0.6)";
    ctx.lineWidth = 2;
    ctx.stroke();

    /* keyhole slot rotates with the plug */
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = "#17100a";
    roundRect(-7, -26, 14, 34, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 14, 9, 0, TAU);
    ctx.fill();
    ctx.restore();

    /* degree ticks */
    var k;
    ctx.strokeStyle = "rgba(201,187,156,0.4)";
    ctx.lineWidth = 1;
    for (k = 0; k <= 4; k++) {
      var a = k * (TAU / 12);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 52, cy + Math.sin(a) * 52);
      ctx.lineTo(cx + Math.cos(a) * 57, cy + Math.sin(a) * 57);
      ctx.stroke();
    }
  }

  function drawCharge(t) {
    if (setCharge <= 0 || mode !== "playing") return;
    var bi = order[binderAt];
    var cx = CHAMBER_XS[bi];
    var cy = SHEAR_Y - 34;
    var pul = 0.7 + 0.3 * Math.sin(t * 0.03);
    ctx.strokeStyle = "rgba(159,199,106," + (0.5 + 0.4 * pul) + ")";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 15, -Math.PI / 2, -Math.PI / 2 + TAU * setCharge);
    ctx.stroke();
  }

  function drawSparks() {
    var i;
    for (i = 0; i < sparks.length; i++) {
      var s = sparks[i];
      var a = 1 - s.age / s.life;
      if (a <= 0) continue;
      ctx.fillStyle = s.gold
        ? "rgba(246,220,154," + a + ")"
        : "rgba(224,106,74," + a + ")";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.8 + a, 0, TAU);
      ctx.fill();
    }
  }

  function drawMotes() {
    var i;
    ctx.fillStyle = "rgba(255,214,150,0.5)";
    for (i = 0; i < motes.length; i++) {
      var m = motes[i];
      ctx.globalAlpha = m.a;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawEventText() {
    if (eventAge > 2.6) return;
    var a = clamp(1 - (eventAge - 1.6) / 1, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = C.paperDim;
    ctx.font = "italic 15px Georgia, serif";
    ctx.textAlign = "left";
    ctx.fillText(eventText, 126, 400);
    ctx.globalAlpha = 1;
  }

  function drawFlashes() {
    if (flashRed > 0) {
      ctx.fillStyle = "rgba(190,50,30," + flashRed * 0.22 + ")";
      ctx.fillRect(0, 0, W, H);
    }
    if (flashGold > 0) {
      ctx.fillStyle = "rgba(246,220,154," + flashGold * 0.1 + ")";
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ── overlay plumbing ────────────────────────────────────── */

  function showOverlay(titleHtml, bodyHtml, btnLabel) {
    ovTitle.innerHTML = titleHtml;
    ovBody.innerHTML = bodyHtml;
    ovBtn.textContent = btnLabel;
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function showTitle() {
    showOverlay(
      "Shear Line",
      '<ul class="howto">' + ovBody.querySelector(".howto").innerHTML + "</ul>",
      "Open the shop",
    );
  }

  function showPause() {
    showOverlay(
      "Paused",
      '<p class="subline">The pick waits in the keyway. The bell holds its breath.</p>',
      "Back to the bench",
    );
  }

  /* ── modes ───────────────────────────────────────────────── */

  function beginRun() {
    newRun();
    mode = "playing";
    hideOverlay();
    say("Lock 1: " + lockName);
    ensureAudio();
  }

  function togglePause() {
    if (mode === "playing" || mode === "open") {
      prevMode = mode;
      mode = "paused";
      showPause();
    } else if (mode === "paused") {
      mode = prevMode;
      hideOverlay();
    }
  }

  function toggleSound() {
    muted = !muted;
    btnSound.textContent = muted ? "Sound: off" : "Sound: on";
    btnSound.setAttribute("aria-pressed", String(muted));
    if (!muted) ensureAudio();
  }

  /* ── input ───────────────────────────────────────────────── */

  function canvasPos(ev) {
    var r = cvs.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) / (r.width / W),
      y: (ev.clientY - r.top) / (r.height / H),
    };
  }

  cvs.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    if (mode !== "playing") return;
    pointerDown = true;
    pointerId = ev.pointerId;
    try {
      cvs.setPointerCapture(ev.pointerId);
    } catch (e) {}
    applyPointer(ev);
  });

  cvs.addEventListener("pointermove", function (ev) {
    if (!pointerDown || ev.pointerId !== pointerId) return;
    applyPointer(ev);
  });

  function applyPointer(ev) {
    var p = canvasPos(ev);
    pickX = clamp(p.x, CHAMBER_XS[0] - 30, CHAMBER_XS[4] + 30);
    /* drag height maps straight to lift across the working band */
    var band = KEYWAY_Y - (BIBLE_TOP + 10);
    lift = clamp(((KEYWAY_Y - 6 - p.y) / band) * MAX_LIFT, 0, MAX_LIFT);
  }

  function endPointer(ev) {
    if (ev !== undefined && ev.pointerId !== pointerId) return;
    pointerDown = false;
    pointerId = null;
  }

  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);
  cvs.addEventListener("contextmenu", function (ev) {
    ev.preventDefault();
  });

  torsionPad.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    if (mode !== "playing") return;
    torsionPadHeld = true;
    ensureAudio();
  });
  window.addEventListener("pointerup", function () {
    torsionPadHeld = false;
  });
  window.addEventListener("pointercancel", function () {
    torsionPadHeld = false;
  });

  document.addEventListener("keydown", function (ev) {
    var k = ev.key;
    if (k === " " || k.indexOf("Arrow") === 0) {
      if (
        ev.target &&
        ev.target.tagName === "BUTTON" &&
        (mode === "title" || mode === "won" || mode === "lost")
      ) {
        /* let the focused overlay button take Space/Enter; ignore the rest */
      } else {
        ev.preventDefault();
      }
    }
    if (k === "ArrowLeft" || k === "a" || k === "A") {
      keys.left = true;
    }
    if (k === "ArrowRight" || k === "d" || k === "D") {
      keys.right = true;
    }
    if (k === "ArrowUp" || k === "w" || k === "W") {
      keys.up = true;
    }
    if (k === "ArrowDown" || k === "s" || k === "S") {
      keys.down = true;
    }
    if (k === " " && mode === "playing") {
      spaceHeld = true;
      ensureAudio();
    }
    if (ev.repeat) return;
    if (k === "p" || k === "P" || k === "Escape") togglePause();
    if ((k === "r" || k === "R") && mode !== "title") beginRun();
    if (k === "m" || k === "M") toggleSound();
    if (
      (k === "Enter" || k === " ") &&
      (mode === "title" || mode === "won" || mode === "lost")
    )
      beginRun();
  });

  document.addEventListener("keyup", function (ev) {
    var k = ev.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = false;
    if (k === "ArrowRight" || k === "d" || k === "D") keys.right = false;
    if (k === "ArrowUp" || k === "w" || k === "W") keys.up = false;
    if (k === "ArrowDown" || k === "s" || k === "S") keys.down = false;
    if (k === " ") spaceHeld = false;
  });

  ovBtn.addEventListener("click", function () {
    ovBtn.blur();
    if (mode === "paused") {
      togglePause();
    } else if (mode === "won" || mode === "lost" || mode === "title") {
      beginRun();
    }
  });

  btnPause.addEventListener("click", function () {
    btnPause.blur();
    togglePause();
  });
  btnRestart.addEventListener("click", function () {
    btnRestart.blur();
    beginRun();
  });
  btnSound.addEventListener("click", function () {
    btnSound.blur();
    toggleSound();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && (mode === "playing" || mode === "open"))
      togglePause();
  });

  window.addEventListener("resize", fit);

  /* ── main loop ───────────────────────────────────────────── */

  var lastT = 0;

  function frame(t) {
    var dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;

    if (mode === "playing") {
      update(dt);
    } else if (mode === "open") {
      openT += dt;
      camAngle = Math.min(1, openT / 0.9) * (Math.PI / 5.2);
      var i;
      for (i = 0; i < 5; i++) pins[i].raise = pins[i].need;
      torsion = Math.max(0, torsion - dt * 3);
      if (openT > 1.25) finishOpen();
    }

    /* sparks & motes live everywhere so they can finish dying */
    var s;
    for (s = sparks.length - 1; s >= 0; s--) {
      var sp = sparks[s];
      sp.age += dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.vy += 340 * dt;
      if (sp.age >= sp.life) sparks.splice(s, 1);
    }
    if (mode !== "paused") {
      var mi;
      for (mi = motes.length - 1; mi >= 0; mi--) {
        var mo = motes[mi];
        mo.y += mo.vy * dt;
        if (mo.y < -8) motes.splice(mi, 1);
      }
    }

    render(t);
    requestAnimationFrame(frame);
  }

  /* ── boot ────────────────────────────────────────────────── */

  fit();
  newRun();
  mode = "title";
  showTitle();
  requestAnimationFrame(frame);
})();
