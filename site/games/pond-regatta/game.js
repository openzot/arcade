/*
 * Pond Regatta — helm a pond yacht round three marks, twice, against
 * Old Bramble, the park champion. Steer the tiller, trim the sheet,
 * hunt the darker gust water. Everything lives in this one classic
 * script, wrapped in an IIFE.
 */
(function () {
  "use strict";

  /* ── helpers ─────────────────────────────────────────── */

  var $ = function (id) {
    return document.getElementById(id);
  };
  var TAU = Math.PI * 2;
  var PI = Math.PI;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function rand(a, b) {
    return a + Math.random() * (b - a);
  }
  function angNorm(a) {
    a = (a + PI) % TAU;
    if (a < 0) a += TAU;
    return a - PI;
  }
  function dist(ax, ay, bx, by) {
    return Math.hypot(bx - ax, by - ay);
  }

  /* distance from point p to segment ab */
  function segDist(px, py, ax, ay, bx, by) {
    var vx = bx - ax,
      vy = by - ay;
    var wx = px - ax,
      wy = py - ay;
    var len2 = vx * vx + vy * vy;
    var t = len2 ? clamp((wx * vx + wy * vy) / len2, 0, 1) : 0;
    return dist(px, py, ax + vx * t, ay + vy * t);
  }

  /* piecewise-linear curve lookup, pts sorted by x */
  function curve(pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        var a = pts[i - 1],
          b = pts[i];
        return lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
      }
    }
    return pts[pts.length - 1][1];
  }

  /* ── dom ─────────────────────────────────────────────── */

  var cvs = $("lake");
  var ctx = cvs.getContext("2d");

  var hudPos = $("hudPos");
  var hudLap = $("hudLap");
  var hudClock = $("hudClock");
  var sheetFill = $("hudSheetFill");
  var roseN = $("roseN");

  var ovTitle = $("ovTitle");
  var ovCount = $("ovCount");
  var countNum = $("countNum");
  var ovResult = $("ovResult");
  var ovPause = $("ovPause");

  var btnStart = $("btnStart");
  var btnAgain = $("btnAgain");
  var btnResume = $("btnResume");
  var btnRestart = $("btnRestart");
  var btnRestart2 = $("btnRestart2");
  var btnPause = $("btnPause");
  var btnMute = $("btnMute");

  var padPort = $("padPort");
  var padStbd = $("padStbd");
  var padEase = $("padEase");
  var padTrim = $("padTrim");

  /* ── world constants ─────────────────────────────────── */

  var WORLD_W = 1600,
    WORLD_H = 1000;
  var WATER = { x: 110, y: 95, w: 1380, h: 810 }; // pond rectangle
  var LAPS = 3;
  var NOGO = 28; // degrees off the wind

  var MARKS = {
    m1: { x: 330, y: 480, color: "#d4574a", name: "RED" },
    m2: { x: 900, y: 205, color: "#e0b64e", name: "YELLOW" },
    m3: { x: 1225, y: 735, color: "#63b56a", name: "GREEN" },
  };

  var COMMITTEE = { x: 1360, y: 585 }; // line, north end
  var PIN = { x: 1360, y: 775 }; // line, south end

  /* one lap of checkpoints, in rounding order */
  function lapCourse() {
    return [
      { kind: "mark", x: MARKS.m1.x, y: MARKS.m1.y },
      { kind: "mark", x: MARKS.m2.x, y: MARKS.m2.y },
      { kind: "mark", x: MARKS.m3.x, y: MARKS.m3.y },
      { kind: "line", ax: COMMITTEE.x, ay: COMMITTEE.y, bx: PIN.x, by: PIN.y },
    ];
  }
  var COURSE = lapCourse();

  /* leg lengths, for progress + rubber-banding */
  var LEGS = [];
  (function () {
    var px = COMMITTEE.x,
      py = (COMMITTEE.y + PIN.y) / 2;
    for (var i = 0; i < COURSE.length; i++) {
      var c = COURSE[i];
      var cx = c.kind === "mark" ? c.x : (c.ax + c.bx) / 2;
      var cy = c.kind === "mark" ? c.y : (c.ay + c.by) / 2;
      LEGS.push(dist(px, py, cx, cy));
      px = cx;
      py = cy;
    }
  })();
  var LAP_LEN = LEGS.reduce(function (a, b) {
    return a + b;
  }, 0);

  /* polar: boat speed fraction vs degrees off the wind */
  var POLAR = [
    [0, 0.02],
    [NOGO, 0.1],
    [34, 0.44],
    [45, 0.64],
    [65, 0.84],
    [95, 0.97],
    [120, 1.0],
    [150, 0.87],
    [180, 0.66],
  ];

  /* ── wind ────────────────────────────────────────────── */

  var wind = { to: 0, strength: 1, gx: [], streaks: [] };

  function windReset(t) {
    wind.to = 0;
    wind.strength = 1;
    wind.gx = [];
    for (var i = 0; i < 5; i++) {
      wind.gx.push({
        x: rand(WATER.x + 150, WATER.x + WATER.w - 150),
        y: rand(WATER.y + 150, WATER.y + WATER.h - 150),
        r: rand(120, 205),
        a: rand(0, TAU),
        sp: rand(10, 24),
        ph: rand(0, TAU),
      });
    }
    wind.streaks = [];
    for (i = 0; i < 26; i++) {
      wind.streaks.push({
        x: rand(WATER.x, WATER.x + WATER.w),
        y: rand(WATER.y, WATER.y + WATER.h),
        o: rand(0.25, 0.7),
      });
    }
  }

  function windUpdate(t, dt) {
    wind.to = 0.088 * Math.sin(t * 0.05) + 0.052 * Math.sin(t * 0.113 + 1.7);
    wind.strength =
      1 + 0.17 * Math.sin(t * 0.071) + 0.07 * Math.sin(t * 0.171 + 0.6);

    for (var i = 0; i < wind.gx.length; i++) {
      var g = wind.gx[i];
      g.ph += dt * 0.4;
      g.a = Math.atan2(Math.sin(g.ph), Math.cos(g.ph * 0.63));
      g.x += Math.cos(g.a) * g.sp * dt;
      g.y += Math.sin(g.a) * g.sp * dt;
      if (
        g.x < WATER.x + g.r * 0.4 ||
        g.x > WATER.x + WATER.w - g.r * 0.4 ||
        g.y < WATER.y + g.r * 0.4 ||
        g.y > WATER.y + WATER.h - g.r * 0.4
      ) {
        g.a += PI + rand(-0.6, 0.6);
      }
      g.x = clamp(g.x, WATER.x + 40, WATER.x + WATER.w - 40);
      g.y = clamp(g.y, WATER.y + 40, WATER.y + WATER.h - 40);
    }

    var sx = Math.cos(wind.to),
      sy = Math.sin(wind.to);
    var sp = 42 + wind.strength * 34;
    for (i = 0; i < wind.streaks.length; i++) {
      var s = wind.streaks[i];
      s.x += sx * sp * dt;
      s.y += sy * sp * dt;
      if (s.x < WATER.x) s.x += WATER.w;
      if (s.x > WATER.x + WATER.w) s.x -= WATER.w;
      if (s.y < WATER.y) s.y += WATER.h;
      if (s.y > WATER.y + WATER.h) s.y -= WATER.h;
    }
  }

  /* local wind strength multiplier at a point (gust patches breathe harder) */
  function windAt(x, y) {
    var w = wind.strength;
    for (var i = 0; i < wind.gx.length; i++) {
      var g = wind.gx[i];
      var d = dist(x, y, g.x, g.y);
      if (d < g.r) w += 0.38 * (1 - d / g.r);
    }
    return w;
  }

  /* ── audio (all synthesised) ─────────────────────────── */

  var AU = null;
  var muted = false;

  function audioInit() {
    if (AU || muted === null) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ac = new AC();
      var master = ac.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ac.destination);

      /* looping water noise bed */
      var len = ac.sampleRate * 2;
      var buf = ac.createBuffer(1, len, ac.sampleRate);
      var data = buf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < len; i++) {
        var wn = Math.random() * 2 - 1;
        last = (last + 0.02 * wn) / 1.02;
        data[i] = last * 3.2;
      }
      function noiseChain(freq, type, q, g0) {
        var src = ac.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        var f = ac.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        var gn = ac.createGain();
        gn.gain.value = g0;
        src.connect(f);
        f.connect(gn);
        gn.connect(master);
        src.start();
        return gn;
      }
      AU = {
        ac: ac,
        master: master,
        water: noiseChain(420, "lowpass", 0.7, 0.0),
        windG: noiseChain(760, "bandpass", 0.6, 0.0),
      };
    } catch (e) {
      AU = null;
    }
  }

  function tone(freq, dur, type, vol, delay, slide) {
    if (!AU) return;
    try {
      var ac = AU.ac;
      var t0 = ac.currentTime + (delay || 0);
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.type = type || "triangle";
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(AU.master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    } catch (e) {
      /* silent */
    }
  }

  var sfx = {
    tick: function () {
      tone(520, 0.09, "square", 0.1);
    },
    go: function () {
      tone(196, 0.5, "sawtooth", 0.16, 0, 185);
      tone(392, 0.5, "triangle", 0.1, 0.02);
    },
    bell: function () {
      tone(1245, 0.5, "sine", 0.14);
      tone(1867, 0.32, "sine", 0.06, 0.01);
    },
    bump: function () {
      tone(90, 0.16, "sine", 0.22, 0, 55);
    },
    win: function () {
      tone(523, 0.16, "triangle", 0.16, 0);
      tone(659, 0.16, "triangle", 0.16, 0.14);
      tone(784, 0.22, "triangle", 0.17, 0.28);
      tone(1046, 0.5, "triangle", 0.18, 0.46);
    },
    lose: function () {
      tone(311, 0.3, "triangle", 0.15, 0);
      tone(233, 0.5, "triangle", 0.15, 0.26);
      tone(174, 0.7, "triangle", 0.14, 0.55);
    },
  };

  function audioFrame(playerV, localW) {
    if (!AU) return;
    try {
      AU.water.gain.value = clamp(playerV / 110, 0, 1) * 0.14;
      AU.windG.gain.value = clamp((localW - 0.8) * 0.22, 0, 0.12);
    } catch (e) {
      /* ignore */
    }
  }

  function setMuted(m) {
    muted = m;
    btnMute.classList.toggle("on", !m);
    if (AU) {
      try {
        AU.master.gain.value = m ? 0 : 0.9;
      } catch (e) {
        /* ignore */
      }
    }
  }

  /* ── yachts ──────────────────────────────────────────── */

  function Yacht(opts) {
    this.isPlayer = !!opts.isPlayer;
    this.hull = opts.hull;
    this.sailCol = opts.sailCol;
    this.trimCol = opts.trimCol;
    this.reset();
  }

  Yacht.prototype.reset = function () {
    this.x = this.isPlayer ? 1298 : 1298;
    this.y = this.isPlayer ? 700 : 748;
    this.heading = PI + 0.73; // settled on a close-hauled port tack
    this.v = 0;
    this.sheet = 0.06;
    this.cp = 0; // checkpoint index within the lap
    this.lap = 0; // completed laps
    this.finished = false;
    this.finishTime = 0;
    this.awDeg = 180;
    this.thrustMul = 1;
    this.flap = 0; // sail-flutter phase when in irons
    this.wake = [];
    this.wakeT = 0;
    this.bumpT = 0;
    this.resultLogged = false;
    this.grooveSide = 0;
    this.noisePh = rand(0, TAU);
  };

  /* effective sail angle in degrees, given sheet 0..1 */
  function effDeg(sheet) {
    return 12 + sheet * 72;
  }

  /* ideal sheet angle for a given angle off the wind */
  function idealDeg(aw) {
    return clamp((aw - 18) * 0.5, 10, 84);
  }

  Yacht.prototype.physics = function (dt, steer, sheetRate, thrustScale) {
    /* angle off the wind: 0 = bow straight into it */
    var windFrom = wind.to + PI;
    this.awDeg = (Math.abs(angNorm(this.heading - windFrom)) * 180) / PI;

    var localW = windAt(this.x, this.y);
    var pol = curve(POLAR, this.awDeg);

    var ed = effDeg(this.sheet);
    var idl = idealDeg(this.awDeg);
    var trim = Math.exp(-Math.pow((ed - idl) / 26, 2));
    this.trimGood = Math.abs(ed - idl) < 9;

    var inIrons = this.awDeg < NOGO;
    var thrust;
    if (inIrons) {
      thrust = -26 * localW; // pushed backwards, sails stalled
      this.flap += dt * 14;
      this.thrustLocal = 0;
      /* backed out of irons: the bow falls off away from the eye on
         whichever tack it is already on, until the sails fill */
      var sgn = angNorm(this.heading - windFrom) >= 0 ? 1 : -1;
      this.heading = angNorm(
        this.heading +
          sgn * clamp(Math.abs(this.v) / 24 + 0.35, 0, 1) * 0.6 * dt,
      );
    } else {
      this.flap = 0;
      this.thrustLocal = pol * trim * thrustScale;
      thrust = 130 * localW * this.thrustLocal;
    }
    this.inIrons = inIrons;
    this.localW = localW;

    this.v += (thrust - 1.05 * this.v) * dt;
    this.v = clamp(this.v, -16, 158);

    var authority = 0.25 + 0.75 * clamp(Math.abs(this.v) / 70, 0, 1);
    this.heading = angNorm(this.heading + steer * 2.1 * authority * dt);

    this.sheet = clamp(this.sheet + sheetRate * dt, 0, 1);

    this.x += Math.cos(this.heading) * this.v * dt;
    this.y += Math.sin(this.heading) * this.v * dt;

    /* soft banks: grinding the shallows slows you, it doesn't stop you */
    var m = 34;
    var scraped = false;
    if (this.x < WATER.x + m) {
      this.x = WATER.x + m;
      scraped = true;
    }
    if (this.x > WATER.x + WATER.w - m) {
      this.x = WATER.x + WATER.w - m;
      scraped = true;
    }
    if (this.y < WATER.y + m) {
      this.y = WATER.y + m;
      scraped = true;
    }
    if (this.y > WATER.y + WATER.h - m) {
      this.y = WATER.y + WATER.h - m;
      scraped = true;
    }
    if (scraped) this.v *= Math.max(0, 1 - 1.2 * dt);
    if (scraped && this.bumpT <= 0) {
      if (this.isPlayer && this.v > 45) sfx.bump();
      this.bumpT = 0.9;
    }
    if (this.bumpT > 0) this.bumpT -= dt;

    /* nudge off the marks */
    for (var key in MARKS) {
      var mk = MARKS[key];
      var d = dist(this.x, this.y, mk.x, mk.y);
      if (d < 34 && d > 0.01) {
        this.x += ((this.x - mk.x) / d) * (34 - d);
        this.y += ((this.y - mk.y) / d) * (34 - d);
      }
    }

    /* wake trail */
    this.wakeT -= dt;
    if (this.v > 40 && this.wakeT <= 0) {
      this.wakeT = 0.045;
      this.wake.push({ x: this.x, y: this.y, t: 1.15 });
      if (this.wake.length > 64) this.wake.shift();
    }
    for (var i = this.wake.length - 1; i >= 0; i--) {
      this.wake[i].t -= dt;
      if (this.wake[i].t <= 0) this.wake.splice(i, 1);
    }
  };

  Yacht.prototype.progress = function () {
    /* metres sailed along the course, for ranking + rubber-banding */
    var done = this.lap * LAP_LEN;
    for (var i = 0; i < this.cp; i++) done += LEGS[i];
    var c = COURSE[clamp(this.cp, 0, COURSE.length - 1)];
    var tx = c.kind === "mark" ? c.x : (c.ax + c.bx) / 2;
    var ty = c.kind === "mark" ? c.y : (c.ay + c.by) / 2;
    var startX = this.lastTx,
      startY = this.lastTy;
    if (startX === undefined) {
      startX = COMMITTEE.x;
      startY = (COMMITTEE.y + PIN.y) / 2;
    }
    var total = dist(startX, startY, tx, ty);
    var frac =
      total > 1 ? clamp(1 - dist(this.x, this.y, tx, ty) / total, 0, 1) : 1;
    return done + frac * LEGS[clamp(this.cp, 0, LEGS.length - 1)];
  };

  Yacht.prototype.checkpoint = function (clock) {
    if (this.finished) return;
    var c = COURSE[this.cp];
    var hit;
    if (c.kind === "mark") {
      hit = dist(this.x, this.y, c.x, c.y) < 68;
    } else {
      hit = segDist(this.x, this.y, c.ax, c.ay, c.bx, c.by) < 62;
    }
    if (!hit) return;
    this.cp++;
    if (this.isPlayer) sfx.bell();
    if (this.cp >= COURSE.length) {
      this.cp = 0;
      this.lap++;
      if (this.lap >= LAPS) {
        this.finished = true;
        this.finishTime = clock;
      }
    }
    this.lastTx = undefined;
  };

  /* One helm brain, shared by Old Bramble and the practice autopilot:
     aim for the next mark, tack when the course pinches, dodge the banks,
     and trim to the wind's eye automatically. */
  Yacht.prototype.helm = function (dt, thrustScale, wanderAmp) {
    var c = COURSE[this.cp];
    var tx = c.kind === "mark" ? c.x : (c.ax + c.bx) / 2;
    var ty = c.kind === "mark" ? c.y : (c.ay + c.by) / 2;
    var bearing = Math.atan2(ty - this.y, tx - this.x);
    var windFrom = wind.to + PI;

    /* wander like a human helm */
    bearing += wanderAmp * Math.sin(state.time * 0.7 + this.noisePh);

    /* keep off the banks (applied first; the no-go groove gets the last word) */
    var cx = WATER.x + WATER.w / 2,
      cy = WATER.y + WATER.h / 2;
    var edge = Math.min(
      this.x - WATER.x,
      WATER.x + WATER.w - this.x,
      this.y - WATER.y,
      WATER.y + WATER.h - this.y,
    );
    if (edge < 130) {
      var home = Math.atan2(cy - this.y, cx - this.x);
      var wgt = ((130 - edge) / 130) * 0.85;
      bearing = angNorm(bearing) + angNorm(home - bearing) * wgt;
    }

    /* watchdog: becalmed below the groove too long? bear away hard */
    if (this.v < 12 && this.awDeg < 42) {
      this.stuckT = (this.stuckT || 0) + dt;
    } else if (this.v > 26 || this.awDeg > 46) {
      this.stuckT = 0;
    }
    var rescued = this.stuckT > 4;

    /* Upwind work: hold ONE groove with hysteresis and tack at the
       layline (when the mark bears across to the far side of the eye).
       Sailing at the mark direct, or flip-flopping across the eye,
       is what becalmed every earlier helm against the north bank. */
    var off = angNorm(bearing - windFrom);
    var lim = ((NOGO + 12) * PI) / 180;
    var rel = ((NOGO + 30) * PI) / 180;

    if (rescued) {
      var rSide = angNorm(this.heading - windFrom) >= 0 ? 1 : -1;
      bearing = windFrom + (rSide * (NOGO + 24) * PI) / 180;
      this.grooveSide = rSide;
    } else if (Math.abs(off) >= rel) {
      this.grooveSide = 0; /* free: sail at it */
    } else {
      if (!this.grooveSide) {
        var curSide = angNorm(this.heading - windFrom) >= 0 ? 1 : -1;
        var wallHere = this.headHitsBank(windFrom + curSide * lim);
        if (wallHere) this.grooveSide = -curSide;
        else this.grooveSide = curSide;
      }
      /* layline: the mark now bears past the far groove - tack */
      if (this.grooveSide > 0 && off < -lim) this.grooveSide = -1;
      if (this.grooveSide < 0 && off > lim) this.grooveSide = 1;
      /* bank looms dead ahead in this groove? tack away from it */
      if (this.headHitsBank(windFrom + this.grooveSide * lim)) {
        this.grooveSide = -this.grooveSide;
      }
      bearing = windFrom + this.grooveSide * lim;
    }

    /* truly becalmed, bow in the eye? fall off until the sails fill.
       Deliberate tacks pass through with way on; pinching close-hauled
       is slow but honest - neither must trip this rescue. */
    if (this.v < 12 && this.awDeg < NOGO + 3) {
      var side = angNorm(this.heading - windFrom) >= 0 ? 1 : -1;
      bearing = windFrom + (side * (NOGO + 20) * PI) / 180;
    }

    var diff = angNorm(bearing - this.heading);
    var steer = clamp(diff * 3.2, -1, 1);
    this.sheet = clamp((idealDeg(this.awDeg) - 12) / 72, 0, 1);

    this.physics(dt, steer, 0, thrustScale);
  };

  Yacht.prototype.headHitsBank = function (hdg) {
    var look = 26 + this.v * 1.5;
    var px = this.x + Math.cos(hdg) * look;
    var py = this.y + Math.sin(hdg) * look;
    return (
      px < WATER.x + 60 ||
      px > WATER.x + WATER.w - 60 ||
      py < WATER.y + 60 ||
      py > WATER.y + WATER.h - 60
    );
  };

  /* Old Bramble's tiller hand: same brain, slightly gentler, with
     rubber-band mercy so a beginner race stays tense to the line */
  Yacht.prototype.ai = function (dt, playerProg) {
    var prog = this.progress();
    var rubber = clamp(1 + ((playerProg - prog) / 2400) * 0.12, 0.88, 1.12);
    this.helm(dt, 0.97 * rubber, 0.06);
  };

  /* ── state ───────────────────────────────────────────── */

  var state = {
    mode: "title", // title | count | race | done
    paused: false,
    time: 0, // race-clock seconds (sim time)
    countT: 0,
    player: null,
    rival: null,
    gustIn: false,
    gustCd: 0,
    gustLeaps: 0,
    result: null,
  };

  function resetRace() {
    if (!state.player) {
      state.player = new Yacht({
        isPlayer: true,
        hull: "#2e8f8f",
        sailCol: "#f6ead2",
        trimCol: "#1d5f5f",
      });
      state.rival = new Yacht({
        isPlayer: false,
        hull: "#a8443a",
        sailCol: "#efe0bd",
        trimCol: "#7c2f27",
      });
    } else {
      state.player.reset();
      state.rival.reset();
    }
    state.player.lastTx = undefined;
    state.rival.lastTx = undefined;
    state.time = 0;
    state.countT = 3.6;
    state.paused = false;
    state.gustIn = false;
    state.gustCd = 0;
    state.gustLeaps = 0;
    state.wentGo = false;
    state.result = null;
    windReset(0);
    hide(ovResult);
    hide(ovPause);
    hide(ovTitle);
  }

  function beginRace() {
    resetRace();
    state.mode = "count";
    show(ovCount);
    countNum.textContent = "3";
  }

  function hide(el) {
    el.classList.add("hidden");
  }
  function show(el) {
    el.classList.remove("hidden");
  }

  function fmtClock(s) {
    s = Math.max(0, s);
    var m = Math.floor(s / 60);
    var sec = s - m * 60;
    return m + ":" + (sec < 10 ? "0" : "") + sec.toFixed(1);
  }

  function fmtResult(s) {
    var m = Math.floor(s / 60);
    var sec = s - m * 60;
    return m + ":" + (sec < 10 ? "0" : "") + sec.toFixed(2);
  }

  /* ── results ─────────────────────────────────────────── */

  function finishRace() {
    state.mode = "done";
    var p = state.player,
      r = state.rival;
    var pTime = p.finishTime;
    var rTime = r.finished ? r.finishTime : state.time + estRemain(r);
    var won = !r.finished || pTime <= rTime;
    var margin = Math.abs(pTime - rTime);

    var head = $("resHead"),
      line = $("resLine"),
      stars = $("resStars");
    var starN;
    if (won) {
      starN = margin >= 10 || pTime <= 78 ? 3 : 2;
      head.textContent = "YOU TAKE THE TIN";
      line.innerHTML = "Old Bramble tips his cap. The pigeons approve.";
      sfx.win();
    } else {
      starN = 1;
      head.textContent = "BRAMBLE TAKES IT";
      line.innerHTML =
        "&ldquo;Nice breeze today,&rdquo; he says, kindly. Ouch.";
      sfx.lose();
    }

    var html = "";
    for (var i = 0; i < 3; i++) {
      html += i < starN ? "&#10022;" : "<span class='dim'>&#10022;</span>";
    }
    stars.innerHTML = html;

    $("resTime").textContent = fmtResult(pTime);
    $("resRival").textContent = fmtResult(rTime);
    $("resMargin").textContent =
      (pTime <= rTime ? "+" : "\u2212") + margin.toFixed(1) + "s";
    $("resGusts").textContent = String(state.gustLeaps);
    show(ovResult);
  }

  /* rough projection if Bramble hasn't finished yet (you lost ground badly) */
  function estRemain(y) {
    var remain = (LAPS - 1 - y.lap) * LAP_LEN + LEGS[y.cp];
    return remain / 100;
  }

  /* ── input ───────────────────────────────────────────── */

  var keys = {};
  var padLeft = false,
    padRight = false,
    padIn = false,
    padOut = false;
  var drag = null; // {x0, y0, sheet0}

  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === "ArrowUp" ||
      k === "ArrowDown" ||
      k === " "
    )
      e.preventDefault();
    if (keys[k]) return;
    keys[k] = true;
    audioInit();

    if (state.mode === "title" && (k === "Enter" || k === " ")) {
      beginRace();
      return;
    }
    if (state.mode === "done" && (k === "Enter" || k === " ")) {
      beginRace();
      return;
    }
    if (k === "p" || k === "P") togglePause();
    if ((k === "r" || k === "R") && state.mode !== "title") beginRace();
    if (k === "m" || k === "M") setMuted(!muted);
  });

  window.addEventListener("keyup", function (e) {
    keys[e.key] = false;
  });

  function bindPad(btn, set) {
    btn.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      audioInit();
      set(true);
      btn.classList.add("held");
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ok */
      }
    });
    function off() {
      set(false);
      btn.classList.remove("held");
    }
    btn.addEventListener("pointerup", off);
    btn.addEventListener("pointercancel", off);
    btn.addEventListener("lostpointercapture", off);
  }
  bindPad(padPort, function (v) {
    padLeft = v;
  });
  bindPad(padStbd, function (v) {
    padRight = v;
  });
  bindPad(padTrim, function (v) {
    padIn = v;
  });
  bindPad(padEase, function (v) {
    padOut = v;
  });

  /* drag on the water: sideways steers, up/down trims */
  cvs.addEventListener("pointerdown", function (e) {
    audioInit();
    if (state.mode !== "race" || state.paused) return;
    var r = cvs.getBoundingClientRect();
    drag = {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      sheet0: state.player.sheet,
    };
    try {
      cvs.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ok */
    }
  });
  cvs.addEventListener("pointermove", function (e) {
    if (!drag || state.mode !== "race" || state.paused) return;
    var r = cvs.getBoundingClientRect();
    var sc = WORLD_W / r.width;
    var dx = (e.clientX - r.left - drag.x) * sc;
    var dy = (e.clientY - r.top - drag.y) * sc;
    drag.steer = clamp(dx / 130, -1, 1);
    state.player.sheet = clamp(drag.sheet0 + dy / 320, 0, 1);
  });
  function dragOff() {
    drag = null;
  }
  cvs.addEventListener("pointerup", dragOff);
  cvs.addEventListener("pointercancel", dragOff);

  $("stage").addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  btnStart.addEventListener("click", function () {
    audioInit();
    beginRace();
  });
  btnAgain.addEventListener("click", function () {
    beginRace();
  });
  btnResume.addEventListener("click", function () {
    togglePause();
  });
  btnRestart.addEventListener("click", function () {
    beginRace();
  });
  btnRestart2.addEventListener("click", function () {
    beginRace();
  });
  btnPause.addEventListener("click", function () {
    togglePause();
  });
  btnMute.addEventListener("click", function () {
    audioInit();
    setMuted(!muted);
  });

  function togglePause() {
    if (state.mode !== "race" && !(state.mode === "count")) return;
    state.paused = !state.paused;
    if (state.paused) show(ovPause);
    else hide(ovPause);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if ((state.mode === "race" || state.mode === "count") && !state.paused)
        togglePause();
      if (AU) {
        try {
          AU.ac.suspend();
        } catch (e) {
          /* ignore */
        }
      }
    } else {
      if (AU) {
        try {
          AU.ac.resume();
        } catch (e) {
          /* ignore */
        }
      }
    }
  });

  /* ── simulation step ─────────────────────────────────── */

  function step(dt) {
    var p = state.player,
      r = state.rival;

    if (state.mode === "count") {
      var prev = Math.ceil(state.countT);
      state.countT -= dt;
      var now = Math.ceil(state.countT);
      if (now !== prev && now > 0) {
        countNum.textContent = String(now);
        sfx.tick();
      }
      if (state.countT <= 0.6 && prev >= 1) {
        countNum.textContent = "GO!";
        if (!state.wentGo) {
          sfx.go();
          state.wentGo = true;
        }
      }
      if (state.countT <= 0) {
        state.mode = "race";
        hide(ovCount);
        state.wentGo = false;
      }
      /* boats sit at the line during the countdown */
      return;
    }

    if (state.mode !== "race") return;

    state.time += dt;

    /* player inputs */
    var steer = 0;
    if (keys["ArrowLeft"] || keys["a"] || keys["A"] || padLeft) steer -= 1;
    if (keys["ArrowRight"] || keys["d"] || keys["D"] || padRight) steer += 1;
    if (drag && drag.steer) steer = clamp(steer + drag.steer, -1, 1);

    if (state.autopilot) {
      p.helm(dt, 1, 0.02);
    } else {
      var sheetRate = 0;
      if (keys["ArrowUp"] || keys["w"] || keys["W"] || padIn) sheetRate += 0.85;
      if (keys["ArrowDown"] || keys["s"] || keys["S"] || padOut)
        sheetRate -= 0.85;

      p.physics(dt, steer, sheetRate, 1);
    }
    p.checkpoint(state.time);

    r.ai(dt, p.progress());
    r.checkpoint(state.time);

    /* boat-and-boat courtesy */
    var d = dist(p.x, p.y, r.x, r.y);
    if (d < 46 && d > 0.01) {
      var push = (46 - d) / 2;
      p.x += ((p.x - r.x) / d) * push;
      p.y += ((p.y - r.y) / d) * push;
      r.x -= ((r.x - p.x) / d) * push;
      r.y -= ((r.y - p.y) / d) * push;
      p.v *= 0.96;
      r.v *= 0.96;
    }

    /* gust leaps: crossing into heavier air at speed */
    state.gustCd -= dt;
    var inGust = false;
    for (var i = 0; i < wind.gx.length; i++) {
      if (dist(p.x, p.y, wind.gx[i].x, wind.gx[i].y) < wind.gx[i].r) {
        inGust = true;
        break;
      }
    }
    if (inGust && !state.gustIn && state.gustCd <= 0 && p.v > 95) {
      state.gustLeaps++;
      state.gustCd = 2.5;
      tone(880, 0.14, "sine", 0.08);
    }
    state.gustIn = inGust;

    if (p.finished) finishRace();
    else if (r.finished && !r.resultLogged) {
      r.resultLogged = true;
      /* Bramble is in: the race is now against the clock he set */
      tone(392, 0.25, "triangle", 0.1);
    }
  }

  /* ── drawing ─────────────────────────────────────────── */

  var view = { s: 1, ox: 0, oy: 0 };

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cvs.clientWidth,
      h = cvs.clientHeight;
    if (!w || !h) return;
    cvs.width = Math.round(w * dpr);
    cvs.height = Math.round(h * dpr);
    var s = Math.min(cvs.width / WORLD_W, cvs.height / WORLD_H);
    view.s = s;
    view.ox = (cvs.width - WORLD_W * s) / 2;
    view.oy = (cvs.height - WORLD_H * s) / 2;
  }
  window.addEventListener("resize", resize);

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function draw(now) {
    resizeIfNeeded();
    var c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#101c26";
    c.fillRect(0, 0, cvs.width, cvs.height);

    c.save();
    c.translate(view.ox, view.oy);
    c.scale(view.s, view.s);

    /* banks */
    var grass = c.createLinearGradient(0, 0, 0, WORLD_H);
    grass.addColorStop(0, "#31503a");
    grass.addColorStop(1, "#24392b");
    c.fillStyle = grass;
    roundRect(c, 0, 0, WORLD_W, WORLD_H, 46);
    c.fill();

    /* mown stripes */
    c.save();
    roundRect(c, 0, 0, WORLD_W, WORLD_H, 46);
    c.clip();
    c.globalAlpha = 0.05;
    c.fillStyle = "#0e1a12";
    for (var i = 0; i < 10; i += 2) {
      c.fillRect(0, (i * WORLD_H) / 10, WORLD_W, WORLD_H / 10);
    }
    c.globalAlpha = 1;
    c.restore();

    /* trees + bandstand silhouettes on the bank corners */
    drawBankLife(c);

    /* pond */
    c.save();
    roundRect(c, WATER.x, WATER.y, WATER.w, WATER.h, 60);
    c.clip();

    var wat = c.createLinearGradient(
      WATER.x,
      WATER.y,
      WATER.x + WATER.w,
      WATER.y + WATER.h,
    );
    wat.addColorStop(0, "#173f52");
    wat.addColorStop(0.5, "#123447");
    wat.addColorStop(1, "#0e2a3a");
    c.fillStyle = wat;
    c.fillRect(WATER.x, WATER.y, WATER.w, WATER.h);

    drawShimmer(c);
    drawGusts(c);
    drawWindStreaks(c);
    drawCourse(c);
    drawWakes(c, state.rival);
    drawWakes(c, state.player);
    drawYacht(c, state.rival, now);
    drawYacht(c, state.player, now);
    drawBeacon(c);

    c.restore(); /* pond clip */

    c.restore(); /* world */
  }

  var lastW = 0,
    lastH = 0;
  function resizeIfNeeded() {
    if (cvs.clientWidth !== lastW || cvs.clientHeight !== lastH) {
      lastW = cvs.clientWidth;
      lastH = cvs.clientHeight;
      resize();
    }
  }

  function drawBankLife(c) {
    /* poplar silhouettes around the rim */
    c.fillStyle = "#1a2c20";
    var spots = [
      [70, 40],
      [150, 26],
      [230, 44],
      [1380, 30],
      [1470, 48],
      [40, 900],
      [120, 930],
      [1440, 900],
      [1520, 880],
    ];
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      c.beginPath();
      c.ellipse(s[0], s[1], 26, 40, 0, 0, TAU);
      c.fill();
    }
    /* little bandstand, top-right corner */
    c.strokeStyle = "#16241c";
    c.lineWidth = 8;
    c.beginPath();
    c.moveTo(1540, 120);
    c.lineTo(1540, 60);
    c.stroke();
    c.beginPath();
    c.moveTo(1495, 78);
    c.quadraticCurveTo(1540, 30, 1585, 78);
    c.closePath();
    c.fillStyle = "#16241c";
    c.fill();
  }

  function drawShimmer(c) {
    var t = state.time;
    c.save();
    c.globalAlpha = 0.06;
    c.strokeStyle = "#cfe8ef";
    c.lineWidth = 2;
    var rows = 13;
    for (var i = 0; i < rows; i++) {
      var y =
        WATER.y +
        ((i + 0.5) * WATER.h) / rows +
        Math.sin(t * 0.7 + i * 1.7) * 7;
      c.beginPath();
      var dir = i % 2 ? 1 : -1;
      for (var x = WATER.x; x < WATER.x + WATER.w; x += 46) {
        var yy = y + Math.sin(x * 0.02 + t * (1.1 + dir * 0.3) + i) * 4;
        if (x === WATER.x) c.moveTo(x, yy);
        else c.lineTo(x, yy);
      }
      c.stroke();
    }
    c.restore();
  }

  function drawGusts(c) {
    for (var i = 0; i < wind.gx.length; i++) {
      var g = wind.gx[i];
      var grad = c.createRadialGradient(g.x, g.y, g.r * 0.1, g.x, g.y, g.r);
      grad.addColorStop(0, "rgba(6,20,30,0.34)");
      grad.addColorStop(1, "rgba(6,20,30,0)");
      c.fillStyle = grad;
      c.beginPath();
      c.ellipse(g.x, g.y, g.r, g.r * 0.78, 0, 0, TAU);
      c.fill();
      /* sparkle */
      c.globalAlpha = 0.16;
      c.strokeStyle = "#bfe3ee";
      c.lineWidth = 1.6;
      c.beginPath();
      c.ellipse(g.x, g.y, g.r * 0.62, g.r * 0.44, 0, 0, TAU);
      c.stroke();
      c.globalAlpha = 1;
    }
  }

  function drawWindStreaks(c) {
    c.strokeStyle = "rgba(207,232,239,0.16)";
    c.lineWidth = 2.4;
    var sx = Math.cos(wind.to),
      sy = Math.sin(wind.to);
    c.beginPath();
    for (var i = 0; i < wind.streaks.length; i++) {
      var s = wind.streaks[i];
      c.moveTo(s.x, s.y);
      c.lineTo(s.x + sx * 26, s.y + sy * 26);
    }
    c.stroke();
  }

  function drawCourse(c) {
    /* dashed route through the marks */
    c.save();
    c.setLineDash([14, 18]);
    c.lineDashOffset = -(state.time * 26) % 32;
    c.strokeStyle = "rgba(232,182,76,0.20)";
    c.lineWidth = 3;
    c.beginPath();
    var mx = (COMMITTEE.x + PIN.x) / 2,
      my = (COMMITTEE.y + PIN.y) / 2;
    c.moveTo(mx, my);
    c.lineTo(MARKS.m1.x, MARKS.m1.y);
    c.lineTo(MARKS.m2.x, MARKS.m2.y);
    c.lineTo(MARKS.m3.x, MARKS.m3.y);
    c.closePath();
    c.stroke();
    c.restore();

    /* start / finish line */
    c.strokeStyle = "rgba(246,234,210,0.5)";
    c.lineWidth = 4;
    c.setLineDash([10, 10]);
    c.beginPath();
    c.moveTo(COMMITTEE.x, COMMITTEE.y);
    c.lineTo(PIN.x, PIN.y);
    c.stroke();
    c.setLineDash([]);
    drawMarkBoat(c, COMMITTEE.x, COMMITTEE.y, "#f6ead2");
    drawMarkBoat(c, PIN.x, PIN.y, "#f6ead2");

    /* cans */
    drawCan(c, MARKS.m1, now);
    drawCan(c, MARKS.m2, now);
    drawCan(c, MARKS.m3, now);
  }

  var now = 0; /* shared render clock for bobbing */

  function drawCan(c, m, t) {
    var bob = Math.sin(t * 1.6 + m.x) * 3;
    c.fillStyle = "rgba(0,0,0,0.25)";
    c.beginPath();
    c.ellipse(m.x + 4, m.y + 8, 16, 7, 0, 0, TAU);
    c.fill();
    c.fillStyle = m.color;
    c.beginPath();
    c.moveTo(m.x - 13, m.y + bob + 10);
    c.quadraticCurveTo(m.x, m.y + bob + 16, m.x + 13, m.y + bob + 10);
    c.lineTo(m.x + 8, m.y + bob - 12);
    c.lineTo(m.x - 8, m.y + bob - 12);
    c.closePath();
    c.fill();
    /* little flag */
    c.strokeStyle = "#20303c";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(m.x, m.y + bob - 12);
    c.lineTo(m.x, m.y + bob - 34);
    c.stroke();
    c.fillStyle = m.color;
    c.beginPath();
    c.moveTo(m.x, m.y + bob - 34);
    var fl = Math.sin(t * 3 + m.y) * 3;
    c.quadraticCurveTo(m.x + 10, m.y + bob - 31 + fl, m.x + 17, m.y + bob - 28);
    c.lineTo(m.x, m.y + bob - 24);
    c.closePath();
    c.fill();
  }

  function drawMarkBoat(c, x, y, col) {
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(x - 16, y);
    c.quadraticCurveTo(x, y - 9, x + 16, y);
    c.quadraticCurveTo(x, y + 8, x - 16, y);
    c.fill();
  }

  function drawWakes(c, y) {
    for (var i = 0; i < y.wake.length; i++) {
      var w = y.wake[i];
      c.globalAlpha = (w.t / 1.15) * 0.22;
      c.fillStyle = "#dff0f5";
      c.beginPath();
      c.arc(w.x, w.y, 5 + (1.15 - w.t) * 9, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;
  }

  function drawYacht(c, y, t) {
    var sh = Math.sin(y.heading);
    var ch = Math.cos(y.heading);

    c.save();
    c.translate(y.x, y.y);

    /* shadow */
    c.rotate(y.heading + PI / 2);
    c.fillStyle = "rgba(0,0,0,0.3)";
    c.beginPath();
    c.ellipse(6, 4, 15, 30, 0, 0, TAU);
    c.fill();
    c.rotate(-(y.heading + PI / 2));

    /* hull: pointed bow forward (+heading), flat stern */
    c.save();
    c.rotate(y.heading);
    var hg = c.createLinearGradient(-20, 0, 24, 0);
    hg.addColorStop(0, shade(y.hull, -0.25));
    hg.addColorStop(0.55, y.hull);
    hg.addColorStop(1, shade(y.hull, -0.35));
    c.fillStyle = hg;
    c.beginPath();
    c.moveTo(26, 0);
    c.quadraticCurveTo(10, -13, -16, -11);
    c.quadraticCurveTo(-22, -9, -22, 0);
    c.quadraticCurveTo(-22, 9, -16, 11);
    c.quadraticCurveTo(10, 13, 26, 0);
    c.fill();
    /* gunwale */
    c.strokeStyle = "rgba(255,255,255,0.35)";
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(24, 0);
    c.quadraticCurveTo(9, -11, -16, -9);
    c.moveTo(24, 0);
    c.quadraticCurveTo(9, 11, -16, 9);
    c.stroke();
    /* cockpit */
    c.fillStyle = "rgba(20,30,38,0.85)";
    c.beginPath();
    c.ellipse(-4, 0, 8, 4.5, 0, 0, TAU);
    c.fill();
    c.restore();

    /* rig: mast a third back from the bow; main sweeps aft */
    var mastX = -ch * 8,
      mastY = -sh * 8;
    var windFrom = wind.to + PI;
    /* which side is the boom on? leeward side, decided by tack */
    var tackSign = angNorm(y.heading - windFrom) > 0 ? 1 : -1;
    var effA =
      ((y.inIrons ? 70 + Math.sin(y.flap) * 26 : effDeg(y.sheet)) * PI) / 180;
    var boomAng = y.heading + tackSign * (PI - effA);
    var boomLen = 30;
    var clewX = mastX + Math.cos(boomAng) * boomLen;
    var clewY = mastY + Math.sin(boomAng) * boomLen;

    /* mainsail */
    var belly = y.inIrons ? 2 : 7 + 5 * y.thrustLocal;
    c.fillStyle = y.sailCol;
    c.globalAlpha = 0.94;
    c.beginPath();
    c.moveTo(mastX, mastY);
    var midX = (mastX + clewX) / 2,
      midY = (mastY + clewY) / 2;
    var nx = -(clewY - mastY),
      ny = clewX - mastX;
    var nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    var flapWob = y.inIrons ? Math.sin(y.flap * 1.7) * 5 : 0;
    c.quadraticCurveTo(
      midX + nx * belly + nx * flapWob,
      midY + ny * belly + ny * flapWob,
      clewX,
      clewY,
    );
    c.quadraticCurveTo(
      midX - nx * 3,
      midY - ny * 3,
      mastX + ch * 2,
      mastY + sh * 2,
    );
    c.closePath();
    c.fill();
    c.globalAlpha = 1;

    /* jib, forward of the mast */
    var jibA = y.heading - tackSign * 0.36;
    var jibX = mastX + Math.cos(jibA) * 20;
    var jibY = mastY + Math.sin(jibA) * 20;
    var bowX = ch * 24,
      bowY = sh * 24;
    c.globalAlpha = 0.8;
    c.fillStyle = y.sailCol;
    c.beginPath();
    c.moveTo(bowX, bowY);
    c.lineTo(jibX, jibY);
    c.lineTo(mastX + ch * 4, mastY + sh * 4);
    c.closePath();
    c.fill();
    c.globalAlpha = 1;

    /* masthead pennant streams downwind — reads the wind for you */
    var penX = mastX + Math.cos(wind.to) * 15;
    var penY = mastY + Math.sin(wind.to) * 15;
    c.strokeStyle = y.isPlayer ? "#ffd97a" : "#f0b6ad";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(mastX, mastY);
    c.quadraticCurveTo((mastX + penX) / 2 + 3, (mastY + penY) / 2, penX, penY);
    c.stroke();

    /* telltale: green when trimmed right, amber when off */
    if (y.isPlayer) {
      c.fillStyle = y.trimGood ? "#9fe8a8" : "#e8b64c";
      c.beginPath();
      c.arc(clewX, clewY, 3.4, 0, TAU);
      c.fill();
    }

    /* in-irons warning */
    if (y.inIrons && y.isPlayer) {
      c.fillStyle = "rgba(255,120,100," + (0.55 + 0.45 * Math.sin(t * 9)) + ")";
      c.font = "700 24px 'Trebuchet MS', sans-serif";
      c.textAlign = "center";
      c.fillText("IN IRONS", 0, -44);
    }

    c.restore();
  }

  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = clamp(((n >> 16) & 255) * (1 + amt), 0, 255);
    var g = clamp(((n >> 8) & 255) * (1 + amt), 0, 255);
    var b = clamp((n & 255) * (1 + amt), 0, 255);
    return (
      "rgb(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(b) + ")"
    );
  }

  function drawBeacon(c) {
    if (state.mode !== "race" || state.player.finished) return;
    var p = state.player;
    var tgt = COURSE[p.cp];
    var bx = tgt.kind === "mark" ? tgt.x : (tgt.ax + tgt.bx) / 2;
    var by = tgt.kind === "mark" ? tgt.y : (tgt.ay + tgt.by) / 2;
    var pulse = 1 + 0.12 * Math.sin(state.time * 5);
    c.strokeStyle = "rgba(232,182,76,0.65)";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(bx, by, 46 * pulse, 0, TAU);
    c.stroke();
    c.globalAlpha = 0.35;
    c.beginPath();
    c.arc(bx, by, 60 * pulse, 0, TAU);
    c.stroke();
    c.globalAlpha = 1;

    /* floating arrow above the player */
    var ang = Math.atan2(by - p.y, bx - p.x);
    c.save();
    c.translate(p.x + Math.cos(ang) * 52, p.y + Math.sin(ang) * 52);
    c.rotate(ang);
    c.fillStyle = "#e8b64c";
    c.beginPath();
    c.moveTo(10, 0);
    c.lineTo(-7, -7);
    c.lineTo(-3, 0);
    c.lineTo(-7, 7);
    c.closePath();
    c.fill();
    c.restore();
  }

  /* ── hud ─────────────────────────────────────────────── */

  var hudT = 0;

  function updateHud(dt) {
    hudT -= dt;
    if (hudT > 0) return;
    hudT = 0.1;
    var p = state.player,
      r = state.rival;
    if (!p) return;

    var pp = p.progress(),
      rp = r.progress();
    var leading = pp >= rp;
    hudPos.textContent = leading ? "1st" : "2nd";
    hudPos.classList.toggle("behind", !leading);

    hudLap.textContent = "LAP " + Math.min(p.lap + 1, LAPS) + "/" + LAPS;
    hudClock.textContent = fmtClock(state.time);

    var ed = effDeg(p.sheet),
      idl = idealDeg(p.awDeg);
    sheetFill.style.width = Math.round(p.sheet * 100) + "%";
    sheetFill.classList.toggle("good", Math.abs(ed - idl) < 9);

    /* needle points the way the wind travels (svg up-tip + clockwise deg) */
    var deg = (wind.to * 180) / PI + 90;
    roseN.setAttribute("transform", "rotate(" + deg.toFixed(1) + " 50 50)");
  }

  /* ── main loop ───────────────────────────────────────── */

  var lastTs = 0;
  var ambTime = 0;

  function frame(ts) {
    requestAnimationFrame(frame);
    var dt = Math.min((ts - lastTs) / 1000 || 0.016, 0.05);
    lastTs = ts;

    if (!state.paused) {
      now = ts / 1000;
      ambTime += dt;
      windUpdate(ambTime, dt);
      if (state.mode === "race" || state.mode === "count") step(dt);
      if (state.player) {
        updateHud(dt);
        audioFrame(state.player.v, state.player.localW || 1);
      }
    }
    draw(now);
  }

  /* tiny debug seam for automated playtests */
  window.__kw = {
    state: function () {
      return state.mode;
    },
    time: function () {
      return state.time;
    },
    player: function () {
      var p = state.player;
      if (!p) return null;
      return {
        x: Math.round(p.x),
        y: Math.round(p.y),
        v: Math.round(p.v),
        hdgDeg: Math.round((p.heading * 180) / PI),
        windFromDeg: Math.round((((wind.to + PI) * 180) / PI) % 360),
        awDeg: Math.round(p.awDeg),
        sheet: +p.sheet.toFixed(2),
        lap: p.lap,
        cp: p.cp,
        rivalLap: state.rival.lap,
        rivalCp: state.rival.cp,
        finished: p.finished,
        rivalFinished: state.rival.finished,
      };
    },
    begin: function () {
      beginRace();
    },
    auto: function (on) {
      state.autopilot = !!on;
    },
    fastForward: function (secs) {
      var n = Math.round(secs * 20);
      for (var i = 0; i < n; i++) step(0.05);
    },
    finishNow: function () {
      var p = state.player;
      p.lap = LAPS - 1;
      p.cp = COURSE.length - 1;
      p.x = (COMMITTEE.x + PIN.x) / 2 + 30;
      p.y = (COMMITTEE.y + PIN.y) / 2;
      p.checkpoint(state.time);
    },
  };

  /* ── boot ────────────────────────────────────────────── */

  setMuted(false);
  resetRace();
  state.mode = "title";
  show(ovTitle);
  hide(ovCount);
  hide(ovPause);
  hide(ovResult);
  resize();
  requestAnimationFrame(frame);
})();
