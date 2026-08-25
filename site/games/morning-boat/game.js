/* The Morning Boat — a Hebridean mail-steamer week.
   Draw routes between island piers; the steamers do the rest. */
(function () {
  "use strict";

  /* ---------------- helpers ---------------- */

  var TAU = Math.PI * 2;
  var W = 960;
  var H = 600;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function el(id) {
    return document.getElementById(id);
  }

  /* ---------------- DOM ---------------- */

  var canvas = el("sea");
  var ctx = canvas.getContext("2d");

  var ui = {
    dayLabel: el("dayLabel"),
    tideFill: el("tideFill"),
    tideLug: el("tideLug"),
    quotaNum: el("quotaNum"),
    hearts: el("hearts"),
    hint: el("hint"),
    drawTools: el("drawTools"),
    fleetChip: el("fleetChip"),
    btnCastOff: el("btnCastOff"),
    btnUndoNode: el("btnUndoNode"),
    btnScrap: el("btnScrap"),
    btnHelp: el("btnHelp"),
    btnMute: el("btnMute"),
    btnPause: el("btnPause"),
    intro: el("introOverlay"),
    pauseOv: el("pauseOverlay"),
    failOv: el("failOverlay"),
    failTitle: el("failTitle"),
    failWhy: el("failWhy"),
    failTally: el("failTally"),
    boonOv: el("boonOverlay"),
    boonTitle: el("boonTitle"),
    dayTally: el("dayTally"),
    boonChoices: el("boonChoices"),
    winOv: el("winOverlay"),
    weekTally: el("weekTally"),
  };

  /* ---------------- passenger types ---------------- */

  var TYPES = [
    { key: "folk", color: "#e2725b", dark: "#8f3a2b" },
    { key: "post", color: "#e8b64c", dark: "#8a651a" },
    { key: "crate", color: "#8fc1d4", dark: "#3c6a80" },
  ];

  /* ---------------- the four days ---------------- */

  // accepts: indices into TYPES
  var DAYS = [
    {
      name: "Monday",
      quota: 12,
      time: 135,
      iv0: 2.5,
      iv1: 1.8,
      islands: [
        { name: "Craignure", x: 215, y: 175, accepts: [0] },
        { name: "Tobermory", x: 760, y: 150, accepts: [0, 2] },
        { name: "Salen", x: 515, y: 255, accepts: [1] },
        { name: "Fionnphort", x: 335, y: 485, accepts: [2] },
        { name: "Iona", x: 155, y: 395, accepts: [1, 0] },
      ],
    },
    {
      name: "Tuesday",
      quota: 20,
      time: 150,
      iv0: 2.2,
      iv1: 1.62,
      islands: [
        { name: "Bunessan", x: 165, y: 300, accepts: [2] },
        { name: "Lochdon", x: 400, y: 205, accepts: [0] },
        { name: "Craignure", x: 610, y: 275, accepts: [2, 1] },
        { name: "Salen", x: 735, y: 430, accepts: [0] },
        { name: "Calgary", x: 855, y: 165, accepts: [1, 0] },
        { name: "Pennyghael", x: 330, y: 470, accepts: [1, 2] },
      ],
    },
    {
      name: "Wednesday",
      quota: 30,
      time: 165,
      iv0: 2.0,
      iv1: 1.48,
      islands: [
        { name: "Ulva", x: 235, y: 115, accepts: [1] },
        { name: "Calgary", x: 505, y: 105, accepts: [0] },
        { name: "Salen", x: 725, y: 185, accepts: [2, 1] },
        { name: "Tobermory", x: 862, y: 330, accepts: [0, 2] },
        { name: "Lochdon", x: 445, y: 285, accepts: [0] },
        { name: "Craignure", x: 615, y: 455, accepts: [1, 2] },
        { name: "Bunessan", x: 365, y: 495, accepts: [2] },
        { name: "Iona", x: 150, y: 395, accepts: [1, 2] },
      ],
    },
    {
      name: "Thursday",
      quota: 42,
      time: 185,
      iv0: 1.85,
      iv1: 1.32,
      islands: [
        { name: "Gometra", x: 108, y: 168, accepts: [2, 0] },
        { name: "Ulva", x: 262, y: 108, accepts: [1] },
        { name: "Calgary", x: 512, y: 92, accepts: [0, 2] },
        { name: "Staffa", x: 762, y: 128, accepts: [1, 0] },
        { name: "Tobermory", x: 872, y: 300, accepts: [0] },
        { name: "Craignure", x: 688, y: 408, accepts: [2, 1] },
        { name: "Salen", x: 552, y: 252, accepts: [2, 0] },
        { name: "Pennyghael", x: 472, y: 492, accepts: [1, 0] },
        { name: "Bunessan", x: 292, y: 452, accepts: [2] },
        { name: "Iona", x: 142, y: 362, accepts: [1] },
      ],
    },
  ];

  var MAX_ROUTES = 5;
  var BASE_SPEED = 78;
  var BASE_HOLD = 6;
  var DOCK_TIME = 1.15;
  var QUEUE_SOFT = 7;
  var WORRY_TIME = 9;
  var HEARTS_MAX = 3;

  /* ---------------- state ---------------- */

  var mode = "intro"; // intro | play | pause | boon | fail | win
  var dayIdx = 0;
  var score = 0;
  var weekDelivered = 0;

  var fleet = { maxRoutes: 2, speedMult: 1, hold: BASE_HOLD };
  var hearts = HEARTS_MAX;
  var heartsAtDayStart = HEARTS_MAX;
  var bonusTimeNext = 0;

  var islands = [];
  var steamers = [];
  var draft = null; // { nodes: [i], closed: bool }
  var pointer = { x: W / 2, y: H / 2, in: false };

  var tide = 100;
  var tideMax = 100;
  var delivered = 0;
  var quota = 10;
  var spawnTimer = 2;
  var floaters = [];
  var smoke = [];
  var waves = [];
  var flash = 0; // red vignette after heart loss
  var hintTimer = 0;

  /* ---------------- audio ---------------- */

  var ac = null;
  var masterGain = null;
  var muted = false;
  var chimeStep = 0;

  function audioReady() {
    if (!ac) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
      masterGain = ac.createGain();
      masterGain.gain.value = muted ? 0 : 0.5;
      masterGain.connect(ac.destination);
    }
    if (ac.state === "suspended") ac.resume();
    return true;
  }

  function tone(freq, dur, type, vol, when, slideTo) {
    if (!audioReady()) return;
    var t0 = ac.currentTime + (when || 0);
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(masterGain);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function sndHorn() {
    tone(146, 0.55, "triangle", 0.22, 0, 138);
    tone(73, 0.55, "sine", 0.18, 0);
  }
  function sndChime() {
    var scale = [523, 587, 659, 784, 880];
    tone(scale[chimeStep % scale.length], 0.28, "sine", 0.16);
    chimeStep++;
  }
  function sndBoard() {
    tone(320, 0.07, "square", 0.035);
  }
  function sndThud() {
    tone(150, 0.5, "sawtooth", 0.22, 0, 60);
    tone(97, 0.5, "sine", 0.2, 0.02, 52);
  }
  function sndBell() {
    tone(880, 0.9, "sine", 0.14);
    tone(1320, 0.7, "sine", 0.06, 0.01);
    tone(1760, 0.5, "sine", 0.03, 0.02);
  }

  /* ---------------- setup per day ---------------- */

  function loadDay(idx, keepScore) {
    var d = DAYS[idx];
    dayIdx = idx;
    islands = [];
    steamers = [];
    draft = null;
    floaters = [];
    smoke = [];
    delivered = 0;
    quota = d.quota;
    tideMax = d.time + bonusTimeNext;
    tide = tideMax;
    bonusTimeNext = 0;
    spawnTimer = 2.2;
    flash = 0;
    hearts = heartsAtDayStart;

    var rng = mulberry32(1234 + idx * 77);
    var cx = W / 2,
      cy = H / 2;
    for (var i = 0; i < d.islands.length; i++) {
      var src = d.islands[i];
      var ang = Math.atan2(cy - src.y, cx - src.x); // pier points toward mid-sound
      var isl = {
        name: src.name,
        x: src.x,
        y: src.y,
        accepts: src.accepts.slice(),
        r: 27 + ((i * 5 + idx * 3) % 9),
        pierAng: ang,
        queue: [],
        worry: 0,
      };
      // blobby coastline
      var pts = [];
      var n = 11;
      for (var k = 0; k < n; k++) {
        var a = (k / n) * TAU;
        var rr = isl.r * (0.82 + rng() * 0.34);
        pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
      }
      isl.pts = pts;
      islands.push(isl);
    }

    // drifting wave dashes
    waves = [];
    for (var w = 0; w < 46; w++) {
      waves.push({
        x: rng() * W,
        y: 30 + rng() * (H - 60),
        len: 14 + rng() * 22,
        ph: rng() * TAU,
        sp: 6 + rng() * 12,
      });
    }

    if (!keepScore) {
      score = 0;
      weekDelivered = 0;
    }
    ui.dayLabel.textContent = d.name;
    showOverlay(null);
    setMode("play");
    updateHud(true);
    sndBell();
    flashHint(d.name + ". Deliver " + quota + " before the tide turns.");
  }

  function startWeek() {
    score = 0;
    weekDelivered = 0;
    fleet.maxRoutes = 2;
    fleet.speedMult = 1;
    fleet.hold = BASE_HOLD;
    bonusTimeNext = 0;
    hearts = HEARTS_MAX;
    heartsAtDayStart = HEARTS_MAX;
    loadDay(0, true);
  }

  function setMode(m) {
    mode = m;
    ui.drawTools.classList.toggle("hidden", m !== "play");
    canvas.style.cursor = m === "play" ? "crosshair" : "default";
    updateButtons();
  }

  function showOverlay(which) {
    ["intro", "pauseOv", "failOv", "boonOv", "winOv"].forEach(function (k) {
      ui[k].classList.add("hidden");
    });
    if (which) ui[which].classList.remove("hidden");
  }

  /* ---------------- HUD ---------------- */

  var lastHud = "";

  function updateHud(force) {
    var sig = [
      delivered,
      quota,
      Math.round(tide),
      hearts,
      fleet.maxRoutes - steamers.length,
      draft ? draft.nodes.length : 0,
    ].join("|");
    if (!force && sig === lastHud) return;
    lastHud = sig;

    ui.quotaNum.textContent = delivered + " / " + quota;
    var frac = clamp(tide / tideMax, 0, 1);
    ui.tideFill.style.width = (frac * 100).toFixed(2) + "%";
    ui.tideLug.style.left = "calc(" + (frac * 100).toFixed(2) + "% - 20px)";
    ui.tideFill.style.background =
      frac < 0.22
        ? "linear-gradient(90deg,#e2725b,#c94f38)"
        : "linear-gradient(90deg,#7fc4bd,#4d9a97)";

    var hs = "";
    for (var i = 0; i < HEARTS_MAX; i++) {
      hs += '<span class="' + (i < hearts ? "" : "spent") + '">\u2665</span>';
    }
    ui.hearts.innerHTML = hs;

    var left = fleet.maxRoutes - steamers.length;
    ui.fleetChip.textContent =
      "Steamers tied up: " + steamers.length + " \u00b7 spare: " + left;
    ui.fleetChip.style.color = left > 0 ? "#e8d5a8" : "#6f8d8a";
  }

  var HINT_DEFAULT =
    "Tap a pier to begin a route \u00b7 tap more piers to extend \u00b7 tap the first again to close the loop.";
  function flashHint(text) {
    ui.hint.textContent = text;
    hintTimer = 2.8;
  }

  function updateButtons() {
    ui.btnPause.textContent = mode === "pause" ? "\u25B6" : "II";
    ui.btnMute.classList.toggle("off", muted);
    ui.btnCastOff.disabled = !draft || draft.closed || draft.nodes.length < 2;
    ui.btnUndoNode.disabled = !draft || draft.nodes.length === 0;
    ui.btnScrap.disabled = !draft && steamers.length === 0;
  }

  /* ---------------- routing input ---------------- */

  function islandAt(x, y) {
    var best = -1,
      bd = 1e9;
    for (var i = 0; i < islands.length; i++) {
      var d = dist(x, y, islands[i].x, islands[i].y);
      if (d < islands[i].r + 12 && d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  function pierTip(isl) {
    return {
      x: isl.x + Math.cos(isl.pierAng) * (isl.r + 26),
      y: isl.y + Math.sin(isl.pierAng) * (isl.r + 26),
    };
  }

  function finishDraft(closed) {
    if (!draft || draft.nodes.length < 2) {
      scrapDraft();
      return;
    }
    if (steamers.length >= fleet.maxRoutes) {
      flashHint("No spare steamer in port \u2014 scrap a route first.");
      sndThud();
      return;
    }
    makeSteamer(draft.nodes.slice(), closed);
    draft = null;
    sndHorn();
    updateButtons();
    lastHud = "";
  }

  function scrapDraft() {
    draft = null;
    updateButtons();
    lastHud = "";
  }

  function scrapLastRoute() {
    if (draft) {
      scrapDraft();
      flashHint("Draft scrapped.");
      return;
    }
    if (steamers.length > 0) {
      var s = steamers.pop();
      // its passengers walk home ashore at the nearest island
      var homeIsl = islands[s.route[0]];
      while (s.aboard.length > 0 && homeIsl.queue.length < QUEUE_SOFT + 4) {
        homeIsl.queue.push(s.aboard.pop());
      }
      floaters.push({
        x: homeIsl.x,
        y: homeIsl.y - homeIsl.r - 18,
        text: "laid up",
        age: 0,
        col: "#9db8b5",
      });
      lastHud = "";
    }
  }

  function onPoint(ev) {
    var rect = canvas.getBoundingClientRect();
    var x = (ev.clientX - rect.left) * (W / rect.width);
    var y = (ev.clientY - rect.top) * (H / rect.height);
    return { x: x, y: y };
  }

  canvas.addEventListener("pointermove", function (ev) {
    var p = onPoint(ev);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.in = true;
  });

  canvas.addEventListener("pointerdown", function (ev) {
    if (mode !== "play") return;
    ev.preventDefault();
    var p = onPoint(ev);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.in = true;
    var hit = islandAt(p.x, p.y);
    if (hit < 0) return;

    if (!draft) {
      draft = { nodes: [hit], closed: false };
      sndBoard();
    } else if (hit === draft.nodes[0] && draft.nodes.length >= 2) {
      finishDraft(true); // tapped the first pier again: close the loop
    } else if (hit === draft.nodes[draft.nodes.length - 1]) {
      if (draft.nodes.length >= 2) finishDraft(false); // tapped the last twice: cast off open
    } else if (hit !== draft.nodes[draft.nodes.length - 1]) {
      draft.nodes.push(hit);
      sndBoard();
    }
    updateButtons();
    lastHud = "";
  });

  canvas.addEventListener("contextmenu", function (ev) {
    ev.preventDefault();
  });

  window.addEventListener("keydown", function (ev) {
    var k = ev.key;
    if (k === "p" || k === "P") {
      togglePause();
      return;
    }
    if (k === "m" || k === "M") {
      toggleMute();
      return;
    }
    if (k === "h" || k === "H") {
      if (mode === "play") {
        showOverlay("intro");
        setMode("pause");
      } else if (mode === "pause") {
        showOverlay(null);
        setMode("play");
      }
      return;
    }
    if (mode !== "play") {
      if ((k === "r" || k === "R") && mode === "fail") retryDay();
      return;
    }
    if (k === "Enter") {
      if (draft && !draft.closed) finishDraft(false);
    } else if (k === "Escape") {
      scrapDraft();
    } else if (k === "r" || k === "R") {
      retryDay();
    }
  });

  /* ---------------- buttons ---------------- */

  function togglePause() {
    if (mode === "play") {
      showOverlay("pauseOv");
      setMode("pause");
    } else if (mode === "pause") {
      showOverlay(null);
      setMode("play");
    }
  }

  function toggleMute() {
    muted = !muted;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.5;
    updateButtons();
  }

  el("btnSail").addEventListener("click", function () {
    audioReady();
    sndBell();
    startWeek();
  });
  el("btnAgain").addEventListener("click", function () {
    startWeek();
  });
  el("btnResume").addEventListener("click", togglePause);
  el("btnRestartFromPause").addEventListener("click", function () {
    retryDay();
  });
  el("btnRetryDay").addEventListener("click", function () {
    retryDay();
  });
  el("btnRestartWeekFail").addEventListener("click", function () {
    startWeek();
  });
  ui.btnPause.addEventListener("click", togglePause);
  ui.btnMute.addEventListener("click", toggleMute);
  ui.btnHelp.addEventListener("click", function () {
    if (mode === "play") {
      showOverlay("intro");
      setMode("pause");
    } else if (mode === "pause") {
      showOverlay(null);
      setMode("play");
    }
  });
  ui.btnCastOff.addEventListener("click", function () {
    if (draft && !draft.closed) finishDraft(false);
  });
  ui.btnUndoNode.addEventListener("click", function () {
    if (draft) {
      draft.nodes.pop();
      if (draft.nodes.length === 0) draft = null;
    }
    updateButtons();
    lastHud = "";
  });
  ui.btnScrap.addEventListener("click", scrapLastRoute);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && mode === "play") togglePause();
  });

  /* ---------------- steamers & passengers ---------------- */

  function makeSteamer(nodes, closed) {
    steamers.push({
      route: nodes,
      closed: closed,
      from: 0,
      to: 1,
      dir: 1, // ping-pong direction for open routes
      t: 0,
      dock: 0.6, // brief pause at the first pier while casting off
      aboard: [],
      wake: [],
    });
  }

  function nextLeg(s) {
    var n = s.route.length;
    var cur = s.to;
    if (s.closed) {
      s.from = cur;
      s.to = (cur + 1) % n;
    } else {
      if (cur === n - 1) s.dir = -1;
      else if (cur === 0) s.dir = 1;
      s.from = cur;
      s.to = cur + s.dir;
    }
    s.t = 0;
  }

  function legLen(s) {
    var a = islands[s.route[s.from]];
    var b = islands[s.route[s.to]];
    return dist(a.x, a.y, b.x, b.y) || 1;
  }

  function trySpawn() {
    var n = islands.length;
    for (var tries = 0; tries < 8; tries++) {
      var i = (Math.random() * n) | 0;
      var isl = islands[i];
      if (isl.queue.length >= QUEUE_SOFT + 5) continue;
      var ty = isl.accepts[(Math.random() * isl.accepts.length) | 0];
      var dests = [];
      for (var j = 0; j < n; j++) {
        if (j !== i && islands[j].accepts.indexOf(ty) >= 0) dests.push(j);
      }
      if (dests.length === 0) continue;
      isl.queue.push({
        type: ty,
        dest: dests[(Math.random() * dests.length) | 0],
        born: 0,
      });
      return;
    }
  }

  function deliver(isl, pass) {
    delivered++;
    weekDelivered++;
    score += 10;
    sndChime();
    floaters.push({
      x: isl.x + Math.cos(isl.pierAng) * 8,
      y: isl.y + Math.sin(isl.pierAng) * 8 - isl.r - 6,
      text: "+1",
      age: 0,
      col: "#ffd98a",
    });
  }

  function loseHeart(isl) {
    hearts--;
    flash = 1;
    sndThud();
    var tip = pierTip(isl);
    floaters.push({
      x: tip.x,
      y: tip.y - 16,
      text: "\u2665 lost",
      age: 0,
      col: "#ff9d8a",
    });
    for (var g = 0; g < 3; g++) {
      if (isl.queue.length > 0) isl.queue.shift();
    }
    isl.worry = 0;
    if (hearts <= 0 && mode === "play") {
      endDay(false, "Patience ran out at the piers.");
    }
  }

  function steamerPos(s) {
    var a = islands[s.route[s.from]];
    var b = islands[s.route[s.to]];
    return {
      x: lerp(a.x, b.x, s.t),
      y: lerp(a.y, b.y, s.t),
      ang: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  function updateSteamer(s, dt) {
    if (s.dock > 0) {
      s.dock -= dt;
      if (s.dock <= 0) nextLeg(s);
      return;
    }
    s.t += (BASE_SPEED * fleet.speedMult * dt) / legLen(s);
    if (s.t < 1) {
      var p = steamerPos(s);
      s.wake.unshift({ x: p.x, y: p.y, a: p.ang });
      if (s.wake.length > 26) s.wake.pop();

      if (Math.random() < dt * 6) {
        smoke.push({
          x: p.x,
          y: p.y - 12,
          vx: (Math.random() - 0.5) * 8,
          vy: -14 - Math.random() * 8,
          age: 0,
          life: 1.6 + Math.random(),
        });
      }
      return;
    }
    // reached the pier: tie up, work the cargo, then sail on
    s.t = 1;
    arrive(s, s.route[s.to]);
  }

  function arrive(s, islIdx) {
    var isl = islands[islIdx];
    s.dock = DOCK_TIME;
    // unload everyone bound here
    for (var i = s.aboard.length - 1; i >= 0; i--) {
      if (s.aboard[i].dest === islIdx) {
        deliver(isl, s.aboard[i]);
        s.aboard.splice(i, 1);
      }
    }
    // then take new folk aboard until the hold is full
    while (s.aboard.length < fleet.hold && isl.queue.length > 0) {
      s.aboard.push(isl.queue.shift());
      sndBoard();
    }
  }

  /* ---------------- day flow ---------------- */

  function endDay(passed, why) {
    if (passed) {
      score += hearts * 15;
      heartsAtDayStart = hearts;
      if (dayIdx === DAYS.length - 1) {
        ui.weekTally.innerHTML =
          "The week\u2019s mail: <b>" +
          weekDelivered +
          "</b> souls &amp; parcels landed.<br>Final standing: <b>" +
          score +
          "</b>";
        showOverlay("winOv");
        setMode("win");
        sndBell();
      } else {
        offerBoons();
      }
    } else {
      ui.failTitle.textContent = "The week is lost";
      ui.failWhy.textContent = why;
      ui.failTally.innerHTML =
        DAYS[dayIdx].name +
        ": " +
        delivered +
        " of " +
        quota +
        " delivered \u00b7 standing " +
        score;
      showOverlay("failOv");
      setMode("fail");
    }
  }

  function retryDay() {
    hearts = heartsAtDayStart;
    loadDay(dayIdx, true);
  }

  var BOONS = [
    {
      name: "Charter another steamer",
      note: "one more boat, one more route",
      ok: function () {
        return fleet.maxRoutes < MAX_ROUTES;
      },
      apply: function () {
        fleet.maxRoutes++;
      },
    },
    {
      name: "Copper bottom",
      note: "all steamers sail a quarter faster",
      ok: function () {
        return true;
      },
      apply: function () {
        fleet.speedMult += 0.25;
      },
    },
    {
      name: "Deeper hold",
      note: "three more souls fit below",
      ok: function () {
        return true;
      },
      apply: function () {
        fleet.hold += 3;
      },
    },
    {
      name: "Kind islanders",
      note: "the parish forgives; one heart returns",
      ok: function () {
        return hearts < HEARTS_MAX;
      },
      apply: function () {
        hearts++;
        heartsAtDayStart = hearts;
      },
    },
    {
      name: "Fair tide",
      note: "tomorrow\u2019s tide waits fifteen seconds longer",
      ok: function () {
        return true;
      },
      apply: function () {
        bonusTimeNext = 15;
      },
    },
  ];

  function offerBoons() {
    var pool = BOONS.filter(function (b) {
      return b.ok();
    });
    for (var i = pool.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    var picks = pool.slice(0, 3);
    ui.boonTitle.textContent = DAYS[dayIdx + 1].name + " dawns";
    ui.dayTally.innerHTML =
      DAYS[dayIdx].name +
      " kept: " +
      delivered +
      " of " +
      quota +
      " delivered \u00b7 standing " +
      score +
      " \u00b7 " +
      hearts +
      " \u2665";
    ui.boonChoices.innerHTML = "";
    picks.forEach(function (b) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "boonBtn";
      btn.innerHTML = "<b>" + b.name + "</b><small>" + b.note + "</small>";
      btn.addEventListener("click", function () {
        b.apply();
        loadDay(dayIdx + 1, true);
      });
      ui.boonChoices.appendChild(btn);
    });
    showOverlay("boonOv");
    setMode("boon");
    sndBell();
  }

  /* ---------------- drawing ---------------- */

  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

  function drawTypeGlyph(t, x, y, s, inkOnly) {
    var c = TYPES[t];
    ctx.strokeStyle = inkOnly ? c.dark : "#24343c";
    ctx.fillStyle = inkOnly ? c.dark : c.color;
    ctx.lineWidth = Math.max(1, s * 0.14);
    if (t === 0) {
      // folk
      ctx.beginPath();
      ctx.arc(x, y - s * 0.22, s * 0.26, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y + s * 0.42, s * 0.44, Math.PI, TAU);
      ctx.stroke();
    } else if (t === 1) {
      // post
      ctx.beginPath();
      ctx.rect(x - s * 0.46, y - s * 0.3, s * 0.92, s * 0.6);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.46, y - s * 0.3);
      ctx.lineTo(x, y + s * 0.06);
      ctx.lineTo(x + s * 0.46, y - s * 0.3);
      ctx.stroke();
    } else {
      // crate
      ctx.beginPath();
      ctx.rect(x - s * 0.4, y - s * 0.4, s * 0.8, s * 0.8);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.4, y - s * 0.4);
      ctx.lineTo(x + s * 0.4, y + s * 0.4);
      ctx.stroke();
    }
  }

  function drawIsland(isl, time) {
    // sand rim
    ctx.save();
    ctx.translate(isl.x, isl.y);
    ctx.beginPath();
    for (var i = 0; i < isl.pts.length; i++) {
      var q = isl.pts[i];
      var x = q.x * 1.16,
        y = q.y * 1.16;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "#dfd0a4";
    ctx.fill();

    ctx.beginPath();
    for (var j = 0; j < isl.pts.length; j++) {
      var p = isl.pts[j];
      if (j === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = "#7ba36b";
    ctx.fill();
    ctx.strokeStyle = "#5d8552";
    ctx.lineWidth = 2;
    ctx.stroke();

    // a tuft or two
    ctx.fillStyle = "#6a9360";
    ctx.beginPath();
    ctx.arc(-isl.r * 0.3, -isl.r * 0.15, isl.r * 0.22, 0, TAU);
    ctx.arc(isl.r * 0.28, isl.r * 0.22, isl.r * 0.17, 0, TAU);
    ctx.fill();

    // pier plank
    var px = Math.cos(isl.pierAng),
      py = Math.sin(isl.pierAng);
    ctx.strokeStyle = "#8a6844";
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(px * isl.r * 0.7, py * isl.r * 0.7);
    ctx.lineTo(px * (isl.r + 24), py * (isl.r + 24));
    ctx.stroke();
    ctx.strokeStyle = "#a97c50";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();

    // waiting folk queue along the pier
    var tip = pierTip(isl);
    var dx = px * 13,
      dy = py * 13;
    for (var k = 0; k < isl.queue.length && k < QUEUE_SOFT + 5; k++) {
      var qx = tip.x + dx * k,
        qy = tip.y + dy * k;
      ctx.beginPath();
      ctx.fillStyle = TYPES[isl.queue[k].type].color;
      ctx.strokeStyle = "rgba(20,40,46,0.75)";
      ctx.lineWidth = 1.5;
      ctx.arc(qx, qy, 6.5, 0, TAU);
      ctx.fill();
      ctx.stroke();
      drawTypeGlyph(isl.queue[k].type, qx, qy, 7, true);
    }

    // name plate
    ctx.font = "bold 13px Georgia, serif";
    var tw = ctx.measureText(isl.name).width;
    var ny = isl.y + isl.r + 10;
    ctx.fillStyle = "rgba(244,234,216,0.93)";
    roundRect(isl.x - tw / 2 - 7, ny, tw + 14, 19, 8);
    ctx.fill();
    ctx.fillStyle = "#24343c";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(isl.name, isl.x, ny + 10);

    // accepted-marks badges
    var bx = isl.x - (isl.accepts.length * 22 - 8) / 2;
    var by = ny + 24;
    for (var b = 0; b < isl.accepts.length; b++) {
      ctx.fillStyle = "#f7efdd";
      roundRect(bx + b * 22, by, 18, 16, 5);
      ctx.fill();
      ctx.strokeStyle = "#cdb98d";
      ctx.lineWidth = 1;
      ctx.stroke();
      drawTypeGlyph(isl.accepts[b], bx + b * 22 + 9, by + 8, 9, true);
    }

    // worry ring when the jetty grumbles
    if (isl.worry > 0.05) {
      var wr = isl.r + 10 + Math.sin(time * 6) * 2;
      ctx.beginPath();
      ctx.arc(
        isl.x,
        isl.y,
        wr,
        -Math.PI / 2,
        -Math.PI / 2 + TAU * (isl.worry / WORRY_TIME),
      );
      ctx.strokeStyle =
        "rgba(226,84,60," +
        (0.35 + 0.45 * (isl.worry / WORRY_TIME)).toFixed(2) +
        ")";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }

  function drawRouteLine(nodes, closed, dashOffset, style, width) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.setLineDash([9, 8]);
    ctx.lineDashOffset = dashOffset;
    ctx.beginPath();
    for (var i = 0; i < nodes.length; i++) {
      var a = islands[nodes[i]];
      if (i === 0) ctx.moveTo(a.x, a.y);
      else ctx.lineTo(a.x, a.y);
    }
    if (closed && nodes.length > 2) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawSteamer(s, time) {
    var p = steamerPos(s);
    var ang = p.ang;
    if (s.dir < 0) ang += Math.PI;

    // wake
    ctx.lineCap = "round";
    for (var i = 0; i < s.wake.length; i++) {
      var wk = s.wake[i];
      var al = 0.3 * (1 - i / s.wake.length);
      ctx.strokeStyle = "rgba(230,245,240," + al.toFixed(3) + ")";
      ctx.lineWidth = 2.5;
      var nx = Math.cos(wk.a + Math.PI / 2),
        ny = Math.sin(wk.a + Math.PI / 2);
      var spread = 4 + i * 0.55;
      ctx.beginPath();
      ctx.moveTo(wk.x + nx * spread, wk.y + ny * spread);
      ctx.lineTo(wk.x - nx * spread, wk.y - ny * spread);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(p.x, p.y);

    // hull rides flat even when reversing
    ctx.rotate(ang);
    // hull
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.quadraticCurveTo(10, 8, -12, 7);
    ctx.quadraticCurveTo(-16, 7, -16, 0);
    ctx.quadraticCurveTo(-16, -7, -12, -7);
    ctx.quadraticCurveTo(10, -8, 16, 0);
    ctx.closePath();
    ctx.fillStyle = "#2e2a26";
    ctx.fill();
    ctx.strokeStyle = "#191512";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // gunwale stripe
    ctx.strokeStyle = "#e8d5a8";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(12, -3.2);
    ctx.quadraticCurveTo(0, -5.4, -12, -4);
    ctx.stroke();
    // deckhouse
    ctx.fillStyle = "#f4ead8";
    roundRect(-8, -4.6, 11, 9.2, 2.5);
    ctx.fill();
    ctx.fillStyle = "#24343c";
    ctx.fillRect(-5.4, -2.4, 3, 3);
    // funnel
    ctx.fillStyle = "#b8452f";
    ctx.fillRect(4.4, -2.6, 3.6, 5.2);
    ctx.restore();

    // hold pips: what she carries
    for (var h = 0; h < s.aboard.length; h++) {
      var hx = p.x + (h - (fleet.hold - 1) / 2) * 8;
      ctx.beginPath();
      ctx.fillStyle = TYPES[s.aboard[h].type].color;
      ctx.arc(hx, p.y + 15, 3, 0, TAU);
      ctx.fill();
    }
  }

  function draw(time, dt) {
    resizeCanvas();
    ctx.clearRect(0, 0, W, H);

    // sea
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#2b8a90");
    grad.addColorStop(0.55, "#1c6470");
    grad.addColorStop(1, "#124450");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // wave dashes
    ctx.strokeStyle = "rgba(220,240,235,0.14)";
    ctx.lineWidth = 2;
    for (var i = 0; i < waves.length; i++) {
      var wv = waves[i];
      var wx =
        ((wv.x + Math.sin(time * 0.25 + wv.ph) * 14 + time * wv.sp * 0.4) %
          (W + 60)) -
        30;
      ctx.beginPath();
      ctx.moveTo(wx, wv.y + Math.sin(time * 0.8 + wv.ph) * 2);
      ctx.quadraticCurveTo(
        wx + wv.len / 2,
        wv.y - 3 + Math.cos(time + wv.ph) * 2,
        wx + wv.len,
        wv.y,
      );
      ctx.stroke();
    }

    // finished routes under everything else
    for (var s2 = 0; s2 < steamers.length; s2++) {
      drawRouteLine(
        steamers[s2].route,
        steamers[s2].closed,
        -time * 26,
        "rgba(244,234,216,0.55)",
        3,
      );
    }

    // draft preview
    if (draft && draft.nodes.length > 0) {
      var last = islands[draft.nodes[draft.nodes.length - 1]];
      ctx.strokeStyle = "rgba(233,182,76,0.85)";
      ctx.lineWidth = 3;
      ctx.setLineDash([7, 7]);
      ctx.lineDashOffset = -time * 30;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(pointer.x, pointer.y);
      ctx.stroke();
      ctx.setLineDash([]);
      drawRouteLine(
        draft.nodes,
        draft.closed,
        -time * 30,
        "rgba(233,182,76,0.9)",
        3.5,
      );
      var hov = islandAt(pointer.x, pointer.y);
      if (hov >= 0) {
        var hi = islands[hov];
        ctx.beginPath();
        ctx.arc(hi.x, hi.y, hi.r + 8, 0, TAU);
        ctx.strokeStyle =
          draft.nodes.indexOf(hov) === 0 && draft.nodes.length >= 2
            ? "rgba(255,217,138,0.95)"
            : "rgba(244,234,216,0.8)";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    // islands
    for (var il = 0; il < islands.length; il++) drawIsland(islands[il], time);

    // smoke behind, boats in front
    for (var sm = 0; sm < smoke.length; sm++) {
      var sk = smoke[sm];
      var sa = 0.3 * (1 - sk.age / sk.life);
      if (sa > 0) {
        ctx.beginPath();
        ctx.fillStyle = "rgba(235,235,225," + sa.toFixed(3) + ")";
        ctx.arc(sk.x, sk.y, 3 + sk.age * 4, 0, TAU);
        ctx.fill();
      }
    }
    for (var st = 0; st < steamers.length; st++)
      drawSteamer(steamers[st], time);

    // floaters
    ctx.font = "bold 14px Georgia, serif";
    ctx.textAlign = "center";
    for (var f = floaters.length - 1; f >= 0; f--) {
      var fl = floaters[f];
      var fa = fl.age < 0.9 ? 1 : 1 - (fl.age - 0.9) / 0.7;
      if (fa <= 0) {
        floaters.splice(f, 1);
        continue;
      }
      ctx.globalAlpha = fa;
      ctx.fillStyle = fl.col;
      ctx.fillText(fl.text, fl.x, fl.y - fl.age * 22);
      ctx.globalAlpha = 1;
    }

    // hurt vignette
    if (flash > 0) {
      ctx.strokeStyle = "rgba(200,60,40," + (flash * 0.5).toFixed(3) + ")";
      ctx.lineWidth = 26;
      ctx.strokeRect(0, 0, W, H);
    }
  }

  /* ---------------- main loop ---------------- */

  var lastTs = null;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (lastTs === null) {
      lastTs = ts;
      return;
    }
    var dt = Math.min((ts - lastTs) / 1000, 0.06);
    lastTs = ts;
    var time = ts / 1000;

    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0) ui.hint.textContent = HINT_DEFAULT;
    }

    if (mode === "play") {
      // tide
      tide -= dt;
      if (tide <= 0) {
        tide = 0;
        endDay(
          delivered >= quota,
          "The tide turned with the mail still waiting.",
        );
        draw(time, dt);
        return;
      }

      // spawning
      var prog = 1 - tide / tideMax;
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        trySpawn();
        var d = DAYS[dayIdx];
        spawnTimer = lerp(d.iv0, d.iv1, prog) * (0.75 + Math.random() * 0.5);
      }

      // island queues
      for (var i = 0; i < islands.length; i++) {
        var isl = islands[i];
        if (isl.queue.length >= QUEUE_SOFT) {
          isl.worry += dt;
          if (isl.worry >= WORRY_TIME) loseHeart(isl);
          if (mode !== "play") {
            draw(time, dt);
            return;
          } // the last heart went
        } else if (isl.worry > 0) {
          isl.worry = Math.max(0, isl.worry - dt * 2);
        }
      }

      // steamers
      for (var s = 0; s < steamers.length; s++) updateSteamer(steamers[s], dt);

      // particles
      for (var sm = smoke.length - 1; sm >= 0; sm--) {
        var sk = smoke[sm];
        sk.age += dt;
        sk.x += sk.vx * dt;
        sk.y += sk.vy * dt;
        if (sk.age >= sk.life) smoke.splice(sm, 1);
      }
      for (var fl = floaters.length - 1; fl >= 0; fl--) {
        floaters[fl].age += dt;
        if (floaters[fl].age > 1.6) floaters.splice(fl, 1);
      }
      if (flash > 0) flash = Math.max(0, flash - dt * 1.4);

      updateHud(false);
    }

    draw(time, dt);
  }

  requestAnimationFrame(frame);
})();
