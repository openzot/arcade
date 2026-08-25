/* Falling Glass - a harbourmaster's week against the Atlantic.
   Read the glass, the vane and the sky each dawn; commit boats; live with it. */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * dom
   * ------------------------------------------------------------------ */
  var canvas = document.getElementById("sea");
  var ctx = canvas.getContext("2d");
  function el(id) {
    return document.getElementById(id);
  }
  var ui = {
    titleCard: el("titleCard"),
    endCard: el("endCard"),
    endTitle: el("endTitle"),
    endBody: el("endBody"),
    glassRead: el("glassRead"),
    glassTrend: el("glassTrend"),
    windRead: el("windRead"),
    windTrend: el("windTrend"),
    skyRead: el("skyRead"),
    skyOmen: el("skyOmen"),
    fleetRow: el("fleetRow"),
    sailBtn: el("sailBtn"),
    bellBtn: el("bellBtn"),
    sleepBtn: el("sleepBtn"),
    dayRead: el("dayRead"),
    purseRead: el("purseRead"),
    quotaRead: el("quotaRead"),
    fleetRead: el("fleetRead"),
    log: el("log"),
    soundBtn: el("soundBtn"),
    pauseBtn: el("pauseBtn"),
    resetBtn: el("resetBtn"),
    startBtn: el("startBtn"),
    againBtn: el("againBtn"),
  };

  /* ------------------------------------------------------------------ *
   * constants
   * ------------------------------------------------------------------ */
  var QUOTA = 92;
  var DAYS = 6;
  var IDLE_COST = 1;
  var BASE_CATCH = 5.5;
  var PENSION = 10; // paid to the widows' fund for every boat lost
  var RECALL_END = 0.42; // bell stops working here
  var REVEAL_AT = 0.5; // the sky shows its hand

  var BOAT_NAMES = [
    "Merry Alice",
    "Jenny Wren",
    "Salt Cat",
    "Gannet",
    "Primrose",
    "Tamarisk",
  ];

  // severity 0..4: flat calm, fair, squalls, gale, storm
  var WEATHER = [
    {
      name: "a flat calm",
      sea: 2,
      catch: 1.35,
      loss: 0,
      cover: 0.12,
      rain: 0,
      top: "#9fd2ec",
      bot: "#dff0f4",
    },
    {
      name: "a fair morning",
      sea: 4.5,
      catch: 1.1,
      loss: 0.02,
      cover: 0.32,
      rain: 0,
      top: "#8fc3e2",
      bot: "#d8e8ee",
    },
    {
      name: "squalls",
      sea: 9,
      catch: 0.55,
      loss: 0.12,
      cover: 0.62,
      rain: 0.5,
      top: "#6d93ad",
      bot: "#b9c8cf",
    },
    {
      name: "a gale",
      sea: 16,
      catch: 0.18,
      loss: 0.45,
      cover: 0.86,
      rain: 0.8,
      top: "#48606f",
      bot: "#8fa0a8",
    },
    {
      name: "a full storm",
      sea: 24,
      catch: 0.08,
      loss: 0.8,
      cover: 1,
      rain: 1,
      top: "#2c3a44",
      bot: "#66757d",
    },
  ];

  // markov chain: rows = yesterday's severity, cells = today's probability
  var CHAIN = [
    [0.44, 0.44, 0.1, 0.02, 0.0],
    [0.2, 0.4, 0.27, 0.1, 0.03],
    [0.07, 0.29, 0.33, 0.24, 0.07],
    [0.02, 0.11, 0.31, 0.37, 0.19],
    [0.0, 0.05, 0.23, 0.43, 0.29],
  ];

  var GLASS_NOMINAL = [1026, 1016, 1005, 994, 981];
  var WIND_NOMINAL = [6, 12, 21, 33, 46];

  var SKY_OMENS = [
    [
      "high haze, and not a cloud below the hill",
      "chimney smoke rising dead straight",
      "the bay bright as beaten tin",
    ],
    [
      "small white clouds walking with the wind",
      "clear over the Point, wisps down-channel",
      "a silver ring round the sun, nothing nearer",
    ],
    [
      "mackerel sky - mackerel sea",
      "a dirty smudge building away to the west",
      "white horses lifting off the bay already",
    ],
    [
      "a low black roof of cloud, horizon to horizon",
      "the gulls all sat inland, facing away",
      "sea breaking clean over the Barb",
    ],
    [
      "a green-black light, like the inside of a bottle",
      "long dumb swell rolling in from the south-west",
      "foam streaks lying flat on the water",
    ],
  ];

  var OMEN_WORSE = [
    "the swell is coming long from the south-west",
    "glass twitching at every glance - more coming",
    "cloud stacking up beyond the Lizard way",
  ];
  var OMEN_BETTER = [
    "swallows flying high tonight",
    "the wind has an easy sound in the rigging",
    "cats settling early on the quay wall",
  ];
  var OMEN_SAME = [
    "the sea holds its note",
    "no change the old men would trust",
    "the vane sleeps where it stood",
  ];

  var DIRS_CALM = [
    "light airs",
    "variable",
    "westerly air",
    "north-east whiff",
  ];
  var DIRS_MAIN = ["SW", "SSW", "W", "NW", "S", "WSW"];
  var TREND_UP = ["rising", "lifting steadily", "recovering"];
  var TREND_DOWN = ["falling", "slipping since dawn", "nose-diving"];
  var TREND_FLAT = ["steady", "hardly moving", "stuck at twenty-nine inches"];

  var ROCKS = ["on the Manacles", "off the Wolf", "on the Barb", "in the Race"];

  /* ------------------------------------------------------------------ *
   * helpers
   * ------------------------------------------------------------------ */
  var rnd = Math.random;
  function pick(arr) {
    return arr[Math.floor(rnd() * arr.length)];
  }
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function gauss(sigma) {
    var u = rnd() || 1e-9;
    var v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
  }
  function roll(p) {
    return rnd() < p;
  }
  function pounds(n) {
    var neg = n < 0 ? "-" : "";
    n = Math.abs(Math.round(n));
    return neg + "\u00a3" + n;
  }

  /* ------------------------------------------------------------------ *
   * state
   * ------------------------------------------------------------------ */
  var state = null;
  var sentFlags = []; // which boats sailed on the working day in progress

  function freshState() {
    return {
      phase: "title", // title | dawn | day | evening | end
      day: 1,
      purse: 10,
      boats: BOAT_NAMES.map(function (n) {
        return { name: n, alive: true, ready: false, atSea: false };
      }),
      weather: 1, // today's true severity (hidden behind the reveal)
      yesterday: null,
      tomorrow: null,
      signs: null,
      recalled: false,
      dayT: 0,
      dayLen: 7000,
      paused: false,
      muted: false,
      revealDone: false,
      pendingLoss: [], // { idx, at }
      sunk: {}, // idx -> sink progress 0..1
      flash: 0,
      bolts: [],
    };
  }

  /* ------------------------------------------------------------------ *
   * weather & signs
   * ------------------------------------------------------------------ */
  function sevFrom(prevSev) {
    var row = CHAIN[prevSev];
    var r = rnd();
    var acc = 0;
    for (var i = 0; i < row.length; i++) {
      acc += row[i];
      if (r <= acc) return i;
    }
    return 2;
  }

  function planDay() {
    // carry yesterday's forecast if one was made, else extend the chain
    if (state.tomorrow === null) {
      state.weather = sevFrom(state.yesterday === null ? 1 : state.yesterday);
    } else {
      state.weather = state.tomorrow;
    }
    state.tomorrow = sevFrom(state.weather);

    var w = state.weather;
    var prev = state.yesterday === null ? w : state.yesterday;
    var gap = w - prev;

    // the glass
    var hpa = GLASS_NOMINAL[w] + gauss(3);
    if (roll(0.06)) hpa += (roll(0.5) ? 1 : -1) * (8 + rnd() * 6);
    var trendPool = gap > 0 ? TREND_DOWN : gap < 0 ? TREND_UP : TREND_FLAT;
    if (gap !== 0 && roll(0.15)) trendPool = gap > 0 ? TREND_UP : TREND_DOWN;

    // the vane
    var knots = Math.max(2, Math.round(WIND_NOMINAL[w] + gauss(3)));
    var dir =
      w <= 1
        ? pick(DIRS_CALM)
        : pick(w >= 3 ? DIRS_MAIN : DIRS_MAIN.concat(DIRS_CALM));
    var windTrend;
    if (w >= 3 && roll(0.6)) windTrend = "backing all the while";
    else if (w <= 1 && roll(0.6)) windTrend = "barely breathing";
    else windTrend = pick(["veering slowly", "holding", "backing a little"]);

    // the sky
    var omenList = SKY_OMENS[w];
    if (roll(0.18)) omenList = SKY_OMENS[clamp(w + (roll(0.5) ? 1 : -1), 0, 4)];

    var tg = state.tomorrow - w;
    var omen =
      tg > 1
        ? OMEN_WORSE[1 + Math.floor(rnd() * (OMEN_WORSE.length - 1))]
        : tg === 1
          ? pick(OMEN_WORSE)
          : tg < 0
            ? pick(OMEN_BETTER)
            : pick(OMEN_SAME);

    state.signs = {
      hpa: hpa,
      glassTrend: pick(trendPool),
      knots: knots,
      dir: dir,
      windTrend: windTrend,
      skyRead: pick(omenList),
      omen: omen,
    };
  }

  /* ------------------------------------------------------------------ *
   * logging & hud
   * ------------------------------------------------------------------ */
  function logLine(text, cls) {
    var li = document.createElement("li");
    if (cls) li.className = cls;
    li.innerHTML = "<b>day " + state.day + "</b> " + text;
    ui.log.appendChild(li);
    ui.log.scrollTop = ui.log.scrollHeight;
    while (ui.log.children.length > 40) ui.log.removeChild(ui.log.firstChild);
  }

  function aliveCount() {
    return state.boats.filter(function (b) {
      return b.alive;
    }).length;
  }

  function renderLedger() {
    ui.dayRead.textContent = "day " + Math.min(state.day, DAYS) + " of " + DAYS;
    ui.purseRead.textContent = "purse " + pounds(state.purse);
    ui.quotaRead.textContent = "quota " + pounds(QUOTA);
    var fit = aliveCount();
    ui.fleetRead.textContent = fit + " boat" + (fit === 1 ? "" : "s") + " fit";
  }

  function renderGauges() {
    var s = state.signs;
    if (!s) {
      ui.glassRead.textContent = "\u2014";
      ui.glassTrend.textContent = "\u2014";
      ui.windRead.textContent = "\u2014";
      ui.windTrend.textContent = "\u2014";
      ui.skyRead.textContent = "\u2014";
      ui.skyOmen.textContent = "\u2014";
      return;
    }
    ui.glassRead.textContent = Math.round(s.hpa) + " hPa";
    ui.glassTrend.textContent = s.glassTrend;
    ui.windRead.textContent =
      s.dir + ", " + s.knots + " kn" + (s.knots >= 28 ? " - hard" : "");
    ui.windTrend.textContent = s.windTrend;
    ui.skyRead.textContent = s.skyRead;
    ui.skyOmen.textContent = "omen: " + s.omen;
  }

  function renderFleet() {
    ui.fleetRow.innerHTML = "";
    state.boats.forEach(function (b, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "boat";
      btn.innerHTML = "<b>" + (i + 1) + "</b>" + b.name;
      btn.dataset.idx = String(i);
      if (!b.alive) {
        btn.classList.add("lost");
        btn.disabled = true;
      } else if (b.atSea) {
        btn.classList.add("at-sea");
        btn.disabled = true;
      } else if (b.ready) {
        btn.classList.add("ready");
      }
      ui.fleetRow.appendChild(btn);
    });
  }

  function anyAtSea() {
    return state.boats.some(function (b) {
      return b.atSea;
    });
  }

  function renderButtons() {
    ui.sailBtn.classList.toggle("hidden", state.phase !== "dawn");
    ui.bellBtn.classList.toggle("hidden", state.phase !== "day");
    ui.sleepBtn.classList.toggle("hidden", state.phase !== "evening");
    ui.bellBtn.disabled =
      state.recalled || state.dayT > RECALL_END || !anyAtSea();
  }

  function refresh() {
    renderLedger();
    renderFleet();
    renderButtons();
  }

  /* ------------------------------------------------------------------ *
   * phases
   * ------------------------------------------------------------------ */
  function showCard(which) {
    ui.titleCard.classList.toggle("hidden", which !== "title");
    ui.endCard.classList.toggle("hidden", which !== "end");
  }

  function beginDawn() {
    state.phase = "dawn";
    state.recalled = false;
    state.revealDone = false;
    state.dayT = 0;
    state.sunk = {};
    state.pendingLoss = [];
    state.bolts = [];
    state.flash = 0;
    state.boats.forEach(function (b) {
      b.ready = false;
      b.atSea = false;
    });
    sentFlags = [];
    planDay();
    renderGauges();
    refresh();
    logLine(
      "Dawn over Porth Annow. Glass at " +
        Math.round(state.signs.hpa) +
        " hPa. Choose your boats.",
    );
  }

  function collectSentFlags() {
    sentFlags = state.boats.map(function (b) {
      return b.alive && b.ready;
    });
  }

  function sail() {
    if (state.phase !== "dawn") return;
    var sent = [];
    state.boats.forEach(function (b) {
      if (b.alive && b.ready) {
        b.atSea = true;
        sent.push(b);
      }
    });
    if (sent.length === 0) {
      logLine("No boats made ready - the crews wait by the wall.");
      return;
    }
    state.phase = "day";
    state.recalled = false;
    state.revealDone = false;
    state.dayT = 0;
    state.pendingLoss = [];
    state.boats.forEach(function (b, i) {
      if (b.atSea && rnd() < WEATHER[state.weather].loss) {
        state.pendingLoss.push({ idx: i, at: 0.62 + i * 0.04 + rnd() * 0.14 });
      }
    });
    sfx.horn();
    sfx.setSea(WEATHER[1].sea / 24); // the bay is innocent at dawn
    logLine(
      sent.length +
        " boat" +
        (sent.length === 1 ? "" : "s") +
        " make sail for the grounds.",
    );
    refresh();
  }

  function ringBell() {
    if (state.phase !== "day" || state.recalled || state.dayT > RECALL_END)
      return;
    if (!anyAtSea()) return;
    state.recalled = true;
    sfx.bell();
    logLine(
      "The recall bell rings out - boats abandon the grounds and run for home.",
      "good-line",
    );
    renderButtons();
  }

  function resolveEvening() {
    state.phase = "evening";
    var w = WEATHER[state.weather];
    var earned = 0;
    var lostNames = [];

    state.boats.forEach(function (b) {
      if (!b.alive || !b.atSea) return;
      var take = BASE_CATCH * w.catch * (0.85 + rnd() * 0.3);
      if (state.recalled) take *= 0.4;
      earned += Math.max(1, Math.round(take));
      b.atSea = false;
    });

    state.pendingLoss.forEach(function (pl) {
      if (state.recalled) return; // the bell saved them
      var b = state.boats[pl.idx];
      if (b.alive) {
        b.alive = false;
        lostNames.push(b.name);
      }
    });

    var idleCost = 0;
    state.boats.forEach(function (b, i) {
      if (b.alive && !sentFlags[i]) idleCost += IDLE_COST;
    });
    var pension = lostNames.length * PENSION;
    state.purse += earned - idleCost - pension;

    logLine(
      "Evening: " +
        w.name +
        " worked itself out over the bay. " +
        (earned > 0
          ? "Fish sold at market: " + pounds(earned) + "."
          : "Nothing brought ashore."),
    );
    if (lostNames.length > 0) {
      lostNames.forEach(function (n) {
        logLine(
          n + " is lost " + pick(ROCKS) + " with her whole crew.",
          "lost-line",
        );
      });
    } else if (idleCost > 0) {
      logLine(
        "Bread and dues for " +
          idleCost +
          " idle boat" +
          (idleCost === 1 ? "" : "s") +
          ": " +
          pounds(-idleCost) +
          ".",
      );
    } else if (earned === 0) {
      logLine("Not a keel went out. The owners will hear of this.");
    }
    if (earned > 0 && lostNames.length === 0) sfx.coin();

    state.yesterday = state.weather;
    renderLedger();
    refresh();

    var fit = aliveCount();
    var daysLeft = DAYS - state.day;
    if (fit === 0) {
      endWeek(true, false);
      return;
    }
    if (daysLeft > 0 && state.purse + fit * 5 * daysLeft < QUOTA) {
      endWeek(false, true);
      return;
    }
    if (daysLeft > 0) {
      logLine(
        "Turn in. " +
          daysLeft +
          " dawn" +
          (daysLeft === 1 ? "" : "s") +
          " remain before the bill.",
      );
    }
  }

  function endWeek(fleetLost, hopeless) {
    state.phase = "end";
    var won = !fleetLost && !hopeless && state.purse >= QUOTA;
    var body = "";
    var fit = aliveCount();
    if (won) {
      var grade =
        state.purse >= 140
          ? "S - Legend of the Quay"
          : state.purse >= 115
            ? "A - Master of the Watch"
            : "B - The bill is paid";
      body =
        "Six dawns survived. Purse: " +
        pounds(state.purse) +
        " against the owners' " +
        pounds(QUOTA) +
        ". " +
        fit +
        " of 6 boats come home to winter refit.<br>Grade: <b>" +
        grade +
        "</b>";
      logLine(
        "The owners' clerk counts the purse, nods once, and leaves. The bill is paid.",
        "good-line",
      );
    } else if (fleetLost) {
      body =
        "Every keel is on the seabed. Porth Annow fishes no more this year.";
      logLine("The week ends in mourning.", "lost-line");
    } else if (hopeless) {
      body =
        "Even luck itself could not raise " +
        pounds(state.purse) +
        " to the owners' " +
        pounds(QUOTA) +
        ". The licence passes to another.";
      logLine("The week is arithmetically lost.", "lost-line");
    } else {
      body =
        "Six dawns gone and the purse holds only " +
        pounds(state.purse) +
        " of " +
        pounds(QUOTA) +
        ". The owners take their business up the coast.";
      logLine("The week ends badly.", "lost-line");
    }
    try {
      var raw = localStorage.getItem("falling-glass-best");
      var best = raw ? parseInt(raw, 10) : 0;
      if (state.purse > best) {
        localStorage.setItem(
          "falling-glass-best",
          String(Math.round(state.purse)),
        );
        body +=
          "<br>New best purse in the village ledger: " +
          pounds(state.purse) +
          ".";
      } else {
        body += "<br>Village best purse: " + pounds(best) + ".";
      }
    } catch (e) {
      /* storage unavailable; the sea does not mind */
    }
    ui.endTitle.textContent = won ? "The Bill Is Paid" : "A Bad Week";
    ui.endBody.innerHTML = body;
    showCard("end");
    refresh();
  }

  function restart() {
    state = freshState();
    sentFlags = [];
    ui.log.innerHTML = "";
    baroDisp = 1013;
    renderGauges();
    refresh();
    showCard("title");
  }

  function startRun() {
    restart();
    showCard(null);
    beginDawn();
  }

  /* ------------------------------------------------------------------ *
   * audio (web audio, synthesised)
   * ------------------------------------------------------------------ */
  var sfx = (function () {
    var actx = null;
    var master = null;
    var ambGain = null;
    var ambFilter = null;
    var ambLevel = 0.1;

    function ensure() {
      if (actx) return true;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        actx = new AC();
      } catch (e) {
        return false;
      }
      master = actx.createGain();
      master.gain.value = 0.9;
      master.connect(actx.destination);

      // looping sea ambience: filtered brown noise
      var len = actx.sampleRate * 3;
      var buf = actx.createBuffer(1, len, actx.sampleRate);
      var data = buf.getChannelData(0);
      var lastV = 0;
      for (var i = 0; i < len; i++) {
        var white = Math.random() * 2 - 1;
        lastV = (lastV + 0.02 * white) / 1.02;
        data[i] = lastV * 3.2;
      }
      var src = actx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      ambFilter = actx.createBiquadFilter();
      ambFilter.type = "lowpass";
      ambFilter.frequency.value = 420;
      ambGain = actx.createGain();
      ambGain.gain.value = 0.02;
      src.connect(ambFilter);
      ambFilter.connect(ambGain);
      ambGain.connect(master);
      src.start();
      return true;
    }

    function tone(freq, dur, type, vol, delay) {
      if (!ensure()) return;
      var t0 = actx.currentTime + (delay || 0);
      var o = actx.createOscillator();
      var g = actx.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }

    function noiseBurst(dur, freq, vol, delay) {
      if (!ensure()) return;
      var t0 = actx.currentTime + (delay || 0);
      var len = Math.max(1, Math.floor(actx.sampleRate * dur));
      var buf = actx.createBuffer(1, len, actx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      }
      var src = actx.createBufferSource();
      src.buffer = buf;
      var f = actx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(freq * 3, t0);
      f.frequency.exponentialRampToValueAtTime(freq, t0 + dur);
      var g = actx.createGain();
      g.gain.value = vol;
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t0);
    }

    return {
      unlock: function () {
        if (ensure() && actx.state === "suspended") actx.resume();
      },
      horn: function () {
        if (!ensure()) return;
        var t0 = actx.currentTime;
        [110, 164].forEach(function (fr, ix) {
          var o = actx.createOscillator();
          var g = actx.createGain();
          var f = actx.createBiquadFilter();
          f.type = "lowpass";
          f.frequency.value = 600;
          o.type = "sawtooth";
          o.frequency.value = fr;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(ix ? 0.06 : 0.13, t0 + 0.12);
          g.gain.setValueAtTime(ix ? 0.06 : 0.13, t0 + 0.75);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.25);
          o.connect(f);
          f.connect(g);
          g.connect(master);
          o.start(t0);
          o.stop(t0 + 1.3);
        });
      },
      bell: function () {
        [660, 652].forEach(function (fr, ix) {
          tone(fr, 1.4, "sine", 0.16, ix * 0.42);
          tone(fr * 2.76, 0.5, "sine", 0.05, ix * 0.42);
        });
      },
      coin: function () {
        tone(880, 0.12, "triangle", 0.11, 0);
        tone(1318, 0.22, "triangle", 0.11, 0.1);
      },
      toll: function () {
        tone(196, 2.2, "sine", 0.17, 0);
        tone(392, 1.2, "sine", 0.06, 0.01);
      },
      thunder: function (delay) {
        noiseBurst(1.8, 90, 0.45, delay || 0);
      },
      gull: function () {
        tone(1180, 0.09, "sawtooth", 0.03, 0);
        tone(920, 0.14, "sawtooth", 0.03, 0.11);
      },
      tick: function () {
        tone(520, 0.05, "square", 0.04, 0);
      },
      setSea: function (level) {
        ambLevel = clamp(level, 0, 1);
      },
      stepAmb: function () {
        if (!actx) return;
        var goal = state.muted ? 0 : 0.015 + ambLevel * 0.14;
        ambGain.gain.setTargetAtTime(goal, actx.currentTime, 0.4);
        ambFilter.frequency.setTargetAtTime(
          300 + ambLevel * 900,
          actx.currentTime,
          0.6,
        );
      },
      toggleMute: function () {
        state.muted = !state.muted;
        ui.soundBtn.textContent = state.muted ? "sound: off" : "sound: on";
      },
    };
  })();

  /* ------------------------------------------------------------------ *
   * scene rendering
   * ------------------------------------------------------------------ */
  var HORIZON = 300;
  var seaAmp = 4.5;
  var baroDisp = 1013;

  var clouds = [];
  (function seedClouds() {
    for (var i = 0; i < 14; i++) {
      var blobs = [];
      var n = 3 + Math.floor(rnd() * 3);
      for (var j = 0; j < n; j++) {
        blobs.push({
          dx: (j - n / 2) * 22 + rnd() * 12,
          dy: rnd() * 10 - 5,
          rx: 24 + rnd() * 26,
          ry: 10 + rnd() * 9,
        });
      }
      clouds.push({
        x: rnd() * 1100 - 100,
        y: 30 + rnd() * 170,
        s: 0.7 + rnd() * 0.9,
        v: 4 + rnd() * 9,
        blobs: blobs,
      });
    }
  })();

  var gulls = [];
  (function seedGulls() {
    for (var i = 0; i < 5; i++) {
      gulls.push({
        x: rnd() * 960,
        y: 60 + rnd() * 130,
        v: 14 + rnd() * 22,
        ph: rnd() * 7,
      });
    }
  })();

  var smoke = [];
  var splashes = [];

  function hexToRgb(h) {
    var v = parseInt(h.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function mixHex(a, b, t) {
    var ca = hexToRgb(a);
    var cb = hexToRgb(b);
    return (
      "rgb(" +
      Math.round(lerp(ca[0], cb[0], t)) +
      "," +
      Math.round(lerp(ca[1], cb[1], t)) +
      "," +
      Math.round(lerp(ca[2], cb[2], t)) +
      ")"
    );
  }

  // what the eye can see right now (severity <=1 until the noon reveal)
  function weatherNow() {
    if (!state || state.phase === "title" || state.phase === "end") return 1;
    if (state.phase === "dawn") return 1;
    if (state.phase === "day" && state.dayT < REVEAL_AT) return 1;
    return state.weather;
  }

  function drawScene(dt, nowSec) {
    var w = canvas.width;
    var h = canvas.height;
    var sev = weatherNow();
    var wp = WEATHER[sev];

    var target = wp.sea;
    seaAmp += (target - seaAmp) * Math.min(1, dt * 1.4);

    var inDay = state.phase === "day" || state.phase === "evening";
    var sunP = inDay ? state.dayT : 0.12;
    var sunX = lerp(90, 700, sunP);
    var sunY = HORIZON - 40 - Math.sin(Math.PI * clamp(sunP, 0, 1)) * 170;

    // sky
    var duskAmt = Math.pow(
      Math.abs(Math.cos(Math.PI * clamp(sunP, 0, 1))),
      1.5,
    );
    var grad = ctx.createLinearGradient(0, 0, 0, HORIZON + 30);
    grad.addColorStop(0, mixHex(wp.top, "#2c3550", duskAmt * 0.75));
    grad.addColorStop(1, mixHex(wp.bot, "#c98a52", duskAmt * 0.8));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, HORIZON + 30);

    // sun
    var sunVis = 1 - wp.cover * 0.85;
    if (sunVis > 0.08) {
      ctx.save();
      ctx.globalAlpha = sunVis;
      var sg = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 60);
      sg.addColorStop(0, "rgba(255,238,190,0.95)");
      sg.addColorStop(0.35, "rgba(255,220,150,0.5)");
      sg.addColorStop(1, "rgba(255,210,130,0)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // clouds
    var cloudAlpha = 0.25 + wp.cover * 0.6;
    clouds.forEach(function (c) {
      c.x += c.v * dt * (0.5 + wp.cover * 1.6);
      if (c.x > w + 140) c.x -= w + 280;
      ctx.save();
      ctx.globalAlpha = cloudAlpha;
      ctx.fillStyle = sev >= 3 ? "#39434c" : sev === 2 ? "#7d8894" : "#ffffff";
      c.blobs.forEach(function (bl) {
        ctx.beginPath();
        ctx.ellipse(
          c.x + bl.dx * c.s,
          c.y + bl.dy * c.s,
          bl.rx * c.s,
          bl.ry * c.s,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      });
      ctx.restore();
    });

    // lightning
    if (sev === 4 && inDay && state.dayT > REVEAL_AT) {
      if (rnd() < dt * 0.35) {
        state.flash = 1;
        sfx.thunder(0.25 + rnd() * 0.8);
        var pts = [];
        var bxL = 120 + rnd() * 560;
        var byL = 40;
        pts.push([bxL, byL]);
        while (byL < HORIZON - 20) {
          bxL += (rnd() - 0.5) * 60;
          byL += 30 + rnd() * 36;
          pts.push([bxL, byL]);
        }
        state.bolts.push({ pts: pts, life: 0.35 });
      }
    }
    state.flash = Math.max(0, state.flash - dt * 3.2);
    if (state.flash > 0) {
      ctx.fillStyle = "rgba(240,244,255," + state.flash * 0.55 + ")";
      ctx.fillRect(0, 0, w, HORIZON + 40);
    }
    state.bolts.forEach(function (bolt) {
      bolt.life -= dt;
      if (bolt.life <= 0) return;
      ctx.save();
      ctx.strokeStyle =
        "rgba(250,250,255," + clamp(bolt.life * 2.4, 0, 1) + ")";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      bolt.pts.forEach(function (p, i) {
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      });
      ctx.stroke();
      ctx.restore();
    });
    state.bolts = state.bolts.filter(function (b) {
      return b.life > 0;
    });

    // sea
    var seaGrad = ctx.createLinearGradient(0, HORIZON, 0, h);
    seaGrad.addColorStop(0, mixHex("#3d6478", "#20313d", sev / 4));
    seaGrad.addColorStop(1, mixHex("#274a5c", "#141f28", sev / 4));
    ctx.fillStyle = seaGrad;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, HORIZON);
    for (var sx = 0; sx <= w; sx += 12) {
      var wy =
        HORIZON +
        Math.sin(sx * 0.021 + nowSec * 1.1) * seaAmp * 0.4 +
        Math.sin(sx * 0.008 - nowSec * 0.7) * seaAmp * 0.6;
      ctx.lineTo(sx, wy);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // wave highlights
    ctx.strokeStyle = "rgba(230,240,245," + (0.1 + seaAmp / 90) + ")";
    ctx.lineWidth = 1.6;
    for (var band = 1; band <= 3; band++) {
      ctx.beginPath();
      for (var bx2 = 0; bx2 <= w; bx2 += 14) {
        var byy =
          HORIZON +
          band * 46 +
          band * band * 14 +
          Math.sin(bx2 * 0.02 + nowSec * (1.2 + band * 0.3)) * seaAmp * 0.5 +
          Math.sin(bx2 * 0.006 - nowSec * 0.5) * seaAmp * 0.3;
        if (byy > h + 10) continue;
        if (bx2 === 0) ctx.moveTo(bx2, byy);
        else ctx.lineTo(bx2, byy);
      }
      ctx.stroke();
    }

    // whitecaps once the sea stands up
    if (seaAmp > 10) {
      ctx.fillStyle = "rgba(245,250,252,0.75)";
      var caps = Math.floor(seaAmp * 2.2);
      for (var ci = 0; ci < caps; ci++) {
        var cx = ((ci * 173 + Math.floor(nowSec * 2) * 61) % 940) + 10;
        var cy =
          HORIZON +
          40 +
          ((ci * 97 + Math.floor(nowSec * 3) * 37) % 160) +
          Math.sin(cx * 0.02 + nowSec) * seaAmp * 0.4;
        if (cy < h - 8) {
          ctx.beginPath();
          ctx.ellipse(cx, cy, 9 + (ci % 3) * 4, 2.4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // rain
    if (wp.rain > 0 && inDay && state.dayT > REVEAL_AT - 0.08) {
      var drops = Math.floor(wp.rain * 90);
      ctx.strokeStyle = "rgba(200,215,228,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var di = 0; di < drops; di++) {
        var rx = ((di * 149 + Math.floor(nowSec * 260) * 31) % (w + 80)) - 40;
        var ry = ((di * 89 + Math.floor(nowSec * 380) * 53) % (h + 40)) - 20;
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 7, ry + 16);
      }
      ctx.stroke();
    }

    // boats working the bay
    if (inDay) drawWorkingBoats(nowSec);

    // headland, quay, cottages, mast
    drawQuay(dt, nowSec);

    // moored boats
    drawMoored(nowSec);

    // gulls in kind weather
    if (sev <= 1) {
      ctx.strokeStyle = "rgba(40,50,60,0.7)";
      ctx.lineWidth = 1.4;
      gulls.forEach(function (gl) {
        gl.x -= gl.v * dt;
        if (gl.x < -30) {
          gl.x = w + 30;
          gl.y = 60 + rnd() * 130;
        }
        var flap = Math.sin(nowSec * 7 + gl.ph) * 3.4;
        ctx.beginPath();
        ctx.moveTo(gl.x - 6, gl.y - flap * 0.4);
        ctx.quadraticCurveTo(gl.x - 2, gl.y + flap, gl.x, gl.y);
        ctx.quadraticCurveTo(
          gl.x + 2,
          gl.y + flap,
          gl.x + 6,
          gl.y - flap * 0.4,
        );
        ctx.stroke();
      });
    }

    // splashes
    splashes.forEach(function (sp) {
      sp.t += dt;
      var p = sp.t / 0.9;
      if (p >= 1) return;
      ctx.strokeStyle = "rgba(235,245,250," + (1 - p) * 0.85 + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 6 + p * 26, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 3 + p * 14, Math.PI, Math.PI * 2);
      ctx.stroke();
    });
    for (var si = splashes.length - 1; si >= 0; si--) {
      if (splashes[si].t > 0.95) splashes.splice(si, 1);
    }

    drawBarometer();
  }

  function boatScreen(i, nowSec) {
    var lane = HORIZON + 56 + ((i * 37) % 130);
    var homeX = 750 - (i % 3) * 30;
    var farX = 110 + ((i * 83) % 420);
    var p = clamp(state.dayT / 0.24, 0, 1);
    var backP = state.recalled ? clamp((state.dayT - 0.3) / 0.5, 0, 1) : 0;
    var outP = lerp(p, 0, backP);
    var x = lerp(homeX, farX, outP);
    var y =
      lane + Math.sin(nowSec * (1.1 + i * 0.13) + i) * (2 + seaAmp * 0.35);
    var lean = state.signs ? clamp(state.signs.knots / 60, 0, 1) * 0.5 : 0.2;
    return { x: x, y: y, lean: lean, sinking: state.sunk[i] || 0 };
  }

  function drawWorkingBoats(nowSec) {
    state.boats.forEach(function (b, i) {
      if (!b.atSea) return;
      if (state.sunk[i] >= 1) return;
      var pos = boatScreen(i, nowSec);
      var sink = pos.sinking;
      ctx.save();
      ctx.translate(pos.x, pos.y + sink * 16);
      ctx.rotate(pos.lean + sink * 1.1);
      ctx.globalAlpha = 1 - sink * 0.9;
      ctx.fillStyle = "#2b2016";
      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.quadraticCurveTo(0, 7, 16, 0);
      ctx.lineTo(11, -5);
      ctx.lineTo(-13, -5);
      ctx.closePath();
      ctx.fill();
      if (sink < 0.4) {
        ctx.fillStyle = "#efe6cf";
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.quadraticCurveTo(10, -16, 2, -27);
        ctx.quadraticCurveTo(-1, -16, 0, -5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawQuay(dt, nowSec) {
    // headland block
    ctx.fillStyle = "#33302b";
    ctx.beginPath();
    ctx.moveTo(690, 540);
    ctx.lineTo(700, 462);
    ctx.lineTo(780, 428);
    ctx.lineTo(960, 408);
    ctx.lineTo(960, 540);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(20,20,18,0.35)";
    ctx.lineWidth = 1;
    for (var i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(706 + i * 4, 470 + i * 15);
      ctx.lineTo(960, 416 + i * 15);
      ctx.stroke();
    }

    // quay lamp
    var lampX = 930;
    var lampY = 372;
    var flicker = 0.75 + Math.sin(nowSec * 9) * 0.08 + rnd() * 0.05;
    var lg = ctx.createRadialGradient(lampX, lampY, 2, lampX, lampY, 46);
    lg.addColorStop(0, "rgba(255,196,110," + 0.5 * flicker + ")");
    lg.addColorStop(1, "rgba(255,180,90,0)");
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(lampX, lampY, 46, 0, Math.PI * 2);
    ctx.fill();

    drawCottage(742, 424, 0.9);
    drawCottage(806, 400, 1);
    drawCottage(868, 384, 0.92);

    // chimney smoke
    if (smoke.length < 26 && rnd() < dt * 8) {
      smoke.push({
        x: 812,
        y: 352,
        vy: -(8 + rnd() * 6),
        r: 2 + rnd() * 2.5,
        life: 0,
      });
    }
    var windLean =
      state && state.signs ? clamp(state.signs.knots / 40, 0, 1.4) : 0.3;
    smoke.forEach(function (p) {
      p.life += dt;
      p.x += (2 + windLean * 14) * dt;
      p.y += p.vy * dt;
      p.r += dt * 3.4;
      if (p.life > 4 || p.x > 1060) return;
      ctx.globalAlpha = 0.28 * (1 - p.life / 4);
      ctx.fillStyle = "rgba(210,214,218,1)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    smoke = smoke.filter(function (p) {
      return p.life <= 4 && p.x < 1060;
    });

    // mast + pennant reading the wind
    var mastX = 716;
    var mastBase = 452;
    ctx.strokeStyle = "#1d1a15";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mastX, mastBase);
    ctx.lineTo(mastX, mastBase - 96);
    ctx.stroke();
    var knots = state && state.signs ? state.signs.knots : 10;
    var dirName = state && state.signs ? state.signs.dir : "westerly air";
    var blowingLeft =
      dirName.indexOf("W") >= 0 ||
      dirName.indexOf("air") >= 0 ||
      dirName.indexOf("variable") >= 0;
    var fl = Math.sin(nowSec * (4 + knots * 0.25)) * (2 + knots * 0.16);
    var flen = clamp(knots * 1.15, 8, 54);
    ctx.fillStyle = "#c8543c";
    ctx.beginPath();
    ctx.moveTo(mastX, mastBase - 94);
    if (blowingLeft) {
      ctx.quadraticCurveTo(
        mastX - flen * 0.6,
        mastBase - 90 + fl,
        mastX - flen,
        mastBase - 84 + fl * 0.4,
      );
      ctx.lineTo(mastX, mastBase - 76);
    } else {
      ctx.quadraticCurveTo(
        mastX + flen * 0.6,
        mastBase - 90 + fl,
        mastX + flen,
        mastBase - 84 + fl * 0.4,
      );
      ctx.lineTo(mastX, mastBase - 76);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawCottage(x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = "#4a443c";
    ctx.fillRect(-17, -26, 34, 26);
    ctx.fillStyle = "#5b5449";
    ctx.beginPath();
    ctx.moveTo(-21, -26);
    ctx.lineTo(0, -42);
    ctx.lineTo(21, -26);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffca7a";
    ctx.fillRect(-10, -19, 8, 8);
    ctx.fillRect(4, -19, 8, 8);
    ctx.fillStyle = "#2c2823";
    ctx.fillRect(8, -58, 7, 18);
    ctx.restore();
  }

  function drawMoored(nowSec) {
    var inDay = state.phase === "day" || state.phase === "evening";
    state.boats.forEach(function (b, i) {
      if (!b.alive) return;
      if (inDay && b.atSea) return;
      var mx = 726 + ((i * 29) % 56);
      var my = 512 + ((i * 13) % 18);
      var bob = Math.sin(nowSec * 1.4 + i * 2) * 1.6;
      ctx.save();
      ctx.translate(mx, my + bob);
      ctx.scale(0.62, 0.62);
      ctx.fillStyle = "#33281c";
      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.quadraticCurveTo(0, 7, 16, 0);
      ctx.lineTo(11, -5);
      ctx.lineTo(-13, -5);
      ctx.closePath();
      ctx.fill();
      if (b.ready && state.phase === "dawn") {
        ctx.fillStyle = "#efe6cf";
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.quadraticCurveTo(10, -16, 2, -27);
        ctx.quadraticCurveTo(-1, -16, 0, -5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawBarometer() {
    var cx = 88;
    var cy = 82;
    var r = 56;
    var shownHpa = state && state.signs ? state.signs.hpa : 1013;
    baroDisp += (shownHpa - baroDisp) * 0.06;

    ctx.save();
    ctx.fillStyle = "rgba(10,14,18,0.72)";
    ctx.beginPath();
    ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#b08a3e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#efe8d6";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    var words = ["storms", "rain", "change", "fair", "set fair"];
    ctx.fillStyle = "#3c362a";
    ctx.font = "600 9px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    words.forEach(function (word, wi) {
      var ang = ((-125 + (wi * 250) / 4) * Math.PI) / 180;
      ctx.fillText(
        word,
        cx + Math.sin(ang) * (r - 15),
        cy - Math.cos(ang) * (r - 15),
      );
    });
    ctx.strokeStyle = "#3c362a";
    ctx.lineWidth = 1;
    for (var ti = 0; ti <= 20; ti++) {
      var ang2 = ((-125 + (ti * 250) / 20) * Math.PI) / 180;
      var inner = ti % 5 === 0 ? r - 26 : r - 21;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(ang2) * inner, cy - Math.cos(ang2) * inner);
      ctx.lineTo(cx + Math.sin(ang2) * (r - 8), cy - Math.cos(ang2) * (r - 8));
      ctx.stroke();
    }
    var frac = clamp((baroDisp - 970) / 65, 0, 1);
    var na = ((-125 + frac * 250) * Math.PI) / 180;
    ctx.strokeStyle = "#8c2f22";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cx - Math.sin(na) * 8, cy + Math.cos(na) * 8);
    ctx.lineTo(cx + Math.sin(na) * (r - 24), cy - Math.cos(na) * (r - 24));
    ctx.stroke();
    ctx.fillStyle = "#8c2f22";
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3c362a";
    ctx.font = "italic 9px Georgia, serif";
    ctx.fillText("the glass", cx, cy + 26);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   * main loop
   * ------------------------------------------------------------------ */
  var lastFrame = performance.now();

  function frame(nowMs) {
    requestAnimationFrame(frame);
    var dtMs = Math.min(52, nowMs - lastFrame);
    lastFrame = nowMs;
    if (state.paused) return;
    var dt = dtMs / 1000;
    var nowSec = nowMs / 1000;

    stepDay(dt);
    drawScene(dt, nowSec);
    sfx.stepAmb();
  }

  function stepDay(dt) {
    if (state.phase !== "day") return;
    state.dayT += (dt * 1000) / state.dayLen;

    if (!state.revealDone && state.dayT >= REVEAL_AT) {
      state.revealDone = true;
      logLine("Noon: it comes on to be " + WEATHER[state.weather].name + ".");
      sfx.setSea(WEATHER[state.weather].sea / 24);
      if (state.weather >= 3) sfx.thunder(0.4);
    }

    if (state.weather <= 1 && rnd() < dt * 0.4) sfx.gull();

    state.pendingLoss.forEach(function (pl) {
      if (state.recalled) return;
      if (!state.sunk[pl.idx] && state.dayT >= pl.at) {
        state.sunk[pl.idx] = 0.0001;
        var pos = boatScreen(pl.idx, performance.now() / 1000);
        splashes.push({ x: pos.x, y: pos.y + 6, t: 0 });
        sfx.toll();
        logLine(
          state.boats[pl.idx].name + " signals trouble - then nothing.",
          "lost-line",
        );
      }
    });
    Object.keys(state.sunk).forEach(function (k) {
      var v = state.sunk[k];
      if (v > 0 && v < 1) state.sunk[k] = Math.min(1, v + dt * 0.9);
    });

    if (!state.recalled && state.dayT > RECALL_END) renderButtons();

    if (state.dayT >= 1) resolveEvening();
  }

  /* ------------------------------------------------------------------ *
   * input
   * ------------------------------------------------------------------ */
  function toggleReady(idx) {
    if (state.phase !== "dawn") return;
    var b = state.boats[idx];
    if (!b || !b.alive || b.atSea) return;
    b.ready = !b.ready;
    sfx.tick();
    refresh();
  }

  ui.fleetRow.addEventListener("click", function (ev) {
    var btn = ev.target.closest("button.boat");
    if (!btn) return;
    sfx.unlock();
    toggleReady(parseInt(btn.dataset.idx, 10));
  });
  ui.sailBtn.addEventListener("click", function () {
    sfx.unlock();
    collectSentFlags();
    sail();
  });
  ui.bellBtn.addEventListener("click", function () {
    sfx.unlock();
    ringBell();
  });
  ui.sleepBtn.addEventListener("click", nextDawn);
  ui.startBtn.addEventListener("click", function () {
    sfx.unlock();
    startRun();
  });
  ui.againBtn.addEventListener("click", function () {
    sfx.unlock();
    startRun();
  });
  ui.soundBtn.addEventListener("click", function () {
    sfx.unlock();
    sfx.toggleMute();
  });
  ui.pauseBtn.addEventListener("click", togglePause);
  ui.resetBtn.addEventListener("click", restart);

  function nextDawn() {
    if (state.phase !== "evening") return;
    state.day++;
    if (state.day > DAYS) {
      endWeek(false, false);
      return;
    }
    beginDawn();
  }

  function togglePause() {
    state.paused = !state.paused;
    ui.pauseBtn.textContent = state.paused ? "resume" : "pause";
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.repeat) return;
    var k = ev.key.toLowerCase();
    if (k >= "1" && k <= "6") {
      sfx.unlock();
      toggleReady(parseInt(k, 10) - 1);
      ev.preventDefault();
    } else if (k === "s" || k === "enter") {
      sfx.unlock();
      if (state.phase === "dawn") {
        collectSentFlags();
        sail();
      } else if (state.phase === "evening") {
        nextDawn();
      } else if (state.phase === "title" || state.phase === "end") {
        startRun();
      }
      ev.preventDefault();
    } else if (k === "b") {
      ringBell();
    } else if (k === "n") {
      nextDawn();
    } else if (k === "m") {
      sfx.toggleMute();
    } else if (k === "p") {
      togglePause();
    } else if (k === "r") {
      restart();
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && !state.paused) togglePause();
  });

  /* ------------------------------------------------------------------ *
   * boot
   * ------------------------------------------------------------------ */
  state = freshState();
  sentFlags = [];
  refresh();
  showCard("title");
  requestAnimationFrame(frame);
})();
