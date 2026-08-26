/*
 * Blink Comparator — survey astronomy on five frost-clear nights.
 * Flick tonight's plate against last night's; every star holds still except
 * one. Mark the jumper before moonrise. Variables pulse, dust sits on one
 * plate only, satellites streak — and the sky pretends nothing moved.
 */
(() => {
  "use strict";

  // ---------- tiny helpers ----------
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const ROMAN = ["I", "II", "III", "IV", "V"];

  const $ = (sel) => document.querySelector(sel);

  // ---------- DOM ----------
  const canvas = $("#scope");
  const ctx = canvas.getContext("2d");
  const el = {
    moonFill: $("#moon-fill"),
    moonWrap: $("#moon-wrap"),
    score: $("#hud-score"),
    lives: $("#hud-lives"),
    chipNight: $("#chip-night"),
    hint: $("#hint"),
    banner: $("#banner"),
    bannerBig: $("#banner-big"),
    bannerSmall: $("#banner-small"),
    padBlink: $("#pad-blink"),
    overlays: {
      title: $("#overlay-title"),
      help: $("#overlay-help"),
      pause: $("#overlay-pause"),
      night: $("#overlay-night"),
      over: $("#overlay-over"),
      won: $("#overlay-won"),
    },
    nightHead: $("#night-head"),
    nightLine: $("#night-line"),
    overLine: $("#over-line"),
    wonLine: $("#won-line"),
  };
  const btn = {
    start: $("#btn-start"),
    help: $("#btn-help"),
    helpClose: $("#btn-help-close"),
    pause: $("#btn-pause"),
    mute: $("#btn-mute"),
    restart: $("#btn-restart"),
    resume: $("#btn-resume"),
    nextNight: $("#btn-next-night"),
    retry: $("#btn-retry"),
    again: $("#btn-again"),
  };

  // ---------- constants ----------
  const W = 960;
  const H = 600;
  const PX = 128;
  const PY = 44;
  const PW = 704;
  const PH = 512;
  const FINAL_NIGHT = 5;
  const PAIRS_PER_NIGHT = 3;
  const START_LIVES = 3;

  // ---------- audio ----------
  let AC = null;
  let masterGain = null;
  let muted = false;

  function audioCtx() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = AC.createGain();
        masterGain.gain.value = 0.4;
        masterGain.connect(AC.destination);
      } catch (err) {
        AC = null;
      }
    }
    if (AC && AC.state === "suspended") {
      AC.resume().catch(() => {});
    }
    return AC;
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (muted) return;
    const ac = audioCtx();
    if (!ac) return;
    const t0 = ac.currentTime + (delay || 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(30, slideTo),
        t0 + dur,
      );
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol || 0.25, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function noiseBurst(dur, vol, cutoff) {
    if (muted) return;
    const ac = audioCtx();
    if (!ac) return;
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buffer = ac.createBuffer(1, len, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff || 900;
    const gain = ac.createGain();

    gain.gain.value = vol || 0.18;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    src.start();
  }

  const snd = {
    flip() {
      tone(1400, 0.03, "square", 0.05);
    },
    chime() {
      tone(660, 0.14, "triangle", 0.16);
      tone(990, 0.2, "triangle", 0.14, 0, 0.09);
      tone(1320, 0.26, "triangle", 0.12, 0, 0.18);
    },
    deny() {
      tone(120, 0.12, "square", 0.12, 78);
    },
    miss() {
      tone(190, 0.06, "square", 0.06);
    },
    nightDone() {
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(f, 0.18, "triangle", 0.15, 0, i * 0.1),
      );
    },
    fog() {
      noiseBurst(0.8, 0.22, 380);
      tone(160, 0.55, "sine", 0.13, 82);
    },
    ui() {
      tone(540, 0.05, "square", 0.07);
    },
  };

  // ---------- state ----------
  let phase = "title"; // title | play | over | won
  let paused = false;
  let helpOpen = false;
  let interlude = false; // night ledger shown between nights

  let night = 1;
  let pairIdx = 0;

  let score = 0;
  let lives = START_LIVES;
  let best = 0;
  try {
    best = Number(localStorage.getItem("blink-comparator-best")) || 0;
  } catch (err) {
    best = 0;
  }

  let stars = []; // {ax,ay,bx,by,r,base,eliminated,xFlash,variable|null,isMover}
  let grainA = [];
  let grainB = [];
  let dust = []; // {x,y,r,onA}
  let streak = null; // {x,y,dx,dy,t}
  let moverIdx = -1;

  let simT = 0;
  let moon = 1;
  let moonMax = 1;
  let pencils = 2;
  let nightPencils = 0;
  let found = false;
  let foundAt = -9999;
  let foundPts = 0;
  let advanceAt = null; // {t, action:'nextPair'|'nightEnd'}
  let lastPrimaryAt = 0;

  let blinkAuto = false;
  let blinkHold = false;
  let viewPlate = "A";
  let lastFlipAt = 0;

  const cursor = { x: PX + PW / 2, y: PY + PH / 2, snap: -1 };
  const keys = {};

  let particles = [];

  // ---------- difficulty ----------
  function diffFor(n) {
    return {
      starCount: 64 + n * 10,
      shift: Math.max(6, 15.5 - n * 1.9),
      variables: Math.min(8, (n - 1) * 2),
      dustCount: [0, 2, 4, 6, 9][n - 1],
      satChance: [0, 0.25, 0.45, 0.6, 0.75][n - 1],
      moonTime: Math.max(30000, 43000 - n * 2600),
    };
  }

  // ---------- generation ----------
  function makeGrain(count) {
    const g = [];
    for (let i = 0; i < count; i++) {
      g.push({
        x: rand(PX + 4, PX + PW - 4),
        y: rand(PY + 4, PY + PH - 4),
        light: Math.random() < 0.5,
        r: rand(0.4, 1.3),
      });
    }
    return g;
  }

  function buildPair() {
    const d = diffFor(night);
    stars = [];
    const pad = 24;
    const count = d.starCount;
    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 60) {
      guard++;
      const x = rand(PX + pad, PX + PW - pad);
      const y = rand(PY + pad, PY + PH - pad);
      let ok = true;
      for (const s of stars) {
        if (Math.hypot(s.ax - x, s.ay - y) < 17) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const big = Math.random() < 0.07;
      stars.push({
        ax: x,
        ay: y,
        bx: x,
        by: y,
        r: big ? rand(2.6, 3.4) : rand(1.15, 2.3),
        base: big ? rand(0.85, 1) : rand(0.5, 0.85),
        eliminated: false,
        xFlash: -9999,
        variable: null,
        isMover: false,
      });
      placed++;
    }

    // the wanderer
    moverIdx = irandIdx(stars.length);
    const m = stars[moverIdx];
    m.isMover = true;
    m.base = rand(0.6, 0.9);
    const ang = rand(0, TAU);
    let dx = Math.cos(ang) * d.shift;
    let dy = Math.sin(ang) * d.shift;
    if (
      m.ax + dx < PX + pad ||
      m.ax + dx > PX + PW - pad ||
      m.ay + dy < PY + pad ||
      m.ay + dy > PY + PH - pad
    ) {
      dx = -dx;
      dy = -dy;
    }
    m.bx = m.ax + dx;
    m.by = m.ay + dy;

    // decoys that pulse but never move
    const pool = stars.map((s, i) => i).filter((i) => !stars[i].isMover);
    for (let v = 0; v < d.variables && pool.length; v++) {
      const idx = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      stars[idx].variable = {
        speed: rand(1.6, 3.6),
        phase: rand(0, TAU),
        depth: rand(0.45, 0.75),
      };
    }

    grainA = makeGrain(240);
    grainB = makeGrain(240);

    // emulsion specks that sit on one plate only
    dust = [];
    for (let i = 0; i < d.dustCount; i++) {
      dust.push({
        x: rand(PX + 20, PX + PW - 20),
        y: rand(PY + 20, PY + PH - 20),
        r: rand(1.6, 3),
        onA: Math.random() < 0.5,
      });
    }

    streak =
      Math.random() < d.satChance
        ? {
            t: -rand(2500, 11000), // delays the pass
            x: 0,
            y: 0,
            dx: 0,
            dy: 0,
          }
        : null;
    if (streak) {
      const edge = Math.random() < 0.5;
      const sx = edge ? PX + 10 : rand(PX + 40, PX + PW - 40);
      const sy = edge ? rand(PY + 40, PY + PH - 40) : PY + 10;
      const targetX = edge ? PX + PW - 10 : sx + rand(-80, 80);
      const targetY = edge ? sy + rand(-80, 80) : PY + PH - 10;
      const len = Math.hypot(targetX - sx, targetY - sy);
      streak.dx = ((targetX - sx) / len) * 900;
      streak.dy = ((targetY - sy) / len) * 900;
      streak.x = sx;
      streak.y = sy;
    }

    moonMax = d.moonTime;
    moon = moonMax;
    pencils = 2;
    found = false;
    foundAt = -9999;
    advanceAt = null;
    cursor.snap = -1;
    updateHUD();
  }

  function irandIdx(n) {
    return Math.floor(Math.random() * n);
  }

  function startRun() {
    night = 1;
    pairIdx = 0;
    score = 0;
    lives = START_LIVES;
    nightPencils = 0;
    particles.length = 0;
    blinkAuto = false;
    el.padBlink.classList.remove("on");
    el.padBlink.setAttribute("aria-pressed", "false");
    phase = "play";
    paused = false;
    helpOpen = false;
    interlude = false;
    hideOverlays();
    simT = 0;
    buildPair();
    snd.ui();
  }

  // ---------- rules ----------
  function starBrightness(s, t) {
    if (!s.variable) return s.base;
    const wave = Math.sin((t / 1000) * s.variable.speed + s.variable.phase);
    return (
      s.base * (1 - s.variable.depth * 0.5 + s.variable.depth * 0.5 * wave)
    );
  }

  function accuse(idx) {
    if (phase !== "play" || paused || helpOpen || interlude || found) return;
    const s = stars[idx];
    if (!s || s.eliminated) {
      snd.miss();
      return;
    }
    if (idx === moverIdx) {
      logFind();
      return;
    }
    s.eliminated = true;
    s.xFlash = simT;
    if (pencils > 0) {
      pencils--;
      nightPencils++;
      moon = Math.max(200, moon - 4000);
      showBanner("Not the one", "a wax pencil snaps · −4 seconds", 1200);
    } else {
      moon = Math.max(200, moon - 7000);
      showBanner("Not the one", "out of pencils · −7 seconds", 1200);
    }
    snd.deny();
    updateHUD();
  }

  function logFind() {
    found = true;
    foundAt = simT;
    foundPts = 100 * night + Math.ceil((moon / moonMax) * 90);
    score += foundPts;
    snd.chime();
    const m = stars[moverIdx];
    for (let i = 0; i < 12; i++) {
      particles.push({
        x: m.bx + rand(-6, 6),
        y: m.by + rand(-6, 6),
        vx: rand(-34, 34),
        vy: rand(-50, -10),
        life: rand(350, 650),
        maxLife: 650,
        col: "#ffe9a8",
        r: rand(1, 2.4),
      });
    }
    showBanner("Logged!", `+${foundPts} pts`, 1400);
    updateHUD();
    advanceAt = {
      t: simT + 1550,
      action: pairIdx + 1 >= PAIRS_PER_NIGHT ? "nightEnd" : "nextPair",
    };
  }

  function moonFail() {
    lives--;
    snd.fog();
    if (lives <= 0) {
      phase = "over";
      saveBest();
      el.overLine.textContent =
        `The survey ends on night ${ROMAN[night - 1]}. ` +
        `${score} pts · best ${best}.`;
      showOverlay("over");
      updateHUD();
    } else {
      showBanner(
        "Moonrise — the plate fogs",
        `${lives} clear night${lives > 1 ? "s" : ""} left · same pair re-exposed`,
        2100,
      );
      buildPair();
    }
  }

  function finishNight() {
    snd.nightDone();
    const pristine = nightPencils === 0;
    let bonus = 0;
    if (pristine) {
      bonus = 150 + 50 * night;
      score += bonus;
    }
    if (night >= FINAL_NIGHT) {
      phase = "won";
      saveBest();
      el.wonLine.textContent =
        `Five nights, ${FINAL_NIGHT * PAIRS_PER_NIGHT} positions plotted. ` +
        `Final tally ${score} pts · best ${best}. ` +
        `The ledger enters your wanderer as 2026 QX${irandIdx(9) + 1}.`;
      showOverlay("won");
      updateHUD();
      return;
    }
    interlude = true;
    saveBest();
    el.nightHead.textContent = `Night ${ROMAN[night - 1]}'s ledger`;
    el.nightLine.textContent =
      `${PAIRS_PER_NIGHT}/${PAIRS_PER_NIGHT} objects logged` +
      (pristine
        ? ` · flawless plates · pristine bonus +${bonus}`
        : ` · ${nightPencils} pencil${nightPencils === 1 ? "" : "s"} snapped`) +
      ` · running total ${score} pts.`;
    showOverlay("night");
    updateHUD();
  }

  function nextNight() {
    night++;
    pairIdx = 0;
    nightPencils = 0;
    interlude = false;
    hideOverlays();
    buildPair();
    snd.ui();
  }

  function saveBest() {
    if (score > best) {
      best = score;
      try {
        localStorage.setItem("blink-comparator-best", String(best));
      } catch (err) {
        /* private mode, fine */
      }
    }
  }

  // ---------- main loop ----------
  let lastFrame = null;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = lastFrame === null ? 16 : clamp(now - lastFrame, 0, 50);
    lastFrame = now;

    const running = phase === "play" && !paused && !helpOpen && !interlude;

    if (running) {
      simT += dt;
      if (!found) {
        moon -= dt;
        if (moon <= 0) {
          moon = 0;
          moonFail();
        }
      }
      updateView(now);
      moveCursor(dt);
      if (advanceAt && simT >= advanceAt.t) {
        const action = advanceAt.action;
        advanceAt = null;
        if (action === "nextPair") {
          pairIdx++;
          buildPair();
        } else {
          finishNight();
        }
      }
      if (streak && viewPlate === "B") {
        streak.t += dt;
        if (streak.t > 0) {
          streak.x += (streak.dx * dt) / 1000;
          streak.y += (streak.dy * dt) / 1000;
        }
      }
      updateParticles(dt);
    }
    tickBanner(now);
    tickHint(now);
    render(now);
  }

  function updateView(now) {
    let next = "A";
    if (blinkHold) {
      next = "B";
    } else if (blinkAuto) {
      next = Math.floor(simT / 300) % 2 === 0 ? "A" : "B";
    }
    if (next !== viewPlate) {
      viewPlate = next;
      if (now - lastFlipAt > 60) {
        snd.flip();
        lastFlipAt = now;
      }
    }
  }

  function moveCursor(dt) {
    const sp = (dt / 1000) * 340;
    let mx = 0;
    let my = 0;
    if (keys.ArrowLeft) mx -= 1;
    if (keys.ArrowRight) mx += 1;
    if (keys.ArrowUp) my -= 1;
    if (keys.ArrowDown) my += 1;
    if (mx || my) {
      const len = Math.hypot(mx, my) || 1;
      cursor.x = clamp(cursor.x + (mx / len) * sp, PX, PX + PW);
      cursor.y = clamp(cursor.y + (my / len) * sp, PY, PY + PH);
    }
    let bestI = -1;
    let bd = 19;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const x = viewPlate === "A" ? s.ax : s.bx;
      const y = viewPlate === "A" ? s.ay : s.by;
      const dd = Math.hypot(x - cursor.x, y - cursor.y);
      if (dd < bd) {
        bd = dd;
        bestI = i;
      }
    }
    cursor.snap = bestI;
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
      p.vy += (90 * dt) / 1000;
    }
  }

  // ---------- rendering ----------
  function render(now) {
    ctx.clearRect(0, 0, W, H);

    // dome darkness with a faint lamp warmth below
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a1024");
    bg.addColorStop(0.65, "#0b1226");
    bg.addColorStop(1, "#101a30");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const lamp = ctx.createRadialGradient(
      W / 2,
      H + 40,
      30,
      W / 2,
      H + 40,
      320,
    );
    lamp.addColorStop(0, "rgba(255,214,150,0.10)");
    lamp.addColorStop(1, "rgba(255,214,150,0)");
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, W, H);

    drawPlateFrame(now);
    drawGrain();
    drawDust();
    drawStars(now);
    drawStreak();
    drawTicks();
    drawFound(now);
    drawParticles();
    drawCursorReticle(now);
    drawLabels();

    // frost + vignette
    const vig = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.38,
      W / 2,
      H / 2,
      H * 0.92,
    );
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(4,7,15,0.5)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
    const frost = ctx.createLinearGradient(0, 0, 0, 90);
    frost.addColorStop(0, "rgba(170,200,235,0.07)");
    frost.addColorStop(1, "rgba(170,200,235,0)");
    ctx.fillStyle = frost;
    ctx.fillRect(0, 0, W, 90);
  }

  function drawPlateFrame(now) {
    // glass plate
    ctx.fillStyle = "#0c1526";
    roundRect(PX, PY, PW, PH, 10);
    ctx.fill();
    // frame
    ctx.strokeStyle = "rgba(205,218,232,0.5)";
    ctx.lineWidth = 2;
    roundRect(PX - 8, PY - 8, PW + 16, PH + 16, 12);
    ctx.stroke();
    ctx.strokeStyle = "rgba(205,218,232,0.22)";
    ctx.lineWidth = 1;
    roundRect(PX - 13, PY - 13, PW + 26, PH + 26, 14);
    ctx.stroke();

    // brass clips
    ctx.fillStyle = "rgba(255,217,138,0.55)";
    [
      [PX - 10, PY - 10],
      [PX + PW + 2, PY - 10],
      [PX - 10, PY + PH + 2],
      [PX + PW + 2, PY + PH + 2],
    ].forEach(([cx2, cy2]) => {
      ctx.beginPath();
      ctx.arc(cx2 + 4, cy2 + 4, 3.4, 0, TAU);
      ctx.fill();
    });

    // eyepiece brackets
    ctx.strokeStyle = "rgba(255,217,138,0.5)";
    ctx.lineWidth = 3;
    const b = 26;
    const off = 22;
    const corners = [
      [PX - off, PY - off, 1, 1],
      [PX + PW + off, PY - off, -1, 1],
      [PX - off, PY + PH + off, 1, -1],
      [PX + PW + off, PY + PH + off, -1, -1],
    ];
    corners.forEach(([cx2, cy2, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(cx2 + sx * b, cy2);
      ctx.lineTo(cx2, cy2);
      ctx.lineTo(cx2, cy2 + sy * b);
      ctx.stroke();
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.rect(x, y, w, h);
    }
  }

  function drawGrain() {
    const g = viewPlate === "A" ? grainA : grainB;
    for (const sp of g) {
      ctx.fillStyle = sp.light ? "rgba(220,230,245,0.045)" : "rgba(0,0,0,0.09)";
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.r, 0, TAU);
      ctx.fill();
    }
  }

  function drawDust() {
    for (const d of dust) {
      if (viewPlate === "A" && !d.onA) continue;
      if (viewPlate === "B" && d.onA) continue;
      ctx.fillStyle = "rgba(215,225,240,0.16)";
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(215,225,240,0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r + 1.6, 0, TAU);
      ctx.stroke();
    }
  }

  function drawStars(now) {
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const x = viewPlate === "A" ? s.ax : s.bx;
      const y = viewPlate === "A" ? s.ay : s.by;
      const bright = clamp(starBrightness(s, simT), 0.12, 1);

      const tw = 0.9 + 0.1 * Math.sin(now / 700 + i * 2.1);
      const glowR = s.r * 3.1;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
      glow.addColorStop(0, `rgba(205,222,250,${0.32 * bright * tw})`);
      glow.addColorStop(1, "rgba(205,222,250,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, TAU);
      ctx.fill();

      ctx.fillStyle = `rgba(235,242,252,${bright})`;
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, TAU);
      ctx.fill();
      if (s.r > 2.5) {
        ctx.strokeStyle = `rgba(235,242,252,${bright * 0.55})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - s.r * 2.4, y);
        ctx.lineTo(x + s.r * 2.4, y);
        ctx.moveTo(x, y - s.r * 2.4);
        ctx.lineTo(x, y + s.r * 2.4);
        ctx.stroke();
      }

      if (s.eliminated) {
        const fade = clamp(1 - (simT - s.xFlash) / 2600, 0.25, 1);
        ctx.strokeStyle = `rgba(255,110,90,${fade})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x - 5, y - 5);
        ctx.lineTo(x + 5, y + 5);
        ctx.moveTo(x + 5, y - 5);
        ctx.lineTo(x - 5, y + 5);
        ctx.stroke();
      }
    }
  }

  function drawStreak() {
    if (!streak || viewPlate !== "B") return;
    if (streak.t <= 0 || streak.x < PX || streak.x > PX + PW) return;
    const tailX = streak.x - (streak.dx / 900) * 46;
    const tailY = streak.y - (streak.dy / 900) * 46;
    const grad = ctx.createLinearGradient(tailX, tailY, streak.x, streak.y);
    grad.addColorStop(0, "rgba(180,210,240,0)");
    grad.addColorStop(1, "rgba(220,235,255,0.85)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(streak.x, streak.y);
    ctx.stroke();
  }

  function drawTicks() {
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = "rgba(150,175,210,0.4)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let c = 0; c < 8; c++) {
      const x = PX + ((c + 0.5) * PW) / 8;
      ctx.fillText(String.fromCharCode(65 + c), x, PY - 22);
    }
    for (let rr = 0; rr < 6; rr++) {
      const y = PY + ((rr + 0.5) * PH) / 6;
      ctx.fillText(String(rr + 1), PX - 24, y);
    }
  }

  function drawFound(now) {
    if (!found || moverIdx < 0) return;
    const m = stars[moverIdx];
    const age = simT - foundAt;
    const pulse = 1 + Math.sin(now / 160) * 0.08;

    ctx.strokeStyle = "rgba(255,217,138,0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(m.ax, m.ay, 11 * pulse, 0, TAU);
    ctx.stroke();

    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "rgba(255,217,138,0.6)";
    ctx.beginPath();
    ctx.moveTo(m.ax, m.ay);
    ctx.lineTo(m.bx, m.by);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(255,217,138,0.85)";
    ctx.beginPath();
    ctx.arc(m.bx, m.by, 3.4, 0, TAU);
    ctx.fill();

    if (age < 1400) {
      ctx.globalAlpha = clamp(1 - age / 1400, 0, 1);
      ctx.fillStyle = "#ffe9bf";
      ctx.font = "bold 17px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`+${foundPts}`, m.ax, m.ay - 20 - age / 40);
      ctx.globalAlpha = 1;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawCursorReticle(now) {
    if (phase !== "play") return;
    const s = cursor.snap >= 0 ? stars[cursor.snap] : null;
    const x = s ? (viewPlate === "A" ? s.ax : s.bx) : cursor.x;
    const y = s ? (viewPlate === "A" ? s.ay : s.by) : cursor.y;
    const r = s ? 10 : 7;
    ctx.strokeStyle = s ? "rgba(255,217,138,0.95)" : "rgba(160,185,220,0.5)";
    ctx.lineWidth = s ? 2 : 1.2;
    ctx.beginPath();
    ctx.arc(x, y, r + Math.sin(now / 220) * (s ? 1 : 0), 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r - 6, y);
    ctx.lineTo(x - r - 1, y);
    ctx.moveTo(x + r + 1, y);
    ctx.lineTo(x + r + 6, y);
    ctx.moveTo(x, y - r - 6);
    ctx.lineTo(x, y - r - 1);
    ctx.moveTo(x, y + r + 1);
    ctx.lineTo(x, y + r + 6);
    ctx.stroke();
  }

  function drawLabels() {
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // which exposure you are seeing
    const isA = viewPlate === "A";
    ctx.fillStyle = isA ? "rgba(160,185,220,0.85)" : "rgba(255,217,138,0.95)";
    ctx.fillText(
      isA ? "PLATE A — LAST NIGHT" : "PLATE B — TONIGHT",
      PX,
      PY + PH + 30,
    );
    ctx.fillStyle = "rgba(120,145,180,0.55)";
    ctx.fillText(
      `field ${String.fromCharCode(65 + irandStatic)}${irandStatic + 1} · 40 min exposure`,
      PX,
      PY + PH + 46,
    );

    // pencils
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(160,185,220,0.75)";
    ctx.fillText("PENCILS", PX + PW, PY - 22);
    for (let i = 0; i < 2; i++) {
      const cx2 = PX + PW - 10 - i * 16;
      const cy2 = PY - 42;
      ctx.beginPath();
      ctx.arc(cx2, cy2, 5, 0, TAU);
      if (i < pencils) {
        ctx.fillStyle = "rgba(255,217,138,0.9)";
        ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(255,110,90,0.6)";
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
  }

  // stable flavour values so labels do not flicker
  const irandStatic = Math.floor(Math.random() * 8);

  // ---------- HUD / overlays ----------
  function updateHUD() {
    el.moonFill.style.transform = `scaleX(${clamp(moon / moonMax, 0, 1)})`;
    el.moonWrap.classList.toggle("warn", moon / moonMax < 0.28);
    el.score.textContent = `${score} pts`;
    let lv = "";
    for (let i = 0; i < START_LIVES; i++) {
      lv += i < lives ? "●" : '<span class="spent">●</span>';
    }
    el.lives.innerHTML = lv;
    el.chipNight.textContent = `Night ${ROMAN[clamp(night, 1, 5) - 1]} · Plate pair ${pairIdx + 1} of ${PAIRS_PER_NIGHT}`;
  }

  let bannerHideAt = 0;
  function showBanner(big, small, dur) {
    el.bannerBig.textContent = big;
    el.bannerSmall.textContent = small || "";
    el.banner.classList.remove("hidden");
    requestAnimationFrame(() => el.banner.classList.add("show"));
    bannerHideAt = performance.now() + (dur || 1800);
  }

  function tickBanner(now) {
    if (bannerHideAt && now > bannerHideAt) {
      el.banner.classList.remove("show");
      bannerHideAt = 0;
    }
  }

  function showOverlay(name) {
    hideOverlays();
    el.overlays[name].classList.remove("hidden");
  }

  function hideOverlays() {
    for (const key in el.overlays) {
      el.overlays[key].classList.add("hidden");
    }
  }

  const HINTS = [
    "Hold SPACE to blink — watch for the star that jumps.",
    "Variables pulse where they stand. Dust never appears on both plates.",
    "Tap the jumper early: the haste bonus grows as moonrise nears.",
    "Two wax pencils a pair. Spend them like blood.",
    "Satellites streak and vanish. That is not your wanderer.",
  ];
  let hintIdx = 0;
  let hintAt = 0;
  function tickHint(now) {
    if (phase === "play" && now > hintAt) {
      hintAt = now + 8000;
      el.hint.textContent = HINTS[hintIdx % HINTS.length];
      hintIdx++;
    }
  }

  // ---------- input ----------
  function evtPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    audioCtx();
    if (phase !== "play" || paused || helpOpen || interlude || found) return;
    const p = evtPos(e);
    cursor.x = p.x;
    cursor.y = p.y;
    let hit = -1;
    let hd = 17;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const x = viewPlate === "A" ? s.ax : s.bx;
      const y = viewPlate === "A" ? s.ay : s.by;
      const dd = Math.hypot(x - p.x, y - p.y);
      if (dd < hd) {
        hd = dd;
        hit = i;
      }
    }
    if (hit >= 0) {
      accuse(hit);
    } else if (p.x > PX && p.x < PX + PW && p.y > PY && p.y < PY + PH) {
      moon = Math.max(200, moon - 1000);
      snd.miss();
    }
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  function primaryButtonForState() {
    if (phase === "title") return btn.start;
    if (phase === "over") return btn.retry;
    if (phase === "won") return btn.again;
    if (helpOpen) return btn.helpClose;
    if (paused && !el.overlays.pause.classList.contains("hidden"))
      return btn.resume;
    if (!el.overlays.night.classList.contains("hidden")) return btn.nextNight;
    return null;
  }

  document.addEventListener("keydown", (e) => {
    const key = e.key;
    if (key === "m" || key === "M") {
      toggleMute();
      return;
    }
    if (key === "r" || key === "R") {
      if (phase !== "title") startRun();
      return;
    }
    if (key === "?" || key === "h" || key === "H") {
      if (phase === "play") toggleHelp();
      return;
    }
    if (key === "Escape") {
      if (helpOpen) toggleHelp();
      return;
    }
    if (key === "p" || key === "P") {
      if (phase === "play" && !helpOpen) togglePause();
      return;
    }
    if (key === " ") {
      e.preventDefault();
      if (primaryButtonForState()) {
        pressPrimary();
        return;
      }
      blinkHold = true;
      return;
    }
    if (key === "Enter") {
      e.preventDefault();
      const pb = primaryButtonForState();
      if (pb) {
        pressPrimary();
        return;
      }
      if (
        phase === "play" &&
        !paused &&
        !helpOpen &&
        !interlude &&
        cursor.snap >= 0
      ) {
        accuse(cursor.snap);
      }
      return;
    }
    if (key.startsWith("Arrow")) {
      if (phase === "play" && !paused && !helpOpen && !interlude)
        e.preventDefault();
      keys[key] = true;
      return;
    }
    if (key >= "0" && key <= "9") {
      // coordinates quick-jump: rows 1-6
      const row = Number(key);
      if (
        row >= 1 &&
        row <= 6 &&
        phase === "play" &&
        !paused &&
        !helpOpen &&
        !interlude
      ) {
        cursor.y = PY + ((row - 0.5) * PH) / 6;
      }
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.key === " ") blinkHold = false;
    if (e.key.startsWith("Arrow")) keys[e.key] = false;
  });

  function pressPrimary() {
    const now = performance.now();
    if (now - lastPrimaryAt < 220) return;
    const pb = primaryButtonForState();
    if (pb) {
      lastPrimaryAt = now;
      pb.click();
    }
  }

  // ---------- buttons ----------
  btn.start.addEventListener("click", () => startRun());
  btn.help.addEventListener("click", () => toggleHelp());
  btn.helpClose.addEventListener("click", () => toggleHelp());
  btn.pause.addEventListener("click", () => {
    if (phase === "play" && !helpOpen) togglePause();
  });
  btn.mute.addEventListener("click", () => toggleMute());
  btn.restart.addEventListener("click", () => {
    if (phase !== "title") startRun();
  });
  btn.resume.addEventListener("click", () => togglePause());
  btn.nextNight.addEventListener("click", () => nextNight());
  btn.retry.addEventListener("click", () => startRun());
  btn.again.addEventListener("click", () => startRun());

  el.padBlink.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    audioCtx();
    blinkAuto = !blinkAuto;
    el.padBlink.classList.toggle("on", blinkAuto);
    el.padBlink.setAttribute("aria-pressed", blinkAuto ? "true" : "false");
    snd.ui();
  });

  function togglePause() {
    if (phase !== "play") return;
    paused = !paused;
    if (paused) {
      showOverlay("pause");
    } else {
      hideOverlays();
      snd.ui();
    }
  }

  function toggleHelp() {
    if (phase !== "play") return;
    helpOpen = !helpOpen;
    if (helpOpen) {
      showOverlay("help");
    } else {
      hideOverlays();
    }
  }

  function toggleMute() {
    muted = !muted;
    btn.mute.textContent = muted ? "×" : "♪";
    if (!muted) snd.ui();
  }

  window.addEventListener("blur", () => {
    blinkHold = false;
    for (const k in keys) keys[k] = false;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && phase === "play" && !paused && !helpOpen) {
      togglePause();
    }
    lastFrame = null;
  });

  // ---------- responsive canvas ----------
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.round(rect.width * dpr));
    const ph = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(pw / W, 0, 0, ph / H, 0, 0);
  }
  window.addEventListener("resize", resize);

  // ---------- debug hook (used by automated tests; harmless otherwise) ----------
  window.__blinkComparator = {
    get phase() {
      return phase;
    },
    get night() {
      return night;
    },
    get pairIdx() {
      return pairIdx;
    },
    get score() {
      return score;
    },
    get lives() {
      return lives;
    },
    get viewPlate() {
      return viewPlate;
    },
    get paused() {
      return paused;
    },
    get pencils() {
      return pencils;
    },
    get found() {
      return found;
    },
    stars() {
      return stars.map((s, i) => ({
        i,
        ax: s.ax,
        ay: s.ay,
        bx: s.bx,
        by: s.by,
        isMover: s.isMover,
        eliminated: s.eliminated,
      }));
    },
    probe(x, y) {
      let hit = -1;
      let hd = 17;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const sx2 = viewPlate === "A" ? s.ax : s.bx;
        const sy2 = viewPlate === "A" ? s.ay : s.by;
        const dd = Math.hypot(sx2 - x, sy2 - y);
        if (dd < hd) {
          hd = dd;
          hit = i;
        }
      }
      return hit;
    },
    mover() {
      const m = stars[moverIdx];
      return m ? { ax: m.ax, ay: m.ay, bx: m.bx, by: m.by } : null;
    },
    starCount() {
      return stars.length;
    },
    accuse(i) {
      accuse(i);
    },
    forceFind() {
      if (phase === "play" && !found) logFind();
    },
    drainMoon() {
      moon = 0.001;
    },
  };

  // ---------- boot ----------
  resize();
  buildPair(); // dress the scope behind the title card
  phase = "title";
  updateHUD();
  requestAnimationFrame(frame);
})();
