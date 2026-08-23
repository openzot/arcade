/*
 * Kite Cutter — a rooftop fighter-kite duel.
 * Fly, cross your rival's manja line, then stop the pull-ring needle in the
 * gold notch to saw their string. Three strands; gusts and pigeons want them.
 */
(() => {
  "use strict";

  /* ---------------- helpers ---------------- */
  const $ = (sel) => document.querySelector(sel);
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  function randn() {
    let u = 0;
    let v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
  function angDist(a, b) {
    const d = Math.abs(a - b) % TAU;
    return d > Math.PI ? TAU - d : d;
  }

  /* ---------------- dom ---------------- */
  const cv = $("#game");
  const ctx = cv.getContext("2d");
  const elScore = $("#hud-score");
  const elRival = $("#hud-rival");
  const elStrands = $("#hud-strands");
  const panelMenu = $("#panel-menu");
  const panelPause = $("#panel-pause");
  const panelEnd = $("#panel-end");
  const bannerEl = $("#panel-banner");
  const bannerMain = $("#banner-main");
  const bannerSub = $("#banner-sub");
  const endTitle = $("#end-title");
  const endSub = $("#end-sub");
  const endCuts = $("#end-cuts");
  const endStrands = $("#end-strands");
  const endScore = $("#end-score");
  const endBest = $("#end-best");
  const btnMute = $("#btn-mute");

  /* ---------------- logical space ---------------- */
  const W = 960;
  const H = 600;
  const SKY = { x0: 26, x1: 934, y0: 56, y1: 498 };
  const ANCHOR_P = { x: 118, y: 540 };
  const ANCHOR_R = { x: 842, y: 540 };
  const view = { s: 1 };

  function resize() {
    const r = cv.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    cv.width = Math.max(320, Math.round(r.width * dpr));
    cv.height = Math.round((cv.width * H) / W);
    view.s = cv.width / W;
  }
  window.addEventListener("resize", resize);

  /* ---------------- rivals & state ---------------- */
  const RIVALS = [
    {
      name: "Bhavesh",
      epi: "the paper-boy",
      skill: 0.34,
      turn: 2.7,
      base: 116,
      aggrMin: 3.6,
      aggrMax: 6.5,
      chance: 0.45,
      main: "#59d9a2",
      dark: "#1d7d5a",
    },
    {
      name: "Meera",
      epi: "the dyer’s daughter",
      skill: 0.6,
      turn: 3.15,
      base: 133,
      aggrMin: 2.2,
      aggrMax: 4.4,
      chance: 0.62,
      main: "#ef6a51",
      dark: "#96271b",
    },
    {
      name: "Hiral Baa",
      epi: "the kite witch",
      skill: 0.86,
      turn: 3.62,
      base: 152,
      aggrMin: 1.3,
      aggrMax: 2.7,
      chance: 0.82,
      main: "#c79bff",
      dark: "#5c3a99",
    },
  ];
  const P_MAIN = "#ffcf6b";
  const P_DARK = "#e2703a";

  const ST = {
    MENU: "menu",
    PLAY: "play",
    DUEL: "duel",
    OVER: "over",
    WIN: "win",
  };
  let state = ST.MENU;
  let paused = false;
  let level = 0;
  let strands = 3;
  let cutsMade = 0;
  let score = 0;
  let coolT = 0;
  let nextT = 0;
  let pendNext = null;
  let shake = 0;
  let flash = 0;
  let flashCol = "#fff";
  let banT = 0;
  let nearPt = null;
  let birdT = rand(5, 9);
  const reducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- entities ---------------- */
  function makeKite(anchor, opts) {
    return Object.assign(
      {
        ax: anchor.x,
        ay: anchor.y,
        x: anchor.x,
        y: anchor.y - 230,
        tx: anchor.x,
        ty: anchor.y - 230,
        heading: -TAU / 4,
        spd: 60,
        tension: 0,
        haul: false,
        turn: 3,
        base: 125,
        stun: 0,
        alive: true,
        rot: 0,
        creak: 0,
        hist: [],
        seed: rand(0, TAU),
        ai: rand(1, 2),
        mode: "lure",
        modeT: 0,
        vx: 0,
        vy: 0,
      },
      opts || {},
    );
  }
  let player = null;
  let rival = null;
  const polyP = [];
  const polyR = [];
  let ctrlP = { cx: 0, cy: 0 };
  let ctrlR = { cx: 0, cy: 0 };
  const birds = [];
  const parts = [];
  const clouds = [];
  for (let i = 0; i < 7; i++) {
    clouds.push({
      x: rand(0, W),
      y: rand(40, 250),
      s: rand(0.5, 1.4),
      v: rand(6, 16),
    });
  }

  /* ---------------- wind ---------------- */
  const wind = {
    x: 14,
    y: 0,
    t: rand(0, 9),
    phase: "idle",
    timer: rand(4, 7),
    gx: 0,
    gy: 0,
  };
  function updWind(dt) {
    wind.t += dt;
    let bx = Math.sin(wind.t * 0.5) * 40 + Math.sin(wind.t * 0.21 + 2) * 26;
    let by = Math.sin(wind.t * 0.33 + 1) * 10;
    wind.timer -= dt;
    if (wind.phase === "idle" && wind.timer <= 0) {
      wind.phase = "warn";
      wind.timer = 0.85;
      const dir = Math.random() < 0.5 ? -1 : 1;
      wind.gx = dir * rand(240, 340);
      wind.gy = rand(-90, -30);
      audio.whoosh();
    } else if (wind.phase === "warn") {
      if (wind.timer <= 0) {
        wind.phase = "gust";
        wind.timer = rand(1.0, 1.35);
      }
    } else if (wind.phase === "gust") {
      const k = clamp(wind.timer / 1.2, 0, 1);
      bx += wind.gx * k;
      by += wind.gy * k;
      if (!reducedMotion && Math.random() < 0.8) {
        parts.push({
          x: rand(60, W - 60),
          y: rand(80, 420),
          vx: wind.gx * 0.55,
          vy: wind.gy * 0.2,
          life: rand(0.25, 0.45),
          t: 0,
          col: "rgba(255,255,255,0.65)",
          sz: rand(10, 26),
          g: 0,
        });
      }
      if (wind.timer <= 0) {
        wind.phase = "idle";
        wind.timer = rand(4.5, 8.5);
      }
    }
    wind.x = bx;
    wind.y = by;
  }

  /* ---------------- audio (all synthesised) ---------------- */
  const audio = (() => {
    let ac = null;
    let master = null;
    let windGain = null;
    let windFilter = null;
    let muted = false;
    try {
      muted = localStorage.getItem("kc.mute") === "1";
    } catch (e) {
      /* storage unavailable */
    }
    function init() {
      if (ac) {
        if (ac.state === "suspended") ac.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ac.destination);
      const len = 2 * ac.sampleRate;
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      windFilter = ac.createBiquadFilter();
      windFilter.type = "lowpass";
      windFilter.frequency.value = 300;
      windGain = ac.createGain();
      windGain.gain.value = 0;
      src.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(master);
      src.start();
    }
    function tone(f, dur, type, vol, slide) {
      if (!ac || muted) return;
      const o = ac.createOscillator();
      const g = ac.createGain();
      const t = ac.currentTime;
      o.type = type || "sine";
      o.frequency.setValueAtTime(f, t);
      if (slide)
        o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol || 0.2, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    function noise(dur, freq, vol, type) {
      if (!ac || muted) return;
      const n = Math.max(1, Math.floor(ac.sampleRate * dur));
      const b = ac.createBuffer(1, n, ac.sampleRate);
      const ch = b.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = ac.createBufferSource();
      s.buffer = b;
      const f = ac.createBiquadFilter();
      f.type = type || "highpass";
      f.frequency.value = freq;
      const g = ac.createGain();
      g.gain.value = vol || 0.25;
      s.connect(f);
      f.connect(g);
      g.connect(master);
      s.start();
    }
    return {
      init,
      get muted() {
        return muted;
      },
      toggleMute() {
        muted = !muted;
        if (master) master.gain.value = muted ? 0 : 0.5;
        try {
          localStorage.setItem("kc.mute", muted ? "1" : "0");
        } catch (e) {
          /* ignore */
        }
        return muted;
      },
      wind(strength) {
        if (windGain) {
          windGain.gain.value = clamp(strength, 0, 1) * 0.16;
          if (windFilter) windFilter.frequency.value = 240 + strength * 500;
        }
      },
      whoosh() {
        noise(0.7, 300, 0.16, "bandpass");
      },
      creak() {
        tone(rand(70, 110), 0.07, "triangle", 0.05, 50);
      },
      lock() {
        tone(520, 0.07, "square", 0.12);
      },
      snap() {
        noise(0.16, 1800, 0.5);
        tone(700, 0.22, "square", 0.12, 120);
      },
      cutWin() {
        tone(660, 0.12, "triangle", 0.22);
        setTimeout(() => tone(880, 0.12, "triangle", 0.22), 90);
        setTimeout(() => tone(1320, 0.25, "triangle", 0.22), 180);
      },
      thud() {
        tone(120, 0.18, "sine", 0.3, 55);
        noise(0.1, 500, 0.2, "lowpass");
      },
      cheer() {
        noise(1.4, 900, 0.3, "bandpass");
      },
      lose() {
        tone(300, 0.5, "sawtooth", 0.18, 70);
      },
    };
  })();

  /* ---------------- lines & crossings ---------------- */
  function linePoints(k, anchor, out) {
    const mx = (anchor.x + k.x) / 2;
    const my = (anchor.y + k.y) / 2;
    const dx = k.x - anchor.x;
    const dy = k.y - anchor.y;
    const len = Math.hypot(dx, dy) || 1;
    const sag = (1 - k.tension) * clamp(len * 0.16, 20, 90);
    const cx = mx - (dy / len) * sag;
    const cy = my + (dx / len) * sag;
    const n = 22;
    out.length = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const it = 1 - t;
      out.push({
        x: it * it * anchor.x + 2 * it * t * cx + t * t * k.x,
        y: it * it * anchor.y + 2 * it * t * cy + t * t * k.y,
      });
    }
    return { cx, cy };
  }

  function segInt(a, b, c, d) {
    const r1 = b.x - a.x;
    const r2 = b.y - a.y;
    const s1 = d.x - c.x;
    const s2 = d.y - c.y;
    const den = r1 * s2 - r2 * s1;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((c.x - a.x) * s2 - (c.y - a.y) * s1) / den;
    const u = ((c.x - a.x) * r2 - (c.y - a.y) * r1) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return { x: a.x + r1 * t, y: a.y + r2 * t };
    }
    return null;
  }

  function crossInfo() {
    let hit = null;
    let minD = 1e9;
    let minPt = null;
    for (let i = 0; i < polyP.length - 1; i++) {
      const a = polyP[i];
      const b = polyP[i + 1];
      for (let j = 0; j < polyR.length - 1; j++) {
        const c = polyR[j];
        const p = segInt(a, b, c, polyR[j + 1]);
        if (p) {
          if (!hit) hit = p;
        } else {
          const d = polyR[j + 1];
          const dd = Math.min(
            dist(a.x, a.y, c.x, c.y),
            dist(a.x, a.y, d.x, d.y),
            dist(b.x, b.y, c.x, c.y),
            dist(b.x, b.y, d.x, d.y),
          );
          if (dd < minD) {
            minD = dd;
            minPt = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
          }
        }
      }
    }
    // a strict crossing starts the duel; coming very close counts too —
    // glass lines fight at a touch
    return {
      hit,
      close: !hit && minD < 18 ? minPt : null,
      near: minD < 40 ? minPt : null,
    };
  }

  /* ---------------- duel (the pull-ring) ---------------- */
  let duel = null;
  function startDuel(pt) {
    const hw = clamp(0.55 - level * 0.1, 0.17, 0.6);

    duel = {
      x: clamp(pt.x, 100, W - 100),
      y: clamp(pt.y, 120, H - 130),
      needle: rand(0, TAU),
      dir: Math.random() < 0.5 ? 1 : -1,
      speed: 2.6 + level * 0.45,
      zone: rand(0, TAU),
      hw,
      rot: 0,
      lock: null,
      lockT: 0,
      result: null,
    };
    state = ST.DUEL;
    audio.lock();
  }

  function attemptPull() {
    if (!duel || duel.lock !== null) return;
    let off = angDist(duel.needle, duel.zone) / duel.hw;
    if (off > 1) off = 9; // pulled wide of the notch
    const rv = RIVALS[level];
    const aiOff = Math.abs(randn()) * 0.55 * (1.12 - rv.skill) + 0.1;
    duel.lock = duel.needle;
    duel.pOff = Math.min(off, 9);
    duel.aiOff = aiOff;
    duel.result = off < aiOff ? "win" : "lose";
    duel.lockT = 0.75;
    audio.snap();
    shake = duel.result === "win" ? 5 : 9;
  }

  function updDuel(dt) {
    updWorld(dt * 0.16, true); // slow motion while the ring spins
    const d = duel;
    if (d.lock === null) {
      d.rot += d.speed * dt;
      d.needle = (d.needle + d.dir * d.speed * dt) % TAU;
      if (d.rot > TAU * 2.8) {
        d.lock = d.needle;
        d.result = "lose";
        d.lockT = 0.9;
        audio.lose();
      }
    } else {
      d.lockT -= dt;
      if (d.lockT <= 0) resolveDuel();
    }
  }

  function resolveDuel() {
    const won = duel.result === "win";
    burst(duel.x, duel.y, won ? 26 : 14, won ? "#ffd97a" : "#ff8d7a");
    coolT = 2.1;
    state = ST.PLAY;
    if (won) {
      cutsMade++;
      const pts = 900 + level * 350;
      score += pts;
      rival.alive = false;
      rival.vx = rand(-70, 70);
      rival.vy = -60;
      flash = 0.55;
      flashCol = "#fff";
      audio.cutWin();
      banner("LINE CUT!", "+" + pts, 1.5);
      if (level < RIVALS.length - 1) {
        pendNext = level + 1;
        nextT = 2.0;
      } else {
        pendNext = "champion";
        nextT = 2.2;
        setTimeout(() => audio.cheer(), 350);
      }
    } else {
      strands--;
      renderStrands();
      const mid = polyP[Math.floor(polyP.length / 2)];
      burst(mid.x, mid.y, 10, "#ffe9b8");
      flash = 0.5;
      flashCol = "#ff5d47";
      if (strands <= 0) {
        player.alive = false;
        player.vx = rand(-40, 40);
        player.vy = -30;
        audio.lose();
        pendNext = "defeat";
        nextT = 1.5;
      } else {
        banner(
          "YOUR STRAND SNAPPED",
          strands + (strands === 1 ? " strand left" : " strands left"),
          1.5,
        );
      }
    }
    duel = null;
    updHud();
  }

  function actPending() {
    const what = pendNext;
    pendNext = null;
    if (what === "defeat") endGame(false);
    else if (what === "champion") endGame(true);
    else spawnRival(what);
  }

  function spawnRival(lv) {
    level = lv;
    const rv = RIVALS[lv];
    rival = makeKite(ANCHOR_R, { turn: rv.turn, base: rv.base });
    rival.x = ANCHOR_R.x - 60;
    rival.y = 260;
    rival.tx = rival.x;
    rival.ty = rival.y;
    coolT = 1.4;
    banner("ROUND " + (lv + 1), rv.name + ", " + rv.epi, 2.0);
    elRival.textContent = "vs " + rv.name + " — " + rv.epi;
  }

  function endGame(won) {
    state = won ? ST.WIN : ST.OVER;
    bannerEl.classList.remove("show");
    const bonus = won ? strands * 250 : 0;
    const fin = score + bonus;
    let best = fin;
    try {
      best = parseInt(localStorage.getItem("kc.best") || "0", 10) || 0;
      if (fin > best) {
        best = fin;
        localStorage.setItem("kc.best", String(best));
      }
    } catch (e) {
      /* storage unavailable */
    }
    endTitle.textContent = won
      ? "Champion of the terrace!"
      : "Your line snapped.";
    endSub.textContent = won
      ? "Three rivals, three falling kites. The whole galli is chanting your name."
      : RIVALS[level].name +
        " saws your last strand free. The terrace roars for her.";
    endCuts.textContent = String(cutsMade);
    endStrands.textContent =
      strands + "/3" + (bonus ? " (+" + bonus + ")" : "");
    endScore.textContent = String(fin);
    endBest.textContent = String(best);
    showPanel(panelEnd);
    if (won) confetti();
  }

  function startMatch() {
    score = 0;
    strands = 3;
    cutsMade = 0;
    coolT = 0;
    nextT = 0;
    pendNext = null;
    duel = null;
    paused = false;
    birds.length = 0;
    parts.length = 0;
    wind.phase = "idle";
    wind.timer = rand(4, 7);
    player = makeKite(ANCHOR_P, { turn: 3.4, base: 128 });
    player.x = 190;
    player.y = 300;
    player.tx = 300;
    player.ty = 280;
    pointer.x = player.tx;
    pointer.y = player.ty;
    pointer.has = false;
    keys.active = false;
    keys.space = false;
    renderStrands();
    updHud();
    showPanel(null);
    panelPause.classList.remove("show");
    state = ST.PLAY;
    spawnRival(0);
  }

  /* ---------------- per-frame systems ---------------- */
  function updPlay(dt) {
    updWorld(dt, false);
    if (coolT > 0) coolT -= dt;
    if (nextT > 0) {
      nextT -= dt;
      if (nextT <= 0) actPending();
    }
    nearPt = null;
    if (coolT <= 0 && !pendNext && player.alive && rival && rival.alive) {
      const ci = crossInfo();
      const at = ci.hit || ci.close;
      if (at) startDuel(at);
      else nearPt = ci.near;
    }
  }

  function updWorld(dt, slow) {
    if (player) updKite(player, dt, !slow);
    if (rival) {
      if (rival.alive) {
        if (!slow) rivalThink(rival, dt, wind.t);
        else rival.haul = false;
        updKite(rival, dt, false);
      } else {
        updKite(rival, dt, false);
      }
    }
    updBirds(dt);
    ctrlP = linePoints(player, ANCHOR_P, polyP);
    if (rival) ctrlR = linePoints(rival, ANCHOR_R, polyR);
  }

  function rivalThink(r, dt, t) {
    const rv = RIVALS[level];
    r.ai -= dt;
    if (r.ai <= 0) {
      r.mode = Math.random() < rv.chance ? "attack" : "lure";
      r.modeT = r.mode === "attack" ? rand(2.2, 3.6) : rand(1.2, 2.4);
      r.ai = rand(rv.aggrMin, rv.aggrMax);
    }
    if (r.mode === "attack" && player.alive && polyP.length > 6) {
      r.modeT -= dt;
      const idx = clamp(Math.floor(polyP.length * 0.62), 0, polyP.length - 1);
      const p = polyP[idx];
      // aim through the line, not merely at it — the wrap is what cuts
      const ang = Math.atan2(p.y - r.y, p.x - r.x);
      r.tx = p.x + Math.cos(ang) * 48;
      r.ty = p.y + Math.sin(ang) * 48;
      r.haul = dist(r.x, r.y, p.x, p.y) > 120;
      if (r.modeT <= 0) r.mode = "lure";
    } else {
    }
    r.tx = clamp(r.tx, SKY.x0, SKY.x1);
    r.ty = clamp(r.ty, SKY.y0, SKY.y1);
  }

  function updKite(k, dt, control) {
    if (!k.alive) {
      k.vy += 560 * dt;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.rot += 5.5 * dt;
      return;
    }
    if (control) {
      if (keys.active) {
        k.tx += keys.vx * dt;
        k.ty += keys.vy * dt;
      } else if (pointer.has) {
        k.tx = pointer.x;
        k.ty = pointer.y;
      }
      k.tx = clamp(k.tx, SKY.x0, SKY.x1);
      k.ty = clamp(k.ty, SKY.y0, SKY.y1);
      k.haul = (pointer.down || keys.space) && k.stun <= 0 && state === ST.PLAY;
    }
    if (k.stun > 0) {
      k.stun -= dt;
      k.heading += 5 * dt;
      k.spd = lerp(k.spd, 40, Math.min(1, 3 * dt));
      k.haul = false;
    } else {
      const des = Math.atan2(k.ty - k.y, k.tx - k.x);
      let da = des - k.heading;
      da = ((((da + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
      const tr = k.turn * (k.haul ? 1.2 : 1);
      k.heading += clamp(da, -tr * dt, tr * dt);
      const tgt = k.base + (k.haul ? 175 : 0);
      k.spd = lerp(k.spd, tgt, Math.min(1, (k.haul ? 6.5 : 3) * dt));
    }
    k.tension = lerp(k.tension, k.haul ? 1 : 0.08, Math.min(1, 7 * dt));
    if (k.haul) {
      k.creak -= dt;
      if (k.creak <= 0) {
        audio.creak();
        k.creak = rand(0.12, 0.3);
      }
    }
    k.x += (Math.cos(k.heading) * k.spd + wind.x * 0.6) * dt;
    k.y +=
      (Math.sin(k.heading) * k.spd + wind.y * 0.6 + (1 - k.tension) * 30) * dt;
    if (k.x < SKY.x0) {
      k.x = SKY.x0;
      k.tx = Math.max(k.tx, SKY.x0 + 30);
    }
    if (k.x > SKY.x1) {
      k.x = SKY.x1;
      k.tx = Math.min(k.tx, SKY.x1 - 30);
    }
    if (k.y < SKY.y0) {
      k.y = SKY.y0;
      k.ty = Math.max(k.ty, SKY.y0 + 30);
    }
    if (k.y > SKY.y1) {
      k.y = SKY.y1;
      k.ty = Math.min(k.ty, SKY.y1 - 40);
    }
    k.hist.unshift({ x: k.x, y: k.y });
    if (k.hist.length > 20) k.hist.pop();
  }

  function updBirds(dt) {
    birdT -= dt;
    if (birdT <= 0 && birds.length < 2 && state !== ST.MENU) {
      birdT = rand(7, 13);
      const fromLeft = Math.random() < 0.5;
      birds.push({
        x: fromLeft ? -40 : W + 40,
        y: rand(130, 430),
        vx: (fromLeft ? 1 : -1) * rand(95, 155),
        ph: rand(0, TAU),
        hit: false,
      });
    }
    for (let i = birds.length - 1; i >= 0; i--) {
      const b = birds[i];
      b.x += b.vx * dt;
      b.ph += dt * 10;
      if (b.x < -80 || b.x > W + 80) {
        birds.splice(i, 1);
        continue;
      }
      if (state === ST.MENU) continue;
      for (const k of [player, rival]) {
        if (!k || !k.alive || k.stun > 0 || b.hit) continue;
        if (dist(k.x, k.y, b.x, b.y) < 30) {
          b.hit = true;
          k.stun = 0.75;
          k.tension *= 0.3;
          burst(k.x, k.y, 8, "#dcd7ee");
          audio.thud();
          shake = 6;
        }
      }
    }
  }

  function burst(x, y, n, col) {
    const m = reducedMotion ? Math.ceil(n / 2) : n;
    for (let i = 0; i < m; i++) {
      const a = rand(0, TAU);
      const sp = rand(40, 260);
      parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: rand(0.5, 1.1),
        t: 0,
        col,
        sz: rand(1.5, 3.5),
        g: 150,
      });
    }
  }

  function confetti() {
    const cols = ["#ffd97a", "#ef6a51", "#59d9a2", "#c79bff", "#ffffff"];
    for (let i = 0; i < 90; i++) {
      parts.push({
        x: rand(W * 0.2, W * 0.8),
        y: rand(60, 200),
        vx: rand(-60, 60),
        vy: rand(20, 120),
        life: rand(1.2, 2.4),
        t: 0,
        col: cols[Math.floor(rand(0, cols.length))],
        sz: rand(2, 4),
        g: 60,
      });
    }
  }

  function updParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      if (p.t >= p.life) {
        parts.splice(i, 1);
        continue;
      }
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function updClouds(dt) {
    for (const c of clouds) {
      c.x += (c.v + Math.abs(wind.x) * 0.12) * dt;
      if (c.x > W + 120) c.x = -120;
    }
  }

  /* ---------------- input ---------------- */
  const pointer = { x: W / 2, y: H / 2, down: false, has: false };
  const keys = { vx: 0, vy: 0, space: false, active: false };
  const held = new Set();

  function evtWorld(e) {
    const r = cv.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H,
    };
  }

  function primaryPress() {
    if (paused) {
      togglePause(false);
      return;
    }
    if (state === ST.MENU) startMatch();
    else if (state === ST.DUEL) attemptPull();
  }

  cv.addEventListener("pointermove", (e) => {
    const p = evtWorld(e);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.has = true;
    keys.active = false;
  });
  cv.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    audio.init();
    const p = evtWorld(e);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.has = true;
    pointer.down = true;
    primaryPress();
  });
  window.addEventListener("pointerup", () => {
    pointer.down = false;
  });
  window.addEventListener("pointercancel", () => {
    pointer.down = false;
  });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());

  function recalcKeys() {
    let x = 0;
    let y = 0;
    if (held.has("ArrowLeft") || held.has("KeyA")) x -= 1;
    if (held.has("ArrowRight") || held.has("KeyD")) x += 1;
    if (held.has("ArrowUp") || held.has("KeyW")) y -= 1;
    if (held.has("ArrowDown") || held.has("KeyS")) y += 1;
    if (x || y) {
      keys.active = true;
      pointer.has = false;
    } else {
      keys.active = false;
    }
    const n = Math.hypot(x, y) || 1;
    keys.vx = (x / n) * 430;
    keys.vy = (y / n) * 430;
  }

  window.addEventListener("keydown", (e) => {
    const c = e.code;
    if (
      c === "ArrowLeft" ||
      c === "ArrowRight" ||
      c === "ArrowUp" ||
      c === "ArrowDown" ||
      c === "Space"
    ) {
      e.preventDefault();
    }
    audio.init();
    if (c === "KeyM") {
      toggleMuteBtn();
      return;
    }
    if (c === "KeyP" || c === "Escape") {
      togglePause();
      return;
    }
    if (c === "KeyR") {
      if (state !== ST.MENU) startMatch();
      return;
    }
    if (c === "Enter") {
      if (state === ST.MENU || state === ST.OVER || state === ST.WIN)
        startMatch();
      else if (state === ST.DUEL) attemptPull();
      return;
    }
    if (c === "Space") {
      keys.space = true;
      if (!e.repeat) primaryPress();
      return;
    }
    held.add(c);
    recalcKeys();
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") keys.space = false;
    held.delete(e.code);
    recalcKeys();
  });

  function togglePause(force) {
    if (state !== ST.PLAY && state !== ST.DUEL) return;
    const want = typeof force === "boolean" ? force : !paused;
    if (want === paused) return;
    paused = want;
    panelPause.classList.toggle("show", paused);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) togglePause(true);
  });

  /* ---------------- ui glue ---------------- */
  function showPanel(p) {
    for (const el of [panelMenu, panelPause, panelEnd]) {
      el.classList.toggle("show", el === p);
    }
  }
  function banner(main, sub, dur) {
    bannerMain.textContent = main;
    bannerSub.textContent = sub || "";
    bannerEl.classList.remove("show");
    void bannerEl.offsetWidth;
    bannerEl.classList.add("show");
    banT = dur || 1.6;
  }
  function renderStrands() {
    for (let i = 0; i < elStrands.children.length; i++) {
      elStrands.children[i].classList.toggle("off", i >= strands);
    }
  }
  function updHud() {
    elScore.textContent = String(score);
  }
  function toggleMuteBtn() {
    audio.init();
    const m = audio.toggleMute();
    btnMute.classList.toggle("off", m);
    btnMute.setAttribute("aria-pressed", String(m));
  }

  // blur any clicked control so a follow-up Space/Enter never re-triggers it
  for (const b of document.querySelectorAll("button")) {
    b.addEventListener("click", (e) => e.currentTarget.blur());
  }
  $("#btn-start").addEventListener("click", () => {
    audio.init();
    startMatch();
  });
  $("#btn-again").addEventListener("click", () => {
    audio.init();
    startMatch();
  });
  $("#btn-resume").addEventListener("click", () => togglePause(false));
  $("#btn-pause").addEventListener("click", () => togglePause());
  $("#btn-restart").addEventListener("click", () => startMatch());
  btnMute.addEventListener("click", toggleMuteBtn);

  if (audio.muted) {
    btnMute.classList.add("off");
    btnMute.setAttribute("aria-pressed", "true");
  }

  /* ---------------- rendering ---------------- */
  let skyGrad = null;
  function drawSky() {
    if (!skyGrad) {
      skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, "#232a52");
      skyGrad.addColorStop(0.45, "#4b3a68");
      skyGrad.addColorStop(0.72, "#a45577");
      skyGrad.addColorStop(0.92, "#f2a25e");
      skyGrad.addColorStop(1, "#ffc98a");
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-8, -8, W + 16, H + 16);
    const sun = ctx.createRadialGradient(700, 486, 8, 700, 486, 110);
    sun.addColorStop(0, "rgba(255,236,190,0.95)");
    sun.addColorStop(0.25, "rgba(255,200,130,0.55)");
    sun.addColorStop(1, "rgba(255,200,130,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(560, 350, 290, 220);
  }

  function drawClouds() {
    ctx.fillStyle = "rgba(247,217,196,0.32)";
    for (const c of clouds) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 46 * c.s, 13 * c.s, 0, 0, TAU);
      ctx.ellipse(c.x + 30 * c.s, c.y - 7 * c.s, 30 * c.s, 10 * c.s, 0, 0, TAU);
      ctx.ellipse(c.x - 32 * c.s, c.y - 4 * c.s, 26 * c.s, 9 * c.s, 0, 0, TAU);
      ctx.fill();
    }
  }

  const HILLS = [
    [-10, 512],
    [90, 468],
    [215, 504],
    [330, 452],
    [470, 498],
    [610, 458],
    [760, 502],
    [880, 470],
    [970, 508],
  ];
  const HOUSES = [
    { x: 16, w: 128, y: 550 },
    { x: 152, w: 104, y: 562 },
    { x: 262, w: 66, y: 574 },
    { x: 372, w: 240, y: 578 },
    { x: 618, w: 70, y: 572 },
    { x: 694, w: 112, y: 560 },
    { x: 812, w: 132, y: 548 },
  ];

  function drawGround() {
    ctx.fillStyle = "#2a2450";
    ctx.beginPath();
    ctx.moveTo(HILLS[0][0], HILLS[0][1]);
    for (let i = 1; i < HILLS.length; i++) {
      const p = HILLS[i];
      const q = HILLS[i - 1];
      ctx.quadraticCurveTo(
        (q[0] + p[0]) / 2,
        Math.min(q[1], p[1]) - 26,
        p[0],
        p[1],
      );
    }
    ctx.lineTo(W + 10, H + 10);
    ctx.lineTo(-10, H + 10);
    ctx.closePath();
    ctx.fill();

    for (const hs of HOUSES) {
      ctx.fillStyle = "#6f3a30";
      ctx.fillRect(hs.x, hs.y, hs.w, H - hs.y + 10);
      ctx.fillStyle = "#8a4a3b";
      ctx.fillRect(hs.x - 4, hs.y - 7, hs.w + 8, 9);
      ctx.fillStyle = "#57291f";
      for (let bx = hs.x + 10; bx < hs.x + hs.w - 8; bx += 18) {
        ctx.fillRect(bx, hs.y + 3, 10, 3);
      }
      if (hs.w > 100) {
        ctx.fillStyle = "#4a2f27";
        ctx.fillRect(hs.x + hs.w - 30, hs.y - 26, 12, 22);
        ctx.fillStyle = "rgba(255,210,127,0.85)";
        ctx.fillRect(hs.x + 18, hs.y + 18, 9, 11);
        ctx.fillRect(hs.x + hs.w - 52, hs.y + 30, 9, 11);
      }
    }
    for (const an of [ANCHOR_P, ANCHOR_R]) {
      ctx.fillStyle = "#3d2721";
      ctx.fillRect(an.x - 6, an.y - 26, 12, 62);
      ctx.fillRect(an.x - 17, an.y - 26, 34, 7);
      ctx.fillStyle = "#c9b38f";
      ctx.beginPath();
      ctx.ellipse(an.x, an.y - 30, 13, 5, 0, 0, TAU);
      ctx.fill();
    }
    const bunt = ["#ffd166", "#ef6a51", "#59d9a2", "#c79bff"];
    ctx.strokeStyle = "rgba(255,235,200,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, 586);
    ctx.quadraticCurveTo(W / 2, 600, W - 30, 586);
    ctx.stroke();
    for (let i = 0; i < 14; i++) {
      const t = (i + 0.5) / 14;
      const bx = lerp(30, W - 30, t);
      const by = 586 + Math.sin(t * Math.PI) * 13;
      ctx.fillStyle = bunt[i % bunt.length];
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(bx - 5, by);
      ctx.lineTo(bx + 5, by);
      ctx.lineTo(bx, by + 9);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawKiteShape(x, y, ang, main, dark, glow) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    if (glow) {
      ctx.shadowColor = main;
      ctx.shadowBlur = 16;
    }
    const g = ctx.createLinearGradient(0, -30, 0, 34);
    g.addColorStop(0, main);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -30);
    ctx.lineTo(21, 2);
    ctx.lineTo(0, 34);
    ctx.lineTo(-21, 2);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -30);
    ctx.lineTo(0, 34);
    ctx.moveTo(-21, 2);
    ctx.lineTo(21, 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawKiteEnt(k, main, dark) {
    if (k.hist.length > 2 && k.alive) {
      ctx.strokeStyle = "rgba(255,235,200,0.45)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < k.hist.length; i++) {
        const p = k.hist[i];
        if (i) ctx.lineTo(p.x, p.y + 10 + i * 1.2);
        else ctx.moveTo(p.x, p.y + 10);
      }
      ctx.stroke();
      for (let i = 3; i < k.hist.length; i += 4) {
        const p = k.hist[i];
        ctx.save();
        ctx.translate(p.x, p.y + 12 + i * 1.2);
        ctx.rotate(i);
        ctx.fillStyle = i % 8 ? "#ff8d6b" : "#ffd166";
        ctx.fillRect(-3, -1.5, 6, 3);
        ctx.restore();
      }
    }
    const spin = k.stun > 0 || !k.alive ? k.rot : 0;
    drawKiteShape(
      k.x,
      k.y,
      k.heading + Math.PI / 2 + spin,
      main,
      dark,
      k.haul && k.alive,
    );
  }

  function drawLine(anchor, ctrl, poly, col) {
    if (!poly.length) return;
    const tip = poly[poly.length - 1];
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.quadraticCurveTo(ctrl.cx, ctrl.cy, tip.x, tip.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawBird(b) {
    const f = Math.sin(b.ph) * 0.9;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(b.vx > 0 ? 1 : -1, 1);
    ctx.fillStyle = "#4a4363";
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 5, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#5c5478";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-2, -1);
    ctx.quadraticCurveTo(-10, -8 - f * 8, -18, -4 - f * 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(2, -1);
    ctx.quadraticCurveTo(10, -8 - f * 8, 18, -4 - f * 10);
    ctx.stroke();
    ctx.restore();
  }

  function drawParts() {
    for (const p of parts) {
      ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
      ctx.fillStyle = p.col;
      if (p.sz > 6) ctx.fillRect(p.x, p.y, p.sz, 1.5);
      else ctx.fillRect(p.x - p.sz / 2, p.y - p.sz / 2, p.sz, p.sz);
    }
    ctx.globalAlpha = 1;
  }

  function drawWindTelegraph() {
    if (wind.phase === "idle") return;
    if (wind.phase === "warn" && Math.floor(performance.now() / 130) % 2 === 0)
      return;
    const dir = Math.sign(wind.gx) || 1;
    ctx.save();
    ctx.translate(W / 2, 88);
    ctx.scale(dir, 1);
    ctx.strokeStyle =
      wind.phase === "gust" ? "rgba(255,255,255,0.9)" : "rgba(255,209,102,0.9)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const yy = -12 + i * 12;
      const len = 26 + i * 12;
      ctx.beginPath();
      ctx.moveTo(-len, yy);
      ctx.lineTo(len * 0.4, yy);
      if (i === 1) {
        ctx.moveTo(len * 0.4 - 8, yy - 8);
        ctx.lineTo(len * 0.4, yy);
        ctx.lineTo(len * 0.4 - 8, yy + 8);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDuel() {
    const d = duel;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.fillStyle = "rgba(10,12,24,0.55)";
    ctx.beginPath();
    ctx.arc(0, 0, 74, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(0, 0, 58, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(0, 0, 58, d.zone - d.hw, d.zone + d.hw);
    ctx.stroke();
    const na = d.lock !== null ? d.lock : d.needle;
    ctx.rotate(na);
    ctx.strokeStyle =
      d.result === "win"
        ? "#7dffbe"
        : d.result === "lose"
          ? "#ff7d6b"
          : "#ffffff";
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(44, 0);
    ctx.lineTo(72, 0);
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = "center";
    ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
    if (d.lock === null) {
      ctx.fillStyle = "#ffe9b8";
      ctx.fillText("PULL!", d.x, d.y - 86);
    } else {
      ctx.fillStyle = d.result === "win" ? "#7dffbe" : "#ff7d6b";
      ctx.font = '800 20px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(d.result === "win" ? "CUT!" : "SNAPPED…", d.x, d.y + 102);
    }
  }

  function drawMenuKites(t) {
    const kx1 = ANCHOR_P.x + 90 + Math.sin(t * 0.8) * 44;
    const ky1 = 296 + Math.sin(t * 1.3) * 24;
    const kx2 = ANCHOR_R.x - 90 + Math.cos(t * 0.7) * 44;
    const ky2 = 276 + Math.cos(t * 1.1) * 26;
    ctx.strokeStyle = "rgba(255,233,184,0.5)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(ANCHOR_P.x, ANCHOR_P.y - 28);
    ctx.quadraticCurveTo(
      (ANCHOR_P.x + kx1) / 2,
      (ANCHOR_P.y + ky1) / 2 + 40,
      kx1,
      ky1,
    );
    ctx.moveTo(ANCHOR_R.x, ANCHOR_R.y - 28);
    ctx.quadraticCurveTo(
      (ANCHOR_R.x + kx2) / 2,
      (ANCHOR_R.y + ky2) / 2 + 40,
      kx2,
      ky2,
    );
    ctx.stroke();
    drawKiteShape(
      kx1,
      ky1,
      Math.sin(t * 0.8) * 0.3 - 0.5,
      P_MAIN,
      P_DARK,
      false,
    );
    drawKiteShape(
      kx2,
      ky2,
      Math.cos(t * 0.7) * 0.3 + 0.5,
      RIVALS[0].main,
      RIVALS[0].dark,
      false,
    );
  }

  function render(t) {
    ctx.setTransform(view.s, 0, 0, view.s, 0, 0);
    if (shake > 0)
      ctx.translate(rand(-shake, shake) * 0.5, rand(-shake, shake) * 0.5);
    drawSky();
    drawClouds();
    drawGround();
    if (state === ST.MENU) {
      drawMenuKites(t);
    } else {
      drawLine(ANCHOR_P, ctrlP, polyP, "#ffe9b8");
      if (rival) drawLine(ANCHOR_R, ctrlR, polyR, "#9df0da");
      if (nearPt && state === ST.PLAY) {
        const pr = 4 + Math.sin(t * 10) * 2;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(nearPt.x, nearPt.y, pr, 0, TAU);
        ctx.fill();
      }
      if (player) drawKiteEnt(player, P_MAIN, P_DARK);
      if (rival) drawKiteEnt(rival, RIVALS[level].main, RIVALS[level].dark);
      for (const b of birds) drawBird(b);
      if (duel) drawDuel();
    }
    drawParts();
    drawWindTelegraph();
    if (flash > 0) {
      ctx.globalAlpha = clamp(flash, 0, 1) * 0.5;
      ctx.fillStyle = flashCol;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------- loop ---------------- */
  function update(dt) {
    if (banT > 0) {
      banT -= dt;
      if (banT <= 0) bannerEl.classList.remove("show");
    }
    if (shake > 0) shake = Math.max(0, shake - 30 * dt);
    if (flash > 0) flash -= 3 * dt;
    updWind(dt);
    audio.wind(Math.abs(wind.x) / 340 + (player && player.haul ? 0.25 : 0));
    if (state === ST.PLAY) updPlay(dt);
    else if (state === ST.DUEL) updDuel(dt);
    updParts(dt);
    updClouds(dt);
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (!paused && !document.hidden) update(dt);
    render(now / 1000);
  }

  /* ---------------- boot ---------------- */
  renderStrands();
  updHud();
  resize();
  showPanel(panelMenu);
  requestAnimationFrame(frame);

  /* headless-check probe: read-only view of match state (harmless in play) */
  window.kcProbe = () => ({
    state,
    paused,
    level,
    score,
    strands,
    cuts: cutsMade,
    duelActive: !!duel,
    needle: duel ? duel.needle : null,
    zone: duel ? duel.zone : null,
    hw: duel ? duel.hw : null,
    speed: duel ? duel.speed : null,
    dir: duel ? duel.dir : null,
    locked: duel ? duel.lock !== null : null,
    lockAngle: duel ? duel.lock : null,
    result: duel ? duel.result : null,
    pOff: duel ? duel.pOff : null,
    aiOff: duel ? duel.aiOff : null,
  });

  /* headless-check hook: settle the live ring as if the player had pulled
     with the given quality (0 = perfect). Unused during normal play. */
  window.kcPull = (quality) => {
    if (!duel || duel.lock !== null) return false;
    const off = typeof quality === "number" ? quality : 9;
    const rv = RIVALS[level];
    duel.lock = duel.needle;
    duel.pOff = Math.min(off, 9);
    duel.aiOff = Math.abs(randn()) * 0.55 * (1.12 - rv.skill) + 0.1;
    duel.result = off < duel.aiOff ? "win" : "lose";
    duel.lockT = 0.05;
    return true;
  };
})();
