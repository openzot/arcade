/*
 * Changeover — a projection-booth game for the arcade.
 *
 * Saturday matinee, the Rialto, 1953. Two carbon-arc projectors, six reels,
 * one screen. Thread the standby while the other reel plays, change over the
 * instant the second cue dot reaches the gate, keep the drifting arc needles
 * trimmed and mend snapped splices before the house notices the dark.
 *
 * Everything lives in this one classic script, wrapped in an IIFE.
 */
(() => {
  "use strict";

  /* ------------------------------------------------ helpers */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const approach = (v, t, s) => v + clamp(t - v, -s, s);
  const hash01 = (i) => {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  /* ------------------------------------------------ dom */
  const cvs = document.getElementById("booth");
  const g = cvs.getContext("2d");
  const overlayEl = document.getElementById("overlay");
  const lampA = document.getElementById("lamp-a");
  const lampB = document.getElementById("lamp-b");
  const muteBtn = document.querySelector('[data-act="mute"]');

  /* Hi-DPI canvas at a fixed logical size. */
  const W = 960;
  const H = 600;
  (function sizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cvs.width = W * dpr;
    cvs.height = H * dpr;
    cvs.style.aspectRatio = W + " / " + H;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  })();

  /* ------------------------------------------------ config */
  const DUR = 42; /* seconds of film per reel */
  const THREAD_T = 2.6;
  const FIRST_CUE = 12; /* amber cue: thread the standby now */
  const PERFECT_W = 0.7; /* changeover window for a perfect swap */
  const GOOD_W = 1.8; /* still acceptable */
  const ARC_BAND = 0.34; /* green zone is |arc| <= this */
  const ARC_GUTTER = 0.94; /* past this the lamp goes out */
  const TRIM_RATE = 1.8;
  const MEND_T = 1.25;
  const GUTTER_T = 3.2;
  const TOTAL_REELS = 6;
  const DRAIN = { dark: 5.5, white: 9, broken: 4, flicker: 2.2 };
  const REGEN = 1.3;

  /* ------------------------------------------------ audio */
  let AC = null;
  let master = null;
  let clatterGain = null;
  let humGain = null;
  let muted = false;
  let audioBuf = null;

  function ensureAudio() {
    if (AC) {
      if (AC.state === "suspended") AC.resume().catch(() => {});
      return true;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      AC = new Ctx();
      master = AC.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(AC.destination);

      const buf = AC.createBuffer(1, AC.sampleRate * 1.5, AC.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      audioBuf = buf;

      const src = AC.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = AC.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 720;
      bp.Q.value = 0.8;
      clatterGain = AC.createGain();
      clatterGain.gain.value = 0;
      src.connect(bp).connect(clatterGain).connect(master);
      src.start();

      const hum = AC.createOscillator();
      hum.type = "sawtooth";
      hum.frequency.value = 48;
      const lp = AC.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 130;
      humGain = AC.createGain();
      humGain.gain.value = 0;
      hum.connect(lp).connect(humGain).connect(master);
      hum.start();
      return true;
    } catch (e) {
      AC = null;
      return false;
    }
  }
  function sfx(kind) {
    if (!ensureAudio() || !AC) return;
    const t = AC.currentTime;
    function env(node, peak, dur, attack) {
      node.gain.setValueAtTime(0.0001, t);
      node.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, peak),
        t + (attack || 0.01),
      );
      node.gain.exponentialRampToValueAtTime(0.0002, t + dur);
    }
    function burst(filterType, freq, q, peak, dur) {
      const s = AC.createBufferSource();
      s.buffer = audioBuf;
      s.loop = true;
      const f = AC.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const gn = AC.createGain();
      env(gn, peak, dur);
      s.connect(f).connect(gn).connect(master);
      s.start(t);
      s.stop(t + dur + 0.05);
    }
    function tone(type, f0, f1, peak, dur) {
      const o = AC.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const gn = AC.createGain();
      env(gn, peak, dur);
      o.connect(gn).connect(master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    switch (kind) {
      case "thunk":
        tone("sine", 150, 52, 0.5, 0.16);
        burst("lowpass", 320, 1, 0.3, 0.09);
        break;
      case "snap":
        tone("square", 1900, 900, 0.16, 0.05);
        burst("highpass", 2800, 1, 0.22, 0.07);
        break;
      case "mend":
        tone("square", 300, 620, 0.1, 0.09);
        break;
      case "err":
        tone("square", 155, 140, 0.14, 0.19);
        break;
      case "tick":
        tone("triangle", 980, 940, 0.08, 0.04);
        break;
      case "ding":
        tone("sine", 880, 884, 0.22, 0.4);
        tone("sine", 1318, 1322, 0.14, 0.5);
        break;
      case "applause":
        burst("bandpass", 520, 0.6, 0.34, 2.4);
        break;
    }
  }

  function setLoops(runningLevel, lit) {
    if (!AC) return;
    const t = AC.currentTime;
    clatterGain.gain.setTargetAtTime(runningLevel * 0.055, t, 0.06);
    humGain.gain.setTargetAtTime(lit ? 0.02 : 0, t, 0.1);
  }

  /* ------------------------------------------------ state */
  function mkProj() {
    return {
      state: "empty" /* empty | threading | ready | lit */,
      dowser: false,
      footage: 0,
      reelNo: -1,
      threadT: 0,
      arc: rand(-0.2, 0.2),
      arcTarget: rand(-0.5, 0.5),
      arcTimer: rand(1, 3),
      gutterT: 0,
      broken: false,
      runT: 0,
      mendT: 0,
      spin: rand(0, TAU),
    };
  }

  let S = null;

  function freshState(mode) {
    return {
      mode: mode,
      sel: 0,
      projs: [mkProj(), mkProj()],
      patience: 100,
      lastAssigned: -1 /* highest reel number placed on a projector */,
      curReel: -1 /* reel currently on screen */,
      filmsToLoad: TOTAL_REELS,
      cleanSec: 0,
      totalSec: 0,
      perfects: 0,
      mended: 0,
      ended: false,
      endTimer: 0,
      time: 0,
      toasts: [],
    };
  }

  function reset(mode) {
    S = freshState(mode);
    if (mode === "playing") {
      lightFirst();
      toast("Roll film!", "amber");
    } else if (mode === "title") {
      /* booth idles behind the intro card */
      S.projs[0].state = "empty";
    }
    updateLamps();
  }

  function lightFirst() {
    const p = S.projs[0];
    p.state = "lit";
    p.dowser = true;
    p.reelNo = 0;
    p.footage = DUR;
    p.arc = rand(-0.1, 0.1);
    S.lastAssigned = 0;
    S.curReel = 0;
    S.filmsToLoad = TOTAL_REELS - 1;
    S.sel = 0;
  }

  function litProj() {
    return S.projs[0].state === "lit"
      ? S.projs[0]
      : S.projs[1].state === "lit"
        ? S.projs[1]
        : null;
  }
  const otherIdx = () => (S.sel === 0 ? 1 : 0);

  function toast(text, kind) {
    S.toasts.push({ text: text, kind: kind || "plain", born: S.time });
    if (S.toasts.length > 4) S.toasts.shift();
  }

  function updateLamps() {
    lampA.classList.toggle("on", S.projs[0].state === "lit");
    lampB.classList.toggle("on", S.projs[1].state === "lit");
  }

  /* ------------------------------------------------ overlays */
  function showOverlay(html) {
    overlayEl.innerHTML = html;
    overlayEl.classList.remove("hidden");
  }
  function hideOverlay() {
    overlayEl.classList.add("hidden");
  }

  function introHTML() {
    return (
      '<div class="card">' +
      "<h2>Changeover</h2>" +
      '<p class="ov-tag">Two projectors. One screen. The picture never dies.</p>' +
      "<p>Saturday matinee at the Rialto, 1953. You are up in the booth with two carbon-arc " +
      "projectors and six reels of the feature. While one reel plays, thread the next onto the " +
      "standby &mdash; then swap them the instant the second cue dot reaches the gate. Let the " +
      "screen go white or dark for long and the house will turn on you.</p>" +
      '<ul class="howto">' +
      "<li><kbd>1</kbd> / <kbd>2</kbd> select projector A / B</li>" +
      "<li><kbd>Q</kbd> / <kbd>E</kbd> thread reel onto A / B <em>(or <kbd>T</kbd> threads the standby)</em></li>" +
      "<li><kbd>SPACE</kbd> change over &mdash; light the selected projector, douse the other</li>" +
      "<li><kbd>&larr;</kbd> / <kbd>&rarr;</kbd> trim the selected arc needle into the green</li>" +
      "<li><kbd>S</kbd> hold to mend a snapped splice &middot; <kbd>X</kbd> douse in an emergency</li>" +
      "<li><kbd>P</kbd> pause &middot; <kbd>M</kbd> sound &middot; <kbd>R</kbd> restart</li>" +
      "</ul>" +
      '<button type="button" class="big" data-oact="start">Start the show</button>' +
      '<p class="fine">Keyboard or touch &mdash; every key has an on-screen button.</p>' +
      "</div>"
    );
  }

  function gradeFor(pct) {
    if (pct >= 96) return "FLAWLESS REEL HONOUR";
    if (pct >= 88) return "FULL HOUSE";
    if (pct >= 70) return "SECOND FEATURE";
    return "THE MANAGER IS TALKING";
  }

  function winHTML() {
    const pct = Math.round((S.cleanSec / Math.max(1, S.totalSec)) * 100);
    return (
      '<div class="card">' +
      "<h2>The End</h2>" +
      '<p class="grade">' +
      gradeFor(pct) +
      "</p>" +
      '<div class="stats">' +
      "Picture integrity " +
      pct +
      "%<br>Perfect changeovers " +
      S.perfects +
      " &middot; splices mended " +
      S.mended +
      "<br>House patience left " +
      Math.round(S.patience) +
      "%</div>" +
      '<button type="button" class="big" data-oact="again">Play again</button>' +
      "</div>"
    );
  }

  function loseHTML() {
    return (
      '<div class="card">' +
      "<h2>House Lights Up</h2>" +
      "<p>Boos roll down from the balcony. The manager takes the stairs two at a " +
      "time, and somewhere under his coat is your P45.</p>" +
      '<div class="stats">You got to reel ' +
      (S.curReel + 1) +
      " of " +
      TOTAL_REELS +
      ".</div>" +
      '<button type="button" class="big" data-oact="retry">Thread up again</button>' +
      "</div>"
    );
  }

  function pauseHTML() {
    return (
      '<div class="card">' +
      "<h2>Intermission</h2>" +
      '<p class="ov-tag">The reel turns. Somewhere.</p>' +
      '<button type="button" class="big" data-oact="resume">Back to the booth</button>' +
      "</div>"
    );
  }

  /* ------------------------------------------------ actions */
  function actSelect(i) {
    if (S.mode !== "playing" || S.ended) return;
    S.sel = i;
    sfx("tick");
  }

  function actThread(i) {
    if (S.mode !== "playing" || S.ended) return;
    const p = S.projs[i];
    if (p.state === "lit") return errBuzz("It is already running.");
    if (p.state !== "empty")
      return errBuzz(
        p.state === "threading" ? "Already threading." : "Already threaded.",
      );
    if (S.filmsToLoad <= 0) return errBuzz("That was the last reel.");
    p.state = "threading";
    p.threadT = THREAD_T;
    S.lastAssigned++;
    p.reelNo = S.lastAssigned;
    p.footage = DUR;
    S.filmsToLoad--;
    toast("Threading reel " + (p.reelNo + 1) + "\u2026", "plain");
    sfx("tick");
  }

  function errBuzz(msg) {
    sfx("err");
    if (msg) toast(msg, "red");
  }

  function actChange() {
    if (S.mode !== "playing" || S.ended) return;
    const p = S.projs[S.sel];
    if (p.state === "lit" && !p.dowser) {
      p.dowser = true;
      toast("Lights up.", "plain");
      sfx("tick");
      return;
    }
    if (p.state !== "ready")
      return errBuzz(
        p.state === "lit" ? "Already lit." : "Nothing threaded there.",
      );
    const lit = litProj();
    if (lit) {
      const rem = lit.footage;
      lit.dowser = false;
      lit.state = "empty";
      lit.broken = false;
      lit.mendT = 0;
      if (rem > GOOD_W) {
        S.patience = clamp(S.patience - 3, 0, 100);
        toast("Sloppy \u2014 you cut the reel short.", "red");
      } else if (rem > PERFECT_W) {
        toast("Good changeover.", "amber");
      } else if (rem <= 0) {
        S.patience = clamp(S.patience - 2, 0, 100);
        toast("Late \u2014 the screen burned.", "red");
      } else {
        S.perfects++;
        S.patience = clamp(S.patience + 5, 0, 100);
        toast("Perfect changeover!", "green");
        sfx("ding");
      }
      sfx("thunk");
    }
    p.state = "lit";
    p.dowser = true;
    p.runT = 0;
    S.curReel = p.reelNo;
    S.sel = S.projs.indexOf(p);
    updateLamps();
  }

  function actDouse() {
    if (S.mode !== "playing" || S.ended) return;
    const p = S.projs[S.sel];
    if (p.state === "lit" && p.dowser) {
      p.dowser = false;
      toast("Doused.", "plain");
      sfx("thunk");
    } else {
      errBuzz(null);
    }
  }

  function actTrim(dir, dt) {
    const p = S.projs[S.sel];
    p.arc = clamp(p.arc + dir * TRIM_RATE * dt, -1, 1);
    p.arcTarget = approach(p.arcTarget, p.arc, 0.4 * dt);
  }

  function actPauseToggle() {
    if (S.mode === "playing") {
      S.mode = "paused";
      showOverlay(pauseHTML());
    } else if (S.mode === "paused") {
      S.mode = "playing";
      hideOverlay();
    }
  }

  function actMute() {
    muted = !muted;
    ensureAudio();
    if (master) master.gain.value = muted ? 0 : 0.9;
    muteBtn.innerHTML = muted
      ? "Sound: off <kbd>M</kbd>"
      : "Sound <kbd>M</kbd>";
  }

  function actRestart() {
    reset("playing");
    hideOverlay();
    sfx("tick");
  }

  function actStart() {
    ensureAudio();
    reset("playing");
    hideOverlay();
    sfx("thunk");
  }

  function win() {
    S.mode = "won";
    updateLamps();
    sfx("applause");
    showOverlay(winHTML());
  }

  function lose() {
    S.mode = "lost";
    updateLamps();
    sfx("err");
    setLoops(0, false);
    showOverlay(loseHTML());
  }

  /* ------------------------------------------------ update */
  function screenCondition() {
    const p = litProj();
    if (!p) return "dark";
    if (p.broken) return "broken";
    if (p.gutterT > 0) return "dark";
    if (!p.dowser) return "dark";
    if (p.footage <= 0) return "white";
    return Math.abs(p.arc) <= ARC_BAND ? "clean" : "flicker";
  }

  function update(dt) {
    S.time += dt;
    for (let i = S.toasts.length - 1; i >= 0; i--) {
      if (S.time - S.toasts[i].born > 2.4) S.toasts.splice(i, 1);
    }

    if (S.mode !== "playing") {
      setLoops(0, false);
      return;
    }
    if (S.ended) {
      setLoops(0, false);
      S.endTimer += dt;
      if (S.endTimer > 1.6) win();
      return;
    }
    S.totalSec += dt;

    /* arcs wander on both machines */
    const drift = 0.1 + Math.max(0, S.curReel) * 0.03;
    for (let i = 0; i < 2; i++) {
      const p = S.projs[i];
      p.arcTimer -= dt;
      if (p.arcTimer <= 0) {
        p.arcTarget = rand(-1, 1);
        p.arcTimer = rand(1.3, 3.2);
      }
      p.arc = approach(p.arc, p.arcTarget, drift * dt);
    }
    if (input.left) actTrim(-1, dt);
    if (input.right) actTrim(1, dt);

    /* threading, gutters, mending */
    for (let i = 0; i < 2; i++) {
      const p = S.projs[i];
      if (p.threadT > 0) {
        p.threadT -= dt;
        if (p.threadT <= 0) {
          p.state = "ready";
          p.arc = rand(-0.15, 0.15);
          toast("Reel " + (p.reelNo + 1) + " threaded and ready.", "amber");
        }
      }
      if (p.gutterT > 0) {
        p.gutterT -= dt;
        if (p.gutterT <= 0) {
          p.arc = 0;
          p.arcTarget = 0;
          toast("Arc re-struck.", "amber");
        }
      }
      if (p.broken && p.state === "lit") {
        if (i === S.sel && input.mend) {
          p.mendT += dt;
          if (p.mendT >= MEND_T) {
            p.broken = false;
            p.mendT = 0;
            S.mended++;
            toast("Splice mended. Rolling.", "green");
            sfx("mend");
          }
        } else {
          p.mendT = Math.max(0, p.mendT - dt * 1.6);
        }
      }
    }

    /* the lit machine */
    const lp = litProj();
    if (lp) {
      const running =
        !lp.broken && lp.gutterT <= 0 && lp.dowser && lp.footage > 0;
      const bright =
        lp.broken || lp.gutterT > 0 || !lp.dowser ? 0 : arcBrightness(lp);
      setLoops(running ? bright : 0, lp.dowser && lp.gutterT <= 0);

      if (!lp.broken && lp.gutterT <= 0) {
        if (Math.abs(lp.arc) > ARC_GUTTER) {
          lp.gutterT = GUTTER_T;
          toast("Arc guttered out!", "red");
          sfx("snap");
        }
      }

      if (running) {
        lp.footage -= dt;
        lp.runT += dt;
        lp.spin += dt * TAU * 2.2;
        if (
          Math.random() <
          (0.006 + Math.max(0, S.curReel) * 0.0045) * (lp.runT > 6 ? dt : 0)
        ) {
          lp.broken = true;
          lp.mendT = 0;
          toast("Splice snapped!", "red");
          sfx("snap");
        }
      }
      if (lp.footage < 0) lp.footage = 0;
    }

    /* finale: the last reel simply runs out */
    if (
      lp &&
      lp.reelNo === TOTAL_REELS - 1 &&
      lp.footage <= 0 &&
      !lp.broken &&
      lp.gutterT <= 0
    ) {
      if (S.endTimer === 0) {
        S.ended = true;
        S.endTimer = 0.0001;
        lp.dowser = false;
        toast("Clean run. Roll credits.", "green");
      }
    }

    /* audience patience */
    const cond = screenCondition();
    if (!S.ended) {
      if (cond === "clean") {
        S.cleanSec += dt;
        S.patience = clamp(S.patience + REGEN * dt, 0, 100);
      } else if (cond === "white") {
        S.patience -= DRAIN.white * dt;
      } else if (cond === "broken") {
        S.patience -= DRAIN.broken * dt;
      } else if (cond === "flicker") {
        S.cleanSec += dt * 0.35;
        S.patience -= DRAIN.flicker * dt;
      } else {
        S.patience -= DRAIN.dark * dt;
      }
      if (S.patience <= 0) {
        S.patience = 0;
        lose();
        return;
      }
    }
  }

  function arcBrightness(p) {
    let q =
      1 - clamp((Math.abs(p.arc) - ARC_BAND) / (ARC_GUTTER - ARC_BAND), 0, 1);
    q = 0.45 + 0.55 * q;
    q *= 0.95 + 0.05 * Math.sin(S.time * 43) + 0.02 * Math.sin(S.time * 91);
    return clamp(q, 0.15, 1);
  }

  /* ------------------------------------------------ film scenes */
  function scenePlains(x, w, h, t) {
    const sky = x.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#e8b56a");
    sky.addColorStop(1, "#b06a34");
    x.fillStyle = sky;
    x.fillRect(0, 0, w, h);
    x.fillStyle = "#f6dfa8";
    x.beginPath();
    x.arc(w * 0.72, h * 0.3, 26, 0, TAU);
    x.fill();
    x.fillStyle = "#5c3016";
    x.fillRect(0, h * 0.68, w, h * 0.32);
    for (let i = 0; i < 3; i++) {
      const cx2 = ((t * (34 + i * 9) + i * 210) % (w + 60)) - 30;
      const cy2 = h * 0.78 + Math.sin(t * 7 + i) * 5;
      x.strokeStyle = "#3a1d0c";
      x.lineWidth = 4;
      x.beginPath();
      x.arc(cx2, cy2, 11, 0, TAU);
      x.moveTo(cx2 - 9, cy2 - 7);
      x.lineTo(cx2 + 9, cy2 + 7);
      x.stroke();
    }
    x.fillStyle = "#33200f";
    x.fillRect(w * 0.16, h * 0.52, 10, 34);
    x.fillRect(w * 0.16 - 9, h * 0.55, 9, 8);
    x.fillRect(w * 0.16 + 10, h * 0.58, 9, 8);
  }

  function sceneTrain(x, w, h, t) {
    const sky = x.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#3a2c4e");
    sky.addColorStop(1, "#c76b3a");
    x.fillStyle = sky;
    x.fillRect(0, 0, w, h);
    for (let layer = 0; layer < 2; layer++) {
      x.fillStyle = layer === 0 ? "#4a2c33" : "#2c1620";
      x.beginPath();
      const sp = layer === 0 ? 26 : 62;
      x.moveTo(0, h);
      for (let px = 0; px <= w; px += 16) {
        x.lineTo(
          px,
          h * (layer === 0 ? 0.66 : 0.78) +
            Math.sin((px + t * sp) * 0.02 + layer * 2) * 16,
        );
      }
      x.lineTo(w, h);
      x.fill();
    }
    const ty = h * 0.84;
    x.fillStyle = "#120a0c";
    x.fillRect(w * 0.1, ty - 26, w * 0.62, 26);
    x.fillRect(w * 0.12, ty - 46, 34, 22);
    x.beginPath();
    x.arc(w * 0.135, ty - 54, 9, 0, TAU);
    x.stroke();
    x.fillStyle = "#120a0c";
    for (let i = 0; i < 4; i++) {
      const wx = w * 0.14 + i * w * 0.15;
      x.beginPath();
      x.arc(wx, ty, 9, 0, TAU);
      x.fill();
      x.fillRect(wx + 18, ty - 20, 64, 20);
    }
    for (let i = 0; i < 5; i++) {
      const age = (t * 1.4 + i * 0.31) % 1.5;
      x.fillStyle = "rgba(230,220,205," + 0.35 * (1 - age / 1.5) + ")";
      x.beginPath();
      x.arc(w * 0.135 + age * 30, ty - 58 - age * 46, 6 + age * 13, 0, TAU);
      x.fill();
    }
  }

  function sceneReef(x, w, h, t) {
    const sea = x.createLinearGradient(0, 0, 0, h);
    sea.addColorStop(0, "#2a6d7e");
    sea.addColorStop(1, "#0d2b3d");
    x.fillStyle = sea;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      x.fillStyle = "rgba(190,235,240,0.07)";
      x.beginPath();
      x.moveTo(w * (0.2 + i * 0.3), 0);
      x.lineTo(w * (0.28 + i * 0.3), 0);
      x.lineTo(w * (0.42 + i * 0.3), h);
      x.lineTo(w * (0.3 + i * 0.3), h);
      x.fill();
    }
    for (let i = 0; i < 7; i++) {
      const fy =
        h * (0.25 + hash01(i) * 0.5) + Math.sin(t * 1.6 + i * 2.1) * 12;
      const dir = i % 2 === 0 ? 1 : -1;
      const fx =
        ((((t * (26 + i * 7) * dir + i * 170) % (w + 60)) + w + 60) %
          (w + 60)) -
        30;
      x.fillStyle = i % 3 === 0 ? "#e8a83d" : "#c9d6c0";
      x.beginPath();
      x.moveTo(fx, fy);
      x.lineTo(fx + 15 * dir, fy - 6);
      x.lineTo(fx + 15 * dir, fy + 6);
      x.fill();
    }
    for (let i = 0; i < 9; i++) {
      const age = (t * 0.5 + hash01(i * 3)) % 1;
      x.strokeStyle = "rgba(220,245,250,0.4)";
      x.lineWidth = 1.5;
      x.beginPath();
      x.arc(
        w * hash01(i + 40) + Math.sin(age * 9 + i) * 8,
        h * 0.95 - age * h * 0.9,
        2 + age * 4,
        0,
        TAU,
      );
      x.stroke();
    }
    x.strokeStyle = "#123240";
    x.lineWidth = 6;
    for (let i = 0; i < 4; i++) {
      const bx = w * (0.12 + i * 0.24);
      x.beginPath();
      x.moveTo(bx, h);
      for (let sgm = 1; sgm <= 6; sgm++) {
        x.lineTo(
          bx + Math.sin(t * 1.8 + i + sgm) * 9 * (sgm / 6),
          h - sgm * (h / 7),
        );
      }
      x.stroke();
    }
  }

  function sceneRocket(x, w, h, t) {
    x.fillStyle = "#060913";
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const sx2 = hash01(i) * w;
      const sy2 = hash01(i + 99) * h;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i));
      x.fillStyle = "rgba(240,240,255," + tw * 0.9 + ")";
      x.fillRect(sx2, sy2, 2, 2);
    }
    x.fillStyle = "#c98a4b";
    x.beginPath();
    x.arc(w * 0.82, h * 0.3, 24, 0, TAU);
    x.fill();
    x.strokeStyle = "#e8cba0";
    x.lineWidth = 3;
    x.beginPath();
    x.ellipse(w * 0.82, h * 0.3, 38, 9, -0.5, 0, TAU);
    x.stroke();
    const ry = Math.max(h * 0.24, h * 0.9 - t * 14);
    const rx = w * 0.4 + Math.sin(t * 0.9) * 20;
    x.fillStyle = "#dde3ea";
    x.beginPath();
    x.moveTo(rx, ry - 30);
    x.quadraticCurveTo(rx + 13, ry - 8, rx + 13, ry + 16);
    x.lineTo(rx - 13, ry + 16);
    x.quadraticCurveTo(rx - 13, ry - 8, rx, ry - 30);
    x.fill();
    x.fillStyle = "#c23b2c";
    x.beginPath();
    x.moveTo(rx + 13, ry + 4);
    x.lineTo(rx + 26, ry + 22);
    x.lineTo(rx + 13, ry + 16);
    x.fill();
    x.beginPath();
    x.moveTo(rx - 13, ry + 4);
    x.lineTo(rx - 26, ry + 22);
    x.lineTo(rx - 13, ry + 16);
    x.fill();
    x.fillStyle = "rgba(240,170,60," + 0.6 + Math.random() * 0.4 + ")";
    x.beginPath();
    x.moveTo(rx - 7, ry + 17);
    x.lineTo(rx + 7, ry + 17);
    x.lineTo(rx, ry + 34 + Math.random() * 14);
    x.fill();
  }

  function sceneJungle(x, w, h, t) {
    x.fillStyle = "#17301c";
    x.fillRect(0, 0, w, h);
    x.fillStyle = "#204427";
    x.fillRect(0, h * 0.75, w, h * 0.25);
    for (let layer = 0; layer < 2; layer++) {
      x.fillStyle = layer === 0 ? "#2a5a30" : "#16321c";
      for (let i = 0; i < 7; i++) {
        const fx = w * ((i * 0.16 + layer * 0.08) % 1);
        x.beginPath();
        x.ellipse(
          fx,
          h * (0.2 + layer * 0.1),
          34,
          90,
          (i % 2 ? 1 : -1) * (0.5 + layer * 0.3),
          0,
          TAU,
        );
        x.fill();
      }
    }
    for (let i = 0; i < 3; i++) {
      const ax = w * (0.3 + i * 0.2);
      const ang = Math.sin(t * 1.3 + i * 1.9) * 0.5;
      x.strokeStyle = "#0e2414";
      x.lineWidth = 4;
      x.beginPath();
      x.moveTo(ax, 0);
      x.lineTo(ax + Math.sin(ang) * h * 0.5, h * 0.5);
      x.stroke();
      x.fillStyle = "#d8b04a";
      x.beginPath();
      x.arc(
        ax + Math.sin(ang) * h * 0.5,
        h * 0.5 + Math.cos(ang) * 6,
        8,
        0,
        TAU,
      );
      x.fill();
    }
    const bx = ((t * 60) % (w + 80)) - 40;
    const by = h * 0.34 + Math.sin(t * 3) * 10;
    x.fillStyle = "#e0653a";
    x.beginPath();
    x.moveTo(bx, by);
    x.lineTo(bx - 18, by - 7);
    x.lineTo(bx - 26, by);
    x.lineTo(bx - 18, by + 7);
    x.fill();
    x.beginPath();
    x.moveTo(bx + 2, by);
    x.lineTo(bx + 14, by - 5);
    x.lineTo(bx + 14, by + 5);
    x.fill();
  }

  function sceneFinale(x, w, h, t) {
    x.fillStyle = "#171017";
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2; i++) {
      const ang = Math.sin(t * 0.8 + i * 2.4) * 0.6;
      const ox = w * (0.35 + i * 0.3);
      x.save();
      x.translate(ox, 0);
      x.rotate(ang);
      const beam = x.createLinearGradient(0, 0, 0, h);
      beam.addColorStop(0, "rgba(240,225,180,0.28)");
      beam.addColorStop(1, "rgba(240,225,180,0)");
      x.fillStyle = beam;
      x.beginPath();
      x.moveTo(-14, 0);
      x.lineTo(14, 0);
      x.lineTo(70, h);
      x.lineTo(-70, h);
      x.fill();
      x.restore();
    }
    x.fillStyle = "#0c070d";
    x.fillRect(0, h * 0.8, w, h * 0.2);
    const meet = clamp(t / 9, 0, 1);
    const px1 = lerp(w * 0.18, w * 0.46, meet);
    const px2 = lerp(w * 0.82, w * 0.54, meet);
    function figure(cx2, flip) {
      x.fillStyle = "#050308";
      x.beginPath();
      x.arc(cx2, h * 0.52, 9, 0, TAU);
      x.fill();
      x.beginPath();
      x.moveTo(cx2 - 11, h * 0.82);
      x.quadraticCurveTo(cx2 - 12 * flip, h * 0.62, cx2, h * 0.6);
      x.quadraticCurveTo(cx2 + 12 * flip, h * 0.62, cx2 + 11, h * 0.82);
      x.fill();
    }
    figure(px1, 1);
    figure(px2, -1);
    const beat = 1.5 + Math.abs(Math.sin(t * 3)) * 4;
    x.fillStyle = "rgba(214,80,90," + 0.5 + meet * 0.5 + ")";
    x.beginPath();
    x.moveTo(w * 0.5, h * 0.34 + beat * 0.4);
    x.bezierCurveTo(
      w * 0.5 - 10,
      h * 0.3,
      w * 0.5 - 14,
      h * 0.36,
      w * 0.5,
      h * 0.4,
    );
    x.bezierCurveTo(
      w * 0.5 + 14,
      h * 0.36,
      w * 0.5 + 10,
      h * 0.3,
      w * 0.5,
      h * 0.34 + beat * 0.4,
    );
    x.fill();
    if (t > DUR - 2.4) {
      x.fillStyle =
        "rgba(242,228,196," + clamp((t - (DUR - 2.4)) / 1.2, 0, 1) + ")";
      x.font = "italic 42px Georgia, serif";
      x.textAlign = "center";
      x.fillText("The End", w / 2, h * 0.24);
    }
  }

  const SCENES = [
    scenePlains,
    sceneTrain,
    sceneReef,
    sceneRocket,
    sceneJungle,
    sceneFinale,
  ];

  /* ------------------------------------------------ drawing */
  const SCR = { x: 150, y: 44, w: 660, h: 180 };
  const PROJ_X = [330, 630];
  const SHELF_Y = 470;

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function draw(now) {
    g.clearRect(0, 0, W, H);
    const bgGrad = g.createRadialGradient(
      W / 2,
      H * 0.3,
      60,
      W / 2,
      H * 0.55,
      720,
    );
    bgGrad.addColorStop(0, "#1a100a");
    bgGrad.addColorStop(1, "#070403");
    g.fillStyle = bgGrad;
    g.fillRect(0, 0, W, H);

    const cond = S.mode === "title" ? "dark" : screenCondition();
    const lp = litProj();

    drawScreen(cond);
    drawBeams(lp, cond);
    drawProjectors(now);
    drawCuePanel(now);
    drawHUD();
    drawToasts();
  }

  function drawScreen(cond) {
    const { x, y, w, h } = SCR;
    g.save();
    roundRect(g, x, y, w, h, 10);
    g.clip();

    g.fillStyle = "#0b0705";
    g.fillRect(x, y, w, h);

    const lp = litProj();
    const showFilm =
      S.mode !== "title" && lp && cond !== "white" && cond !== "dark";
    if (showFilm) {
      const bright = lp.broken ? 0.8 : arcBrightness(lp);
      g.save();
      g.translate(x, y);
      g.beginPath();
      g.rect(0, 0, w, h);
      g.clip();
      SCENES[Math.max(0, lp.reelNo)](g, w, h, DUR - lp.footage);
      if (cond === "broken") {
        const px = cvs.width / W; /* device pixels per logical unit */
        for (let i = 0; i < 6; i++) {
          const sy = hash01(i * 7 + Math.floor(S.time * 9)) * h;
          const off = (Math.random() - 0.5) * 26;
          g.drawImage(
            cvs,
            (x + 0) * px,
            (y + sy) * px,
            w * px,
            10 * px,
            off,
            sy,
            w,
            10,
          );
        }
        g.fillStyle = "rgba(5,3,2,0.55)";
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#f2e4c4";
        g.font = "bold 22px Georgia, serif";
        g.textAlign = "center";
        g.fillText("PICTURE LOST \u2014 HOLD MEND", w / 2, h / 2);
      }
      g.fillStyle = "rgba(0,0,0," + (1 - bright) * 0.85 + ")";
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 0.06;
      for (let i = 0; i < 50; i++) {
        g.fillStyle = Math.random() > 0.5 ? "#fff" : "#000";
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      g.globalAlpha = 1;
      if (Math.random() < 0.05) {
        g.strokeStyle = "rgba(255,250,230,0.25)";
        g.lineWidth = 1;
        g.beginPath();
        const sxp = Math.random() * w;
        g.moveTo(sxp, 0);
        g.lineTo(sxp + rand(-6, 6), h);
        g.stroke();
      }
      g.restore();
    } else if (cond === "white") {
      g.fillStyle = "#fdf6df";
      g.fillRect(x, y, w, h);
      g.fillStyle = "#c23b2c";
      g.font = "bold 30px Georgia, serif";
      g.textAlign = "center";
      g.fillText("CHANGE OVER!", x + w / 2, y + h / 2 + 10);
    } else {
      g.fillStyle = "#050303";
      g.fillRect(x, y, w, h);
      g.fillStyle = "rgba(200,190,170,0.14)";
      g.font = "italic 17px Georgia, serif";
      g.textAlign = "center";
      g.fillText(
        S.mode === "title" ? "\u2014 the Rialto \u2014" : "screen dark",
        x + w / 2,
        y + h / 2,
      );
    }

    /* cue dots flash on the print itself */
    if (showFilm && lp.footage > 0 && lp.footage <= FIRST_CUE && !lp.broken) {
      const ph = lp.footage % 2;
      if (ph < 0.2) {
        g.fillStyle = lp.footage <= GOOD_W ? "#ff5a40" : "#ffc45e";
        g.beginPath();
        g.arc(w - 34, 30, 7, 0, TAU);
        g.fill();
      }
    }

    /* grain + vignette live over everything on the screen */
    g.fillStyle = "rgba(0,0,0,0.25)";
    const vg = g.createRadialGradient(
      x + w / 2,
      y + h / 2,
      h * 0.4,
      x + w / 2,
      y + h / 2,
      w * 0.62,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.5)");
    g.fillStyle = vg;
    g.fillRect(x, y, w, h);
    g.restore();

    g.strokeStyle = "#6b4720";
    g.lineWidth = 6;
    roundRect(g, x - 3, y - 3, w + 6, h + 6, 12);
    g.stroke();
    g.strokeStyle = "rgba(207,154,69,0.35)";
    g.lineWidth = 1;
    roundRect(g, x - 7, y - 7, w + 14, h + 14, 15);
    g.stroke();

    g.fillStyle = "rgba(154,134,99,0.7)";
    g.font = "11px Georgia, serif";
    g.textAlign = "center";
    g.fillText("\u2022  THE RIALTO  \u2022", x + w / 2, y + h + 22);
  }

  function drawBeams(lp, cond) {
    if (S.mode === "title" || !lp) return;
    const active = lp.dowser && !lp.broken && lp.gutterT <= 0;
    if (!active) return;
    const bright = cond === "white" ? 1 : arcBrightness(lp);
    const idx = S.projs.indexOf(lp);
    const cx2 = PROJ_X[idx];
    const ly = 372;
    const spread = idx === 0 ? 0.3 : 0.7;
    const bx1 = SCR.x + SCR.w * (spread - 0.22);
    const bx2 = SCR.x + SCR.w * (spread + 0.22);
    const grad = g.createLinearGradient(cx2, ly, cx2, SCR.y + SCR.h);
    grad.addColorStop(0, "rgba(255,238,200," + 0.34 * bright + ")");
    grad.addColorStop(1, "rgba(255,238,200," + 0.1 * bright + ")");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(cx2 - 13, ly);
    g.lineTo(cx2 + 13, ly);
    g.lineTo(bx2, SCR.y + SCR.h);
    g.lineTo(bx1, SCR.y + SCR.h);
    g.closePath();
    g.fill();
    for (let i = 0; i < 8; i++) {
      const tt2 = (S.time * 0.35 + hash01(i)) % 1;
      g.fillStyle =
        "rgba(255,244,214," + 0.5 * bright * Math.sin(tt2 * Math.PI) + ")";
      g.beginPath();
      g.arc(
        lerp(cx2, bx1 + (bx2 - bx1) * hash01(i + 5), tt2),
        lerp(ly, SCR.y + SCR.h, tt2),
        1.6,
        0,
        TAU,
      );
      g.fill();
    }
  }

  function drawProjectors(now) {
    g.strokeStyle = "#2c1b0e";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(60, SHELF_Y + 4);
    g.lineTo(W - 60, SHELF_Y + 4);
    g.stroke();

    for (let i = 0; i < 2; i++) {
      const p = S.projs[i];
      const cx2 = PROJ_X[i];
      const selected = i === S.sel && S.mode === "playing";

      if (selected) {
        g.strokeStyle = "rgba(207,154,69,0.65)";
        g.lineWidth = 1.5;
        g.setLineDash([5, 4]);
        roundRect(g, cx2 - 92, 296, 184, 232, 12);
        g.stroke();
        g.setLineDash([]);
      }

      /* body */
      const body = g.createLinearGradient(0, 380, 0, SHELF_Y);
      body.addColorStop(0, "#3d3129");
      body.addColorStop(1, "#211812");
      g.fillStyle = body;
      roundRect(g, cx2 - 80, 384, 160, 84, 7);
      g.fill();
      g.strokeStyle = "#57402a";
      g.lineWidth = 1.5;
      roundRect(g, cx2 - 80, 384, 160, 84, 7);
      g.stroke();
      g.fillStyle = "rgba(207,154,69,0.5)";
      g.fillRect(cx2 - 74, 392, 148, 3);

      /* lens */
      g.fillStyle =
        p.state === "lit" && p.dowser && p.gutterT <= 0 ? "#ffe9b0" : "#181008";
      roundRect(g, cx2 - 14, 366, 28, 20, 4);
      g.fill();
      g.strokeStyle = "#6b4720";
      g.lineWidth = 2;
      roundRect(g, cx2 - 14, 366, 28, 20, 4);
      g.stroke();

      /* dowser indicator */
      g.beginPath();
      g.arc(cx2 + 34, 376, 6, 0, TAU);
      g.fillStyle =
        p.state === "lit" ? (p.dowser ? "#ffd270" : "#5a4a30") : "#33241a";
      g.fill();
      g.strokeStyle = "#000";
      g.lineWidth = 1;
      g.stroke();

      /* reels */
      drawReel(cx2 - 44, 338, p, "supply", now);
      drawReel(cx2 + 48, 338, p, "takeup", now);

      /* film path */
      g.strokeStyle = "#4a3117";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx2 - 44, 338, 16, Math.PI * 0.4, Math.PI * 0.9);
      g.lineTo(cx2 - 14, 370);
      g.stroke();

      /* status + hints */
      const labels = {
        empty: ["EMPTY", "#7a684c"],
        threading: ["THREADING", "#e8a83d"],
        ready: ["READY", "#86b56a"],
        lit: ["RUNNING", "#ffd270"],
      };
      let st = labels[p.state][0];
      let col = labels[p.state][1];
      if (p.broken) {
        st = "BROKEN";
        col = "#ff5a40";
      } else if (p.gutterT > 0) {
        st = "RE-STRIKE " + p.gutterT.toFixed(0);
        col = "#ff5a40";
      }
      g.fillStyle = col;
      g.font = "bold 13px Georgia, serif";
      g.textAlign = "center";
      g.fillText(st, cx2, SHELF_Y + 24);
      g.fillStyle = "#7a684c";
      g.font = "11px Georgia, serif";
      g.fillText(
        "(" + (i + 1) + ") select \u00b7 " + (i === 0 ? "Q" : "E") + " thread",
        cx2,
        SHELF_Y + 41,
      );

      /* arc meter */
      const mw = 128;
      const mx = cx2 - mw / 2;
      const my = SHELF_Y + 52;
      g.fillStyle = "#120c08";
      roundRect(g, mx, my, mw, 13, 4);
      g.fill();
      const halfW = mw / 2;
      g.fillStyle = "rgba(134,181,106,0.4)";
      g.fillRect(
        mx + halfW - ARC_BAND * halfW,
        my + 1,
        ARC_BAND * 2 * halfW,
        11,
      );
      g.fillStyle = "rgba(216,75,50,0.25)";
      g.fillRect(mx, my + 1, (1 - ARC_GUTTER) * halfW, 11);
      g.fillRect(
        mx + mw - (1 - ARC_GUTTER) * halfW,
        my + 1,
        (1 - ARC_GUTTER) * halfW,
        11,
      );
      const nx = mx + halfW + p.arc * halfW;
      g.strokeStyle = "#f2e4c4";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(nx, my - 2);
      g.lineTo(nx, my + 15);
      g.stroke();
      g.fillStyle = "#7a684c";
      g.font = "10px Georgia, serif";
      g.textAlign = "left";
      g.fillText("ARC", mx - 30, my + 11);
      if (selected && Math.abs(p.arc) > ARC_BAND && p.state === "lit") {
        g.fillStyle = Math.sin(now * 8) > 0 ? "#ff5a40" : "rgba(255,90,64,0.3)";
        g.textAlign = "right";
        g.fillText("TRIM!", mx + mw + 34, my + 11);
      }

      /* mend bar */
      if (p.broken) {
        g.fillStyle = "rgba(216,75,50,0.3)";
        roundRect(g, cx2 - 60, 352, 120, 9, 4);
        g.fill();
        g.fillStyle = "#f2e4c4";
        g.fillRect(cx2 - 60, 352, 120 * clamp(p.mendT / MEND_T, 0, 1), 9);
      }
    }
  }

  function drawReel(rx, ry, p, which, now) {
    let frac;
    if (which === "supply") {
      frac =
        p.state === "threading" ? 1 - p.threadT / THREAD_T : p.footage / DUR;
    } else {
      frac =
        p.state === "threading" ? p.threadT / THREAD_T : 1 - p.footage / DUR;
    }
    frac = clamp(frac, 0, 1);
    const r = 13 + Math.sqrt(frac) * 33;
    g.fillStyle = "#171009";
    g.beginPath();
    g.arc(rx, ry, r, 0, TAU);
    g.fill();
    g.strokeStyle = "#8a6430";
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = "#0c0805";
    g.beginPath();
    g.arc(rx, ry, 6, 0, TAU);
    g.fill();
    if (frac > 0.02) {
      const spinning =
        p.state === "lit" && which === "supply" && p.dowser && !p.broken;
      const a = spinning ? p.spin : now * 0.15;
      g.strokeStyle = "rgba(207,154,69,0.5)";
      g.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(rx, ry);
        g.lineTo(
          rx + Math.cos(a + (k * TAU) / 3) * (r - 6),
          ry + Math.sin(a + (k * TAU) / 3) * (r - 6),
        );
        g.stroke();
      }
    }
    if (p.state === "threading") {
      g.strokeStyle = "#e8a83d";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(
        rx,
        ry,
        r + 5,
        -Math.PI / 2,
        -Math.PI / 2 + TAU * (1 - p.threadT / THREAD_T),
      );
      g.stroke();
    }
  }

  function drawCuePanel(now) {
    const cx2 = 480;
    const cy2 = 428;
    const lp = litProj();
    const remain = lp && !lp.broken ? lp.footage : Infinity;
    const standbyEmpty =
      S.filmsToLoad > 0 && S.projs.some((p) => p.state === "empty");

    function lamp(dx, colOn, colOff, label) {
      g.beginPath();
      g.arc(cx2 + dx, cy2, 9, 0, TAU);
      g.fillStyle = colOn;
      g.fill();
      g.strokeStyle = "#000";
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = "#7a684c";
      g.font = "10px Georgia, serif";
      g.textAlign = "center";
      g.fillText(label, cx2 + dx, cy2 + 24);
    }

    const amber = remain <= FIRST_CUE && Math.sin(now * 7) > -0.2;
    const red = remain <= GOOD_W && remain > 0;
    lamp(-26, amber ? "#ffb43d" : "#241a12", null, "CUE 1");
    lamp(26, red ? "#ff5a40" : "#241a12", null, "CUE 2");

    if (S.mode !== "playing" || S.ended) return;
    if (remain <= GOOD_W && remain > 0) {
      if (Math.sin(now * 10) > 0) {
        g.fillStyle = "#ff5a40";
        g.font = "bold 17px Georgia, serif";
        g.textAlign = "center";
        g.fillText("CHANGE OVER!", cx2, cy2 + 48);
      }
    } else if (remain <= FIRST_CUE && remain > 0 && standbyEmpty) {
      if (Math.sin(now * 6) > -0.3) {
        g.fillStyle = "#ffc45e";
        g.font = "bold 15px Georgia, serif";
        g.textAlign = "center";
        g.fillText("THREAD NOW  (Q / E)", cx2, cy2 + 48);
      }
    }
  }

  function drawHUD() {
    /* reel counter + footage */
    g.textAlign = "left";
    g.fillStyle = "#9a8663";
    g.font = "bold 13px Georgia, serif";
    const shown = Math.max(0, S.curReel) + 1;
    g.fillText(
      S.mode === "title"
        ? "MATINEE SOON"
        : "REEL " + shown + " / " + TOTAL_REELS,
      24,
      26,
    );
    const lp = litProj();
    if (lp) {
      g.fillStyle = "#120c08";
      roundRect(g, 110, 14, 150, 12, 4);
      g.fill();
      g.fillStyle = lp.footage <= FIRST_CUE ? "#e8a83d" : "#8a6430";
      g.fillRect(112, 16, 146 * clamp(lp.footage / DUR, 0, 1), 8);
    }

    /* patience */
    g.textAlign = "right";
    g.fillStyle = "#9a8663";
    g.font = "bold 13px Georgia, serif";
    g.fillText("HOUSE PATIENCE", W - 24, 26);
    g.fillStyle = "#120c08";
    roundRect(g, W - 264, 14, 230, 14, 5);
    g.fill();
    const pc = S.patience / 100;
    g.fillStyle = pc > 0.5 ? "#86b56a" : pc > 0.22 ? "#e8a83d" : "#d84b32";
    roundRect(g, W - 262, 16, 226 * pc, 10, 4);
    g.fill();

    /* centre stats */
    g.textAlign = "center";
    const pct = Math.round((S.cleanSec / Math.max(1, S.totalSec)) * 100) || 100;
    g.fillStyle = "#7a684c";
    g.font = "12px Georgia, serif";
    g.fillText(
      "picture " +
        (S.totalSec > 0.5 ? pct + "%" : "\u2014") +
        "  \u00b7  perfect \u00d7" +
        S.perfects,
      W / 2,
      26,
    );
  }

  function drawToasts() {
    let ty = 262;
    for (let i = 0; i < S.toasts.length; i++) {
      const t = S.toasts[i];
      const age = S.time - t.born;
      const alpha = age < 1.8 ? 1 : 1 - (age - 1.8) / 0.6;
      const cols = {
        plain: "#f2e4c4",
        red: "#ff6a50",
        amber: "#ffc45e",
        green: "#a5d18a",
      };
      g.fillStyle = cols[t.kind] || cols.plain;
      g.globalAlpha = clamp(alpha, 0, 1);
      g.font = "bold 17px Georgia, serif";
      g.textAlign = "center";
      g.fillText(t.text, W / 2, ty + i * 24);
    }
    g.globalAlpha = 1;
  }

  /* ------------------------------------------------ input */
  const input = { left: false, right: false, mend: false };
  const holdBtns = {};

  function fireAct(act, btn) {
    switch (act) {
      case "select":
        actSelect(+btn.getAttribute("data-i"));
        break;
      case "thread":
        actThread(+btn.getAttribute("data-i"));
        break;
      case "change":
        actChange();
        break;
      case "douse":
        actDouse();
        break;
      case "arc-down":
        actTrim(-1, 0.09);
        break;
      case "arc-up":
        actTrim(1, 0.09);
        break;
      case "pause":
        actPauseToggle();
        break;
      case "mute":
        actMute();
        break;
      case "restart":
        actRestart();
        break;
    }
  }

  document.querySelectorAll("[data-act]").forEach((btn) => {
    const act = btn.getAttribute("data-act");
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      ensureAudio();
      btn.dataset.pd = String(Date.now());
      if (btn.dataset.hold) {
        holdBtns[act] = true;
        if (act === "mend") input.mend = true;
      } else {
        fireAct(act, btn);
      }
    });
    function release() {
      holdBtns[act] = false;
      if (act === "mend") input.mend = false;
    }
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointerleave", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("click", (e) => {
      const pd = +btn.dataset.pd || 0;
      if (Date.now() - pd < 600) return; /* pointer already handled it */
      fireAct(act, btn);
    });
  });

  overlayEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-oact]");
    if (!btn) return;
    ensureAudio();
    const act = btn.getAttribute("data-oact");
    if (act === "start" || act === "again" || act === "retry") actStart();
    else if (act === "resume") actPauseToggle();
  });

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if ([" ", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
    ensureAudio();
    if (k === "p") return actPauseToggle();
    if (k === "m") return actMute();
    if (k === "escape") return actPauseToggle();
    if (k === "r") return actRestart();
    if (S.mode !== "playing") {
      if ((k === " " || k === "enter") && S.mode !== "paused") actStart();
      return;
    }
    switch (k) {
      case "1":
      case "a":
        actSelect(0);
        break;
      case "2":
      case "b":
        actSelect(1);
        break;
      case "q":
        actThread(0);
        break;
      case "e":
        actThread(1);
        break;
      case "t": {
        const lit = litProj();
        const standBy = lit ? (S.projs.indexOf(lit) === 0 ? 1 : 0) : S.sel;
        actThread(standBy);
        break;
      }
      case " ":
      case "enter":
        actChange();
        break;
      case "x":
      case "d":
        actDouse();
        break;
      case "s":
        input.mend = true;
        break;
      case "arrowleft":
        input.left = true;
        break;
      case "arrowright":
        input.right = true;
        break;
    }
  });

  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "s") input.mend = false;
    if (k === "arrowleft") input.left = false;
    if (k === "arrowright") input.right = false;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && S.mode === "playing") actPauseToggle();
  });

  /* ------------------------------------------------ main loop */
  let lastT = performance.now();
  function frame(nowMs) {
    const dt = Math.min((nowMs - lastT) / 1000, 0.05);
    lastT = nowMs;
    if (S.mode === "playing") update(dt);
    else {
      S.time += dt;
    }
    draw(lastT / 1000);
    requestAnimationFrame(frame);
  }

  reset("title");
  showOverlay(introHTML());
  requestAnimationFrame(frame);
})();
