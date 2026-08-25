/*
 * The Exchange — a 1920s seaside-hotel telephone switchboard game for the arcade.
 *
 * Guests ring down the left column wanting a line (Dining, Bar, Rooms, Desk,
 * Doctor, Manager). You have five patch cords: tap a ringing guest to lift one
 * end, tap a destination jack to plug the other. Connected calls chat for a
 * while, then pop free with a tip. Let three rings die unanswered and the
 * manager comes up the stairs; serve the night's quota and the dawn comes.
 *
 * Everything lives in this one classic script, wrapped in an IIFE. Vanilla
 * canvas + Web Audio, no dependencies, no network.
 */
(function () {
  "use strict";

  /* ── dom ─────────────────────────────────────────────────────────── */

  var cvs = document.getElementById("game");
  var ctx = cvs.getContext("2d");

  var elScore = document.getElementById("score");
  var elServed = document.getElementById("served");
  var elStreakChip = document.getElementById("streakChip");
  var elStreak = document.getElementById("streak");
  var elLost = document.getElementById("lostChip");
  var elCords = document.getElementById("cordChip");
  var pauseBtn = document.getElementById("pauseBtn");
  var soundBtn = document.getElementById("soundBtn");
  var newBtn = document.getElementById("newBtn");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovBody = document.getElementById("ovBody");
  var ovBtn = document.getElementById("ovBtn");
  var boardwrap = document.getElementById("boardwrap");

  /* ── config ──────────────────────────────────────────────────────── */

  var LW = 800;
  var LH = 1060;
  var QUOTA_DEFAULT = 20;

  var params = {};
  try {
    params = new URLSearchParams(window.location.search);
  } catch (e) {
    params = {
      get: function () {
        return null;
      },
    };
  }
  var QUOTA = clampInt(
    params.get ? params.get("quota") : null,
    3,
    99,
    QUOTA_DEFAULT,
  );
  var PACE = clampFloat(params.get ? params.get("pace") : null, 0.5, 4, 1);

  var DESTS = [
    { key: "DINING", label: "DINING" },
    { key: "BAR", label: "BAR" },
    { key: "ROOMS", label: "ROOMS" },
    { key: "DESK", label: "DESK" },
    { key: "DOCTOR", label: "DOCTOR" },
    { key: "MGR", label: "MANAGER" },
  ];

  var CORD_COLORS = ["#3f8f86", "#b0473c", "#c99a2e", "#5a6b8c", "#7d4a78"];
  var NUM_CORDS = CORD_COLORS.length;
  var NUM_SLOTS = 8;
  var MAX_LOST = 3;

  /* layout (logical units) */
  var callerRect = [];
  var destRect = [];
  (function buildLayout() {
    for (var i = 0; i < NUM_SLOTS; i++) {
      callerRect.push({ x: 42, y: 165 + i * 104, w: 290, h: 86 });
    }
    for (var j = 0; j < DESTS.length; j++) {
      destRect.push({ x: 468, y: 188 + j * 140, w: 288, h: 92 });
    }
  })();

  var SKINS = ["#eec39a", "#d9a066", "#a9714b", "#8d5524", "#f2d3b1"];
  var HAT_BOWLER = 0,
    HAT_CLOCHE = 1,
    HAT_FLAT = 2,
    HAT_NIGHT = 3,
    HAT_NONE = 4;

  /* ── helpers ─────────────────────────────────────────────────────── */

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function clampInt(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    return isNaN(n) ? dflt : clamp(n, lo, hi);
  }

  function clampFloat(v, lo, hi, dflt) {
    var n = parseFloat(v);
    return isNaN(n) ? dflt : clamp(n, lo, hi);
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* ── audio ───────────────────────────────────────────────────────── */

  var AC = null;
  var master = null;
  var muted = false;
  try {
    muted = window.localStorage.getItem("exchange-muted") === "1";
  } catch (e) {}

  function audio() {
    if (!AC) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      try {
        AC = new Ctor();
        master = AC.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(AC.destination);
      } catch (e) {
        AC = null;
      }
    }
    if (AC && AC.state === "suspended") AC.resume();
  }

  function tone(f, dur, type, vol, delay, slideTo) {
    if (!AC) return;
    var t = AC.currentTime + (delay || 0);
    var o = AC.createOscillator();
    var g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slideTo)
      o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  function thud(vol, delay) {
    if (!AC) return;
    var t = AC.currentTime + (delay || 0);
    var len = Math.floor(AC.sampleRate * 0.06);
    var buf = AC.createBuffer(1, len, AC.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = AC.createBufferSource();
    src.buffer = buf;
    var f = AC.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 900;
    var g = AC.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
  }

  var sfx = {
    pickup: function () {
      tone(720, 0.05, "square", 0.1);
    },
    plug: function () {
      thud(0.3);
      tone(170, 0.09, "sine", 0.28, 0, 120);
    },
    deny: function () {
      tone(150, 0.16, "sawtooth", 0.16, 0, 110);
    },
    ding: function () {
      tone(880, 0.14, "sine", 0.2);
      tone(1318, 0.2, "sine", 0.14, 0.07);
    },
    coin: function () {
      tone(1046, 0.08, "triangle", 0.16, 0.02);
      tone(1568, 0.14, "triangle", 0.13, 0.09);
    },
    abandon: function () {
      tone(240, 0.38, "sawtooth", 0.2, 0, 90);
      tone(120, 0.4, "square", 0.12, 0.05, 60);
    },
    ring: function () {
      tone(1450, 0.06, "square", 0.055);
      tone(1150, 0.06, "square", 0.05, 0.09);
    },
    urgent: function () {
      tone(980, 0.07, "square", 0.12);
      tone(980, 0.07, "square", 0.12, 0.11);
      tone(1240, 0.1, "square", 0.13, 0.22);
    },
    win: function () {
      var seq = [523, 659, 784, 1046];
      for (var i = 0; i < seq.length; i++)
        tone(seq[i], 0.22, "triangle", 0.16, i * 0.13);
    },
    lose: function () {
      var seq = [392, 330, 262, 196];
      for (var i = 0; i < seq.length; i++)
        tone(seq[i], 0.3, "sawtooth", 0.12, i * 0.16);
    },
  };

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.5;
    soundBtn.textContent = m ? "Sound: Off" : "Sound: On";
    try {
      window.localStorage.setItem("exchange-muted", m ? "1" : "0");
    } catch (e) {}
  }

  /* ── state ───────────────────────────────────────────────────────── */

  var mode = "title"; // title | playing | paused | won | lost
  var slots = []; // caller slots
  var destBusy = []; // per destination: cord index or -1
  var destRemain = [];
  var cords = [];
  var sel = -1; // index of held (half-plugged) cord, -1 none
  var score = 0;
  var served = 0;
  var totalServed = 0;
  var lostCount = 0;
  var streak = 0;
  var spawnT = 1600;
  var spawnsSinceDoc = 0;
  var connectFracs = [];
  var dawnT = 0;
  var shake = 0;
  var clockMs = 0;

  var floats = [];
  var sparks = [];

  var pointerLogical = { x: LW / 2, y: LH / 2 };
  var hoverCell = null;
  var cur = { col: 0, row: 0 };
  var lastInput = "ptr";

  function makeCords() {
    cords = [];
    for (var i = 0; i < NUM_CORDS; i++) {
      cords.push({ state: "free", slot: -1, dest: -1, remain: 0, frac: 0 });
    }
  }

  function makeSlots() {
    slots = [];
    for (var i = 0; i < NUM_SLOTS; i++) slots.push(null);
  }

  function resetBoard() {
    makeSlots();
    makeCords();
    destBusy = [];
    destRemain = [];
    for (var j = 0; j < DESTS.length; j++) {
      destBusy.push(-1);
      destRemain.push(0);
    }
    sel = -1;
    score = 0;
    served = 0;
    lostCount = 0;
    streak = 0;
    spawnT = 1500;
    spawnsSinceDoc = 0;
    connectFracs = [];
    floats = [];
    sparks = [];
    shake = 0;
  }

  /* ── difficulty & spawning ───────────────────────────────────────── */

  function spawnInterval() {
    var base = Math.max(2000, 4300 - totalServed * 90) / PACE;
    return base + rand(-350, 450);
  }

  function patienceFor(kind) {
    if (kind === "doc") return 6000 / PACE;
    if (kind === "vip") return 11500 / PACE;
    return Math.max(7600, 13200 - totalServed * 250) / PACE;
  }

  function spawnCall() {
    var free = [];
    for (var i = 0; i < NUM_SLOTS; i++) if (!slots[i]) free.push(i);
    if (!free.length) return false;

    var kind = "normal";
    if (totalServed >= 5 && spawnsSinceDoc >= 3 && Math.random() < 0.16) {
      kind = "doc";
    } else if (totalServed >= 3 && Math.random() < 0.13) {
      kind = "vip";
    }
    spawnsSinceDoc = kind === "doc" ? 0 : spawnsSinceDoc + 1;

    var slot = pick(free);
    slots[slot] = {
      kind: kind,
      want: Math.floor(Math.random() * DESTS.length),
      pat: patienceFor(kind),
      patMax: patienceFor(kind),
      room: 10 + Math.floor(rand(2, 41)),
      seed: Math.floor(Math.random() * 1000),
      connected: false,
      ringAcc: rand(0, 0.5),
      born: clockMs,
    };
    if (kind === "doc") sfx.urgent();
    return true;
  }

  /* ── actions ─────────────────────────────────────────────────────── */

  function freeCordIndex() {
    for (var i = 0; i < NUM_CORDS; i++) if (cords[i].state === "free") return i;
    return -1;
  }

  function cordHoldingSlot(slot) {
    for (var i = 0; i < NUM_CORDS; i++) {
      if (cords[i].slot === slot && cords[i].state !== "free") return i;
    }
    return -1;
  }

  function layDown() {
    if (sel < 0) return;
    var c = cords[sel];
    if (c.state === "held") {
      c.state = "free";
      c.slot = -1;
    }
    sel = -1;
  }

  function clickCaller(i) {
    var guest = slots[i];
    if (!guest || guest.connected) return;

    var holding = cordHoldingSlot(i);
    if (holding >= 0) {
      // clicking the guest we already hold — put the cord down
      layDown();
      sfx.pickup();
      return;
    }

    var prev = sel;
    layDown();

    var ci = freeCordIndex();
    if (ci < 0) {
      flash(
        "NO FREE CORD",
        callerRect[i].x + callerRect[i].w / 2,
        callerRect[i].y,
        "#c0392b",
      );
      sfx.deny();
      shake = Math.max(shake, 5);
      return;
    }
    var c = cords[ci];
    c.state = "held";
    c.slot = i;
    sel = ci;
    sfx.pickup();
    if (prev !== ci)
      sparkAt(
        callerRect[i].x + callerRect[i].w - 14,
        callerRect[i].y + 14,
        "#f4e3bb",
        4,
      );
  }

  function clickDest(j) {
    if (sel < 0) return;
    if (destBusy[j] >= 0) {
      flash(
        "LINE BUSY",
        destRect[j].x + destRect[j].w / 2,
        destRect[j].y,
        "#c0392b",
      );
      sfx.deny();
      shake = Math.max(shake, 4);
      return;
    }
    var c = cords[sel];
    var guest = slots[c.slot];
    c.dest = j;
    c.state = "full";
    c.remain = rand(5200, 9200) / PACE;
    c.frac = guest.pat / guest.patMax;
    guest.connected = true;
    destBusy[j] = sel;
    destRemain[j] = c.remain;
    sel = -1;
    sfx.plug();
    sparkAt(
      destRect[j].x + 30,
      destRect[j].y + destRect[j].h / 2,
      "#e6c877",
      6,
    );
  }

  function completeCall(ci) {
    var c = cords[ci];
    var guest = slots[c.slot];
    var dr = destRect[c.dest];

    var base = 12;
    var mult = 1;
    var tag = "";
    if (guest.kind === "vip") {
      mult = 2.2;
      base = 14;
      tag = "VIP ";
    } else if (guest.kind === "doc") {
      mult = 2.6;
      base = 12;
      tag = "URGENT ";
    }
    var speedBonus = Math.round(9 * c.frac);
    streak++;
    var pts = Math.round((base + speedBonus) * mult * Math.min(streak, 5));
    score += pts;
    served++;
    totalServed++;
    connectFracs.push(c.frac);

    flash(tag + "+" + pts, dr.x + dr.w / 2, dr.y - 6, "#e6c877");
    sparkAt(dr.x + dr.w / 2, dr.y + dr.h / 2, "#ffd76b", 10);
    sfx.ding();
    sfx.coin();

    destBusy[c.dest] = -1;
    destRemain[c.dest] = 0;
    c.state = "free";
    c.slot = -1;
    c.dest = -1;
    slots[c.slot] = null;

    hudSync();
    if (served >= QUOTA) endShift("won");
  }

  function abandonCall(i) {
    var guest = slots[i];
    var cr = callerRect[i];

    // if a cord was hovering on this guest's jack, drop it
    for (var k = 0; k < NUM_CORDS; k++) {
      if (cords[k].slot === i && cords[k].state === "held") {
        cords[k].state = "free";
        cords[k].slot = -1;
        if (sel === k) sel = -1;
      }
    }

    lostCount++;
    streak = 0;
    flash("RINGS OUT!", cr.x + cr.w / 2, cr.y - 6, "#c0392b");
    sparkAt(cr.x + cr.w / 2, cr.y + cr.h / 2, "#c0392b", 8);
    sfx.abandon();
    shake = Math.max(shake, 8);
    slots[i] = null;

    hudSync();
    if (lostCount >= MAX_LOST) endShift("lost");
  }

  /* ── shift flow ──────────────────────────────────────────────────── */

  function startShift() {
    resetBoard();
    mode = "playing";
    overlay.classList.add("hidden");
    hudSync();
    syncButtons();
  }

  function endShift(how) {
    mode = how;
    layDown();
    if (how === "won") sfx.win();
    else sfx.lose();
    showEndOverlay(how);
    syncButtons();
  }

  function pauseGame() {
    if (mode !== "playing") return;
    mode = "paused";
    showOverlay(
      "Paused",
      "<p>The hotel holds its breath. The rings wait. They do not like waiting.</p>",
      "Back to the board",
      resumeGame,
    );
    syncButtons();
  }

  function resumeGame() {
    if (mode !== "paused") return;
    mode = "playing";
    overlay.classList.add("hidden");
    syncButtons();
  }

  /* ── overlays & hud ──────────────────────────────────────────────── */

  function clearBody() {
    while (ovBody.firstChild) ovBody.removeChild(ovBody.firstChild);
  }

  function bodyHTML(html) {
    clearBody();
    ovBody.innerHTML = html;
  }

  function showOverlay(title, html, btnLabel, fn) {
    ovTitle.textContent = title;
    bodyHTML(html);
    ovBtn.textContent = btnLabel;
    ovBtn.onclick = function () {
      audio();
      fn();
    };
    overlay.classList.remove("hidden");
  }

  function showTitle() {
    showOverlay(
      "The Exchange",
      "<p>You are the night operator at the Grand Pier Hotel. Guests ring down the left; " +
        "plug a cord into the line they ask for before their ring dies. Five cords, six lines, " +
        "one busy season.</p>" +
        '<p class="keys">Tap a ringing guest, then a line on the right.<br>' +
        "Keys: <b>1–8</b> pick a guest · arrows + <b>Enter</b> move &amp; plug · " +
        "<b>Esc</b> put the cord down · <b>P</b> pause · <b>M</b> sound · <b>R</b> new shift</p>",
      "Clock on",
      startShift,
    );
  }

  function starsFor() {
    if (!connectFracs.length) return 1;
    var sum = 0;
    for (var i = 0; i < connectFracs.length; i++) sum += connectFracs[i];
    var avg = sum / connectFracs.length;
    if (lostCount === 0 && avg >= 0.45) return 3;
    if (lostCount <= 1) return 2;
    return 1;
  }

  function showEndOverlay(how) {
    if (how === "won") {
      var n = starsFor();
      var stars = "";
      for (var i = 0; i < 3; i++) stars += i < n ? "★" : "☆";
      showOverlay(
        "Dawn report",
        "<div class='stars'>" +
          stars +
          "</div>" +
          "<p>Quota filled — <b>" +
          served +
          "</b> calls put through, <b>" +
          lostCount +
          "</b> ring" +
          (lostCount === 1 ? "" : "s") +
          " lost, <b>£" +
          score +
          "</b> in tips. The lobby yawns; the sea goes quiet.</p>" +
          "<p>The day clerk is climbing the stairs. One more round?</p>",
        "Keep going",
        function () {
          QUOTA += 15;
          mode = "playing";
          overlay.classList.add("hidden");
          hudSync();
          syncButtons();
        },
      );
    } else {
      showOverlay(
        "The manager is here",
        "<p>Three rings died unanswered. He does not shout — worse, he <i>schedules a meeting</i>. " +
          "You put through <b>" +
          served +
          "</b> calls and earned <b>£" +
          score +
          "</b> before the stairs creaked.</p>",
        "Clock on again",
        startShift,
      );
    }
  }

  function hudSync() {
    elScore.textContent = String(score);
    elServed.textContent = served + "/" + QUOTA;
    elStreak.textContent = "×" + Math.min(streak, 5);
    if (streak >= 2) elStreakChip.classList.remove("hidden");
    else elStreakChip.classList.add("hidden");

    var dots = elLost.getElementsByTagName("i");
    for (var i = 0; i < dots.length; i++) {
      dots[i].className = i < MAX_LOST - lostCount ? "dot on" : "dot off";
    }

    if (elCords.childNodes.length !== NUM_CORDS) {
      elCords.textContent = "";
      elCords.appendChild(document.createTextNode("CORDS "));
      for (var k = 0; k < NUM_CORDS; k++) {
        var s = document.createElement("i");
        s.className = "corddot";
        s.style.background = CORD_COLORS[k];
        elCords.appendChild(s);
      }
    }
    var cds = elCords.getElementsByClassName("corddot");
    for (var m = 0; m < cds.length; m++) {
      cds[m].className =
        cords[m] && cords[m].state !== "free" ? "corddot used" : "corddot";
      cds[m].style.background = CORD_COLORS[m];
    }
  }

  function syncButtons() {
    pauseBtn.disabled = mode !== "playing" && mode !== "paused";
    pauseBtn.textContent = mode === "paused" ? "Resume" : "Pause";
  }

  /* ── input ───────────────────────────────────────────────────────── */

  function toLogical(ev) {
    var r = cvs.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * LW,
      y: ((ev.clientY - r.top) / r.height) * LH,
    };
  }

  function hitCell(p) {
    for (var i = 0; i < NUM_SLOTS; i++) {
      var cr = callerRect[i];
      if (
        p.x >= cr.x &&
        p.x <= cr.x + cr.w &&
        p.y >= cr.y &&
        p.y <= cr.y + cr.h
      ) {
        return { col: 0, row: i };
      }
    }
    for (var j = 0; j < DESTS.length; j++) {
      var dr = destRect[j];
      if (
        p.x >= dr.x &&
        p.x <= dr.x + dr.w &&
        p.y >= dr.y &&
        p.y <= dr.y + dr.h
      ) {
        return { col: 1, row: j };
      }
    }
    return null;
  }

  function activateCell(cell) {
    if (!cell) {
      layDown();
      return;
    }
    if (cell.col === 0) {
      if (cell.row < NUM_SLOTS) clickCaller(cell.row);
    } else if (cell.row < DESTS.length) {
      clickDest(cell.row);
    }
  }

  cvs.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    audio();
    if (mode !== "playing") return;
    var p = toLogical(ev);
    pointerLogical = p;
    lastInput = "ptr";
    var cell = hitCell(p);
    hoverCell = cell;
    activateCell(cell);
  });

  cvs.addEventListener("pointermove", function (ev) {
    var p = toLogical(ev);
    pointerLogical = p;
    hoverCell = hitCell(p);
  });

  cvs.addEventListener("contextmenu", function (ev) {
    ev.preventDefault();
    layDown();
  });

  window.addEventListener("keydown", function (ev) {
    var k = ev.key;
    if (k === "m" || k === "M") {
      audio();
      setMuted(!muted);
      return;
    }
    if (k === "r" || k === "R") {
      ev.preventDefault();
      audio();
      startShift();
      return;
    }
    if (k === "p" || k === "P") {
      if (mode === "playing") pauseGame();
      else if (mode === "paused") resumeGame();
      return;
    }
    if (mode === "title" || mode === "won" || mode === "lost") {
      if (k === "Enter" || k === " ") {
        ev.preventDefault();
        audio();
        ovBtn.click();
      }
      return;
    }
    if (mode !== "playing") return;

    var nav = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    if (nav[k]) {
      ev.preventDefault();
      lastInput = "key";
      var dc = nav[k][0];
      var dr2 = nav[k][1];
      if (dc !== 0) {
        var nc = clamp(cur.col + dc, 0, 1);
        if (nc !== cur.col) {
          cur.col = nc;
          cur.row = Math.min(
            cur.row,
            nc === 0 ? NUM_SLOTS - 1 : DESTS.length - 1,
          );
        }
      }
      if (dr2 !== 0) {
        var maxRow = cur.col === 0 ? NUM_SLOTS - 1 : DESTS.length - 1;
        cur.row = (cur.row + dr2 + maxRow + 1) % (maxRow + 1);
      }
      return;
    }
    if (k === "Enter" || k === " ") {
      ev.preventDefault();
      audio();
      lastInput = "key";
      activateCell({ col: cur.col, row: cur.row });
      return;
    }
    if (k === "Escape") {
      layDown();
      sfx.pickup();
      return;
    }
    if (k >= "1" && k <= "8") {
      var idx = parseInt(k, 10) - 1;
      if (idx < NUM_SLOTS) {
        lastInput = "key";
        cur.col = 0;
        cur.row = idx;
        audio();
        activateCell({ col: 0, row: idx });
      }
    }
  });

  pauseBtn.addEventListener("click", function () {
    audio();
    if (mode === "playing") pauseGame();
    else if (mode === "paused") resumeGame();
  });

  soundBtn.addEventListener("click", function () {
    audio();
    setMuted(!muted);
  });

  newBtn.addEventListener("click", function () {
    audio();
    startShift();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && mode === "playing") pauseGame();
  });

  window.addEventListener("blur", function () {
    if (mode === "playing") pauseGame();
  });

  /* ── update ──────────────────────────────────────────────────────── */

  function update(dtMs) {
    var dt = dtMs / 1000;
    clockMs += dtMs;

    spawnT -= dtMs;
    if (spawnT <= 0) {
      if (spawnCall()) spawnT = spawnInterval();
      else spawnT = 700;
    }

    for (var i = 0; i < NUM_SLOTS; i++) {
      var g = slots[i];
      if (!g || g.connected) continue;
      g.pat -= dtMs;
      g.ringAcc += dt;
      var period = g.kind === "doc" ? 0.62 : 1.15;
      if (g.ringAcc >= period) {
        g.ringAcc = 0;
        if (g.kind === "doc") sfx.urgent();
        else sfx.ring();
      }
      if (g.pat <= 0) abandonCall(i);
    }

    for (var c = 0; c < NUM_CORDS; c++) {
      var cd = cords[c];
      if (cd.state !== "full") continue;
      cd.remain -= dtMs;
      destRemain[cd.dest] = cd.remain;
      if (cd.remain <= 0) completeCall(c);
    }

    var targetDawn = clamp(totalServed / QUOTA, 0, 1);
    dawnT += (targetDawn - dawnT) * Math.min(1, dt * 0.8);

    if (shake > 0) shake = Math.max(0, shake - dt * 22);

    for (var f = floats.length - 1; f >= 0; f--) {
      floats[f].t += dt;
      if (floats[f].t > 1.1) floats.splice(f, 1);
    }
    for (var s = sparks.length - 1; s >= 0; s--) {
      var p = sparks[s];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 60 * dt;
      p.t += dt;
      if (p.t > p.life) sparks.splice(s, 1);
    }
  }

  function flash(txt, x, y, color) {
    floats.push({ txt: txt, x: x, y: y, color: color, t: 0 });
  }

  function sparkAt(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      sparks.push({
        x: x,
        y: y,
        vx: rand(-70, 70),
        vy: rand(-130, -20),
        t: 0,
        life: rand(0.4, 0.8),
        color: color,
        r: rand(1.5, 3.2),
      });
    }
  }

  /* ── static backdrop ─────────────────────────────────────────────── */

  var bg = document.createElement("canvas");

  function paintBackdrop() {
    var px = Math.max(
      1,
      Math.floor(cvs.clientWidth * (window.devicePixelRatio || 1)),
    );
    var py = Math.max(1, Math.floor((px * LH) / LW));
    bg.width = px;
    bg.height = py;
    var b = bg.getContext("2d");
    b.scale(px / LW, py / LH);

    // wooden desk
    b.fillStyle = "#2b1d12";
    b.fillRect(0, 0, LW, LH);
    for (var x = 0; x < LW; x += 66) {
      b.fillStyle =
        "rgba(255,225,170," + (0.018 + ((x / 66) % 3) * 0.008) + ")";
      b.fillRect(x, 0, 33, LH);
      b.fillStyle = "rgba(0,0,0,0.22)";
      b.fillRect(x + 63, 0, 3, LH);
    }

    // top engraved plate
    var grad = b.createLinearGradient(0, 26, 0, 96);
    grad.addColorStop(0, "#4a3620");
    grad.addColorStop(1, "#332414");
    b.fillStyle = grad;
    rr(b, 190, 26, 420, 70, 12);
    b.fill();
    b.strokeStyle = "#8a6d3f";
    b.lineWidth = 2;
    rr(b, 190, 26, 420, 70, 12);
    b.stroke();
    b.fillStyle = "#d9bd85";
    b.font = "17px Georgia, serif";
    b.textAlign = "center";
    b.fillText("G R A N D   P I E R   H O T E L", 400, 58);
    b.font = "12px Georgia, serif";
    b.fillStyle = "#a98d5c";
    b.fillText("N I G H T   E X C H A N G E   ·   No. 3", 400, 82);

    // column headers
    b.font = "bold 15px Georgia, serif";
    b.fillStyle = "#c7b28d";
    b.textAlign = "left";
    b.fillText("GUEST LINES — ANSWER", 52, 148);
    b.textAlign = "right";
    b.fillText("EXCHANGE LINES", 748, 172);

    // central rail
    var rg = b.createLinearGradient(392, 0, 414, 0);
    rg.addColorStop(0, "#6b5326");
    rg.addColorStop(0.5, "#a9853f");
    rg.addColorStop(1, "#54401e");
    b.fillStyle = rg;
    b.fillRect(392, 118, 22, 880);
    for (var ry = 150; ry < 1000; ry += 74) {
      b.beginPath();
      b.arc(403, ry, 4.4, 0, Math.PI * 2);
      b.fillStyle = "#3a2a19";
      b.fill();
      b.strokeStyle = "#c9a95f88";
      b.lineWidth = 1;
      b.stroke();
    }

    // cord well at the bottom
    b.fillStyle = "#20150c";
    rr(b, 34, 996, 732, 52, 14);
    b.fill();
    b.strokeStyle = "#57401f";
    b.lineWidth = 2;
    rr(b, 34, 996, 732, 52, 14);
    b.stroke();
    b.fillStyle = "#8a6d3f";
    b.font = "11px Georgia, serif";
    b.textAlign = "center";
    b.fillText("P A T C H   C O R D S", 400, 1013);

    // vignette
    var vg = b.createRadialGradient(
      LW / 2,
      LH / 2,
      LH * 0.35,
      LW / 2,
      LH / 2,
      LH * 0.75,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.45)");
    b.fillStyle = vg;
    b.fillRect(0, 0, LW, LH);
  }

  /* ── drawing ─────────────────────────────────────────────────────── */

  var INK = "#241a10";

  function drawIcon(c, key, x, y, s, color) {
    c.save();
    c.translate(x, y);
    c.scale(s / 30, s / 30);
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 2.6;
    c.lineCap = "round";
    c.lineJoin = "round";
    if (key === "DINING") {
      c.beginPath();
      c.moveTo(-9, -12);
      c.lineTo(-9, 12);
      c.moveTo(-13, -12);
      c.lineTo(-13, -4);
      c.moveTo(-5, -12);
      c.lineTo(-5, -4);
      c.moveTo(-13, -4);
      c.quadraticCurveTo(-9, 2, -5, -4);
      c.stroke();
      c.beginPath();
      c.moveTo(9, -12);
      c.quadraticCurveTo(14, -2, 8, 4);
      c.lineTo(8, 12);
      c.stroke();
    } else if (key === "BAR") {
      c.beginPath();
      c.moveTo(-11, -10);
      c.lineTo(11, -10);
      c.lineTo(0, 2);
      c.closePath();
      c.stroke();
      c.beginPath();
      c.moveTo(0, 2);
      c.lineTo(0, 12);
      c.moveTo(-6, 12);
      c.lineTo(6, 12);
      c.stroke();
      c.beginPath();
      c.arc(5, -13, 2.6, 0, Math.PI * 2);
      c.fill();
    } else if (key === "ROOMS") {
      c.beginPath();
      c.moveTo(-12, -8);
      c.lineTo(-12, 10);
      c.moveTo(-12, 4);
      c.lineTo(12, 4);
      c.lineTo(12, 10);
      c.moveTo(12, 10);
      c.lineTo(12, -2);
      c.quadraticCurveTo(12, -6, 6, -6);
      c.lineTo(-4, -6);
      c.lineTo(-4, 4);
      c.stroke();
      c.fillRect(-9, -3, 7, 4);
    } else if (key === "DESK") {
      c.beginPath();
      c.arc(0, 2, 10, Math.PI, 0);
      c.closePath();
      c.fill();
      c.fillRect(-14, 4, 28, 4);
      c.beginPath();
      c.arc(0, -12, 2, 0, Math.PI * 2);
      c.fill();
    } else if (key === "DOCTOR") {
      c.fillRect(-4, -12, 8, 24);
      c.fillRect(-12, -4, 24, 8);
    } else {
      // MGR — top hat
      c.fillRect(-11, 4, 22, 4);
      c.fillRect(-7, -12, 14, 17);
      c.fillStyle = "rgba(255,255,255,0.35)";
      c.fillRect(-7, -1, 14, 4);
    }
    c.restore();
  }

  function drawFace(c, x, y, r, seed, mood, t) {
    var skin = SKINS[seed % SKINS.length];
    var hat = seed % 5;
    c.save();
    c.translate(x, y);
    // head
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fillStyle = skin;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = INK;
    c.stroke();
    // eyes
    c.fillStyle = INK;
    c.beginPath();
    c.arc(-r * 0.34, -r * 0.15, 1.9, 0, Math.PI * 2);
    c.arc(r * 0.34, -r * 0.15, 1.9, 0, Math.PI * 2);
    c.fill();
    // mouth: smile when patient, flat when worried, frown when desperate
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.beginPath();
    var bend = r * 0.42 * mood; // mood 1 happy .. -1 cross
    c.moveTo(-r * 0.34, r * 0.38);
    c.quadraticCurveTo(0, r * 0.38 + bend, r * 0.34, r * 0.38);
    c.stroke();
    // hats
    c.fillStyle = seed % 2 ? "#5a4632" : "#3d3d52";
    c.strokeStyle = INK;
    if (hat === HAT_BOWLER) {
      c.beginPath();
      c.ellipse(0, -r * 0.72, r * 1.05, r * 0.24, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(0, -r * 0.78, r * 0.62, Math.PI, 0);
      c.fill();
    } else if (hat === HAT_CLOCHE) {
      c.beginPath();
      c.arc(0, -r * 0.42, r * 0.92, Math.PI * 1.05, Math.PI * 1.95);
      c.lineTo(r * 0.92, -r * 0.42);
      c.closePath();
      c.fill();
    } else if (hat === HAT_FLAT) {
      c.beginPath();
      c.ellipse(r * 0.15, -r * 0.68, r * 1.0, r * 0.26, -0.08, 0, Math.PI * 2);
      c.fill();
      c.fillRect(-r * 0.55, -r * 1.0, r * 1.1, r * 0.36);
    } else if (hat === HAT_NIGHT) {
      c.beginPath();
      c.moveTo(-r * 0.8, -r * 0.55);
      c.quadraticCurveTo(
        0,
        -r * 1.7 + Math.sin(t * 3 + seed) * 3,
        r * 0.8,
        -r * 0.55,
      );
      c.closePath();
      c.fill();
      c.beginPath();
      c.arc(0, -r * 1.42 + Math.sin(t * 3 + seed) * 3, r * 0.2, 0, Math.PI * 2);
      c.fillStyle = "#c9a227";
      c.fill();
    }
    c.restore();
  }

  function drawCallerCard(c, i, t) {
    var rc = callerRect[i];
    var g = slots[i];
    c.save();
    if (!g) {
      // empty jack plate
      rr(c, rc.x + 14, rc.y + 14, rc.w - 28, rc.h - 28, 10);
      c.fillStyle = "#241a10";
      c.fill();
      c.strokeStyle = "#57401f";
      c.lineWidth = 2;
      c.stroke();
      c.beginPath();
      c.arc(rc.x + rc.w / 2, rc.y + rc.h / 2, 7, 0, Math.PI * 2);
      c.fillStyle = "#100a06";
      c.fill();
      c.restore();
      return;
    }

    var frac = clamp(g.pat / g.patMax, 0, 1);
    var mood = frac > 0.66 ? 1 : frac > 0.33 ? 0 : -1;
    var urgent = frac <= 0.33;

    // card
    rr(c, rc.x, rc.y, rc.w, rc.h, 12);
    c.fillStyle = "#efe2c6";
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = INK;
    c.stroke();

    // kind rims
    if (g.kind === "vip") {
      rr(c, rc.x - 2.5, rc.y - 2.5, rc.w + 5, rc.h + 5, 13);
      c.strokeStyle = "#e0b64f";
      c.lineWidth = 3.4;
      c.stroke();
      c.fillStyle = "#e0b64f";
      c.font = "bold 10px Georgia, serif";
      c.textAlign = "right";
      c.fillText("✦ VIP", rc.x + rc.w - 8, rc.y + 13);
    } else if (g.kind === "doc") {
      var pulse = 0.5 + 0.5 * Math.sin(t * 9);
      rr(
        c,
        rc.x - 2.5 - pulse * 1.6,
        rc.y - 2.5 - pulse * 1.6,
        rc.w + 5 + pulse * 3.2,
        rc.h + 5 + pulse * 3.2,
        13,
      );
      c.strokeStyle = "rgba(192,57,43," + 0.55 + pulse * 0.45 + ")";
      c.lineWidth = 3 + pulse * 2;
      c.stroke();
      c.fillStyle = "#c0392b";
      c.font = "bold 10px Georgia, serif";
      c.textAlign = "right";
      c.fillText("URGENT", rc.x + rc.w - 8, rc.y + 13);
    }

    // face
    drawFace(c, rc.x + 46, rc.y + rc.h / 2 - 4, 21, g.seed, mood, t);
    c.fillStyle = "#55432b";
    c.font = "bold 11px Georgia, serif";
    c.textAlign = "center";
    c.fillText("RM " + g.room, rc.x + 46, rc.y + rc.h - 9);

    // speech bubble with wanted line
    var bx = rc.x + 128;
    var by = rc.y + 12;
    var bw = rc.w - 142;
    var bh = rc.h - 34;
    rr(c, bx, by, bw, bh, 9);
    c.fillStyle = g.connected ? "#dceed2" : "#fdf6e3";

    c.fill();
    c.strokeStyle = "#8a6d3f";
    c.lineWidth = 1.6;
    c.stroke();
    c.beginPath();
    c.moveTo(bx, by + bh / 2 - 5);
    c.lineTo(bx - 9, by + bh / 2);
    c.lineTo(bx, by + bh / 2 + 5);
    c.closePath();
    c.fillStyle = g.connected ? "#dceed2" : "#fdf6e3";
    c.fill();

    var d = DESTS[g.want];
    if (g.connected) {
      // chatting dots
      c.fillStyle = "#4c7a3f";
      for (var k = 0; k < 3; k++) {
        var ph = Math.sin(t * 6 - k * 0.9) * 2.4;
        c.beginPath();
        c.arc(
          bx + bw / 2 + (k - 1) * 13,
          by + bh / 2 + ph,
          3.4,
          0,
          Math.PI * 2,
        );
        c.fill();
      }
    } else {
      drawIcon(c, d.key, bx + 26, by + bh / 2, 30, "#5c3a17");
      c.fillStyle = "#5c3a17";
      c.font = "bold 12px Georgia, serif";
      c.textAlign = "left";
      c.fillText(d.label, bx + 48, by + bh / 2 + 4);
    }

    // patience bar
    var pw = (rc.w - 16) * frac;
    var hue = 8 + 108 * frac;
    rr(c, rc.x + 8, rc.y + rc.h - 8, pw, 4.6, 2.3);
    c.fillStyle = "hsl(" + hue + ",70%," + (urgent ? 48 : 42) + "%)";
    c.fill();

    // ringing halo
    if (!g.connected && Math.sin(t * 8) > 0.4 && !urgent) {
      c.strokeStyle = "rgba(198,158,80,0.5)";
      c.lineWidth = 2;
      rr(c, rc.x - 5, rc.y - 5, rc.w + 10, rc.h + 10, 14);
      c.stroke();
    }
    c.restore();
  }

  function drawDestCard(c, j, t) {
    var rc = destRect[j];
    var d = DESTS[j];
    var busy = destBusy[j] >= 0;

    c.save();
    rr(c, rc.x, rc.y, rc.w, rc.h, 12);
    var gr = c.createLinearGradient(rc.x, rc.y, rc.x, rc.y + rc.h);
    if (busy) {
      gr.addColorStop(0, "#f4dfae");
      gr.addColorStop(1, "#e2c489");
    } else {
      gr.addColorStop(0, "#d9c493");
      gr.addColorStop(1, "#c3ab77");
    }
    c.fillStyle = gr;
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = "#4a3620";
    c.stroke();

    // brass socket
    c.beginPath();
    c.arc(rc.x + 44, rc.y + rc.h / 2, 21, 0, Math.PI * 2);
    var sg = c.createRadialGradient(
      rc.x + 40,
      rc.y + rc.h / 2 - 6,
      3,
      rc.x + 44,
      rc.y + rc.h / 2,
      22,
    );
    sg.addColorStop(0, busy ? "#ffcf6e" : "#171008");
    sg.addColorStop(1, "#0d0906");
    c.fillStyle = sg;
    c.fill();
    c.strokeStyle = "#8a6d3f";
    c.lineWidth = 2.4;
    c.stroke();

    if (busy) {
      // lamp glow + remaining-time arc
      c.beginPath();
      c.arc(
        rc.x + 44,
        rc.y + rc.h / 2,
        27,
        -Math.PI / 2,
        -Math.PI / 2 +
          Math.PI *
            2 *
            (destRemain[j] > 0 ? clamp(destRemain[j] / 9000, 0, 1) : 0),
      );
      c.strokeStyle = "rgba(255,214,107,0.85)";
      c.lineWidth = 3;
      c.stroke();
      c.beginPath();
      c.arc(
        rc.x + 44,
        rc.y + rc.h / 2,
        31 + Math.sin(t * 5) * 1.5,
        0,
        Math.PI * 2,
      );
      c.strokeStyle = "rgba(255,207,110,0.28)";
      c.lineWidth = 2;
      c.stroke();
    }

    drawIcon(c, d.key, rc.x + 108, rc.y + rc.h / 2, 34, "#4a3010");
    c.fillStyle = "#3d2a12";
    c.font = "bold 16px Georgia, serif";
    c.textAlign = "left";
    c.fillText(d.label, rc.x + 136, rc.y + rc.h / 2 + 6);

    if (busy) {
      c.fillStyle = "#7a5a1e";
      c.font = "italic 11px Georgia, serif";
      c.fillText("in conversation…", rc.x + 136, rc.y + rc.h / 2 + 24);
    }
    c.restore();
  }

  function cordPath(c, x1, y1, x2, y2, sag) {
    c.beginPath();
    c.moveTo(x1, y1);
    c.bezierCurveTo(
      x1 + (x2 - x1) * 0.3,
      y1 + sag,
      x1 + (x2 - x1) * 0.7,
      y2 + sag,
      x2,
      y2,
    );
  }

  function drawCordLine(c, ci, x1, y1, x2, y2) {
    var col = CORD_COLORS[ci];
    c.lineCap = "round";
    cordPath(c, x1, y1, x2, y2, 60 + ci * 7);
    c.strokeStyle = "rgba(0,0,0,0.55)";
    c.lineWidth = 10;
    c.stroke();
    cordPath(c, x1, y1, x2, y2, 60 + ci * 7);
    c.strokeStyle = col;
    c.lineWidth = 6.4;
    c.stroke();
    cordPath(c, x1, y1, x2, y2, 60 + ci * 7);
    c.strokeStyle = "rgba(255,255,255,0.28)";
    c.lineWidth = 1.6;
    c.stroke();

    // plugs
    c.fillStyle = "#241a10";
    c.beginPath();
    c.rect(x1 - 7, y1 - 7, 14, 14);
    c.rect(x2 - 7, y2 - 7, 14, 14);
    c.fill();
    c.strokeStyle = CORD_COLORS[ci];
    c.lineWidth = 2.4;
    c.strokeRect(x1 - 7, y1 - 7, 14, 14);
    c.strokeRect(x2 - 7, y2 - 7, 14, 14);
  }

  function drawCords(c, t) {
    // connected cords
    for (var i = 0; i < NUM_CORDS; i++) {
      var cd = cords[i];
      if (cd.state !== "full") continue;
      var cr = callerRect[cd.slot];
      var dr = destRect[cd.dest];
      drawCordLine(
        c,
        i,
        cr.x + cr.w - 6,
        cr.y + cr.h / 2,
        dr.x + 6,
        dr.y + dr.h / 2,
      );
      if (cd.remain < 1500 && Math.sin(t * 12) > 0) {
        c.fillStyle = "#fff3d0";
        c.font = "italic 11px Georgia, serif";
        c.textAlign = "center";
        c.fillText(
          "finishing…",
          (cr.x + cr.w + dr.x) / 2,
          (cr.y + dr.y) / 2 + 90,
        );
      }
    }
    // held cord follows the pointer / cursor
    if (sel >= 0) {
      var hc = cords[sel];
      var hcr = callerRect[hc.slot];
      var tx = pointerLogical.x;
      var ty = pointerLogical.y;
      if (lastInput === "key") {
        if (cur.col === 1 && cur.row < DESTS.length) {
          tx = destRect[cur.row].x + 6;
          ty = destRect[cur.row].y + destRect[cur.row].h / 2;
        } else {
          tx = hcr.x + hcr.w / 2;
          ty = hcr.y - 26;
        }
      }
      drawCordLine(c, sel, hcr.x + hcr.w - 6, hcr.y + hcr.h / 2, tx, ty);
      c.fillStyle = "#fff3d0";
      c.font = "italic 12px Georgia, serif";
      c.textAlign = "center";
      c.fillText(
        "choose a line…",
        (hcr.x + hcr.w + tx) / 2,
        (hcr.y + hcr.h / 2 + ty) / 2 + 74,
      );
    }
    // parked coils
    for (var k = 0; k < NUM_CORDS; k++) {
      if (cords[k].state !== "free") continue;
      var x = 116 + k * 142;
      var y = 1022;
      c.strokeStyle = CORD_COLORS[k];
      c.globalAlpha = 0.9;
      c.lineWidth = 6;
      c.lineCap = "round";
      c.beginPath();
      c.ellipse(x, y, 34, 11, 0, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.ellipse(x, y - 5, 26, 8, 0, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
      c.fillStyle = "#241a10";
      c.fillRect(x + 30, y - 5, 12, 10);
      c.strokeStyle = CORD_COLORS[k];
      c.lineWidth = 2;
      c.strokeRect(x + 30, y - 5, 12, 10);
    }
  }

  function drawCursor(c) {
    var cell = lastInput === "ptr" ? hoverCell : cur;
    if (!cell) return;
    var rc =
      cell.col === 0
        ? cell.row < NUM_SLOTS
          ? callerRect[cell.row]
          : null
        : cell.row < DESTS.length
          ? destRect[cell.row]
          : null;
    if (!rc) return;
    c.save();
    c.strokeStyle = "rgba(255,236,180,0.9)";
    c.lineWidth = 2.4;
    c.setLineDash([7, 5]);
    c.lineDashOffset = -performance.now() / 60;
    rr(c, rc.x - 6, rc.y - 6, rc.w + 12, rc.h + 12, 14);
    c.stroke();
    c.restore();
  }

  function drawFx(c) {
    for (var i = 0; i < sparks.length; i++) {
      var p = sparks[i];
      c.globalAlpha = 1 - p.t / p.life;
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    for (var f = 0; f < floats.length; f++) {
      var ft = floats[f];
      var a = ft.t < 0.75 ? 1 : 1 - (ft.t - 0.75) / 0.35;
      c.globalAlpha = clamp(a, 0, 1);
      c.fillStyle = ft.color;
      c.font = "bold 19px Georgia, serif";
      c.textAlign = "center";
      c.strokeStyle = "rgba(0,0,0,0.65)";
      c.lineWidth = 4;
      c.strokeText(ft.txt, ft.x, ft.y - ft.t * 34);
      c.fillText(ft.txt, ft.x, ft.y - ft.t * 34);
    }
    c.globalAlpha = 1;
  }

  function render(now) {
    var t = now / 1000;
    var dpr = window.devicePixelRatio || 1;
    var cw = cvs.clientWidth || LW;
    var k = (cw * dpr) / LW;
    if (cvs.width !== Math.floor(cw * dpr)) {
      cvs.width = Math.floor(cw * dpr);
      cvs.height = Math.floor((cw * dpr * LH) / LW);
      paintBackdrop();
    }
    ctx.setTransform(k, 0, 0, k, 0, 0);

    ctx.drawImage(bg, 0, 0, LW, LH);

    // dawn tint grows as the quota fills
    if (dawnT > 0.01) {
      var dg = ctx.createLinearGradient(0, 0, 0, LH * 0.6);
      dg.addColorStop(0, "rgba(255,166,90," + 0.16 * dawnT + ")");
      dg.addColorStop(1, "rgba(255,166,90,0)");
      ctx.fillStyle = dg;
      ctx.fillRect(0, 0, LW, LH * 0.6);
    }

    if (shake > 0.2) {
      ctx.translate(rand(-shake, shake) * 0.6, rand(-shake, shake) * 0.6);
    }

    var reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {}
    var tt = reduced ? 0 : t;

    for (var i = 0; i < NUM_SLOTS; i++) drawCallerCard(ctx, i, tt);
    for (var j = 0; j < DESTS.length; j++) drawDestCard(ctx, j, tt);
    drawCords(ctx, tt);
    drawFx(ctx);
    if (mode === "playing") drawCursor(ctx);
  }

  /* ── main loop ───────────────────────────────────────────────────── */

  var last = performance.now();

  function loop(now) {
    var dt = Math.min(50, now - last);
    last = now;
    if (mode === "playing") update(dt);
    render(now);
    window.requestAnimationFrame(loop);
  }

  /* ── boot ────────────────────────────────────────────────────────── */

  setMuted(muted);
  resetBoard();
  hudSync();
  syncButtons();
  showTitle();
  window.requestAnimationFrame(loop);
})();
