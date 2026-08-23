/* Brakefall — ride a runaway ore cart down five switchbacks of a lamplit
   copper mine. Hold to brake; heat fades the shoes; crawl the posted hairpins,
   keep the ore aboard, and stay ahead of the collapse dust to the flooded sump. */
(function () {
  "use strict";

  /* ---------- dom ---------- */

  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var frameEl = document.getElementById("frame");
  var overlayEl = document.getElementById("overlay");
  var chipFlight = document.getElementById("chipFlight");
  var chipOre = document.getElementById("chipOre");
  var chipLives = document.getElementById("chipLives");
  var btnPause = document.getElementById("btnPause");
  var btnSound = document.getElementById("btnSound");
  var btnRestart = document.getElementById("btnRestart");

  /* ---------- utils ---------- */

  function clamp(x, a, b) {
    return x < a ? a : x > b ? b : x;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function fmt(n) {
    return String(Math.round(n));
  }

  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6d2b79f5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- tuning ---------- */

  var FLIGHTS = 5;
  var LEG_DX = 1080;
  var GRADES = [0.46, 0.5, 0.54, 0.57, 0.6];
  var C1 = [272, 248, 226, 206, 188];
  var GRAV = 1450,
    ROLL = 26,
    DRAG_K = 0.00042,
    BRAKE = 640;
  var HEAT_IN = 0.16,
    HEAT_V = 1 / 2000,
    HEAT_OUT = 0.2,
    HEAT_BRACE = 0.45;
  var WALL_BASE = 225,
    WALL_PER_FLIGHT = 20;
  var START_GAP = 1650,
    RESPAWN_GAP = 1550;
  var MAX_SPEED_REF = 1000;

  var COL = {
    bgTop: "#191009",
    bgBot: "#0b0705",
    rock: "#171009",
    rockLine: "#241811",
    rail: "#c9a878",
    railDark: "#7a5c39",
    tie: "#5d4326",
    wood: "#8a5a2e",
    woodDark: "#4a3018",
    ore: "#c98a4b",
    ember: "#ff7a3c",
    amber: "#ffcf7d",
    danger: "#ff5646",
    safe: "#86d06a",
    ink: "#f2e2c4",
    water: "#173038",
    waterHi: "#2a5560",
  };

  /* ---------- world ---------- */

  var W = null; // world container

  function buildWorld(seed) {
    var rng = mulberry32(seed);
    var segs = [],
      corners = [],
      roughs = [],
      braces = [],
      sacks = [];
    var x = 0,
      y = 0,
      s = 0;

    function addSeg(dx, dy, kind, flight) {
      var len = Math.sqrt(dx * dx + dy * dy);
      segs.push({
        x0: x,
        y0: y,
        x1: x + dx,
        y1: y + dy,
        dx: dx,
        dy: dy,
        len: len,
        s0: s,
        s1: s + len,
        kind: kind,
        flight: flight,
        ang: Math.atan2(dy, dx),
      });
      x += dx;
      y += dy;
      s += len;
    }

    for (var f = 0; f < FLIGHTS; f++) {
      var g = GRADES[f];
      var j1 = (rng() - 0.5) * 120,
        j2 = (rng() - 0.5) * 120;

      // leg A: down-right
      addSeg(LEG_DX + j1, (LEG_DX + j1) * g, "leg", f);
      corners.push({ s: s, x: x, y: y, limit: C1[f], kind: "hairpin" });

      // leg B: down-left
      addSeg(-(LEG_DX + j2), (LEG_DX + j2) * g, "leg", f);

      // brace landing: hairpin onto a flat ledge (checkpoint, fast cooling)
      corners.push({ s: s, x: x, y: y, limit: C1[f] - 16, kind: "brace" });
      braces.push({ s: s + 115, x: x + 115, y: y });
      addSeg(230, 0, "brace", f);

      // rotten trestles (never on flight 1)
      if (f >= 1) {
        var legA = segs[segs.length - 3];
        var rLen = 170 + rng() * 100;
        var rStart = legA.s0 + legA.len * (0.42 + rng() * 0.2);
        roughs.push({
          s0: rStart,
          s1: rStart + rLen,
          limit: C1[f] + 105,
          seed: rng() * 999,
        });
        if (f >= 3) {
          var legB = segs[segs.length - 2];
          var rLen2 = 150 + rng() * 90;
          var rStart2 = legB.s0 + legB.len * (0.35 + rng() * 0.25);
          roughs.push({
            s0: rStart2,
            s1: rStart2 + rLen2,
            limit: C1[f] + 105,
            seed: rng() * 999,
          });
        }
      }

      // ore sacks on leg A, rewarding the racing line
      for (var k = 0; k < 2; k++) {
        var frac = k === 0 ? 0.3 : 0.62;
        var ss = segs[segs.length - 3].s0 + segs[segs.length - 3].len * frac;
        var clash = false;
        for (var ri = 0; ri < roughs.length; ri++) {
          if (ss > roughs[ri].s0 - 40 && ss < roughs[ri].s1 + 40) clash = true;
        }
        if (clash)
          ss = segs[segs.length - 3].s0 + segs[segs.length - 3].len * 0.16;
        sacks.push({ s: ss, taken: false });
      }
    }

    // the sump pier
    addSeg(470, 0, "pier", FLIGHTS - 1);
    var waterY = y + 46;

    var pts = [];
    for (var i = 0; i < segs.length; i++) {
      if (pts.length === 0) pts.push({ x: segs[i].x0, y: segs[i].y0 });
      pts.push({ x: segs[i].x1, y: segs[i].y1 });
    }

    return {
      segs: segs,
      corners: corners,
      roughs: roughs,
      braces: braces,
      sacks: sacks,
      totalS: s,
      waterY: waterY,
      winS: s - 130,
      rng: rng,
    };
  }

  function segAt(s) {
    s = clamp(s, 0, W.totalS);
    for (var i = 0; i < W.segs.length; i++) {
      var g = W.segs[i];
      if (s <= g.s1) return g;
    }
    return W.segs[W.segs.length - 1];
  }

  function posAt(s) {
    var g = segAt(s);
    var t = clamp((s - g.s0) / g.len, 0, 1);
    return {
      x: g.x0 + g.dx * t,
      y: g.y0 + g.dy * t,
      ang: g.ang,
      kind: g.kind,
      flight: g.flight,
      seg: g,
    };
  }

  /* ---------- state ---------- */

  var mode = "title"; // title | count | run | pause | winning | win | losing | lose
  var pausedFrom = "run";
  var loseReason = "";
  var tally = null;
  var countT = 0,
    animT = 0,
    nowSec = 0;

  var cart = null,
    wall = null;
  var hearts = 3,
    cargo = 100,
    elapsed = 0,
    checkpoint = 0;
  var shake = 0,
    hurtFlash = 0,
    buriedPulse = 0;
  var cam = { x: 0, y: 0, z: 1 };
  var particles = [],
    floaters = [];
  var reducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resetCart() {
    cart = {
      s: 0,
      prevS: 0,
      v: 0,
      dist: 0,
      heat: 0,
      jammed: false,
      derailT: 0,
      om: 0,
      dAng: 0,
      tip: 0,
      poured: false,
    };
    wall = { s: -START_GAP, frozenUntil: 0 };
    hearts = 3;
    cargo = 100;
    elapsed = 0;
    checkpoint = 0;
    shake = 0;
    hurtFlash = 0;
    buriedPulse = 0;
    particles.length = 0;
    floaters.length = 0;
  }

  function newSeedRun(toMode) {
    W = buildWorld((Math.random() * 0xffffffff) >>> 0);
    resetCart();
    cam.x = 0;
    cam.y = 0;
    cam.z = 1;
    mode = toMode;
    if (toMode === "count") {
      countT = 1.05;
      hideOverlay();
    }
    refreshChips(true);
  }

  /* ---------- audio (all synthesised) ---------- */

  var actx = null,
    master = null,
    rumbleGain = null,
    rumbleFilter = null;
  var squealOsc = null,
    squealGain = null;
  var muted = false;

  function ensureAudio() {
    if (actx) {
      if (actx.state === "suspended") actx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      actx = new AC();
    } catch (e) {
      actx = null;
      return;
    }
    master = actx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(actx.destination);

    var len = actx.sampleRate * 2;
    var buf = actx.createBuffer(1, len, actx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    var src = actx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    rumbleFilter = actx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 90;
    rumbleGain = actx.createGain();
    rumbleGain.gain.value = 0;
    src.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(master);
    src.start();

    squealOsc = actx.createOscillator();
    squealOsc.type = "sawtooth";
    squealOsc.frequency.value = 700;
    var bp = actx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1300;
    bp.Q.value = 3;
    squealGain = actx.createGain();
    squealGain.gain.value = 0;
    squealOsc.connect(bp);
    bp.connect(squealGain);
    squealGain.connect(master);
    squealOsc.start();
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!actx || muted) return;
    var t0 = actx.currentTime + (delay || 0);
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo)
      o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseHit(dur, cutoff, vol, delay) {
    if (!actx || muted) return;
    var t0 = actx.currentTime + (delay || 0);
    var n = Math.floor(actx.sampleRate * dur);
    var buf = actx.createBuffer(1, n, actx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = actx.createBufferSource();
    src.buffer = buf;
    var f = actx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    var g = actx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
  }

  var snd = {
    clank: function () {
      tone(150, 0.08, "square", 0.2, 90);
      noiseHit(0.07, 900, 0.16);
    },
    chime: function () {
      tone(740, 0.12, "triangle", 0.16);
      tone(1110, 0.16, "triangle", 0.09, 0, 0.06);
    },
    sack: function () {
      tone(960, 0.09, "triangle", 0.16);
      tone(1280, 0.1, "triangle", 0.1, 0, 0.05);
    },
    scrape: function () {
      noiseHit(0.22, 2800, 0.24);
      tone(210, 0.18, "sawtooth", 0.08, 140);
    },
    thud: function () {
      tone(100, 0.45, "sine", 0.5, 36);
      noiseHit(0.3, 260, 0.4);
    },
    boom: function () {
      tone(72, 0.8, "sine", 0.6, 26);
      noiseHit(0.8, 180, 0.5);
    },
    tick: function () {
      tone(880, 0.05, "square", 0.08);
    },
    go: function () {
      tone(520, 0.16, "square", 0.14);
      tone(780, 0.2, "square", 0.12, 0, 0.1);
    },
    win: function () {
      var seq = [523, 659, 784, 1047];
      for (var i = 0; i < seq.length; i++)
        tone(seq[i], 0.22, "triangle", 0.16, 0, i * 0.11);
      noiseHit(0.5, 700, 0.2, 0.44);
    },
    splash: function () {
      noiseHit(0.6, 500, 0.3);
    },
  };

  function updateAudio(dt) {
    if (!actx || !cart) return;
    var prox = clamp(1 - (cart.s - wall.s) / 900, 0, 1);
    var rv =
      mode === "run" || mode === "winning"
        ? clamp(cart.v / 900, 0, 1) * (0.14 + prox * 0.22) + prox * 0.06
        : 0;
    rumbleGain.gain.setTargetAtTime(muted ? 0 : rv, actx.currentTime, 0.08);
    rumbleFilter.frequency.setTargetAtTime(
      70 + cart.v * 0.3,
      actx.currentTime,
      0.1,
    );
    var sq =
      held() && cart.v > 60 && !cart.jammed && mode === "run"
        ? 0.04 + cart.heat * 0.09
        : 0;
    squealGain.gain.setTargetAtTime(muted ? 0 : sq, actx.currentTime, 0.05);
    if (sq > 0) {
      squealOsc.frequency.setTargetAtTime(
        640 + cart.heat * 1100 + Math.sin(nowSec * 31) * 45,
        actx.currentTime,
        0.03,
      );
    }
  }

  function toggleSound() {
    muted = !muted;
    btnSound.classList.toggle("off", muted);
    if (actx && master)
      master.gain.setTargetAtTime(muted ? 0 : 0.85, actx.currentTime, 0.02);
    if (!muted) ensureAudio();
  }

  /* ---------- input ---------- */

  var keyBrake = false,
    pointers = new Set();

  function held() {
    return keyBrake || pointers.size > 0;
  }

  window.addEventListener("keydown", function (e) {
    var c = e.code;
    if (c === "Space" || c === "ArrowDown" || c === "KeyS" || c === "Enter") {
      e.preventDefault();
      if (e.repeat) return;
      ensureAudio();
      if (mode === "title" || mode === "win" || mode === "lose") {
        primaryAction();
        return;
      }
      if (c !== "Enter") keyBrake = true;
    } else if (c === "KeyP" || c === "Escape") {
      e.preventDefault();
      togglePause();
    } else if (c === "KeyM") {
      ensureAudio();
      toggleSound();
    } else if (c === "KeyR") {
      ensureAudio();
      if (mode !== "title") newSeedRun("count");
    }
  });

  window.addEventListener("keyup", function (e) {
    var c = e.code;
    if (c === "Space" || c === "ArrowDown" || c === "KeyS") keyBrake = false;
  });

  frameEl.addEventListener("pointerdown", function (e) {
    if (e.target.closest("button") || e.target.closest("a")) return;
    ensureAudio();
    if (mode === "title" || mode === "win" || mode === "lose") {
      primaryAction();
      return;
    }
    pointers.add(e.pointerId);
    try {
      frameEl.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ok */
    }
  });

  function pointerEnd(e) {
    pointers.delete(e.pointerId);
  }
  frameEl.addEventListener("pointerup", pointerEnd);
  frameEl.addEventListener("pointercancel", pointerEnd);
  frameEl.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  overlayEl.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el) return;
    ensureAudio();
    var act = el.getAttribute("data-act");
    if (act === "start") newSeedRun("count");
    else if (act === "resume") togglePause();
    else if (act === "retry") newSeedRun("count");
  });

  btnPause.addEventListener("click", function () {
    ensureAudio();
    togglePause();
  });
  btnSound.addEventListener("click", function () {
    ensureAudio();
    toggleSound();
  });
  btnRestart.addEventListener("click", function () {
    ensureAudio();
    newSeedRun("count");
  });

  function primaryAction() {
    if (mode === "title" || mode === "win" || mode === "lose")
      newSeedRun("count");
  }

  function togglePause() {
    if (mode === "run" || mode === "count") {
      pausedFrom = mode;
      mode = "pause";
      showCard(pauseCard());
      btnPause.textContent = "▶";
    } else if (mode === "pause") {
      mode = pausedFrom;
      hideOverlay();
      btnPause.textContent = "❚❚";
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (mode === "run" || mode === "count") togglePause();
      if (actx) actx.suspend();
    } else if (actx) {
      actx.resume();
    }
  });

  /* ---------- overlays ---------- */

  var TAGLINE = "Gravity is the engine. The brake is the whole job.";

  function showCard(html) {
    overlayEl.innerHTML = html;
    overlayEl.classList.remove("hidden");
  }

  function hideOverlay() {
    overlayEl.classList.add("hidden");
  }

  function titleCard() {
    return (
      '<div class="card">' +
      "<h1>Brakefall</h1>" +
      '<p class="tag">' +
      TAGLINE +
      "</p>" +
      '<ul class="how">' +
      "<li><strong>Hold</strong> Space, mouse or finger — that is the whole brake.</li>" +
      "<li>Crawl the <strong>posted hairpins</strong>: arrive hot and the axle snaps.</li>" +
      "<li>Rotten <strong>trestles</strong> shed ore above their limit.</li>" +
      "<li>Ride the brake and the shoes <strong>fade</strong>, then jam. Pump them.</li>" +
      "<li>The <strong>collapse</strong> behind you will not wait. Reach the sump.</li>" +
      "</ul>" +
      '<p class="goal">Five flights down · three spare axles · save the ore</p>' +
      '<button class="cta" type="button" data-act="start">Drop the pin ⬇</button>' +
      '<p class="keys"><b>Hold</b> space / touch to brake · <b>P</b> pause · <b>M</b> sound · <b>R</b> restart</p>' +
      "</div>"
    );
  }

  function pauseCard() {
    return (
      '<div class="card">' +
      "<h2>Paused</h2>" +
      '<p class="reason">The dust hangs in the dark. For now.</p>' +
      '<button class="cta" type="button" data-act="resume">Back to the rail ▶</button>' +
      '<p class="keys"><b>P</b> resumes · <b>R</b> restarts the shift</p>' +
      "</div>"
    );
  }

  function loseCard(reason) {
    var h =
      reason === "buried" ? "The collapse took the gangway." : "Axle snapped.";
    var flavour =
      reason === "buried"
        ? "The dust rolled over the cart at Flight " +
          (flightOf(cart.s) + 1) +
          "."
        : "Wrecked at Flight " +
          (flightOf(cart.s) + 1) +
          ", " +
          fmt(depthOf(cart.s)) +
          " m down.";
    return (
      '<div class="card" data-state="lose">' +
      "<h2>" +
      h +
      "</h2>" +
      '<p class="reason">' +
      flavour +
      " Ore saved: <b>" +
      fmt(cargo) +
      "%</b>.</p>" +
      '<button class="cta" type="button" data-act="retry">Mule another cart ↻</button>' +
      '<p class="keys"><b>Space</b> retries · <b>R</b> restarts</p>' +
      "</div>"
    );
  }

  function winCard(t) {
    return (
      '<div class="card" data-state="win">' +
      "<h2>Sump reached!</h2>" +
      '<p class="tag">The cart tips its load into the sluice. The dust never caught you.</p>' +
      '<div class="tally">' +
      row("Ore banked", fmt(t.cargo) + "% × 12", t.orePts) +
      row("Spare axles", t.hearts + " × 80", t.axlePts) +
      row("Shift time", fmt(t.elapsed) + " s", t.timePts) +
      '<div class="row total"><span>Pay packet</span><span>' +
      fmt(t.total) +
      "</span></div>" +
      "</div>" +
      '<button class="cta" type="button" data-act="retry">Run it again ↻</button>' +
      '<p class="keys"><b>Space</b> runs it again</p>' +
      "</div>"
    );
  }

  function row(label, detail, val) {
    return (
      '<div class="row"><span>' +
      label +
      " <small>(" +
      detail +
      ")</small></span><span>+" +
      fmt(val) +
      "</span></div>"
    );
  }

  /* ---------- particles & floaters ---------- */

  function spawn(type, x, y, vx, vy, life, size) {
    if (particles.length > 420) particles.shift();
    particles.push({
      type: type,
      x: x,
      y: y,
      vx: vx,
      vy: vy,
      life: life,
      max: life,
      size: size,
    });
  }

  function floatText(txt, x, y, col) {
    floaters.push({ txt: txt, x: x, y: y, life: 1.0, col: col || COL.amber });
  }

  function stepParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      if (p.type === "spark") {
        p.vy += 900 * dt;
      } else if (p.type === "ore") {
        p.vy += 700 * dt;
      } else if (p.type === "smoke") {
        p.vy -= 60 * dt;
        p.vx *= 0.98;
      } else if (p.type === "dust") {
        p.vx *= 0.985;
        p.vy *= 0.985;
      } else if (p.type === "splash") {
        p.vy += 800 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (var j = floaters.length - 1; j >= 0; j--) {
      floaters[j].life -= dt;
      floaters[j].y -= 42 * dt;
      if (floaters[j].life <= 0) floaters.splice(j, 1);
    }
  }

  /* ---------- game logic ---------- */

  function flightOf(s) {
    return clamp(posAt(s).flight, 0, FLIGHTS - 1);
  }
  function depthOf(s) {
    return Math.round((s / W.totalS) * 340);
  }
  function onBrace(s) {
    var p = posAt(s);
    return p.kind === "brace";
  }

  function brakeEffect() {
    if (cart.jammed) return 0;
    if (cart.heat < 0.55) return 1;
    return Math.max(0.15, 1 - ((cart.heat - 0.55) / 0.45) * 0.85);
  }

  function wallSpeed() {
    var f = flightOf(cart.s);
    var v = WALL_BASE + f * WALL_PER_FLIGHT;
    var gap = cart.s - wall.s;
    if (gap > 2200) v *= 1.45;
    else if (gap > 1500) v *= 1.2;
    if (gap < 380) v *= 0.9;
    if (onBrace(cart.s)) v *= 0.55;
    return v;
  }

  function doScrape(c) {
    cargo = Math.max(0, cargo - 7);
    cart.v *= 0.8;
    shake = Math.max(shake, reducedMotion ? 2 : 7);
    snd.scrape();
    var p = posAt(c.s);
    floatText("-7 ore", p.x, p.y - 46, COL.danger);
    for (var i = 0; i < 16; i++) {
      spawn(
        "spark",
        p.x,
        p.y,
        (Math.random() - 0.5) * 320,
        -Math.random() * 260,
        0.5,
        2,
      );
    }
    refreshChips(true);
  }

  function doDerail() {
    cart.derailT = 1.15;
    cart.om = (Math.random() < 0.5 ? -1 : 1) * 9;
    cart.dAng = 0;
    cart.v *= 0.55;
    hearts--;
    cargo = Math.max(0, cargo - 15);
    shake = reducedMotion ? 3 : 14;
    snd.thud();
    var p = posAt(cart.s);
    for (var i = 0; i < 26; i++) {
      spawn(
        "ore",
        p.x,
        p.y - 10,
        (Math.random() - 0.5) * 420,
        -Math.random() * 380,
        0.9,
        3,
      );
    }
    wall.frozenUntil = nowSec + 1.3;
    refreshChips(true);
    chipLives.classList.remove("hurt");
    void chipLives.offsetWidth;
    chipLives.classList.add("hurt");
  }

  function resolveAfterDerail() {
    if (hearts <= 0) {
      beginLose("derailed");
      return;
    }
    cart.s = checkpoint;
    cart.prevS = checkpoint;
    cart.v = 0;
    cart.heat = 0;
    cart.jammed = false;
    cart.dAng = 0;
    cart.om = 0;
    wall.s = checkpoint - RESPAWN_GAP;
    wall.frozenUntil = nowSec + 0.9;
  }

  function doBuried() {
    hearts--;
    snd.boom();
    shake = reducedMotion ? 4 : 18;
    buriedPulse = 1;
    var p = posAt(cart.s);
    for (var i = 0; i < 40; i++) {
      spawn(
        "dust",
        p.x - 60 + Math.random() * 120,
        p.y - Math.random() * 60,
        (Math.random() - 0.3) * 160,
        -Math.random() * 120,
        1.4,
        26 + Math.random() * 30,
      );
    }
    if (hearts <= 0) {
      beginLose("buried");
      return;
    }
    cart.s = checkpoint;
    cart.prevS = checkpoint;
    cart.v = 0;
    cart.heat = 0;
    cart.jammed = false;
    wall.s = checkpoint - RESPAWN_GAP;
    wall.frozenUntil = nowSec + 1.0;
    refreshChips(true);
  }

  function beginLose(reason) {
    loseReason = reason;
    mode = "losing";
    animT = reason === "buried" ? 1.25 : 0.9;
  }

  function beginWin() {
    mode = "winning";
    animT = 1.7;
    cart.poured = false;
    snd.win();
  }

  function finishWin() {
    var timePts = Math.max(0, 2200 - Math.floor(elapsed) * 14);
    var orePts = Math.round(cargo) * 12;
    var axlePts = hearts * 80;
    tally = {
      cargo: Math.round(cargo),
      hearts: hearts,
      elapsed: Math.floor(elapsed),
      orePts: orePts,
      axlePts: axlePts,
      timePts: timePts,
      total: orePts + axlePts + timePts,
    };
    mode = "win";
    showCard(winCard(tally));
  }

  function stepRun(dt) {
    var braking = held();

    if (cart.derailT > 0) {
      cart.derailT -= dt;
      cart.dAng += cart.om * dt;
      cart.om *= 0.985;
      cart.v = Math.max(0, cart.v - 520 * dt);
      var dp = posAt(cart.s);
      cart.s += cart.v * dt;
      cart.dist += cart.v * dt;
      if (Math.random() < 0.5) {
        spawn(
          "spark",
          dp.x,
          dp.y,
          (Math.random() - 0.5) * 200,
          -Math.random() * 200,
          0.4,
          2,
        );
      }
      if (cart.derailT <= 0) resolveAfterDerail();
      advanceWall(dt);
      return;
    }

    var p0 = posAt(cart.s);
    var sinT = Math.sin(p0.ang);
    var acc = GRAV * sinT - ROLL - DRAG_K * cart.v * cart.v;
    if (braking) acc -= BRAKE * brakeEffect();

    cart.prevS = cart.s;
    cart.v = Math.max(0, cart.v + acc * dt);
    cart.s += cart.v * dt;
    cart.dist += cart.v * dt;

    // brake heat
    if (braking && cart.v > 25) {
      cart.heat = clamp(cart.heat + dt * (HEAT_IN + cart.v * HEAT_V), 0, 1);
      if (cart.heat >= 1) cart.jammed = true;
      if (cart.heat > 0.7 && Math.random() < 0.5) {
        var hp = posAt(cart.s);
        spawn(
          "smoke",
          hp.x,
          hp.y - 12,
          (Math.random() - 0.5) * 30,
          -20,
          0.9,
          5,
        );
      }
    } else {
      var cool = HEAT_OUT + (onBrace(cart.s) ? HEAT_BRACE : 0);
      cart.heat = clamp(cart.heat - dt * cool, 0, 1);
      if (cart.jammed && cart.heat <= 0.62) cart.jammed = false;
    }

    // corners
    for (var ci = 0; ci < W.corners.length; ci++) {
      var c = W.corners[ci];
      if (cart.prevS < c.s && cart.s >= c.s) {
        if (cart.v > c.limit * 1.06) {
          doDerail();
          return;
        }
        if (cart.v >= c.limit * 0.95) {
          doScrape(c);
        } else snd.chime();
      }
    }

    // rotten trestles
    for (var ri = 0; ri < W.roughs.length; ri++) {
      var rg = W.roughs[ri];
      if (cart.s > rg.s0 && cart.s < rg.s1 && cart.v > rg.limit) {
        cargo = Math.max(0, cargo - (cart.v - rg.limit) * dt * 0.05);
        shake = Math.max(shake, reducedMotion ? 1 : 3.5);
        if (Math.random() < 0.35) {
          var rp = posAt(cart.s);
          spawn("dust", rp.x, rp.y, (Math.random() - 0.5) * 60, -30, 0.6, 8);
          spawn(
            "ore",
            rp.x,
            rp.y - 8,
            (Math.random() - 0.5) * 120,
            -160,
            0.7,
            2.5,
          );
        }
      }
    }

    // ore sacks
    for (var si = 0; si < W.sacks.length; si++) {
      var sk = W.sacks[si];
      if (!sk.taken && Math.abs(cart.s - sk.s) < 26) {
        sk.taken = true;
        cargo = Math.min(100, cargo + 5);
        snd.sack();
        var sp = posAt(sk.s);
        floatText("+5 ore", sp.x, sp.y - 40, COL.safe);
        refreshChips(true);
      }
    }

    // brace checkpoints
    for (var bi = 0; bi < W.braces.length; bi++) {
      var b = W.braces[bi];
      if (cart.prevS < b.s && cart.s >= b.s) {
        checkpoint = b.s;
        cart.heat = Math.max(0, cart.heat - 0.35);
        snd.clank();
        floatText("landing", b.x, b.y - 44, COL.amber);
      }
    }

    // win?
    if (cart.s >= W.winS) {
      beginWin();
      return;
    }

    advanceWall(dt);

    // buried?
    if (wall.s >= cart.s - 24) {
      doBuried();
      return;
    }

    // running dust from the wall face
    var gap = cart.s - wall.s;
    if (gap < 1000 && Math.random() < 0.6) {
      var wp = posAt(wall.s);
      spawn(
        "dust",
        wp.x + (Math.random() - 0.5) * 80,
        wp.y - Math.random() * 40,
        (Math.random() - 0.5) * 60,
        -40 - Math.random() * 60,
        1.1,
        14 + Math.random() * 18,
      );
    }

    // wheel sparks while braking hard at speed
    if (braking && cart.v > 380 && !cart.jammed && Math.random() < 0.4) {
      var bp = posAt(cart.s - 20);
      spawn(
        "spark",
        bp.x,
        bp.y + 4,
        -cart.v * 0.25 * Math.cos(bp.ang),
        -60 - Math.random() * 120,
        0.3,
        1.6,
      );
    }

    elapsed += dt;
  }

  function advanceWall(dt) {
    if (nowSec < wall.frozenUntil) return;
    if (mode !== "run") return;
    wall.s += wallSpeed() * dt;
  }

  function stepWinning(dt) {
    animT -= dt;
    var decel = 420;
    cart.v = Math.max(0, cart.v - decel * dt);
    cart.s = Math.min(W.totalS, cart.s + cart.v * dt);
    cart.dist += cart.v * dt;
    if (cart.v < 30) {
      cart.tip = Math.min(0.5, cart.tip + dt * 0.8);
      if (!cart.poured && cart.tip > 0.3) {
        cart.poured = true;
        snd.splash();
        var p = posAt(cart.s);
        for (var i = 0; i < 30; i++) {
          spawn(
            "ore",
            p.x + 30,
            p.y - 14,
            120 + Math.random() * 220,
            -80 - Math.random() * 160,
            1.0,
            3,
          );
          if (i % 3 === 0) {
            spawn(
              "splash",
              p.x + 120 + Math.random() * 80,
              W.waterY,
              (Math.random() - 0.5) * 160,
              -260 - Math.random() * 220,
              0.9,
              3,
            );
          }
        }
      }
    }
    if (animT <= 0) finishWin();
  }

  function stepLosing(dt) {
    animT -= dt;
    if (loseReason === "derailed" && cart.derailT > 0) {
      cart.derailT -= dt;
      cart.dAng += cart.om * dt;
    }
    if (animT <= 0) {
      mode = "lose";
      showCard(loseCard(loseReason));
    }
  }

  /* ---------- chips ---------- */

  var chipTick = 0;
  function refreshChips(force) {
    chipFlight.textContent =
      "Flight " +
      (flightOf(cart.s) + 1) +
      "/" +
      FLIGHTS +
      " · " +
      fmt(depthOf(cart.s)) +
      " m";
    chipOre.textContent = "Ore " + fmt(cargo) + "%";
    var htxt = "";
    for (var i = 0; i < 3; i++) htxt += i < hearts ? "♥" : "♡";
    chipLives.textContent = htxt;
  }

  /* ---------- rendering ---------- */

  var dpr = 1,
    cw = 0,
    ch = 0;

  function resize() {
    var r = frameEl.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = Math.max(320, r.width);
    ch = Math.max(240, r.height);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  window.addEventListener("resize", resize);

  function seededJitter(seed) {
    var x = Math.sin(seed * 127.1) * 43758.5453;
    return x - Math.floor(x);
  }

  function drawStrata() {
    // parallax rock bands, screen space
    var offY = (-cam.y * 0.35) % 96;
    var offX = (-cam.x * 0.22) % 140;
    ctx.fillStyle = COL.rock;
    ctx.fillRect(0, 0, cw, ch);
    for (var i = -1; i < ch / 96 + 2; i++) {
      var yy = offY + i * 96;
      var shade = i % 2 === 0 ? "rgba(255,190,120,0.022)" : "rgba(0,0,0,0.16)";
      ctx.fillStyle = shade;
      ctx.fillRect(0, yy, cw, 48);
      for (var k = 0; k < 7; k++) {
        var sx =
          ((offX + k * 140 + seededJitter(i * 13 + k) * 120) % (cw + 60)) - 30;
        var sy = yy + 20 + seededJitter(i * 7 + k * 3) * 40;
        ctx.fillStyle = "rgba(255,200,140,0.05)";
        ctx.fillRect(sx, sy, 3 + seededJitter(k + i) * 5, 2);
      }
    }
  }

  function worldToScreenSetup(shakeX, shakeY) {
    ctx.save();
    ctx.translate(shakeX, shakeY);
    ctx.translate(cw / 2, ch * 0.56);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);
  }

  function drawRails(sLo, sHi) {
    for (var i = 0; i < W.segs.length; i++) {
      var g = W.segs[i];
      if (g.s1 < sLo || g.s0 > sHi) continue;
      var a = Math.max(g.s0, sLo),
        b = Math.min(g.s1, sHi);
      var ta = (a - g.s0) / g.len,
        tb = (b - g.s0) / g.len;
      var ax = g.x0 + g.dx * ta,
        ay = g.y0 + g.dy * ta;
      var bx = g.x0 + g.dx * tb,
        by = g.y0 + g.dy * tb;
      var nx = -g.dy / g.len,
        ny = g.dx / g.len;

      // ballast
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 26;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      // ties
      var step = g.kind === "leg" ? 26 : 20;
      ctx.strokeStyle = COL.tie;
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (var s = Math.ceil(a / step) * step; s <= b; s += step) {
        var t = (s - g.s0) / g.len;
        if (t < 0 || t > 1) continue;
        var px = g.x0 + g.dx * t,
          py = g.y0 + g.dy * t;
        var broken = inRough(s);
        if (broken && Math.floor(s / step) % 3 === 0) continue; // missing ties
        ctx.moveTo(px - nx * 15, py - ny * 15);
        ctx.lineTo(px + nx * 15, py + ny * 15);
      }
      ctx.stroke();

      // rails
      for (var side = -1; side <= 1; side += 2) {
        ctx.strokeStyle = side < 0 ? COL.railDark : COL.rail;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(ax + nx * 7 * side, ay + ny * 7 * side);
        ctx.lineTo(bx + nx * 7 * side, by + ny * 7 * side);
        ctx.stroke();
      }
    }

    // chevrons before each corner
    for (var ci = 0; ci < W.corners.length; ci++) {
      var c = W.corners[ci];
      if (c.s < sLo - 200 || c.s > sHi + 200) continue;
      for (var k = 0; k < 3; k++) {
        var cs = c.s - 130 - k * 55;
        if (cs < sLo) continue;
        var cp = posAt(cs);
        var dxn = Math.cos(cp.ang),
          dyn = Math.sin(cp.ang);
        ctx.strokeStyle = "rgba(255,207,125," + (0.55 - k * 0.15) + ")";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cp.x - dxn * 10, cp.y - dyn * 10 - 16);
        ctx.lineTo(cp.x + dxn * 6, cp.y + dyn * 6 - 16);
        ctx.lineTo(cp.x - dxn * 10, cp.y - dyn * 10 - 8);
        ctx.stroke();
      }
    }
  }

  function inRough(s) {
    for (var ri = 0; ri < W.roughs.length; ri++) {
      if (s > W.roughs[ri].s0 && s < W.roughs[ri].s1) return true;
    }
    return false;
  }

  function drawFeatures(sLo, sHi) {
    // timbers along legs
    var startK = Math.floor(sLo / 380),
      endK = Math.ceil(sHi / 380);
    for (var k = startK; k <= endK; k++) {
      var s = k * 380;
      if (s <= 0 || s >= W.totalS) continue;
      var p = posAt(s);
      if (p.kind !== "leg") continue;
      var nx = -Math.sin(p.ang),
        ny = Math.cos(p.ang);
      ctx.strokeStyle = "rgba(74,48,24,0.9)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(p.x - nx * 30, p.y - ny * 30);
      ctx.lineTo(p.x + nx * 30, p.y + ny * 30);
      ctx.moveTo(p.x - nx * 26, p.y - ny * 26 - 46);
      ctx.lineTo(p.x + nx * 26, p.y + ny * 26 - 46);
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(p.x - nx * 26, p.y - ny * 26 - 46);
      ctx.lineTo(p.x - nx * 26, p.y - ny * 26);
      ctx.moveTo(p.x + nx * 26, p.y + ny * 26 - 46);
      ctx.lineTo(p.x + nx * 26, p.y + ny * 26);
      ctx.stroke();
    }

    // rotten trestle patches
    for (var ri = 0; ri < W.roughs.length; ri++) {
      var rg = W.roughs[ri];
      if (rg.s1 < sLo || rg.s0 > sHi) continue;
      var mp = posAt((rg.s0 + rg.s1) / 2);
      ctx.fillStyle = "rgba(255,120,60,0.10)";
      ctx.beginPath();
      ctx.ellipse(mp.x, mp.y, (rg.s1 - rg.s0) / 2, 26, mp.ang, 0, Math.PI * 2);
      ctx.fill();
    }

    // brace landings
    for (var bi = 0; bi < W.braces.length; bi++) {
      var b = W.braces[bi];
      if (b.s < sLo - 300 || b.s > sHi + 300) continue;
      ctx.fillStyle = "#54371c";
      ctx.fillRect(b.x - 90, b.y + 6, 180, 12);
      ctx.fillStyle = COL.woodDark;
      ctx.fillRect(b.x + 78, b.y - 26, 14, 40); // stop block
      // lantern
      ctx.fillStyle = "#2a1a0e";
      ctx.fillRect(b.x - 84, b.y - 58, 4, 52);
      var flick = 0.75 + Math.sin(nowSec * 9 + bi) * 0.12;
      ctx.fillStyle = "rgba(255,190,90," + flick + ")";
      ctx.beginPath();
      ctx.arc(b.x - 82, b.y - 62, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,170,60,0.12)";
      ctx.beginPath();
      ctx.arc(b.x - 82, b.y - 62, 34, 0, Math.PI * 2);
      ctx.fill();
    }

    // corner placards
    for (var ci = 0; ci < W.corners.length; ci++) {
      var c = W.corners[ci];
      if (c.s < sLo - 200 || c.s > sHi + 400) continue;
      var py = c.y - 92;
      ctx.strokeStyle = "#3a2714";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(c.x, py + 26);
      ctx.lineTo(c.x, py);
      ctx.stroke();
      ctx.fillStyle = "#20150c";
      ctx.strokeStyle = c.kind === "brace" ? "#86d06a" : "#e8b04b";
      ctx.lineWidth = 2.5;
      roundRect(c.x - 33, py - 30, 66, 34, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COL.ink;
      ctx.font = "bold 21px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fmt(c.limit), c.x, py - 12);
      ctx.font = "9px system-ui, sans-serif";
      ctx.fillStyle = "#c9a878";
      ctx.fillText(c.kind === "brace" ? "LANDING" : "HAIRPIN", c.x, py + 36);
    }

    // ore sacks
    for (var si = 0; si < W.sacks.length; si++) {
      var sk = W.sacks[si];
      if (sk.taken || sk.s < sLo || sk.s > sHi) continue;
      var kp = posAt(sk.s);
      var bob = Math.sin(nowSec * 4 + sk.s) * 3;
      ctx.fillStyle = "#b5813f";
      ctx.beginPath();
      ctx.ellipse(kp.x, kp.y - 14 + bob, 11, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#6e4c22";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(kp.x - 5, kp.y - 24 + bob);
      ctx.lineTo(kp.x + 5, kp.y - 24 + bob);
      ctx.stroke();
      ctx.fillStyle =
        "rgba(255,220,150," +
        (0.5 + Math.sin(nowSec * 6 + sk.s * 2) * 0.3) +
        ")";
      ctx.beginPath();
      ctx.arc(kp.x, kp.y - 15 + bob, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // pier, sluice and water
    var pier = W.segs[W.segs.length - 1];
    if (pier.s1 > sLo - 600) {
      ctx.fillStyle = "#4a3018";
      for (var pi2 = 0; pi2 < 10; pi2++) {
        ctx.fillRect(pier.x0 + 20 + pi2 * 46, pier.y0 + 4, 38, 9);
      }
      ctx.strokeStyle = "#2a1a0e";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(pier.x0 + 250, pier.y0 + 12);
      ctx.lineTo(pier.x0 + 250, pier.y0 - 40);
      ctx.stroke();
      ctx.fillStyle = "#20150c";
      roundRect(pier.x0 + 232, pier.y0 - 66, 36, 28, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,207,125,0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var sl = 0; sl < 4; sl++) {
        ctx.moveTo(pier.x0 + 236, pier.y0 - 60 + sl * 7);
        ctx.lineTo(pier.x0 + 264, pier.y0 - 60 + sl * 7);
      }
      ctx.stroke();
    }
    if (W.waterY - cam.y * cam.z < ch * 1.6) {
      var wl = cam.x - cw / cam.z,
        wr = cam.x + cw / cam.z;
      var grad = ctx.createLinearGradient(0, W.waterY - 30, 0, W.waterY + 260);
      grad.addColorStop(0, COL.waterHi);
      grad.addColorStop(1, "#0a161a");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(wl, W.waterY + 260);
      ctx.lineTo(wl, W.waterY);
      for (var wx = wl; wx < wr; wx += 24) {
        ctx.lineTo(wx, W.waterY + Math.sin(wx * 0.02 + nowSec * 2.2) * 5);
      }
      ctx.lineTo(wr, W.waterY + 260);
      ctx.closePath();
      ctx.fill();
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

  function drawWall(sLo, sHi) {
    if (wall.s < sLo - 700) return;
    var wp = posAt(Math.max(0, wall.s));
    var churn = Math.floor(wall.s / 50);
    ctx.fillStyle = "#241209";
    for (var i = 0; i < 16; i++) {
      var back =
        wp.x - Math.cos(wp.ang) * (i * 22 + seededJitter(churn + i) * 14);
      var backY =
        wp.y - Math.sin(wp.ang) * (i * 22 + seededJitter(churn + i) * 14);
      var r = 20 + (i % 5) * 10 + seededJitter(churn * 3 + i) * 12;
      ctx.beginPath();
      ctx.arc(
        back + (seededJitter(churn + i * 7) - 0.5) * 30,
        backY - 14 - seededJitter(churn + i * 3) * 22,
        r,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,140,70,0.05)";
    ctx.beginPath();
    ctx.arc(wp.x, wp.y - 30, 90, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCart() {
    var p = posAt(cart.s);
    var ang = p.ang + cart.dAng + (p.kind === "pier" ? cart.tip : 0);
    var wob = Math.min(cart.v / 700, 1) * Math.sin(cart.dist * 0.05) * 0.025;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang + wob);

    // headlamp cone
    var lg = ctx.createLinearGradient(0, 0, 330, 0);
    lg.addColorStop(0, "rgba(255,214,140,0.16)");
    lg.addColorStop(1, "rgba(255,214,140,0)");
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(20, -14);
    ctx.lineTo(340, -66);
    ctx.lineTo(340, 40);
    ctx.closePath();
    ctx.fill();

    // wheels
    ctx.fillStyle = "#2a1a0e";
    for (var wi = -1; wi <= 1; wi += 2) {
      ctx.save();
      ctx.translate(wi * 16, 10);
      ctx.rotate(cart.dist / 9);
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#6e4c22";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(7, 0);
      ctx.moveTo(0, -7);
      ctx.lineTo(0, 7);
      ctx.stroke();
      ctx.restore();
    }

    // bed
    ctx.fillStyle = COL.wood;
    ctx.strokeStyle = COL.woodDark;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-27, 10);
    ctx.lineTo(-23, -14);
    ctx.lineTo(23, -14);
    ctx.lineTo(27, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(42,26,14,0.7)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-25, 2);
    ctx.lineTo(26, 2);
    ctx.moveTo(-24, -6);
    ctx.lineTo(25, -6);
    ctx.stroke();

    // ore load
    var oh = (cargo / 100) * 13;
    if (oh > 1) {
      ctx.fillStyle = COL.ore;
      ctx.beginPath();
      ctx.moveTo(-21, -14);
      ctx.quadraticCurveTo(-12, -14 - oh, -2, -13 - oh * 0.8);
      ctx.quadraticCurveTo(8, -14 - oh * 1.1, 21, -14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,220,170,0.35)";
      ctx.beginPath();
      ctx.arc(-8, -15 - oh * 0.6, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(7, -16 - oh * 0.5, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // brake shoe glow
    var e = brakeEffect();
    var heatCol =
      cart.heat > 0.05
        ? "rgb(" +
          Math.round(lerp(70, 255, cart.heat)) +
          "," +
          Math.round(lerp(40, 90, cart.heat)) +
          ",26)"
        : "#4a2a18";
    ctx.fillStyle = heatCol;
    ctx.fillRect(-24, 2, 9, 6);
    if (cart.heat > 0.55) {
      var fl = 0.4 + Math.sin(nowSec * 22) * 0.2;
      ctx.fillStyle = "rgba(255,122,60," + fl + ")";
      ctx.beginPath();
      ctx.arc(-19, 5, 10, 0, Math.PI * 2);
      ctx.fill();
    }

    // lamp housing
    ctx.fillStyle = "#e8b04b";
    ctx.beginPath();
    ctx.arc(22, -16, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,235,180,0.9)";
    ctx.beginPath();
    ctx.arc(22, -16, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // ambient lamp light
    var glow = ctx.createRadialGradient(p.x, p.y - 8, 10, p.x, p.y - 8, 430);
    glow.addColorStop(0, "rgba(255,190,110,0.14)");
    glow.addColorStop(1, "rgba(255,190,110,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y - 8, 430, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var a = clamp(p.life / p.max, 0, 1);
      if (p.type === "spark") {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = "rgba(255,180,80," + a + ")";
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      } else if (p.type === "dust" || p.type === "smoke") {
        ctx.fillStyle =
          p.type === "dust"
            ? "rgba(120,88,58," + a * 0.3 + ")"
            : "rgba(140,130,120," + a * 0.25 + ")";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.6 - a * 0.6), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === "ore") {
        ctx.fillStyle = "rgba(201,138,75," + a + ")";
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else if (p.type === "splash") {
        ctx.fillStyle = "rgba(170,220,230," + a + ")";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.textAlign = "center";
    for (var f = 0; f < floaters.length; f++) {
      var fl = floaters[f];
      ctx.font = "bold 15px system-ui, sans-serif";
      ctx.fillStyle = "rgba(0,0,0," + fl.life * 0.5 + ")";
      ctx.fillText(fl.txt, fl.x + 1, fl.y + 1);
      ctx.globalAlpha = clamp(fl.life, 0, 1);
      ctx.fillStyle = fl.col;
      ctx.fillText(fl.txt, fl.x, fl.y);
      ctx.globalAlpha = 1;
    }
  }

  function gauge(x, y, w, label, frac, markerFrac, col, alertTxt) {
    ctx.fillStyle = "rgba(16,10,6,0.72)";
    roundRect(x - 8, y - 20, w + 16, 44, 8);
    ctx.fill();
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#c9a878";
    ctx.fillText(label, x, y - 8);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    roundRect(x, y, w, 10, 5);
    ctx.fill();
    ctx.fillStyle = col;
    roundRect(x, y, Math.max(3, w * clamp(frac, 0, 1)), 10, 5);
    ctx.fill();
    if (markerFrac != null) {
      var mx = x + w * clamp(markerFrac, 0, 1);
      ctx.fillStyle = COL.ink;
      ctx.beginPath();
      ctx.moveTo(mx, y - 2);
      ctx.lineTo(mx - 5, y - 9);
      ctx.lineTo(mx + 5, y - 9);
      ctx.closePath();
      ctx.fill();
    }
    if (alertTxt && Math.floor(nowSec * 4) % 2 === 0) {
      ctx.textAlign = "right";
      ctx.fillStyle = COL.danger;
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillText(alertTxt, x + w, y - 8);
    }
  }

  function drawHud() {
    // next corner marker info
    var next = null;
    for (var i = 0; i < W.corners.length; i++) {
      if (W.corners[i].s > cart.s - 10) {
        next = W.corners[i];
        break;
      }
    }
    var markerFrac = next ? next.limit / MAX_SPEED_REF : null;

    gauge(
      18,
      ch - 30,
      190,
      "SPEED",
      cart.v / MAX_SPEED_REF,
      markerFrac,
      cart.v > (next ? next.limit : 1e9) ? COL.danger : COL.safe,
      null,
    );
    gauge(
      cw - 198,
      ch - 30,
      150,
      "HEAT",
      cart.heat,
      0.55,
      cart.heat > 0.55 ? COL.ember : "#8a5a2e",
      cart.jammed
        ? "JAMMED"
        : brakeEffect() < 0.5 && cart.heat > 0.55
          ? "FADED"
          : null,
    );

    // dust proximity
    var gap = cart.s - wall.s;
    var m = Math.max(0, Math.round(gap * 0.085));
    var close = gap < 420;
    ctx.textAlign = "center";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillStyle = close
      ? Math.floor(nowSec * 6) % 2 === 0
        ? COL.danger
        : "#ffb49e"
      : "rgba(242,226,196,0.75)";
    ctx.fillText("▼ collapse " + m + " m", cw / 2, 46);

    if (close) {
      var a = (1 - gap / 420) * (0.14 + Math.sin(nowSec * 6) * 0.06);
      var vg = ctx.createLinearGradient(0, 0, 0, ch * 0.4);
      vg.addColorStop(0, "rgba(150,40,20," + Math.max(0, a) + ")");
      vg.addColorStop(1, "rgba(150,40,20,0)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, cw, ch * 0.4);
    }

    // countdown
    if (mode === "count") {
      ctx.fillStyle = "rgba(8,5,3,0.45)";
      ctx.fillRect(0, 0, cw, ch);
      var pulse = 0.6 + Math.sin(nowSec * 8) * 0.4;
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,207,125," + pulse + ")";
      ctx.font = "bold 30px system-ui, sans-serif";
      ctx.fillText("HOLD TO BRAKE", cw / 2, ch / 2 - 6);
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillStyle = "rgba(242,226,196,0.85)";
      ctx.fillText(
        "release on the straights — mind the heat",
        cw / 2,
        ch / 2 + 22,
      );
    }

    // vignette
    var rad = ctx.createRadialGradient(
      cw / 2,
      ch / 2,
      ch * 0.35,
      cw / 2,
      ch / 2,
      ch * 0.85,
    );
    rad.addColorStop(0, "rgba(0,0,0,0)");
    rad.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, cw, ch);
  }

  function render() {
    resizeIfNeeded();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStrata();

    var p = posAt(cart.s);
    var viewW = cw / cam.z;
    var sLo = cart.s - viewW * 0.8 - 300;
    var sHi = cart.s + viewW * 0.95 + 400;
    if (wall.s > sLo - 500) sLo = Math.min(sLo, wall.s - 200);

    var shX = 0,
      shY = 0;
    if (shake > 0.1 && !reducedMotion) {
      shX = (Math.random() - 0.5) * shake;
      shY = (Math.random() - 0.5) * shake;
    }

    worldToScreenSetup(shX, shY);
    drawRails(clamp(sLo, 0, W.totalS), clamp(sHi, 0, W.totalS));
    drawFeatures(sLo, sHi);
    drawWall(sLo, sHi);
    drawCart();
    drawParticles();
    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawHud();
  }

  var lastW = 0,
    lastH = 0;
  function resizeIfNeeded() {
    var r = frameEl.getBoundingClientRect();
    if (
      Math.abs(r.width - lastW) > 1 ||
      Math.abs(r.height - lastH) > 1 ||
      canvas.width === 0
    ) {
      lastW = r.width;
      lastH = r.height;
      resize();
    }
  }

  /* ---------- camera ---------- */

  function stepCamera(dt) {
    var p = posAt(cart.s);
    var look = 200 + cart.v * 0.22;
    var tx = p.x + Math.cos(p.ang) * look;
    var ty = p.y + Math.sin(p.ang) * look - 70;
    var zTarget = clamp(Math.min(cw / 1500, ch / 950), 0.4, 1.15);
    var k = Math.min(1, dt * 5);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    cam.z += (zTarget - cam.z) * Math.min(1, dt * 3);
  }

  /* ---------- main loop ---------- */

  var lastTs = 0;

  function frame(ts) {
    var dt = Math.min(0.033, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    nowSec += dt;

    if (mode === "count") {
      countT -= dt;
      var wasAbove = countT > 0.35;
      if (wasAbove && countT <= 0.35) snd.tick();
      if (countT <= 0) {
        mode = "run";
        snd.go();
      }
    } else if (mode === "run") {
      var steps = 2;
      for (var i = 0; i < steps && mode === "run"; i++) stepRun(dt / steps);
      shake = Math.max(0, shake - dt * 26);
    } else if (mode === "winning") {
      stepWinning(dt);
    } else if (mode === "losing") {
      stepLosing(dt);
    } else if (mode === "title") {
      // attract: idle lamp flicker only
    }

    if (mode !== "pause") {
      stepParticles(dt);
      stepCamera(dt);
      buriedPulse = Math.max(0, buriedPulse - dt);
      hurtFlash = Math.max(0, hurtFlash - dt);
    }

    chipTick += dt;
    if (chipTick > 0.12) {
      chipTick = 0;
      refreshChips();
    }

    updateAudio(dt);
    render();
    requestAnimationFrame(frame);
  }

  /* ---------- debug hook (only with #debug) ---------- */

  if (window.location.hash.indexOf("debug") !== -1) {
    window.__bf = {
      state: function () {
        return {
          mode: mode,
          hearts: hearts,
          cargo: Math.round(cargo),
          s: Math.round(cart.s),
          v: Math.round(cart.v),
          heat: Math.round(cart.heat * 100),
        };
      },
      win: function () {
        beginWin();
      },
      lose: function () {
        beginLose("buried");
      },
    };
  }

  /* ---------- boot ---------- */

  W = buildWorld(12345);
  resetCart();
  resize();
  cam.x = posAt(0).x + 200;
  cam.y = posAt(0).y - 70;
  showCard(titleCard());
  refreshChips(true);
  requestAnimationFrame(frame);
})();
