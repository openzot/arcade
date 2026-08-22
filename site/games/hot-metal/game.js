(() => {
  "use strict";

  // ---------------------------------------------------------------- dom ----
  const $ = (id) => document.getElementById(id);
  const frame = $("playfield");
  const wordsEl = $("words");
  const pageEl = $("page");
  const floatEl = $("floaters");
  const clockEl = $("clock");
  const shiftFill = $("shiftfill");
  const scoreEl = $("score");
  const comboEl = $("combo");
  const smearPips = Array.from(document.querySelectorAll("#smears .pip"));
  const overlayEl = $("overlay");
  const introCard = $("introCard");
  const pauseCard = $("pauseCard");
  const endCard = $("endCard");
  const endTitle = $("endTitle");
  const endLede = $("endLede");
  const endStats = $("endStats");
  const oskEl = $("osk");

  // ------------------------------------------------------------- tuning ----
  const HOUR_MS = 24000; // one printed hour of the shift
  const HOUR_LABELS = [
    "11 PM",
    "12 AM",
    "1 AM",
    "2 AM",
    "3 AM",
    "4 AM",
    "5 AM",
    "6 AM",
  ];
  const SHIFT_HOURS = 7; // play through these, then the dawn bell
  const SPAWN_MS = [2600, 2300, 2050, 1800, 1550, 1350, 1150];
  const MAX_SLUGS = [3, 4, 4, 5, 5, 6, 7];
  const SPEEDS = [13, 16, 19, 23, 27, 31, 35]; // px/s before scaling

  const WORDS = [
    "INK",
    "AIM",
    "JIG",
    "RAG",
    "CUT",
    "SET",
    "TIE",
    "OAR",
    "HUM",
    "KEY",
    "PEN",
    "WAX",
    "GUM",
    "DRY",
    "VAT",
    "RIM",
    "HEM",
    "AXE",
    "IVY",
    "OWL",
    "ELF",
    "ORB",
    "FEN",
    "JAM",
    "MOP",
    "NOD",
    "PIP",
    "RIB",
    "SAP",
    "TIN",
    "VOW",
    "YAK",
    "ZIP",
    "DAB",
    "BED",
    "FOG",
    "LAP",
    "NET",
    "URN",
    "TYPE",
    "LEAD",
    "SORT",
    "FONT",
    "SLUG",
    "DAMP",
    "FOLD",
    "BIND",
    "GILD",
    "MEND",
    "WARP",
    "TWIN",
    "ECHO",
    "HUSK",
    "KILN",
    "LOOM",
    "LYNX",
    "MYTH",
    "ONYX",
    "PROW",
    "QUIZ",
    "VELD",
    "WISP",
    "YARN",
    "ZINC",
    "BELL",
    "CHAR",
    "DUSK",
    "ETCH",
    "FLAX",
    "GRIM",
    "HAZE",
    "IRIS",
    "JOLT",
    "KELP",
    "MOTH",
    "NOSE",
    "OPAL",
    "PALM",
    "QUAY",
    "RUST",
    "SEAM",
    "TRIM",
    "VEIL",
    "WEFT",
    "YOLK",
    "PRESS",
    "CHASE",
    "FORME",
    "QUOIN",
    "PROOF",
    "INKER",
    "BRACE",
    "CHALK",
    "DRIFT",
    "EMBER",
    "FLINT",
    "GHOST",
    "HOIST",
    "IVORY",
    "JEWEL",
    "KNAVE",
    "LATCH",
    "MIRTH",
    "NICKEL",
    "OTTER",
    "PLUMB",
    "QUIRK",
    "SHARD",
    "THRUM",
    "UMBRA",
    "VIGIL",
    "WHORL",
    "CRANK",
    "BLURB",
    "SPINE",
    "QUILL",
    "RULER",
    "KNURL",
    "GALLEY",
    "PLATEN",
    "SERIFS",
    "FOLIOS",
    "QUARTO",
    "OCTAVO",
    "BRAYER",
    "TYMPAN",
    "FRISKET",
    "DABBER",
    "GILDED",
    "KINDLE",
    "MEADOW",
    "NIMBLE",
    "ORACLE",
    "QUARRY",
    "RUSTLE",
    "TALLOW",
    "VELVET",
    "WALNUT",
    "COPPER",
    "SIZZLE",
    "KINDRED",
    "LANTERN",
    "PIGMENT",
    "TYPEBAR",
    "INKWELL",
    "MERCURY",
    "PRINTER",
    "MACHINE",
    "GASLIGHT",
    "LINOTYPE",
    "TYPEFACE",
    "NOCTURNE",
    "TYPECASE",
    "INKSTAND",
    "MOONBEAM",
    "TWILIGHT",
    "WHISPER",
    "COMPOSING",
    "MOONSHINE",
    "LAMPLIGHT",
    "PAPERMILL",
    "NIGHTFALL",
  ];

  // -------------------------------------------------------------- state ----
  let state = "intro"; // intro | playing | paused | over
  let hour = 0;
  let hourT = 0;
  let spawnT = 0;
  let score = 0;
  let setCount = 0;
  let chain = 0;
  let bestChain = 0;
  let bestMult = 1;
  let right = 0;
  let wrong = 0;
  let smears = 0;
  let locked = null;
  let muted = false;
  let last = 0;
  let slugs = [];
  let blots = [];
  let pageOff = { x: 0, y: 0, w: 0, h: 0 };

  // ------------------------------------------------------------ helpers ----
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function multiplier() {
    return Math.min(5, 1 + ((chain / 3) | 0));
  }

  function fieldRect() {
    return frame.getBoundingClientRect();
  }

  function measurePage() {
    const f = fieldRect();
    const r = pageEl.getBoundingClientRect();
    pageOff = { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height };
  }

  function nearestOnPage(x, y) {
    return {
      x: clamp(x, pageOff.x, pageOff.x + pageOff.w),
      y: clamp(y, pageOff.y, pageOff.y + pageOff.h),
    };
  }

  function distToPage(s) {
    const p = nearestOnPage(s.x, s.y);
    return Math.hypot(p.x - s.x, p.y - s.y);
  }

  function floater(x, y, text, cls) {
    const d = document.createElement("div");
    d.className = "floater" + (cls ? " " + cls : "");
    d.textContent = text;
    d.style.left = x + "px";
    d.style.top = y + "px";
    floatEl.appendChild(d);
    setTimeout(() => d.remove(), 1000);
  }

  function toast(text) {
    const d = document.createElement("div");
    d.className = "toast";
    d.textContent = text;
    floatEl.appendChild(d);
    setTimeout(() => d.remove(), 2100);
  }

  // -------------------------------------------------------------- audio ----
  let actx = null;

  function ac() {
    if (!actx) {
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (err) {
        return null;
      }
    }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }

  function tone(freq, dur, vol, type, when, slideTo) {
    if (muted) return;
    const c = ac();
    if (!c) return;
    const t = c.currentTime + (when || 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function hiss(dur, vol, when) {
    if (muted) return;
    const c = ac();
    if (!c) return;
    const t = c.currentTime + (when || 0);
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = vol;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 900;
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
  }

  const sndTick = (p, kind) =>
    tone((kind === "red" ? 420 : 330) + p * 240, 0.055, 0.05, "square");

  const sndSet = (kind) => {
    tone(110, 0.16, 0.16, "triangle", 0, 70);
    hiss(0.09, 0.05);
    tone(660, 0.06, 0.05, "square", 0.03);
    if (kind === "gilt") {
      tone(880, 0.12, 0.07, "sine", 0.08);
      tone(1320, 0.14, 0.05, "sine", 0.12);
    }
    if (kind === "red") tone(520, 0.09, 0.06, "sawtooth", 0.04);
  };

  const sndMiss = () => tone(95, 0.13, 0.08, "sawtooth");

  const sndSmear = () => {
    tone(150, 0.32, 0.13, "sawtooth", 0, 52);
    hiss(0.22, 0.09);
  };

  const sndHour = () => {
    tone(523, 0.18, 0.06, "sine");
    tone(784, 0.22, 0.05, "sine", 0.1);
  };

  const sndDawn = () => {
    [660, 880, 990].forEach((f, i) => tone(f, 0.5, 0.09, "sine", i * 0.28));
  };

  // --------------------------------------------------------------- slugs ----
  function activeWords() {
    const used = new Set(slugs.map((s) => s.word));
    return WORDS.filter((w) => !used.has(w));
  }

  function spawnSlug() {
    const avail = activeWords().filter((w) =>
      hour < 2 ? w.length <= 6 : true,
    );
    const word = pick(avail.length ? avail : activeWords());
    const f = fieldRect();
    const scale = clamp(Math.min(f.width, f.height) / 640, 0.55, 1.5);
    const roll = Math.random();
    const kind =
      roll < 0.11 && hour >= 1
        ? "red"
        : roll < 0.19 && word.length >= 7 && smears > 0
          ? "gilt"
          : "plain";

    // enter from a random edge, just outside the frame
    const side = (Math.random() * 4) | 0;
    const m = 56;
    let x;
    let y;
    if (side === 0) {
      x = rand(0, f.width);
      y = -m;
    } else if (side === 1) {
      x = f.width + m;
      y = rand(0, f.height);
    } else if (side === 2) {
      x = rand(0, f.width);
      y = f.height + m;
    } else {
      x = -m;
      y = rand(0, f.height);
    }

    const el = document.createElement("div");
    el.className = "slug" + (kind === "plain" ? "" : " " + kind);
    const chEls = [];
    for (const chr of word) {
      const sp = document.createElement("span");
      sp.className = "ch";
      sp.textContent = chr;
      el.appendChild(sp);
      chEls.push(sp);
    }
    wordsEl.appendChild(el);

    const s = {
      el,
      chEls,
      word,
      next: 0,
      kind,
      x,
      y,
      tx: 0,
      ty: 0,
      speed:
        SPEEDS[hour] *
        scale *
        rand(0.88, 1.15) *
        (kind === "red" ? 1.45 : kind === "gilt" ? 0.55 : 1),
      wobA: rand(9, 20),
      wobF: rand(1.2, 2.4),
      wobP: rand(0, Math.PI * 2),
      t: 0,
    };
    retarget(s);
    slugs.push(s);
    placeSlug(s);
  }

  function retarget(s) {
    const p = nearestOnPage(s.x, s.y);
    // aim just inside the page's edge, jittered so arrivals spread out
    s.tx = clamp(p.x + rand(-24, 24), pageOff.x, pageOff.x + pageOff.w);
    s.ty = clamp(p.y + rand(-24, 24), pageOff.y, pageOff.y + pageOff.h);
  }

  function placeSlug(s) {
    s.el.style.transform =
      "translate(" + s.x.toFixed(1) + "px," + s.y.toFixed(1) + "px)";
  }

  function removeSlug(s, wasSet) {
    s.dead = true;
    if (wasSet) {
      s.el.classList.add("set");
      const el = s.el;
      setTimeout(() => el.remove(), 320);
    } else {
      s.el.remove();
    }
    slugs = slugs.filter((o) => o !== s);
    if (locked === s) locked = null;
  }

  // --------------------------------------------------------------- blots ----
  function addBlot(px, py) {
    const b = document.createElement("div");
    b.className = "blot";
    const size = rand(26, 54);
    b.style.width = size + "px";
    b.style.height = size * rand(0.8, 1.1) + "px";
    b.style.left = px - size / 2 + "px";
    b.style.top = py - size / 2 + "px";
    b.style.transform =
      "rotate(" +
      ((Math.random() * 360) | 0) +
      "deg) scale(" +
      rand(0.75, 1.25).toFixed(2) +
      ")";
    pageEl.appendChild(b);
    blots.push(b);
  }

  function liftBlot() {
    const b = blots.pop();
    if (b) b.remove();
  }

  // -------------------------------------------------------------- input ----
  function flashKey(ch) {
    const k = oskEl.querySelector('[data-key="' + ch + '"]');
    if (!k) return;
    k.classList.add("hit");
    setTimeout(() => k.classList.remove("hit"), 130);
  }

  function typeLetter(ch) {
    flashKey(ch);
    let target = locked && !locked.dead ? locked : null;
    if (!target) {
      let best = null;
      let bestD = Infinity;
      for (const s of slugs) {
        if (s.next < s.word.length && s.word[s.next] === ch) {
          const d = distToPage(s);
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
      }
      if (best) {
        locked = best;
        target = best;
      }
    }

    if (target && target.word[target.next] === ch) {
      target.chEls[target.next].classList.add("done");
      target.next++;
      right++;
      if (!target.el.classList.contains("locked")) {
        target.el.classList.add("locked");
      }
      sndTick(target.next / target.word.length, target.kind);
      if (target.next >= target.word.length) setWord(target);
    } else {
      mistake();
    }
  }

  function releaseLock() {
    if (locked) locked.el.classList.remove("locked");
    locked = null;
  }

  function mistake() {
    wrong++;
    chain = 0;
    comboEl.classList.remove("bad");
    void comboEl.offsetWidth;
    comboEl.classList.add("bad");
    shakeFrame(false);
    sndMiss();
    updateHud();
  }

  function setWord(s) {
    chain++;
    bestChain = Math.max(bestChain, chain);
    bestMult = Math.max(bestMult, multiplier());
    const mult = multiplier();
    let gained = s.word.length * 10 * mult;
    if (s.kind === "red") gained *= 2;
    score += gained;
    setCount++;
    floater(
      clamp(s.x, 8, fieldRect().width - 90),
      clamp(s.y - 10, 8, fieldRect().height - 30),
      "+" + gained,
      s.kind === "red" ? "bad" : s.kind === "gilt" ? "gilt" : "",
    );
    if (s.kind === "gilt" && smears > 0) {
      smears--;
      liftBlot();
      floater(
        clamp(s.x, 8, fieldRect().width - 130),
        s.y + 16,
        "SMUDGE LIFTED",
        "gilt",
      );
    }
    removeSlug(s, true);
    sndSet(s.kind);
    updateHud();
  }

  function reachPage(s) {
    smears++;
    addBlot(
      clamp(s.tx - pageOff.x, 10, Math.max(10, pageOff.w - 10)),
      clamp(s.ty - pageOff.y, 10, Math.max(10, pageOff.h - 10)),
    );
    chain = 0;
    floater(
      clamp(s.x, 8, fieldRect().width - 100),
      clamp(s.y, 8, fieldRect().height - 30),
      "SMUDGED",
      "bad",
    );
    removeSlug(s, false);
    shakeFrame(true);
    sndSmear();
    updateHud();
    if (smears >= 3) gameOver(false);
  }

  function shakeFrame(hard) {
    frame.classList.remove("shake", "flash");
    void frame.offsetWidth;
    frame.classList.add("shake");
    if (hard) frame.classList.add("flash");
  }

  // ---------------------------------------------------------------- hud ----
  function updateHud() {
    scoreEl.textContent = String(score);
    comboEl.textContent = "\u00d7" + multiplier();
    smearPips.forEach((pip, i) => {
      pip.classList.toggle("gone", i >= 3 - smears);
    });
    clockEl.textContent = HOUR_LABELS[Math.min(hour, HOUR_LABELS.length - 1)];
    shiftFill.style.width =
      (((hour * HOUR_MS + hourT) / (SHIFT_HOURS * HOUR_MS)) * 100).toFixed(1) +
      "%";
  }

  // ------------------------------------------------------------- shifts ----
  function advanceHour() {
    hour++;
    hourT = 0;
    if (hour >= SHIFT_HOURS) {
      gameOver(true);
      return;
    }
    toast(HOUR_LABELS[hour] + " \u2014 the press speeds up");
    sndHour();
    updateHud();
  }

  // ------------------------------------------------------ state changes ----
  function showOverlay(card) {
    for (const c of [introCard, pauseCard, endCard]) c.hidden = c !== card;
    overlayEl.classList.toggle("show", !!card);
  }

  function clearBoard() {
    for (const s of slugs) s.el.remove();
    slugs = [];
    for (const b of blots) b.remove();
    blots = [];
    floatEl.innerHTML = "";
    releaseLock();
  }

  function startShift() {
    clearBoard();
    hour = 0;
    hourT = 0;
    spawnT = 700;
    score = 0;
    setCount = 0;
    chain = 0;
    bestChain = 0;
    bestMult = 1;
    right = 0;
    wrong = 0;
    smears = 0;
    state = "playing";
    showOverlay(null);
    toast("11 PM \u2014 night shift begins");
    updateHud();
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      showOverlay(pauseCard);
    } else if (state === "paused") {
      state = "playing";
      showOverlay(null);
    }
  }

  function gameOver(win) {
    state = "over";
    releaseLock();
    for (const s of slugs.slice()) removeSlug(s, false);
    const acc =
      right + wrong > 0 ? Math.round((right / (right + wrong)) * 100) : 100;
    endTitle.textContent = win ? "Dawn bell." : "The edition is ruined.";
    endLede.textContent = win
      ? "The presses fall silent. Fresh copies, barely dry, go out with the milk."
      : "Three smudges and the foreman pulls the page. The press rolls on without you.";
    endStats.innerHTML =
      "<li>Words set &mdash; " +
      setCount +
      "</li><li>Best chain &mdash; \u00d7" +
      bestMult +
      " (" +
      bestChain +
      " clean)</li><li>Keystroke accuracy &mdash; " +
      acc +
      "%</li><li>Night's pay &mdash; " +
      score +
      "</li>";
    showOverlay(endCard);
    if (win) sndDawn();
    updateHud();
  }

  // --------------------------------------------------------------- loop ----
  function tick(t) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    if (state !== "playing") return;

    hourT += dt * 1000;
    if (hourT >= HOUR_MS) {
      advanceHour();
      if (state !== "playing") return;
    }

    spawnT -= dt * 1000;
    if (spawnT <= 0 && slugs.length < MAX_SLUGS[Math.min(hour, 6)]) {
      spawnSlug();
      spawnT = SPAWN_MS[hour] * rand(0.72, 1.3);
    }

    for (const s of slugs.slice()) {
      if (s.dead) continue;
      s.t += dt;
      const dx = s.tx - s.x;
      const dy = s.ty - s.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;
      const w = s.wobA * s.wobF * Math.cos(s.t * s.wobF + s.wobP);
      s.x += ux * s.speed * dt + -uy * w * dt;
      s.y += uy * s.speed * dt + ux * w * dt;
      placeSlug(s);
      if (d < s.speed * dt + 5) reachPage(s);
    }
  }

  // ----------------------------------------------------------- keyboard ----
  // While the shift is running every letter key types - P, M and R are just
  // letters to set. The shortcuts (and R-restart) live on menus and buttons.
  function onKey(e) {
    if (e.repeat) return;
    const k = e.key;
    const isLetter = /^[a-z]$/i.test(k);

    if (state === "playing") {
      if (k === "Backspace" || k === "Escape") {
        e.preventDefault();
        releaseLock();
        return;
      }
      if (isLetter) {
        e.preventDefault();
        typeLetter(k.toUpperCase());
      } else if (k === " ") {
        e.preventDefault();
      }
      return;
    }

    if (k === "m" || k === "M") {
      toggleSound();
      return;
    }
    if ((k === "p" || k === "P") && state === "paused") {
      togglePause();
      return;
    }
    if (k === "r" || k === "R") {
      startShift();
      return;
    }
    if (state === "intro" || state === "over") {
      if (k === "Enter" || k === " " || isLetter) {
        e.preventDefault();
        startShift();
      }
    }
  }
  function makeKey(ch, wide) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "key" + (wide ? " wide" : "");
    b.textContent = ch;
    b.dataset.key = wide ? "*" : ch;

    b.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        if (state === "intro" || state === "over") startShift();
        else if (wide) releaseLock();
        else typeLetter(ch);
      },
      { passive: false },
    );
    return b;
  }

  function buildOsk() {
    const rows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
    rows.forEach((row) => {
      const div = document.createElement("div");
      div.className = "oskrow";
      for (const ch of row) div.appendChild(makeKey(ch));
      if (row === "ZXCVBNM") div.appendChild(makeKey("\u232b", true));
      oskEl.appendChild(div);
    });
  }

  function toggleKeys() {
    oskEl.hidden = false;
    const on = oskEl.classList.toggle("show");
    $("keysBtn").textContent = "Keys: " + (on ? "on" : "off");
  }

  function toggleSound() {
    muted = !muted;
    $("soundBtn").textContent = "Sound: " + (muted ? "off" : "on");
    if (!muted) tone(660, 0.07, 0.05, "square");
  }

  // -------------------------------------------------------------- wiring ---
  $("startBtn").addEventListener("click", startShift);
  $("againBtn").addEventListener("click", startShift);
  $("resumeBtn").addEventListener("click", togglePause);
  $("pauseBtn").addEventListener("click", togglePause);
  $("restartBtn").addEventListener("click", startShift);
  $("soundBtn").addEventListener("click", toggleSound);
  $("keysBtn").addEventListener("click", toggleKeys);
  // keep space/enter from re-triggering whichever button was last clicked
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) b.blur();
  });
  window.addEventListener("keydown", onKey);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") togglePause();
  });

  window.addEventListener("resize", () => {
    measurePage();
    for (const s of slugs) retarget(s);
  });

  // ---------------------------------------------------------------- boot ---
  buildOsk();
  if (
    window.matchMedia("(pointer: coarse)").matches ||
    "ontouchstart" in window
  ) {
    toggleKeys();
  }
  measurePage();
  updateHud();
  showOverlay(introCard);
  requestAnimationFrame(tick);
})();
