(() => {
  "use strict";

  /* ============================================================
     Shadow Stage - a shadow-puppet silhouette puzzle
     Drag translucent puppets behind a lantern screen and resize
     them to assemble each fable's silhouette before the
     audience's patience runs out.
     ============================================================ */

  /* ---------- stage geometry (logical units) ---------- */
  const LW = 960;
  const LH = 600;
  const SX = 70;
  const SY = 48;
  const SW = 820;
  const SH = 330;
  const BENCH_Y = 452;
  const LAMP = { x: LW / 2, y: 592 };

  const COLORS = [
    "#d95a4a",
    "#3fa7a3",
    "#e8b34b",
    "#9b7bd4",
    "#67b055",
    "#e08b3e",
    "#d96fa0",
  ];
  const SHADOW_C = [
    "#241420",
    "#14201f",
    "#231a10",
    "#1d1730",
    "#16210f",
    "#241708",
    "#260f1c",
  ];

  /* ---------- scenes ----------
     Positions are fractions of the screen (x of SW, y of SH);
     sizes are fractions of SH. Each target piece maps 1:1 to a
     puppet the player slides behind the screen. */
  const SCENES = [
    {
      name: "The Apple",
      target: [
        { t: "circle", x: 0.5, y: 0.62, r: 0.18 },
        { t: "rect", x: 0.5, y: 0.37, w: 0.02, h: 0.1 },
        { t: "diamond", x: 0.57, y: 0.32, w: 0.09, h: 0.05 },
      ],
    },
    {
      name: "The Duck",
      target: [
        { t: "circle", x: 0.42, y: 0.64, r: 0.19 },
        { t: "circle", x: 0.66, y: 0.4, r: 0.115 },
        { t: "tri", x: 0.83, y: 0.42, w: 0.12, h: 0.07, rot: 90 },
        { t: "tri", x: 0.225, y: 0.56, w: 0.11, h: 0.08, rot: -125 },
      ],
    },
    {
      name: "The Rabbit",
      target: [
        { t: "circle", x: 0.46, y: 0.68, r: 0.165 },
        { t: "rect", x: 0.385, y: 0.39, w: 0.05, h: 0.25, rot: 8 },
        { t: "rect", x: 0.55, y: 0.37, w: 0.05, h: 0.25, rot: -8 },
      ],
    },
    {
      name: "The Sailboat",
      target: [
        { t: "rect", x: 0.5, y: 0.77, w: 0.42, h: 0.09 },
        { t: "rect", x: 0.5, y: 0.48, w: 0.016, h: 0.32 },
        { t: "tri", x: 0.553, y: 0.47, w: 0.26, h: 0.29, rot: 90 },
      ],
    },
    {
      name: "The Fox",
      target: [
        { t: "tri", x: 0.5, y: 0.58, w: 0.34, h: 0.28, rot: 180 },
        { t: "tri", x: 0.36, y: 0.35, w: 0.1, h: 0.14 },
        { t: "tri", x: 0.64, y: 0.35, w: 0.1, h: 0.14 },
        { t: "tri", x: 0.78, y: 0.74, w: 0.28, h: 0.12, rot: -160 },
      ],
    },
    {
      name: "Mountain & Moon",
      target: [
        { t: "tri", x: 0.32, y: 0.73, w: 0.48, h: 0.46 },
        { t: "tri", x: 0.66, y: 0.78, w: 0.36, h: 0.3 },
        { t: "circle", x: 0.83, y: 0.18, r: 0.075 },
      ],
    },
    {
      name: "The Dragon",
      target: [
        { t: "diamond", x: 0.38, y: 0.63, w: 0.17, h: 0.11, rot: -20 },
        { t: "diamond", x: 0.51, y: 0.56, w: 0.16, h: 0.105, rot: -12 },
        { t: "diamond", x: 0.635, y: 0.5, w: 0.14, h: 0.095, rot: -5 },
        { t: "tri", x: 0.79, y: 0.45, w: 0.17, h: 0.13, rot: -25 },
        { t: "tri", x: 0.45, y: 0.36, w: 0.28, h: 0.21, rot: -100 },
        { t: "tri", x: 0.245, y: 0.69, w: 0.17, h: 0.09, rot: 200 },
      ],
    },
  ];

  /* ---------- tuning ---------- */
  const PASS = 0.75;
  const STAR2 = 0.85;
  const STAR3 = 0.93;
  const DRAIN = 0.45; // audience patience per second
  const SCENE_BONUS = 8;
  const FAIL_PENALTY = 7;
  const MIN_S = 0.35;
  const MAX_S = 3.4;

  const JITTER = [
    [0.055, -0.07],
    [-0.06, 0.075],
    [0.045, 0.085],
    [-0.045, -0.085],
    [0.07, 0.03],
    [-0.07, -0.03],
  ];

  /* ---------- dom ---------- */
  const $ = (id) => document.getElementById(id);
  const canvas = $("stage");
  const ctx = canvas.getContext("2d");
  const elPatience = $("patience-fill");
  const elMatchBar = $("match-fill").parentElement;
  const elMatchFill = $("match-fill");
  const elMatchNum = $("match-num");
  const elSceneName = $("scene-name");
  const elSceneCount = $("scene-count");
  const elScore = $("score-readout");
  const overlay = $("overlay");
  const card = $("card");

  /* ---------- audio (Web Audio, synthesised) ---------- */
  let AC = null;
  let master = null;

  function audio() {
    if (!AC) {
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        AC = new Ctor();
        master = AC.createGain();
        master.gain.value = 0.4;
        master.connect(AC.destination);
      } catch (err) {
        AC = null;
      }
    }
    if (AC && AC.state === "suspended") AC.resume();
    return AC;
  }

  function tone(freq, dur, type, gain, when, glideTo) {
    const ac = audio();
    if (!ac || state.muted) return;
    const t = ac.currentTime + (when || 0);
    const osc = ac.createOscillator();
    const vol = ac.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    vol.gain.setValueAtTime(0.0001, t);
    vol.gain.exponentialRampToValueAtTime(gain || 0.15, t + 0.012);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(vol);
    vol.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  const SFX = {
    pick() {
      tone(520, 0.06, "triangle", 0.09);
    },
    size() {
      tone(300, 0.04, "sine", 0.05);
    },
    success() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone(f, 0.22, "sine", 0.13, i * 0.09),
      );
      tone(130.81, 0.5, "triangle", 0.09);
    },
    fail() {
      tone(175, 0.32, "sawtooth", 0.11, 0, 68);
    },
    start() {
      tone(392, 0.12, "triangle", 0.09);
      tone(587.33, 0.16, "triangle", 0.09, 0.1);
    },
    win() {
      [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone(f, 0.3, "triangle", 0.12, i * 0.12),
      );
    },
    over() {
      [330, 262, 196].forEach((f, i) => tone(f, 0.4, "sine", 0.11, i * 0.18));
    },
  };

  /* ---------- state ---------- */
  const state = {
    phase: "intro", // intro | play | complete | over | win
    sceneIdx: 0,
    score: 0,
    patience: 100,
    match: 0,
    muted: false,
  };

  let scene = null; // compiled current scene
  let puppets = []; // runtime puppets { def, x, y, s }
  let sel = -1;
  let dirty = true;
  let lastEval = 0;
  let flickerT = 0;
  let drag = null; // { mode, idx, offX, offY, startDist, startS }
  let lastSizeBlip = 0;

  /* ---------- shape compilation ---------- */

  function compileShape(def) {
    const cx = SX + def.x * SW;
    const cy = SY + def.y * SH;
    if (def.t === "circle") {
      return { kind: "circle", cx, cy, r: def.r * SH };
    }
    const w = def.w * SH;
    const h = def.h * SH;
    const rot = ((def.rot || 0) * Math.PI) / 180;
    const unit = UNIT[def.t] || UNIT.rect;
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    const verts = unit.map(([u, v]) => {
      const vx = u * w;
      const vy = v * h;
      return [vx * c - vy * sn, vx * sn + vy * c];
    });
    return { kind: "poly", cx, cy, w, h, rot, verts };
  }

  const UNIT = {
    rect: [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ],
    tri: [
      [0, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ],
    diamond: [
      [0, -0.5],
      [0.5, 0],
      [0, 0.5],
      [-0.5, 0],
    ],
  };

  function pointInPoly(x, y, verts) {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const xi = verts[i][0];
      const yi = verts[i][1];
      const xj = verts[j][0];
      const yj = verts[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function pointInDef(def, dx, dy, s) {
    if (def.kind === "circle") {
      const rr = def.r * s;
      return dx * dx + dy * dy <= rr * rr;
    }
    const c = Math.cos(-def.rot);
    const sn = Math.sin(-def.rot);
    const lx = (dx * c - dy * sn) / s;
    const ly = (dx * sn + dy * c) / s;
    return pointInPoly(lx, ly, def.verts);
  }

  function pointInShape(sh, X, Y, s) {
    return pointInDef(sh, X - sh.cx, Y - sh.cy, s);
  }

  function pointInPuppet(p, X, Y) {
    return pointInDef(p.def, X - p.x, Y - p.y, p.s);
  }

  function hitRadius(p) {
    const d = p.def;
    if (d.kind === "circle") return d.r * p.s;
    let m = 0;
    for (const v of d.verts) m = Math.max(m, Math.hypot(v[0], v[1]));
    return m * p.s;
  }

  /* ---------- mask rasterising / likeness ---------- */
  const GW = 196;
  const GH = 132;
  const targetMask = new Uint8Array(GW * GH);
  const playerMask = new Uint8Array(GW * GH);
  let targetArea = 1;

  function buildTargetMask() {
    targetArea = 0;
    for (let gy = 0; gy < GH; gy++) {
      const Y = SY + ((gy + 0.5) * SH) / GH;
      for (let gx = 0; gx < GW; gx++) {
        const X = SX + ((gx + 0.5) * SW) / GW;
        let on = 0;
        for (const sh of scene.target) {
          if (pointInShape(sh, X, Y, 1)) {
            on = 1;
            break;
          }
        }
        targetMask[gy * GW + gx] = on;
        targetArea += on;
      }
    }
    if (targetArea < 1) targetArea = 1;
  }

  function evalMatch() {
    playerMask.fill(0);
    let inter = 0;
    let playerCells = 0;
    for (let gy = 0; gy < GH; gy++) {
      const Y = SY + ((gy + 0.5) * SH) / GH;
      const row = gy * GW;
      for (let gx = 0; gx < GW; gx++) {
        const X = SX + ((gx + 0.5) * SW) / GW;
        for (const p of puppets) {
          if (pointInPuppet(p, X, Y)) {
            playerMask[row + gx] = 1;
            break;
          }
        }
      }
    }
    for (let i = 0; i < playerMask.length; i++) {
      if (playerMask[i]) {
        playerCells++;
        if (targetMask[i]) inter++;
      }
    }
    state.match = inter / (targetArea + (playerCells - inter));
    dirty = false;
    lastEval = performance.now();
  }

  /* ---------- scene lifecycle ---------- */

  function startScene(idx) {
    state.sceneIdx = idx;
    const data = SCENES[idx];
    scene = {
      name: data.name,
      target: data.target.map(compileShape),
    };
    puppets = data.target.map((def, i) => {
      const c = compileShape(def);
      const j = JITTER[i % JITTER.length];
      return {
        def: c,
        color: i % COLORS.length,
        x: clamp(c.cx + j[0] * SW, SX + 20, SX + SW - 20),
        y: clamp(c.cy + j[1] * SH, SY + 20, SY + SH - 20),
        s: 1,
      };
    });
    sel = 0;
    state.match = 0;
    state.phase = "play";
    dirty = true;
    hideCard();
    buildTargetMask();
    evalMatch();
    syncHUD();
    SFX.start();
  }

  function restartGame(showIntro) {
    state.score = 0;
    state.patience = 100;
    state.match = 0;
    sel = -1;
    if (showIntro) {
      state.phase = "intro";
      showIntroCard();
      syncHUD();
    } else {
      startScene(0);
    }
  }

  function starsFor(m) {
    if (m >= STAR3) return 3;
    if (m >= STAR2) return 2;
    return 1;
  }

  function present() {
    if (state.phase !== "play") return;
    evalMatch();
    if (state.match >= PASS) {
      const stars = starsFor(state.match);
      const pts = Math.round(state.match * 100) + stars * 20;
      state.score += pts;
      state.patience = Math.min(100, state.patience + SCENE_BONUS);
      if (state.sceneIdx + 1 >= SCENES.length) {
        // final fable - straight to the curtain call
        state.phase = "win";
        SFX.win();
        showWinCard();
      } else {
        state.phase = "complete";
        SFX.success();
        showCompleteCard(stars, pts);
      }
      syncHUD();
    } else {
      state.patience -= FAIL_PENALTY;

      SFX.fail();
      elMatchBar.classList.remove("flash");
      void elMatchBar.offsetWidth;
      elMatchBar.classList.add("flash");
      const frame = document.querySelector(".frame");
      frame.classList.remove("shake");
      void frame.offsetWidth;
      frame.classList.add("shake");
      if (state.patience <= 0) {
        state.patience = 0;
        gameOver();
      }
      syncHUD();
    }
  }

  function continueAction() {
    if (state.sceneIdx + 1 >= SCENES.length) {
      state.phase = "win";
      SFX.win();
      showWinCard();
      syncHUD();
    } else {
      startScene(state.sceneIdx + 1);
    }
  }

  function gameOver() {
    state.phase = "over";
    SFX.over();
    showOverCard();
    syncHUD();
  }

  /* ---------- hud ---------- */

  function syncHUD() {
    elPatience.style.width = Math.max(0, state.patience) + "%";
    const pct = Math.round(state.match * 100);
    elMatchFill.style.width = pct + "%";
    elMatchNum.textContent = pct + "%";
    elMatchBar.classList.toggle("ready", state.match >= PASS);
    $("btn-present").classList.toggle(
      "pulse",
      state.match >= PASS && state.phase === "play",
    );
    elSceneName.textContent =
      state.phase === "play"
        ? "Scene " + (state.sceneIdx + 1) + " · " + scene.name
        : "—";
    elSceneCount.textContent = state.sceneIdx + 1 + " / " + SCENES.length;
    elScore.textContent = state.score + " pts";
  }

  /* ---------- overlays ---------- */

  function showCard(html) {
    card.innerHTML = html;
    overlay.classList.add("open");
  }

  function hideCard() {
    overlay.classList.remove("open");
  }

  function showIntroCard() {
    showCard(
      "<h2>Shadow Stage</h2>" +
        '<p class="sub">Closer to the flame, bolder the shadow.</p>' +
        "<ul>" +
        "<li>Seven paper fables need their silhouettes cast on the screen.</li>" +
        "<li><b>Drag</b> a shadow to move it. <b>Drag the gold knob</b>, scroll, or press <b>&minus;/&#43;</b> to resize it.</li>" +
        "<li>The dashed outline shows the figure the audience expects. Reach <b>75%</b> likeness, then <b>Raise the curtain</b>.</li>" +
        "<li>Audience patience drains while you work. A botched showing costs extra.</li>" +
        "</ul>" +
        '<button id="btn-begin" class="btn primary" type="button">Light the lamp &#9656;</button>',
    );
    $("btn-begin").addEventListener("click", () => startScene(0));
  }

  function showCompleteCard(stars, pts) {
    const row =
      "&#9733;".repeat(stars) +
      '<span class="off">' +
      "&#9733;".repeat(3 - stars) +
      "</span>";
    showCard(
      "<h2>Scene clear!</h2>" +
        '<div class="stars">' +
        row +
        "</div>" +
        '<p class="stat-line">Likeness <b>' +
        Math.round(state.match * 100) +
        "%</b> &middot; +" +
        pts +
        " pts &middot; audience restored +" +
        SCENE_BONUS +
        "</p>" +
        '<button id="btn-continue" class="btn primary" type="button">Next fable &#9656;</button>',
    );
    $("btn-continue").addEventListener("click", continueAction);
  }

  function grade(score) {
    if (score >= 800) return "Legendary troupe";
    if (score >= 640) return "Headliners";
    if (score >= 460) return "Touring players";
    return "Apprentices of the lamp";
  }

  function showWinCard() {
    showCard(
      "<h2>Curtain call!</h2>" +
        '<p class="sub">All seven fables told. The lantern gutters, happily.</p>' +
        '<p class="stat-line">Final score <b>' +
        state.score +
        " pts</b></p>" +
        '<p class="stat-line">The papers will call you <b>' +
        grade(state.score) +
        "</b></p>" +
        '<button id="btn-encore" class="btn primary" type="button">Encore &mdash; play again</button>',
    );
    $("btn-encore").addEventListener("click", () => restartGame(false));
  }

  function showOverCard() {
    showCard(
      "<h2>The house goes dark</h2>" +
        '<p class="sub">The audience drifted home before the last fable.</p>' +
        '<p class="stat-line">Fables told <b>' +
        state.sceneIdx +
        " / " +
        SCENES.length +
        "</b> &middot; score <b>" +
        state.score +
        " pts</b></p>" +
        '<button id="btn-retry" class="btn primary" type="button">Try again</button>',
    );
    $("btn-retry").addEventListener("click", () => restartGame(false));
  }

  /* ---------- input ---------- */

  function viewTransform() {
    const r = canvas.getBoundingClientRect();
    const sc = Math.min(r.width / LW, r.height / LH);
    return {
      sc,
      ox: (r.width - LW * sc) / 2,
      oy: (r.height - LH * sc) / 2,
      rect: r,
    };
  }

  function toLogical(e) {
    const t = viewTransform();
    return {
      x: (e.clientX - t.rect.left - t.ox) / t.sc,
      y: (e.clientY - t.rect.top - t.oy) / t.sc,
    };
  }

  function knobPos(p) {
    const r = hitRadius(p) + 12;
    return { x: p.x + r * Math.SQRT1_2, y: p.y + r * Math.SQRT1_2 };
  }

  function clampPos(p) {
    p.x = clamp(p.x, SX + 8, SX + SW - 8);
    p.y = clamp(p.y, SY + 8, SY + SH - 8);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  canvas.addEventListener("pointerdown", (e) => {
    audio();
    if (state.phase !== "play") return;
    const pos = toLogical(e);
    if (sel >= 0) {
      const k = knobPos(puppets[sel]);
      if (Math.hypot(pos.x - k.x, pos.y - k.y) <= 20) {
        drag = {
          mode: "size",
          idx: sel,
          startDist: Math.max(
            6,
            Math.hypot(pos.x - puppets[sel].x, pos.y - puppets[sel].y),
          ),
          startS: puppets[sel].s,
        };
        canvas.setPointerCapture(e.pointerId);
        canvas.classList.add("dragging");
        return;
      }
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < puppets.length; i++) {
      const d = Math.hypot(pos.x - puppets[i].x, pos.y - puppets[i].y);
      const reach = Math.max(26, hitRadius(puppets[i]) * 0.95 + 10);
      if (d <= reach && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    if (best >= 0) {
      if (best !== sel) {
        sel = best;
        SFX.pick();
      }
      drag = {
        mode: "move",
        idx: best,
        offX: pos.x - puppets[best].x,
        offY: pos.y - puppets[best].y,
      };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("dragging");
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!drag || state.phase !== "play") return;
    const pos = toLogical(e);
    const p = puppets[drag.idx];
    if (drag.mode === "move") {
      p.x = pos.x - drag.offX;
      p.y = pos.y - drag.offY;
      clampPos(p);
      dirty = true;
    } else {
      const d = Math.max(6, Math.hypot(pos.x - p.x, pos.y - p.y));
      p.s = clamp((drag.startS * d) / drag.startDist, MIN_S, MAX_S);
      dirty = true;
      const now = performance.now();
      if (now - lastSizeBlip > 90) {
        SFX.size();
        lastSizeBlip = now;
      }
    }
  });

  function endDrag(e) {
    if (!drag) return;
    drag = null;
    canvas.classList.remove("dragging");
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* pointer already released */
    }
    if (state.phase === "play") {
      evalMatch();
      syncHUD();
    }
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener(
    "wheel",
    (e) => {
      if (state.phase !== "play") return;
      e.preventDefault();
      if (sel < 0) return;
      const p = puppets[sel];
      p.s = clamp(p.s * (e.deltaY < 0 ? 1.07 : 1 / 1.07), MIN_S, MAX_S);
      dirty = true;
    },
    { passive: false },
  );

  function cycle(delta) {
    if (!puppets.length) return;
    sel = (sel + delta + puppets.length) % puppets.length;
    SFX.pick();
  }

  function resizeSel(factor) {
    if (state.phase !== "play") return;
    if (sel < 0 && puppets.length) sel = 0;
    if (sel < 0) return;
    const p = puppets[sel];
    p.s = clamp(p.s * factor, MIN_S, MAX_S);
    dirty = true;
  }

  function nudge(dx, dy) {
    if (state.phase !== "play" || sel < 0) return;
    const p = puppets[sel];
    p.x += dx;
    p.y += dy;
    clampPos(p);
    dirty = true;
  }

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key;
    if (key === "m" || key === "M") {
      toggleSound();
      return;
    }
    const overlayOpen = overlay.classList.contains("open");
    if (overlayOpen) {
      if (key === "Enter") {
        const b = card.querySelector("button");
        if (b) b.click();
      }
      return;
    }
    if (key === "Enter") {
      present();
    } else if (key === "r" || key === "R") {
      restartGame(false);
    } else if (
      key === "Tab" ||
      key === "q" ||
      key === "Q" ||
      key === "e" ||
      key === "E"
    ) {
      e.preventDefault();
      cycle(
        key === "Tab"
          ? e.shiftKey
            ? -1
            : 1
          : key === "q" || key === "Q"
            ? -1
            : 1,
      );
    } else if (key === "-" || key === "_") {
      resizeSel(1 / 1.08);
    } else if (key === "+" || key === "=") {
      resizeSel(1.08);
    } else if (key.startsWith("Arrow")) {
      e.preventDefault();
      const step = e.shiftKey ? 20 : 7;
      if (key === "ArrowLeft") nudge(-step, 0);
      else if (key === "ArrowRight") nudge(step, 0);
      else if (key === "ArrowUp") nudge(0, -step);
      else nudge(0, step);
    }
  });

  $("btn-present").addEventListener("click", present);
  $("btn-restart").addEventListener("click", () => restartGame(false));
  $("btn-smaller").addEventListener("click", () => resizeSel(1 / 1.1));
  $("btn-bigger").addEventListener("click", () => resizeSel(1.1));

  const sndBtn = $("btn-sound");
  function toggleSound() {
    state.muted = !state.muted;
    sndBtn.classList.toggle("off", state.muted);
    sndBtn.setAttribute("aria-pressed", String(!state.muted));
    if (!state.muted) SFX.pick();
  }
  sndBtn.addEventListener("click", toggleSound);

  /* ---------- drawing ---------- */

  function sizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (
      canvas.width !== Math.round(w * dpr) ||
      canvas.height !== Math.round(h * dpr)
    ) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
  }

  function pathShape(c, sh, cx, cy, s, grow) {
    c.beginPath();
    if (sh.kind === "circle") {
      c.arc(cx, cy, Math.max(0.5, sh.r * s * (grow || 1)), 0, Math.PI * 2);
      return;
    }
    const g = grow || 1;
    for (let i = 0; i < sh.verts.length; i++) {
      const vx = cx + sh.verts[i][0] * s * g;
      const vy = cy + sh.verts[i][1] * s * g;
      if (i === 0) c.moveTo(vx, vy);
      else c.lineTo(vx, vy);
    }
    c.closePath();
  }

  function drawWall(now) {
    const g = ctx.createLinearGradient(0, 0, 0, LH);
    g.addColorStop(0, "#241722");
    g.addColorStop(0.55, "#1a1017");
    g.addColorStop(1, "#120b10");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LW, LH);

    // faint wallpaper pattern
    ctx.strokeStyle = "rgba(232,179,75,0.045)";
    ctx.lineWidth = 1;
    for (let x = SX - 40; x < LW; x += 56) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x - 24, LH);
      ctx.stroke();
    }

    const flick =
      0.5 + 0.5 * Math.sin(now * 0.0013 + Math.sin(now * 0.0047) * 2);
    const glow = ctx.createRadialGradient(
      LAMP.x,
      LAMP.y,
      20,
      LAMP.x,
      LAMP.y,
      430,
    );
    glow.addColorStop(
      0,
      "rgba(240,190,90," + (0.16 + flick * 0.05).toFixed(3) + ")",
    );
    glow.addColorStop(1, "rgba(240,190,90,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, LW, LH);
  }

  function drawScreenArea() {
    // wooden proscenium
    ctx.fillStyle = "#3c2517";
    ctx.fillRect(SX - 16, SY - 16, SW + 32, SH + 32);
    ctx.fillStyle = "#55361f";

    ctx.fillRect(SX - 10, SY - 10, SW + 20, SH + 20);

    // parchment screen
    const g = ctx.createRadialGradient(
      SX + SW / 2,
      SY + SH * 0.45,
      30,
      SX + SW / 2,
      SY + SH * 0.5,
      SW * 0.62,
    );
    g.addColorStop(0, "#f4e3b2");
    g.addColorStop(0.7, "#e3c98d");
    g.addColorStop(1, "#caa268");
    ctx.fillStyle = g;
    ctx.fillRect(SX, SY, SW, SH);

    // warm vignette on the cloth
    const v = ctx.createRadialGradient(
      SX + SW / 2,
      SY + SH / 2,
      SH * 0.3,
      SX + SW / 2,
      SY + SH / 2,
      SW * 0.58,
    );
    v.addColorStop(0, "rgba(90,50,20,0)");
    v.addColorStop(1, "rgba(70,35,15,0.4)");
    ctx.fillStyle = v;
    ctx.fillRect(SX, SY, SW, SH);

    // target guide outlines
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "rgba(110,74,40,0.55)";
    for (const sh of scene.target) {
      pathShape(ctx, sh, sh.cx, sh.cy, 1);
      ctx.stroke();
    }
    ctx.restore();

    // inner shadow of the frame
    ctx.strokeStyle = "rgba(30,15,8,0.55)";
    ctx.lineWidth = 6;
    ctx.strokeRect(SX + 3, SY + 3, SW - 6, SH - 6);
  }

  function drawShadows(now) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(SX, SY, SW, SH);
    ctx.clip();

    if (sel >= 0 && state.phase === "play") {
      const p = puppets[sel];
      ctx.save();
      ctx.setLineDash([3, 7]);
      ctx.strokeStyle = "rgba(232,179,75,0.16)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(LAMP.x, LAMP.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    }

    const flick =
      0.88 +
      0.12 * (0.5 + 0.5 * Math.sin(now * 0.0021 + Math.sin(now * 0.006) * 3));
    for (let i = 0; i < puppets.length; i++) {
      const p = puppets[i];
      // soft halo pass
      ctx.globalAlpha = 0.16 * flick;
      ctx.fillStyle = "#1a1026";
      pathShape(ctx, p.def, p.x, p.y, p.s, 1.06);
      ctx.fill();
      // body
      ctx.globalAlpha = 0.92 * flick;
      ctx.fillStyle = SHADOW_C[p.color];
      pathShape(ctx, p.def, p.x, p.y, p.s);
      ctx.fill();
      if (i === sel && state.phase === "play") {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(232,179,75,0.85)";
        ctx.lineWidth = 1.4;
        pathShape(ctx, p.def, p.x, p.y, p.s);
        ctx.stroke();
        // number badge
        ctx.beginPath();
        ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(244,227,178,0.92)";
        ctx.fill();
        ctx.fillStyle = "#2b1a10";
        ctx.font = "bold 12px Verdana, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), p.x, p.y + 0.5);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawSelection() {
    if (sel < 0 || state.phase !== "play") return;
    const p = puppets[sel];
    const r = hitRadius(p) + 12;
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = "rgba(232,179,75,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const k = knobPos(p);
    ctx.beginPath();
    ctx.arc(k.x, k.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#e8b34b";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#3a2410";
    ctx.stroke();
    // grip marks
    ctx.beginPath();
    ctx.moveTo(k.x - 4, k.y);
    ctx.lineTo(k.x + 4, k.y);
    ctx.moveTo(k.x, k.y - 4);
    ctx.lineTo(k.x, k.y + 4);
    ctx.strokeStyle = "rgba(58,36,16,0.8)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  function drawBench() {
    const g = ctx.createLinearGradient(0, BENCH_Y, 0, LH);
    g.addColorStop(0, "#4a2e1d");
    g.addColorStop(0.25, "#3a2315");
    g.addColorStop(1, "#241409");
    ctx.fillStyle = g;
    ctx.fillRect(0, BENCH_Y, LW, LH - BENCH_Y);
    ctx.fillStyle = "rgba(232,179,75,0.18)";
    ctx.fillRect(0, BENCH_Y, LW, 2);

    const n = puppets.length;
    for (let i = 0; i < n; i++) {
      const p = puppets[i];
      const slotX = (LW * (i + 1)) / (n + 1);
      const isSel = i === sel;
      let maxR = 0;
      if (p.def.kind === "circle") maxR = p.def.r;
      else
        for (const v of p.def.verts)
          maxR = Math.max(maxR, Math.hypot(v[0], v[1]));
      const k = (isSel ? 34 : 30) / Math.max(maxR, 8);

      ctx.save();
      ctx.translate(slotX, BENCH_Y + 52 + (isSel ? -8 : 0));
      if (isSel) {
        ctx.shadowColor = "rgba(232,179,75,0.9)";
        ctx.shadowBlur = 14;
      }
      pathShape(ctx, p.def, 0, 0, k);
      ctx.fillStyle = COLORS[p.color];
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = isSel ? "#e8b34b" : "rgba(243,231,211,0.55)";
      ctx.font = "11px Verdana, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(i + 1), slotX, BENCH_Y + 84);
    }
  }

  function drawLamp(now) {
    const fl = Math.sin(now * 0.011) * 0.5 + Math.sin(now * 0.027) * 0.3;
    // flame glow
    const fg = ctx.createRadialGradient(
      LAMP.x,
      LAMP.y - 26,
      4,
      LAMP.x,
      LAMP.y - 26,
      90 + fl * 8,
    );
    fg.addColorStop(0, "rgba(255,214,120,0.85)");
    fg.addColorStop(0.4, "rgba(240,150,50,0.35)");
    fg.addColorStop(1, "rgba(240,150,50,0)");
    ctx.fillStyle = fg;
    ctx.fillRect(LAMP.x - 130, LAMP.y - 156, 260, 200);
    // flame body
    ctx.beginPath();
    ctx.moveTo(LAMP.x, LAMP.y - 52 + fl * 2);
    ctx.quadraticCurveTo(
      LAMP.x + 13,
      LAMP.y - 30 + fl * 2,
      LAMP.x,
      LAMP.y - 12,
    );
    ctx.quadraticCurveTo(
      LAMP.x - 13,
      LAMP.y - 30 + fl * 2,
      LAMP.x,
      LAMP.y - 52 + fl * 2,
    );
    ctx.fillStyle = "#ffd873";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(LAMP.x, LAMP.y - 40 + fl * 1.4);
    ctx.quadraticCurveTo(
      LAMP.x + 6,
      LAMP.y - 26 + fl * 1.4,
      LAMP.x,
      LAMP.y - 14,
    );
    ctx.quadraticCurveTo(
      LAMP.x - 6,
      LAMP.y - 26 + fl * 1.4,
      LAMP.x,
      LAMP.y - 40 + fl * 1.4,
    );
    ctx.fillStyle = "#fff3cf";
    ctx.fill();
    // burner + base
    ctx.fillStyle = "#6b4a26";
    ctx.fillRect(LAMP.x - 16, LAMP.y - 14, 32, 8);
    ctx.beginPath();
    ctx.moveTo(LAMP.x - 30, LAMP.y + 26);
    ctx.quadraticCurveTo(LAMP.x, LAMP.y - 8, LAMP.x + 30, LAMP.y + 26);
    ctx.closePath();
    ctx.fillStyle = "#7c5528";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,220,140,0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function draw(now) {
    sizeCanvas();
    const dpr = canvas.width / canvas.clientWidth || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const sc = Math.min(cw / LW, ch / LH);
    const ox = (cw - LW * sc) / 2;
    const oy = (ch - LH * sc) / 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0d090c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(sc * dpr, 0, 0, sc * dpr, ox * dpr, oy * dpr);

    drawWall(now);
    if (scene) {
      drawScreenArea();
      drawShadows(now);
      drawSelection();
    }
    drawBench();
    drawLamp(now);

    // letterbox frame edge
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = "rgba(232,179,75,0.08)";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      ox * dpr + 1,
      oy * dpr + 1,
      LW * sc * dpr - 2,
      LH * sc * dpr - 2,
    );
  }

  /* ---------- main loop ---------- */

  let lastT = performance.now();

  function frame(now) {
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    flickerT += dt;

    if (state.phase === "play") {
      state.patience -= DRAIN * dt;
      if (state.patience <= 0) {
        state.patience = 0;
        gameOver();
      } else {
        elPatience.style.width = state.patience + "%";
      }
      if (dirty && now - lastEval > 70) {
        evalMatch();
        syncHUD();
      }
    }
    draw(now);
    requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", () => {
    lastT = performance.now();
  });

  window.addEventListener("resize", sizeCanvas);

  /* ---------- debug hook (only with #debug hash) ---------- */
  if (/\bdebug\b/.test(window.location.hash)) {
    window.__stage = {
      state() {
        return {
          phase: state.phase,
          sceneIdx: state.sceneIdx,
          score: state.score,
          patience: state.patience,
          match: state.match,
          puppets: puppets.map((p) => ({ x: p.x, y: p.y, s: p.s })),
        };
      },
      solve() {
        scene.target.forEach((t, i) => {
          puppets[i].x = t.cx;
          puppets[i].y = t.cy;
          puppets[i].s = 1;
        });
        evalMatch();
        syncHUD();
      },
      present,
      next: continueAction,
      begin() {
        startScene(0);
      },
    };
  }

  /* ---------- boot ---------- */
  restartGame(true);
  requestAnimationFrame(frame);
})();
