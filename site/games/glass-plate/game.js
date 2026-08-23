/* Glass Plate — a spirit-photography séance.
   Pan a viewfinder across a haunted ballroom, frame what flickers,
   and spend twelve glass plates filling an album before dawn. */
(() => {
  "use strict";

  /* ---------------- helpers ---------------- */

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const irand = (n) => Math.floor(Math.random() * n);

  function mulberry32(seed) {
    let s = seed | 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const el = (id) => document.getElementById(id);

  /* ---------------- constants ---------------- */

  const WORLD_W = 1680;
  const WORLD_H = 1050;
  const NIGHT = 150; // seconds until dawn
  const GOAL = 5; // album prints wanted
  const PLATES = 12;

  const GHOST_TYPES = {
    wisp: {
      rMin: 40,
      rMax: 58,
      lifeMin: 4.0,
      lifeMax: 6.5,
      speed: 26,
      label: "a pale wisp",
    },
    lady: {
      rMin: 52,
      rMax: 64,
      lifeMin: 6.0,
      lifeMax: 8.5,
      speed: 12,
      label: "the grey lady",
    },
    phantom: {
      rMin: 44,
      rMax: 56,
      lifeMin: 5.0,
      lifeMax: 7.0,
      speed: 34,
      label: "the restless shade",
    },
    colonel: {
      rMin: 74,
      rMax: 88,
      lifeMin: 7.0,
      lifeMax: 9.0,
      speed: 8,
      label: "the colonel",
    },
  };

  const GRADE_LINES = {
    S: "The Spiritual Society begs a formal sitting.",
    A: "Marlowe House will want this in the morning papers.",
    B: "Respectable plates. The dead kept their poise.",
    C: "Blurry, but the shapes are certainly there.",
    D: "The negatives disagree with your story.",
  };

  /* ---------------- dom ---------------- */

  const cv = el("scene");
  const ctx = cv.getContext("2d");
  const stage = el("stage");
  const scoreEl = el("score");
  const platesEl = el("plates");
  const dawnFill = document.querySelector("#dawnBar i");
  const slots = Array.from(document.querySelectorAll(".slot"));
  const verdictEl = el("verdict");
  const hintEl = el("hintToast");

  const menuOv = el("menu");
  const pauseOv = el("pauseOv");
  const endOv = el("endOv");
  const stampEl = el("stamp");
  const endTitleEl = el("endTitle");
  const endLineEl = el("endLine");
  const statsEl = el("stats");

  const btnStart = el("btnStart");
  const btnAgain = el("btnAgain");
  const btnShutter = el("btnShutter");
  const btnZoomIn = el("btnZoomIn");
  const btnZoomOut = el("btnZoomOut");
  const btnSound = el("btnSound");
  const btnPause = el("btnPause");

  /* ---------------- canvas / camera ---------------- */

  let cw = 900;
  let chh = 600;
  let dpr = 1;
  let fit = 1; // world units per css px baseline so the whole room can cover the view
  let scale = 1;
  let zoom = 1.3;

  const cam = { x: WORLD_W / 2, y: WORLD_H * 0.52 };
  const target = { x: cam.x, y: cam.y };
  const view = { w: 100, h: 100 };

  function applyScale() {
    scale = fit * zoom;
    view.w = cw / scale;
    view.h = chh / scale;
    clampCam();
  }

  function clampCam() {
    const hx = view.w / 2;
    const hy = view.h / 2;
    target.x =
      view.w >= WORLD_W ? WORLD_W / 2 : clamp(target.x, hx, WORLD_W - hx);
    target.y =
      view.h >= WORLD_H ? WORLD_H / 2 : clamp(target.y, hy, WORLD_H - hy);
    cam.x = view.w >= WORLD_W ? WORLD_W / 2 : clamp(cam.x, hx, WORLD_W - hx);
    cam.y = view.h >= WORLD_H ? WORLD_H / 2 : clamp(cam.y, hy, WORLD_H - hy);
  }

  let vignette = null;

  function resize() {
    const r = stage.getBoundingClientRect();
    cw = Math.max(320, Math.floor(r.width));
    chh = Math.max(240, Math.floor(r.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(chh * dpr);
    fit = Math.max(cw / WORLD_W, chh / WORLD_H);
    applyScale();

    vignette = document.createElement("canvas");
    vignette.width = cw;
    vignette.height = chh;
    const vg = vignette.getContext("2d");
    const g = vg.createRadialGradient(
      cw / 2,
      chh / 2,
      Math.min(cw, chh) * 0.36,
      cw / 2,
      chh / 2,
      Math.hypot(cw, chh) * 0.62,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.62)");
    vg.fillStyle = g;
    vg.fillRect(0, 0, cw, chh);
  }

  /* ---------------- grain tile ---------------- */

  const grainTile = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 160;
    const g = c.getContext("2d");
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 90 + irand(110);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  })();

  /* ---------------- game state ---------------- */

  let rng = Math.random;
  let seed = 0;
  let state = "menu"; // menu | playing | paused | ending | over
  let timeSec = 0;
  let elapsed = 0;
  let plates = PLATES;
  let accepted = 0;
  let shots = 0;
  let best = 0;
  let score = 0;
  let flash = 0;
  let cooldown = 0;
  let failTimer = -1;
  let endT = 0;
  let spawnTimer = 1.2;
  let whisperGap = 0;
  let creakTimer = 6;
  let hintTimer = 0;
  let verdictTimer = null;

  const ghosts = [];
  const motes = [];

  let room = null;

  function genRoom() {
    const R = rng;
    const floorY = Math.round(WORLD_H * 0.6);
    const winY = floorY - 430;
    const winW = 150;
    const winH = 300;
    const xs = [0.17, 0.5, 0.83].map((u) =>
      Math.round(WORLD_W * u + (R() - 0.5) * 70),
    );
    const windows = xs.map((x) => ({
      x: Math.round(x - winW / 2),
      y: winY,
      w: winW,
      h: winH,
    }));
    const candidates = [210, 430, 640, 1040, 1250, 1470];
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const clear = candidates.filter((px) =>
      windows.every((w) => Math.abs(w.x + w.w / 2 - px) > 190),
    );
    const portraitXs = clear.slice(0, 4);
    for (const px of candidates) {
      if (portraitXs.length >= 4) break;
      if (!portraitXs.includes(px)) portraitXs.push(px);
    }
    const portraits = portraitXs.map((px, i) => ({
      x: px,
      y: winY + 40 + (i % 2) * 66,
      tilt: (R() - 0.5) * 0.09,
      face: R(),
    }));
    const fire = {
      x: Math.round(WORLD_W * (0.3 + R() * 0.06)),
      w: 250,
      h: 205,
    };
    const chandeliers = [
      { x: Math.round(WORLD_W * 0.33), y: 128 },
      { x: Math.round(WORLD_W * 0.67), y: 118 },
    ];
    const kinds = [
      "sheet",
      "chair",
      "table",
      "crate",
      "candelabrum",
      "chair",
      "table",
    ];
    const furn = kinds.map((kind, i) => ({
      kind,
      x: Math.round(WORLD_W * (0.08 + 0.86 * ((i + R() * 0.7) / kinds.length))),
      y: Math.round(floorY + 50 + R() * (WORLD_H - floorY - 120)),
      s: 0.85 + R() * 0.5,
      flip: R() < 0.5 ? 1 : -1,
    }));
    furn.sort((a, b) => a.y - b.y);
    room = { floorY, windows, portraits, fire, chandeliers, furn };
  }

  for (let i = 0; i < 46; i++) {
    motes.push({
      x: rand(0, WORLD_W),
      y: rand(0, WORLD_H),
      v: rand(4, 14),
      ph: rand(0, TAU),
    });
  }

  /* ---------------- ghosts ---------------- */

  function pickType() {
    const prog = clamp(elapsed / NIGHT, 0, 1);
    const roll = Math.random();
    const anyAccepted = accepted > 0;
    if (anyAccepted && !ghosts.some((g) => g.type === "colonel") && roll < 0.09)
      return "colonel";
    if (prog > 0.18 && roll < 0.42) return "phantom";
    if (roll < 0.72) return "lady";
    return "wisp";
  }

  function spawnPos() {
    for (let tries = 0; tries < 24; tries++) {
      let x;
      let y;
      if (Math.random() < 0.35) {
        // bias into the current view so attention is sometimes rewarded
        const m = 0.16;
        x = lerp(
          cam.x - view.w * (0.5 - m),
          cam.x + view.w * (0.5 - m),
          Math.random(),
        );
        y = lerp(
          cam.y - view.h * (0.5 - m),
          cam.y + view.h * (0.5 - m),
          Math.random(),
        );
      } else {
        x = rand(220, WORLD_W - 220);
        y = rand(room.floorY + 40, WORLD_H - 160);
      }
      x = clamp(x, 190, WORLD_W - 190);
      y = clamp(y, room.floorY - 240, WORLD_H - 140);
      if (ghosts.every((g) => Math.hypot(g.x - x, g.y - y) > 250))
        return { x, y };
    }
    return { x: rand(220, WORLD_W - 220), y: rand(room.floorY, WORLD_H - 180) };
  }

  function spawnGhost() {
    const typeName = pickType();
    const T = GHOST_TYPES[typeName];
    const p = spawnPos();
    ghosts.push({
      type: typeName,
      label: T.label,
      x: p.x,
      y: p.y,
      r: rand(T.rMin, T.rMax),
      age: 0,
      life: rand(T.lifeMin, T.lifeMax),
      seed: rand(0, TAU),
      heading: rand(0, TAU),
      speed: T.speed,
      shy: 0,
      tpIdx: 0,
      alpha: 0,
      dead: false,
    });
    if (whisperGap <= 0) {
      Snd.whisper();
      whisperGap = 5;
    }
  }

  function updateGhosts(dt) {
    for (const g of ghosts) {
      g.age += dt;
      if (g.age > g.life + 0.15) {
        g.dead = true;
        continue;
      }
      // wander
      g.heading += (Math.random() - 0.5) * 1.7 * dt;
      // steer away from walls
      const mg = 150;
      if (g.x < mg || g.x > WORLD_W - mg)
        g.heading = Math.atan2(0, g.x < mg ? 1 : -1);
      if (g.y < room.floorY - 320 || g.y > WORLD_H - 120)
        g.heading = Math.atan2(g.y > WORLD_H / 2 ? -1 : 1, 0);
      g.x += Math.cos(g.heading) * g.speed * dt;
      g.y += Math.sin(g.heading) * g.speed * dt * 0.55;
      g.x = clamp(g.x, 130, WORLD_W - 130);
      g.y = clamp(g.y, 210, WORLD_H - 110);
      // shy lady fades faster under a centred lens
      if (g.type === "lady") {
        const nd = Math.hypot((g.x - cam.x) / view.w, (g.y - cam.y) / view.h);
        g.shy = clamp(g.shy + (nd < 0.24 ? dt * 0.5 : -dt * 0.25), 0, 0.7);
      }
      // phantom teleports twice
      if (g.type === "phantom") {
        const marks = [0.38, 0.68];
        if (g.tpIdx < marks.length && g.age > g.life * marks[g.tpIdx]) {
          g.tpIdx++;
          const p = spawnPos();
          g.x = p.x;
          g.y = p.y;
          g.seed = rand(0, TAU);
        }
      }
      // visibility envelope: rise, flicker, fall
      const ein = clamp(g.age / 0.7, 0, 1);
      const eout = clamp((g.life - g.age) / 1.15, 0, 1);
      const env = Math.min(ein, eout);
      const flick =
        0.62 +
        0.38 * Math.sin(g.age * 6.3 + g.seed) +
        0.16 * Math.sin(g.age * 12.7 + g.seed * 2.1);
      let al = clamp(env * flick, 0.03, 1);
      if (g.type === "lady") al *= 1 - g.shy;
      g.alpha = al;
    }
    for (let i = ghosts.length - 1; i >= 0; i--)
      if (ghosts[i].dead) ghosts.splice(i, 1);
  }

  /* ---------------- audio ---------------- */

  const Snd = {
    actx: null,
    master: null,
    noiseBuf: null,

    ensure() {
      if (this.actx) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.actx = new AC();
        this.master = this.actx.createGain();
        this.master.gain.value = muted ? 0 : 0.5;
        this.master.connect(this.actx.destination);
        const len = this.actx.sampleRate;
        this.noiseBuf = this.actx.createBuffer(1, len, this.actx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.ambience();
      } catch (e) {
        this.actx = null;
      }
    },

    resume() {
      if (this.actx && this.actx.state === "suspended") this.actx.resume();
    },

    toggle() {
      muted = !muted;
      if (this.master) this.master.gain.value = muted ? 0 : 0.5;
      btnSound.classList.toggle("muted", muted);
    },

    tone(type, f0, f1, dur, vol, delay) {
      if (!this.actx) return;
      const t0 = this.actx.currentTime + (delay || 0);
      const o = this.actx.createOscillator();
      const g = this.actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(1, f0), t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    },

    hiss(dur, vol, freq, q, delay) {
      if (!this.actx) return;
      const t0 = this.actx.currentTime + (delay || 0);
      const src = this.actx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const bp = this.actx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = freq;
      bp.Q.value = q || 1;
      const g = this.actx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    },

    ambience() {
      if (!this.actx) return;
      const t0 = this.actx.currentTime;
      const src = this.actx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const lp = this.actx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 210;
      const g = this.actx.createGain();
      g.gain.value = 0.02;
      const lfo = this.actx.createOscillator();
      lfo.frequency.value = 0.07;
      const lg = this.actx.createGain();
      lg.gain.value = 0.01;
      lfo.connect(lg);
      lg.connect(g.gain);
      src.connect(lp);
      lp.connect(g);
      g.connect(this.master);
      src.start(t0);
      lfo.start(t0);
    },

    shutter() {
      this.hiss(0.05, 0.5, 2600, 1.2);
      this.tone("square", 1500, 700, 0.05, 0.11);
      this.tone("square", 900, 300, 0.08, 0.09, 0.035);
      this.hiss(0.45, 0.1, 850, 0.5, 0.1); // plate wipe
    },
    bell(perfect) {
      const base = perfect ? 784 : 587;
      this.tone("sine", base, base, 0.5, 0.2);
      this.tone("sine", base * 1.5, base * 1.5, 0.42, 0.1, 0.03);
      if (perfect) this.tone("sine", base * 2, base * 2, 0.5, 0.07, 0.06);
    },
    fair() {
      this.tone("triangle", 392, 392, 0.25, 0.1);
    },
    thud() {
      this.tone("sine", 150, 58, 0.22, 0.28);
      this.hiss(0.1, 0.12, 300, 0.8);
    },
    emptyClick() {
      this.tone("triangle", 320, 190, 0.09, 0.11);
    },
    whisper() {
      this.hiss(1.4, 0.045, 720, 0.6);
    },
    creak() {
      this.tone("sawtooth", 112, 54, 1.15, 0.03);
    },
    fanfare() {
      [523, 659, 784, 1047].forEach((f, i) =>
        this.tone("sine", f, f, 0.6, 0.16, i * 0.13),
      );
    },
  };

  let muted = false;

  /* ---------------- verdict / hud ---------------- */

  function showVerdict(text, cls) {
    verdictEl.textContent = text;
    verdictEl.className = "";
    void verdictEl.offsetWidth; // restart animation
    verdictEl.className = "show " + cls;
    clearTimeout(verdictTimer);
    verdictTimer = setTimeout(() => {
      verdictEl.className = "";
    }, 1250);
  }

  function buildPips() {
    platesEl.textContent = "";
    for (let i = 0; i < PLATES; i++) {
      const p = document.createElement("span");
      p.className = "pip full";
      platesEl.appendChild(p);
    }
  }

  function refreshPlates() {
    const pips = platesEl.children;
    for (let i = 0; i < pips.length; i++) {
      pips[i].className = "pip" + (i < plates ? " full" : "");
    }
  }

  function refreshScore() {
    scoreEl.textContent = String(score);
  }

  function clearAlbum() {
    for (const s of slots) {
      s.getContext("2d").clearRect(0, 0, s.width, s.height);
      s.classList.remove("filled");
    }
  }

  /* ---------------- capture ---------------- */

  const snapCanvas = document.createElement("canvas");
  snapCanvas.width = 192;
  snapCanvas.height = 128;

  function interArea(b, L, T, R, B) {
    const w = Math.min(b.r, R) - Math.max(b.l, L);
    const h = Math.min(b.b, B) - Math.max(b.t, T);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function photoScore(g, contain) {
    const dx = (g.x - cam.x) / (view.w / 2);
    const dy = (g.y - cam.y) / (view.h / 2);
    const centering = clamp(1 - Math.hypot(dx, dy) * 0.62, 0, 1);
    const hFrac = (g.r * 2.7) / view.h;
    const size =
      hFrac < 0.15
        ? hFrac / 0.15
        : hFrac > 0.92
          ? Math.max(0, 1 - (hFrac - 0.92) / 0.8)
          : 1;
    const boldness = clamp((g.alpha - 0.16) / 0.84, 0, 1);
    return Math.round(
      100 *
        clamp(
          0.28 * contain + 0.32 * centering + 0.14 * size + 0.26 * boldness,
          0,
          1,
        ),
    );
  }

  function snapshotInto(slot) {
    const L = cam.x - view.w / 2;
    const T = cam.y - view.h / 2;
    const ts = snapCanvas.width / view.w;
    const sc = snapCanvas.getContext("2d");
    sc.setTransform(ts, 0, 0, ts, -L * ts, -T * ts);
    sc.fillStyle = "#0b0e14";
    sc.fillRect(L, T, view.w, view.h);
    renderWorld(sc, L, T, view.w, view.h, timeSec, true);
    sc.setTransform(1, 0, 0, 1, 0, 0);
    slot.getContext("2d").drawImage(snapCanvas, 0, 0, slot.width, slot.height);
    slot.classList.add("filled");
  }

  function capture() {
    if (state !== "playing" || plates <= 0 || cooldown > 0) return;
    plates--;
    shots++;
    cooldown = 0.4;
    flash = 1;
    Snd.shutter();
    refreshPlates();
    btnShutter.classList.add("cooldown");

    const L = cam.x - view.w / 2;
    const T = cam.y - view.h / 2;
    const R = L + view.w;
    const B = T + view.h;

    const hits = [];
    for (const g of ghosts) {
      if (g.dead) continue;
      const w = g.r * 1.9;
      const h = g.r * 2.7;
      const bb = { l: g.x - w / 2, t: g.y - h, r: g.x + w / 2, b: g.y };
      const area = interArea(bb, L, T, R, B);
      if (area <= 0) continue;
      const contain = area / (w * h);
      if (contain >= 0.55) hits.push({ g, contain });
    }

    if (!hits.length) {
      Snd.emptyClick();
      showVerdict("nothing — the frame holds only dust", "v-blur");
    } else {
      hits.forEach((hit) => {
        hit.s = photoScore(hit.g, hit.contain);
      });
      hits.sort((a, b) => b.s - a.s);
      const main = hits[0];
      const doubled = hits.length >= 2;
      let pts = main.s;
      if (doubled) pts += 40;

      const tier =
        pts >= 88
          ? "perfect"
          : pts >= 72
            ? "good"
            : pts >= 60
              ? "fair"
              : "blur";

      if (tier === "blur") {
        Snd.thud();
        showVerdict("blurred — the plate is spent", "v-blur");
      } else {
        score += pts;
        best = Math.max(best, pts);
        snapshotInto(slots[accepted]);
        accepted++;
        refreshScore();
        const tail = doubled ? " · DOUBLE EXPOSURE" : "";
        if (tier === "perfect") {
          Snd.bell(true);
          showVerdict(
            "perfect — " + main.g.label + ", plain as day +" + pts + tail,
            "v-perfect",
          );
        } else if (tier === "good") {
          Snd.bell(false);
          showVerdict(
            "good — " + main.g.label + " holds still +" + pts + tail,
            "v-good",
          );
        } else {
          Snd.fair();
          showVerdict("fair — something moved there +" + pts, "v-fair");
        }
        hintEl.classList.remove("show");
        if (accepted >= GOAL) {
          beginEnding();
          return;
        }
      }
    }

    if (plates <= 0 && accepted < GOAL) failTimer = 1.0;
  }

  /* ---------------- flow ---------------- */

  function beginEnding() {
    state = "ending";
    endT = 0;
    Snd.fanfare();
  }

  function finish(kind) {
    state = "over";
    pauseOv.classList.add("hidden");
    const win = kind === "win";
    const savedBonus = plates * 25;
    const timeBonus = win ? Math.round((1 - elapsed / NIGHT) * 60) : 0;
    const final = score + savedBonus + timeBonus;
    let letter =
      final >= 620
        ? "S"
        : final >= 540
          ? "A"
          : final >= 450
            ? "B"
            : final >= 300
              ? "C"
              : "D";
    if (!win && letter === "S") letter = "A";
    if (!win && letter === "A") letter = "B";

    let title;
    let line;
    if (win) {
      title = "Album Complete";
      line = GRADE_LINES[letter];
    } else if (kind === "plates") {
      title = "Out of Plates";
      line = "Twelve exposures spent, and the parlour keeps its silence.";
    } else {
      title = "Dawn Breaks";
      line = "Grey light floods the ballroom. Whatever danced is gone.";
    }

    stampEl.textContent = letter;
    stampEl.className = letter === "S" ? "g-S" : "";
    endTitleEl.textContent = title;
    endLineEl.textContent = line;

    const rows = [
      ["Exposed", shots + " of " + PLATES + " plates"],
      ["Printed", accepted + " of " + GOAL + " spirits"],
      ["Best plate", best + " points"],
      ["Saved plates", "+" + savedBonus],
    ];
    if (win) rows.push(["Beaten the sun", "+" + timeBonus]);
    rows.push(["Total", String(final)]);
    statsEl.innerHTML = rows
      .map((r) => "<div><dt>" + r[0] + "</dt><dd>" + r[1] + "</dd></div>")
      .join("");

    endOv.classList.remove("hidden");
  }

  function resetGame(play) {
    seed = (Math.random() * 2147483647) | 0;
    rng = mulberry32(seed);
    genRoom();
    ghosts.length = 0;
    spawnTimer = 1.0;
    plates = PLATES;
    accepted = 0;
    shots = 0;
    best = 0;
    score = 0;
    elapsed = 0;
    flash = 0;
    cooldown = 0;
    failTimer = -1;
    endT = 0;
    whisperGap = 0;
    zoom = 1.3;
    cam.x = target.x = WORLD_W / 2;
    cam.y = target.y = WORLD_H * 0.52;
    applyScale();
    clearAlbum();
    buildPips();
    refreshScore();
    dawnFill.style.width = "0%";
    btnShutter.classList.remove("cooldown");
    menuOv.classList.toggle("hidden", !!play);
    endOv.classList.add("hidden");
    pauseOv.classList.add("hidden");
    hintEl.classList.toggle("show", !!play);
    hintTimer = play ? 6 : 0;
    state = play ? "playing" : "menu";
  }

  function togglePause(force) {
    if (state === "playing" && force !== false) {
      state = "paused";
      pauseOv.classList.remove("hidden");
    } else if (state === "paused") {
      state = "playing";
      pauseOv.classList.add("hidden");
    }
  }

  /* ---------------- input ---------------- */

  const keys = { l: false, r: false, u: false, d: false };
  const pointers = new Map();
  let downX = 0;
  let downY = 0;
  let downT = 0;
  let movedFar = false;
  let everPinch = false;
  let pinchDist = 0;
  let hoverNX = 0;
  let hoverNY = 0;
  let ptrX = -100;
  let ptrY = -100;
  let ptrOn = false;

  cv.addEventListener("pointerdown", (e) => {
    Snd.ensure();
    Snd.resume();
    cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downX = e.clientX;
      downY = e.clientY;
      downT = performance.now();
      movedFar = false;
      everPinch = false;
    } else if (pointers.size === 2) {
      everPinch = true;
      const ps = Array.from(pointers.values());
      pinchDist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
    }
    ptrX = e.clientX;
    ptrY = e.clientY;
    ptrOn = true;
    if (state === "paused") togglePause();
  });

  cv.addEventListener("pointermove", (e) => {
    ptrX = e.clientX;
    ptrY = e.clientY;
    ptrOn = true;
    hoverNX = clamp((ptrX / cw - 0.5) * 2, -1, 1);
    hoverNY = clamp((ptrY / chh - 0.5) * 2, -1, 1);
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    if (pointers.size === 2) {
      const ps = Array.from(pointers.values());
      const nd = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      if (pinchDist > 0 && nd > 0) {
        zoom = clamp(zoom * (nd / pinchDist), 1, 2.8);
        applyScale();
      }
      pinchDist = nd;
      target.x -= dx / scale / 2;
      target.y -= dy / scale / 2;
      clampCam();
      movedFar = true;
    } else if (pointers.size === 1) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 7) movedFar = true;
      if (movedFar) {
        target.x -= dx / scale;
        target.y -= dy / scale;
        clampCam();
      }
    }
  });

  function pointerEnd(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      const quick = performance.now() - downT < 350;
      if (!movedFar && !everPinch && quick) capture();
    } else if (pointers.size === 1) {
      pinchDist = 0;
    }
  }

  cv.addEventListener("pointerup", pointerEnd);
  cv.addEventListener("pointercancel", pointerEnd);
  cv.addEventListener("pointerleave", () => {
    ptrOn = false;
  });

  cv.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0014), 1, 2.8);
      applyScale();
    },
    { passive: false },
  );

  cv.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    Snd.ensure();
    Snd.resume();
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") keys.l = true;
    else if (k === "arrowright" || k === "d") keys.r = true;
    else if (k === "arrowup" || k === "w") keys.u = true;
    else if (k === "arrowdown" || k === "s") keys.d = true;
    else if (k === " ") {
      if (!e.repeat) capture();
    } else if (k === "enter") {
      if (!e.repeat) capture();
    } else if (k === "+" || k === "=") {
      zoom = clamp(zoom * 1.18, 1, 2.8);
      applyScale();
    } else if (k === "-" || k === "_") {
      zoom = clamp(zoom / 1.18, 1, 2.8);
      applyScale();
    } else if (k === "m") {
      Snd.toggle();
    } else if (k === "p") {
      togglePause();
    } else if (k === "escape") {
      togglePause();
    } else if (k === "r") {
      resetGame(true);
    } else {
      return;
    }
    e.preventDefault();
  });

  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") keys.l = false;
    else if (k === "arrowright" || k === "d") keys.r = false;
    else if (k === "arrowup" || k === "w") keys.u = false;
    else if (k === "arrowdown" || k === "s") keys.d = false;
  });

  btnStart.addEventListener("click", () => {
    Snd.ensure();
    Snd.resume();
    btnStart.blur();
    resetGame(true);
  });

  btnAgain.addEventListener("click", () => {
    btnAgain.blur();
    resetGame(true);
  });

  btnShutter.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    btnShutter.blur();
    capture();
  });

  btnZoomIn.addEventListener("click", () => {
    btnZoomIn.blur();
    zoom = clamp(zoom * 1.25, 1, 2.8);
    applyScale();
  });

  btnZoomOut.addEventListener("click", () => {
    btnZoomOut.blur();
    zoom = clamp(zoom / 1.25, 1, 2.8);
    applyScale();
  });

  btnSound.addEventListener("click", () => {
    Snd.ensure();
    Snd.resume();
    Snd.toggle();
    btnSound.blur();
  });

  btnPause.addEventListener("click", () => {
    togglePause();
    btnPause.blur();
  });

  pauseOv.addEventListener("click", () => {
    if (state === "paused") togglePause();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") togglePause();
  });

  /* ---------------- update ---------------- */

  function currentInterval() {
    const prog = clamp(elapsed / NIGHT, 0, 1);
    return lerp(2.35, 1.15, Math.pow(prog, 1.2));
  }

  function update(dt) {
    timeSec += dt;

    if (state === "playing") {
      elapsed += dt;
      if (hintTimer > 0) {
        hintTimer -= dt;
        if (hintTimer <= 0) hintEl.classList.remove("show");
      }
      if (elapsed >= NIGHT) {
        finish("dawn");
      }
    } else if (state === "ending") {
      endT += dt / 2.6;
      if (endT >= 1) {
        endT = 1;
        finish("win");
      }
    }

    // spawning (menu keeps a live backdrop too)
    if (state === "playing" || state === "menu" || state === "over") {
      spawnTimer -= dt;
      const cap = elapsed > NIGHT * 0.55 ? 4 : 3;
      if (spawnTimer <= 0 && ghosts.length < cap) {
        spawnGhost();
        spawnTimer =
          (state === "playing" ? currentInterval() : 2.6) * rand(0.7, 1.3);
      }
      updateGhosts(dt);
    }

    if (state === "playing") {
      // keyboard pan
      const spd = (620 / zoom) * dt;
      if (keys.l) target.x -= spd;
      if (keys.r) target.x += spd;
      if (keys.u) target.y -= spd;
      if (keys.d) target.y += spd;
      if (failTimer > 0) {
        failTimer -= dt;
        if (failTimer <= 0) finish("plates");
      }
      whisperGap -= dt;
      creakTimer -= dt;
      if (creakTimer <= 0) {
        creakTimer = rand(9, 20);
        Snd.creak();
      }
    }

    // idle drift behind menus
    if (state === "menu" || state === "over") {
      target.x = WORLD_W / 2 + Math.sin(timeSec * 0.13) * 240;
      target.y = WORLD_H * 0.5 + Math.cos(timeSec * 0.09) * 120;
    }

    // parallax lean toward the cursor
    const desiredX =
      target.x + (ptrOn && state === "playing" ? hoverNX * 42 : 0);
    const desiredY =
      target.y + (ptrOn && state === "playing" ? hoverNY * 30 : 0);
    const kEase = 1 - Math.exp(-dt * 6);
    cam.x += (desiredX - cam.x) * kEase;
    cam.y += (desiredY - cam.y) * kEase;
    clampCam();

    cooldown = Math.max(0, cooldown - dt);
    if (cooldown === 0) btnShutter.classList.remove("cooldown");
    flash = Math.max(0, flash - dt * 2.4);

    for (const m of motes) {
      m.x -= m.v * dt * 0.6;
      m.y -= m.v * dt;
      if (m.x < -20) m.x = WORLD_W + 10;
      if (m.y < -20) m.y = WORLD_H + 10;
    }

    if (state === "playing") {
      dawnFill.style.width =
        clamp((elapsed / NIGHT) * 100, 0, 100).toFixed(1) + "%";
    }
  }

  /* ---------------- rendering ---------------- */

  function inView(L, T, vw, vh, x0, x1, pad) {
    return x1 > L - pad && x0 < L + vw + pad;
  }

  function drawWindow(g, w) {
    g.save();
    g.translate(w.x + w.w / 2, w.y);
    // frame
    g.fillStyle = "#242c3f";
    g.fillRect(-w.w / 2 - 9, -9, w.w + 18, w.h + 18);
    g.strokeStyle = "#6b5a36";
    g.lineWidth = 2.5;
    g.strokeRect(-w.w / 2 - 9, -9, w.w + 18, w.h + 18);
    // arch top
    g.beginPath();
    g.moveTo(-w.w / 2, 0);
    g.arc(0, 0, w.w / 2, Math.PI, 0);
    g.lineTo(w.w / 2, w.h);
    g.lineTo(-w.w / 2, w.h);
    g.closePath();
    const pane = g.createLinearGradient(0, -w.w / 2, 0, w.h);
    pane.addColorStop(0, "#101b30");
    pane.addColorStop(1, "#0a1220");
    g.fillStyle = pane;
    g.fill();
    // moon
    g.save();
    g.clip();
    g.fillStyle = "rgba(214,228,246,0.9)";
    g.beginPath();
    g.arc(w.w * 0.22, w.h * 0.24, 21, 0, TAU);
    g.fill();
    g.fillStyle = "rgba(214,228,246,0.12)";
    g.beginPath();
    g.arc(w.w * 0.22, w.h * 0.24, 44, 0, TAU);
    g.fill();
    // mullions
    g.strokeStyle = "#161d2c";
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(0, -w.w / 2);
    g.lineTo(0, w.h);
    g.moveTo(-w.w / 2, w.h * 0.38);
    g.lineTo(w.w / 2, w.h * 0.38);
    g.moveTo(-w.w / 2, w.h * 0.74);
    g.lineTo(w.w / 2, w.h * 0.74);
    g.stroke();
    g.restore();
    // sill
    g.fillStyle = "#2c3040";
    g.fillRect(-w.w / 2 - 14, w.h + 8, w.w + 28, 10);
    g.restore();
  }

  function drawPortrait(g, p, t) {
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.tilt);
    g.fillStyle = "#20242f";
    g.beginPath();
    g.ellipse(0, 0, 44, 56, 0, 0, TAU);
    g.fill();
    g.strokeStyle = "#6b5a36";
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = "#0d1017";
    g.beginPath();
    g.ellipse(0, 0, 37, 49, 0, 0, TAU);
    g.fill();
    // faint sitter
    g.fillStyle = "rgba(150,165,190,0.13)";
    g.beginPath();
    g.ellipse(0, 12, 22, 26, 0, Math.PI, 0);
    g.fill();
    g.beginPath();
    g.arc(0, -8, 12, 0, TAU);
    g.fill();
    g.fillStyle = "rgba(150,165,190,0.2)";
    g.beginPath();
    g.arc(-5, -9, 1.6, 0, TAU);
    g.arc(5, -9, 1.6, 0, TAU);
    g.fill();
    // occasional glint
    const glint = Math.sin(t * 0.6 + p.face * 9) > 0.995 ? 0.35 : 0;
    if (glint > 0) {
      g.fillStyle = "rgba(255,236,190," + glint + ")";
      g.beginPath();
      g.arc(14, -20, 2, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function drawFireplace(g, f, t) {
    g.save();
    g.translate(f.x, room.floorY);
    const w = f.w;
    const h = f.h;
    g.fillStyle = "#191d29";
    g.fillRect(-w / 2 - 22, -h - 16, w + 44, h + 16);
    g.fillStyle = "#12151f";
    g.beginPath();
    g.moveTo(-w / 2, 0);
    g.lineTo(-w / 2, -h + 46);
    g.quadraticCurveTo(0, -h - 26, w / 2, -h + 46);
    g.lineTo(w / 2, 0);
    g.closePath();
    g.fill();
    // ember glow
    const fl = 0.75 + 0.25 * Math.sin(t * 3.1) + 0.1 * Math.sin(t * 7.7);
    const gr = g.createRadialGradient(0, -34, 8, 0, -34, 120);
    gr.addColorStop(0, "rgba(255,140,60," + 0.34 * fl + ")");
    gr.addColorStop(0.5, "rgba(230,90,40," + 0.14 * fl + ")");
    gr.addColorStop(1, "rgba(230,90,40,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, -34, 120, 0, TAU);
    g.fill();
    // logs
    g.fillStyle = "#0a0c12";
    g.fillRect(-34, -26, 68, 12);
    g.fillRect(-22, -38, 48, 10);
    // coals
    g.fillStyle = "rgba(255,120,40," + 0.5 * fl + ")";
    g.beginPath();
    g.arc(-10, -22, 4, 0, TAU);
    g.arc(12, -24, 3, 0, TAU);
    g.arc(2, -30, 2.4, 0, TAU);
    g.fill();
    // mantel
    g.fillStyle = "#2c3040";
    g.fillRect(-w / 2 - 30, -h - 24, w + 60, 12);
    g.restore();
  }

  function drawChandelier(g, c, t) {
    const sway = Math.sin(t * 0.42 + c.x) * 6;
    g.save();
    g.translate(c.x + sway, c.y);
    g.strokeStyle = "#3a3423";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, -c.y);
    g.lineTo(0, 0);
    g.stroke();
    // arms
    g.strokeStyle = "#4a4128";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, -6, 52, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    g.beginPath();
    g.arc(0, -2, 30, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
    // candles + flames
    const spots = [
      [-52, -12],
      [-26, -30],
      [0, -36],
      [26, -30],
      [52, -12],
      [-30, -8],
      [30, -8],
    ];
    for (const s of spots) {
      g.fillStyle = "#d8cdb0";
      g.fillRect(s[0] - 2, s[1] - 10, 4, 12);
      const fl = 0.7 + 0.3 * Math.sin(t * 9 + s[0] * 1.7);
      const fg = g.createRadialGradient(
        s[0],
        s[1] - 16,
        1,
        s[0],
        s[1] - 16,
        16,
      );
      fg.addColorStop(0, "rgba(255,214,140," + 0.85 * fl + ")");
      fg.addColorStop(0.4, "rgba(255,160,70," + 0.25 * fl + ")");
      fg.addColorStop(1, "rgba(255,160,70,0)");
      g.fillStyle = fg;
      g.beginPath();
      g.arc(s[0], s[1] - 16, 16, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function drawFurniture(g, f, t) {
    const s = f.s;
    g.save();
    g.translate(f.x, f.y);
    g.scale(s * f.flip, s);
    g.fillStyle = "#0c0f16";
    g.strokeStyle = "#1c2130";
    g.lineWidth = 2;
    if (f.kind === "sheet") {
      g.beginPath();
      g.moveTo(-46, 0);
      g.quadraticCurveTo(-52, -96, -30, -128);
      g.quadraticCurveTo(0, -152, 30, -126);
      g.quadraticCurveTo(52, -94, 46, 0);
      g.closePath();
      g.fill();
      g.stroke();
      g.strokeStyle = "rgba(90,100,125,0.35)";
      g.beginPath();
      g.moveTo(-16, -124);
      g.quadraticCurveTo(-22, -66, -14, -4);
      g.moveTo(14, -120);
      g.quadraticCurveTo(20, -60, 12, -6);
      g.stroke();
    } else if (f.kind === "chair") {
      g.fillRect(-30, -74, 10, 74);
      g.fillRect(22, -74, 10, 74);
      g.fillRect(-30, -80, 62, 12);
      g.fillRect(-38, -34, 76, 10);
      g.fillRect(-34, -26, 8, 26);
      g.fillRect(28, -26, 8, 26);
      g.strokeRect(-30, -74, 10, 40);
    } else if (f.kind === "table") {
      g.beginPath();
      g.ellipse(0, -58, 64, 13, 0, 0, TAU);
      g.fill();
      g.stroke();
      g.fillRect(-56, -52, 8, 52);
      g.fillRect(48, -52, 8, 52);
    } else if (f.kind === "crate") {
      g.fillRect(-36, -52, 72, 52);
      g.strokeRect(-36, -52, 72, 52);
      g.beginPath();
      g.moveTo(-36, -52);
      g.lineTo(36, 0);
      g.moveTo(36, -52);
      g.lineTo(-36, 0);
      g.stroke();
    } else {
      // candelabrum
      g.fillRect(-3, -88, 6, 88);
      g.beginPath();
      g.ellipse(0, 0, 26, 6, 0, 0, TAU);
      g.fill();
      const arms = [
        [-26, -70],
        [0, -84],
        [26, -70],
      ];
      for (const a of arms) {
        g.fillRect(a[0] - 2, a[1] - 12, 4, 14);
        const fl = 0.7 + 0.3 * Math.sin(t * 8 + a[0]);
        g.fillStyle = "rgba(255,196,110," + 0.7 * fl + ")";
        g.beginPath();
        g.arc(a[0], a[1] - 16, 3.4, 0, TAU);
        g.fill();
        g.fillStyle = "rgba(255,170,80," + 0.14 * fl + ")";
        g.beginPath();
        g.arc(a[0], a[1] - 16, 22, 0, TAU);
        g.fill();
        g.fillStyle = "#0c0f16";
      }
    }
    g.restore();
  }

  function drawGhost(g, gh, t, extraDim) {
    const a = gh.alpha * extraDim;
    if (a < 0.02) return;
    const H = gh.r * (gh.type === "lady" ? 3.0 : 2.7);
    const W = gh.r * 1.9;
    const bob = Math.sin(t * 1.7 + gh.seed) * gh.r * 0.08;
    g.save();
    g.translate(gh.x, gh.y + bob);

    // aura
    const aura = g.createRadialGradient(
      0,
      -H * 0.45,
      gh.r * 0.2,
      0,
      -H * 0.45,
      gh.r * 2.3,
    );
    aura.addColorStop(0, "rgba(185,222,255," + 0.26 * a + ")");
    aura.addColorStop(1, "rgba(185,222,255,0)");
    g.fillStyle = aura;
    g.beginPath();
    g.arc(0, -H * 0.45, gh.r * 2.3, 0, TAU);
    g.fill();

    // side wisps
    g.strokeStyle = "rgba(208,233,255," + 0.2 * a + ")";
    g.lineWidth = 3;
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? -1 : 1;
      g.beginPath();
      g.moveTo(sgn * W * 0.42, -H * 0.32);
      g.quadraticCurveTo(
        sgn * W * 0.78,
        -H * 0.16 + Math.sin(t * 3 + i + gh.seed) * 9,
        sgn * W * 0.6,
        8 + Math.sin(t * 2.2 + i * 2 + gh.seed) * 6,
      );
      g.stroke();
    }

    // body
    const body = g.createLinearGradient(0, -H, 0, 0);
    body.addColorStop(0, "rgba(228,242,255," + 0.92 * a + ")");
    body.addColorStop(0.65, "rgba(198,222,246," + 0.55 * a + ")");
    body.addColorStop(1, "rgba(178,205,235,0)");
    const hr = gh.r * 0.42;
    const hy = -H + hr;
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(-W / 2, 0);
    for (let i = 1; i <= 6; i++) {
      const u = i / 6;
      const hx = -W / 2 + W * u;
      const hyy = -(
        Math.sin(u * Math.PI * 3 + t * 2.2 + gh.seed) * gh.r * 0.13 +
        Math.sin(u * 9 + gh.seed) * gh.r * 0.05
      );
      g.lineTo(hx, hyy);
    }
    g.bezierCurveTo(
      W / 2 + gh.r * 0.1,
      -H * 0.35,
      W * 0.32,
      -H * 0.72,
      hr * 0.82,
      hy + hr * 0.56,
    );
    g.arc(0, hy, hr, 0.62, Math.PI - 0.62, true);
    g.bezierCurveTo(
      -W * 0.32,
      -H * 0.72,
      -W / 2 - gh.r * 0.1,
      -H * 0.35,
      -W / 2,
      0,
    );
    g.closePath();
    g.fill();

    // eyes
    g.fillStyle = "rgba(9,15,27," + 0.85 * a + ")";
    g.beginPath();
    g.ellipse(-hr * 0.38, hy - 2, hr * 0.15, hr * 0.22, 0.12, 0, TAU);
    g.ellipse(hr * 0.38, hy - 2, hr * 0.15, hr * 0.22, -0.12, 0, TAU);
    g.fill();
    if (gh.type === "phantom") {
      g.beginPath();
      g.ellipse(0, hy + hr * 0.46, hr * 0.13, hr * 0.2, 0, 0, TAU);
      g.fill();
    }

    // the colonel's hat and brass
    if (gh.type === "colonel") {
      g.fillStyle = "rgba(26,34,54," + 0.9 * a + ")";
      g.beginPath();
      g.ellipse(0, hy - hr * 0.82, hr * 1.16, hr * 0.24, 0, 0, TAU);
      g.fill();
      g.fillRect(-hr * 0.56, hy - hr * 1.92, hr * 1.12, hr * 1.1);
      g.fillStyle = "rgba(201,168,106," + 0.5 * a + ")";
      g.fillRect(-W * 0.36, -H * 0.67, 13, 8);
      g.fillRect(W * 0.36 - 13, -H * 0.67, 13, 8);
    }
    if (gh.type === "lady") {
      g.strokeStyle = "rgba(210,232,255," + 0.3 * a + ")";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, hy, hr * 1.28, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
    }
    g.restore();
  }

  function renderWorld(g, L, T, vw, vh, t, withGhosts) {
    const R = room;
    const floorY = R.floorY;

    // wall
    const wall = g.createLinearGradient(0, 0, 0, floorY);
    wall.addColorStop(0, "#141826");
    wall.addColorStop(1, "#0e1119");
    g.fillStyle = wall;
    g.fillRect(L - 10, T - 10, vw + 20, floorY - T + 10);

    // crown moulding
    g.fillStyle = "#1d2230";
    g.fillRect(L - 10, 22, vw + 20, 7);

    // wainscot
    g.fillStyle = "#171b28";
    g.fillRect(L - 10, floorY - 84, vw + 20, 84);
    g.fillStyle = "#232838";
    g.fillRect(L - 10, floorY - 88, vw + 20, 5);
    g.strokeStyle = "rgba(10,12,18,0.8)";
    g.lineWidth = 2;
    const bat0 = Math.max(0, Math.floor((L - 10) / 92));
    const bat1 = Math.ceil((L + vw + 10) / 92);
    g.beginPath();
    for (let bx = bat0; bx <= bat1; bx++) {
      g.moveTo(bx * 92, floorY - 84);
      g.lineTo(bx * 92, floorY);
    }
    g.stroke();

    // floor
    const fl = g.createLinearGradient(0, floorY, 0, WORLD_H);
    fl.addColorStop(0, "#181109");
    fl.addColorStop(1, "#0a0705");
    g.fillStyle = fl;
    g.fillRect(L - 10, floorY, vw + 20, WORLD_H - floorY + 10);
    g.strokeStyle = "rgba(0,0,0,0.4)";
    g.lineWidth = 1.5;
    const plank0 = Math.max(floorY, Math.floor(T / 46) * 46);
    g.beginPath();
    for (let py = plank0; py < T + vh + 10; py += 46) {
      if (py < floorY) continue;
      g.moveTo(L - 10, py);
      g.lineTo(L + vw + 10, py);
    }
    g.stroke();

    // moonlight shafts
    for (const w of R.windows) {
      const wx = w.x + w.w / 2;
      g.save();
      const sh = g.createLinearGradient(0, w.y + w.h, 0, floorY + 210);
      sh.addColorStop(0, "rgba(186,209,244,0.085)");
      sh.addColorStop(1, "rgba(186,209,244,0)");
      g.fillStyle = sh;
      g.beginPath();
      g.moveTo(wx - w.w * 0.42, w.y + w.h);
      g.lineTo(wx + w.w * 0.42, w.y + w.h);
      g.lineTo(wx + w.w * 1.15, floorY + 215);
      g.lineTo(wx - w.w * 0.55, floorY + 215);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(186,209,244,0.05)";
      g.beginPath();
      g.ellipse(wx + 30, floorY + 150, w.w * 0.95, 34, 0, 0, TAU);
      g.fill();
      g.restore();
    }

    // fireplace (behind ghosts)
    drawFireplace(g, R.fire, t);

    // windows
    for (const w of R.windows) {
      if (inView(L, T, vw, vh, w.x, w.x + w.w, 80)) drawWindow(g, w);
    }

    // portraits
    for (const p of R.portraits) {
      if (inView(L, T, vw, vh, p.x - 50, p.x + 50, 40)) drawPortrait(g, p, t);
    }

    // furniture
    for (const f of R.furn) {
      if (inView(L, T, vw, vh, f.x - 90, f.x + 90, 40)) drawFurniture(g, f, t);
    }

    // dust motes
    g.fillStyle = "rgba(205,220,240,0.16)";
    for (const m of motes) {
      if (
        m.x < L - 30 ||
        m.x > L + vw + 30 ||
        m.y < T - 30 ||
        m.y > T + vh + 30
      )
        continue;
      const tw = 0.5 + 0.5 * Math.sin(t * 1.8 + m.ph);
      g.globalAlpha = 0.05 + 0.13 * tw;
      g.beginPath();
      g.arc(m.x, m.y, 1.4, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;

    // chandeliers hang over everything static
    for (const c of R.chandeliers) {
      if (inView(L, T, vw, vh, c.x - 80, c.x + 80, 60)) drawChandelier(g, c, t);
    }

    // spirits
    if (withGhosts) {
      const dim = state === "ending" ? Math.max(0, 1 - endT) : 1;
      const sorted = ghosts.slice().sort((a, b) => a.y - b.y);
      for (const gh of sorted) {
        if (
          gh.x < L - 260 ||
          gh.x > L + vw + 260 ||
          gh.y < T - 320 ||
          gh.y - gh.r * 3 > T + vh + 60
        )
          continue;
        drawGhost(g, gh, t, dim);
      }
    }
  }

  function draw() {
    const L = cam.x - view.w / 2;
    const T = cam.y - view.h / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#04050a";
    ctx.fillRect(0, 0, cw, chh);

    ctx.setTransform(
      dpr * scale,
      0,
      0,
      dpr * scale,
      -L * dpr * scale,
      -T * dpr * scale,
    );
    renderWorld(ctx, L, T, view.w, view.h, timeSec, true);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // film grain
    ctx.globalAlpha = 0.055;
    ctx.globalCompositeOperation = "overlay";
    const ox = irand(160);
    const oy = irand(160);
    for (let gx = -ox; gx < cw; gx += 160) {
      for (let gy = -oy; gy < chh; gy += 160) {
        ctx.drawImage(grainTile, gx, gy);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // vignette
    ctx.drawImage(vignette, 0, 0);

    // dawn light
    let warm = 0;
    if (state === "playing" && elapsed > NIGHT - 32) {
      warm = clamp((elapsed - (NIGHT - 32)) / 32, 0, 1) * 0.38;
    } else if (state === "ending" || (state === "over" && accepted >= GOAL)) {
      warm = 0.38 + endT * 0.5;
    }
    if (warm > 0) {
      const wg = ctx.createLinearGradient(0, 0, 0, chh * 0.55);
      wg.addColorStop(0, "rgba(226,148,86," + 0.5 * warm + ")");
      wg.addColorStop(1, "rgba(226,148,86,0)");
      ctx.fillStyle = wg;
      ctx.fillRect(0, 0, cw, chh * 0.55);
      ctx.fillStyle = "rgba(226,148,86," + 0.1 * warm + ")";
      ctx.fillRect(0, 0, cw, chh);
    }
    if (state === "ending" || (state === "over" && accepted >= GOAL)) {
      const sy = lerp(chh * 1.05, chh * 0.26, 1 - Math.pow(1 - endT, 2));
      const sg = ctx.createRadialGradient(
        cw / 2,
        sy,
        10,
        cw / 2,
        sy,
        cw * 0.55,
      );
      sg.addColorStop(0, "rgba(255,206,132," + 0.55 * endT + ")");
      sg.addColorStop(1, "rgba(255,206,132,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, cw, chh);
    }

    // viewfinder brackets
    const breath = 1 + Math.sin(timeSec * 2.1) * 0.012;
    const m = 24 * breath;
    const len = 30;
    const bAlpha = cooldown > 0 ? 0.28 : flash > 0.5 ? 1 : 0.8;
    ctx.strokeStyle =
      flash > 0.5
        ? "rgba(255,255,255," + bAlpha + ")"
        : "rgba(201,168,106," + bAlpha + ")";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(m, m + len);
    ctx.lineTo(m, m);
    ctx.lineTo(m + len, m);
    ctx.moveTo(cw - m - len, m);
    ctx.lineTo(cw - m, m);
    ctx.lineTo(cw - m, m + len);
    ctx.moveTo(cw - m, chh - m - len);
    ctx.lineTo(cw - m, chh - m);
    ctx.lineTo(cw - m - len, chh - m);
    ctx.moveTo(m + len, chh - m);
    ctx.lineTo(m, chh - m);
    ctx.lineTo(m, chh - m - len);
    ctx.stroke();
    ctx.strokeStyle = "rgba(201,168,106,0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(m, m, cw - 2 * m, chh - 2 * m);

    // reticle
    if (ptrOn && (state === "playing" || state === "menu")) {
      ctx.strokeStyle = "rgba(232,220,192,0.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ptrX, ptrY, 8, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = "rgba(232,220,192,0.9)";
      ctx.beginPath();
      ctx.arc(ptrX, ptrY, 1.4, 0, TAU);
      ctx.fill();
    }

    // shutter flash
    if (flash > 0) {
      ctx.fillStyle = "rgba(245,248,255," + Math.min(1, flash) * 0.85 + ")";
      ctx.fillRect(0, 0, cw, chh);
    }
  }

  /* ---------------- boot ---------------- */

  function loop(ms) {
    const t = ms / 1000;
    const dt = clamp(t - (loop.last || t), 0, 0.05);
    loop.last = t;
    if (state !== "paused") update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(resize).observe(stage);
  }

  resize();
  buildPips();
  resetGame(false);
  requestAnimationFrame(loop);
})();
