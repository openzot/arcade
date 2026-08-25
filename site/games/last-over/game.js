/* Last Over — a village-cricket last-over chase.
 *
 * You bat. Six balls, two wickets, a target that climbs every time you win.
 * Read the delivery, choose leg or off, loft or block, and swing in time.
 *
 * Vanilla canvas + Web Audio. No dependencies, no network.
 */
(function () {
  "use strict";

  /* ---------- helpers ---------- */

  var $ = function (id) {
    return document.getElementById(id);
  };
  var clamp = function (v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  };
  var rand = function (lo, hi) {
    return lo + Math.random() * (hi - lo);
  };
  var randInt = function (lo, hi) {
    return Math.floor(rand(lo, hi + 1));
  };
  var pick = function (arr) {
    return arr[randInt(0, arr.length - 1)];
  };

  /* ---------- audio (all synthesised) ---------- */

  var AudioKit = {
    ctx: null,
    master: null,
    crowdGain: null,
    crowdFilter: null,
    excited: 0,
    muted: false,

    ensure: function () {
      if (this.ctx) {
        if (this.ctx.state === "suspended") {
          this.ctx.resume();
        }
        return true;
      }
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctx();
      } catch (e) {
        this.ctx = null;
        return false;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);

      /* crowd bed: looped noise through a bandpass */
      var len = this.ctx.sampleRate * 2;
      var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var data = buf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < len; i++) {
        var white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
      var src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      this.crowdFilter = this.ctx.createBiquadFilter();
      this.crowdFilter.type = "bandpass";
      this.crowdFilter.frequency.value = 500;
      this.crowdFilter.Q.value = 0.7;
      this.crowdGain = this.ctx.createGain();
      this.crowdGain.gain.value = 0.035;
      src.connect(this.crowdFilter);
      this.crowdFilter.connect(this.crowdGain);
      this.crowdGain.connect(this.master);
      src.start();
      return true;
    },

    setMuted: function (m) {
      this.muted = m;
      if (this.master) {
        this.master.gain.setTargetAtTime(
          m ? 0 : 0.9,
          this.ctx.currentTime,
          0.05,
        );
      }
    },

    bump: function (amount) {
      this.excited = Math.min(1, this.excited + amount);
    },

    update: function (dt) {
      if (!this.ctx) return;
      this.excited = Math.max(0, this.excited - dt * 0.35);
      var g = 0.035 + this.excited * 0.16;
      this.crowdGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.15);
      this.crowdFilter.frequency.setTargetAtTime(
        500 + this.excited * 900,
        this.ctx.currentTime,
        0.2,
      );
    },

    blip: function (freq, dur, type, vol, when) {
      if (!this.ctx) return;
      var t = this.ctx.currentTime + (when || 0);
      var o = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      o.type = type || "triangle";
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol || 0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.02);
    },

    noiseBurst: function (filterType, freq, dur, vol, when) {
      if (!this.ctx) return;
      var t = this.ctx.currentTime + (when || 0);
      var n = Math.floor(this.ctx.sampleRate * dur);
      var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      }
      var src = this.ctx.createBufferSource();
      src.buffer = buf;
      var f = this.ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      var g = this.ctx.createGain();
      g.gain.value = vol;
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(t);
    },

    crack: function (power) {
      this.noiseBurst("highpass", 1600, 0.07, 0.25 + power * 0.3);
      this.blip(150 + power * 40, 0.1, "sine", 0.22);
    },

    boundary: function () {
      this.bump(0.9);
      var self = this;
      [440, 554, 659, 880].forEach(function (fq, i) {
        self.blip(fq, 0.3, "triangle", 0.12, i * 0.09);
      });
    },

    groan: function () {
      this.bump(0.5);
      if (!this.ctx) return;
      var t = this.ctx.currentTime;
      [196, 147].forEach(function (fq, i) {
        var o = this.ctx.createOscillator();
        var g = this.ctx.createGain();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(fq, t);
        o.frequency.exponentialRampToValueAtTime(fq * 0.72, t + 0.5);
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
        o.connect(g);
        g.connect(AudioKit.master);
        o.start(t + i * 0.03);
        o.stop(t + 0.6);
      });
    },

    stumps: function () {
      this.noiseBurst("highpass", 900, 0.12, 0.4);
      this.blip(720, 0.08, "square", 0.16);
      this.blip(940, 0.08, "square", 0.14, 0.05);
      this.groan();
    },

    tick: function () {
      this.blip(880, 0.06, "square", 0.06);
    },
  };

  /* ---------- geometry ---------- */

  var cv = $("pitch");
  var ctx2d = cv.getContext("2d");
  var W = cv.width;
  var H = cv.height;
  var CX = 450;
  var CY = 322;
  var RX = 404;
  var RY = 274;
  var BAT = { x: 452, y: 442 };
  var STUMP_X = 450;
  var STUMP_Y = 436;
  var REL = { x: 450, y: 176 };
  var KEEPER = { x: 450, y: 492 };
  var IDEAL_Y = 414;
  var ZONE_HALF = 20;

  var FIELD_DEFS = [
    { a: -35, d: 0.58 },
    { a: -66, d: 0.56 },
    { a: -95, d: 0.53 },
    { a: -128, d: 0.6 },
    { a: -17, d: 0.87 },
    { a: 17, d: 0.87 },
    { a: 64, d: 0.57 },
    { a: 96, d: 0.54 },
    { a: 128, d: 0.6 },
  ];

  function fieldSpot(def) {
    var ang = ((def.a + Game.bias * 13) * Math.PI) / 180;
    var dd = def.d * (1 + Game.bias * 0.1 * Math.sin(ang));
    var x = BAT.x + Math.sin(ang) * dd * RX * 0.98;
    var y = BAT.y - Math.cos(ang) * dd * RY * 0.95;
    /* keep inside the rope */
    var nx = (x - CX) / RX;
    var ny = (y - CY) / RY;
    var rr = Math.sqrt(nx * nx + ny * ny);
    if (rr > 0.93) {
      x = CX + (nx / rr) * RX * 0.93;
      y = CY + (ny / rr) * RY * 0.93;
    }
    return { x: x, y: y };
  }

  function insideRope(x, y, shrink) {
    var s = shrink || 1;
    var nx = (x - CX) / (RX * s);
    var ny = (y - CY) / (RY * s);
    return nx * nx + ny * ny <= 1;
  }

  /* ---------- state ---------- */

  var Game = {
    state: "menu", // menu | prep | live | between | end | paused
    prev: null,
    chase: 1,
    streak: 0,
    bestStreak: 0,
    totalRuns: 0,
    target: 10,
    runs: 0,
    balls: 6,
    wkts: 2,
    level: 1,
    bias: 0,
    side: 0, // -1 leg, +1 off, 0 straight
    loftHeld: false,
    blockHeld: false,
    sub: "idle", // runup | flight | outfield
    timer: 0,
    simT: 0,
    hitTime: 0,
    swung: false,
    delivery: null,
    ball: null,
    fielders: [],
    chaser: -1,
    batSwing: 0,
    bowlerPos: { x: REL.x, y: REL.y - 60 },
    trail: [],
    parts: [],
    commentaryTimer: 0,
  };

  var els = {
    chase: $("hud-chase"),
    target: $("hud-target"),
    need: $("hud-need"),
    wkts: $("hud-wickets"),
    ball: $("hud-ball"),
    comm: $("commentary"),
    ovlStart: $("ovl-start"),
    ovlBanner: $("ovl-banner"),
    bannerTitle: $("banner-title"),
    bannerText: $("banner-text"),
    btnBanner: $("btn-banner"),
    ovlEnd: $("ovl-end"),
    endTitle: $("end-title"),
    endText: $("end-text"),
    ovlPause: $("ovl-pause"),
  };

  /* ---------- flow ---------- */

  function say(text) {
    els.comm.textContent = text;
    Game.commentaryTimer = 4.5;
  }

  function updateHud() {
    els.chase.textContent =
      "Chase " + Game.chase + (Game.streak > 0 ? " · won " + Game.streak : "");
    els.target.textContent = "Target " + Game.target;
    var need = Math.max(0, Game.target - Game.runs);
    els.need.textContent = "Need " + need + " off " + Game.balls;
    var w = "";
    for (var i = 0; i < 2; i++) {
      w += i < Game.wkts ? "●" : "○";
    }
    els.wkts.textContent = "Wickets " + w;
    els.ball.textContent = "Ball " + Math.min(6, 7 - Game.balls) + " of 6";
  }

  function showOverlay(which) {
    [els.ovlStart, els.ovlBanner, els.ovlEnd, els.ovlPause].forEach(
      function (o) {
        o.classList.add("hidden");
      },
    );
    if (which) which.classList.remove("hidden");
  }

  function showBanner(title, text, btnLabel, onNext) {
    Game.bannerNext = onNext;
    els.bannerTitle.textContent = title;
    els.bannerText.textContent = text;
    els.btnBanner.textContent = btnLabel;
    els.btnBanner.classList.remove("hidden");
    showOverlay(els.ovlBanner);
    Game.state = "prep";
    AudioKit.tick();
  }

  function targetFor(n) {
    return 7 + n * 3 + randInt(0, 2);
  }

  function placeField() {
    Game.fielders = FIELD_DEFS.map(function (def) {
      var spot = fieldSpot(def);
      return { hx: spot.x, hy: spot.y, x: spot.x, y: spot.y };
    });
  }

  function startChase(n, forcedTarget) {
    Game.chase = n;
    Game.level = n;
    Game.streak = Math.max(Game.streak, 0);
    Game.target = forcedTarget || targetFor(n);
    Game.runs = 0;
    Game.balls = 6;
    Game.wkts = 2;
    Game.bias = 0;
    Game.side = 0;
    placeField();
    updateHud();
    showBanner(
      "Chase " + n,
      "Need " +
        Game.target +
        " off six balls. Two wickets in hand. " +
        describeBowling(n),
      "Face up",
      beginBall,
    );
  }

  function describeBowling(n) {
    if (n <= 1) return "Their opener trundles in, gentle enough.";
    if (n === 2) return "The change bowler has ideas about your stumps.";
    if (n <= 4) return "The crafty spinner is on — watch the seam flick.";
    return "Their spearhead, fully warmed up. Good luck.";
  }

  function beginBall() {
    showOverlay(null);
    Game.state = "live";
    Game.sub = "runup";
    Game.timer = 0.6;
    Game.swung = false;
    Game.ball = null;
    Game.trail = [];
    Game.batSwing = 0;
    syncPads();
  }

  function makeDelivery() {
    var lv = Game.level;
    var D = Math.max(0.6, 0.95 - lv * 0.028) * rand(0.96, 1.04);
    var slower = Math.random() < Math.min(0.32, 0.06 + lv * 0.05);
    if (slower) D += 0.26;
    var straightChance = Math.min(0.5, 0.22 + lv * 0.05);
    var lineX;
    if (Math.random() < straightChance) {
      lineX = STUMP_X + rand(-6, 6);
    } else {
      lineX = STUMP_X + rand(16, 62) * (Math.random() < 0.5 ? -1 : 1);
    }
    var spin =
      Math.random() < Math.min(0.5, 0.1 + lv * 0.08)
        ? rand(24, 52) * (Math.random() < 0.5 ? -1 : 1)
        : 0;
    Game.delivery = {
      D: D,
      slower: slower,
      spin: spin,
      bounced: false,
    };
    Game.ball = {
      x: REL.x,
      y: REL.y,
      z: 0,
      vx: (lineX - REL.x) / D,
      vy: (STUMP_Y + 14 - REL.y) / D,
      airborne: false,
      slowTint: slower,
      spinTint: spin !== 0,
    };
  }

  /* ---------- the swing ---------- */

  function swing() {
    if (Game.state !== "live" || Game.sub !== "flight" || Game.swung) return;
    Game.swung = true;
    Game.batSwing = 0.001;
    var b = Game.ball;
    var u = (b.y - IDEAL_Y) / ZONE_HALF;
    var au = Math.abs(u);
    if (au > 1.7) {
      /* fresh air */
      AudioKit.noiseBurst("bandpass", 2400, 0.06, 0.1);
      return; // ball carries on; may bowl you
    }
    var q;
    if (au <= 0.3) q = 1;
    else if (au <= 0.65) q = 0.78;
    else if (au <= 1.05) q = 0.5;
    else q = 0.24; // edge

    var side = Game.side;
    var spread; // degrees off straight
    if (side === 0) {
      spread = rand(-24, 24);
    } else {
      spread = side * (52 + (u < 0 ? 18 : -10) + rand(-6, 6));
      if (au > 1.05) {
        spread = side * rand(105, 140); // edge squirts behind square
      }
    }
    var rad = (spread * Math.PI) / 180;
    var dx = Math.sin(rad);
    var dy = -Math.cos(rad);

    if (Game.blockHeld && au <= 1.05) {
      b.vx = dx * 40;
      b.vy = dy * 40 + 30;
      b.airborne = false;
      Game.hitTime = Game.simT;
      Game.sub = "outfield";
      AudioKit.crack(0.15);
      Game.bias *= 0.8;
      say(
        pick([
          "Dead-batted into the pitch. The bowler scowls.",
          "Soft hands, no run. Dot ball.",
          "Blocked. Safe, if unspectacular.",
        ]),
      );
      assignChaser();
      return;
    }

    var lofted = Game.loftHeld;
    AudioKit.crack(q);
    if (au > 1.05) {
      /* thin edge */
      b.vx = dx * rand(110, 170);
      b.vy = dy * rand(110, 170);
      b.airborne = false;
      b.z = 0;
      say("Thick edge — it squirts away. No harm done.");
      Game.hitTime = Game.simT;
      Game.sub = "outfield";
      Game.bias *= 0.8;
      assignChaser();
      return;
    }

    Game.hitTime = Game.simT;
    Game.sub = "outfield";
    b.airborne = lofted;
    if (lofted) {
      var hang = 0.95 + q * 0.6;
      var v = 150 + q * 185;
      b.vx = dx * v;
      b.vy = dy * v;
      b.z = 1;
      b.vzz = (520 * hang) / 2;
    } else {
      var vg = 235 + q * 365;
      b.vx = dx * vg;
      b.vy = dy * vg;
      b.z = 6;
      b.vzz = 90;
    }
    Game.bias = clamp(Game.bias + side * 0.35, -1, 1);
    placeField(); // captain shifts his ring toward your gap
    assignChaser();
    if (!lofted && q >= 0.99) {
      say(
        pick([
          "Middle of the bat!",
          "Creamed. The rope waits.",
          "Timed to perfection.",
        ]),
      );
    }
  }

  function assignChaser() {
    var best = -1;
    var bd = Infinity;
    Game.fielders.forEach(function (f, i) {
      var d =
        (f.x - Game.ball.x) * (f.x - Game.ball.x) +
        (f.y - Game.ball.y) * (f.y - Game.ball.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    Game.chaser = best;
  }

  /* ---------- outcomes ---------- */

  function addRuns(r, why) {
    Game.runs += r;
    Game.totalRuns += r;
    updateHud();
    endBall(false, why);
  }

  function loseWicket(howText) {
    Game.wkts--;
    say(howText);
    updateHud();
    endBall(true, null);
  }

  function endBall(wasOut, why) {
    Game.balls--;
    updateHud();
    var need = Game.target - Game.runs;
    if (need <= 0) {
      Game.streak++;
      Game.bestStreak = Math.max(Game.bestStreak, Game.streak);
      AudioKit.boundary();
      if (Game.streak >= 5) {
        finish(
          true,
          "Five chases on the bounce — the evening is yours and the " +
            "pavilion bell rings for you.",
        );
        return;
      }
      var nxt = Game.chase + 1;
      var tNext = targetFor(nxt);
      showBanner(
        "Over won!",
        "Home with " +
          need * -1 +
          " to spare. That is " +
          Game.streak +
          (Game.streak === 1 ? " chase" : " chases") +
          " on the trot. Next they send their best — need " +
          tNext +
          ".",
        "Face the next over",
        function () {
          startChase(nxt, tNext);
        },
      );
      return;
    }
    if (wasOut && Game.wkts <= 0) {
      finish(false, "All out. The pavilion applauds anyway.");
      return;
    }
    if (Game.balls <= 0) {
      finish(
        false,
        need === 1
          ? "One short. Of all the cruel ways."
          : "Overs gone, " + need + " short. The light beats you.",
      );
      return;
    }
    Game.state = "between";
    Game.sub = "idle";
    Game.timer = 1.15;
    Game.ball = null;
  }

  function finish(won, reason) {
    Game.state = "end";
    var rating;
    if (Game.streak === 0) {
      rating = "A duck in the scorebook and a lesson for Saturday.";
    } else if (Game.streak < 3) {
      rating = "The tea is poured in your honour.";
    } else if (Game.streak < 6) {
      rating = "They are naming a bench after you by the pavilion.";
    } else {
      rating = "Legend of the green. They will talk of this evening for years.";
    }
    els.endTitle.textContent = won ? "Match won!" : "Stumps.";
    els.endText.textContent =
      reason +
      " You chased down " +
      Game.streak +
      (Game.streak === 1 ? " over" : " overs") +
      " for " +
      Game.totalRuns +
      " runs this evening. Best streak " +
      Game.bestStreak +
      ". " +
      rating;
    showOverlay(els.ovlEnd);
  }

  function restartMatch() {
    Game.streak = 0;
    Game.totalRuns = 0;
    Game.parts.length = 0;
    startChase(1);
  }

  /* ---------- update ---------- */

  function update(dt) {
    Game.simT += dt;
    if (Game.commentaryTimer > 0) {
      Game.commentaryTimer -= dt;
      if (Game.commentaryTimer <= 0) {
        els.comm.textContent = "";
      }
    }
    updateParts(dt);

    if (Game.state === "between") {
      Game.timer -= dt;
      if (Game.timer <= 0) beginBall();
      return;
    }
    if (Game.state !== "live") return;

    moveFielders(dt);

    if (Game.sub === "runup") {
      Game.timer -= dt;
      var prog = 1 - Math.max(0, Game.timer) / 0.6;
      Game.bowlerPos.x = REL.x;
      Game.bowlerPos.y = REL.y - 60 + prog * 58;
      if (Game.timer <= 0) {
        makeDelivery();
        Game.sub = "flight";
        Game.delivery.t = 0;
      }
      return;
    }

    if (Game.sub === "flight") {
      var b = Game.ball;
      var d = Game.delivery;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (!d.bounced && b.y >= 396) {
        d.bounced = true;
        puff(b.x, b.y, "#d8cbaa");
        if (d.spin) {
          b.vx += d.spin;
        }
      }
      trailPush(b.x, b.y);
      /* holding block alone plays a safe dead bat in the contact zone */
      if (
        !Game.swung &&
        Game.blockHeld &&
        Math.abs(b.y - IDEAL_Y) <= ZONE_HALF * 1.4
      ) {
        Game.swung = true;
        Game.batSwing = 0.001;
        b.vx = rand(-25, 25);
        b.vy = rand(15, 45);
        b.airborne = false;
        b.z = 0;
        Game.hitTime = Game.simT;
        Game.sub = "outfield";
        AudioKit.crack(0.15);
        say(
          pick([
            "Dead-batted into the pitch. The bowler scowls.",
            "Soft hands, no run. Dot ball.",
            "Blocked. Safe, if unspectacular.",
          ]),
        );
        Game.bias *= 0.8;
        assignChaser();
        return;
      }
      /* past the bat without a shot */

      if (b.y > STUMP_Y + 2 && !b.airborne && Game.swung === false) {
        if (Math.abs(b.x - STUMP_X) < 11) {
          smashStumps();
          loseWicket("Through the gate — timber! Your off stump cartwheels.");
        } else {
          Game.ball = null;
          say(
            pick([
              "Beaten! Past the outside edge, a gasp round the ground.",
              "Wrong’un entirely. The keeper takes it clean.",
              "Shouldered arms. Wise, perhaps.",
            ]),
          );
          addRuns(0, "quiet");
        }
        return;
      }
      if (Game.swung && b.y > STUMP_Y + 30) {
        /* whiffed but survived */
        Game.ball = null;
        say("Swung early, hit nothing. The keeper claps twice.");
        addRuns(0, "quiet");
        return;
      }
      return;
    }

    if (Game.sub === "outfield") {
      stepOutfield(dt);
    }
  }

  function moveFielders(dt) {
    Game.fielders.forEach(function (f, i) {
      if (i === Game.chaser && Game.sub === "outfield") return;
      var dx = f.hx - f.x;
      var dy = f.hy - f.y;
      var d = Math.hypot(dx, dy);
      if (d > 1) {
        var mv = Math.min(d, 70 * dt);
        f.x += (dx / d) * mv;
        f.y += (dy / d) * mv;
      }
    });
  }

  function trailPush(x, y) {
    Game.trail.push({ x: x, y: y });
    if (Game.trail.length > 9) Game.trail.shift();
  }

  function stepOutfield(dt) {
    var b = Game.ball;

    if (b.airborne) {
      b.vzz -= 520 * dt;
      b.z += b.vzz * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      trailPush(b.x, b.y - b.z);
      /* catch check while descending low enough */
      if (b.vzz < 0 && b.z < 84) {
        for (var i = 0; i < Game.fielders.length; i++) {
          var f = Game.fielders[i];
          var dd = Math.hypot(f.x - b.x, f.y - b.y);
          if (dd < 34) {
            f.diving = 0.5;
            puff(f.x, f.y, "#ffffff");
            AudioKit.groan();
            loseWicket(
              pick([
                "Up goes the ball... and down comes the catch. Gone.",
                "Straight to the man. He makes it look easy.",
                "Skied it. The fielder calls for it and takes it.",
              ]),
            );
            return;
          }
        }
      }
      if (b.z <= 0) {
        b.z = 0;
        b.airborne = false;
        puff(b.x, b.y, "#cfc39e");
        b.vx *= 0.6;
        b.vy *= 0.6;
        assignChaser();
      }
    } else {
      var sp = Math.hypot(b.vx, b.vy);
      if (sp > 4) {
        var drag = 300 * dt;
        var ns = Math.max(0, sp - drag);
        b.vx = (b.vx / sp) * ns;
        b.vy = (b.vy / sp) * ns;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (Game.simT % 0.1 < dt) trailPush(b.x, b.y);
      } else {
        b.vx = 0;
        b.vy = 0;
      }
      /* fielder chases */
      if (Game.chaser >= 0) {
        var c = Game.fielders[Game.chaser];
        var cd = Math.hypot(c.x - b.x, c.y - b.y);
        var fs = 112 + Game.level * 6;
        if (cd > 13) {
          c.x += ((b.x - c.x) / cd) * fs * dt;
          c.y += ((b.y - c.y) / cd) * fs * dt;
        } else {
          var runsDone = Math.floor((Game.simT - Game.hitTime) / 1.55);
          var r = clamp(runsDone, 0, 3);
          if (r > 0) {
            say(r + (r === 1 ? " run hustled." : " runs, good running."));
            addRuns(r, "quiet");
          } else {
            say(
              pick([
                "Cut off in the ring. No run.",
                "Straight to the fielder. Dot ball pressure builds.",
                "Well fielded. Nothing given away.",
              ]),
            );
            addRuns(0, "quiet");
          }
          return;
        }
      }
    }

    /* rope check */
    if (!insideRope(b.x, b.y, 1)) {
      var six = b.airborne || b.z > 4;
      if (six) {
        spark(b.x, b.y);
        AudioKit.boundary();
        say(
          pick([
            "That is OUT of the ground. SIX!",
            "Launched over the ropes — six more!",
            "Flat and huge. Six, no doubt.",
          ]),
        );
        addRuns(6, "loud");
      } else {
        spark(b.x, b.y);
        AudioKit.boundary();
        say(
          pick([
            "Beat the chase to the rope. Four!",
            "Races away to the boundary. Four runs.",
            "Find the gap and it races — four!",
          ]),
        );
        addRuns(4, "loud");
      }
    }
  }

  /* ---------- particles ---------- */

  function puff(x, y, color) {
    for (var i = 0; i < 5; i++) {
      Game.parts.push({
        x: x,
        y: y,
        vx: rand(-30, 30),
        vy: rand(-30, 10),
        life: rand(0.3, 0.6),
        t: 0,
        size: rand(2, 5),
        color: color,
      });
    }
  }

  function spark(x, y) {
    for (var i = 0; i < 14; i++) {
      Game.parts.push({
        x: x,
        y: y,
        vx: rand(-90, 90),
        vy: rand(-110, -20),
        life: rand(0.4, 0.8),
        t: 0,
        size: rand(1.5, 3.5),
        color: Math.random() < 0.5 ? "#d9a441" : "#f3e9d2",
      });
    }
  }

  function smashStumps() {
    for (var i = 0; i < 10; i++) {
      Game.parts.push({
        x: STUMP_X + rand(-6, 6),
        y: STUMP_Y,
        vx: rand(-120, 120),
        vy: rand(-190, -60),
        life: rand(0.4, 0.8),
        t: 0,
        size: rand(2, 4),
        color: "#e8dcc0",
      });
    }
  }

  function updateParts(dt) {
    for (var i = Game.parts.length - 1; i >= 0; i--) {
      var p = Game.parts[i];
      p.t += dt;
      if (p.t >= p.life) {
        Game.parts.splice(i, 1);
        continue;
      }
      p.vy += 260 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /* ---------- rendering ---------- */

  function drawPlayer(x, y, shirt, trim) {
    ctx2d.fillStyle = "rgba(0,0,0,0.28)";
    ctx2d.beginPath();
    ctx2d.ellipse(x + 4, y + 6, 6, 3.4, 0, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.fillStyle = shirt;
    ctx2d.strokeStyle = "rgba(0,0,0,0.45)";
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath();
    ctx2d.arc(x, y, 7, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.stroke();
    ctx2d.fillStyle = trim;
    ctx2d.beginPath();
    ctx2d.arc(x, y - 3.5, 3.4, 0, Math.PI * 2);
    ctx2d.fill();
  }

  function render() {
    /* out-of-ground surround */
    ctx2d.fillStyle = "#152b1b";
    ctx2d.fillRect(0, 0, W, H);

    /* the square */
    var grad = ctx2d.createRadialGradient(CX, CY - 60, 40, CX, CY, RX * 1.05);
    grad.addColorStop(0, "#3d6b41");
    grad.addColorStop(0.6, "#2f5735");
    grad.addColorStop(1, "#234527");
    ctx2d.fillStyle = grad;
    ctx2d.beginPath();
    ctx2d.ellipse(CX, CY, RX, RY, 0, 0, Math.PI * 2);
    ctx2d.fill();

    /* mown stripes */
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.ellipse(CX, CY, RX, RY, 0, 0, Math.PI * 2);
    ctx2d.clip();
    ctx2d.fillStyle = "rgba(255,255,255,0.045)";
    for (var sy = CY - RY; sy < CY + RY; sy += 44) {
      ctx2d.fillRect(CX - RX, sy, RX * 2, 22);
    }
    /* long evening tree shadows */
    ctx2d.fillStyle = "rgba(10,20,12,0.16)";
    ctx2d.beginPath();
    ctx2d.moveTo(CX - RX, CY + RY * 0.55);
    ctx2d.lineTo(CX - RX * 0.2, CY + RY);
    ctx2d.lineTo(CX - RX, CY + RY);
    ctx2d.closePath();
    ctx2d.fill();
    ctx2d.beginPath();
    ctx2d.moveTo(CX + RX, CY - RY * 0.2);
    ctx2d.lineTo(CX + RX * 0.45, CY - RY);
    ctx2d.lineTo(CX + RX, CY - RY);
    ctx2d.closePath();
    ctx2d.fill();

    /* sight screens */
    ctx2d.fillStyle = "#efe7cf";
    ctx2d.fillRect(CX - 26, CY - RY + 8, 52, 14);
    ctx2d.fillRect(CX - 26, CY + RY - 22, 52, 14);
    ctx2d.restore();

    /* boundary rope */
    ctx2d.strokeStyle = "rgba(243,233,210,0.85)";
    ctx2d.lineWidth = 3;
    ctx2d.setLineDash([10, 9]);
    ctx2d.beginPath();
    ctx2d.ellipse(CX, CY, RX - 7, RY - 7, 0, 0, Math.PI * 2);
    ctx2d.stroke();
    ctx2d.setLineDash([]);

    /* pitch */
    ctx2d.fillStyle = "#c9b178";
    roundRect(CX - 37, 152, 74, 320, 8);
    ctx2d.fill();
    ctx2d.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(CX - 20, 230, 40, 170, 10);
    ctx2d.fill();
    ctx2d.strokeStyle = "rgba(255,255,255,0.75)";
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath();
    ctx2d.moveTo(CX - 30, 432);
    ctx2d.lineTo(CX + 30, 432);
    ctx2d.moveTo(CX - 30, 182);
    ctx2d.lineTo(CX + 30, 182);
    ctx2d.stroke();

    /* stumps */
    drawStumps(STUMP_X, STUMP_Y);
    drawStumps(REL.x, 184);

    /* umpire */
    drawPlayer(CX - 34, 162, "#efe7cf", "#222");

    /* keeper */
    drawPlayer(KEEPER.x, KEEPER.y, "#20386b", "#d9a441");

    /* fielders */
    Game.fielders.forEach(function (f) {
      drawPlayer(f.x, f.y, "#20386b", "#d9a441");
      if (f.diving > 0) {
        f.diving -= 0.016;
      }
    });

    /* bowler */
    if (
      Game.sub === "runup" ||
      Game.state !== "live" ||
      Game.sub === "flight"
    ) {
      drawPlayer(Game.bowlerPos.x, Game.bowlerPos.y, "#20386b", "#d9a441");
    }

    /* batsman + bat */
    var bs = Game.batSwing;
    var batAng;
    if (bs > 0) {
      bs = Math.min(1, bs + 0.12);
      Game.batSwing = bs;
      batAng = -0.7 + bs * 2.4;
    } else {
      batAng = -0.7 + Math.sin(Game.simT * 2.2) * 0.06;
    }
    var bx = BAT.x + 8;
    var by = BAT.y;
    ctx2d.save();
    ctx2d.translate(bx, by);
    ctx2d.rotate(batAng);
    ctx2d.strokeStyle = "#e8dcc0";
    ctx2d.lineWidth = 5;
    ctx2d.lineCap = "round";
    ctx2d.beginPath();
    ctx2d.moveTo(0, 0);
    ctx2d.lineTo(0, -26);
    ctx2d.stroke();
    ctx2d.restore();
    drawPlayer(BAT.x, BAT.y, "#e8dcc0", "#b8452e");

    /* side marker */
    if (Game.side !== 0) {
      ctx2d.fillStyle = "rgba(217,164,65,0.85)";
      var mx = BAT.x + Game.side * 26;
      var my = BAT.y - 18;
      ctx2d.beginPath();
      ctx2d.moveTo(mx, my - 5);
      ctx2d.lineTo(mx + Game.side * 7, my);
      ctx2d.lineTo(mx, my + 5);
      ctx2d.closePath();
      ctx2d.fill();
    }

    /* ball trail */
    if (Game.ball && Game.sub === "flight") {
      Game.trail.forEach(function (tp, i) {
        ctx2d.fillStyle =
          "rgba(184,69,46," + (i / Game.trail.length) * 0.35 + ")";
        ctx2d.beginPath();
        ctx2d.arc(tp.x, tp.y, 3, 0, Math.PI * 2);
        ctx2d.fill();
      });
    }

    /* ball */
    if (Game.ball) {
      var bb = Game.ball;
      var dyUp = bb.z || 0;
      /* shadow */
      ctx2d.fillStyle =
        "rgba(0,0,0," + clamp(0.32 - dyUp / 500, 0.1, 0.32) + ")";
      ctx2d.beginPath();
      ctx2d.ellipse(
        bb.x,
        bb.y + 3,
        5 - dyUp / 90,
        2.6 - dyUp / 200,
        0,
        0,
        Math.PI * 2,
      );
      ctx2d.fill();
      var col = "#c23b28";
      if (bb.slowTint) col = "#a05261";
      if (bb.spinTint && Game.sub === "flight") col = "#d4a03c";
      ctx2d.fillStyle = col;
      ctx2d.beginPath();
      ctx2d.arc(bb.x, bb.y - dyUp, 5, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.strokeStyle = "rgba(255,255,255,0.55)";
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.arc(bb.x, bb.y - dyUp, 5, 0.4, 1.8);
      ctx2d.stroke();
    }

    /* particles */
    Game.parts.forEach(function (p) {
      ctx2d.globalAlpha = 1 - p.t / p.life;
      ctx2d.fillStyle = p.color;
      ctx2d.beginPath();
      ctx2d.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx2d.fill();
    });
    ctx2d.globalAlpha = 1;
  }

  function drawStumps(x, y) {
    ctx2d.strokeStyle = "#e8dcc0";
    ctx2d.lineWidth = 2.4;
    [-5, 0, 5].forEach(function (off) {
      ctx2d.beginPath();
      ctx2d.moveTo(x + off, y - 12);
      ctx2d.lineTo(x + off, y + 2);
      ctx2d.stroke();
    });
    ctx2d.beginPath();
    ctx2d.moveTo(x - 6, y - 12.5);
    ctx2d.lineTo(x + 6, y - 12.5);
    ctx2d.stroke();
  }

  function roundRect(x, y, w, h, r) {
    ctx2d.beginPath();
    ctx2d.moveTo(x + r, y);
    ctx2d.arcTo(x + w, y, x + w, y + h, r);
    ctx2d.arcTo(x + w, y + h, x, y + h, r);
    ctx2d.arcTo(x, y + h, x, y, r);
    ctx2d.arcTo(x, y, x + w, y, r);
    ctx2d.closePath();
  }

  /* ---------- input ---------- */

  function setSide(s) {
    Game.side = s;
    syncPads();
    if (AudioKit.ensure()) AudioKit.tick();
  }

  function sideFromAttr(v) {
    return v === "leg" ? -1 : v === "off" ? 1 : 0;
  }

  function syncPads() {
    document.querySelectorAll(".pad[data-shot]").forEach(function (btn) {
      var s = sideFromAttr(btn.getAttribute("data-shot"));
      btn.classList.toggle("on", s === Game.side);
    });
    document.querySelectorAll(".pad[data-mod]").forEach(function (btn) {
      var m = btn.getAttribute("data-mod");
      var on = m === "loft" ? Game.loftHeld : Game.blockHeld;
      btn.classList.toggle("on", on);
    });
  }

  function primaryAction() {
    if (Game.state === "menu") {
      showOverlay(null);
      startChase(1);
      return;
    }
    if (Game.state === "prep") {
      if (Game.bannerNext) {
        var fn = Game.bannerNext;
        Game.bannerNext = null;
        fn();
      }
      return;
    }
    if (Game.state === "end") {
      restartMatch();
      return;
    }
    if (Game.state === "live") {
      swing();
    }
  }

  function togglePause() {
    if (Game.state === "paused") {
      Game.state = Game.prev || "live";
      showOverlay(null);
      return;
    }
    if (
      Game.state === "live" ||
      Game.state === "between" ||
      Game.state === "prep"
    ) {
      Game.prev = Game.state;
      Game.state = "paused";
      showOverlay(els.ovlPause);
    }
  }

  function toggleSound() {
    AudioKit.ensure();
    AudioKit.setMuted(!AudioKit.muted);
    $("btn-sound").textContent = "Sound: " + (AudioKit.muted ? "off" : "on");
  }

  function isButtonFocused() {
    var el = document.activeElement;
    return !!(el && el.tagName === "BUTTON" && el.offsetParent !== null);
  }

  document.addEventListener("keydown", function (ev) {
    var k = ev.key;
    if (
      k === " " ||
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === "ArrowUp" ||
      k === "ArrowDown"
    ) {
      ev.preventDefault();
    }
    if (isButtonFocused() && (k === " " || k === "Enter")) {
      return; // let the button handle itself
    }
    if (k === "p" || k === "P") {
      togglePause();
      return;
    }
    if (k === "m" || k === "M") {
      toggleSound();
      return;
    }
    if (k === "r" || k === "R") {
      if (Game.state !== "menu") restartMatch();
      return;
    }
    AudioKit.ensure();
    if (k === "ArrowLeft" || k === "a" || k === "A") {
      setSide(-1);
    } else if (k === "ArrowRight" || k === "d" || k === "D") {
      setSide(1);
    } else if (k === "ArrowUp" || k === "w" || k === "W") {
      Game.loftHeld = true;
      Game.blockHeld = false;
      syncPads();
    } else if (k === "ArrowDown" || k === "s" || k === "S") {
      Game.blockHeld = true;
      Game.loftHeld = false;
      syncPads();
    } else if (k === " " || k === "Enter") {
      primaryAction();
    }
  });

  document.addEventListener("keyup", function (ev) {
    var k = ev.key;
    if (k === "ArrowUp" || k === "w" || k === "W") {
      Game.loftHeld = false;
      syncPads();
    } else if (k === "ArrowDown" || k === "s" || k === "S") {
      Game.blockHeld = false;
      syncPads();
    }
  });

  document.querySelectorAll(".pad[data-shot]").forEach(function (btn) {
    btn.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      AudioKit.ensure();
      setSide(sideFromAttr(btn.getAttribute("data-shot")));
    });
  });

  document.querySelectorAll(".pad[data-mod]").forEach(function (btn) {
    var m = btn.getAttribute("data-mod");
    btn.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      AudioKit.ensure();
      if (m === "loft") {
        Game.loftHeld = true;
        Game.blockHeld = false;
      } else {
        Game.blockHeld = true;
        Game.loftHeld = false;
      }
      syncPads();
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (evt) {
      btn.addEventListener(evt, function () {
        if (m === "loft") Game.loftHeld = false;
        else Game.blockHeld = false;
        syncPads();
      });
    });
  });
  $("pad-swing").addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    AudioKit.ensure();
    primaryAction();
  });

  $("btn-start").addEventListener("click", function () {
    AudioKit.ensure();
    showOverlay(null);
    startChase(1);
  });
  els.btnBanner.addEventListener("click", function () {
    if (Game.bannerNext) {
      var fn = Game.bannerNext;
      Game.bannerNext = null;
      fn();
    }
  });
  $("btn-again").addEventListener("click", function () {
    restartMatch();
  });
  $("btn-resume").addEventListener("click", function () {
    togglePause();
  });
  $("btn-pause").addEventListener("click", togglePause);
  $("btn-sound").addEventListener("click", toggleSound);
  $("btn-restart").addEventListener("click", function () {
    restartMatch();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && Game.state === "live") {
      togglePause();
    }
  });

  /* ---------- main loop ---------- */

  var lastTs = 0;
  function frame(ts) {
    var dt = Math.min(0.033, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    if (Game.state !== "paused") {
      update(dt);
    }
    AudioKit.update(dt);
    render();
    requestAnimationFrame(frame);
  }

  placeField();
  updateHud();
  showOverlay(els.ovlStart);
  requestAnimationFrame(frame);
})();
