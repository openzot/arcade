/*  * Athanor — an alchemical discovery game for the arcade.  *
 * Combine the four primordials into forty-three essences and complete  *
 * the Great Work. Vanilla DOM + Web Audio. Everything lives in this  *
 * one classic script, wrapped in an IIFE.  */
(function () {
  "use strict";

  /* ---------- tuning ---------- */

  var TOTAL_ESSENCES = 43;
  var CHAIN_WINDOW_MS = 60000;
  var BASE_POINTS = 25;
  var CHAIN_BONUS = 10;
  var WHISPER_COST = 20;

  /* ---------- data ---------- */

  var GLYPHS = {
    fire: "\u25b2",
    water: "\u25bc",
    earth: "\u25a3",
    air: "\u25b3",
    steam: "\u2668",
    lava: "\u223f",
    smoke: "\u25cc",
    rain: "\u2602",
    dust: "\u2234",
    stone: "\u25a0",
    cloud: "\u2601",
    ash: "\u273b",
    mud: "\u2592",
    clay: "\u25cd",
    brick: "\u25ac",
    sand: "\u22f0",
    metal: "\u2699",
    sulphur: "\u2666",
    quicksilver: "\u263f",
    rust: "\u2715",
    sky: "\u25c7",
    wind: "\u224b",
    storm: "\u26a1",
    lightning: "\u21af",
    sun: "\u2600",
    moon: "\u263e",
    star: "\u2736",
    night: "\u2606",
    rainbow: "\u2312",
    glass: "\u25a1",
    lens: "\u25ce",
    salt: "\u2733",
    life: "\u2618",
    moss: "\u2767",
    herb: "\u03a8",
    spirit: "\u2727",
    golem: "\u2593",
    tincture: "\u25c9",
    gold: "\u2609",
    silver: "\u25d1",
    vitriol: "\u2207",
    elixir: "\u271a",
    "philosophers-stone": "\u2735",
  };

  var COLOURS = {
    fire: "#e06c2a",
    water: "#4f9dd6",
    earth: "#8d6f47",
    air: "#9fd0e8",
    steam: "#bcd7e6",
    lava: "#e0492a",
    smoke: "#8d8698",
    rain: "#5fa8cf",
    dust: "#b09a72",
    stone: "#9a9aa2",
    cloud: "#d7dee8",
    ash: "#c9c2b2",
    mud: "#77613f",
    clay: "#c07a4a",
    brick: "#b5533c",
    sand: "#dcc27e",
    metal: "#c0c4cc",
    sulphur: "#e3d23c",
    quicksilver: "#cfd8dc",
    rust: "#b06a3b",
    sky: "#79b6e8",
    wind: "#c9e6f2",
    storm: "#8f7fe8",
    lightning: "#f4ee8a",
    sun: "#f2c14e",
    moon: "#d8dbe8",
    star: "#f4e79a",
    night: "#707aa8",
    rainbow: "#c97fd6",
    glass: "#a5d3dd",
    lens: "#8fd0c8",
    salt: "#eeeeef",
    life: "#7fc97f",
    moss: "#6da96d",
    herb: "#93c47d",
    spirit: "#dcd6f7",
    golem: "#6d6d78",
    tincture: "#b58ad6",
    gold: "#d9a441",
    silver: "#c9ccd6",
    vitriol: "#a8c66c",
    elixir: "#e07fb8",
    "philosophers-stone": "#ffdf6b",
  };

  /* sorted pair key -> result. 39 recipes, one route per essence. */
  var RECIPES = {
    "air+cloud": "sky",
    "air+earth": "dust",
    "air+fire": "smoke",
    "air+sky": "wind",
    "air+steam": "cloud",
    "air+water": "rain",
    "clay+lightning": "golem",
    "cloud+moon": "night",
    "cloud+wind": "storm",
    "dust+sun": "salt",
    "dust+water": "clay",
    "earth+fire": "lava",
    "earth+rain": "mud",
    "elixir+gold": "philosophers-stone",
    "fire+mud": "brick",
    "fire+sand": "glass",
    "fire+sky": "sun",
    "fire+smoke": "ash",
    "fire+stone": "metal",
    "fire+water": "steam",
    "glass+sun": "lens",
    "gold+tincture": "elixir",
    "herb+water": "tincture",
    "lava+water": "stone",
    "life+rain": "herb",
    "life+smoke": "spirit",
    "life+stone": "moss",
    "lightning+mud": "life",
    "metal+moon": "silver",
    "metal+rain": "rust",
    "metal+smoke": "quicksilver",
    "metal+storm": "lightning",
    "metal+sun": "gold",
    "moon+sun": "star",
    "rain+sun": "rainbow",
    "salt+sulphur": "vitriol",
    "sky+stone": "moon",
    "smoke+stone": "sulphur",
    "stone+water": "sand",
  };

  /* ---------- dom ---------- */

  function $(id) {
    return document.getElementById(id);
  }

  /* ---------- state ---------- */

  var discovered = new Set();
  var slots = { a: null, b: null };
  var score = 0;
  var attempts = 0;
  var hits = 0;
  var lastFindAt = 0;
  var startedAt = 0;
  var bootedAt = Date.now();
  var muted = false;
  var won = false;
  var suppressClickUntil = 0;

  /* ---------- audio ---------- */

  var actx = null;

  function audio() {
    if (!actx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      actx = new Ctor();
    }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }

  function tone(freq, dur, type, delay, gainPeak) {
    var ctx = audio();
    if (!ctx || muted) return;
    var t0 = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainPeak || 0.12, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  var sfx = {
    select: function () {
      tone(520, 0.08, "triangle", 0, 0.05);
    },
    discover: function () {
      tone(392, 0.16, "sine", 0);
      tone(523, 0.18, "sine", 0.09);
      tone(659, 0.22, "sine", 0.18);
    },
    chain: function () {
      tone(659, 0.12, "sine", 0);
      tone(784, 0.12, "sine", 0.08);
      tone(988, 0.2, "sine", 0.16);
    },
    fail: function () {
      tone(140, 0.25, "sawtooth", 0, 0.06);
      tone(98, 0.3, "sawtooth", 0.08, 0.05);
    },
    known: function () {
      tone(330, 0.1, "triangle", 0, 0.05);
    },
    whisper: function () {
      tone(880, 0.3, "sine", 0, 0.03);
      tone(660, 0.35, "sine", 0.12, 0.03);
    },
    win: function () {
      var notes = [523, 659, 784, 1047];
      for (var i = 0; i < notes.length; i++)
        tone(notes[i], 0.35, "sine", i * 0.14);
      tone(1568, 0.6, "sine", 0.6, 0.08);
    },
  };

  /* ---------- helpers ---------- */

  function label(name) {
    return name.replace(/-/g, " ");
  }

  function colourOf(name) {
    return COLOURS[name] || "#8a6d3b";
  }

  function glyphOf(name) {
    return GLYPHS[name] || "\u2022";
  }

  function toast(msg, kind) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.remove("bad", "good");
    if (kind) el.classList.add(kind);
    el.classList.add("show");
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(function () {
      el.classList.remove("show");
    }, 2800);
  }

  function logLine(html, kind) {
    var li = document.createElement("li");
    li.innerHTML = html;
    if (kind) li.className = kind;
    var log = $("log");
    log.insertBefore(li, log.firstChild);
    while (log.children.length > 40) log.removeChild(log.lastChild);
  }

  function pairKey(a, b) {
    return a < b ? a + "+" + b : b + "+" + a;
  }

  /* ---------- shelf ---------- */

  function makeChip(name, isNew) {
    var li = document.createElement("li");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (isNew ? " new" : "");
    btn.dataset.name = name;
    btn.style.setProperty("--chip-colour", colourOf(name));
    btn.setAttribute("aria-label", label(name));

    var g = document.createElement("span");
    g.className = "glyph";
    g.textContent = glyphOf(name);

    var n = document.createElement("span");
    n.className = "name";
    n.textContent = label(name);

    var p = document.createElement("span");
    p.className = "pairs";

    btn.appendChild(g);
    btn.appendChild(n);
    btn.appendChild(p);
    li.appendChild(btn);
    return li;
  }

  function shelfButton(name) {
    var btns = $("shelf").querySelectorAll('button[data-name="' + name + '"]');
    return btns.length ? btns[0] : null;
  }

  /* actionable leads: known parents, unknown result */
  function refreshLeadCounts() {
    var counts = {};
    Object.keys(RECIPES).forEach(function (key) {
      var parts = key.split("+");
      var res = RECIPES[key];
      if (discovered.has(res)) return;
      if (!discovered.has(parts[0]) || !discovered.has(parts[1])) return;
      parts.forEach(function (p) {
        counts[p] = (counts[p] || 0) + 1;
      });
    });
    discovered.forEach(function (name) {
      var btn = shelfButton(name);
      if (!btn) return;
      var leads = counts[name] || 0;
      btn.querySelector(".pairs").textContent =
        leads > 0 ? leads + (leads === 1 ? " lead" : " leads") : "spent";
      btn.style.opacity = leads > 0 ? "1" : "0.62";
    });
  }

  function addEssence(name, isNew) {
    discovered.add(name);
    $("shelf").appendChild(makeChip(name, isNew));
    refreshLeadCounts();
    $("found-count").textContent = String(discovered.size);
    var pct = Math.round((discovered.size / TOTAL_ESSENCES) * 100);
    $("progress-fill").style.width = pct + "%";
    $("progress-bar").setAttribute("aria-valuenow", pct);
  }

  /* ---------- slots ---------- */

  function renderSlot(which) {
    var slot = $("slot-" + which);
    var face = slot.querySelector(".slot-face");
    var name = slots[which];
    if (name) {
      slot.classList.add("filled");
      slot.style.setProperty("--slot-colour", colourOf(name));
      face.textContent = glyphOf(name) + " " + label(name);
    } else {
      slot.classList.remove("filled");
      slot.style.removeProperty("--slot-colour");
      face.textContent = "?";
    }
  }

  function placeInSlot(which, name) {
    slots[which] = name;
    renderSlot(which);
    syncTransmute();
  }

  function pushSelection(name) {
    if (slots.a === name || slots.b === name) {
      if (slots.a === name) slots.a = null;
      else slots.b = null;
      renderSlot("a");
      renderSlot("b");
      syncTransmute();
      return;
    }
    if (!slots.a) placeInSlot("a", name);
    else if (!slots.b) placeInSlot("b", name);
    else {
      slots.a = slots.b;
      slots.b = name;
      renderSlot("a");
      renderSlot("b");
      syncTransmute();
    }
    sfx.select();
  }

  function clearSlots(silent) {
    slots.a = null;
    slots.b = null;
    renderSlot("a");
    renderSlot("b");
    var out = $("slot-out");
    out.classList.remove("revealed");
    out.style.removeProperty("--slot-colour");
    $("out-face").textContent = "\u00a0";
    if (!silent) syncTransmute();
  }

  function syncTransmute() {
    $("btn-transmute").disabled = !(slots.a && slots.b);
  }

  /* ---------- transmutation ---------- */

  var MISS_LINES = [
    "The fumes curl away. Nothing.",
    "A sour smell, a grey film. Nothing stirs.",
    "The candle gutters. These two refuse each other.",
    "Cold dross at the bottom of the crucible.",
    "Nothing. The athanor mutters in its sleep.",
  ];

  function transmute() {
    if (!(slots.a && slots.b) || won) return;
    attempts += 1;
    if (!startedAt) startedAt = Date.now();

    var key = pairKey(slots.a, slots.b);
    var result = Object.prototype.hasOwnProperty.call(RECIPES, key)
      ? RECIPES[key]
      : null;

    if (result && !discovered.has(result)) {
      hits += 1;
      var now = Date.now();
      var chained = lastFindAt !== 0 && now - lastFindAt <= CHAIN_WINDOW_MS;
      lastFindAt = now;
      var gained = BASE_POINTS + (chained ? CHAIN_BONUS : 0);
      score += gained;
      $("score").textContent = String(score);

      addEssence(result, true);
      logLine(
        "<b>" +
          label(slots.a) +
          "</b> + <b>" +
          label(slots.b) +
          "</b> \u27f6 <b>" +
          label(result) +
          "</b> +" +
          gained +
          (chained ? " (chain)" : ""),
        "good",
      );
      toast(
        label(result) + " crystallises!" + (chained ? " Chain bonus." : ""),
        "good",
      );

      var out = $("slot-out");
      out.classList.add("revealed");
      out.style.setProperty("--slot-colour", colourOf(result));
      $("out-face").textContent = glyphOf(result) + " " + label(result);

      slots.a = slots.b = null;
      renderSlot("a");
      renderSlot("b");

      if (chained) sfx.chain();
      else sfx.discover();

      if (discovered.size >= TOTAL_ESSENCES) finishWork();
    } else if (result) {
      sfx.known();
      toast(label(result) + " already sits on your shelf.");
      logLine(
        "<b>" +
          label(slots.a) +
          "</b> + <b>" +
          label(slots.b) +
          "</b> \u27f6 known.",
        "",
      );
    } else {
      sfx.fail();
      toast(MISS_LINES[Math.floor(Math.random() * MISS_LINES.length)], "bad");
      logLine(label(slots.a) + " + " + label(slots.b) + " \u2014 dross.", "");
      var outEl = $("slot-out");
      outEl.querySelector(".slot-face").textContent = "\u00d7";
      outEl.classList.remove("shake");
      void outEl.offsetWidth;
      outEl.classList.add("shake");
    }
    syncTransmute();
  }

  /* ---------- whisper hint ---------- */

  function whisper() {
    var frontier = [];
    Object.keys(RECIPES).forEach(function (key) {
      var parts = key.split("+");
      var res = RECIPES[key];
      if (discovered.has(res)) return;
      if (discovered.has(parts[0]) && discovered.has(parts[1]))
        frontier.push(parts);
    });
    if (!frontier.length) return;
    score = Math.max(0, score - WHISPER_COST);
    $("score").textContent = String(score);
    var pick = frontier[Math.floor(Math.random() * frontier.length)];
    sfx.whisper();
    toast(
      "A voice in the fumes: \u201ctry " +
        label(pick[0]) +
        " with " +
        label(pick[1]) +
        ".\u201d",
    );
    logLine(
      "whisper \u2014 " + label(pick[0]) + " + " + label(pick[1]),
      "hint",
    );
  }

  /* ---------- win ---------- */

  function finishWork() {
    won = true;
    window.setTimeout(function () {
      var elapsed =
        (startedAt || bootedAt) && Date.now() - (startedAt || bootedAt);
      var mins = Math.floor(elapsed / 60000);
      var secs = Math.floor((elapsed % 60000) / 1000);
      $("win-score").textContent = String(score);
      $("win-attempts").textContent = String(attempts);
      $("win-accuracy").textContent =
        (attempts ? Math.round((hits / attempts) * 100) : 100) + "%";
      $("win-time").textContent = mins + ":" + (secs < 10 ? "0" : "") + secs;
      $("overlay-win").hidden = false;
      sfx.win();
    }, 700);
  }

  /* ---------- drag & drop ---------- */

  var drag = null;

  function ghostFor(name) {
    var ghost = document.createElement("div");
    ghost.className = "chip drag-ghost";
    ghost.style.setProperty("--chip-colour", colourOf(name));
    var g = document.createElement("span");
    g.className = "glyph";
    g.textContent = glyphOf(name);
    var n = document.createElement("span");
    n.className = "name";
    n.textContent = label(name);
    ghost.appendChild(g);
    ghost.appendChild(n);
    return ghost;
  }

  function slotFromPoint(x, y) {
    var els = document.querySelectorAll("#bench .slot");
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
        return els[i];
    }
    return null;
  }

  function unhighlightSlots() {
    document.querySelectorAll("#bench .slot").forEach(function (s) {
      s.classList.remove("drop-here");
    });
  }

  function wireChip(btn) {
    btn.addEventListener("pointerdown", function (ev) {
      if (won) return;
      ev.preventDefault();
      drag = {
        name: btn.dataset.name,
        startX: ev.clientX,
        startY: ev.clientY,
        moved: false,
        ghost: null,
        pid: ev.pointerId,
      };
      try {
        btn.setPointerCapture(ev.pointerId);
      } catch (err) {
        /* pointer already released */
      }
    });

    btn.addEventListener("pointermove", function (ev) {
      if (!drag || drag.pid !== ev.pointerId) return;
      var dx = ev.clientX - drag.startX;
      var dy = ev.clientY - drag.startY;
      if (!drag.moved && dx * dx + dy * dy > 64) {
        drag.moved = true;
        drag.ghost = ghostFor(drag.name);
        document.body.appendChild(drag.ghost);
      }
      if (drag.moved) {
        drag.ghost.style.left = ev.clientX + "px";
        drag.ghost.style.top = ev.clientY + "px";
        var target = slotFromPoint(ev.clientX, ev.clientY);
        unhighlightSlots();
        if (target && target.id !== "slot-out")
          target.classList.add("drop-here");
      }
    });

    btn.addEventListener("pointerup", function (ev) {
      if (!drag || drag.pid !== ev.pointerId) return;
      var d = drag;
      drag = null;
      /* the pointer already chose an action; swallow the trailing click */
      suppressClickUntil = Date.now() + 400;
      if (d.ghost) d.ghost.remove();
      unhighlightSlots();
      if (d.moved) {
        var target = slotFromPoint(ev.clientX, ev.clientY);
        if (target && target.id !== "slot-out") {
          placeInSlot(target.dataset.slot, d.name);
          sfx.select();
        }
      } else {
        pushSelection(d.name);
      }
    });

    btn.addEventListener("pointercancel", function () {
      if (drag && drag.ghost) drag.ghost.remove();
      drag = null;
      unhighlightSlots();
    });

    btn.addEventListener("click", function () {
      if (Date.now() < suppressClickUntil) return;
      if (!won) pushSelection(btn.dataset.name);
    });
  }

  /* ---------- setup / reset ---------- */

  function resetGame(showIntro) {
    discovered.clear();
    slots.a = slots.b = null;
    score = 0;
    attempts = 0;
    hits = 0;
    lastFindAt = 0;
    startedAt = 0;
    won = false;
    $("score").textContent = "0";
    $("log").innerHTML = "";
    $("shelf").innerHTML = "";
    ["fire", "water", "earth", "air"].forEach(function (p) {
      addEssence(p, false);
    });
    clearSlots(true);
    $("overlay-win").hidden = true;
    if (showIntro) $("overlay-intro").hidden = false;
    logLine("The garret is swept. Four primordials wait on the shelf.", "sys");
  }

  /* ---------- events ---------- */

  function toggleSound() {
    muted = !muted;
    $("btn-sound").setAttribute("aria-pressed", muted ? "false" : "true");
    if (!muted) sfx.select();
  }

  function wireOnce() {
    Array.prototype.forEach.call(
      $("shelf").querySelectorAll(".chip"),
      wireChip,
    );

    /* chips are created dynamically, so observe the shelf itself */
    new MutationObserver(function (records) {
      records.forEach(function (rec) {
        Array.prototype.forEach.call(rec.addedNodes, function (node) {
          if (node.nodeType === 1) {
            var btn = node.matches("button.chip")
              ? node
              : node.querySelector("button.chip");
            if (btn) wireChip(btn);
          }
        });
      });
    }).observe($("shelf"), { childList: true, subtree: true });

    $("btn-transmute").addEventListener("click", transmute);
    $("btn-clear").addEventListener("click", function () {
      clearSlots(false);
    });
    $("btn-whisper").addEventListener("click", whisper);
    $("btn-start").addEventListener("click", function () {
      $("overlay-intro").hidden = true;
      audio();
    });
    $("btn-again").addEventListener("click", function () {
      resetGame(false);
    });
    $("btn-restart").addEventListener("click", function () {
      resetGame(false);
      toast("The garret is swept clean.");
    });
    $("btn-help").addEventListener("click", function () {
      var ov = $("overlay-intro");
      ov.hidden = !ov.hidden;
    });
    $("overlay-intro").addEventListener("click", function (ev) {
      if (ev.target === $("overlay-intro")) $("overlay-intro").hidden = true;
    });

    document.addEventListener("keydown", function (ev) {
      var k = ev.key.toLowerCase();
      if (k === "r") {
        resetGame(false);
        toast("The garret is swept clean.");
      } else if (k === "m") {
        toggleSound();
      } else if (k === "h") {
        var ov = $("overlay-intro");
        ov.hidden = !ov.hidden;
      } else if (k === "enter" && !$("overlay-intro").hidden) {
        $("overlay-intro").hidden = true;
      }
    });

    document.addEventListener("visibilitychange", function () {
      if (!actx) return;
      if (document.hidden) actx.suspend();
      else actx.resume();
    });
  }

  /* ---------- boot ---------- */

  bootedAt = Date.now();
  resetGame(false);
  wireOnce();
})();
