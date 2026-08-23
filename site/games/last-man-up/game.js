/**
 * The Last Man Up — twin pit cages, one shared cable, a flooding colliery.
 * You are the onsetter: wind the drum, work the landings, bring every man
 * up to the bank before the water finds their boots.
 * Vanilla canvas game; no dependencies, no network.
 */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  tiny helpers
   * ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  const TAU = Math.PI * 2;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t ^ (t >>> 14)) >>> 0;
      return t / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ *
   *  constants
   * ------------------------------------------------------------------ */

  const VW = 960;
  const VH = 640;

  const SHAFT_CX = 460;
  const LANE_L = 400;
  const LANE_R = 520;
  const GIRDER_L = 444;
  const GIRDER_R = 476;

  const TOP_Y = 132; // surface stop
  const BOT_Y = 598; // deepest stop
  const N_STOPS = 5;
  const STOPS = [];
  for (let i = 0; i < N_STOPS; i++) {
    STOPS.push(TOP_Y + ((BOT_Y - TOP_Y) * i) / (N_STOPS - 1));
  }

  const CAGE_CH = 56; // cage height above its floor
  const CAGE_HW = 33; // cage half width
  const CAP = 4; // men per cage
  const DOOR_T = 1.0; // seconds gates stand open
  const WHEEL_X = SHAFT_CX;
  const WHEEL_Y = 88;
  const WHEEL_R = 24;

  const ACCEL = 430;
  const BRAKE = 520;
  const V_MAX = 280;
  const LEVEL_V = 46; // max speed to catch a landing
  const LEVEL_D = 9; // max distance to catch a landing

  const ROMAN = ["BANK", "SEAM I", "SEAM II", "SEAM III", "SEAM IV"];

  const DAYS = [
    { miners: 8, engs: 0, span: 46, rate: 6.5, fuseMul: 1.18 },
    { miners: 11, engs: 1, span: 54, rate: 8.0, fuseMul: 1.05 },
    { miners: 14, engs: 2, span: 62, rate: 9.5, fuseMul: 0.95 },
    { miners: 17, engs: 2, span: 70, rate: 11.0, fuseMul: 0.85 },
    { miners: 20, engs: 3, span: 78, rate: 13.0, fuseMul: 0.75 },
  ];

  const SLOT_OFF = [
    [-15, -13],
    [15, -13],
    [-15, -31],
    [15, -31],
  ];

  /* ------------------------------------------------------------------ *
   *  canvas setup
   * ------------------------------------------------------------------ */

  const cvs = $("game");
  const ctx = cvs.getContext("2d");
  let viewScale = 1;

  function resize() {
    const rect = cvs.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.round(rect.width * dpr));
    const ph = Math.max(1, Math.round(rect.height * dpr));
    if (cvs.width !== pw || cvs.height !== ph) {
      cvs.width = pw;
      cvs.height = ph;
    }
    viewScale = pw / VW;
  }
  window.addEventListener("resize", resize);

  /* ------------------------------------------------------------------ *
   *  audio — everything synthesised, nothing fetched
   * ------------------------------------------------------------------ */

  let ac = null;
  let master = null;
  let windGain = null;
  let windOsc = null;
  let waterGain = null;
  let soundOn = true;

  function ensureAudio() {
    if (ac) {
      if (ac.state === "suspended") ac.resume();
      return;
    }
    if (!soundOn) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.5;
      master.connect(ac.destination);

      windOsc = ac.createOscillator();
      windOsc.type = "sawtooth";
      windOsc.frequency.value = 50;
      const windFil = ac.createBiquadFilter();
      windFil.type = "lowpass";
      windFil.frequency.value = 340;
      windGain = ac.createGain();
      windGain.gain.value = 0;
      windOsc.connect(windFil).connect(windGain).connect(master);
      windOsc.start();

      const len = ac.sampleRate;
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const noise = ac.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const nf = ac.createBiquadFilter();
      nf.type = "bandpass";
      nf.frequency.value = 520;
      waterGain = ac.createGain();
      waterGain.gain.value = 0;
      noise.connect(nf).connect(waterGain).connect(master);
      noise.start();
    } catch (err) {
      ac = null;
    }
  }

  function tone(type, f0, f1, dur, vol, when) {
    if (!ac || !soundOn) return;
    try {
      const t0 = ac.currentTime + (when || 0);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0)
        o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch (err) {
      /* audio is best-effort */
    }
  }

  function noiseHit(dur, vol, freq) {
    if (!ac || !soundOn) return;
    try {
      const n = Math.max(1, Math.ceil(ac.sampleRate * dur));
      const buf = ac.createBuffer(1, n, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ac.createBufferSource();
      src.buffer = buf;
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = freq;
      const g = ac.createGain();
      g.gain.value = vol;
      src.connect(f).connect(g).connect(master);
      src.start();
    } catch (err) {
      /* best-effort */
    }
  }

  const sfx = {
    click() {
      tone("square", 900, 700, 0.04, 0.05);
    },
    ding() {
      tone("sine", 1318, 1318, 0.55, 0.16);
      tone("sine", 2637, 2637, 0.18, 0.07);
    },
    thud() {
      tone("sine", 110, 48, 0.22, 0.3);
      noiseHit(0.12, 0.22, 260);
    },
    cheer() {
      tone("triangle", 620, 620, 0.09, 0.1);
      tone("triangle", 830, 830, 0.14, 0.1, 0.09);
    },
    ladder() {
      tone("triangle", 480, 480, 0.07, 0.07);
    },
    grumble() {
      tone("sawtooth", 210, 150, 0.18, 0.07);
    },
    klaxon() {
      tone("square", 392, 392, 0.16, 0.08);
      tone("square", 370, 370, 0.16, 0.08, 0.22);
    },
    clank() {
      tone("square", 523, 523, 0.1, 0.09);
      tone("square", 784, 784, 0.16, 0.08, 0.07);
      noiseHit(0.06, 0.1, 900);
    },
    buzzer() {
      tone("square", 233, 233, 0.3, 0.09);
      tone("square", 233, 233, 0.3, 0.09, 0.36);
    },
  };

  /* ------------------------------------------------------------------ *
   *  static background, prerendered once
   * ------------------------------------------------------------------ */

  const bg = document.createElement("canvas");
  bg.width = VW;
  bg.height = VH;

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function paintStatic() {
    const g = bg.getContext("2d");

    // dawn sliver above ground
    const sky = g.createLinearGradient(0, 0, 0, TOP_Y);
    sky.addColorStop(0, "#0c1126");
    sky.addColorStop(0.62, "#231a30");
    sky.addColorStop(1, "#59322c");
    g.fillStyle = sky;
    g.fillRect(0, 0, VW, TOP_Y);
    g.fillStyle = "rgba(255,196,92,0.14)";
    g.fillRect(0, TOP_Y - 10, VW, 10);

    // headframe silhouette against the sky
    g.strokeStyle = "#080a12";
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(WHEEL_X - 96, TOP_Y);
    g.lineTo(WHEEL_X - 8, WHEEL_Y);
    g.moveTo(WHEEL_X + 96, TOP_Y);
    g.lineTo(WHEEL_X + 8, WHEEL_Y);
    g.moveTo(WHEEL_X - 62, TOP_Y - 34);
    g.lineTo(WHEEL_X + 62, TOP_Y - 34);
    g.stroke();
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(WHEEL_X - 74, TOP_Y - 17);
    g.lineTo(WHEEL_X + 74, TOP_Y - 17);
    g.stroke();

    // winding house + pithead buildings
    g.fillStyle = "#0a0c14";
    g.fillRect(40, TOP_Y - 52, 150, 52);
    g.beginPath();
    g.moveTo(34, TOP_Y - 52);
    g.lineTo(115, TOP_Y - 78);
    g.lineTo(196, TOP_Y - 52);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255,196,92,0.75)";
    g.fillRect(66, TOP_Y - 40, 18, 14);
    g.fillRect(130, TOP_Y - 40, 18, 14);

    // underground rock
    const rock = g.createLinearGradient(0, TOP_Y, 0, VH);
    rock.addColorStop(0, "#161a26");
    rock.addColorStop(1, "#0d1019");
    g.fillStyle = rock;
    g.fillRect(0, TOP_Y, VW, VH - TOP_Y);

    // strata bands
    for (let i = 0; i < 9; i++) {
      const y = TOP_Y + 24 + i * 56;
      g.strokeStyle = i % 2 ? "rgba(255,255,255,0.028)" : "rgba(0,0,0,0.16)";
      g.lineWidth = 10;
      g.beginPath();
      for (let x = 0; x <= VW; x += 24) {
        const yy = y + Math.sin(x * 0.014 + i * 2.4) * 6;
        if (x === 0) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.stroke();
    }
    // speckle
    const rng = mulberry32(99);
    for (let i = 0; i < 1500; i++) {
      const x = rng() * VW;
      const y = TOP_Y + rng() * (VH - TOP_Y);
      g.fillStyle = rng() > 0.5 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.22)";
      g.fillRect(x, y, 2, 2);
    }

    // shaft cut
    g.fillStyle = "#0b0d15";
    g.fillRect(LANE_L - 48, TOP_Y, LANE_R + 48 - (LANE_L - 48), VH - TOP_Y);
    const edgeL = g.createLinearGradient(LANE_L - 48, 0, LANE_L - 20, 0);
    edgeL.addColorStop(0, "rgba(0,0,0,0.6)");
    edgeL.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = edgeL;
    g.fillRect(LANE_L - 48, TOP_Y, 28, VH - TOP_Y);
    const edgeR = g.createLinearGradient(LANE_R + 48, 0, LANE_R + 20, 0);
    edgeR.addColorStop(0, "rgba(0,0,0,0.6)");
    edgeR.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = edgeR;
    g.fillRect(LANE_R + 20, TOP_Y, 28, VH - TOP_Y);

    // timber guides along both lanes
    g.fillStyle = "#2c2118";
    g.fillRect(LANE_L - CAGE_HW - 6, TOP_Y, 5, VH - TOP_Y);
    g.fillRect(LANE_L + CAGE_HW + 1, TOP_Y, 5, VH - TOP_Y);
    g.fillRect(LANE_R - CAGE_HW - 6, TOP_Y, 5, VH - TOP_Y);
    g.fillRect(LANE_R + CAGE_HW + 1, TOP_Y, 5, VH - TOP_Y);

    // centre girder + ladders
    g.fillStyle = "#171c2a";
    g.fillRect(GIRDER_L, TOP_Y, GIRDER_R - GIRDER_L, VH - TOP_Y);
    g.strokeStyle = "#3d4356";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(SHAFT_CX - 7, TOP_Y + 6);
    g.lineTo(SHAFT_CX - 7, VH);
    g.moveTo(SHAFT_CX + 7, TOP_Y + 6);
    g.lineTo(SHAFT_CX + 7, VH);
    for (let y = TOP_Y + 14; y < VH; y += 15) {
      g.moveTo(SHAFT_CX - 7, y);
      g.lineTo(SHAFT_CX + 7, y);
    }
    g.stroke();

    // landings
    for (let i = 0; i < N_STOPS; i++) {
      const y = STOPS[i];
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? 176 : LANE_R + 48;
        const x1 = side < 0 ? LANE_L - 48 : 784;
        g.fillStyle = "#3a2c1e";
        g.fillRect(x0, y, x1 - x0, 9);
        g.fillStyle = "rgba(255,214,138,0.16)";
        g.fillRect(x0, y, x1 - x0, 2);
        g.strokeStyle = "#241a10";
        g.lineWidth = 3;
        g.beginPath();
        const px = side < 0 ? x1 - 40 : x0 + 40;
        g.moveTo(px, y + 9);
        g.lineTo(px + side * 26, y + 52);
        g.stroke();
        // lantern post
        const lx = side < 0 ? x0 + 14 : x1 - 14;
        g.fillStyle = "#241a10";
        g.fillRect(lx - 2, y - 26, 4, 26);
      }
      // landing lip across the shaft mouth
      g.fillStyle = "#241a10";
      g.fillRect(LANE_L - 48, y, 12, 9);
      g.fillRect(LANE_R + 36, y, 12, 9);

      // labels
      g.font = "600 11px Georgia, serif";
      g.fillStyle = "rgba(242,233,216,0.5)";
      g.textAlign = "left";
      g.fillText(ROMAN[i], 18, y + 2);
      g.textAlign = "right";
      g.fillText(i === 0 ? "bank" : i * 120 + " ft", 918, y + 2);
    }

    // depth gauge rail
    g.strokeStyle = "rgba(242,233,216,0.18)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(930, TOP_Y);
    g.lineTo(930, BOT_Y);
    for (let i = 0; i < N_STOPS; i++) {
      g.moveTo(924, STOPS[i]);
      g.lineTo(936, STOPS[i]);
    }
    g.stroke();

    // vignette
    const vig = g.createRadialGradient(
      VW / 2,
      VH / 2,
      VH * 0.42,
      VW / 2,
      VH / 2,
      VH * 0.95,
    );
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.5)");
    g.fillStyle = vig;
    g.fillRect(0, 0, VW, VH);
  }

  /* ------------------------------------------------------------------ *
   *  state
   * ------------------------------------------------------------------ */

  const G = {
    mode: "title", // title | play | paused | dayend | over | won
    day: 0,
    score: 0,
    best: 0,
    dayStartScore: 0,
    elapsed: 0,
    v: 0, // shared cable speed
    cageL: null,
    cageR: null,
    persons: [],
    queue: [],
    pumps: [false, false, false, false, false],
    curRate: 0,
    waterY: VH + 60,
    stats: null,
    warnT: 0,
    shakeT: 0,
    shakeAmp: 0,
    wheelAng: 0,
    tGlobal: 0,
    spawnedAll: false,
    ladderToastDone: false,
  };

  let pid = 1;

  function newCage(id, laneX) {
    return {
      id,
      laneX,
      y: id === "L" ? BOT_Y : TOP_Y, // floor y
      doorT: 0,
      cool: 0,
      lastOpenY: -999,
      floor: id === "L" ? 4 : 0,
      seats: [false, false, false, false],
    };
  }

  function makeSchedule(dayIdx) {
    const cfg = DAYS[dayIdx];
    const rng = mulberry32(1234 + dayIdx * 7919);
    const q = [];

    // two men are already on the landings when the buzzer goes
    q.push({ t: 0.02, kind: "miner", floor: 3 });
    q.push({ t: 0.05, kind: "miner", floor: 4 });

    for (let k = 0; k < cfg.miners - 2; k++) {
      const prog = (k + 1) / cfg.miners;
      const t = cfg.span * ((k + 1) / (cfg.miners - 1)) * (0.92 + rng() * 0.16);
      let fl;
      const r = rng();
      if (prog < 0.35) fl = r < 0.5 ? 2 : r < 0.85 ? 1 : 3;
      else if (prog < 0.7) fl = r < 0.4 ? 3 : r < 0.75 ? 4 : 2;
      else fl = r < 0.6 ? 4 : 3;
      q.push({ t: Math.max(0.5, t), kind: "miner", floor: fl });
    }

    const engSeams = [4, 3, 2];
    const engTimes = [0.1, 0.4, 0.7];
    for (let e = 0; e < cfg.engs; e++) {
      q.push({
        t: Math.max(1, cfg.span * engTimes[e]),
        kind: "eng",
        floor: 0,
        dest: engSeams[e],
      });
    }

    q.sort((a, b) => a.t - b.t);
    return q;
  }

  function spawnPerson(item) {
    const rng = Math.random;
    const cfg = DAYS[G.day];
    const p = {
      id: pid++,
      kind: item.kind,
      floor: item.floor,
      dest: item.kind === "eng" ? item.dest : 0,
      state: "wait",
      x: 0,
      y: STOPS[item.floor],
      face: 1,
      fuseMax:
        item.kind === "eng" ? 26 * cfg.fuseMul : (15 + rng() * 4) * cfg.fuseMul,
      fuse: 0,
      cage: null,
      slot: -1,
      tw: null,
      walkPhase: rng() * TAU,
      claimed: false,
      warnedLadder: false,
      leaveVia: "ladder",
      boardedOpen: false,
      done: false,
      via: null,
    };
    p.fuse = p.fuseMax;
    if (item.floor === 0) {
      p.x = item.kind === "eng" ? 250 + rng() * 60 : 230 + rng() * 100;
      p.face = 1;
    } else if (rng() > 0.5) {
      p.x = 210 + rng() * 110;
      p.face = 1;
    } else {
      p.x = 610 + rng() * 110;
      p.face = -1;
    }
    G.persons.push(p);
  }

  function resetDay(dayIdx) {
    G.day = dayIdx;
    G.elapsed = 0;
    G.v = 0;
    G.cageL = newCage("L", LANE_L);
    G.cageR = newCage("R", LANE_R);
    G.persons = [];
    G.queue = makeSchedule(dayIdx);
    G.pumps = [false, false, false, false, false];
    G.waterY = VH + 60;
    G.curRate = DAYS[dayIdx].rate;
    G.stats = {
      savedCage: 0,
      savedLadder: 0,
      posted: 0,
      comfortSum: 0,
      comfortN: 0,
      roster: DAYS[dayIdx].miners + DAYS[dayIdx].engs,
    };
    G.spawnedAll = false;
    G.warnT = 0;
    G.shakeT = 0;
    G.ladderToastDone = false;
    pid = 1;
    G.dayStartScore = G.score;
    hideOverlay();
    G.mode = "play";
    sfx.buzzer();
    syncChips(true);
  }

  /* ------------------------------------------------------------------ *
   *  overlay + HUD
   * ------------------------------------------------------------------ */

  const overlay = $("overlay");
  const ovTitle = $("ovTitle");
  const ovTagline = $("ovTagline");
  const ovBody = $("ovBody");
  const ovKeys = $("ovKeys");
  const btnGo = $("btnGo");
  let goAction = "start";
  let altBtn = null;

  const CONTROLS = [
    "<b>Hold ↑ / W</b> or drag up — wind: left cage rises, right sinks",
    "<b>Hold ↓ / S</b> — reverse the drum",
    "<b>Release</b> — brake; stop level with a seam to work the landing",
    "<b>⌂ men</b> ride up to the bank · <b>⚙ engineers</b> must reach their tagged seam",
    "<b>Ladders</b> — impatient men climb out alone for a pittance",
    "<b>P</b> pause · <b>R</b> retry day · <b>M</b> sound",
  ];

  function showOverlay(
    title,
    tagline,
    bodyHTML,
    keys,
    goLabel,
    action,
    altLabel,
    altAction,
  ) {
    ovTitle.textContent = title;
    ovTagline.textContent = tagline;
    ovBody.innerHTML = bodyHTML;
    ovKeys.innerHTML = "";
    if (keys && keys.length) {
      for (const k of keys) {
        const li = document.createElement("li");
        li.innerHTML = k;
        ovKeys.appendChild(li);
      }
      ovKeys.style.display = "";
    } else {
      ovKeys.style.display = "none";
    }
    btnGo.textContent = goLabel;
    goAction = action;
    if (!altBtn) {
      altBtn = document.createElement("button");
      altBtn.type = "button";
      altBtn.className = "go dim";
      altBtn.addEventListener("click", routeAlt);
      btnGo.insertAdjacentElement("beforebegin", altBtn);
    }
    if (altLabel) {
      altBtn.textContent = altLabel;
      altBtn.dataset.action = altAction || "";
      altBtn.style.display = "";
    } else {
      altBtn.style.display = "none";
    }
    overlay.classList.add("show");
  }

  function hideOverlay() {
    overlay.classList.remove("show");
  }

  function statLine(txt) {
    return '<span class="stat-line">' + txt + "</span>";
  }

  function showTitle() {
    G.mode = "title";
    showOverlay(
      "The Last Man Up",
      "One lever. Two cages. Everyone home.",
      "You are the onsetter at Marrowdale Colliery, and the river has found the old workings. " +
        "Both cages hang on <b>one cable over one drum</b> — raise the left and you lower the right. " +
        "Stop level with each seam to open the gates, bring every man up to the bank, and post the " +
        "pump engineers down to their seams before the water climbs past their boots.",
      CONTROLS,
      "Sound the buzzer ⏎",
      "start",
    );
  }

  function showDayEnd() {
    const st = G.stats;
    const bonus = Math.max(
      0,
      Math.round((DAYS[G.day].span * 1.35 - G.elapsed) * 8),
    );
    G.score += bonus;
    const comfort =
      st.comfortN > 0 ? Math.round((st.comfortSum / st.comfortN) * 100) : 100;
    const final = G.day === DAYS.length - 1;
    if (final) {
      saveBest();
      G.mode = "won";
      showOverlay(
        "Every man up",
        "The bank head counts heads by lantern light.",
        statLine(
          `Shift ${G.day + 1} clear · ${st.savedCage} by cage · ${st.savedLadder} by ladder · ${st.posted} pumps set`,
        ) +
          statLine(`Comfort ${comfort}% · time bonus +${bonus}`) +
          statLine(`Total score ${G.score} · best ${G.best}`) +
          "<br>Marrowdale stands. The lamps burn all night in the windows, and nobody is down the hole.",
        null,
        "Sink another shaft ⏎",
        "again",
      );
    } else {
      G.mode = "dayend";
      showOverlay(
        `Shift ${G.day + 1} survived`,
        "The water pauses. The men do not.",
        statLine(
          `Saved ${st.savedCage + st.savedLadder + st.posted}/${st.roster} · by cage ${st.savedCage} · by ladder ${st.savedLadder} · pumps ${st.posted}`,
        ) +
          statLine(`Comfort ${comfort}% · time bonus +${bonus}`) +
          statLine(`Score ${G.score}`) +
          "<br>The next shift goes below at once.",
        null,
        "Next shift ⏎",
        "nextday",
      );
    }
  }

  function showGameOver(reason, detail) {
    G.mode = "over";
    showOverlay(
      reason,
      "The cage stands silent.",
      detail +
        statLine(`Score ${G.dayStartScore} · reached shift ${G.day + 1}`),
      null,
      "Retry the day ⏎",
      "retry",
      "Back to the bank",
      "quit",
    );
  }

  function showPaused() {
    showOverlay(
      "Paused",
      "The drum is dogged.",
      "The water waits for no one — but it will wait for you.",
      null,
      "Resume ⏎",
      "resume",
    );
  }

  function routeGo() {
    ensureAudio();
    sfx.click();
    switch (goAction) {
      case "start":
        G.score = 0;
        resetDay(0);
        break;
      case "nextday":
        resetDay(G.day + 1);
        break;
      case "retry":
        G.score = G.dayStartScore;
        resetDay(G.day);
        break;
      case "again":
        G.score = 0;
        resetDay(0);
        break;
      case "quit":
        showTitle();
        break;
      case "resume":
        G.mode = "play";
        hideOverlay();
        break;
    }
  }

  function routeAlt() {
    ensureAudio();
    sfx.click();
    if (altBtn && altBtn.dataset.action === "quit") showTitle();
  }

  btnGo.addEventListener("click", routeGo);

  const chipDay = $("chipDay");
  const chipBelow = $("chipBelow");
  const chipSafe = $("chipSafe");
  const chipScore = $("chipScore");
  let chipCache = ["", "", "", ""];

  function syncChips(force) {
    const below = G.persons.filter((p) => !p.done).length;
    const safe = G.stats
      ? G.stats.savedCage + G.stats.savedLadder + G.stats.posted
      : 0;
    const roster = G.stats ? G.stats.roster : 0;
    const vals = [
      `Day ${G.day + 1}/${DAYS.length}`,
      `Below ${below}${roster ? " · " + safe + "/" + roster + " up" : ""}`,
      `Water ${Math.max(0, Math.round(((VH + 60 - G.waterY) / (VH + 60 - TOP_Y)) * 100))}%`,
      `${G.score} pts`,
    ];
    if (
      force ||
      vals[0] !== chipCache[0] ||
      vals[1] !== chipCache[1] ||
      vals[2] !== chipCache[2] ||
      vals[3] !== chipCache[3]
    ) {
      chipDay.textContent = vals[0];
      chipBelow.textContent = vals[1];
      chipSafe.textContent = vals[2];
      chipScore.textContent = vals[3];
      chipCache = vals.slice();
    }
  }

  const toastEl = $("toast");
  let toastTimer = 0;

  function toast(msg, toneName) {
    toastEl.textContent = msg;
    toastEl.className = "toast show" + (toneName ? " " + toneName : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  function saveBest() {
    try {
      const b = Number(localStorage.getItem("lastmanup_best") || "0");
      G.best = Math.max(b, G.score);
      localStorage.setItem("lastmanup_best", String(G.best));
    } catch (err) {
      G.best = Math.max(G.best, G.score);
    }
  }

  /* ------------------------------------------------------------------ *
   *  input
   * ------------------------------------------------------------------ */

  const keys = new Set();
  let ptrThrottle = 0;
  let padHold = 0;
  let debugThrottle = 0;

  function keyAxis() {
    let a = 0;
    if (keys.has("ArrowUp") || keys.has("KeyW")) a += 1;
    if (keys.has("ArrowDown") || keys.has("KeyS")) a -= 1;
    return a;
  }

  window.addEventListener("keydown", (e) => {
    const c = e.code;
    if (["ArrowUp", "ArrowDown", "Space"].includes(c) && G.mode === "play") {
      e.preventDefault();
    }
    ensureAudio();
    if (
      (c === "Enter" || c === "Space") &&
      overlay.classList.contains("show")
    ) {
      routeGo();
      return;
    }
    if (e.repeat) return;
    if (c === "ArrowUp" || c === "KeyW" || c === "ArrowDown" || c === "KeyS") {
      keys.add(c);
    } else if (c === "KeyP") {
      togglePause();
    } else if (c === "KeyM") {
      toggleSound();
    } else if (c === "KeyR" && G.mode === "play") {
      G.score = G.dayStartScore;
      resetDay(G.day);
      toast("Day restarted", "");
    }
  });

  window.addEventListener("keyup", (e) => keys.delete(e.code));

  // drag anywhere on the pit to wind
  let dragId = null;
  let dragY0 = 0;
  const frame = $("frame");

  frame.addEventListener("pointerdown", (e) => {
    ensureAudio();
    if (e.target.closest("button") || overlay.classList.contains("show"))
      return;
    dragId = e.pointerId;
    dragY0 = e.clientY;
    try {
      frame.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ok */
    }
  });

  frame.addEventListener("pointermove", (e) => {
    if (e.pointerId !== dragId) return;
    ptrThrottle = clamp((dragY0 - e.clientY) / 90, -1, 1);
  });

  function endDrag(e) {
    if (e.pointerId === dragId) {
      dragId = null;
      ptrThrottle = 0;
    }
  }
  frame.addEventListener("pointerup", endDrag);
  frame.addEventListener("pointercancel", endDrag);

  const padUp = $("padUp");
  const padDown = $("padDown");

  function bindPad(el, dir) {
    const on = (e) => {
      e.preventDefault();
      ensureAudio();
      el.classList.add("hot");
      padHold = dir;
    };
    const off = () => {
      el.classList.remove("hot");
      if (padHold === dir) padHold = 0;
    };
    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointercancel", off);
    el.addEventListener("pointerleave", off);
  }
  bindPad(padUp, 1);
  bindPad(padDown, -1);

  const btnSound = $("btnSound");
  const btnPause = $("btnPause");

  function toggleSound() {
    soundOn = !soundOn;
    btnSound.textContent = soundOn ? "🔊" : "🔇";
    if (master) master.gain.value = soundOn ? 0.5 : 0;
    if (soundOn) ensureAudio();
  }

  function togglePause() {
    if (G.mode === "play") {
      G.mode = "paused";
      showPaused();
    } else if (G.mode === "paused") {
      G.mode = "play";
      hideOverlay();
    }
  }

  btnSound.addEventListener("click", () => {
    ensureAudio();
    toggleSound();
  });
  btnPause.addEventListener("click", () => {
    sfx.click();
    togglePause();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && G.mode === "play") togglePause();
  });

  /* ------------------------------------------------------------------ *
   *  simulation
   * ------------------------------------------------------------------ */

  function throttleInput() {
    return clamp(keyAxis() + padHold + ptrThrottle + debugThrottle, -1, 1);
  }

  function nearestStop(y) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < N_STOPS; i++) {
      const d = Math.abs(y - STOPS[i]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi;
  }

  function openDoor(c) {
    const idx = nearestStop(c.y);
    c.y = STOPS[idx];
    c.floor = idx;
    c.doorT = DOOR_T;
    c.lastOpenY = c.y;
    sfx.ding();

    // alight first
    let delay = 0;
    for (const p of G.persons) {
      if (p.state === "ride" && p.cage === c.id && p.dest === idx) {
        p.state = "out";
        p.boardedOpen = false;
        const sx = c.laneX + SLOT_OFF[p.slot][0];
        const sy = c.y + SLOT_OFF[p.slot][1];
        p.cage = null;
        c.seats[p.slot] = false;
        p.slot = -1;
        p.floor = idx;
        const ex = c.laneX < SHAFT_CX ? c.laneX - 62 : c.laneX + 62;
        p.tw = { fx: sx, fy: sy, tx: ex, ty: STOPS[idx], t: -delay, dur: 0.32 };
        delay += 0.08;
      }
    }

    tryBoard(c);
  }

  // boarding runs the whole time the gates stand open, so men who walk up
  // mid-stop still catch the cage
  function tryBoard(c) {
    const cand = G.persons
      .filter((p) => p.state === "wait" && p.floor === c.floor && !p.claimed)
      .sort((a, b) => Math.abs(a.x - c.laneX) - Math.abs(b.x - c.laneX));
    let seat = 0;
    let delay = 0.06;
    for (const p of cand) {
      while (seat < CAP && c.seats[seat]) seat++;
      if (seat >= CAP) break;
      c.seats[seat] = true;
      p.claimed = true;
      p.cage = c.id;
      p.slot = seat;
      p.boardedOpen = true;
      p.state = "in";
      p.tw = { fx: p.x, fy: p.y, tx: 0, ty: 0, t: -delay, dur: 0.3 };
      delay += 0.08;
      seat++;
    }
  }

  function closeDoor(c) {
    c.doorT = 0;
    c.cool = 0.5;
    let grumbled = false;
    for (const p of G.persons) {
      if (
        p.state === "ride" &&
        p.cage === c.id &&
        p.boardedOpen &&
        p.dest !== c.floor
      ) {
        p.fuse = Math.max(0, p.fuse - p.fuseMax * 0.06);
        grumbled = true;
      }
      p.boardedOpen = false;
    }
    if (grumbled) sfx.grumble();
  }

  function installPump(floorIdx) {
    G.pumps[floorIdx] = true;
    const active = G.pumps.filter(Boolean).length;
    G.curRate = DAYS[G.day].rate * Math.pow(0.55, active);
    G.stats.posted++;
    G.score += 250;
    sfx.clank();
    toast(`Clank on at ${ROMAN[floorIdx]} — flood slowed`, "good");
  }

  function resolveSafe(p, via) {
    p.done = true;
    p.state = "safe";
    p.via = via;
    if (via === "ladder") {
      G.stats.savedLadder++;
      G.score += 25;
      sfx.ladder();
    } else if (via === "posted") {
      /* points already awarded by installPump; just mark the engineer safe */
    } else {
      G.stats.savedCage++;
      const frac = clamp(p.fuse / p.fuseMax, 0, 1);
      G.stats.comfortSum += frac;
      G.stats.comfortN += 1;
      G.score += Math.round(100 * (0.75 + 0.5 * frac));
      sfx.cheer();
    }
    sparkAt(p.x, p.y);
  }

  function stepPerson(p, dt) {
    switch (p.state) {
      case "wait": {
        p.fuse -= dt;
        if (p.fuse <= 0) {
          p.state = "walkIn";
          if (!G.ladderToastDone) {
            G.ladderToastDone = true;
            toast("Men are taking the ladders!", "bad");
          }
        }
        break;
      }
      case "walkIn": {
        const dx = SHAFT_CX - p.x;
        const sp = 52;
        if (Math.abs(dx) <= sp * dt) {
          p.x = SHAFT_CX;
          p.state = "climb";
        } else {
          p.x += Math.sign(dx) * sp * dt;
          p.face = Math.sign(dx);
          p.walkPhase += dt * 9;
        }
        break;
      }
      case "climb": {
        p.y -= 24 * dt;
        p.walkPhase += dt * 7;
        if (p.y <= STOPS[0]) {
          p.y = STOPS[0];
          p.state = "leave";
          p.leaveVia = "ladder";
          p.face = p.x < VW / 2 ? -1 : 1;
        }
        break;
      }
      case "leave": {
        p.x += p.face * 60 * dt;
        p.walkPhase += dt * 9;
        if (p.x < 40 || p.x > VW - 40) {
          resolveSafe(p, p.leaveVia);
        }
        break;
      }
      case "in": {
        p.tw.t += dt;
        if (p.tw.t >= p.tw.dur) {
          p.state = "ride";
          p.tw = null;
        }
        break;
      }
      case "out": {
        p.tw.t += dt;
        if (p.tw.t >= p.tw.dur) {
          p.x = p.tw.tx;
          p.y = p.tw.ty;
          p.tw = null;
          if (p.floor === 0) {
            p.state = "leave";
            p.leaveVia = "cage";
            p.face = p.x < VW / 2 ? -1 : 1;
          } else if (p.kind === "eng" && p.dest === p.floor) {
            p.state = "postedWalk";
          } else {
            // stepped out at the wrong seam; back onto the landing
            p.state = "wait";
            p.claimed = false;
            p.face = p.x < SHAFT_CX ? 1 : -1;
            if (p.kind === "miner") {
              toast("Wrong seam — back they go", "bad");
            }
          }
        }
        break;
      }
      case "postedWalk": {
        const dx = 700 - p.x;
        if (Math.abs(dx) <= 56 * dt) {
          p.x = 700;
          installPump(p.floor);
          resolveSafe(p, "posted");
        } else {
          p.x += Math.sign(dx) * 56 * dt;
          p.face = Math.sign(dx);
          p.walkPhase += dt * 9;
        }
        break;
      }
      case "ride": {
        const c = p.cage === "L" ? G.cageL : G.cageR;
        p.x = c.laneX + SLOT_OFF[p.slot][0];
        p.y = c.y + SLOT_OFF[p.slot][1];
        break;
      }
      default:
        break;
    }
  }

  function personWorldPos(p) {
    if ((p.state === "in" || p.state === "out") && p.tw) {
      const t = clamp(p.tw.t / p.tw.dur, 0, 1);
      const k = easeOut(t);
      let txv = p.tw.tx;
      let tyv = p.tw.ty;
      if (p.state === "in") {
        const c = p.cage === "L" ? G.cageL : G.cageR;
        txv = c.laneX + SLOT_OFF[p.slot][0];
        tyv = c.y + SLOT_OFF[p.slot][1];
      }
      return [lerp(p.tw.fx, txv, k), lerp(p.tw.fy, tyv, k)];
    }
    return [p.x, p.y];
  }

  function stepSim(dt) {
    G.elapsed += dt;
    G.tGlobal += dt;

    // spawn queue
    while (G.queue.length && G.elapsed >= G.queue[0].t) {
      spawnPerson(G.queue.shift());
    }
    if (!G.queue.length) G.spawnedAll = true;

    // drum physics (positive v = left cage descends, right cage rises)
    const locked = G.cageL.doorT > 0 || G.cageR.doorT > 0;
    const thr = locked ? 0 : throttleInput();
    if (thr !== 0) {
      G.v -= thr * ACCEL * dt;
    } else {
      const dv = BRAKE * dt;
      if (Math.abs(G.v) <= dv) G.v = 0;
      else G.v -= Math.sign(G.v) * dv;
    }
    G.v = clamp(G.v, -V_MAX, V_MAX);

    G.cageL.y += G.v * dt;
    G.cageR.y -= G.v * dt;
    G.wheelAng += (G.v * dt) / WHEEL_R;

    // ends of travel
    for (const c of [G.cageL, G.cageR]) {
      if (c.y < TOP_Y) {
        c.y = TOP_Y;
        if (Math.abs(G.v) > 90) jolt();
        G.v = 0;
      } else if (c.y > BOT_Y) {
        c.y = BOT_Y;
        if (Math.abs(G.v) > 90) jolt();
        G.v = 0;
      }
    }

    // landings & gates
    for (const c of [G.cageL, G.cageR]) {
      if (c.doorT > 0) {
        c.doorT -= dt;
        tryBoard(c);
        if (c.doorT <= 0) closeDoor(c);
      } else {
        if (c.cool > 0) c.cool -= dt;
        const idx = nearestStop(c.y);
        const d = Math.abs(c.y - STOPS[idx]);
        if (
          c.cool <= 0 &&
          d < LEVEL_D &&
          Math.abs(G.v) < LEVEL_V &&
          Math.abs(c.y - c.lastOpenY) > 10
        ) {
          openDoor(c);
          G.v = 0;
        }
      }
    }

    // people
    for (const p of G.persons) {
      if (!p.done) stepPerson(p, dt);
    }

    // water
    G.waterY -= G.curRate * dt;
    if (waterGain) {
      const risen = clamp((VH + 60 - G.waterY) / (VH + 60 - TOP_Y), 0, 1);
      waterGain.gain.value = risen * 0.11;
    }
    if (windGain && windOsc) {
      windOsc.frequency.value = 46 + Math.abs(G.v) * 0.55;
      windGain.gain.value = (Math.abs(G.v) / V_MAX) * 0.07;
    }

    // drowning checks
    let lost = 0;
    for (const p of G.persons) {
      if (p.done) continue;
      const py = personWorldPos(p)[1];
      if (py >= G.waterY - 2) lost++;
    }
    for (const c of [G.cageL, G.cageR]) {
      const riders = G.persons.filter(
        (p) => !p.done && p.state === "ride" && p.cage === c.id,
      );
      if (riders.length && c.y >= G.waterY - 2) lost += riders.length;
    }
    if (lost > 0) {
      sfx.thud();
      showGameOver(
        "The water takes the pit",
        `The flood reached ${lost} ${lost > 1 ? "men" : "man"} still below. ` +
          "The banksman lowers the signal and the colliery bell tolls for Marrowdale.<br>",
      );
      return;
    }

    // klaxon warning
    let lowest = Infinity;
    for (const p of G.persons) {
      if (!p.done) lowest = Math.min(lowest, personWorldPos(p)[1]);
    }
    const danger = lowest < Infinity && G.waterY - lowest < 60;
    if (danger) {
      G.warnT += dt;
      if (G.warnT > 1.4) {
        G.warnT = 0;
        sfx.klaxon();
        toast("Water near the lowest men!", "bad");
      }
    } else {
      G.warnT = 0;
    }

    if (G.shakeT > 0) G.shakeT -= dt;

    stepFx(dt);

    // day complete?
    if (G.spawnedAll && G.persons.length && G.persons.every((p) => p.done)) {
      showDayEnd();
      return;
    }
    syncChips(false);
  }

  function jolt() {
    G.shakeT = 0.28;
    G.shakeAmp = 7;
    sfx.thud();
    for (const p of G.persons) {
      if (p.state === "ride") p.fuse = Math.max(0, p.fuse - p.fuseMax * 0.05);
    }
  }

  /* ------------------------------------------------------------------ *
   *  effects
   * ------------------------------------------------------------------ */

  const sparks = [];
  const motes = [];
  const drips = [];
  const ripples = [];
  const moteRng = mulberry32(7);

  for (let i = 0; i < 42; i++) {
    motes.push({
      x: moteRng() * VW,
      y: TOP_Y + moteRng() * (VH - TOP_Y),
      vx: (moteRng() - 0.5) * 6,
      vy: -4 - moteRng() * 6,
      a: 0.05 + moteRng() * 0.12,
      s: moteRng() * 1.6 + 0.6,
    });
  }

  function sparkAt(x, y) {
    for (let i = 0; i < 10; i++) {
      sparks.push({
        x,
        y: y - 10,
        vx: (Math.random() - 0.5) * 90,
        vy: -40 - Math.random() * 70,
        t: 0.5 + Math.random() * 0.3,
        c: Math.random() > 0.4 ? "#ffd98a" : "#8fd97a",
      });
    }
  }

  function stepFx(dt) {
    for (const m of motes) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.y < TOP_Y + 6) {
        m.y = VH - 6;
        m.x = Math.random() * VW;
      }
      if (m.x < -4) m.x = VW + 4;
      if (m.x > VW + 4) m.x = -4;
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.t -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 160 * dt;
      if (s.t <= 0) sparks.splice(i, 1);
    }
    if (G.mode === "play" && G.waterY < VH + 20 && Math.random() < dt * 2.2) {
      drips.push({
        x: LANE_L - 44 + Math.random() * (LANE_R - LANE_L + 88),
        y: TOP_Y + 4,
        v: 120,
      });
    }
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i];
      d.y += d.v * dt;
      d.v += 300 * dt;
      if (d.y >= G.waterY) {
        ripples.push({ x: d.x, y: G.waterY, t: 0.5 });
        drips.splice(i, 1);
      }
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].t -= dt;
      if (ripples[i].t <= 0) ripples.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------------ *
   *  drawing
   * ------------------------------------------------------------------ */

  function drawMan(g, x, y, opt) {
    // feet at (x, y)
    const s = opt.scale || 1;
    g.save();
    g.translate(x, y);
    g.scale(s * (opt.flip ? -1 : 1), s);
    g.globalAlpha = opt.alpha == null ? 1 : opt.alpha;

    let legA = 0;
    let bob = 0;
    if (opt.walk) {
      legA = Math.sin(opt.phase || 0) * 0.5;
      bob = Math.abs(Math.cos(opt.phase || 0)) * 1.2;
    }
    g.translate(0, -bob);

    // legs
    g.strokeStyle = "#1c2434";
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(-2, -8);
    g.lineTo(-2 - legA * 4, 0);
    g.moveTo(2, -8);
    g.lineTo(2 + legA * 4, 0);
    g.stroke();

    // torso
    g.fillStyle = opt.suit || "#2b3a52";
    rr(g, -4.5, -19, 9, 12, 3);
    g.fill();

    // arm
    g.strokeStyle = opt.suit || "#2b3a52";
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(-3, -16);
    g.lineTo(opt.armUp ? -7 : -5, opt.armUp ? -24 : -10);
    g.stroke();

    // head + helmet
    g.fillStyle = "#caa27e";
    g.beginPath();
    g.arc(0.5, -22.5, 3.6, 0, TAU);
    g.fill();
    g.fillStyle = opt.helmet || "#ffb238";
    g.beginPath();
    g.arc(0.5, -23.5, 4.1, Math.PI, 0);
    g.closePath();
    g.fill();
    g.fillRect(-3.8, -23.8, 8.6, 1.6);

    // lamp
    if (opt.lamp) {
      g.fillStyle = "#fff3c4";
      g.beginPath();
      g.arc(4.6, -23, 1.5, 0, TAU);
      g.fill();
    }
    g.restore();

    // lamp glow (unscaled, soft)
    if (opt.lamp && opt.glow) {
      const gl = g.createRadialGradient(x, y - 22 * s, 1, x, y - 22 * s, 26);
      gl.addColorStop(0, "rgba(255,233,170,0.22)");
      gl.addColorStop(1, "rgba(255,233,170,0)");
      g.fillStyle = gl;
      g.fillRect(x - 26, y - 48, 52, 52);
    }
  }

  function drawBadge(g, x, y, p) {
    const label =
      p.kind === "eng" ? "⚙ S" + p.dest : p.dest === 0 ? "⌂" : "S" + p.dest;
    g.font = "700 9px system-ui, sans-serif";
    const w = g.measureText(label).width + 10;
    const bx = x - w / 2;
    const by = y - 40;
    g.fillStyle = "rgba(10,13,22,0.88)";
    g.strokeStyle =
      p.kind === "eng" ? "rgba(143,217,122,0.8)" : "rgba(255,196,92,0.7)";
    g.lineWidth = 1;
    rr(g, bx, by, w, 13, 6);
    g.fill();
    g.stroke();
    g.fillStyle = p.kind === "eng" ? "#a9e394" : "#ffd98a";
    g.textAlign = "center";
    g.fillText(label, x, by + 10);
  }

  function drawFuse(g, x, y, p) {
    const frac = clamp(p.fuse / p.fuseMax, 0, 1);
    const w = 24;
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(x - w / 2, y + 4, w, 3.5);
    g.fillStyle = frac > 0.5 ? "#8fd97a" : frac > 0.22 ? "#ffc45c" : "#ff5a4e";
    g.fillRect(x - w / 2, y + 4, w * frac, 3.5);
  }

  function drawCage(g, c) {
    const x = c.laneX;
    const fy = c.y;
    const open = c.doorT > 0 ? clamp(c.doorT / DOOR_T, 0, 1) : 0;

    // cable to the wheel
    g.strokeStyle = "#494f63";
    g.lineWidth = 2;
    g.beginPath();
    const gx = c.id === "L" ? WHEEL_X - 9 : WHEEL_X + 9;
    g.moveTo(x, fy - CAGE_CH - 6);
    g.lineTo(gx, WHEEL_Y);
    g.stroke();

    // back wall
    g.fillStyle = "rgba(8,10,16,0.9)";
    g.fillRect(x - CAGE_HW + 3, fy - CAGE_CH + 4, CAGE_HW * 2 - 6, CAGE_CH - 4);

    // frame
    g.strokeStyle = "#7d8598";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x - CAGE_HW, fy - CAGE_CH);
    g.lineTo(x - CAGE_HW, fy);
    g.lineTo(x + CAGE_HW, fy);
    g.lineTo(x + CAGE_HW, fy - CAGE_CH);
    g.moveTo(x - CAGE_HW, fy - CAGE_CH);
    g.lineTo(x + CAGE_HW, fy - CAGE_CH);
    g.stroke();
    g.lineWidth = 1.4;
    g.strokeStyle = "rgba(125,133,152,0.55)";
    g.beginPath();
    for (let bx = x - CAGE_HW + 8; bx < x + CAGE_HW - 4; bx += 9) {
      g.moveTo(bx, fy - CAGE_CH + 3);
      g.lineTo(bx, fy - 1);
    }
    g.stroke();

    // wood skids
    g.fillStyle = "#5a3d28";
    g.fillRect(x - CAGE_HW - 2, fy - 3, CAGE_HW * 2 + 4, 5);

    // gate panels sliding apart
    const gw = CAGE_HW - 3;
    g.fillStyle = "#8b93a7";
    g.fillRect(x - gw - gw * open, fy - CAGE_CH + 4, gw, CAGE_CH - 6);
    g.fillRect(x + gw * open, fy - CAGE_CH + 4, gw, CAGE_CH - 6);
    g.strokeStyle = "rgba(20,24,36,0.7)";
    g.lineWidth = 1;
    g.strokeRect(x - gw - gw * open, fy - CAGE_CH + 4, gw, CAGE_CH - 6);
    g.strokeRect(x + gw * open, fy - CAGE_CH + 4, gw, CAGE_CH - 6);

    // signal lamp when gates open
    if (open > 0) {
      const gl = g.createRadialGradient(x, fy - 6, 2, x, fy - 6, 40);
      gl.addColorStop(0, "rgba(255,214,138,0.3)");
      gl.addColorStop(1, "rgba(255,214,138,0)");
      g.fillStyle = gl;
      g.fillRect(x - 40, fy - 46, 80, 52);
    }
  }

  function drawWheel(g) {
    g.save();
    g.translate(WHEEL_X, WHEEL_Y);
    g.strokeStyle = "#20242f";
    g.lineWidth = 5;
    g.beginPath();
    g.arc(0, 0, WHEEL_R, 0, TAU);
    g.stroke();
    g.save();
    g.rotate(G.wheelAng);
    g.strokeStyle = "#39404f";
    g.lineWidth = 2.4;
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      g.moveTo(-WHEEL_R + 3, 0);
      g.lineTo(WHEEL_R - 3, 0);
      g.stroke();
    }
    g.restore();
    g.fillStyle = "#ffb238";
    g.beginPath();
    g.arc(0, 0, 3.4, 0, TAU);
    g.fill();
    g.restore();
  }

  function drawPumps(g) {
    for (let i = 1; i < N_STOPS; i++) {
      if (!G.pumps[i]) continue;
      const y = STOPS[i];
      const x = 700;
      g.fillStyle = "#3f4a37";
      rr(g, x - 16, y - 22, 32, 22, 3);
      g.fill();
      g.strokeStyle = "#232a1e";
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = "#8fd97a";
      g.beginPath();
      g.arc(x, y - 28, 3.4 + Math.sin(G.tGlobal * 9) * 0.8, 0, TAU);
      g.fill();
      g.strokeStyle = "rgba(53,201,187,0.5)";
      g.lineWidth = 1.6;
      g.beginPath();
      const jet = 14 + Math.sin(G.tGlobal * 21 + i) * 5;
      g.moveTo(x + 16, y - 14);
      g.quadraticCurveTo(x + 16 + jet, y - 26, x + 16 + jet, y - 34);
      g.stroke();
    }
  }

  function drawWater(g) {
    if (G.waterY > VH + 40) return;
    const t = G.tGlobal;
    g.save();
    g.beginPath();
    g.moveTo(0, VH);
    g.lineTo(0, G.waterY);
    for (let x = 0; x <= VW; x += 16) {
      const y =
        G.waterY +
        Math.sin(x * 0.03 + t * 2.6) * 2.4 +
        Math.sin(x * 0.011 - t * 1.7) * 1.8;
      g.lineTo(x, y);
    }
    g.lineTo(VW, VH);
    g.closePath();
    const grad = g.createLinearGradient(0, G.waterY, 0, VH);
    grad.addColorStop(0, "rgba(53,201,187,0.4)");
    grad.addColorStop(1, "rgba(15,84,94,0.72)");
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = "rgba(180,255,245,0.55)";
    g.lineWidth = 1.6;
    g.beginPath();
    for (let x = 0; x <= VW; x += 16) {
      const y =
        G.waterY +
        Math.sin(x * 0.03 + t * 2.6) * 2.4 +
        Math.sin(x * 0.011 - t * 1.7) * 1.8;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    for (const r of ripples) {
      g.strokeStyle = `rgba(180,255,245,${r.t * 1.2})`;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(r.x, r.y, (0.5 - r.t) * 26 + 2, 0, TAU);
      g.stroke();
    }
    g.restore();
  }

  function drawGauge(g) {
    let lowest = Infinity;
    for (const p of G.persons) {
      if (!p.done) lowest = Math.min(lowest, personWorldPos(p)[1]);
    }
    if (G.waterY < VH + 40) {
      const wy = clamp(G.waterY, TOP_Y, BOT_Y);
      g.fillStyle = "#35c9bb";
      g.beginPath();
      g.moveTo(944, wy - 5);
      g.lineTo(952, wy);
      g.lineTo(944, wy + 5);
      g.closePath();
      g.fill();
    }
    if (lowest < Infinity) {
      const ly = clamp(lowest, TOP_Y, BOT_Y);
      g.fillStyle = "#ffc45c";
      g.beginPath();
      g.arc(938, ly, 2.6, 0, TAU);
      g.fill();
    }
  }

  function drawScene() {
    ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
    ctx.clearRect(0, 0, VW, VH);

    ctx.save();
    if (G.shakeT > 0) {
      const a = G.shakeAmp * (G.shakeT / 0.28);
      ctx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    }
    ctx.drawImage(bg, 0, 0);

    // lantern glows per landing
    for (let i = 0; i < N_STOPS; i++) {
      const y = STOPS[i];
      const fl =
        0.8 + Math.sin(G.tGlobal * 11 + i * 2.1) * 0.12 + Math.random() * 0.06;
      for (const lx of [190, 770]) {
        const gl = ctx.createRadialGradient(lx, y - 30, 2, lx, y - 30, 64 * fl);
        gl.addColorStop(0, "rgba(255,205,120,0.26)");
        gl.addColorStop(1, "rgba(255,205,120,0)");
        ctx.fillStyle = gl;
        ctx.fillRect(lx - 64, y - 94, 128, 128);
        ctx.fillStyle = "rgba(255,220,150,0.9)";
        ctx.fillRect(lx - 3, y - 32, 6, 7);
      }
    }

    drawPumps(ctx);
    drawWheel(ctx);

    // motes
    for (const m of motes) {
      ctx.fillStyle = `rgba(255,235,190,${m.a})`;
      ctx.fillRect(m.x, m.y, m.s, m.s);
    }

    // people not in cages
    for (const p of G.persons) {
      if (p.done || p.state === "ride") continue;
      const pos = personWorldPos(p);
      const opts = {
        scale: 1,
        flip: p.face < 0,
        walk:
          p.state === "walkIn" ||
          p.state === "leave" ||
          p.state === "postedWalk" ||
          p.state === "climb",
        phase: p.walkPhase,
        suit: p.kind === "eng" ? "#57683a" : "#2b3a52",
        helmet: p.kind === "eng" ? "#e8e4da" : "#ffb238",
        lamp: true,
        glow: true,
      };
      if (p.state === "climb") opts.armUp = Math.sin(p.walkPhase) > 0;
      drawMan(ctx, pos[0], pos[1], opts);
      if (p.state === "wait") {
        drawBadge(ctx, pos[0], pos[1], p);
        drawFuse(ctx, pos[0], pos[1], p);
      }
    }

    // cages with riders
    for (const c of [G.cageL, G.cageR]) {
      drawCage(ctx, c);
      for (const p of G.persons) {
        if (p.done || p.state !== "ride" || p.cage !== c.id) continue;
        drawMan(ctx, p.x, p.y, {
          scale: 0.82,
          suit: p.kind === "eng" ? "#57683a" : "#2b3a52",
          helmet: p.kind === "eng" ? "#e8e4da" : "#ffb238",
          lamp: true,
        });
      }
      if (c.doorT > 0) {
        ctx.font = "600 10px system-ui, sans-serif";
        ctx.fillStyle = "rgba(242,233,216,0.85)";
        ctx.textAlign = "center";
        ctx.fillText(ROMAN[c.floor], c.laneX, c.y - CAGE_CH - 10);
      }
    }

    // boarding / alighting men on top
    for (const p of G.persons) {
      if (p.done || (p.state !== "in" && p.state !== "out")) continue;
      const pos = personWorldPos(p);
      drawMan(ctx, pos[0], pos[1], {
        scale: 0.9,
        walk: true,
        phase: p.tw ? p.tw.t * 20 : 0,
        suit: p.kind === "eng" ? "#57683a" : "#2b3a52",
        helmet: p.kind === "eng" ? "#e8e4da" : "#ffb238",
        lamp: true,
      });
    }

    drawWater(ctx);

    // drips above water
    for (const d of drips) {
      ctx.fillStyle = "rgba(150,230,225,0.7)";
      ctx.fillRect(d.x, d.y, 1.6, 5);
    }

    // sparks
    for (const s of sparks) {
      ctx.globalAlpha = clamp(s.t * 2, 0, 1);
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x, s.y, 2.4, 2.4);
      ctx.globalAlpha = 1;
    }

    drawGauge(ctx);

    // danger vignette
    if (G.mode === "play" && G.warnT > 0) {
      const a = 0.12 + Math.sin(G.tGlobal * 8) * 0.06;
      const vg = ctx.createRadialGradient(
        VW / 2,
        VH / 2,
        VH * 0.36,
        VW / 2,
        VH / 2,
        VH * 0.85,
      );
      vg.addColorStop(0, "rgba(255,60,40,0)");
      vg.addColorStop(1, `rgba(255,60,40,${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, VW, VH);
    }

    ctx.restore();

    if (G.mode === "title") {
      ctx.fillStyle = "rgba(6,8,14,0.35)";
      ctx.fillRect(0, 0, VW, VH);
    }
  }

  /* ------------------------------------------------------------------ *
   *  main loop
   * ------------------------------------------------------------------ */

  let last = performance.now();

  function frameTick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    resize();
    if (G.mode === "play") {
      stepSim(dt);
    } else {
      G.tGlobal += dt;
      stepFx(dt);
      // fade the machine loops while menus are up
      if (windGain) windGain.gain.value *= 0.9;
      if (waterGain) waterGain.gain.value *= 0.9;
    }
    drawScene();
    requestAnimationFrame(frameTick);
  }

  /* ------------------------------------------------------------------ *
   *  debug handle (kept deliberately tiny)
   * ------------------------------------------------------------------ */

  window.__pit = {
    info() {
      return {
        mode: G.mode,
        day: G.day,
        score: G.score,
        waterY: Math.round(G.waterY),
        below: G.persons.filter((p) => !p.done).length,
        states: G.persons.map((p) => p.state),
        cageL: Math.round(G.cageL.y),
        cageR: Math.round(G.cageR.y),
        stats: G.stats,
      };
    },

    win() {
      for (const p of G.persons) if (!p.done) resolveSafe(p, "ladder");
      G.queue.length = 0;
      G.spawnedAll = true;
    },
    flood() {
      // raise the water to just under the bank so anyone still below is lost
      G.waterY = TOP_Y + 40;
    },
    throttle(v) {
      debugThrottle = clamp(Number(v) || 0, -1, 1);
    },
  };

  /* ------------------------------------------------------------------ *
   *  boot
   * ------------------------------------------------------------------ */

  paintStatic();
  resize();
  G.cageL = newCage("L", LANE_L);
  G.cageR = newCage("R", LANE_R);
  G.stats = {
    savedCage: 0,
    savedLadder: 0,
    posted: 0,
    comfortSum: 0,
    comfortN: 0,
    roster: 0,
  };
  showTitle();
  requestAnimationFrame(frameTick);
})();
