/*
 * Star Shell — a fireworks choreography game for bonfire night.
 *
 * You are the pyrotechnician on a harbour jetty. Each night brings a written
 * commission: bloom the asked colours inside its rings before the show clock
 * runs out. Every tube holds one shell; the fuse you set is how many seconds
 * from firing to burst, so the whole art is planting shots early enough that
 * several bloom together while the powder rack lasts. Five nights, one tide.
 *
 * Everything lives in this one classic script, wrapped in an IIFE. All sound
 * is synthesised with the Web Audio API; all art is drawn on one canvas.
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
  function randInt(a, b) {
    return Math.floor(rand(a, b + 1));
  }
  function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }
  function $(id) {
    return document.getElementById(id);
  }

  var scene = $("scene");
  var ctx = scene.getContext("2d");

  var ui = {
    nightlabel: $("nightlabel"),
    score: $("score"),
    cname: $("cname"),
    clist: $("clist"),
    clockwrap: $("clockwrap"),
    clockbar: $("clockbar"),
    windglyph: $("windglyph"),
    windfill: $("windfill"),
    tubes: $("tubes"),
    shellpips: $("shellpips"),
    palette: $("palette"),
    fuselabel: $("fuselabel"),
    fuseless: $("fuseless"),
    fusemore: $("fusemore"),
    pausebtn: $("pausebtn"),
    mutebtn: $("mutebtn"),
    overlay: $("overlay"),
    card: $("card"),
  };

  /* ================================ audio =============================== */

  var actx = null;
  var master = null;
  var noiseBuf = null;
  var muted = false;

  function ensureAudio() {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        return false;
      }
      actx = new AC();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      var comp = actx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      master.connect(comp);
      comp.connect(actx.destination);
      var len = Math.floor(actx.sampleRate * 1.4);
      noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        d[i] = Math.random() * 2 - 1;
      }
    }
    if (actx.state === "suspended") {
      actx.resume();
    }
    return true;
  }

  function setMuted(m) {
    muted = m;
    if (master) {
      master.gain.value = muted ? 0 : 0.55;
    }
    ui.mutebtn.textContent = muted ? "\u2715" : "\u266a";
  }

  function playNoise(dur, fStart, fEnd, vol, curveSpikes) {
    if (!ensureAudio()) {
      return;
    }
    var t = actx.currentTime;
    var src = actx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var lp = actx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(fStart, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), t + dur);
    var g = actx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    if (curveSpikes) {
      var n = 48;
      var curve = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        curve[i] = Math.random() < 0.45 ? rand(0.3, 1) : rand(0, 0.12);
      }
      g.gain.setValueCurveAtTime(curve, t + 0.05, dur * 0.8);
    }
    src.connect(lp);
    lp.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function playTone(type, f0, f1, dur, vol, when) {
    if (!ensureAudio()) {
      return;
    }
    var t = actx.currentTime + (when || 0);
    var o = actx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function sfxLaunch(fuse) {
    playNoise(0.22, 320, 90, 0.5);
    playTone("sine", 110, 60, 0.28, 0.4);
  }

  function sfxWhistle(shell, fuse) {
    if (!ensureAudio()) {
      return;
    }
    var t = actx.currentTime;
    var o = actx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + fuse * 0.85);
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.055, t + 0.12);
    g.gain.setValueAtTime(0.055, t + fuse * 0.8);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + fuse + 0.05);
    shell.whistle = { o: o, g: g };
  }

  function stopWhistle(shell) {
    if (shell.whistle && actx) {
      try {
        shell.whistle.g.gain.cancelScheduledValues(actx.currentTime);
        shell.whistle.o.stop(actx.currentTime + 0.02);
      } catch (e) {
        /* already stopped */
      }
      shell.whistle = null;
    }
  }

  function sfxBurst() {
    playNoise(1.05, 900, 110, 0.85);
    playTone("sine", 74, 36, 0.5, 0.5);
  }

  function sfxCrackle() {
    playNoise(1.1, 5200, 2600, 0.32, true);
  }

  function sfxClick() {
    playTone("square", 330, 300, 0.05, 0.09);
  }

  function sfxDeny() {
    playTone("square", 150, 110, 0.09, 0.12);
  }

  function sfxZoneDone() {
    playTone("triangle", 660, 660, 0.12, 0.16);
    playTone("triangle", 990, 990, 0.16, 0.14, 0.09);
  }

  function sfxNightClear() {
    var seq = [523, 659, 784, 1046];
    for (var i = 0; i < seq.length; i++) {
      playTone("triangle", seq[i], seq[i], 0.22, 0.17, i * 0.11);
    }
  }

  function sfxFlop() {
    playTone("sawtooth", 210, 82, 0.8, 0.22);
    playTone("sawtooth", 105, 55, 0.9, 0.16, 0.05);
  }

  /* ============================ colour palette ========================== */

  var COLORS = {
    gold: { hue: 46, sat: 100, name: "gold", css: "#ffd98c" },
    crimson: { hue: 352, sat: 92, name: "crimson", css: "#ff97a0" },
    violet: { hue: 274, sat: 88, name: "violet", css: "#c9a6ff" },
    silver: { hue: 214, sat: 18, name: "silver", css: "#eef4ff" },
  };

  /* =========================== night commissions ======================== */

  var NIGHTS = [
    {
      name: "The Harbourmaster's Welcome",
      flavor:
        "A gentle opener. The harbourmaster wants gold over the anchorage before the tide turns.",
      clock: 70,
      wind: 0.08,
      tubes: 4,
      shells: 7,
      zones: [
        {
          x: 0.56,
          y: 0.33,
          r: 0.115,
          color: "gold",
          need: 4,
          label: "the anchorage",
        },
      ],
    },
    {
      name: "The Fishwives' Waltz",
      flavor:
        "Two balconies, two colours. Keep both ends of the sky busy at once.",
      clock: 72,
      wind: 0.22,
      tubes: 4,
      shells: 10,
      zones: [
        {
          x: 0.24,
          y: 0.28,
          r: 0.1,
          color: "violet",
          need: 3,
          label: "the west cliff",
        },
        {
          x: 0.76,
          y: 0.23,
          r: 0.1,
          color: "silver",
          need: 3,
          label: "the church tower",
        },
      ],
    },
    {
      name: "The Lighthouse Ring",
      flavor:
        "The keeper swears the old tower was courted once. Crimson twice at once, they say.",
      clock: 66,
      wind: 0.3,
      tubes: 4,
      shells: 12,
      zones: [
        {
          lighthouse: true,
          color: "crimson",
          salvo: 2,
          r: 0.09,
          label: "the lantern room",
        },
        {
          x: 0.42,
          y: 0.46,
          r: 0.105,
          color: "gold",
          need: 3,
          label: "the mole",
        },
      ],
    },
    {
      name: "The Packet Boat",
      flavor:
        "Last packet of the season steaming in. Gild her crossing - she will not wait.",
      clock: 68,
      wind: 0.42,
      tubes: 4,
      shells: 12,
      zones: [
        {
          moving: { x0: 0.18, x1: 0.8, y: 0.37, speed: 0.16 },
          r: 0.12,
          color: "gold",
          need: 3,
          label: "the packet boat",
        },
        {
          x: 0.6,
          y: 0.19,
          r: 0.095,
          color: "silver",
          need: 2,
          label: "high water",
        },
      ],
    },
    {
      name: "The Grand Finale",
      flavor:
        "Five racks, the whole bay watching. End the season with the sky on fire.",
      clock: 80,
      wind: 0.5,
      tubes: 5,
      shells: 16,
      zones: [
        {
          lighthouse: true,
          color: "crimson",
          salvo: 2,
          r: 0.09,
          label: "the lantern room",
        },
        {
          moving: { x0: 0.16, x1: 0.82, y: 0.29, speed: 0.2 },
          r: 0.115,
          color: "gold",
          need: 3,
          label: "the packet boat",
        },
        {
          x: 0.3,
          y: 0.21,
          r: 0.095,
          color: "violet",
          need: 3,
          label: "the west cliff",
        },
      ],
    },
  ];

  /* ================================ state =============================== */

  var state = {
    phase: "title", // title | intro | show | clear | gameover | season
    paused: false,
    nightIndex: 0,
    clock: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    shellsLeft: 0,
    fuse: 2,
    chosenColour: "gold",
    selectedTube: 0,
    time: 0,
    nightPoints: 0,
    failReason: "",
    recentHits: [],
  };

  var tubes = []; // { reload, x, y }
  var shells = []; // airborne
  var particles = [];
  var zones = [];

  var aim = { x: 0, y: 0 };
  var keys = {};
  var stars = [];
  var shimmer = [];
  var townRows = [];
  var vignette = null;

  var W = 0;
  var H = 0;

  function layoutAnchors() {
    return {
      waterY: H * 0.78,
      jettyX0: W * 0.05,
      jettyX1: W * 0.3,
      jettyY: H * 0.885,
      lhX: W * 0.855,
      lhBaseY: H * 0.8,
      lhH: H * 0.34,
      firstTubeX: W * 0.072,
      tubeGap: Math.min(38, W * 0.03),
      minY: H * 0.1,
      maxY: H * 0.5,
    };
  }

  function lighthouseLamp(a) {
    a = a || layoutAnchors();
    return { x: a.lhX, y: a.lhBaseY - a.lhH + 8 };
  }

  /* ============================== resizing ============================== */

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    scene.width = Math.floor(W * dpr);
    scene.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    stars = [];
    for (var i = 0; i < 120; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H * 0.68,
        r: rand(0.4, 1.4),
        tw: rand(1.5, 4),
        ph: rand(0, TAU),
      });
    }
    shimmer = [];
    for (var j = 0; j < 42; j++) {
      shimmer.push({
        x: Math.random() * W,
        y: 0,
        len: rand(14, 60),
        sp: rand(4, 16),
        al: rand(0.04, 0.14),
      });
      shimmer[j].y = H * 0.79 + Math.random() * (H * 0.19);
    }
    townRows = [];
    var bx = -20;
    while (bx < W + 40) {
      var bw = rand(18, 46);
      var bh = rand(12, 36);
      var wins = [];
      var wn = randInt(0, 3);
      for (var k = 0; k < wn; k++) {
        wins.push({ dx: rand(3, bw - 6), dy: rand(3, bh - 6) });
      }
      townRows.push({ x: bx, w: bw, h: bh, wins: wins });
      bx += bw + rand(2, 8);
    }

    vignette = ctx.createRadialGradient(
      W / 2,
      H / 2,
      Math.min(W, H) * 0.36,
      W / 2,
      H / 2,
      Math.max(W, H) * 0.72,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,5,0.5)");

    clampAim();
  }

  function clampAim() {
    var a = layoutAnchors();
    aim.x = clamp(aim.x, W * 0.06, W * 0.94);
    aim.y = clamp(aim.y, a.minY, a.maxY);
  }

  window.addEventListener("resize", resize);

  /* ============================ night setup ============================= */

  function setupNight(idx) {
    var cfg = NIGHTS[idx];
    var a = layoutAnchors();
    state.nightIndex = idx;
    state.clock = cfg.clock;
    state.combo = 0;
    state.bestCombo = 0;
    state.shellsLeft = cfg.shells;
    state.nightPoints = 0;
    state.failReason = "";
    state.recentHits = [];
    state.selectedTube = 0;
    state.paused = false;
    state.chosenColour = cfg.zones[0].color;

    tubes = [];
    for (var i = 0; i < cfg.tubes; i++) {
      tubes.push({
        reload: 0,
        x: a.firstTubeX + i * a.tubeGap,
        y: a.jettyY - 6,
      });
    }
    var lamp = lighthouseLamp(a);
    zones = [];
    for (var z = 0; z < cfg.zones.length; z++) {
      var spec = cfg.zones[z];
      zones.push({
        spec: spec,
        hits: 0,
        done: false,
        salvoDone: false,
        phase: rand(0, TAU),
        lx: lamp.x,
        ly: lamp.y,
      });
    }
    for (var w = 0; w < shells.length; w++) {
      stopWhistle(shells[w]);
    }
    shells.length = 0;
    particles.length = 0;
    buildTubeDom();
    buildPips();
    buildCommissionList();
    syncStatic();
  }

  function zonePos(z, t) {
    var spec = z.spec;
    if (spec.moving) {
      var m = spec.moving;
      var fx = 0.5 + 0.5 * Math.sin(t * m.speed * TAU + z.phase);
      return { x: lerp(W * m.x0, W * m.x1, fx), y: H * m.y };
    }
    if (spec.lighthouse) {
      return { x: z.lx, y: z.ly };
    }
    return { x: W * spec.x, y: H * spec.y };
  }

  function zoneRadius(z) {
    return H * z.spec.r;
  }

  /* ============================== DOM sync ============================== */

  function buildTubeDom() {
    ui.tubes.textContent = "";
    for (var i = 0; i < tubes.length; i++) {
      var d = document.createElement("div");
      d.className = "tube";
      var n = document.createElement("span");
      n.textContent = String(i + 1);
      var r = document.createElement("span");
      r.className = "reload";
      var bar = document.createElement("i");
      r.appendChild(bar);
      d.appendChild(n);
      d.appendChild(r);
      ui.tubes.appendChild(d);
    }
  }

  function buildPips() {
    ui.shellpips.textContent = "";
    var cfg = NIGHTS[state.nightIndex];
    for (var i = 0; i < cfg.shells; i++) {
      var s = document.createElement("i");
      s.textContent = "\u2726";
      if (i >= state.shellsLeft) {
        s.className = "spent";
      }
      ui.shellpips.appendChild(s);
    }
  }

  function commissionText(z) {
    var c = COLORS[z.spec.color].name;
    if (z.spec.salvo) {
      return z.spec.label + " \u00b7 a pair of " + c + " bursting together";
    }
    return z.spec.label + " \u00b7 " + c + " \u00d7 " + z.spec.need;
  }

  function buildCommissionList() {
    ui.cname.textContent = NIGHTS[state.nightIndex].name;
    ui.clist.textContent = "";
    for (var i = 0; i < zones.length; i++) {
      var li = document.createElement("li");
      var pip = document.createElement("span");
      pip.className = "pip";
      pip.textContent = "\u25c7";
      var txt = document.createElement("span");
      txt.textContent = commissionText(zones[i]);
      li.appendChild(pip);
      li.appendChild(txt);
      ui.clist.appendChild(li);
    }
    syncCommissionList();
  }

  function syncCommissionList() {
    var lis = ui.clist.children;
    for (var i = 0; i < lis.length; i++) {
      var z = zones[i];
      lis[i].className = z.done ? "done" : "";
      lis[i].firstChild.textContent = z.done ? "\u2713" : "\u25c7";
      if (z.spec.salvo) {
        lis[i].lastChild.textContent = commissionText(z);
      } else {
        lis[i].lastChild.textContent =
          z.spec.label +
          " \u00b7 " +
          COLORS[z.spec.color].name +
          " \u00d7 " +
          Math.min(z.hits, z.spec.need) +
          "/" +
          z.spec.need;
      }
    }
  }

  function syncStatic() {
    ui.nightlabel.textContent = "Night " + (state.nightIndex + 1);
    ui.score.textContent = String(state.score);
    ui.fuselabel.textContent =
      "fuse " + state.fuse.toFixed(2).replace(/0$/, "") + "s";
  }

  function syncFrame() {
    ui.clockbar.style.width =
      (
        (clamp(state.clock, 0, NIGHTS[state.nightIndex].clock) /
          NIGHTS[state.nightIndex].clock) *
        100
      ).toFixed(1) + "%";
    ui.clockwrap.className =
      state.clock < 12 && state.phase === "show" ? "low" : "";

    var cfg = NIGHTS[state.nightIndex];
    var w = cfg.wind * (0.7 + 0.3 * Math.sin(state.time * 0.5));
    ui.windfill.style.width = Math.round((clamp(w, 0, 0.7) / 0.7) * 100) + "%";

    var kids = ui.tubes.children;
    for (var i = 0; i < kids.length; i++) {
      var t = tubes[i];
      kids[i].className = "tube " + (t.reload <= 0 ? "ready" : "");
      if (i === state.selectedTube && t.reload <= 0) {
        kids[i].className += " selected";
      }
      kids[i].lastChild.firstChild.style.width =
        t.reload > 0
          ? ((1 - t.reload / tubeReloadTime()) * 100).toFixed(0) + "%"
          : "100%";
    }
    ui.score.textContent = String(state.score);
  }

  function tubeReloadTime() {
    return 3.2;
  }

  /* =============================== input ================================ */

  function selectReadyTube(pref) {
    if (pref >= 0 && pref < tubes.length && tubes[pref].reload <= 0) {
      state.selectedTube = pref;
      return true;
    }
    for (var i = 0; i < tubes.length; i++) {
      if (tubes[i].reload <= 0) {
        state.selectedTube = i;
        return true;
      }
    }
    return false;
  }

  function fireSelected() {
    if (state.phase !== "show" || state.paused) {
      return;
    }
    if (!selectReadyTube(state.selectedTube)) {
      sfxDeny();
      flashFuse();
      return;
    }
    var tube = tubes[state.selectedTube];
    if (state.shellsLeft <= 0) {
      sfxDeny();
      return;
    }
    state.shellsLeft -= 1;
    buildPips();
    tube.reload = tubeReloadTime();

    var drift = windNow() * state.fuse * 30;
    var shell = {
      x0: tube.x + 6,
      y0: tube.y - 14,
      tx: aim.x + drift,
      ty: aim.y,
      fuse: state.fuse,
      age: 0,
      color: COLORS.gold.name,
      trail: [],
      whistle: null,
    };
    shell.tx = clamp(shell.tx, W * 0.04, W * 0.96);
    shell.color = state.chosenColour;
    shells.push(shell);
    sfxLaunch(shell.fuse);
    sfxWhistle(shell, shell.fuse);

    for (var i = 0; i < 10; i++) {
      particles.push({
        x: shell.x0,
        y: shell.y0,
        vx: rand(-70, 70),
        vy: rand(-160, -30),
        life: rand(0.15, 0.4),
        max: 0.4,
        size: rand(1, 2.2),
        hue: 40,
        sat: 90,
        lum: 70,
        delay: 0,
      });
    }
    selectReadyTube(-1);
  }


  function flashFuse() {
    ui.fuselabel.style.color = "#e88a6a";
    setTimeout(function () {
      ui.fuselabel.style.color = "";
    }, 220);
  }

  function adjustFuse(d) {
    state.fuse = clamp(Math.round((state.fuse + d) * 4) / 4, 0.75, 4);
    ui.fuselabel.textContent =
      "fuse " +
      state.fuse.toFixed(2).replace(/\.00$/, "").replace(/0$/, "") +
      "s";
    sfxClick();
  }

  function pointerPos(e) {
    var r = scene.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  scene.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    ensureAudio();
    if (state.phase !== "show" || state.paused) {
      return;
    }
    var p = pointerPos(e);
    aim.x = p.x;
    aim.y = p.y;
    clampAim();
    fireSelected();
  });

  scene.addEventListener("pointermove", function (e) {
    var p = pointerPos(e);
    aim.x = p.x;
    aim.y = p.y;
    clampAim();
  });

  scene.addEventListener(
    "wheel",
    function (e) {
      e.preventDefault();
      adjustFuse(e.deltaY < 0 ? 0.25 : -0.25);
    },
    { passive: false },
  );

  scene.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        " ",
        "Backspace",
      ].indexOf(k) >= 0
    ) {
      e.preventDefault();
    }
    if (k === "m" || k === "M") {
      ensureAudio();
      setMuted(!muted);
      return;
    }
    if (k === "r" || k === "R") {
      restartRun();
      return;
    }
    if ((k === "p" || k === "P") && state.phase === "show") {
      togglePause();
      return;
    }
    if (k === "Enter" || k === " ") {
      if (state.phase !== "show") {
        var go = ui.card.querySelector("button.go");
        if (go) {
          go.click();
          return;
        }
      }
    }
    if (state.phase !== "show" || state.paused) {
      return;
    }
    if (k === " ") {
      fireSelected();
      return;
    }
    if (k === "c" || k === "C") {
      cycleColour();
      sfxClick();
      return;
    }
    if (k === "-" || k === "_" || k === "[") {
      adjustFuse(-0.25);
      return;
    }
    if (k === "=" || k === "+" || k === "]" || k === ";") {
      adjustFuse(0.25);
      return;
    }
    var num = parseInt(k, 10);
    if (num >= 1 && num <= tubes.length) {
      if (tubes[num - 1].reload <= 0) {
        state.selectedTube = num - 1;
        fireSelected();
      } else {
        sfxDeny();
      }
      return;
    }
    keys[k] = true;
    keys[k.toLowerCase()] = true;
  });

  window.addEventListener("keyup", function (e) {
    keys[e.key] = false;
    keys[e.key.toLowerCase()] = false;
  });

  ui.fuseless.addEventListener("click", function () {
    ensureAudio();
    adjustFuse(-0.25);
  });
  ui.fusemore.addEventListener("click", function () {
    ensureAudio();
    adjustFuse(0.25);
  });
  ui.pausebtn.addEventListener("click", function () {
    if (state.phase === "show") {
      togglePause();
    }
  });
  ui.mutebtn.addEventListener("click", function () {
    ensureAudio();
    setMuted(!muted);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state.phase === "show" && !state.paused) {
      togglePause();
    }
  });

  /* ============================ overlay cards =========================== */

  function showCard(html) {
    ui.card.innerHTML = html;
    ui.overlay.classList.add("shown");
  }

  function hideCard() {
    ui.overlay.classList.remove("shown");
    ui.card.innerHTML = "";
  }

  function titleCard() {
    state.phase = "title";
    showCard(
      "<h2>Star Shell</h2>" +
        '<p class="flavor">Bonfire night on the harbour jetty. The town has paid for five displays, the powder is counted, and the tide will not wait.</p>' +
        '<ul class="howto">' +
        "<li><b>Tap or click the sky</b> to aim a ready tube and fire it there. Arrows or WASD aim too; space fires.</li>" +
        "<li><b>The fuse is everything.</b> It sets the seconds from firing to burst, so plant shots early and let several bloom together. Set it with &minus; / + or the mouse wheel.</li>" +
        "<li><b>Choose your shells</b>: tap a coloured chip (or press C) to load that colour, then bloom the commission's asked colours inside its dashed rings before the show clock ends. Some rings want a pair bursting together.</li>" +
        "<li><b>Mind the powder.</b> You carry a counted rack of shells each night. Run dry or run late and the season folds.</li>" +
        "</ul>" +
        '<div class="specs"><span>Nights <b>5</b></span><span>Tubes <b>4&ndash;5</b></span><span>Powder <b>strictly counted</b></span></div>' +
        '<button class="go" type="button">Light the first fuse</button>' +
        '<p class="fineprint">P pause &middot; M sound &middot; R restart</p>',
    );
    var go = ui.card.querySelector("button.go");
    go.addEventListener("click", function () {
      ensureAudio();
      introCard(0);
    });
  }

  function introCard(idx) {
    state.phase = "intro";
    setupNight(idx);
    var cfg = NIGHTS[idx];
    var items = "";
    for (var i = 0; i < cfg.zones.length; i++) {
      items += "<li>" + commissionTextRuntime(cfg.zones[i]) + "</li>";
    }
    showCard(
      "<h3>Night " +
        (idx + 1) +
        " &mdash; " +
        cfg.name +
        "</h3>" +
        '<p class="flavor">' +
        cfg.flavor +
        "</p>" +
        '<ul class="howto">' +
        items +
        "</ul>" +
        '<div class="specs"><span>Clock <b>' +
        cfg.clock +
        "s</b></span><span>Shells <b>" +
        cfg.shells +
        "</b></span><span>Tubes <b>" +
        cfg.tubes +
        "</b></span><span>Wind <b>" +
        windWord(cfg.wind) +
        "</b></span></div>" +
        '<button class="go" type="button">Show time</button>',
    );
    var go = ui.card.querySelector("button.go");
    go.addEventListener("click", function () {
      ensureAudio();
      state.phase = "show";
      hideCard();
    });
  }

  function commissionTextRuntime(spec) {
    var c = COLORS[spec.color].name;
    if (spec.salvo) {
      return (
        "<b>A pair of " + c + "</b>, bursting together, over " + spec.label
      );
    }
    return (
      "<b>" +
      spec.need +
      " " +
      c +
      "</b> bursts inside the ring over " +
      spec.label
    );
  }

  function windWord(w) {
    if (w < 0.15) {
      return "barely a breath";
    }
    if (w < 0.3) {
      return "light";
    }
    if (w < 0.45) {
      return "freshening";
    }
    return "gusting";
  }

  function clearCard() {
    var cfg = NIGHTS[state.nightIndex];
    var timeBonus = Math.ceil(state.clock) * 10;
    var powderBonus = state.shellsLeft * 15;
    var total = state.nightPoints + timeBonus + powderBonus;
    state.score += timeBonus + powderBonus;
    syncStatic();
    sfxNightClear();
    if (state.nightIndex >= NIGHTS.length - 1) {
      state.phase = "season";
      showCard(
        "<h3>The Season Is Won</h3>" +
          '<p class="flavor">Five displays, every commission met. The bay will talk about this bonfire night for years, and the harbourmaster is already reaching for next year\'s purse.</p>' +
          '<div class="specs"><span>Final score <b>' +
          state.score +
          "</b></span><span>Best chain <b>&times;" +
          Math.max(1, state.bestCombo) +
          "</b></span></div>" +
          '<button class="go" type="button">Run the season again</button>',
      );
      ui.card.querySelector("button.go").addEventListener("click", function () {
        introCard(0);
      });
      return;
    }
    state.phase = "clear";
    showCard(
      "<h3>Night " +
        (state.nightIndex + 1) +
        " clear</h3>" +
        '<p class="flavor">' +
        cfg.flavor +
        "</p>" +
        '<div class="specs"><span>Bursts <b>' +
        state.nightPoints +
        "</b></span><span>Time bonus <b>" +
        timeBonus +
        "</b></span><span>Powder saved <b>" +
        powderBonus +
        "</b></span></div>" +
        '<button class="go" type="button">On to night ' +
        (state.nightIndex + 2) +
        "</button>",
    );
    ui.card.querySelector("button.go").addEventListener("click", function () {
      introCard(state.nightIndex + 1);
    });
  }

  function gameOverCard(reason) {
    state.phase = "gameover";
    sfxFlop();
    var line =
      reason === "clock"
        ? "The show clock ran down with the commission unmet. The crowd drifts to the chippy, and the committee crosses your name off next year's bill."
        : "The racks ran dry mid-display. A fireworks man with no powder is just a man in a cold field.";
    showCard(
      "<h3>The Season Folds</h3>" +
        '<p class="flavor">' +
        line +
        "</p>" +
        '<div class="specs"><span>Nights cleared <b>' +
        state.nightIndex +
        "</b></span><span>Score <b>" +
        state.score +
        "</b></span></div>" +
        '<button class="go" type="button">Strike another match</button>',
    );
    ui.card.querySelector("button.go").addEventListener("click", function () {
      introCard(0);
    });
  }

  function pauseCard() {
    showCard(
      "<h3>Paused</h3>" +
        '<ul class="howto">' +
        "<li><b>Tap / click the sky</b> or press space to fire a ready tube where you aimed.</li>" +
        "<li><b>Fuse (&minus; / +)</b> sets seconds until the burst. Long fuses let plans stack.</li>" +
        "<li><b>C / colour chips</b> load the tube with that shell.</li>" +
        "<li><b>1&ndash;" +
        tubes.length +
        "</b> pick a tube. The rings mark the commission; the clock and powder rack end the night.</li>" +
        "</ul>" +
        '<button class="go" type="button">Back to the show</button>',
    );
    ui.card.querySelector("button.go").addEventListener("click", function () {
      togglePause();
    });
  }

  function togglePause() {
    if (state.phase !== "show") {
      return;
    }
    state.paused = !state.paused;
    if (state.paused) {
      pauseCard();
    } else {
      hideCard();
    }
  }

  function restartRun() {
    hideCard();
    introCard(0);
  }

  /* ============================== updating ============================== */

  function update(dt) {
    state.time += dt;

    if (state.phase === "show" && !state.paused) {
      state.clock -= dt;
      if (state.clock <= 0) {
        state.clock = 0;
        finishFail("clock");
        return;
      }

      var moved = false;
      var sp = 340 * dt;
      if (keys["ArrowLeft"] || keys["a"]) {
        aim.x -= sp;
        moved = true;
      }
      if (keys["ArrowRight"] || keys["d"]) {
        aim.x += sp;
        moved = true;
      }
      if (keys["ArrowUp"] || keys["w"]) {
        aim.y -= sp;
        moved = true;
      }
      if (keys["ArrowDown"] || keys["s"]) {
        aim.y += sp;
        moved = true;
      }
      if (moved) {
        clampAim();
      }

      for (var i = 0; i < tubes.length; i++) {
        if (tubes[i].reload > 0) {
          tubes[i].reload = Math.max(0, tubes[i].reload - dt);
        }
      }

      for (var s = shells.length - 1; s >= 0; s--) {
        var sh = shells[s];
        sh.age += dt;
        if (sh.age >= sh.fuse) {
          stopWhistle(sh);
          doBurst(sh);
          shells.splice(s, 1);
        }
      }

      var anyAir = shells.length > 0;
      if (state.shellsLeft <= 0 && !anyAir && !allZonesDone()) {
        finishFail("powder");
        return;
      }
      if (allZonesDone()) {
        finishClear();
        return;
      }
    }

    var windPx = windNow() * 95;
    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      if (pt.delay > 0) {
        pt.delay -= dt;
        continue;
      }
      pt.life -= dt;
      if (pt.life <= 0) {
        particles.splice(p, 1);
        continue;
      }
      pt.vx *= Math.pow(0.32, dt);
      pt.vy = pt.vy * Math.pow(0.42, dt) + 46 * dt;
      pt.x += (pt.vx + windPx) * dt;
      pt.y += pt.vy * dt;
    }
    if (particles.length > 1500) {
      particles.splice(0, particles.length - 1500);
    }
  }

  function windNow() {
    var cfg = NIGHTS[state.nightIndex];
    return (
      cfg.wind *
      (0.75 +
        0.25 * Math.sin(state.time * 0.5) +
        0.12 * Math.sin(state.time * 1.7))
    );
  }

  function allZonesDone() {
    for (var i = 0; i < zones.length; i++) {
      if (!zones[i].done) {
        return false;
      }
    }
    return zones.length > 0;
  }

  function shellPos(sh) {
    var t = clamp(sh.age / sh.fuse, 0, 1);
    var e = easeOutQuad(t);
    var bow = Math.sin(Math.PI * t) * 0.05;
    var dx = sh.tx - sh.x0;
    var dy = sh.ty - sh.y0;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x: lerp(sh.x0, sh.tx, e),
      y: lerp(sh.y0, sh.ty, e) - dist * bow * (dy < 0 ? 1 : 0.4),
    };
  }

  function doBurst(sh) {
    var c = COLORS[sh.color];
    var count = sh.color === "silver" ? 58 : sh.color === "gold" ? 48 : 42;
    var speedBase = zoneRadius(zones[0]) * rand(2.2, 2.8);
    for (var i = 0; i < count; i++) {
      var ang = (i / count) * TAU + rand(-0.06, 0.06);
      var spd = speedBase * rand(0.55, 1.15);
      particles.push({
        x: sh.tx,
        y: sh.ty,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: rand(1.1, 1.9),
        max: 1.9,
        size: rand(1.4, 2.6),
        hue: c.hue + rand(-8, 8),
        sat: c.sat,
        lum: rand(58, 86),
        delay: 0,
      });
    }
    if (sh.color === "violet") {
      for (var v = 0; v < 16; v++) {
        var va = rand(0, TAU);
        var vs = speedBase * rand(0.15, 0.4);
        particles.push({
          x: sh.tx,
          y: sh.ty,
          vx: Math.cos(va) * vs,
          vy: Math.sin(va) * vs,
          life: rand(1.6, 2.3),
          max: 2.3,
          size: rand(1, 1.8),
          hue: c.hue + rand(-10, 10),
          sat: c.sat,
          lum: rand(60, 84),
          delay: rand(0.12, 0.3),
        });
      }
    }
    if (sh.color === "silver") {
      for (var cr = 0; cr < 26; cr++) {
        particles.push({
          x: sh.tx + rand(-speedBase * 0.7, speedBase * 0.7),
          y: sh.ty + rand(-speedBase * 0.7, speedBase * 0.7),
          vx: rand(-14, 14),
          vy: rand(-10, 26),
          life: rand(0.12, 0.3),
          max: 0.3,
          size: rand(1, 2),
          hue: 214,
          sat: 20,
          lum: 92,
          delay: rand(0.15, 1.15),
        });
      }
      sfxCrackle();
    }
    sfxBurst();

    if (state.phase !== "show") {
      return;
    }

    var hitZone = null;
    for (var z = 0; z < zones.length; z++) {
      var zo = zones[z];
      if (zo.done) {
        continue;
      }
      var zp = zonePos(zo, state.time);
      var d = Math.hypot(sh.tx - zp.x, sh.ty - zp.y);
      if (d <= zoneRadius(zo)) {
        if (zo.spec.color === sh.color) {
          hitZone = zo;
          break;
        }
      }
    }

    if (hitZone) {
      state.combo += 1;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      var mult = Math.min(state.combo, 5);
      var pts = 100 * mult;
      state.score += pts;
      state.nightPoints += pts;
      if (hitZone.spec.salvo) {
        state.recentHits.push({ id: zones.indexOf(hitZone), t: state.time });
        var pair = false;
        for (var rh = state.recentHits.length - 1; rh >= 0; rh--) {
          var other = state.recentHits[rh];
          if (
            other.id === zones.indexOf(hitZone) &&
            state.time - other.t <= 0.65 &&
            other.t !== state.time &&
            other.t >= state.time - 0.65 &&
            rh !== state.recentHits.length - 1
          ) {
            pair = true;
            break;
          }
        }
        if (pair && !hitZone.salvoDone) {
          hitZone.salvoDone = true;
          hitZone.done = true;
          sfxZoneDone();
        }
      } else {
        hitZone.hits += 1;
        if (hitZone.hits >= hitZone.spec.need) {
          hitZone.done = true;
          sfxZoneDone();
        }
      }
      syncCommissionList();
    } else {
      state.combo = 0;
    }
    state.recentHits = state.recentHits.filter(function (h) {
      return state.time - h.t < 2;
    });
  }

  function finishClear() {
    state.phase = "clearing";
    clearCard();
  }

  function finishFail(reason) {
    state.failReason = reason;
    state.phase = "over";
    gameOverCard(reason);
  }

  /* ============================== rendering ============================= */

  function render() {
    var a = layoutAnchors();
    var waterY = a.waterY;

    var sky = ctx.createLinearGradient(0, 0, 0, waterY);
    sky.addColorStop(0, "#05060f");
    sky.addColorStop(0.55, "#0a1124");
    sky.addColorStop(1, "#17203a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, waterY + 1);

    ctx.fillStyle = "#cfd8ea";
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      var tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(state.time * st.tw + st.ph));
      ctx.globalAlpha = tw * 0.8;
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    var mx = W * 0.73;
    var my = H * 0.15;
    var mg = ctx.createRadialGradient(mx, my, 4, mx, my, H * 0.13);
    mg.addColorStop(0, "rgba(230,235,250,0.5)");
    mg.addColorStop(1, "rgba(230,235,250,0)");
    ctx.fillStyle = mg;
    ctx.fillRect(mx - H * 0.13, my - H * 0.13, H * 0.26, H * 0.26);
    ctx.fillStyle = "#e9edf8";
    ctx.beginPath();
    ctx.arc(mx, my, H * 0.028, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(190,200,225,0.5)";
    ctx.beginPath();
    ctx.arc(mx - H * 0.008, my - H * 0.006, H * 0.006, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx + H * 0.007, my + H * 0.009, H * 0.004, 0, TAU);
    ctx.fill();

    drawBeam(mx, my);

    drawZones();

    drawTownAndWater(a, waterY);

    drawHeadlands(a, waterY);

    drawShells();
    drawParticles(waterY);

    drawJetty(a);
    drawReticle(a);
    drawVignette();
  }

  function drawBeam() {
    if (state.phase === "title") {
      return;
    }
    var a = layoutAnchors();
    var ang = Math.sin((state.time * TAU) / 9) * 0.6;
    var len = W * 0.34;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(a.lhX, a.lhBaseY - a.lhH - 14);
    for (var k = 0; k < 2; k++) {
      ctx.rotate(ang * (k === 0 ? 1 : -0.35));
      var grd = ctx.createLinearGradient(0, 0, k === 0 ? len : len * 0.6, 0);
      grd.addColorStop(0, "rgba(255,238,180,0.22)");
      grd.addColorStop(1, "rgba(255,238,180,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, -len * 0.09);
      ctx.lineTo(len, len * 0.09);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-ang * (k === 0 ? 1 : -0.35));
    }
    ctx.restore();
  }

  function drawZones() {
    if (state.phase !== "show") {
      return;
    }
    ctx.save();
    for (var z = 0; z < zones.length; z++) {
      var zo = zones[z];
      var zp = zonePos(zo, state.time);
      var rp = zoneRadius(zo);
      var c = COLORS[zo.spec.color];
      var pulse = 0.5 + 0.5 * Math.sin(state.time * 2.2 + zo.phase);
      ctx.strokeStyle = zo.done
        ? "rgba(159,211,154,0.85)"
        : hexA(c.css, 0.5 + pulse * 0.4);
      ctx.globalAlpha = zo.done ? 0.9 : 0.55 + pulse * 0.4;
      ctx.beginPath();
      ctx.arc(zp.x, zp.y, rp, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = c.css;
      ctx.fill();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      var tag = zo.done
        ? "\u2713 " + zo.spec.label
        : zo.spec.salvo
          ? "pair \u00b7 " + c.name
          : c.name + " \u00d7 " + zo.spec.need;
      ctx.font = "13px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillStyle = zo.done ? "#9fd39a" : c.css;
      ctx.globalAlpha = 0.95;
      ctx.fillText(tag, zp.x, zp.y - rp - 10);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return (
      "rgba(" +
      ((n >> 16) & 255) +
      "," +
      ((n >> 8) & 255) +
      "," +
      (n & 255) +
      "," +
      a.toFixed(2) +
      ")"
    );
  }

  function drawTownAndWater(a, waterY) {
    ctx.fillStyle = "#141d36";
    for (var i = 0; i < townRows.length; i++) {
      var b = townRows[i];
      ctx.fillRect(b.x, waterY - b.h, b.w, b.h);
    }
    for (var j = 0; j < townRows.length; j++) {
      var bb = townRows[j];
      ctx.fillStyle = "rgba(255,205,120,0.7)";
      for (var k = 0; k < bb.wins.length; k++) {
        ctx.fillRect(bb.x + bb.wins[k].dx, waterY - bb.h + bb.wins[k].dy, 2, 3);
      }
    }

    var wg = ctx.createLinearGradient(0, waterY, 0, H);
    wg.addColorStop(0, "#101a30");
    wg.addColorStop(1, "#05070f");
    ctx.fillStyle = wg;
    ctx.fillRect(0, waterY, W, H - waterY);

    var windPx = windNow() * 30;
    ctx.strokeStyle = "#9fb4d8";
    for (var s = 0; s < shimmer.length; s++) {
      var sm = shimmer[s];
      sm.x += (sm.sp + windPx) * 0.016;
      if (sm.x > W + sm.len) {
        sm.x = -sm.len;
      }
      if (sm.x < -sm.len - 4) {
        sm.x = W + sm.len;
      }
      ctx.globalAlpha = sm.al;
      ctx.beginPath();
      ctx.moveTo(sm.x, sm.y);
      ctx.lineTo(sm.x + sm.len, sm.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(233,237,248,0.10)";
    ctx.fillRect(mx0(), waterY, H * 0.056 * 1.6, 2);
  }

  function mx0() {
    return W * 0.73 - H * 0.045;
  }

  function drawShells() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < shells.length; i++) {
      var sh = shells[i];
      var p = shellPos(sh);
      sh.trail.push({ x: p.x, y: p.y });
      if (sh.trail.length > 13) {
        sh.trail.shift();
      }
      var c = COLORS[sh.color];
      for (var t = 0; t < sh.trail.length; t++) {
        var tp = sh.trail[t];
        ctx.globalAlpha = (t / sh.trail.length) * 0.5;
        ctx.fillStyle = "hsl(" + c.hue + "," + c.sat + "%,72%)";
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, 1.4, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff6dd";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawParticles(waterY) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (p.delay > 0) {
        continue;
      }
      var lf = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = lf;
      ctx.fillStyle = "hsl(" + p.hue + "," + p.sat + "%," + p.lum + "%)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + lf * 0.5), 0, TAU);
      ctx.fill();
      if (p.y < waterY && p.y > waterY - H * 0.5) {
        ctx.globalAlpha = lf * 0.22;
        ctx.beginPath();
        ctx.arc(
          p.x + Math.sin(state.time * 3 + p.y * 0.05) * 3,
          2 * waterY - p.y,
          p.size * (0.5 + lf * 0.5),
          0,
          TAU,
        );
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawHeadlands(a, waterY) {
    /* west cliff — a low dark mass the violet commissions hang beside */
    ctx.fillStyle = "#0c1222";
    ctx.beginPath();
    ctx.moveTo(-4, waterY + 2);
    ctx.lineTo(-4, H * 0.66);
    ctx.quadraticCurveTo(W * 0.05, H * 0.64, W * 0.1, H * 0.72);
    ctx.quadraticCurveTo(W * 0.13, H * 0.76, W * 0.15, waterY + 2);
    ctx.closePath();
    ctx.fill();

    /* the lighthouse on its rock spur */
    var baseW = Math.max(26, W * 0.02);
    ctx.fillStyle = "#0d1426";
    ctx.beginPath();
    ctx.moveTo(a.lhX - baseW * 1.9, waterY + 3);
    ctx.quadraticCurveTo(
      a.lhX - baseW,
      a.lhBaseY - 14,
      a.lhX - baseW * 0.7,
      a.lhBaseY,
    );
    ctx.lineTo(a.lhX + baseW * 0.9, a.lhBaseY);
    ctx.quadraticCurveTo(
      a.lhX + baseW * 1.5,
      a.lhBaseY - 22,
      a.lhX + baseW * 2.4,
      waterY + 3,
    );
    ctx.closePath();
    ctx.fill();

    var topY = a.lhBaseY - a.lhH;
    ctx.fillStyle = "#1b2338";
    ctx.beginPath();
    ctx.moveTo(a.lhX - baseW * 0.42, a.lhBaseY);
    ctx.lineTo(a.lhX - baseW * 0.24, topY);
    ctx.lineTo(a.lhX + baseW * 0.24, topY);
    ctx.lineTo(a.lhX + baseW * 0.42, a.lhBaseY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(210,220,240,0.16)";
    ctx.fillRect(
      a.lhX - baseW * 0.31,
      lerp(topY, a.lhBaseY, 0.28),
      baseW * 0.62,
      a.lhH * 0.09,
    );
    ctx.fillRect(
      a.lhX - baseW * 0.27,
      lerp(topY, a.lhBaseY, 0.62),
      baseW * 0.54,
      a.lhH * 0.09,
    );

    /* gallery and glowing lamp room */
    ctx.fillStyle = "#232d47";
    ctx.fillRect(a.lhX - baseW * 0.34, topY - 10, baseW * 0.68, 10);
    var glow = ctx.createRadialGradient(
      a.lhX,
      topY - 16,
      2,
      a.lhX,
      topY - 16,
      H * 0.05,
    );
    glow.addColorStop(0, "rgba(255,236,170,0.85)");
    glow.addColorStop(0.35, "rgba(255,226,140,0.25)");
    glow.addColorStop(1, "rgba(255,226,140,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(a.lhX - H * 0.05, topY - 16 - H * 0.05, H * 0.1, H * 0.1);
    ctx.fillStyle = "#ffe9b0";
    ctx.fillRect(a.lhX - baseW * 0.18, topY - 20, baseW * 0.36, 12);
    ctx.fillStyle = "#141b30";
    ctx.beginPath();
    ctx.moveTo(a.lhX - baseW * 0.26, topY - 20);
    ctx.lineTo(a.lhX, topY - 32);
    ctx.lineTo(a.lhX + baseW * 0.26, topY - 20);
    ctx.closePath();
    ctx.fill();
  }

  function drawJetty(a) {
    ctx.fillStyle = "#080b14";
    ctx.beginPath();
    ctx.moveTo(a.jettyX0 - 30, H);
    ctx.lineTo(a.jettyX0 - 10, a.jettyY);
    ctx.lineTo(a.jettyX1 + 20, a.jettyY);
    ctx.lineTo(a.jettyX1 + 60, H);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#141a2a";
    ctx.lineWidth = 2;
    for (var px = a.jettyX0; px < a.jettyX1 + 20; px += 16) {
      ctx.beginPath();
      ctx.moveTo(px, a.jettyY);
      ctx.lineTo(px - 6, H);
      ctx.stroke();
    }
    ctx.strokeStyle = "#1c2336";
    ctx.beginPath();
    ctx.moveTo(a.jettyX0 - 10, a.jettyY);
    ctx.lineTo(a.jettyX1 + 20, a.jettyY);
    ctx.stroke();

    ctx.fillStyle = "#171228";
    ctx.fillRect(a.jettyX1 - 34, a.jettyY - 20, 26, 20);
    ctx.strokeStyle = "#2c2340";
    ctx.strokeRect(a.jettyX1 - 34, a.jettyY - 20, 26, 20);
    ctx.font = "11px Georgia, serif";
    ctx.fillStyle = "#8d84a8";
    ctx.textAlign = "center";
    ctx.fillText("POWDER", a.jettyX1 - 21, a.jettyY - 7);

    for (var i = 0; i < tubes.length; i++) {
      var tb = tubes[i];
      ctx.save();
      ctx.translate(tb.x, tb.y);
      ctx.rotate(-Math.PI / 3.1);
      ctx.fillStyle = tubes[i].reload > 0 ? "#23283c" : "#39415c";
      ctx.fillRect(-5, -22, 10, 24);
      ctx.fillStyle = "#12151f";
      ctx.fillRect(-6.5, 0, 13, 5);
      ctx.restore();
      if (tubes[i].reload <= 0) {
        ctx.fillStyle = "rgba(255,217,140,0.85)";
        ctx.beginPath();
        ctx.arc(tb.x, tb.y - 27, 1.6, 0, TAU);
        ctx.fill();
      }
    }
  }

  function drawReticle(a) {
    if (state.phase !== "show" || state.paused) {
      return;
    }
    var ready = selectReadyTubeSilent();
    var previewDrift = windNow() * state.fuse * 30;
    ctx.save();
    if (ready >= 0) {
      var tube = tubes[ready];
      var steps = 16;
      ctx.fillStyle = "rgba(255,230,160,0.35)";
      for (var s = 1; s <= steps; s++) {
        var fake = {
          x0: tube.x + 6,
          y0: tube.y - 14,
          tx: aim.x + previewDrift,
          ty: aim.y,
          fuse: state.fuse,
          age: (s / steps) * state.fuse,
          trail: [],
        };
        var pp = shellPos(fake);
        ctx.globalAlpha = 0.5 * (1 - s / steps) + 0.1;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 1.5, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = ready >= 0 ? "#ffe49a" : "#5a6180";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(aim.x, aim.y, 13, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    for (var k = 0; k < 4; k++) {
      var ang = (k * TAU) / 4;
      ctx.moveTo(aim.x + Math.cos(ang) * 8, aim.y + Math.sin(ang) * 8);
      ctx.lineTo(aim.x + Math.cos(ang) * 18, aim.y + Math.sin(ang) * 18);
    }
    ctx.stroke();
    ctx.font = "12px Georgia, serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(232,223,200,0.8)";
    ctx.fillText(
      "burst in " + state.fuse.toFixed(2).replace(/0$/, "") + "s",
      aim.x + 20,
      aim.y - 14,
    );
    ctx.restore();
  }

  function selectReadyTubeSilent() {
    if (tubes[state.selectedTube] && tubes[state.selectedTube].reload <= 0) {
      return state.selectedTube;
    }
    for (var i = 0; i < tubes.length; i++) {
      if (tubes[i].reload <= 0) {
        return i;
      }
    }
    return -1;
  }

  function drawVignette() {
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  /* ============================= main loop ============================== */

  var lastTs = 0;

  function frame(ts) {
    var dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    if (document.hidden) {
      requestAnimationFrame(frame);
      return;
    }
    if (state.phase === "show" && !state.paused) {
      update(dt);
    } else {
      state.time += dt * 0.4;
      for (var p = particles.length - 1; p >= 0; p--) {
        var pt = particles[p];
        pt.life -= dt;
        if (pt.life <= 0) {
          particles.splice(p, 1);
          continue;
        }
        pt.vx *= Math.pow(0.32, dt);
        pt.vy = pt.vy * Math.pow(0.42, dt) + 46 * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
      }
    }
    render();
    if (state.phase === "show") {
      syncFrame();
    }
    try {
      window.__SS = {
        t: state.time,
        w: W,
        h: H,
        aimx: aim.x,
        aimy: aim.y,
        zones: zones.map(function (z) {
          var zp = zonePos(z, state.time);
          return { x: zp.x, y: zp.y, r: zoneRadius(z), hits: z.hits, done: z.done, color: z.spec.color };
        }),
        shells: shells.map(function (s) {
          return { tx: s.tx, ty: s.ty, age: s.age, fuse: s.fuse, color: s.color };
        })
      };
    } catch (e) {}
    requestAnimationFrame(frame);
  }

  /* ============================ colour palette ========================== */

  var PALETTE_ORDER = ["gold", "crimson", "violet", "silver"];

  function buildPaletteDom() {
    ui.palette.textContent = "";
    for (var i = 0; i < PALETTE_ORDER.length; i++) {
      var name = PALETTE_ORDER[i];
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (name === state.chosenColour ? " selected" : "");
      b.dataset.colour = name;
      b.title = "Load " + COLORS[name].name + " shells";
      b.addEventListener("click", function (e) {
        ensureAudio();
        setChosenColour(e.currentTarget.dataset.colour);
        sfxClick();
      });
      ui.palette.appendChild(b);
    }
  }

  function setChosenColour(name) {
    if (!COLORS[name]) {
      return;
    }
    state.chosenColour = name;
    var chips = ui.palette.children;
    for (var i = 0; i < chips.length; i++) {
      chips[i].className = "chip" + (chips[i].dataset.colour === name ? " selected" : "");
    }
  }

  function cycleColour() {
    var idx = PALETTE_ORDER.indexOf(state.chosenColour);
    setChosenColour(PALETTE_ORDER[(idx + 1) % PALETTE_ORDER.length]);
  }

  /* ================================ boot ================================ */

  resize();
  buildPaletteDom();
  aim.x = W * 0.5;
  aim.y = H * 0.3;
  setupNight(0);
  titleCard();
  requestAnimationFrame(frame);
})();
