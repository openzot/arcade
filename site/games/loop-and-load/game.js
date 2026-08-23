/* Loop & Load — night shift at a depot where the robot only obeys loops.
   Program a sequence; it repeats forever. Ship the parcel, charge the bot. */
(function () {
  "use strict";

  /* ---------- level data ---------- */
  /* legend: # shelf  . floor  S bot start (faces east)
             P parcel  C chute  D charge pad  ~ oil slick            */
  var LEVELS = [
    {
      name: "First Round",
      hint: "East to the parcel, post it, then climb to the pad.",
      slots: 10,
      map: [
        "............",
        "............",
        "......D.....",
        "..##........",
        ".S.P..C.....",
        "..##........",

        "............",
        "............",
        "............",
      ],
    },
    {
      name: "Round the Stack",
      hint: "A shelf blocks the straight road. Jog south around it.",
      slots: 12,
      map: [
        "............",
        "....D.......",
        "....C.......",
        "..##........",
        ".S.#........",
        "....P.......",
        "............",
        "............",
        "............",
      ],
    },
    {
      name: "Mind the Sweeper",
      hint: "The sweeper owns row four. Get off it, let it pass, then go.",
      slots: 13,
      map: [
        "............",
        "............",
        "....DC......",
        "....P.......",

        ".S..........",
        "............",
        "............",
        "............",
        "............",
      ],
      sweeper: { x: 6, y: 4, dx: -1, dy: 0 },
    },
    {
      name: "The Crane Aisle",
      hint: "Grab and post inside the haunted column — time your entry.",
      slots: 16,
      map: [
        "............",
        "............",
        "....D..C....",
        "............",
        ".S.....P....",
        "............",
        "............",
        "............",
        "............",
      ],
      sweeper: { x: 7, y: 6, dx: 0, dy: -1 },
    },
    {
      name: "Skate the Spill",
      hint: "Oil carries you to the far side. It works both ways.",
      slots: 14,
      map: [
        "............",
        "........##..",
        "..D.......C.",
        "............",
        ".S..........",
        "...~~~~~.P..",
        "............",
        "..##........",
        "............",
      ],
    },
    {
      name: "Night Shift Finale",
      hint: "Ride the spill east, then thread the column northbound.",
      slots: 16,
      map: [
        "............",
        "...##.......",
        "..........#.",
        "..........#.",
        "............",
        "..D.....C...",
        "............",
        ".S.~~~P.....",
        "............",
      ],
      sweeper: { x: 8, y: 8, dx: 0, dy: -1 },
    },
  ];

  /* ---------- constants ---------- */
  var COLS = 12,
    ROWS = 9,
    TILE = 48;
  var TICK = 260; // ms per executed command
  var STALL_TICKS = 80; // fail if the loop hasn't finished by then
  var DIRS = [
    [1, 0],
    [0, -1],
    [-1, 0],
    [0, 1],
  ]; // E N W S (CCW order)
  var GLYPH = {
    F: "\u2191",
    L: "\u21B0",
    R: "\u21B1",
    W: "\u23F1",
    G: "\u{1F4E6}",
  };
  var CMD_NAME = {
    F: "Forward",
    L: "Left",
    R: "Right",
    W: "Wait",
    G: "Grab/Drop",
  };

  /* ---------- dom ---------- */
  function $(id) {
    return document.getElementById(id);
  }
  var cv = $("game"),
    ctx = cv.getContext("2d");
  var elLevel = $("levelName"),
    elObj = $("objective");
  var elStage = $("stage");
  var elOverlay = $("overlay"),
    elOvTitle = $("ovTitle"),
    elOvText = $("ovText"),
    elOvButtons = $("ovButtons");
  var elTray = $("tray");
  var btnRun = $("btnRun"),
    btnUndo = $("btnUndo"),
    btnClear = $("btnClear");
  var btnRestart = $("btnRestart"),
    btnMute = $("btnMute");

  /* ---------- audio ---------- */
  var AC = null,
    muted = false;
  function ensureAudio() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        AC = null;
      }
    }
    if (AC && AC.state === "suspended") {
      AC.resume();
    }
  }
  function tone(freq, dur, type, vol, delay) {
    if (muted || !AC) {
      return;
    }
    var t = AC.currentTime + (delay || 0);
    var o = AC.createOscillator(),
      g = AC.createGain();
    o.type = type || "square";
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(AC.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
  var sfx = {
    click: function () {
      tone(520, 0.06, "square", 0.045);
    },
    turn: function () {
      tone(330, 0.05, "square", 0.04);
    },
    grab: function () {
      tone(392, 0.09, "triangle", 0.09);
      tone(587, 0.12, "triangle", 0.07, 0.07);
    },
    drop: function () {
      tone(262, 0.08, "triangle", 0.07);
    },
    deliver: function () {
      tone(523, 0.18, "triangle", 0.09);
      tone(659, 0.18, "triangle", 0.09, 0.09);
      tone(784, 0.22, "triangle", 0.09, 0.18);
    },
    crash: function () {
      tone(190, 0.25, "sawtooth", 0.11);
      tone(85, 0.35, "sawtooth", 0.1, 0.06);
    },
    win: function () {
      tone(523, 0.14, "square", 0.06);
      tone(659, 0.14, "square", 0.06, 0.1);
      tone(784, 0.14, "square", 0.06, 0.2);
      tone(1046, 0.24, "square", 0.07, 0.3);
    },
    err: function () {
      tone(140, 0.14, "square", 0.07);
    },
  };

  /* ---------- game state ---------- */
  var G = {
    lvl: 0,
    program: [],
    status: "intro", // intro | edit | run | paused | lost | wonlvl | done
    grid: null,
    bot: null,
    parcelAt: null,
    sweepers: [],
    delivered: false,
    steps: 0,
    acc: 0,
    lastTs: 0,
    crashes: 0,
    stalls: 0,
    ovPrimary: null,
  };

  function parseMap(lvlDef) {
    var g = {
      walls: {},
      oil: {},
      start: null,
      parcel: null,
      chute: null,
      dock: null,
    };
    lvlDef.map.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        var c = row.charAt(x);
        if (c === "#") {
          g.walls[x + "," + y] = true;
        } else if (c === "~") {
          g.oil[x + "," + y] = true;
        } else if (c === "S") {
          g.start = { x: x, y: y };
        } else if (c === "P") {
          g.parcel = { x: x, y: y };
        } else if (c === "C") {
          g.chute = { x: x, y: y };
        } else if (c === "D") {
          g.dock = { x: x, y: y };
        }
      }
    });
    return g;
  }

  function loadLevel(i, keepProgram) {
    var def = LEVELS[i];
    G.lvl = i;
    G.grid = parseMap(def);
    if (!keepProgram) {
      G.program = [];
    }
    if (G.program.length > def.slots) {
      G.program = G.program.slice(0, def.slots);
    }
    G.bot = {
      x: G.grid.start.x,
      y: G.grid.start.y,
      px: G.grid.start.x,
      py: G.grid.start.y,
      dir: 0,
      carrying: false,
    };
    G.parcelAt = G.grid.parcel
      ? { x: G.grid.parcel.x, y: G.grid.parcel.y }
      : null;
    G.sweepers = [];
    if (def.sweeper) {
      G.sweepers.push({
        x: def.sweeper.x,
        y: def.sweeper.y,
        px: def.sweeper.x,
        py: def.sweeper.y,
        dx: def.sweeper.dx,
        dy: def.sweeper.dy,
      });
    }
    G.delivered = false;
    G.steps = 0;
    G.acc = 0;
    G.status = "edit";
    hideOverlay();
    syncUI();
  }

  /* ---------- ui sync ---------- */
  function syncUI() {
    var def = LEVELS[G.lvl];
    elLevel.textContent =
      "Level " + (G.lvl + 1) + " / " + LEVELS.length + " \u00b7 " + def.name;
    elObj.textContent = def.hint;

    var editing = G.status === "edit";
    btnRun.textContent = G.status === "run" ? "\u25a0 Stop" : "\u25b6 Run loop";
    btnRun.classList.toggle("running", G.status === "run");
    btnRun.disabled = G.status === "paused";
    btnUndo.disabled = !editing || G.program.length === 0;
    btnClear.disabled = !editing || G.program.length === 0;
    Array.prototype.forEach.call(
      document.querySelectorAll("#palette button"),
      function (b) {
        b.disabled = !editing;
      },
    );

    var html = "";
    for (var s = 0; s < def.slots; s++) {
      var cls = "chip";
      if (s >= G.program.length) {
        cls += " empty";
        html += '<span class="' + cls + '" aria-hidden="true">\u00b7</span>';
        continue;
      }
      var cmd = G.program[s];
      if (
        G.status === "run" &&
        G.program.length > 0 &&
        s === G.steps % G.program.length
      ) {
        cls += " active";
      }
      html +=
        '<span class="' +
        cls +
        '" title="' +
        CMD_NAME[cmd] +
        '">' +
        GLYPH[cmd] +
        "</span>";
    }
    elTray.innerHTML = html;
  }

  function flashTray() {
    elTray.classList.remove("flash-full");
    void elTray.offsetWidth;
    elTray.classList.add("flash-full");
  }

  /* ---------- overlay ---------- */
  function showOverlay(title, textHtml, buttons) {
    elOvTitle.innerHTML = title;
    elOvText.innerHTML = textHtml;
    elOvButtons.innerHTML = "";
    G.ovPrimary = null;
    buttons.forEach(function (b) {
      var el = document.createElement("button");
      el.type = "button";
      el.textContent = b.label;
      if (b.primary) {
        el.className = "primary";
        G.ovPrimary = el;
      }
      el.addEventListener("click", function () {
        ensureAudio();
        b.fn();
      });
      elOvButtons.appendChild(el);
    });
    elOverlay.classList.remove("hidden");
  }
  function hideOverlay() {
    elOverlay.classList.add("hidden");
    G.ovPrimary = null;
  }

  /* ---------- commands ---------- */
  function keyOf(x, y) {
    return x + "," + y;
  }
  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS;
  }
  function isWall(x, y) {
    return G.grid.walls[keyOf(x, y)] === true;
  }
  function isOil(x, y) {
    return G.grid.oil[keyOf(x, y)] === true;
  }

  function crash(reason) {
    G.status = "lost";
    G.crashes++;
    sfx.crash();
    elStage.classList.remove("shake");
    void elStage.offsetWidth;
    elStage.classList.add("shake");
    showOverlay(
      "Shift ended",
      reason +
        '<br><span class="fine">Edit your loop and try the shift again.</span>',
      [
        {
          label: "\u21bb Retry level",
          primary: true,
          fn: function () {
            loadLevel(G.lvl, true);
          },
        },
      ],
    );
    syncUI();
  }

  function moveForward() {
    var d = DIRS[G.bot.dir];
    var sx = G.bot.x,
      sy = G.bot.y;
    var x = sx + d[0],
      y = sy + d[1];
    if (!inBounds(x, y)) {
      crash("You rolled off the floor edge.");
      return;
    }
    if (isWall(x, y)) {
      crash("You bumped into the shelving.");
      return;
    }
    var path = [{ x: x, y: y }];
    while (isOil(x, y)) {
      var nx = x + d[0],
        ny = y + d[1];
      if (!inBounds(nx, ny) || isWall(nx, ny)) {
        crash("Slammed into shelving while sliding on the oil.");
        return;
      }
      x = nx;
      y = ny;
      path.push({ x: x, y: y });
    }
    G.bot.px = sx;
    G.bot.py = sy;
    G.bot.x = x;
    G.bot.y = y;
    G.slidePath = path.slice(0, -1); // intermediate cells for collision checks
  }

  function updateSweepers() {
    G.sweepers.forEach(function (sw) {
      sw.px = sw.x;
      sw.py = sw.y;
      var nx = sw.x + sw.dx,
        ny = sw.y + sw.dy;
      if (!inBounds(nx, ny) || isWall(nx, ny)) {
        sw.dx = -sw.dx;
        sw.dy = -sw.dy; // bump: reverse, stay put this tick
      } else {
        sw.x = nx;
        sw.y = ny;
      }
    });
  }

  function checkCollisions() {
    var botCells = [{ x: G.bot.x, y: G.bot.y }].concat(G.slidePath || []);
    var botPrev = { x: G.bot.px, y: G.bot.py };
    for (var i = 0; i < G.sweepers.length; i++) {
      var sw = G.sweepers[i];
      // overlap with where the sweeper now stands
      for (var a = 0; a < botCells.length; a++) {
        if (botCells[a].x === sw.x && botCells[a].y === sw.y) {
          crash("Clipped by a patrol sweeper.");
          return true;
        }
      }
      // swapped places through each other this tick
      if (
        G.bot.x === sw.px &&
        G.bot.y === sw.py &&
        sw.x === botPrev.x &&
        sw.y === botPrev.y &&
        !(sw.x === sw.px && sw.y === sw.py)
      ) {
        crash("Clipped by a patrol sweeper.");
        return true;
      }
    }
    return false;
  }

  function grabDrop() {
    var at = keyOf(G.bot.x, G.bot.y);
    if (
      !G.bot.carrying &&
      G.parcelAt &&
      G.parcelAt.x === G.bot.x &&
      G.parcelAt.y === G.bot.y
    ) {
      G.bot.carrying = true;
      G.parcelAt = null;
      sfx.grab();
    } else if (
      G.bot.carrying &&
      G.grid.chute.x === G.bot.x &&
      G.grid.chute.y === G.bot.y
    ) {
      G.bot.carrying = false;
      G.delivered = true;
      sfx.deliver();
    } else if (G.bot.carrying) {
      G.bot.carrying = false;
      G.parcelAt = { x: G.bot.x, y: G.bot.y };
      sfx.drop();
    } else {
      sfx.err(); // nothing to grab here
    }
    void at;
  }

  function doTick() {
    if (G.status !== "run") {
      return;
    }
    var len = G.program.length;
    var cmd = G.program[G.steps % len];
    G.slidePath = [];
    if (cmd === "F") {
      moveForward();
    } else if (cmd === "L") {
      G.bot.dir = (G.bot.dir + 1) % 4;
      sfx.turn();
    } else if (cmd === "R") {
      G.bot.dir = (G.bot.dir + 3) % 4;
      sfx.turn();
    } else if (cmd === "W") {
      /* idle */
    } else if (cmd === "G") {
      grabDrop();
    }
    if (G.status !== "run") {
      return;
    } // crashed mid-command

    // sweepers patrol at half the bot's tempo: they step on odd ticks only,
    // but collisions are checked every tick
    if (G.steps % 2 === 0) {
      updateSweepers();
    }
    if (checkCollisions()) {
      return;
    }

    G.steps++;
    if (G.delivered && G.bot.x === G.grid.dock.x && G.bot.y === G.grid.dock.y) {
      levelWon();
      return;
    }
    if (G.steps >= STALL_TICKS) {
      G.stalls++;
      G.status = "lost";
      sfx.crash();
      showOverlay(
        "Shift stalled",
        'Eighty ticks and the parcel still isn\u2019t home.<br><span class="fine">Shorten the loop or reroute it.</span>',
        [
          {
            label: "\u21bb Retry level",
            primary: true,
            fn: function () {
              loadLevel(G.lvl, true);
            },
          },
        ],
      );
      syncUI();
      return;
    }
    syncUI();
  }

  function levelWon() {
    G.status = "wonlvl";
    sfx.win();
    var loops = Math.ceil(G.steps / Math.max(1, G.program.length));
    var last = G.lvl === LEVELS.length - 1;
    if (last) {
      G.status = "done";
      showOverlay(
        "All parcels shipped!",
        "Six rounds, one loop at a time.<br>" +
          '<span class="fine">Shift report: ' +
          G.crashes +
          " crash" +
          (G.crashes === 1 ? "" : "es") +
          " \u00b7 " +
          G.stalls +
          " stall" +
          (G.stalls === 1 ? "" : "s") +
          ". The dawn crew takes it from here.</span>",
        [
          {
            label: "\u25b6 Play again",
            primary: true,
            fn: function () {
              G.crashes = 0;
              G.stalls = 0;
              loadLevel(0, false);
            },
          },
        ],
      );
    } else {
      showOverlay(
        "Parcel shipped!",
        "Delivered in " +
          loops +
          " loop" +
          (loops === 1 ? "" : "s") +
          " \u2014 the pad is humming.",
        [
          {
            label: "Next level \u2192",
            primary: true,
            fn: function () {
              loadLevel(G.lvl + 1, true);
            },
          },
          {
            label: "Tinker again",
            fn: function () {
              loadLevel(G.lvl, true);
            },
          },
        ],
      );
    }
    syncUI();
  }

  /* ---------- controls ---------- */
  function appendCmd(c) {
    ensureAudio();
    if (G.status !== "edit") {
      return;
    }
    var max = LEVELS[G.lvl].slots;
    if (G.program.length >= max) {
      flashTray();
      sfx.err();
      return;
    }
    G.program.push(c);
    sfx.click();
    syncUI();
  }
  function eraseLast() {
    ensureAudio();
    if (G.status !== "edit" || G.program.length === 0) {
      return;
    }
    G.program.pop();
    sfx.click();
    syncUI();
  }
  function clearProgram() {
    ensureAudio();
    if (G.status !== "edit" || G.program.length === 0) {
      return;
    }
    G.program = [];
    sfx.click();
    syncUI();
  }
  function resetEntities() {
    var g = G.grid;
    G.bot = {
      x: g.start.x,
      y: g.start.y,
      px: g.start.x,
      py: g.start.y,
      dir: 0,
      carrying: false,
    };
    G.parcelAt = g.parcel ? { x: g.parcel.x, y: g.parcel.y } : null;
    var def = LEVELS[G.lvl];
    G.sweepers = [];
    if (def.sweeper) {
      G.sweepers.push({
        x: def.sweeper.x,
        y: def.sweeper.y,
        px: def.sweeper.x,
        py: def.sweeper.y,
        dx: def.sweeper.dx,
        dy: def.sweeper.dy,
      });
    }
    G.delivered = false;
    G.steps = 0;
    G.acc = 0;
  }
  function toggleRun() {
    ensureAudio();
    if (G.status === "edit") {
      if (G.program.length === 0) {
        flashTray();
        sfx.err();
        return;
      }
      G.status = "run";
      G.acc = 0;
    } else if (G.status === "run") {
      G.status = "edit";
      resetEntities();
      hideOverlay();
    } else if (G.status === "paused") {
      G.status = "run";
      hideOverlay();
    }
    sfx.click();
    syncUI();
  }
  function restartLevel() {
    ensureAudio();
    loadLevel(G.lvl, true);
    sfx.click();
  }
  function togglePause(auto) {
    if (G.status === "run") {
      G.status = "paused";
      showOverlay(
        "Paused",
        auto
          ? "The shift waits while you\u2019re away."
          : "Press P (or Run) to resume.",
        [
          {
            label: "\u25b6 Resume",
            primary: true,
            fn: function () {
              G.status = "run";
              hideOverlay();
              syncUI();
            },
          },
        ],
      );
      syncUI();
    } else if (G.status === "paused" && !auto) {
      G.status = "run";
      hideOverlay();
      syncUI();
    }
  }
  function toggleMute() {
    muted = !muted;
    btnMute.textContent = muted ? "\ud83d\udd07" : "\ud83d\udd0a";
    if (!muted) {
      ensureAudio();
      sfx.click();
    }
  }

  document.querySelectorAll("#palette button").forEach(function (b) {
    b.addEventListener("click", function () {
      appendCmd(b.getAttribute("data-cmd"));
    });
  });
  btnRun.addEventListener("click", toggleRun);
  btnUndo.addEventListener("click", eraseLast);
  btnClear.addEventListener("click", clearProgram);
  btnRestart.addEventListener("click", restartLevel);
  btnMute.addEventListener("click", function () {
    ensureAudio();
    toggleMute();
  });

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    var k = e.key;
    var overlayOpen = !elOverlay.classList.contains("hidden");
    if ((k === "Enter" || k === " ") && overlayOpen) {
      e.preventDefault();
      if (G.ovPrimary) {
        G.ovPrimary.click();
      }
      return;
    }
    switch (k) {
      case "f":
      case "F":
        appendCmd("F");
        e.preventDefault();
        break;
      case "l":
      case "L":
        appendCmd("L");
        e.preventDefault();
        break;
      case "r":
      case "R":
        appendCmd("R");
        e.preventDefault();
        break;
      case "w":
      case "W":
        appendCmd("W");
        e.preventDefault();
        break;
      case "g":
      case "G":
        appendCmd("G");
        e.preventDefault();
        break;
      case "Backspace":
        eraseLast();
        e.preventDefault();
        break;
      case "Enter":
      case " ":
        toggleRun();
        e.preventDefault();
        break;
      case "p":
      case "P":
        togglePause(false);
        break;
      case "m":
      case "M":
        ensureAudio();
        toggleMute();
        break;
      default:
        break;
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && G.status === "run") {
      togglePause(true);
    }
  });

  /* ---------- rendering ---------- */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawFloor(time) {
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#141c31" : "#111827";
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (var gx = 1; gx < COLS; gx++) {
      ctx.beginPath();
      ctx.moveTo(gx * TILE, 0);
      ctx.lineTo(gx * TILE, ROWS * TILE);
      ctx.stroke();
    }
    for (var gy = 1; gy < ROWS; gy++) {
      ctx.beginPath();
      ctx.moveTo(0, gy * TILE);
      ctx.lineTo(COLS * TILE, gy * TILE);
      ctx.stroke();
    }
    void time;
  }

  function drawOil(time) {
    Object.keys(G.grid.oil).forEach(function (k) {
      var p = k.split(",");
      var x = parseInt(p[0], 10) * TILE,
        y = parseInt(p[1], 10) * TILE;
      ctx.fillStyle = "#241a3f";
      roundRect(x + 3, y + 3, TILE - 6, TILE - 6, 12);
      ctx.fill();
      var shim = 0.5 + 0.5 * Math.sin(time / 600 + x * 1.7 + y);
      ctx.fillStyle = "rgba(150,110,220," + (0.1 + 0.1 * shim) + ")";
      ctx.beginPath();
      ctx.ellipse(
        x + TILE / 2,
        y + TILE / 2,
        TILE * 0.28,
        TILE * 0.16,
        shim * 0.6,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });
  }

  function drawShelves() {
    Object.keys(G.grid.walls).forEach(function (k) {
      var p = k.split(",");
      var x = parseInt(p[0], 10) * TILE,
        y = parseInt(p[1], 10) * TILE;
      ctx.fillStyle = "#332617";
      roundRect(x + 4, y + 4, TILE - 8, TILE - 8, 4);
      ctx.fill();
      ctx.strokeStyle = "#5b4426";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.moveTo(x + 6, y + TILE / 2);
      ctx.lineTo(x + TILE - 6, y + TILE / 2);
      ctx.moveTo(x + TILE / 2, y + 6);
      ctx.lineTo(x + TILE / 2, y + TILE - 6);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,203,107,0.10)";
      ctx.fillRect(x + 4, y + 4, TILE - 8, 5);
    });
  }

  function pulse(time, period) {
    return 0.5 + 0.5 * Math.sin(time / period);
  }

  function drawChute(time) {
    var c = G.grid.chute;
    var cx = c.x * TILE + TILE / 2,
      cy = c.y * TILE + TILE / 2;
    if (G.delivered) {
      ctx.fillStyle = "rgba(111,227,161,0.20)";
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#6fe3a1";
    } else {
      var p = pulse(time, 700);
      ctx.strokeStyle = "rgba(111,227,161," + (0.45 + 0.45 * p) + ")";
    }
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE * 0.34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = G.delivered ? "#6fe3a1" : "rgba(111,227,161,0.75)";
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(G.delivered ? "\u2713" : "OUT", cx, cy);
  }

  function drawDock(time) {
    var d = G.grid.dock;
    var x = d.x * TILE,
      y = d.y * TILE;
    var p = G.delivered ? pulse(time, 400) : 0;
    ctx.fillStyle =
      "rgba(255,203,107," + (G.delivered ? 0.3 + 0.25 * p : 0.14) + ")";
    roundRect(x + 5, y + 5, TILE - 10, TILE - 10, 6);
    ctx.fill();
    ctx.strokeStyle = G.delivered ? "#ffcb6b" : "rgba(255,203,107,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // lightning bolt
    var cx = x + TILE / 2,
      cy = y + TILE / 2;
    ctx.fillStyle = G.delivered ? "#ffcb6b" : "rgba(255,203,107,0.7)";
    ctx.beginPath();
    ctx.moveTo(cx + 3, cy - 11);
    ctx.lineTo(cx - 6, cy + 2);
    ctx.lineTo(cx - 1, cy + 2);
    ctx.lineTo(cx - 3, cy + 11);
    ctx.lineTo(cx + 6, cy - 2);
    ctx.lineTo(cx + 1, cy - 2);
    ctx.closePath();
    ctx.fill();
  }

  function drawParcel(time) {
    if (!G.parcelAt) {
      return;
    }
    var bob = Math.sin(time / 300) * 1.5;
    var x = G.parcelAt.x * TILE + TILE / 2;
    var y = G.parcelAt.y * TILE + TILE / 2 + bob;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, G.parcelAt.y * TILE + TILE - 8, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#a9713d";
    roundRect(x - 11, y - 9, 22, 18, 3);
    ctx.fill();
    ctx.strokeStyle = "#7a4e27";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = "#e8c98f";
    ctx.beginPath();
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x, y + 9);
    ctx.moveTo(x - 11, y);
    ctx.lineTo(x + 11, y);
    ctx.stroke();
  }

  function drawBot(progress, time) {
    var bx = lerp(G.bot.px, G.bot.x, progress) * TILE + TILE / 2;
    var by = lerp(G.bot.py, G.bot.y, progress) * TILE + TILE / 2;
    var ang = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][G.bot.dir]; // E=0 -> pointing right
    // E vector (1,0) => angle 0 ; N => -90deg ; W => 180 ; S => 90
    ang = [0, -Math.PI / 2, Math.PI, Math.PI / 2][G.bot.dir];
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(ang);
    if (G.status === "run") {
      var beam = ctx.createLinearGradient(10, 0, TILE * 0.95, 0);
      beam.addColorStop(0, "rgba(255,230,150,0.28)");
      beam.addColorStop(1, "rgba(255,230,150,0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(10, -5);
      ctx.lineTo(TILE * 0.95, -TILE * 0.34);
      ctx.lineTo(TILE * 0.95, TILE * 0.34);
      ctx.lineTo(10, 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(0, 6, 14, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = G.bot.carrying ? "#ffd98a" : "#ffcb6b";
    ctx.strokeStyle = "#8a5f1d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-10, -11);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-10, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#20263a";
    ctx.beginPath();
    ctx.arc(4, 0, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    void time;
  }

  function drawSweepers(time) {
    G.sweepers.forEach(function (sw) {
      var sx =
        lerp(sw.px, sw.x, G.status === "run" ? Math.min(1, G.acc / TICK) : 1) *
          TILE +
        TILE / 2;
      var sy =
        lerp(sw.py, sw.y, G.status === "run" ? Math.min(1, G.acc / TICK) : 1) *
          TILE +
        TILE / 2;
      var glow = 0.25 + 0.2 * pulse(time, 500);
      ctx.fillStyle = "rgba(255,80,80," + glow + ")";
      ctx.beginPath();
      ctx.arc(sx, sy, TILE * 0.44, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#c93b3b";
      ctx.beginPath();
      ctx.arc(sx, sy, TILE * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#7d1f1f";
      ctx.lineWidth = 2;
      ctx.stroke();
      var rot = time / 120;
      ctx.strokeStyle = "#ffb3b3";
      ctx.lineWidth = 2;
      for (var i = 0; i < 3; i++) {
        var a = rot + i * ((Math.PI * 2) / 3);
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a) * 5, sy + Math.sin(a) * 5);
        ctx.lineTo(sx + Math.cos(a) * 12, sy + Math.sin(a) * 12);
        ctx.stroke();
      }
    });
  }

  function drawVignette() {
    var g = ctx.createRadialGradient(
      cv.width / 2,
      cv.height / 2,
      cv.height * 0.35,
      cv.width / 2,
      cv.height / 2,
      cv.height * 0.75,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cv.width, cv.height);
  }

  function draw(time) {
    var progress = G.status === "run" ? Math.min(1, G.acc / TICK) : 1;
    drawFloor(time);
    drawOil(time);
    drawShelves();
    drawChute(time);
    drawDock(time);
    drawParcel(time);
    drawSweepers(time);
    drawBot(progress, time);
    drawVignette();
  }

  function frame(ts) {
    if (!G.lastTs) {
      G.lastTs = ts;
    }
    var dt = Math.min(60, ts - G.lastTs);
    G.lastTs = ts;
    if (G.status === "run" && G.program.length > 0) {
      G.acc += dt;
      var guard = 0;
      while (G.acc >= TICK && G.status === "run" && guard < 8) {
        G.acc -= TICK;
        doTick();
        guard++;
      }
      if (G.status === "run") {
        syncActiveChip();
      }
    }
    draw(ts);
    requestAnimationFrame(frame);
  }

  var lastChipIndex = -1;
  function syncActiveChip() {
    var idx = G.program.length > 0 ? G.steps % G.program.length : -1;
    if (idx !== lastChipIndex) {
      lastChipIndex = idx;
      syncUI();
    }
  }

  /* ---------- boot ---------- */
  loadLevel(0, false);
  showOverlay(
    "Loop &amp; Load",
    "Night shift, parcel depot. The courier bot obeys exactly one thing: " +
      "<b>the loop you program</b> \u2014 and it repeats it from the top, forever.<br><br>" +
      "Build a loop from Forward, Left, Right, Wait and Grab/Drop, hit <b>Run</b>, " +
      "and watch it play out. Grab the <b>parcel</b>, post it at the <b>chute</b>, " +
      "then roll onto the <b>charge pad</b> to ship the round.<br>" +
      '<span class="fine">Shelves, walls and red patrol sweepers end the attempt instantly. Oil slicks slide you.</span>',
    [
      {
        label: "\u25b6 Start the shift",
        primary: true,
        fn: function () {
          G.status = "edit";
          hideOverlay();
          syncUI();
        },
      },
    ],
  );
  syncUI();
  requestAnimationFrame(frame);
})();
