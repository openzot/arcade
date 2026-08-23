/* Exact Change - Harbour Sweets, Saturday.
   All behaviour lives here. Classic script, wrapped in an IIFE. */
(function () {
  "use strict";

  /* ---------- tiny helpers ---------- */

  var $ = function (id) {
    return document.getElementById(id);
  };

  function fmt(p) {
    return p >= 100 ? "£" + (p / 100).toFixed(2) : p + "p";
  }

  function mulberry(seed) {
    var a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  /* ---------- till data ---------- */

  var DENOMS = [
    { v: 1, label: "1p", cls: "c1" },
    { v: 2, label: "2p", cls: "c2" },
    { v: 5, label: "5p", cls: "c5" },
    { v: 10, label: "10p", cls: "c10" },
    { v: 20, label: "20p", cls: "c20" },
    { v: 50, label: "50p", cls: "c50" },
    { v: 100, label: "£1", cls: "c100" },
    { v: 200, label: "£2", cls: "c200" },
    { v: 500, label: "£5", cls: "c100 big-note" },
    { v: 1000, label: "£10", cls: "c200 big-note" },
  ];

  var ITEMS = [
    "pearl drops",
    "sherbet lenses",
    "a liquorice rope",
    "aniseed wheels",
    "chocolate shells",
    "fizzy stars",
    "toffee knots",
    "barley sugar",
    "humbug sticks",
    "coconut mushrooms",
    "jelly eels",
    "peppermint creams",
    "rum butter fudge",
    "salted caramels",
  ];

  var NAMES = [
    "Nan Pearl",
    "Ollie",
    "Mrs Figg",
    "the sailmaker",
    "Dee",
    "Cousin Bert",
    "Miss Tuppence",
    "old Sal",
    "the ferry boy",
    "Granda Wick",
    "Polly",
    "the postman",
    "Aunt Roo",
    "the harbourmaster",
    "little Enid",
    "Chip",
  ];

  var CHAT = [
    "says the gulls have been ruthless today.",
    "wants it wrapped for her nan.",
    "pays in sea-damp coins.",
    "hums while you count.",
    "is practising for the tombola.",
    "has opinions about the fudge.",
    "waves at someone through the glass.",
    "asks if you take foreign coin. You do not.",
  ];

  var QUIRK_NOTES = {
    kid: "Barely tall enough to see the fudge. Hurry!",
    collector: "Counts every coin. Fewest coins wins their tip.",
    rush: "The doorbell has not stopped. Whole harbour wants sweets!",
  };

  var DAY_LEN = 14;
  var RUSH_FROM = 8;
  var RUSH_TO = 10;

  /* ---------- audio (synthesised, lazy) ---------- */

  var actx = null;
  var master = null;
  var muted = false;

  function ensureAudio() {
    if (!actx) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
        master = actx.createGain();
        master.gain.value = 0.5;
        master.connect(actx.destination);
      } catch (e) {
        actx = null;
      }
    }
    if (actx && actx.state === "suspended") {
      actx.resume();
    }
  }

  function tone(freq, dur, type, vol, delay, slideTo) {
    if (!actx || muted) return;
    var t0 = actx.currentTime + (delay || 0);
    var osc = actx.createOscillator();
    var g = actx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(30, slideTo),
        t0 + dur,
      );
    }
    g.gain.setValueAtTime(vol || 0.18, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function sfxCoin(idx) {
    tone(430 * Math.pow(1.13, idx), 0.07, "square", 0.14);
  }

  function sfxOk() {
    tone(660, 0.09, "triangle", 0.22);
    tone(880, 0.16, "triangle", 0.22, 0.09);
    tone(1560, 0.2, "square", 0.08, 0.06);
  }

  function sfxErr() {
    tone(240, 0.24, "sawtooth", 0.2, 0, 90);
  }

  function sfxThud() {
    tone(110, 0.28, "sine", 0.34, 0, 55);
  }

  function sfxBell() {
    tone(880, 0.7, "triangle", 0.26);
    tone(1320, 0.55, "triangle", 0.12, 0.02);
    tone(440, 0.9, "sine", 0.16, 0.04);
  }

  /* ---------- portraits (inline SVG, code-drawn) ---------- */

  var SKINS = ["#f2c9a4", "#e0aa7e", "#c98d5f", "#f5d7ba"];
  var SHIRTS = [
    "#1f8a80",
    "#e4593c",
    "#5a6bb5",
    "#c9962e",
    "#7a9e56",
    "#a35a8e",
  ];
  var HAIRS = ["#3c2f26", "#6b4a2c", "#9c9c9c", "#20242c", "#a8642c"];
  var BGS = ["#d9ece4", "#fbe3c9", "#e3e7f6", "#f6ded6"];

  function portraitSVG(rng, kind) {
    var skin = pick(rng, SKINS);
    var shirt = pick(rng, SHIRTS);
    var hair = pick(rng, HAIRS);
    var bg = pick(rng, BGS);
    var style = Math.floor(rng() * 4);
    var extra = "";
    if (kind === "kid") {
      style = -1;
      extra =
        '<ellipse cx="50" cy="27" rx="21" ry="7" fill="' +
        hair +
        '"/><rect x="34" y="14" width="32" height="15" rx="6" fill="' +
        hair +
        '"/><circle cx="50" cy="14" r="4" fill="#e4593c"/>';
    } else if (kind === "collector") {
      extra =
        '<circle cx="59" cy="46" r="7" fill="rgba(210,235,240,0.5)" stroke="#35302a" stroke-width="1.6"/><line x1="59" y1="53" x2="66" y2="66" stroke="#35302a" stroke-width="1.4"/>';
    } else {
      var acc = Math.floor(rng() * 4);
      if (acc === 0) {
        extra =
          '<circle cx="42" cy="46" r="6.5" fill="none" stroke="#35302a" stroke-width="1.6"/><circle cx="58" cy="46" r="6.5" fill="none" stroke="#35302a" stroke-width="1.6"/><line x1="48" y1="46" x2="52" y2="46" stroke="#35302a" stroke-width="1.6"/>';
      } else if (acc === 1) {
        extra =
          '<rect x="33" y="16" width="34" height="13" rx="5" fill="' +
          shirt +
          '" stroke="#35302a" stroke-opacity="0.25"/><ellipse cx="50" cy="29" rx="26" ry="4.5" fill="' +
          shirt +
          '" stroke="#35302a" stroke-opacity="0.25"/>';
      } else if (acc === 2) {
        extra =
          '<path d="M68 36 l14 -7 l-3 12 z" fill="#ef7b57"/><path d="M70 40 l15 1 l-9 9 z" fill="#e4593c"/>';
      }
    }
    var hairShape = "";
    if (style === 0) {
      hairShape = '<path d="M27 46 a23 23 0 0 1 46 0 z" fill="' + hair + '"/>';
    } else if (style === 1) {
      hairShape =
        '<path d="M27 46 a23 23 0 0 1 46 0 z" fill="' +
        hair +
        '"/><rect x="24" y="40" width="9" height="26" rx="4.5" fill="' +
        hair +
        '"/><rect x="67" y="40" width="9" height="26" rx="4.5" fill="' +
        hair +
        '"/>';
    } else if (style === 2) {
      hairShape =
        '<path d="M31 54 a19 19 0 0 0 38 0 z" fill="#bdbdbd"/><circle cx="38" cy="32" r="6" fill="' +
        hair +
        '"/><circle cx="50" cy="28" r="7" fill="' +
        hair +
        '"/><circle cx="62" cy="32" r="6" fill="' +
        hair +
        '"/>';
    } else if (style === 3) {
      hairShape =
        '<path d="M26 47 a24 24 0 0 1 48 0 l-5 0 a19 19 0 0 0 -38 0 z" fill="' +
        hair +
        '"/>';
    }
    return (
      '<svg viewBox="0 0 100 100" role="img" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="48" fill="' +
      bg +
      '"/>' +
      '<path d="M12 102 Q50 60 88 102 Z" fill="' +
      shirt +
      '"/>' +
      '<circle cx="50" cy="46" r="23" fill="' +
      skin +
      '"/>' +
      hairShape +
      '<circle cx="42" cy="46" r="2.3" fill="#35302a"/>' +
      '<circle cx="58" cy="46" r="2.3" fill="#35302a"/>' +
      '<path d="M43 57 q7 6 14 0" fill="none" stroke="#35302a" stroke-width="2" stroke-linecap="round"/>' +
      extra +
      "</svg>"
    );
  }

  /* ---------- day / sale generation ---------- */

  var TIERS = { 1: 20, 2: 17, 3: 15 };

  function buildSpec(i, daySeed) {
    var rng = mulberry(daySeed * 131 + i * 17 + 5);
    var tier = i < 5 ? 1 : i < 10 ? 2 : 3;
    var tenders =
      tier === 1 ? [50, 100] : tier === 2 ? [100, 200, 500] : [200, 500, 1000];
    var tender = pick(rng, tenders);
    var lo = tier === 1 ? 5 : tier === 2 ? 12 : 30;
    var hi = tier === 1 ? 40 : tier === 2 ? 180 : 450;
    var change = lo + Math.floor(rng() * (hi - lo));
    var roll = rng();
    if (roll < 0.55) {
      change = Math.max(5, Math.round(change / 5) * 5);
    } else if (roll < 0.8) {
      change = Math.round(change / 10) * 10;
    } else if (roll < 0.92) {
      change = change - (change % 10) + 9;
    }
    if (change > tender - 5) change = tender - 5;
    if (change < 1) change = 1;
    var quirk = null;
    if (i === 3 || i === 12) quirk = "kid";
    if (i === 6 || i === 11) quirk = "collector";
    var rush = i >= RUSH_FROM && i <= RUSH_TO;
    var base = TIERS[tier];
    var mult = (quirk === "kid" ? 0.55 : 1) * (rush ? 0.78 : 1);
    var note;
    if (quirk && QUIRK_NOTES[quirk]) note = QUIRK_NOTES[quirk];
    else if (rush) note = QUIRK_NOTES.rush;
    else note = pick(rng, CHAT);
    return {
      item: ITEMS[i % ITEMS.length],
      tender: tender,
      price: tender - change,
      due: change,
      name: pick(rng, NAMES),
      kind: quirk,
      quirk: quirk,
      rush: rush,
      note: note,
      patience: Math.round(base * mult * 10) / 10,
      art: portraitSVG(rng, quirk),
    };
  }

  function optimalCoins(due) {
    var rest = due;
    var n = 0;
    for (var i = DENOMS.length - 1; i >= 0; i--) {
      n += Math.floor(rest / DENOMS[i].v);
      rest %= DENOMS[i].v;
    }
    return n;
  }

  /* ---------- state ---------- */

  var state = "intro";
  var epoch = 0;
  var daySeed = 1;
  var specs = [];
  var cur = 0;
  var current = null;
  var tray = [];
  var patience = 0;
  var maxPatience = 1;
  var busy = false;

  var takings = 0;
  var streak = 0;
  var bestStreak = 0;
  var servedCount = 0;
  var mistakes = 0;
  var hearts = 3;
  var bestEver = 0;
  try {
    bestEver = parseInt(localStorage.getItem("exact-change-best"), 10) || 0;
  } catch (e) {
    bestEver = 0;
  }

  /* ---------- dom refs ---------- */

  var elTakings = $("takings");
  var elStreak = $("streak");
  var elServed = $("served");
  var elHearts = $("hearts").children;
  var elPortrait = $("portrait");
  var elWants = $("line-wants");
  var elPays = $("line-pays");
  var elDue = $("change-due");
  var elNote = $("line-note");
  var elRail = $("patience-fill");
  var elQueue = $("queue");
  var elRush = $("rush-banner");
  var elStack = $("tray-stack");
  var elTotal = $("tray-total");
  var elDiff = $("tray-diff");
  var ovIntro = $("overlay-intro");
  var ovPause = $("overlay-pause");
  var ovEnd = $("overlay-end");

  /* ---------- rendering ---------- */

  function renderHud() {
    elTakings.textContent = fmt(takings);
    elStreak.textContent = "×" + streak;
    elServed.textContent = servedCount + "/" + DAY_LEN;
    for (var i = 0; i < elHearts.length; i++) {
      elHearts[i].classList.toggle("lost", i >= hearts);
    }
  }

  function renderCustomer() {
    elPortrait.innerHTML = current.art;
    elPortrait.classList.remove("arrive", "walkout");
    void elPortrait.offsetWidth;
    elPortrait.classList.add("arrive");
    elWants.innerHTML =
      "<strong>" +
      current.name.charAt(0).toUpperCase() +
      current.name.slice(1) +
      "</strong> wants " +
      current.item +
      " — " +
      fmt(current.price);
    elPays.textContent = "…and pays with " + fmt(current.tender);
    elDue.textContent = fmt(current.due);
    elNote.textContent = current.note;
    elRush.classList.toggle("hidden", !current.rush);
    renderQueue();
  }

  function renderQueue() {
    var html = "";
    var upcoming = specs.slice(cur, cur + 2);
    for (var i = 0; i < upcoming.length; i++) {
      var s = upcoming[i];
      html +=
        '<span class="queue-card">' +
        s.art +
        '<span><span class="q-tag">' +
        s.name +
        "</span> · " +
        (s.quirk === "kid"
          ? "in a hurry"
          : s.quirk === "collector"
            ? "counts coins"
            : "waiting") +
        "</span></span>";
    }
    elQueue.innerHTML =
      html ||
      '<span class="queue-card"><span>last one — closing bell soon</span></span>';
  }

  function traySum() {
    var s = 0;
    for (var i = 0; i < tray.length; i++) s += DENOMS[tray[i]].v;

    return s;
  }

  function renderTray() {
    var html = "";
    for (var i = 0; i < tray.length; i++) {
      var d = DENOMS[tray[i]];
      html += '<span class="coin ' + d.cls + '">' + d.label + "</span>";
    }
    elStack.innerHTML = html;
    var sum = traySum();
    elTotal.textContent = fmt(sum);
    if (tray.length === 0) {
      elTotal.classList.remove("matched");
      elDiff.textContent = "";
      elDiff.className = "tray-diff";
      return;
    }
    var diff = sum - current.due;
    if (diff === 0) {
      elTotal.classList.add("matched");
      elDiff.textContent = "exact!";
      elDiff.className = "tray-diff";
    } else {
      elTotal.classList.remove("matched");
      elDiff.textContent = (diff > 0 ? "+" : "−") + fmt(Math.abs(diff));
      elDiff.className = "tray-diff " + (diff > 0 ? "over" : "short");
    }
  }

  function renderPatience() {
    var frac = Math.max(0, patience / maxPatience);
    elRail.style.width = (frac * 100).toFixed(1) + "%";
    elRail.className = frac > 0.5 ? "high" : frac > 0.22 ? "mid" : "low";
  }

  function later(fn, ms) {
    var e = epoch;
    setTimeout(function () {
      if (e === epoch) fn();
    }, ms);
  }

  /* ---------- actions ---------- */

  function addCoin(idx) {
    if (state !== "serving" || busy) return;
    tray.push(idx);
    sfxCoin(idx);
    renderTray();
  }

  function undoCoin() {
    if (state !== "serving" || busy || tray.length === 0) return;
    tray.pop();
    renderTray();
  }

  function clearTray() {
    if (state !== "serving" || busy || tray.length === 0) return;
    tray = [];
    renderTray();
  }

  function shakeTray() {
    elStack.classList.remove("shake");
    void elStack.offsetWidth;
    elStack.classList.add("shake");
  }

  function flashNote(msg) {
    elNote.textContent = msg;
  }

  function handOver() {
    if (state !== "serving" || busy) return;
    var sum = traySum();
    if (tray.length === 0) {
      sfxErr();
      shakeTray();
      return;
    }
    if (sum === current.due) succeed();
    else botch();
  }

  function succeed() {
    busy = true;
    var wasCollector = current.quirk === "collector";
    var usedOptimal = tray.length <= optimalCoins(current.due);
    var speedTip = Math.round(6 * (patience / maxPatience));
    var streakBonus = Math.min(streak + 1, 5);
    var collectorBonus = wasCollector && usedOptimal ? 6 : 0;
    var tip = 2 + speedTip + streakBonus + collectorBonus;
    takings += current.price + tip;
    servedCount += 1;
    streak += 1;
    if (streak > bestStreak) bestStreak = streak;
    sfxOk();
    elStack.classList.remove("flash-ok");
    void elStack.offsetWidth;
    elStack.classList.add("flash-ok");
    var msg =
      "Perfect — " +
      fmt(current.price + tip) +
      " in the till (" +
      tip +
      "p tip)";
    if (collectorBonus) msg = "Fewest coins! " + msg;
    flashNote(msg);
    tray = [];
    renderTray();
    renderHud();
    later(function () {
      if (cur >= specs.length) endDay(true);
      else serveNext();
    }, 560);
  }

  function botch() {
    mistakes += 1;
    patience -= Math.max(5, maxPatience * 0.35);
    sfxErr();
    shakeTray();
    tray = [];
    renderTray();
    flashNote("That is not what they owe… recount!");
    renderPatience();
    if (patience <= 0) walkout();
  }

  function walkout() {
    busy = true;
    patience = 0;
    renderPatience();
    hearts -= 1;
    streak = 0;
    sfxThud();
    elPortrait.classList.add("walkout");
    flashNote(current.name + " storms out into the rain.");
    renderHud();
    later(function () {
      if (hearts <= 0) endDay(false);
      else if (cur >= specs.length) endDay(true);
      else serveNext();
    }, 640);
  }

  function serveNext() {
    current = specs[cur];
    cur += 1;
    tray = [];
    maxPatience = current.patience;
    patience = maxPatience;
    busy = false;
    renderCustomer();
    renderTray();
    renderPatience();
  }

  function endDay(won) {
    state = "ended";
    busy = true;
    elRush.classList.add("hidden");
    if (takings > bestEver) {
      bestEver = takings;
      try {
        localStorage.setItem("exact-change-best", String(bestEver));
      } catch (e) {
        /* private mode, never mind */
      }
    }
    var title;
    var flair;
    if (won) {
      sfxBell();
      title = "Closing bell!";
      flair =
        mistakes === 0 && hearts === 3
          ? "Not a penny out, not a mood lost. The golden till."
          : mistakes <= 2
            ? "Clean counting on a wild Saturday. Nan would be proud."
            : "You survived the rush. The fudge survived you.";
    } else {
      sfxThud();
      title = "Three walkouts";
      flair = "The till drawer closes early. Tomorrow is another Saturday.";
    }
    $("end-title").textContent = title;
    $("end-flair").textContent = flair;
    $("end-stats").innerHTML =
      "<dt>Takings</dt><dd>" +
      fmt(takings) +
      "</dd>" +
      "<dt>Served</dt><dd>" +
      servedCount +
      " of " +
      DAY_LEN +
      "</dd>" +
      "<dt>Best streak</dt><dd>×" +
      bestStreak +
      "</dd>" +
      "<dt>Mistakes</dt><dd>" +
      mistakes +
      "</dd>" +
      "<dt>Best day ever</dt><dd>" +
      fmt(bestEver) +
      "</dd>";
    ovEnd.classList.remove("hidden");
  }

  function startDay() {
    epoch += 1;
    daySeed = (Date.now() % 100000) + Math.floor(Math.random() * 9973);
    specs = [];
    for (var i = 0; i < DAY_LEN; i++) specs.push(buildSpec(i, daySeed));
    cur = 0;
    tray = [];
    takings = 0;
    streak = 0;
    bestStreak = 0;
    servedCount = 0;
    mistakes = 0;
    hearts = 3;
    state = "serving";
    busy = false;
    ovIntro.classList.add("hidden");
    ovPause.classList.add("hidden");
    ovEnd.classList.add("hidden");
    renderHud();
    serveNext();
  }

  function togglePause(forcePause) {
    if (state === "serving" && (forcePause === undefined || forcePause)) {
      state = "paused";
      ovPause.classList.remove("hidden");
      $("btn-pause").textContent = "Resume";
    } else if (state === "paused" && !forcePause) {
      state = "serving";
      ovPause.classList.add("hidden");
      $("btn-pause").textContent = "Pause";
    }
  }

  function toggleMute() {
    muted = !muted;
    $("btn-mute").textContent = muted ? "Sound: off" : "Sound: on";
    if (!muted) {
      ensureAudio();
      sfxCoin(3);
    }
  }

  /* ---------- main loop ---------- */

  var lastT = 0;

  function frame(t) {
    var dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    if (state === "serving" && !busy) {
      patience -= dt;
      if (patience <= 0) {
        patience = 0;
        renderPatience();
        walkout();
      } else {
        renderPatience();
      }
    }
    window.requestAnimationFrame(frame);
  }

  /* ---------- input wiring ---------- */

  var KEY2IDX = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 0: 9 };

  document.addEventListener("keydown", function (ev) {
    var k = ev.key;
    if (k === " " || k === "Spacebar" || k === "Enter" || k === "Backspace") {
      ev.preventDefault();
    }
    ensureAudio();
    var lk = k.toLowerCase();
    if (lk === "m") {
      toggleMute();
      return;
    }
    if (lk === "r") {
      startDay();
      return;
    }
    if (lk === "p") {
      togglePause();
      return;
    }
    if (k === "Enter" || k === " ") {
      if (state === "intro") startDay();
      else if (state === "ended") startDay();
      else if (state === "paused") togglePause(false);
      else if (state === "serving") handOver();
      return;
    }
    if (state !== "serving" || busy) return;
    if (Object.prototype.hasOwnProperty.call(KEY2IDX, k)) {
      addCoin(KEY2IDX[k]);
    } else if (k === "Backspace" || lk === "b") {
      undoCoin();
    } else if (lk === "c" || lk === "x") {
      clearTray();
    }
  });

  document.addEventListener("pointerdown", ensureAudio, { passive: true });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) togglePause(true);
  });

  (function buildRegister() {
    var reg = $("register");
    DENOMS.forEach(function (d, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "coin " + d.cls;
      b.textContent = d.label;
      b.setAttribute("aria-label", "add " + d.label);
      b.addEventListener("click", function () {
        addCoin(i);
      });
      reg.appendChild(b);
    });
  })();

  $("btn-undo").addEventListener("click", undoCoin);
  $("btn-clear").addEventListener("click", clearTray);
  $("btn-hand").addEventListener("click", handOver);
  $("btn-start").addEventListener("click", startDay);
  $("btn-again").addEventListener("click", startDay);
  $("btn-resume").addEventListener("click", function () {
    togglePause(false);
  });
  $("btn-pause").addEventListener("click", function () {
    togglePause();
  });
  $("btn-mute").addEventListener("click", toggleMute);

  renderHud();
  window.requestAnimationFrame(frame);
})();
