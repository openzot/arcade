/*
 * The Black Chamber — a game of Elizabethan codebreaking for the arcade.
 *
 * London, 1586. Six intercepted dispatches, each written in a simple
 * substitution cipher. Tap a glyph, choose its true letter, and pull the
 * plot out of the noise before your candle burns down. A false full
 * reading scorches the wax; a hunch sealed in wax reveals one true letter.
 *
 * Everything lives in this one classic script, wrapped in an IIFE.
 */
(function () {
  "use strict";

  /* ── the dispatches ────────────────────────────────────── */

  var MSGS = [
    {
      note: "Slipped from a boat at Billingsgate \u2014 the ink ran, the words did not.",
      text: "THE BARGE WAITS AT THE WATER GATE AFTER MIDNIGHT TIDE",
    },
    {
      note: "Taken from a rider stopped at Southwark Bar at dusk.",
      text: "SEAL THIS IN WAX AND THE COURIER RIDES NORTH AT FIRST LIGHT",
    },
    {
      note: "Copied out by a waiter in the Plough tavern, Westminster.",
      text: "SIX GENTLEMEN WILL MEET AT PLAGUE PIT HILL ON FRIDAY NIGHT",
    },
    {
      note: "Lifted from the vintner\u2019s counting desk at Dowgate.",
      text: "THE GOLD MOVES THROUGH THE THIRD CASK ON THE THAMES BARGE",
    },
    {
      note: "Read by lantern through a lodging window on Tower Hill.",
      text: "SHOW THE GREEN LANTERN WHEN THE FORT GATE OPENS TONIGHT",
    },
    {
      note: "The last dispatch. The hand that wrote it shakes.",
      text: "STRIKE WHEN THE ROYAL BARGE PASSES THE TOWER TRUST NO ONE",
    },
  ];

  /* seconds of candlelight per dispatch; later nights burn faster */
  var DUR = [100, 96, 92, 88, 84, 80];
  var ROMAN = ["I", "II", "III", "IV", "V", "VI"];
  var AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  var SEAL_LINES = [
    "The reading was true to the letter.",
    "Walsingham will have this before the fire needs stoking.",
    "Another thread in the web, drawn quietly tight.",
    "Somewhere across the city, a door will be watched tonight.",
  ];

  /* ── dom ───────────────────────────────────────────────── */

  function $(id) {
    return document.getElementById(id);
  }

  var letterEl = $("letter");
  var trayEl = $("tray");
  var interceptEl = $("intercept");
  var verdictEl = $("verdict");
  var deskEl = $("desk");
  var veilEl = $("veil");
  var panels = {
    ovTitle: $("ovTitle"),
    ovHelp: $("ovHelp"),
    ovPause: $("ovPause"),
    ovSeal: $("ovSeal"),
    ovEnd: $("ovEnd"),
  };
  var waxFillEl = $("waxFill");
  var waxTrackEl = $("waxTrack");
  var flameEl = $("flame");
  var candleWrapEl = $("candleWrap");
  var btnHint = $("btnHint");
  var btnSound = $("btnSound");
  var dispatchLabelEl = $("dispatchLabel");
  var scoreLabelEl = $("scoreLabel");

  /* ── state ─────────────────────────────────────────────── */

  var state = "title"; // title | playing | paused | sealed | won | lost
  var level = 0;
  var score = 0;
  var wax = 100;
  var hints = 0;
  var msgText = "";
  var cipherOf = {}; // plain letter -> cipher glyph
  var truthFor = {}; // cipher glyph -> plain letter
  var order = []; // cipher glyphs in first-appearance order
  var map = {}; // cipher glyph -> guessed plain letter or null
  var used = {}; // plain letter -> cipher glyph or null
  var revealed = {}; // cipher glyphs given away by a wax hunch
  var undoStack = [];
  var lastPenalty = "";
  var sel = null; // currently selected cipher glyph
  var muted = false;

  /* ── tiny helpers ──────────────────────────────────────── */

  function snapshot() {
    undoStack.push(JSON.stringify([map, used]));
    if (undoStack.length > 80) undoStack.shift();
  }

  function verdict(text, bad) {
    verdictEl.textContent = text || "\u00a0";
    verdictEl.classList.toggle("bad", !!bad);
  }

  function shakeDesk() {
    deskEl.classList.remove("shake");
    void deskEl.offsetWidth;
    deskEl.classList.add("shake");
  }

  /* ── sound (Web Audio, synthesised) ────────────────────── */

  var actx = null;

  function ensureAudio() {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    if (actx && actx.state === "suspended") actx.resume();
  }

  function beep(freq, dur, type, gain, glideTo) {
    if (muted || !actx) return;
    try {
      var t0 = actx.currentTime;
      var osc = actx.createOscillator();
      var g = actx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (glideTo) osc.frequency.linearRampToValueAtTime(glideTo, t0 + dur);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(actx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (e) {
      /* audio is garnish; never let it break the desk */
    }
  }

  var snd = {
    select: function () {
      beep(300, 0.05, "square", 0.04);
    },
    tick: function (i) {
      beep(430 + (i % 14) * 22, 0.07, "triangle", 0.09);
    },
    swap: function () {
      beep(360, 0.05, "square", 0.05);
      setTimeout(function () {
        beep(430, 0.05, "square", 0.05);
      }, 55);
    },
    err: function () {
      beep(130, 0.3, "sine", 0.16);
      beep(98, 0.34, "sawtooth", 0.07);
    },
    hint: function () {
      beep(500, 0.18, "triangle", 0.08, 880);
    },
    seal: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        setTimeout(function () {
          beep(f, 0.16, "triangle", 0.12);
        }, i * 95);
      });
    },
    win: function () {
      [392, 494, 587, 784].forEach(function (f, i) {
        setTimeout(function () {
          beep(f, 0.5, "triangle", 0.1);
        }, i * 130);
      });
    },
    lose: function () {
      beep(240, 0.8, "sine", 0.13, 85);
    },
    ui: function () {
      beep(700, 0.04, "triangle", 0.05);
    },
  };

  /* ── rendering ─────────────────────────────────────────── */

  function buildLetter() {
    letterEl.textContent = "";
    var words = msgText.split(" ");
    for (var w = 0; w < words.length; w++) {
      var word = document.createElement("span");
      word.className = "word";
      for (var i = 0; i < words[w].length; i++) {
        var ch = words[w][i];
        if (!/[A-Z]/.test(ch)) continue;
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.dataset.c = cipherOf[ch];
        var gl = document.createElement("span");
        gl.className = "gl";
        gl.textContent = cipherOf[ch];
        var gu = document.createElement("span");
        gu.className = "gu";
        gu.textContent = "\u00a0";
        chip.appendChild(gl);
        chip.appendChild(gu);
        word.appendChild(chip);
      }
      letterEl.appendChild(word);
    }
  }

  function paintLetter() {
    var chips = letterEl.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      var c = chips[i].dataset.c;
      chips[i].querySelector(".gu").textContent = map[c] || "\u00a0";
      chips[i].classList.toggle("sel", !!sel && c === sel);
      chips[i].classList.toggle("kin", !!sel && c === sel);
      chips[i].classList.toggle("revealed", !!revealed[c]);
    }
  }

  function render() {
    paintLetter();
    updateTray();
  }

  function buildTray() {
    trayEl.textContent = "";
    for (var i = 0; i < AZ.length; i++) {
      var b = document.createElement("button");
      b.type = "button";
      b.dataset.l = AZ[i];
      b.textContent = AZ[i];
      var small = document.createElement("small");
      b.appendChild(small);
      trayEl.appendChild(b);
    }
  }

  function updateTray() {
    var buttons = trayEl.children;
    for (var i = 0; i < buttons.length; i++) {
      var l = buttons[i].dataset.l;
      var holder = used[l];
      buttons[i].className = holder ? "used" : "";
      buttons[i].querySelector("small").textContent = holder || "";
    }
  }

  function updateScore() {
    scoreLabelEl.textContent = "score " + score;
  }

  function updateWax() {
    waxFillEl.style.height = wax + "%";
    var trackH = waxTrackEl.clientHeight || 120;
    flameEl.style.bottom = 8 + ((trackH - 20) * wax) / 100 + "px";
    candleWrapEl.classList.toggle("low", wax < 25);
    btnHint.classList.toggle("spent", wax <= 15);
  }

  function updateDispatchLabel() {
    dispatchLabelEl.textContent =
      "dispatch " + ROMAN[level] + " of " + ROMAN[MSGS.length - 1];
  }

  function showPanel(name) {
    veilEl.hidden = false;
    for (var k in panels) panels[k].hidden = k !== name;
  }

  function hideVeil() {
    veilEl.hidden = true;
    for (var k in panels) panels[k].hidden = true;
  }

  /* ── cipher plumbing ───────────────────────────────────── */

  /* Sattolo shuffle of the identity: one cycle, so no fixed points —
     no letter ever hides behind itself. */
  function makeDerangement() {
    var a = AZ.split("");
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * i);
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function buildCipher() {
    var der = makeDerangement();
    cipherOf = {};
    truthFor = {};
    for (var i = 0; i < 26; i++) {
      cipherOf[AZ[i]] = der[i];
      truthFor[der[i]] = AZ[i];
    }
  }

  function scanOrder() {
    order = [];
    var seen = {};
    for (var i = 0; i < msgText.length; i++) {
      var ch = msgText[i];
      if (!/[A-Z]/.test(ch)) continue;
      var g = cipherOf[ch];
      if (!seen[g]) {
        seen[g] = true;
        order.push(g);
      }
    }
  }

  function firstUnmapped() {
    for (var i = 0; i < order.length; i++) {
      if (!map[order[i]]) return order[i];
    }
    return null;
  }

  function advanceSel() {
    if (state !== "playing") {
      sel = null;
      return;
    }
    var start = order.indexOf(sel);
    var n = order.length;
    for (var k = 1; k <= n; k++) {
      var i = (start + k) % n;
      if (!map[order[i]]) {
        sel = order[i];
        return;
      }
    }
    sel = null;
  }

  function decode() {
    return msgText.replace(/[A-Z]/g, function (ch) {
      return map[cipherOf[ch]] || "?";
    });
  }

  function allMapped() {
    for (var i = 0; i < order.length; i++) {
      if (!map[order[i]]) return false;
    }
    return true;
  }

  /* core move: give cipher glyph c the plain letter l (swapping if held) */
  function applyMapping(c, l) {
    if (map[c] === l) return false;
    snapshot();
    var prevHolder = used[l];
    var oldVal = map[c];
    map[c] = l;
    used[l] = c;
    if (prevHolder && prevHolder !== c) map[prevHolder] = oldVal || null;
    if (oldVal) used[oldVal] = prevHolder || null;
    return true;
  }

  function checkFull() {
    if (!allMapped() || state !== "playing") return;
    var dec = decode();
    if (dec === msgText) {
      seal();
    } else if (dec !== lastPenalty) {
      lastPenalty = dec;
      wax = Math.max(0, wax - 10);
      verdict("It reads false \u2014 the wax hisses and shrinks.", true);
      shakeDesk();
      snd.err();
      updateWax();
      /* park the selection on the first glyph so backspace can free a
         letter at once */
      sel = order.length ? order[0] : null;
      paintLetter();
    }
  }

  function assign(c, l) {
    if (!c || state !== "playing") return;
    var swapped = !!map[c] && !!used[l] && used[l] !== c;
    if (applyMapping(c, l)) {
      if (swapped) snd.swap();
      else snd.tick(order.indexOf(c));
      render();
      checkFull();
      advanceSel();
      paintLetter();
    }
  }

  function clearSelGlyph() {
    if (!sel || state !== "playing" || !map[sel]) return;
    snapshot();
    used[map[sel]] = null;
    map[sel] = null;
    snd.select();
    render();
  }

  function undo() {
    if (state !== "playing" || !undoStack.length) return;
    var pair = JSON.parse(undoStack.pop());
    map = pair[0];
    used = pair[1];
    lastPenalty = "";

    snd.ui();
    render();
  }

  function hint() {
    if (state !== "playing" || wax <= 15) return;
    var missing = [];
    var wrong = [];
    for (var i = 0; i < order.length; i++) {
      var c = order[i];
      if (!map[c]) missing.push(c);
      else if (map[c] !== truthFor[c]) wrong.push(c);
    }
    if (!missing.length && !wrong.length) return;
    var pool = missing.length ? missing : wrong;
    var c = pool[Math.floor(Math.random() * pool.length)];
    applyMapping(c, truthFor[c]);
    revealed[c] = true;
    hints++;
    wax = Math.max(0, wax - 15);
    sel = c;
    advanceSel();
    snd.hint();
    verdict("A hunch, sealed in wax.");
    render();
    updateWax();
    checkFull();
  }

  /* ── flow ──────────────────────────────────────────────── */

  function startDispatch() {
    msgText = MSGS[level].text;
    buildCipher();
    scanOrder();
    map = {};
    used = {};
    revealed = {};
    for (var a = 0; a < AZ.length; a++) {
      map[cipherOf[AZ[a]]] = null;
      used[AZ[a]] = null;
    }
    undoStack = [];
    lastPenalty = "";
    hints = 0;
    wax = 100;
    sel = order.length ? order[0] : null;
    interceptEl.textContent = MSGS[level].note;
    verdict("");
    buildLetter();
    render();
    updateScore();
    updateDispatchLabel();
    updateWax();
    hideVeil();
    state = "playing";
  }

  function newRun() {
    score = 0;
    level = 0;
    startDispatch();
    snd.ui();
  }

  function seal() {
    state = "sealed";
    sel = null;
    var timeBonus = Math.round(wax * 1.5);
    var clean = hints === 0 ? 60 : 0;
    var gained = 150 + timeBonus + clean;
    score += gained;
    updateScore();
    verdict("Sealed and sent.");
    $("sealLine").textContent =
      SEAL_LINES[Math.floor(Math.random() * SEAL_LINES.length)];
    $("sealScore").textContent =
      "dispatch " +
      ROMAN[level] +
      " \u2014 +" +
      gained +
      " (candle bonus " +
      timeBonus +
      (hints === 0 ? ", unwavering +60" : "") +
      ") \u2014 score " +
      score;
    showPanel("ovSeal");
    snd.seal();
  }

  function win() {
    state = "won";
    $("endTitle").textContent = "The realm stands";
    $("endLine").textContent =
      "Six dispatches read, six plots undone. The royal barge passes the Tower " +
      "unaware, and London wakes none the wiser.";
    $("endScore").textContent = "six seals \u2014 final score " + score;
    $("btnAgain").textContent = "run it again";
    showPanel("ovEnd");
    snd.win();
  }

  function lose() {
    state = "lost";
    sel = null;
    var unread = MSGS.length - level;
    $("endTitle").textContent = "The candle dies";
    $("endLine").textContent =
      "The wax gives out with " +
      (unread === 1 ? "a dispatch" : unread + " dispatches") +
      " still unread. Somewhere on the dark river, oars dip \u2014 and no one " +
      "is watching.";
    $("endScore").textContent =
      (level === 0 ? "no seals" : level === 1 ? "one seal" : level + " seals") +
      " \u2014 score " +
      score;
    $("btnAgain").textContent = "strike a fresh candle";
    showPanel("ovEnd");
    snd.lose();
  }

  function pauseGame() {
    if (state !== "playing") return;
    state = "paused";
    showPanel("ovPause");
    snd.ui();
  }

  function resumeGame() {
    if (state !== "paused") return;
    state = "playing";
    hideVeil();
    snd.ui();
  }

  function openHelp() {
    if (state !== "playing") return;
    state = "paused";
    showPanel("ovHelp");
    snd.ui();
  }

  function toggleSound() {
    muted = !muted;
    btnSound.textContent = muted ? "sound off" : "sound on";
    if (!muted) snd.ui();
  }

  /* ── input ─────────────────────────────────────────────── */

  function setSelected(c) {
    if (state !== "playing" || !c) return;
    sel = c;
    snd.select();
    paintLetter();
  }

  function moveSelection(dir) {
    if (state !== "playing" || !order.length) return;
    var i = order.indexOf(sel);
    i = ((i < 0 ? 0 : i) + dir + order.length) % order.length;
    sel = order[i];
    snd.select();
    paintLetter();
  }

  function primaryAction() {
    if (!panels.ovSeal.hidden) nextDispatch();
    else if (state === "title" || state === "won" || state === "lost") newRun();
    else if (state === "paused") resumeGame();
  }

  function nextDispatch() {
    if (state !== "sealed") return;
    level++;
    if (level >= MSGS.length) win();
    else startDispatch();
    snd.ui();
  }

  letterEl.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (chip) setSelected(chip.dataset.c);
  });

  trayEl.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-l]");
    if (!b || state !== "playing") return;
    var l = b.dataset.l;
    var c = sel || firstUnmapped();
    if (c) assign(c, l);
    else setSelected(used[l]);
  });

  document.addEventListener("keydown", function (e) {
    ensureAudio();
    var k = e.key;

    if (!veilEl.hidden) {
      var bare = !e.ctrlKey && !e.metaKey && !e.altKey;
      if (bare && (k === "Enter" || k === " ")) {
        e.preventDefault();
        primaryAction();
      } else if (bare && (k === "Escape" || k === "p" || k === "P")) {
        if (state === "paused") resumeGame();
      }
      return;
    }

    /* the desk: A–Z are always somebody's guess; commands live on
       non-letter keys, with modifiers, or on the buttons */
    if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[a-zA-Z]$/.test(k)) {
      e.preventDefault();
      var c = sel || firstUnmapped();
      if (c) assign(c, k.toUpperCase());
      return;
    }

    switch (k) {
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        moveSelection(-1);
        break;
      case "ArrowRight":
      case "ArrowDown":
      case "Tab":
        e.preventDefault();
        moveSelection(1);
        break;
      case "Backspace":
      case "Delete":
        e.preventDefault();
        clearSelGlyph();
        break;
      case "z":
      case "Z":
        /* ctrl+cmd+z undoes; a bare Z is somebody's guess */
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          undo();
        }
        break;
      case "Escape":
        e.preventDefault();
        pauseGame();
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        break;
    }
  });

  $("btnStart").addEventListener("click", function () {
    ensureAudio();
    newRun();
  });
  $("btnAgain").addEventListener("click", function () {
    ensureAudio();
    newRun();
  });
  $("btnContinue").addEventListener("click", function () {
    ensureAudio();
    nextDispatch();
  });
  $("btnResume").addEventListener("click", resumeGame);
  $("btnResume2").addEventListener("click", resumeGame);
  $("btnHint").addEventListener("click", function () {
    ensureAudio();
    hint();
  });
  $("btnUndo").addEventListener("click", function () {
    ensureAudio();
    undo();
  });
  $("btnPause").addEventListener("click", function () {
    if (state === "paused") resumeGame();
    else pauseGame();
  });
  btnSound.addEventListener("click", function () {
    ensureAudio();
    toggleSound();
  });
  $("btnNew").addEventListener("click", function () {
    ensureAudio();
    newRun();
  });
  $("btnHelp").addEventListener("click", function () {
    ensureAudio();
    if (state === "paused") resumeGame();
    else openHelp();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state === "playing") pauseGame();
  });

  /* ── the candle burns ──────────────────────────────────── */

  var lastTs = performance.now();

  function loop(ts) {
    var dt = Math.min(50, ts - lastTs);
    lastTs = ts;
    if (state === "playing" && veilEl.hidden) {
      wax -= (dt / 1000) * (100 / DUR[level]);
      if (wax <= 0) {
        wax = 0;
        updateWax();
        lose();
      } else {
        updateWax();
      }
    }
    requestAnimationFrame(loop);
  }

  /* ── boot ──────────────────────────────────────────────── */

  buildTray();
  updateScore();
  updateDispatchLabel();
  updateWax();
  showPanel("ovTitle");

  if (location.hash === "#debug") {
    window.__bc = {
      get level() {
        return level;
      },
      get state() {
        return state;
      },
      get wax() {
        return Math.round(wax);
      },
      get plain() {
        return MSGS[Math.min(level, MSGS.length - 1)].text;
      },
      get order() {
        return order;
      },
      get truthFor() {
        return truthFor;
      },
      drain: function (n) {
        wax = Math.max(0, wax - n);
        updateWax();
      },
    };
  }

  requestAnimationFrame(loop);
})();
