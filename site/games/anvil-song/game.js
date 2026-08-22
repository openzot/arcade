/*
 * Anvil Song — forge five blades on the bellows' beat.
 * Strike when the sweeping mark crosses the glowing zone; keep the blade hot
 * with the bellows without letting the coal bed die; quench to set the edge.
 */
(() => {
  "use strict";

  // ---------- tiny helpers ----------
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);

  const FONTS =
    '"Avenir Next", Avenir, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const FONT_SMALL = "600 15px " + FONTS;
  const FONT_BIG = "700 42px " + FONTS;

  const EMBERS = ["#ffd27a", "#ff9a3c", "#ff6a1a", "#ffe9a8"];
  const GREYS = ["#8b8b93", "#6f6f77", "#a5a5ad"];

  // ---------- dom ----------
  const canvas = document.getElementById("forge");
  const ctx = canvas.getContext("2d");
  const titleOverlay = document.getElementById("titleOverlay");
  const pauseOverlay = document.getElementById("pauseOverlay");
  const endOverlay = document.getElementById("endOverlay");
  const endTitle = document.getElementById("endTitle");
  const endDetail = document.getElementById("endDetail");
  const startBtn = document.getElementById("startBtn");
  const againBtn = document.getElementById("againBtn");
  const resumeBtn = document.getElementById("resumeBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const soundBtn = document.getElementById("soundBtn");
  const restartBtn = document.getElementById("restartBtn");
  const bellowsBtn = document.getElementById("bellowsBtn");

  // ---------- synth ----------
  const Sound = (() => {
    let ac = null;
    let master = null;
    let noiseBuf = null;
    let muted = false;
    let bellows = null;

    function ensure() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!ac) {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(ac.destination);
        const n = ac.sampleRate | 0;
        noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ac.state === "suspended") ac.resume();
    }

    const ready = () => !!ac && !muted;

    function tone(type, f0, f1, dur, vol, delay) {
      if (!ready()) return;
      const t = ac.currentTime + (delay || 0);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0)
        o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dur + 0.03);
    }

    function rush(dur, vol, fType, f0, f1, delay) {
      if (!ready()) return;
      const t = ac.currentTime + (delay || 0);
      const s = ac.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = true;
      const f = ac.createBiquadFilter();
      f.type = fType;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f);
      f.connect(g);
      g.connect(master);
      s.start(t);
      s.stop(t + dur + 0.05);
    }

    function clank() {
      tone("triangle", 430, 150, 0.16, 0.4);
      rush(0.07, 0.22, "highpass", 2600, 2200);
    }

    return {
      ensure,
      setMuted(m) {
        muted = m;
        if (master) master.gain.value = m ? 0 : 0.5;
      },
      tick(step) {
        tone("square", 1050 + step * 45, 0, 0.05, 0.05);
      },
      clank,
      perfect() {
        clank();
        tone("sine", 1568, 1568, 0.35, 0.14, 0.01);
        tone("sine", 2093, 2093, 0.3, 0.08, 0.06);
      },
      glance() {
        tone("triangle", 190, 85, 0.13, 0.28);
        rush(0.09, 0.12, "lowpass", 700, 300);
      },
      cold() {
        tone("square", 140, 65, 0.2, 0.3);
        rush(0.16, 0.18, "lowpass", 900, 200);
      },
      quench(good) {
        rush(good ? 1.0 : 0.6, good ? 0.34 : 0.22, "lowpass", 5200, 260);
      },
      bellowsStart() {
        if (!ac || bellows) return;
        const s = ac.createBufferSource();
        s.buffer = noiseBuf;
        s.loop = true;
        const f = ac.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 330;
        f.Q.value = 0.8;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.16, ac.currentTime + 0.18);
        s.connect(f);
        f.connect(g);
        g.connect(master);
        s.start();
        bellows = { s, g };
      },
      bellowsStop() {
        if (!bellows || !ac) return;
        const b = bellows;
        bellows = null;
        try {
          g_stop(b, ac.currentTime);
        } catch (e) {
          /* already silent */
        }
      },
      motif(stars) {
        const notes = [523, 659, 784];
        if (stars >= 3) notes.push(1047);
        for (let i = 0; i < notes.length; i++)
          tone("sine", notes[i], notes[i], 0.28, 0.16, i * 0.11);
        if (stars >= 2) tone("triangle", 262, 262, 0.4, 0.1);
      },
      fanfare() {
        const notes = [392, 523, 659, 784, 1047];
        for (let i = 0; i < notes.length; i++)
          tone("triangle", notes[i], notes[i], 0.34, 0.15, i * 0.13);
      },
      sad() {
        tone("triangle", 220, 110, 0.7, 0.2);
        tone("triangle", 165, 82, 0.9, 0.18, 0.35);
      },
    };

    function g_stop(b, t) {
      b.g.gain.cancelScheduledValues(t);
      b.g.gain.setValueAtTime(0.16, t);
      b.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      b.s.stop(t + 0.2);
    }
  })();

  // ---------- tuning ----------
  const BLADES = [
    { name: "Horseshoe", hits: 8, bpm: 84, heatDecay: 3.6, zoneW: 0.3 },
    { name: "Dagger", hits: 10, bpm: 92, heatDecay: 4.0, zoneW: 0.26 },
    { name: "Scythe", hits: 12, bpm: 100, heatDecay: 4.4, zoneW: 0.23 },
    { name: "Axe Head", hits: 14, bpm: 108, heatDecay: 4.8, zoneW: 0.2 },
    { name: "Longsword", hits: 16, bpm: 116, heatDecay: 5.2, zoneW: 0.17 },
  ];
  const COAL_START = 100;
  const COAL_DRAIN = 1.15; // per second while forging
  const COAL_BELLOWS = 3.4; // extra drain per second while bellowing
  const COAL_PERFECT = 2.0; // coal returned per perfect strike
  const HEAT_MAX = 100;
  const HEAT_COLD = 25; // below this the iron only dents
  const HEAT_BELLOWS = 30; // heat gained per second while bellowing
  const SWING_RECOVER = 0.34; // seconds between swings

  // ---------- state ----------
  const S = {
    state: "title", // title | intro | forge | quench | done | win | lose
    paused: false,
    muted: false,
    blade: 0,
    hits: 0,
    quality: 100,
    heat: 70,
    coal: COAL_START,
    score: 0,
    stars: [],
    streak: 0,
    markerT: 0,
    zoneC: 0.5,
    bellowsHeld: false,
    swingAt: -9,
    quenchSwept: false,
    bannerText: "",
    bannerSub: "",
    bannerT: 0,
    bannerMax: 1,
    time: 0,
    emberAcc: 0,
  };
  let bellowsOn = false;
  const parts = [];

  const PLAYABLE = ["intro", "forge", "quench", "done"];

  // ---------- layout ----------
  const W = 960;
  const H = 600;

  function fit() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", fit);
  fit();

  // ---------- flow ----------
  function hideOverlays() {
    titleOverlay.classList.add("hidden");
    pauseOverlay.classList.add("hidden");
    endOverlay.classList.add("hidden");
  }

  function newZone() {
    S.zoneC = rand(0.2, 0.8);
  }

  function beginBlade(i) {
    S.blade = i;
    S.hits = 0;
    S.quality = 100;
    S.heat = 70;
    S.streak = 0;
    S.markerT = 0;
    S.quenchSwept = false;
    S.zoneW = BLADES[i].zoneW;
    newZone();
    S.state = "intro";
    S.bannerT = 1.5;
    S.bannerMax = 1.5;
    S.bannerText = BLADES[i].name.toUpperCase();
    S.bannerSub = "blade " + (i + 1) + " of " + BLADES.length;
    hideOverlays();
    Sound.tick(i);
  }

  function startGame() {
    Sound.ensure();
    S.coal = COAL_START;
    S.score = 0;
    S.stars = [];
    S.swingAt = -9;
    S.paused = false;
    pauseBtn.textContent = "Pause";
    parts.length = 0;
    beginBlade(0);
  }

  function finishBlade() {
    const st = S.quality >= 90 ? 3 : S.quality >= 70 ? 2 : 1;
    S.stars.push(st);
    S.score += Math.round(S.quality);
    S.state = "done";
    S.bannerT = 1.7;
    S.bannerMax = 1.7;
    S.bannerText = BLADES[S.blade].name + " quenched";
    S.bannerSub =
      "\u2605".repeat(st) +
      "\u00b7".repeat(3 - st) +
      "   quality " +
      Math.round(S.quality);
    Sound.motif(st);
  }

  function advance() {
    if (S.blade + 1 >= BLADES.length) endGame(true);
    else beginBlade(S.blade + 1);
  }

  function endGame(won) {
    manageBellowsAudio(false);
    S.state = won ? "win" : "lose";
    let totalStars = 0;
    for (const st of S.stars) totalStars += st;
    if (won) {
      endTitle.textContent = "Every blade sings";
      endDetail.textContent =
        "Five blades forged over one coal bed. Score " +
        S.score +
        " \u2014 " +
        totalStars +
        "/15 stars.";
    } else {
      endTitle.textContent = "The forge is cold";
      endDetail.textContent =
        "The coal died at blade " +
        (S.blade + 1) +
        " of " +
        BLADES.length +
        ". Score " +
        S.score +
        ".";
    }
    endOverlay.classList.remove("hidden");
    if (won) Sound.fanfare();
    else Sound.sad();
  }

  function setPaused(p) {
    if (p === S.paused) return;
    if (p && PLAYABLE.indexOf(S.state) === -1) return;
    S.paused = p;
    pauseOverlay.classList.toggle("hidden", !p);
    pauseBtn.textContent = p ? "Resume" : "Pause";
    if (p) manageBellowsAudio(false);
  }

  function toggleMute() {
    S.muted = !S.muted;
    Sound.ensure();
    Sound.setMuted(S.muted);
    soundBtn.textContent = S.muted ? "Sound: off" : "Sound: on";
  }

  function manageBellowsAudio(on) {
    if (on && !bellowsOn) {
      Sound.bellowsStart();
      bellowsOn = true;
    } else if (!on && bellowsOn) {
      Sound.bellowsStop();
      bellowsOn = false;
    }
  }

  // ---------- input ----------
  function strike() {
    if (S.paused) return;
    if (S.state !== "forge" && S.state !== "quench") return;
    if (S.time - S.swingAt < SWING_RECOVER) return;
    S.swingAt = S.time;
    resolveSwing();
  }

  function resolveSwing() {
    const B = BLADES[S.blade];

    if (S.state === "forge") {
      const p = clamp(S.hits / B.hits, 0, 1);
      const hx = 340 + (70 + 210 * p) * 0.62;
      const hy = 372;

      if (S.heat < HEAT_COLD) {
        S.quality = Math.max(0, S.quality - 4);
        S.streak = 0;
        Sound.cold();
        spawnSparks(hx, hy, 6, 120, GREYS);
        return;
      }

      const d = Math.abs(S.markerT - S.zoneC);
      const half = S.zoneW / 2;

      if (d <= half * 0.4) {
        S.hits += 1;
        S.streak += 1;
        S.coal = Math.min(100, S.coal + COAL_PERFECT);
        Sound.perfect();
        spawnSparks(hx, hy, 14 + S.streak * 2, 300, EMBERS);
      } else if (d <= half) {
        S.hits += 1;
        S.streak = 0;
        Sound.clank();
        spawnSparks(hx, hy, 9, 220, EMBERS);
      } else {
        S.quality = Math.max(0, S.quality - 5);
        S.streak = 0;
        Sound.glance();
        spawnSparks(hx, hy, 4, 120, GREYS);
      }

      if (S.hits >= B.hits) {
        S.state = "quench";
        S.markerT = 0;
        S.quenchSwept = false;
        Sound.tick(S.blade);
      }
      return;
    }

    // quench strike
    const d = Math.abs(S.markerT - 0.5);
    let bonus = 0;
    let good = false;
    if (d <= 0.048) {
      bonus = 8;
      good = true;
    } else if (d <= 0.12) {
      bonus = 4;
      good = true;
    }
    S.quality = Math.min(100, S.quality + bonus);
    Sound.quench(good);
    spawnSteam(470, 378, 26);
    S.quenchSwept = true;
    finishBlade();
  }

  window.addEventListener("keydown", (e) => {
    const onButton = e.target && e.target.tagName === "BUTTON";
    switch (e.code) {
      case "Space":
      case "Enter":
        if (onButton) return; // let focused buttons behave natively
        e.preventDefault();
        strike();
        break;
      case "KeyB":
        S.bellowsHeld = true;
        break;
      case "KeyP":
        setPaused(!S.paused);
        break;
      case "KeyM":
        toggleMute();
        break;
      case "KeyR":
        startGame();
        break;
      default:
        break;
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyB") S.bellowsHeld = false;
  });

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    Sound.ensure();
    strike();
  });

  bellowsBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    Sound.ensure();
    S.bellowsHeld = true;
    try {
      bellowsBtn.setPointerCapture(e.pointerId);
    } catch (err) {
      /* no capture needed */
    }
  });
  const releaseBellows = () => {
    S.bellowsHeld = false;
  };
  bellowsBtn.addEventListener("pointerup", releaseBellows);
  bellowsBtn.addEventListener("pointercancel", releaseBellows);
  bellowsBtn.addEventListener("lostpointercapture", releaseBellows);
  bellowsBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  startBtn.addEventListener("click", () => {
    startGame();
    startBtn.blur();
  });
  againBtn.addEventListener("click", () => {
    startGame();
    againBtn.blur();
  });
  resumeBtn.addEventListener("click", () => {
    setPaused(false);
    resumeBtn.blur();
  });
  pauseBtn.addEventListener("click", () => {
    setPaused(!S.paused);
    pauseBtn.blur();
  });
  soundBtn.addEventListener("click", () => {
    toggleMute();
    soundBtn.blur();
  });
  restartBtn.addEventListener("click", () => {
    startGame();
    restartBtn.blur();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) setPaused(true);
  });

  // ---------- particles ----------
  function spawnSparks(x, y, n, power, cols) {
    for (let i = 0; i < n; i++) {
      const life = rand(0.25, 0.7);
      parts.push({
        x,
        y,
        vx: rand(-1, 1) * power,
        vy: rand(-power * 1.5, -power * 0.2),
        grav: 850,
        life,
        max: life,
        size: rand(1.5, 3.4),
        col: cols[(Math.random() * cols.length) | 0],
        grow: 0,
      });
    }
  }

  function spawnSteam(x, y, n) {
    for (let i = 0; i < n; i++) {
      const life = rand(0.5, 1.2);
      parts.push({
        x: x + rand(-26, 26),
        y: y + rand(-8, 8),
        vx: rand(-30, 30),
        vy: rand(-120, -60),
        grav: -30,
        life,
        max: life,
        size: rand(4, 9),
        col: "rgba(222,228,234,0.9)",
        grow: 1.8,
      });
    }
  }

  const COALS = [];
  for (let i = 0; i < 11; i++) {
    COALS.push({
      x: 40 + i * 88 + rand(-18, 18),
      y: 512 + (i % 3) * 14,
      r: rand(14, 26),
      ph: rand(0, TAU),
      sp: rand(1.5, 3),
    });
  }

  function spawnEmber() {
    const c = COALS[(Math.random() * COALS.length) | 0];
    const life = rand(0.9, 2.1);
    parts.push({
      x: c.x + rand(-10, 10),
      y: c.y - 4,
      vx: rand(-9, 9),
      vy: rand(-38, -14),
      grav: -6,
      life,
      max: life,
      size: rand(1.2, 2.6),
      col: Math.random() < 0.3 ? "#ffd27a" : "#ff8a2a",
      grow: 0,
    });
  }

  // ---------- update ----------
  function update(dt) {
    S.time += dt;
    const B = BLADES[S.blade];
    const playing = S.state === "forge" || S.state === "quench";

    if (S.state === "intro" || S.state === "done") {
      S.bannerT -= dt;
      if (S.bannerT <= 0) {
        if (S.state === "intro") S.state = "forge";
        else advance();
      }
    }

    let emberRate = 5;
    if (playing) {
      S.coal -= COAL_DRAIN * dt;
      const belling = S.bellowsHeld && S.state === "forge";
      if (belling) {
        S.coal -= COAL_BELLOWS * dt;
        S.heat += HEAT_BELLOWS * dt;
        emberRate = 22;
      } else {
        S.heat -= B.heatDecay * dt;
      }
      S.heat = clamp(S.heat, 0, HEAT_MAX);
      manageBellowsAudio(belling);

      if (S.coal <= 0) {
        S.coal = 0;
        endGame(false);
        return;
      }

      const period = 60 / B.bpm;
      S.markerT += dt / period;
      if (S.state === "forge") {
        if (S.markerT >= 1) {
          S.markerT %= 1;
          newZone();
          Sound.tick(S.blade);
        }
      } else if (!S.quenchSwept && S.markerT >= 1) {
        S.quenchSwept = true;
        finishBlade();
      }
    } else {
      manageBellowsAudio(false);
    }

    S.emberAcc += dt * emberRate;
    while (S.emberAcc >= 1) {
      S.emberAcc -= 1;
      spawnEmber();
    }

    if (S.state === "quench" && Math.random() < dt * 14)
      spawnSteam(rand(340, 560), rand(356, 380), 1);

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        parts.splice(i, 1);
        continue;
      }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  // ---------- render ----------
  const HEAT_STOPS = [
    [0.0, 74, 66, 58],
    [0.22, 128, 32, 16],
    [0.45, 216, 74, 12],
    [0.7, 255, 152, 40],
    [1.0, 255, 232, 168],
  ];

  function heatRGB(t) {
    t = clamp(t, 0, 1);
    for (let i = 1; i < HEAT_STOPS.length; i++) {
      const a = HEAT_STOPS[i - 1];
      const b = HEAT_STOPS[i];
      if (t <= b[0]) {
        const k = (t - a[0]) / (b[0] - a[0]);
        return (
          "rgb(" +
          Math.round(lerp(a[1], b[1], k)) +
          "," +
          Math.round(lerp(a[2], b[2], k)) +
          "," +
          Math.round(lerp(a[3], b[3], k)) +
          ")"
        );
      }
    }
    return "rgb(255,232,168)";
  }

  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function seg(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawWall() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#181208");
    g.addColorStop(0.6, "#100b07");
    g.addColorStop(1, "#0a0705");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;
    for (let y = 205; y < 470; y += 54) {
      seg(0, y, W, y);
      const off = ((y / 54) | 0) % 2 ? 70 : 0;
      for (let x = off; x < W; x += 140) seg(x, y, x, y + 54);
    }

    ctx.fillStyle = "#1d130a";
    ctx.fillRect(0, 158, W, 20);
    ctx.fillStyle = "rgba(255,190,120,0.06)";
    ctx.fillRect(0, 158, W, 3);
  }

  function drawCoalBed(bpm) {
    const beat = 60 / bpm;
    const pulse =
      (0.72 + 0.28 * Math.sin((S.time / beat) * TAU)) *
      (0.35 + 0.65 * (S.coal / 100));

    const g = ctx.createLinearGradient(0, 380, 0, 520);
    g.addColorStop(0, "rgba(255,110,20,0)");
    g.addColorStop(1, "rgba(255,110,20," + (0.16 * pulse).toFixed(3) + ")");
    ctx.fillStyle = g;
    ctx.fillRect(0, 380, W, 140);

    ctx.fillStyle = "#15100a";
    ctx.fillRect(0, 500, W, 100);
    ctx.fillStyle = "#0e0a06";
    for (let i = 0; i < 23; i++) {
      const x = -12 + i * 46;
      const y = 494 + (i % 2) * 6;
      rrect(x, y, 44, 18, 7);
      ctx.fill();
    }

    for (const c of COALS) {
      const fl = 0.6 + 0.4 * Math.sin(S.time * c.sp + c.ph);
      const a = (0.35 + 0.65 * fl) * pulse;
      const rg = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, c.r * 2.2);
      rg.addColorStop(0, "rgba(255,190,80," + (0.75 * a).toFixed(3) + ")");
      rg.addColorStop(0.45, "rgba(255,100,20," + (0.45 * a).toFixed(3) + ")");
      rg.addColorStop(1, "rgba(120,30,0,0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r * 2.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255,140,40," + (0.5 * a).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r * 0.5, 0, TAU);
      ctx.fill();
    }
  }

  function drawAnvil() {
    ctx.fillStyle = "#20202a";
    ctx.beginPath();
    ctx.moveTo(320, 374);
    ctx.quadraticCurveTo(272, 372, 256, 382);
    ctx.quadraticCurveTo(272, 392, 320, 392);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#2c2c35";
    rrect(320, 368, 290, 26, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(324, 369, 282, 3);

    ctx.fillStyle = "#23232c";
    ctx.beginPath();
    ctx.moveTo(400, 394);
    ctx.lineTo(530, 394);
    ctx.lineTo(560, 436);
    ctx.lineTo(370, 436);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#1d1d24";
    rrect(350, 436, 230, 22, 4);
    ctx.fill();
  }

  function drawBlade() {
    const B = BLADES[S.blade];
    const p = clamp(S.hits / B.hits, 0, 1);
    const len = 70 + 210 * p;
    const x0 = 340;
    const y = 372;
    const h = 14;
    let heat = S.heat / 100;
    if (S.state === "quench") heat = Math.min(1, heat + 0.3);
    const col = heatRGB(heat);

    ctx.save();
    if (heat > 0.18) {
      ctx.shadowColor = col;
      ctx.shadowBlur = 6 + heat * 26;
    }
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x0, y + h);
    ctx.lineTo(x0 + len - 26, y + h);
    ctx.lineTo(x0 + len, y + h * 0.5);
    ctx.lineTo(x0 + len - 26, y);
    ctx.lineTo(x0, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(x0, y + 2, len - 26, 2);

    ctx.fillStyle = "#241a12";
    rrect(x0 - 64, y + 3, 66, 8, 3);
    ctx.fill();
  }

  const HPX = 706;
  const HPY = 236;
  const HL = 152;

  function hammerAngle() {
    const REST = -1.05;
    const u = S.time - S.swingAt;
    if (u < 0 || u > 0.5) return REST;
    if (u < 0.09) return lerp(REST, 0, u / 0.09);
    if (u < 0.16) return 0;
    const t = clamp((u - 0.16) / 0.34, 0, 1);
    return lerp(0, REST, 1 - (1 - t) * (1 - t));
  }

  function drawHammer() {
    const a = hammerAngle();
    const hx = HPX + Math.sin(a) * HL;
    const hy = HPY + Math.cos(a) * HL;

    const u = S.time - S.swingAt;
    if (u >= 0 && u < 0.14) {
      const fa = 1 - u / 0.14;
      const fg = ctx.createRadialGradient(hx, hy + 14, 2, hx, hy + 14, 60);
      fg.addColorStop(0, "rgba(255,220,140," + (0.5 * fa).toFixed(3) + ")");
      fg.addColorStop(1, "rgba(255,120,20,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(hx, hy + 14, 60, 0, TAU);
      ctx.fill();
    }

    ctx.strokeStyle = "#5d4326";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    seg(HPX, HPY, hx, hy);

    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(-a * 0.35);
    ctx.fillStyle = "#3c3f47";
    rrect(-24, -14, 48, 28, 6);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    rrect(-24, -14, 48, 9, 6);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#1c130c";
    ctx.beginPath();
    ctx.arc(HPX, HPY, 10, 0, TAU);
    ctx.fill();
  }

  function drawParticles() {
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.grow ? 1 + (1 - a) * p.grow : 1), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function bar(x, y, w, h, frac, fill) {
    ctx.fillStyle = "#191008";
    rrect(x, y, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = "#3a2c1c";
    ctx.lineWidth = 2;
    rrect(x, y, w, h, 6);
    ctx.stroke();
    const fw = Math.max(0, Math.min(1, frac)) * (w - 6);
    if (fw > 1) {
      ctx.fillStyle = fill;
      rrect(x + 3, y + 3, fw, h - 6, 4);
      ctx.fill();
    }
  }

  function drawStrikeBar(label, zoneC, zoneW, accent) {
    const TX = 150;
    const TW = 660;
    const TY = 116;
    const TH = 26;

    ctx.font = FONT_SMALL;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(232,221,204,0.78)";
    ctx.fillText(label, TX + TW / 2, TY - 22);

    ctx.fillStyle = "#191008";
    rrect(TX, TY, TW, TH, 13);
    ctx.fill();
    ctx.strokeStyle = "#3a2c1c";
    ctx.lineWidth = 2;
    rrect(TX, TY, TW, TH, 13);
    ctx.stroke();

    const zx = TX + (zoneC - zoneW / 2) * TW;
    const zw = zoneW * TW;
    const pulse = 0.75 + 0.25 * Math.sin(S.time * 7);
    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = 16 * pulse;
    ctx.globalAlpha = 0.18 + 0.3 * pulse;
    ctx.fillStyle = accent;
    rrect(zx, TY + 3, zw, TH - 6, 10);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    seg(TX + zoneC * TW, TY + 4, TX + zoneC * TW, TY + TH - 4);
    ctx.globalAlpha = 1;

    const mx = TX + clamp(S.markerT, 0, 1) * TW;
    ctx.save();
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#fff8ec";
    rrect(mx - 2.5, TY - 5, 5, TH + 10, 2.5);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#ffe9a8";
    ctx.beginPath();
    ctx.moveTo(mx, TY - 16);
    ctx.lineTo(mx + 6, TY - 9);
    ctx.lineTo(mx, TY - 2);
    ctx.lineTo(mx - 6, TY - 9);
    ctx.closePath();
    ctx.fill();
  }

  function drawHUD() {
    const B = BLADES[S.blade];

    ctx.font = FONT_SMALL;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(232,221,204,0.85)";
    ctx.fillText(
      "BLADE " +
        (S.blade + 1) +
        "/" +
        BLADES.length +
        " \u2014 " +
        B.name.toUpperCase(),
      30,
      42,
    );

    const pg = ctx.createLinearGradient(30, 0, 250, 0);
    pg.addColorStop(0, "#ff6a1a");
    pg.addColorStop(1, "#ffcf6e");
    bar(30, 52, 220, 12, S.hits / B.hits, pg);

    for (let i = 0; i < BLADES.length; i++) {
      const cx = 41 + i * 28;
      const cy = 94;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx + 7, cy);
      ctx.lineTo(cx, cy + 8);
      ctx.lineTo(cx - 7, cy);
      ctx.closePath();
      if (i < S.stars.length) {
        const st = S.stars[i];
        ctx.fillStyle = st >= 3 ? "#ffcf6e" : st === 2 ? "#ff8a2a" : "#9a5a28";
        ctx.fill();
      } else {
        ctx.strokeStyle =
          i === S.blade ? "rgba(255,207,110,0.85)" : "rgba(154,140,120,0.35)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(232,221,204,0.85)";
    ctx.fillText("COAL BED", 930, 42);
    let coalCol = "#ff8a2a";
    if (S.coal < 20 && Math.sin(S.time * 10) > 0) coalCol = "#e2452e";
    bar(710, 50, 220, 12, S.coal / 100, coalCol);
    ctx.fillText("SCORE " + S.score, 930, 92);

    const GX = 884;
    const GY = 210;
    const GW = 22;
    const GH = 220;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(232,221,204,0.85)";
    ctx.fillText("HEAT", GX + GW / 2, GY - 12);
    ctx.fillStyle = "#191008";
    rrect(GX, GY, GW, GH, 8);
    ctx.fill();
    ctx.strokeStyle = "#3a2c1c";
    ctx.lineWidth = 2;
    rrect(GX, GY, GW, GH, 8);
    ctx.stroke();
    ctx.save();
    rrect(GX, GY, GW, GH, 8);
    ctx.clip();
    const fh = (S.heat / HEAT_MAX) * GH;
    ctx.fillStyle = heatRGB(S.heat / 100);
    ctx.fillRect(GX, GY + GH - fh, GW, fh);
    ctx.restore();
    const coldY = GY + GH * (1 - HEAT_COLD / HEAT_MAX);
    ctx.strokeStyle = "rgba(226,69,46,0.9)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    seg(GX - 6, coldY, GX + GW + 6, coldY);
    ctx.setLineDash([]);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(226,69,46,0.85)";
    ctx.fillText("COLD", GX - 10, coldY + 4);
  }

  function drawBanner() {
    const a = Math.max(
      0,
      Math.min(1, S.bannerT / 0.3, (S.bannerMax - S.bannerT) / 0.22),
    );
    if (a <= 0) return;
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.font = FONT_BIG;
    ctx.fillStyle = "#ffcf6e";
    ctx.shadowColor = "rgba(255,122,26,0.6)";
    ctx.shadowBlur = 24;
    ctx.fillText(S.bannerText, W / 2, 258);
    ctx.shadowBlur = 0;
    ctx.font = FONT_SMALL;
    ctx.fillStyle = "rgba(232,221,204,0.92)";
    ctx.fillText(S.bannerSub, W / 2, 296);
    ctx.globalAlpha = 1;
  }

  let vignette = null;
  function drawVignette() {
    if (!vignette) {
      vignette = ctx.createRadialGradient(W / 2, H / 2, 260, W / 2, H / 2, 640);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.55)");
    }
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawWall();
    const bpm = S.state === "title" ? 84 : BLADES[S.blade].bpm;
    drawCoalBed(bpm);
    drawAnvil();
    if (S.state !== "title") drawBlade();
    drawHammer();
    drawParticles();
    if (S.state !== "title") drawHUD();
    if (S.state === "forge")
      drawStrikeBar("STRIKE ON THE GLOW", S.zoneC, S.zoneW, "#ff8a2a");
    else if (S.state === "quench")
      drawStrikeBar("QUENCH IN THE ZONE", 0.5, 0.24, "#5ec8ff");
    if (S.state === "intro" || S.state === "done") drawBanner();
    drawVignette();
  }

  // ---------- main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!S.paused) update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
