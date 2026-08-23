/**
 * Foldsong — fold a patterned sheet edge over edge until the commissioned
 * motif lies face-up on the finished packet.
 * Vanilla canvas puzzle; no dependencies, no network.
 */
(() => {
  "use strict";

  /* ------------------------------------------------------------ motifs *
   * Every printed face: a tinted ground, an inked motif drawn from SVG  *
   * path data (also reused to build inline glyphs for the HUD), and a   *
   * plain kraft back that shows whenever the face is turned over.       */

  const KRAFT = "#d9c49c";
  const KRAFT_INK = "rgba(122, 98, 62, 0.4)";

  const MOTIFS = [
    {
      key: "crane",
      name: "Crane",
      tint: "#dbe7f3",
      ink: "#3d5f80",
      prims: [
        { d: "M12 2.4 L19.8 10.7 L12.5 9.1 Z" },
        { d: "M12 2.4 L4.2 10.7 L11.5 9.1 Z" },
        { d: "M11 8.4 L15.9 20.8 L11 17.4 L6.1 20.8 Z" },
      ],
      dots: [],
    },
    {
      key: "moon",
      name: "Moon",
      tint: "#e9e3f6",
      ink: "#5b4a8c",
      prims: [
        { d: "M15.6 3 A9.3 9.3 0 1 0 15.6 21 A11.6 11.6 0 0 1 15.6 3 Z" },
      ],
      dots: [],
    },
    {
      key: "fish",
      name: "Fish",
      tint: "#def0e9",
      ink: "#31705b",
      prims: [
        {
          d: "M2.6 12 C5.6 8.1 8.8 6.4 12.4 7.4 C14.9 8.1 16.9 9.9 18.4 12 C16.9 14.1 14.9 15.9 12.4 16.6 C8.8 17.6 5.6 15.9 2.6 12 Z M18.4 12 L21.8 8.4 L21.8 15.6 Z",
        },
      ],
      dots: [{ cx: 14.6, cy: 10.7, r: 1.05, knock: true }],
    },
    {
      key: "pine",
      name: "Pine",
      tint: "#e4efdb",
      ink: "#406c36",
      prims: [
        { d: "M12 2.4 L16.5 9 L13.7 9 L18.3 15.3 L5.7 15.3 L10.3 9 L7.5 9 Z" },
        { d: "M11.1 15.3 L12.9 15.3 L12.9 20.6 L11.1 20.6 Z" },
      ],
      dots: [],
    },
    {
      key: "blossom",
      name: "Blossom",
      tint: "#f7e5ea",
      ink: "#a44e66",
      prims: [],
      dots: [
        { cx: 12, cy: 7.4, r: 3.4 },
        { cx: 16.38, cy: 10.58, r: 3.4 },
        { cx: 14.7, cy: 15.72, r: 3.4 },
        { cx: 9.3, cy: 15.72, r: 3.4 },
        { cx: 7.62, cy: 10.58, r: 3.4 },
        { cx: 12, cy: 12, r: 1.9, knock: true },
      ],
    },
    {
      key: "star",
      name: "Star",
      tint: "#f7edd9",
      ink: "#8a6a2a",
      prims: [
        {
          d: "M12 2.8 L14.4 9.2 L21.2 9.5 L15.9 13.7 L17.8 20.2 L12 16.4 L6.2 20.2 L8.1 13.7 L2.8 9.5 L9.6 9.2 Z",
        },
      ],
      dots: [],
    },
  ];

  /* The afternoon's commissions: sheet size and what must show at the end. */

  const ORDERS = [
    { cols: 2, rows: 2, kind: "plain" },
    { cols: 2, rows: 2, kind: "plain+1" },
    { cols: 4, rows: 2, kind: "motif" },
    { cols: 4, rows: 2, kind: "motif+1" },
    { cols: 4, rows: 4, kind: "motif" },
    { cols: 4, rows: 4, kind: "motif+2" },
  ];

  const PRAISE = [
    "A tidy first packet. The client nods once.",
    "Hidden neat as a secret. Splendid work.",
    "The motif shows exactly as ordered.",
    "Two layers, one song. The shop takes notice.",
    "Crisp creases. The apprentice takes notes.",
    "A perfect fitting. The day's finest fold.",
  ];

  const FOLD_MS = 270;
  const SEAL_DELAY_S = 1.05;
  const REDUCED =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const STORE_BEST = "foldsong-best";
  const STORE_MUTE = "foldsong-mute";

  /* --------------------------------------------------------------- dom */

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const stageEl = document.getElementById("stage");
  const elOrder = document.getElementById("order");
  const elOrders = document.getElementById("orders");
  const elMoves = document.getElementById("moves");
  const elPar = document.getElementById("par");
  const elScore = document.getElementById("score");
  const elCommission = document.getElementById("commission");
  const elBanner = document.getElementById("banner");
  const overlay = document.getElementById("overlay");
  const ovTitle = document.getElementById("ov-title");
  const ovTag = document.getElementById("ov-tag");
  const ovBody = document.getElementById("ov-body");
  const ovBest = document.getElementById("ov-best");
  const btnStart = document.getElementById("btn-start");
  const btnUndo = document.getElementById("btn-undo");
  const btnPause = document.getElementById("btn-pause");
  const btnMute = document.getElementById("btn-mute");
  const btnRestart = document.getElementById("btn-restart");

  elOrders.textContent = String(ORDERS.length);

  /* ----------------------------------------------------------- helpers */

  const clone = (v) => JSON.parse(JSON.stringify(v));

  function loadNum(key) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? 0 : Number(v) || 0;
    } catch (err) {
      return 0;
    }
  }

  function saveNum(key, val) {
    try {
      window.localStorage.setItem(key, String(val));
    } catch (err) {
      /* private mode: scores simply won't persist */
    }
  }

  /* ------------------------------------------------------------ model *
   * A sheet is { cols, rows, cells }, cells[row * cols + col] being a   *
   * stack of faces bottom -> top. A face is { m: motif index,           *
   * front: showing its print? }; flipped faces show plain kraft.        *
   * Folding always takes an exact half over, so every dimension stays   *
   * even until it reaches 1.                                            */

  function newSheet(cols, rows) {
    const cells = [];
    for (let i = 0; i < cols * rows; i++) {
      cells.push([{ m: (Math.random() * MOTIFS.length) | 0, front: true }]);
    }
    return { cols, rows, cells };
  }

  function foldState(s, dir) {
    const cols = s.cols;
    const rows = s.rows;
    const horiz = dir === "left" || dir === "right";
    const half = horiz ? cols / 2 : rows / 2;
    const nc = horiz ? cols - half : cols;
    const nr = horiz ? rows : rows - half;
    const cells = [];
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        const sc = horiz ? c + (dir === "left" ? half : 0) : c;
        const sr = horiz ? r : r + (dir === "top" ? half : 0);
        let mc = c;
        let mr = r;
        if (dir === "left") {
          mc = half - 1 - c;
        } else if (dir === "right") {
          mc = cols - 1 - c;
        } else if (dir === "top") {
          mr = half - 1 - r;
        } else {
          mr = rows - 1 - r;
        }
        const base = s.cells[sr * cols + sc].slice();
        const mov = s.cells[mr * cols + mc]
          .map((f) => ({ m: f.m, front: !f.front }))
          .reverse();
        cells.push(base.concat(mov));
      }
    }
    return { cols: nc, rows: nr, cells };
  }

  function foldSeq(s, dirs) {
    let out = s;
    for (const d of dirs) out = foldState(out, d);
    return out;
  }

  function canFold(s, dir) {
    return dir === "left" || dir === "right" ? s.cols >= 2 : s.rows >= 2;
  }

  function packetOf(s) {
    return s.cells[0];
  }

  /* Turning the whole sheet over: a real folder picks the paper up. We   *
   * turn it about its vertical axis, so columns mirror while every       *
   * layer reverses and shows its other side. This is how a print can     *
   * finish face-up: start with it face-down.                             */

  function flipSheet(s) {
    const cells = new Array(s.cols * s.rows);
    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.cols; c++) {
        const src = s.cells[r * s.cols + (s.cols - 1 - c)];
        cells[r * s.cols + c] = src
          .map((f) => ({ m: f.m, front: !f.front }))
          .reverse();
      }
    }
    return { cols: s.cols, rows: s.rows, cells };
  }

  function canFlip(s) {
    return s.cells.length > 1;
  }

  function checkSeal(pkt, c) {
    const n = pkt.length;
    const top = pkt[n - 1];
    const s2 = pkt[n - 2];
    const s3 = pkt[n - 3];
    if (c.kind === "plain") return !top.front;
    if (c.kind === "plain+1") return !top.front && s2.front && s2.m === c.ms[0];
    if (c.kind === "motif") return top.front && top.m === c.ms[0];
    if (c.kind === "motif+1")
      return top.front && top.m === c.ms[0] && s2.front && s2.m === c.ms[1];
    if (c.kind === "motif+2")
      return (
        top.front &&
        top.m === c.ms[0] &&
        s2.front &&
        s2.m === c.ms[1] &&
        s3.front &&
        s3.m === c.ms[2]
      );
    return false;
  }

  /* ------------------------------------------------------- generation *
   * Pick a random legal halving sequence, fold a random sheet along it, *
   * and read what ends on top. If it makes a good commission, ship it - *
   * the reverse of that sequence is then guaranteed to solve the order. */

  function randSheet(cols, rows, minDistinct) {
    for (;;) {
      const s = newSheet(cols, rows);
      const seen = new Set();
      for (const stack of s.cells) seen.add(stack[0].m);
      if (seen.size >= minDistinct) return s;
    }
  }

  function randSequence(cols, rows) {
    const seq = [];
    let c = cols;
    let r = rows;
    while (c > 1 || r > 1) {
      const opts = [];
      if (c > 1) opts.push("left", "right");
      if (r > 1) opts.push("top", "bottom");
      const d = opts[(Math.random() * opts.length) | 0];
      seq.push(d);
      if (d === "left" || d === "right") c /= 2;
      else r /= 2;
    }
    return seq;
  }

  function generateOrder(order) {
    const minDist = Math.min(3, order.cols * order.rows);
    for (let tries = 0; tries < 600; tries++) {
      const sheet = randSheet(
        order.cols,
        order.rows,
        tries < 400 ? minDist : 1,
      );
      const seq = randSequence(order.cols, order.rows);
      const flip = Math.random() < 0.5;
      const pkt = packetOf(foldSeq(flip ? flipSheet(sheet) : sheet, seq));
      const top = pkt[pkt.length - 1];
      const s2 = pkt[pkt.length - 2];
      const s3 = pkt[pkt.length - 3];
      let ms = null;
      let ok = false;
      if (order.kind === "plain") ok = !top.front;
      else if (order.kind === "plain+1") {
        ok = !top.front && s2.front;
        ms = [s2.m];
      } else if (order.kind === "motif") {
        ok = top.front;
        ms = [top.m];
      } else if (order.kind === "motif+1") {
        ok = top.front && s2.front && s2.m !== top.m;
        ms = [top.m, s2.m];
      } else if (order.kind === "motif+2") {
        ok =
          top.front &&
          s2.front &&
          s3.front &&
          top.m !== s2.m &&
          s2.m !== s3.m &&
          top.m !== s3.m;
        ms = [top.m, s2.m, s3.m];
      }
      if (ok) {
        return {
          sheet,
          commission: { kind: order.kind, ms },
          par: seq.length + (flip ? 1 : 0),
        };
      }
    }
    /* unreachable in practice; fall back to a plain commission */
    return {
      sheet: randSheet(order.cols, order.rows, 1),
      commission: { kind: "plain", ms: [] },
      par: 6,
    };
  }

  /* ------------------------------------------------------------ audio */

  let AC = null;
  let master = null;
  let muted = false;
  try {
    muted = window.localStorage.getItem(STORE_MUTE) === "1";
  } catch (err) {
    muted = false;
  }

  function ensureAudio() {
    if (!AC) {
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        AC = new Ctor();
        master = AC.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(AC.destination);
      } catch (err) {
        AC = null;
      }
    }
    if (AC && AC.state === "suspended") AC.resume();
  }

  function setMuted(v) {
    muted = v;
    if (master) master.gain.value = muted ? 0 : 0.5;
    btnMute.classList.toggle("off", muted);
    try {
      window.localStorage.setItem(STORE_MUTE, muted ? "1" : "0");
    } catch (err) {
      /* non-fatal */
    }
  }

  function noiseSwish() {
    if (!AC || muted) return;
    const dur = 0.22;
    const buf = AC.createBuffer(1, (AC.sampleRate * dur) | 0, AC.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = AC.createBufferSource();
    src.buffer = buf;
    const bp = AC.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(420, AC.currentTime);
    bp.frequency.exponentialRampToValueAtTime(1500, AC.currentTime + dur);
    const g = AC.createGain();
    g.gain.setValueAtTime(0.0001, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.5, AC.currentTime + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    src.connect(bp).connect(g).connect(master);
    src.start();
  }

  function tone(freq, at, dur, type, vol) {
    if (!AC || muted) return;
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, AC.currentTime + at);
    g.gain.setValueAtTime(0.0001, AC.currentTime + at);
    g.gain.exponentialRampToValueAtTime(vol, AC.currentTime + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + at + dur);
    o.connect(g).connect(master);
    o.start(AC.currentTime + at);
    o.stop(AC.currentTime + at + dur + 0.05);
  }

  const sndTick = () => tone(880, 0, 0.06, "sine", 0.12);
  const sndDeny = () => {
    tone(160, 0, 0.16, "triangle", 0.3);
    tone(110, 0.09, 0.2, "triangle", 0.26);
  };
  const sndSeal = () => {
    tone(659.25, 0, 0.22, "sine", 0.28);
    tone(987.77, 0.1, 0.3, "sine", 0.24);
    tone(1318.5, 0.2, 0.36, "sine", 0.16);
  };

  /* ------------------------------------------------------------- state */

  let st = null; // live sheet (leads the animation)
  let curGen = null; // { sheet, commission, par } for this order
  let orderIdx = 0;
  let moves = 0;
  let attempts = 0;
  let score = 0;
  let starsTotal = 0;
  let history = [];
  let mode = "menu"; // menu | playing | sealed | done
  let paused = false;
  let anim = null; // { dir, pre, post, t0 }
  let stampAt = 0;
  let interShown = false;
  let confetti = [];
  let hoverDir = null;
  let clock = 0;
  let lastTs = 0;
  let vw = 300;
  let vh = 300;

  let best = loadNum(STORE_BEST);

  /* The sheet the desk currently shows: while a fold animates, that is   *
   * still the pre-fold sheet; the live state has already folded ahead.   */

  function view() {
    return anim ? anim.pre : st;
  }

  /* -------------------------------------------------------------- hud */

  function glyphSvg(i, cls) {
    const m = MOTIFS[i];
    let inner = "";
    for (const p of m.prims) inner += `<path d="${p.d}"/>`;
    for (const d of m.dots) {
      inner += `<circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="${
        d.knock ? m.tint : m.ink
      }"/>`;
    }
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><g fill="${m.ink}">${inner}</g></svg>`;
  }

  function commissionHtml(c) {
    const g = (i) => glyphSvg(i, "cglyph");
    const nm = (i) => `<b>the ${MOTIFS[i].name}</b>`;
    if (c.kind === "plain")
      return "Commission &mdash; fold it plain-side out, not a print showing.";
    if (c.kind === "plain+1")
      return `Commission &mdash; plain side out, with ${g(c.ms[0])} ${nm(
        c.ms[0],
      )} hidden just beneath.`;
    if (c.kind === "motif")
      return `Commission &mdash; finish with ${g(c.ms[0])} ${nm(
        c.ms[0],
      )} face-up on the packet.`;
    if (c.kind === "motif+1")
      return `Commission &mdash; ${g(c.ms[0])} ${nm(c.ms[0])} face-up, ${g(
        c.ms[1],
      )} ${nm(c.ms[1])} sealed just beneath.`;
    return `Commission &mdash; ${g(c.ms[0])} ${nm(c.ms[0])} on top, ${g(
      c.ms[1],
    )} ${nm(c.ms[1])} beneath it, ${g(c.ms[2])} ${nm(
      c.ms[2],
    )} at the bottom of the show.`;
  }

  function syncHud() {
    elOrder.textContent = String(orderIdx + 1);
    elMoves.textContent = String(moves);
    elPar.textContent = String(curGen ? curGen.par : 0);
    elScore.textContent = String(score);
    btnUndo.disabled = mode !== "playing" || history.length === 0;
    btnUndo.classList.toggle("pulse", mode === "playing" && attempts > 0);
  }

  function showBanner(text) {
    elBanner.innerHTML = text;
    elBanner.classList.add("show");
  }

  function hideBanner() {
    elBanner.classList.remove("show");
  }

  /* ---------------------------------------------------------- overlay */

  let overlayAction = null;

  function showOverlay(opts) {
    ovTitle.innerHTML = opts.title;
    ovTag.innerHTML = opts.tag || "";
    ovTag.style.display = opts.tag ? "" : "none";
    ovBody.innerHTML = opts.body || "";
    ovBody.style.display = opts.body ? "" : "none";
    ovBest.innerHTML = opts.best || "";
    ovBest.style.display = opts.best ? "" : "none";
    btnStart.innerHTML = opts.button;
    overlayAction = opts.action;
    overlay.classList.add("show");
  }

  function hideOverlay() {
    overlay.classList.remove("show");
    overlayAction = null;
  }

  function starRow(n) {
    let out = "";
    for (let i = 1; i <= 3; i++) {
      out += `<span${i <= n ? "" : ' class="off"'}>&#9733;</span>`;
    }
    return out;
  }

  function showMenu() {
    showOverlay({
      title: "Foldsong",
      tag: "Every crease decides what shows.",
      body:
        "<ul>" +
        "<li>Fold the sheet in half, edge over edge, until it is one small sealed packet.</li>" +
        "<li>The commission above the desk says which printed face must finish on top &mdash; and which must hide just beneath.</li>" +
        "<li>Each fold flips its half over: prints turn face-down, plain kraft turns face-up. Plan the order of your creases.</li>" +
        "<li>The &#10227; button (or F) turns the whole sheet over &mdash; often the only way a print can finish face-up.</li>" +
        "<li>Fewest folds and one clean seal earn three stars. Undo is free, but the paper remembers how much you handled it.</li>" +
        "</ul>",
      best:
        best > 0
          ? `Best day at the desk: <b>${best}</b>`
          : "Six commissions await.",
      button: "Open the desk",
      action: beginPlay,
    });
  }

  function showInterstitial(stars, pts) {
    showOverlay({
      title: "Order filled",
      tag: PRAISE[orderIdx] || "",
      body: `<div class="stars">${starRow(
        stars,
      )}</div><p id="ov-score">+${pts} points &middot; day so far <b>${score}</b></p>`,
      button:
        orderIdx + 1 < ORDERS.length ? "Next commission" : "Close up the shop",
      action: () => {
        if (orderIdx + 1 < ORDERS.length) startOrder(orderIdx + 1);
        else finishRun();
      },
    });
  }

  function showDone() {
    showOverlay({
      title: "The desk is cleared",
      tag: "Every commission folded, sealed and gone with the evening post.",
      body: `<div class="stars">${starRow(
        Math.round(starsTotal / ORDERS.length),
      )}</div><p id="ov-score">Day's takings <b>${score}</b> points &middot; ${starsTotal} of ${
        ORDERS.length * 3
      } stars</p>`,
      best:
        score >= best
          ? "A new best day at the desk."
          : `Best day at the desk: <b>${best}</b>`,
      button: "Fold a new day",
      action: () => {
        startRun();
        mode = "playing";
      },
    });
  }

  function showPause() {
    showOverlay({
      title: "Paused",
      tag: "The kettle is on.",
      body: "",
      button: "Back to the desk",
      action: togglePause,
    });
  }

  /* -------------------------------------------------------------- flow */

  function startRun() {
    score = 0;
    starsTotal = 0;
    startOrder(0);
  }

  function startOrder(idx) {
    orderIdx = idx;
    curGen = generateOrder(ORDERS[idx]);
    st = clone(curGen.sheet);
    history = [];
    moves = 0;
    attempts = 0;
    anim = null;
    confetti = [];
    interShown = false;
    hoverDir = null;
    mode = "playing";
    hideBanner();
    elCommission.classList.remove("done");
    elCommission.innerHTML = commissionHtml(curGen.commission);
    syncHud();
  }

  function beginPlay() {
    ensureAudio();
    sndTick();
    hideOverlay();
    mode = "playing";
    syncHud();
  }

  function starCount() {
    if (attempts <= 1 && moves <= curGen.par + 2) return 3;
    if (attempts <= 3 && moves <= curGen.par + 8) return 2;
    return 1;
  }

  function wrongSealText() {
    const c = curGen.commission;
    const nm = (i) => `<b>the&nbsp;${MOTIFS[i].name}</b>`;
    if (c.kind === "plain" || c.kind === "plain+1") {
      const under =
        c.kind === "plain+1" ? `, with ${nm(c.ms[0])} hidden just beneath` : "";
      return `The seal slides off &mdash; it takes only plain kraft face-up${under}.`;
    }
    return `The seal slides off &mdash; ${nm(c.ms[0])} must finish face-up.`;
  }

  function evaluateSeal() {
    const pkt = packetOf(st);
    if (checkSeal(pkt, curGen.commission)) {
      const stars = starCount();
      const pts = stars * 100;
      score += pts;
      starsTotal += stars;
      mode = "sealed";
      stampAt = clock;
      elCommission.classList.add("done");
      spawnConfetti();
      sndSeal();
      syncHud();
    } else {
      attempts++;
      sndDeny();
      showBanner(wrongSealText());
      syncHud();
    }
  }

  function finishRun() {
    mode = "done";
    if (score > best) {
      best = score;
      saveNum(STORE_BEST, best);
    }
    showDone();
  }

  /* ------------------------------------------------------------ acting */

  function doFold(dir) {
    if (mode !== "playing" || paused || anim) return;
    if (!st || !canFold(st, dir)) return;
    hideBanner();
    history.push(clone(st));
    if (history.length > 40) history.shift();
    anim = { dir, pre: st, post: foldState(st, dir), t0: clock };
    st = anim.post; // logic folds at once; the eye follows over FOLD_MS
    moves++;
    noiseSwish();
    syncHud();
  }

  function doUndo() {
    if (mode !== "playing" || paused || anim || !history.length) return;
    st = history.pop();
    moves++;
    hideBanner();
    sndTick();
    syncHud();
  }

  function doFlip() {
    if (mode !== "playing" || paused || anim || !st) return;
    if (!canFlip(st)) return;
    hideBanner();
    history.push(clone(st));
    if (history.length > 40) history.shift();
    anim = { type: "flip", pre: st, post: flipSheet(st), t0: clock };
    st = anim.post;
    moves++;
    noiseSwish();
    syncHud();
  }

  function restartOrder() {
    if (mode === "menu" || mode === "done" || !curGen) return;
    startOrder(orderIdx);
    sndTick();
  }

  function togglePause(force) {
    if (mode !== "playing" && mode !== "sealed") return;
    const to = force === undefined ? !paused : force;
    if (to === paused) return;
    paused = to;
    if (paused) showPause();
    else hideOverlay();
    btnPause.innerHTML = paused ? "&#9654;" : "&#10073;&#10073;";
    sndTick();
  }

  function toggleMute() {
    ensureAudio();
    setMuted(!muted);
    if (!muted) sndTick();
  }

  /* --------------------------------------------------------- confetti */

  function spawnConfetti() {
    if (REDUCED) return;
    const lay = layout();
    const v = view();
    const cx = lay.ox + (lay.s * v.cols) / 2;
    const cy = lay.oy + (lay.s * v.rows) / 2;
    const colors = ["#c05a44", "#e8a13c", "#67b06a", "#5f8fd9", "#d95fa0"];
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 90 + Math.random() * 190;
      confetti.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 130,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 9,
        color: colors[i % colors.length],
        life: 1.15,
      });
    }
  }

  /* ----------------------------------------------------------- drawing */

  function layout() {
    const v = view();
    const margin = 56;
    const s = Math.max(
      28,
      Math.min((vw - margin * 2) / v.cols, (vh - margin * 2) / v.rows, 92),
    );
    return { s, ox: (vw - s * v.cols) / 2, oy: (vh - s * v.rows) / 2 };
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hashNoise(a, b) {
    const t = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return t - Math.floor(t);
  }

  function drawFace(x, y, s, face, seed) {
    const inset = Math.max(0.75, s * 0.012);
    const w = s - inset * 2;
    rr(x + inset, y + inset, w, w, s * 0.09);
    if (face.front) {
      const m = MOTIFS[face.m];
      ctx.fillStyle = m.tint;
      ctx.fill();
      ctx.strokeStyle = "rgba(60, 42, 20, 0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();
      drawGlyph(x + s / 2, y + s / 2, s * 0.64, m);
    } else {
      ctx.fillStyle = KRAFT;
      ctx.fill();
      ctx.strokeStyle = "rgba(60, 42, 20, 0.14)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = KRAFT_INK;
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const fy = y + s * (0.28 + 0.22 * i) + hashNoise(seed, i) * s * 0.06;
        const fx = x + s * (0.16 + hashNoise(seed + 3, i) * 0.14);
        const fl = s * (0.3 + hashNoise(seed + 7, i) * 0.35);
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + fl, fy + (hashNoise(seed + 11, i) - 0.5) * s * 0.06);
        ctx.stroke();
      }
    }
  }

  function drawGlyph(cx, cy, size, m) {
    const k = size / 24;
    ctx.save();
    ctx.translate(cx - (12 * size) / 24, cy - (12 * size) / 24);
    ctx.scale(k, k);
    ctx.fillStyle = m.ink;
    for (const p of m.prims) ctx.fill(new Path2D(p.d));
    for (const d of m.dots) {
      ctx.fillStyle = d.knock ? m.tint : m.ink;
      ctx.beginPath();
      ctx.arc(d.cx, d.cy, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function arrowPos(dir, lay) {
    const v = view();
    const mx = lay.ox + (lay.s * v.cols) / 2;
    const my = lay.oy + (lay.s * v.rows) / 2;
    if (dir === "top") return { x: mx, y: lay.oy - 32 };
    if (dir === "bottom") return { x: mx, y: lay.oy + lay.s * v.rows + 32 };
    if (dir === "left") return { x: lay.ox - 32, y: my };
    if (dir === "flip")
      return {
        x: lay.ox + lay.s * v.cols + 27,
        y: lay.oy + lay.s * v.rows + 27,
      };
    return { x: lay.ox + lay.s * v.cols + 32, y: my };
  }

  function drawArrow(dir, lay) {
    const v = view();
    if (dir === "flip") {
      if (!canFlip(v)) return;
    } else if (!canFold(v, dir)) {
      return;
    }
    const p = arrowPos(dir, lay);
    const hov = hoverDir === dir;
    const pulse = 0.5 + 0.5 * Math.sin(clock * 3.2);
    ctx.save();
    ctx.globalAlpha = hov ? 1 : 0.55 + 0.35 * pulse;
    ctx.beginPath();
    ctx.arc(p.x, p.y, hov ? 23 : 20, 0, Math.PI * 2);
    ctx.fillStyle = hov
      ? "rgba(243, 233, 210, 0.28)"
      : "rgba(243, 233, 210, 0.13)";
    ctx.fill();
    ctx.strokeStyle = "rgba(243, 233, 210, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = "#f3e9d2";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (dir === "flip") {
      ctx.beginPath();
      ctx.arc(0, 1, 7, Math.PI * 0.5, Math.PI * 2.05);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(7, 8);
      ctx.lineTo(7.5, 1.5);
      ctx.lineTo(1.5, 3);
      ctx.closePath();
      ctx.fillStyle = "#f3e9d2";
      ctx.fill();
    } else {
      const rot =
        dir === "top"
          ? Math.PI
          : dir === "left"
            ? Math.PI / 2
            : dir === "right"
              ? -Math.PI / 2
              : 0;
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(-6, -7);
      ctx.lineTo(0, -1);
      ctx.lineTo(6, -7);
      ctx.stroke();
    }
    ctx.restore();
  }

  function movingSet() {
    if (!anim || anim.type === "flip") return null;
    const { dir, pre } = anim;
    const half =
      dir === "left" || dir === "right" ? pre.cols / 2 : pre.rows / 2;
    const set = new Set();
    for (let r = 0; r < pre.rows; r++) {
      for (let c = 0; c < pre.cols; c++) {
        const isSrc =
          dir === "left"
            ? c < half
            : dir === "right"
              ? c >= pre.cols - half
              : dir === "top"
                ? r < half
                : r >= pre.rows - half;
        if (isSrc) set.add(r * pre.cols + c);
      }
    }
    return set;
  }

  function drawSheet(lay) {
    let pulse = 0;
    if (anim && anim.type === "flip") {
      const dur = (REDUCED ? 90 : FOLD_MS) / 1000;
      const e = Math.min(1, Math.max(0, (clock - anim.t0) / dur));
      pulse = Math.sin(Math.PI * e);
    }
    if (!pulse) {
      drawSheetInner(lay);
      return;
    }
    const v0 = view();
    ctx.save();
    ctx.translate(
      lay.ox + (lay.s * v0.cols) / 2,
      lay.oy + (lay.s * v0.rows) / 2,
    );
    const k = 1 - 0.12 * pulse;
    ctx.scale(k, k);
    ctx.translate(
      -lay.ox - (lay.s * v0.cols) / 2,
      -lay.oy - (lay.s * v0.rows) / 2,
    );
    drawSheetInner(lay);
    ctx.fillStyle = `rgba(30, 20, 10, ${0.22 * pulse})`;
    rr(lay.ox + 1, lay.oy + 1, lay.s * v0.cols - 2, lay.s * v0.rows - 2, 8);
    ctx.fill();
    ctx.restore();
  }

  function drawSheetInner(lay) {
    const v = view();
    const { s, ox, oy } = lay;
    const w = s * v.cols;
    const h = s * v.rows;

    /* cast shadow under the whole sheet */
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 10;
    rr(ox + 2, oy + 2, w - 4, h - 4, 8);
    ctx.fillStyle = "rgba(43, 30, 18, 0.9)";
    ctx.fill();
    ctx.restore();

    /* packet thickness once the sheet is folded small */
    if (v.cells.length === 1) {
      const layers = Math.min(
        7,
        Math.max(2, Math.round(v.cells[0].length / 2.4)),
      );
      for (let i = layers; i >= 1; i--) {
        rr(ox + 2 + i * 1.4, oy + 2 + i * 1.4, w - 4, h - 4, 8);
        ctx.fillStyle = "#cbb894";
        ctx.fill();
      }
    }

    const moving = movingSet();

    for (let r = 0; r < v.rows; r++) {
      for (let c = 0; c < v.cols; c++) {
        const i = r * v.cols + c;
        if (moving && moving.has(i)) continue; // drawn transformed below
        const stack = v.cells[i];
        drawFace(ox + c * s, oy + r * s, s, stack[stack.length - 1], i * 17);
      }
    }

    /* crease guides */
    if (!anim) {
      ctx.save();
      ctx.strokeStyle = "rgba(43, 30, 18, 0.28)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      if (v.cols >= 2) {
        ctx.beginPath();
        ctx.moveTo(ox + (s * v.cols) / 2, oy + 3);
        ctx.lineTo(ox + (s * v.cols) / 2, oy + h - 3);
        ctx.stroke();
      }
      if (v.rows >= 2) {
        ctx.beginPath();
        ctx.moveTo(ox + 3, oy + (s * v.rows) / 2);
        ctx.lineTo(ox + w - 3, oy + (s * v.rows) / 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (anim && anim.type !== "flip") drawMovingHalf(lay);

    /* wax seal stamp */
    if (mode === "sealed" && v.cells.length === 1) {
      const t = Math.min(1, (clock - stampAt) / 0.45);
      const pop = REDUCED ? 1 : 1 + 0.25 * Math.sin(t * Math.PI);
      const rad = s * 0.52 * (0.2 + 0.8 * t) * pop;
      const cx = ox + w / 2;
      const cy = oy + h / 2;
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.75 * t;
      ctx.beginPath();
      ctx.arc(cx + 2, cy + 3, rad, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fillStyle = "#a33b2e";
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, rad * 0.09);
      ctx.strokeStyle = "#c05a44";
      ctx.stroke();
      if (curGen.commission.kind !== "plain") {
        drawGlyph(cx, cy, rad * 1.15, {
          ...MOTIFS[curGen.commission.ms[0]],
          ink: "#f3e9d2",
          tint: "#a33b2e",
        });
      } else {
        ctx.fillStyle = "#f3e9d2";
        ctx.font = `${Math.max(10, rad * 0.95)}px Georgia, serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("\u2713", cx, cy + 1);
      }
      ctx.restore();
    }
  }

  function drawMovingHalf(lay) {
    const { s, ox, oy } = lay;
    const dur = (REDUCED ? 90 : FOLD_MS) / 1000;
    const e = Math.min(1, Math.max(0, (clock - anim.t0) / dur));
    const eased = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
    const sc = 1 - 2 * eased;
    const lift = 1 - Math.abs(sc);

    ctx.save();
    ctx.shadowColor = `rgba(0, 0, 0, ${0.05 + 0.3 * lift})`;
    ctx.shadowBlur = 20 * lift;
    ctx.shadowOffsetY = 14 * lift;
    if (anim.dir === "left" || anim.dir === "right") {
      const fx = ox + (s * anim.pre.cols) / 2;
      ctx.translate(fx, 0);
      ctx.scale(sc, 1);
      ctx.translate(-fx, 0);
    } else {
      const fy = oy + (s * anim.pre.rows) / 2;
      ctx.translate(0, fy);
      ctx.scale(1, sc);
      ctx.translate(0, -fy);
    }
    const mv = movingSet();
    for (let r = 0; r < anim.pre.rows; r++) {
      for (let c = 0; c < anim.pre.cols; c++) {
        const i = r * anim.pre.cols + c;
        if (!mv.has(i)) continue;
        const x = ox + c * s;
        const y = oy + r * s;
        const stack = anim.pre.cells[i];
        drawFace(x, y, s, stack[stack.length - 1], i * 17);
        ctx.fillStyle = `rgba(30, 20, 10, ${0.3 * lift})`;
        rr(x + 1, y + 1, s - 2, s - 2, s * 0.09);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawConfetti(dt) {
    for (const p of confetti) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 480 * dt;
      p.rot += p.vr * dt;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-4, -2.5, 8, 5);
      ctx.restore();
    }
    confetti = confetti.filter((p) => p.life > 0 && p.y < vh + 40);
  }

  function draw(dt) {
    ctx.clearRect(0, 0, vw, vh);
    if (!st) return;
    const lay = layout();
    drawSheet(lay);
    if (mode === "playing" && !anim && !paused) {
      for (const dir of ["top", "bottom", "left", "right"]) drawArrow(dir, lay);
    }
    drawConfetti(paused ? 0 : dt);
  }

  /* ------------------------------------------------------------ input */

  function hitArrow(x, y) {
    if (!st) return null;
    const lay = layout();
    const v = view();
    for (const dir of ["top", "bottom", "left", "right", "flip"]) {
      if (dir === "flip") {
        if (!canFlip(v)) continue;
      } else if (!canFold(v, dir)) {
        continue;
      }
      const p = arrowPos(dir, lay);
      const dx = x - p.x;
      const dy = y - p.y;
      if (dx * dx + dy * dy <= 32 * 32) return dir;
    }
    return null;
  }

  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    hoverDir = hitArrow(e.clientX - rect.left, e.clientY - rect.top);
  });

  canvas.addEventListener("pointerleave", () => {
    hoverDir = null;
  });

  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    const rect = canvas.getBoundingClientRect();
    const dir = hitArrow(e.clientX - rect.left, e.clientY - rect.top);
    if (dir) {
      if (dir === "flip") doFlip();
      else doFold(dir);
      e.preventDefault();
    }
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "m") {
      toggleMute();
      return;
    }
    if (k === "p") {
      togglePause();
      e.preventDefault();
      return;
    }
    if (k === "u") {
      doUndo();
      return;
    }
    if (k === "r") {
      restartOrder();
      return;
    }
    if (k === "f") {
      doFlip();
      return;
    }
    if (mode !== "playing" || paused || anim) return;
    const dirs = {
      arrowup: "top",
      w: "top",
      arrowdown: "bottom",
      s: "bottom",
      arrowleft: "left",
      a: "left",
      arrowright: "right",
      d: "right",
    };
    const dir = dirs[k];
    if (dir) {
      doFold(dir);
      e.preventDefault();
    }
  });

  btnStart.addEventListener("click", () => {
    ensureAudio();
    const action = overlayAction;
    hideOverlay();
    if (action) action();
  });

  btnUndo.addEventListener("click", () => {
    ensureAudio();
    doUndo();
  });
  btnPause.addEventListener("click", () => {
    ensureAudio();
    togglePause();
  });
  btnMute.addEventListener("click", toggleMute);
  btnRestart.addEventListener("click", () => {
    ensureAudio();
    restartOrder();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mode === "playing" && !paused) togglePause(true);
  });

  /* ------------------------------------------------------- boot & loop */

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    vw = stageEl.clientWidth;
    vh = stageEl.clientHeight;
    canvas.width = Math.max(1, Math.round(vw * dpr));
    canvas.height = Math.max(1, Math.round(vh * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", resize);

  function frame(ts) {
    const dt = Math.min(0.05, lastTs ? (ts - lastTs) / 1000 : 0.016);
    lastTs = ts;
    if (!paused) {
      clock += dt;
      if (anim && clock - anim.t0 >= (REDUCED ? 90 : FOLD_MS) / 1000) {
        anim = null;
        if (mode === "playing" && st.cols === 1 && st.rows === 1) {
          evaluateSeal();
        }
      }
      if (mode === "sealed" && !interShown && clock - stampAt >= SEAL_DELAY_S) {
        interShown = true;
        showInterstitial(starCount(), starCount() * 100);
      }
    }
    draw(dt);
    requestAnimationFrame(frame);
  }

  setMuted(muted);
  resize();
  startRun();
  mode = "menu";
  showMenu();
  requestAnimationFrame(frame);

  /* Test seam: production pages never define __foldsongTest, so no global
     is created in normal play. Lets the headless suite read the model. */
  if (window.__foldsongTest) {
    window.foldsong = {
      state: () => (st ? clone(st) : null),
      commission: () => (curGen ? clone(curGen.commission) : null),
      par: () => (curGen ? curGen.par : 0),
      pure: { foldState, flipSheet, checkSeal, packetOf },
    };
  }
})();
