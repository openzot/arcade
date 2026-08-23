/*
 * Firefly Vespers — lead a scattered swarm of fireflies into one shared blink.
 *
 * You are the small gold fly. Every flash you make leaves an afterglow that
 * bends each neighbour's internal rhythm toward your beat (Kuramoto-style
 * pulse coupling). Flash on the swarm's beat and the unison rises; fill the
 * unison meter past the gold mark and hold it there to end the night. Flash
 * alone — or frantically — and the frog learns your rhythm: three strikes and
 * your vespers are over. Each night brings more voices, wider natural spreads,
 * angrier frogs and sooner fog.
 *
 * Everything lives in this one classic script, wrapped in an IIFE.
 */
(function () {
  "use strict";

  /* ============================== helpers ============================== */

  var TAU = Math.PI * 2;
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function rand(a, b) {
    return a + Math.random() * (b - a);
  }
  function wrap01(v) {
    v = v % 1;
    return v < 0 ? v + 1 : v;
  }
  /* shortest signed gap from phase a UP TO phase b, in [-0.5, 0.5) */
  function circGap(a, b) {
    var d = wrap01(b - a);
    return d > 0.5 ? d - 1 : d;
  }
  function circDist(a, b) {
    return Math.abs(circGap(a, b));
  }

  /* ================================= dom =============================== */

  var canvas = document.getElementById("scene");
  var ctx = canvas.getContext("2d");
  var elNight = document.getElementById("nightlabel");
  var elScore = document.getElementById("score");
  var elMeterFill = document.getElementById("meterfill");
  var elCombo = document.getElementById("combo");
  var elHearts = document.getElementById("hearts");
  var elFogWrap = document.getElementById("fogwrap");
  var elFogFill = document.getElementById("fogfill");
  var elBanner = document.getElementById("banner");
  var elOverlay = document.getElementById("overlay");
  var elOvTitle = document.getElementById("ovtitle");
  var elOvBody = document.getElementById("ovbody");
  var elOvRules = document.getElementById("ovrules");
  var elOvStats = document.getElementById("ovstats");
  var elOvButton = document.getElementById("ovbutton");
  var btnPause = document.getElementById("pausebtn");
  var btnMute = document.getElementById("mutebtn");

  var W = 0;
  var H = 0;
  var M = 0; /* min(W, H) — the swarm's measuring stick */

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    M = Math.min(W, H);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildScenery();
  }
  window.addEventListener("resize", resize);

  /* ================================ audio ============================== */

  var AC = window.AudioContext || window.webkitAudioContext;
  var ac = null;
  var master = null;
  var muted = false;

  function ensureAudio() {
    if (!AC) return;
    if (!ac) {
      try {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.85;
        master.connect(ac.destination);
      } catch (e) {
        ac = null;
      }
    }
    if (ac && ac.state === "suspended") ac.resume();
  }

  function tone(opt) {
    if (!ac || muted) return;
    var t0 = ac.currentTime + (opt.delay || 0);
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.type = opt.type || "triangle";
    osc.frequency.setValueAtTime(opt.f, t0);
    if (opt.f2)
      osc.frequency.exponentialRampToValueAtTime(opt.f2, t0 + opt.dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opt.vol || 0.15, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + opt.dur + 0.05);
  }

  function noise(opt) {
    if (!ac || muted) return;
    var dur = opt.dur || 0.4;
    var len = Math.max(1, Math.floor(ac.sampleRate * dur));
    var buf = ac.createBuffer(1, len, ac.sampleRate);
    var data = buf.getChannelData(0);
    var i;
    for (i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = ac.createBufferSource();
    src.buffer = buf;
    var filt = ac.createBiquadFilter();
    filt.type = "bandpass";
    var t0 = ac.currentTime + (opt.delay || 0);
    filt.frequency.setValueAtTime(opt.f || 800, t0);
    if (opt.f2) filt.frequency.exponentialRampToValueAtTime(opt.f2, t0 + dur);
    var gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opt.vol || 0.1, t0 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(gain);
    gain.connect(master);
    src.start(t0);
  }

  /* pentatonic pluck; pitch climbs as the flash lands closer to the choir */
  var SCALE = [392.0, 440.0, 523.25, 587.33, 659.25, 783.99];
  function sndFlash(alignment, isPlayer) {
    if (!ac || muted) return;
    var idx = clamp(Math.floor(alignment * SCALE.length), 0, SCALE.length - 1);
    tone({
      f: SCALE[idx],
      type: "triangle",
      dur: 0.32,
      vol: 0.08 + 0.07 * alignment,
    });
    tone({
      f: SCALE[idx] * 2,
      type: "sine",
      dur: 0.2,
      vol: 0.03 + 0.04 * alignment,
      delay: 0.005,
    });
    if (isPlayer) tone({ f: 196, type: "sine", dur: 0.28, vol: 0.05 });
  }
  function sndCroak() {
    tone({ f: 118, f2: 78, type: "sawtooth", dur: 0.22, vol: 0.07 });
    tone({
      f: 104,
      f2: 66,
      type: "sawtooth",
      dur: 0.26,
      vol: 0.07,
      delay: 0.24,
    });
  }
  function sndTongue() {
    noise({ f: 2400, f2: 500, dur: 0.18, vol: 0.16 });
    tone({ f: 900, f2: 220, type: "square", dur: 0.12, vol: 0.04 });
  }
  function sndGulp() {
    tone({ f: 280, f2: 72, type: "sine", dur: 0.42, vol: 0.2 });
  }
  function sndChime() {
    var notes = [523.25, 659.25, 783.99, 1046.5];
    var i;
    for (i = 0; i < notes.length; i++) {
      tone({ f: notes[i], type: "sine", dur: 0.5, vol: 0.09, delay: i * 0.13 });
    }
  }
  function sndWhoosh() {
    noise({ f: 350, f2: 1300, dur: 0.7, vol: 0.06 });
  }
  function sndThud() {
    tone({ f: 68, type: "sine", dur: 0.14, vol: 0.2 });
  }

  /* ============================ night configs ========================== */

  var NIGHTS = [
    {
      count: 6,
      spread: 0.07,
      dur: 75,
      gustEvery: 13,
      gustVar: 6,
      isoGain: 24,
      kp: 4.6,
    },
    {
      count: 7,
      spread: 0.09,
      dur: 73,
      gustEvery: 11,
      gustVar: 6,
      isoGain: 27,
      kp: 4.3,
    },
    {
      count: 8,
      spread: 0.11,
      dur: 71,
      gustEvery: 10,
      gustVar: 5,
      isoGain: 30,
      kp: 4.0,
    },
    {
      count: 9,
      spread: 0.13,
      dur: 69,
      gustEvery: 9,
      gustVar: 5,
      isoGain: 33,
      kp: 3.7,
    },
    {
      count: 10,
      spread: 0.15,
      dur: 65,
      gustEvery: 8,
      gustVar: 4,
      isoGain: 36,
      kp: 3.4,
    },
  ];
  var BASE_PERIOD = 1.45; /* seconds per beat at the centre of the spread */
  var WIN_R = 0.88; /* unison needed to start the hold */
  var HOLD_S = 2.5; /* seconds the unison must be held */
  var COVER = 0.1; /* "in step" window: within 10% of a beat */
  var GLOW_TAU = 1.0; /* afterglow decay of a flash's influence */
  var WILD_KP = 0.9; /* their own weak mutual attraction */
  var SNAP_PULL = 0.05; /* tiny forward-only kick a flash lands on neighbours */
  var CASCADE_FALL = 0.55;
  var FLASH_COOLDOWN = 0.34;
  var FATIGUE_MAX = 3.2; /* beyond this, every flash reads as lonely */
  var FATIGUE_DECAY = 1.2; /* points per second of rest */

  /* ================================ state ============================== */

  var state = "menu"; /* menu | play | pause | clear | over */
  var nightIndex = 0;
  var score = 0;
  var dispScore = 0;
  var hearts = 3;
  var combo = 0;
  var bestCombo = 0;
  var fatigue = 0; /* rapid-fire punishment gauge */
  var time = 0; /* seconds since page load (visual clock) */
  var shake = 0;

  var flies = [];
  var player = null;
  var frog = null;
  var events = []; /* recent flashes, still glowing with influence */
  var parts = [];
  var ripples = [];
  var fireQueue = [];

  var nightDur = 75;
  var nightT = 0;
  var coherence = 0;
  var smoothR = 0;
  var holdT = 0;
  var nextGust = 10;
  var lastThud = 0;
  var bannerTimer = null;

  /* -------------------------------- flies ------------------------------ */

  function makeFly(isPlayer, cfg) {
    var period = BASE_PERIOD * (1 + rand(-cfg.spread, cfg.spread));
    return {
      isPlayer: isPlayer,
      alive: true,
      phase: rand(0, 1),
      omega: 1 / period,
      /* the player has no hidden clock of their own: their rhythm is simply
         the tempo they have been flashing at */
      Tp: BASE_PERIOD,
      lastFlash: isPlayer ? -BASE_PERIOD : -10,
      ang: rand(0, TAU),
      rad: 0.18,
      ox: 0,
      oy: 0,
      vx: 0,
      vy: 0,
      sp1: rand(0.5, 1.1),
      sp2: rand(0.4, 0.9),
      ph1: rand(0, TAU),
      ph2: rand(0, TAU),
      flashCount: 0,
      px: 0,
      py: 0,
    };
  }

  /* golden-angle spiral around the hollow; player hangs low centre */
  function layoutFlies() {
    var i;
    for (i = 0; i < flies.length; i++) {
      var f = flies[i];
      if (f.isPlayer) {
        f.ang = Math.PI / 2;
        f.rad = 0.3;
      } else {
        var golden = i * 2.399963 + 0.7;
        f.rad = 0.08 + 0.28 * Math.sqrt((i + 0.6) / flies.length);
        f.ang = golden;
      }
    }
  }

  function flyPos(f) {
    var wob = 0.014 * M;
    var cx = W / 2 + f.ox * M;
    var cy = H * 0.45 + f.oy * M;
    return {
      x:
        cx +
        Math.cos(f.ang) * f.rad * M * 1.15 +
        wob * Math.sin(time * f.sp1 + f.ph1),
      y:
        cy +
        Math.sin(f.ang) * f.rad * M * 0.92 +
        wob * 0.7 * Math.sin(time * f.sp2 + f.ph2),
    };
  }

  function setupNight(idx, keepScore) {
    var cfg = NIGHTS[idx];
    nightIndex = idx;
    nightDur = cfg.dur;
    nightT = 0;
    holdT = 0;
    combo = 0;
    bestCombo = 0;
    fatigue = 0;
    nextGust = cfg.gustEvery * rand(0.7, 1.2);
    parts.length = 0;
    ripples.length = 0;
    events.length = 0;
    fireQueue.length = 0;

    flies = [];
    var i;
    for (i = 0; i < cfg.count; i++) flies.push(makeFly(false, cfg));
    player = makeFly(true, cfg);
    flies.push(player);
    layoutFlies();
    for (i = 0; i < flies.length; i++) {
      var p = flyPos(flies[i]);
      flies[i].px = p.x;
      flies[i].py = p.y;
    }

    frog = {
      attention: 0,
      committed: false,
      commitT: 0,
      striking: false,
      strikeT: -10,
      hitDone: false,
      cool: 0,
      blink: rand(1, 4),
    };

    if (!keepScore) score = 0;
    updateHearts();
    updateNightLabel();
  }

  /* ------------------------- the flash mechanic ------------------------ */

  /* a flash nudges its neighbours forward a touch and leaves an afterglow
     that keeps bending their rhythms toward the flashing one's beat */
  function doFlash(f, depth) {
    var isP = !!f.isPlayer;
    if (isP) {
      var since = time - f.lastFlash;
      if (since > 0.25 && since < 4) {
        /* remember the tempo you actually keep */
        f.Tp = clamp(lerp(f.Tp, since, 0.45), 0.6, 3.2);
      }
      fatigue = Math.min(fatigue + 1, 9);
    }
    f.phase = 0;
    f.lastFlash = time;
    f.flashCount++;
    spawnSparks(f);

    var alignment = currentAlignment(f);
    sndFlash(alignment, isP);

    events.push({
      x: f.px,
      y: f.py,
      t: time,
      wild: !isP,
      depth: depth,
    });

    if (isP) {
      judgePlayerFlash(); /* the frog only ever watches YOU */
    } else {
      knockNeighbours(f, depth);
    }
  }

  /* tiny forward-only kick; may tip someone over the threshold -> chain */
  function knockNeighbours(src, depth) {
    var i;
    for (i = 0; i < flies.length; i++) {
      var f = flies[i];
      if (f === src || !f.alive || f.isPlayer) continue;
      var dx = f.px - src.px;
      var dy = f.py - src.py;
      var prox = clamp(
        1.35 - Math.sqrt(dx * dx + dy * dy) / (0.75 * M),
        0.3,
        1,
      );
      f.phase += SNAP_PULL * prox;
      if (f.phase >= 1) {
        f.phase -= 1;
        if (depth < 3 && fireQueue.length < 48) {
          fireQueue.push({ f: f, depth: depth + 1 });
        }
      }
    }
  }

  /* how close is this flash to everyone else's beat? 0..1, for the sound */
  function currentAlignment(src) {
    var sum = 0;
    var n = 0;
    var i;
    for (i = 0; i < flies.length; i++) {
      var f = flies[i];
      if (f === src || !f.alive) continue;
      sum += clamp(1 - circDist(f.phase, src.phase) / 0.25, 0, 1);
      n++;
    }
    return n ? sum / n : 0;
  }

  function playerFlash() {
    if (state !== "play") return;
    if (!player || !player.alive) return;
    if (time - player.lastFlash < FLASH_COOLDOWN) return;
    doFlash(player, 0);
  }

  /* the frog only ever watches YOU */
  function judgePlayerFlash() {
    if (frog.cool > 0 || frog.striking) return;
    var partners = 0;
    var i;
    for (i = 0; i < flies.length; i++) {
      var f = flies[i];
      if (f.isPlayer || !f.alive) continue;
      if (circDist(f.phase, 0) <= COVER) partners++;
    }
    var frantic = fatigue > FATIGUE_MAX;
    if (partners >= 2 && !frantic) {
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      frog.attention = clamp(frog.attention - 13, 0, 100);
    } else if (partners === 1 && !frantic) {
      frog.attention = clamp(frog.attention - 4, 0, 100);
    } else {
      combo = 0;
      frog.attention = clamp(
        frog.attention + NIGHTS[nightIndex].isoGain * (frantic ? 0.8 : 1),
        0,
        100,
      );
      if (frog.attention >= 100 && !frog.committed) {
        frog.committed = true;
        frog.commitT = time;
        sndCroak();
      }
    }
  }

  /* continuous afterglow coupling. Each recent flash acts as a rotating
     phase reference; every other firefly is pulled toward it (or gently held
     back) in proportion to the reference's remaining glow — classic sine
     coupling, which lets faster fireflies be slowed and slower ones hurried */
  function applyGlow(dt) {
    var cfg = NIGHTS[nightIndex];
    var i;
    var e;
    for (i = events.length - 1; i >= 0; i--) {
      if (time - events[i].t > GLOW_TAU * 2.5) events.splice(i, 1);
    }
    for (i = 0; i < flies.length; i++) {
      var f = flies[i];
      if (!f.alive || f.isPlayer) continue;
      var j;
      var drive = 0;
      for (j = 0; j < events.length; j++) {
        e = events[j];
        var age = time - e.t;
        var glow = Math.exp(-age / GLOW_TAU);
        if (glow < 0.02) continue;
        var dx = f.px - e.x;
        var dy = f.py - e.y;
        var prox = clamp(
          1.35 - Math.sqrt(dx * dx + dy * dy) / (0.75 * M),
          0.25,
          1,
        );
        var k = ((e.wild ? WILD_KP : cfg.kp) * prox * glow) / TAU;
        if (e.depth > 0) k *= CASCADE_FALL;
        /* the reference rotates onward from the moment of the flash */
        var refPhase = (age / BASE_PERIOD) % 1;
        drive += k * Math.sin(TAU * (refPhase - f.phase));
      }
      if (drive !== 0) {
        f.phase += drive * dt;
        while (f.phase >= 1) {
          f.phase -= 1;
          fireQueue.push({ f: f, depth: 0 });
        }
        if (f.phase < -0.5) f.phase += 1; /* wrapped backwards past a fire */
      }
    }
  }

  /* --------------------------- misc sim pieces -------------------------- */

  function scatterPhases(power) {
    var i;
    for (i = 0; i < flies.length; i++) {
      flies[i].phase = wrap01(flies[i].phase + rand(-power, power));
      flies[i].vx += rand(-50, 50);
      flies[i].vy += rand(-50, 50);
    }
    holdT = 0;
  }

  function gust() {
    scatterPhases(0.05 + 0.02 * nightIndex);
    sndWhoosh();
    var i;
    for (i = 0; i < 26; i++) {
      parts.push({
        kind: "streak",
        x: rand(0, W),
        y: rand(H * 0.08, H * 0.75),
        vx: rand(320, 700),
        vy: rand(-40, 40),
        life: rand(0.4, 0.8),
        age: 0,
      });
    }
  }

  function spawnSparks(f) {
    var i;
    for (i = 0; i < 7; i++) {
      var a = rand(0, TAU);
      var sp = rand(20, 90);
      parts.push({
        kind: "spark",
        x: f.px,
        y: f.py,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.35, 0.7),
        age: 0,
        wild: !f.isPlayer,
      });
    }
  }

  /* ------------------------------- hearts ------------------------------- */

  function loseHeart(reason) {
    hearts--;
    updateHearts();
    shake = 1;
    sndGulp();
    combo = 0;
    if (hearts <= 0) {
      endRun();
      return;
    }
    if (reason === "frog") {
      scatterPhases(0.3);
      frog.attention = 0;
      frog.committed = false;
      frog.cool = 3.2;
      showBanner(
        "The frog strikes",
        "keep the beat \u2014 stay inside the choir",
        2200,
      );
    } else {
      nightT = 0;
      scatterPhases(0.22);
      frog.attention = 0;
      frog.committed = false;
      frog.cool = 2.5;
      showBanner(
        "The fog took the night",
        "gather them again before it returns",
        2400,
      );
    }
  }

  function frogStrike() {
    if (!player.alive) return;
    frog.striking = true;
    frog.strikeT = time;
    frog.hitDone = false;
    sndTongue();
    ripples.push({ x: player.px, y: player.py, age: 0, life: 0.6 });
  }

  /* ----------------------------- coherence ------------------------------ */

  function computeCoherence() {
    var sx = 0;
    var sy = 0;
    var n = 0;
    var i;
    for (i = 0; i < flies.length; i++) {
      var f = flies[i];
      if (!f.alive) continue;
      var a = f.phase * TAU;
      sx += Math.cos(a);
      sy += Math.sin(a);
      n++;
    }
    if (!n) return 0;
    return Math.sqrt((sx * sx + sy * sy) / (n * n));
  }

  /* ------------------------------- update ------------------------------- */

  function stepSwarm(dt, ambient) {
    var i;
    var cfg = NIGHTS[nightIndex];

    /* phases advance; wild flies fire themselves at the threshold */
    fireQueue.length = 0;
    for (i = 0; i < flies.length; i++) {
      var f = flies[i];
      if (f.isPlayer) {
        /* your rhythm is the tempo of your own flashes */
        f.phase = wrap01((time - f.lastFlash) / f.Tp);
      } else {
        f.phase += f.omega * dt;
        while (f.phase >= 1) {
          f.phase -= 1;
          fireQueue.push({ f: f, depth: 0 });
        }
      }
    }

    applyGlow(dt);

    /* resolve queued flashes, cascades included */
    var qi = 0;
    var guard = 0;
    while (qi < fireQueue.length && guard < 64) {
      var job = fireQueue[qi++];
      doFlash(job.f, job.depth);
      guard++;
    }
    fireQueue.length = 0;

    /* drift physics */
    for (i = 0; i < flies.length; i++) {
      f = flies[i];
      f.vx += (-f.ox * 2.2 - f.vx * 2.6) * dt;
      f.vy += (-f.oy * 2.2 - f.vy * 2.6) * dt;
      f.ox = clamp(f.ox + f.vx * dt, -0.05, 0.05);
      f.oy = clamp(f.oy + f.vy * dt, -0.05, 0.05);
      var p = flyPos(f);
      f.px = p.x;
      f.py = p.y;
    }

    coherence = computeCoherence();
    smoothR = lerp(smoothR, coherence, 1 - Math.exp(-dt * 6));

    fatigue = Math.max(0, fatigue - FATIGUE_DECAY * dt);

    if (ambient) return;

    /* unison hold */
    if (coherence >= WIN_R) {
      holdT += dt;
      if (holdT >= HOLD_S) {
        nightClear();
        return;
      }
    } else {
      holdT = Math.max(0, holdT - dt * 2.5);
    }

    /* frog */
    if (frog.cool > 0) frog.cool -= dt;
    if (!frog.committed && !frog.striking) {
      frog.attention = clamp(frog.attention - 5 * dt, 0, 100);
    }
    if (frog.committed && !frog.striking && time - frog.commitT > 0.65) {
      frog.committed = false;
      frogStrike();
    }
    if (frog.striking && !frog.hitDone && time - frog.strikeT > 0.22) {
      frog.hitDone = true;
      loseHeart("frog");
      if (state !== "play") return;
    }
    if (frog.striking && time - frog.strikeT > 0.55) {
      frog.striking = false;
    }

    /* gusts */
    nextGust -= dt;
    if (nextGust <= 0) {
      gust();
      nextGust = cfg.gustEvery + rand(0, cfg.gustVar);
    }

    /* fog */
    nightT += dt;
    var remain = nightDur - nightT;
    if (remain < 10 && remain > 0 && time - lastThud > 1) {
      lastThud = time;
      sndThud();
    }
    if (remain <= 0) {
      loseHeart("fog");
    }
  }

  function updateFx(dt) {
    var i;
    for (i = parts.length - 1; i >= 0; i--) {
      var pt = parts[i];
      pt.age += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.kind === "spark") {
        pt.vx *= 1 - 1.6 * dt;
        pt.vy *= 1 - 1.6 * dt;
      }
      if (pt.age >= pt.life) parts.splice(i, 1);
    }
    for (i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age += dt;
      if (ripples[i].age >= ripples[i].life) ripples.splice(i, 1);
    }
    shake = Math.max(0, shake - dt * 2.4);
  }

  /* ------------------------------ night flow ---------------------------- */

  function nightClear() {
    state = "clear";
    var cfg = NIGHTS[nightIndex];
    var remaining = Math.max(0, cfg.dur - nightT);
    var timeBonus = Math.round(remaining * 6);
    var comboBonus = bestCombo * 25;
    var base = 400 * (nightIndex + 1);
    score += base + timeBonus + comboBonus;
    sndChime();

    var isLast = nightIndex >= NIGHTS.length - 1;
    showOverlay(
      isLast ? "Dawn comes" : "The swamp blinks as one",
      isLast
        ? "Five nights, one light. The whole marsh breathes on a single beat," +
            " and even the frog sits still to listen."
        : "For a handful of heartbeats every firefly in the hollow blinked" +
            " together. Out in the reeds, something old nodded along.",
      "Night " +
        (nightIndex + 1) +
        " clear\nunison held \u00b7 best rhythm \u00d7" +
        bestCombo +
        "\n+" +
        base +
        " vesper   +" +
        timeBonus +
        " fog bonus   +" +
        comboBonus +
        " rhythm\nscore " +
        score,
      isLast ? "Sing it again" : "Deeper into the night",
      function () {
        if (isLast) {
          startRun();
        } else {
          hideOverlay();
          setupNight(nightIndex + 1, true);
          state = "play";
          showBanner(
            "Night " + (nightIndex + 1),
            NIGHTS[nightIndex].count + " voices \u00b7 wider wings",
            2000,
          );
        }
      },
      false,
    );
  }

  function endRun() {
    state = "over";
    showOverlay(
      "The marsh goes quiet",
      "A lonely flash is a loud thing in the dark. The frog was faster.",
      "final score " +
        score +
        "\nreached night " +
        (nightIndex + 1) +
        " of " +
        NIGHTS.length,
      "Try again",
      function () {
        startRun();
      },
      false,
    );
  }

  function startRun() {
    hearts = 3;
    score = 0;
    dispScore = 0;
    hideOverlay();
    setupNight(0, false);
    state = "play";
    showBanner(
      "Night 1",
      "find their beat \u00b7 join it \u00b7 hold it",
      2400,
    );
    elOvButton.blur();
  }

  function pauseGame() {
    if (state !== "play") return;
    state = "pause";
    showOverlay(
      "Paused",
      "The swarm hangs in the air, waiting for your beat.",
      "",
      "Resume",
      function () {
        hideOverlay();
        state = "play";
      },
      false,
    );
  }

  /* ------------------------------- overlays ----------------------------- */

  function showOverlay(title, body, stats, label, action, withRules) {
    elOvTitle.textContent = title;
    elOvBody.textContent = body;
    elOvRules.style.display = withRules ? "grid" : "none";
    elOvStats.textContent = stats || "";
    elOvStats.style.display = stats ? "block" : "none";
    elOvButton.textContent = label;
    elOverlay.classList.remove("hidden");
    elOvButton.onclick = function () {
      ensureAudio();
      action();
      elOvButton.blur();
    };
  }

  function hideOverlay() {
    elOverlay.classList.add("hidden");
  }

  function showBanner(main, sub, ms) {
    elBanner.innerHTML = "";
    var big = document.createElement("div");
    big.textContent = main;
    elBanner.appendChild(big);
    if (sub) {
      var small = document.createElement("small");
      small.textContent = sub;
      elBanner.appendChild(small);
    }
    elBanner.classList.remove("hidden");
    elBanner.style.animation = "none";
    void elBanner.offsetWidth;
    elBanner.style.animation = "";
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () {
      elBanner.classList.add("hidden");
    }, ms || 2000);
  }

  function updateHearts() {
    var html = "";
    var i;
    for (i = 0; i < 3; i++) {
      html += '<span class="' + (i < hearts ? "" : "lost") + '">\u2726</span>';
    }
    elHearts.innerHTML = html;
  }

  function updateNightLabel() {
    elNight.textContent = "Night " + (nightIndex + 1);
  }

  /* ============================== scenery =============================== */

  var stars = [];
  var reeds = [];
  var skyGrad = null;
  var waterGrad = null;
  var spriteWild = null;
  var spritePlayer = null;

  function makeGlowSprite(stops) {
    var s = document.createElement("canvas");
    s.width = 160;
    s.height = 160;
    var c = s.getContext("2d");
    var g = c.createRadialGradient(80, 80, 2, 80, 80, 78);
    var i;
    for (i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    c.fillStyle = g;
    c.fillRect(0, 0, 160, 160);
    return s;
  }

  function buildSprites() {
    spriteWild = makeGlowSprite([
      [0, "rgba(235,255,190,0.95)"],
      [0.14, "rgba(198,242,120,0.85)"],
      [0.35, "rgba(140,205,70,0.38)"],
      [0.7, "rgba(90,150,50,0.1)"],
      [1, "rgba(70,120,40,0)"],
    ]);
    spritePlayer = makeGlowSprite([
      [0, "rgba(255,250,215,1)"],
      [0.14, "rgba(255,228,140,0.9)"],
      [0.35, "rgba(255,196,90,0.4)"],
      [0.7, "rgba(210,150,60,0.1)"],
      [1, "rgba(180,130,50,0)"],
    ]);
  }

  function buildScenery() {
    var i;
    stars = [];
    for (i = 0; i < 70; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random() * 0.55,
        r: rand(0.4, 1.4),
        tw: rand(0.5, 2.2),
        ph: rand(0, TAU),
      });
    }
    reeds = [];
    var n = Math.max(10, Math.round(W / 90));
    for (i = 0; i < n; i++) {
      reeds.push({
        x: rand(-20, W + 20),
        h: rand(H * 0.1, H * 0.26),
        lean: rand(-0.25, 0.25),
        head: Math.random() < 0.45,
        ph: rand(0, TAU),
        wide: rand(2, 4),
      });
    }
    skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0, "#050912");
    skyGrad.addColorStop(0.42, "#0a1626");
    skyGrad.addColorStop(0.75, "#12283a");
    skyGrad.addColorStop(1, "#16304a");
    waterGrad = ctx.createLinearGradient(0, H * 0.8, 0, H);
    waterGrad.addColorStop(0, "#0b1a26");
    waterGrad.addColorStop(1, "#04080d");
  }

  /* ================================ render ============================== */

  function glowOf(f) {
    var since = time - f.lastFlash;
    var env =
      since < 0.6 ? Math.min(since / 0.05, 1) * Math.exp(-since * 4.4) : 0;
    var breath =
      0.08 + 0.42 * Math.pow(clamp((f.phase - 0.3) / 0.7, 0, 1), 2.2);
    return clamp(breath + env * 1.25, 0, 1.25);
  }

  function render() {
    var i;
    var urgent = clamp(nightT / nightDur, 0, 1);

    ctx.save();
    if (shake > 0) {
      ctx.translate(rand(-1, 1) * 7 * shake, rand(-1, 1) * 7 * shake);
    }

    /* sky */
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-8, -8, W + 16, H + 16);

    /* stars */
    ctx.fillStyle = "#cfe0ee";
    for (i = 0; i < stars.length; i++) {
      var st = stars[i];
      ctx.globalAlpha =
        (0.18 + 0.5 * (0.5 + 0.5 * Math.sin(time * st.tw + st.ph))) *
        (1 - st.y * 1.2);
      ctx.beginPath();
      ctx.arc(st.x * W, st.y * H, st.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* moon */
    var mx = W * 0.86;
    var my = H * 0.15;
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "#e8ecda";
    ctx.beginPath();
    ctx.arc(mx, my, 24, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0a1626";
    ctx.beginPath();
    ctx.arc(mx - 10, my - 5, 21, 0, TAU);
    ctx.fill();

    /* water */
    var wy = H * 0.82;
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, wy, W, H - wy);

    /* reflections + shimmer */
    ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < flies.length; i++) {
      var fl = flies[i];
      var b = glowOf(fl);
      if (b < 0.14) continue;
      var ry = wy + (wy - fl.py) * 0.22;
      if (ry < wy) ry = wy + 6;
      var rh = clamp(30 + b * 60, 20, 90);
      var grad = ctx.createLinearGradient(0, ry, 0, ry + rh);
      var col = fl.isPlayer ? "255,214,120" : "170,230,110";
      grad.addColorStop(0, "rgba(" + col + "," + (0.3 * b).toFixed(3) + ")");
      grad.addColorStop(1, "rgba(" + col + ",0)");
      ctx.fillStyle = grad;
      var rw = 10 + b * 16;
      ctx.fillRect(fl.px - rw / 2, ry, rw, rh);
    }
    for (i = 0; i < 5; i++) {
      var ly = wy + 8 + i * ((H - wy) / 5.4);
      var la = 0.05 + 0.03 * Math.sin(time * 1.4 + i * 1.9);
      ctx.fillStyle = "rgba(150,190,210," + la.toFixed(3) + ")";
      ctx.fillRect(
        W * 0.06 + Math.sin(time * 0.6 + i) * W * 0.05,
        ly,
        W * 0.3,
        1.4,
      );
    }
    ctx.globalCompositeOperation = "source-over";

    /* reeds */
    ctx.strokeStyle = "#08110c";
    ctx.lineCap = "round";
    for (i = 0; i < reeds.length; i++) {
      var rd = reeds[i];
      var sway = Math.sin(time * 0.7 + rd.ph) * rd.h * 0.06;
      var by = H * 0.86 + ((rd.ph / TAU) % 1) * H * 0.12;
      var tx = rd.x + rd.lean * rd.h + sway;
      var ty = by - rd.h;
      ctx.lineWidth = rd.wide;
      ctx.beginPath();
      ctx.moveTo(rd.x, by);
      ctx.quadraticCurveTo(
        rd.x + rd.lean * rd.h * 0.3,
        by - rd.h * 0.6,
        tx,
        ty,
      );
      ctx.stroke();
      if (rd.head) {
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(rd.lean + sway / rd.h);
        ctx.fillStyle = "#08110c";
        ctx.beginPath();
        ctx.ellipse(0, -rd.wide * 2.4, rd.wide * 0.9, rd.wide * 2.6, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    drawFrog();

    /* creeping fog */
    var fa = urgent * urgent * 0.5;
    if (fa > 0.01) {
      var fgL = ctx.createLinearGradient(0, 0, W * 0.3, 0);
      fgL.addColorStop(0, "rgba(168,186,204," + fa.toFixed(3) + ")");
      fgL.addColorStop(1, "rgba(168,186,204,0)");
      ctx.fillStyle = fgL;
      ctx.fillRect(0, 0, W * 0.3, H);
      var fgR = ctx.createLinearGradient(W, 0, W * 0.7, 0);
      fgR.addColorStop(0, "rgba(168,186,204," + fa.toFixed(3) + ")");
      fgR.addColorStop(1, "rgba(168,186,204,0)");
      ctx.fillStyle = fgR;
      ctx.fillRect(W * 0.7, 0, W * 0.3, H);
    }

    /* flies */
    ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < flies.length; i++) {
      if (flies[i].alive) drawFly(flies[i]);
    }
    ctx.globalCompositeOperation = "source-over";

    /* particles */
    for (i = 0; i < parts.length; i++) {
      var pp = parts[i];
      var pa = 1 - pp.age / pp.life;
      if (pp.kind === "streak") {
        ctx.strokeStyle = "rgba(190,210,225," + (0.25 * pa).toFixed(3) + ")";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(pp.x, pp.y);
        ctx.lineTo(pp.x - pp.vx * 0.05, pp.y - pp.vy * 0.05);
        ctx.stroke();
      } else {
        ctx.fillStyle =
          (pp.wild ? "rgba(190,240,120," : "rgba(255,224,130,") +
          (0.7 * pa).toFixed(3) +
          ")";
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 1.6 + 2 * pa, 0, TAU);
        ctx.fill();
      }
    }

    /* ripple rings */
    for (i = 0; i < ripples.length; i++) {
      var rp = ripples[i];
      var rt = rp.age / rp.life;
      ctx.strokeStyle = "rgba(220,240,210," + (0.5 * (1 - rt)).toFixed(3) + ")";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, 8 + 46 * rt, 0, TAU);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawFly(f) {
    var b = glowOf(f);
    var spr = f.isPlayer ? spritePlayer : spriteWild;
    var size = (f.isPlayer ? 46 : 40) * (0.55 + 0.75 * b);
    ctx.globalAlpha = 0.25 + 0.75 * clamp(b, 0, 1);
    ctx.drawImage(spr, f.px - size / 2, f.py - size / 2, size, size);
    ctx.globalAlpha = 1;

    ctx.fillStyle = f.isPlayer
      ? "rgba(255,244,200,0.95)"
      : "rgba(232,255,190,0.9)";
    ctx.beginPath();
    ctx.arc(f.px, f.py, (f.isPlayer ? 2.6 : 2.1) * (0.7 + 0.5 * b), 0, TAU);
    ctx.fill();

    if (f.isPlayer) {
      var ready = time - f.lastFlash >= FLASH_COOLDOWN;
      /* halo warms to red while your flashing turns frantic */
      var heat = clamp(fatigue / FATIGUE_MAX, 0, 1);
      ctx.strokeStyle =
        "rgba(255," +
        Math.round(lerp(226, 120, heat)) +
        "," +
        Math.round(lerp(140, 110, heat)) +
        "," +
        (ready ? 0.55 : 0.18) +
        ")";
      ctx.lineWidth = 1.2 + heat;
      ctx.beginPath();
      ctx.arc(f.px, f.py, 11 + (ready ? Math.sin(time * 5) * 1.4 : 0), 0, TAU);
      ctx.stroke();
    }
  }

  function drawFrog() {
    var fx = W * 0.115;
    var fy = H * 0.845;
    var s = M / 420;

    ctx.fillStyle = "#0e2114";
    ctx.beginPath();
    ctx.ellipse(fx, fy + 16 * s, 52 * s, 15 * s, -0.06, 0, TAU);
    ctx.fill();

    var tele =
      frog.committed || frog.striking
        ? 1 + 0.1 * Math.abs(Math.sin(time * 22))
        : 1 + 0.02 * Math.sin(time * 1.7);

    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(s * tele, s * tele);

    ctx.fillStyle = "#1c3018";
    ctx.beginPath();
    ctx.ellipse(-16, 10, 20, 7, 0.35, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(18, 11, 16, 6, -0.3, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#26401f";
    ctx.beginPath();
    ctx.ellipse(0, 0, 26, 17, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#3a5a2c";
    ctx.beginPath();
    ctx.ellipse(0, 6, 18, 7, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#26401f";
    ctx.beginPath();
    ctx.arc(-9, -14, 6.5, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(9, -14, 6.5, 0, TAU);
    ctx.fill();

    var heat = clamp(frog.attention / 100, 0, 1);
    ctx.fillStyle =
      "rgb(" +
      Math.round(lerp(180, 255, heat)) +
      "," +
      Math.round(lerp(200, 90, heat * heat)) +
      ",70)";
    ctx.beginPath();
    ctx.arc(-9, -15, 4, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(9, -15, 4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#101408";
    ctx.beginPath();
    ctx.arc(-9, -15, 1.7, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(9, -15, 1.7, 0, TAU);
    ctx.fill();

    frog.blink -= 1 / 60;
    if (frog.blink < -0.12) frog.blink = rand(2.5, 6);
    if (frog.blink < 0) {
      ctx.fillStyle = "#26401f";
      ctx.fillRect(-14, -19, 10, 8);
      ctx.fillRect(4, -19, 10, 8);
    }

    ctx.restore();

    if (frog.striking) {
      var tt = time - frog.strikeT;
      var ext;
      if (tt < 0.2) ext = tt / 0.2;
      else if (tt < 0.3) ext = 1;
      else ext = Math.max(0, 1 - (tt - 0.3) / 0.22);
      var mouthX = fx + 8 * s;
      var mouthY = fy - 10 * s;
      var tipX = lerp(mouthX, player.px, ext);
      var tipY = lerp(mouthY, player.py, ext);
      ctx.strokeStyle = "#d87a94";
      ctx.lineWidth = 5 * s;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(mouthX, mouthY);
      ctx.quadraticCurveTo(
        (mouthX + player.px) / 2,
        Math.min(mouthY, player.py) - 30 * s * ext,
        tipX,
        tipY,
      );
      ctx.stroke();
      ctx.fillStyle = "#e89aae";
      ctx.beginPath();
      ctx.arc(tipX, tipY, 5 * s, 0, TAU);
      ctx.fill();
    }
  }

  /* ================================= hud ================================ */

  function renderHud() {
    elMeterFill.style.width = (clamp(smoothR, 0, 1) * 100).toFixed(1) + "%";
    if (coherence >= WIN_R && state === "play") {
      elMeterFill.classList.add("gold");
    } else {
      elMeterFill.classList.remove("gold");
    }
    elCombo.textContent = combo >= 2 ? "\u00d7" + combo : "";

    dispScore =
      Math.abs(score - dispScore) < 1 ? score : lerp(dispScore, score, 0.15);
    elScore.textContent = String(Math.round(dispScore));

    var remain = clamp(1 - nightT / nightDur, 0, 1);
    elFogFill.style.width = (remain * 100).toFixed(1) + "%";
    if (remain < 0.16 && state === "play") elFogWrap.classList.add("urgent");
    else elFogWrap.classList.remove("urgent");
  }

  /* ================================ input =============================== */

  function overlayVisible() {
    return !elOverlay.classList.contains("hidden");
  }

  window.addEventListener("keydown", function (ev) {
    if (ev.code === "Space" || ev.code === "Enter") ev.preventDefault();
    ensureAudio();
    switch (ev.code) {
      case "Space":
      case "Enter":
        if (overlayVisible()) elOvButton.click();
        else if (ev.code === "Space") playerFlash();
        break;
      case "KeyP":
        if (state === "play") pauseGame();
        else if (state === "pause") {
          hideOverlay();
          state = "play";
        }
        break;
      case "KeyM":
        toggleMute();
        break;
      case "KeyR":
        if (state !== "menu") startRun();
        break;
    }
  });

  canvas.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    ensureAudio();
    if (state === "menu") {
      startRun();
      return;
    }
    playerFlash();
  });

  canvas.addEventListener("contextmenu", function (ev) {
    ev.preventDefault();
  });

  function toggleMute() {
    muted = !muted;
    btnMute.textContent = muted ? "\u2715" : "\u266b";
    btnMute.title = muted ? "Unmute (M)" : "Sound (M)";
  }

  btnPause.addEventListener("click", function () {
    ensureAudio();
    if (state === "play") pauseGame();
    else if (state === "pause") {
      hideOverlay();
      state = "play";
    }
    btnPause.blur();
  });

  btnMute.addEventListener("click", function () {
    ensureAudio();
    toggleMute();
    btnMute.blur();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state === "play") pauseGame();
  });

  /* ================================= boot =============================== */

  function showMenu() {
    state = "menu";
    showOverlay(
      "Firefly Vespers",
      "Dusk is falling over the swamp and the fireflies blink out of step." +
        " You are the small gold one. Every flash pulls your neighbours toward" +
        " your beat \u2014 find the swarm's rhythm, join it, hold it, and the" +
        " whole marsh will breathe as one light.",
      "",
      "Begin the vespers",
      function () {
        startRun();
      },
      true,
    );
  }

  buildSprites();
  resize();
  setupNight(2, false); /* an ambient cast blinks behind the intro */
  showMenu();

  /* tuning hook: only active when the page is opened with #debug */
  if (/debug/.test(window.location.hash)) {
    window.__ffv_debug = {
      get coherence() {
        return coherence;
      },
      get smoothR() {
        return smoothR;
      },
      get phases() {
        return flies.map(function (f) {
          return f.phase;
        });
      },
      get omegas() {
        return flies.map(function (f) {
          return f.omega;
        });
      },
      get events() {
        return events.length;
      },
      get playerTp() {
        return player.Tp;
      },
      get fatigue() {
        return fatigue;
      },
      get attention() {
        return frog.attention;
      },
    };
  }

  var lastFrame = performance.now();
  function frame(now) {
    var dt = clamp((now - lastFrame) / 1000, 0, 0.05);
    lastFrame = now;
    time += dt;
    if (state === "play" || state === "menu") {
      stepSwarm(dt, state === "menu");
      updateFx(dt);
    }
    render();
    renderHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
