/* Bad Penny — an assay office deduction puzzle.
   One coin in each batch is counterfeit (heavier or lighter, unknown).
   Weigh equal pans on a two-pan balance, read the tilts, accuse in time.
   All behaviour lives here, wrapped in one IIFE. */

(() => {
  "use strict";

  /* ============================== helpers ============================== */

  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  const randInt = (limit) => Math.floor(Math.random() * limit);

  function loadFlag(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function saveFlag(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      /* storage unavailable — play on */
    }
  }

  const ids = (list) => list.map((i) => i + 1).join(" ");

  /* =============================== sound =============================== */

  const Sound = (() => {
    let ctx = null;
    let master = null;
    let muted = loadFlag("badpenny.muted") === "1";

    function ensure() {
      if (muted) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.45;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    function tone(freq, dur, type, peak, delay, glideTo) {
      const c = ensure();
      if (!c) return;
      const t0 = c.currentTime + (delay || 0);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      if (glideTo)
        osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak || 0.15, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }

    function noise(dur, peak, cutoff, delay) {
      const c = ensure();
      if (!c) return;
      const t0 = c.currentTime + (delay || 0);
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++)
        data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource();
      src.buffer = buf;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = cutoff || 1400;
      const gain = c.createGain();
      gain.gain.value = peak || 0.15;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(t0);
    }

    return {
      ensure,
      isMuted: () => muted,
      toggleMute() {
        muted = !muted;
        saveFlag("badpenny.muted", muted ? "1" : "0");
        if (!muted) tone(880, 0.08, "triangle", 0.1);
        return muted;
      },
      suspend() {
        if (ctx && ctx.state === "running") ctx.suspend();
      },
      place() {
        tone(1500 + randInt(500), 0.07, "triangle", 0.09);
        noise(0.03, 0.04, 5200);
      },
      tick() {
        tone(1150, 0.045, "square", 0.03);
      },
      thock() {
        tone(170, 0.16, "sine", 0.28, 0, 95);
        noise(0.06, 0.1, 700);
      },
      tip(result) {
        if (result === "=") {
          tone(523, 0.22, "sine", 0.1);
          tone(523, 0.22, "sine", 0.08, 0.05);
          return;
        }
        const down = result === "L";
        tone(down ? 210 : 180, 0.5, "sawtooth", 0.035, 0, down ? 160 : 145);
        tone(150, 0.14, "sine", 0.2, 0.55, 90);
        noise(0.05, 0.08, 600, 0.55);
      },
      settle() {
        tone(740, 0.12, "triangle", 0.07, 0.62);
      },
      solve() {
        [523, 659, 784, 1047].forEach((f, i) =>
          tone(f, 0.24, "triangle", 0.11, i * 0.09),
        );
      },
      crack() {
        noise(0.28, 0.3, 900);
        tone(120, 0.32, "square", 0.11, 0, 65);
      },
      deny() {
        tone(150, 0.1, "square", 0.09);
        tone(120, 0.13, "square", 0.09, 0.11);
      },
      shuffle() {
        for (let i = 0; i < 4; i++) {
          noise(0.03, 0.05, 4800, i * 0.06);
        }
      },
    };
  })();

  /* ============================== constants ============================ */

  const CASE_LADDER = [
    { coins: 5, weighs: 3 },
    { coins: 6, weighs: 3 },
    { coins: 7, weighs: 3 },
    { coins: 8, weighs: 3 },
    { coins: 9, weighs: 3 },
    { coins: 10, weighs: 3 },
    { coins: 11, weighs: 4 },
    { coins: 12, weighs: 3 },
  ];

  const LATE_CASES = [
    { coins: 12, weighs: 4 },
    { coins: 13, weighs: 4 },
    { coins: 12, weighs: 3 },
    { coins: 13, weighs: 4 },
  ];

  const MAX_SEALS = 3;

  function specFor(caseNo) {
    if (caseNo <= CASE_LADDER.length) return CASE_LADDER[caseNo - 1];
    return LATE_CASES[(caseNo - CASE_LADDER.length - 1) % LATE_CASES.length];
  }

  /* ================================ state ============================== */

  let S = null;
  let shiftSeq = 0;

  function freshShift() {
    const bestFlag = Number(loadFlag("badpenny.best")) || 0;
    shiftSeq += 1;
    S = {
      uid: shiftSeq,
      score: 0,
      seals: MAX_SEALS,
      casesSolved: 0,
      caseNo: 1,
      best: bestFlag,
      serial: 0,
      cardOpen: false,
      cardDismissable: false,
      spec: { coins: 0, weighs: 0 },
      phase: "arrange", // arrange | anim | accuse | done
      coins: [],
      fakeIndex: 0,
      fakeHeavy: false,
      weighsLeft: 0,
      weighings: [],
      accused: -1,
      cursor: 0,
    };
    dealCase();
  }

  function dealCase() {
    const spec = specFor(S.caseNo);
    S.serial += 1;
    S.spec = spec;
    S.phase = "arrange";
    S.coins = Array.from({ length: spec.coins }, () => ({ where: "tray" }));
    S.fakeIndex = randInt(spec.coins);
    S.fakeHeavy = Math.random() < 0.5;
    S.weighsLeft = spec.weighs;
    S.weighings = [];
    S.accused = -1;
    S.cursor = 0;
    resetTilt();
  }

  // Genuine coins weigh 10; the bad penny weighs 12 or 8.
  const weightOf = (i) => (i === S.fakeIndex ? (S.fakeHeavy ? 12 : 8) : 10);
  const sideWeight = (list) => list.reduce((sum, i) => sum + weightOf(i), 0);
  const coinIdxs = (where) =>
    S.coins.map((c, i) => (c.where === where ? i : -1)).filter((i) => i >= 0);

  /* ============================== rendering ============================ */

  const rigEl = () => $("rig");

  function resetTilt() {
    rigEl().classList.remove("tip-left", "tip-right");
  }

  function setTilt(result) {
    rigEl().classList.toggle("tip-left", result === "L");
    rigEl().classList.toggle("tip-right", result === "R");
  }

  function setMessage(text, mood) {
    const v = $("verdict");
    v.textContent = text;
    v.className = mood || "";
  }

  function idleMessage() {
    if (S.cardOpen) return;
    const l = coinIdxs("left").length;
    const r = coinIdxs("right").length;
    if (S.phase === "accuse") {
      setMessage(
        S.accused < 0
          ? "Accusation: tap the guilty coin."
          : `Coin ${S.accused + 1} stands accused — swear it heavy or light.`,
        "warn",
      );
      return;
    }
    if (S.weighsLeft === 0) {
      setMessage("The scales are spent — accuse (E), or abandon the case.");
      return;
    }
    if (l === 0 && r === 0) {
      setMessage("Tap a coin: once for the left pan, again for the right.");
      return;
    }
    if (l !== r) {
      setMessage(`Uneven pans (${l} vs ${r}) — even them out to weigh.`);
      return;
    }
    setMessage(`${l} against ${l} on the beam — ready to weigh (\u21b5).`);
  }

  function fillBin(box, idxs, where) {
    box.textContent = "";
    idxs.forEach((i) => {
      const b = el("button", "coin", String(i + 1));
      b.type = "button";
      b.dataset.i = String(i);
      b.dataset.where = where;
      const bits = [`Coin ${i + 1}`];
      if (where === "left") bits.push("on the left pan");
      else if (where === "right") bits.push("on the right pan");
      else bits.push("in the tray");
      if (i === S.cursor && (S.phase === "arrange" || S.phase === "accuse"))
        b.classList.add("cursor");
      if (S.phase === "accuse" && i === S.accused) b.classList.add("picked");
      if (S.phase === "done" && i === S.fakeIndex) b.classList.add("revealed");
      b.setAttribute("aria-label", bits.join(", "));
      box.appendChild(b);
    });
    if (idxs.length === 0 && box.classList.contains("slots")) {
      box.appendChild(el("span", "slot-empty", "\u00b7\u00b7\u00b7"));
    }
  }

  function renderBoard() {
    fillBin($("tray"), coinIdxs("tray"), "tray");
    fillBin($("slots-left"), coinIdxs("left"), "left");
    fillBin($("slots-right"), coinIdxs("right"), "right");
    $("count-left").textContent = String(coinIdxs("left").length);
    $("count-right").textContent = String(coinIdxs("right").length);
    $("count-tray").textContent = String(coinIdxs("tray").length);
    syncButtons();
  }

  function renderHUD() {
    $("chip-case").textContent = `Case ${S.caseNo}`;
    $("chip-batch").textContent =
      `${S.spec.coins} coins \u00b7 ${S.weighsLeft}/${S.spec.weighs} weighings`;
    $("chip-score").textContent =
      S.best > 0
        ? `Score ${S.score} \u00b7 Best ${S.best}`
        : `Score ${S.score}`;
    const sealsBox = $("seals");
    sealsBox.textContent = "";
    for (let i = 0; i < MAX_SEALS; i++) {
      sealsBox.appendChild(
        el("span", "seal" + (i < S.seals ? "" : " cracked")),
      );
    }
    sealsBox.setAttribute(
      "aria-label",
      `${S.seals} of ${MAX_SEALS} seals intact`,
    );
  }

  function renderLedger() {
    const list = $("ledger-list");
    list.textContent = "";
    $("ledger-empty").hidden = S.weighings.length !== 0;
    S.weighings.forEach((w, n0) => {
      const li = el("li");
      li.appendChild(el("span", "lnum", `#${S.weighings.length - n0}`));
      li.appendChild(el("span", "lnums", `${ids(w.left)} vs ${ids(w.right)}`));
      const v =
        w.result === "L"
          ? ["v-l", "\u25c0 left"]
          : w.result === "R"
            ? ["v-r", "right \u25b6"]
            : ["v-b", "= level"];
      li.appendChild(el("span", "lverdict " + v[0], v[1]));
      list.appendChild(li);
    });
  }

  function renderAll() {
    renderHUD();
    renderBoard();
    renderLedger();
  }

  function syncButtons() {
    const arranging = S.phase === "arrange" && !S.cardOpen;
    const accusing = S.phase === "accuse" && !S.cardOpen;
    $("btn-weigh").disabled = !arranging;
    $("btn-clear").disabled = !arranging;
    $("btn-accuse").disabled = !(arranging || accusing);
    $("btn-accuse").innerHTML = accusing
      ? "Cancel accusation <kbd>Esc</kbd>"
      : "Accuse <kbd>E</kbd>";
    $("btn-abandon").hidden = !(arranging && S.weighsLeft === 0);
    $("btn-heavy").hidden = !(accusing && S.accused >= 0);
    $("btn-light").hidden = !(accusing && S.accused >= 0);
  }

  function saveBestIfBeaten() {
    if (S.score > S.best) {
      S.best = S.score;
      saveFlag("badpenny.best", String(S.best));
      return true;
    }
    return false;
  }

  /* ============================== overlays ============================= */

  function showCard(title, buildBody, actions, dismissable) {
    S.cardOpen = true;
    S.cardDismissable = Boolean(dismissable);
    $("card-title").textContent = title;
    const body = $("card-body");
    body.textContent = "";
    buildBody(body);
    const acts = $("card-actions");
    acts.textContent = "";
    actions.forEach((a) => {
      const btn = el(
        "button",
        "card-btn" + (a.primary ? " primary" : ""),
        a.label,
      );
      btn.type = "button";
      btn.addEventListener("click", a.fn);
      acts.appendChild(btn);
    });
    $("overlay").hidden = false;
    syncButtons();
    const first =
      acts.querySelector(".primary") || acts.querySelector("button");
    if (first) first.focus();
  }

  function closeCard() {
    S.cardOpen = false;
    S.cardDismissable = false;
    $("overlay").hidden = true;
    syncButtons();
  }

  function para(box, text) {
    box.appendChild(el("p", "", text));
  }

  function helpBody(box) {
    para(
      box,
      "Each case puts a fresh batch on your bench. Exactly one coin is counterfeit \u2014 it weighs a whisker more or less than true silver, and only the scales can say which.",
    );
    para(
      box,
      "Load equal numbers of coins on both pans and pull the beam. Left heavy, level or right heavy \u2014 every weighing is a clue, and each case allows only a few.",
    );
    para(
      box,
      "When you know \u2014 or dare \u2014 accuse: pick the coin and swear it heavy or light. A true oath pays a bounty that grows with the case number and every weighing you saved. A false oath cracks one of your three wax seals. Three cracks and you are dismissed.",
    );
    const dl = el("dl", "controls-grid");
    [
      [
        "Tap / click a coin",
        "tray \u2192 left pan \u2192 right pan \u2192 back",
      ],
      ["\u2190 / \u2192", "move the picking cursor"],
      ["A / D / S", "send the picked coin left / right / back to the tray"],
      ["Enter", "weigh (even pans only)"],
      ["E", "begin or cancel an accusation"],
      ["H / L", "swear the accused coin heavy or light"],
      ["C", "clear both pans"],
      ["M / R", "sound on/off \u00b7 restart the whole shift"],
    ].forEach((row) => {
      dl.appendChild(el("dt", "", row[0]));
      dl.appendChild(el("dd", "", row[1]));
    });
    box.appendChild(dl);
  }

  function showHelp(firstTime) {
    showCard(
      firstTime ? "Bad Penny \u2014 the assay office" : "How the office works",
      helpBody,
      [
        {
          label: firstTime ? "Begin the shift" : "Back to the bench",
          primary: true,
          fn: () => {
            closeCard();
            idleMessage();
          },
        },
      ],
      !firstTime,
    );
  }

  function showDismissed() {
    const newBest = saveBestIfBeaten();
    showCard(
      "Dismissed from the office",
      (box) => {
        para(
          box,
          "The third seal cracks. The magistrate's clerk takes your loupe, your ledger and your chair.",
        );
        const ul = el("ul");
        ul.appendChild(el("li", "", `Cases cleared: ${S.casesSolved}`));
        ul.appendChild(el("li", "", `Final score: ${S.score}`));
        ul.appendChild(
          el(
            "li",
            "",
            `Best score: ${S.best}${newBest ? " \u2014 a new best!" : ""}`,
          ),
        );
        box.appendChild(ul);
      },
      [
        {
          label: "Take the chair again",
          primary: true,
          fn: () => {
            freshShift();
            closeCard();
            renderAll();
            idleMessage();
          },
        },
      ],
    );
  }

  /* ============================ board actions ========================== */

  function afterEdit(soundIt) {
    resetTilt();
    if (soundIt) Sound.place();
    renderAll();
    idleMessage();
  }

  function onCoinClick(i) {
    if (!S || S.cardOpen) return;
    if (S.phase === "accuse") {
      S.accused = S.accused === i ? -1 : i;
      renderAll();
      idleMessage();
      return;
    }
    if (S.phase !== "arrange") return;
    const coin = S.coins[i];
    coin.where =
      coin.where === "tray" ? "left" : coin.where === "left" ? "right" : "tray";
    S.cursor = i;
    afterEdit(true);
  }

  function moveCursorCoin(dest) {
    if (!S || S.cardOpen || S.phase !== "arrange") return;
    const coin = S.coins[S.cursor];
    if (coin.where !== dest) {
      coin.where = dest;
      afterEdit(true);
    }
  }

  function clearPans() {
    if (!S || S.cardOpen || S.phase !== "arrange") return;
    let touched = false;
    S.coins.forEach((c) => {
      if (c.where !== "tray") {
        c.where = "tray";
        touched = true;
      }
    });
    afterEdit(touched);
  }

  function shakeActions() {
    const a = $("actions");
    a.classList.remove("shake");
    void a.offsetWidth;
    a.classList.add("shake");
  }

  function deny(text) {
    setMessage(text, "warn");
    Sound.deny();
    shakeActions();
  }

  function performWeigh() {
    if (!S || S.cardOpen || S.phase !== "arrange") return;
    const left = coinIdxs("left");
    const right = coinIdxs("right");
    if (left.length === 0 || right.length === 0) {
      deny("Both pans must carry coins before you weigh.");
      return;
    }
    if (left.length !== right.length) {
      deny(
        `Uneven pans (${left.length} vs ${right.length}) \u2014 the counts must match.`,
      );
      return;
    }
    const diff = sideWeight(left) - sideWeight(right);
    const result = diff > 0 ? "L" : diff < 0 ? "R" : "=";
    const serial = S.serial;
    S.phase = "anim";
    syncButtons();
    setMessage("The beam swings\u2026");
    Sound.thock();
    setTimeout(() => {
      if (!S || S.uid !== shiftSeq || S.serial !== serial) return;
      setTilt(result);
      Sound.tip(result);
    }, 150);
    setTimeout(() => {
      if (!S || S.uid !== shiftSeq || S.serial !== serial) return;
      S.weighings.unshift({ left, right, result });
      S.weighsLeft -= 1;
      S.phase = "arrange";
      let line;
      if (result === "L") {
        line =
          "Left pan sinks \u2014 the counterfeit is on the left (heavy) or the right (light).";
      } else if (result === "R") {
        line =
          "Right pan sinks \u2014 the counterfeit is on the right (heavy) or the left (light).";
      } else {
        line = `Level beams \u2014 all ${left.length + right.length} of those coins are true.`;
      }
      if (S.weighsLeft === 0) line += " The scales are spent.";
      setMessage(line);
      renderAll();
    }, 1200);
  }

  function toggleAccuse() {
    if (!S || S.cardOpen) return;
    if (S.phase === "arrange") {
      S.phase = "accuse";
      S.accused = -1;
      Sound.tick();
      renderAll();
      idleMessage();
    } else if (S.phase === "accuse") {
      S.phase = "arrange";
      S.accused = -1;
      renderAll();
      idleMessage();
    }
  }

  function confirmAccuse(kind) {
    if (!S || S.cardOpen || S.phase !== "accuse") return;
    if (S.accused < 0) {
      deny("First tap the coin you accuse.");
      return;
    }
    finishCase(S.accused, kind === "H");
  }

  function abandonCase() {
    if (!S || S.cardOpen) return;
    if (!(S.phase === "arrange" && S.weighsLeft === 0)) return;
    S.seals -= 1;
    renderHUD();
    Sound.crack();
    S.phase = "done";
    syncButtons();
    setMessage(
      `Case abandoned \u2014 a seal cracks. Coin ${S.fakeIndex + 1} was the bad penny.`,
    );
    const uid = S.uid;
    const serial = S.serial;
    setTimeout(() => {
      if (!S || S.uid !== uid || S.serial !== serial) return;
      if (S.seals > 0) {
        showCard(
          "Case abandoned",
          (box) => {
            para(
              box,
              `You set the batch aside unsolved and the clerk strikes a wax seal \u2014 ${S.seals} remain.`,
            );
            para(
              box,
              `For the record: coin ${S.fakeIndex + 1} ran ${S.fakeHeavy ? "heavy" : "light"}.`,
            );
          },
          [
            {
              label: "Fresh batch, same case",
              primary: true,
              fn: () => {
                dealCase();
                closeCard();
                renderAll();
                idleMessage();
              },
            },
          ],
        );
      } else {
        showDismissed();
      }
    }, 850);
  }

  function finishCase(accusedIdx, saidHeavy) {
    S.phase = "done";
    syncButtons();
    const correct = accusedIdx === S.fakeIndex && saidHeavy === S.fakeHeavy;
    if (correct) {
      Sound.solve();
      const base = 100;
      const caseBonus = 40 * (S.caseNo - 1);
      const spareBonus = 25 * S.weighsLeft;
      S.score += base + caseBonus + spareBonus;
      S.casesSolved += 1;
      renderHUD();
      setMessage(
        `Coin ${S.fakeIndex + 1} is ${S.fakeHeavy ? "heavy" : "light"} \u2014 a true oath.`,
        "good",
      );
      const uid = S.uid;
      const serial = S.serial;
      setTimeout(() => {
        if (!S || S.uid !== uid || S.serial !== serial) return;
        saveBestIfBeaten();
        showCard(
          "Case closed",
          (box) => {
            para(
              box,
              `You swore coin ${accusedIdx + 1} ran ${saidHeavy ? "heavy" : "light"} \u2014 and the melt proved you right.`,
            );
            const ul = el("ul");
            ul.appendChild(el("li", "", `Case bounty: ${base + caseBonus}`));
            ul.appendChild(
              el(
                "li",
                "",
                `Unused weighings \u00d7${S.weighsLeft}: +${spareBonus}`,
              ),
            );
            ul.appendChild(
              el("li", "", `Paid: ${base + caseBonus + spareBonus}`),
            );
            box.appendChild(ul);
          },
          [
            {
              label: `Next \u2014 case ${S.caseNo + 1}`,
              primary: true,
              fn: () => {
                S.caseNo += 1;
                dealCase();
                closeCard();
                renderAll();
                idleMessage();
              },
            },
          ],
        );
      }, 950);
    } else {
      Sound.crack();
      S.seals -= 1;
      renderHUD();
      setMessage(
        `A false oath \u2014 coin ${S.fakeIndex + 1} was the bad penny, and it ran ${S.fakeHeavy ? "heavy" : "light"}.`,
        "warn",
      );
      const uid = S.uid;
      const serial = S.serial;
      const sealsLeft = S.seals;
      setTimeout(() => {
        if (!S || S.uid !== uid || S.serial !== serial) return;
        if (sealsLeft > 0) {
          showCard(
            "A false oath",
            (box) => {
              para(
                box,
                `Coin ${accusedIdx + 1} stood silent in the pan. The bad penny was coin ${S.fakeIndex + 1}, and it ran ${S.fakeHeavy ? "heavy" : "light"}.`,
              );
              para(box, `A wax seal cracks. ${sealsLeft} remain.`);
            },
            [
              {
                label: "Fresh batch, same case",
                primary: true,
                fn: () => {
                  dealCase();
                  closeCard();
                  renderAll();
                  idleMessage();
                },
              },
            ],
          );
        } else {
          showDismissed();
        }
      }, 950);
    }
  }

  function restartShift() {
    freshShift();
    closeCard();
    renderAll();
    idleMessage();
    Sound.shuffle();
  }

  /* =============================== input =============================== */

  document.addEventListener("click", (ev) => {
    const coinBtn = ev.target.closest ? ev.target.closest("button.coin") : null;
    if (coinBtn) onCoinClick(Number(coinBtn.dataset.i));
  });

  document.addEventListener("keydown", (ev) => {
    const key = ev.key;
    if (key === "m" || key === "M") {
      applyMute(Sound.toggleMute());
      return;
    }
    if (key === "r" || key === "R") {
      restartShift();
      return;
    }
    if (S.cardOpen) {
      if ((key === "Escape" || key === "Esc") && S.cardDismissable) {
        closeCard();
        idleMessage();
      }
      return;
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      ev.preventDefault();
      if (S.phase !== "arrange" && S.phase !== "accuse") return;
      const n = S.coins.length;
      S.cursor =
        key === "ArrowRight" ? (S.cursor + 1) % n : (S.cursor + n - 1) % n;
      Sound.tick();
      renderBoard();
      return;
    }
    const low = key.length === 1 ? key.toLowerCase() : key;
    switch (low) {
      case "a":
        moveCursorCoin("left");
        break;
      case "d":
        moveCursorCoin("right");
        break;
      case "s":
        moveCursorCoin("tray");
        break;
      case "Enter":
        performWeigh();
        break;
      case "e":
        toggleAccuse();
        break;
      case "h":
        confirmAccuse("H");
        break;
      case "l":
        confirmAccuse("L");
        break;
      case "c":
        clearPans();
        break;
      case "Escape":
        if (S.phase === "accuse") toggleAccuse();
        break;
      default:
        break;
    }
  });

  function applyMute(muted) {
    const btn = $("btn-sound");
    btn.classList.toggle("off", muted);
    btn.setAttribute("aria-pressed", String(muted));
    btn.title = muted ? "Sound off (M)" : "Sound on (M)";
  }

  $("btn-sound").addEventListener("click", () => applyMute(Sound.toggleMute()));
  $("btn-help").addEventListener("click", () => {
    if (!S.cardOpen) showHelp(false);
  });
  $("btn-restart").addEventListener("click", restartShift);
  $("btn-clear").addEventListener("click", clearPans);
  $("btn-weigh").addEventListener("click", performWeigh);
  $("btn-accuse").addEventListener("click", toggleAccuse);
  $("btn-heavy").addEventListener("click", () => confirmAccuse("H"));
  $("btn-light").addEventListener("click", () => confirmAccuse("L"));
  $("btn-abandon").addEventListener("click", abandonCase);

  ["pointerdown", "keydown"].forEach((t) =>
    document.addEventListener(t, () => Sound.ensure(), {
      once: true,
      capture: true,
    }),
  );

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) Sound.suspend();
  });

  /* ================================ init =============================== */

  applyMute(Sound.isMuted());
  freshShift();
  renderAll();
  idleMessage();
  setMessage("The clerk sets the first batch on your bench.");
  showHelp(true);
})();
