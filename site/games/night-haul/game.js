/* Night Haul — a night-lake net-fishing game.
   Hold to sink the net, release to snap it shut around drifting schools,
   and fill the creel before the dawn bell. One classic script, one IIFE. */

(() => {
  "use strict";

  /* ============================== helpers ============================== */

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));

  /* ============================== constants ============================ */

  const W = 560;
  const H = 760;
  const SURFACE = 170;
  const BED = 712;
  const DEPTH = BED - SURFACE;
  const NIGHT_LEN = 95;
  const QUOTA = 45;
  const NET_MAX = 520;
  const NET_SINK = 300;
  const NET_HALF_TOP = 80;
  const NET_HALF_BOT = 64;

  const SPECIES = {
    sprat: { name: "Sprats", value: 1, deep: [0.1, 0.34], speed: [46, 64] },
    perch: { name: "Perch", value: 2, deep: [0.28, 0.58], speed: [26, 40] },
    eel: { name: "Eels", value: 3, deep: [0.8, 0.92], speed: [18, 30] },
    moonfish: {
      name: "Moonfish",
      value: 5,
      deep: [0.55, 0.95],
      speed: [13, 21],
    },
    carp: { name: "Old carp", value: 20, deep: [0.86, 0.95], speed: [9, 13] },
    boot: { name: "Old boots", value: 0, deep: [0.6, 0.98], speed: [4, 8] },
  };

  const SPAWNS = [
    { kind: "sprat", every: [3.4, 5.4], n: [6, 9] },
    { kind: "perch", every: [4.5, 7.2], n: [1, 2] },
    { kind: "eel", every: [6.5, 9.5], n: [1, 1] },
    { kind: "moonfish", every: [12, 17], n: [1, 1] },
    { kind: "boot", every: [8, 12.5], n: [1, 1] },
    { kind: "carp", every: [34, 47], n: [1, 1] },
  ];

  /* ============================== state ================================ */

  const boat = { x: W / 2, tx: W / 2, bob: 0 };
  const net = {
    state: "idle", // idle | down | hauling | cooldown
    depth: 0,
    hold: 0,
    t: 0,
    catch: [],
  };
  let fish = [];
  let bits = []; // particles: ripples, bubbles, sparkles
  let stars = [];
  let trees = [];
  let stones = [];
  let spawnTimers = [];
  let coins = 0;
  let caught = {}; // species -> count
  let boots = 0;
  let timeLeft = NIGHT_LEN;
  let warned = false;
  let mode = "title"; // title | play | pause | end
  let won = false;
  let muted = false;
  let dragging = false;
  const keys = { left: false, right: false };
  let last = performance.now();
  let clock = 0;

  const canvas = $("lake");
  const ctx = canvas.getContext("2d");

  /* ============================== audio ================================ */

  const Audio = (() => {
    let ac = null;
    let master = null;
    let amb = null;

    function ensure() {
      if (ac) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        ac = new AC();
      } catch (err) {
        ac = null;
        return false;
      }
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ac.destination);
      // lake ambience: soft filtered noise, gently lapping
      const len = ac.sampleRate * 2;
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      let v = 0;
      for (let i = 0; i < len; i++) {
        v = v * 0.98 + (Math.random() * 2 - 1) * 0.05;
        d[i] = v;
      }
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 260;
      amb = ac.createGain();
      amb.gain.value = 0.16;
      const lfo = ac.createOscillator();
      lfo.frequency.value = 0.13;
      const lfoG = ac.createGain();
      lfoG.gain.value = 0.06;
      lfo.connect(lfoG).connect(amb.gain);
      lfo.start();
      src.connect(lp).connect(amb).connect(master);
      src.start();
      return true;
    }

    function resume() {
      if (ensure() && ac.state === "suspended") ac.resume();
    }

    function noiseBurst(dur, freq, q, vol, type) {
      if (!ensure()) return;
      const n = Math.floor(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, n, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const f = ac.createBiquadFilter();
      f.type = type || "bandpass";
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      src.connect(f).connect(g).connect(master);
      src.start();
    }

    function tone(freq, dur, vol, type, when, slide) {
      if (!ensure()) return;
      const t0 = ac.currentTime + (when || 0);
      const o = ac.createOscillator();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }

    return {
      resume,
      splash() {
        noiseBurst(0.22, 640, 0.9, 0.5);
        tone(300, 0.16, 0.12, "sine", 0, 120);
      },
      snap() {
        noiseBurst(0.07, 1400, 1.2, 0.4);
        tone(190, 0.1, 0.2, "square", 0, 90);
      },
      creak() {
        tone(96, 0.3, 0.08, "sawtooth", 0, 70);
      },
      chime(value) {
        const base = value >= 5 ? 660 : 560;
        tone(base, 0.14, 0.22);
        tone(base * 1.335, 0.16, 0.2, "sine", 0.09);
        if (value >= 5) tone(base * 2, 0.2, 0.16, "sine", 0.18);
      },
      clunk() {
        tone(110, 0.16, 0.3, "square", 0, 60);
        noiseBurst(0.12, 300, 1, 0.3, "lowpass");
      },
      fanfare() {
        [523, 659, 784, 1047].forEach((f, i) =>
          tone(f, 0.22, 0.2, "triangle", i * 0.11),
        );
      },
      bell() {
        tone(220, 1.3, 0.3, "sine");
        tone(440, 0.9, 0.12, "sine");
        tone(220, 1.3, 0.24, "sine", 0.7);
      },
      setMuted(m) {
        muted = m;
        if (ensure())
          master.gain.setTargetAtTime(m ? 0 : 0.5, ac.currentTime, 0.03);
      },
    };
  })();

  /* ============================== scenery ============================== */

  function buildScenery() {
    stars = [];
    for (let i = 0; i < 70; i++)
      stars.push({
        x: rand(0, W),
        y: rand(6, SURFACE - 40),
        r: rand(0.5, 1.6),
        p: rand(0, Math.PI * 2),
        s: rand(0.6, 1.8),
      });
    trees = [];
    let x = -10;
    while (x < W + 10) {
      const w = rand(14, 34);
      trees.push({ x, w, h: rand(10, 34) });
      x += w * rand(0.55, 0.85);
    }
    stones = [];
    for (let i = 0; i < 16; i++)
      stones.push({ x: rand(10, W - 10), r: rand(5, 14), y: rand(2, 16) });
  }

  /* ============================== spawning ============================= */

  function makeFish(kind, x, y, dir, speedScale) {
    const sp = SPECIES[kind];
    const fy =
      y !== undefined ? y : SURFACE + rand(sp.deep[0], sp.deep[1]) * DEPTH;
    const speed = rand(sp.speed[0], sp.speed[1]) * (speedScale || 1);
    return {
      kind,
      x: x !== undefined ? x : dir > 0 ? -40 : W + 40,
      y: fy,
      home: fy,
      vx: (dir || (Math.random() < 0.5 ? 1 : -1)) * speed,
      vy: 0,
      flee: 0,
      phase: rand(0, Math.PI * 2),
      size:
        kind === "carp"
          ? 15
          : kind === "moonfish"
            ? 11
            : kind === "boot"
              ? 10
              : 6,
      dart: 0,
    };
  }

  function spawnWave(kind, n, speedScale) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (kind === "sprat") {
      const cy =
        SURFACE + rand(SPECIES.sprat.deep[0], SPECIES.sprat.deep[1]) * DEPTH;
      const x0 = dir > 0 ? -60 : W + 60;
      for (let i = 0; i < n; i++)
        fish.push(
          makeFish(
            "sprat",
            x0 + rand(-46, 46) * (dir > 0 ? 1 : -1),
            cy + rand(-26, 26),
            dir,
            speedScale,
          ),
        );
    } else {
      for (let i = 0; i < n; i++)
        fish.push(makeFish(kind, undefined, undefined, dir, speedScale));
    }
  }

  function resetSpawns() {
    spawnTimers = SPAWNS.map((s) => ({
      kind: s.kind,
      n: s.n,
      t: rand(s.every[0] * 0.4, s.every[1]),
    }));
  }

  /* ============================== net ================================== */

  function netHalfWat(y) {
    const t = clamp((y - SURFACE) / NET_MAX, 0, 1);
    return lerp(NET_HALF_TOP, NET_HALF_BOT, t);
  }

  function netBottomY() {
    return SURFACE + 18 + net.depth;
  }

  function netDown() {
    if (mode !== "play" || net.state !== "idle") return;
    net.state = "down";
    net.depth = 0;
    net.hold = 0;
    net.catch = [];
    Audio.splash();
    splashAt(boat.x, SURFACE + 6, 10);
  }

  function netUp() {
    if (net.state !== "down") return;
    if (net.hold < 0.22 || net.depth < 34) {
      net.state = "cooldown";
      net.t = 0.18;
      return;
    }
    net.state = "hauling";
    net.t = 0;
    Audio.snap();
    capture();
  }

  function capture() {
    const bx = boat.x;
    const top = SURFACE + 18;
    const bot = netBottomY();
    let got = 0;
    let boot = false;
    let carp = false;
    let value = 0;
    const kept = [];
    for (const f of fish) {
      const hw = netHalfWat(f.y);
      const inside = f.y > top + 4 && f.y < bot && Math.abs(f.x - bx) < hw - 4;
      if (inside) {
        net.catch.push(f.kind);
        if (f.kind === "boot") {
          boot = true;
          boots++;
        } else {
          got++;
          value += SPECIES[f.kind].value;
          caught[f.kind] = (caught[f.kind] || 0) + 1;
          if (f.kind === "carp") carp = true;
        }
      } else kept.push(f);
    }
    fish = kept;
    coins += value;
    if (boot) {
      Audio.clunk();
      toast("An old boot. The net sulks.");
    }
    if (carp) {
      Audio.fanfare();
      toast("The old carp of the deep!");
    } else if (got > 0 && !boot) {
      Audio.chime(
        SPECIES.sprat.value * 0 + (value >= 5 ? 5 : value >= 3 ? 3 : 1),
      );
      if (got >= 6) toast("A full mouthful of sprats!");
    }
    updateHud();
  }

  /* ============================== update =============================== */

  function step(dt) {
    clock += dt;
    timeLeft -= dt;

    // dawn warning
    if (!warned && timeLeft <= 15) {
      warned = true;
      Audio.bell();
      toast("The sky pales. Last casts!");
      $("dawn-fill").parentElement.classList.add("warn");
    }
    if (timeLeft <= 0) {
      timeLeft = 0;
      endNight();
      return;
    }

    // boat movement
    const slow = net.state === "down" ? 0.55 : 1;
    if (keys.left) boat.tx -= 170 * dt * slow;
    if (keys.right) boat.tx += 170 * dt * slow;
    boat.tx = clamp(boat.tx, 90, W - 90);
    boat.x += (boat.tx - boat.x) * Math.min(1, dt * 6);
    boat.bob = Math.sin(clock * 1.7) * 2.2;

    // net states
    if (net.state === "down") {
      net.hold += dt;
      net.depth = Math.min(NET_MAX, net.depth + NET_SINK * dt);
      if (Math.random() < dt * 14)
        bits.push(
          bubble(
            boat.x + rand(-30, 30),
            SURFACE + 30 + rand(0, net.depth - 20),
          ),
        );
    } else if (net.state === "hauling") {
      net.t += dt;
      if (net.t > 0.62) {
        net.state = "cooldown";
        net.t = net.catch.includes("boot") ? 1.35 : 0.55;
        if (net.catch.length) sparkleAt(boat.x, SURFACE + 30, 12);
      }
    } else if (net.state === "cooldown") {
      net.t -= dt;
      if (net.t <= 0) {
        net.state = "idle";
        net.catch = [];
      }
    }

    // spawning
    const rush = timeLeft < NIGHT_LEN * 0.45 ? 1.25 : 1;
    for (const s of spawnTimers) {
      s.t -= dt;
      if (s.t <= 0) {
        const def = SPAWNS.find((d) => d.kind === s.kind);
        s.t = rand(def.every[0], def.every[1]);
        if (fish.length < 46) spawnWave(s.kind, randi(s.n[0], s.n[1]), rush);
      }
    }

    updateFish(dt);
    updateBits(dt);
    updateHud();

    // ripples under the boat

    if (Math.random() < dt * 1.6)
      bits.push(ripple(boat.x + rand(-16, 16), SURFACE + 4));

    // early win
    if (coins >= QUOTA) {
      endNight();
      return;
    }
  }

  function updateFish(dt) {
    const bx = boat.x;
    const nb = netBottomY();
    const active = net.state === "down";
    for (const f of fish) {
      // fear of the ropes: fish spook when the sinking foot-rope closes on
      // them, but anything already enveloped inside the mesh stays calm
      if (active) {
        const hw = netHalfWat(f.y);
        const dx = f.x - bx;
        const dyb = nb - f.y; // + means the net bottom sits below the fish
        const inMouth = Math.abs(dx) < hw - 4 && dyb > 6 && f.y > SURFACE + 16;
        if (!inMouth && Math.abs(dx) < hw + 30 && dyb > -60 && dyb < 110) {
          f.flee = Math.max(f.flee, 0.9);
          const push = (dx >= 0 ? 1 : -1) * 260;
          f.vx += push * dt * 1.7;
          if (f.kind === "eel" || f.kind === "moonfish") f.vy -= 210 * dt * 1.5;
        }
      }

      f.dart = Math.max(0, (f.dart || 0) - dt);

      const sp = SPECIES[f.kind];
      const cap =
        sp.speed[1] * (1.4 + (f.flee > 0 ? 1.35 : 0) + (f.dart > 0 ? 1.1 : 0));
      f.vx = clamp(f.vx, -cap, cap);
      // drift back toward cruise speed
      const cruise = (f.vx > 0 ? 1 : -1) * (sp.speed[0] + sp.speed[1]) * 0.5;
      if (f.flee <= 0 && f.dart <= 0)
        f.vx += (cruise - f.vx) * Math.min(1, dt * 0.9);
      f.x += f.vx * dt * (1 + (f.flee > 0 ? 0.9 : 0) + (f.dart > 0 ? 0.8 : 0));
      // vertical: spring to home depth, flee upward for eels
      f.vy *= Math.pow(0.4, dt);
      f.y += f.vy * dt;
      f.y += (f.home - f.y) * Math.min(1, dt * (f.flee > 0 ? 0.25 : 1.1));
      f.y = clamp(f.y, SURFACE + 26, BED - 14);
      // wrap around
      const m = 60;
      if (f.x < -m) f.x = W + m - 1;
      if (f.x > W + m) f.x = -m + 1;
    }
  }

  function ripple(x, y) {
    return { kind: "ripple", x, y, r: 3, life: 1.4, max: 1.4 };
  }
  function bubble(x, y) {
    return {
      kind: "bubble",
      x,
      y,
      r: rand(1.5, 3.4),
      life: rand(0.8, 1.6),
      max: 1.6,
      vy: rand(-34, -18),
    };
  }
  function splashAt(x, y, n) {
    for (let i = 0; i < n; i++)
      bits.push({
        kind: "drop",
        x: x + rand(-8, 8),
        y,
        vx: rand(-60, 60),
        vy: rand(-140, -40),
        life: 0.7,
        max: 0.7,
      });
    bits.push(ripple(x, y));
  }
  function sparkleAt(x, y, n) {
    for (let i = 0; i < n; i++)
      bits.push({
        kind: "spark",
        x: x + rand(-26, 26),
        y: y + rand(-10, 26),
        vy: rand(-30, -8),
        life: rand(0.5, 1),
        max: 1,
      });
  }

  function updateBits(dt) {
    const keep = [];
    for (const b of bits) {
      b.life -= dt;
      if (b.life <= 0) continue;
      if (b.kind === "ripple") b.r += dt * 26;
      if (b.kind === "bubble" || b.kind === "spark") {
        b.y += (b.vy || -20) * dt;
        if (b.kind === "bubble" && b.y < SURFACE + 4) b.life = 0;
      }
      if (b.kind === "drop") {
        b.vy += 420 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.y > SURFACE + 6) b.life = 0;
      }
      keep.push(b);
    }
    bits = keep;
  }

  /* ============================== drawing ============================== */

  function draw() {
    const dawn = 1 - timeLeft / NIGHT_LEN;
    const late = warned ? clamp((NIGHT_LEN - 15 - timeLeft) / 15, 0, 1) : 0;
    ctx.clearRect(0, 0, W, H);

    /* sky */
    const sky = ctx.createLinearGradient(0, 0, 0, SURFACE);
    sky.addColorStop(0, mix("#0a1421", "#31435f", late));
    sky.addColorStop(1, mix("#14243a", "#7c6a6e", late * 0.8));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, SURFACE);

    /* stars */
    for (const s of stars) {
      const a =
        (0.35 + 0.6 * (0.5 + 0.5 * Math.sin(clock * s.s + s.p))) *
        (1 - dawn * 0.85);
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = "#dfe9f5";
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    /* moon */
    const mx = W * 0.76;
    const my = 64;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#f3ead2";
    ctx.beginPath();
    ctx.arc(mx, my, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mix("#0a1421", "#31435f", late);
    ctx.beginPath();
    ctx.arc(mx - 11, my - 7, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* treeline */
    ctx.fillStyle = "#050b13";
    ctx.beginPath();
    ctx.moveTo(0, SURFACE);
    for (const t of trees) {
      ctx.lineTo(t.x + t.w * 0.5, SURFACE - t.h - 6);
      ctx.lineTo(t.x + t.w, SURFACE - rand(0, 0));
    }
    ctx.lineTo(W, SURFACE);
    ctx.closePath();
    ctx.fill();

    /* water */
    const wat = ctx.createLinearGradient(0, SURFACE, 0, H);
    wat.addColorStop(0, mix("#173250", "#2c466b", late * 0.7));
    wat.addColorStop(0.5, "#0d1e33");
    wat.addColorStop(1, "#050d18");
    ctx.fillStyle = wat;
    ctx.fillRect(0, SURFACE, W, H - SURFACE);

    /* moon glint */
    ctx.save();
    ctx.globalAlpha = 0.14 + 0.05 * Math.sin(clock * 1.3);
    ctx.fillStyle = "#f3ead2";
    for (let i = 0; i < 9; i++) {
      const yy = SURFACE + 8 + i * 9 + Math.sin(clock * 2 + i) * 2;
      const ww = 30 + i * 9;
      ctx.fillRect(mx - ww / 2 + Math.sin(clock + i * 2.1) * 6, yy, ww, 2.5);
    }
    ctx.restore();

    /* lakebed */
    ctx.fillStyle = "#04080f";
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, BED - 6);
    for (let x = 0; x <= W; x += 40)
      ctx.lineTo(x + 20, BED - 6 + Math.sin(x * 0.05) * 5);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    for (const st of stones) {
      ctx.fillStyle = "#0a1420";
      ctx.beginPath();
      ctx.ellipse(st.x, BED - st.y, st.r, st.r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    /* fish, dim beyond the lantern */
    for (const f of fish) drawFish(f);

    /* bits */
    drawBits();

    /* net + boat */
    drawNet();
    drawBoat();
  }

  function mix(hexA, hexB, t) {
    const a = parseInt(hexA.slice(1), 16);
    const b = parseInt(hexB.slice(1), 16);
    const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, t));
    const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
    const bl = Math.round(lerp(a & 255, b & 255, t));
    return `rgb(${r},${g},${bl})`;
  }

  function lanternDim(x, y) {
    const d = Math.hypot(x - boat.x, y - (SURFACE + 30));
    return clamp(1 - d / 260, 0.16, 1);
  }

  function drawFish(f) {
    const dim = lanternDim(f.x, f.y);
    ctx.save();
    ctx.translate(f.x, f.y + Math.sin(f.phase) * 2);
    const dir = f.vx >= 0 ? 1 : -1;
    ctx.scale(dir, 1);
    ctx.globalAlpha = dim;

    const wag = Math.sin(f.phase * 2.6) * 0.35;
    switch (f.kind) {
      case "sprat": {
        ctx.fillStyle = "#a9c3d6";
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 2.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-6, 0);
        ctx.lineTo(-11, -3 + wag * 4);
        ctx.lineTo(-11, 3 + wag * 4);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "perch": {
        ctx.fillStyle = "#7fa06a";
        ctx.beginPath();
        ctx.ellipse(0, 0, 11, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#4c6b3c";
        ctx.lineWidth = 1.4;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 4 - 2, -4);
          ctx.lineTo(i * 4 - 4, 4);
          ctx.stroke();
        }
        ctx.fillStyle = "#7fa06a";
        ctx.beginPath();
        ctx.moveTo(-9, 0);
        ctx.lineTo(-15, -4 + wag * 4);
        ctx.lineTo(-15, 4 + wag * 4);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "eel": {
        ctx.strokeStyle = "#5d6b46";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(-16, 0);
        for (let i = -12; i <= 16; i += 7)
          ctx.quadraticCurveTo(
            i + 3,
            Math.sin(f.phase * 3 + i * 0.3) * 5,
            i + 7,
            Math.sin(f.phase * 3 + (i + 7) * 0.3) * 5,
          );
        ctx.stroke();
        break;
      }
      case "moonfish": {
        const glow = 0.25 + 0.15 * Math.sin(f.phase);
        ctx.fillStyle = `rgba(214,229,244,${glow * dim})`;
        ctx.beginPath();
        ctx.arc(0, 0, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#dce9f7";
        ctx.beginPath();
        ctx.ellipse(0, 0, 10, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#9fb4c9";
        ctx.beginPath();
        ctx.moveTo(-8, 0);
        ctx.lineTo(-14, -4 + wag * 3);
        ctx.lineTo(-14, 4 + wag * 3);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "carp": {
        ctx.fillStyle = "#b07a3a";
        ctx.beginPath();
        ctx.ellipse(0, 0, 17, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#7c5122";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.scale(1, 1);
        ctx.moveTo(-14, 2);
        ctx.quadraticCurveTo(0, 12, 14, 2);
        ctx.stroke();
        ctx.fillStyle = "#b07a3a";
        ctx.beginPath();
        ctx.moveTo(-15, 0);
        ctx.lineTo(-24, -7 + wag * 5);
        ctx.lineTo(-24, 7 + wag * 5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#e8c98e";
        ctx.beginPath();
        ctx.arc(9, -3, 1.8, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "boot": {
        ctx.fillStyle = "#5c4632";
        ctx.beginPath();
        ctx.moveTo(-6, -10);
        ctx.lineTo(2, -10);
        ctx.lineTo(3, 2);
        ctx.lineTo(11, 4);
        ctx.lineTo(11, 9);
        ctx.lineTo(-6, 9);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#3e2e20";
        ctx.lineWidth = 1.4;
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawBits() {
    for (const b of bits) {
      const t = b.life / b.max;
      if (b.kind === "ripple") {
        ctx.strokeStyle = `rgba(210,228,245,${0.35 * t})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(b.x, b.y, b.r, b.r * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (b.kind === "bubble") {
        ctx.strokeStyle = `rgba(210,228,245,${0.5 * t})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (b.kind === "drop") {
        ctx.fillStyle = `rgba(200,224,244,${0.8 * t})`;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (b.kind === "spark") {
        ctx.fillStyle = `rgba(255,217,138,${0.9 * t})`;
        ctx.fillRect(b.x - 1.2, b.y - 1.2, 2.4, 2.4);
      }
    }
  }

  function drawNet() {
    if (net.state === "idle") return;
    const bx = boat.x;
    const by = SURFACE + boat.bob;
    const top = by + 14;
    const bot = netBottomY();
    const hauling = net.state === "hauling";
    const prog = hauling ? clamp(net.t / 0.62, 0, 1) : 0;
    const bottom = lerp(bot, top + 26, prog);
    let pinch = 1;
    if (hauling) pinch = lerp(1, 0.24, clamp(prog * 1.6, 0, 1));

    const hwT = NET_HALF_TOP * pinch;
    const hwB = NET_HALF_BOT * pinch;

    ctx.save();
    // float bar at the surface
    ctx.strokeStyle = "#c8a06a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(bx - hwT, top);
    ctx.lineTo(bx + hwT, top);
    ctx.stroke();

    // side ropes
    ctx.strokeStyle = "rgba(222,205,175,0.85)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx - hwT, top);
    ctx.lineTo(bx - hwB, bottom);
    ctx.moveTo(bx + hwT, top);
    ctx.lineTo(bx + hwB, bottom);
    ctx.stroke();

    // mesh
    ctx.strokeStyle = "rgba(222,205,175,0.3)";
    ctx.lineWidth = 0.8;
    const rows = Math.max(3, Math.floor((bottom - top) / 22));
    for (let i = 1; i < rows; i++) {
      const t = i / rows;
      const y = lerp(top, bottom, t);
      const hw = lerp(hwT, hwB, t);
      ctx.beginPath();
      ctx.moveTo(bx - hw, y);
      ctx.lineTo(bx + hw, y);
      ctx.stroke();
    }
    for (let sx = -1; sx <= 1; sx += 0.34) {
      ctx.beginPath();
      ctx.moveTo(bx + sx * hwT, top);
      ctx.lineTo(bx + sx * hwB, bottom);
      ctx.stroke();
    }

    // catch shown while hauling
    if (hauling && net.catch.length) {
      const kinds = net.catch.slice(0, 10);
      kinds.forEach((k, i) => {
        const a = (i / kinds.length) * Math.PI * 2;
        const fx = bx + Math.cos(a) * (hwB * 0.55);
        const fy = lerp(top + 14, bottom - 8, 0.6) + Math.sin(a) * 8;
        ctx.fillStyle =
          k === "boot"
            ? "#5c4632"
            : k === "carp"
              ? "#b07a3a"
              : k === "perch"
                ? "#7fa06a"
                : k === "eel"
                  ? "#5d6b46"
                  : k === "moonfish"
                    ? "#dce9f7"
                    : "#a9c3d6";
        ctx.beginPath();
        ctx.ellipse(
          fx,
          fy,
          k === "carp" ? 8 : k === "boot" ? 5 : 4,
          3,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      });
    }
    ctx.restore();
  }

  function drawBoat() {
    const x = boat.x;
    const y = SURFACE + boat.bob;

    // lantern glow
    const glow = ctx.createRadialGradient(x, y + 26, 10, x, y + 26, 250);
    glow.addColorStop(0, "rgba(255,214,140,0.20)");
    glow.addColorStop(0.5, "rgba(255,214,140,0.07)");
    glow.addColorStop(1, "rgba(255,214,140,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - 260, y - 40, 520, 560);

    // hull
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(clock * 1.1) * 0.02);
    ctx.fillStyle = "#4a3320";
    ctx.beginPath();
    ctx.moveTo(-52, -10);
    ctx.quadraticCurveTo(0, 14, 52, -10);
    ctx.lineTo(40, 4);
    ctx.quadraticCurveTo(0, 16, -40, 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#2e1f12";
    ctx.lineWidth = 2;
    ctx.stroke();
    // gunwale
    ctx.fillStyle = "#5d4227";
    ctx.fillRect(-52, -14, 104, 6);
    // seat
    ctx.fillStyle = "#3c2a18";
    ctx.fillRect(-18, -12, 36, 4);
    // lantern on a short post
    ctx.strokeStyle = "#2e1f12";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(30, -12);
    ctx.lineTo(30, -34);
    ctx.stroke();
    const flick = 0.85 + 0.15 * Math.sin(clock * 9 + Math.sin(clock * 13));
    ctx.fillStyle = `rgba(255,217,138,${flick})`;
    ctx.fillRect(25, -44, 10, 12);
    ctx.strokeStyle = "#2e1f12";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(25, -44, 10, 12);
    ctx.restore();
  }

  /* ============================== hud & flow =========================== */

  function updateHud() {
    $("coins").textContent = String(coins);
    const f = $("dawn-fill");
    f.style.transform = `scaleX(${clamp(timeLeft / NIGHT_LEN, 0, 1)})`;
  }

  let toastTimer = null;
  function toast(msg, ms) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), ms || 1900);
  }

  function showOverlay(id) {
    for (const o of ["ov-title", "ov-end", "ov-pause"])
      $(o).classList.toggle("hidden", o !== id);
  }

  function startNight() {
    Audio.resume();
    coins = 0;
    caught = {};
    boots = 0;
    timeLeft = NIGHT_LEN;
    warned = false;
    won = false;
    fish = [];
    bits = [];
    net.state = "idle";
    net.catch = [];
    net.depth = 0;
    boat.x = W / 2;
    boat.tx = W / 2;
    resetSpawns();
    $("dawn-fill").parentElement.classList.remove("warn");
    $("quota").textContent = String(QUOTA);
    updateHud();
    mode = "play";
    showOverlay(null);
    toast("Night falls. The lake stirs.");
  }

  function endNight() {
    mode = "end";
    won = coins >= QUOTA;
    if (won) Audio.fanfare();
    else Audio.bell();
    $("end-title").textContent = won ? "Creel Full" : "Dawn Comes";
    $("end-note").textContent = won
      ? "The mist lifts on a heavy creel."
      : "The mist lifts. The lake keeps its change.";
    const tally = $("tally");
    tally.textContent = "";
    const rows = [];
    for (const k of Object.keys(SPECIES)) {
      const n = k === "boot" ? boots : caught[k] || 0;
      if (n > 0)
        rows.push([
          `${SPECIES[k].name} ×${n}`,
          `${n * SPECIES[k].value} coins`,
        ]);
    }
    if (!rows.length) rows.push(["Nothing but water", "0 coins"]);
    for (const [dt_, dd] of rows) {
      const d = document.createElement("div");
      const a = document.createElement("dt");
      a.textContent = dt_;
      const b = document.createElement("dd");
      b.textContent = dd;
      d.append(a, b);
      tally.append(d);
    }
    const line = $("score-line");
    line.textContent = won
      ? `${coins} coins — the village breakfasts well.`
      : `${coins} of ${QUOTA} coins — the carp keep their secrets.`;
    line.classList.toggle("short", !won);
    $("btn-again").textContent = "";
    const label = won ? "Another night" : "Try again";
    $("btn-again").append(label, document.createElement("kbd"));
    $("btn-again").lastChild.textContent = "↵";
    showOverlay("ov-end");
  }

  function setPaused(p) {
    if (p && mode === "play") {
      mode = "pause";
      showOverlay("ov-pause");
    } else if (!p && mode === "pause") {
      mode = "play";
      showOverlay(null);
      last = performance.now();
    }
    $("pause").textContent = mode === "pause" ? "▶ Row on" : "⏸ Pause";
  }

  function toggleMute() {
    muted = !muted;
    Audio.setMuted(muted);
    const b = $("mute");
    b.textContent = muted ? "🔇 Muted" : "🔊 Sound";
    b.setAttribute("aria-pressed", String(muted));
  }

  /* ============================== input ================================ */

  function canvasX(evt) {
    const r = canvas.getBoundingClientRect();
    return ((evt.clientX - r.left) / r.width) * W;
  }

  canvas.addEventListener("pointerdown", (e) => {
    Audio.resume();
    dragging = true;
    boat.tx = canvasX(e);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) boat.tx = canvasX(e);
  });
  canvas.addEventListener("pointerup", () => {
    dragging = false;
  });
  canvas.addEventListener("pointercancel", () => {
    dragging = false;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const netBtn = $("net");
  netBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    Audio.resume();
    netBtn.classList.add("held");
    netDown();
  });
  const netRelease = () => {
    netBtn.classList.remove("held");
    netUp();
  };
  netBtn.addEventListener("pointerup", netRelease);
  netBtn.addEventListener("pointercancel", netRelease);
  netBtn.addEventListener("pointerleave", netRelease);

  $("btn-start").addEventListener("click", startNight);
  $("btn-again").addEventListener("click", startNight);
  $("btn-resume").addEventListener("click", () => setPaused(false));
  $("pause").addEventListener("click", () => setPaused(mode !== "pause"));
  $("mute").addEventListener("click", toggleMute);
  $("restart").addEventListener("click", () => {
    Audio.resume();
    startNight();
  });

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (["ArrowLeft", "ArrowRight", "ArrowDown", " "].includes(k))
      e.preventDefault();
    if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = true;
    if (k === "ArrowRight" || k === "d" || k === "D") keys.right = true;
    if (
      (k === "ArrowDown" || k === " " || k === "s" || k === "S") &&
      !e.repeat
    ) {
      Audio.resume();
      netDown();
    }
    if (k === "Enter") {
      if (mode === "title" || mode === "end") startNight();
      else if (mode === "pause") setPaused(false);
    }
    if (k === "p" || k === "P") setPaused(mode !== "pause");
    if (k === "m" || k === "M") toggleMute();
    if (k === "r" || k === "R") {
      if (mode !== "title") startNight();
    }
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = false;
    if (k === "ArrowRight" || k === "d" || k === "D") keys.right = false;
    if (k === "ArrowDown" || k === " " || k === "s" || k === "S") netUp();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) setPaused(true);
  });

  /* ============================== loop ================================= */

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    if (mode === "play") step(dt);
    else {
      clock += dt;
      boat.bob = Math.sin(clock * 1.7) * 2.2;
      updateBits(dt);
    }
    draw();
  }

  /* ============================== init ================================= */

  function init() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildScenery();
    resetSpawns();
    // a few fish so the title screen is alive
    for (let i = 0; i < 10; i++)
      fish.push(
        makeFish(
          i % 3 === 0 ? "perch" : "sprat",
          rand(40, W - 40),
          undefined,
          undefined,
          1,
        ),
      );
    updateHud();
    $("quota").textContent = String(QUOTA);
    requestAnimationFrame((t) => {
      last = t;
      frame(t);
    });
  }

  init();
})();
