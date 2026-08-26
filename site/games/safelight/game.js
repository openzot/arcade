/* Safelight - a midnight darkroom.
   Print a wedding roll overnight: set the enlarger, dodge and burn the blank
   sheet by hand while the lamp floods, then lift each print from the
   developer at its true density before the fog takes it. */
(function () {
  "use strict";

  /* ---------- dom ---------- */

  var cvs = document.getElementById("darkroom");
  var ctx = cvs.getContext("2d");
  var W = cvs.width;
  var H = cvs.height;

  var el = function (id) {
    return document.getElementById(id);
  };
  var chipFrame = el("chipFrame");
  var chipBase = el("chipBase");
  var chipSheets = el("chipSheets");
  var chipAlbum = el("chipAlbum");
  var chipClock = el("chipClock");
  var padLess = el("padLess");
  var padMore = el("padMore");
  var padBurn = el("padBurn");
  var padLift = el("padLift");
  var padExpose = el("padExpose");
  var padTimeVal = el("padTimeVal");
  var veil = el("veil");
  var cardTitle = el("cardTitle");
  var cardTag = el("cardTag");
  var cardBody = el("cardBody");
  var cardBtn = el("cardBtn");
  var cardBtn2 = el("cardBtn2");
  var btnSound = el("btnSound");
  var btnHelp = el("btnHelp");
  var btnPause = el("btnPause");
  var btnRestart = el("btnRestart");

  /* ---------- tuning ---------- */

  var PW = 384;
  var PH = 256;
  var N = PW * PH;

  var EASEL_X = 60;
  var EASEL_Y = 220;

  var TRAY = { x: 556, y: 298, w: 372, h: 182 };
  var PRINT_IN_TRAY = { x: 610, y: 306, w: 264, h: 176 };

  var PROOF = { x: 644, y: 84, w: 276, h: 126 };
  var PROOF_PRINT_W = 178;
  var PROOF_PRINT_H = 119;

  var LINE_Y = 54;
  var ALBUM_SLOTS = [170, 258, 346, 434];

  var FRAMES_NEEDED = 6;
  var ALBUM_NEED = 4;
  var SHEETS_TOTAL = 8;
  var NIGHT_SECONDS = 300;

  var BASE_MIN = 3;
  var BASE_MAX = 28;
  var EXPOSE_CAP = 34;

  var NMIN = 1.6;
  var NMAX = 40;
  var LOGR = Math.log(NMAX / NMIN);

  var F_MIN = 0.16;
  var B_ADD = 1.9;
  var R1 = 44;
  var R2 = 110;

  var MOUNT_AT = 56;

  /* ---------- utils ---------- */

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function smoothstep(v) {
    v = clamp(v, 0, 1);
    return v * v * (3 - 2 * v);
  }
  function mulberry(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function fmtClock(s) {
    s = Math.max(0, Math.ceil(s));
    var m = Math.floor(s / 60);
    var ss = s % 60;
    return m + ":" + (ss < 10 ? "0" : "") + ss;
  }

  /* ---------- audio ---------- */

  var actx = null;
  var master = null;
  var muted = false;
  var humOsc = null;
  var fanSrc = null;
  var fanGain = null;
  var noiseBuf = null;

  function audioReady() {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(actx.destination);
      var len = actx.sampleRate * 1.2;
      noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      humOsc = actx.createOscillator();
      humOsc.type = "triangle";
      humOsc.frequency.value = 46;
      var hg = actx.createGain();
      hg.gain.value = 0.016;
      var hf = actx.createBiquadFilter();
      hf.type = "lowpass";
      hf.frequency.value = 130;
      humOsc.connect(hf);
      hf.connect(hg);
      hg.connect(master);
      humOsc.start();
    }
    if (actx.state === "suspended") actx.resume();
    return true;
  }

  function blip(freq, dur, type, gain, delay) {
    if (!actx || muted) return;
    var t0 = actx.currentTime + (delay || 0);
    var o = actx.createOscillator();
    o.type = type || "sine";
    o.frequency.value = freq;
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function hiss(dur, freq, gain, delay) {
    if (!actx || muted || !noiseBuf) return;
    var t0 = actx.currentTime + (delay || 0);
    var src = actx.createBufferSource();
    src.buffer = noiseBuf;
    var f = actx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq;
    var g = actx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  function fanOn() {
    if (!actx || muted || fanSrc) return;
    fanSrc = actx.createBufferSource();
    fanSrc.buffer = noiseBuf;
    fanSrc.loop = true;
    var f = actx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 320;
    f.Q.value = 0.7;
    fanGain = actx.createGain();
    fanGain.gain.value = 0.032;
    fanSrc.connect(f);
    f.connect(fanGain);
    fanGain.connect(master);
    fanSrc.start();
  }
  function fanOff() {
    if (!fanSrc) return;
    try {
      fanSrc.stop();
    } catch (e) {}
    fanSrc = null;
    fanGain = null;
  }

  function sndLampOn() {
    blip(1500, 0.05, "square", 0.05);
    fanOn();
  }
  function sndLampOff() {
    fanOff();
    blip(700, 0.05, "square", 0.04);
  }
  function sndSlosh() {
    hiss(0.42, 650, 0.2);
    hiss(0.3, 900, 0.12, 0.13);
  }
  function sndDing() {
    blip(1046, 0.1, "sine", 0.16);
    blip(1568, 0.16, "sine", 0.13, 0.08);
  }
  function sndThud() {
    blip(96, 0.22, "sine", 0.26);
  }
  function sndStamp() {
    hiss(0.08, 1600, 0.24);
    blip(190, 0.08, "square", 0.1);
  }
  function sndToggle() {
    blip(520, 0.04, "square", 0.05);
  }

  /* ---------- scenes: the wedding roll ---------- */

  function gray(t) {
    var v = Math.round(clamp(t, 0, 1) * 255);
    return "rgb(" + v + "," + v + "," + v + ")";
  }

  function painter(g) {
    return {
      bg: function (t) {
        g.fillStyle = gray(t);
        g.fillRect(0, 0, PW, PH);
      },
      ell: function (x, y, rx, ry, t) {
        g.fillStyle = gray(t);
        g.beginPath();
        g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        g.fill();
      },
      rr: function (x, y, w, h, t) {
        g.fillStyle = gray(t);
        g.fillRect(x, y, w, h);
      },
      poly: function (pts, t) {
        g.fillStyle = gray(t);
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
        g.closePath();
        g.fill();
      },
      ring: function (x, y, r, wdt, t) {
        g.strokeStyle = gray(t);
        g.lineWidth = wdt;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
      },
      mottle: function (rnd, n, tMin, tMax, rMax) {
        for (var i = 0; i < n; i++) {
          this.ell(
            rnd() * PW,
            rnd() * PH,
            8 + rnd() * rMax,
            6 + rnd() * (rMax * 0.7),
            lerp(tMin, tMax, rnd()),
          );
        }
      },
    };
  }

  var SCENES = [
    {
      name: "The Rings",
      seed: 11,
      draw: function (g) {
        var p = painter(g);
        var rnd = mulberry(this.seed);
        p.bg(0.74);
        p.mottle(rnd, 14, 0.62, 0.82, 30);
        p.ell(PW / 2, PH / 2 + 30, 150, 62, 0.6);
        p.ell(PW / 2, PH / 2 + 18, 132, 48, 0.68);
        p.ring(PW / 2 - 22, PH / 2 + 6, 34, 9, 0.16);
        p.ring(PW / 2 + 22, PH / 2 - 2, 34, 9, 0.2);
        p.ell(PW / 2 + 40, PH / 2 - 26, 7, 7, 0.04);
        p.ell(PW / 2 - 60, PH / 2 + 40, 26, 10, 0.5);
      },
    },
    {
      name: "The Cake",
      seed: 23,
      draw: function (g) {
        var p = painter(g);
        var rnd = mulberry(this.seed);
        p.bg(0.62);
        p.mottle(rnd, 10, 0.5, 0.72, 40);
        p.rr(0, 196, PW, 60, 0.34);
        p.rr(0, 196, PW, 7, 0.24);
        p.rr(122, 158, 140, 44, 0.07);
        p.rr(142, 116, 100, 44, 0.06);
        p.rr(162, 80, 60, 38, 0.08);
        p.rr(122, 196, 140, 6, 0.16);
        p.poly(
          [
            [181, 80],
            [181, 58],
            [188, 50],
            [192, 58],
            [192, 80],
          ],
          0.92,
        );
        p.poly(
          [
            [194, 80],
            [194, 60],
            [201, 52],
            [204, 60],
            [204, 80],
          ],
          0.95,
        );
        p.ell(70, 60, 40, 16, 0.5);
        p.ell(320, 44, 46, 18, 0.46);
      },
    },
    {
      name: "The Bouquet",
      seed: 37,
      draw: function (g) {
        var p = painter(g);
        var rnd = mulberry(this.seed);
        p.bg(0.8);
        p.mottle(rnd, 26, 0.6, 0.9, 34);
        p.ell(PW / 2, PH / 2 - 10, 96, 84, 0.42);
        var blooms = [
          [150, 96, 34],
          [206, 76, 30],
          [250, 108, 32],
          [172, 146, 30],
          [228, 148, 33],
          [192, 112, 36],
        ];
        var i;
        for (i = 0; i < blooms.length; i++) {
          p.ell(
            blooms[i][0],
            blooms[i][1],
            blooms[i][2],
            blooms[i][2] * 0.9,
            0.12,
          );
        }
        for (i = 0; i < blooms.length; i++) {
          p.ell(
            blooms[i][0],
            blooms[i][1],
            blooms[i][2] * 0.42,
            blooms[i][2] * 0.38,
            0.05,
          );
        }
        p.poly(
          [
            [186, 176],
            [198, 176],
            [206, 240],
            [178, 240],
          ],
          0.3,
        );
        p.rr(174, 168, 36, 14, 0.24);
      },
    },
    {
      name: "First Dance",
      seed: 41,
      draw: function (g) {
        var p = painter(g);
        p.bg(0.88);
        var gl = g.createRadialGradient(PW / 2, 96, 10, PW / 2, 110, 170);
        gl.addColorStop(0, gray(0.16));
        gl.addColorStop(1, gray(0.88));
        g.fillStyle = gl;
        g.fillRect(0, 0, PW, 210);
        var i;
        var rnd = mulberry(this.seed);
        for (i = 0; i < 26; i++) {
          p.ell(rnd() * PW, 20 + rnd() * 90, 1.6, 1.6, 0.02);
        }
        p.rr(0, 208, PW, 48, 0.66);
        p.poly(
          [
            [168, 208],
            [186, 118],
            [196, 96],
            [206, 118],
            [214, 208],
          ],
          0.97,
        );
        p.ell(199, 84, 12, 14, 0.97);
        p.poly(
          [
            [212, 208],
            [222, 124],
            [232, 106],
            [242, 124],
            [252, 208],
          ],
          0.98,
        );
        p.ell(232, 94, 11, 13, 0.98);
        p.rr(150, 214, 120, 6, 0.5);
      },
    },
    {
      name: "The Getaway Car",
      seed: 53,
      draw: function (g) {
        var p = painter(g);
        var rnd = mulberry(this.seed);
        p.bg(0.07);
        p.mottle(rnd, 8, 0.1, 0.17, 40);
        p.rr(0, 150, PW, 106, 0.52);
        p.rr(0, 150, PW, 6, 0.4);
        p.ell(80, 40, 52, 14, 0.14);
        p.ell(300, 62, 60, 16, 0.12);
        p.poly(
          [
            [58, 152],
            [86, 116],
            [150, 102],
            [230, 100],
            [300, 114],
            [338, 148],
            [338, 178],
            [58, 180],
          ],
          0.86,
        );
        p.poly(
          [
            [104, 118],
            [154, 106],
            [154, 134],
            [96, 134],
          ],
          0.1,
        );
        p.poly(
          [
            [166, 105],
            [238, 104],
            [280, 118],
            [166, 132],
          ],
          0.12,
        );
        p.rr(52, 168, 292, 12, 0.05);
        p.ell(116, 184, 26, 26, 0.95);
        p.ell(116, 184, 11, 11, 0.3);
        p.ell(286, 184, 26, 26, 0.95);
        p.ell(286, 184, 11, 11, 0.3);
      },
    },
    {
      name: "The Confetti Throw",
      seed: 67,
      draw: function (g) {
        var p = painter(g);
        var rnd = mulberry(this.seed);
        p.bg(0.46);
        p.mottle(rnd, 12, 0.36, 0.56, 44);
        var i;
        for (i = 0; i < 90; i++) {
          g.save();
          g.translate(rnd() * PW, rnd() * 170);
          g.rotate(rnd() * Math.PI);
          g.fillStyle = gray(0.05 + rnd() * 0.12);
          g.fillRect(-4 - rnd() * 3, -2, 8 + rnd() * 6, 4);
          g.restore();
        }
        p.rr(0, 176, PW, 80, 0.9);
        for (i = 0; i < 16; i++) {
          p.ell(14 + i * 24, 178 + (i % 3) * 6, 12, 10, 0.95);
        }
        p.ell(PW / 2 - 20, 150, 16, 30, 0.2);
        p.ell(PW / 2 + 22, 152, 17, 30, 0.16);
        p.ell(PW / 2 - 20, 118, 9, 11, 0.2);
        p.ell(PW / 2 + 22, 121, 9, 11, 0.16);
      },
    },
  ];

  var truthCanvas = document.createElement("canvas");
  truthCanvas.width = PW;
  truthCanvas.height = PH;
  var truthCtx = truthCanvas.getContext("2d", { willReadFrequently: true });

  var printCanvas = document.createElement("canvas");
  printCanvas.width = PW;
  printCanvas.height = PH;
  var printCtx = printCanvas.getContext("2d");
  var printImg = printCtx.createImageData(PW, PH);

  var grain = new Float32Array(N);
  (function () {
    var r = mulberry(999);
    for (var i = 0; i < N; i++) grain[i] = (r() - 0.5) * 11;
  })();

  /* ---------- state ---------- */

  var frames = [];
  var phase = "title";
  var phaseT = 0;
  var paused = false;
  var veilOpen = false;

  var frameIdx = 0;
  var sheets = SHEETS_TOTAL;
  var albumCount = 0;
  var mountedScores = [];
  var printed = 0;
  var clock = NIGHT_SECONDS;
  var baseTime = 10;

  var truth = new Float32Array(N);
  var exp = new Float32Array(N);
  var Dfinal = new Float32Array(N);
  var disp = new Float32Array(N);
  var dispSnap = new Float32Array(N);

  var exposing = false;
  var exposeT = 0;
  var devClock = 0;
  var devT = 6.4;

  var wand = { x: PW / 2, y: PH / 2, mode: "dodge" };

  var gradeScore = 0;
  var gradeVerdict = "";
  var zoneErr = new Float32Array(16);
  var mountKind = "album";
  var mountFrom = { x: 0, y: 0 };
  var lastReason = "";

  var bubbles = [];
  var banner = { text: "", sub: "", ttl: 0 };

  var testMode =
    typeof location !== "undefined" &&
    typeof location.hash === "string" &&
    location.hash.indexOf("test") >= 0;

  /* ---------- card / veil ---------- */

  function showCard(cfg) {
    veilOpen = true;
    veil.classList.remove("hidden");
    cardTitle.innerHTML = cfg.title;
    cardTag.innerHTML = cfg.tag || "";
    cardBody.innerHTML = cfg.body || "";
    cardBtn.innerHTML = cfg.btn || "Continue";
    cardBtn.classList.toggle("hidden", !cfg.btn);
    if (cfg.btn2) {
      cardBtn2.innerHTML = cfg.btn2;
      cardBtn2.classList.remove("hidden");
    } else {
      cardBtn2.classList.add("hidden");
    }
    cardBtn.onclick = cfg.onBtn || hideCard;
    cardBtn2.onclick = cfg.onBtn2 || hideCard;
    if (cfg.btn) cardBtn.focus();
  }

  function hideCard() {
    veilOpen = false;
    veil.classList.add("hidden");
  }

  function introBody() {
    return (
      "<p><span class='step'>ONE.</span> Study <b>the proof</b> pinned on the " +
      "board - it shows exactly how tonight's negative should print. Pale " +
      "areas want little light; black areas want plenty.</p>" +
      "<p><span class='step'>TWO.</span> Set a <b>base time</b> (&uarr;&darr; or " +
      "&#8722;/&#43;), then <b>hold EXPOSE</b> (or SPACE). The blank sheet " +
      "only shows a ghost under the lamp - steer the wand to <b>dodge</b> " +
      "light away, tap X or BURN to heap it on.</p>" +
      "<p><span class='step'>THREE.</span> The sheet slides into the " +
      "developer. Watch it come up against the proof and <b>LIFT</b> (ENTER) " +
      "at the moment the tones match. Hesitate and the fog takes it.</p>" +
      "<p>Fill the album with <b>" +
      ALBUM_NEED +
      " good prints</b> from " +
      FRAMES_NEEDED +
      " negatives. You have <b>" +
      SHEETS_TOTAL +
      " sheets</b> and one night.</p>"
    );
  }

  function showTitle() {
    phase = "title";
    showCard({
      title: "Safelight",
      tag: "The negative never lies. The print is all you.",
      body: introBody(),
      btn: "Start the night",
      onBtn: function () {
        audioReady();
        hideCard();
        newNight();
      },
    });
  }

  function showHelp() {
    var wasPaused = paused;
    var reshow = null;
    if (phase === "title") reshow = showTitle;
    else if (phase === "win") reshow = showWin;
    else if (phase === "lose")
      reshow = function () {
        showLose(lastReason);
      };
    showCard({
      title: "How to print",
      tag: "Three moves, one night.",
      body: introBody(),
      btn: "Back to the bench",
      onBtn: function () {
        hideCard();
        if (reshow) reshow();
        else if (wasPaused) showPause();
      },
    });
  }

  function showPause() {
    paused = true;
    showCard({
      title: "Paused",
      tag: "The trays can wait.",
      body: "<p>The clock is stopped. The developer holds its breath.</p>",
      btn: "Carry on printing",
      onBtn: function () {
        paused = false;
        hideCard();
      },
    });
  }

  function starsFor(avg) {
    if (avg >= 86) return 3;
    if (avg >= 74) return 2;
    return 1;
  }

  function resultBody() {
    var best = 0;
    var avg = 0;
    if (mountedScores.length) {
      for (var i = 0; i < mountedScores.length; i++) {
        best = Math.max(best, mountedScores[i]);
        avg += mountedScores[i];
      }
      avg = Math.round(avg / mountedScores.length);
    }
    var html =
      "<p>Negatives printed: <b>" +
      printed +
      " of " +
      FRAMES_NEEDED +
      "</b> &middot; sheets left: <b>" +
      sheets +
      "</b></p>" +
      "<p>Album: <b>" +
      albumCount +
      " of " +
      ALBUM_NEED +
      "</b> mounted &middot; best print: <b>" +
      best +
      "</b> &middot; average: <b>" +
      avg +
      "</b></p>";
    if (phase === "win") {
      var st = starsFor(avg);
      var row = "";
      for (var s = 0; s < 3; s++) row += s < st ? "\u2605" : "\u2606";
      html +=
        "<span class='stars'>" +
        row +
        "</span>" +
        "<p>" +
        (st === 3
          ? "Master printer. The couple will weep for the right reasons."
          : st === 2
            ? "A fine night's work. One print could have been braver."
            : "Mounted is mounted. Nobody inspects the corners at a wedding.") +
        "</p>";
    }
    return html;
  }

  function showWin() {
    phase = "win";
    sndDing();
    showCard({
      title: "The album is ready",
      tag: "Dawn finds it done.",
      body: resultBody(),
      btn: "Print another roll",
      onBtn: function () {
        hideCard();
        newNight();
      },
    });
  }

  function showLose(reason) {
    phase = "lose";
    lastReason = reason;
    sndThud();
    var tag =
      reason === "dawn"
        ? "Morning. Vans in the street."
        : reason === "sheets"
          ? "The paper box is empty."
          : "That was the whole roll.";
    var line =
      reason === "dawn"
        ? "Grey light is coming under the door and the couple collects the album within the hour. It is not full."
        : reason === "sheets"
          ? "Eight sheets was what the budget ran to. Some nights the paper decides the album."
          : "Six negatives were all they trusted you with, and too few survived the trays.";
    showCard({
      title: "Out of night",
      tag: tag,
      body: "<p>" + line + "</p>" + resultBody(),
      btn: "New roll, new night",
      onBtn: function () {
        hideCard();
        newNight();
      },
    });
  }

  /* ---------- night / frame setup ---------- */

  function buildRoll() {
    frames = [];
    for (var i = 0; i < SCENES.length; i++) {
      truthCtx.fillStyle = "#808080";
      truthCtx.fillRect(0, 0, PW, PH);
      SCENES[i].draw(truthCtx);
      var data = truthCtx.getImageData(0, 0, PW, PH).data;
      // ease each negative's contrast in as the night wears on: early frames
      // sit near mid grey, the last one uses nearly the full scale.
      var spread = [0.45, 0.55, 0.65, 0.75, 0.85, 0.95][i] || 0.95;
      var t = new Float32Array(N);
      var img = printCtx.createImageData(PW, PH);
      for (var j = 0; j < N; j++) {
        var v = clamp(0.5 + (data[j * 4] / 255 - 0.5) * spread, 0, 1);
        t[j] = v;
        var g = Math.round(v * 255);
        var k = j * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = g;
        img.data[k + 3] = 255;
      }
      var snap = document.createElement("canvas");
      snap.width = PW;
      snap.height = PH;
      snap.getContext("2d").putImageData(img, 0, 0);
      frames.push({ name: SCENES[i].name, canvas: snap, truth: t });
    }
  }

  function setupFrame() {
    var f = frames[frameIdx];
    truth.set(f.truth);
    exp.fill(0.0001);
    disp.fill(0);
    devClock = 0;
    exposeT = 0;

    exposing = false;
    wand.x = PW / 2;
    wand.y = PH / 2;
    phaseT = 0;
    bubbles.length = 0;
    banner.text = "NEGATIVE " + (frameIdx + 1) + " OF " + FRAMES_NEEDED;
    banner.sub = "\u201C" + f.name + "\u201D";
    banner.ttl = 3.4;
    phase = "ready";
    syncChips();
    syncPads();
  }

  function newNight() {
    if (!frames.length) buildRoll();
    sheets = SHEETS_TOTAL;
    albumCount = 0;
    mountedScores = [];
    printed = 0;
    clock = NIGHT_SECONDS;
    frameIdx = 0;
    baseTime = clamp(baseTime, BASE_MIN, BASE_MAX);
    paused = false;
    miniCache = {};
    setupFrame();
    toast("A FRESH BOX OF PAPER", "eight sheets. make them sing.");
  }

  function toast(text, sub) {
    banner.text = text;
    banner.sub = sub || "";
    banner.ttl = 2.6;
  }

  /* ---------- exposure model ---------- */

  function soften(v) {
    return v + (smoothstep(v) - v) * 0.35;
  }

  function beginExpose() {
    if (phase !== "ready" || paused || veilOpen) return;
    audioReady();
    exposing = true;
    exposeT = 0;
    phase = "expose";
    sndLampOn();
    syncPads();
  }

  function endExpose() {
    if (phase !== "expose" || !exposing) return;
    exposing = false;
    sndLampOff();
    for (var i = 0; i < N; i++) {
      var v = clamp(Math.log(Math.max(exp[i], 0.0001) / NMIN) / LOGR, 0, 1);
      Dfinal[i] = soften(v);
    }
    sheets--;
    printed++;
    devT = 6.4 + (printed - 1) * 0.85;
    devClock = 0;
    phase = "develop";
    sndSlosh();
    syncChips();
    syncPads();
  }

  function accumulate(dt) {
    var i;
    for (i = 0; i < N; i++) exp[i] += dt;
    var cx = wand.x;
    var cy = wand.y;
    var x0 = Math.max(0, Math.floor(cx - R2));
    var x1 = Math.min(PW - 1, Math.ceil(cx + R2));
    var y0 = Math.max(0, Math.floor(cy - R2));
    var y1 = Math.min(PH - 1, Math.ceil(cy + R2));
    var dodge = wand.mode === "dodge";
    for (var y = y0; y <= y1; y++) {
      var dy = y + 0.5 - cy;
      for (var x = x0; x <= x1; x++) {
        var dx = x + 0.5 - cx;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d >= R2) continue;
        var wgt = d <= R1 ? 1 : 1 - (d - R1) / (R2 - R1);
        var f = dodge ? 1 - (1 - F_MIN) * wgt : 1 + B_ADD * wgt;
        var idx = y * PW + x;
        exp[idx] += dt * (f - 1);
      }
    }
  }

  function renderDisp(target) {
    var img = printImg.data;
    for (var i = 0; i < N; i++) {
      var v = clamp(247 - target[i] * 238 + grain[i], 0, 255) | 0;
      var k = i * 4;
      img[k] = v;
      img[k + 1] = v;
      img[k + 2] = v;
      img[k + 3] = 255;
    }
    printCtx.putImageData(printImg, 0, 0);
  }

  function computeDisp() {
    var ap = Math.pow(clamp(devClock / (devT * 0.82), 0, 1), 1.22);
    var fog = clamp((devClock - devT * 1.02) / (devT * 0.5), 0, 1) * 0.9;
    for (var i = 0; i < N; i++) {
      var d = Dfinal[i] * ap;
      disp[i] = d + (0.53 - d) * fog;
    }
  }

  /* ---------- grading ---------- */

  function computeZoneErr(target) {
    var zw = PW / 4;
    var zh = PH / 4;
    var total = 0;
    var worst = 0;
    for (var zy = 0; zy < 4; zy++) {
      for (var zx = 0; zx < 4; zx++) {
        var sum = 0;
        var cnt = 0;
        for (var y = zy * zh; y < (zy + 1) * zh; y += 2) {
          for (var x = zx * zw; x < (zx + 1) * zw; x += 2) {
            var i = y * PW + x;
            sum += Math.abs(target[i] - truth[i]);
            cnt++;
          }
        }
        var e = sum / cnt;
        zoneErr[zy * 4 + zx] = e;
        total += e;
        worst = Math.max(worst, e);
      }
    }
    return { mean: total / 16, worst: worst };
  }

  function lift() {
    if (phase !== "develop") return;
    computeDisp();
    dispSnap.set(disp);
    var z = computeZoneErr(dispSnap);
    gradeScore = clamp(
      Math.round(118 * (1 - z.mean * 2.0) - z.worst * 26),
      0,
      100,
    );
    gradeVerdict =
      gradeScore >= 86
        ? "BRILLIANT"
        : gradeScore >= 72
          ? "KEEPER"
          : gradeScore >= MOUNT_AT
            ? "GOOD"
            : gradeScore >= 40
              ? "THIN"
              : "SPOILED";
    phase = "rinse";
    phaseT = 0;
    if (gradeScore >= MOUNT_AT) sndDing();
    else sndThud();
    sndStamp();
    syncPads();
  }

  function afterMount() {
    if (albumCount >= ALBUM_NEED) {
      showWin();
      return;
    }
    if (clock <= 0) {
      showLose("dawn");
      return;
    }
    if (sheets <= 0) {
      showLose("sheets");
      return;
    }
    if (frameIdx >= FRAMES_NEEDED - 1) {
      showLose("roll");
      return;
    }
    frameIdx++;
    setupFrame();
  }

  /* ---------- chips & pads ---------- */

  function syncChips() {
    chipFrame.textContent =
      "NEG " + Math.min(frameIdx + 1, FRAMES_NEEDED) + "/" + FRAMES_NEEDED;
    chipBase.textContent = "BASE " + baseTime + "s";
    chipSheets.textContent = "SHEETS " + sheets;
    chipAlbum.textContent = "ALBUM " + albumCount + "/" + ALBUM_NEED;
    chipClock.textContent = "\u263E " + fmtClock(clock);
    chipClock.classList.toggle("chip-hot", clock <= 60);
    padTimeVal.textContent = baseTime + "s";
  }

  function syncPads() {
    padExpose.disabled = phase !== "ready";
    padExpose.classList.toggle("on", exposing);
    padLift.disabled = phase !== "develop";
    padLift.classList.toggle("ready", phase === "develop");
    padBurn.classList.toggle("on", wand.mode === "burn");
    padBurn.setAttribute(
      "aria-pressed",
      wand.mode === "burn" ? "true" : "false",
    );
    padLess.disabled = padMore.disabled = phase !== "ready";
  }

  /* ---------- input ---------- */

  function canvasPos(e) {
    var r = cvs.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * W) / r.width,
      y: ((e.clientY - r.top) * H) / r.height,
    };
  }

  function moveWand(e) {
    var p = canvasPos(e);
    wand.x = clamp(p.x - EASEL_X, 0, PW - 1);
    wand.y = clamp(p.y - EASEL_Y, 0, PH - 1);
  }

  cvs.addEventListener("pointermove", moveWand);
  cvs.addEventListener("pointerdown", function (e) {
    audioReady();
    moveWand(e);
    if (phase === "ready") beginExpose();
    else if (phase === "develop") {
      var p = canvasPos(e);
      if (
        p.x > TRAY.x &&
        p.x < TRAY.x + TRAY.w &&
        p.y > TRAY.y &&
        p.y < TRAY.y + TRAY.h
      )
        lift();
    }
    e.preventDefault();
  });
  window.addEventListener("pointerup", function () {
    if (exposing) endExpose();
  });
  window.addEventListener("blur", function () {
    if (exposing) endExpose();
  });
  cvs.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  padExpose.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    audioReady();
    beginExpose();
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
    padExpose.addEventListener(ev, function () {
      if (exposing) endExpose();
    });
  });

  function toggleBurn() {
    if (phase !== "ready" && phase !== "expose") return;
    wand.mode = wand.mode === "dodge" ? "burn" : "dodge";
    sndToggle();
    syncPads();
  }
  padBurn.addEventListener("click", toggleBurn);

  function bumpTime(d) {
    if (phase !== "ready") return;
    baseTime = clamp(baseTime + d, BASE_MIN, BASE_MAX);
    sndToggle();
    syncChips();
  }
  padLess.addEventListener("click", function () {
    bumpTime(-1);
  });
  padMore.addEventListener("click", function () {
    bumpTime(1);
  });

  padLift.addEventListener("click", lift);

  btnSound.addEventListener("click", function () {
    muted = !muted;
    btnSound.setAttribute("aria-pressed", muted ? "true" : "false");
    if (master) master.gain.value = muted ? 0 : 0.9;
    if (!muted) audioReady();
  });
  btnHelp.addEventListener("click", function () {
    audioReady();
    showHelp();
  });
  btnPause.addEventListener("click", function () {
    if (veilOpen) return;
    audioReady();
    showPause();
    syncPads();
  });
  btnRestart.addEventListener("click", function () {
    audioReady();
    hideCard();
    paused = false;
    newNight();
  });

  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === " " || k === "Spacebar") {
      e.preventDefault();
      if (!e.repeat) beginExpose();
      return;
    }
    if (k === "Enter") {
      e.preventDefault();
      if (phase === "develop") lift();
      else if (phase === "grade") phaseT = 99;
      return;
    }
    if (k === "x" || k === "X") {
      toggleBurn();
      return;
    }
    if (k === "ArrowUp" || k === "+" || k === "=") {
      e.preventDefault();
      bumpTime(1);
      return;
    }
    if (k === "ArrowDown" || k === "-" || k === "_") {
      e.preventDefault();
      bumpTime(-1);
      return;
    }
    if (k === "p" || k === "P") {
      if (!veilOpen) showPause();
      return;
    }
    if (k === "m" || k === "M") {
      btnSound.click();
      return;
    }
    if (k === "h" || k === "?" || k === "/") {
      showHelp();
      return;
    }
    if (k === "r" || k === "R") {
      hideCard();
      paused = false;
      newNight();
      return;
    }
    if (k === "ArrowLeft" || k === "a" || k === "A") {
      wand.x = clamp(wand.x - 22, 0, PW - 1);
      return;
    }
    if (k === "ArrowRight" || k === "d" || k === "D") {
      wand.x = clamp(wand.x + 22, 0, PW - 1);
      return;
    }
    if (k === "w" || k === "W") {
      wand.y = clamp(wand.y - 22, 0, PH - 1);
      return;
    }
    if (k === "s" || k === "S") {
      wand.y = clamp(wand.y + 22, 0, PH - 1);
    }
  });

  window.addEventListener("keyup", function (e) {
    if (e.key === " " || e.key === "Spacebar") {
      if (exposing) endExpose();
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (
      document.hidden &&
      !veilOpen &&
      phase !== "title" &&
      phase !== "win" &&
      phase !== "lose"
    ) {
      showPause();
    }
  });

  /* ---------- update ---------- */

  function update(dt) {
    phaseT += dt;
    if (banner.ttl > 0) banner.ttl -= dt;

    var working =
      phase === "ready" ||
      phase === "expose" ||
      phase === "develop" ||
      phase === "rinse" ||
      phase === "grade" ||
      phase === "mount";

    if (working) {
      clock -= dt;
      if (clock <= 0) {
        clock = 0;
        if (phase === "ready" || phase === "expose") {
          if (exposing) {
            exposing = false;
            fanOff();
          }
          syncChips();
          showLose("dawn");
          return;
        }
      }
    }

    if (phase === "expose") {
      exposeT += dt;
      accumulate(dt);
      if (exposeT >= EXPOSE_CAP) endExpose();
    } else if (phase === "develop") {
      devClock += dt;
      computeDisp();
      if (Math.random() < dt * 3)
        bubbles.push({
          x: PRINT_IN_TRAY.x + 20 + Math.random() * (PRINT_IN_TRAY.w - 40),
          y: PRINT_IN_TRAY.y + PRINT_IN_TRAY.h - 8,
          r: 1 + Math.random() * 2.4,
          vy: -(6 + Math.random() * 10),
        });
      for (var i = bubbles.length - 1; i >= 0; i--) {
        var b = bubbles[i];
        b.y += b.vy * dt;
        if (b.y < TRAY.y + 26) bubbles.splice(i, 1);
      }
      if (devClock > devT * 2.4) lift();
    } else if (phase === "rinse") {
      if (phaseT > 0.8) {
        phase = "grade";
        phaseT = 0;
      }
    } else if (phase === "grade") {
      if (phaseT > 1.7) {
        mountKind = gradeScore >= MOUNT_AT ? "album" : "bin";
        if (mountKind === "album") {
          albumCount++;
          mountedScores.push(gradeScore);
        }
        mountFrom = {
          x: PRINT_IN_TRAY.x,
          y: PRINT_IN_TRAY.y,
        };
        phase = "mount";
        phaseT = 0;
        syncChips();
      }
    } else if (phase === "mount") {
      if (phaseT > 0.75) afterMount();
    }
  }

  /* ---------- drawing ---------- */

  function rrPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function drawRoom() {
    var wall = ctx.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, "#1c0d10");
    wall.addColorStop(0.7, "#150a0c");
    wall.addColorStop(1, "#0e0608");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "#2c1518";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 476);
    ctx.lineTo(W, 476);
    ctx.stroke();
    var bench = ctx.createLinearGradient(0, 476, 0, H);
    bench.addColorStop(0, "#241115");
    bench.addColorStop(1, "#170a0d");
    ctx.fillStyle = bench;
    ctx.fillRect(0, 476, W, H - 476);
    ctx.fillStyle = "#2e1619";
    ctx.fillRect(0, 476, W, 7);

    var glow = ctx.createRadialGradient(592, 34, 6, 592, 40, 190);
    glow.addColorStop(0, "rgba(255,64,48,0.34)");
    glow.addColorStop(1, "rgba(255,64,48,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(400, 0, 420, 260);
    ctx.fillStyle = "#3a1010";
    ctx.beginPath();
    ctx.arc(592, 34, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff5a48";
    ctx.beginPath();
    ctx.arc(592, 36, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#574341";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(30, LINE_Y - 6);
    ctx.quadraticCurveTo(320, LINE_Y + 10, 610, LINE_Y - 6);
    ctx.stroke();
  }

  function drawMini(x, y, w, h, canvas) {
    ctx.save();
    ctx.fillStyle = "#cbb9a8";
    ctx.fillRect(x + w / 2 - 3, y - 7, 6, 8);
    ctx.fillStyle = "#efe6da";
    ctx.fillRect(x - 3, y - 2, w + 6, h + 8);
    if (canvas) ctx.drawImage(canvas, x, y, w, h);
    else {
      ctx.fillStyle = "#111";
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  function drawLine() {
    for (var i = 0; i < ALBUM_SLOTS.length; i++) {
      if (i < mountedScores.length) {
        drawMini(
          ALBUM_SLOTS[i],
          LINE_Y + 6,
          56,
          37,
          frames[0] ? printFromScore(i) : null,
        );
      } else {
        ctx.fillStyle = "rgba(120,90,86,0.25)";
        ctx.font = "12px ui-monospace, Menlo, Consolas, monospace";
        ctx.textAlign = "center";
        ctx.fillText("\u2717", ALBUM_SLOTS[i] + 28, LINE_Y + 30);
      }
    }
  }

  var miniCache = {};
  function printFromScore(idx) {
    if (miniCache[idx]) return miniCache[idx];
    var c = document.createElement("canvas");
    c.width = PW;
    c.height = PH;
    var g = c.getContext("2d");
    var img = g.createImageData(PW, PH);
    for (var i = 0; i < N; i++) {
      var v = clamp(247 - dispSnap[i] * 238, 0, 255) | 0;
      var k = i * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    miniCache[idx] = c;
    return c;
  }

  function drawEnlarger(active) {
    ctx.fillStyle = "#3a2024";
    ctx.fillRect(452, 84, 12, 392);
    ctx.fillStyle = "#4a282c";
    ctx.fillRect(448, 80, 20, 8);
    ctx.fillStyle = "#3a2024";
    ctx.strokeStyle = "#3a2024";

    ctx.strokeStyle = "#3a2024";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(458, 104);
    ctx.lineTo(268, 104);
    ctx.stroke();

    var headG = ctx.createLinearGradient(0, 108, 0, 176);
    headG.addColorStop(0, "#5a3036");
    headG.addColorStop(1, "#33191d");
    ctx.fillStyle = headG;
    rrPath(ctx, 168, 108, 200, 68, 10);
    ctx.fill();
    ctx.strokeStyle = "#6a3a40";
    ctx.lineWidth = 2;
    rrPath(ctx, 168, 108, 200, 68, 10);
    ctx.stroke();

    ctx.fillStyle = active ? "#ffd9a0" : "#241014";
    rrPath(ctx, 196, 122, 90, 26, 5);
    ctx.fill();
    ctx.fillStyle = active ? "#41250e" : "#170a0c";
    ctx.font = "700 17px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(active ? exposeT.toFixed(1) + "s" : baseTime + "s", 241, 141);

    ctx.fillStyle = "#241014";
    rrPath(ctx, 300, 122, 54, 26, 5);
    ctx.fill();
    ctx.fillStyle = "#8a555c";
    ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillText("KNOBS", 327, 139);

    ctx.fillStyle = "#20100f";
    ctx.beginPath();
    ctx.moveTo(226, 176);
    ctx.lineTo(278, 176);
    ctx.lineTo(268, 196);
    ctx.lineTo(236, 196);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = active ? "#fff3d9" : "#4a2a2e";
    ctx.beginPath();
    ctx.ellipse(252, 200, 13, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    if (active) {
      var pulse = 0.16 + Math.sin(phaseT * 9) * 0.03;
      var cone = ctx.createLinearGradient(0, 200, 0, EASEL_Y + 40);
      cone.addColorStop(0, "rgba(255,236,200," + (pulse + 0.14) + ")");
      cone.addColorStop(1, "rgba(255,236,200," + pulse * 0.5 + ")");
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(240, 202);
      ctx.lineTo(264, 202);
      ctx.lineTo(EASEL_X + PW + 26, EASEL_Y + 30);
      ctx.lineTo(EASEL_X - 26, EASEL_Y + 30);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(EASEL_X - 26, EASEL_Y + 20, PW + 52, PH - 12);
    }
  }

  function drawEasel() {
    ctx.fillStyle = "#241215";
    rrPath(ctx, EASEL_X - 14, EASEL_Y - 14, PW + 28, PH + 28, 8);
    ctx.fill();
    ctx.strokeStyle = "#4a2326";
    ctx.lineWidth = 2;
    rrPath(ctx, EASEL_X - 14, EASEL_Y - 14, PW + 28, PH + 28, 8);
    ctx.stroke();
  }

  function drawPaperOnEasel(alphaGhost, withWand) {
    ctx.save();
    ctx.translate(EASEL_X, EASEL_Y);
    ctx.fillStyle = "#ece7dd";
    ctx.fillRect(0, 0, PW, PH);
    if (alphaGhost) {
      ctx.globalAlpha = 0.22;
      ctx.drawImage(frames[frameIdx].canvas, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (withWand) {
      var wx = wand.x;
      var wy = wand.y;
      var sh = ctx.createRadialGradient(wx, wy, R1 * 0.4, wx, wy, R2);
      sh.addColorStop(0, "rgba(8,4,4,0.85)");
      sh.addColorStop(1, "rgba(8,4,4,0)");
      ctx.fillStyle = sh;
      ctx.beginPath();
      ctx.arc(wx, wy, R2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle =
        wand.mode === "dodge"
          ? "rgba(230,240,255,0.9)"
          : "rgba(255,190,90,0.95)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(wx, wy, (R1 + R2) / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "700 11px ui-monospace, Menlo, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = wand.mode === "dodge" ? "#dfeaff" : "#ffcf8a";
      ctx.fillText(wand.mode === "dodge" ? "DODGE" : "BURN", wx, wy - R2 - 6);
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(40,20,22,0.9)";
    ctx.lineWidth = 3;
    ctx.strokeRect(EASEL_X - 1, EASEL_Y - 1, PW + 2, PH + 2);
  }

  function drawEmptyEaselNote() {
    ctx.fillStyle = "rgba(200,160,150,0.28)";
    ctx.font = "italic 13px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("in the developer\u2026", EASEL_X + PW / 2, EASEL_Y + PH / 2);
  }

  function drawProofBoard() {
    ctx.fillStyle = "#33201a";
    rrPath(ctx, PROOF.x, PROOF.y, PROOF.w, PROOF.h, 8);
    ctx.fill();
    ctx.strokeStyle = "#54332a";
    ctx.lineWidth = 3;
    rrPath(ctx, PROOF.x, PROOF.y, PROOF.w, PROOF.h, 8);
    ctx.stroke();
    if (frames.length) {
      var px = PROOF.x + (PROOF.w - PROOF_PRINT_W) / 2;
      var py = PROOF.y + (PROOF.h - PROOF_PRINT_H) / 2;
      ctx.fillStyle = "#e8dfd2";
      ctx.fillRect(px - 4, py - 4, PROOF_PRINT_W + 8, PROOF_PRINT_H + 8);
      ctx.drawImage(
        frames[Math.min(frameIdx, frames.length - 1)].canvas,
        px,
        py,
        PROOF_PRINT_W,
        PROOF_PRINT_H,
      );
      ctx.fillStyle = "rgba(255,180,84,0.5)";
      ctx.save();
      ctx.translate(px + 10, py + 4);
      ctx.rotate(-0.3);
      ctx.fillRect(-9, -3, 18, 7);
      ctx.restore();
      ctx.save();
      ctx.translate(px + PROOF_PRINT_W - 10, py + 4);
      ctx.rotate(0.3);
      ctx.fillRect(-9, -3, 18, 7);
      ctx.restore();
    }
    ctx.fillStyle = "#9c7a6e";
    ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      "THE PROOF \u2014 match this",
      PROOF.x + PROOF.w / 2,
      PROOF.y + PROOF.h + 16,
    );
  }

  function drawTrayArea() {
    var showPrint =
      phase === "develop" ||
      phase === "rinse" ||
      phase === "grade" ||
      phase === "mount";
    if (!showPrint) {
      ctx.fillStyle = "rgba(200,160,150,0.2)";
      ctx.font = "12px ui-monospace, Menlo, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText("developer tray, waiting", TRAY.x + TRAY.w / 2, TRAY.y + 40);
      return;
    }
    ctx.fillStyle = "#1c0e12";
    rrPath(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, 12);
    ctx.fill();
    ctx.strokeStyle = "#4a2326";
    ctx.lineWidth = 3;
    rrPath(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, 12);
    ctx.stroke();

    var liq = ctx.createLinearGradient(0, TRAY.y + 18, 0, TRAY.y + TRAY.h);
    liq.addColorStop(0, "rgba(120,160,120,0.16)");
    liq.addColorStop(1, "rgba(60,90,70,0.30)");
    ctx.fillStyle = liq;
    rrPath(ctx, TRAY.x + 6, TRAY.y + 6, TRAY.w - 12, TRAY.h - 12, 9);
    ctx.fill();

    var wob = Math.sin(phaseT * 2.1) * 3;
    ctx.strokeStyle = "rgba(190,230,190,0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(TRAY.x + 10, TRAY.y + 22 + wob);
    ctx.quadraticCurveTo(
      TRAY.x + TRAY.w / 2,
      TRAY.y + 16 + wob,
      TRAY.x + TRAY.w - 10,
      TRAY.y + 22 - wob,
    );
    ctx.stroke();

    ctx.save();
    ctx.translate(PRINT_IN_TRAY.x, PRINT_IN_TRAY.y);
    ctx.fillStyle = "#d9cfc0";
    ctx.fillRect(-5, -5, PRINT_IN_TRAY.w + 10, PRINT_IN_TRAY.h + 10);
    ctx.drawImage(printCanvas, 0, 0, PRINT_IN_TRAY.w, PRINT_IN_TRAY.h);
    ctx.restore();

    for (var i = 0; i < bubbles.length; i++) {
      ctx.fillStyle = "rgba(210,240,210,0.35)";
      ctx.beginPath();
      ctx.arc(bubbles[i].x, bubbles[i].y, bubbles[i].r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (phase === "rinse") {
      ctx.strokeStyle = "rgba(200,225,235,0.6)";
      ctx.lineWidth = 2;
      var t = phaseT / 0.8;
      for (var d = 0; d < 5; d++) {
        var dx2 = PRINT_IN_TRAY.x + 30 + d * 50;
        ctx.beginPath();
        ctx.moveTo(dx2, PRINT_IN_TRAY.y - 4);
        ctx.lineTo(dx2, PRINT_IN_TRAY.y + 14 + ((t * 40 + d * 13) % 30));
        ctx.stroke();
      }
    }
  }

  function drawZoneFlash() {
    var ox = PRINT_IN_TRAY.x;
    var oy = PRINT_IN_TRAY.y;
    var zw = PRINT_IN_TRAY.w / 4;
    var zh = PRINT_IN_TRAY.h / 4;
    for (var zy = 0; zy < 4; zy++) {
      for (var zx = 0; zx < 4; zx++) {
        var e = zoneErr[zy * 4 + zx];
        var bad = clamp((e - 0.06) / 0.22, 0, 1);
        var good = clamp((0.1 - e) / 0.1, 0, 1);
        ctx.fillStyle =
          bad > good
            ? "rgba(255,70,50," + (bad * 0.4).toFixed(3) + ")"
            : "rgba(90,220,120," + (good * 0.3).toFixed(3) + ")";
        ctx.fillRect(ox + zx * zw, oy + zy * zh, zw, zh);
      }
    }
  }

  function drawStamp() {
    var cx = 480;
    var cy = 350;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.06);
    var pop = clamp(phaseT / 0.18, 0, 1);
    ctx.scale(pop, pop);
    ctx.globalAlpha = 0.94;
    ctx.strokeStyle = gradeScore >= MOUNT_AT ? "#7ee49a" : "#ff6a55";
    ctx.lineWidth = 4;
    rrPath(ctx, -150, -46, 300, 92, 10);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    rrPath(ctx, -142, -38, 284, 76, 7);
    ctx.stroke();
    ctx.fillStyle = gradeScore >= MOUNT_AT ? "#a5f0bc" : "#ff8a75";
    ctx.font = "700 34px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(gradeVerdict, 0, -2);
    ctx.font = "700 17px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillText(gradeScore + " / 100", 0, 26);
    ctx.restore();
  }

  function drawMountAnim() {
    var t = smoothstep(phaseT / 0.75);
    var tx;
    var ty;
    if (mountKind === "album") {
      var slot = ALBUM_SLOTS[Math.min(albumCount - 1, ALBUM_SLOTS.length - 1)];
      tx = slot;
      ty = LINE_Y + 6;
    } else {
      tx = 980;
      ty = 560;
    }
    var x = lerp(mountFrom.x, tx, t);
    var y = lerp(mountFrom.y, ty, t);
    var w = lerp(PRINT_IN_TRAY.w, 56, t);
    var h = lerp(PRINT_IN_TRAY.h, 37, t);
    ctx.fillStyle = "#d9cfc0";
    ctx.fillRect(
      x - 2 * (w / 56),
      y - 2 * (w / 56),
      w + 4 * (w / 56),
      h + 4 * (w / 56),
    );
    ctx.drawImage(printCanvas, x, y, w, h);
  }

  function drawBanner() {
    if (banner.ttl <= 0) return;
    var a = clamp(banner.ttl / 0.5, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(20,8,10,0.72)";
    ctx.fillRect(140, 96, 420, 58);
    ctx.fillStyle = "#ffd9cf";
    ctx.font = "700 19px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(banner.text, 350, 121);
    if (banner.sub) {
      ctx.fillStyle = "#ffb454";
      ctx.font = "italic 13px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillText(banner.sub, 350, 143);
    }
    ctx.globalAlpha = 1;
  }

  function drawHintLine() {
    var msg = "";
    if (phase === "ready")
      msg =
        "set the base time, then HOLD EXPOSE \u2014 steer the wand over the ghost";
    else if (phase === "expose")
      msg =
        wand.mode === "dodge"
          ? "holding light BACK here \u2014 X or BURN flips the wand"
          : "pouring EXTRA light here \u2014 X flips back to dodge";
    else if (phase === "develop")
      msg = "watch it come up \u2014 LIFT when the tones meet the proof";
    if (!msg) return;
    ctx.fillStyle = "rgba(220,180,165,0.62)";
    ctx.font = "12.5px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(msg, 350, 172);
  }

  function drawDevMeter() {
    if (phase !== "develop") return;
    var mx = 528;
    var my = 306;
    var mh = 160;
    ctx.fillStyle = "rgba(20,10,12,0.7)";
    rrPath(ctx, mx - 10, my - 14, 22, mh + 28, 6);
    ctx.fill();
    var p = clamp(devClock / (devT * 0.82), 0, 1);
    var fog = clamp((devClock - devT * 1.02) / (devT * 0.5), 0, 1);
    ctx.fillStyle = "#3a5a40";
    ctx.fillRect(mx - 4, my + mh * (1 - p), 10, mh * p);
    if (fog > 0) {
      ctx.fillRect(mx - 4, my + mh - mh * fog, 10, mh * fog);

      ctx.fillRect(mx - 4, my + mh * (1 - fog) * 0, 10, mh * fog);
    }
    ctx.strokeStyle = "#7ea886";
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - 4, my, 10, mh);
    ctx.fillStyle = "#c9a49b";
    ctx.font = "9px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.save();
    ctx.translate(mx + 1, my + mh + 24);
    ctx.fillText("DEV", 0, 0);
    ctx.restore();
  }

  function draw() {
    drawRoom();
    drawLine();
    drawProofBoard();
    drawEnlarger(phase === "expose");
    drawEasel();

    if (phase === "ready") {
      drawPaperOnEasel(false, false);
    } else if (phase === "expose") {
      drawPaperOnEasel(true, true);
    } else if (phase === "develop" || phase === "rinse" || phase === "grade") {
      drawEmptyEaselNote();
    } else if (phase === "mount") {
      drawEmptyEaselNote();
    } else {
      drawPaperOnEasel(true, false);
    }

    renderDisp(phase === "grade" || phase === "mount" ? dispSnap : disp);
    drawTrayArea();
    drawDevMeter();
    if (phase === "grade") {
      drawZoneFlash();
      drawStamp();
    }
    if (phase === "mount") drawMountAnim();
    drawBanner();
    drawHintLine();
  }

  /* ---------- debug hook (only with #test in the URL) ---------- */

  if (testMode) {
    window.__sl = {
      phase: function () {
        return phase;
      },
      frame: function () {
        return frameIdx + 1;
      },
      album: function () {
        return albumCount;
      },
      sheets: function () {
        return sheets;
      },
      clock: function () {
        return clock;
      },
      lastScore: function () {
        return gradeScore;
      },
      exposeFor: function (secs, bx, by) {
        baseTime = clamp(secs, BASE_MIN, BASE_MAX);
        wand.x = bx == null ? PW / 2 : bx;
        wand.y = by == null ? PH / 2 : by;
        beginExpose();
      },
      finishExpose: function () {
        endExpose();
      },
      fastForward: function () {
        if (phase === "develop") devClock = devT;
      },
      winNow: function () {
        albumCount = ALBUM_NEED;
        mountedScores = [91, 84, 77, 88];
        showWin();
      },
      loseNow: function (why) {
        showLose(why || "dawn");
      },
      goto: function (n) {
        frameIdx = clamp(n - 1, 0, FRAMES_NEEDED - 1);
        sheets = SHEETS_TOTAL;
        clock = NIGHT_SECONDS;
        albumCount = 0;
        mountedScores = [];
        printed = frameIdx;
        setupFrame();
      },
      instant: function (secs) {
        if (phase !== "ready") return;
        exposing = true;
        phase = "expose";
        for (var i = 0; i < N; i++) exp[i] = Math.max(secs, 0.0001);
        exposeT = secs;
        fanOff();
        endExpose();
      },
      dismiss: function () {
        veilOpen = false;
        veil.classList.add("hidden");
        paused = false;
      },
    };
  }

  /* ---------- main loop ---------- */

  var lastT = 0;
  function loop(t) {
    var dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;
    if (!paused && !veilOpen) update(dt);
    if (frames.length) draw();
    requestAnimationFrame(loop);
  }

  buildRoll();
  syncChips();
  syncPads();
  showTitle();
  requestAnimationFrame(loop);
})();
