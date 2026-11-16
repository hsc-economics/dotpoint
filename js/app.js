// Dotpoint: the interface. All facts come from data/*.js; all calculations from js/logic.js.
(function () {
  "use strict";

  const L = globalThis.DP_LOGIC;
  const SY = globalThis.DP_SYLLABUS;
  const EV = globalThis.DP_EVIDENCE;
  const ST = globalThis.DP_STATS;
  const QS = globalThis.DP_QUESTIONS || [];
  const CONFIG = globalThis.DP_CONFIG || {};
  const REPO = /^[\w.-]+\/[\w.-]+$/.test(CONFIG.repo || "") ? CONFIG.repo : "";
  // The GitHub form for suggesting examples and statistics, or "" when no repository is set.
  const SUGGEST_URL = REPO ? `https://github.com/${REPO}/issues/new?template=suggest-evidence.yml` : "";

  const now = new Date();
  const TODAY_ISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const TODAY = L.parseISO(TODAY_ISO);

  const deck = L.buildDeck(SY, EV, ST);
  const dpIndex = L.dotpointIndex(SY);
  const evById = Object.fromEntries(EV.map((e) => [e.id, e]));
  // The Examples page and search also list the news reports collected automatically (see tools/update_news.py)
  const NEWS_EV = L.newsReports(globalThis.DP_NEWS_ARCHIVE, dpIndex);
  const ALL_EV = EV.concat(NEWS_EV);
  const EV_PAGE = 30;
  const indById = Object.fromEntries(ST.indicators.map((i) => [i.id, i]));
  const VIEWS = ["today", "syllabus", "evidence", "stats", "resources", "drills", "essay"];
  // Official past papers and study resources, collected daily by tools/update_resources.py
  const RES = globalThis.DP_RESOURCES || { items: [] };
  const STATUS_LABEL = { none: "Unsure", shaky: "Getting there", confident: "Confident" };

  const ui = {
    view: "today", year: 11, openDp: null, homeQuery: "", sort: "new",
    query: "", fFocus: "all", fType: "all", fFresh: "all", openEv: {},
    statSel: null, statRange: "5", statTable: false,
    drill: null,
  };

  // ---------- small DOM helpers ----------

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "dataset") Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const SVGNS = "http://www.w3.org/2000/svg";
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
    for (const kid of kids) if (kid) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }

  function $(id) { return document.getElementById(id); }

  // A row of short facts, spaced apart rather than joined with separators.
  function meta(cls, ...parts) {
    return h("span", { class: cls }, parts.flat().filter((p) => p !== null && p !== undefined && p !== false && p !== "").map((p) => h("span", null, p)));
  }

  // The confidence marker for a dot point: empty ring, half filled or filled.
  function mark(st) {
    return h("span", { class: "mark m-" + st, "aria-hidden": "true" });
  }

  // ---------- motion: short transitions, none when the viewer prefers reduced motion ----------

  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Run fn once the browser has drawn the current state, so a CSS transition has a starting point.
  // The timer is a fallback for when animation frames are paused (a hidden tab or frame).
  const nextFrame = (fn) => {
    let ran = false;
    const run = () => { if (!ran) { ran = true; fn(); } };
    requestAnimationFrame(() => requestAnimationFrame(run));
    setTimeout(run, 80);
  };

  // A panel that slides open: <div class="reveal"><div class="reveal-inner">content</div></div>
  function revealBox(content, attrs, animate) {
    const box = h("div", { ...attrs, class: "reveal" + (animate ? "" : " is-open") }, h("div", { class: "reveal-inner" }, content));
    if (animate) nextFrame(() => { void box.offsetHeight; box.classList.add("is-open"); });
    return box;
  }

  // Slide a revealBox closed, then remove it.
  function collapseBox(box) {
    if (!box) return;
    if (reducedMotion()) { box.remove(); return; }
    let gone = false;
    const done = () => { if (!gone) { gone = true; box.remove(); } };
    box.classList.remove("is-open");
    box.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 350);
  }

  // A short Web Animations API movement (no CSS keyframes). Does nothing when motion is reduced.
  function motion(el, frames, opts) {
    if (!el || reducedMotion() || typeof el.animate !== "function") return null;
    return el.animate(frames, opts);
  }

  const DOT_COLOURS = ["var(--hl)", "var(--ink)", "var(--good)", "var(--hl)"];

  // Little dots that burst out from a point on the screen, then fade.
  function dotBurst(x, y, count) {
    if (reducedMotion()) return;
    const layer = h("div", { class: "fx-layer", "aria-hidden": "true" });
    document.body.append(layer);
    for (let i = 0; i < (count || 10); i++) {
      const size = 4 + Math.random() * 5;
      const dot = h("span", { class: "fx-dot", style: `left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${DOT_COLOURS[i % DOT_COLOURS.length]}` });
      layer.append(dot);
      const angle = (Math.PI * 2 * i) / (count || 10) + Math.random() * 0.5;
      const dist = 22 + Math.random() * 26;
      motion(dot, [
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0.2)`, opacity: 0 },
      ], { duration: 520 + Math.random() * 200, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" });
    }
    setTimeout(() => layer.remove(), 900);
  }

  // A shower of dots falling across the whole screen: the celebration.
  function dotShower(count) {
    if (reducedMotion()) return;
    const layer = h("div", { class: "fx-layer", "aria-hidden": "true" });
    document.body.append(layer);
    const n = count || 36;
    for (let i = 0; i < n; i++) {
      const size = 6 + Math.random() * 14;
      const dot = h("span", { class: "fx-dot", style: `left:${Math.random() * 100}vw;top:-24px;width:${size}px;height:${size}px;background:${DOT_COLOURS[i % DOT_COLOURS.length]}` });
      layer.append(dot);
      const drift = (Math.random() - 0.5) * 120;
      motion(dot, [
        { transform: "translate(0, 0)", opacity: 1 },
        { transform: `translate(${drift}px, calc(100vh + 48px))`, opacity: 0.9 },
      ], { duration: 1400 + Math.random() * 1200, delay: Math.random() * 500, easing: "cubic-bezier(.45,.05,.75,.6)", fill: "forwards" });
    }
    setTimeout(() => layer.remove(), 3400);
  }

  // The opening moment, once per visit: three dot points are jotted down like notes, their lines
  // pull back, the three dots slide together into one yellow dot, a pen circles it, and that circled
  // dot flies into the logo while the paper closes in around it. A click or key press skips it.
  function introDot() {
    try {
      if (sessionStorage.getItem("dotpoint.intro")) return;
      sessionStorage.setItem("dotpoint.intro", "1");
    } catch (e) { /* storage blocked: play it anyway */ }
    const target = document.querySelector(".brand-mark");
    if (!target || reducedMotion() || typeof target.animate !== "function") return;
    const t = target.getBoundingClientRect();
    if (!t.width || t.bottom < 0) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = vw / 2, cy = vh / 2;
    const D = Math.round(Math.min(vw, vh, 700) * 0.6); // the notes, centred on the screen
    const L = Math.round(D * 0.34);                    // the logo, with its dot where the notes meet

    // In a 100 x 100 box: three notes, each a dot point and a line of writing. The dots meet at (50, 50).
    const ROWS = [{ y: 32, w: 52 }, { y: 50, w: 40 }, { y: 68, w: 46 }];
    const DOT_X = 22, DOT_R = 4.2, LINE_X = 32;
    const notes = s("svg", { class: "intro-notes", viewBox: "0 0 100 100", style: `width:${D}px;height:${D}px;margin:${-D / 2}px 0 0 ${-D / 2}px` },
      ...ROWS.map((r) => s("g", null,
        s("rect", { class: "in-line", x: LINE_X, y: r.y - 2.2, width: r.w, height: 4.4, rx: 2.2 }),
        s("circle", { class: "in-dot", cx: DOT_X, cy: r.y, r: DOT_R }))));
    const mark = target.cloneNode(true);
    mark.setAttribute("class", "intro-mark");
    const left = cx - (37 / 64) * L, top = cy - (37 / 64) * L; // the logo's dot centre is at (37, 37) of 64
    mark.setAttribute("style", `width:${L}px;height:${L}px;left:${left}px;top:${top}px`);
    mark.querySelectorAll(".brand-line").forEach((el) => el.setAttribute("pathLength", "1"));
    const veil = h("div", { class: "intro-veil" }, notes);
    const stage = h("div", { class: "intro", "aria-hidden": "true" }, veil, mark);
    document.body.append(stage);
    target.style.visibility = "hidden";

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      stage.remove();
      target.style.visibility = "";
      motion(target.querySelector(".brand-art"), [{ transform: "scale(1.4)" }, { transform: "scale(0.88)" }, { transform: "scale(1)" }],
        { duration: 360, easing: "cubic-bezier(.3,1.6,.5,1)" });
      window.removeEventListener("keydown", finish);
    };
    stage.addEventListener("click", finish);
    window.addEventListener("keydown", finish);
    setTimeout(finish, 3200); // never leave the page covered, even if animations are paused

    try {
      const ease = "cubic-bezier(.5,0,.3,1)";
      const draw = (el, delay, duration) => el.animate([
        { strokeDashoffset: 1, opacity: 0 }, { opacity: 1, offset: 0.04 }, { strokeDashoffset: 0, opacity: 1 },
      ], { delay, duration, easing: ease, fill: "both" });
      const dots = notes.querySelectorAll(".in-dot"), lines = notes.querySelectorAll(".in-line");
      ROWS.forEach((r, i) => {
        // jotted down one after another: the dot, then its line written out from left to right
        dots[i].animate([{ transform: "scale(0)" }, { transform: "scale(1.25)", offset: 0.6 }, { transform: "scale(1)" }],
          { delay: 60 + i * 140, duration: 260, easing: "cubic-bezier(.3,1.4,.5,1)", fill: "both" });
        lines[i].animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
          { delay: 140 + i * 140, duration: 340, easing: ease, fill: "both" });
        // then the lines pull back and the dots slide together
        lines[i].animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
          { delay: 860 + i * 40, duration: 260, easing: "cubic-bezier(.6,0,.8,.4)", fill: "forwards" });
        dots[i].animate([{ transform: "translate(0, 0)" }, { transform: `translate(${50 - DOT_X}px, ${50 - r.y}px)` }],
          { delay: 1020, duration: 300, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" });
        dots[i].animate([{ opacity: 1 }, { opacity: 0 }], { delay: 1300, duration: 90, fill: "forwards" });
      });
      // where they meet, the logo's dot swells out of them and the pen circles it
      mark.querySelector(".brand-dot").animate([{ transform: "scale(0.2)", opacity: 0 }, { transform: "scale(1.15)", opacity: 1, offset: 0.6 }, { transform: "scale(1)", opacity: 1 }],
        { delay: 1270, duration: 340, easing: "cubic-bezier(.3,1.4,.5,1)", fill: "both" });
      const [ring, note] = mark.querySelectorAll(".brand-line");
      draw(ring, 1420, 420);
      draw(note, 1800, 160);

      const dx = t.left + t.width / 2 - (left + L / 2);
      const dy = t.top + t.height / 2 - (top + L / 2);
      const fly = { delay: 1990, duration: 600, easing: "cubic-bezier(.6,0,.2,1)", fill: "both" };
      const flight = mark.animate([{ transform: "translate(0, 0) scale(1)" }, { transform: `translate(${dx}px, ${dy}px) scale(${t.width / L})` }], fly);
      const at = `at ${t.left + t.width / 2}px ${t.top + t.height / 2}px`;
      veil.animate([{ clipPath: `circle(${Math.ceil(Math.hypot(vw, vh))}px ${at})` }, { clipPath: `circle(0px ${at})` }], fly);

      flight.onfinish = finish;
    } catch (e) {
      finish(); // something went wrong: show the page rather than a blank cover
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    nextFrame(() => t.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove("show");
      toastTimer = setTimeout(() => { t.hidden = true; }, reducedMotion() ? 0 : 220);
    }, 3200);
  }

  // Copy text; the button itself says what happened, then goes back to its label.
  async function copyText(text, fallbackEl, btn) {
    const say = (msg, ms) => {
      if (!btn) return;
      const label = btn.dataset.label || btn.textContent;
      btn.dataset.label = label;
      btn.textContent = msg;
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(() => { btn.textContent = label; }, ms);
    };
    try {
      await navigator.clipboard.writeText(text);
      say("Copied ✓", 1800);
    } catch (e) {
      if (fallbackEl) {
        const range = document.createRange();
        range.selectNodeContents(fallbackEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      say("Selected: press Ctrl+C or Cmd+C", 4000);
    }
  }

  // ---------- progress: this browser first, account copy when available ----------

  const KEY = "dotpoint.progress.v1";
  let progress = loadLocal();

  function loadLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      return L.normaliseProgress(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return L.emptyProgress();
    }
  }

  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (e) { /* storage blocked: keep in memory */ }
  }

  function commit(mutate) {
    mutate(progress);
    progress.updatedAt = Date.now();
    saveLocal();
    Sync.schedule();
    updateBadge();
    updateGold(true);
  }

  const Sync = {
    db: null, uid: null, ref: null, timer: null, writing: false, again: false,

    async init() {
      if (!window.claude || typeof window.claude.use !== "function") return setSync("local");
      try {
        const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
        if (!db || !user) return setSync("local");
        const uid = await user.id();
        if (!uid) return setSync("local");
        this.db = db;
        this.uid = uid;
        const ref = db.doc(`data/users/${uid}/progress`);
        const snap = await ref.get();
        const remote = snap.exists ? snap.data() : null;
        const remoteN = remote ? L.normaliseProgress(remote) : null;
        this.ref = ref;
        if (remoteN && remoteN.updatedAt > progress.updatedAt) {
          progress = JSON.parse(JSON.stringify(remoteN));
          saveLocal();
          renderAll();
        } else if (progress.updatedAt > 0) {
          this.schedule();
        }
        setSync("synced");
      } catch (e) {
        this.ref = null;
        setSync("local");
      }
    },

    schedule() {
      if (!this.ref) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 1200);
    },

    async flush() {
      if (!this.ref) return;
      if (this.writing) { this.again = true; return; }
      this.writing = true;
      const body = JSON.parse(JSON.stringify(progress));
      try {
        await this.ref.set(body);
        setSync("synced");
      } catch (e) {
        if (e && e.code === "unavailable") {
          await new Promise((r) => setTimeout(r, 600 + Math.random() * 900));
          try { await this.ref.set(body); setSync("synced"); } catch (e2) { setSync("local"); }
        } else {
          this.ref = null; // read-only viewer or store unavailable: stay local for this visit
          setSync("local");
        }
      } finally {
        this.writing = false;
        if (this.again) { this.again = false; this.schedule(); }
      }
    },
  };

  function setSync(state) {
    const el = $("sync-status");
    el.dataset.state = state;
    el.textContent = state === "synced" ? "Progress saved to your account" : "Progress is saved in this browser";
  }

  // ---------- settings: theme, and resetting progress ----------

  const THEME_KEY = "dotpoint.theme";

  function themeChoice() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === "light" || t === "dark" ? t : "system";
    } catch (e) {
      return "system";
    }
  }

  function applyTheme(t) {
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }

  // The new colours cross-fade where the browser can, rather than snapping.
  function setTheme(t) {
    try {
      if (t === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t);
    } catch (e) { /* storage blocked: this visit only */ }
    const swap = () => { applyTheme(t); renderSettings(); };
    if (typeof document.startViewTransition === "function" && !reducedMotion()) document.startViewTransition(swap);
    else swap();
  }

  // ---------- the gold finish: an easter egg for rating every Year 11 and Year 12 dot point confident ----------

  const GOLD_KEY = "dotpoint.gold";
  const ADMIN_KEY = "dotpoint.admin";
  const FORCE_KEY = "dotpoint.gold.force";
  // SHA-256 of "dotpoint-admin:" + the admin password, so the password itself isn't in the page source.
  // This is a static site, so it only keeps the secret theme out of casual reach, not a real lock.
  const ADMIN_HASH = "10e1abf861afb0955db2d731eecde1782063dac0017ec793aa486cd8891b2d8b";
  let goldEarned = false;

  function goldWanted() {
    try { return localStorage.getItem(GOLD_KEY) !== "off"; } catch (e) { return true; }
  }

  function readKey(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function writeKey(k, v) {
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage blocked */ }
  }
  const adminUnlocked = () => readKey(ADMIN_KEY) === "1";
  const goldForced = () => adminUnlocked() && readKey(FORCE_KEY) === "on";
  const goldOn = () => (goldEarned && goldWanted()) || goldForced();

  function applyGold(on) {
    if (on) document.documentElement.dataset.gold = "on";
    else delete document.documentElement.dataset.gold;
    const n = SY.focusAreas.reduce((sum, fa) => sum + fa.dotpoints.length, 0);
    const markEl = $("done-mark");
    markEl.hidden = !on;
    markEl.textContent = `${n}/${n}`;
    markEl.setAttribute("title", `All ${n} dot points confident`);
    markEl.setAttribute("aria-label", `All ${n} dot points confident`);
  }

  // Called after every change to progress. celebrate is true only for a change the student just made,
  // so the colours fade over when they rate the last dot point, rather than snapping, and not on every page load.
  function updateGold(celebrate) {
    const was = goldEarned;
    goldEarned = L.syllabusComplete(SY, progress, deck, TODAY);
    $("set-gold").hidden = !goldEarned;
    const on = goldOn();
    if (celebrate && goldEarned && !was && on && !goldForced()) setTimeout(goldUnlock, 600);
    else applyGold(on);
  }

  function goldUnlock() {
    if (!goldEarned || !goldWanted()) return; // un-rated again in the meantime
    const swap = () => { applyGold(true); if (ui.view === "today") render("today"); };
    if (typeof document.startViewTransition === "function" && !reducedMotion()) document.startViewTransition(swap);
    else swap();
    toast("All dot points confident");
  }

  function setGold(choice) {
    try {
      if (choice === "off") localStorage.setItem(GOLD_KEY, "off"); else localStorage.removeItem(GOLD_KEY);
    } catch (e) { /* storage blocked: this visit only */ }
    const swap = () => { applyGold(goldOn()); renderSettings(); if (ui.view === "today") render("today"); };
    if (typeof document.startViewTransition === "function" && !reducedMotion()) document.startViewTransition(swap);
    else swap();
  }

  // ---------- admin: a padlock in settings; the password opens a switch for the secret theme ----------

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function renderAdmin() {
    const open = !$("admin-body").hidden, unlocked = adminUnlocked();
    const lock = $("admin-lock");
    lock.setAttribute("aria-expanded", String(open));
    lock.setAttribute("aria-label", unlocked ? "Admin, unlocked" : "Admin");
    if (unlocked) lock.dataset.unlocked = ""; else delete lock.dataset.unlocked;
    $("admin-form").hidden = unlocked;
    $("admin-panel").hidden = !unlocked;
    const force = goldForced() ? "on" : "off";
    for (const b of $("admin-gold-seg").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.choice === force));
  }

  function closeAdmin() {
    $("admin-body").hidden = true;
    $("admin-pin").value = "";
    $("admin-msg").textContent = "";
    renderAdmin();
  }

  // Theme changes from the admin panel cross-fade like the theme switch does.
  function refreshGold() {
    const swap = () => { applyGold(goldOn()); renderSettings(); if (ui.view === "today") render("today"); };
    if (typeof document.startViewTransition === "function" && !reducedMotion()) document.startViewTransition(swap);
    else swap();
  }

  function setupAdmin() {
    $("admin-lock").addEventListener("click", () => {
      if (!$("admin-body").hidden) return closeAdmin();
      $("admin-body").hidden = false;
      renderAdmin();
      if (!adminUnlocked()) $("admin-pin").focus({ preventScroll: true });
      $("admin-body").scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    });
    $("admin-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const pin = $("admin-pin");
      const msg = $("admin-msg");
      if (!(window.crypto && crypto.subtle)) { msg.textContent = "Admin needs a secure (https) connection."; return; }
      if ((await sha256("dotpoint-admin:" + pin.value.trim())) === ADMIN_HASH) {
        writeKey(ADMIN_KEY, "1");
        pin.value = "";
        msg.textContent = "";
        renderAdmin();
        $("admin-gold-seg").querySelector("button").focus({ preventScroll: true });
        $("admin-body").scrollIntoView({ block: "nearest" });
      } else {
        pin.value = "";
        msg.textContent = "That's not the password.";
        msg.scrollIntoView({ block: "nearest" });
        motion(pin, [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" },
          { transform: "translateX(-4px)" }, { transform: "translateX(0)" }], { duration: 300, easing: "ease-out" });
        pin.focus();
      }
    });
    for (const b of $("admin-gold-seg").querySelectorAll("button")) b.addEventListener("click", () => {
      writeKey(FORCE_KEY, b.dataset.choice === "on" ? "on" : null);
      renderAdmin();
      refreshGold();
    });
    $("admin-relock").addEventListener("click", () => {
      const wasForced = goldForced();
      writeKey(ADMIN_KEY, null);
      writeKey(FORCE_KEY, null);
      closeAdmin();
      $("admin-lock").focus();
      if (wasForced) refreshGold();
    });
    $("settings-dialog").addEventListener("close", closeAdmin);
    renderAdmin();
  }

  const HOLD_LABEL = "Hold to reset all progress";
  const COUNT_LABELS = [["dots", "dot point rated", "dot points rated"], ["cards", "flashcard practised", "flashcards practised"],
    ["days", "study day", "study days"], ["examples", "example opened", "examples opened"]];
  let resetJustDone = false;

  function holdLabel(text) {
    for (const el of $("reset-hold").querySelectorAll(".hold-label")) el.textContent = text;
  }

  function renderSettings() {
    const choice = themeChoice();
    for (const b of $("theme-seg").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.choice === choice));
    const gold = goldWanted() ? "on" : "off";
    for (const b of $("gold-seg").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.choice === gold));
    const c = L.progressCounts(progress);
    $("set-counts").replaceChildren(...COUNT_LABELS.map(([k, one, many]) => h("div", { class: "set-count" },
      h("dt", null, c[k] === 1 ? one : many), h("dd", { "data-from": c[k] }, String(c[k])))));
    $("set-where").textContent = Sync.ref
      ? "Saved to your account and in this browser. Resetting clears both."
      : "Saved in this browser only. Other browsers and devices keep their own.";
    const any = Object.values(c).some((n) => n > 0) || !!(ui.essay && ui.essay.draft.text.trim());
    const btn = $("reset-hold");
    if (resetJustDone) return;
    btn.disabled = !any;
    holdLabel(any ? HOLD_LABEL : "Nothing to reset yet");
  }

  const narrowScreen = () => window.matchMedia("(max-width: 760px)").matches;
  let sheetAnims = [];

  function openSettings() {
    const d = $("settings-dialog"), btn = $("settings-open");
    if (d.open) return;
    renderSettings();
    $("reset-status").textContent = "";
    const narrow = narrowScreen();
    if (narrow) {
      d.style.top = d.style.right = "";
    } else {
      const r = btn.getBoundingClientRect();
      d.style.top = `${Math.round(r.bottom + 8)}px`;
      d.style.right = `${Math.max(12, Math.round(window.innerWidth - r.right))}px`;
    }
    sheetAnims.forEach((a) => a.cancel());
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
    btn.dataset.open = "";
    motion(d, narrow
      ? [{ transform: "translateY(100%)" }, { transform: "none" }]
      : [{ opacity: 0, transform: "translateY(-8px) scale(0.95)" }, { opacity: 1, transform: "none" }],
    { duration: narrow ? 320 : 220, easing: "cubic-bezier(.2,.9,.25,1)" });
    try { motion(d, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, pseudoElement: "::backdrop" }); } catch (e) { /* no backdrop animation */ }
  }

  function closeSettings() {
    const d = $("settings-dialog");
    if (!d.open || sheetAnims.length) return;
    const narrow = narrowScreen();
    const opts = { duration: narrow ? 220 : 150, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" };
    const panel = motion(d, narrow
      ? [{ transform: "none" }, { transform: "translateY(100%)" }]
      : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-6px) scale(0.97)" }], opts);
    let shade = null;
    try { shade = motion(d, [{ opacity: 1 }, { opacity: 0 }], { ...opts, pseudoElement: "::backdrop" }); } catch (e) { /* no backdrop animation */ }
    sheetAnims = [panel, shade].filter(Boolean);
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
      sheetAnims.forEach((a) => a.cancel());
      sheetAnims = [];
    };
    if (panel) {
      panel.onfinish = done;
      setTimeout(done, opts.duration + 200); // never leave it half closed, even if animations are paused
    } else done();
  }

  // Resetting needs a deliberate press and hold (mouse, finger, or Enter or Space held down), so a stray
  // tap can't wipe anything. Screen readers activate buttons without a hold, so for them a second press
  // within a few seconds confirms instead.
  function setupResetHold() {
    const btn = $("reset-hold"), fill = btn.querySelector(".hold-fill"), status = $("reset-status");
    const EMPTY = "inset(0 100% 0 0)";
    let anim = null, armed = false, armTimer = 0;
    const disarm = () => {
      clearTimeout(armTimer);
      if (armed) { armed = false; renderSettings(); }
    };
    const start = () => {
      if (btn.disabled || anim || resetJustDone) return;
      disarm();
      status.textContent = "";
      anim = fill.animate([{ clipPath: EMPTY }, { clipPath: "inset(0 0 0 0)" }],
        { duration: 1300, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" });
      anim.onfinish = () => {
        const full = anim;
        anim = null;
        resetAll();
        setTimeout(() => {
          const fade = fill.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: "ease-out" });
          fade.onfinish = () => { full.cancel(); resetJustDone = false; renderSettings(); };
        }, 900);
      };
    };
    const stop = () => {
      if (!anim) return;
      const at = getComputedStyle(fill).clipPath;
      anim.cancel();
      anim = null;
      fill.animate([{ clipPath: at }, { clipPath: EMPTY }], { duration: 240, easing: "ease-out" });
      status.textContent = "Keep holding until the bar fills to reset.";
    };
    btn.addEventListener("pointerdown", (e) => { if (e.button === 0) start(); });
    for (const ev of ["pointerup", "pointerleave", "pointercancel", "blur"]) btn.addEventListener(ev, stop);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
    btn.addEventListener("keydown", (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      if (!e.repeat) start();
    });
    btn.addEventListener("keyup", (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      stop();
    });
    btn.addEventListener("click", (e) => {
      if (e.detail !== 0 || btn.disabled || resetJustDone) return; // a mouse or finger holds instead
      if (armed) {
        disarm();
        resetAll().then(() => setTimeout(() => { resetJustDone = false; renderSettings(); }, 1200));
        return;
      }
      armed = true;
      holdLabel("Press again to reset");
      status.textContent = "Press the button again to reset all progress.";
      armTimer = setTimeout(disarm, 6000);
    });
    $("settings-dialog").addEventListener("close", () => { stop(); disarm(); status.textContent = ""; });
  }

  // Wipe everything the site has saved for this person: here, and in their account copy if they have one.
  async function resetAll() {
    resetJustDone = true;
    holdLabel("All progress reset");
    $("reset-hold").disabled = true;
    $("reset-status").textContent = "";
    progress = L.emptyProgress();
    progress.updatedAt = Date.now(); // newer than any other copy, so the account copy and other devices take the reset too
    saveLocal();
    Sync.schedule();
    ui.drill = null;
    ui.openEv = {};
    clearTimeout(draftTimer);
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* storage blocked */ }
    Object.assign(ui.essay, { draft: emptyDraft(), result: null, checked: null, msg: "" });
    await clearOldEssays();
    renderAll();
    countDown();
    toast("All progress reset");
  }

  // The saved counts tick down to zero, so it's clear what was cleared.
  function countDown() {
    const dds = [...$("set-counts").querySelectorAll("dd")];
    if (reducedMotion() || !dds.some((dd) => Number(dd.dataset.from) > 0)) return renderSettings();
    const t0 = performance.now(), ms = 600;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms), left = Math.pow(1 - k, 3);
      for (const dd of dds) dd.textContent = String(Math.round(Number(dd.dataset.from) * left));
      if (k < 1) requestAnimationFrame(tick); else renderSettings();
    };
    requestAnimationFrame(tick);
  }

  // ---------- problem reports ----------

  let reportTarget = "";

  function openReport(target, label) {
    reportTarget = target;
    $("report-target").textContent = label ? `About: ${label}` : "About the site in general";
    $("report-note").value = "";
    $("reason-wrong").checked = true;
    $("report-fallback").hidden = true;
    $("report-send").hidden = false;
    $("report-send").disabled = false;
    $("report-send").textContent = "Send report";
    $("report-cancel").textContent = "Cancel";
    const d = $("report-dialog");
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  }

  function closeReport() {
    const d = $("report-dialog");
    if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
  }

  async function sendReport() {
    const reason = (document.querySelector('input[name="reason"]:checked') || {}).value;
    const r = L.cleanReport({ reason, note: $("report-note").value, target: reportTarget });
    $("report-send").disabled = true;
    let sent = false;
    try {
      if (Sync.db && Sync.uid) {
        const ref = Sync.db.doc(`reports/${Sync.uid}`);
        const snap = await ref.get();
        const prev = snap.exists && Array.isArray(snap.data().items) ? snap.data().items.slice(-49) : [];
        await ref.set({ items: prev.concat([r]), updatedAt: Date.now() });
        sent = true;
      }
    } catch (e) {
      sent = false;
    }
    $("report-send").disabled = false;
    if (sent) {
      $("report-send").textContent = "Sent ✓ Thank you";
      $("report-send").disabled = true;
      setTimeout(closeReport, 1100);
    } else {
      $("report-copy").value = `Dotpoint report\nItem: ${r.target || "site"}\nProblem: ${r.reason}\nDetails: ${r.note || "(none)"}\nDate: ${r.at.slice(0, 10)}`;
      $("report-fallback").hidden = false;
      if (REPO) {
        const body = `${$("report-copy").value}\n`;
        $("report-github").href = `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(`Problem: ${r.reason}${r.target ? ` (${r.target})` : ""}`)}&body=${encodeURIComponent(body)}`;
        $("report-github").hidden = false;
        $("report-fallback-text").textContent = "Send it as a GitHub issue, or copy the text below.";
      }
      $("report-send").hidden = true;
      $("report-cancel").textContent = "Close";
    }
  }

  // ---------- navigation ----------

  function go(view, opts) {
    if (view === "skills") view = "syllabus"; // old links
    if (view === "papers") view = "resources";
    if (!VIEWS.includes(view)) view = "today";
    // A finished flashcard session shouldn't greet you next time you open Flashcards.
    if (view === "drills" && ui.drill && ui.drill.i >= ui.drill.queue.length && ui.view !== "drills") ui.drill = null;
    const changed = ui.view !== view;
    ui.view = view;
    for (const v of VIEWS) $("view-" + v).hidden = v !== view;
    const el = $("view-" + view);
    if (changed && !reducedMotion()) {
      el.classList.add("view-enter");
      nextFrame(() => el.classList.remove("view-enter"));
    }
    for (const b of document.querySelectorAll(".tab")) {
      if (b.dataset.nav === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    }
    render(view);
    try {
      // A new history entry per view, so the browser's Back button returns to the previous view.
      if (location.hash !== "#" + view) {
        if (opts && opts.fromHistory) history.replaceState(null, "", "#" + view);
        else if (location.hash) history.pushState(null, "", "#" + view);
        else history.replaceState(null, "", "#" + view);
      }
    } catch (e) { /* ignore */ }
    if (!opts || !opts.keepScroll) window.scrollTo({ top: 0, behavior: "instant" });
    if (!opts || opts.focus !== false) {
      const head = $("h-" + view);
      if (head) head.focus({ preventScroll: true });
    }
  }

  function render(view) {
    if (view === "today") renderToday();
    else if (view === "syllabus") renderSyllabus();
    else if (view === "evidence") renderEvidence();
    else if (view === "stats") renderStats();
    else if (view === "resources") renderResources();
    else if (view === "drills") renderDrills();
    else if (view === "essay") renderEssay();
  }

  function renderAll() {
    render(ui.view);
    updateBadge();
    updateGold(false);
  }

  function updateBadge() {
    const n = L.dueQueue(deck, progress.cards, TODAY).filter((c) => progress.cards[c.id]).length;
    const b = $("due-badge");
    b.hidden = !n;
    b.textContent = n ? String(n) : "";
    b.setAttribute("aria-label", n ? `${n} due` : "");
  }

  function viewHead(id, title, intro) {
    return h("div", { class: "view-head" },
      h("h1", { id: "h-" + id, tabindex: "-1" }, title),
      intro && h("p", null, intro));
  }

  function status(dpId) {
    return L.dotpointStatus(dpId, progress, deck, TODAY);
  }

  function openDotpoint(dpId) {
    const dp = dpIndex[dpId];
    if (!dp) return;
    ui.year = dp.focus.year;
    ui.openDp = dpId;
    go("syllabus", { focus: false });
    const el = $("dpd-" + dpId) || $("dp-" + dpId);
    if (el) {
      el.scrollIntoView({ block: "center" });
      const f = el.querySelector(".dp-toggle") || el.closest(".dp") && el.closest(".dp").querySelector(".dp-toggle");
      if (f) f.focus({ preventScroll: true });
    }
  }

  function openEvidence(evId) {
    ui.query = ""; ui.fFocus = "all"; ui.fType = "all"; ui.fFresh = "all";
    ui.openEv = { [evId]: true };
    markSeen(evId);
    go("evidence", { focus: false });
    const el = document.getElementById("ev-" + evId);
    if (el) {
      el.scrollIntoView({ block: "start" });
      const btn = el.querySelector(".ev-head");
      if (btn) btn.focus({ preventScroll: true });
    }
  }

  function markSeen(evId) {
    if (!progress.seenEvidence[evId]) commit((p) => { p.seenEvidence[evId] = TODAY_ISO; });
  }

  // ---------- shared pieces ----------

  function progressText(dpId) {
    const sk = L.skillLevel(dpId, progress, deck);
    return sk.total ? `${sk.learned} of ${sk.total} cards learned` : "No cards yet";
  }

  function dpLink(id) {
    return h("button", { type: "button", class: "link-btn", onclick: () => openDotpoint(id) }, dpIndex[id].short || dpIndex[id].text);
  }

  function joinLinks(ids) {
    return ids.filter((id) => dpIndex[id]).map(dpLink).flatMap((el, i) => (i ? [", ", el] : [el]));
  }

  function exampleRow(e) {
    return h("li", null,
      h("button", { type: "button", onclick: () => openEvidence(e.id) },
        h("span", null, e.title,
          meta("dp-counts", e.type, L.fmtDate(e.date), L.freshness(e.date, TODAY_ISO).label)),
        h("span", { class: "mono" }, e.keyFigure)));
  }

  // Terms, sequence, examples, statistics, confidence and flashcards for one dot point.
  function dpBody(dp) {
    const parts = [];
    const evs = EV.filter((e) => e.dotpoints.includes(dp.id)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const inds = ST.indicators.filter((i) => i.dotpoints.includes(dp.id));
    const cards = deck.filter((c) => c.dotpoints.includes(dp.id));
    const seq = L.sequence(SY.branches, dp.id);
    if (dp.terms && dp.terms.length) {
      parts.push(h("p", { class: "sublabel" }, "Key terms"),
        h("dl", { class: "terms" }, dp.terms.map(([t, d]) => h("div", null, h("dt", null, t), h("dd", null, d)))));
    }
    if (seq.buildsOn.length || seq.leadsTo.length) {
      parts.push(h("div", { class: "seq" },
        seq.buildsOn.length ? h("p", null, h("span", { class: "sublabel" }, "Builds on "), joinLinks(seq.buildsOn)) : null,
        seq.leadsTo.length ? h("p", null, h("span", { class: "sublabel" }, "Leads to "), joinLinks(seq.leadsTo)) : null));
    }
    parts.push(h("p", { class: "sublabel" }, `Examples (${evs.length})`));
    if (evs.length) parts.push(h("ul", { class: "mini-ev" }, evs.map(exampleRow)));
    else parts.push(h("p", { class: "small muted" }, "No examples written for this dot point yet."));
    if (inds.length) {
      parts.push(h("p", { class: "sublabel" }, "Statistics"),
        h("div", { class: "tags" }, inds.map((i) => h("button", {
          type: "button", class: "tag", onclick: () => { ui.statSel = i.id; go("stats"); },
        }, h("b", null, L.fmtValue(i, L.latest(i)[1])), i.short))));
    }
    const st = status(dp.id);
    parts.push(h("div", { class: "dp-actions" },
      h("div", { class: "status-ctl", role: "group", "aria-label": `How confident do you feel about ${dp.short || dp.text}` },
        ["none", "shaky", "confident"].map((k) => h("button", {
          type: "button", class: "s-" + k, "aria-pressed": String(st === k),
          onclick: () => {
            const was = status(dp.id);
            commit((p) => { p.dotStatus[dp.id] = k; });
            refreshRowSummary(dp.id);
            if (k !== was) celebrateDot(dp.id, k);
          },
        }, mark(k), STATUS_LABEL[k]))),
      h("button", { type: "button", class: "btn small", disabled: cards.length ? null : true, onclick: () => startDrill("dp:" + dp.id) },
        `Revise ${cards.length} flashcard${cards.length === 1 ? "" : "s"}`),
      h("span", { class: "small muted" }, progressText(dp.id))));
    return parts;
  }

  // ---------- HOME ----------

  function renderToday() {
    const root = $("view-today");
    root.replaceChildren();
    const hero = h("div", { class: "hero" }, viewHead("today", "Find evidence for any dot point",
      `Search the ${SY.syllabus} by topic and get the dot point, real examples you can cite and the latest RBA and ABS figures.`));
    root.append(hero);

    const box = h("div", { class: "home-search", role: "search" },
      h("label", { class: "sr-only", for: "home-q" }, "Search everything"),
      h("input", { type: "search", id: "home-q", class: "field big", placeholder: "Try inflation, oligopoly or tariffs", autocomplete: "off" }));
    const results = h("div", { id: "home-results", "aria-live": "polite" });
    hero.append(box);
    root.append(results, dailyStrip("today"));
    const input = box.querySelector("input");
    input.value = ui.homeQuery || "";
    input.addEventListener("input", () => { ui.homeQuery = input.value; renderHomeResults(results); });
    renderHomeResults(results);

    // The headline economic indicators, leaving out the ones already in Daily numbers
    const inDaily = new Set(["cash-rate", "aud-usd", "twi"]);
    const homeInds = ST.indicators.filter((ind) => ind.group !== "more" && !inDaily.has(ind.id));
    root.append(h("section", { class: "section", "aria-labelledby": "h-numbers" },
      h("div", { class: "section-head" },
        h("div", null,
          h("h2", { id: "h-numbers" }, "Economic indicators"),
          h("p", { class: "small muted" }, "The latest official RBA and ABS figures, and how each has changed in a year.")),
        h("button", { type: "button", class: "btn ghost small", onclick: () => go("stats") }, "All 20 figures and charts")),
      h("div", { class: "tiles home-tiles" }, homeInds.map((ind) => statTile(ind, () => { ui.statSel = ind.id; go("stats"); })))));

    root.append(newsSection(), newestExamples(), studyBand());
  }

  // The six newest examples as a grid, each led by the figure you'd quote.
  function newestExamples() {
    const newest = EV.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
    return h("section", { class: "section", "aria-labelledby": "h-new-ev" },
      h("div", { class: "section-head" },
        h("div", null,
          h("h2", { id: "h-new-ev" }, "Newest examples"),
          h("p", { class: "small muted" }, "Recent figures and events you can quote, each checked against its source.")),
        h("button", { type: "button", class: "btn ghost small", onclick: () => go("evidence") }, `All ${EV.length} examples`)),
      h("ul", { class: "ev-grid" }, newest.map((e) => h("li", null,
        h("button", { type: "button", onclick: () => openEvidence(e.id) },
          h("span", { class: "ev-fig" }, e.keyFigure),
          h("span", { class: "ev-title" }, e.title),
          meta("dp-counts", e.type, L.fmtDate(e.date), L.freshness(e.date, TODAY_ISO).label))))));
  }

  // Everything that's yours sits on one tinted band: flashcards, essay practice and how you rate each focus area.
  function studyBand() {
    const dueReviews = L.dueQueue(deck, progress.cards, TODAY).filter((c) => progress.cards[c.id]).length;
    const dueAll = L.dueQueue(deck, progress.cards, TODAY).length;
    const allSt = SY.focusAreas.flatMap((fa) => fa.dotpoints.map((dp) => status(dp.id)));
    const nConf = allSt.filter((x) => x === "confident").length;
    const nShaky = allSt.filter((x) => x === "shaky").length;
    const gold = goldEarned && goldWanted();
    return h("section", { class: "study-band", "aria-labelledby": "h-study" },
      h("h2", { id: "h-study" }, "Your study"),
      gold && h("p", { class: "gold-note" }, h("span", { class: "gold-seal", "aria-hidden": "true" }),
        `${allSt.length} of ${allSt.length} dot points confident, Year 11 and Year 12.`),
      h("div", { class: "study-actions" },
        h("section", { class: "panel revise", "aria-labelledby": "h-revise" },
          h("div", null,
            h("h3", { id: "h-revise" }, "Flashcards"),
            h("p", { class: "muted small" }, dueReviews
              ? `${dueReviews} card${dueReviews === 1 ? "" : "s"} due for review today.`
              : dueAll ? `Nothing due for review. ${dueAll} new cards available.` : "Nothing due today.")),
          h("button", { type: "button", class: "btn primary", disabled: dueAll ? null : true, onclick: () => startDrill("due") },
            dueReviews ? "Review due cards" : "Start 10 new cards")),
        h("section", { class: "panel revise", "aria-labelledby": "h-essay-home" },
          h("div", null,
            h("h3", { id: "h-essay-home" }, "Essay checker"),
            h("p", { class: "muted small" }, "Check a practice essay's figures, structure and key terms in seconds.")),
          h("button", { type: "button", class: "btn", onclick: () => go("essay") }, "Check an essay"))),
      h("section", { class: "section", "aria-labelledby": "h-dir" },
        h("div", { class: "section-head" },
          h("div", null,
            h("h3", { id: "h-dir" }, "Your dot points"),
            h("p", { class: "small muted" }, nConf || nShaky
              ? `${nConf} confident and ${nShaky} getting there, out of ${allSt.length}.`
              : `${allSt.length} dot points. Open one and mark how confident you feel.`)),
          h("button", { type: "button", class: "btn ghost small", onclick: () => go("syllabus") }, "All dot points")),
        h("ul", { class: "fa-tiles" }, SY.focusAreas.map((fa) => {
          const sts = fa.dotpoints.map((dp) => status(dp.id));
          const c = sts.filter((x) => x === "confident").length;
          return h("li", null, h("button", {
            type: "button", onclick: () => { ui.year = fa.year; ui.openDp = null; go("syllabus", { focus: false }); const el = $("fa-" + fa.id); if (el) el.scrollIntoView({ block: "start" }); },
          },
            h("span", { class: "fa-tile-top" }, h("span", null, `Year ${fa.year}`), h("span", null, `${c} of ${fa.dotpoints.length} confident`)),
            h("span", { class: "dir-name" }, fa.name),
            h("span", { class: "dir-marks", "aria-hidden": "true" }, sts.map(mark))));
        }))));
  }

  function renderHomeResults(box) {
    box.replaceChildren();
    const q = (ui.homeQuery || "").trim();
    if (!q) return;
    const r = L.searchAll(q, SY, ALL_EV, ST);
    const total = r.dotpoints.length + r.examples.length + r.stats.length;
    if (!total) {
      box.append(h("p", { class: "empty" }, `Nothing matches "${q}". Try a broader word.`));
      return;
    }
    const groups = h("div", { class: "results" });
    if (r.stats.length) {
      groups.append(h("section", { class: "result-group" }, h("h3", null, `Statistics (${r.stats.length})`),
        h("div", { class: "tags" }, r.stats.map((i) => h("button", {
          type: "button", class: "tag", onclick: () => { ui.statSel = i.id; go("stats"); },
        }, h("b", null, L.fmtValue(i, L.latest(i)[1])), i.short)))));
    }
    if (r.dotpoints.length) {
      groups.append(h("section", { class: "result-group" }, h("h3", null, `Dot points (${r.dotpoints.length})`),
        h("ul", { class: "mini-ev" }, r.dotpoints.slice(0, 6).map((dp) => h("li", null,
          h("button", { type: "button", onclick: () => openDotpoint(dp.id) },
            h("span", null, dp.text, meta("dp-counts", `Year ${dp.focus.year}`, dp.focus.name))))))));
    }
    if (r.examples.length) {
      groups.append(h("section", { class: "result-group" }, h("h3", null, `Examples (${r.examples.length})`),
        h("ul", { class: "mini-ev" }, r.examples.slice(0, 6).map(exampleRow)),
        r.examples.length > 6 ? h("button", { type: "button", class: "btn ghost small", onclick: () => { ui.query = q; ui.openEv = {}; go("evidence"); } }, `See all ${r.examples.length} examples`) : null));
    }
    box.append(groups);
  }

  // ---------- SYLLABUS ----------

  function renderSyllabus() {
    const root = $("view-syllabus");
    root.replaceChildren();
    root.append(viewHead("syllabus", "Dot points",
      `Every dot point in the ${SY.syllabus}, with key terms, examples and statistics. Mark how confident you feel and the dot fills in. Summaries are in our own words; follow the NESA links for the official wording.`));
    root.append(h("div", { class: "btn-row" },
      h("div", { class: "seg", role: "group", "aria-label": "Year" },
        [11, 12].map((y) => h("button", {
          type: "button", "aria-pressed": String(ui.year === y),
          onclick: () => { ui.year = y; ui.openDp = null; renderSyllabus(); },
        }, `Year ${y}`)))));
    // Two columns that grow independently, so opening a dot point never leaves a gap beside it.
    // On narrower screens the columns dissolve and `order` keeps the focus areas in sequence.
    const cols = [h("div", { class: "fa-col" }), h("div", { class: "fa-col" })];
    root.append(h("div", { class: "fa-grid" }, cols));
    SY.focusAreas.filter((f) => f.year === ui.year).forEach((fa, i) => {
      cols[i % 2].append(h("section", { class: "fa", id: "fa-" + fa.id, style: `order:${i}`, "aria-labelledby": "fah-" + fa.id },
        h("div", { class: "fa-head" },
          h("h2", { id: "fah-" + fa.id }, fa.name),
          h("a", { href: fa.url, target: "_blank", rel: "noopener", class: "small" }, "Official wording on NESA ↗")),
        h("ul", { class: "dp-list" }, fa.dotpoints.map((dp) => dotpointRow(dp)))));
    });
  }

  function chevron() {
    return h("span", { class: "chev", "aria-hidden": "true" },
      s("svg", { viewBox: "0 0 16 16", width: 16, height: 16 },
        s("path", { d: "M4 6l4 4 4-4", fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round" })));
  }

  function rowCounts(dp) {
    const evCount = EV.filter((e) => e.dotpoints.includes(dp.id)).length;
    const st = status(dp.id);
    return meta("dp-counts", `${evCount} example${evCount === 1 ? "" : "s"}`, progressText(dp.id), st !== "none" ? STATUS_LABEL[st] : null);
  }

  // Open or close one dot point without redrawing the page; only one is open at a time.
  function toggleDotpoint(dpId) {
    const prev = ui.openDp;
    ui.openDp = prev === dpId ? null : dpId;
    if (prev) setRowOpen(prev, false);
    if (ui.openDp) setRowOpen(ui.openDp, true);
  }

  function setRowOpen(dpId, open) {
    const li = $("dp-" + dpId);
    if (!li) return;
    li.querySelector(".dp-toggle").setAttribute("aria-expanded", String(open));
    const box = li.querySelector(".reveal[id]"); // a panel that is still closing has lost its id
    if (open && !box) li.append(revealBox(h("div", { class: "dp-detail" }, ...dpBody(dpIndex[dpId])), { id: "dpd-" + dpId }, true));
    if (!open && box) { box.removeAttribute("id"); collapseBox(box); }
  }

  // The row's dot pops when its confidence changes, bursts when it becomes confident, and finishing
  // a whole focus area earns a shower of dots.
  function celebrateDot(dpId, st) {
    const m = document.querySelector(`#dp-${dpId} .dp-toggle .mark`);
    if (!m || st === "none") return;
    motion(m, [{ transform: "scale(1)" }, { transform: "scale(1.7)" }, { transform: "scale(0.9)" }, { transform: "scale(1)" }],
      { duration: 460, easing: "cubic-bezier(.3,1.6,.5,1)" });
    if (st !== "confident") return;
    const r = m.getBoundingClientRect();
    dotBurst(r.left + r.width / 2, r.top + r.height / 2, 12);
    const fa = dpIndex[dpId].focus;
    if (fa.dotpoints.every((x) => status(x.id) === "confident")) {
      setTimeout(() => dotShower(40), 350);
    }
  }

  // After a confidence change, update the marker, the counts and the pressed button in place.
  function refreshRowSummary(dpId) {
    const li = $("dp-" + dpId);
    if (!li) return;
    const st = status(dpId);
    li.querySelector(".dp-toggle .mark").className = "mark m-" + st;
    li.querySelector(".dp-toggle .dp-counts").replaceWith(rowCounts(dpIndex[dpId]));
    for (const b of li.querySelectorAll(".status-ctl button")) b.setAttribute("aria-pressed", String(b.classList.contains("s-" + st)));
  }

  function dotpointRow(dp) {
    const open = ui.openDp === dp.id;
    const li = h("li", { class: "dp", id: "dp-" + dp.id });
    li.append(h("button", {
      type: "button", class: "dp-toggle", "aria-expanded": String(open), "aria-controls": "dpd-" + dp.id,
      onclick: () => toggleDotpoint(dp.id),
    },
      mark(status(dp.id)),
      h("span", null, h("span", { class: "dp-text" }, dp.text), rowCounts(dp)),
      chevron()));
    if (open) li.append(revealBox(h("div", { class: "dp-detail" }, ...dpBody(dp)), { id: "dpd-" + dp.id }, false));
    return li;
  }

  // ---------- EXAMPLES ----------

  let evSkeleton = false;

  function renderEvidence() {
    const root = $("view-evidence");
    if (!evSkeleton) {
      root.replaceChildren();
      root.append(viewHead("evidence", "Real-world examples",
        "Decisions, court cases, laws, reports and data releases you can cite, each checked by hand against its source. News reports are added automatically from trusted outlets every day, so the list keeps growing."));
      const types = [...new Set(ALL_EV.map((e) => e.type))].sort();
      const side = h("aside", { class: "filter-side", "aria-label": "Filters" },
        h("label", { for: "ev-search" }, "Search",
          h("input", { type: "search", id: "ev-search", class: "field", placeholder: "Words, names, numbers", autocomplete: "off" })),
        h("label", { for: "ev-focus" }, "Focus area",
          h("select", { id: "ev-focus", class: "field" }, h("option", { value: "all" }, "All focus areas"),
            SY.focusAreas.map((fa) => h("option", { value: fa.id }, `Year ${fa.year}: ${fa.name}`)))),
        h("label", { for: "ev-type" }, "Type",
          h("select", { id: "ev-type", class: "field" }, h("option", { value: "all" }, "All types"),
            types.map((ty) => h("option", { value: ty }, ty)))),
        h("label", { for: "ev-fresh" }, "Age",
          h("select", { id: "ev-fresh", class: "field" }, h("option", { value: "all" }, "Any age"),
            h("option", { value: "fresh" }, "Under 6 months"),
            h("option", { value: "ageing" }, "6–18 months"),
            h("option", { value: "old" }, "Over 18 months"))),
        h("label", { for: "ev-sort" }, "Sort",
          h("select", { id: "ev-sort", class: "field" },
            h("option", { value: "new" }, "Newest first"),
            h("option", { value: "old" }, "Oldest first"),
            h("option", { value: "rel" }, "Best match"))),
        h("button", { type: "button", class: "btn ghost small", id: "ev-clear" }, "Clear filters"),
        suggestLink("Know a report or article that belongs here?"));
      const main = h("div", { class: "ev-main" },
        // the count sits on the same line as the "Search" label, so the first example lines up with the search box
        h("p", { class: "result-line", id: "ev-count", "aria-live": "polite" }),
        h("ul", { class: "ev-list", id: "ev-list" }));
      root.append(h("div", { class: "ev-layout" }, side, main));
      $("ev-search").addEventListener("input", (e) => { ui.query = e.target.value; renderEvidenceList(); });
      $("ev-focus").addEventListener("change", (e) => { ui.fFocus = e.target.value; renderEvidenceList(); });
      $("ev-type").addEventListener("change", (e) => { ui.fType = e.target.value; renderEvidenceList(); });
      $("ev-fresh").addEventListener("change", (e) => { ui.fFresh = e.target.value; renderEvidenceList(); });
      $("ev-sort").addEventListener("change", (e) => { ui.sort = e.target.value; renderEvidenceList(); });
      $("ev-clear").addEventListener("click", () => {
        ui.query = ""; ui.fFocus = "all"; ui.fType = "all"; ui.fFresh = "all";
        renderEvidence();
        $("ev-search").focus();
      });
      evSkeleton = true;
    }
    ui.evShown = EV_PAGE;
    $("ev-search").value = ui.query;
    $("ev-focus").value = ui.fFocus;
    $("ev-type").value = ui.fType;
    $("ev-fresh").value = ui.fFresh;
    $("ev-sort").value = ui.sort;
    renderEvidenceList();
  }

  function filteredEvidence() {
    let list = L.searchEvidence(ALL_EV, dpIndex, ui.query);
    const byRelevance = ui.sort === "rel" && ui.query.trim();
    if (!byRelevance) list.sort((a, b) => (ui.sort === "old" ? (a.date > b.date ? 1 : -1) : (a.date < b.date ? 1 : -1)));
    if (ui.fFocus !== "all") list = list.filter((e) => e.dotpoints.some((id) => dpIndex[id] && dpIndex[id].focus.id === ui.fFocus));
    if (ui.fType !== "all") list = list.filter((e) => e.type === ui.fType);
    if (ui.fFresh !== "all") list = list.filter((e) => L.freshness(e.date, TODAY_ISO).level === ui.fFresh);
    return list;
  }

  function renderEvidenceList() {
    const list = filteredEvidence();
    const ul = $("ev-list");
    ul.replaceChildren();
    const filtered = ui.query.trim() || ui.fFocus !== "all" || ui.fType !== "all" || ui.fFresh !== "all";
    $("ev-count").textContent = filtered
      ? `${list.length} of ${ALL_EV.length} examples`
      : NEWS_EV.length ? `${EV.length} checked examples and ${NEWS_EV.length} news reports` : `${EV.length} examples`;
    $("ev-clear").hidden = !filtered;
    if (!list.length) {
      ul.append(h("li", { class: "empty" }, "No examples match. Try a broader word, or clear the filters."));
      return;
    }
    // A page at a time, so the list stays quick as the news reports pile up. An example opened from
    // elsewhere is always on the page.
    const openAt = list.findIndex((e) => ui.openEv[e.id]);
    const shown = Math.max(ui.evShown || EV_PAGE, openAt + 1);
    for (const e of list.slice(0, shown)) ul.append(evidenceCard(e));
    const left = list.length - shown;
    if (left > 0) {
      ul.append(h("li", { class: "ev-more" }, h("button", {
        type: "button", class: "btn",
        onclick: (ev) => {
          ui.evShown = shown + EV_PAGE;
          const next = shown;
          renderEvidenceList();
          const card = $("ev-list").children[next];
          if (card && ev.detail === 0) card.querySelector(".ev-head").focus(); // keyboard: carry on from the first new card
        },
      }, `Show ${Math.min(EV_PAGE, left)} more`), h("span", { class: "small muted" }, `${shown} of ${list.length} shown`)));
    }
  }

  function evidenceCard(e) {
    const open = !!ui.openEv[e.id];
    const fr = L.freshness(e.date, TODAY_ISO);
    const bodyId = "evb-" + e.id;
    const li = h("li", { class: "ev", id: "ev-" + e.id });
    const head = h("button", {
      type: "button", class: "ev-head", "aria-expanded": String(open), "aria-controls": bodyId,
      onclick: () => {
        const nowOpen = !ui.openEv[e.id];
        ui.openEv[e.id] = nowOpen;
        head.setAttribute("aria-expanded", String(nowOpen));
        if (nowOpen) { markSeen(e.id); li.append(revealBox(evidenceBody(e), { id: bodyId }, true)); }
        else { const box = li.querySelector(".reveal[id]"); if (box) { box.removeAttribute("id"); collapseBox(box); } }
      },
    },
      h("span", { class: "ev-title" }, e.title),
      h("span", { class: "ev-figure" }, e.keyFigure),
      h("span", { class: "ev-meta" },
        h("span", { class: "chip" }, e.type),
        e.auto && h("span", null, e.source.name),
        h("span", { class: `chip fresh-${fr.level}` }, fr.label),
        e.status === "developing" && h("span", { class: "chip developing" }, "Developing story"),
        h("span", null, `${L.fmtDate(e.date)}, ${L.ageText(fr.months)}`),
        h("span", { class: "ev-tags" }, e.dotpoints.filter((id) => dpIndex[id]).slice(0, 3).map((id) => h("span", { class: "chip quiet" }, dpIndex[id].short)))),
      chevron());
    li.append(head);
    if (open) li.append(revealBox(evidenceBody(e), { id: bodyId }, false));
    return li;
  }

  function evidenceBody(e) {
      const inds = L.relatedIndicators(e, ST);
      return h("div", { class: "ev-body" },
        e.quote && h("figure", { class: "quote" },
          h("blockquote", null, e.quote.text),
          h("figcaption", null, e.auto ? "The outlet's own summary: " : null,
            e.quote.url ? h("a", { href: e.quote.url, target: "_blank", rel: "noopener" }, e.quote.by + " ↗") : e.quote.by)),
        e.summary && h("p", null, e.summary),
        h("div", { class: "use" }, h("b", null, "Use it for: "), e.useFor),
        inds.length > 0 && h("div", { class: "pair" },
          h("p", { class: "sublabel" }, "Related statistics"),
          h("div", { class: "tags" }, inds.map((i) => h("button", {
            type: "button", class: "tag", onclick: () => { ui.statSel = i.id; go("stats"); },
          }, h("b", null, L.fmtValue(i, L.latest(i)[1])), i.short)))),
        h("div", { class: "pair" },
          h("p", { class: "sublabel" }, "Dot points"),
          h("div", { class: "tags", "aria-label": "Dot points" }, e.dotpoints.filter((id) => dpIndex[id]).map((id) =>
            h("button", { type: "button", class: "tag", onclick: () => openDotpoint(id) }, dpIndex[id].short || dpIndex[id].text)))),
        h("div", { class: "source" },
          h("span", null, e.auto ? "Read the article: " : "Source: ", h("a", { href: e.source.url, target: "_blank", rel: "noopener" }, e.source.name + " ↗")),
          e.auto && e.also.length > 0 && h("span", null, "Also in ", e.also.flatMap((a, i) => [
            i ? (i === e.also.length - 1 ? " and " : ", ") : "",
            h("a", { href: a.url, target: "_blank", rel: "noopener" }, a.outlet)])),
          h("span", null, e.auto ? "Collected automatically, not checked by hand" : `Checked ${L.fmtDate(e.checked)}`),
          h("button", { type: "button", class: "link-btn small", onclick: () => openReport(e.id, e.title) }, "Report a problem")));
  }

  // ---------- STATS ----------

  function statTile(ind, onclick, pressed) {
    const [, v] = L.latest(ind);
    const ch = L.yearChange(ind);
    return h("button", {
      type: "button", class: "tile", onclick, "data-ind": ind.id, "aria-pressed": pressed === undefined ? null : String(pressed),
      "aria-label": `${ind.short}: ${L.fmtValue(ind, v)} as at ${L.periodOf(ind)}${ch ? `, ${L.fmtDelta(ind, ch.delta)} on a year earlier` : ""}`,
    },
      h("span", { class: "tile-name" }, ind.short),
      h("span", { class: "tile-value" }, L.fmtValue(ind, v)),
      h("span", { class: "tile-meta" }, h("span", null, L.periodOf(ind)),
        ch && h("span", { class: "chg" }, `${L.fmtDelta(ind, ch.delta)} in a year`)),
      sparkline(ind));
  }

  // A link to the suggestion form, shown only once a GitHub repository is set in data/config.js.
  function suggestLink(lead) {
    if (!SUGGEST_URL) return null;
    return h("p", { class: "suggest small muted" }, lead, " ",
      h("a", { href: SUGGEST_URL, target: "_blank", rel: "noopener" }, "Suggest an example or statistic ↗"));
  }

  // Top economics and politics stories from trusted outlets, ranked by tools/update_news.py (how widely
  // a story is covered, how closely it links to the syllabus, how recent it is). Headlines always link
  // to the original article. Each story names the dot points it links to.
  function newsSection() {
    const N = globalThis.DP_NEWS;
    if (!N) return null;
    const nowMs = Date.now();
    const cols = [["economy", "Economy and markets"], ["world", "Politics and world"]]
      .map(([key, title]) => ({ key, title, items: L.recentNews(N[key], nowMs) }));
    const total = cols.reduce((n, c) => n + c.items.length, 0);
    const section = h("section", { class: "section", id: "news", "aria-labelledby": "h-news" });
    const draw = () => {
      const shown = ui.newsAll ? 12 : 4;
      const more = cols.some((c) => c.items.length > 4);
      section.replaceChildren(
        h("div", { class: "section-head" },
          h("div", null,
            h("h2", { id: "h-news" }, "In the news"),
            h("p", { class: "small muted" }, total
              ? `The biggest stories that link to the syllabus. Updated ${L.timeAgo(N.generatedAt, nowMs)}.`
              : "No stories from the last few days. The list refreshes several times a day."))),
        total ? h("div", { class: "grid-2 news-cols", id: "news-cols" }, cols.map((c) => h("div", { class: "news-col" },
          h("h3", null, c.title),
          c.items.length
            ? h("ul", { class: "news-list" }, c.items.slice(0, shown).map((n) => newsItem(n, nowMs)))
            : h("p", { class: "small muted" }, "No recent stories.")))) : null,
        total ? h("div", { class: "news-end" },
          more ? h("button", {
            type: "button", class: "btn small", "aria-expanded": ui.newsAll ? "true" : "false", "aria-controls": "news-cols",
            onclick: () => { ui.newsAll = !ui.newsAll; draw(); },
          }, ui.newsAll ? "Show fewer stories" : "Show more stories") : null,
          h("p", { class: "small muted" }, `From ${L.andList(N.sources)}, ranked by how widely each story is covered and how closely it links to the syllabus.`)) : null);
    };
    draw();
    return section;
  }

  function newsItem(n, nowMs) {
    const dps = (n.dotpoints || []).map((id) => dpIndex[id]).filter(Boolean);
    const also = n.also || [];
    return h("li", { class: "news-item" },
      h("a", { class: "news-link", href: n.url, target: "_blank", rel: "noopener" }, n.title, h("span", { class: "sr-only" }, " (opens in a new tab)")),
      meta("news-meta", n.outlet, L.timeAgo(n.published, nowMs),
        also.length ? h("span", null, "Also in ", also.flatMap((a, i) => [
          i ? (i === also.length - 1 ? " and " : ", ") : "",
          h("a", { href: a.url, target: "_blank", rel: "noopener" }, a.outlet)])) : null),
      dps.length ? h("div", { class: "news-dps" }, dps.map((dp) => h("button", {
        type: "button", class: "news-dp", onclick: () => openDotpoint(dp.id), "aria-label": `Open dot point: ${dp.short}`,
      }, mark(status(dp.id)), h("span", null, dp.short)))) : null);
  }

  // The figures the RBA updates every business day, with the change on the previous business day.
  function dailyStrip(where) {
    const items = ST.daily || [];
    if (!items.length) return null;
    const latest = items.map((d) => d.points[d.points.length - 1][0]).sort().pop();
    return h("section", { class: "section", "aria-labelledby": "h-daily-" + where },
      h("div", { class: "section-head" },
        h("div", null,
          h("h2", { id: "h-daily-" + where }, "Daily numbers"),
          h("p", { class: "small muted" }, `Updated each business day from RBA tables. Latest figures ${L.fmtDate(latest)}.`))),
      h("ul", { class: "daily-list" }, items.map((d) => {
        const p = d.points, [iso, v] = p[p.length - 1], prevIso = p[p.length - 2][0];
        const ch = +(v - p[p.length - 2][1]).toFixed(d.decimals);
        return h("li", { class: "daily-item" },
          h("span", { class: "tile-name" }, d.short),
          h("span", { class: "daily-value" }, L.fmtValue(d, v)),
          h("span", { class: "daily-meta" },
            h("span", { class: "chg" }, `${ch === 0 ? "No change" : `${ch > 0 ? "▲" : "▼"} ${L.fmtDelta(d, ch)}`} since ${L.fmtDate(prevIso).replace(/ \d{4}$/, "")}`),
            h("span", null, L.fmtDate(iso))),
          sparkline(d));
      })));
  }

  function sparkline(ind) {
    const pts = ind.points.slice(-36);
    const W = 160, H = 34, pad = 3;
    const ys = pts.map((p) => p[1]);
    const min = Math.min(...ys), max = Math.max(...ys);
    const span = max - min || 1;
    const x = (i) => pad + (i / Math.max(1, pts.length - 1)) * (W - pad * 2);
    const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
    // The line stretches to fit its card, so the end dot sits on top as its own element and stays round.
    const dot = h("span", { class: "spark-end" });
    dot.style.left = `${((x(pts.length - 1) / W) * 100).toFixed(2)}%`;
    dot.style.top = `${((y(pts[pts.length - 1][1]) / H) * 100).toFixed(2)}%`;
    return h("span", { class: "spark-wrap", "aria-hidden": "true" },
      s("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", focusable: "false" },
        s("path", { d, class: "spark", "vector-effect": "non-scaling-stroke" })),
      dot);
  }

  function renderStats() {
    const root = $("view-stats");
    root.replaceChildren();
    const gen = L.fmtDate(ST.generatedAt.slice(0, 10));
    root.append(viewHead("stats", "Latest numbers",
      `The numbers behind your arguments, pulled from Reserve Bank and ABS tables on ${gen}. Each figure shows the period it covers. Pair them with examples to show what caused them.`));

    root.append(dailyStrip("stats"));

    // Nothing is open until a figure is picked; picking the open one again closes it.
    if (ui.statSel && !indById[ui.statSel]) ui.statSel = null;
    const pick = (ind) => () => {
      ui.statSel = ui.statSel === ind.id ? null : ind.id;
      renderStats();
      const t = document.querySelector(`#view-stats .tile[data-ind="${ind.id}"]`);
      if (t) t.focus({ preventScroll: true });
      const panel = $("stat-title");
      if (panel) {
        // Bring the chart into view when most of it would be below the fold.
        const r = panel.getBoundingClientRect();
        if (r.top > window.innerHeight * 0.45 || r.top < 0) {
          panel.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
        }
      }
    };
    const ind = indById[ui.statSel];
    const groups = [["headline", "Headline figures"], ["more", "Wages, interest rates, credit and trade"]];
    for (const [g, title] of groups) {
      const inds = ST.indicators.filter((i) => (i.group || "headline") === g);
      if (!inds.length) continue;
      root.append(h("section", { class: "section", "aria-labelledby": "h-stats-" + g },
        h("h2", { id: "h-stats-" + g }, title),
        h("div", { class: "tiles", role: "group", "aria-label": title }, inds.map((i) => statTile(i, pick(i), i.id === ui.statSel)))));
      // The chart opens straight under the group you picked from, not at the bottom of the page.
      if (ind && inds.includes(ind)) {
        root.append(statDetail(ind));
        if (ind.id === "cash-rate" && ST.cashRateDecisions && ST.cashRateDecisions.length) root.append(decisionsTable());
      }
    }
    if (!ind) root.append(h("p", { class: "empty" }, "Pick a figure to see its chart, its history and a sentence you can cite in an essay."));
    root.append(suggestLink("Seen a new figure or report that students should know about?"));
  }

  // Time ranges for the chart. Where the main series doesn't reach back far enough (monthly CPI
  // only starts in 2025) the longer ranges use the quarterly history instead. A range that would
  // draw exactly the same chart as the next longer one is left out, so every button changes the chart.
  const RANGE_ORDER = { 2: 0, 5: 1, all: 2 };

  function rangeOptions(ind) {
    const lastT = L.parseISO(L.latest(ind)[0]).getTime();
    const hist = ind.history && ind.history.points && ind.history.points.length >= 2
      ? { ...ind, frequency: ind.history.frequency, points: ind.history.points } : null;
    const startOf = (pts) => L.parseISO(pts[0][0]).getTime();
    const opts = [["2", "2 years"], ["5", "5 years"], ["all", "All"]].map(([key, label]) => {
      const from = key === "all" ? -Infinity : lastT - Number(key) * 365.25 * L.DAY;
      const useHist = key !== "2" && hist && startOf(ind.points) > from && startOf(hist.points) < startOf(ind.points);
      const series = useHist ? hist : ind;
      const pts = series.points.filter((p) => L.parseISO(p[0]).getTime() >= from);
      return { key, label, order: RANGE_ORDER[key], ind: series, pts: pts.length >= 2 ? pts : series.points };
    });
    return opts.filter((o, i) => {
      const next = opts[i + 1];
      return !next || next.ind !== o.ind || next.pts.length !== o.pts.length;
    });
  }

  function statDetail(ind) {
    const [, v] = L.latest(ind);
    const ch = L.yearChange(ind);
    const panel = h("section", { class: "panel section", "aria-labelledby": "stat-title" });

    panel.append(h("div", { class: "detail-head" },
      h("div", null,
        h("h2", { id: "stat-title" }, ind.label),
        meta("dp-counts", L.periodOf(ind), ch ? `${L.fmtDelta(ind, ch.delta)} on a year earlier` : null,
          `${ind.frequency}${ind.adjustment ? ", " + ind.adjustment.toLowerCase() : ""}`)),
      h("div", { class: "big-value" }, L.fmtValue(ind, v))));
    panel.append(h("p", null, ind.meaning));

    const options = rangeOptions(ind);
    const sel = options.find((o) => o.order >= RANGE_ORDER[ui.statRange]) || options[options.length - 1];
    const cInd = sel.ind, usable = sel.pts;
    const refocus = (selector) => { const b = document.querySelector(selector); if (b) b.focus({ preventScroll: true }); };

    panel.append(h("div", { class: "section-head" },
      options.length > 1
        ? h("div", { class: "range", role: "group", "aria-label": "Time range" }, options.map((o) => h("button", {
          type: "button", "aria-pressed": String(o === sel), "data-range": o.key,
          onclick: () => { ui.statRange = o.key; renderStats(); refocus(`#view-stats .range [data-range="${o.key}"]`); },
        }, o.label)))
        : h("p", { class: "small muted" }, `${L.fmtMonth(usable[0][0])} to ${L.fmtMonth(usable[usable.length - 1][0])}, the whole series`),
      h("button", { type: "button", class: "btn ghost small", id: "stat-table-toggle", "aria-pressed": String(ui.statTable), onclick: () => { ui.statTable = !ui.statTable; renderStats(); refocus("#stat-table-toggle"); } },
        ui.statTable ? "Hide table" : "Show as table")));

    if (cInd !== ind) {
      panel.append(h("p", { class: "small muted" },
        `${ind.history.frequency} figures (${ind.history.source}), because the ${ind.frequency.toLowerCase()} series only starts in ${L.fmtMonth(ind.points[0][0], true)}.`));
    }

    const chartBox = h("div", { class: "chart-wrap" });
    panel.append(chartBox);
    mountChart(chartBox, cInd, usable);

    if (ui.statTable) {
      panel.append(h("div", { class: "table-wrap" }, h("table", null,
        h("caption", { class: "sr-only" }, `${ind.label}, most recent first`),
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Period"), h("th", { scope: "col", class: "num" }, ind.unit === "index" ? "Index" : "Value"))),
        h("tbody", null, usable.slice().reverse().map(([iso, val], i) => h("tr", null,
          h("td", null, L.fmtPeriod(iso, cInd.frequency, i === 0 && L.isDaily(cInd))),
          h("td", { class: "num" }, L.fmtValue(ind, val))))))));
    }

    const sentence = L.citationSentence(ind);
    const quote = h("blockquote", { class: "cite", id: "cite-text" }, sentence);
    panel.append(h("p", { class: "sublabel" }, "Ready-to-use sentence"), quote,
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn small", onclick: (ev) => copyText(sentence, quote, ev.currentTarget) }, "Copy sentence"),
        h("span", { class: "small muted" }, "Always say where a statistic comes from.")));

    const rel = L.relatedExamples(ind, EV).slice(0, 4);
    if (rel.length) {
      panel.append(h("p", { class: "sublabel" }, "Examples that explain these numbers"),
        h("ul", { class: "mini-ev" }, rel.map((e) => h("li", null,
          h("button", { type: "button", onclick: () => openEvidence(e.id) },
            h("span", null, e.title, meta("dp-counts", e.type, L.fmtDate(e.date))),
            h("span", { class: "mono" }, e.keyFigure))))));
    }
    const dps = ind.dotpoints.filter((id) => dpIndex[id]);
    if (dps.length) {
      panel.append(h("p", { class: "sublabel" }, "Skills"),
        h("div", { class: "tags" }, dps.map((id) => h("button", { type: "button", class: "tag", onclick: () => openDotpoint(id) }, dpIndex[id].short || dpIndex[id].text))));
    }
    panel.append(h("div", { class: "source" },
      h("span", null, "Source: ", h("a", { href: ind.sourceUrl, target: "_blank", rel: "noopener" }, ind.source + " ↗")),
      ind.published && h("span", null, `Released ${L.fmtDate(ind.published)}`),
      h("button", { type: "button", class: "link-btn small", onclick: () => openReport("stat:" + ind.id, ind.label) }, "Report a problem")));
    return panel;
  }

  function decisionsTable() {
    const rows = ST.cashRateDecisions.slice().reverse();
    return h("section", { class: "section", "aria-labelledby": "h-decisions" },
      h("h2", { id: "h-decisions" }, "Every cash rate change since 2019"),
      h("p", { class: "muted small" }, "Dates are when each new target took effect, the day after the RBA's announcement. From RBA table F1."),
      h("div", { class: "table-wrap" }, h("table", null,
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Took effect"), h("th", { scope: "col", class: "num" }, "Change"), h("th", { scope: "col", class: "num" }, "New target"))),
        h("tbody", null, rows.map((r) => h("tr", null,
          h("td", null, L.fmtDate(r.date)),
          h("td", { class: "num" }, `${r.change > 0 ? "▲ +" : "▼ −"}${Math.abs(r.change).toFixed(2)}`),
          h("td", { class: "num" }, `${r.rate.toFixed(2)}%`)))))));
  }

  // ----- the line chart -----

  function niceStep(range, count) {
    const raw = range / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  function mountChart(box, ind, pts) {
    let lastW = 0, drawnAt = 0;
    const draw = () => {
      const w = Math.round(box.clientWidth || 600);
      let redrawn = false;
      if (!(Math.abs(w - lastW) < 8 && box.firstChild)) {
        lastW = w;
        box.replaceChildren(lineChart(ind, pts, w));
        redrawn = true;
      }
      // Charts are built before they're on the page, when the line has no length to trace, so the
      // line is drawn in the first time the chart is showing. A resize that replaces the chart while
      // it is still drawing (a scrollbar appearing, say) starts the drawing again on the new one.
      if (!box.isConnected || !box.clientWidth) return;
      if (!drawnAt || (redrawn && performance.now() - drawnAt < 1200)) { drawnAt = performance.now(); drawIn(box); }
    };
    draw();
    nextFrame(draw); // by then the chart is on the page, even where resize events are slow to arrive
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(() => { if (!box.isConnected) { ro.disconnect(); return; } draw(); });
      ro.observe(box);
    }
  }

  // The line traces itself from left to right, then the latest point pops in.
  function drawIn(box) {
    const line = box.querySelector(".series"), area = box.querySelector(".series-area"), end = box.querySelector(".end-dot");
    if (!line || reducedMotion() || typeof line.getTotalLength !== "function") return;
    const len = Math.ceil(line.getTotalLength());
    if (!len) return;
    line.style.strokeDasharray = `${len}`;
    const anim = motion(line, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 900, easing: "cubic-bezier(.3,.6,.2,1)" });
    if (anim) anim.onfinish = () => { line.style.strokeDasharray = ""; };
    motion(area, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 500, fill: "backwards" });
    motion(end, [{ transform: "scale(0)" }, { transform: "scale(1.5)" }, { transform: "scale(1)" }],
      { duration: 380, delay: 850, easing: "cubic-bezier(.3,1.6,.5,1)", fill: "backwards" });
  }

  function lineChart(ind, pts, width) {
    const W = Math.max(280, width), H = W < 480 ? 200 : Math.round(Math.min(420, Math.max(240, W * 0.26)));
    const m = { t: 16, r: 14, b: 26, l: 46 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const ts = pts.map((p) => L.parseISO(p[0]).getTime());
    const vs = pts.map((p) => p[1]);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (ind.band) { lo = Math.min(lo, ind.band[0]); hi = Math.max(hi, ind.band[1]); }
    if (ind.kind === "balance") { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (hi === lo) { hi += 1; lo -= 1; }
    const step = niceStep(hi - lo, 4);
    const y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step;
    const t0 = ts[0], t1 = ts[ts.length - 1] === t0 ? t0 + L.DAY : ts[ts.length - 1];
    const X = (t) => m.l + ((t - t0) / (t1 - t0)) * iw;
    const Y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
    const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0;
    const fmtTick = (v) => {
      if (ind.unit === "US$") return `${(v * 100).toFixed(0)}¢`;
      const n = v.toFixed(dec).replace(/^-/, "−");
      return ind.unit === "%" || ind.unit === "% of GDP" ? `${n}%` : n;
    };

    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true", focusable: "false" });
    // horizontal grid + y labels
    for (let v = y0; v <= y1 + step / 2; v += step) {
      const yy = Y(v);
      svg.append(s("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: Math.abs(v) < step / 1000 && ind.kind === "balance" ? "zero-line" : "grid-line" }));
      svg.append(s("text", { x: m.l - 8, y: yy + 4, "text-anchor": "end", class: "ax" }, fmtTick(v)));
    }
    // target band
    if (ind.band) {
      const yTop = Y(ind.band[1]), yBot = Y(ind.band[0]);
      svg.append(s("rect", { x: m.l, y: yTop, width: iw, height: Math.max(1, yBot - yTop), class: "band-rect" }));
      svg.append(s("text", { x: m.l + 6, y: yTop + 12, class: "band-label" }, `RBA target ${ind.band[0]}–${ind.band[1]}%`));
    }
    // x ticks: years for long spans, months for short ones
    const spanYears = (t1 - t0) / (365.25 * L.DAY);
    const ticks = [];
    if (spanYears > 2.5) {
      const every = spanYears > 8 ? 2 : 1;
      for (let yr = new Date(t0).getUTCFullYear() + 1; yr <= new Date(t1).getUTCFullYear(); yr += every) {
        ticks.push([Date.UTC(yr, 0, 1), String(yr)]);
      }
    } else {
      const monthsApart = iw / Math.max(1, spanYears * 12) >= 22 ? 3 : 6;
      const start = new Date(t0);
      for (let y = start.getUTCFullYear(), mo = start.getUTCMonth() + 1; ; mo++) {
        if (mo > 11) { mo = 0; y++; }
        const t = Date.UTC(y, mo, 1);
        if (t > t1) break;
        if (mo % monthsApart === 0) ticks.push([t, `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo]} ${String(y).slice(2)}`]);
      }
    }
    for (const [t, label] of ticks) {
      const xx = X(t);
      if (xx < m.l + 14 || xx > W - m.r - 14) continue;
      svg.append(s("line", { x1: xx, x2: xx, y1: m.t + ih, y2: m.t + ih + 4, class: "grid-line" }));
      svg.append(s("text", { x: xx, y: H - 6, "text-anchor": "middle", class: "ax" }, label));
    }
    // series
    const d = pts.map((p, i) => `${i ? "L" : "M"}${X(ts[i]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    const base = Y(y0 < 0 && y1 > 0 ? 0 : y0);
    svg.append(s("path", { d: `${d}L${X(ts[ts.length - 1]).toFixed(1)},${base.toFixed(1)}L${X(ts[0]).toFixed(1)},${base.toFixed(1)}Z`, class: "series-area" }));
    svg.append(s("path", { d, class: "series" }));
    const li = pts.length - 1;
    svg.append(s("circle", { cx: X(ts[li]), cy: Y(vs[li]), r: 4.5, class: "end-dot" }));

    // hover + keyboard layer
    const hoverLine = s("line", { y1: m.t, y2: m.t + ih, class: "hover-line", visibility: "hidden" });
    const hoverDot = s("circle", { r: 4.5, class: "hover-dot", visibility: "hidden" });
    const hit = s("rect", { x: m.l, y: m.t, width: iw, height: ih, class: "hit" });
    svg.append(hoverLine, hoverDot, hit);

    const wrap = h("div", {
      class: "chart-wrap", tabindex: "0", role: "group",
      "aria-label": `${ind.label} chart, ${pts.length} points from ${L.fmtMonth(pts[0][0])} to ${L.fmtMonth(pts[li][0])}. Use left and right arrow keys to read values.`,
    });
    const tip = h("div", { class: "tooltip", hidden: true });
    const live = h("div", { class: "sr-only", "aria-live": "polite" });
    wrap.append(svg, tip, live);

    let cur = -1;
    const show = (i, announce) => {
      cur = Math.max(0, Math.min(li, i));
      const xx = X(ts[cur]), yy = Y(vs[cur]);
      hoverLine.setAttribute("x1", xx); hoverLine.setAttribute("x2", xx);
      hoverLine.setAttribute("visibility", "visible");
      hoverDot.setAttribute("cx", xx); hoverDot.setAttribute("cy", yy);
      hoverDot.setAttribute("visibility", "visible");
      const text = `${L.fmtPeriod(pts[cur][0], ind.frequency, cur === li && L.isDaily(ind))}: ${L.fmtValue(ind, vs[cur])}`;
      tip.textContent = text;
      tip.hidden = false;
      const scale = (wrap.clientWidth || W) / W;
      tip.style.left = `${Math.max(60, Math.min(W - 60, xx)) * scale}px`;
      tip.style.top = `${yy * scale}px`;
      if (announce) live.textContent = text;
    };
    const hide = () => {
      cur = -1;
      tip.hidden = true;
      hoverLine.setAttribute("visibility", "hidden");
      hoverDot.setAttribute("visibility", "hidden");
    };
    const nearest = (clientX) => {
      const r = svg.getBoundingClientRect();
      const x = ((clientX - r.left) / r.width) * W;
      const t = t0 + ((x - m.l) / iw) * (t1 - t0);
      let best = 0;
      for (let i = 1; i < ts.length; i++) if (Math.abs(ts[i] - t) < Math.abs(ts[best] - t)) best = i;
      return best;
    };
    hit.addEventListener("pointermove", (e) => show(nearest(e.clientX), false));
    hit.addEventListener("pointerdown", (e) => show(nearest(e.clientX), false));
    hit.addEventListener("pointerleave", hide);
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        show(cur < 0 ? li : cur + (e.key === "ArrowRight" ? 1 : -1), true);
      } else if (e.key === "Home") { e.preventDefault(); show(0, true); }
      else if (e.key === "End") { e.preventDefault(); show(li, true); }
      else if (e.key === "Escape") hide();
    });
    wrap.addEventListener("blur", hide);
    return wrap;
  }

  // ---------- DRILLS ----------

  function deckFor(key) {
    if (key === "due") return L.dueQueue(deck, progress.cards, TODAY, 10);
    let pool;
    if (key === "stats") pool = deck.filter((c) => c.kind === "stat");
    else if (key.startsWith("fa:")) {
      const fa = SY.focusAreas.find((f) => "fa:" + f.id === key);
      const ids = new Set(fa ? fa.dotpoints.map((d) => d.id) : []);
      pool = deck.filter((c) => c.dotpoints.some((id) => ids.has(id)));
    } else if (key.startsWith("dp:")) {
      const id = key.slice(3);
      pool = deck.filter((c) => c.dotpoints.includes(id));
    } else pool = deck.slice();
    const due = L.dueQueue(pool, progress.cards, TODAY);
    const dueIds = new Set(due.map((c) => c.id));
    const rest = pool.filter((c) => !dueIds.has(c.id))
      .sort((a, b) => (progress.cards[a.id] ? progress.cards[a.id].box : 0) - (progress.cards[b.id] ? progress.cards[b.id].box : 0));
    return due.concat(rest).slice(0, 10);
  }

  function deckTitle(key) {
    if (key === "due") return "Today's cards";
    if (key === "stats") return "Latest statistics";
    if (key.startsWith("fa:")) { const fa = SY.focusAreas.find((f) => "fa:" + f.id === key); return fa ? fa.name : "Focus area"; }
    if (key.startsWith("dp:")) { const dp = dpIndex[key.slice(3)]; return dp ? dp.text : "Dot point"; }
    return "Everything";
  }

  function startDrill(key) {
    const queue = deckFor(key);
    if (!queue.length) { toast("No flashcards here yet"); return; }
    ui.drill = { key, queue, base: queue.length, i: 0, shown: false, results: { again: 0, hard: 0, good: 0 }, requeued: {}, log: [] };
    go("drills");
  }


  // ---------- past papers and resources ----------
  // Everything here comes from data/resources.js. Links open the file on the publisher's own site.

  // Shown as new for 30 days after the daily check first finds it (not on the day collecting began).
  function isNewResource(it) {
    if (!it.added || !RES.since || it.added <= RES.since) return false;
    const d = L.parseISO(it.added);
    return d && (TODAY - d) / 86400000 <= 30;
  }

  function newChip(it) {
    return isNewResource(it) ? h("span", { class: "chip res-new" }, "New") : null;
  }

  function fileLabel(it) {
    return [it.format === "Web page" ? "Web page" : it.format || "PDF", it.size].filter(Boolean).join(", ");
  }

  function extLink(url, label, cls, srLabel) {
    return h("a", { href: url, target: "_blank", rel: "noopener", class: cls },
      label, srLabel && h("span", { class: "sr-only" }, " " + srLabel), h("span", { "aria-hidden": "true" }, " ↗"));
  }

  function dpChips(ids) {
    const known = (ids || []).filter((id) => dpIndex[id]);
    if (!known.length) return null;
    return h("span", { class: "res-dps" }, known.map((id) =>
      h("button", { type: "button", class: "chip quiet res-dp", onclick: () => openDotpoint(id), title: dpIndex[id].text }, dpIndex[id].short)));
  }

  function renderResources() {
    const root = $("view-resources");
    root.replaceChildren();
    const items = RES.items || [];
    const of = (g) => items.filter((i) => i.group === g);
    const fresh = items.filter(isNewResource);

    root.append(viewHead("resources", "Past papers and resources",
      "Every official HSC Economics past paper, marking guideline and band sample we can find, plus the RBA's study guides. Dotpoint checks the publishers' sites for new ones every day. Links open the file on the publisher's own site."));

    if (fresh.length) {
      root.append(h("section", { class: "section", "aria-labelledby": "res-new-h" },
        h("h2", { id: "res-new-h" }, "New this month"),
        h("ul", { class: "res-list" }, fresh.slice(0, 8).map((it) => h("li", { class: "res-item" },
          h("div", null, extLink(it.url, it.title, "res-title", `(${fileLabel(it)}, opens in a new tab)`)),
          meta("res-meta", it.publisher, it.kind, fileLabel(it), `Found ${L.fmtDate(it.added)}`))))));
    }

    // the new syllabus: NESA's sample paper
    const ns = of("new-syllabus");
    if (ns.length) {
      root.append(h("section", { class: "section panel res-callout", "aria-labelledby": "res-ns-h" },
        h("div", null,
          h("h2", { id: "res-ns-h" }, "The new syllabus sample exam"),
          h("p", { class: "muted" }, "NESA's sample paper for the Economics 11–12 Syllabus (2025), first examined in the 2028 HSC. It shows the new layout: multiple choice, short answers, a stimulus-based question and an extended response.")),
        h("ul", { class: "res-list" }, ns.map((it) => h("li", { class: "res-item" },
          h("div", null, extLink(it.url, it.title.replace(/^Economics 11–12 \(2025\): /, ""), "res-title", `(${fileLabel(it)}, opens in a new tab)`), newChip(it)),
          meta("res-meta", it.publisher, fileLabel(it)))))));
    }

    // HSC exam packs: one row per year
    const hsc = of("hsc");
    if (hsc.length) {
      const years = [...new Set(hsc.map((i) => i.year))].sort((a, b) => b - a);
      const cols = [["Exam paper", "Exam paper"], ["Marking guidelines", "Marking guidelines"], ["Marker feedback", "Marker feedback"]];
      const table = h("table", { class: "res-table" },
        h("caption", { class: "sr-only" }, "HSC Economics exam papers by year"),
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Year"), cols.map(([, label]) => h("th", { scope: "col" }, label)))),
        h("tbody", null, years.map((y) => {
          const row = hsc.filter((i) => i.year === y);
          return h("tr", null,
            h("th", { scope: "row" }, String(y)),
            cols.map(([kind, label]) => {
              const it = row.find((i) => i.kind === kind);
              return h("td", { "data-label": label }, it
                ? [extLink(it.url, it.format === "Web page" ? "Read on NESA" : fileLabel(it), "res-file", `${y} ${label.toLowerCase()}, opens in a new tab`), newChip(it)]
                : h("span", { class: "muted small" }, "Not out yet"));
            }));
        })));
      root.append(h("section", { class: "section", "aria-labelledby": "res-hsc-h" },
        h("div", { class: "section-head" }, h("div", null,
          h("h2", { id: "res-hsc-h" }, "HSC exam papers"),
          h("p", { class: "muted small" }, `${years.length} years from NESA, each with its marking guidelines and what markers said about students' answers. These were set on the 2009 syllabus, which is examined up to the 2027 HSC.`))),
        h("div", { class: "res-table-wrap" }, table)));
    }

    // band samples: real answers at each band, grouped by question
    const st = of("standards");
    if (st.length) {
      const groups = [];
      for (const it of st) {
        const name = it.title.split(": ")[0];
        let g = groups.find((x) => x.name === name);
        if (!g) groups.push(g = { name, items: [] });
        g.items.push(it);
      }
      const bandOrder = (b) => -parseInt((b || "0").replace(/\D/g, "").slice(-1) || "0", 10);
      root.append(h("section", { class: "section", "aria-labelledby": "res-std-h" },
        h("div", { class: "section-head" }, h("div", null,
          h("h2", { id: "res-std-h" }, "Real answers at every band"),
          h("p", { class: "muted small" }, "Student answers from past HSC exams that NESA chose to show each band, from Band 1/2 to Band 5/6. Put a top answer next to a middle one to see what lifts the mark."))),
        h("ul", { class: "res-list res-groups" }, groups.map((g) => h("li", { class: "res-item" },
          h("span", { class: "res-title-plain" }, g.name),
          h("span", { class: "res-bands" }, g.items.slice().sort((a, b) => bandOrder(a.band) - bandOrder(b.band) || (a.title < b.title ? -1 : 1)).map((it) => {
            const label = it.band ? it.title.split(": ").slice(1).join(": ").replace(/, sample 1$/, "") : it.title.split(": ").slice(1).join(": ") || "Answer";
            return extLink(it.url, label, "chip quiet res-band", `${g.name}, ${fileLabel(it)}, opens in a new tab`);
          })))))));
    }

    // RBA Education, grouped by type
    const rba = of("rba");
    if (rba.length) {
      const kinds = [...new Set(rba.map((i) => i.kind))];
      const order = ["Explainer", "In a Nutshell", "Snapshot", "Interactive", "Chart pack", "Student event"];
      kinds.sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
      const plural = { "In a Nutshell": "In a Nutshell guides", "Chart pack": "Chart pack", "Student event": "Student events" };
      root.append(h("section", { class: "section", "aria-labelledby": "res-rba-h" },
        h("div", { class: "section-head" }, h("div", null,
          h("h2", { id: "res-rba-h" }, "Study guides from the Reserve Bank"),
          h("p", { class: "muted small" }, "Short, plain-English guides from the RBA's education team. Tap a dot point to see where it fits in the syllabus."))),
        kinds.map((k) => h("div", { class: "res-kind" },
          h("h3", null, plural[k] || k + "s"),
          h("ul", { class: "res-list" }, rba.filter((i) => i.kind === k).map((it) => h("li", { class: "res-item" },
            h("div", null, extLink(it.url, it.title, "res-title", `(${fileLabel(it)}, opens in a new tab)`), newChip(it)),
            it.desc && h("p", { class: "res-desc" }, it.desc),
            h("span", { class: "res-meta" },
              h("span", null, fileLabel(it)),
              it.pdf && extLink(it.pdf, "PDF", "res-file", `copy of ${it.title}, opens in a new tab`),
              dpChips(it.dotpoints)))))))));
    }

    if (!items.length) root.append(h("p", { class: "empty" }, "The resources list hasn't loaded. Try again in a moment."));

    root.append(h("p", { class: "small muted res-foot" },
      `${items.length} resources from NESA and the Reserve Bank of Australia. Checked every day; the list last changed ${RES.updated ? L.fmtDate(RES.updated) : "recently"}. `,
      "Dotpoint isn't affiliated with NESA or the RBA, and doesn't host their files. Trial papers from schools aren't listed, because schools don't publish them openly."));
  }

  function renderDrills() {
    const root = $("view-drills");
    root.replaceChildren();
    const d = ui.drill;
    if (d && d.i < d.queue.length) return renderCard(root, d);
    if (d && d.i >= d.queue.length) return renderSummary(root, d);

    root.append(viewHead("drills", "Flashcards",
      "Recall practice on examples, statistics and key terms, using spaced repetition: cards you get wrong come back sooner, cards you know come back later."));
    const main = h("div", { class: "section" });
    root.append(h("div", { class: "drills-layout" }, main, progressPanel()));

    const dueQ = L.dueQueue(deck, progress.cards, TODAY);
    const dueCount = dueQ.length;
    const reviewCount = dueQ.filter((c) => progress.cards[c.id]).length;
    const newCount = dueCount - reviewCount;
    const decks = [
      ["due", "Today's cards", reviewCount
        ? `${reviewCount} to review${newCount ? `, then ${newCount} new` : ""}, 10 at a time`
        : dueCount ? `${dueCount} cards you haven't seen, 10 at a time` : "Nothing due today", dueCount],
      ["stats", "Latest statistics", `${deck.filter((c) => c.kind === "stat").length} cards, refreshed with each data release`, 1],
      ...SY.focusAreas.map((fa) => {
        const ids = new Set(fa.dotpoints.map((x) => x.id));
        const n = deck.filter((c) => c.dotpoints.some((id) => ids.has(id))).length;
        return ["fa:" + fa.id, fa.name, `Year ${fa.year}, ${n} card${n === 1 ? "" : "s"}`, n];
      }),
    ];
    main.append(h("h2", null, "Choose a deck"),
      h("div", { class: "deck-list" }, decks.map(([key, title, detail, n]) => h("button", {
        type: "button", class: "deck", disabled: n ? null : true, onclick: () => startDrill(key),
      }, h("strong", null, title), h("span", { class: "count" }, detail)))),
      h("p", { class: "small muted" }, "Keyboard: ", h("kbd", null, "Space"), " flips the card, then ",
        h("kbd", null, "1"), " forgot, ", h("kbd", null, "2"), " unsure, ", h("kbd", null, "3"), " knew it."));
  }

  // Where your cards stand, what's due over the next week, and how the spacing works.
  function progressPanel() {
    const states = progress.cards;
    const learned = deck.filter((c) => states[c.id] && states[c.id].box >= 3).length;
    const learning = deck.filter((c) => states[c.id] && states[c.id].box < 3).length;
    const fresh = deck.length - learned - learning;
    const pct = (n, of) => `${(n / Math.max(1, of)) * 100}%`;
    const today = L.dayNumber(TODAY);
    const week = Array.from({ length: 7 }, (_, k) => {
      const n = deck.filter((c) => states[c.id] && (k === 0 ? states[c.id].due <= today : states[c.id].due === today + k)).length;
      const label = k === 0 ? "Today" : new Date(TODAY.getTime() + k * L.DAY).toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" });
      return { n, label };
    });
    const most = Math.max(1, ...week.map((x) => x.n));
    const num = (n, label, cls) => h("div", { class: "pnum " + cls }, h("b", null, String(n)), h("span", { class: "small muted" }, label));
    // The heading sits above the panel, level with "Choose a deck", so the panel lines up with the first row of decks
    return h("aside", { class: "section side-col", "aria-labelledby": "h-progress" },
      h("h2", { id: "h-progress" }, "Your progress"),
      h("div", { class: "panel side-panel" },
      h("div", { class: "split-bar", role: "img", "aria-label": `${learned} learned, ${learning} in progress, ${fresh} not started, out of ${deck.length}` },
        h("span", { class: "seg-learned", style: `width:${pct(learned, deck.length)}` }),
        h("span", { class: "seg-learning", style: `width:${pct(learning, deck.length)}` })),
      h("div", { class: "pnums" }, num(learned, "learned", "learned"), num(learning, "in progress", "learning"), num(fresh, "not started", "fresh")),
      h("p", { class: "sublabel" }, "Coming up this week"),
      week.some((x) => x.n)
        ? h("div", { class: "week", role: "img", "aria-label": week.map((x) => `${x.label}: ${x.n}`).join(", ") },
          week.map((x) => h("div", { class: "week-day" },
            h("span", { class: "week-n" }, x.n ? String(x.n) : ""),
            h("span", { class: "week-track" }, h("span", { class: "week-bar", style: `height:${Math.round((x.n / most) * 100)}%` })),
            h("span", { class: "week-label" }, x.label))))
        : h("p", { class: "small muted" }, "Nothing scheduled yet. Cards you study are spaced out over the coming days and show up here."),
      h("p", { class: "sublabel" }, "How spacing works"),
      h("div", { class: "ladder" }, L.INTERVALS.slice(1).map((days, i) =>
        h("span", { class: "rung" }, mark(i >= 2 ? "confident" : "shaky"), days === 1 ? "1 day" : `${days} days`))),
      h("p", { class: "small muted" }, "Each time you know a card it moves one step along and comes back later. Forget it and it starts again. From the third step it counts as learned."),
      h("p", { class: "sublabel" }, "By focus area"),
      h("ul", { class: "fa-progress" }, SY.focusAreas.map((fa) => {
        const ids = new Set(fa.dotpoints.map((x) => x.id));
        const cards = deck.filter((c) => c.dotpoints.some((id) => ids.has(id)));
        const l = cards.filter((c) => states[c.id] && states[c.id].box >= 3).length;
        return h("li", null, h("span", { class: "fa-name" }, fa.name),
          h("span", { class: "mini-bar", "aria-hidden": "true" }, h("span", { style: `width:${pct(l, cards.length)}` })),
          h("span", { class: "small muted" }, `${l} of ${cards.length}`));
      }))));
  }

  // One dot per card in the session: filled in the colour of your answer as you go.
  function sessionPanel(d) {
    const r = d.results;
    const name = { again: "forgot", hard: "unsure", good: "knew it" };
    return h("aside", { class: "panel side-panel", "aria-labelledby": "h-session" },
      h("h2", { id: "h-session" }, "This session"),
      h("div", { class: "session-dots", role: "img", "aria-label": `${d.i} of ${d.queue.length} cards done` },
        d.queue.map((c, i) => h("span", { class: "sdot" + (i < d.i ? " done g-" + d.log[i] : i === d.i ? " now" : ""),
          title: i < d.i ? name[d.log[i]] : i === d.i ? "this card" : "to come" }))),
      h("div", { class: "pnums" },
        h("div", { class: "pnum learned" }, h("b", null, String(r.good)), h("span", { class: "small muted" }, "knew it")),
        h("div", { class: "pnum learning" }, h("b", null, String(r.hard)), h("span", { class: "small muted" }, "unsure")),
        h("div", { class: "pnum forgot" }, h("b", null, String(r.again)), h("span", { class: "small muted" }, "forgot"))),
      h("p", { class: "sublabel" }, "Shortcuts"),
      h("dl", { class: "keys" },
        [["Space", "Flip the card"], ["1", "Forgot"], ["2", "Unsure"], ["3", "Knew it"]].map(([k, v]) =>
          h("div", null, h("dt", null, h("kbd", null, k)), h("dd", null, v)))));
  }

  const KIND_LABEL = { evidence: "Example", term: "Key term", stat: "Statistic" };

  // A two-sided card: the question on the front, the answer on the back. Tap it, or press Space, to flip.
  function renderCard(root, d) {
    const c = d.queue[d.i];
    const extra = d.queue.length - (d.base || d.queue.length);
    const dps = c.dotpoints.filter((id) => dpIndex[id]);
    root.append(viewHead("drills", `Card ${d.i + 1} of ${d.queue.length}`,
      `Flashcards: ${deckTitle(d.key)}.${extra ? ` ${extra} card${extra === 1 ? "" : "s"} you forgot ${extra === 1 ? "comes" : "come"} back at the end.` : ""}`));
    const card = h("div", { class: "flash" });
    card.append(h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(d.queue.length), "aria-valuenow": String(d.i), "aria-label": "Progress" },
      h("span", { style: `width:${(d.i / d.queue.length) * 100}%` })));
    card.append(h("div", { class: "flash-top" }, h("span", { class: "small muted" }, KIND_LABEL[c.kind] || "Card"),
      h("button", { type: "button", class: "btn ghost small", onclick: () => { ui.drill = null; renderDrills(); } }, "Stop")));

    const front = h("div", { class: "flip-face flip-front", "aria-hidden": String(!!d.shown), inert: d.shown ? true : null },
      h("span", { class: "chip" }, "Question"),
      h("p", { class: "flash-q", id: "flash-q" }, c.q),
      h("p", { class: "flip-hint small muted" }, "Tap the card or press Space to flip"));
    const back = h("div", { class: "flip-face flip-back", "aria-hidden": String(!d.shown), inert: d.shown ? null : true },
      h("span", { class: "chip" }, "Answer"),
      h("p", { class: "flash-a-main" }, c.a),
      c.source && h("p", { class: "small muted" }, "Source: ", c.source),
      dps.length > 0 && h("p", { class: "small muted" }, "Dot point: ", dpIndex[dps[0]].text),
      c.kind === "evidence" && h("button", { type: "button", class: "link-btn small", onclick: () => { ui.drill = null; openEvidence(c.ref); } }, "Open the example"));
    card.append(h("div", { class: "flip" + (d.shown ? " is-flipped" : ""), id: "flip",
      onclick: (ev) => { if (!ev.target.closest("button, a")) flipCard(); } },
      h("div", { class: "flip-inner" }, front, back)));
    card.append(h("p", { class: "sr-only", id: "flip-live", "aria-live": "polite" }));
    card.append(h("div", { class: "flash-controls", id: "flash-controls" }, flashControls(d, c)));
    root.append(h("div", { class: "session-layout" }, card, sessionPanel(d)));
    // Each new card rises in. (Moving up, not sideways, so it never pokes off the edge of a phone.)
    motion(card.querySelector(".flip"), [{ opacity: 0, transform: "translateY(14px) scale(0.98)" }, { opacity: 1, transform: "none" }],
      { duration: 300, easing: "cubic-bezier(.2,.8,.2,1)" });
  }

  function flashControls(d, c) {
    if (!d.revealed) {
      return h("button", { type: "button", class: "btn primary", id: "show-answer", onclick: () => flipCard() },
        "Flip to see the answer ", h("kbd", null, "Space"));
    }
    return [
      h("p", { class: "small muted" }, "How well did you know it? Keys 1, 2 and 3 work too. Press Space or tap the card to flip it back and reread the question."),
      h("div", { class: "grades" },
        h("button", { type: "button", class: "btn g-again", id: "g-again", onclick: () => gradeCard("again") }, "Forgot", h("small", null, "back later today")),
        h("button", { type: "button", class: "btn g-hard", id: "g-hard", onclick: () => gradeCard("hard") }, "Unsure", h("small", null, nextGap(c, "hard"))),
        h("button", { type: "button", class: "btn g-good", id: "g-good", onclick: () => gradeCard("good") }, "Knew it", h("small", null, nextGap(c, "good")))),
    ];
  }

  // Turn the card over in place. The first flip reveals the answer and the grading buttons.
  function flipCard() {
    const d = ui.drill;
    const flip = $("flip");
    if (!d || !flip) return;
    d.shown = !d.shown;
    const firstReveal = d.shown && !d.revealed;
    if (d.shown) d.revealed = true;
    flip.classList.toggle("is-flipped", d.shown);
    const [front, back] = flip.querySelectorAll(".flip-face");
    front.setAttribute("aria-hidden", String(d.shown)); front.inert = d.shown;
    back.setAttribute("aria-hidden", String(!d.shown)); back.inert = !d.shown;
    const c = d.queue[d.i];
    $("flip-live").textContent = d.shown ? `Answer: ${c.a}` : `Question: ${c.q}`;
    if (firstReveal) {
      $("flash-controls").replaceChildren(...[].concat(flashControls(d, c)));
      const g = $("g-good"); if (g) g.focus();
    }
  }

  // When a card comes back after this grade, worked out by the same rule the scheduler uses.
  function nextGap(c, result) {
    const days = L.INTERVALS[L.grade(progress.cards[c.id], result, TODAY).box];
    return days === 1 ? "back tomorrow" : `back in ${days} days`;
  }

  function gradeCard(result) {
    const d = ui.drill;
    if (!d || !d.revealed) return;
    const c = d.queue[d.i];
    if (result === "good") {
      const b = $("g-good");
      if (b) { const r = b.getBoundingClientRect(); dotBurst(r.left + r.width / 2, r.top + r.height / 2, 10); }
    }
    commit((p) => { p.cards[c.id] = L.grade(p.cards[c.id], result, TODAY); });
    d.results[result]++;
    d.log[d.i] = result;
    if (result === "again" && !d.requeued[c.id]) { d.requeued[c.id] = true; d.queue.push(c); }
    d.i++;
    d.shown = false;
    d.revealed = false;
    renderDrills();
    const btn = $("show-answer");
    if (btn) btn.focus(); else { const hd = $("h-drills"); if (hd) hd.focus(); }
  }

  function renderSummary(root, d) {
    const r = d.results;
    const perfect = r.good > 0 && !r.hard && !r.again;
    root.append(viewHead("drills", perfect ? "Perfect session" : "Session complete", perfect
      ? "You knew every card. They'll come back later, spaced out, to make sure they stick."
      : "Cards you forgot are scheduled first next time. Short, regular sessions work better than cramming."));
    if (perfect) setTimeout(() => dotShower(36), 150);
    root.append(h("div", { class: "panel section" },
      h("div", { class: "summary-nums" },
        h("div", null, h("b", null, String(r.good)), h("span", { class: "small muted" }, "knew it")),
        h("div", null, h("b", null, String(r.hard)), h("span", { class: "small muted" }, "unsure")),
        h("div", null, h("b", null, String(r.again)), h("span", { class: "small muted" }, "forgot"))),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn primary", onclick: () => startDrill(d.key) }, "Next 10 cards"),
        h("button", { type: "button", class: "btn", onclick: () => { ui.drill = null; go("today"); } }, "Back to Home"))));
  }

  // During a card, Space only ever turns the card over, wherever focus is. It never presses the
  // focused button, so it can't grade the card and move on (after the first flip, focus sits on
  // "Knew it"). Enter still presses the focused button.
  const drillKeysOn = (e) => ui.view === "drills" && ui.drill && ui.drill.i < ui.drill.queue.length
    && !(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) && !document.querySelector("dialog[open]")
    && !(e.altKey || e.ctrlKey || e.metaKey);
  document.addEventListener("keydown", (e) => {
    if (!drillKeysOn(e)) return;
    const onControl = e.target && /^(BUTTON|A|SUMMARY)$/.test(e.target.tagName);
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat) flipCard();
    } else if (e.key === "Enter" && !ui.drill.revealed && !onControl) {
      e.preventDefault();
      flipCard();
    } else if (ui.drill.revealed && ["1", "2", "3"].includes(e.key)) {
      e.preventDefault();
      gradeCard({ 1: "again", 2: "hard", 3: "good" }[e.key]);
    }
  });
  // Buttons press on Space's key-up, so stop that too.
  document.addEventListener("keyup", (e) => { if (e.key === " " && drillKeysOn(e)) e.preventDefault(); });

  // ---------- ESSAY CHECKER ----------
  // Instant checks on a practice essay, run in this browser with no AI: figures against the latest RBA
  // and ABS data, what the question's verb asks for, structure, key terms, and evidence to add. The
  // draft stays in this browser and nothing is sent anywhere. It never gives a mark or rewrites anything.

  const DRAFT_KEY = "dotpoint.essayDraft.v1";
  const OLD_ESSAYS = "dotpoint.essays.v1"; // essays marked by the old Claude marking; a reset still clears them
  const FIG_LABEL = { current: "Latest figure", historical: "Older figure, dated", outdated: "Out of date", unmatched: "Check this figure", untracked: "Before our data" };

  function emptyDraft() { return { qid: QS.length ? QS[0].id : "custom", custom: "", text: "" }; }

  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (!d || typeof d !== "object") return emptyDraft();
      const qid = d.qid === "custom" || QS.some((q) => q.id === d.qid) ? d.qid : emptyDraft().qid;
      return { qid, custom: String(d.custom || "").slice(0, 400), text: String(d.text || "").slice(0, L.ESSAY_MAX_CHARS * 2) };
    } catch (e) {
      return emptyDraft();
    }
  }

  let draftTimer = null;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(ui.essay.draft)); } catch (e) { /* storage blocked */ } }, 400);
  }

  ui.essay = { draft: loadDraft(), result: null, checked: null, msg: "" };

  // Essays marked by the old Claude marking, in this browser or the account copy.
  async function clearOldEssays() {
    try { localStorage.removeItem(OLD_ESSAYS); } catch (e) { /* storage blocked */ }
    const col = Sync.db && Sync.uid ? Sync.db.collection(`data/users/${Sync.uid}`) : null;
    if (!col) return;
    try {
      const snap = await col.where("kind", "==", "essay").get();
      await Promise.all(snap.docs.map((d) => col.doc(d.id).delete()));
    } catch (e) { /* nothing there, or the account copy is out of reach */ }
  }

  function questionText(d) {
    if (d.qid === "custom") return d.custom.trim();
    const q = QS.find((x) => x.id === d.qid);
    return q ? q.text : "";
  }

  function focusIn(view, id) {
    if (ui.view !== view) return;
    const el = $(id);
    if (el) el.focus();
  }

  function renderEssay() {
    const root = $("view-essay");
    root.replaceChildren();
    root.append(viewHead("essay", "Essay checker",
      "Paste a practice essay to check it in seconds: whether your figures are the latest, whether you've done what the question's verb asks, your structure and key terms, and evidence you could add. It runs in your browser with no AI, so nothing is sent anywhere. It never gives a mark or rewrites your work."));
    root.append(h("div", { class: "essay-layout" }, essayForm(), essayResults()));
  }

  function verbNote(q) {
    const verb = L.verbOf(q);
    if (verb) return [h("b", null, verb[0].toUpperCase() + verb.slice(1)), ` means: ${L.VERBS[verb].charAt(0).toLowerCase()}${L.VERBS[verb].slice(1)}`];
    return q.trim() ? "Questions usually start with a key verb such as assess, evaluate or analyse. The checker looks at whether you've done what it asks." : "";
  }

  function countText(text) {
    const w = L.wordCount(text), p = L.paragraphs(text).length;
    return `${w} word${w === 1 ? "" : "s"}, ${p} paragraph${p === 1 ? "" : "s"}`;
  }

  function essayForm() {
    const E = ui.essay, d = E.draft;
    const note = h("p", { class: "verb-note", id: "essay-verb", "aria-live": "polite" }, verbNote(questionText(d)));
    const sel = h("select", { id: "essay-q", class: "field" },
      [12, 11].map((y) => h("optgroup", { label: `Year ${y} practice questions` },
        QS.filter((x) => x.year === y).map((x) => h("option", { value: x.id }, x.text)))),
      h("optgroup", { label: "Your own" }, h("option", { value: "custom" }, "I'll type my own question")));
    sel.value = d.qid;
    sel.addEventListener("change", () => { d.qid = sel.value; saveDraft(); renderEssay(); focusIn("essay", "essay-q"); });

    const custom = d.qid === "custom" && h("textarea", { id: "essay-custom", class: "field", rows: "2", maxlength: "400", placeholder: "For example: Assess the impact of rising interest rates on Australian households." });
    if (custom) {
      custom.value = d.custom;
      custom.addEventListener("input", () => { d.custom = custom.value; saveDraft(); note.replaceChildren(...[].concat(verbNote(d.custom))); });
    }

    const counter = h("p", { class: "small muted", id: "essay-count", "aria-live": "polite" }, countText(d.text));
    const text = h("textarea", { id: "essay-text", class: "field essay-text", rows: "18", spellcheck: "true",
      placeholder: "Paste or type your essay. Leave a blank line between paragraphs." });
    text.value = d.text;
    let countTimer = null;
    text.addEventListener("input", () => {
      d.text = text.value; saveDraft();
      clearTimeout(countTimer);
      countTimer = setTimeout(() => {
        counter.textContent = countText(d.text);
        const stale = $("checks-stale");
        if (stale) stale.hidden = d.text === E.checked;
      }, 250);
    });

    return h("form", { class: "panel essay-form", novalidate: true, onsubmit: (ev) => { ev.preventDefault(); runCheck(); } },
      h("label", { for: "essay-q", class: "sublabel" }, "Question"),
      sel,
      custom && h("label", { for: "essay-custom", class: "sr-only" }, "Your question"),
      custom,
      note,
      h("label", { for: "essay-text", class: "sublabel" }, "Your response"),
      text,
      counter,
      h("p", { class: "form-msg", id: "essay-msg", role: "alert", tabindex: "-1" }, E.msg),
      h("div", { class: "btn-row" },
        h("button", { type: "submit", class: "btn primary" }, "Check my essay"),
        h("span", { class: "small muted" }, "Instant, in your browser. Your draft is saved here as you type.")));
  }

  function runCheck() {
    const E = ui.essay, d = E.draft;
    const question = questionText(d);
    const essay = d.text.trim();
    const words = L.wordCount(essay);
    const fail = (msg, id) => { E.msg = msg; renderEssay(); focusIn("essay", id || "essay-msg"); };
    if (question.length < 15) return fail("Type the question you're answering first.", d.qid === "custom" ? "essay-custom" : "essay-q");
    if (words < L.ESSAY_MIN_WORDS) return fail(`Write at least ${L.ESSAY_MIN_WORDS} words to check. Your response has ${words}.`, "essay-text");
    if (essay.length > L.ESSAY_MAX_CHARS) return fail("This response is too long to check in one go. Trim it to about 3,500 words.", "essay-text");
    const listed = d.qid !== "custom" ? (QS.find((x) => x.id === d.qid) || {}).dotpoints : null;
    E.result = L.checkEssay({ question, listedDotpoints: listed, essay, syllabus: SY, evidence: EV, stats: ST });
    E.checked = d.text;
    E.msg = "";
    renderEssay();
    const head = $("h-checks");
    if (head) {
      if (narrowScreen()) head.scrollIntoView({ block: "start" });
      head.focus({ preventScroll: true });
    }
  }

  // One line of the checklist: a filled dot when it's done, a red ring when there's something to fix.
  function checkItem(c) {
    return h("li", { class: c.ok ? "ok" : "fix" },
      h("span", { class: `mark ${c.ok ? "m-confident" : "m-fix"}`, "aria-hidden": "true" }),
      h("span", null, h("span", { class: "sr-only" }, c.ok ? "Done: " : "To fix: "), c.text));
  }

  function figureText(f) {
    const ind = indById[f.statId], name = ind.short.toLowerCase();
    if (f.status === "current") return `Matches the latest ${name}: ${f.latest}.${f.dated ? "" : " Add the period it's for, as markers look for it."}`;
    if (f.status === "historical") return `This was ${name} in ${f.then}. Fine for history; the latest is ${f.latest}.`;
    if (f.status === "outdated") return `This was ${name} in ${f.then}, so it's out of date. The latest is ${f.latest}.`;
    if (f.status === "untracked") return `Dotpoint's ${name} data starts in ${f.then}, so it can't check this one. Make sure it comes from the RBA, the ABS or another reliable source.`;
    return `This doesn't match any ${name} figure in the RBA and ABS data. The latest is ${f.latest}. Check your source.`;
  }

  function essayResults() {
    const E = ui.essay, r = E.result;
    const box = h("section", { class: "essay-results", "aria-labelledby": "h-checks" },
      h("h2", { id: "h-checks", tabindex: "-1" }, "Your checks"));
    if (!r) {
      box.append(h("p", { class: "small muted" }, "Press Check my essay and the results appear here: your figures against the latest RBA and ABS data, what the question's verb asks for, your structure and key terms, and evidence you could add."));
      return box;
    }
    const fixes = r.figures.filter((f) => f.status === "outdated" || f.status === "unmatched").length;
    box.append(
      h("p", { class: "small stale", id: "checks-stale", hidden: E.draft.text === E.checked ? true : null }, "You've changed your essay since this check. Check it again to update these."),
      h("p", { class: "small muted" }, `${r.words} words in ${r.paragraphs} paragraph${r.paragraphs === 1 ? "" : "s"}. ${r.figures.length
        ? `${r.figures.length} figure${r.figures.length === 1 ? "" : "s"} checked${fixes ? `, ${fixes} to fix` : ", none to fix"}.`
        : "No figures matched to the RBA and ABS data yet."}`));

    box.append(h("section", { class: "check-group", "aria-labelledby": "h-figs" },
      h("h3", { id: "h-figs" }, "Your figures"),
      r.figures.length
        ? h("ul", { class: "checks" }, r.figures.map((f) => h("li", null,
          h("p", { class: "check-quote" }, `“${f.quote}”`),
          h("p", null, h("span", { class: `chip fig-${f.status}` }, FIG_LABEL[f.status]), " ", figureText(f)),
          h("button", { type: "button", class: "tag", onclick: () => { ui.statSel = f.statId; go("stats"); } },
            h("b", null, L.fmtValue(indById[f.statId], L.latest(indById[f.statId])[1])), indById[f.statId].short))))
        : h("p", { class: "small muted" }, "No percentages next to a statistic Dotpoint tracks, such as inflation, the cash rate or unemployment. Strong responses use several, each with its period.")));

    box.append(h("section", { class: "check-group", "aria-labelledby": "h-verb" },
      h("h3", { id: "h-verb" }, "Answering the question"),
      r.verb && h("p", { class: "small muted" }, h("b", null, r.verb[0].toUpperCase() + r.verb.slice(1)), ` means: ${L.VERBS[r.verb].charAt(0).toLowerCase()}${L.VERBS[r.verb].slice(1)}`),
      h("ul", { class: "checklist" }, r.question.map(checkItem))));

    box.append(h("section", { class: "check-group", "aria-labelledby": "h-structure" },
      h("h3", { id: "h-structure" }, "Structure"),
      h("ul", { class: "checklist" }, r.structure.map(checkItem))));

    if (r.terms.used.length || r.terms.missing.length) {
      box.append(h("section", { class: "check-group", "aria-labelledby": "h-terms" },
        h("h3", { id: "h-terms" }, "Key terms"),
        h("p", { class: "small muted" }, `From ${L.andList(r.dotpoints.map((id) => dpIndex[id].short))}. You've used ${r.terms.used.length} of ${r.terms.used.length + r.terms.missing.length}.`),
        h("div", { class: "tags" },
          r.terms.used.map((t) => h("span", { class: "chip term-used" }, h("span", { class: "sr-only" }, "Used: "), t)),
          r.terms.missing.map((t) => h("span", { class: "chip quiet" }, h("span", { class: "sr-only" }, "Not used yet: "), t)))));
    }

    if (r.addStats.length || r.addExamples.length) {
      box.append(h("section", { class: "check-group", "aria-labelledby": "h-add" },
        h("h3", { id: "h-add" }, "Evidence you could add"),
        r.addStats.length > 0 && h("ul", { class: "cite-list" }, r.addStats.map((id) => h("li", null,
          h("p", null, L.citationSentence(indById[id])),
          h("button", { type: "button", class: "link-btn small", onclick: () => { ui.statSel = id; go("stats"); } }, `See the ${indById[id].short.toLowerCase()} chart`)))),
        r.addExamples.length > 0 && h("ul", { class: "mini-ev" }, r.addExamples.map((id) => {
          const e = evById[id];
          return h("li", null, h("button", { type: "button", onclick: () => openEvidence(e.id) },
            h("span", null, e.title, meta("dp-counts", e.type, L.fmtDate(e.date))),
            h("span", { class: "mono" }, e.keyFigure)));
        }))));
    }
    return box;
  }

  // ---------- start ----------

  function init() {
    for (const el of document.querySelectorAll("[data-nav]")) {
      el.addEventListener("click", (e) => { e.preventDefault(); go(el.dataset.nav); });
    }
    $("report-general").addEventListener("click", () => openReport("site", ""));
    let dotClicks = [];
    document.querySelector(".brand").addEventListener("click", () => {
      motion(document.querySelector(".brand-art"), [
        { transform: "translateY(0) scale(1, 1)" }, { transform: "translateY(-9px) scale(0.9, 1.12)" },
        { transform: "translateY(0) scale(1.25, 0.78)" }, { transform: "translateY(-3px) scale(0.96, 1.04)" }, { transform: "translateY(0) scale(1, 1)" },
      ], { duration: 520, easing: "ease-out" });
      const now = Date.now();
      dotClicks = dotClicks.filter((t) => now - t < 2500).concat(now);
      if (dotClicks.length >= 5) {
        dotClicks = [];
        dotShower(48);
      }
    });
    if (SUGGEST_URL) { $("suggest-footer").href = SUGGEST_URL; $("suggest-footer").hidden = false; }
    $("report-cancel").addEventListener("click", closeReport);
    applyTheme(themeChoice());
    $("settings-open").addEventListener("click", openSettings);
    $("settings-close").addEventListener("click", closeSettings);
    const sheet = $("settings-dialog");
    sheet.addEventListener("cancel", (e) => { e.preventDefault(); closeSettings(); });
    sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSettings(); }); // a click on the shaded page
    sheet.addEventListener("close", () => { delete $("settings-open").dataset.open; $("settings-open").focus(); });
    for (const b of $("theme-seg").querySelectorAll("button")) b.addEventListener("click", () => setTheme(b.dataset.choice));
    for (const b of $("gold-seg").querySelectorAll("button")) b.addEventListener("click", () => setGold(b.dataset.choice));
    setupAdmin();
    updateGold(false);
    setupResetHold();
    $("report-form").addEventListener("submit", (e) => { e.preventDefault(); sendReport(); });

    const latestPub = ST.indicators.map((i) => i.points[i.points.length - 1][0]).sort().pop();
    $("data-note").textContent = `Statistics from the Reserve Bank of Australia and the ABS, latest observation ${L.fmtDate(latestPub)}. ${EV.length} examples, each checked against its source.`;

    const fromHash = (location.hash || "").replace(/^#/, "");
    go(fromHash || "today", { focus: false, fromHistory: true });
    const fromLocation = () => {
      const v = (location.hash || "").replace(/^#/, "");
      const target = v === "skills" ? "syllabus" : v;
      if (VIEWS.includes(target) && target !== ui.view) go(target, { fromHistory: true });
    };
    window.addEventListener("popstate", fromLocation);
    window.addEventListener("hashchange", fromLocation);
    updateBadge();
    introDot();
    Sync.init();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
