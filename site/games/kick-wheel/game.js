/* Kick Wheel — throw five commissioned vessels on a lamplit potter's wheel.
   Everything lives in this one classic script, wrapped in an IIFE. */
(function () {
  "use strict";

  /* ── dom ─────────────────────────────────────────────── */

  var cvs = document.getElementById("wheel");
  var ctx = cvs.getContext("2d");

  var hudCommission = document.getElementById("hudCommission");
  var hudClock = document.getElementById("hudClock");
  var hudLumps = document.getElementById("hudLumps");
  var hudScore = document.getElementById("hudScore");

  var startOverlay = document.getElementById("startOverlay");
  var pieceOverlay = document.getElementById("pieceOverlay");
  var endOverlay = document.getElementById("endOverlay");
  var pauseOverlay = document.getElementById("pauseOverlay");

  var pieceTitle = document.getElementById("pieceTitle");
  var pieceStars = document.getElementById("pieceStars");
  var pieceDetail = document.getElementById("pieceDetail");
  var pieceNext = document.getElementById("pieceNext");
  var endTitle = document.getElementById("endTitle");
  var endDetail = document.getElementById("endDetail");
  var endScore = document.getElementById("endScore");

  var startBtn = document.getElementById("startBtn");
  var nextBtn = document.getElementById("nextBtn");
  var againBtn = document.getElementById("againBtn");
  var resumeBtn = document.getElementById("resumeBtn");
  var pauseBtn = document.getElementById("pauseBtn");
  var soundBtn = document.getElementById("soundBtn");
  var restartBtn = document.getElementById("restartBtn");

  /* ── geometry constants ──────────────────────────────── */

  var VW = 920;
  var VH = 660;
  var DH = 6; /* px per profile slot          */
  var K = 64; /* slots from base to sky       */
  var MAXH = K * DH; /* 384 px of clay possible      */
  var AXIS_X = 372;
  var BASE_Y = 568;

  var MIN_WALL = 14; /* thinner than this tears      */
  var SOFT_WALL = 34; /* greener than this is ideal   */
  var HEAVY_WALL = 46; /* heavier than this caps stars */
  var TOL = 13; /* blueprint tolerance, px      */

  var FIRE_RECT = { x: 656, y: 566, w: 208, h: 66 };

  /* ── commissions ─────────────────────────────────────── */
  /* anchors: [height from base (px), outer radius (px)]    */

  var COMMS = [
    {
      name: "Flower Pot",
      note: "A forgiving taper to warm up on.",
      base: 120,
      anchors: [
        [0, 60],
        [20, 70],
        [80, 100],
        [140, 112],
        [186, 122],
      ],
    },
    {
      name: "Wide Bowl",
      note: "Low and broad — mind the rim.",
      base: 145,
      anchors: [
        [0, 56],
        [18, 82],
        [60, 124],
        [110, 142],
        [148, 148],
      ],
    },
    {
      name: "Shoulder Vase",
      note: "Up to a proud shoulder, then in at the neck.",
      base: 175,
      anchors: [
        [0, 52],
        [26, 74],
        [110, 116],
        [190, 98],
        [228, 56],
        [248, 62],
      ],
    },
    {
      name: "Amphora",
      note: "Foot, belly, whip-thin neck, flared lip.",
      base: 215,
      anchors: [
        [0, 44],
        [16, 62],
        [84, 106],
        [168, 88],
        [206, 48],
        [224, 44],
        [250, 70],
      ],
    },
    {
      name: "Long-Neck Jug",
      note: "The masterwork. Belly deep, neck long.",
      base: 260,
      anchors: [
        [0, 48],
        [24, 90],
        [100, 114],
        [176, 72],
        [216, 54],
        [272, 50],
        [298, 60],
      ],
    },
  ];

  /* ── mutable game state ──────────────────────────────── */

  var mode = "title"; /* title | shape | fired | done */
  var runId = 0; /* guards stale collapse timers */
  var commIdx = 0; /* current commission index     */

  var clock = 0;

  var lumps = 3;
  var till = 0;
  var soldCount = 0;
  var paused = false;

  var outer = new Array(K);
  var inner = new Array(K);
  var bpR = new Array(K);
  var H = 0; /* current rim height, px     */
  var blankR0 = 120;
  var bpTop = 0; /* blueprint top slot         */
  var maxHAllowed = 0;

  var toolY = BASE_Y - 60;
  var press = 0; /* smoothed press strength    */
  var pressing = false;
  var centring = false;
  var wobble = 0;
  var spin = 0;
  var collapseT = 0;
  var bpFlash = 0;
  var matchAcc = 0;
  var matchTimer = 0;
  var hoverFire = false;
  var pointerDown = false;

  var toasts = [];
  var keys = {};

  /* ── audio (all synthesised) ─────────────────────────── */

  var ac = null;
  var master = null;
  var humGain = null;
  var mudGain = null;
  var muted = false;
  var noiseBuf = null;

  function ensureAudio() {
    if (ac) {
      if (ac.state === "suspended") ac.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(ac.destination);

    var len = Math.floor(ac.sampleRate * 1.2);
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    var d = noiseBuf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }

    /* wheel hum: two detuned lows through a lowpass */
    humGain = ac.createGain();
    humGain.gain.value = 0.0;
    var lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 160;
    humGain.connect(lp);
    lp.connect(master);
    [46, 46.7].forEach(function (f) {
      var o = ac.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      o.connect(humGain);
      o.start();
    });

    /* wet-clay slop: looped noise through a bandpass */
    mudGain = ac.createGain();
    mudGain.gain.value = 0;
    var bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 320;
    bp.Q.value = 0.8;
    var src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.connect(bp);
    bp.connect(mudGain);
    mudGain.connect(master);
    src.start();
  }

  function blip(freq, dur, type, vol, slideTo) {
    if (!ac || muted) return;
    var t = ac.currentTime;
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noiseBurst(dur, freq, vol, type) {
    if (!ac || muted) return;
    var t = ac.currentTime;
    var s = ac.createBufferSource();
    s.buffer = noiseBuf;
    var f = ac.createBiquadFilter();
    f.type = type || "bandpass";
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(
      Math.max(60, freq * 0.25),
      t + dur,
    );
    var g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  function chime(good) {
    if (!ac || muted) return;
    var seq = good ? [523, 659, 784, 1046] : [392, 330];
    seq.forEach(function (f, i) {
      setTimeout(function () {
        blip(f, 0.5, "sine", 0.16);
      }, i * 95);
    });
  }

  /* ── small helpers ───────────────────────────────────── */

  function toast(text, tone) {
    toasts.push({ text: text, tone: tone || "#f4e5cd", t: 2.6 });
    if (toasts.length > 3) toasts.shift();
  }

  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /* ── commission setup ────────────────────────────────── */

  function interpAnchors(anchors, y) {
    if (y <= anchors[0][0]) return anchors[0][1];
    for (var i = 1; i < anchors.length; i++) {
      if (y <= anchors[i][0]) {
        var a = anchors[i - 1],
          b = anchors[i];
        var f = (y - a[0]) / (b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * f;
      }
    }
    return anchors[anchors.length - 1][1];
  }

  function buildComm(idx) {
    var c = COMMS[idx];
    var top = c.anchors[c.anchors.length - 1][0];
    var maxR = 0;
    for (var a = 0; a < c.anchors.length; a++) {
      maxR = Math.max(maxR, c.anchors[a][1]);
    }
    blankR0 = maxR + 14;
    bpTop = Math.round(top / DH);
    maxHAllowed = Math.min(MAXH, top + 26);

    for (var s = 0; s < K; s++) bpR[s] = interpAnchors(c.anchors, s * DH);

    var blankTop = Math.max(6, Math.round((top * 0.62) / DH));
    H = blankTop * DH;
    var holeR = 24;
    var cavBottom = Math.round(blankTop * 0.45);

    for (var j = 0; j < K; j++) {
      outer[j] = j <= blankTop ? blankR0 : 0;
      inner[j] = 0;
    }
    outer[blankTop] *= 0.92; /* gentle dome on the blank */

    for (var q = blankTop - 1; q >= cavBottom; q--) {
      var fade = clamp((q - cavBottom) / 4, 0, 1);
      inner[q] = holeR * fade;
    }

    toolY = BASE_Y - H * 0.7;
    press = 0;
    wobble = 0;
    collapseT = 0;
    bpFlash = 1.6;
    matchAcc = 0;

    hudCommission.textContent = idx + 1 + "/5 \u00b7 " + c.name;
    toast("Commission " + (idx + 1) + " of 5 \u2014 the " + c.name, "#e8a34c");
  }

  /* ── scoring ─────────────────────────────────────────── */

  function computeMatch() {
    var rim = clamp(Math.floor(H / DH), 1, K - 1);
    var sum = 0,
      n = 0;
    var best = 2,
      worst = bpTop;
    for (var s = 2; s <= bpTop; s++) {
      if (bpR[s] > bpR[best]) best = s;
      if (bpR[s] < bpR[worst]) worst = s;
    }
    for (var t = 2; t <= bpTop; t += 4) {
      sum += anchorErr(t, rim);
      n++;
    }
    [best, worst].forEach(function (s) {
      sum += anchorErr(s, rim);
      n++;
    });
    var acc = n ? (sum / n) * 100 : 0;

    var wallSum = 0,
      wn = 0;
    var from = Math.max(3, Math.floor(rim * 0.15));
    for (var u = from; u < rim - 1; u++) {
      if (inner[u] > 2) {
        wallSum += outer[u] - inner[u];
        wn++;
      }
    }
    return { acc: acc, avgWall: wn ? wallSum / wn : 0 };
  }

  function anchorErr(s, rim) {
    if (s > rim) return 1; /* clay missing entirely */
    var err = Math.abs(outer[s] - bpR[s]);
    return clamp(1 - err / TOL, 0, 1);
  }

  function firePiece() {
    var m = computeMatch();
    var acc = m.acc;
    var c = COMMS[commIdx];
    var heavy = m.avgWall > HEAVY_WALL;
    var stars = acc >= 88 ? 3 : acc >= 70 ? 2 : acc >= 52 ? 1 : 0;
    if (stars > 0 && heavy) stars = Math.min(stars, 2);

    var pay = 0;
    if (stars > 0) {
      var mult = stars === 3 ? 1.25 : stars === 2 ? 1 : 0.7;
      if (heavy) mult *= 0.75;
      pay = Math.round(c.base * (acc / 100) * mult);
      till += pay;
      soldCount++;
      clock = Math.min(clock + stars * 9, 999);
    }

    mode = "fired";
    pressing = false;
    if (humGain) humGain.gain.value = 0;
    if (mudGain) mudGain.gain.value = 0;

    if (stars === 0) {
      chime(false);
      pieceTitle.textContent = "Rejected at the kiln";
      pieceStars.textContent = "\u2727 \u2727 \u2727";
      pieceStars.style.color = "#8a6d52";
      pieceDetail.textContent =
        "Only " +
        Math.round(acc) +
        "% true to the pattern \u2014 the merchant" +
        " walks on without a glance. Nothing earned, nothing broken.";
    } else {
      chime(stars === 3);
      pieceTitle.textContent = c.name + ", fired";
      pieceStars.textContent =
        stars === 3
          ? "\u2605\u2605\u2605"
          : stars === 2
            ? "\u2605\u2605\u2606"
            : "\u2605\u2606\u2606";
      pieceStars.style.color = "";
      pieceDetail.textContent =
        "Sold for " +
        pay +
        (stars === 3
          ? " \u2014 true-centred work."
          : stars === 2
            ? " \u2014 honest ware."
            : " \u2014 it will find a kitchen.") +
        (heavy ? " It throws heavy; the price took a knock." : "");
    }

    if (commIdx >= COMMS.length - 1) {
      pieceNext.textContent = "That was the last commission. The kiln waits.";
      nextBtn.textContent = "Seal the kiln";
    } else {
      pieceNext.textContent =
        "Next: the " +
        COMMS[commIdx + 1].name +
        " \u2014 " +
        COMMS[commIdx + 1].note;
      nextBtn.textContent = "Next commission";
    }
    pieceOverlay.classList.remove("hidden");
    syncHud();
  }

  function nextComm() {
    pieceOverlay.classList.add("hidden");
    if (commIdx >= COMMS.length - 1) {
      endRun("win");
      return;
    }
    commIdx++;
    buildComm(commIdx);
    mode = "shape";
  }

  function endRun(kind) {
    mode = "done";
    pressing = false;
    if (humGain) humGain.gain.value = 0;
    if (mudGain) mudGain.gain.value = 0;
    pieceOverlay.classList.add("hidden");
    pauseSet(false);

    if (kind === "win") {
      endTitle.textContent =
        soldCount === 5 ? "A perfect shift" : "The kiln is sealed";
      endDetail.textContent =
        "All five commissions fired before dusk, " +
        soldCount +
        " of them sold. The village drinks from your work tonight.";
      chime(true);
    } else if (kind === "time") {
      endTitle.textContent = "Dusk beats the wheel";
      endDetail.textContent =
        "The kiln is bricked up with " +
        commIdx +
        " of five commissions" +
        " delivered. The rest stay wet until tomorrow.";
    } else {
      endTitle.textContent = "The wheel goes cold";
      endDetail.textContent =
        "Three lumps torn through carelessness. The clay bucket is empty" +
        " and the shift is over.";
      chime(false);
    }
    endScore.textContent = String(till);
    endOverlay.classList.remove("hidden");
  }

  function collapsePiece() {
    lumps--;
    collapseT = 1.15;
    wobble = 1;
    noiseBurst(0.5, 900, 0.5);
    blip(160, 0.5, "sawtooth", 0.25, 40);
    toast("Torn! The wall gives way \u2014 a lump wasted.", "#d95f45");
    syncHud();
    var thisRun = runId;
    if (lumps <= 0) {
      setTimeout(function () {
        if (mode === "shape" && runId === thisRun) endRun("lumps");
      }, 900);
    }
  }

  /* ── simulation step ─────────────────────────────────── */

  function yieldAt(y) {
    var fy = clamp(y / Math.max(H, 1), 0, 1);
    var v = 0.62 + 0.38 * Math.sin(clamp(fy, 0, 1) * Math.PI);
    if (fy < 0.18) v *= 0.55; /* the base resists */
    return v;
  }

  function step(dt) {
    spin += dt * (press > 0.05 ? 2.6 : 3.4);
    if (mode !== "shape" || paused) return;

    /* clock */

    clock -= dt;
    if (clock <= 0) {
      clock = 0;
      syncHud();
      endRun("time");
      return;
    }

    /* collapse animation lockout */
    if (collapseT > 0) {
      collapseT -= dt;
      if (collapseT <= 0 && lumps > 0) buildComm(commIdx);
      return;
    }

    /* keyboard tool movement */
    var kv = 0;
    if (keys.ArrowUp || keys.KeyW) kv -= 1;
    if (keys.ArrowDown || keys.KeyS) kv += 1;
    if (kv) toolY = clamp(toolY + kv * 300 * dt, BASE_Y - H - 4, BASE_Y - 4);
    toolY = clamp(toolY, BASE_Y - H - 4, BASE_Y - 4);

    /* centring steadies the piece but earns nothing */

    var wasPressing = press > 0.02;
    var wantPress = (pressing || keys.Space) && !centring && mode === "shape";
    press = clamp(press + (wantPress ? 3.2 : -7) * dt, 0, 1);

    if (centring) {
      wobble = Math.max(0, wobble - 0.34 * dt);
      if (mudGain && !muted) mudGain.gain.value = 0.03;
    } else if (mudGain && !muted) {
      mudGain.gain.value = press * 0.11;
    }
    if (humGain && !muted) humGain.gain.value = 0.05;

    if (!wasPressing && press > 0.02) noiseBurst(0.12, 500, 0.08);

    /* pressing reshapes the profile */
    if (press > 0.01) {
      var yld = yieldAt(BASE_Y - toolY);
      for (var s = 0; s < K; s++) {
        if (outer[s] <= 1) continue;
        var dy = BASE_Y - s * DH - toolY;
        var g = Math.exp(-(dy * dy) / (2 * 20 * 20));
        if (g < 0.01) continue;
        var d = 30 * press * g * yld * dt;
        /* gossamer clay resists: walls ease toward paper-thin instead of
           cliffing straight through, giving the gauge time to scream */
        var wallNow = outer[s] - inner[s];
        if (wallNow < SOFT_WALL) {
          d *= Math.max(0.12, (wallNow - 10) / (SOFT_WALL - 10));
        }
        var floor = MIN_WALL - 3; /* a hair past the guide, it lets go */
        var room = outer[s] - inner[s] - floor;
        if (room <= 0) continue;
        d = Math.min(d, room);
        var innerShare = clamp(inner[s] / outer[s], 0.15, 0.8) + 0.12;
        outer[s] -= d * (1 - innerShare);
        inner[s] += d * innerShare;
      }

      /* fragile gossamer walls survive only gentle hands */
      var rimNow = clamp(Math.floor(H / DH), 1, K - 1);
      var fragile = false;
      var pierced = false;
      for (var chk = 1; chk <= rimNow; chk++) {
        if (inner[chk] > 2) {
          var wl = outer[chk] - inner[chk];
          if (wl < MIN_WALL) fragile = true;
          if (wl < 7) {
            pierced = true;
            break;
          }
        }
      }
      if (pierced || (fragile && toolSpeed > 150)) {
        collapsePiece();
        return;
      }

      /* displaced clay raises the rim; fresh wall carries the cavity up */
      var oldRim = rimNow;
      var newH = Math.min(H + 7.5 * press * dt, maxHAllowed);
      var newRim = clamp(Math.floor(newH / DH), 0, K - 1);
      for (var ext = oldRim + 1; ext <= newRim; ext++) {
        outer[ext] = outer[ext - 1];
        inner[ext] = inner[ext - 1];
      }
      H = newH;

      /* wobble grows with careless hands; gossamer walls magnify it */
      wobble += press * (0.02 + Math.min(toolSpeed, 600) * 0.00035) * (fragile ? 2.4 : 1) * dt;
      if (wobble >= 1) {
        collapsePiece();
        return;
      }
    } else {
      wobble = Math.max(0, wobble - 0.05 * dt);
    }


    /* the spinning wheel irons out small ridges */
    for (var m = 1; m < K - 1; m++) {
      if (outer[m] <= 1) continue;
      var avg = (outer[m - 1] + outer[m] * 2 + outer[m + 1]) / 4;
      var f = centring ? 0.22 : 0.09;
      outer[m] += (avg - outer[m]) * f;
    }

    /* live match read-out, throttled */
    matchTimer -= dt;
    if (matchTimer <= 0) {
      matchTimer = 0.2;
      matchAcc = computeMatch().acc;
    }

    if (bpFlash > 0) bpFlash -= dt;
    for (var ti = toasts.length - 1; ti >= 0; ti--) {
      toasts[ti].t -= dt;
      if (toasts[ti].t <= 0) toasts.splice(ti, 1);
    }
  }

  /* tool speed tracker for wobble gain */
  var lastToolY = null;
  var toolSpeed = 0;

  function trackToolSpeed(dt) {
    if (lastToolY === null) lastToolY = toolY;
    toolSpeed = Math.abs(toolY - lastToolY) / Math.max(dt, 0.001);
    lastToolY = toolY;
  }

  /* ── rendering ───────────────────────────────────────── */

  function wobOff(s) {
    if (wobble <= 0.001) return 0;
    return (
      Math.sin(spin * 2.6 + s * 0.42) * wobble * 7 * Math.sin(s * 0.09 + 1.2)
    );
  }

  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, VH);
    var collapsing = collapseT > 0;
    var rim = clamp(Math.floor(H / DH), 1, K - 1);
    var slump = collapsing ? 1 - collapseT / 1.15 : 0;

    ctx.save();
    var grad = ctx.createLinearGradient(AXIS_X - 140, 0, AXIS_X + 140, 0);

    /* lamplight pool behind the wheel */
    var rg = ctx.createRadialGradient(
      AXIS_X,
      BASE_Y - 150,
      40,
      AXIS_X,
      BASE_Y - 150,
      430,
    );
    rg.addColorStop(0, "rgba(232,163,76,0.13)");
    rg.addColorStop(1, "rgba(232,163,76,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, VW, VH);
  }

  function drawBlueprint() {
    var flash = bpFlash > 0 ? bpFlash / 1.6 : 0;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = "rgba(232,163,76," + (0.4 + flash * 0.45) + ")";
    ctx.beginPath();
    for (var s = 0; s <= bpTop; s++) {
      var y = BASE_Y - s * DH;
      var r = bpR[s];
      if (s === 0) ctx.moveTo(AXIS_X + r, y);
      else ctx.lineTo(AXIS_X + r, y);
    }
    for (var t = bpTop; t >= 0; t--) {
      ctx.lineTo(AXIS_X - bpR[t], BASE_Y - t * DH);
    }
    ctx.closePath();
    ctx.stroke();

    /* tolerance ghosts */
    ctx.setLineDash([3, 7]);
    ctx.strokeStyle = "rgba(232,163,76,0.14)";
    [-TOL, TOL].forEach(function (off) {
      ctx.beginPath();
      for (var s2 = 0; s2 <= bpTop; s2++) {
        var yy = BASE_Y - s2 * DH;
        if (s2 === 0) ctx.moveTo(AXIS_X + bpR[s2] + off, yy);
        else ctx.lineTo(AXIS_X + bpR[s2] + off, yy);
      }
      ctx.stroke();
    });
    ctx.restore();

    /* label */
    ctx.fillStyle = "rgba(189,159,126,0.75)";
    ctx.font = "italic 15px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("the pattern", AXIS_X, BASE_Y - bpTop * DH - 18);
  }

  function drawClay() {
    var collapsing = collapseT > 0;
    var rim = clamp(Math.floor(H / DH), 1, K - 1);
    var slump = collapsing ? 1 - collapseT / 1.15 : 0;

    ctx.save();
    var grad = ctx.createLinearGradient(AXIS_X - 140, 0, AXIS_X + 140, 0);
    grad.addColorStop(0, "#8a4a2e");
    grad.addColorStop(0.32, "#c97a4e");
    grad.addColorStop(0.55, "#dd9a67");
    grad.addColorStop(0.8, "#b06138");
    grad.addColorStop(1, "#7e4227");
    ctx.fillStyle = grad;
    ctx.strokeStyle = "rgba(46,22,10,0.55)";
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    for (var s = 0; s <= rim; s++) {
      var y = BASE_Y - s * DH + slump * 60 * (s / rim);
      var r = outer[s];
      if (collapsing) r = outer[s] * (1 + slump * 0.9) * (1 - 0.35 * (s / rim));
      var x = AXIS_X + r + wobOff(s);
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (var q = rim; q >= 0; q--) {
      var y2 = BASE_Y - q * DH + slump * 60 * (q / rim);
      var r2 = outer[q];
      if (collapsing)
        r2 = outer[q] * (1 + slump * 0.9) * (1 - 0.35 * (q / rim));
      ctx.lineTo(AXIS_X - r2 + wobOff(q), y2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    /* cavity shadow: stacked ellipses reading as a hollow */
    for (var c = rim - 1; c >= 2; c -= 2) {
      if (inner[c] > 3) {
        ctx.fillStyle = "rgba(24,10,4," + (0.16 + 0.22 * (c / rim)) + ")";
        ctx.beginPath();
        ctx.ellipse(
          AXIS_X + wobOff(c),
          BASE_Y - c * DH,
          Math.max(inner[c] - 2, 2),
          Math.max(inner[c] - 2, 2) * 0.16,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    /* rim opening */
    if (!collapsing && inner[rim - 1] > 3) {
      ctx.fillStyle = "#2a1207";
      ctx.beginPath();
      ctx.ellipse(
        AXIS_X + wobOff(rim),
        BASE_Y - rim * DH,
        Math.max(inner[rim - 1], 2),
        Math.max(inner[rim - 1], 2) * 0.2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    /* rotating flecks sell the spin */
    ctx.fillStyle = "rgba(60,28,12,0.4)";
    for (var sp = 2; sp < rim; sp += 3) {
      for (var k = 0; k < 3; k++) {
        var ph = spin * 2 + sp * 0.53 + k * 2.4;
        var dx = Math.sin(ph) * (outer[sp] * 0.72);
        if (dx < 0) continue;
        ctx.beginPath();
        ctx.arc(
          AXIS_X + dx + wobOff(sp),
          BASE_Y - sp * DH,
          1.7,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawWheelHead() {
    var cy = BASE_Y + 26;
    ctx.save();
    /* flywheel */
    ctx.fillStyle = "#4a3623";

    ctx.beginPath();
    ctx.ellipse(AXIS_X, cy, 252, 44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2b1d10";
    ctx.lineWidth = 3;
    ctx.stroke();

    /* rotating spokes read as motion */
    ctx.strokeStyle = "rgba(232,183,110,0.28)";
    ctx.lineWidth = 5;
    for (var k = 0; k < 4; k++) {
      var off = Math.sin(spin * 2 + (k * Math.PI) / 2) * 235;
      ctx.beginPath();
      ctx.moveTo(AXIS_X + off, cy - 30);
      ctx.lineTo(AXIS_X + off * 0.92, cy + 30);
      ctx.stroke();
    }

    /* wheel head disc the clay sits on */
    var hg = ctx.createRadialGradient(AXIS_X, cy - 8, 10, AXIS_X, cy - 8, 130);
    hg.addColorStop(0, "#6b4d31");
    hg.addColorStop(1, "#3c2a18");
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.ellipse(AXIS_X, BASE_Y + 2, 138, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(20,10,4,0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function drawTool() {
    if (mode !== "shape" || collapseT > 0) return;
    var rim = clamp(Math.floor(H / DH), 1, K - 1);
    var ty = toolY;
    var edge =
      AXIS_X +
      outer[clamp(Math.round((BASE_Y - ty) / DH), 0, rim)] +
      wobOff(clamp(Math.round((BASE_Y - ty) / DH), 0, rim));

    ctx.save();
    /* height guide across the vessel */
    ctx.strokeStyle = "rgba(244,229,205,0.12)";
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(AXIS_X - 190, ty);
    ctx.lineTo(AXIS_X + 190, ty);
    ctx.stroke();
    ctx.setLineDash([]);

    /* arm reaching in from the right */
    ctx.strokeStyle = "#8a6a45";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(VW - 30, ty - 14);
    ctx.lineTo(edge + 26, ty);
    ctx.stroke();

    /* pad */
    var glow = press;
    ctx.fillStyle =
      glow > 0.05
        ? "rgb(232," +
          Math.round(163 + 40 * glow) +
          "," +
          Math.round(76 + 60 * glow) +
          ")"
        : "#c9a06a";
    ctx.shadowColor = "rgba(232,163,76,0.9)";
    ctx.shadowBlur = 14 * glow;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(edge - 2, ty - 7, 20, 14, 5);
    else ctx.rect(edge - 2, ty - 7, 20, 14);
    ctx.fill();
    ctx.restore();
  }

  function drawGauges() {
    if (mode !== "shape" && mode !== "fired") return;
    ctx.save();
    ctx.textAlign = "left";

    /* ── wall gauge ── */
    var gx = 648,
      gy = 168,
      gh = 250,
      gw = 26;
    ctx.fillStyle = "rgba(189,159,126,0.75)";
    ctx.font = "12px Georgia, serif";
    ctx.fillText("WALL", gx, gy - 10);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(gx, gy, gw, gh);
    var map = function (w) {
      return gy + gh - clamp(w / 70, 0, 1) * gh;
    };
    ctx.fillStyle = "rgba(217,95,69,0.5)";
    ctx.fillRect(gx, map(MIN_WALL), gw, gy + gh - map(MIN_WALL));
    ctx.fillStyle = "rgba(159,196,106,0.4)";
    ctx.fillRect(gx, map(SOFT_WALL), gw, map(MIN_WALL) - map(SOFT_WALL));
    ctx.fillStyle = "rgba(232,163,76,0.4)";
    ctx.fillRect(gx, map(HEAVY_WALL), gw, map(SOFT_WALL) - map(HEAVY_WALL));
    ctx.fillStyle = "rgba(217,95,69,0.5)";
    ctx.fillRect(gx, gy, gw, map(HEAVY_WALL) - gy);

    var rim = clamp(Math.floor(H / DH), 1, K - 1);
    var ts = clamp(Math.round((BASE_Y - toolY) / DH), 0, rim);
    var wallHere = Math.max(0, outer[ts] - inner[ts]);
    var ny = map(wallHere);
    ctx.strokeStyle = "#f4e5cd";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(gx - 5, ny);
    ctx.lineTo(gx + gw + 5, ny);
    ctx.stroke();
    ctx.fillStyle =
      wallHere < MIN_WALL
        ? "#d95f45"
        : wallHere > HEAVY_WALL
          ? "#e8a34c"
          : "#9fc46a";
    ctx.fillText(Math.round(wallHere) + " px", gx + gw + 12, ny + 4);

    /* ── wobble meter ── */
    var wx = 720,
      wy = 168,
      ww = 150,
      wh = 16;
    ctx.fillStyle = "rgba(189,159,126,0.75)";
    ctx.fillText("WOBBLE", wx, wy - 10);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(wx, wy, ww, wh);
    var wobCol =
      wobble > 0.75 ? "#d95f45" : wobble > 0.45 ? "#e8a34c" : "#9fc46a";
    ctx.fillStyle = wobCol;
    ctx.fillRect(wx, wy, ww * clamp(wobble, 0, 1), wh);
    ctx.strokeStyle = "rgba(244,229,205,0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(wx + ww * 0.75, wy - 4);
    ctx.lineTo(wx + ww * 0.75, wy + wh + 4);
    ctx.stroke();
    ctx.strokeStyle = "rgba(189,159,126,0.4)";
    ctx.strokeRect(wx, wy, ww, wh);
    if (centring) {
      ctx.fillStyle = "#e8a34c";
      ctx.fillText("steadying\u2026", wx, wy + wh + 18);
    }

    /* ── live match ── */
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(189,159,126,0.75)";
    ctx.font = "12px Georgia, serif";
    ctx.fillText("MATCH TO PATTERN", wx + ww / 2, wy + 58);
    ctx.font = "bold 34px Georgia, serif";
    ctx.fillStyle =
      matchAcc >= 70 ? "#9fc46a" : matchAcc >= 52 ? "#e8a34c" : "#d95f45";
    ctx.fillText(Math.round(matchAcc) + "%", wx + ww / 2, wy + 92);

    /* rim height note */
    ctx.font = "12px Georgia, serif";
    ctx.fillStyle = "rgba(189,159,126,0.6)";
    ctx.fillText(
      "rim " + Math.round(H) + " / " + Math.round(bpTop * DH) + " px",
      wx + ww / 2,
      wy + 114,
    );

    /* ── fire plate ── */
    var hot = mode === "shape" && collapseT <= 0 && !paused;
    var fx = FIRE_RECT.x,
      fy = FIRE_RECT.y,
      fw = FIRE_RECT.w,
      fh = FIRE_RECT.h;
    ctx.save();
    if (hot && hoverFire) {
      ctx.shadowColor = "rgba(232,163,76,0.8)";
      ctx.shadowBlur = 18;
    }
    ctx.fillStyle = hot ? "rgba(58,40,26,0.95)" : "rgba(40,28,18,0.6)";
    ctx.strokeStyle = hot ? "#e8a34c" : "rgba(138,109,82,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(fx, fy, fw, fh, 12);
    else ctx.rect(fx, fy, fw, fh);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.textAlign = "center";
    ctx.fillStyle = hot ? "#f4e5cd" : "rgba(189,159,126,0.5)";
    ctx.font = "bold 21px Georgia, serif";
    ctx.fillText("FIRE IT", fx + fw / 2, fy + 30);
    ctx.font = "12px Georgia, serif";
    ctx.fillStyle = hot ? "rgba(232,163,76,0.9)" : "rgba(138,109,82,0.6)";
    ctx.fillText("enter \u2014 send it to the kiln", fx + fw / 2, fy + 50);
    ctx.restore();

    /* ── hints ── */
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(189,159,126,0.55)";
    ctx.font = "13px Georgia, serif";
    ctx.fillText(
      "hold SPACE / mouse to press \u00b7 hold C to centre",
      24,
      VH - 20,
    );

    ctx.restore();
  }

  function drawToasts() {
    ctx.save();
    ctx.textAlign = "center";
    toasts.forEach(function (t, i) {
      var a = clamp(t.t / 0.6, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = t.tone;
      ctx.font = "bold 17px Georgia, serif";
      ctx.fillText(t.text, AXIS_X + 40, 46 + i * 26);
    });
    ctx.restore();
  }

  function render() {
    drawBackground();
    drawBlueprint();
    drawClay();
    drawWheelHead();
    drawTool();
    drawGauges();
    drawToasts();

    if (paused && mode === "shape") {
      ctx.fillStyle = "rgba(10,5,2,0.35)";
      ctx.fillRect(0, 0, VW, VH);
    }
  }
  hudLumps.textContent =
    "\u25cf\u25cf\u25cf".slice(0, Math.max(0, lumps)) +
    "\u25cb\u25cb\u25cb".slice(0, Math.max(0, 3 - Math.max(0, lumps)));

  function syncHud() {
    hudClock.textContent = fmtClock(clock);
    hudClock.classList.toggle("low", clock <= 15 && mode === "shape");
    hudLumps.textContent =
      "\u25cf\u25cf\u25cf".slice(0, lumps) +
      "\u25cb\u25cb\u25cb".slice(0, Math.max(0, 3 - lumps));
    hudScore.textContent = String(till);
  }

  /* ── flow control ────────────────────────────────────── */

  function pauseSet(v) {
    if (mode !== "shape" && v) return;
    paused = v;
    pauseOverlay.classList.toggle("hidden", !paused);
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    if (humGain) humGain.gain.value = paused || muted ? 0 : 0.05;
    if (mudGain) mudGain.gain.value = 0;
  }

  function startShift() {
    ensureAudio();
    startOverlay.classList.add("hidden");
    endOverlay.classList.add("hidden");
    pieceOverlay.classList.add("hidden");
    commIdx = 0;
    clock = 175;
    lumps = 3;
    till = 0;
    soldCount = 0;
    toasts.length = 0;
    runId++;

    buildComm(0);
    mode = "shape";
    paused = false;
    pauseOverlay.classList.add("hidden");
    pauseBtn.textContent = "Pause";
    syncHud();
  }

  function restart() {
    if (mode === "title") {
      startShift();
      return;
    }
    startShift();
    toast("Fresh shift. The wheel turns again.", "#e8a34c");
  }

  startBtn.addEventListener("click", function () {
    startBtn.blur();
    startShift();
  });
  nextBtn.addEventListener("click", function () {
    nextBtn.blur();
    ensureAudio();
    nextComm();
  });
  againBtn.addEventListener("click", function () {
    againBtn.blur();
    startShift();
  });
  resumeBtn.addEventListener("click", function () {
    resumeBtn.blur();
    pauseSet(false);
  });
  pauseBtn.addEventListener("click", function () {
    pauseBtn.blur();
    pauseSet(!paused);
  });
  restartBtn.addEventListener("click", function () {
    restartBtn.blur();
    restart();
  });
  soundBtn.addEventListener("click", function () {
    soundBtn.blur();
    muted = !muted;
    soundBtn.textContent = muted ? "Sound: off" : "Sound: on";
    if (master) master.gain.value = muted ? 0 : 0.85;
  });

  /* ── pointer input ───────────────────────────────────── */

  function canvasPos(e) {
    var r = cvs.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (VW / r.width),
      y: (e.clientY - r.top) * (VH / r.height),
    };
  }

  function overFire(p) {
    return (
      p.x >= FIRE_RECT.x &&
      p.x <= FIRE_RECT.x + FIRE_RECT.w &&
      p.y >= FIRE_RECT.y &&
      p.y <= FIRE_RECT.y + FIRE_RECT.h
    );
  }

  cvs.addEventListener("pointermove", function (e) {
    var p = canvasPos(e);
    hoverFire = overFire(p);
    cvs.style.cursor = hoverFire ? "pointer" : "crosshair";
    if (mode === "shape" && !paused && collapseT <= 0) {
      /* hovering aims the tool; a held mouse or finger presses as it aims */
      toolY = clamp(p.y, BASE_Y - H - 4, BASE_Y - 4);
    }
  });

  cvs.addEventListener("pointerdown", function (e) {
    ensureAudio();
    var p = canvasPos(e);

    var p = canvasPos(e);
    if (overFire(p)) {
      if (mode === "shape" && !paused && collapseT <= 0) firePiece();
      return;
    }
    pointerDown = true;
    try {
      cvs.setPointerCapture(e.pointerId);
    } catch (err) {
      /* noop */
    }
    if (mode === "shape" && !paused) {
      toolY = clamp(p.y, BASE_Y - H - 4, BASE_Y - 4);
      pressing = true;
    }
    e.preventDefault();
  });

  function releasePointer() {
    pointerDown = false;
    pressing = false;
  }
  cvs.addEventListener("pointerup", releasePointer);
  cvs.addEventListener("pointercancel", releasePointer);
  cvs.addEventListener("pointerleave", function () {
    hoverFire = false;
  });

  window.addEventListener("blur", releasePointer);

  /* ── keyboard ────────────────────────────────────────── */

  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "ArrowDown") {
      e.preventDefault();
    }
    if (e.repeat) {
      keys[e.code] = true;
      return;
    }
    keys[e.code] = true;

    switch (e.code) {
      case "KeyP":
        if (mode === "shape") pauseSet(!paused);
        break;
      case "KeyM":
        muted = !muted;
        soundBtn.textContent = muted ? "Sound: off" : "Sound: on";
        if (master) master.gain.value = muted ? 0 : 0.85;
        break;
      case "KeyR":
        restart();
        break;
      case "KeyC":
        centring = true;
        break;
      case "Enter":
      case "KeyF":
        if (mode === "shape" && !paused && collapseT <= 0) {
          ensureAudio();
          firePiece();
        } else if (!pieceOverlay.classList.contains("hidden")) nextComm();
        else if (!endOverlay.classList.contains("hidden")) startShift();
        break;
      case "Space":
        if (mode === "title" && !startOverlay.classList.contains("hidden"))
          startShift();
        break;
    }
  });

  window.addEventListener("keyup", function (e) {
    keys[e.code] = false;
    if (e.code === "KeyC") centring = false;
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && mode === "shape" && !paused) pauseSet(true);
  });

  /* ── responsive backing store ────────────────────────── */

  function fit() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = cvs.clientWidth || VW;
    var scale = (cssW / VW) * dpr;
    cvs.width = Math.round(VW * scale);
    cvs.height = Math.round(VH * scale);
    ctx = cvs.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  window.addEventListener("resize", fit);

  /* ── main loop ───────────────────────────────────────── */

  var lastT = null;
  var hudT = 0;
  function frame(t) {
    if (lastT === null) lastT = t;
    var dt = Math.min((t - lastT) / 1000, 0.033);
    lastT = t;

    trackToolSpeed(dt);
    step(dt);

    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.2;
      syncHud();
    }

    /* ambient toasts even outside shaping */
    for (var ti = toasts.length - 1; ti >= 0; ti--) {
      if (mode !== "shape" || paused) {
        toasts[ti].t -= dt * 0.4;
        if (toasts[ti].t <= 0) toasts.splice(ti, 1);
      }
    }
    if (bpFlash > 0 && (mode !== "shape" || paused)) bpFlash -= dt * 0.5;

    render();
    requestAnimationFrame(frame);
  }

  cvs.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  /* boot: show the title scene with a dummy vessel behind it */
  buildComm(0);
  mode = "title";
  clock = 175;
  syncHud();
  fit();
  requestAnimationFrame(frame);
})();
