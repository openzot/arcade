"use strict";

(() => {
  /* ------------------------------------------------------------------ *
   * Penumbra - your halo of light is your health.                       *
   * It drains constantly; blooms smother it; embers refill it.          *
   * ------------------------------------------------------------------ */

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  };

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const el = {
    lightFill: document.getElementById("light-fill"),
    wave: document.getElementById("stat-wave"),
    score: document.getElementById("stat-score"),
    best: document.getElementById("stat-best"),
    pause: document.getElementById("btn-pause"),
    mute: document.getElementById("btn-mute"),
    restart: document.getElementById("btn-restart"),
    start: document.getElementById("btn-start"),
    resume: document.getElementById("btn-resume"),
    quit: document.getElementById("btn-quit"),
    again: document.getElementById("btn-again"),
    endless: document.getElementById("btn-endless"),
    screenStart: document.getElementById("screen-start"),
    screenPause: document.getElementById("screen-pause"),
    screenOver: document.getElementById("screen-over"),
    overTitle: document.getElementById("over-title"),
    overLine: document.getElementById("over-line"),
    overScore: document.getElementById("over-score"),
    overWave: document.getElementById("over-wave"),
    overBest: document.getElementById("over-best"),
  };

  /* ----------------------------- storage ---------------------------- */

  const store = {
    get(key, fallback) {
      try {
        const v = window.localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch (err) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (err) {
        /* private mode, file:// quirks - play on without saving */
      }
    },
  };

  /* ------------------------------ audio ----------------------------- */

  const sound = {
    ctx: null,
    master: null,
    muted: store.get("penumbra.muted", false),
    ensure() {
      if (this.ctx || typeof window.AudioContext !== "function") return;
      try {
        this.ctx = new window.AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
      } catch (err) {
        this.ctx = null;
      }
    },
    resume() {
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },
    setMuted(m) {
      this.muted = m;
      store.set("penumbra.muted", m);
      if (this.master) this.master.gain.value = m ? 0 : 0.5;
      el.mute.classList.toggle("muted", m);
    },
    tone(freq, endFreq, dur, type, vol, delay) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + (delay || 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(endFreq, 1),
        t0 + dur,
      );
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    shoot() {
      this.tone(340, 190, 0.07, "square", 0.06);
    },
    hit() {
      this.tone(160, 120, 0.05, "triangle", 0.09);
    },
    pop(size) {
      this.tone(520 + size * 40, 900 + size * 60, 0.09, "square", 0.08);
      this.tone(220, 110, 0.12, "triangle", 0.07, 0.02);
    },
    ember() {
      this.tone(680, 1020, 0.09, "sine", 0.1);
    },
    hurt() {
      this.tone(130, 55, 0.28, "sawtooth", 0.22);
    },
    wave() {
      this.tone(392, 392, 0.14, "triangle", 0.12);
      this.tone(523, 523, 0.14, "triangle", 0.12, 0.13);
      this.tone(659, 659, 0.2, "triangle", 0.12, 0.26);
    },
    death() {
      this.tone(320, 42, 0.9, "sawtooth", 0.22);
      this.tone(180, 30, 1.1, "triangle", 0.16, 0.05);
    },
    win() {
      const notes = [523, 659, 784, 1046];
      notes.forEach((n, i) =>
        this.tone(n, n, 0.22, "triangle", 0.13, i * 0.14),
      );
    },
  };

  /* ------------------------------ world ------------------------------ */

  const MAX_LIGHT = 170;
  const START_LIGHT = 148;
  const DIE_LIGHT = 26;
  const FINAL_WAVE = 10;

  let W = 960;
  let H = 600;

  const state = {
    mode: "menu", // menu | playing | paused | over | won
    time: 0,
    score: 0,
    best: store.get("penumbra.best", 0),
    wave: 1,
    endless: false,
    phase: "idle", // announce | spawning | clearing | done
    phaseT: 0,
    queue: [],
    spawnT: 0,
    shake: 0,
    flash: 0,
    banner: "",
    bannerSub: "",
    bannerT: 0,
  };

  const player = {
    x: 480,
    y: 300,
    vx: 0,
    vy: 0,
    r: 11,
    light: START_LIGHT,
    inv: 0,
    aim: 0,
    fireCd: 0,
  };

  let bullets = [];
  let enemies = [];
  let embers = [];
  let particles = [];
  let floaters = [];
  let warnings = [];

  /* ------------------------------ input ------------------------------ */

  const keys = new Set();
  const pointer = { x: W / 2, y: H / 2, down: false };
  const moveStick = { active: false, ox: 0, oy: 0, x: 0, y: 0, id: -1 };
  const aimStick = { active: false, ox: 0, oy: 0, x: 0, y: 0, id: -1 };
  let touchMode = false;

  function keyToDir() {
    let dx = 0;
    let dy = 0;
    if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
    if (keys.has("arrowright") || keys.has("d")) dx += 1;
    if (keys.has("arrowup") || keys.has("w")) dy -= 1;
    if (keys.has("arrowdown") || keys.has("s")) dy += 1;
    return [dx, dy];
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (
      [
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
        " ",
        "spacebar",
      ].includes(k)
    ) {
      e.preventDefault();
    }
    if (e.repeat) return;
    keys.add(k === "spacebar" ? " " : k);
    sound.ensure();
    sound.resume();

    if (k === "m") {
      sound.setMuted(!sound.muted);
      return;
    }
    if (state.mode === "menu" && (k === "enter" || k === " ")) {
      startGame();
      return;
    }
    if ((state.mode === "over" || state.mode === "won") && k === "enter") {
      startGame();
      return;
    }
    if (k === "p") {
      if (state.mode === "playing") pauseGame();
      else if (state.mode === "paused") resumeGame();
      return;
    }
    if (k === "r" && state.mode !== "menu") {
      startGame();
    }
  });

  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k === "spacebar" ? " " : k);
  });

  function canvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return [
      ((clientX - rect.left) / rect.width) * W,
      ((clientY - rect.top) / rect.height) * H,
    ];
  }

  canvas.addEventListener("mousemove", (e) => {
    const p = canvasPoint(e.clientX, e.clientY);
    pointer.x = p[0];
    pointer.y = p[1];
  });
  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    sound.ensure();
    sound.resume();
    const p = canvasPoint(e.clientX, e.clientY);
    pointer.x = p[0];
    pointer.y = p[1];
    pointer.down = true;
  });
  window.addEventListener("mouseup", () => {
    pointer.down = false;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  function stickFrom(t) {
    const p = canvasPoint(t.clientX, t.clientY);
    return { x: p[0], y: p[1], id: t.identifier };
  }

  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      touchMode = true;
      sound.ensure();
      sound.resume();
      for (const t of e.changedTouches) {
        const s = stickFrom(t);
        const stick = s.x < W / 2 ? moveStick : aimStick;
        if (!stick.active) {
          stick.active = true;
          stick.id = s.id;
          stick.ox = s.x;
          stick.oy = s.y;
          stick.x = s.x;
          stick.y = s.y;
        }
      }
    },
    { passive: false },
  );

  canvas.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const s = stickFrom(t);
        const stick =
          moveStick.active && moveStick.id === s.id
            ? moveStick
            : aimStick.active && aimStick.id === s.id
              ? aimStick
              : null;
        if (stick) {
          stick.x = s.x;
          stick.y = s.y;
        }
      }
    },
    { passive: false },
  );

  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (moveStick.id === t.identifier) moveStick.active = false;
      if (aimStick.id === t.identifier) aimStick.active = false;
    }
  }
  canvas.addEventListener("touchend", endTouch);
  canvas.addEventListener("touchcancel", endTouch);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.mode === "playing") pauseGame();
  });

  /* --------------------------- wave building -------------------------- */

  const TYPES = {
    mote: { r: 9, hp: 1, cost: 1, score: 10, dmg: 14, ember: 0.55 },
    drifter: { r: 14, hp: 2, cost: 2, score: 20, dmg: 18, ember: 0.9 },
    splitter: { r: 17, hp: 2, cost: 3, score: 30, dmg: 18, ember: 1 },
    bulwark: { r: 25, hp: 6, cost: 6, score: 80, dmg: 26, ember: 1 },
  };

  function buildQueue(n) {
    let budget = 5 + n * 4;
    const list = [];
    const canDrifter = n >= 2;
    const canSplitter = n >= 4;
    const canBulwark = n >= 5;
    let bulwarks = canBulwark ? Math.min(1 + Math.floor(n / 3), 4) : 0;
    budget -= bulwarks * TYPES.bulwark.cost;
    while (budget > 0) {
      const roll = Math.random();
      if (canSplitter && roll < 0.22 && budget >= 3) {
        list.push("splitter");
        budget -= 3;
      } else if (canDrifter && roll < 0.55 && budget >= 2) {
        list.push("drifter");
        budget -= 2;
      } else {
        list.push("mote");
        budget -= 1;
      }
    }
    for (let i = 0; i < bulwarks; i++) list.push("bulwark");
    // shuffle
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    const interval = clamp(1.0 - n * 0.055, 0.34, 1.0);
    return { list, interval };
  }

  function edgeSpawnPoint() {
    const side = Math.floor(rand(0, 4));
    const pad = 34;
    if (side === 0) return [rand(0, W), -pad];
    if (side === 1) return [rand(0, W), H + pad];
    if (side === 2) return [-pad, rand(0, H)];
    return [W + pad, rand(0, H)];
  }

  function startWave(n) {
    state.wave = n;
    state.phase = "announce";
    state.phaseT = 0;
    const q = buildQueue(n);
    state.queue = q.list;
    state.spawnT = 1.1;
    state.spawnInterval = q.interval;
    banner(
      state.endless ? `wave ${n}` : `wave ${n} of ${FINAL_WAVE}`,
      n % 3 === 0 ? "the dark leans in" : "",
    );
    sound.wave();
  }

  function spawnEnemy(typeName, x, y) {
    const t = TYPES[typeName];
    const wob = [];
    for (let i = 0; i < 7; i++) wob.push(rand(0.82, 1.18));
    enemies.push({
      type: typeName,
      x,
      y,
      vx: 0,
      vy: 0,
      r: t.r,
      hp: typeName === "bulwark" ? t.hp + Math.floor(state.wave / 4) : t.hp,
      born: state.time,
      phase: rand(0, TAU),
      wob,
      hitFlash: 0,
    });
  }

  function spawnWarning(x, y) {
    warnings.push({ x, y, t: 0, dur: 0.75, type: null });
  }

  /* ----------------------------- effects ------------------------------ */

  function burst(x, y, color, count, power) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(power * 0.3, power);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.3, 0.7),
        max: 0.7,
        size: rand(1.5, 3.5),
        color,
      });
    }
    if (particles.length > 420) particles.splice(0, particles.length - 420);
  }

  function floatText(x, y, text, color) {
    floaters.push({ x, y, text, color, life: 0.9, max: 0.9 });
    if (floaters.length > 30) floaters.shift();
  }

  function banner(text, sub) {
    state.banner = text;
    state.bannerSub = sub || "";
    state.bannerT = 2.1;
  }

  /* ------------------------------ combat ------------------------------ */

  function fire() {
    const a = player.aim;
    const spread = rand(-0.026, 0.026);
    const ang = a + spread;
    bullets.push({
      x: player.x + Math.cos(a) * (player.r + 7),
      y: player.y + Math.sin(a) * (player.r + 7),
      px: player.x,
      py: player.y,
      vx: Math.cos(ang) * 560,
      vy: Math.sin(ang) * 560,
      life: 0.95,
    });
    player.vx -= Math.cos(a) * 26;
    player.vy -= Math.sin(a) * 26;
    sound.shoot();
  }

  function killEnemy(e, idx) {
    const t = TYPES[e.type];
    state.score += t.score;
    floatText(e.x, e.y - e.r - 4, `+${t.score}`, "#ffd27a");
    burst(e.x, e.y, enemyColor(e.type), e.type === "bulwark" ? 26 : 12, 190);
    sound.pop(e.type === "bulwark" ? 2 : 1);
    if (Math.random() < t.ember) dropEmber(e.x, e.y, e.type === "bulwark");
    if (e.type === "splitter") {
      for (let i = 0; i < 2; i++) {
        spawnEnemy("mote", e.x + rand(-12, 12), e.y + rand(-12, 12));
      }
    }
    enemies.splice(idx, 1);
  }

  function dropEmber(x, y, rich) {
    embers.push({
      x,
      y,
      vx: rand(-40, 40),
      vy: rand(-40, 40),
      life: 9,
      spin: rand(0, TAU),
      value: rich ? 26 : 15,
    });
  }

  function hurtPlayer(dmg, fx, fy) {
    if (player.inv > 0) return;
    player.light -= dmg;
    player.inv = 0.95;
    state.shake = Math.min(10, 4 + dmg * 0.18);
    state.flash = 0.35;
    sound.hurt();
    burst(player.x, player.y, "#ff8a5e", 14, 220);
    const a = Math.atan2(player.y - fy, player.x - fx);
    player.vx += Math.cos(a) * 240;
    player.vy += Math.sin(a) * 240;
    if (player.light <= DIE_LIGHT) {
      player.light = 0;
      dieOut();
    }
  }

  function dieOut() {
    state.mode = "over";
    burst(player.x, player.y, "#fff3c9", 40, 300);
    burst(player.x, player.y, "#ff8a5e", 30, 220);
    sound.death();
    saveBest();
    el.overTitle.textContent = "the light went out";
    el.overLine.textContent = "the static closes over the place you stood.";
    showOver();
  }

  function winGame() {
    state.mode = "won";
    state.score += 500;
    saveBest();
    sound.win();
    banner("the lattice holds", "");
    el.overTitle.textContent = "the lattice holds";
    el.overLine.textContent = "ten waves burned back. dawn reaches the wires.";
    showOver();
  }

  function saveBest() {
    if (state.score > state.best) {
      state.best = state.score;
      store.set("penumbra.best", state.best);
    }
  }

  function showOver() {
    el.overScore.textContent = String(state.score);
    el.overWave.textContent = String(state.wave);
    el.overBest.textContent = String(state.best);
    el.endless.hidden = state.mode !== "won";
    showScreen(el.screenOver);
  }

  /* ------------------------------- flow ------------------------------- */

  function showScreen(which) {
    for (const s of [el.screenStart, el.screenPause, el.screenOver]) {
      s.hidden = s !== which;
    }
  }

  function hideScreens() {
    for (const s of [el.screenStart, el.screenPause, el.screenOver]) {
      s.hidden = true;
    }
  }

  function startGame() {
    bullets = [];
    enemies = [];
    embers = [];
    particles = [];
    floaters = [];
    warnings = [];
    state.mode = "playing";
    state.time = 0;
    state.score = 0;
    state.endless = false;
    state.shake = 0;
    state.flash = 0;
    player.x = W / 2;
    player.y = H / 2;
    player.vx = 0;
    player.vy = 0;
    player.light = START_LIGHT;
    player.inv = 0;
    player.fireCd = 0;
    hideScreens();
    startWave(1);
    syncHud(true);
  }

  function pauseGame() {
    if (state.mode !== "playing") return;
    state.mode = "paused";
    showScreen(el.screenPause);
  }

  function resumeGame() {
    if (state.mode !== "paused") return;
    state.mode = "playing";
    hideScreens();
  }

  function quitToMenu() {
    state.mode = "menu";
    showScreen(el.screenStart);
  }

  function goEndless() {
    state.endless = true;
    state.mode = "playing";
    hideScreens();
    startWave(state.wave + 1);
  }

  /* ------------------------------ update ------------------------------ */

  function update(dt) {
    state.time += dt;

    /* --- player movement --- */
    let dx = 0;
    let dy = 0;
    if (moveStick.active) {
      const mx = moveStick.x - moveStick.ox;
      const my = moveStick.y - moveStick.oy;
      const len = Math.hypot(mx, my);
      if (len > 6) {
        const f = Math.min(len, 48) / 48;
        dx = (mx / len) * f;
        dy = (my / len) * f;
      }
    } else {
      const [kx, ky] = keyToDir();
      const len = Math.hypot(kx, ky) || 1;
      dx = kx / len;
      dy = ky / len;
    }
    player.vx += dx * 2300 * dt;
    player.vy += dy * 2300 * dt;
    const damp = Math.exp(-7.5 * dt);
    player.vx *= damp;
    player.vy *= damp;
    player.x = clamp(player.x + player.vx * dt, 16, W - 16);
    player.y = clamp(player.y + player.vy * dt, 16, H - 16);

    /* --- aiming --- */
    if (aimStick.active) {
      const ax = aimStick.x - aimStick.ox;
      const ay = aimStick.y - aimStick.oy;
      if (Math.hypot(ax, ay) > 8) player.aim = Math.atan2(ay, ax);
    } else if (!touchMode) {
      player.aim = Math.atan2(pointer.y - player.y, pointer.x - player.x);
    }

    /* --- firing --- */
    player.fireCd -= dt;
    const wantFire = pointer.down || keys.has(" ") || aimStick.active;
    if (wantFire && player.fireCd <= 0) {
      fire();
      player.fireCd = 0.15;
    }

    /* --- light drain --- */
    const drain = 1.15 + state.wave * 0.11;
    player.light -= drain * dt;
    player.inv = Math.max(0, player.inv - dt);
    if (player.light <= DIE_LIGHT) {
      player.light = 0;
      dieOut();
      return;
    }

    /* --- wave director --- */
    state.phaseT += dt;
    if (state.phase === "announce") {
      if (state.phaseT > 1.35) {
        state.phase = "spawning";
        state.phaseT = 0;
      }
    } else if (state.phase === "spawning") {
      state.spawnT -= dt;
      if (state.spawnT <= 0 && state.queue.length) {
        const type = state.queue.shift();
        const [sx, sy] = edgeSpawnPoint();
        warnings.push({ x: sx, y: sy, t: 0, dur: 0.7, type });
        state.spawnT = state.spawnInterval * rand(0.75, 1.25);
      }
      if (!state.queue.length) {
        state.phase = "clearing";
        state.phaseT = 0;
      }
    } else if (state.phase === "clearing") {
      if (!enemies.length && !warnings.length) {
        const bonus = 40 + state.wave * 10;
        state.score += bonus;
        player.light = Math.min(MAX_LIGHT, player.light + 26);
        floatText(player.x, player.y - 26, `wave clear +${bonus}`, "#57e6c9");
        if (!state.endless && state.wave >= FINAL_WAVE) {
          winGame();
          return;
        }
        startWave(state.wave + 1);
      }
    }

    /* --- warnings hatch into blooms --- */
    for (let i = warnings.length - 1; i >= 0; i--) {
      const w = warnings[i];
      w.t += dt;
      if (w.t >= w.dur) {
        const [ix, iy] = pullInside(w.x, w.y);
        spawnEnemy(w.type, ix, iy);
        warnings.splice(i, 1);
      }
    }

    /* --- enemies --- */
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const age = state.time - e.born;
      const hatch = clamp(age / 0.45, 0, 1);
      const a = Math.atan2(player.y - e.y, player.x - e.x);
      let sp =
        e.type === "mote"
          ? 76 + state.wave * 2.6
          : e.type === "drifter"
            ? 46 + state.wave * 1.7
            : e.type === "splitter"
              ? 42 + state.wave * 1.5
              : 26 + state.wave * 0.8;
      sp = Math.min(sp, 165);
      // the light weighs on them
      if (dist2(e.x, e.y, player.x, player.y) < player.light * player.light) {
        sp *= 0.72;
      }
      e.vx += (Math.cos(a) * sp - e.vx) * 3.2 * dt;
      e.vy += (Math.sin(a) * sp - e.vy) * 3.2 * dt;

      // gentle separation so blooms read as individuals
      for (let j = i - 1; j >= 0; j--) {
        const o = enemies[j];
        const rr = (e.r + o.r) * 0.9;
        const d2 = dist2(e.x, e.y, o.x, o.y);
        if (d2 < rr * rr && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const push = ((rr - d) / d) * 30 * dt;
          e.x += ((e.x - o.x) / d) * push * 60 * dt;
          e.y += ((e.y - o.y) / d) * push * 60 * dt;
        }
      }

      e.x += e.vx * hatch * dt;
      e.y += e.vy * hatch * dt;
      e.hitFlash = Math.max(0, e.hitFlash - dt * 5);

      if (hatch >= 1) {
        const rr = e.r + player.r;
        if (dist2(e.x, e.y, player.x, player.y) < rr * rr) {
          hurtPlayer(TYPES[e.type].dmg, e.x, e.y);
          const away = Math.atan2(e.y - player.y, e.x - player.x);
          e.vx = Math.cos(away) * 260;
          e.vy = Math.sin(away) * 260;
          e.x += Math.cos(away) * 6;
          e.y += Math.sin(away) * 6;
        }
      }
    }

    /* --- bullets --- */
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.px = b.x;
      b.py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let dead =
        b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20;
      if (!dead) {
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (state.time - e.born < 0.15) continue;
          const rr = e.r + 4;
          if (dist2(b.x, b.y, e.x, e.y) < rr * rr) {
            e.hp -= 1;
            e.hitFlash = 1;
            dead = true;
            burst(b.x, b.y, "#fff3c9", 4, 120);
            sound.hit();
            if (e.hp <= 0) killEnemy(e, j);
            break;
          }
        }
      }
      if (dead) bullets.splice(i, 1);
    }

    /* --- embers --- */
    for (let i = embers.length - 1; i >= 0; i--) {
      const em = embers[i];
      em.life -= dt;
      em.spin += dt * 2.4;
      em.vx *= Math.exp(-2 * dt);
      em.vy *= Math.exp(-2 * dt);
      const d2p = dist2(em.x, em.y, player.x, player.y);
      if (d2p < 130 * 130) {
        const d = Math.sqrt(d2p) || 1;
        em.vx += ((player.x - em.x) / d) * 620 * dt;
        em.vy += ((player.y - em.y) / d) * 620 * dt;
      }
      em.x += em.vx * dt;
      em.y += em.vy * dt;
      if (d2p < (player.r + 10) * (player.r + 10)) {
        player.light = Math.min(MAX_LIGHT, player.light + em.value);
        floatText(player.x, player.y - 22, `+${em.value}`, "#ffd27a");
        burst(em.x, em.y, "#ffd27a", 8, 130);
        sound.ember();
        embers.splice(i, 1);
      } else if (em.life <= 0) {
        embers.splice(i, 1);
      }
    }

    /* --- particles & floaters --- */
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-3 * dt);
      p.vy *= Math.exp(-3 * dt);
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt;
      f.y -= 26 * dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }

    state.shake = Math.max(0, state.shake - dt * 26);
    state.flash = Math.max(0, state.flash - dt * 2.4);
    state.bannerT = Math.max(0, state.bannerT - dt);
  }

  function pullInside(x, y) {
    return [clamp(x, 24, W - 24), clamp(y, 24, H - 24)];
  }

  /* ------------------------------ render ------------------------------ */

  const COLORS = {
    mote: "#c05cff",
    drifter: "#5cb8ff",
    splitter: "#63f2d8",
    bulwark: "#7a5cff",
  };

  function enemyColor(type) {
    return COLORS[type] || "#c05cff";
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (state.shake > 0.2) {
      ctx.translate(
        rand(-state.shake, state.shake),
        rand(-state.shake, state.shake),
      );
    }

    /* backdrop */
    ctx.fillStyle = "#04050a";
    ctx.fillRect(-12, -12, W + 24, H + 24);
    drawGrid();

    /* embers */
    for (const em of embers) {
      const blink = em.life < 2 && Math.floor(em.life * 8) % 2 === 0;
      if (blink) continue;
      drawEmber(em);
    }

    /* warnings */
    for (const w of warnings) {
      const p = w.t / w.dur;
      const [ix, iy] = pullInside(w.x, w.y);
      ctx.strokeStyle = `rgba(192,92,255,${0.25 + 0.45 * p})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ix, iy, 16 - 10 * p, 0, TAU);
      ctx.stroke();
    }

    /* enemies */
    for (const e of enemies) {
      drawEnemy(e);
    }

    /* bullets */
    ctx.lineCap = "round";
    for (const b of bullets) {
      ctx.strokeStyle = "rgba(255,236,180,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.px, b.py);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    /* player */
    if (state.mode !== "over") drawPlayer();

    /* particles */
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    /* darkness beyond the halo */
    drawDarkness();

    /* floaters above the dark */
    ctx.textAlign = "center";
    ctx.font = "600 13px ui-rounded, 'Segoe UI', system-ui, sans-serif";
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life / f.max, 0, 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    /* hurt flash */
    if (state.flash > 0.01) {
      ctx.fillStyle = `rgba(255,90,70,${state.flash * 0.28})`;
      ctx.fillRect(-12, -12, W + 24, H + 24);
    }

    drawBanner();
    if (touchMode) drawSticks();
  }

  function drawGrid() {
    ctx.strokeStyle = "rgba(122,142,205,0.055)";
    ctx.lineWidth = 1;
    const step = 52;
    ctx.beginPath();
    for (let x = step; x < W; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = step; y < H; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
  }

  function drawPlayer() {
    const L = player.light;
    const blink = player.inv > 0 && Math.floor(player.inv * 14) % 2 === 0;

    // halo rim
    ctx.strokeStyle = "rgba(255,210,122,0.22)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 9]);
    ctx.beginPath();
    ctx.arc(player.x, player.y, L, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // soft inner glow floor
    const g = ctx.createRadialGradient(
      player.x,
      player.y,
      0,
      player.x,
      player.y,
      L,
    );
    g.addColorStop(0, "rgba(255,222,150,0.16)");
    g.addColorStop(0.55, "rgba(255,180,110,0.05)");
    g.addColorStop(1, "rgba(255,170,100,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(player.x, player.y, L, 0, TAU);
    ctx.fill();

    // core
    ctx.save();
    if (blink) ctx.globalAlpha = 0.45;
    const cg = ctx.createRadialGradient(
      player.x - 2,
      player.y - 2,
      1,
      player.x,
      player.y,
      player.r + 7,
    );
    cg.addColorStop(0, "#ffffff");
    cg.addColorStop(0.4, "#ffe9ad");
    cg.addColorStop(1, "rgba(255,138,94,0)");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r + 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#fffdf4";
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r * 0.62, 0, TAU);
    ctx.fill();
    // aim tick
    ctx.strokeStyle = "rgba(255,240,200,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(
      player.x + Math.cos(player.aim) * (player.r + 3),
      player.y + Math.sin(player.aim) * (player.r + 3),
    );
    ctx.lineTo(
      player.x + Math.cos(player.aim) * (player.r + 12),
      player.y + Math.sin(player.aim) * (player.r + 12),
    );
    ctx.stroke();
    ctx.restore();

    // low-light warning ring
    if (L < 62) {
      const pulse = 0.4 + 0.35 * Math.sin(state.time * 9);
      ctx.strokeStyle = `rgba(255,110,80,${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r + 14, 0, TAU);
      ctx.stroke();
    }
  }

  function drawEnemy(e) {
    const age = state.time - e.born;
    const hatch = clamp(age / 0.45, 0, 1);
    const col = enemyColor(e.type);
    const wob = e.wob;
    const t = state.time * 4.6 + e.phase;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(hatch, hatch);
    ctx.beginPath();
    const pts = wob.length;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * TAU;
      const rr = e.r * wob[i % pts] * (1 + 0.09 * Math.sin(t + i * 1.7));
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.82;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = e.hitFlash > 0 ? "#ffffff" : col;
    ctx.lineWidth = e.hitFlash > 0 ? 2.5 : 1.4;
    ctx.stroke();
    // cold core
    ctx.fillStyle = "rgba(6,8,16,0.85)";
    ctx.beginPath();
    ctx.arc(0, 0, e.r * 0.36, 0, TAU);
    ctx.fill();
    if (e.type === "bulwark") {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 0.62, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEmber(em) {
    ctx.save();
    ctx.translate(em.x, em.y);
    ctx.rotate(em.spin);
    const s = 5 + Math.sin(em.spin * 2) * 1.2;
    ctx.fillStyle = "#ffd27a";
    ctx.shadowColor = "rgba(255,210,122,0.9)";
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.7, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(-s * 0.7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawDarkness() {
    const L = player.light;
    const far = Math.max(L * 2.3, 260);
    const g = ctx.createRadialGradient(
      player.x,
      player.y,
      L * 0.55,
      player.x,
      player.y,
      far,
    );
    g.addColorStop(0, "rgba(3,4,9,0)");
    g.addColorStop(clamp(L / far, 0, 1), "rgba(3,4,9,0.55)");
    g.addColorStop(1, "rgba(3,4,9,0.94)");
    ctx.fillStyle = g;
    ctx.fillRect(-12, -12, W + 24, H + 24);
  }

  function drawBanner() {
    if (state.bannerT <= 0) return;
    const a = clamp(state.bannerT / 0.6, 0, 1);
    ctx.textAlign = "center";
    ctx.globalAlpha = a;
    ctx.fillStyle = "#ffe9ad";
    ctx.font = "700 30px ui-rounded, 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(state.banner.toUpperCase(), W / 2, 74);
    if (state.bannerSub) {
      ctx.font = "italic 15px ui-rounded, 'Segoe UI', system-ui, sans-serif";
      ctx.fillStyle = "#9aa3ba";
      ctx.fillText(state.bannerSub, W / 2, 98);
    }
    ctx.globalAlpha = 1;
  }

  function drawSticks() {
    for (const st of [moveStick, aimStick]) {
      if (!st.active) continue;
      const col = st === moveStick ? "rgba(232,236,244," : "rgba(255,210,122,";
      ctx.strokeStyle = col + "0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(st.ox, st.oy, 44, 0, TAU);
      ctx.stroke();
      let kx = st.x - st.ox;
      let ky = st.y - st.oy;
      const len = Math.hypot(kx, ky);
      if (len > 44) {
        kx = (kx / len) * 44;
        ky = (ky / len) * 44;
      }
      ctx.fillStyle = col + "0.5)";
      ctx.beginPath();
      ctx.arc(st.ox + kx, st.oy + ky, 17, 0, TAU);
      ctx.fill();
    }
  }

  /* -------------------------------- hud -------------------------------- */

  let hudCache = { score: -1, wave: "", best: -1 };

  function syncHud(force) {
    const pct = clamp(
      ((player.light - DIE_LIGHT) / (MAX_LIGHT - DIE_LIGHT)) * 100,
      0,
      100,
    );
    el.lightFill.style.width = `${pct.toFixed(1)}%`;
    if (force || state.score !== hudCache.score) {
      el.score.textContent = String(state.score);
      hudCache.score = state.score;
    }
    if (force || state.wave !== hudCache.wave) {
      el.wave.textContent = state.endless
        ? `${state.wave} ∞`
        : `${state.wave}/${FINAL_WAVE}`;
      hudCache.wave = state.wave;
    }
    if (force || state.best !== hudCache.best) {
      el.best.textContent = String(state.best);
      hudCache.best = state.best;
    }
  }

  /* ------------------------------- loop -------------------------------- */

  let DPR = 1;
  let last = performance.now();

  function resize() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(320, Math.round(rect.width));
    H = Math.max(240, Math.round(rect.height));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    player.x = clamp(player.x, 16, W - 16);
    player.y = clamp(player.y, 16, H - 16);
  }

  window.addEventListener("resize", resize);

  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    if (state.mode === "playing") {
      update(dt);
      syncHud(false);
    } else if (state.mode === "over" || state.mode === "won") {
      // keep particles settling behind the results screen
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.life <= 0) particles.splice(i, 1);
      }
      state.shake = Math.max(0, state.shake - dt * 26);
    }
    render();
    requestAnimationFrame(frame);
  }

  /* ------------------------------- wiring ------------------------------ */

  el.start.addEventListener("click", () => {
    sound.ensure();
    sound.resume();
    startGame();
  });
  el.again.addEventListener("click", () => startGame());
  el.endless.addEventListener("click", () => goEndless());
  el.resume.addEventListener("click", () => resumeGame());
  el.quit.addEventListener("click", () => quitToMenu());
  el.pause.addEventListener("click", () => {
    if (state.mode === "playing") pauseGame();
    else if (state.mode === "paused") resumeGame();
  });
  el.restart.addEventListener("click", () => {
    sound.ensure();
    startGame();
  });
  el.mute.addEventListener("click", () => {
    sound.ensure();
    sound.setMuted(!sound.muted);
  });

  sound.setMuted(sound.muted);
  el.best.textContent = String(state.best);
  resize();
  showScreen(el.screenStart);
  requestAnimationFrame(frame);
})();
