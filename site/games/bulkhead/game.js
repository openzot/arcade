/* Bulkhead - a turn-based containment game for the arcade.
   Weld two corridor tiles shut each turn; then the spore bloom creeps one
   tile in every direction. Wall the bloom in completely before it drowns
   the station or touches the reactor. */
(function () {
  "use strict";

  /* ------------------------------------------------------------ levels */
  /* Legend: '#' rock, '.' corridor, 'S' breach (bloom source), 'R' reactor. */
  var LEVELS = [
    {
      name: "The Sump",
      par: 2,
      brief: "Every way out of the breached room must be welded. All three.",
      map: [
        "###########",
        "#....#....#",
        "#.S..#....#",
        "#....#....#",
        "#.#..#..R.#",
        "#.........#",
        "###########",
      ],
    },
    {
      name: "Pump House",
      par: 3,
      brief: "The pump room has five hatches. Close every one of them.",
      map: [
        "###############",
        "##.###.###....#",
        "#..#.....#....#",
        "#..#.....#....#",
        "#.....S.......#",
        "#..#.....#....#",
        "#..#.....#....#",
        "#..###..###...#",
        "#...........R.#",
        "#.............#",
        "###############",
      ],
    },
    {
      name: "Cold Store",
      par: 3,
      brief: "Two breaches, two cold rooms. The far hatches can wait - barely.",
      map: [
        "###############",
        "#....#...#....#",
        "#....#.R.#....#",
        "#........#....#",
        "#....#...#....#",
        "#.S..#...#..S.#",
        "#....#........#",
        "#....#...#....#",
        "#....#........#",
        "#....#...#....#",
        "###############",
      ],
    },
    {
      name: "Long Gallery",
      par: 3,
      brief:
        "Anchor your wall on the pillars - a shorter wall costs fewer welds.",
      map: [
        "###################",
        "#...#.........#...#",
        "#.....#.....#.....#",
        "#.................#",
        "#S...............R#",
        "#.....#.....#.....#",
        "#.................#",
        "#...#.........#...#",
        "###################",
      ],
    },
    {
      name: "Reactor Hall",
      par: 4,
      brief:
        "Three breaches boil inside the vault. Close all six hatches before they blow.",
      map: [
        "#####################",
        "#...................#",
        "#.....###..####.....#",
        "#.....##.....##..#..#",
        "#.....#.S...S.#.....#",
        "#.............#.....#",
        "#...#.....R.........#",
        "#.....#.............#",
        "#.....#...S...#.....#",
        "#..#..##.....##.....#",
        "#.....#########.....#",
        "#...............#...#",
        "#####################",
      ],
    },
  ];

  var WELDS_PER_TURN = 2;
  var SPREAD_DELAY = 320; // ms of tension before the bloom advances
  var DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  /* --------------------------------------------------------------- dom */
  function $(id) {
    return document.getElementById(id);
  }

  var canvas = $("game");
  var ctx = canvas.getContext("2d");
  var stage = $("stage");
  var overlay = $("overlay");
  var panels = {
    start: $("panel-start"),
    win: $("panel-win"),
    lose: $("panel-lose"),
    final: $("panel-final"),
  };
  var hud = {
    level: $("hud-level"),
    turn: $("hud-turn"),
    welds: $("hud-welds"),
    blight: $("hud-blight"),
  };
  var hint = $("hint");

  /* ----------------------------------------------------------- storage */
  var store = {
    get: function (k, d) {
      try {
        var v = localStorage.getItem(k);
        return v === null ? d : v;
      } catch (e) {
        return d;
      }
    },
    set: function (k, v) {
      try {
        localStorage.setItem(k, String(v));
      } catch (e) {
        /* private mode: progress just won't persist */
      }
    },
  };

  function getUnlocked() {
    var n = parseInt(store.get("bh-unlocked", "1"), 10);
    return n >= 1 && n <= LEVELS.length ? n : 1;
  }

  function getStars() {
    try {
      var arr = JSON.parse(store.get("bh-stars", "[]"));
      return arr instanceof Array ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveResult(idx, stars) {
    var arr = getStars();
    if (arr[idx] == null || stars > arr[idx]) {
      arr[idx] = stars;
    }
    store.set("bh-stars", JSON.stringify(arr));
    if (idx + 2 > getUnlocked()) {
      store.set("bh-unlocked", String(idx + 2));
    }
  }

  /* ------------------------------------------------------------- audio */
  var Sound = (function () {
    var ac = null;
    var noiseBuf = null;
    var muted = store.get("bh-muted", "0") === "1";

    function ensure() {
      if (muted) {
        return null;
      }
      if (!ac) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
          muted = true;
          return null;
        }
        try {
          ac = new AC();
        } catch (e) {
          muted = true;
          return null;
        }
      }
      if (ac.state === "suspended") {
        ac.resume();
      }
      return ac;
    }

    function tone(freq, dur, type, vol, slide) {
      var c = ensure();
      if (!c) {
        return;
      }
      var t0 = c.currentTime;
      var o = c.createOscillator();
      var g = c.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t0);
      if (slide) {
        o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
      }
      g.gain.setValueAtTime(vol || 0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }

    function noise(dur, vol) {
      var c = ensure();
      if (!c) {
        return;
      }
      if (!noiseBuf) {
        noiseBuf = c.createBuffer(1, (c.sampleRate * 0.2) | 0, c.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < d.length; i++) {
          d[i] = Math.random() * 2 - 1;
        }
      }
      var t0 = c.currentTime;
      var s = c.createBufferSource();
      s.buffer = noiseBuf;
      var f = c.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = 900;
      var g = c.createGain();
      g.gain.setValueAtTime(vol || 0.1, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f);
      f.connect(g);
      g.connect(c.destination);
      s.start(t0);
      s.stop(t0 + dur + 0.02);
    }

    return {
      unlock: function () {
        ensure();
      },
      weld: function () {
        tone(190, 0.1, "square", 0.1, 70);
        noise(0.06, 0.09);
      },
      deny: function () {
        tone(140, 0.08, "square", 0.05, 120);
      },
      spread: function () {
        tone(82, 0.24, "sine", 0.13, 46);
      },
      win: function () {
        [392, 523, 659, 784].forEach(function (f, i) {
          setTimeout(function () {
            tone(f, 0.2, "triangle", 0.12);
          }, i * 95);
        });
      },
      lose: function () {
        [311, 247, 165].forEach(function (f, i) {
          setTimeout(function () {
            tone(f, 0.32, "sawtooth", 0.08);
          }, i * 150);
        });
      },
      click: function () {
        tone(660, 0.05, "triangle", 0.06);
      },
      toggle: function () {
        muted = !muted;
        store.set("bh-muted", muted ? "1" : "0");
        if (!muted) {
          ensure();
        }
        return muted;
      },
      isMuted: function () {
        return muted;
      },
    };
  })();

  /* ------------------------------------------------------------- state */
  var st = null;
  var epoch = 0; // invalidates queued timeouts across restarts
  var currentIdx = Math.min(getUnlocked(), LEVELS.length) - 1;
  var view = { ts: 32, w: 300, h: 200, dpr: 1 };
  var bgCache = { key: "", grad: null };

  function cell(x, y) {
    return st.cells[y * st.gw + x];
  }

  function inb(x, y) {
    return x >= 0 && y >= 0 && x < st.gw && y < st.gh;
  }

  function openFloor(x, y) {
    return inb(x, y) && cell(x, y).t === "floor" && !cell(x, y).blight;
  }

  /* True when no blighted tile borders an open corridor: the bloom is walled in. */
  function enclosed() {
    for (var i = 0; i < st.cells.length; i++) {
      var c = st.cells[i];
      if (!c.blight) {
        continue;
      }
      var x = i % st.gw;
      var y = (i / st.gw) | 0;
      for (var d = 0; d < 4; d++) {
        if (openFloor(x + DIRS[d][0], y + DIRS[d][1])) {
          return false;
        }
      }
    }
    return true;
  }

  function loadLevel(idx) {
    epoch++;
    currentIdx = idx;
    var L = LEVELS[idx];
    var rows = L.map;
    var gh = rows.length;
    var gw = rows[0].length;
    var cells = new Array(gw * gh);
    var sources = [];
    var reactor = null;
    var open = 0;

    for (var y = 0; y < gh; y++) {
      var row = rows[y];
      for (var x = 0; x < gw; x++) {
        var ch = row.charAt(x);
        var t = "floor";
        if (ch === "#") {
          t = "rock";
        } else if (ch === "R") {
          t = "reactor";
          reactor = { x: x, y: y };
        }
        var c = {
          t: t,
          blight: false,
          born: 0,
          shade: ((x * 73856093) ^ (y * 19349663)) >>> 0,
        };
        if (ch === "S") {
          c.blight = true;
          c.born = performance.now();
          sources.push({ x: x, y: y });
        }
        if (t !== "rock") {
          open++;
        }
        cells[y * gw + x] = c;
      }
    }

    var focus = sources[0] || reactor || { x: (gw / 2) | 0, y: (gh / 2) | 0 };
    st = {
      idx: idx,
      name: L.name,
      brief: L.brief,
      par: L.par,
      gw: gw,
      gh: gh,
      cells: cells,
      sources: sources,
      reactor: reactor,
      turn: 1,
      weldsLeft: WELDS_PER_TURN,
      phase: "play",
      openStart: open,
      cap: Math.ceil(open * 0.5),
      blightCount: sources.length,
      cursor: { x: focus.x, y: focus.y },
      sparks: [],
      bubbles: [],
      denyT: -1e9,
    };
    initBubbles();
    fitCanvas();
    updateHud();
    hint.textContent = L.brief;
    showPanel(null);
  }

  function scheduleSpread() {
    st.phase = "spreading";
    updateHud();
    var e = epoch;
    setTimeout(function () {
      if (e === epoch) {
        doSpread();
      }
    }, SPREAD_DELAY);
  }

  /* Deliberately end the turn early: the sea does not wait for spare welds. */
  function passTurn() {
    if (!st || st.phase !== "play") {
      return;
    }
    Sound.click();
    st.weldsLeft = 0;
    hint.textContent = "You hold your torch - the bloom advances...";
    scheduleSpread();
  }

  function tryWeld(x, y) {
    if (!st || st.phase !== "play" || !inb(x, y)) {
      return;
    }
    st.cursor.x = x;
    st.cursor.y = y;
    var c = cell(x, y);
    if (c.t !== "floor" || c.blight) {
      st.denyT = performance.now();
      Sound.deny();
      return;
    }
    c.t = "weld";
    c.born = performance.now();
    spawnSparks(x, y);
    Sound.weld();
    st.weldsLeft--;
    updateHud();

    if (enclosed()) {
      finish("won", "contain", st.turn);
      return;
    }
    if (st.weldsLeft <= 0) {
      hint.textContent = "Welds spent - the bloom advances...";
      scheduleSpread();
    } else {
      hint.textContent = "One weld left this turn.";
    }
  }

  function doSpread() {
    if (!st || st.phase !== "spreading") {
      return;
    }
    var now = performance.now();
    var played = st.turn;
    var meltdown = false;
    var order = 0;

    for (var i = 0; i < st.cells.length; i++) {
      var c = st.cells[i];
      if (!c.blight) {
        continue;
      }
      var x = i % st.gw;
      var y = (i / st.gw) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = x + DIRS[d][0];
        var ny = y + DIRS[d][1];
        if (!inb(nx, ny)) {
          continue;
        }
        var n = cell(nx, ny);
        if (n.t === "reactor") {
          meltdown = true;
        } else if (n.t === "floor" && !n.blight) {
          n.blight = true;
          n.born = now + order * 26;
          order++;
          st.blightCount++;
        }
      }
    }

    st.turn++;
    st.weldsLeft = WELDS_PER_TURN;
    Sound.spread();
    updateHud();

    if (meltdown) {
      finish("lost", "meltdown", played);
      return;
    }
    if (st.blightCount > st.cap) {
      finish("lost", "overrun", played);
      return;
    }
    if (enclosed()) {
      finish("won", "contain", played);
      return;
    }
    st.phase = "play";
    hint.textContent = "Two welds. Choose where the wall goes.";
  }

  function finish(kind, reason, turns) {
    st.phase = kind === "won" ? "won" : "lost";
    updateHud();
    var e = epoch;
    if (kind === "won") {
      Sound.win();
      var stars = turns <= st.par ? 3 : turns <= st.par + 2 ? 2 : 1;
      saveResult(st.idx, stars);
      setTimeout(function () {
        if (e !== epoch) {
          return;
        }
        if (st.idx === LEVELS.length - 1) {
          showFinal();
        } else {
          showWin(stars, turns);
        }
      }, 750);
    } else {
      Sound.lose();
      setTimeout(function () {
        if (e !== epoch) {
          return;
        }
        showLose(reason);
      }, 800);
    }
  }

  /* ---------------------------------------------------------- overlays */
  function showPanel(name) {
    Object.keys(panels).forEach(function (k) {
      panels[k].hidden = k !== name;
    });
    overlay.classList.toggle("hidden", !name);
  }

  function starHtml(n) {
    var s = "";
    for (var i = 1; i <= 3; i++) {
      s += '<span class="star' + (i <= n ? " on" : "") + '">\u2605</span>';
    }
    return s;
  }

  function showWin(stars, turns) {
    $("win-title").textContent = "Contained!";
    $("win-stars").innerHTML = starHtml(stars);
    $("win-stat").textContent =
      "Dive " +
      (st.idx + 1) +
      " - " +
      st.name +
      ": sealed on turn " +
      turns +
      " (par " +
      st.par +
      ").";
    showPanel("win");
  }

  function showLose(reason) {
    $("lose-title").textContent =
      reason === "meltdown" ? "Meltdown" : "Overrun";
    $("lose-stat").textContent =
      reason === "meltdown"
        ? "The bloom touched the reactor on turn " +
          st.turn +
          ". Seal it earlier - rock counts as wall, so anchor on it."
        : "The station flooded on turn " +
          st.turn +
          ". Cut the bloom off before it can spread wide.";
    showPanel("lose");
  }

  function showFinal() {
    var arr = getStars();
    var total = 0;
    for (var i = 0; i < LEVELS.length; i++) {
      total += arr[i] || 0;
    }
    $("final-stars").innerHTML = starHtml(
      total >= LEVELS.length * 3 ? 3 : total >= 10 ? 2 : 1,
    );
    $("final-stat").textContent =
      "All " +
      LEVELS.length +
      " dives contained - " +
      total +
      " of " +
      LEVELS.length * 3 +
      " stars earned. The station holds.";
    showPanel("final");
  }

  function buildPick() {
    var host = $("level-pick");
    host.innerHTML = "";
    var unlocked = getUnlocked();
    var stars = getStars();
    LEVELS.forEach(function (L, i) {
      var locked = i + 1 > unlocked;
      var b = document.createElement("button");
      b.type = "button";
      b.className =
        "pick" +
        (locked ? " locked" : "") +
        (i === currentIdx ? " current" : "");
      var big = document.createElement("span");
      big.textContent = locked ? "-" : String(i + 1);
      var sm = document.createElement("small");
      sm.textContent = locked
        ? "locked"
        : L.name + (stars[i] ? " \u2605" + stars[i] : "");
      b.appendChild(big);
      b.appendChild(sm);
      b.addEventListener("click", function () {
        if (locked) {
          Sound.deny();
          return;
        }
        Sound.click();
        loadLevel(i);
      });
      host.appendChild(b);
    });
  }

  /* -------------------------------------------------------------- hud */
  function updateHud() {
    hud.level.textContent = "Dive " + (st.idx + 1) + " \u00b7 " + st.name;
    hud.turn.textContent = "Turn " + st.turn;
    var dots = "";
    for (var i = 0; i < WELDS_PER_TURN; i++) {
      dots += i < st.weldsLeft ? "\u25cf" : "\u25cb";
    }
    hud.welds.textContent = "Welds " + dots;
    hud.blight.textContent =
      "Bloom " + Math.round((st.blightCount / st.openStart) * 100) + "%";
    var passBtn = $("btn-pass");
    passBtn.disabled = st.phase !== "play";
  }

  /* --------------------------------------------------------- rendering */
  function fitCanvas() {
    var bw = stage.clientWidth;
    var bh = stage.clientHeight;
    if (bw < 40 || bh < 40) {
      return;
    }
    var ts = Math.floor(Math.min((bw - 8) / st.gw, (bh - 8) / st.gh));
    ts = Math.max(14, Math.min(ts, 64));
    var w = ts * st.gw;
    var h = ts * st.gh;
    var dpr = window.devicePixelRatio || 1;
    view.ts = ts;
    view.w = w;
    view.h = h;
    view.dpr = dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    bgCache.key = "";
  }

  function bgGrad() {
    var key = view.w + "x" + view.h;
    if (bgCache.key !== key) {
      var g = ctx.createLinearGradient(0, 0, 0, view.h);
      g.addColorStop(0, "#0a2a38");
      g.addColorStop(1, "#04141d");
      bgCache.grad = g;
      bgCache.key = key;
    }
    return bgCache.grad;
  }

  function initBubbles() {
    var n = Math.max(12, Math.min(40, Math.round((st.gw * st.gh) / 22)));
    st.bubbles = [];
    for (var i = 0; i < n; i++) {
      st.bubbles.push({
        x: Math.random() * view.w,
        y: Math.random() * view.h,
        r: 1 + Math.random() * 2.2,
        v: 7 + Math.random() * 15,
        ph: Math.random() * 6.28,
      });
    }
  }

  function spawnSparks(x, y) {
    var ts = view.ts;
    for (var i = 0; i < 7; i++) {
      var a = Math.random() * 6.28;
      var spd = (1.4 + Math.random() * 2.2) * ts;
      st.sparks.push({
        x: x * ts + ts / 2,
        y: y * ts + ts / 2,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        born: performance.now(),
      });
    }
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

  function drawFloor(px, py, ts, c) {
    ctx.fillStyle = "#0b2833";
    ctx.fillRect(px, py, ts, ts);
    ctx.strokeStyle = "rgba(127,200,220,0.06)";
    ctx.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);
    if (c.shade % 7 === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(px + ts * 0.3, py + ts * 0.55, 2, 2);
    }
  }

  function drawRock(px, py, ts, c) {
    ctx.fillStyle = "#173540";
    ctx.fillRect(px, py, ts, ts);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(px, py, ts, 2);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(px, py + ts - 2, ts, 2);
    if (c.shade % 3 === 0) {
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.fillRect(px + ts * 0.45, py + ts * 0.25, 2, ts * 0.5);
    }
  }

  function drawWeld(px, py, ts, c, now) {
    ctx.fillStyle = "#2b5261";
    ctx.fillRect(px, py, ts, ts);
    ctx.strokeStyle = "#49788a";
    ctx.lineWidth = 1.5;
    rr(px + 3, py + 3, ts - 6, ts - 6, 3);
    ctx.stroke();
    ctx.fillStyle = "rgba(190,235,245,0.55)";
    var o = 6;
    ctx.fillRect(px + o, py + o, 2, 2);
    ctx.fillRect(px + ts - o - 2, py + o, 2, 2);
    ctx.fillRect(px + o, py + ts - o - 2, 2, 2);
    ctx.fillRect(px + ts - o - 2, py + ts - o - 2, 2, 2);
    var k = (now - c.born) / 450;
    if (k < 1) {
      ctx.fillStyle = "rgba(255,166,77," + (1 - k) * 0.55 + ")";
      ctx.fillRect(px, py, ts, ts);
      ctx.strokeStyle = "rgba(255,200,120," + (1 - k) * 0.8 + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px + ts / 2, py + ts / 2, ts * (0.3 + k * 0.45), 0, 6.28);
      ctx.stroke();
    }
  }

  function drawReactor(px, py, ts, now) {
    var cx = px + ts / 2;
    var cy = py + ts / 2;
    ctx.fillStyle = "#06202b";
    ctx.fillRect(px, py, ts, ts);
    var pulse = 0.75 + 0.25 * Math.sin(now / 300);
    var g = ctx.createRadialGradient(cx, cy, 1, cx, cy, ts * 0.46);
    g.addColorStop(0, "rgba(191,244,255," + 0.95 * pulse + ")");
    g.addColorStop(0.45, "rgba(79,216,235," + 0.5 * pulse + ")");
    g.addColorStop(1, "rgba(79,216,235,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, ts * 0.46, 0, 6.28);
    ctx.fill();
    ctx.strokeStyle = "rgba(79,216,235,0.85)";
    ctx.lineWidth = 2;
    var a0 = now / 700;
    ctx.beginPath();
    ctx.arc(cx, cy, ts * 0.33, a0, a0 + 1.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, ts * 0.33, a0 + 3.14, a0 + 4.84);
    ctx.stroke();
  }

  function drawBlight(now) {
    var ts = view.ts;
    for (var i = 0; i < st.cells.length; i++) {
      var c = st.cells[i];
      if (!c.blight) {
        continue;
      }
      var x = i % st.gw;
      var y = (i / st.gw) | 0;
      var pop = (now - c.born) / 300;
      if (pop <= 0) {
        continue;
      }
      if (pop > 1) {
        pop = 1;
      }
      var cx = x * ts + ts / 2;
      var cy = y * ts + ts / 2;
      var pulse = 0.82 + 0.18 * Math.sin(now / 260 + x * 1.9 + y * 1.3);
      var r = ts * 0.68 * (0.55 + 0.45 * pop) * pulse;
      var g = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
      g.addColorStop(0, "rgba(214,255,140,0.95)");
      g.addColorStop(0.4, "rgba(164,240,74,0.7)");
      g.addColorStop(1, "rgba(90,170,40,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 6.28);
      ctx.fill();
      ctx.fillStyle = "rgba(232,255,190,0.85)";
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.2, 0, 6.28);
      ctx.fill();
    }
  }

  function drawSources(now) {
    var ts = view.ts;
    st.sources.forEach(function (s) {
      var cx = s.x * ts + ts / 2;
      var cy = s.y * ts + ts / 2;
      var a = 0.5 + 0.3 * Math.sin(now / 200);
      ctx.strokeStyle = "rgba(255,120,60," + a + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - ts * 0.2, cy - ts * 0.25);
      ctx.lineTo(cx + ts * 0.1, cy);
      ctx.lineTo(cx - ts * 0.05, cy + ts * 0.1);
      ctx.lineTo(cx + ts * 0.22, cy + ts * 0.28);
      ctx.stroke();
    });
  }

  function drawSparks(now, dt) {
    var ts = view.ts;
    var keep = [];
    for (var i = 0; i < st.sparks.length; i++) {
      var s = st.sparks[i];
      var age = (now - s.born) / 500;
      if (age >= 1) {
        continue;
      }
      var fx = s.x + s.vx * age * 0.5;
      var fy = s.y + s.vy * age * 0.5;
      ctx.fillStyle = "rgba(255,180,94," + (1 - age) * 0.85 + ")";
      ctx.beginPath();
      ctx.arc(fx, fy, ts * 0.09 * (1 - age * 0.5), 0, 6.28);
      ctx.fill();
      keep.push(s);
    }
    st.sparks = keep;
  }

  function drawBubbles(now, dt) {
    var ts = view.ts;
    for (var i = 0; i < st.bubbles.length; i++) {
      var b = st.bubbles[i];
      b.y -= b.v * (dt / 1000) * (ts / 32);
      b.x += Math.sin(now / 900 + b.ph) * 0.18;
      if (b.y < -4) {
        b.y = view.h + 4;
        b.x = Math.random() * view.w;
      }
      ctx.fillStyle = "rgba(140,220,240,0.07)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (ts / 32), 0, 6.28);
      ctx.fill();
    }
  }

  function drawCursor(now) {
    if (st.phase !== "play") {
      return;
    }
    var ts = view.ts;
    var deny = now - st.denyT < 260;
    var a = 0.55 + 0.3 * Math.sin(now / 220);
    ctx.strokeStyle = deny
      ? "rgba(255,94,73," + a + ")"
      : "rgba(215,240,247," + a + ")";
    ctx.lineWidth = 2;
    rr(st.cursor.x * ts + 2, st.cursor.y * ts + 2, ts - 4, ts - 4, 4);
    ctx.stroke();
  }

  function drawDanger(now) {
    var best = 99;
    for (var i = 0; i < st.cells.length; i++) {
      var c = st.cells[i];
      if (!c.blight) {
        continue;
      }
      var x = i % st.gw;
      var y = (i / st.gw) | 0;
      var d = Math.abs(x - st.reactor.x) + Math.abs(y - st.reactor.y);
      if (d < best) {
        best = d;
      }
    }
    if (best > 3) {
      return;
    }
    var a = (1 - (best - 1) / 3) * (0.3 + 0.14 * Math.sin(now / 160));
    ctx.strokeStyle = "rgba(255,94,73," + Math.max(0, a) + ")";
    ctx.lineWidth = 10;
    rr(5, 5, view.w - 10, view.h - 10, 12);
    ctx.stroke();
  }

  function draw(now, dt) {
    var ts = view.ts;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = bgGrad();
    ctx.fillRect(0, 0, view.w, view.h);
    drawBubbles(now, dt);
    for (var y = 0; y < st.gh; y++) {
      for (var x = 0; x < st.gw; x++) {
        var c = st.cells[y * st.gw + x];
        var px = x * ts;
        var py = y * ts;
        if (c.t === "rock") {
          drawRock(px, py, ts, c);
        } else if (c.t === "weld") {
          drawWeld(px, py, ts, c, now);
        } else if (c.t === "reactor") {
          drawReactor(px, py, ts, now);
        } else {
          drawFloor(px, py, ts, c);
        }
      }
    }
    drawSources(now);
    drawBlight(now);
    drawSparks(now, dt);
    drawCursor(now);
    drawDanger(now);
  }

  var lastT = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    var dt = Math.min(50, t - lastT);
    lastT = t;
    if (!st) {
      return;
    }
    draw(t, dt);
  }

  /* ------------------------------------------------------------- input */
  function eventTile(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - r.left) / view.ts),
      y: Math.floor((e.clientY - r.top) / view.ts),
    };
  }

  canvas.addEventListener("pointerdown", function (e) {
    Sound.unlock();
    var t = eventTile(e);
    tryWeld(t.x, t.y);
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!st) {
      return;
    }
    var t = eventTile(e);
    if (inb(t.x, t.y)) {
      st.cursor.x = t.x;
      st.cursor.y = t.y;
    }
  });

  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "m" || k === "M") {
      toggleSound();
      return;
    }
    if (k === "r" || k === "R") {
      if (st) {
        Sound.click();
        loadLevel(st.idx);
      }
      return;
    }
    if (k === "e" || k === "E") {
      passTurn();
      return;
    }
    if (!st || st.phase !== "play") {
      return;
    }

    if (!st || st.phase !== "play") {
      return;
    }
    var dx = 0;
    var dy = 0;
    if (k === "ArrowLeft" || k === "a" || k === "A") {
      dx = -1;
    } else if (k === "ArrowRight" || k === "d" || k === "D") {
      dx = 1;
    } else if (k === "ArrowUp" || k === "w" || k === "W") {
      dy = -1;
    } else if (k === "ArrowDown" || k === "s" || k === "S") {
      dy = 1;
    }
    if (dx || dy) {
      st.cursor.x = Math.max(0, Math.min(st.gw - 1, st.cursor.x + dx));
      st.cursor.y = Math.max(0, Math.min(st.gh - 1, st.cursor.y + dy));
      e.preventDefault();
    } else if (k === " " || k === "Enter") {
      tryWeld(st.cursor.x, st.cursor.y);
      e.preventDefault();
    }
  });

  /* ----------------------------------------------------------- buttons */
  function toggleSound() {
    var m = Sound.toggle();
    $("btn-sound").innerHTML = m ? "\u00d7" : "\u266a";
    Sound.click();
  }

  $("btn-sound").addEventListener("click", function () {
    Sound.unlock();
    toggleSound();
  });

  $("btn-restart").addEventListener("click", function () {
    Sound.click();
    loadLevel(st.idx);
  });

  $("btn-pass").addEventListener("click", passTurn);

  $("btn-start").addEventListener("click", function () {
    Sound.unlock();
    Sound.click();
    loadLevel(currentIdx);
  });

  $("btn-next").addEventListener("click", function () {
    Sound.click();
    loadLevel(Math.min(st.idx + 1, LEVELS.length - 1));
  });

  $("btn-replay").addEventListener("click", function () {
    Sound.click();
    loadLevel(st.idx);
  });

  $("btn-retry").addEventListener("click", function () {
    Sound.click();
    loadLevel(st.idx);
  });

  $("btn-menu").addEventListener("click", function () {
    Sound.click();
    buildPick();
    showPanel("start");
  });

  $("btn-again").addEventListener("click", function () {
    Sound.click();
    loadLevel(0);
  });

  /* -------------------------------------------------------------- boot */
  document.addEventListener("visibilitychange", function () {
    lastT = performance.now();
  });

  window.addEventListener("resize", function () {
    if (st) {
      fitCanvas();
    }
  });

  $("btn-sound").innerHTML = Sound.isMuted() ? "\u00d7" : "\u266a";
  loadLevel(currentIdx);
  buildPick();
  showPanel("start");
  requestAnimationFrame(frame);
})();
