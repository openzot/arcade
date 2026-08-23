/* Midnight Broth — a midnight ramen yatai time-management game.
   One pot, ten regulars, and a simmer ring that will not wait.
   Vanilla classic script, wrapped in an IIFE; no modules, no network. */

(function () {
  "use strict";

  /* ════════════════════════ helpers ════════════════════════ */

  var TAU = Math.PI * 2;
  var W = 960;
  var H = 600;

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function rand(lo, hi) {
    return lo + Math.random() * (hi - lo);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function fmt(n) {
    return n.toLocaleString("en-US");
  }

  /* ════════════════════════ audio ════════════════════════ */

  var audio = {
    ctx: null,
    master: null,
    rainGain: null,
    muted: false,

    ensure: function () {
      if (this.ctx) {
        if (this.ctx.state === "suspended") this.ctx.resume();
        return true;
      }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        this.ctx = new AC();
      } catch (err) {
        this.ctx = null;
        return false;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.startRain();
      return true;
    },

    startRain: function () {
      var len = this.ctx.sampleRate * 2;
      var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var data = buf.getChannelData(0);
      var i;
      for (i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      var src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      var filt = this.ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 420;
      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0.05;
      src.connect(filt);
      filt.connect(this.rainGain);
      this.rainGain.connect(this.master);
      src.start();
    },

    setMuted: function (m) {
      this.muted = m;
      if (this.master) {
        this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.02);
      }
    },

    tone: function (freq, dur, type, vol, glideTo, delay) {
      if (!this.ctx) return;
      var t0 = this.ctx.currentTime + (delay || 0);
      var osc = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      if (glideTo)
        osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    },

    hiss: function (dur, freq, vol) {
      if (!this.ctx) return;
      var t0 = this.ctx.currentTime;
      var n = Math.floor(this.ctx.sampleRate * dur);
      var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      var d = buf.getChannelData(0);
      var i;
      for (i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var src = this.ctx.createBufferSource();
      src.buffer = buf;
      var filt = this.ctx.createBiquadFilter();
      filt.type = "bandpass";
      filt.frequency.value = freq || 800;
      var g = this.ctx.createGain();
      g.gain.value = vol || 0.15;
      src.connect(filt);
      filt.connect(g);
      g.connect(this.master);
      src.start(t0);
    },
  };

  var sfx = {
    drop: function () {
      audio.tone(320, 0.14, "triangle", 0.22, 170);
      audio.hiss(0.18, 900, 0.1);
    },
    plop: function (i) {
      audio.tone(360 + i * 46, 0.09, "sine", 0.22, 300 + i * 46);
      audio.hiss(0.06, 1400, 0.05);
    },
    wrong: function () {
      audio.tone(140, 0.16, "square", 0.13);
    },
    tok: function () {
      audio.tone(1150, 0.045, "square", 0.09);
    },
    perfect: function () {
      audio.tone(660, 0.14, "sine", 0.2);
      audio.tone(880, 0.18, "sine", 0.2, null, 0.09);
      audio.tone(1320, 0.2, "sine", 0.12, null, 0.16);
    },
    soggy: function () {
      audio.tone(220, 0.2, "triangle", 0.18, 150);
    },
    burnt: function () {
      audio.hiss(0.4, 260, 0.28);
      audio.tone(92, 0.42, "square", 0.16, 60);
    },
    slurp: function () {
      audio.hiss(0.32, 620, 0.2);
      audio.tone(988, 0.12, "sine", 0.14, null, 0.24);
    },
    storm: function () {
      audio.tone(392, 0.16, "triangle", 0.16);
      audio.tone(294, 0.24, "triangle", 0.16, null, 0.14);
    },
    win: function () {
      var seq = [523, 659, 784, 1047];
      var k;
      for (k = 0; k < seq.length; k++) {
        audio.tone(seq[k], 0.22, "sine", 0.18, null, k * 0.13);
      }
    },
    lose: function () {
      var seq = [330, 262, 196];
      var k;
      for (k = 0; k < seq.length; k++) {
        audio.tone(seq[k], 0.3, "triangle", 0.16, null, k * 0.18);
      }
    },
  };

  /* ════════════════════ toppings & shift ════════════════════ */

  var TOP_ORDER = ["negi", "tamago", "nori", "chashu", "menma"];

  var TOPPINGS = {
    negi: { label: "Negi", color: "#7fd66f", dark: "#3f8f3a" },
    tamago: { label: "Tamago", color: "#fdf3d8", dark: "#d9a92f" },
    nori: { label: "Nori", color: "#2e5d43", dark: "#16331f" },
    chashu: { label: "Chashu", color: "#c98a7a", dark: "#8c4f3f" },
    menma: { label: "Menma", color: "#e0c26a", dark: "#a8842f" },
  };

  var REGULARS = [
    { who: "the Bricklayer", coat: "#5b7fa6", skin: "#e8b98a" },
    { who: "the Nurse", coat: "#8fb6a8", skin: "#f0c9a0" },
    { who: "the Cabman", coat: "#6d6a8f", skin: "#c98e5f" },
    { who: "the Student", coat: "#b0785f", skin: "#ecc19c" },
    { who: "the Fishwife", coat: "#4e7d6b", skin: "#e3ae82" },
    { who: "the Poet", coat: "#7d5a7f", skin: "#f0c9a0" },
    { who: "the Inspector", coat: "#31456b", skin: "#d9a06e", vip: true },
    { who: "the Longshoreman", coat: "#7a4b3a", skin: "#b97f52" },
    { who: "the Detective", coat: "#43423e", skin: "#e8b98a", vip: true },
    { who: "the Editor", coat: "#8c3b3b", skin: "#f0c9a0", vip: true },
  ];

  /* want-count, patience seconds, strain-window milliseconds */
  var SHIFT_PLAN = [
    { n: 1, pat: 26, win: 1900 },
    { n: 2, pat: 24, win: 1800 },
    { n: 2, pat: 23, win: 1700 },
    { n: 3, pat: 22, win: 1550 },
    { n: 3, pat: 21, win: 1450 },
    { n: 3, pat: 20, win: 1350 },
    { n: 4, pat: 20, win: 1250 },
    { n: 4, pat: 18, win: 1150 },
    { n: 4, pat: 17, win: 1050 },
    { n: 4, pat: 16, win: 950 },
  ];

  var COOK_MS = 5600; /* drop to burn timeline */
  var COOK_CENTER = COOK_MS * 0.62; /* al dente bullseye */
  var BURN_GRACE = 850; /* ms of overdone zone past the window */
  var HEARTS = 3;

  /* ════════════════════════ state ════════════════════════ */

  var canvas, ctx;
  var state = "title"; /* title | play | paused | end */
  var pausedFrom = "play";
  var timeScale = 1;
  var now = 0; /* game clock, ms */

  var shift = null; /* current customer */
  var bowl = null; /* the one pot that matters */
  var hearts, score, streak, bestStreak, served, perfects;
  var floaters = [];
  var sparks = [];
  var steams = [];
  var rains = [];
  var splashes = [];
  var confetti = [];
  var shake = 0;
  var lanternT = 0;

  function newBowl() {
    return {
      noodleState: "idle" /* idle | cooking | under | perfect | over */,
      t: 0,
      winStart: 0,
      winEnd: 0,
      burnAt: 0,
      slots: [] /* want ids in ticket order; null when empty */,
      fillIdx: 0,
      basketY: 0 /* 0 up, 1 dunked */,
      ringFade: 1,
    };
  }

  function newShift(idx) {
    var plan = SHIFT_PLAN[idx];
    var reg = REGULARS[idx];
    var pool = TOP_ORDER.slice();
    var want = [];
    var k;
    for (k = 0; k < plan.n; k++) {
      var j = Math.floor(Math.random() * pool.length);
      want.push(pool.splice(j, 1)[0]);
    }
    if (reg.vip)
      pool = TOP_ORDER.slice(); /* vip draws fresh, may repeat types */
    return {
      idx: idx,
      reg: reg,
      want: want,
      vip: !!reg.vip,
      patience: 0,
      patienceMax: plan.pat * 1000,
      patRate: plan.pat,
      winW: plan.win,
      phase: "arrive" /* arrive | active | served | storm */,
      phaseT: 0,
      x: W + 90,
      mood: 1,
      blink: rand(1, 4),
      gone: false,
    };
  }

  function resetGame() {
    now = 0;
    hearts = HEARTS;
    score = 0;
    streak = 0;
    bestStreak = 0;
    served = 0;
    perfects = 0;
    floaters = [];
    sparks = [];
    steams = [];
    splashes = [];
    confetti = [];
    shake = 0;
    bowl = newBowl();
    shift = newShift(0);
    syncUI();
  }

  /* ═══════════════════ flow: the night's work ═══════════════════ */

  function startShift() {
    audio.ensure();
    resetGame();
    state = "play";
    showOverlay(null);
    syncUI();
  }

  function togglePause(force) {
    if (state === "play") {
      pausedFrom = state;
      state = "paused";
      showOverlay("overlayPause");
      $("btnPause").textContent = "Resume";
    } else if (state === "paused") {
      if (force === true) return;
      state = pausedFrom;
      showOverlay(null);
      $("btnPause").textContent = "Pause";
    }
  }

  function potAction() {
    if (state !== "play" || !shift || shift.phase !== "active") return;
    if (bowl.noodleState === "idle") {
      var half = (shift.winW || 1500) / 2;
      bowl.noodleState = "cooking";
      bowl.t = 0;
      bowl.winStart = COOK_CENTER - half;
      bowl.winEnd = COOK_CENTER + half;
      bowl.burnAt = bowl.winEnd + BURN_GRACE;
      bowl.basketY = 1;
      sfx.drop();
    } else if (bowl.noodleState === "cooking") {
      doStrain();
    }
  }

  function doStrain() {
    bowl.basketY = 0;
    bowl.ringFade = 0;
    var t = bowl.t;
    if (t >= bowl.winStart && t <= bowl.winEnd) {
      bowl.noodleState = "perfect";
      perfects++;
      sfx.perfect();
      burst(bowlX(), bowlY() - 70, "#ffe08a", 16);
      addFloater("AL DENTE!", bowlX(), bowlY() - 120, "#ffd166", 26);
      addFloater("+150 x" + mult(), bowlX() + 70, bowlY() - 84, "#fff3c4", 17);
    } else if (t < bowl.winStart) {
      bowl.noodleState = "under";
      sfx.soggy();
      drainPatience(shift.patienceMax * 0.08);
      addFloater("crunchy…", bowlX(), bowlY() - 110, "#9fd6ff", 20);
    } else {
      bowl.noodleState = "over";
      sfx.soggy();
      drainPatience(shift.patienceMax * 0.14);
      addFloater("soggy…", bowlX(), bowlY() - 110, "#c9b6ff", 20);
    }
    syncUI();
  }

  function addTopping(id) {
    if (state !== "play" || !shift || shift.phase !== "active") return;
    var needLeft = bowl.slots.reduce(function (acc, s, i) {
      if (s === null && shift.want[i] === id) acc++;
      return acc;
    }, 0);

    if (needLeft === 0) {
      nudgeBowl();
      sfx.wrong();
      addFloater("not on the ticket", bowlX(), bowlY() - 104, "#ffb3ab", 16);
      return;
    }
    if (shift.vip) {
      /* must follow ticket order exactly */
      var nextId = shift.want[bowl.fillIdx];
      if (nextId !== id) {
        nudgeBowl();
        sfx.wrong();
        drainPatience(1600);
        addFloater("in order!", bowlX(), bowlY() - 104, "#ffd166", 18);
        return;
      }
    }
    /* place into first empty matching slot */
    var i;
    for (i = 0; i < bowl.slots.length; i++) {
      if (bowl.slots[i] === null && shift.want[i] === id) {
        bowl.slots[i] = id;
        break;
      }
    }
    bowl.fillIdx++;
    sfx.plop(TOP_ORDER.indexOf(id));
    burst(bowlX() - 30 + i * 22, bowlY() - 58, TOPPINGS[id].color, 7);
    syncUI();
  }

  function canServe() {
    if (!shift || shift.phase !== "active") return false;
    if (bowl.noodleState === "idle" || bowl.noodleState === "cooking")
      return false;
    return bowl.slots.every(function (s) {
      return s !== null;
    });
  }

  function tryServe() {
    if (state !== "play" || !canServe()) {
      if (shift && shift.phase === "active" && !canServe()) {
        nudgeBowl();
        addFloater(
          bowl.noodleState === "idle" || bowl.noodleState === "cooking"
            ? "the noodles!"
            : "finish the ticket!",
          bowlX(),
          bowlY() - 104,
          "#ffd166",
          18,
        );
      }
      return;
    }
    finishServe();
  }

  function finishServe() {
    shift.phase = "served";
    shift.phaseT = 0;
    var multV = mult();
    var pts = 0;
    var lines = [];
    pts += shift.want.length * 100;
    lines.push("ticket +" + shift.want.length * 100);
    if (bowl.noodleState === "perfect") {
      pts += 150;
      lines.push("al dente +150");
    }
    var speed = Math.round((shift.patience / shift.patienceMax) * 200);
    pts += speed;
    lines.push("swift +" + speed);
    pts *= multV;
    if (multV > 1) lines.push("streak x" + multV);
    if (shift.vip) {
      pts *= 2;
      lines.push("gold x2");
    }
    score += pts;
    served++;
    if (bowl.noodleState === "perfect") {
      streak++;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      streak = 0;
    }
    sfx.slurp();
    addFloater("+" + fmt(pts), shift.x - 10, 208, "#ffd166", 30);
    var k;
    for (k = lines.length - 1; k >= 0; k--) {
      addFloater(
        lines[k],
        shift.x - 10,
        244 + k * 20,
        "#f6ead2",
        13,
        1400 + k * 300,
      );
    }
    syncUI();
  }

  function ruinBowl(reason) {
    bowl.noodleState = "burnt";
    sfx.burnt();
    shake = 14;
    burst(bowlX(), bowlY() - 60, "#5a5a5a", 20);
    loseHeart(reason);
  }

  function stormOut(reason) {
    shift.phase = "storm";
    shift.phaseT = 0;
    sfx.storm();
    loseHeart(reason);
  }

  function loseHeart(reason) {
    hearts--;
    streak = 0;
    var msg =
      reason === "burnt"
        ? "the pot burnt!"
        : reason === "patience"
          ? pick(["walked out!", "lost patience!", "left into the rain!"])
          : reason;
    if (shift.reg) addFloater(msg, shift.x - 10, 200, "#ef6461", 22);
    syncUI();
    if (hearts <= 0) endShift(false);
  }

  function endShift(won) {
    state = "end";
    var title = $("endTitle");
    var tag = $("endTag");
    var stats = $("endStats");
    if (won) {
      var rank =
        score < 2500
          ? "Night Porter"
          : score < 5500
            ? "Line Cook"
            : score < 8500
              ? "Broth Adept"
              : "Broth Sage";
      title.textContent = "Dawn breaks";
      tag.textContent = "Ten regulars fed. Rank earned: " + rank + ".";
      stats.textContent =
        "Score " +
        fmt(score) +
        "\nAl dente " +
        perfects +
        "/10 · best streak " +
        bestStreak;
      sfx.win();
      seedConfetti();
    } else {
      title.textContent = "Shutters down";
      tag.textContent = "Three walk-outs. The lantern gutters out.";
      stats.textContent =
        "Score " +
        fmt(score) +
        "\n" +
        served +
        "/10 served · best streak " +
        bestStreak;
      sfx.lose();
    }
    showOverlay("overlayEnd");
    syncUI();
  }

  /* ═══════════════════ small mechanics helpers ═══════════════════ */

  function mult() {
    return 1 + Math.min(4, streak);
  }

  function drainPatience(ms) {
    if (shift && shift.phase === "active") {
      shift.patience = Math.min(shift.patienceMax, shift.patience + ms);
    }
  }

  function bowlX() {
    return 300;
  }

  function bowlY() {
    return 452;
  }

  function nudgeBowl() {
    shake = Math.max(shake, 5);
  }

  function addFloater(text, x, y, color, size, life) {
    floaters.push({
      text: text,
      x: x,
      y: y,
      color: color || "#fff",
      size: size || 16,
      life: life || 1300,
      age: 0,
    });
  }

  function burst(x, y, color, n) {
    var k;
    for (k = 0; k < n; k++) {
      sparks.push({
        x: x,
        y: y,
        vx: rand(-90, 90),
        vy: rand(-150, -30),
        color: color,
        life: rand(0.4, 0.9),
        age: 0,
        r: rand(2, 4.5),
      });
    }
  }

  function seedConfetti() {
    var k;
    for (k = 0; k < 90; k++) {
      confetti.push({
        x: rand(0, W),
        y: rand(-H, 0),
        vy: rand(40, 120),
        vx: rand(-25, 25),
        rot: rand(0, TAU),
        vr: rand(-3, 3),
        kind: Math.random() < 0.5 ? "ring" : "star",
        color: pick(["#7fd66f", "#ffd166", "#f6ead2", "#ff9e7d", "#9fd6ff"]),
        s: rand(4, 9),
      });
    }
  }

  /* ════════════════════════ update ════════════════════════ */

  function update(dt) {
    var dts = dt / 1000;
    now += dt;
    lanternT += dts;
    if (shake > 0) shake = Math.max(0, shake - dts * 26);

    updateRain(dts);

    var i;
    for (i = steams.length - 1; i >= 0; i--) {
      var st = steams[i];
      st.age += dts;
      st.y -= st.vy * dts;
      st.x += Math.sin(st.age * 3 + st.seed) * 14 * dts;
      if (st.age > st.life) steams.splice(i, 1);
    }
    for (i = sparks.length - 1; i >= 0; i--) {
      var sp = sparks[i];
      sp.age += dts;
      sp.vy += 340 * dts;
      sp.x += sp.vx * dts;
      sp.y += sp.vy * dts;
      if (sp.age > sp.life) sparks.splice(i, 1);
    }
    for (i = floaters.length - 1; i >= 0; i--) {
      var fl = floaters[i];
      fl.age += dt;
      fl.y -= 26 * dts;
      if (fl.age > fl.life) floaters.splice(i, 1);
    }
    for (i = confetti.length - 1; i >= 0; i--) {
      var cf = confetti[i];
      cf.y += cf.vy * dts;
      cf.x += cf.vx * dts;
      cf.rot += cf.vr * dts;
      if (cf.y > H + 20) {
        cf.y = -20;
        cf.x = rand(0, W);
      }
    }

    if (bowl) {
      if (bowl.noodleState === "cooking") {
        bowl.t += dt;
        bowl.basketY = Math.min(1, bowl.basketY + dts * 5);
        if (bowl.t >= bowl.winStart && bowl.t - dt < bowl.winStart) sfx.tok();
        if (bowl.t >= bowl.burnAt) {
          ruinBowl("burnt");
          if (shift && shift.phase === "active") {
            shift.phase = "storm";
            shift.phaseT = 0;
          }
        }
      }
      if (bowl.ringFade < 1)
        bowl.ringFade = Math.min(1, bowl.ringFade + dts * 2);
      /* steam while simmering */
      if (
        (bowl.noodleState === "cooking" || bowl.noodleState === "perfect") &&
        Math.random() < dts * 9
      ) {
        steams.push({
          x: bowlX() + rand(-34, 34),
          y: bowlY() - 52,
          vy: rand(26, 46),
          life: rand(1, 1.8),
          age: 0,
          seed: rand(0, 9),
          r: rand(8, 16),
        });
      }
    }

    if (state === "play" && shift) updateShift(dt);
  }

  function updateShift(dt) {
    var dts = dt / 1000;
    shift.phaseT += dt;
    shift.blink -= dts;
    if (shift.blink < -0.12) shift.blink = rand(1.6, 4.5);

    if (shift.phase === "arrive") {
      shift.x = lerp(W + 90, 700, Math.min(1, shift.phaseT / 900));
      if (shift.phaseT >= 900) {
        shift.phase = "active";
        shift.phaseT = 0;
        bowl.slots = shift.want.map(function () {
          return null;
        });
        syncUI();
      }
    } else if (shift.phase === "active") {
      shift.patience += dt;
      var frac = 1 - shift.patience / shift.patienceMax;
      shift.mood = frac;
      if (shift.patience >= shift.patienceMax) stormOut("patience");
    } else if (shift.phase === "served") {
      if (shift.phaseT >= 1150) nextCustomer();
    } else if (shift.phase === "storm") {
      shift.x -= dts * 260;
      if (shift.phaseT >= 900 && hearts > 0) nextCustomer();
    }
  }

  function nextCustomer() {
    if (served >= 10) {
      endShift(true);
      return;
    }
    if (hearts <= 0) return; /* endShift already ran */
    shift = newShift(Math.min(9, shift.idx + 1));
    bowl = newBowl();
    syncUI();
  }

  function updateRain(dts) {
    while (rains.length < 90) {
      rains.push({
        x: rand(0, W),
        y: rand(-H, 0),
        len: rand(9, 20),
        v: rand(340, 560),
        layer: Math.random() < 0.75 ? 0 : 1,
      });
    }
    var i;
    for (i = 0; i < rains.length; i++) {
      var r = rains[i];
      r.y += r.v * dts;
      r.x -= r.v * 0.12 * dts;
      if (r.y > H) {
        if (Math.random() < 0.3) {
          splashes.push({ x: r.x, y: rand(468, 560), life: 0.3, age: 0 });
        }
        r.y = rand(-60, -10);
        r.x = rand(0, W + 60);
      }
    }
    for (i = splashes.length - 1; i >= 0; i--) {
      splashes[i].age += dts;
      if (splashes[i].age > splashes[i].life) splashes.splice(i, 1);
    }
  }

  /* ════════════════════════ render ════════════════════════ */

  function render() {
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    drawSky();
    drawSkyline();

    ctx.save();
    if (shake > 0) {
      ctx.translate(rand(-shake, shake) * 0.5, rand(-shake, shake) * 0.5);
    }
    drawRainLayer(0);
    drawStall();
    drawCounter();
    if (shift) drawCustomer();
    drawTicketRail();
    if (bowl) drawBowl();
    drawSparks();
    drawSplashes();
    drawRainLayer(1);
    drawSteamFront();
    ctx.restore();

    drawHUD();
    drawFloaters();
    if (state === "end") drawConfetti();
    drawVignette();
    ctx.restore();
  }

  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0d0a1e");
    g.addColorStop(0.55, "#1a1330");
    g.addColorStop(1, "#241736");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawSkyline() {
    ctx.fillStyle = "#141024";
    var bs = [
      [0, 330, 120, 270],
      [110, 290, 90, 310],
      [190, 350, 140, 250],
      [620, 310, 110, 290],
      [720, 270, 90, 330],
      [800, 340, 160, 260],
    ];
    var i;
    for (i = 0; i < bs.length; i++) {
      ctx.fillRect(bs[i][0], bs[i][1], bs[i][2], bs[i][3]);
    }
    ctx.fillStyle = "rgba(255,209,102,0.28)";
    var wins = [
      [30, 360],
      [64, 400],
      [132, 330],
      [220, 380],
      [280, 420],
      [650, 350],
      [688, 396],
      [748, 320],
      [838, 380],
      [900, 420],
    ];
    for (i = 0; i < wins.length; i++) {
      ctx.fillRect(wins[i][0], wins[i][1], 7, 9);
    }
  }

  function drawRainLayer(layer) {
    ctx.strokeStyle =
      layer === 0 ? "rgba(159,181,222,0.30)" : "rgba(200,214,240,0.45)";
    ctx.lineWidth = layer === 0 ? 1 : 1.5;
    ctx.beginPath();
    var i;
    for (i = 0; i < rains.length; i++) {
      var r = rains[i];
      if (r.layer !== layer) continue;
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - r.len * 0.12, r.y + r.len);
    }
    ctx.stroke();
  }

  function drawSplashes() {
    var i;
    ctx.strokeStyle = "rgba(200,214,240,0.5)";
    for (i = 0; i < splashes.length; i++) {
      var s = splashes[i];
      var p = s.age / s.life;
      ctx.globalAlpha = 1 - p;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 3 + p * 8, 1 + p * 2.4, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawStall() {
    /* posts */
    ctx.fillStyle = "#4a2f18";
    ctx.fillRect(24, 120, 18, 360);
    ctx.fillRect(W - 42, 120, 18, 360);
    /* awning */
    var stripes = 12;
    var aw = W - 20;
    var seg = aw / stripes;
    var i;
    for (i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#8c3b3b" : "#f0e3c8";
      ctx.beginPath();
      ctx.moveTo(10 + i * seg, 96);
      ctx.lineTo(10 + (i + 1) * seg, 96);
      ctx.lineTo(10 + (i + 1) * seg, 128);
      ctx.quadraticCurveTo(10 + (i + 0.5) * seg, 142, 10 + i * seg, 128);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#3a2512";
    ctx.fillRect(10, 92, aw, 8);
    /* lantern */
    var flick =
      0.86 + Math.sin(lanternT * 9) * 0.05 + Math.sin(lanternT * 23.7) * 0.04;
    var lx = 78;
    var ly = 168;
    var glow = ctx.createRadialGradient(lx, ly, 4, lx, ly, 130);
    glow.addColorStop(0, "rgba(255,190,90," + 0.34 * flick + ")");
    glow.addColorStop(1, "rgba(255,190,90,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(lx - 130, ly - 130, 260, 260);
    ctx.strokeStyle = "#2c1c0c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx, 96);
    ctx.lineTo(lx, ly - 34);
    ctx.stroke();
    ctx.fillStyle = "#ffb454";
    ctx.beginPath();
    ctx.ellipse(lx, ly, 22, 30, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#c97f2e";
    ctx.beginPath();
    ctx.moveTo(lx - 22, ly);
    ctx.lineTo(lx + 22, ly);
    ctx.moveTo(lx - 18, ly - 15);
    ctx.lineTo(lx + 18, ly - 15);
    ctx.moveTo(lx - 18, ly + 15);
    ctx.lineTo(lx + 18, ly + 15);
    ctx.stroke();
    ctx.fillStyle = "#2c1c0c";
    ctx.fillRect(lx - 8, ly - 38, 16, 6);
    ctx.fillRect(lx - 8, ly + 32, 16, 6);
  }

  function drawCounter() {
    var g = ctx.createLinearGradient(0, 452, 0, H);
    g.addColorStop(0, "#9a683c");
    g.addColorStop(0.12, "#8a5a33");
    g.addColorStop(1, "#4c3018");
    ctx.fillStyle = g;
    ctx.fillRect(0, 452, W, H - 452);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    var i;
    for (i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 452 + i * 38);
      ctx.lineTo(W, 452 + i * 38);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,220,160,0.10)";
    ctx.fillRect(0, 452, W, 5);
    /* stools */
    ctx.fillStyle = "#3a2512";
    ctx.fillRect(120, 520, 10, 70);
    ctx.fillRect(560, 520, 10, 70);
  }

  function drawCustomer() {
    if (!shift || shift.idx === undefined) return;
    var x = shift.x;
    var y = 372; /* feet on floor behind counter */
    var bob = shift.phase === "active" ? Math.sin(now / 300) * 2 : 0;
    var reg = shift.reg;
    var leaving = shift.phase === "storm";

    ctx.save();
    if (leaving) ctx.globalAlpha = Math.max(0.15, 1 - shift.phaseT / 900);

    /* umbrella */
    ctx.strokeStyle = "#20202c";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 46, y - 96 + bob);
    ctx.lineTo(x + 46, y - 148 + bob);
    ctx.stroke();
    ctx.fillStyle = shift.vip ? "#caa53f" : "#5a4a7a";
    ctx.beginPath();
    ctx.moveTo(x + 18, y - 146 + bob);
    ctx.quadraticCurveTo(x + 46, y - 178 + bob, x + 74, y - 146 + bob);
    ctx.quadraticCurveTo(x + 46, y - 156 + bob, x + 18, y - 146 + bob);
    ctx.fill();

    /* body */
    ctx.fillStyle = reg.coat;
    ctx.beginPath();
    ctx.moveTo(x - 30, y);
    ctx.quadraticCurveTo(x - 34, y - 74, x, y - 80 + bob);
    ctx.quadraticCurveTo(x + 34, y - 74, x + 30, y);
    ctx.closePath();
    ctx.fill();

    /* head */
    var hy = y - 106 + bob;
    ctx.fillStyle = reg.skin;
    ctx.beginPath();
    ctx.arc(x, hy, 22, 0, TAU);
    ctx.fill();
    /* hair */
    ctx.fillStyle = "#241a12";
    ctx.beginPath();
    ctx.arc(x, hy - 6, 22, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();

    /* face by mood */
    var mood = shift.mood;
    ctx.strokeStyle = "#241a12";
    ctx.lineWidth = 2.4;
    var blink = shift.blink < 0;
    var ey = hy - 2;
    ctx.beginPath();
    if (blink) {
      ctx.moveTo(x - 11, ey);
      ctx.lineTo(x - 5, ey);
      ctx.moveTo(x + 5, ey);
      ctx.lineTo(x + 11, ey);
    } else if (mood < 0.28) {
      /* angry slants */
      ctx.moveTo(x - 12, ey - 4);
      ctx.lineTo(x - 4, ey);
      ctx.moveTo(x + 4, ey);
      ctx.lineTo(x + 12, ey - 4);
    } else {
      ctx.moveTo(x - 10, ey);
      ctx.lineTo(x - 5, ey - 4);
      ctx.moveTo(x - 10, ey - 4);
      ctx.lineTo(x - 5, ey);
      ctx.moveTo(x + 5, ey - 4);
      ctx.lineTo(x + 10, ey);
      ctx.moveTo(x + 5, ey);
      ctx.lineTo(x + 10, ey - 4);
    }
    ctx.stroke();
    /* mouth */
    ctx.beginPath();
    if (shift.phase === "served") {
      ctx.arc(x, hy + 8, 8, 0.15 * Math.PI, 0.85 * Math.PI);
    } else if (mood < 0.28) {
      ctx.arc(x, hy + 15, 7, 1.2 * Math.PI, 1.8 * Math.PI);
    } else {
      ctx.moveTo(x - 5, hy + 10);
      ctx.lineTo(x + 5, hy + 10);
    }
    ctx.stroke();

    /* patience bar */
    if (shift.phase === "active") {
      var bw = 76;
      var frac = clamp(1 - shift.patience / shift.patienceMax, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(x - bw / 2, y + 12, bw, 9);
      ctx.fillStyle =
        frac > 0.5 ? "#58d68d" : frac > 0.25 ? "#ffd166" : "#ef6461";
      ctx.fillRect(x - bw / 2 + 1, y + 13, (bw - 2) * frac, 7);
    }
    ctx.restore();
  }

  function drawTicketRail() {
    if (!shift || shift.phase === "storm") return;
    var tx = W / 2;
    var ty = 64;
    var tw = 320;
    var th = 158;
    var sway = Math.sin(now / 900) * 0.02;

    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(sway);
    /* strings */
    ctx.strokeStyle = "rgba(246,234,210,0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-tw / 2 + 30, -40);
    ctx.lineTo(-tw / 2 + 40, 4);
    ctx.moveTo(tw / 2 - 30, -40);
    ctx.lineTo(tw / 2 - 40, 4);
    ctx.stroke();

    /* paper */
    ctx.fillStyle = shift.vip ? "#ffe9ad" : "#fff7e6";
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = 14;
    ctx.fillRect(-tw / 2, 0, tw, th);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = shift.vip ? "#c9971f" : "#d9c9a8";
    ctx.lineWidth = 3;
    if (shift.vip) {
      ctx.strokeRect(-tw / 2 + 3, 3, tw - 6, th - 6);
    }
    ctx.strokeRect(-tw / 2, 0, tw, th);

    ctx.fillStyle = "#33241a";
    ctx.font = "bold 15px Georgia, serif";
    ctx.textAlign = "center";
    var head = shift.vip
      ? "★ GOLD TICKET — IN ORDER ★"
      : "ORDER No." + (shift.idx + 1);
    ctx.fillText(head, 0, 24);
    ctx.font = "italic 12px Georgia, serif";
    ctx.fillText(regName(), 0, 42);

    /* icon slots */
    var n = shift.want.length;
    var gap = Math.min(64, (tw - 40) / n);
    var startX = -((n - 1) * gap) / 2;
    var i;
    for (i = 0; i < n; i++) {
      var ix = startX + i * gap;
      var iy = 84;
      var filled =
        bowl && bowl.slots[i] !== null && bowl.slots[i] !== undefined;
      ctx.beginPath();
      ctx.arc(ix, iy, 22, 0, TAU);
      ctx.fillStyle = filled ? "#eaf7ea" : "#f3e6cd";
      ctx.fill();
      ctx.strokeStyle = filled ? "#2f9e63" : "#cdbb96";
      ctx.lineWidth = 2;
      ctx.stroke();
      if (filled) {
        drawTopGlyph(shift.want[i], ix, iy, 13);
        /* green check */
        ctx.strokeStyle = "#2f9e63";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ix + 8, iy + 14);
        ctx.lineTo(ix + 14, iy + 20);
        ctx.lineTo(ix + 26, iy + 4);
        ctx.stroke();
      } else {
        drawTopGlyph(shift.want[i], ix, iy, 13);
        if (shift.vip) {
          ctx.fillStyle = "#a8842f";
          ctx.font = "bold 11px Georgia, serif";
          ctx.fillText(String(i + 1), ix + 16, iy - 16);
        }
      }
    }
    ctx.restore();
  }

  function regName() {
    return shift.reg.who.charAt(0).toUpperCase() + shift.reg.who.slice(1);
  }

  function drawTopGlyph(id, x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    var t = TOPPINGS[id];
    if (id === "negi") {
      ctx.strokeStyle = t.dark;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(-r * 0.4, 0, r * 0.55, 0, TAU);
      ctx.moveTo(r * 0.65, r * 0.2);
      ctx.arc(r * 0.3, r * 0.2, r * 0.5, 0, TAU);
      ctx.stroke();
    } else if (id === "tamago") {
      ctx.fillStyle = t.color;
      ctx.fillRect(-r, -r * 0.7, r * 2, r * 1.4);
      ctx.fillStyle = t.dark;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.45, 0, TAU);
      ctx.fill();
    } else if (id === "nori") {
      ctx.fillStyle = t.color;
      ctx.fillRect(-r * 0.85, -r, r * 1.7, r * 2);
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(-r * 0.85, -r, r * 0.6, r * 2);
    } else if (id === "chashu") {
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = t.dark;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      var a;
      for (a = 0; a < TAU * 2.2; a += 0.3) {
        var rr = (a / (TAU * 2.2)) * r * 0.9;
        if (a === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.stroke();
    } else {
      /* menma */
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.6);
      ctx.lineTo(r * 0.5, r * 0.7);
      ctx.moveTo(r * 0.1, -r * 0.8);
      ctx.lineTo(r * 0.85, r * 0.35);
      ctx.stroke();
      ctx.strokeStyle = t.dark;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.6);
      ctx.lineTo(r * 0.5, r * 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBowl() {
    var x = bowlX();
    var y = bowlY();

    /* simmer ring */
    if (bowl.noodleState === "cooking") {
      var p = clamp(bowl.t / bowl.burnAt, 0, 1);
      var inWin = bowl.t >= bowl.winStart && bowl.t <= bowl.winEnd;
      ctx.save();
      ctx.translate(x, y);
      ctx.lineWidth = 9;
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.beginPath();
      ctx.arc(0, 0, 108, 0, TAU);
      ctx.stroke();
      /* green window arc */
      ctx.strokeStyle = inWin ? "#58d68d" : "rgba(88,214,141,0.75)";
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.arc(
        0,
        0,
        108,
        -Math.PI / 2 + (bowl.winStart / bowl.burnAt) * TAU,
        -Math.PI / 2 + (bowl.winEnd / bowl.burnAt) * TAU,
      );
      ctx.stroke();
      /* progress */
      ctx.strokeStyle = inWin ? "#eafff0" : "#ffb454";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, 94, -Math.PI / 2, -Math.PI / 2 + p * TAU);
      ctx.stroke();
      /* burn tick */
      ctx.strokeStyle = "#ef6461";
      ctx.lineWidth = 4;
      var ba = -Math.PI / 2 + TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ba) * 100, Math.sin(ba) * 100);
      ctx.lineTo(Math.cos(ba) * 116, Math.sin(ba) * 116);
      ctx.stroke();
      ctx.restore();
      if (inWin) {
        ctx.font = "bold 30px Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillStyle = Math.sin(now / 90) > 0 ? "#58d68d" : "#eafff0";
        ctx.fillText("STRAIN!", x, y - 138);
      }
    }

    /* basket handle while cooking */
    if (bowl.noodleState === "cooking" || bowl.noodleState === "idle") {
      ctx.strokeStyle = "#6b4423";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x - 40, y - 96);
      ctx.quadraticCurveTo(x, y - 150, x + 40, y - 96);
      ctx.stroke();
    }

    /* bowl body */
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#b03a3a";
    ctx.beginPath();
    ctx.moveTo(x - 86, y - 44);
    ctx.quadraticCurveTo(x - 80, y + 44, x, y + 48);
    ctx.quadraticCurveTo(x + 80, y + 44, x + 86, y - 44);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    /* rim */
    ctx.fillStyle = "#f0e3c8";
    ctx.beginPath();
    ctx.ellipse(x, y - 44, 86, 22, 0, 0, TAU);
    ctx.fill();
    /* stripe */
    ctx.fillStyle = "#f0e3c8";
    ctx.fillRect(x - 84, y - 8, 168, 9);

    /* broth */
    var bg = ctx.createRadialGradient(x, y - 46, 8, x, y - 46, 84);
    bg.addColorStop(0, "#e8a23c");
    bg.addColorStop(1, "#b96f1d");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(x, y - 44, 76, 17, 0, 0, TAU);
    ctx.fill();
    /* oil gleam swirl */
    ctx.strokeStyle = "rgba(255,230,160,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    var sw;
    for (sw = 0; sw < TAU; sw += 0.22) {
      var rr = 30 + Math.sin(sw * 3 + now / 500) * 12;
      var px = x + Math.cos(sw + now / 900) * rr;
      var py = y - 44 + Math.sin(sw + now / 900) * rr * 0.22;
      if (sw === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    /* noodle bundle */
    if (bowl.noodleState !== "idle" && bowl.noodleState !== "burnt") {
      var ny =
        y -
        46 +
        (bowl.noodleState === "cooking" ? (1 - bowl.basketY) * -26 : 0);
      ctx.strokeStyle = "#f5e6a8";
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      var k;
      for (k = 0; k < 9; k++) {
        var wob = Math.sin(now / 260 + k) * 4;
        ctx.moveTo(x - 44 + k * 10, ny + 6);
        ctx.quadraticCurveTo(
          x - 40 + k * 10 + wob,
          ny - 10,
          x - 30 + k * 10,
          ny - 2,
        );
      }
      ctx.stroke();
      if (bowl.noodleState === "perfect") {
        ctx.font = "italic 13px Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#eaffea";
        ctx.fillText("al dente", x, y + 74);
      } else if (bowl.noodleState === "under") {
        ctx.fillStyle = "#cfe8ff";
        ctx.fillText("crunchy", x, y + 74);
      } else if (bowl.noodleState === "over") {
        ctx.fillStyle = "#dcc9ff";
        ctx.fillText("soggy", x, y + 74);
      }
    }
    if (bowl.noodleState === "burnt") {
      ctx.fillStyle = "#3a332c";
      ctx.beginPath();
      ctx.ellipse(x, y - 44, 70, 14, 0, 0, TAU);
      ctx.fill();
      ctx.font = "italic 14px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ef9a9a";
      ctx.fillText("burnt…", x, y + 74);
    }

    /* placed toppings riding the broth */
    var placed = [];
    var q;
    for (q = 0; q < bowl.slots.length; q++) {
      if (bowl.slots[q]) placed.push(bowl.slots[q]);
    }
    for (q = 0; q < placed.length; q++) {
      var ang = -0.9 + q * 0.85;
      var tx = x + Math.cos(ang) * 46;
      var ty2 = y - 46 + Math.sin(ang) * 8;
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.ellipse(tx, ty2 + 4, 13, 5, 0, 0, TAU);
      ctx.fill();
      drawTopGlyph(placed[q], tx, ty2, 10);
    }
  }

  function drawSteamFront() {
    var i;
    for (i = 0; i < steams.length; i++) {
      var st = steams[i];
      var p = st.age / st.life;
      ctx.globalAlpha = (1 - p) * 0.34;
      ctx.fillStyle = "#fdf6e3";
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r * (1 + p), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawSparks() {
    var i;
    for (i = 0; i < sparks.length; i++) {
      var sp = sparks[i];
      ctx.globalAlpha = 1 - sp.age / sp.life;
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawHUD() {
    /* hearts */
    var i;
    for (i = 0; i < HEARTS; i++) {
      var hx = 34 + i * 34;
      var hy = 34;
      drawHeart(hx, hy, 12, i < hearts ? "#ef6461" : "rgba(246,234,210,0.22)");
    }
    /* score */
    ctx.textAlign = "right";
    ctx.font = "bold 26px Georgia, serif";
    ctx.fillStyle = "#ffd166";
    ctx.fillText(fmt(score), W - 30, 44);
    ctx.font = "13px Georgia, serif";
    ctx.fillStyle = "rgba(246,234,210,0.8)";
    ctx.fillText("score", W - 30, 62);

    /* shift progress + streak */
    ctx.textAlign = "center";
    ctx.font = "14px Georgia, serif";
    ctx.fillStyle = "rgba(246,234,210,0.85)";
    if (shift) {
      var custNum = shift.idx + 1;
      ctx.fillText("customer " + custNum + " of 10", W / 2, 24);
    }
    if (streak >= 2) {
      ctx.font = "bold 17px Georgia, serif";
      ctx.fillStyle = "#ffd166";
      ctx.fillText("streak " + streak + "  ×" + mult(), W / 2, 46);
    }

    /* contextual hint */
    if (state === "play" && shift && shift.phase === "active") {
      var msg;
      if (bowl.noodleState === "idle" && bowl.slots.length) {
        msg = "Space drops the noodles · fill the ticket while it simmers";
      } else if (bowl.noodleState === "cooking") {
        msg =
          bowl.t >= bowl.winStart && bowl.t <= bowl.winEnd
            ? "NOW — Space strains them!"
            : "watch the ring… strain inside the green";
      } else if (canServe()) {
        msg = "looks good — Enter serves it";
      } else {
        msg = "fill every slot on the ticket";
      }
      ctx.font = "italic 15px Georgia, serif";
      ctx.fillStyle = "rgba(246,234,210,0.75)";
      ctx.fillText(msg, W / 2, H - 18);
    } else if (state === "play" && shift && shift.phase === "arrive") {
      ctx.font = "italic 15px Georgia, serif";
      ctx.fillStyle = "rgba(246,234,210,0.75)";
      ctx.fillText(regName() + " shakes off the rain…", W / 2, H - 18);
    }
  }

  function drawHeart(x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s / 12, s / 12);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.bezierCurveTo(-11, -5, -8, -14, 0, -8);
    ctx.bezierCurveTo(8, -14, 11, -5, 0, 5);
    ctx.fill();
    ctx.restore();
  }

  function drawFloaters() {
    ctx.textAlign = "center";
    var i;
    for (i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      var p = f.age / f.life;
      ctx.globalAlpha = p > 0.7 ? (1 - p) / 0.3 : 1;
      ctx.font = "bold " + f.size + "px Georgia, serif";
      ctx.fillStyle = f.color;
      ctx.strokeStyle = "rgba(10,6,20,0.7)";
      ctx.lineWidth = 3;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawConfetti() {
    var i;
    for (i = 0; i < confetti.length; i++) {
      var c = confetti[i];
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      if (c.kind === "ring") {
        ctx.strokeStyle = c.color;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, c.s, 0, TAU);
        ctx.stroke();
      } else {
        ctx.fillRect(-c.s / 2, -c.s / 2, c.s, c.s);
      }
      ctx.restore();
    }
  }

  function drawVignette() {
    var g = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.45,
      W / 2,
      H / 2,
      H * 0.95,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(4,2,10,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ═══════════════════ UI plumbing ═══════════════════ */

  var binBtns = {};

  function showOverlay(id) {
    var ids = ["overlayTitle", "overlayPause", "overlayEnd"];
    var i;
    for (i = 0; i < ids.length; i++) {
      $(ids[i]).classList.toggle("show", ids[i] === id);
    }
  }

  function syncUI() {
    var playing = state === "play";
    var active = playing && shift && shift.phase === "active";
    Object.keys(binBtns).forEach(function (k) {
      binBtns[k].disabled = !active;
    });
    var potBtn = $("btnPot");
    var serveBtn = $("btnServe");
    if (bowl && bowl.noodleState === "cooking") {
      var inWin = bowl.t >= bowl.winStart && bowl.t <= bowl.winEnd;
      potBtn.innerHTML = "Strain!<kbd>Space</kbd>";
      potBtn.disabled = !active;
      potBtn.classList.toggle("armed", active && inWin);
    } else {
      potBtn.innerHTML = "Noodles ↓<kbd>Space</kbd>";
      potBtn.disabled = !active || (bowl && bowl.noodleState !== "idle");
      potBtn.classList.remove("armed");
    }
    serveBtn.disabled = !(playing && canServe());
    $("btnRestart").disabled = state === "title";
  }

  function wireDom() {
    canvas = $("scene");
    ctx = canvas.getContext("2d");

    binBtns = {};
    Array.prototype.forEach.call(
      document.querySelectorAll(".bin"),
      function (b) {
        binBtns[b.getAttribute("data-top")] = b;
        b.addEventListener("click", function () {
          addTopping(b.getAttribute("data-top"));
          b.blur();
        });
      },
    );

    $("btnPot").addEventListener("click", function () {
      potAction();
      this.blur();
    });
    $("btnServe").addEventListener("click", function () {
      tryServe();
      this.blur();
    });
    $("btnStart").addEventListener("click", startShift);
    $("btnAgain").addEventListener("click", startShift);
    $("btnResume").addEventListener("click", function () {
      togglePause();
    });
    $("btnPause").addEventListener("click", function () {
      togglePause();
      this.blur();
    });
    $("btnRestart").addEventListener("click", function () {
      if (state !== "title") startShift();
      this.blur();
    });
    $("btnSound").addEventListener("click", function () {
      audio.ensure();
      audio.setMuted(!audio.muted);
      this.textContent = audio.muted ? "Sound: Off" : "Sound: On";
      this.setAttribute("aria-pressed", String(!audio.muted));
      this.blur();
    });

    document.addEventListener("keydown", function (e) {
      if (e.repeat) return;
      var code = e.code;
      if (code === "Space") {
        e.preventDefault();
        if (state === "title" || state === "end") startShift();
        else if (state === "play") potAction();
        return;
      }
      if (code === "Enter") {
        e.preventDefault();
        if (state === "title" || state === "end") startShift();
        else if (state === "play") tryServe();
        return;
      }
      if (code === "Escape" || code === "KeyP") {
        if (state === "play" || state === "paused") togglePause();
        return;
      }
      if (code === "KeyM") {
        $("btnSound").click();
        return;
      }
      if (code === "KeyR") {
        if (state !== "title") startShift();
        return;
      }
      var digitMatch = /^Digit([1-5])$/.exec(code);
      if (digitMatch) {
        e.preventDefault();
        addTopping(TOP_ORDER[Number(digitMatch[1]) - 1]);
      }
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden && state === "play") togglePause(true);
    });

    fitCanvas();
    window.addEventListener("resize", fitCanvas);
  }

  function fitCanvas() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ═══════════════════ main loop ═══════════════════ */

  var lastTs = 0;

  function frame(ts) {
    var raw = lastTs === 0 ? 16 : ts - lastTs;
    lastTs = ts;
    var dt = clamp(raw, 0, 48);
    if (state !== "paused") {
      update(dt * timeScale);
    }
    render();
    requestAnimationFrame(frame);
  }

  /* ═══════════════ boot ═════════════ */

  resetGame();
  wireDom();
  showOverlay("overlayTitle");
  requestAnimationFrame(frame);

  /* tiny debug seam used by the factory's automated playtests */
  window.__midnightBroth = {
    state: function () {
      return state;
    },
    customer: function () {
      return shift
        ? {
            phase: shift.phase,
            want: shift.want.slice(),
            vip: shift.vip,
            idx: shift.idx,
          }
        : null;
    },
    bowl: function () {
      return {
        state: bowl.noodleState,
        inWindow:
          bowl.noodleState === "cooking" &&
          bowl.t >= bowl.winStart &&
          bowl.t <= bowl.winEnd,
        slots: bowl.slots.slice(),
      };
    },
    canServe: canServe,
    stats: function () {
      return {
        score: score,
        served: served,
        hearts: hearts,
        perfects: perfects,
      };
    },
    timeScale: function (v) {
      timeScale = v;
    },
  };
})();
