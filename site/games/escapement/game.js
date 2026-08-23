/* Escapement — rebuild the clocktower gear trains before midnight.
   Everything behavioural lives in this file, wrapped in one IIFE. */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   * constants                                                           *
   * ------------------------------------------------------------------ */
  const W = 960,
    H = 600;
  const RAD = { S: 24, M: 36, L: 52 };
  const DRIVE_R = 52,
    CROWN_R = 44,
    DRIVE_SPEED = 0.75;
  const TOL = 8,
    SNAP = 40,
    HOLD = 0.9,
    FAIL_AFTER = 2.6;
  const PLATE = { x: 24, y: 64, w: W - 48, h: 398 };
  const TRAY = { x: 24, y: 474, w: W - 48, h: 102 };

  const PAL = {
    S: { hi: "#f2d78d", lo: "#a97e22", rim: "#5f470f" },
    M: { hi: "#dfb761", lo: "#8a6420", rim: "#4d370b" },
    L: { hi: "#c79d4c", lo: "#6f5218", rim: "#3c2c06" },
    drive: { hi: "#a7adbb", lo: "#484d59", rim: "#22252d" },
    crown: { hi: "#eaf0f8", lo: "#93a0b2", rim: "#4c5766" },
    rust: { hi: "#7a4e2c", lo: "#4a2c15", rim: "#20120a" },
  };

  /* ------------------------------------------------------------------ *
   * levels — peg chains are generated so meshes are exact               *
   * ------------------------------------------------------------------ */
  // steps: {r, a(deg)} relative polar hops; a crown hop carries dir (+1 CW).
  function chainPts(start, steps) {
    const pts = [{ x: start.x, y: start.y, r: start.r }];
    let prevR = start.r;
    for (const s of steps) {
      const last = pts[pts.length - 1];
      const d = prevR + s.r;
      const a = (s.a * Math.PI) / 180;
      pts.push({
        x: last.x + Math.cos(a) * d,
        y: last.y + Math.sin(a) * d,
        r: s.r,
      });
      prevR = s.r;
    }
    return pts;
  }

  const LEVELS = [
    {
      name: "The Hour Train",
      tip: "Every mesh reverses the turn — count the flips on the road to the crown.",
      start: { x: 250, y: 250, r: DRIVE_R },
      steps: [
        { r: 36, a: -16 },
        { r: 36, a: 14 },
        { r: 36, a: -12 },
        { r: 36, a: 12 },
        { r: CROWN_R, a: -8, crown: -1 },
      ],
      tray: { S: 1, M: 5, L: 1 },
      par: 4,
      rust: [],
      decoys: [
        [700, 380],
        [180, 400],
        [520, 120],
      ],
    },
    {
      name: "The Weight Floor",
      tip: "Rusted gears are dead: they hold their peg and never turn. Route around them.",
      start: { x: 300, y: 210, r: DRIVE_R },
      steps: [
        { r: 24, a: -20 },
        { r: 36, a: 22 },
        { r: 36, a: -18 },
        { r: 24, a: 20 },
        { r: 36, a: -14 },
        { r: CROWN_R, a: 10, crown: 1 },
      ],
      tray: { S: 3, M: 4, L: 1 },
      par: 5,
      rust: [
        [430, 340, "L"],
        [240, 330, "M"],
      ],
      decoys: [
        [180, 180],
        [820, 320],
        [560, 380],
      ],
    },
    {
      name: "The Long Case",
      tip: "Click a misplaced gear to lift it straight back off the board.",
      start: { x: 220, y: 200, r: DRIVE_R },
      steps: [
        { r: 36, a: -24 },
        { r: 24, a: 24 },
        { r: 36, a: -26 },
        { r: 36, a: 26 },
        { r: 24, a: -22 },
        { r: 36, a: 18 },
        { r: 36, a: -16 },
        { r: CROWN_R, a: 8, crown: 1 },
      ],
      tray: { S: 2, M: 5, L: 1 },
      par: 7,
      rust: [
        [350, 300, "L"],
        [560, 320, "M"],
        [150, 330, "S"],
      ],
      decoys: [
        [430, 390],
        [760, 320],
        [140, 140],
      ],
    },
    {
      name: "Dead Escapement",
      tip: "More than one road up — a longer train flips direction one extra time.",
      start: { x: 210, y: 320, r: DRIVE_R },
      steps: [
        { r: 36, a: -35 },
        { r: 36, a: -25 },
        { r: 24, a: -15 },
        { r: 36, a: 5 },
        { r: 36, a: 20 },
        { r: 24, a: 28 },
        { r: CROWN_R, a: 14, crown: -1 },
      ],
      tray: { S: 3, M: 5, L: 1 },
      par: 5,
      rust: [
        [300, 150, "M"],
        [450, 420, "L"],
      ],
      decoys: [
        [150, 180],
        [700, 180],
        [820, 400],
      ],
    },
    {
      name: "The Twin Sisters",
      tip: "Two crowns, two demands — one shared train can serve them both.",
      start: { x: 260, y: 220, r: DRIVE_R },
      steps: [
        { r: 36, a: -18 },
        { r: 24, a: 16 },
        { r: 36, a: -14 },
        { r: CROWN_R, a: 10, crown: 1 },
        { r: 36, a: 24 },
        { r: 24, a: 30 },
        { r: CROWN_R, a: 40, crown: -1 },
      ],
      tray: { S: 3, M: 5, L: 1 },
      par: 5,
      rust: [
        [520, 330, "M"],
        [650, 120, "L"],
      ],
      decoys: [
        [180, 340],
        [850, 200],
      ],
    },
    {
      name: "Eleven Fifty-Nine",
      tip: "No gear to spare. Every placement must earn its keep.",
      start: { x: 200, y: 320, r: DRIVE_R },
      steps: [
        { r: 36, a: -28 },
        { r: 24, a: -18 },
        { r: 36, a: -10 },
        { r: 36, a: -4 },
        { r: 24, a: 6 },
        { r: 36, a: 14 },
        { r: 36, a: 22 },
        { r: 24, a: 28 },
        { r: CROWN_R, a: 18, crown: -1 },
      ],
      tray: { S: 3, M: 5, L: 1 },
      par: 8,
      rust: [
        [330, 440, "L"],
        [540, 150, "M"],
        [728, 225, "M"],
      ],
      decoys: [
        [120, 140],
        [430, 120],
        [860, 420],
      ],
    },
  ];

  /* ------------------------------------------------------------------ *
   * state                                                               *
   * ------------------------------------------------------------------ */
  let floorIdx = 0,
    phase = "intro"; // intro | play | clear | fail | win
  let pegs = [],
    crowns = [],
    drive = null;
  let placed = []; // per-peg gear or null
  let tray = { S: 0, M: 0, L: 0 };
  let hand = null; // {size} carried gear
  let hoverPeg = -1,
    selPeg = 0;
  let jam = false,
    wasJam = false;
  let holdT = 0,
    failT = 0;
  let bestStars = [],
    totalGears = 0;
  let userPaused = false,
    hiddenPaused = false;
  let tGlobal = 0,
    runToken = 0;
  let pointerPos = null;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * DPR;
  canvas.height = H * DPR;

  const el = {
    hudFloor: document.getElementById("hud-floor"),
    hint: document.getElementById("hint"),
    banner: document.getElementById("banner"),
    overlay: document.getElementById("overlay"),
    panel: document.getElementById("panel"),
    help: document.getElementById("btn-help"),
    sound: document.getElementById("btn-sound"),
    reset: document.getElementById("btn-reset"),
  };

  /* ------------------------------------------------------------------ *
   * audio (Web Audio, synthesised, lazily created on first gesture)     *
   * ------------------------------------------------------------------ */
  let AC = null,
    master = null,
    muted = false,
    noiseBuf = null;

  function audio() {
    if (!AC) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      AC = new Ctx();
      master = AC.createGain();
      master.gain.value = muted ? 0 : 0.4;
      master.connect(AC.destination);
      noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.3, AC.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (AC.state === "suspended") AC.resume();
    return AC;
  }

  function tone(freq, dur, type, vol, when) {
    if (!audio()) return;
    const t0 = AC.currentTime + (when || 0);
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol || 0.2, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function clack(freq, vol) {
    if (!audio()) return;
    const t0 = AC.currentTime;
    const src = AC.createBufferSource();
    src.buffer = noiseBuf;
    const bp = AC.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 1.6;
    const g = AC.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + 0.1);
  }

  const sfx = {
    pick() {
      tone(520, 0.06, "triangle", 0.12);
    },
    drop(sz) {
      clack(sz === "S" ? 1500 : sz === "M" ? 1050 : 720, 0.5);
      tone(180, 0.05, "sine", 0.1);
    },
    lift() {
      clack(900, 0.3);
      tone(300, 0.07, "triangle", 0.08);
    },
    bad() {
      tone(95, 0.14, "square", 0.16);
    },
    engage() {
      tone(660, 0.4, "sine", 0.14);
      tone(990, 0.5, "sine", 0.09, 0.05);
    },
    clear() {
      [523, 659, 784, 1046].forEach((f, i) =>
        tone(f, 0.32, "sine", 0.16, i * 0.11),
      );
    },
    thud() {
      tone(70, 0.3, "sine", 0.25);
      clack(240, 0.4);
    },
    jam() {
      tone(60, 0.35, "sawtooth", 0.2);
    },
    ui() {
      tone(1250, 0.04, "square", 0.05);
    },
  };

  /* ------------------------------------------------------------------ *
   * level loading                                                       *
   * ------------------------------------------------------------------ */
  function loadFloor(i) {
    runToken++;
    const lv = LEVELS[i];
    const pts = chainPts(lv.start, lv.steps);
    drive = {
      x: pts[0].x,
      y: pts[0].y,
      r: DRIVE_R,
      theta: 0,
      speed: DRIVE_SPEED,
    };
    pegs = [];
    crowns = [];
    for (let k = 1; k < pts.length; k++) {
      const st = lv.steps[k - 1];
      if (st.crown) {
        pegs.push({ x: pts[k].x, y: pts[k].y, kind: "crown" });
        crowns.push({
          x: pts[k].x,
          y: pts[k].y,
          r: CROWN_R,
          dir: st.crown,
          theta: 0,
          speed: 0,
          on: false,
        });
      } else {
        pegs.push({ x: pts[k].x, y: pts[k].y, kind: "open" });
      }
    }
    for (const [rx, ry, rsz] of lv.rust) {
      pegs.push({
        x: rx,
        y: ry,
        kind: "rust",
        r: RAD[rsz],
        seed: (rx * 31 + ry * 17) % 997,
      });
    }
    for (const [dx, dy] of lv.decoys) pegs.push({ x: dx, y: dy, kind: "open" });
    placed = pegs.map(() => null);
    tray = { S: lv.tray.S, M: lv.tray.M, L: lv.tray.L };
    hand = null;
    hoverPeg = -1;
    selPeg = 0;
    jam = wasJam = false;
    holdT = 0;
    failT = 0;
    phase = "play";
    el.hudFloor.textContent = "Floor " + (i + 1) + " · " + lv.name;
    setHint();
  }

  function boardCount() {
    let n = 0;
    for (const g of placed) if (g) n++;
    return n;
  }

  function trayEmpty() {
    return tray.S + tray.M + tray.L === 0 && !hand;
  }

  /* ------------------------------------------------------------------ *
   * physics — who turns, which way, how fast                            *
   * ------------------------------------------------------------------ */
  function meshed(a, b) {
    const dx = a.x - b.x,
      dy = a.y - b.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    return Math.abs(d - (a.r + b.r)) <= TOL;
  }

  function computeTrain() {
    const nodes = [{ kind: "drive", x: drive.x, y: drive.y, r: drive.r }];
    for (const g of placed) if (g) nodes.push(g);
    for (const c of crowns) nodes.push(c);
    const sign = new Map(),
      speed = new Map();
    sign.set(nodes[0], 1);
    speed.set(nodes[0], DRIVE_SPEED);
    let j = false;
    const queue = [nodes[0]];
    while (queue.length) {
      const u = queue.shift();
      for (const v of nodes) {
        if (v === u || sign.has(v)) continue;
        if (!meshed(u, v)) continue;
        sign.set(v, -sign.get(u));
        speed.set(v, (speed.get(u) * u.r) / v.r);
        queue.push(v);
      }
    }
    // parity conflict = mechanical jam (an odd loop of meshed gears)
    outer: for (const u of nodes) {
      for (const v of nodes) {
        if (v === u || !meshed(u, v)) continue;
        if (sign.has(u) && sign.has(v) && sign.get(u) === sign.get(v)) {
          j = true;
          break outer;
        }
      }
    }
    jam = j;
    for (const g of placed)
      if (g) {
        g.sign = sign.get(g) || 0;
        g.speed = j ? 0 : speed.get(g) || 0;
      }
    for (const c of crowns) {
      c.sign = sign.get(c) || 0;
      c.speed = j ? 0 : speed.get(c) || 0;
      c.on = !j && c.sign === c.dir;
    }
    if (jam && !wasJam) {
      sfx.jam();
      toast("The train is jammed — pull a gear off the board.", true);
    }
    wasJam = jam;
  }

  /* ------------------------------------------------------------------ *
   * interaction                                                         *
   * ------------------------------------------------------------------ */
  function toGame(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * W) / r.width,
      y: ((e.clientY - r.top) * H) / r.height,
    };
  }

  function pegAt(p, radius) {
    let best = -1,
      bd = 1e9;
    for (let i = 0; i < pegs.length; i++) {
      const dx = p.x - pegs[i].x,
        dy = p.y - pegs[i].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const lim = Math.max(radius, placed[i] ? placed[i].r : 14);
      if (d < lim && d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  function fitsOnPeg(size, i) {
    const peg = pegs[i];
    if (!peg || peg.kind !== "open" || placed[i]) return false;
    const cand = { x: peg.x, y: peg.y, r: RAD[size] };
    // a gear may kiss anything (that is a mesh) but must never overlap it
    if (overlap(cand, drive)) return false;
    for (const c of crowns) if (overlap(cand, c)) return false;
    for (let k = 0; k < pegs.length; k++) {
      if (k === i || !placed[k]) continue;
      if (overlap(cand, placed[k])) return false;
    }
    for (const peg2 of pegs) {
      if (peg2.kind !== "rust") continue;
      if (overlap(cand, peg2)) return false;
    }
    return true;
  }

  function overlap(a, b) {
    const dx = a.x - b.x,
      dy = a.y - b.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    return d < a.r + b.r - TOL;
  }

  function liftFromTray(sz) {
    if (phase !== "play" || hand || tray[sz] <= 0) {
      if (hand || tray[sz] <= 0) sfx.bad();
      return;
    }
    hand = { size: sz };
    tray[sz]--;
    sfx.pick();
    setHint();
  }

  function liftFromBoard(i) {
    if (phase !== "play" || !placed[i]) return;
    if (hand) {
      tray[hand.size]++;
      hand = null;
    } // swap politely
    const g = placed[i];
    hand = { size: g.size };
    placed[i] = null;
    sfx.lift();
    setHint();
  }

  function placeAt(i) {
    if (phase !== "play" || !hand) return;
    const peg = pegs[i];
    if (!peg || peg.kind !== "open" || placed[i]) {
      sfx.bad();
      return;
    }
    if (!fitsOnPeg(hand.size, i)) {
      sfx.bad();
      return;
    }
    const sz = hand.size;
    placed[i] = {
      size: sz,
      r: RAD[sz],
      x: peg.x,
      y: peg.y,
      theta: Math.random() * 6.28,
    };
    hand = null;
    sfx.drop(sz);
    failT = 0;
    setHint();
  }

  function cancelHand() {
    if (!hand) return;
    tray[hand.size]++;
    hand = null;
    sfx.ui();
    setHint();
  }

  function moveSel(dx, dy) {
    const cur = pegs[selPeg] || { x: W / 2, y: H / 2 };
    let best = -1,
      bs = -2;
    for (let i = 0; i < pegs.length; i++) {
      if (i === selPeg) continue;
      const vx = pegs[i].x - cur.x,
        vy = pegs[i].y - cur.y;
      const d = Math.hypot(vx, vy);
      if (d < 4) continue;
      const cos = (vx * dx + vy * dy) / d;
      if (cos <= 0.05) continue;
      const score = cos - d / 2400;
      if (score > bs) {
        bs = score;
        best = i;
      }
    }
    if (best >= 0) {
      selPeg = best;
      sfx.ui();
    }
  }

  function trayHit(p) {
    const sizes = ["S", "M", "L"];
    const cy = TRAY.y + TRAY.h / 2;
    for (let i = 0; i < 3; i++) {
      const cx = 108 + i * 118;
      if (Math.abs(p.x - cx) <= 46 && Math.abs(p.y - cy) <= 38) return sizes[i];
    }
    return null;
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    audio();
    pointerPos = toGame(e);
    if (phase !== "play" || effPaused()) return;
    const slot = trayHit(pointerPos);
    if (slot) {
      if (hand && hand.size === slot) cancelHand();
      else liftFromTray(slot);
      return;
    }
    const i = pegAt(pointerPos, SNAP);
    if (i < 0) return;
    selPeg = i;
    if (placed[i]) {
      liftFromBoard(i);
      return;
    }
    if (pegs[i].kind === "open") {
      if (hand) placeAt(i);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    pointerPos = toGame(e);
    hoverPeg = phase === "play" ? pegAt(pointerPos, SNAP) : -1;
    if (hoverPeg >= 0) selPeg = hoverPeg;
  });

  canvas.addEventListener("pointerleave", () => {
    pointerPos = null;
    hoverPeg = -1;
  });

  window.addEventListener("keydown", (e) => {
    audio();
    if (
      e.repeat &&
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
    )
      return;
    const k = e.key;
    if ([" ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(k))
      e.preventDefault();

    if (k === "m" || k === "M") {
      toggleMute();
      return;
    }
    if (k === "?" || k === "h" || k === "H") {
      toggleHelp();
      return;
    }
    if (k === "p" || k === "P") {
      if (phase === "play") {
        userPaused = !userPaused;
        toast(userPaused ? "Paused" : "Resumed");
      }
      return;
    }
    if (k === "r" || k === "R") {
      if (phase === "play" || phase === "fail") resetFloor();
      return;
    }
    if (k === "Escape") {
      if (!el.overlay.hidden) {
        if (phase === "fail") resetFloor();
        else if (phase === "play") closePanel();
      } else cancelHand();
      return;
    }
    if (phase !== "play" || effPaused()) {
      if ((k === "Enter" || k === " ") && !el.overlay.hidden) {
        const go = el.panel.querySelector("button.go");
        if (go) go.click();
      }
      return;
    }

    switch (k) {
      case "1":
        liftFromTray("S");
        break;
      case "2":
        liftFromTray("M");
        break;
      case "3":
        liftFromTray("L");
        break;
      case "ArrowLeft":
        moveSel(-1, 0);
        break;
      case "ArrowRight":
        moveSel(1, 0);
        break;
      case "ArrowUp":
        moveSel(0, -1);
        break;
      case "ArrowDown":
        moveSel(0, 1);
        break;
      case "Enter":
        if (placed[selPeg]) liftFromBoard(selPeg);
        else if (hand) placeAt(selPeg);
        break;
      case "x":
      case "X":
        if (placed[selPeg]) liftFromBoard(selPeg);
        break;
    }
  });

  /* ------------------------------------------------------------------ *
   * HUD / overlays                                                      *
   * ------------------------------------------------------------------ */
  function setHint() {
    const lv = LEVELS[floorIdx];
    if (phase !== "play") {
      el.hint.textContent = lv ? lv.tip : "";
      return;
    }
    if (jam)
      el.hint.textContent =
        "Two wheels are being asked to turn the same way — remove something.";
    else if (trayEmpty())
      el.hint.textContent =
        "The tray is empty and the crown hangs still — press R to wind the floor back.";
    else if (hand)
      el.hint.textContent =
        "Carrying a " +
        { S: "small", M: "medium", L: "large" }[hand.size] +
        " gear — click a free brass peg that kisses its neighbours.";
    else el.hint.textContent = lv.tip;
  }

  let toastTimer = 0;
  function toast(msg, bad, ms) {
    el.banner.textContent = msg;
    el.banner.classList.toggle("bad", !!bad);
    el.banner.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.banner.hidden = true;
    }, ms || 1700);
  }

  function showPanel(html) {
    el.panel.innerHTML = html;
    el.overlay.hidden = false;
  }
  function closePanel() {
    el.overlay.hidden = true;
  }

  function starString(n) {
    return "★★★".slice(0, n) + "☆☆☆".slice(0, 3 - n);
  }

  function starsFor(count, par) {
    return count <= par ? 3 : count <= par + 2 ? 2 : 1;
  }

  function panelIntro() {
    showPanel(
      "<h2>Escapement</h2>" +
        '<p class="kicker">Eleven thirty-seven, and the town clock stands still.</p>' +
        "<p>The retiring keeper stripped six floors of gear trains bare. You have the tray, the pegs, and until midnight.</p>" +
        "<ul>" +
        "<li>Drag gears onto the brass pegs — a gear must just <em>kiss</em> its neighbours to mesh.</li>" +
        "<li>Every mesh reverses the turn; big and small teeth trade speed for reach.</li>" +
        "<li>Turn each crown wheel the way its arrow demands, and hold it there.</li>" +
        "</ul>" +
        "<p><kbd>1·2·3</kbd> pick up · <kbd>←↑↓→</kbd> aim · <kbd>enter</kbd> drop · <kbd>x</kbd> unmesh · <kbd>R</kbd> reset · <kbd>M</kbd> sound</p>" +
        '<button type="button" class="go">Begin the shift</button>',
    );
    el.panel.querySelector(".go").addEventListener("click", () => {
      audio();
      sfx.ui();
      startGame();
    });
  }

  function panelFail() {
    showPanel(
      "<h2>The Train Slips</h2>" +
        '<p class="kicker">The tray is empty and the crown hangs still.</p>' +
        "<p>Wind the floor back and try another road up.</p>" +
        '<button type="button" class="go">Reset the floor</button>',
    );
    el.panel.querySelector(".go").addEventListener("click", () => {
      sfx.ui();
      resetFloor();
    });
  }

  function panelWin() {
    let rows = "",
      golds = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      const st = bestStars[i] || 1;
      if (st === 3) golds++;
      rows +=
        "<tr><td>" +
        (i + 1) +
        " · " +
        LEVELS[i].name +
        "</td><td>" +
        starString(st) +
        "</td></tr>";
    }
    showPanel(
      "<h2>Midnight Holds</h2>" +
        '<p class="kicker">The first stroke rolls out across the rooftops.</p>' +
        '<p class="stars-line">' +
        "★".repeat(golds) +
        "&nbsp;<small>of " +
        LEVELS.length +
        " gold floors</small></p>" +
        '<table class="score-table">' +
        rows +
        "<tr><td><b>gears left on the boards</b></td><td>" +
        totalGears +
        "</td></tr></table>" +
        '<button type="button" class="go">Climb again</button>',
    );
    el.panel.querySelector(".go").addEventListener("click", () => {
      sfx.ui();
      startGame();
    });
  }

  function toggleHelp() {
    if (el.overlay.hidden) {
      const wasPlaying = phase === "play";
      showPanel(
        "<h2>How it Works</h2>" +
          "<ul>" +
          "<li>Gears snap onto brass pegs and mesh when they <em>kiss</em> — rim to rim, no overlap.</li>" +
          "<li>Each mesh reverses the turn. The drive wheel always turns clockwise.</li>" +
          "<li>Rust is dead: it blocks a peg and never turns.</li>" +
          "<li>Satisfy every crown\u2019s arrow and hold it to finish the floor.</li>" +
          "</ul>" +
          "<p><kbd>1·2·3</kbd> pick up · <kbd>←↑↓→</kbd> aim · <kbd>enter</kbd> drop / lift · <kbd>x</kbd> unmesh · <kbd>R</kbd> reset · <kbd>P</kbd> pause</p>" +
          '<button type="button" class="go">' +
          (wasPlaying ? "Back to the clocktower" : "Begin the shift") +
          "</button>",
      );
      el.panel.querySelector(".go").addEventListener("click", () => {
        sfx.ui();
        if (wasPlaying) {
          closePanel();
        } else startGame();
      });
    } else if (phase === "play") {
      closePanel();
    }
  }

  function toggleMute() {
    muted = !muted;
    el.sound.setAttribute("aria-pressed", String(!muted));
    if (master) master.gain.value = muted ? 0 : 0.4;
    if (!muted) sfx.ui();
  }

  el.sound.addEventListener("click", () => {
    audio();
    toggleMute();
  });
  el.help.addEventListener("click", () => {
    audio();
    toggleHelp();
  });
  el.reset.addEventListener("click", () => {
    if (phase === "play" || phase === "fail") {
      sfx.ui();
      resetFloor();
    }
  });

  /* ------------------------------------------------------------------ *
   * flow                                                                *
   * ------------------------------------------------------------------ */
  function startGame() {
    floorIdx = 0;
    bestStars = [];
    totalGears = 0;
    loadFloor(0);
    closePanel();
    toast("Floor 1 · " + LEVELS[0].name);
  }

  function resetFloor() {
    closePanel();
    loadFloor(floorIdx);
    toast("Floor wound back");
  }

  function clearFloor() {
    const count = boardCount();
    const st = starsFor(count, LEVELS[floorIdx].par);
    bestStars[floorIdx] = Math.max(bestStars[floorIdx] || 0, st);
    totalGears += count;
    sfx.clear();
    toast("Floor cleared · " + starString(st), false, 1400);
    phase = "clear";
    const token = runToken;
    setTimeout(() => {
      if (token !== runToken) return;
      floorIdx++;
      if (floorIdx >= LEVELS.length) {
        phase = "win";
        panelWin();
      } else {
        loadFloor(floorIdx);
        toast("Floor " + (floorIdx + 1) + " · " + LEVELS[floorIdx].name);
      }
    }, 1500);
  }

  function effPaused() {
    return userPaused || hiddenPaused;
  }

  document.addEventListener("visibilitychange", () => {
    hiddenPaused = document.hidden;
    if (!hiddenPaused) {
      tGlobal += 0;
    }
  });

  /* ------------------------------------------------------------------ *
   * update                                                              *
   * ------------------------------------------------------------------ */
  function update(dt) {
    if ((phase !== "play" && phase !== "clear") || effPaused()) return;
    computeTrain();
    drive.theta += DRIVE_SPEED * dt;
    for (const g of placed) if (g && g.speed) g.theta += g.speed * g.sign * dt;
    for (const c of crowns) if (c.speed) c.theta += c.speed * c.sign * dt;

    if (phase !== "play") return;

    const allOn = crowns.length > 0 && crowns.every((c) => c.on);
    if (allOn) {
      if (holdT === 0) sfx.engage();
      holdT += dt;
      if (holdT >= HOLD) {
        holdT = 0;
        clearFloor();
      }
    } else {
      holdT = 0;
    }

    if (!allOn && trayEmpty() && !hand) {
      failT += dt;
      if (failT >= FAIL_AFTER) {
        failT = 0;
        phase = "fail";
        sfx.thud();
        panelFail();
      }
    } else {
      failT = 0;
    }
    setHintLight();
  }

  let lastHintKey = "";
  function setHintLight() {
    const lv = LEVELS[floorIdx];
    let msg;
    if (jam) msg = "jam";
    else if (crowns.every((c) => c.on) && crowns.length) msg = "hold";
    else if (trayEmpty()) msg = "empty";
    else if (hand) msg = "hand";
    else msg = "tip";
    if (msg === lastHintKey) return;
    lastHintKey = msg;
    if (msg === "jam")
      el.hint.textContent =
        "The train is locked — two wheels want to turn the same way.";
    else if (msg === "hold") el.hint.textContent = "Hold them turning\u2026";
    else if (msg === "empty")
      el.hint.textContent =
        "Out of gears and the crown is still \u2014 press R to reset the floor.";
    else if (msg === "hand")
      el.hint.textContent =
        "Carrying a " +
        { S: "small", M: "medium", L: "large" }[hand.size] +
        " gear \u2014 click a free peg it can kiss.";
    else el.hint.textContent = lv.tip;
  }

  /* ------------------------------------------------------------------ *
   * drawing                                                             *
   * ------------------------------------------------------------------ */
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const sky = document.createElement("canvas");
  sky.width = W;
  sky.height = H;
  (function paintSky() {
    const s = sky.getContext("2d");
    const grad = s.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#191634");
    grad.addColorStop(0.55, "#12101f");
    grad.addColorStop(1, "#0a0812");
    s.fillStyle = grad;
    s.fillRect(0, 0, W, H);
    const rnd = mulberry(20260822);
    for (let i = 0; i < 130; i++) {
      const x = rnd() * W,
        y = rnd() * H * 0.85;
      const r = rnd() * 1.3 + 0.3;
      s.fillStyle = "rgba(240,235,255," + (rnd() * 0.5 + 0.12).toFixed(2) + ")";
      s.beginPath();
      s.arc(x, y, r, 0, 6.284);
      s.fill();
    }
    // moon
    s.save();
    s.shadowColor = "rgba(240,230,190,0.8)";
    s.shadowBlur = 40;
    s.fillStyle = "#efe6c8";
    s.beginPath();
    s.arc(856, 92, 34, 0, 6.284);
    s.fill();
    s.restore();
    s.fillStyle = "rgba(16,14,27,0.35)";
    s.beginPath();
    s.arc(844, 84, 30, 0, 6.284);
    s.fill();
    // rooftop silhouettes along the very bottom edge
    s.fillStyle = "#0b0913";
    s.beginPath();
    s.moveTo(0, H);
    s.lineTo(0, 540);
    let x = 0;
    while (x < W) {
      const w = 46 + rnd() * 90;
      const h = 30 + rnd() * 55;
      s.lineTo(x, 600 - h);
      s.lineTo(x + w, 600 - h);
      x += w;
    }
    s.lineTo(W, H);
    s.closePath();
    s.fill();
  })();

  function drawGear(x, y, r, theta, pal, opts) {
    opts = opts || {};
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(theta);
    // teeth
    const n = opts.teeth || Math.max(9, Math.round(r * 0.42));
    ctx.strokeStyle = pal.lo;
    ctx.lineWidth = Math.max(4, r * 0.16);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.moveTo(Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88);
      ctx.lineTo(Math.cos(a) * r * 1.06, Math.sin(a) * r * 1.06);
    }
    ctx.stroke();
    // body
    const grad = ctx.createRadialGradient(
      -r * 0.3,
      -r * 0.3,
      r * 0.15,
      0,
      0,
      r,
    );
    grad.addColorStop(0, pal.hi);
    grad.addColorStop(1, pal.lo);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, 6.284);
    ctx.fill();
    ctx.strokeStyle = pal.rim;
    ctx.lineWidth = 2;
    ctx.stroke();
    // cut-out + spokes
    if (r >= 30) {
      ctx.fillStyle = "rgba(20,16,30,0.92)";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, 0, 6.284);
      ctx.fill();
      ctx.strokeStyle = pal.lo;
      ctx.lineWidth = Math.max(3, r * 0.13);
      const spokes = r > 44 ? 5 : 4;
      for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
        ctx.lineTo(Math.cos(a) * r * 0.64, Math.sin(a) * r * 0.64);
        ctx.stroke();
      }
    }
    // hub
    ctx.fillStyle = opts.hub || "#e8c766";
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(4, r * 0.16), 0, 6.284);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawRust(peg) {
    const rnd = mulberry(peg.seed + 7);
    ctx.save();
    ctx.translate(peg.x, peg.y);
    ctx.fillStyle = PAL.rust.lo;
    ctx.beginPath();
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = peg.r * (0.82 + rnd() * 0.3);
      const px = Math.cos(a) * rr,
        py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PAL.rust.rim;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = "#2a180c";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const a = rnd() * 6.28,
        r1 = peg.r * 0.15,
        r2 = peg.r * (0.5 + rnd() * 0.35);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.fillStyle = "#1c1008";
    ctx.beginPath();
    ctx.arc(0, 0, peg.r * 0.14, 0, 6.284);
    ctx.fill();
    ctx.restore();
  }

  function drawCrownBadge(c) {
    const bx = c.x,
      by = c.y - c.r - 30;
    ctx.save();
    ctx.translate(bx, by);
    ctx.fillStyle = "rgba(13,10,22,0.92)";
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, 6.284);
    ctx.fill();
    const col = c.on ? "#9fce6a" : "#c9a227";
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.4;
    ctx.shadowColor = col;
    ctx.shadowBlur = c.on ? 10 : 0;
    const sweep = c.dir > 0 ? 4.4 : -4.4;
    ctx.beginPath();
    ctx.arc(0, 0, 8, -1.1, -1.1 + sweep, c.dir < 0);
    ctx.stroke();
    // arrowhead
    const ea = -1.1 + sweep;
    const ex = Math.cos(ea) * 8,
      ey = Math.sin(ea) * 8;
    const ta = ea + (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(ex + Math.cos(ta) * 5, ey + Math.sin(ta) * 5);
    ctx.lineTo(ex + Math.cos(ta + 2.5) * 5.5, ey + Math.sin(ta + 2.5) * 5.5);
    ctx.lineTo(ex + Math.cos(ta - 2.5) * 5.5, ey + Math.sin(ta - 2.5) * 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(sky, 0, 0);

    // playfield plate
    ctx.fillStyle = "rgba(24,19,38,0.88)";
    roundRect(ctx, PLATE.x, PLATE.y, PLATE.w, PLATE.h, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(201,162,39,0.28)";
    ctx.lineWidth = 2;
    roundRect(ctx, PLATE.x + 5, PLATE.y + 5, PLATE.w - 10, PLATE.h - 10, 9);
    ctx.stroke();

    // tray shelf
    const tg = ctx.createLinearGradient(0, TRAY.y, 0, TRAY.y + TRAY.h);
    tg.addColorStop(0, "#241a10");
    tg.addColorStop(1, "#171009");
    ctx.fillStyle = tg;
    roundRect(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(201,162,39,0.25)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, 12);
    ctx.stroke();

    // drive wheel + weight
    const sway = Math.sin(tGlobal * 0.8) * 0.04;
    ctx.save();
    ctx.translate(drive.x, drive.y);
    ctx.rotate(sway * 0.3);
    ctx.strokeStyle = "#3a2c1a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, drive.r + 58);
    ctx.stroke();
    ctx.fillStyle = "#22160c";
    roundRect(ctx, -17, drive.r + 58, 34, 44, 6);
    ctx.fill();
    ctx.strokeStyle = "#c9a227";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    drawGear(drive.x, drive.y, drive.r, drive.theta, PAL.drive, {
      hub: "#6b7280",
    });
    ctx.font = "600 10px Georgia, serif";
    ctx.fillStyle = "rgba(240,230,207,0.55)";
    ctx.textAlign = "center";
    ctx.fillText("DRIVE", drive.x, drive.y + drive.r + 20);

    // pegs
    for (let i = 0; i < pegs.length; i++) {
      const p = pegs[i];
      if (p.kind === "rust") {
        drawRust(p);
        continue;
      }
      if (p.kind === "crown") continue;
      const isTarget = hand && !placed[i];
      ctx.fillStyle = "#8a6a1e";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6.5, 0, 6.284);
      ctx.fill();
      ctx.fillStyle = "#1a1426";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, 6.284);
      ctx.fill();
      if (isTarget) {
        const pulse = 0.5 + 0.5 * Math.sin(tGlobal * 4 + i);
        ctx.strokeStyle =
          "rgba(232,199,102," + (0.25 + 0.35 * pulse).toFixed(3) + ")";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 11 + pulse * 2.5, 0, 6.284);
        ctx.stroke();
      }
    }

    // placed gears
    for (let i = 0; i < pegs.length; i++) {
      const g = placed[i];
      if (!g) continue;
      drawGear(g.x, g.y, g.r, g.theta, PAL[g.size]);
    }

    // crowns
    for (const c of crowns) {
      if (c.speed)
        drawGear(c.x, c.y, c.r, c.theta, PAL.crown, {
          teeth: 24,
          hub: "#d34f63",
        });
      else drawGear(c.x, c.y, c.r, 0, PAL.crown, { teeth: 24, hub: "#d34f63" });
      drawCrownBadge(c);
    }

    // selection / hover rings
    const focus = hoverPeg >= 0 ? hoverPeg : selPeg;
    if (focus >= 0 && phase === "play") {
      const p = pegs[focus];
      const rr =
        (placed[focus] ? placed[focus].r : hand ? RAD[hand.size] : 16) + 9;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(tGlobal * 0.9);
      ctx.strokeStyle = hand ? "#e8c766" : "rgba(232,199,102,0.7)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, 6.284);
      ctx.stroke();
      ctx.restore();
    }

    // hand ghost
    if (hand && phase === "play") {
      let gx = null,
        gy = null,
        ok = false;
      if (
        hoverPeg >= 0 &&
        !placed[hoverPeg] &&
        pegs[hoverPeg].kind === "open"
      ) {
        gx = pegs[hoverPeg].x;
        gy = pegs[hoverPeg].y;
        ok = fitsOnPeg(hand.size, hoverPeg);
      } else if (pointerPos) {
        gx = pointerPos.x;
        gy = pointerPos.y;
      }
      if (gx !== null) {
        ctx.globalAlpha = 0.55;
        drawGear(gx, gy, RAD[hand.size], tGlobal * 0.6, PAL[hand.size]);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ok ? "rgba(159,206,106,0.9)" : "rgba(217,108,79,0.9)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(gx, gy, RAD[hand.size] + 5, 0, 6.284);
        ctx.stroke();
      }
    }

    // jam veil
    if (jam) {
      ctx.fillStyle = "rgba(120,30,10,0.12)";
      roundRect(ctx, PLATE.x, PLATE.y, PLATE.w, PLATE.h, 12);
      ctx.fill();
      ctx.font = "700 22px Georgia, serif";
      ctx.fillStyle = "rgba(255,120,80,0.85)";
      ctx.textAlign = "center";
      ctx.fillText("JAMMED", W / 2, PLATE.y + 28);
    }

    // tray slots
    drawTray();

    // pause veil
    if (effPaused() && phase === "play") {
      ctx.fillStyle = "rgba(8,6,14,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.font = "700 30px Georgia, serif";
      ctx.fillStyle = "#e8c766";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", W / 2, H / 2 - 6);
      ctx.font = "italic 14px Georgia, serif";
      ctx.fillStyle = "rgba(240,230,207,0.8)";
      ctx.fillText("press P to resume", W / 2, H / 2 + 22);
    }
  }

  function drawTray() {
    const sizes = ["S", "M", "L"];
    const labels = { S: "SMALL", M: "MEDIUM", L: "LARGE" };
    const slotY = TRAY.y + TRAY.h / 2;
    for (let i = 0; i < 3; i++) {
      const sz = sizes[i];
      const sx = 108 + i * 118;
      const active = tray[sz] > 0;
      const hot = hand && hand.size === sz;
      ctx.save();
      ctx.globalAlpha = active ? 1 : 0.32;
      ctx.fillStyle = hot ? "rgba(201,162,39,0.18)" : "rgba(0,0,0,0.28)";
      roundRect(ctx, sx - 46, slotY - 38, 92, 76, 10);
      ctx.fill();
      ctx.strokeStyle = hot ? "#e8c766" : "rgba(201,162,39,0.4)";
      ctx.lineWidth = hot ? 2.5 : 1.2;
      roundRect(ctx, sx - 46, slotY - 38, 92, 76, 10);
      ctx.stroke();
      drawGear(sx, slotY - 8, 20, tGlobal * 0.5 + i, PAL[sz]);
      ctx.font = "600 10px Georgia, serif";
      ctx.fillStyle = "#e8c766";
      ctx.textAlign = "center";
      ctx.fillText(labels[sz], sx, slotY + 24);
      ctx.font = "700 13px Georgia, serif";
      ctx.fillStyle = "#f0e6cf";
      ctx.fillText("\u00d7" + tray[sz], sx, slotY - 32);
      ctx.restore();
    }
    // right-side status
    ctx.font = "600 12px Georgia, serif";
    ctx.fillStyle = "rgba(240,230,207,0.75)";
    ctx.textAlign = "right";
    const lv = LEVELS[floorIdx] || LEVELS[LEVELS.length - 1];

    ctx.fillText(
      "floor " +
        (floorIdx + 1) +
        " of " +
        LEVELS.length +
        "    ·    gears on board " +
        boardCount() +
        " · par " +
        lv.par,
      TRAY.x + TRAY.w - 18,
      slotY - 8,
    );
    ctx.font = "italic 11px Georgia, serif";
    ctx.fillStyle = "rgba(240,230,207,0.45)";
    ctx.fillText(
      "the drive wheel always turns clockwise",
      TRAY.x + TRAY.w - 18,
      slotY + 12,
    );
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* ------------------------------------------------------------------ *
   * main loop                                                           *
   * ------------------------------------------------------------------ */
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    if (!effPaused()) tGlobal += dt;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  /* boot */
  loadFloor(0);
  phase = "intro";
  panelIntro();
  requestAnimationFrame(frame);
})();
