/*
 * Opus Tessellatum — rebuild the buried mosaic floors of a Roman villa.
 * Read the run counts along every row and column, set only the tesserae
 * they swear to, and keep the inspector's three wax seals uncracked.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  Commissions: hand-cut floors. Art rows use palette keys; a dot is  *
   *  bare screed.                                                       *
   * ------------------------------------------------------------------ */
  const LEVELS = [
    {
      name: "The Amphora",
      numeral: "I",
      pal: { a: ["#c1622f", "#b05426"] },
      art: [".aaa.", ".aaa.", "aaaaa", ".aaa.", "..a.."],
    },
    {
      name: "The Mullet",
      numeral: "II",
      pal: {
        s: ["#7fa3ad", "#6d92a0"],
        d: ["#33424a", "#2a373e"],
      },
      art: [
        "........",
        "..ssss.s",
        ".sdsssss",
        ".sssssss",
        "..ssss.s",
        "........",
      ],
    },
    {
      name: "The Rosette",
      numeral: "III",
      pal: {
        r: ["#a03a2c", "#8f3226"],
        g: ["#c99a3f", "#b98a34"],
        o: ["#c47a35", "#b06a2c"],
      },
      art: [
        "....rr....",
        ".oo.rr.oo.",
        ".oo.rr.oo.",
        "....rr....",
        "rr..gg..rr",
        "rr..gg..rr",
        "....gg....",
        ".oo.rr.oo.",
        ".oo.rr.oo.",
        "....rr....",
      ],
    },
    {
      name: "The Vine",
      numeral: "IV",
      pal: {
        v: ["#6f7f3a", "#5f7031"],
        p: ["#6b4a7a", "#5b3d69"],
      },
      art: [
        ".....vv.....",
        ".....vv.....",
        "..vvv..vvv..",
        "...pp.pp....",
        "...pp.pp....",
        "..pp.pp.pp..",
        "..pp.pp.pp..",
        "...pp.pp....",
        "...pp.pp....",
        "....pp......",
        "....pp......",
        "............",
      ],
    },
    {
      name: "The Owl of Minerva",
      numeral: "V",
      pal: {
        b: ["#8a5a33", "#7a4d2a"],
        y: ["#e3c98f", "#d6ba7d"],
        o: ["#c4883c", "#b27630"],
      },
      art: [
        "...b.......b...",
        "..bbb.....bbb..",
        ".bbbbbbbbbbbbb.",
        ".bbbbbbbbbbbbb.",
        ".byybbbbbbbyyb.",
        ".byybbbbbbbyyb.",
        ".bbbbbbbbbbbbb.",
        "..bbbbbbbbbbb..",
        "...bbbbobbbb...",
        "..bbbbbbbbbbb..",
        ".bbbbbbbbbbbbb.",
        ".bbbbbooobbbbb.",
        "....o.....o....",
        "..bbbbbbbbbbb..",
        ".b.b.b.b.b.b.b.",
      ],
    },
  ];

  /* ------------------------------------------------------------------ */
  /*  Small helpers                                                      */
  /* ------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  function hash2(a, b) {
    const n = Math.sin(a * 127.1 + b * 311.7 + 13.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }

  function say(msg) {
    $("sr").textContent = msg;
  }

  /* ------------------------------------------------------------------ */
  /*  Sound — everything synthesised, nothing fetched                    */
  /* ------------------------------------------------------------------ */
  let AC = null;
  let master = null;
  let muted = false;

  function audio() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        master = AC.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(AC.destination);
      } catch (err) {
        AC = null;
      }
    }
    if (AC && AC.state === "suspended") {
      AC.resume().catch(function () {});
    }
    return AC;
  }

  function tone(freq, type, dur, vol, slideTo, when) {
    if (!audio() || muted) {
      return;
    }
    const t0 = AC.currentTime + (when || 0);
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) {
      o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function hiss(dur, freq, vol, kind, when) {
    if (!audio() || muted) {
      return;
    }
    const t0 = AC.currentTime + (when || 0);
    const len = Math.max(1, Math.floor(AC.sampleRate * dur));
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = Math.random() * 2 - 1;
    }
    const src = AC.createBufferSource();
    src.buffer = buf;
    const f = AC.createBiquadFilter();
    f.type = kind || "lowpass";
    f.frequency.setValueAtTime(freq, t0);
    f.frequency.exponentialRampToValueAtTime(
      Math.max(60, freq * 0.35),
      t0 + dur,
    );
    const g = AC.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
  }

  const snd = {
    blip() {
      tone(660, "triangle", 0.05, 0.12);
    },
    thock() {
      tone(165 + Math.random() * 28, "triangle", 0.09, 0.4);
      hiss(0.035, 2200, 0.18);
    },
    tick() {
      tone(125, "sine", 0.045, 0.16);
    },
    crack() {
      hiss(0.22, 1400, 0.5, "bandpass");
      tone(95, "sawtooth", 0.2, 0.3, 50);
    },
    chime() {
      [659, 880, 988, 1319].forEach(function (f, i) {
        tone(f, "sine", 0.32, 0.2, null, i * 0.09);
      });
    },
    fanfare() {
      [392, 494, 587, 784, 988, 1175].forEach(function (f, i) {
        tone(f, "triangle", 0.4, 0.22, null, i * 0.13);
        tone(f * 2, "sine", 0.3, 0.08, null, i * 0.13);
      });
    },
    sad() {
      tone(330, "triangle", 0.3, 0.2);
      tone(233, "triangle", 0.5, 0.2, null, 0.25);
    },
  };

  /* ------------------------------------------------------------------ */
  /*  Game state                                                         */
  /* ------------------------------------------------------------------ */
  const S = {
    screen: "intro", // intro | play | reveal | floorDone | failed | won
    paused: false,
    li: 0,
    lvl: null,
    cols: 0,
    rows: 0,
    sol: [], // solution char or "" per cell
    cells: [], // {set, mark, slip}
    rowClue: [],
    colClue: [],
    rowDone: [],
    colDone: [],
    seals: 3,
    undo: [],
    mode: "set",
    cr: 0,
    cc: 0,
    hoverR: -1,
    hoverC: -1,
    elapsed: 0,
    lastTick: 0,
    flashT: 0,
    revealStart: 0,
    revealShown: false,
    sparks: [],
    sealsTotal: 0,
    floorsDone: 0,
    runMs: 0,
    layout: null,
    drag: null,
    pointerDown: false,
    lastEarned: 0,
  };

  function runsOfLine(line, n) {
    const get = typeof line === "function" ? line : (i) => line[i];
    const out = [];
    let run = 0;
    for (let i = 0; i < n; i++) {
      if (get(i)) {
        run++;
      } else if (run > 0) {
        out.push(run);
        run = 0;
      }
    }
    if (run > 0) {
      out.push(run);
    }
    return out.length ? out : [0];
  }

  function arraysEqual(a, b) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  function refreshDoneLines() {
    for (let r = 0; r < S.rows; r++) {
      const cur = runsOfLine((c) => S.cells[r * S.cols + c].set, S.cols);
      S.rowDone[r] = arraysEqual(cur, S.rowClue[r]);
    }
    for (let c = 0; c < S.cols; c++) {
      const cur = runsOfLine((r) => S.cells[r * S.cols + c].set, S.rows);
      S.colDone[c] = arraysEqual(cur, S.colClue[c]);
    }
  }

  function computeLayout() {
    const CU = 17; // width of one clue number slot
    const CV = 19; // vertical spacing for column clues
    const pad = 22;
    let mr = 1;
    let mc = 1;
    S.rowClue.forEach(function (cl) {
      mr = Math.max(mr, cl.length);
    });
    S.colClue.forEach(function (cl) {
      mc = Math.max(mc, cl.length);
    });
    const gutW = mr * CU + 18;
    const gutH = mc * CV + 16;
    const availW = W - pad * 2 - gutW;
    const availH = H - pad * 2 - gutH - 30;
    let cell = Math.min(availW / S.cols, availH / S.rows, 86);
    cell = Math.floor(cell * 100) / 100;
    const bw = cell * S.cols;
    const bh = cell * S.rows;
    S.layout = {
      pad,
      gutW,
      gutH,
      cell,
      ox: Math.round(pad + gutW + (availW - bw) / 2),
      oy: Math.round(pad + gutH + (availH - bh) / 2),
      gw: bw,
      gh: bh,
      CU,
      CV,
    };
  }

  function loadLevel(i) {
    S.li = i;
    S.lvl = LEVELS[i];
    S.rows = S.lvl.art.length;
    S.cols = S.lvl.art[0].length;
    S.sol = [];
    S.cells = [];
    S.lvl.art.forEach(function (rowStr, r) {
      for (let c = 0; c < S.cols; c++) {
        const ch = rowStr.charAt(c);
        S.sol.push(ch === "." || ch === " " ? "" : ch);
        S.cells.push({ set: false, mark: false, slip: false });
      }
    });
    S.rowClue = [];
    S.colClue = [];
    for (let r = 0; r < S.rows; r++) {
      const rowSol = [];
      for (let c = 0; c < S.cols; c++) {
        rowSol.push(S.sol[r * S.cols + c] !== "");
      }
      S.rowClue.push(runsOfLine(rowSol, S.cols));
    }
    for (let c = 0; c < S.cols; c++) {
      const colSol = [];
      for (let r = 0; r < S.rows; r++) {
        colSol.push(S.sol[r * S.cols + c] !== "");
      }
      S.colClue.push(runsOfLine(colSol, S.rows));
    }
    S.rowDone = new Array(S.rows).fill(false);
    S.colDone = new Array(S.cols).fill(false);
    S.seals = 3;
    S.undo = [];
    S.cr = 0;
    S.cc = 0;
    S.hoverR = -1;
    S.hoverC = -1;
    S.elapsed = 0;
    S.flashT = 0;
    S.sparks = [];
    S.revealShown = false;
    S.drag = null;
    S.pointerDown = false;
    computeLayout();
    S.screen = "play";
    S.paused = false;
    hideOverlay();
    updateHUD();
    say(
      "Floor " +
        S.lvl.numeral +
        ", " +
        S.lvl.name +
        ": " +
        S.cols +
        " by " +
        S.rows +
        ". Three wax seals remain.",
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Moves                                                              */
  /* ------------------------------------------------------------------ */
  function idx(r, c) {
    return r * S.cols + c;
  }

  function pushUndo(cellI, prev) {
    S.undo.push({ i: cellI, prevSet: prev.set, prevMark: prev.mark });
    if (S.undo.length > 400) {
      S.undo.shift();
    }
  }

  function doSlip(r, c) {
    const cell = S.cells[idx(r, c)];
    cell.slip = true;
    cell.set = false;
    cell.mark = false;
    S.seals--;
    S.flashT = 1;
    snd.crack();
    updateHUD(true);
    if (S.seals <= 0) {
      S.screen = "failed";
      snd.sad();
      showOverlay({
        title: "The inspector walks out",
        body:
          "Four chips in the wrong places and the consular wax is spent. " +
          "The floor is re-bedded and your commission stands — begin it again.",
        note: "\u201CRead the counts twice. Cut once.\u201D",
        btn: "Re-lay this floor",
        action: function () {
          loadLevel(S.li);
        },
      });
      say("Commission failed. The floor will be reset.");
    } else {
      say(
        "A seal cracks. " + S.seals + " remain on floor " + S.lvl.numeral + ".",
      );
    }
  }

  function trySet(r, c) {
    const i = idx(r, c);
    const cell = S.cells[i];
    if (cell.slip || cell.set) {
      return true;
    }
    if (S.sol[i] === "") {
      doSlip(r, c);
      return false; // abort any stroke in progress
    }
    pushUndo(i, cell);
    cell.set = true;
    cell.mark = false;
    snd.thock();
    refreshDoneLines();
    checkWin();
    return true;
  }

  function tryToggleMark(r, c) {
    const i = idx(r, c);
    const cell = S.cells[i];
    if (cell.slip || cell.set) {
      return;
    }
    pushUndo(i, cell);
    cell.mark = !cell.mark;
    snd.tick();
  }

  function clearMark(r, c) {
    const i = idx(r, c);
    const cell = S.cells[i];
    if (cell.mark && !cell.set && !cell.slip) {
      pushUndo(i, cell);
      cell.mark = false;
      snd.tick();
    }
  }

  function undoMove() {
    if (!S.undo.length || S.screen !== "play") {
      return;
    }
    const mv = S.undo.pop();
    const cell = S.cells[mv.i];
    cell.set = mv.prevSet;
    cell.mark = mv.prevMark;
    snd.blip();
    refreshDoneLines();
    updateHUD();
  }

  function useHint() {
    if (S.screen !== "play" || S.paused || S.seals <= 0) {
      return;
    }
    const open = [];
    for (let i = 0; i < S.sol.length; i++) {
      if (S.sol[i] !== "" && !S.cells[i].set && !S.cells[i].slip) {
        open.push(i);
      }
    }
    if (!open.length) {
      return;
    }
    const pick = open[Math.floor(Math.random() * open.length)];
    const cell = S.cells[pick];
    cell.set = true;
    cell.mark = false;
    S.seals--;
    S.flashT = 0.6;
    snd.crack();
    refreshDoneLines();
    updateHUD(true);
    say("The patron points out one true tessera. A seal cracks.");
    if (S.seals <= 0) {
      S.screen = "failed";
      snd.sad();
      showOverlay({
        title: "The inspector walks out",
        body:
          "That last favour spent your final seal. The floor is re-bedded — " +
          "begin the commission again.",
        note: "\u201CHints are wax too.\u201D",
        btn: "Re-lay this floor",
        action: function () {
          loadLevel(S.li);
        },
      });
      return;
    }
    checkWin();
  }

  function checkWin() {
    for (let i = 0; i < S.sol.length; i++) {
      if (S.sol[i] !== "" && !S.cells[i].set) {
        updateHUD();
        return;
      }
    }
    startReveal();
  }

  function startReveal() {
    S.screen = "reveal";
    S.revealStart = performance.now();
    S.revealShown = false;
    S.runMs += S.elapsed;
    S.floorsDone++;
    const earned = Math.max(0, S.seals);
    S.sealsTotal += earned;
    snd.chime();
    S.lastEarned = earned;
    say("Floor complete. " + earned + " of three seals survive.");
  }

  function finishReveal() {
    S.screen = "floorDone";
    const earned = S.lastEarned;
    const last = S.li >= LEVELS.length - 1;
    const praise =
      earned === 3
        ? "Not one slip of the chisel. The inspector presses his seal without a word."
        : earned === 2
          ? "One seal cracked. He signs anyway, shaking his head."
          : earned === 1
            ? "Two cracks in the wax. It holds — barely."
            : "The wax is spent, but the floor is yours.";
    showOverlay({
      title:
        "Floor " + S.lvl.numeral + " \u2014 " + S.lvl.name + " \u2014 laid",
      body: praise,
      note: last
        ? "That was the final floor. The doors open at dawn."
        : "Seals kept so far: " +
          S.sealsTotal +
          ". Next: floor " +
          LEVELS[S.li + 1].numeral +
          ", " +
          LEVELS[S.li + 1].name +
          " (" +
          LEVELS[S.li + 1].art[0].length +
          " \u00D7 " +
          LEVELS[S.li + 1].art.length +
          ").",
      btn: last ? "Open the museum" : "Next floor",
      action: function () {
        if (last) {
          winRun();
        } else {
          loadLevel(S.li + 1);
        }
      },
    });
  }

  function winRun() {
    S.screen = "won";
    snd.fanfare();
    const mins = fmtTime(S.runMs);
    showOverlay({
      title: "The museum opens",
      body:
        "Five floors of the Villa of the Gilded Cupid, set true under the " +
        "lamp: " +
        S.sealsTotal +
        " of 15 seals survive, in " +
        mins +
        " of bench time. The morning crowd files past the owl and gasps.",
      note: "\u201COpus Tessellatum \u2014 the counts never lie.\u201D",
      btn: "Begin a new commission",
      action: function () {
        S.sealsTotal = 0;
        S.floorsDone = 0;
        S.runMs = 0;
        loadLevel(0);
      },
    });
    say("All five floors laid. The museum opens.");
  }

  function restartFloor() {
    if (S.screen === "intro" || S.screen === "won") {
      return;
    }
    snd.blip();
    loadLevel(S.li);
  }

  /* ------------------------------------------------------------------ */
  /*  Overlay + HUD                                                      */
  /* ------------------------------------------------------------------ */
  function showOverlay(cfg) {
    $("ov-title").textContent = cfg.title;
    $("ov-body").textContent = cfg.body;
    const list = $("ov-list");
    if (cfg.list) {
      list.innerHTML = cfg.list;
      list.style.display = "";
    } else {
      list.innerHTML = "";
      list.style.display = "none";
    }
    $("ov-note").textContent = cfg.note || "";
    const btn = $("ov-btn");
    btn.textContent = cfg.btn;
    btn.onclick = function () {
      snd.blip();
      btn.blur();
      cfg.action();
    };
    $("overlay").classList.remove("hidden");
    btn.focus();
  }

  function hideOverlay() {
    $("overlay").classList.add("hidden");
  }

  function showIntro() {
    S.screen = "intro";
    showOverlay({
      title: "Opus Tessellatum",
      body:
        "The dig at the Villa of the Gilded Cupid came up with five buried " +
        "floors. Rebuild them tonight: the tally marks along each row and " +
        "column swear to the pattern beneath the plaster.",
      list:
        "<li>The counts give the <strong>runs of tesserae</strong> in that " +
        "line, in order, with at least one bare square between runs.</li>" +
        "<li><strong>Set</strong> the squares you are sure of; " +
        "<strong>void</strong>-mark the ones a line can never touch.</li>" +
        "<li>Lay every tessera to finish the floor. One chip in the wrong " +
        "place <strong>cracks a wax seal</strong> &mdash; three cracks and " +
        "the inspector walks.</li>" +
        "<li>Mouse: click sets, right-click voids, drag paints. Touch: the " +
        "SET / VOID pads. Keys: arrows move, <strong>Space</strong> applies, " +
        "<strong>X</strong> voids, <strong>Z</strong> undo, <strong>H</strong> " +
        "hint, <strong>P</strong> pause, <strong>M</strong> sound, " +
        "<strong>R</strong> restart floor.</li>",
      note: "Keep three seals on a floor for full honours. Fifteen await.",
      btn: "Take up the chisel",
      action: function () {
        S.sealsTotal = 0;
        S.floorsDone = 0;
        S.runMs = 0;
        loadLevel(0);
      },
    });
  }

  function updateHUD(sealAnim) {
    const lv = S.lvl || LEVELS[0];
    $("commission").textContent = "Floor " + lv.numeral + " \u2014 " + lv.name;
    $("gridsize").textContent = lv.art[0].length + " \u00D7 " + lv.art.length;
    $("clock").textContent = fmtTime(S.elapsed);
    const pips = $("seals").children;
    for (let i = 0; i < 3; i++) {
      const broken = i >= S.seals;
      if (broken && !pips[i].classList.contains("cracked")) {
        pips[i].classList.add("cracked");
        if (sealAnim) {
          pips[i].classList.remove("justcracked");
          void pips[i].offsetWidth;
          pips[i].classList.add("justcracked");
        }
      } else if (!broken) {
        pips[i].classList.remove("cracked", "justcracked");
      }
    }
    $("undo").disabled = !(S.screen === "play" && S.undo.length);
    $("hint").disabled = !(S.screen === "play" && S.seals > 0 && !S.paused);
    $("pausebtn").disabled = S.screen !== "play";
    $("restartbtn").disabled =
      S.screen === "intro" || S.screen === "won" || S.screen === "failed";
    $("mode-set").classList.toggle("on", S.mode === "set");
    $("mode-void").classList.toggle("on", S.mode === "void");
    $("mode-set").setAttribute("aria-pressed", String(S.mode === "set"));
    $("mode-void").setAttribute("aria-pressed", String(S.mode === "void"));
  }

  /* ------------------------------------------------------------------ */
  /*  Rendering                                                          */
  /* ------------------------------------------------------------------ */
  function cellAt(px, py) {
    if (!S.layout) {
      return null;
    }
    const L = S.layout;
    const c = Math.floor((px - L.ox) / L.cell);
    const r = Math.floor((py - L.oy) / L.cell);
    if (r < 0 || c < 0 || r >= S.rows || c >= S.cols) {
      return null;
    }
    return { r, c };
  }

  function easeOutBack(p) {
    const s = 1.70158;
    const q = p - 1;
    return q * q * ((s + 1) * q + s) + 1;
  }

  function drawStone(x, y, size, base) {
    ctx.fillStyle = base;
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    ctx.fillStyle = "rgba(255,240,205,0.22)";
    ctx.fillRect(x + 1, y + 1, size - 2, 2);
    ctx.fillRect(x + 1, y + 1, 2, size - 2);
    ctx.fillStyle = "rgba(20,8,0,0.28)";
    ctx.fillRect(x + 1, y + size - 3, size - 2, 2);
    ctx.fillRect(x + size - 3, y + 1, 2, size - 2);
  }

  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    if (!S.layout) {
      return;
    }
    const L = S.layout;
    const cs = L.cell;

    // engraved caption
    ctx.font = "italic 15px Georgia, serif";
    ctx.fillStyle = "rgba(200,175,125,0.35)";
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(
      "Floor " + S.lvl.numeral + " \u00B7 " + S.cols + " \u00D7 " + S.rows,
      W - L.pad,
      H - 12,
    );

    // screed slab behind the grid
    ctx.fillStyle = "#382816";
    roundRect(L.ox - 7, L.oy - 7, L.gw + 14, L.gh + 14, 8);
    ctx.fill();

    // clue backdrops
    ctx.fillStyle = "rgba(56,40,22,0.55)";
    roundRect(L.pad, L.oy - 7, L.gutW + 14, L.gh + 14, 8);
    ctx.fill();
    roundRect(L.ox - 7, L.pad, L.gw + 14, L.gutH + 14, 8);
    ctx.fill();

    const revealing = S.screen === "reveal" || S.screen === "floorDone";
    const revealT = revealing ? (now - S.revealStart) / 1000 : 0;

    for (let r = 0; r < S.rows; r++) {
      for (let c = 0; c < S.cols; c++) {
        const i = idx(r, c);
        const cell = S.cells[i];
        const x = L.ox + c * cs;
        const y = L.oy + r * cs;

        if (cell.slip) {
          ctx.fillStyle = "#191009";
          ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
          ctx.strokeStyle = "#6e5a3a";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + 5, y + 5);
          ctx.lineTo(x + cs - 5, y + cs - 5);
          ctx.moveTo(x + cs - 5, y + 5);
          ctx.lineTo(x + 5, y + cs - 5);
          ctx.stroke();
          continue;
        }

        if (cell.set) {
          let base = "#bfa06a";
          const j = hash2(r + 1, c + 1) * 14 - 7;
          base = shade(base, j);
          let popScale = 1;
          let colorKey = S.sol[i];
          if (revealing && colorKey) {
            const p = Math.min(1, Math.max(0, (revealT - r * 0.09) / 0.3));
            if (p > 0) {
              popScale = 0.6 + 0.4 * easeOutBack(p);
              const pair = S.lvl.pal[colorKey];
              base = pair[Math.floor(hash2(r * 3, c * 5) * pair.length)];
              if (Math.random() < p * 0.02 && S.sparks.length < 90) {
                S.sparks.push({
                  x: x + cs / 2,
                  y: y + cs / 2,
                  vx: (Math.random() - 0.5) * 30,
                  vy: -20 - Math.random() * 30,
                  life: 1,
                });
              }
            }
          }
          const inset = (cs * (1 - popScale)) / 2;
          drawStone(x + inset, y + inset, cs * popScale, base);
        } else {
          ctx.fillStyle = "#46331d";
          ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
          // plaster speckle
          ctx.fillStyle = "rgba(90,68,36,0.7)";
          for (let k = 0; k < 3; k++) {
            const sx = x + 3 + hash2(r * 7 + k, c * 13 + k) * (cs - 7);
            const sy = y + 3 + hash2(c * 11 + k, r * 5 + k) * (cs - 7);
            ctx.fillRect(sx, sy, 2, 2);
          }
          if (cell.mark) {
            ctx.strokeStyle = "#cdb384";
            ctx.lineWidth = Math.max(2, cs * 0.07);
            const m = cs * 0.28;
            ctx.beginPath();
            ctx.moveTo(x + m, y + m);
            ctx.lineTo(x + cs - m, y + cs - m);
            ctx.moveTo(x + cs - m, y + m);
            ctx.lineTo(x + m, y + cs - m);
            ctx.stroke();
          }
        }
      }
    }

    // grid lines
    ctx.strokeStyle = "rgba(18,9,3,0.55)";
    ctx.lineWidth = 1;
    for (let c = 0; c <= S.cols; c++) {
      const gx = Math.round(L.ox + c * cs) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, L.oy);
      ctx.lineTo(gx, L.oy + L.gh);
      ctx.stroke();
    }
    for (let r = 0; r <= S.rows; r++) {
      const gy = Math.round(L.oy + r * cs) + 0.5;
      ctx.beginPath();
      ctx.moveTo(L.ox, gy);
      ctx.lineTo(L.ox + L.gw, gy);
      ctx.stroke();
    }
    ctx.strokeStyle = "#6b5231";
    ctx.lineWidth = 2;
    ctx.strokeRect(L.ox, L.oy, L.gw, L.gh);

    // hover highlight
    if (
      S.screen === "play" &&
      !S.paused &&
      S.hoverR >= 0 &&
      !S.cells[idx(S.hoverR, S.hoverC)].slip
    ) {
      ctx.fillStyle = "rgba(255,235,190,0.09)";
      ctx.fillRect(L.ox + S.hoverC * cs, L.oy + S.hoverR * cs, cs, cs);
    }

    // keyboard cursor + crosshair
    if (S.screen === "play") {
      const cx = L.ox + S.cc * cs;
      const cy = L.oy + S.cr * cs;
      ctx.fillStyle = "rgba(232,176,75,0.10)";
      ctx.fillRect(L.ox, cy, L.gw, cs);
      ctx.fillRect(cx, L.oy, cs, L.gh);
      ctx.strokeStyle = "#e8b04b";
      ctx.lineWidth = 2;
      ctx.strokeRect(cx + 1, cy + 1, cs - 2, cs - 2);
    }

    // clues
    ctx.font = "600 15px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let c = 0; c < S.cols; c++) {
      const cl = S.colClue[c];
      const sat = S.colDone[c] && !revealing;
      ctx.fillStyle = sat ? "rgba(160,135,85,0.45)" : "#ecd9ab";
      for (let k = 0; k < cl.length; k++) {
        const y = L.oy - 12 - (cl.length - 1 - k) * L.CV;
        ctx.fillText(String(cl[k]), L.ox + c * cs + cs / 2, y);
      }
    }
    for (let r = 0; r < S.rows; r++) {
      const cl = S.rowClue[r];
      const sat = S.rowDone[r] && !revealing;
      ctx.fillStyle = sat ? "rgba(160,135,85,0.45)" : "#ecd9ab";
      for (let k = 0; k < cl.length; k++) {
        const x = L.ox - 14 - (cl.length - 1 - k) * L.CU;
        ctx.fillText(String(cl[k]), x, L.oy + r * cs + cs / 2);
      }
    }

    // sparks
    for (let i = S.sparks.length - 1; i >= 0; i--) {
      const sp = S.sparks[i];
      sp.x += sp.vx * 0.016;
      sp.y += sp.vy * 0.016;
      sp.life -= 0.02;
      if (sp.life <= 0) {
        S.sparks.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, sp.life);
      ctx.fillStyle = "#ffd97a";
      ctx.fillRect(sp.x, sp.y, 3, 3);
      ctx.globalAlpha = 1;
    }

    // slip flash vignette
    if (S.flashT > 0) {
      ctx.fillStyle = "rgba(150,30,20," + (S.flashT * 0.28).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    if (revealing) {
      const done = revealT > S.rows * 0.09 + 0.75;
      if (done && !S.revealShown) {
        S.revealShown = true;
        setTimeout(finishReveal, 350);
      }
    }
  }

  function roundRect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let rr = (n >> 16) + amt;
    let gg = ((n >> 8) & 255) + amt;
    let bb = (n & 255) + amt;
    rr = Math.max(0, Math.min(255, rr));
    gg = Math.max(0, Math.min(255, gg));
    bb = Math.max(0, Math.min(255, bb));
    return (
      "#" + ((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1)
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Input                                                              */
  /* ------------------------------------------------------------------ */
  function localPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / rect.height),
    };
  }

  function strokeApply(r, c) {
    const op = S.drag && S.drag.op;
    if (!op || S.drag.visited.has(idx(r, c))) {
      return;
    }
    S.drag.visited.add(idx(r, c));
    if (op === "set") {
      if (!trySet(r, c)) {
        S.drag.op = null; // a slip aborts the stroke
      }
    } else if (op === "mark") {
      const cell = S.cells[idx(r, c)];
      if (!cell.set && !cell.slip && !cell.mark) {
        pushUndo(idx(r, c), cell);
        cell.mark = true;
        snd.tick();
      }
    }
  }

  canvas.addEventListener("pointerdown", function (e) {
    audio();
    if (S.screen !== "play" || S.paused) {
      return;
    }
    e.preventDefault();
    const pos = localPos(e);
    const hit = cellAt(pos.x, pos.y);
    if (!hit) {
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    S.pointerDown = true;
    S.cr = hit.r;
    S.cc = hit.c;
    const cell = S.cells[idx(hit.r, hit.c)];
    if (e.button === 2) {
      tryToggleMark(hit.r, hit.c);
      S.drag = { op: null, visited: new Set([idx(hit.r, hit.c)]) };
      return;
    }
    let op = null;
    if (S.mode === "set") {
      if (!cell.set && !cell.slip) {
        op = "set";
      }
    } else if (!cell.set && !cell.slip && !cell.mark) {
      // void mode paints fresh marks; an existing mark is removed below
      op = "mark";
    }
    S.drag = { op, visited: new Set([idx(hit.r, hit.c)]) };
    if (op === "set") {
      if (!trySet(hit.r, hit.c)) {
        S.drag.op = null;
      }
    } else if (op === "mark") {
      pushUndo(idx(hit.r, hit.c), cell);
      cell.mark = true;
      snd.tick();
    } else if (S.mode === "void" && cell.mark && !cell.set && !cell.slip) {
      // clicking an existing void mark removes it
      pushUndo(idx(hit.r, hit.c), cell);
      cell.mark = false;
      snd.tick();
    }

    updateHUD();
  });

  canvas.addEventListener("pointermove", function (e) {
    const pos = localPos(e);
    const hit = cellAt(pos.x, pos.y);
    S.hoverR = hit ? hit.r : -1;
    S.hoverC = hit ? hit.c : -1;
    if (S.pointerDown && S.drag && S.drag.op && hit) {
      strokeApply(hit.r, hit.c);
    }
  });

  function endStroke() {
    S.pointerDown = false;
    S.drag = null;
    updateHUD();
  }

  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  canvas.addEventListener("pointerleave", function () {
    S.hoverR = -1;
    S.hoverC = -1;
  });
  canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  window.addEventListener("keydown", function (e) {
    const key = e.key;
    if (S.screen === "play" && !S.paused) {
      const move = {
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        a: [0, -1],
        d: [0, 1],
        w: [-1, 0],
        s: [1, 0],
        A: [0, -1],
        D: [0, 1],
        W: [-1, 0],
        S: [1, 0],
      }[key];
      if (move) {
        S.cr = Math.max(0, Math.min(S.rows - 1, S.cr + move[0]));
        S.cc = Math.max(0, Math.min(S.cols - 1, S.cc + move[1]));
        e.preventDefault();
        return;
      }
      if (key === " " || key === "Enter") {
        e.preventDefault();
        trySet(S.cr, S.cc);
        updateHUD();
        return;
      }
      if (key === "x" || key === "X") {
        e.preventDefault();
        const cell = S.cells[idx(S.cr, S.cc)];
        if (!cell.set && !cell.slip) {
          tryToggleMark(S.cr, S.cc);
          updateHUD();
        }
        return;
      }
      if (key === "c" || key === "C") {
        clearMark(S.cr, S.cc);
        updateHUD();
        return;
      }
      if (key === "z" || key === "Z") {
        undoMove();
        return;
      }
      if (key === "h" || key === "H") {
        useHint();
        return;
      }
      if (key === "r" || key === "R") {
        restartFloor();
        return;
      }
      if (key === "m" || key === "M") {
        toggleSound();
        return;
      }
    }
    if (key === "p" || key === "P") {
      if (S.screen === "play") {
        e.preventDefault();
        togglePause();
      }
      return;
    }
    if (key === "m" || key === "M") {
      toggleSound();
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Buttons                                                            */
  /* ------------------------------------------------------------------ */
  function setMode(m) {
    S.mode = m;
    snd.blip();
    updateHUD();
  }

  $("mode-set").addEventListener("click", function () {
    this.blur();
    setMode("set");
  });
  $("mode-void").addEventListener("click", function () {
    this.blur();
    setMode("void");
  });
  $("undo").addEventListener("click", function () {
    this.blur();
    undoMove();
    updateHUD();
  });
  $("hint").addEventListener("click", function () {
    this.blur();
    useHint();
    updateHUD();
  });
  $("pausebtn").addEventListener("click", function () {
    this.blur();
    togglePause();
  });
  $("soundbtn").addEventListener("click", function () {
    this.blur();
    toggleSound();
  });
  $("restartbtn").addEventListener("click", function () {
    this.blur();
    restartFloor();
  });

  function togglePause() {
    if (S.screen !== "play") {
      return;
    }
    if (!S.paused) {
      S.paused = true;
      snd.blip();
      showOverlay({
        title: "Paused",
        body: "The lamp is trimmed low and the bench falls quiet.",
        note: "P or the button resumes.",
        btn: "Resume",
        action: function () {
          S.paused = false;
          updateHUD();
        },
      });
      $("pausebtn").textContent = "Resume";
    } else {
      S.paused = false;
      hideOverlay();
      snd.blip();
      $("pausebtn").textContent = "Pause";
    }
    updateHUD();
  }

  function toggleSound() {
    muted = !muted;
    if (master) {
      master.gain.value = muted ? 0 : 0.5;
    }
    const b = $("soundbtn");
    b.textContent = muted ? "Sound off" : "Sound on";
    b.setAttribute("aria-pressed", String(!muted));
    if (!muted) {
      snd.blip();
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && S.screen === "play" && !S.paused) {
      togglePause();
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Main loop                                                          */
  /* ------------------------------------------------------------------ */
  function loop(now) {
    const dt = Math.min(0.1, (now - (S.lastTick || now)) / 1000);
    S.lastTick = now;
    if (S.screen === "play" && !S.paused && !document.hidden) {
      S.elapsed += dt * 1000;
      $("clock").textContent = fmtTime(S.elapsed);
    }
    if (S.flashT > 0) {
      S.flashT = Math.max(0, S.flashT - dt * 2.4);
    }
    if (S.screen !== "intro") {
      draw(now);
    } else {
      ctx.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------------ */
  /*  Boot                                                               */
  /* ------------------------------------------------------------------ */
  S.lvl = LEVELS[0];
  S.rows = S.lvl.art.length;
  S.cols = S.lvl.art[0].length;
  showIntro();
  updateHUD();
  requestAnimationFrame(loop);
})();
