/*
 * Before the Buses — a pre-dawn snowplough game for the arcade.
 *
 * Sweep the sleeping hill-town's streets cell by cell. Everything the blade
 * gathers rides your bumper as a drift; tip it at an amber gully or a
 * riverside bay before it brims over. Clear every road before the clock
 * reaches 7:00 and the buses run.
 *
 * Vanilla canvas + Web Audio. One classic script, wrapped in an IIFE,
 * no dependencies, no network.
 */
(function () {
  "use strict";

  /* ── tiny helpers ─────────────────────────────────────────── */

  var $ = function (id) {
    return document.getElementById(id);
  };
  var clamp = function (v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  };
  var lerp = function (a, b, t) {
    return a + (b - a) * t;
  };
  var rand = function (a, b) {
    return a + Math.random() * (b - a);
  };
  function hash3(a, b, c) {
    var h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
    h = (h ^ (h >>> 13)) >>> 0;
    return (h % 100000) / 100000;
  }

  /* ── world constants ──────────────────────────────────────── */

  var COLS = 13;
  var ROWS = 9;
  var CELL = 80;
  var W = COLS * CELL;
  var H = ROWS * CELL;

  var DX = [1, 0, -1, 0]; // 0=E 1=S 2=W 3=N
  var DY = [0, 1, 0, -1];

  var CAP = 12; // drift capacity, in shovel-fulls
  var SNOW_PER_TILE = 2;
  var MOVE_MS = 150;
  var TURN_MS = 90;
  var SLIDE_MAX = 3;

  var CLOCK_START = 350; // 5:50
  var CLOCK_END = 420; // 7:00

  /*
   * Map legend:
   *   '#' house   'W' water   'c' parked car (solid)
   *   'R' snowy road          'i' icy road (snowy + slippery)
   *   'D' gully drain (dump)  'B' riverside bay (dump)
   *   '@' truck start (snowy road)
   */
  var LEVELS = [
    {
      name: "Foundry Hill",
      time: 95,
      map: [
        "#############",
        "#@RRRRRRRRRD#",
        "#R#########R#",
        "#R#########R#",
        "#R#########R#",
        "#R#########R#",
        "#R#########R#",
        "#RRRRRDRRRRR#",
        "#############",
      ],
    },
    {
      name: "Millrace Yard",
      time: 105,
      map: [
        "#############",
        "#@RRcRRRRRDD#",
        "##RRRRRRRRR##",
        "##########R##",
        "##RRRRRRRRR##",
        "##R#######R##",
        "##B#######B##",
        "#WWWWWWWWWWW#",
        "#############",
      ],
    },
    {
      name: "Chapel Brow",
      time: 115,
      map: [
        "#############",
        "#@RRiRRRRRRD#",
        "########R####",
        "###RRRRRRRiR#",
        "###R#########",
        "###RRRRRRRRR#",
        "######D####B#",
        "#WWWWWWWWWWW#",
        "#############",
      ],
    },
    {
      name: "Cinder Lane",
      time: 125,
      map: [
        "#############",
        "#@RRRRRRRRRD#",
        "##RRRRcRRRR##",
        "##########R##",
        "####RRRRRRRR#",
        "####R########",
        "#DRRRRRRRRiD#",
        "#############",
        "#############",
      ],
    },
    {
      name: "The Quay",
      time: 140,
      map: [
        "#############",
        "#@RRRRiRRRDD#",
        "######R######",
        "#RRRRRRRRRRR#",
        "##RRRRcRRRR##",
        "##R#######R##",
        "#RRiRRRRRBRD#",
        "#WWWWWWWWWWW#",
        "#############",
      ],
    },
  ];

  /* ── dom ──────────────────────────────────────────────────── */

  var canvas = $("town");
  var ctx = canvas.getContext("2d");
  var elClock = $("clock");
  var elStreets = $("streets");
  var elChip = $("chip-level");
  var elDriftWrap = $("drift-wrap");
  var elDriftFill = $("drift-fill");
  var elHint = $("hint");
  var elBanner = $("banner");
  var elBannerBig = $("banner-big");
  var elBannerSmall = $("banner-small");

  var overlays = {
    title: $("overlay-title"),
    pause: $("overlay-pause"),
    level: $("overlay-level"),
    over: $("overlay-over"),
    won: $("overlay-won"),
  };

  var btnStart = $("btn-start");
  var btnResume = $("btn-resume");
  var btnNext = $("btn-next");
  var btnRetry = $("btn-retry");
  var btnAgain = $("btn-again");
  var btnPause = $("btn-pause");
  var btnMute = $("btn-mute");
  var btnRestart = $("btn-restart");
  var btnHelp = $("btn-help");

  /* ── audio (lazy, synthesised) ────────────────────────────── */

  var AC = null;
  var master = null;
  var muted = false;
  var engOsc = null;
  var engGain = null;
  var windGain = null;
  var scrapeGain = null;

  function audioInit() {
    if (AC) {
      if (AC.state === "suspended") {
        AC.resume();
      }
      return;
    }
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      return;
    }
    try {
      AC = new Ctor();
    } catch (err) {
      AC = null;
      return;
    }
    master = AC.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(AC.destination);

    var buf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    var d = buf.getChannelData(0);
    var i;
    for (i = 0; i < d.length; i++) {
      d[i] = Math.random() * 2 - 1;
    }

    // wind bed
    var wind = AC.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    var wf = AC.createBiquadFilter();
    wf.type = "lowpass";
    wf.frequency.value = 420;
    windGain = AC.createGain();
    windGain.gain.value = 0.05;
    wind.connect(wf).connect(windGain).connect(master);
    wind.start();

    // blade scrape bed (raised while gathering)
    var scr = AC.createBufferSource();
    scr.buffer = buf;
    scr.loop = true;
    var sf = AC.createBiquadFilter();
    sf.type = "bandpass";
    sf.frequency.value = 950;
    sf.Q.value = 0.8;
    scrapeGain = AC.createGain();
    scrapeGain.gain.value = 0;
    scr.connect(sf).connect(scrapeGain).connect(master);
    scr.start();

    // idle engine
    engOsc = AC.createOscillator();
    engOsc.type = "sawtooth";
    engOsc.frequency.value = 52;
    var ef = AC.createBiquadFilter();
    ef.type = "lowpass";
    ef.frequency.value = 220;
    engGain = AC.createGain();
    engGain.gain.value = 0;
    engOsc.connect(ef).connect(engGain).connect(master);
    engOsc.start();
  }

  function tone(freq, dur, type, gain, when, slideTo) {
    if (!AC || muted) {
      return;
    }
    var t = AC.currentTime + (when || 0);
    var o = AC.createOscillator();
    var g = AC.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) {
      o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.2, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noiseHit(dur, freq, q, gain) {
    if (!AC || muted) {
      return;
    }
    var t = AC.currentTime;
    var src = AC.createBufferSource();
    var n = Math.max(1, Math.floor(AC.sampleRate * dur));
    var b = AC.createBuffer(1, n, AC.sampleRate);
    var d = b.getChannelData(0);
    var i;
    for (i = 0; i < n; i++) {
      d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    }
    src.buffer = b;
    var f = AC.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q || 1;
    var g = AC.createGain();
    g.gain.value = gain || 0.25;
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  function sfxScrape(on) {
    if (!AC) {
      return;
    }
    var want = on && !muted ? 0.09 : 0;
    if (scrapeGain) {
      scrapeGain.gain.setTargetAtTime(want, AC.currentTime, 0.05);
    }
  }

  function sfxEngine(moving) {
    if (!AC || !engGain) {
      return;
    }
    engGain.gain.setTargetAtTime(
      moving && !muted ? 0.05 : 0.022,
      AC.currentTime,
      0.08,
    );
    if (engOsc) {
      engOsc.frequency.setTargetAtTime(moving ? 74 : 52, AC.currentTime, 0.1);
    }
  }

  function sfxDump(bay) {
    noiseHit(0.35, bay ? 500 : 800, 0.7, 0.3);
    tone(bay ? 300 : 420, 0.3, "sine", 0.12, 0, bay ? 90 : 160);
    if (bay) {
      noiseHit(0.5, 260, 0.5, 0.22);
    }
  }

  function sfxFull() {
    tone(180, 0.12, "square", 0.08, 0);
    tone(140, 0.14, "square", 0.08, 0.12);
  }

  function sfxThud() {
    noiseHit(0.12, 140, 1.2, 0.28);
  }

  function sfxWin() {
    tone(523, 0.16, "triangle", 0.16, 0);
    tone(659, 0.16, "triangle", 0.16, 0.13);
    tone(784, 0.22, "triangle", 0.16, 0.26);
    tone(1046, 0.4, "triangle", 0.14, 0.4);
  }

  function sfxBell() {
    tone(880, 0.5, "sine", 0.2, 0, 870);
    tone(440, 0.7, "sine", 0.16, 0.05, 430);
    tone(330, 0.9, "sine", 0.12, 0.4);
  }

  function sfxStart() {
    tone(392, 0.1, "triangle", 0.12, 0);
    tone(523, 0.14, "triangle", 0.12, 0.09);
  }

  function applyMute() {
    if (master) {
      master.gain.setTargetAtTime(muted ? 0 : 0.85, AC.currentTime, 0.03);
    }
    btnMute.textContent = muted ? "✕" : "♪";
  }

  /* ── state ────────────────────────────────────────────────── */

  var state = "title"; // title | play | levelend | over | won
  var paused = false;
  var levelIndex = 0;
  var level = null;
  var terrain = []; // grid of type strings
  var snow = []; // grid of remaining snow
  var tracks = []; // grid: "" | "h" | "v"
  var snowLeft = 0;
  var snowTotal = 0;
  var elapsed = 0;
  var savedSeconds = 0;

  var truck = null;
  var pending = null; // buffered action while moving
  var slideChain = 0;

  var flakes = [];
  var sparks = [];
  var smokes = [];
  var rings = [];
  var time = 0;
  var lastTs = 0;
  var beaconT = 0;
  var fullFlashT = 0;
  var bumpT = 0;

  /* ── level loading ────────────────────────────────────────── */

  function cellCenter(r, c) {
    return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
  }

  function loadLevel(idx) {
    levelIndex = idx;
    level = LEVELS[idx];
    terrain = [];
    snow = [];
    tracks = [];
    snowLeft = 0;
    snowTotal = 0;
    elapsed = 0;
    pending = null;
    slideChain = 0;
    sparks = [];
    rings = [];

    var r, c, row, ch;
    var startR = 1;
    var startC = 1;
    for (r = 0; r < ROWS; r++) {
      row = level.map[r];
      terrain.push([]);
      snow.push([]);
      tracks.push([]);
      for (c = 0; c < COLS; c++) {
        ch = row.charAt(c);
        var t = ch;
        if (ch === "@") {
          startR = r;
          startC = c;
          t = "R";
        }
        terrain[r].push(t);
        tracks[r].push("");
        var s = 0;
        if (t === "R" || t === "i") {
          s = SNOW_PER_TILE;
          snowLeft += s;
        }
        snow[r].push(s);
      }
    }
    snowTotal = snowLeft;

    truck = {
      r: startR,
      c: startC,
      dir: 0,
      angle: 0,
      x: 0,
      y: 0,
      moving: null, // {fr,fc,tr,tc,t,dur,back}
      drift: 0,
    };
    var cc = cellCenter(startR, startC);
    truck.x = cc.x;
    truck.y = cc.y;

    elChip.textContent = "Street " + (idx + 1) + " · " + level.name;
    syncHud();
    syncHint();
    setState("play");
    showBanner(
      "Street " + (idx + 1) + " — " + level.name,
      snowTotal / SNOW_PER_TILE + " sweeps before 7:00",
      2000,
    );
    sfxStart();
  }

  function setState(s) {
    state = s;
    var k;
    for (k in overlays) {
      if (Object.prototype.hasOwnProperty.call(overlays, k)) {
        overlays[k].classList.add("hidden");
      }
    }
    syncHint();
  }

  function showOverlay(name) {
    overlays[name].classList.remove("hidden");
  }

  var bannerUntil = 0;
  function showBanner(big, small, ms) {
    elBannerBig.textContent = big;
    elBannerSmall.textContent = small;
    elBanner.classList.remove("hidden");
    bannerUntil = performance.now() + (ms || 1800);
  }

  /* ── hud ──────────────────────────────────────────────────── */

  function sweepsLeft() {
    return snowLeft / SNOW_PER_TILE;
  }

  function clockMinutes() {
    var frac = level ? clamp(elapsed / level.time, 0, 1) : 0;
    return CLOCK_START + Math.floor((CLOCK_END - CLOCK_START) * frac);
  }

  function fmtClock(mins) {
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return h + ":" + (m < 10 ? "0" : "") + m;
  }

  function syncHud() {
    var mins = clockMinutes();
    elClock.textContent = fmtClock(mins);
    var frac = level ? elapsed / level.time : 0;
    elClock.classList.toggle("late", frac > 0.82);
    elStreets.textContent = sweepsLeft() + " sweeps";
    var d = truck ? truck.drift : 0;
    elDriftFill.style.width = (100 * d) / CAP + "%";
    elDriftWrap.classList.toggle("full", d >= CAP);
  }

  function syncHint() {
    var txt = "";
    var warn = false;
    if (state === "play") {
      if (truck && truck.drift >= CAP) {
        txt = "Blade brimming — roll into an amber gully or a riverside bay";
        warn = true;
      } else {
        txt = "▲ drive · ← → turn · ▼ reverse · dump before you brim over";
      }
    } else if (state === "title") {
      txt = "";
    } else if (state === "over") {
      txt = "";
    }
    elHint.textContent = txt;
    elHint.classList.toggle("warn", warn);
    elHint.classList.toggle("hidden", !txt);
  }

  /* ── movement & rules ─────────────────────────────────────── */

  function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  function passable(r, c) {
    if (!inBounds(r, c)) {
      return false;
    }
    var t = terrain[r][c];
    return t !== "#" && t !== "c" && t !== "W";
  }

  function isDump(t) {
    return t === "D" || t === "B";
  }

  function queueAction(act) {
    if (!truck || state !== "play" || paused) {
      return false;
    }
    if (truck.moving) {
      pending = act;
      return true;
    }
    return performAction(act);
  }

  function performAction(act) {
    var nd;
    if (act === "tl" || act === "tr") {
      nd = (truck.dir + (act === "tr" ? 1 : 3)) % 4;
      truck.dir = nd;
      sfxEngine(false);
      return true;
    }
    var back = act === "b";
    slideChain = 0;
    var fwd = back ? (truck.dir + 2) % 4 : truck.dir;
    var nr = truck.r + DY[fwd];
    var nc = truck.c + DX[fwd];
    if (!passable(nr, nc)) {
      bumpT = 0.18;
      sfxThud();
      return false;
    }
    var fr = truck.r;
    var fc = truck.c;
    truck.r = nr;
    truck.c = nc;
    truck.moving = {
      fr: fr,
      fc: fc,
      tr: nr,
      tc: nc,
      t: 0,
      dur: MOVE_MS / 1000,
      back: back,
      fwd: fwd,
    };
    sfxEngine(true);
    return true;
  }

  function arrive(tr, tc, cameDir) {
    var t = terrain[tr][tc];

    // gather
    if (snow[tr][tc] > 0) {
      var room = CAP - truck.drift;
      var take = Math.min(snow[tr][tc], room);
      if (take > 0) {
        snow[tr][tc] -= take;
        snowLeft -= take;
        truck.drift += take;
        sprayAt(tr, tc, take);
        sfxScrape(true);
        window.setTimeout(function () {
          sfxScrape(false);
        }, 160);
        if (truck.drift >= CAP) {
          sfxFull();
          fullFlashT = 0.6;
        }
      } else {
        fullFlashT = 0.35;
        sfxFull();
      }
    }

    // dump
    if (isDump(t) && truck.drift > 0) {
      dumpAt(tr, tc, t);
      truck.drift = 0;
    }

    // tracks
    if (cameDir === 0 || cameDir === 2) {
      tracks[tr][tc] = "h";
    } else if (cameDir === 1 || cameDir === 3) {
      tracks[tr][tc] = "v";
    }

    // win?
    if (snowLeft <= 0) {
      completeLevel();
      return;
    }

    // ice slide
    if (t === "i" && slideChain < SLIDE_MAX) {
      var nr = tr + DY[cameDir];
      var nc = tc + DX[cameDir];
      if (passable(nr, nc)) {
        slideChain++;
        truck.moving = {
          fr: tr,
          fc: tc,
          tr: nr,
          tc: nc,
          t: 0,
          dur: MOVE_MS / 700,
          back: false,
          fwd: cameDir,
          slide: true,
        };
        truck.r = nr;
        truck.c = nc;
        return;
      }
    }
    slideChain = 0;
  }

  function dumpAt(tr, tc, t) {
    var cc = cellCenter(tr, tc);
    var bay = t === "B";
    var n;
    for (n = 0; n < 16; n++) {
      sparks.push({
        x: cc.x + rand(-14, 14),
        y: cc.y + rand(-10, 6),
        vx: rand(-70, 70),
        vy: bay ? rand(-40, -120) : rand(-90, -20),
        life: rand(0.4, 0.8),
        t: 0,
        col: bay ? "#bfe6ef" : "#ffd23f",
        g: bay ? 320 : 140,
      });
    }
    rings.push({ x: cc.x, y: cc.y, t: 0, life: 0.6 });
    sfxDump(bay);
  }

  function sprayAt(r, c, amount) {
    var cc = cellCenter(r, c);
    var n = 3 + amount * 2;
    var i;
    for (i = 0; i < n; i++) {
      sparks.push({
        x: cc.x + rand(-24, 24),
        y: cc.y + rand(-24, 24),
        vx: rand(-40, 40),
        vy: rand(-70, -10),
        life: rand(0.25, 0.5),
        t: 0,
        col: "#ffffff",
        g: 220,
      });
    }
  }

  function completeLevel() {
    var remain = level.time - elapsed;
    var stars =
      remain / level.time >= 0.3 ? 3 : remain / level.time >= 0.12 ? 2 : 1;
    savedSeconds += Math.round(Math.max(0, remain));
    sfxScrape(false);
    sfxEngine(false);
    setState("levelend");
    $("done-head").textContent = level.name + " is swept";
    $("done-line").textContent =
      "Clean with " +
      fmtClock(clockMinutes()) +
      " on the town hall clock — " +
      Math.ceil(remain) +
      "s to spare.";
    var starEl = $("done-stars");
    starEl.innerHTML = "";
    var s;
    for (s = 0; s < 3; s++) {
      var span = document.createElement("span");
      span.textContent = "✶";
      if (s >= stars) {
        span.className = "dim";
      }
      starEl.appendChild(span);
    }
    showOverlay("level");
    sfxWin();
  }

  function failLevel() {
    sfxScrape(false);
    sfxEngine(false);
    setState("over");
    $("over-line").textContent =
      level.name +
      " still wears " +
      sweepsLeft() +
      " sweeps of snow. The buses shudder to a halt.";
    showOverlay("over");
    sfxBell();
  }

  /* ── update ───────────────────────────────────────────────── */

  function update(dt) {
    time += dt;
    beaconT += dt;
    if (fullFlashT > 0) {
      fullFlashT -= dt;
    }
    if (bumpT > 0) {
      bumpT -= dt;
    }
    if (elBanner && !elBanner.classList.contains("hidden")) {
      if (performance.now() > bannerUntil) {
        elBanner.classList.add("hidden");
      }
    }
    updateFlakes(dt);
    updateSparks(dt);
    updateSmoke(dt);

    if (state !== "play" || paused) {
      sfxEngine(false);
      return;
    }

    elapsed += dt;
    if (elapsed >= level.time) {
      elapsed = level.time;
      syncHud();
      failLevel();
      return;
    }
    if (snowLeft <= 0) {
      completeLevel();
      return;
    }

    // movement tween
    if (truck.moving) {
      var m = truck.moving;
      m.t += dt;
      var k = clamp(m.t / m.dur, 0, 1);
      var a = cellCenter(m.fr, m.fc);
      var b = cellCenter(m.tr, m.tc);
      var ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      truck.x = lerp(a.x, b.x, ease);
      truck.y = lerp(a.y, b.y, ease);
      truck.angle = m.fwd * (Math.PI / 2);
      if (k >= 1) {
        truck.x = b.x;
        truck.y = b.y;
        truck.moving = null;
        arrive(m.tr, m.tc, m.fwd);
        if (state === "play" && !truck.moving && pending) {
          var act = pending;
          pending = null;
          performAction(act);
        }
      }
    } else if (pending) {
      var p = pending;
      pending = null;
      performAction(p);
    }

    syncHud();
  }

  function updateFlakes(dt) {
    while (flakes.length < 90) {
      flakes.push({
        x: rand(0, W),
        y: rand(0, H),
        z: rand(0.35, 1),
        sway: rand(0, Math.PI * 2),
      });
    }
    var i, f;
    for (i = 0; i < flakes.length; i++) {
      f = flakes[i];
      f.sway += dt * 1.4;
      f.y += (26 + 44 * f.z) * dt;
      f.x += (Math.sin(f.sway) * 12 - 8 * f.z) * dt;
      if (f.y > H + 6) {
        f.y = -8;
        f.x = rand(0, W);
      }
      if (f.x < -8) {
        f.x = W + 6;
      }
    }
  }

  function updateSparks(dt) {
    var i, s;
    for (i = sparks.length - 1; i >= 0; i--) {
      s = sparks[i];
      s.t += dt;
      if (s.t >= s.life) {
        sparks.splice(i, 1);
        continue;
      }
      s.vy += s.g * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    for (i = rings.length - 1; i >= 0; i--) {
      rings[i].t += dt;
      if (rings[i].t >= rings[i].life) {
        rings.splice(i, 1);
      }
    }
  }

  var smokeClock = 0;
  function updateSmoke(dt) {
    smokeClock += dt;
    var i, s;
    if (smokeClock > 0.55 && smokes.length < 26) {
      smokeClock = 0;
      // find a random house with a chimney
      var tries = 8;
      while (tries-- > 0) {
        var r = Math.floor(rand(0, ROWS));
        var c = Math.floor(rand(0, COLS));
        if (terrain.length && terrain[r][c] === "#") {
          smokes.push({
            x: c * CELL + CELL * (0.3 + hash3(r, c, 5) * 0.4),
            y: r * CELL + CELL * 0.42,
            vx: rand(-6, 2),
            vy: rand(-16, -9),
            t: 0,
            life: rand(2.4, 3.6),
            rad: rand(3, 6),
          });
          break;
        }
      }
    }
    for (i = smokes.length - 1; i >= 0; i--) {
      s = smokes[i];
      s.t += dt;
      if (s.t >= s.life) {
        smokes.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
  }

  /* ── rendering ────────────────────────────────────────────── */

  var ROOF_COLS = ["#4c5570", "#5d5470", "#4f6272", "#5a4f63", "#45536b"];

  function render() {
    ctx.save();
    ctx.clearRect(0, 0, W, H);

    if (!level || terrain.length < ROWS) {
      // title backdrop: night ground and falling snow behind the card
      var tg = ctx.createLinearGradient(0, 0, 0, H);
      tg.addColorStop(0, "#23284a");
      tg.addColorStop(1, "#10121f");
      ctx.fillStyle = tg;
      ctx.fillRect(0, 0, W, H);
      drawFlakes();
      ctx.restore();
      return;
    }

    // base ground
    ctx.fillStyle = "#171c30";
    ctx.fillRect(0, 0, W, H);

    var r, c, t, x, y;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        t = terrain[r][c];
        x = c * CELL;
        y = r * CELL;
        if (t === "#") {
          drawHouse(r, c, x, y);
        } else if (t === "W") {
          drawWater(x, y);
        } else if (t === "B") {
          drawWater(x, y);
          drawBay(x, y);
        } else {
          drawRoadTile(r, c, t, x, y);
        }
      }
    }

    drawRings();
    drawSparks();
    drawTruck();
    drawSmoke();
    drawFlakes();
    drawDawn();

    ctx.restore();
  }

  function drawHouse(r, c, x, y) {
    var h = hash3(r, c, 1);
    ctx.fillStyle = ROOF_COLS[Math.floor(h * ROOF_COLS.length)];
    ctx.fillRect(x + 3, y + 6, CELL - 6, CELL - 12);
    // ridge
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(x + 3, y + CELL / 2 - 2, CELL - 6, 4);
    // snow cap
    ctx.fillStyle = "#e8eef8";
    ctx.fillRect(x + 3, y + 6, CELL - 6, 10);
    ctx.fillRect(x + 3, y + 6, 8, CELL - 12);
    // chimney
    var hx = x + CELL * (0.3 + hash3(r, c, 5) * 0.4);
    ctx.fillStyle = "#2a2130";
    ctx.fillRect(hx, y + 14, 9, 12);
    ctx.strokeStyle = "rgba(16,19,31,0.5)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3.5, y + 6.5, CELL - 7, CELL - 13);
  }

  function drawWater(x, y) {
    ctx.fillStyle = "#14303c";
    ctx.fillRect(x, y, CELL, CELL);
    var ph = time * 1.6 + x * 0.05 + y * 0.11;
    ctx.strokeStyle = "rgba(127,212,201,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    var yy = y + 22 + Math.sin(ph) * 6;
    ctx.moveTo(x + 8, yy);
    ctx.quadraticCurveTo(
      x + CELL / 2,
      yy + 7 * Math.sin(ph * 1.7),
      x + CELL - 8,
      yy,
    );
    ctx.stroke();
    var ph2 = ph + 2.2;
    ctx.beginPath();
    yy = y + 54 + Math.sin(ph2) * 5;
    ctx.moveTo(x + 10, yy);
    ctx.quadraticCurveTo(
      x + CELL / 2,
      yy - 6 * Math.sin(ph2),
      x + CELL - 10,
      yy,
    );
    ctx.stroke();
  }

  function drawBay(x, y) {
    ctx.fillStyle = "#5a4632";
    ctx.fillRect(x + 6, y + 8, CELL - 12, CELL - 16);
    ctx.fillStyle = "#6e5740";
    var i;
    for (i = 0; i < 4; i++) {
      ctx.fillRect(x + 6, y + 12 + i * 14, CELL - 12, 9);
    }
    ctx.strokeStyle = "#8a7350";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 6, y + 8, CELL - 12, CELL - 16);
    ctx.fillStyle = "rgba(255,210,63,0.9)";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("TIP", x + CELL / 2, y + CELL / 2 + 4);
  }

  function drawRoadTile(r, c, t, x, y) {
    var snowy = snow[r][c] > 0;
    if (t === "i" && snowy) {
      // ice under thin snow
      ctx.fillStyle = "#a9cede";
      ctx.fillRect(x, y, CELL, CELL);
      ctx.fillStyle = "rgba(230,245,250,0.75)";
      ctx.fillRect(x, y, CELL, CELL);
    } else if (snowy) {
      var shade = hash3(r, c, 2);
      ctx.fillStyle = shade > 0.5 ? "#e3eaf4" : "#dbe3f0";
      ctx.fillRect(x, y, CELL, CELL);
    } else {
      // cleared wet asphalt
      ctx.fillStyle = "#333b53";
      ctx.fillRect(x, y, CELL, CELL);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(x, y + CELL * 0.3, CELL, 3);
    }

    // kerbs
    ctx.strokeStyle = "rgba(16,19,31,0.28)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);

    if (snowy) {
      // speckle
      ctx.fillStyle = "rgba(155,175,205,0.35)";
      var k;
      for (k = 0; k < 5; k++) {
        var sx = x + hash3(r, c, k + 10) * (CELL - 8) + 4;
        var sy = y + hash3(r, c, k + 40) * (CELL - 8) + 4;
        ctx.fillRect(sx, sy, 3, 3);
      }
    } else if (tracks[r][c]) {
      ctx.strokeStyle = "rgba(16,19,31,0.4)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      if (tracks[r][c] === "h") {
        ctx.moveTo(x + 4, y + CELL / 2 - 10);
        ctx.lineTo(x + CELL - 4, y + CELL / 2 - 10);
        ctx.moveTo(x + 4, y + CELL / 2 + 10);
        ctx.lineTo(x + CELL - 4, y + CELL / 2 + 10);
      } else {
        ctx.moveTo(x + CELL / 2 - 10, y + 4);
        ctx.lineTo(x + CELL / 2 - 10, y + CELL - 4);
        ctx.moveTo(x + CELL / 2 + 10, y + 4);
        ctx.lineTo(x + CELL / 2 + 10, y + CELL - 4);
      }
      ctx.stroke();
    }

    if (t === "i") {
      // ice sparkle
      var gl = 0.4 + 0.3 * Math.sin(time * 3 + r + c);
      ctx.strokeStyle = "rgba(255,255,255," + gl.toFixed(2) + ")";
      ctx.lineWidth = 2;
      var ix = x + 18 + hash3(r, c, 7) * 40;
      var iy = y + 18 + hash3(r, c, 8) * 40;
      ctx.beginPath();
      ctx.moveTo(ix - 5, iy);
      ctx.lineTo(ix + 5, iy);
      ctx.moveTo(ix, iy - 5);
      ctx.lineTo(ix, iy + 5);
      ctx.stroke();
    }

    if (t === "D") {
      var pulse = 0.55 + 0.35 * Math.sin(time * 3.2);
      ctx.fillStyle = "rgba(255,180,84," + (0.16 * pulse).toFixed(3) + ")";
      ctx.fillRect(x, y, CELL, CELL);
      ctx.fillStyle = "#20242f";
      ctx.fillRect(x + 18, y + 18, CELL - 36, CELL - 36);
      ctx.strokeStyle = "rgba(255,180,84," + pulse.toFixed(2) + ")";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 18, y + 18, CELL - 36, CELL - 36);
      ctx.strokeStyle = "rgba(255,220,150,0.5)";
      ctx.lineWidth = 2;
      var g;
      for (g = 0; g < 3; g++) {
        ctx.beginPath();
        ctx.moveTo(x + 24, y + 28 + g * 12);
        ctx.lineTo(x + CELL - 24, y + 28 + g * 12);
        ctx.stroke();
      }
    }

    // lamp pools on some road tiles
    if ((t === "R" || t === "i") && (r * COLS + c) % 9 === 4) {
      var lg = ctx.createRadialGradient(
        x + CELL / 2,
        y + CELL / 2,
        6,
        x + CELL / 2,
        y + CELL / 2,
        CELL * 0.8,
      );
      lg.addColorStop(0, "rgba(255,190,110,0.20)");
      lg.addColorStop(1, "rgba(255,190,110,0)");
      ctx.fillStyle = lg;
      ctx.fillRect(x - CELL / 2, y - CELL / 2, CELL * 2, CELL * 2);
      ctx.fillStyle = "#ffcf87";
      ctx.beginPath();
      ctx.arc(x + CELL / 2, y + CELL / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // parked cars
    if (t === "c") {
      drawCar(r, c, x, y);
    }
  }

  function drawCar(r, c, x, y) {
    var horizontal =
      (inBounds(r, c - 1) && terrain[r][c - 1] !== "#") ||
      (inBounds(r, c + 1) && terrain[r][c + 1] !== "#");
    var cols = ["#7d4438", "#3f5a80", "#55684a", "#6b5580"];
    var col = cols[Math.floor(hash3(r, c, 3) * cols.length)];
    ctx.save();
    ctx.translate(x + CELL / 2, y + CELL / 2);
    if (!horizontal) {
      ctx.rotate(Math.PI / 2);
    }
    ctx.fillStyle = "rgba(10,12,22,0.35)";
    roundRect(-26, -12, 52, 28, 8);
    ctx.fill();
    ctx.fillStyle = col;
    roundRect(-26, -14, 52, 28, 8);
    ctx.fill();
    ctx.fillStyle = "rgba(210,230,245,0.8)";
    roundRect(-8, -11, 16, 22, 4);
    ctx.fill();
    // snow blanket
    ctx.fillStyle = "rgba(238,244,252,0.9)";
    roundRect(-24, -14, 48, 9, 5);
    ctx.fill();
    ctx.restore();
  }

  function roundRect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawRings() {
    var i, rr;
    for (i = 0; i < rings.length; i++) {
      rr = rings[i];
      var k = rr.t / rr.life;
      ctx.strokeStyle = "rgba(191,230,239," + (0.5 * (1 - k)).toFixed(2) + ")";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(rr.x, rr.y, 8 + 40 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawSparks() {
    var i, s;
    for (i = 0; i < sparks.length; i++) {
      s = sparks[i];
      ctx.globalAlpha = 1 - s.t / s.life;
      ctx.fillStyle = s.col;
      ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawSmoke() {
    var i, s;
    for (i = 0; i < smokes.length; i++) {
      s = smokes[i];
      var k = s.t / s.life;
      ctx.globalAlpha = 0.16 * (1 - k);
      ctx.fillStyle = "#cfd6e4";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.rad + k * 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFlakes() {
    var i, f;
    for (i = 0; i < flakes.length; i++) {
      f = flakes[i];
      ctx.globalAlpha = 0.25 + 0.5 * f.z;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(f.x, f.y, 1.6 + f.z * 1.8, 1.6 + f.z * 1.8);
    }
    ctx.globalAlpha = 1;
  }

  function drawDawn() {
    if (!level) {
      return;
    }
    var prog = clamp(elapsed / level.time, 0, 1);
    if (prog > 0.001) {
      var g = ctx.createLinearGradient(0, 0, 0, H * 0.7);
      g.addColorStop(0, "rgba(255,157,106," + (0.2 * prog).toFixed(3) + ")");
      g.addColorStop(1, "rgba(255,157,106,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (fullFlashT > 0) {
      ctx.fillStyle = "rgba(217,83,79," + (0.1 * fullFlashT).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawTruck() {
    if (!truck) {
      return;
    }
    ctx.save();
    ctx.translate(truck.x, truck.y);

    var bounce = bumpT > 0 ? Math.sin(bumpT * 40) * 2.4 : 0;
    ctx.translate(bounce * 0.4, bounce);

    ctx.rotate(truck.dir * (Math.PI / 2));

    // headlight cones
    var hg = ctx.createLinearGradient(CELL / 2, 0, CELL * 1.5, 0);
    hg.addColorStop(0, "rgba(255,235,180,0.22)");
    hg.addColorStop(1, "rgba(255,235,180,0)");
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(CELL * 0.32, -14);
    ctx.lineTo(CELL * 1.45, -34);
    ctx.lineTo(CELL * 1.45, 34);
    ctx.lineTo(CELL * 0.32, 14);
    ctx.closePath();
    ctx.fill();

    // shadow
    ctx.fillStyle = "rgba(10,12,22,0.4)";
    roundRect(-30, -17, 60, 36, 9);
    ctx.fill();

    // blade
    ctx.fillStyle = "#98a2b8";
    ctx.beginPath();
    ctx.moveTo(26, -26);
    ctx.lineTo(36, -20);
    ctx.lineTo(36, 20);
    ctx.lineTo(26, 26);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#5c657c";
    ctx.lineWidth = 2;
    ctx.stroke();

    // drift mound riding the blade
    var dk = truck.drift / CAP;
    if (dk > 0) {
      var mw = 12 + 20 * dk;
      var mh = 10 + 16 * dk;
      ctx.fillStyle = truck.drift >= CAP ? "#fff2d8" : "#f2f6fc";
      ctx.beginPath();
      ctx.ellipse(30, 0, mw * 0.5, mh * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(160,178,205,0.5)";
      ctx.beginPath();
      ctx.ellipse(32, 0, mw * 0.28, mh * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // body
    ctx.fillStyle = "#d97f26";
    roundRect(-28, -14, 46, 28, 7);
    ctx.fill();
    ctx.strokeStyle = "#8c4d12";
    ctx.lineWidth = 2;
    roundRect(-28, -14, 46, 28, 7);
    ctx.stroke();
    // cab
    ctx.fillStyle = "#e89a44";
    roundRect(6, -12, 18, 24, 5);
    ctx.fill();
    ctx.fillStyle = "#20304a";
    roundRect(10, -9, 10, 8, 2);
    ctx.fill();
    roundRect(10, 1, 10, 8, 2);
    ctx.fill();
    // tyres
    ctx.fillStyle = "#181b26";
    ctx.fillRect(-26, -19, 12, 6);
    ctx.fillRect(-26, 13, 12, 6);
    ctx.fillRect(8, -19, 12, 6);
    ctx.fillRect(8, 13, 12, 6);

    // beacon
    var blink = Math.sin(beaconT * 7) > 0.2;
    ctx.fillStyle = blink ? "#ffd23f" : "#7a5b16";
    ctx.beginPath();
    ctx.arc(-6, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    if (blink) {
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(-6, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  /* ── main loop ────────────────────────────────────────────── */

  function frame(ts) {
    var dt = Math.min(0.033, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    if (!paused) {
      update(dt);
    } else {
      time += dt * 0.2;
      updateFlakes(dt * 0.3);
    }
    render();
    requestAnimationFrame(frame);
  }

  /* ── flow control ─────────────────────────────────────────── */

  function startRun() {
    audioInit();
    savedSeconds = 0;
    loadLevel(0);
  }

  function togglePause(force) {
    if (state !== "play") {
      return;
    }
    var want = typeof force === "boolean" ? force : !paused;
    if (want === paused) {
      return;
    }
    paused = want;
    sfxScrape(false);
    sfxEngine(false);
    if (paused) {
      showOverlay("pause");
    } else {
      overlays.pause.classList.add("hidden");
    }
  }

  function confirmOverlay() {
    audioInit();
    if (state === "title") {
      startRun();
    } else if (state === "levelend") {
      nextLevel();
    } else if (state === "over") {
      loadLevel(levelIndex);
    } else if (state === "won") {
      startRun();
    } else if (paused) {
      togglePause(false);
    }
  }

  function nextLevel() {
    if (levelIndex + 1 >= LEVELS.length) {
      setState("won");
      $("won-line").textContent =
        "Five streets, all clear, and " +
        savedSeconds +
        " spare seconds banked. You hear the diesel hiss at the bottom of the hill — the 7:05 rolls through clean streets.";
      showOverlay("won");
      sfxWin();
      return;
    }
    loadLevel(levelIndex + 1);
  }

  function restartLevel() {
    if (state === "play" || state === "over" || state === "levelend") {
      paused = false;
      overlays.pause.classList.add("hidden");
      loadLevel(levelIndex);
    }
  }

  function openHelp() {
    if (state === "title") {
      return;
    }
    togglePause(true);
  }

  /* ── input ────────────────────────────────────────────────── */

  var KEYMAP = {
    ArrowUp: "f",
    KeyW: "f",
    Space: "f",
    ArrowDown: "b",
    KeyS: "b",
    ArrowLeft: "tl",
    KeyA: "tl",
    ArrowRight: "tr",
    KeyD: "tr",
  };

  document.addEventListener("keydown", function (ev) {
    var code = ev.code;
    if (
      code === "ArrowUp" ||
      code === "ArrowDown" ||
      code === "ArrowLeft" ||
      code === "ArrowRight" ||
      code === "Space"
    ) {
      ev.preventDefault();
    }
    audioInit();

    if (code === "Enter") {
      ev.preventDefault();
      confirmOverlay();
      return;
    }
    if (code === "KeyP") {
      togglePause();
      return;
    }
    if (code === "KeyM") {
      muted = !muted;
      applyMute();
      return;
    }
    if (code === "KeyR") {
      restartLevel();
      return;
    }
    if (code === "KeyH" || code === "Slash") {
      openHelp();
      return;
    }
    if (code === "Escape") {
      togglePause(true);
      return;
    }

    var act = KEYMAP[code];
    if (act && !ev.repeat) {
      if (state === "title") {
        startRun();
        return;
      }
      queueAction(act);
    }
  });

  // touch pads with hold-to-repeat
  function bindPad(id, act) {
    var el = $(id);
    var timer = null;
    var stop = function () {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    el.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      audioInit();
      if (state === "title") {
        startRun();
        return;
      }
      queueAction(act);
      timer = window.setInterval(function () {
        queueAction(act);
      }, 170);
    });
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    el.addEventListener("pointerleave", stop);
  }
  bindPad("pad-up", "f");
  bindPad("pad-down", "b");
  bindPad("pad-left", "tl");
  bindPad("pad-right", "tr");

  // swipe on the canvas
  var swipe = null;
  canvas.addEventListener("pointerdown", function (ev) {
    audioInit();
    swipe = { x: ev.clientX, y: ev.clientY };
  });
  canvas.addEventListener("pointerup", function (ev) {
    if (!swipe) {
      return;
    }
    var dx = ev.clientX - swipe.x;
    var dy = ev.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) < 22 && Math.abs(dy) < 22) {
      return;
    }
    var act;
    if (Math.abs(dx) > Math.abs(dy)) {
      act = dx > 0 ? "tr" : "tl";
    } else {
      act = dy > 0 ? "b" : "f";
    }
    queueAction(act);
  });

  /* ── buttons ──────────────────────────────────────────────── */

  btnStart.addEventListener("click", function () {
    audioInit();
    startRun();
  });
  btnResume.addEventListener("click", function () {
    togglePause(false);
  });
  btnNext.addEventListener("click", function () {
    nextLevel();
  });
  btnRetry.addEventListener("click", function () {
    loadLevel(levelIndex);
  });
  btnAgain.addEventListener("click", function () {
    startRun();
  });
  btnPause.addEventListener("click", function () {
    togglePause();
  });
  btnMute.addEventListener("click", function () {
    audioInit();
    muted = !muted;
    applyMute();
  });
  btnRestart.addEventListener("click", function () {
    restartLevel();
  });
  btnHelp.addEventListener("click", function () {
    openHelp();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      togglePause(true);
    }
  });

  /* ── responsive canvas ────────────────────────────────────── */

  function fitCanvas() {
    var field = $("playfield");
    var availW = field.clientWidth - 16;
    var availH = field.clientHeight - 16;
    var scale = clamp(Math.min(availW / W, availH / H), 0.2, 1.6);
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = Math.round(W * scale) + "px";
    canvas.style.height = Math.round(H * scale) + "px";
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }
  window.addEventListener("resize", fitCanvas);

  /* ── boot ─────────────────────────────────────────────────── */

  fitCanvas();
  setState("title");
  showOverlay("title");
  syncHud();
  requestAnimationFrame(frame);

  // debug hook for automated playtesting (only with #debug in the URL)
  if (/debug/.test(window.location.hash)) {
    window.__btb = {
      mode: function () {
        return state + (paused ? ":paused" : "");
      },
      level: function () {
        return levelIndex;
      },
      sweeps: function () {
        return sweepsLeft();
      },
      drift: function () {
        return truck ? truck.drift : -1;
      },
      pos: function () {
        return truck ? [truck.r, truck.c, truck.dir] : null;
      },
      step: function (act) {
        return queueAction(act);
      },
      setRemain: function (sec) {
        elapsed = level.time - sec;
      },
      clearAll: function () {
        var r, c;
        for (r = 0; r < ROWS; r++) {
          for (c = 0; c < COLS; c++) {
            snowLeft -= snow[r][c];
            snow[r][c] = 0;
          }
        }
      },
    };
  }
})();
