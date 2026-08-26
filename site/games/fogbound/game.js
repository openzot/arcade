/*
 * Fogbound — a moorland navigation game for the arcade.
 *
 * You are lost in hill fog on an evening moor. The map is good; only your
 * place on it is unknown. Sight landmarks to cut bearing wedges across the
 * map, plant your pin where they agree, then set off and steer a blind walk
 * to the stone gate before the daylight runs out. Wind shoves your true
 * course, bogs swallow pace, and the compass is only as honest as your pin.
 *
 * All behaviour lives in this one classic script, wrapped in an IIFE.
 */
(() => {
  "use strict";

  /* ============================== constants ============================== */

  const W = 960;
  const H = 600;
  const TAU = Math.PI * 2;
  const VIS = 95; // fog visibility radius while walking
  const GATE_R = 17; // reach the gate inside this radius
  const MARGIN = 26; // walker cannot leave this frame
  const WALK_SPD = 62; // px / s
  const TURN_SPD = 2.1; // rad / s while steering
  const REFINE_F = 0.42; // refine multiplies the sighting error
  const SUN_PASSIVE = 0.0019; // daylight fraction lost per second, always
  const SUN_BOG = 3.6; // daylight drain multiplier while stuck in a bog
  const COST_SIGHT = 0.01;
  const COST_REFINE = 0.018;
  const TEA = 0.06; // daylight regained at each gate

  const LEGS = [
    { marks: 4, noise: 24, wind: 15, bogs: 3, gateMin: 330 },
    { marks: 4, noise: 27, wind: 23, bogs: 4, gateMin: 390 },
    { marks: 5, noise: 30, wind: 29, bogs: 4, gateMin: 440 },
    { marks: 4, noise: 33, wind: 37, bogs: 5, gateMin: 500 },
    { marks: 3, noise: 36, wind: 45, bogs: 6, gateMin: 560 },
  ];

  const NAMES = [
    "Old Harry",
    "Cutter Tor",
    "Wolf Stones",
    "Maiden Cross",
    "Hare Crag",
    "Druid's Seat",
    "Split Rock",
    "Gallows Hill",
    "Raven Scar",
    "Kitty Wood",
    "Long Stoop",
    "Fairy Kirk",
    "Hob Hole",
    "Wain Stones",
    "Eller Beck",
    "Standing Stone",
    "Pickery Trig",
    "Lingy Flat",
  ];

  const COL = {
    paper: "#efe7d4",
    paperDeep: "#e6dcc4",
    ink: "#3f382c",
    inkSoft: "rgba(63,56,44,0.62)",
    line: "rgba(63,56,44,0.14)",
    rust: "#a84b2a",
    gold: "#c98a1b",
    heather: "rgba(141,123,147,0.5)",
    bogFill: "rgba(95,114,128,0.32)",
    bogLine: "rgba(60,80,95,0.55)",
    fog: "rgba(230,230,224,1)",
  };

  /* =============================== helpers =============================== */

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const wrapTau = (a) => ((a % TAU) + TAU) % TAU;
  const wrap180 = (d) => ((((d + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const fmtDeg = (n) => "\u00b1" + Math.round(n) + "\u00b0";

  /* ================================= dom ================================= */

  const cv = document.getElementById("map");
  const ctx = cv.getContext("2d");
  const board = document.querySelector(".board");
  const overlay = document.getElementById("overlay");
  const ovTitle = document.getElementById("ovTitle");
  const ovBody = document.getElementById("ovBody");
  const ovBtn = document.getElementById("ovBtn");
  const legLabel = document.getElementById("legLabel");
  const sunFill = document.getElementById("sunFill");
  const phaseMsg = document.getElementById("phaseMsg");
  const markList = document.getElementById("markList");
  const bench = document.querySelector(".bench");
  const btnSight = document.getElementById("btnSight");
  const btnRefine = document.getElementById("btnRefine");
  const btnOff = document.getElementById("btnOff");
  const btnSound = document.getElementById("btnSound");
  const btnPause = document.getElementById("btnPause");
  const btnNew = document.getElementById("btnNew");

  let dpr = 1;
  function fit() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fit();
  window.addEventListener("resize", fit);

  /* ================================ audio ================================ */

  let ac = null;
  let master = null;
  let windGain = null;
  let muted = false;

  function initAudio() {
    if (ac) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ac.destination);
    // low moorland wind: looping noise through a bandpass
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 380;
    bp.Q.value = 0.55;
    windGain = ac.createGain();
    windGain.gain.value = 0.04;
    src.connect(bp);
    bp.connect(windGain);
    windGain.connect(master);
    src.start();
  }

  function beep(freq, dur, type, vol, slideTo) {
    if (!ac || muted) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    const t0 = ac.currentTime;
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo)
      o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol || 0.16, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  const sfx = {
    click() {
      beep(480, 0.045, "triangle", 0.09);
    },
    sight() {
      beep(660, 0.07, "sine", 0.15);
      setTimeout(() => beep(495, 0.09, "sine", 0.12), 60);
    },
    refine() {
      beep(880, 0.09, "sine", 0.13);
    },
    pin() {
      beep(150, 0.07, "square", 0.16, 90);
    },
    deny() {
      beep(190, 0.11, "square", 0.08, 140);
    },
    setOff() {
      beep(392, 0.14, "triangle", 0.14);
      setTimeout(() => beep(523, 0.18, "triangle", 0.13), 110);
    },
    bog() {
      beep(96, 0.28, "sawtooth", 0.1, 55);
    },
    gate() {
      [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => beep(f, 0.22, "sine", 0.15), i * 95),
      );
    },
    night() {
      beep(220, 1.6, "sine", 0.16, 82);
    },
    win() {
      [392, 523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => beep(f, 0.3, "triangle", 0.14), i * 130),
      );
    },
  };

  function setMuted(m) {
    muted = m;
    btnSound.textContent = muted ? "\u266a\u0338" : "\u266a";
    btnSound.setAttribute("aria-pressed", String(muted));
    if (master) master.gain.value = muted ? 0 : 0.5;
  }

  /* ============================ map generation =========================== */

  function genMap(li) {
    const leg = LEGS[li];
    const rnd = mulberry32((runSeed + li * 7919) | 0);

    const gate = { x: 0, y: 0 };
    const edge = Math.floor(rnd() * 4);
    if (edge === 0) {
      gate.x = W * (0.25 + rnd() * 0.5);
      gate.y = 52;
    } else if (edge === 1) {
      gate.x = W - 58;
      gate.y = H * (0.25 + rnd() * 0.5);
    } else if (edge === 2) {
      gate.x = W * (0.25 + rnd() * 0.5);
      gate.y = H - 74;
    } else {
      gate.x = 58;
      gate.y = H * (0.25 + rnd() * 0.5);
    }

    // walker starts far from the gate, out of the bogs
    let tp = null;
    for (let tries = 0; tries < 400; tries++) {
      const x = 90 + rnd() * (W - 180);
      const y = 90 + rnd() * (H - 200);
      if (dist(x, y, gate.x, gate.y) < leg.gateMin) continue;
      tp = { x, y };
      break;
    }
    if (!tp) tp = { x: W * 0.2, y: H * 0.75 };
    genStart = { x: tp.x, y: tp.y };

    // landmark stones
    const pool = shuffle(NAMES.slice(), rnd);
    const marks = [];
    for (let tries = 0; tries < 900 && marks.length < leg.marks; tries++) {
      const x = 70 + rnd() * (W - 140);
      const y = 66 + rnd() * (H - 160);
      if (dist(x, y, tp.x, tp.y) < 120) continue;
      if (dist(x, y, gate.x, gate.y) < 90) continue;
      let ok = true;
      for (const m of marks) if (dist(x, y, m.x, m.y) < 125) ok = false;
      if (ok)
        marks.push({
          x,
          y,
          name: pool[marks.length % pool.length],
          err: 0,
          refined: false,
        });
    }

    // bogs
    const bogs = [];
    for (let tries = 0; tries < 600 && bogs.length < leg.bogs; tries++) {
      const rx = 42 + rnd() * 34;
      const ry = 30 + rnd() * 26;
      const b = {
        x: 80 + rnd() * (W - 160),
        y: 80 + rnd() * (H - 190),
        rx,
        ry,
        rot: rnd() * Math.PI,
      };
      if (dist(b.x, b.y, tp.x, tp.y) < 130 + rx) continue;
      if (dist(b.x, b.y, gate.x, gate.y) < 85 + rx) continue;
      let ok = true;
      for (const o of bogs)
        if (dist(b.x, b.y, o.x, o.y) < rx + o.rx + 46) ok = false;
      if (ok) bogs.push(b);
    }

    // paper decoration: contours, heather stipple, rock dots
    const contours = [];
    for (let k = 0; k < 9; k++) {
      const baseY = 30 + (k * (H - 40)) / 9 + rnd() * 26;
      const ph = rnd() * TAU;
      const amp = 12 + rnd() * 22;
      const pts = [];
      for (let x = -20; x <= W + 20; x += 24) {
        pts.push({
          x,
          y:
            baseY +
            Math.sin(x * 0.008 + ph) * amp +
            Math.sin(x * 0.021 + ph * 2) * 8,
        });
      }
      contours.push(pts);
    }
    const stipples = [];
    for (let i = 0; i < 240; i++) {
      stipples.push({
        x: rnd() * W,
        y: rnd() * H,
        a: rnd() * Math.PI,
        l: 3 + rnd() * 5,
      });
    }
    const rocks = [];
    for (let i = 0; i < 40; i++) {
      rocks.push({ x: rnd() * W, y: rnd() * H, r: 1 + rnd() * 1.6 });
    }

    return { leg, gate, marks, bogs, contours, stipples, rocks };
  }

  /* ================================ state ================================ */

  let runSeed = (Date.now() % 1e9) | 0;
  let mode = "intro"; // intro | fix | walk | between | end
  let paused = false;
  let legIdx = 0;
  let sun = 1;
  let map = null;
  let truePos = { x: 0, y: 0 };
  let pin = null;
  let heading = 0;
  let homeBearing = 0; // believed course, pin -> gate
  let selected = -1;
  let gust = { active: false, dir: 0, str: 0, timer: 3, t: 0 };
  let fixErrors = [];
  let refsUsed = 0;
  let betweenT = 0;
  let walkT = 0;
  let fixErrPending = 0; // distance from pin to truth, scored at the gate
  let nowSec = 0;
  let inBog = false;
  let bogSfxCd = 0;
  let genStart = { x: W / 2, y: H / 2 }; // where genMap dropped the walker

  // tiny debug/read-only hook used by the shift's smoke test
  window.__fb = {
    get mode() {
      return mode;
    },
    get sun() {
      return sun;
    },
    get leg() {
      return legIdx;
    },
    get pos() {
      return { x: truePos.x, y: truePos.y };
    },
    get pin() {
      return pin ? { x: pin.x, y: pin.y } : null;
    },
    get gate() {
      return map ? { x: map.gate.x, y: map.gate.y } : null;
    },
  };

  /* ============================== ui helpers ============================= */

  function showOverlay(title, html, btnText, cb) {
    ovTitle.textContent = title;
    ovBody.innerHTML = html;
    ovBtn.textContent = btnText;
    overlay.classList.remove("hidden");
    ovBtn.onclick = () => {
      sfx.click();
      cb();
    };
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
    ovBtn.onclick = null;
  }

  function say(text) {
    phaseMsg.textContent = text;
  }

  function setMode(m) {
    mode = m;
    board.classList.toggle("fix-mode", m === "fix");
    board.classList.toggle("walk-mode", m === "walk");
    bench.classList.toggle("locked", m !== "fix");
  }

  function refreshPanel() {
    legLabel.textContent =
      "Leg " +
      (legIdx + 1) +
      " of " +
      LEGS.length +
      " \u00b7 " +
      map.leg.noise +
      "\u00b0 sights";
    markList.innerHTML = "";
    map.marks.forEach((m, i) => {
      const li = document.createElement("li");
      li.dataset.i = String(i);
      if (i === selected) li.classList.add("selected");
      if (m.err > 0) li.classList.add("sighted");
      const nm = document.createElement("span");
      nm.className = "mk-name";
      nm.textContent = i + 1 + ". " + m.name;
      const val = document.createElement("span");
      val.className = "mk-val";
      val.textContent =
        m.err > 0 ? (m.refined ? "steady " : "") + fmtDeg(m.err) : "unsighted";
      li.appendChild(nm);
      li.appendChild(val);
      markList.appendChild(li);
    });
    const sel = selected >= 0 ? map.marks[selected] : null;
    btnSight.disabled = !(mode === "fix" && sel && sel.err === 0);
    btnRefine.disabled = !(
      mode === "fix" &&
      sel &&
      sel.err > 0 &&
      !sel.refined &&
      sun > COST_REFINE + 0.02
    );
    btnOff.disabled = !(
      mode === "fix" &&
      pin &&
      map.marks.some((m) => m.err > 0)
    );
  }

  /* ============================== run control ============================ */

  function newRun() {
    runSeed = (Date.now() % 1e9) | 0;
    sun = 1;
    legIdx = 0;
    fixErrors = [];
    refsUsed = 0;
    startLeg(0);
  }

  function startLeg(i) {
    legIdx = i;
    map = genMap(i);
    truePos = { x: genStart.x, y: genStart.y };
    pin = null;
    selected = -1;
    heading = Math.atan2(map.gate.y - truePos.y, map.gate.x - truePos.x);
    homeBearing = heading;
    gust = {
      active: false,
      dir: 0,
      str: 0,
      timer: 2 + Math.random() * 3,
      t: 0,
    };
    walkT = 0;
    inBog = false;
    setMode("fix");
    hideOverlay();
    say(
      "Fog holds the moor. Pick a stone, take its bearing, let the wedges cross \u2014 then plant your pin and set off before the light goes.",
    );
    refreshPanel();
  }

  /* ---- actions ---- */

  function selectMark(i) {
    if (mode !== "fix") return;
    selected = i >= 0 && i < map.marks.length ? i : -1;
    if (selected >= 0) sfx.click();
    refreshPanel();
  }

  function takeSight() {
    if (mode !== "fix" || selected < 0) return;
    const m = map.marks[selected];
    if (m.err > 0) return;
    if (sun <= COST_SIGHT + 0.005) {
      sfx.deny();
      say("Too dark for another sight. Plant your pin and go.");
      return;
    }
    sun -= COST_SIGHT;
    m.err = map.leg.noise * (0.92 + Math.random() * 0.16);
    sfx.sight();
    say(
      fmtDeg(m.err) +
        " to " +
        m.name +
        ". A second bearing narrows the crossing \u2014 each sight costs light.",
    );
    refreshPanel();
  }

  function refineSight() {
    if (mode !== "fix" || selected < 0) return;
    const m = map.marks[selected];
    if (!(m.err > 0) || m.refined) return;
    if (sun <= COST_REFINE + 0.005) {
      sfx.deny();
      say("Not enough light left to steady a sight.");
      return;
    }
    sun -= COST_REFINE;
    refsUsed++;
    m.refined = true;
    m.err *= REFINE_F;
    sfx.refine();
    say(
      "Feet planted, breath held \u2014 " +
        fmtDeg(m.err) +
        " to " +
        m.name +
        ".",
    );
    refreshPanel();
  }

  function placePin(x, y) {
    if (mode !== "fix") return;
    pin = { x: clamp(x, 14, W - 14), y: clamp(y, 14, H - 14) };
    sfx.pin();
    say(
      map.marks.some((m) => m.err > 0)
        ? "Pin planted. Where the wedges agree, that's you \u2014 set off when it looks honest."
        : "A pin with no bearings is a guess. Take a sight first.",
    );
    refreshPanel();
  }

  function setOff() {
    if (mode !== "fix" || !pin || !map.marks.some((m) => m.err > 0)) {
      if (mode === "fix") {
        sfx.deny();
        say("At least one bearing and a pin, or the moor keeps you.");
      }
      return;
    }
    const d = dist(pin.x, pin.y, map.gate.x, map.gate.y);
    if (d > 2) {
      homeBearing = Math.atan2(map.gate.y - pin.y, map.gate.x - pin.x);
      heading = homeBearing;
    }
    fixErrPending = dist(pin.x, pin.y, truePos.x, truePos.y);
    setMode("walk");
    sfx.setOff();
    say(
      "Steer for the gate. The needle points where your pin says home is \u2014 trust it as far as you trusted the pin.",
    );
    refreshPanel();
  }

  function legDone() {
    sun = Math.min(1, sun + TEA);
    fixErrors.push(fixErrPending);
    sfx.gate();
    if (legIdx >= LEGS.length - 1) {
      endRun(true);
      return;
    }
    betweenT = 1.9;
    setMode("between");
  }

  function scoreTotal() {
    let s = 0;
    for (const e of fixErrors) s += Math.max(60, Math.round(420 - e * 1.6));
    return s + Math.round(sun * 700);
  }

  function statRows() {
    const avg =
      fixErrors.length > 0
        ? Math.round(
            fixErrors.reduce((a, b) => a + b, 0) / fixErrors.length / 2,
          )
        : 0;
    const rows = [
      ["Gates reached", fixErrors.length + " of " + LEGS.length],
      ["Mean miss", avg + " paces"],
      ["Steadied sights", String(refsUsed)],
      ["Light left", Math.max(0, Math.round(sun * 100)) + "%"],
      ["Score", String(scoreTotal())],
    ];
    return (
      '<table class="stats">' +
      rows
        .map((r) => "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>")
        .join("") +
      "</table>"
    );
  }

  function endRun(win) {
    setMode("end");
    if (win) sfx.win();
    else sfx.night();
    showOverlay(
      win ? "Home before dark" : "Night takes the moor",
      win
        ? "<p>Five gates, five flasks of tea, and the last of the light still in the sky.</p>" +
            statRows()
        : "<p>The fog went grey, then blue, then black. The gate will still be there at dawn \u2014 somewhere.</p>" +
            statRows(),
      "Walk again",
      () => newRun(),
    );
  }

  function togglePause(force) {
    if (mode !== "fix" && mode !== "walk" && mode !== "between") return;
    paused = force !== undefined ? force : !paused;
    btnPause.setAttribute("aria-pressed", String(paused));
    btnPause.textContent = paused ? "\u25b6" : "\u23f8";
    if (paused) {
      showOverlay(
        "Paused",
        "<p>The moor waits. The light does not \u2014 but it will hold a moment for you.</p>",
        "Resume",
        () => togglePause(false),
      );
    } else {
      hideOverlay();
    }
  }

  /* ================================ input ================================ */

  const keys = new Set();
  const touches = new Map();

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    initAudio();
    const k = e.key;
    const playing =
      !paused && (mode === "fix" || mode === "walk" || mode === "between");
    if (
      playing &&
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        " ",
        "Enter",
      ].includes(k)
    ) {
      e.preventDefault();
    }
    if (k === "m" || k === "M") {
      setMuted(!muted);
      return;
    }
    if (k === "p" || k === "P") {
      togglePause();
      return;
    }
    if (k === "r" || k === "R") {
      if (mode !== "intro") newRun();
      return;
    }
    if (paused) {
      if (k === "Escape") togglePause(false);
      return;
    }
    if (mode === "fix") {
      if (k >= "1" && k <= "9") {
        selectMark(Number(k) - 1);
      } else if (k === "Enter" || k === " ") {
        const sel = selected >= 0 ? map.marks[selected] : null;
        if (sel && sel.err === 0) takeSight();
        else setOff();
      } else if (k === "f" || k === "F") {
        refineSight();
      } else if (k === "o" || k === "O") {
        setOff();
      } else if (k === "Escape") {
        selectMark(-1);
      } else if (k.startsWith("Arrow")) {
        if (!pin) placePin(W / 2, H / 2);
        const step = e.shiftKey ? 18 : 6;
        if (k === "ArrowLeft") pin.x -= step;
        if (k === "ArrowRight") pin.x += step;
        if (k === "ArrowUp") pin.y -= step;
        if (k === "ArrowDown") pin.y += step;
        pin.x = clamp(pin.x, 14, W - 14);
        pin.y = clamp(pin.y, 14, H - 14);
        refreshPanel();
      }
    } else if (mode === "walk") {
      if (k === "ArrowLeft" || k === "a" || k === "A") keys.add("L");
      if (k === "ArrowRight" || k === "d" || k === "D") keys.add("R");
    } else if (mode === "between") {
      if (k === "Enter" || k === " ") betweenT = 0;
    }
  });

  document.addEventListener("keyup", (e) => {
    const k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") keys.delete("L");
    if (k === "ArrowRight" || k === "d" || k === "D") keys.delete("R");
  });

  function canvasXY(e) {
    const r = cv.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * W) / r.width,
      y: ((e.clientY - r.top) * H) / r.height,
    };
  }

  cv.addEventListener("pointerdown", (e) => {
    initAudio();
    if (paused) return;
    const p = canvasXY(e);
    if (mode === "fix") {
      let hit = -1;
      map.marks.forEach((m, i) => {
        if (dist(p.x, p.y, m.x, m.y) < 26) hit = i;
      });
      if (hit >= 0) selectMark(hit);
      else placePin(p.x, p.y);
    } else if (mode === "walk") {
      touches.set(e.pointerId, p.x < W / 2 ? "L" : "R");
    } else if (mode === "between") {
      betweenT = 0;
    }
  });

  const clearTouch = (e) => touches.delete(e.pointerId);
  cv.addEventListener("pointerup", clearTouch);
  cv.addEventListener("pointercancel", clearTouch);
  cv.addEventListener("pointerleave", clearTouch);

  btnSight.addEventListener("click", () => {
    initAudio();
    takeSight();
  });
  btnRefine.addEventListener("click", () => {
    initAudio();
    refineSight();
  });
  btnOff.addEventListener("click", () => {
    initAudio();
    setOff();
  });
  btnSound.addEventListener("click", () => {
    initAudio();
    setMuted(!muted);
  });
  btnPause.addEventListener("click", () => togglePause());
  btnNew.addEventListener("click", () => {
    initAudio();
    newRun();
  });

  markList.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) {
      initAudio();
      selectMark(Number(li.dataset.i));
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (mode === "walk" || mode === "fix"))
      togglePause(true);
  });

  /* ================================ update =============================== */

  function inAnyBog(x, y) {
    for (const b of map.bogs) {
      const c = Math.cos(-b.rot);
      const s = Math.sin(-b.rot);
      const dx = x - b.x;
      const dy = y - b.y;
      const ux = dx * c - dy * s;
      const uy = dx * s + dy * c;
      if ((ux * ux) / (b.rx * b.rx) + (uy * uy) / (b.ry * b.ry) <= 1)
        return true;
    }
    return false;
  }

  function update(dt) {
    nowSec += dt;
    if (mode === "fix" || mode === "walk") {
      sun -= dt * SUN_PASSIVE * (inBog ? SUN_BOG : 1);
      if (sun <= 0) {
        sun = 0;
        endRun(false);
        return;
      }
    }

    if (mode === "between") {
      betweenT -= dt;
      if (betweenT <= 0) startLeg(legIdx + 1);
      return;
    }

    if (mode !== "walk") return;

    walkT += dt;
    bogSfxCd -= dt;

    // steering: keyboard + touch
    let steer = 0;
    if (keys.has("L")) steer -= 1;
    if (keys.has("R")) steer += 1;
    for (const side of touches.values()) steer += side === "L" ? -1 : 1;
    steer = clamp(steer, -1, 1);
    heading = wrapTau(heading + steer * TURN_SPD * dt);

    // wind gusts
    if (gust.active) {
      gust.t -= dt;
      if (gust.t <= 0) {
        gust.active = false;
        gust.timer = 3.5 + Math.random() * 4.5;
      }
    } else {
      gust.timer -= dt;
      if (gust.timer <= 0) {
        gust.active = true;
        gust.t = 1.2 + Math.random() * 1.4;
        gust.dir = Math.random() * TAU;
        gust.str = map.leg.wind * (0.7 + Math.random() * 0.6);
      }
    }

    inBog = inAnyBog(truePos.x, truePos.y);
    if (inBog && bogSfxCd <= 0) {
      sfx.bog();
      bogSfxCd = 1.4;
    }

    const spd = WALK_SPD * (inBog ? 0.42 : 1);
    let vx = Math.cos(heading) * spd;
    let vy = Math.sin(heading) * spd;
    if (gust.active) {
      vx += Math.cos(gust.dir) * gust.str * 0.55;
      vy += Math.sin(gust.dir) * gust.str * 0.55;
    }
    truePos.x = clamp(truePos.x + vx * dt, MARGIN, W - MARGIN);
    truePos.y = clamp(truePos.y + vy * dt, MARGIN, H - MARGIN);

    // wind audio swell
    if (windGain) {
      const target = muted
        ? 0
        : 0.035 + (gust.active ? gust.str / 420 : 0) + (inBog ? 0.02 : 0.02);
      windGain.gain.setTargetAtTime(target, ac.currentTime, 0.5);
    }

    if (dist(truePos.x, truePos.y, map.gate.x, map.gate.y) < GATE_R) legDone();
  }

  /* ================================ render =============================== */

  function drawPaper() {
    ctx.fillStyle = COL.paper;
    ctx.fillRect(0, 0, W, H);

    // faint km grid
    ctx.strokeStyle = "rgba(63,56,44,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 60; x < W; x += 60) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = 60; y < H; y += 60) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();

    // contours
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 1.2;
    for (const pts of map.contours) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }

    // heather stipple + rocks
    ctx.strokeStyle = COL.heather;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const s of map.stipples) {
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + Math.cos(s.a) * s.l, s.y + Math.sin(s.a) * s.l);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(63,56,44,0.35)";
    for (const r of map.rocks) {
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.fill();
    }
  }

  function drawBogs() {
    for (const b of map.bogs) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.fillStyle = COL.bogFill;
      ctx.strokeStyle = COL.bogLine;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.ellipse(0, 0, b.rx, b.ry, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(60,80,95,0.28)";
      for (let k = 1; k <= 2; k++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, b.rx * (k * 0.33), b.ry * (k * 0.33), 0, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawGate() {
    const g = map.gate;
    ctx.save();
    ctx.translate(g.x, g.y);
    // fence stubs either side
    ctx.strokeStyle = COL.inkSoft;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(-46, 4);
    ctx.lineTo(-12, 4);
    ctx.moveTo(12, 4);
    ctx.lineTo(46, 4);
    ctx.stroke();
    ctx.setLineDash([]);
    // stone posts + lintel
    ctx.fillStyle = "#cbbfa5";
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 2;
    ctx.fillRect(-10, -12, 6, 18);
    ctx.strokeRect(-10, -12, 6, 18);
    ctx.fillRect(4, -12, 6, 18);
    ctx.strokeRect(4, -12, 6, 18);
    ctx.fillStyle = COL.rust;
    ctx.fillRect(-13, -18, 26, 6);
    ctx.strokeRect(-13, -18, 26, 6);
    ctx.restore();
    label("THE GATE", g.x, g.y + 26, COL.rust);
  }

  function label(text, x, y, color, font) {
    const prev = ctx.textAlign;
    ctx.font = font || "11px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(239,231,212,0.85)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color || COL.ink;
    ctx.fillText(text, x, y);
    ctx.textAlign = prev;
  }

  function drawMarks() {
    map.marks.forEach((m, i) => {
      const sel = i === selected && mode === "fix";
      if (sel) {
        const pulse = 15 + Math.sin(nowSec * 5) * 3;
        ctx.strokeStyle = COL.rust;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(m.x, m.y, pulse, 0, TAU);
        ctx.stroke();
      }
      // trig station symbol
      ctx.fillStyle = COL.paperDeep;
      ctx.strokeStyle = COL.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - 8);
      ctx.lineTo(m.x - 7, m.y + 6);
      ctx.lineTo(m.x + 7, m.y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COL.ink;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 1.7, 0, TAU);
      ctx.fill();
      label(i + 1 + " " + m.name.toUpperCase(), m.x, m.y - 14);
    });
  }

  function drawWedges() {
    if (mode !== "fix") return;
    for (const m of map.marks) {
      if (!(m.err > 0)) continue;
      const ang = Math.atan2(truePos.y - m.y, truePos.x - m.x);
      const e = rad(m.err);
      const len = 1750;
      ctx.fillStyle = "rgba(168,75,42,0.13)";
      ctx.strokeStyle = "rgba(168,75,42,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.arc(m.x, m.y, len, ang - e, ang + e);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // tick the measured centre line lightly
      ctx.strokeStyle = "rgba(168,75,42,0.25)";
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x + Math.cos(ang) * len, m.y + Math.sin(ang) * len);
      ctx.stroke();
    }
  }

  function drawPin() {
    if (!pin) return;
    const ghost = mode === "walk";
    ctx.globalAlpha = ghost ? 0.5 : 1;
    ctx.strokeStyle = COL.rust;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(pin.x - 7, pin.y - 7);
    ctx.lineTo(pin.x + 7, pin.y + 7);
    ctx.moveTo(pin.x + 7, pin.y - 7);
    ctx.lineTo(pin.x - 7, pin.y + 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pin.x, pin.y, 11, 0, TAU);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (mode === "fix") {
      // planned course
      ctx.strokeStyle = "rgba(63,56,44,0.5)";
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(pin.x, pin.y);
      ctx.lineTo(map.gate.x, map.gate.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawWalker() {
    // lantern glow
    const g = ctx.createRadialGradient(
      truePos.x,
      truePos.y,
      2,
      truePos.x,
      truePos.y,
      26,
    );
    g.addColorStop(0, "rgba(255,196,100,0.55)");
    g.addColorStop(1, "rgba(255,196,100,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(truePos.x, truePos.y, 26, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = COL.ink;
    ctx.fillStyle = "#2e2a24";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(truePos.x, truePos.y, 4.2, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // facing tick
    ctx.beginPath();
    ctx.moveTo(truePos.x, truePos.y);
    ctx.lineTo(
      truePos.x + Math.cos(heading) * 13,
      truePos.y + Math.sin(heading) * 13,
    );
    ctx.stroke();
  }

  function drawFog() {
    const g = ctx.createRadialGradient(
      truePos.x,
      truePos.y,
      VIS * 0.45,
      truePos.x,
      truePos.y,
      VIS,
    );
    g.addColorStop(0, "rgba(230,230,224,0)");
    g.addColorStop(0.78, "rgba(230,230,224,0.88)");
    g.addColorStop(1, COL.fog);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawCompass() {
    const th = 46;
    const top = H - th;
    ctx.fillStyle = "rgba(239,231,212,0.94)";
    ctx.fillRect(0, top, W, th);
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(W, top);
    ctx.stroke();

    const cx = W / 2;
    const ppd = 2.6;
    const CARD = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    for (let d = 0; d < 360; d += 15) {
      const diff = wrap180(rad(d) - heading);
      const x = cx + diff * ppd;
      if (x < -20 || x > W + 20) continue;
      const major = d % 45 === 0;
      ctx.strokeStyle = major ? COL.ink : COL.inkSoft;
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + (major ? 12 : 7));
      ctx.stroke();
      if (major) {
        ctx.fillStyle = COL.ink;
        ctx.fillText(CARD[d / 45] + " " + d, x, top + 25);
      }
    }

    // believed home bearing (wobbles with the size of your fix error)
    const jit = Math.min(12, 1.5 + (fixErrPending || 0) * 0.05);
    const wob =
      Math.sin(nowSec * 6) * jit + Math.sin(nowSec * 12.7 + 2) * jit * 0.5;
    const homeDisp = homeBearing + rad(wob);
    const diff = wrap180(homeDisp - heading);
    let hx = cx + diff * ppd;
    const clipped = hx < 18 || hx > W - 18;
    hx = clamp(hx, 18, W - 18);
    const aligned = Math.abs(wrap180(homeBearing - heading)) < rad(4);
    ctx.fillStyle = aligned ? "#e8b64c" : COL.gold;
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, top + 4);
    ctx.lineTo(hx + 6, top + 11);
    ctx.lineTo(hx, top + 18);
    ctx.lineTo(hx - 6, top + 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (clipped) {
      ctx.fillStyle = COL.gold;
      if (diff > 0) {
        ctx.fillText("\u00bb", hx + 8, top + 41);
      } else {
        ctx.fillText("\u00ab", hx - 8, top + 41);
      }
    }

    // current heading caret
    ctx.fillStyle = COL.ink;
    ctx.beginPath();
    ctx.moveTo(cx, top - 1);
    ctx.lineTo(cx - 5, top - 9);
    ctx.lineTo(cx + 5, top - 9);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = "right";
    ctx.fillText(
      (
        "00" + Math.round(deg(heading) < 0 ? deg(heading) + 360 : deg(heading))
      ).slice(-3) + "\u00b0",
      W - 10,
      top + 25,
    );
    ctx.textAlign = "left";
    ctx.fillText(inBog ? "BOG \u2014 slow!" : "moor fog", 10, top + 25);
  }

  function drawSock() {
    if (mode !== "walk" || !(gust.active || gust.str > 0)) return;
    const fade = gust.active ? 1 : 0.35;
    const bx = 84;
    const by = 64;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = "rgba(239,231,212,0.8)";
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(10, 10, 148, 108);
    ctx.fill();
    ctx.stroke();
    label("WIND", bx - 10, 30, COL.ink);
    ctx.translate(bx, by);
    ctx.rotate(gust.dir);
    const L = 26 + (gust.str / 50) * 26;
    ctx.fillStyle = COL.rust;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(L, -9);
    ctx.lineTo(L, 9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawBanner() {
    if (mode !== "between") return;
    ctx.fillStyle = "rgba(63,56,44,0.72)";
    ctx.fillRect(0, H / 2 - 74, W, 132);
    ctx.textAlign = "center";
    ctx.fillStyle = COL.paper;
    ctx.font = '600 34px Georgia, "Times New Roman", serif';
    ctx.fillText("LEG " + (legIdx + 1) + " CLEAR", W / 2, H / 2 - 18);
    ctx.font = "italic 15px Georgia, serif";
    ctx.fillText(
      "Hot tea at the gate \u2014 six more minutes of light in the flask.",
      W / 2,
      H / 2 + 12,
    );
    ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillStyle = "rgba(239,231,212,0.7)";
    ctx.fillText("the fog closes again\u2026", W / 2, H / 2 + 40);
    ctx.textAlign = "left";
  }

  function render() {
    if (!map) return;
    drawPaper();
    drawBogs();
    drawWedges();
    drawGate();
    drawMarks();
    drawPin();
    if (mode === "walk") {
      drawWalker();
      drawFog();
      drawCompass();
      drawSock();
    }
    if (mode === "fix" && !pin && map.marks.every((m) => !(m.err > 0))) {
      ctx.textAlign = "center";
      ctx.fillStyle = COL.inkSoft;
      ctx.font = "italic 15px Georgia, serif";
      ctx.fillText(
        "You are somewhere on this sheet. The stones know where.",
        W / 2,
        44,
      );
      ctx.textAlign = "left";
    }
    drawBanner();
  }

  /* ================================= loop ================================ */

  let last = performance.now();
  function step(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!paused) update(dt);
    render();
    requestAnimationFrame(step);
  }

  /* ================================ intro ================================ */

  function intro() {
    map = genMap(0); // backdrop behind the card
    truePos = { x: genStart.x, y: genStart.y };
    setMode("intro");
    showOverlay(
      "Fogbound",
      "<p><strong>You are lost on the evening moor.</strong> The map is perfect; only your place on it is missing.</p>" +
        "<p><strong>Fix.</strong> Select a stone and <em>Sight</em> it \u2014 its bearing wedge cuts across the sheet. Two or three wedges cross where you stand. Plant your pin there, then <em>Set off</em>.</p>" +
        "<p><strong>Walk.</strong> Hold \u2190 / \u2192 to steer for the stone gate. Gusts shove your true course, bogs drink your pace and your daylight, and the compass is only as true as your pin.</p>" +
        "<hr class='rule'><p>Sights cost light; every gate pours a flask of tea back. Reach the fifth gate before sundown.</p>",
      "Begin the walk",
      () => newRun(),
    );
    requestAnimationFrame(step);
  }

  intro();
})();
