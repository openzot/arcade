/* Firebreak - hold the line against a wind-driven wildfire.
   Cut bare-soil firebreaks, set risky backburns, read the shifting wind,
   and keep every cabin standing through five night shifts. */
(() => {
  "use strict";

  /* ---------------- dom ---------------- */

  const $ = (id) => document.getElementById(id);
  const canvas = $("board");
  const ctx = canvas.getContext("2d");
  const elShiftNum = $("shift-num");
  const elShiftName = $("shift-name");
  const elEffort = $("effort-fill");
  const elHomes = $("homes");
  const elToast = $("toast");
  const elOverlay = $("overlay");
  const elOvTitle = $("ov-title");
  const elOvLede = $("ov-lede");
  const elOvList = $("ov-list");
  const elOvKeys = $("ov-keys");
  const elBtnStart = $("btn-start");
  const elStHomes = $("st-homes");
  const elStGreen = $("st-green");

  /* ---------------- constants ---------------- */

  const COLS = 26;
  const ROWS = 16;
  const CELL = 36;

  const T_DIRT = 0;
  const T_GRASS = 1;
  const T_SCRUB = 2;
  const T_TREE = 3;
  const T_ROCK = 4;
  const T_WATER = 5;
  const T_HOUSE = 6;

  const FUEL = [0, 0.62, 0.85, 1.0, 0, 0, 0.9];
  const CUT_COST = [0, 5, 6, 8, 0, 0, 0];
  const TORCH_COST = 9;

  const S_INTACT = 0;
  const S_BURN = 1;
  const S_BURNT = 2;

  const SHIFTS = [
    {
      name: "First Smoke",
      tick: 540,
      spread: 0.33,
      embers: 0,
      effort: 100,
      refill: 13,
      windDeg: 155,
      wander: 0.01,
      lede: "A stray ember has caught on the north ridge. Gentle wind, honest country. Learn your crew.",
    },
    {
      name: "Rising Wind",
      tick: 480,
      spread: 0.36,
      embers: 0,
      effort: 98,
      refill: 13,
      windDeg: 140,
      wander: 0.022,
      lede: "The breeze has found its lungs. The front will move quicker tonight.",
    },
    {
      name: "Crosscurrent",
      tick: 450,
      spread: 0.38,
      embers: 0.22,
      effort: 96,
      refill: 14,
      windDeg: 120,
      wander: 0.04,
      lede: "The wind is arguing with itself. Hot crowns now throw embers over thin lines.",
    },
    {
      name: "Black Gully",
      tick: 420,
      spread: 0.4,
      embers: 0.32,
      effort: 94,
      refill: 14,
      windDeg: 165,
      wander: 0.048,
      lede: "A gully cuts the range, and the creek runs low. The fire loves a funnel.",
    },
    {
      name: "The Old North Wind",
      tick: 390,
      spread: 0.42,
      embers: 0.42,
      effort: 92,
      refill: 15,
      windDeg: 135,
      wander: 0.062,
      lede: "Last shift before the rain. The old north wind blows hard and lies often.",
    },
  ];

  /* ---------------- state ---------------- */

  let shiftIdx = 0;
  let phase = "intro"; // intro | brief | playing | paused | won | lost | victory
  let totalScore = 0;
  let bestScore = 0;

  let type = new Uint8Array(COLS * ROWS);
  let state = new Uint8Array(COLS * ROWS);
  let burnLeft = new Float32Array(COLS * ROWS);
  let shade = new Float32Array(COLS * ROWS);

  let homes = []; // { c, r, alive }
  let effort = 100;
  let effortMax = 100;
  let refill = 9;
  let windAngle = 0;
  let windVel = 0;
  let windSpeed = 1;
  let tickAcc = 0;
  let simTime = 0;
  let startFlammable = 1;
  let pendingLose = 0;
  let winGrace = 0;

  let tool = "break";
  let cursor = { c: 12, r: 8, active: false };
  let keysDown = new Set();
  let curRepeatMove = 0;
  let curRepeatApply = 0;

  let dragging = false;
  let lastDragCell = null;

  let flames = [];
  let smokes = [];
  let chips = [];
  let embers = [];
  let streakSeed = Math.random() * 1000;

  let toastTimer = 0;
  const toastGate = {};
  let sfxLastCut = 0;

  /* ---------------- helpers ---------------- */

  const idx = (c, r) => r * COLS + c;
  const inGrid = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const irnd = (a, b) => Math.floor(rnd(a, b + 1));

  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  function showToast(msg, ms) {
    elToast.textContent = msg;
    elToast.classList.add("show");
    toastTimer = (ms || 1700) / 1000;
  }

  function toastOnce(key, msg, gateMs) {
    const now = performance.now();
    if (!toastGate[key] || now - toastGate[key] > gateMs) {
      toastGate[key] = now;
      showToast(msg);
    }
  }

  /* ---------------- audio ---------------- */

  const audio = (() => {
    let acx = null;
    let master = null;
    let muted = false;
    let noiseBuf = null;
    let gCrackle = null;
    let gWind = null;

    function ensure() {
      if (acx) return true;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        acx = new AC();
        master = acx.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(acx.destination);
        const len = acx.sampleRate;
        noiseBuf = acx.createBuffer(1, len, acx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        // fire crackle: looping noise through a bandpass
        const cr = acx.createBufferSource();
        cr.buffer = noiseBuf;
        cr.loop = true;
        const bp = acx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 850;
        bp.Q.value = 0.7;
        gCrackle = acx.createGain();
        gCrackle.gain.value = 0;
        cr.connect(bp).connect(gCrackle).connect(master);
        cr.start();
        // wind bed: looping noise, lowpassed
        const wd = acx.createBufferSource();
        wd.buffer = noiseBuf;
        wd.loop = true;
        wd.playbackRate.value = 0.5;
        const lp = acx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 260;
        gWind = acx.createGain();
        gWind.gain.value = 0;
        wd.connect(lp).connect(gWind).connect(master);
        wd.start();
        return true;
      } catch (err) {
        return false;
      }
    }

    function burst(dur, freq, q, vol, kind) {
      if (!ensure()) return;
      const src = acx.createBufferSource();
      src.buffer = noiseBuf;
      src.playbackRate.value = rnd(0.8, 1.25);
      const f = acx.createBiquadFilter();
      f.type = kind || "bandpass";
      f.frequency.value = freq;
      f.Q.value = q;
      const g = acx.createGain();
      const t = acx.currentTime;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(master);
      src.start(t);
      src.stop(t + dur + 0.02);
    }

    function tone(freq, dur, vol, wave, slideTo) {
      if (!ensure()) return;
      const o = acx.createOscillator();
      o.type = wave || "sine";
      const g = acx.createGain();
      const t = acx.currentTime;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    return {
      unlock() {
        if (ensure() && acx.state === "suspended") acx.resume();
      },
      setMuted(m) {
        muted = m;
        if (master) master.gain.value = m ? 0 : 0.5;
      },
      ambience(intensity, windAmt) {
        if (!acx) return;
        const t = acx.currentTime;
        gCrackle.gain.setTargetAtTime(
          Math.min(0.16, intensity * 0.012),
          t,
          0.25,
        );
        gWind.gain.setTargetAtTime(0.03 + windAmt * 0.05, t, 0.6);
      },
      cut() {
        burst(0.07, 2100, 1.1, 0.16, "highpass");
      },
      fell() {
        burst(0.16, 320, 1.4, 0.2);
        tone(150, 0.14, 0.1, "triangle", 70);
      },
      torch() {
        burst(0.4, 650, 0.9, 0.24);
      },
      fizzle() {
        burst(0.12, 2600, 2.2, 0.05, "highpass");
      },
      alarm() {
        tone(392, 0.16, 0.16, "square");
        setTimeout(() => tone(311, 0.16, 0.16, "square"), 190);
        setTimeout(() => tone(392, 0.16, 0.16, "square"), 380);
      },
      win() {
        tone(523, 0.22, 0.14);
        setTimeout(() => tone(659, 0.22, 0.14), 140);
        setTimeout(() => tone(784, 0.34, 0.16), 280);
      },
      lose() {
        tone(196, 1.1, 0.18, "sawtooth", 82);
        burst(0.7, 140, 0.8, 0.22, "lowpass");
      },
      dawn() {
        [392, 494, 587, 784].forEach((f, i) =>
          setTimeout(() => tone(f, 0.4, 0.13), i * 170),
        );
      },
    };
  })();

  /* ---------------- map generation ---------------- */

  function generateMap() {
    type.fill(T_GRASS);
    state.fill(S_INTACT);
    burnLeft.fill(0);

    for (let i = 0; i < COLS * ROWS; i++) shade[i] = Math.random();

    const blobs = irnd(7, 10);
    for (let b = 0; b < blobs; b++) {
      const bc = rnd(1, COLS - 1);
      const br = rnd(0, ROWS - 1);
      const rad = rnd(1.6, 3.4);
      const kind = Math.random() < 0.55 ? T_SCRUB : T_TREE;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const d = Math.hypot(c - bc, (r - br) * 1.25);
          if (d < rad && Math.random() < 0.82) type[idx(c, r)] = kind;
        }
    }
    // rocky spine(s)
    const spines = shiftIdx >= 3 ? 2 : 1;
    for (let s = 0; s < spines; s++) {
      let c = irnd(3, COLS - 4);
      let r = 0;
      while (r < ROWS) {
        for (let w = -1; w <= irnd(0, 1); w++)
          if (inGrid(c + w, r)) type[idx(c + w, r)] = T_ROCK;
        r++;
        c += irnd(-1, 1);
        c = Math.max(2, Math.min(COLS - 3, c));
      }
    }
    // a creek from shift 4 on
    if (shiftIdx >= 3) {
      let c = irnd(4, COLS - 5);
      for (let r = 0; r < ROWS; r++) {
        for (let w = 0; w <= 1; w++)
          if (inGrid(c + w, r) && type[idx(c + w, r)] !== T_HOUSE)
            type[idx(c + w, r)] = T_WATER;
        c += irnd(-1, 1);
        c = Math.max(2, Math.min(COLS - 3, c));
      }
    }
    // clear the homestead flat
    const flatC = 9 + irnd(0, 4);
    for (let r = ROWS - 6; r < ROWS; r++)
      for (let c = flatC - 4; c < flatC + 6; c++)
        if (inGrid(c, r) && type[idx(c, r)] === T_TREE)
          type[idx(c, r)] = T_GRASS;

    // cabins
    homes = [];
    const slots = [flatC - 3, flatC, flatC + 3];
    for (const hc of slots) {
      const hr = ROWS - 3 - irnd(0, 1);
      const c = Math.max(1, Math.min(COLS - 2, hc + irnd(-1, 1)));
      homes.push({ c, r: hr, alive: true });
      type[idx(c, hr)] = T_HOUSE;
      // bare yard around each cabin
      for (const off of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const cc = c + off[0];
        const rr = hr + off[1];
        if (
          inGrid(cc, rr) &&
          type[idx(cc, rr)] !== T_HOUSE &&
          type[idx(cc, rr)] !== T_WATER &&
          Math.random() < 0.7
        )
          type[idx(cc, rr)] = T_DIRT;
      }
    }

    // ignition cluster on the far ridge, roughly upwind of the valley;
    // seeds prefer the heaviest fuel so the fire reliably takes hold
    const L = SHIFTS[shiftIdx];
    const fc = Math.round(
      COLS / 2 - Math.cos((L.windDeg * Math.PI) / 180) * 9 + rnd(-3, 3),
    );
    const fr = irnd(0, 2);
    let lit = 0;
    outer: for (let rad = 0; rad <= 3 && lit < 4; rad++) {
      for (let dr = 0; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          const c = fc + dc;
          const r = fr + dr;
          if (!inGrid(c, r)) continue;
          const i = idx(c, r);
          if (state[i] === S_INTACT && FUEL[type[i]] >= 0.85) {
            igniteCell(c, r, true);
            lit++;
            if (lit >= 4) break outer;
          }
        }
      }
    }
    // fallback: whatever green cells exist near the target
    if (lit === 0) {
      for (let dr = 0; dr < 4 && lit === 0; dr++)
        for (let dc = -4; dc <= 4 && lit === 0; dc++) {
          const c = fc + dc;
          const r = fr + dr;
          if (inGrid(c, r) && FUEL[type[idx(c, r)]] > 0) {
            igniteCell(c, r, true);
            lit++;
          }
        }
    }

    startFlammable = 0;
    for (let i = 0; i < COLS * ROWS; i++)
      if (FUEL[type[i]] > 0 && state[i] !== S_BURNT) startFlammable++;
  }

  /* ---------------- simulation ---------------- */

  function igniteCell(c, r, natural) {
    const i = idx(c, r);
    if (state[i] !== S_INTACT || FUEL[type[i]] <= 0) return false;
    state[i] = S_BURN;
    burnLeft[i] = 4 + Math.random() * 4 + FUEL[type[i]] * 3;
    if (type[i] === T_HOUSE) {
      const h = homes.find((hh) => hh.c === c && hh.r === r);
      if (h && h.alive) {
        h.alive = false;
        renderHomes();
        audio.alarm();
        showToast("A cabin is alight - nothing left to save it!");
        pendingLose = 1.6;
      }
    } else if (!natural) {
      audio.torch();
    }
    for (let k = 0; k < 5; k++) spawnFlame(c, r, true);
    return true;
  }

  function countBurning() {
    let n = 0;
    for (let i = 0; i < COLS * ROWS; i++) if (state[i] === S_BURN) n++;
    return n;
  }

  function countIntactFlammable() {
    let n = 0;
    for (let i = 0; i < COLS * ROWS; i++)
      if (state[i] === S_INTACT && FUEL[type[i]] > 0) n++;
    return n;
  }

  function simTick() {
    const L = SHIFTS[shiftIdx];
    const wx = Math.cos(windAngle);
    const wy = Math.sin(windAngle);
    const spreadP = L.spread * (0.8 + windSpeed * 0.25);

    const births = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = idx(c, r);
        if (state[i] !== S_BURN) continue;
        burnLeft[i] -= 1;
        if (burnLeft[i] <= 0) {
          state[i] = S_BURNT;
          continue;
        }
        for (let d = 0; d < 8; d++) {
          const dx = DIRS[d][0];
          const dy = DIRS[d][1];
          const nc = c + dx;
          const nr = r + dy;
          if (!inGrid(nc, nr)) continue;
          const ni = idx(nc, nr);
          if (state[ni] !== S_INTACT || FUEL[type[ni]] <= 0) continue;
          const len = Math.hypot(dx, dy);
          // align: 1 straight downwind, negative upwind
          const align = (dx / len) * wx + (dy / len) * wy;
          let p =
            spreadP *
            FUEL[type[i]] *
            (Math.pow(Math.max(align, 0), 1.5) * 0.85 + 0.1);
          if (len > 1.5) p *= 0.62;
          if (Math.random() < p) births.push(ni);
        }
      }
    }
    for (const ni of births) igniteCell(ni % COLS, Math.floor(ni / COLS), true);

    // ember throws over thin lines
    if (L.embers > 0 && Math.random() < L.embers) {
      const burning = [];
      for (let i = 0; i < COLS * ROWS; i++)
        if (state[i] === S_BURN && FUEL[type[i]] >= 0.8) burning.push(i);
      if (burning.length) {
        const i = burning[irnd(0, burning.length - 1)];
        const c = i % COLS;
        const r = Math.floor(i / COLS);
        embers.push({
          x: c * CELL + CELL / 2,
          y: r * CELL + CELL / 2,
          vx: wx * rnd(130, 210),
          vy: wy * rnd(130, 210),
          life: rnd(0.55, 0.95),
          trail: [],
        });
      }
    }

    audio.ambience(countBurning(), windSpeed);
  }

  function stepSim(dt) {
    const L = SHIFTS[shiftIdx];
    // meandering wind: smooth random walk around the prevailing bearing
    windVel += (Math.random() - 0.5) * L.wander * dt * 14;
    windVel *= 0.985;
    windAngle += windVel * dt;
    windSpeed =
      1 + Math.sin(simTime * 0.9) * 0.14 + Math.sin(simTime * 2.3) * 0.08;

    effort = Math.min(effortMax, effort + refill * dt);

    tickAcc += dt * 1000;
    while (tickAcc >= L.tick) {
      tickAcc -= L.tick;
      simTick();
    }

    // embers fly and land
    for (let k = embers.length - 1; k >= 0; k--) {
      const e = embers[k];
      e.life -= dt;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.vx += Math.cos(windAngle) * 40 * dt;
      e.vy += Math.sin(windAngle) * 40 * dt;
      e.trail.push({ x: e.x, y: e.y });
      if (e.trail.length > 7) e.trail.shift();
      if (e.life <= 0) {
        const c = Math.floor(e.x / CELL);
        const r = Math.floor(e.y / CELL);
        if (inGrid(c, r)) {
          const i = idx(c, r);
          if (state[i] === S_INTACT && FUEL[type[i]] > 0)
            igniteCell(c, r, true);
          else audio.fizzle();
        }
        embers.splice(k, 1);
      }
    }

    if (pendingLose > 0) {
      pendingLose -= dt;
      if (pendingLose <= 0) endShift(false);
    } else if (winGrace > 0) {
      winGrace -= dt;
      if (winGrace <= 0) endShift(true);
    } else if (countBurning() === 0 && embers.length === 0) {
      winGrace = 0.8;
    }
  }

  /* ---------------- tools ---------------- */

  function applyTool(c, r) {
    if (phase !== "playing" || !inGrid(c, r)) return;
    const i = idx(c, r);
    if (tool === "break") {
      const cost = CUT_COST[type[i]];
      if (cost <= 0 || state[i] !== S_INTACT) return;
      if (effort < cost) {
        toastOnce(
          "breath",
          "The crew needs breath - let the meter refill.",
          1400,
        );
        return;
      }
      effort -= cost;
      const wasTree = type[i] === T_TREE;
      type[i] = T_DIRT;
      spawnChips(c, r);
      const now = performance.now();
      if (now - sfxLastCut > 70) {
        sfxLastCut = now;
        if (wasTree) audio.fell();
        else audio.cut();
      }
    } else {
      if (state[i] !== S_INTACT || FUEL[type[i]] <= 0) return;
      if (effort < TORCH_COST) {
        toastOnce("torch", "Not enough effort to swing the torch.", 1400);
        return;
      }
      effort -= TORCH_COST;
      igniteCell(c, r, false);
    }
  }

  function paintLine(c0, r0, c1, r1) {
    const steps = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
    if (steps === 0) {
      applyTool(c1, r1);
      return;
    }
    for (let s = 1; s <= steps; s++) {
      applyTool(
        Math.round(c0 + ((c1 - c0) * s) / steps),
        Math.round(r0 + ((r1 - r0) * s) / steps),
      );
    }
  }

  function eventCell(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      c: Math.floor(((ev.clientX - rect.left) / rect.width) * COLS),
      r: Math.floor(((ev.clientY - rect.top) / rect.height) * ROWS),
    };
  }

  /* ---------------- particles ---------------- */

  function spawnFlame(c, r, big) {
    if (flames.length > 260) return;
    flames.push({
      x: c * CELL + rnd(6, CELL - 6),
      y: r * CELL + rnd(6, CELL - 6),
      vx: Math.cos(windAngle) * rnd(4, 16),
      vy: Math.sin(windAngle) * rnd(4, 16) - rnd(14, 30),
      life: rnd(0.3, 0.7),
      age: 0,
      big: !!big,
    });
  }

  function spawnSmoke(c, r) {
    if (smokes.length > 90) return;
    smokes.push({
      x: c * CELL + CELL / 2 + rnd(-8, 8),
      y: r * CELL + CELL / 2 + rnd(-8, 8),
      vx: Math.cos(windAngle) * rnd(10, 26),
      vy: Math.sin(windAngle) * rnd(10, 26) - rnd(4, 12),
      life: rnd(1.6, 2.8),
      age: 0,
      rad: rnd(7, 14),
    });
  }

  function spawnChips(c, r) {
    for (let k = 0; k < 5; k++)
      chips.push({
        x: c * CELL + CELL / 2 + rnd(-10, 10),
        y: r * CELL + CELL / 2 + rnd(-10, 10),
        vx: rnd(-40, 40),
        vy: rnd(-70, -20),
        life: rnd(0.25, 0.5),
        age: 0,
      });
  }

  function burningCells() {
    const out = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (state[idx(c, r)] === S_BURN) out.push([c, r]);
    return out;
  }

  function stepParticles(dt, live) {
    const cells = burningCells();
    if (live && cells.length) {
      const pick = cells[irnd(0, cells.length - 1)];
      if (Math.random() < Math.min(0.9, cells.length * 0.35))
        spawnSmoke(pick[0], pick[1]);
      for (const cell of cells)
        if (Math.random() < 0.5) spawnFlame(cell[0], cell[1], false);
    }

    for (let k = flames.length - 1; k >= 0; k--) {
      const f = flames[k];
      f.age += dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy -= 26 * dt;
      if (f.age >= f.life) flames.splice(k, 1);
    }
    for (let k = smokes.length - 1; k >= 0; k--) {
      const s = smokes[k];
      s.age += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.age >= s.life) smokes.splice(k, 1);
    }
    for (let k = chips.length - 1; k >= 0; k--) {
      const ch = chips[k];
      ch.age += dt;
      ch.x += ch.vx * dt;
      ch.y += ch.vy * dt;
      ch.vy += 340 * dt;
      if (ch.age >= ch.life) chips.splice(k, 1);
    }
  }

  /* ---------------- rendering ---------------- */

  function cellColor(t, sh, burnt) {
    if (burnt) {
      const v = Math.round(34 + sh * 22);
      return "rgb(" + v + "," + (v - 4) + "," + (v - 8) + ")";
    }
    switch (t) {
      case T_DIRT: {
        const v = Math.round(108 + sh * 26);
        return "rgb(" + v + "," + (v - 26) + "," + (v - 52) + ")";
      }
      case T_GRASS: {
        const v = Math.round(sh * 26);
        return "rgb(" + (62 + v) + "," + (108 + v) + "," + (52 + v) + ")";
      }
      case T_SCRUB: {
        const v = Math.round(sh * 22);
        return "rgb(" + (72 + v) + "," + (96 + v) + "," + (44 + v) + ")";
      }
      case T_TREE: {
        const v = Math.round(sh * 20);
        return "rgb(" + (32 + v) + "," + (72 + v) + "," + (40 + v) + ")";
      }
      case T_ROCK: {
        const v = Math.round(96 + sh * 30);
        return "rgb(" + v + "," + (v - 4) + "," + (v - 10) + ")";
      }
      case T_WATER:
        return "rgb(52,84,110)";
      default:
        return "#333333";
    }
  }

  let vignette = null;

  function drawHouse(c, r, alive, t) {
    const x = c * CELL;
    const y = r * CELL;
    ctx.fillStyle = "#4a3826";
    ctx.fillRect(x + 6, y + 16, CELL - 12, 15);
    ctx.fillStyle = alive ? "#7c3a2a" : "#3a2c22";
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 17);
    ctx.lineTo(x + CELL / 2, y + 5);
    ctx.lineTo(x + CELL - 3, y + 17);
    ctx.closePath();
    ctx.fill();
    if (alive) {
      const glow = 0.6 + Math.sin(t * 2 + c) * 0.25;
      ctx.fillStyle = "rgba(255,205,110," + glow.toFixed(2) + ")";
      ctx.fillRect(x + 14, y + 21, 8, 7);
    } else {
      ctx.fillStyle = "rgba(255,110,40,0.7)";
      ctx.fillRect(x + 14, y + 21, 8, 7);
    }
  }

  function draw(t) {
    // terrain
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = idx(c, r);
        const burnt = state[i] === S_BURNT && FUEL[type[i]] > 0;
        ctx.fillStyle = cellColor(type[i], shade[i], burnt);
        ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
        if (type[i] === T_TREE && !burnt) {
          ctx.fillStyle = "rgba(20,44,24,0.8)";
          ctx.beginPath();
          ctx.arc(
            c * CELL + 10 + shade[i] * 14,
            r * CELL + 12 + shade[i] * 10,
            7 + shade[i] * 4,
            0,
            7,
          );
          ctx.fill();
        } else if (type[i] === T_ROCK) {
          ctx.fillStyle = "rgba(60,58,54,0.7)";
          ctx.beginPath();
          ctx.arc(
            c * CELL + 12 + shade[i] * 12,
            r * CELL + 14 + shade[i] * 8,
            6,
            0,
            7,
          );
          ctx.fill();
        } else if (type[i] === T_WATER) {
          const ph = Math.sin(t * 1.6 + c * 0.9 + r * 1.7);
          ctx.fillStyle = "rgba(150,190,220,0.25)";
          ctx.fillRect(c * CELL + 6, r * CELL + 12 + ph * 4, CELL - 12, 3);
        } else if (type[i] === T_DIRT && state[i] === S_INTACT) {
          ctx.fillStyle = "rgba(70,52,30,0.5)";
          ctx.fillRect(
            c * CELL + 8 + shade[i] * 12,
            r * CELL + 9 + shade[i] * 14,
            3,
            2,
          );
          ctx.fillRect(
            c * CELL + 22 - shade[i] * 10,
            r * CELL + 24 - shade[i] * 12,
            2,
            2,
          );
        } else if (burnt) {
          ctx.fillStyle = "rgba(90,84,78,0.35)";
          ctx.fillRect(
            c * CELL + 6 + shade[i] * 16,
            r * CELL + 8 + shade[i] * 16,
            4,
            2,
          );
        }
        if (state[i] === S_BURN) {
          ctx.fillStyle = "rgba(120,40,10,0.85)";
          ctx.fillRect(c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4);
        }
      }
    }

    // cabins
    for (const h of homes) drawHouse(h.c, h.r, h.alive || pendingLose > 0, t);

    // night wash
    ctx.fillStyle = "rgba(10,14,30,0.30)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // wind streaks
    ctx.strokeStyle = "rgba(220,225,235,0.07)";
    ctx.lineWidth = 1.5;
    const wx = Math.cos(windAngle);
    const wy = Math.sin(windAngle);
    for (let k = 0; k < 12; k++) {
      const sd = streakSeed + k * 97.3;
      const bx =
        ((((sd * 137.5 + t * wx * 60) % (canvas.width + 160)) +
          canvas.width +
          160) %
          (canvas.width + 160)) -
        80;
      const by =
        ((((sd * 61.7 + t * wy * 60) % (canvas.height + 160)) +
          canvas.height +
          160) %
          (canvas.height + 160)) -
        80;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + wx * 46, by + wy * 46);
      ctx.stroke();
    }

    // smoke
    for (const s of smokes) {
      const a = (1 - s.age / s.life) * 0.24;
      ctx.fillStyle = "rgba(70,68,72," + a.toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.rad + s.age * 9, 0, 7);
      ctx.fill();
    }

    // flames and embers (additive glow)
    ctx.globalCompositeOperation = "lighter";
    for (const f of flames) {
      const k = 1 - f.age / f.life;
      const rr = (f.big ? 7 : 4.6) * k + 1.6;
      ctx.fillStyle = "rgba(255,120,30," + (0.5 * k).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(f.x, f.y, rr, 0, 7);
      ctx.fill();
      ctx.fillStyle = "rgba(255,214,120," + (0.55 * k).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(f.x, f.y - rr * 0.4, rr * 0.55, 0, 7);
      ctx.fill();
    }
    for (const e of embers) {
      for (let ti = 0; ti < e.trail.length; ti++) {
        const pt = e.trail[ti];
        ctx.fillStyle =
          "rgba(255,170,60," + ((ti / e.trail.length) * 0.7).toFixed(2) + ")";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.2, 0, 7);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,230,150,0.95)";
      ctx.beginPath();
      ctx.arc(e.x, e.y, 3, 0, 7);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // wood chips
    for (const ch of chips) {
      ctx.fillStyle =
        "rgba(190,150,90," + (1 - ch.age / ch.life).toFixed(2) + ")";
      ctx.fillRect(ch.x, ch.y, 3, 3);
    }

    // keyboard cursor
    if (cursor.active && phase === "playing") {
      ctx.strokeStyle = "rgba(255,217,160,0.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        cursor.c * CELL + 2,
        cursor.r * CELL + 2,
        CELL - 4,
        CELL - 4,
      );
    }

    // wind compass
    const cx = canvas.width - 56;
    const cy = 52;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = "rgba(16,13,10,0.72)";
    ctx.strokeStyle = "rgba(120,104,74,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, 7);
    ctx.fill();
    ctx.stroke();
    ctx.rotate(windAngle);
    ctx.strokeStyle = "#ffcf8a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(12, 0);
    ctx.moveTo(12, 0);
    ctx.lineTo(4, -6);
    ctx.moveTo(12, 0);
    ctx.lineTo(4, 6);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "rgba(216,201,168,0.85)";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    const deg = ((((windAngle * 180) / Math.PI) % 360) + 360) % 360;
    const names = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
    ctx.fillText("WIND " + names[Math.round(deg / 45) % 8], cx, cy + 40);

    // vignette
    if (!vignette) {
      vignette = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        canvas.height * 0.35,
        canvas.width / 2,
        canvas.height / 2,
        canvas.height * 0.85,
      );
      vignette.addColorStop(0, "rgba(8,10,22,0)");
      vignette.addColorStop(1, "rgba(8,10,22,0.5)");
    }
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // paused veil
    if (phase === "paused") {
      ctx.fillStyle = "rgba(8,8,10,0.45)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  /* ---------------- hud ---------------- */

  function renderHomes() {
    elHomes.innerHTML = homes
      .map(
        (h) => '<span class="' + (h.alive ? "" : "h-lost") + '">\u2302</span>',
      )
      .join("");
    elStHomes.textContent = String(homes.filter((h) => h.alive).length);
  }

  function renderHud() {
    const pct = (effort / effortMax) * 100;
    elEffort.style.width = pct.toFixed(1) + "%";
    elEffort.classList.toggle("low", pct < 30);
    elStGreen.textContent =
      Math.round((countIntactFlammable() / startFlammable) * 100) + "%";
  }

  function setTool(next) {
    tool = next;
    document
      .getElementById("tool-break")
      .classList.toggle("active", tool === "break");
    document
      .getElementById("tool-break")
      .setAttribute("aria-pressed", String(tool === "break"));
    document
      .getElementById("tool-burn")
      .classList.toggle("active", tool === "burn");
    document
      .getElementById("tool-burn")
      .setAttribute("aria-pressed", String(tool === "burn"));
  }

  /* ---------------- overlay / flow ---------------- */

  function showOverlay(title, lede, listHtml, keysHtml, ctaLabel, mood) {
    elOvTitle.textContent = title;
    elOvTitle.className = mood || "";
    elOvLede.innerHTML = lede;
    elOvList.innerHTML = listHtml;
    elOvKeys.textContent = keysHtml;
    elBtnStart.textContent = ctaLabel;
    elOverlay.classList.add("show");
  }

  function hideOverlay() {
    elOverlay.classList.remove("show");
  }

  function showIntro() {
    phase = "intro";
    showOverlay(
      "Firebreak",
      "A dry electric storm has dropped embers on the far ridge. " +
        "You have a crew, two tools, and until the fire arrives to decide " +
        "where the valley ends.",
      "<li><b>Cut breaks.</b> Drag across scrub to strip it to bare dirt. " +
        "Fire cannot cross bare dirt.</li>" +
        "<li><b>Burn ahead of it.</b> Tap the torch on green ground in the " +
        "fire's path - burnt land feeds nothing. Careful: your fire spreads " +
        "too.</li>" +
        "<li><b>Read the wind.</b> The dial is truth. It shifts through the " +
        "night, and hot fires throw embers over thin lines.</li>" +
        "<li><b>Save every cabin.</b> Lose one and the shift is lost. " +
        "Survive all five shifts to see the dawn.</li>",
      "drag / arrows + space to work \u00b7 Z / X swap tools \u00b7 P pause \u00b7 M sound \u00b7 R restart",
      "Light it. Go.",
      "",
    );
  }

  function showShiftBrief() {
    const L = SHIFTS[shiftIdx];
    showOverlay(
      "Shift " + (shiftIdx + 1) + " \u00b7 " + L.name,
      L.lede,
      "",
      "three cabins stand between the fire and the river flat",
      "Take the ridge",
      "",
    );
  }

  function endShift(survived) {
    phase = survived ? "won" : "lost";
    const greenPct = Math.max(
      0,
      Math.round((countIntactFlammable() / startFlammable) * 100),
    );
    const homesAlive = homes.filter((h) => h.alive).length;
    const earned = survived ? greenPct * 6 + homesAlive * 400 + 200 : 0;
    totalScore += earned;
    if (survived) audio.win();
    else audio.lose();

    if (survived && shiftIdx >= SHIFTS.length - 1) {
      phase = "victory";
      if (totalScore > bestScore) {
        bestScore = totalScore;
        try {
          localStorage.setItem("firebreak-best", String(bestScore));
        } catch (err) {
          /* storage may be unavailable; best stays in memory */
        }
      }
      audio.dawn();
      showOverlay(
        "Dawn",
        "The old north wind dies with the stars. All three cabins still " +
          "stand, and the valley smells of rain coming.<br><br>" +
          "Final score <b>" +
          totalScore +
          "</b>" +
          (bestScore ? " \u00b7 best <b>" + bestScore + "</b>" : ""),
        "",
        "",
        "Run the season again",
      );
      return;
    }

    if (survived) {
      showOverlay(
        "Shift survived",
        "The fire starved with <b>" +
          greenPct +
          "%</b> of the valley unburned and all three cabins standing.<br><br>" +
          "This shift: <b>+" +
          earned +
          "</b> \u00b7 total <b>" +
          totalScore +
          "</b>",
        "",
        "",
        "Next shift",
        "won",
      );
    } else {
      showOverlay(
        "The valley burned",
        "A cabin caught, and once one goes the rest follow it. " +
          "The crew walks out under a red sky.<br><br>" +
          "Valley unburned: " +
          greenPct +
          "%",
        "",
        "",
        "Retry shift " + (shiftIdx + 1),
        "lost",
      );
    }
  }

  function startShift() {
    const L = SHIFTS[shiftIdx];
    generateMap();
    effortMax = L.effort;
    effort = effortMax;
    refill = L.refill;
    windAngle = (L.windDeg * Math.PI) / 180;
    windVel = 0;
    windSpeed = 1;
    tickAcc = 0;
    simTime = 0;
    pendingLose = 0;
    winGrace = 0;
    flames = [];
    smokes = [];
    chips = [];
    embers = [];
    keysDown.clear();
    cursor.active = false;
    dragging = false;
    lastDragCell = null;
    elShiftNum.textContent = String(shiftIdx + 1);
    elShiftName.textContent = L.name;
    renderHomes();
    renderHud();
    hideOverlay();
    phase = "playing";
  }

  function primaryAction() {
    audio.unlock();
    if (phase === "intro") {
      shiftIdx = 0;
      totalScore = 0;
      startShift();
      showShiftBrief();
      phase = "brief";
    } else if (phase === "brief") {
      startShift();
    } else if (phase === "won") {
      shiftIdx++;
      startShift();
      showShiftBrief();
      phase = "brief";
    } else if (phase === "lost") {
      startShift();
      showShiftBrief();
      phase = "brief";
    } else if (phase === "victory") {
      shiftIdx = 0;
      totalScore = 0;
      startShift();
      showShiftBrief();
      phase = "brief";
    }
  }

  /* ---------------- input ---------------- */

  elBtnStart.addEventListener("click", primaryAction);

  document
    .getElementById("tool-break")
    .addEventListener("click", () => setTool("break"));
  document
    .getElementById("tool-burn")
    .addEventListener("click", () => setTool("burn"));

  document
    .getElementById("btn-pause")
    .addEventListener("click", () => togglePause());
  document.getElementById("btn-mute").addEventListener("click", () => {
    const mutedNow =
      document.getElementById("btn-mute").textContent.trim() !== "Sound";
    document.getElementById("btn-mute").textContent = mutedNow
      ? "Sound"
      : "Muted";
    audio.setMuted(!mutedNow);
  });
  document.getElementById("btn-restart").addEventListener("click", () => {
    if (phase === "playing" || phase === "paused") {
      startShift();
      showToast("Shift restarted.");
    }
  });

  function togglePause(forcePause) {
    if (phase === "playing" && forcePause !== false) {
      phase = "paused";
      document.getElementById("btn-pause").textContent = "Resume";
    } else if (phase === "paused") {
      phase = "playing";
      document.getElementById("btn-pause").textContent = "Pause";
    }
  }

  canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

  canvas.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    audio.unlock();
    if (phase !== "playing") return;
    dragging = true;
    if (canvas.setPointerCapture && ev.pointerId !== undefined) {
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch (err) {
        /* capture is best-effort */
      }
    }
    const cell = eventCell(ev);
    lastDragCell = cell;
    cursor.active = false;
    applyTool(cell.c, cell.r);
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (!dragging || phase !== "playing") return;
    const cell = eventCell(ev);
    if (
      lastDragCell &&
      (cell.c !== lastDragCell.c || cell.r !== lastDragCell.r)
    ) {
      paintLine(lastDragCell.c, lastDragCell.r, cell.c, cell.r);
      lastDragCell = cell;
    }
  });

  const releasePointer = () => {
    dragging = false;
    lastDragCell = null;
  };
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);

  window.addEventListener("keydown", (ev) => {
    const k = ev.key;
    if ((k === "Enter" || k === " ") && elOverlay.classList.contains("show")) {
      ev.preventDefault();
      primaryAction();
      return;
    }
    switch (k) {
      case "p":
      case "P":
        togglePause();
        return;
      case "m":
      case "M":
        document.getElementById("btn-mute").click();
        return;
      case "r":
      case "R":
        document.getElementById("btn-restart").click();
        return;
      default:
        break;
    }
    if (phase !== "playing") return;
    switch (k) {
      case "z":
      case "Z":
      case "1":
        setTool("break");
        break;
      case "x":
      case "X":
      case "2":
        setTool("burn");
        break;
      case "ArrowUp":
      case "w":
      case "W":
        keysDown.add("up");
        ev.preventDefault();
        cursor.active = true;
        break;
      case "ArrowDown":
      case "s":
      case "S":
        keysDown.add("down");
        ev.preventDefault();
        cursor.active = true;
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        keysDown.add("left");
        ev.preventDefault();
        cursor.active = true;
        break;
      case "ArrowRight":
      case "d":
      case "D":
        keysDown.add("right");
        ev.preventDefault();
        cursor.active = true;
        break;
      case " ":
        keysDown.add("apply");
        ev.preventDefault();
        break;
      default:
        break;
    }
  });

  window.addEventListener("keyup", (ev) => {
    switch (ev.key) {
      case "ArrowUp":
      case "w":
      case "W":
        keysDown.delete("up");
        break;
      case "ArrowDown":
      case "s":
      case "S":
        keysDown.delete("down");
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        keysDown.delete("left");
        break;
      case "ArrowRight":
      case "d":
      case "D":
        keysDown.delete("right");
        break;
      case " ":
        keysDown.delete("apply");
        break;
      default:
        break;
    }
  });

  function stepCursor(dt) {
    if (!cursor.active || phase !== "playing") return;
    curRepeatMove -= dt;
    if (curRepeatMove <= 0) {
      const anyDir =
        keysDown.has("up") ||
        keysDown.has("down") ||
        keysDown.has("left") ||
        keysDown.has("right");
      curRepeatMove = anyDir ? 0.11 : 0.02;
      if (keysDown.has("up")) cursor.r = Math.max(0, cursor.r - 1);
      if (keysDown.has("down")) cursor.r = Math.min(ROWS - 1, cursor.r + 1);
      if (keysDown.has("left")) cursor.c = Math.max(0, cursor.c - 1);
      if (keysDown.has("right")) cursor.c = Math.min(COLS - 1, cursor.c + 1);
    }
    curRepeatApply -= dt;
    if (curRepeatApply <= 0) {
      if (keysDown.has("apply")) {
        curRepeatApply = 0.16;
        applyTool(cursor.c, cursor.r);
      } else {
        curRepeatApply = 0;
      }
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && phase === "playing") togglePause(true);
  });

  /* ---------------- main loop ---------------- */

  let lastT = performance.now();

  function frame(now) {
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.06) dt = 0.06;
    const live = phase === "playing" || pendingLose > 0;
    if (live) {
      simTime += dt;
      stepSim(dt);
      stepCursor(dt);
    }
    stepParticles(live ? dt : dt * 0.25, live);
    draw(now / 1000);

    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) elToast.classList.remove("show");
    }
    renderHud();
    requestAnimationFrame(frame);
  }

  /* ---------------- boot ---------------- */

  try {
    const stored = localStorage.getItem("firebreak-best");
    if (stored) bestScore = parseInt(stored, 10) || 0;
  } catch (err) {
    /* storage unavailable on this origin */
  }

  generateMap();
  renderHomes();
  renderHud();
  showIntro();
  requestAnimationFrame(frame);
})();
