// Pure functions with no DOM access, so tests/run_tests.mjs can check them in Node.
(function (root) {
  "use strict";

  const DAY = 86400000;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December"];

  // ---------- dates ----------

  function parseISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 ? d : null;
  }

  function toISO(date) {
    return date.toISOString().slice(0, 10);
  }

  function fmtDate(iso) {
    const d = parseISO(iso);
    return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "";
  }

  function fmtMonth(iso, long) {
    const d = parseISO(iso);
    if (!d) return "";
    return `${(long ? MONTHS_LONG : MONTHS)[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  // How the period of an observation should be written for its frequency.
  function fmtPeriod(iso, frequency, isLatestDaily) {
    const d = parseISO(iso);
    if (!d) return "";
    if (/quarter/i.test(frequency || "")) return `${MONTHS_LONG[d.getUTCMonth()]} quarter ${d.getUTCFullYear()}`;
    if (isLatestDaily) return fmtDate(iso);
    return fmtMonth(iso, true);
  }

  function monthsBetween(fromISO, toISOstr) {
    const a = parseISO(fromISO), b = parseISO(toISOstr);
    if (!a || !b) return NaN;
    return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
      - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
  }

  // ---------- freshness ----------

  // Markers reward recent evidence. Under 6 months is fresh, 6–18 months is ageing, older is old.
  function freshness(eventISO, todayISO) {
    const months = monthsBetween(eventISO, todayISO);
    if (!(months >= 0)) return { level: "fresh", label: "New", months: 0 };
    if (months < 6) return { level: "fresh", label: "Fresh", months };
    if (months < 18) return { level: "ageing", label: "Ageing", months };
    return { level: "old", label: "Old", months };
  }

  function ageText(months) {
    if (months < 1) return "in the past month";
    if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
    const y = Math.floor(months / 12);
    return `${months % 12 ? "over " : ""}${y} year${y === 1 ? "" : "s"} ago`;
  }

  // ---------- spaced repetition (Leitner boxes) ----------

  // Box n is reviewed again after INTERVALS[n] days. A miss sends the card back to box 0.
  const INTERVALS = [0, 1, 3, 7, 16, 35];
  const MAX_BOX = INTERVALS.length - 1;

  function dayNumber(date) {
    return Math.floor(date.getTime() / DAY);
  }

  function grade(state, result, today) {
    const s = state ? { ...state } : { box: 0, due: 0, reviews: 0, lapses: 0 };
    const t = dayNumber(today);
    if (result === "again") {
      s.box = 0;
      s.lapses = (s.lapses || 0) + 1;
    } else if (result === "hard") {
      s.box = Math.max(1, Math.min(s.box, MAX_BOX - 1));
    } else if (result === "good") {
      s.box = Math.min(s.box + 1, MAX_BOX);
    } else {
      throw new Error("unknown grade: " + result);
    }
    s.due = t + INTERVALS[s.box];
    s.reviews = (s.reviews || 0) + 1;
    s.last = t;
    return s;
  }

  function isDue(state, today) {
    return !state || state.due <= dayNumber(today);
  }

  // Cards to study now: ones never seen and ones whose due day has arrived. Overdue first.
  function dueQueue(cards, states, today, limit) {
    const t = dayNumber(today);
    const due = cards.filter((c) => isDue(states[c.id], today));
    due.sort((a, b) => {
      const sa = states[a.id], sb = states[b.id];
      const ka = sa ? sa.due - t : 1, kb = sb ? sb.due - t : 1; // reviews before new cards
      return ka - kb || (a.order || 0) - (b.order || 0);
    });
    return typeof limit === "number" ? due.slice(0, limit) : due;
  }

  // ---------- statistics ----------

  function latest(ind) {
    return ind.points[ind.points.length - 1];
  }

  // Change from the observation closest to 12 months earlier (needs one within 45 days of it).
  function yearChange(ind) {
    const [lastISO, lastVal] = latest(ind);
    const target = parseISO(lastISO).getTime() - 365 * DAY;
    let best = null, bestGap = Infinity;
    for (const [iso, v] of ind.points) {
      const gap = Math.abs(parseISO(iso).getTime() - target);
      if (gap < bestGap) { best = [iso, v]; bestGap = gap; }
    }
    if (!best || bestGap > 45 * DAY) return null;
    return { from: best, delta: +(lastVal - best[1]).toFixed(ind.decimals) };
  }

  function fmtValue(ind, v) {
    if (v === null || v === undefined || Number.isNaN(v)) return "–";
    if (ind.unit === "US$") return `US${(v * 100).toFixed(1)}¢`;
    const n = v.toFixed(ind.decimals === 4 ? 2 : ind.decimals).replace(/^-/, "−");
    if (ind.unit === "%" || ind.unit === "% of GDP") return `${n}%`;
    if (ind.unit === "CNY") return `${n} yuan`;
    return n;
  }

  function fmtDelta(ind, d) {
    if (ind.unit === "US$") return `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d * 100).toFixed(1)}¢`;
    const unit = ind.unit === "%" || ind.unit === "% of GDP" ? " pts" : "";
    const n = Math.abs(d).toFixed(ind.decimals === 4 ? 2 : ind.decimals);
    return `${d > 0 ? "+" : d < 0 ? "−" : "±"}${n}${unit}`;
  }

  function periodOf(ind) {
    const [iso] = latest(ind);
    const daily = /month-end/i.test(ind.frequency);
    return fmtPeriod(iso, ind.frequency, daily);
  }

  function isDaily(ind) {
    return /month-end/i.test(ind.frequency);
  }

  function sentenceValue(ind, v) {
    return fmtValue(ind, v) + (ind.unit === "% of GDP" ? " of GDP" : "");
  }

  // A sentence a student can drop into an essay, with the source in brackets.
  function citationSentence(ind) {
    const [, v] = latest(ind);
    let s = `${isDaily(ind) ? "On" : "In the"} ${periodOf(ind)}, ${ind.phrase} ${ind.verb} ${sentenceValue(ind, v)}`;
    if (!isDaily(ind) && !/quarter/i.test(ind.frequency)) s = s.replace(/^In the /, "In ");
    if (ind.band) {
      const pos = v > ind.band[1] ? "above" : v < ind.band[0] ? "below" : "within";
      s += `, ${pos} the RBA's ${ind.band[0]}–${ind.band[1]}% target band`;
    }
    const ch = yearChange(ind);
    if (ch && ch.delta !== 0) {
      s += `, ${ch.delta > 0 ? "up" : "down"} from ${sentenceValue(ind, ch.from[1])} a year earlier`;
    }
    return `${s} (${sourceShort(ind)}).`;
  }

  function sourceShort(ind) {
    if (ind.source.startsWith("ABS")) return "ABS";
    if (/^RBA/.test(ind.source)) return "RBA";
    const who = ind.source.split(" via ")[0];
    return who === "ABS" ? "ABS" : `${who}, via RBA`;
  }

  // Flashcards built from the latest numbers. The id includes the period, so a new release
  // creates a new card instead of quizzing students on an old figure.
  function statCards(stats) {
    return stats.indicators.map((ind, i) => {
      const [iso, v] = latest(ind);
      const when = isDaily(ind) ? fmtMonth(iso, true) : (/quarter/i.test(ind.frequency) ? "the " : "") + periodOf(ind);
      const [aux, ...rest] = ind.verb.split(" ");
      const adj = ind.adjustment && ind.adjustment !== "Original" ? ind.adjustment.toLowerCase() + ", " : "";
      return {
        id: `stat:${ind.id}:${iso}`,
        kind: "stat",
        order: 1000 + i,
        dotpoints: ind.dotpoints,
        q: `What ${aux} ${ind.phrase}${rest.length ? " " + rest.join(" ") : ""} in ${when}?`,
        a: `${sentenceValue(ind, v)} (${adj}${sourceShort(ind)})`,
        source: ind.source,
      };
    });
  }

  function evidenceCards(evidence) {
    return evidence.map((e, i) => ({
      id: `ev:${e.id}`, kind: "evidence", order: i, dotpoints: e.dotpoints,
      q: e.flash.q, a: e.flash.a, source: e.source.name, ref: e.id,
    }));
  }

  function termCards(syllabus) {
    const out = [];
    let i = 0;
    for (const fa of syllabus.focusAreas) {
      for (const dp of fa.dotpoints) {
        for (const [term, def] of dp.terms || []) {
          out.push({
            id: `term:${slug(term)}`, kind: "term", order: 500 + i++, dotpoints: [dp.id],
            q: `Define: ${term}`, a: def,
          });
        }
      }
    }
    return out;
  }

  function buildDeck(syllabus, evidence, stats) {
    return [...evidenceCards(evidence), ...termCards(syllabus), ...statCards(stats)];
  }

  // ---------- syllabus helpers ----------

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function dotpointIndex(syllabus) {
    const map = {};
    for (const fa of syllabus.focusAreas) {
      for (const dp of fa.dotpoints) map[dp.id] = { ...dp, focus: fa };
    }
    return map;
  }

  // Confidence: what the student says, nudged by drill results.
  // Returns "confident", "shaky" or "none" (not started).
  function dotpointStatus(dpId, progress, deck, today) {
    const own = progress.dotStatus && progress.dotStatus[dpId];
    if (own) return own;
    const cards = deck.filter((c) => c.dotpoints.includes(dpId));
    const seen = cards.filter((c) => progress.cards && progress.cards[c.id]);
    if (!seen.length) return "none";
    const strong = seen.filter((c) => progress.cards[c.id].box >= 3).length;
    return strong === cards.length ? "confident" : "shaky";
  }

  // ---------- search ----------

  function tokens(s) {
    return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9%$.]+/).filter((t) => t.length > 1 || /\d/.test(t));
  }

  function searchEvidence(evidence, dpIndex, query) {
    const q = tokens(query);
    if (!q.length) return evidence.slice();
    const scored = [];
    for (const e of evidence) {
      const fields = [
        [e.title, 5], [e.keyFigure, 4], [e.type, 2], [e.summary, 2], [e.quote ? e.quote.text + " " + e.quote.by : "", 2], [e.useFor, 1], [e.source.name, 1],
        [e.dotpoints.map((id) => (dpIndex[id] ? dpIndex[id].text + " " + dpIndex[id].focus.name : "")).join(" "), 2],
        [e.dotpoints.flatMap((id) => (dpIndex[id] ? dpIndex[id].terms.map((t) => t[0]) : [])).join(" "), 3],
      ];
      let score = 0, all = true;
      for (const t of q) {
        let hit = 0;
        for (const [text, w] of fields) {
          const words = tokens(text);
          if (words.some((w2) => w2 === t)) hit += w * 2;
          else if (words.some((w2) => w2.startsWith(t))) hit += w;
        }
        if (!hit) all = false;
        score += hit;
      }
      if (all && score > 0) scored.push([score, e]);
    }
    scored.sort((a, b) => b[0] - a[0] || (a[1].date < b[1].date ? 1 : -1));
    return scored.map((x) => x[1]);
  }

  // ---------- progress ----------

  function emptyProgress() {
    return { version: 1, updatedAt: 0, dotStatus: {}, cards: {}, seenEvidence: {}, days: {} };
  }

  function normaliseProgress(p) {
    const base = emptyProgress();
    if (!p || typeof p !== "object" || p.version !== 1) return base;
    return {
      version: 1,
      updatedAt: Number(p.updatedAt) || 0,
      dotStatus: isPlain(p.dotStatus) ? p.dotStatus : {},
      cards: isPlain(p.cards) ? p.cards : {},
      seenEvidence: isPlain(p.seenEvidence) ? p.seenEvidence : {},
      days: isPlain(p.days) ? p.days : {},
    };
  }

  function isPlain(x) {
    return !!x && typeof x === "object" && !Array.isArray(x);
  }

  // Keep whichever copy was changed most recently (this browser or the account copy).
  function mergeProgress(local, remote) {
    const a = normaliseProgress(local), b = normaliseProgress(remote);
    return b.updatedAt > a.updatedAt ? b : a;
  }

  // ---------- suggestions ----------

  function suggestions(ctx) {
    const { deck, progress, today, dpIndex, evidence } = ctx;
    const out = [];
    const due = dueQueue(deck, progress.cards, today);
    const reviews = due.filter((c) => progress.cards[c.id]).length;
    if (reviews) {
      const mins = Math.max(1, Math.round(Math.min(reviews, 10) * 0.4));
      out.push({ kind: "drill", title: `${reviews} card${reviews === 1 ? "" : "s"} due for review`,
        detail: `Reviewing on time is what makes facts stick. About ${mins} minute${mins === 1 ? "" : "s"}.` });
    }
    if (ctx.branches) {
      const next = nextSkill(ctx.branches, progress, deck);
      if (next) {
        const dp = dpIndex[next.id];
        out.push({ kind: "dotpoint", id: dp.id, title: `Next skill: ${dp.short || dp.text}`,
          detail: next.level ? `You're ${MASTERY[next.level].toLowerCase()} with it. Drill it to level up.` : `Ready to unlock in ${next.branch.name}.` });
      }
    }
    const unseen = evidence.filter((e) => !progress.seenEvidence[e.id])
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    if (unseen.length) {
      out.push({ kind: "evidence", id: unseen[0].id, title: `New example: ${unseen[0].title}`,
        detail: `${unseen.length} example${unseen.length === 1 ? "" : "s"} you haven't opened yet.` });
    }
    if (!reviews) {
      const fresh = due.length;
      out.unshift({ kind: "drill", title: fresh ? "Start a 5-minute drill" : "All caught up",
        detail: fresh ? `${Math.min(fresh, 10)} new cards on cases, statistics and key terms.` : "Nothing is due. Come back tomorrow, or browse the newest examples." });
    }
    return out;
  }

  // ---------- skill tree ----------

  // Mastery levels follow Khan Academy's idea: you only reach "Mastered" by proving it in drills.
  const MASTERY = ["Not started", "Familiar", "Proficient", "Mastered"];

  function skillLevel(dpId, progress, deck) {
    const cards = deck.filter((c) => c.dotpoints.includes(dpId));
    const states = progress.cards || {};
    const seen = cards.filter((c) => states[c.id]).length;
    const learned = cards.filter((c) => states[c.id] && states[c.id].box >= 3).length;
    const own = progress.dotStatus && progress.dotStatus[dpId];
    let level = 0;
    if (cards.length && learned === cards.length) level = 3;
    else if ((cards.length && learned / cards.length >= 0.5) || own === "confident") level = 2;
    else if (seen > 0 || own === "shaky") level = 1;
    return { level, learned, total: cards.length };
  }

  // state: "mastered", "progress" (levels 1–2), "ready" (not started, parents begun) or "locked".
  // Locked is only advice: every skill can still be opened.
  function skillTree(branches, progress, deck) {
    const out = {};
    for (const b of branches) for (const n of b.nodes) out[n.id] = { ...skillLevel(n.id, progress, deck), branch: b, node: n };
    for (const id of Object.keys(out)) {
      const s = out[id];
      const parentsBegun = s.node.parents.every((p) => out[p] && out[p].level >= 1);
      s.state = s.level === 3 ? "mastered" : s.level > 0 ? "progress" : parentsBegun ? "ready" : "locked";
    }
    return out;
  }

  // Rows of a branch, by depth from its roots (for drawing the tree).
  function branchRows(branch) {
    const depth = {};
    const byId = Object.fromEntries(branch.nodes.map((n) => [n.id, n]));
    const d = (id, seen) => {
      if (depth[id] !== undefined) return depth[id];
      if (seen.has(id)) throw new Error("cycle at " + id);
      seen.add(id);
      const ps = byId[id].parents.filter((p) => byId[p]);
      depth[id] = ps.length ? 1 + Math.max(...ps.map((p) => d(p, seen))) : 0;
      return depth[id];
    };
    for (const n of branch.nodes) d(n.id, new Set());
    const rows = [];
    for (const n of branch.nodes) (rows[depth[n.id]] = rows[depth[n.id]] || []).push(n.id);
    return rows;
  }

  // The skill to work on next: one already started but not mastered, else the first ready one.
  function nextSkill(branches, progress, deck) {
    const tree = skillTree(branches, progress, deck);
    const order = branches.flatMap((b) => b.nodes.map((n) => n.id));
    const started = order.find((id) => tree[id].state === "progress" && tree[id].total > 0);
    const ready = order.find((id) => tree[id].state === "ready" && tree[id].total > 0);
    const id = started || ready;
    return id ? { id, level: tree[id].level, branch: tree[id].branch } : null;
  }

  // ---------- streaks and points ----------

  // Consecutive study days ending today, or yesterday (so a streak isn't lost before you study today).
  function streak(days, todayISO) {
    const has = (iso) => !!(days && days[iso]);
    let d = parseISO(todayISO);
    if (!d) return 0;
    if (!has(todayISO)) d = new Date(d.getTime() - DAY);
    let n = 0;
    while (has(toISO(d))) { n++; d = new Date(d.getTime() - DAY); }
    return n;
  }

  // 10 points for every box a card has climbed.
  function points(progress) {
    return Object.values(progress.cards || {}).reduce((sum, c) => sum + 10 * (Number(c.box) || 0), 0);
  }

  // ---------- linking statistics and examples ----------

  function relatedIndicators(example, stats) {
    return stats.indicators.filter((i) => i.dotpoints.some((id) => example.dotpoints.includes(id)));
  }

  function relatedExamples(ind, evidence) {
    return evidence.filter((e) => e.dotpoints.some((id) => ind.dotpoints.includes(id)))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  // ---------- news ----------

  // "12 minutes ago", "5 hours ago", "yesterday", "3 days ago".
  function timeAgo(iso, nowMs) {
    const ms = nowMs - Date.parse(iso);
    const min = Math.floor(ms / 60000);
    if (!(min >= 1)) return "just now"; // also covers a clock that runs a little fast
    if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    const days = Math.floor(hrs / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }

  // Stories from the last few days, kept in the order tools/update_news.py ranked them.
  function recentNews(items, nowMs, maxDays) {
    const limit = (maxDays || 4) * DAY;
    return (items || []).filter((n) => {
      const t = Date.parse(n.published);
      return t <= nowMs + 3600000 && nowMs - t <= limit;
    });
  }

  // "A", "A and B", "A, B and C".
  function andList(items) {
    return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  }

  // ---------- study sequence and site-wide search ----------

  // Which dot points this one builds on, and which build on it (from the branch structure).
  function sequence(branches, dpId) {
    const buildsOn = [], leadsTo = [];
    for (const b of branches) {
      for (const n of b.nodes) {
        if (n.id === dpId) buildsOn.push(...n.parents, ...(n.also || []));
        if (n.parents.includes(dpId) || (n.also || []).includes(dpId)) leadsTo.push(n.id);
      }
    }
    return { buildsOn: [...new Set(buildsOn)], leadsTo: [...new Set(leadsTo)] };
  }

  function matchesAll(q, text) {
    const words = tokens(text);
    return q.every((t) => words.some((w) => w === t || w.startsWith(t)));
  }

  // One search box for the whole site: dot points, examples and statistics.
  function searchAll(query, syllabus, evidence, stats) {
    const q = tokens(query);
    if (!q.length) return { dotpoints: [], examples: [], stats: [] };
    const idx = dotpointIndex(syllabus);
    const dotpoints = Object.values(idx).filter((dp) =>
      matchesAll(q, [dp.text, dp.short, dp.focus.name, (dp.terms || []).map((t) => t.join(" ")).join(" ")].join(" ")));
    const examples = searchEvidence(evidence, idx, query);
    const statsHit = stats.indicators.filter((i) => matchesAll(q, [i.label, i.short, i.meaning].join(" ")));
    return { dotpoints, examples, stats: statsHit };
  }

  // ---------- reports ----------

  const REPORT_REASONS = ["Wrong fact", "Out of date", "Broken link", "Other"];

  function cleanReport(r) {
    const reason = REPORT_REASONS.includes(r.reason) ? r.reason : "Other";
    const note = String(r.note || "").replace(/\s+/g, " ").trim().slice(0, 600);
    return { reason, note, target: String(r.target || "").slice(0, 120), at: r.at || new Date().toISOString() };
  }

  // ---------- essay feedback ----------

  // Plain-English meanings of the key verbs, in the spirit of NESA's glossary of key words.
  const VERBS = {
    analyse: "Identify the parts and how they relate to each other, and draw out the implications.",
    assess: "Make a judgement of value, quality, outcomes, results or size.",
    evaluate: "Make a judgement based on criteria; decide how good or effective something is.",
    discuss: "Identify issues and give points for and against.",
    explain: "Relate cause and effect; make clear how and why.",
    examine: "Inquire into the topic in detail.",
    describe: "Give the characteristics and features.",
    outline: "Sketch the main features in general terms.",
    justify: "Support an argument or conclusion with evidence.",
    compare: "Show how things are similar and different.",
  };

  const CRITERIA = [
    { id: "question", name: "Answers the question", detail: "Responds to the key verb (assess and evaluate need a clear, sustained judgement) and covers every part of the question." },
    { id: "knowledge", name: "Economic knowledge", detail: "Accurate economic concepts, theory and terminology." },
    { id: "evidence", name: "Evidence", detail: "Relevant, accurate and current statistics and real-world examples, woven into the argument rather than listed." },
    { id: "analysis", name: "Analysis", detail: "Cause-and-effect chains, links between concepts, and the limits and other influences that complicate the picture." },
    { id: "structure", name: "Structure", detail: "A clear thesis in the introduction, paragraphs that each make one point, and a conclusion that answers the question." },
  ];
  const LEVELS = ["", "Limited", "Sound", "Thorough", "Sophisticated"];
  const ESSAY_MARKS = 20;
  const ESSAY_MIN_WORDS = 150;
  const ESSAY_MAX_CHARS = 25000;
  const CHECK_STATUS = ["outdated", "incorrect", "unsourced"];

  function wordCount(text) {
    const m = String(text || "").match(/[A-Za-z0-9][A-Za-z0-9'’%.$,-]*/g);
    return m ? m.length : 0;
  }

  // Paragraphs split on blank lines; a response pasted without blank lines splits on single line breaks.
  function paragraphs(text) {
    const t = String(text || "").replace(/\r\n?/g, "\n").trim();
    if (!t) return [];
    const byBlank = t.split(/\n\s*\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (byBlank.length > 1) return byBlank;
    return t.split(/\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  }

  function verbOf(question) {
    const words = tokens(question);
    return words.find((w) => VERBS[w]) || null;
  }

  // HSC-style bands for a 20-mark extended response.
  function bandFor(mark) {
    if (mark >= 17) return "17–20";
    if (mark >= 13) return "13–16";
    if (mark >= 9) return "9–12";
    if (mark >= 5) return "5–8";
    if (mark >= 1) return "1–4";
    return "0";
  }

  // Everything Claude needs in one memoryless prompt: the task, the rubric, the rules,
  // Dotpoint's own statistics and examples (so it can check figures and suggest evidence), and the reply shape.
  function essayPrompt(ctx) {
    const { question, essay, syllabus, evidence, stats, today } = ctx;
    const verb = verbOf(question);
    const paras = paragraphs(essay);
    const idx = dotpointIndex(syllabus);
    const lines = [];
    lines.push(`You are an experienced HSC Economics marker in New South Wales. Mark this practice extended response (${ESSAY_MARKS} marks), written by a Year 11 or 12 student studying the ${syllabus.syllabus}. Today is ${fmtDate(today)}.`);
    lines.push("", `QUESTION (${ESSAY_MARKS} marks): ${question.trim()}`);
    if (verb) lines.push(`Key verb: "${verb}", which means: ${VERBS[verb]}`);
    lines.push("", "THE STUDENT'S RESPONSE (paragraphs numbered P1, P2… for your reference; the student did not write the labels):");
    paras.forEach((p, i) => lines.push(`[P${i + 1}] ${p}`));
    lines.push("", "HOW TO MARK",
      "Judge the response on these five criteria. Give each a level from 1 to 4 (1 limited, 2 sound, 3 thorough, 4 sophisticated) and a specific comment of one or two sentences:");
    for (const c of CRITERIA) lines.push(`- ${c.id}: ${c.detail}`);
    lines.push(`Then give one mark out of ${ESSAY_MARKS}, as an HSC marker would, using the bands 17–20, 13–16, 9–12, 5–8 and 1–4. Be honest and do not inflate. A response that describes when the verb asks for a judgement, or that uses few accurate and current statistics, does not belong in the top band.`);
    lines.push("", "RULES",
      "- Never rewrite the response or write sentences the student could paste in. Say what to change and where (by paragraph label), not the words to use.",
      "- Every \"quote\" must be copied exactly from the response, at most 20 words.",
      "- Suggest examples and statistics only by the ids listed below, at most 3 of each, and only ones that genuinely fit this question.",
      "- dataChecks: list each statistic or dated fact in the response that is out of date, incorrect, or given without a period or source, compared with the latest statistics below. status is \"outdated\", \"incorrect\" or \"unsourced\". Give an empty list if there are none.",
      "- Write in plain Australian English and speak to the student as \"you\".");
    lines.push("", "LATEST STATISTICS (id: ready-to-cite sentence)");
    for (const i of stats.indicators) lines.push(`${i.id}: ${citationSentence(i)}`);
    lines.push("", "REAL-WORLD EXAMPLES IN DOTPOINT (id | date | title | key figure | dot points)");
    for (const e of evidence) {
      const dps = e.dotpoints.filter((id) => idx[id]).map((id) => idx[id].short).join(", ");
      lines.push(`${e.id} | ${e.date} | ${e.title} | ${e.keyFigure} | ${dps}`);
    }
    lines.push("", "DOT POINTS (id: summary)");
    for (const dp of Object.values(idx)) lines.push(`${dp.id}: ${dp.text}`);
    lines.push("", "Reply with only one JSON object in exactly this shape (2 or 3 strengths, 3 to 5 improvements with the most important first):",
      JSON.stringify({
        mark: 14,
        summary: "Two sentences on the overall quality and the main thing holding the mark back.",
        criteria: CRITERIA.map((c) => ({ id: c.id, level: 3, comment: "…" })),
        strengths: [{ quote: "exact words from the response", why: "…" }],
        improvements: [{ where: "P2", issue: "what is wrong", action: "what to do about it" }],
        dataChecks: [{ quote: "exact words from the response", status: "outdated", latest: "the current figure and its period", statId: "cpi" }],
        examples: [{ id: "example id", why: "how it would strengthen the argument" }],
        stats: [{ id: "statistic id", why: "…" }],
        dotpoints: ["dot point id"],
        nextStep: "The single most important change for the next draft.",
      }));
    return lines.join("\n");
  }

  function looseText(s) {
    return String(s || "").toLowerCase().replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
      .replace(/\s+/g, " ").replace(/^["'\s.…]+|["'\s.…]+$/g, "").trim();
  }

  function str(v, max) {
    return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
  }

  // Check Claude's reply before showing it: clamp the mark, keep only quotes that really are in
  // the essay and only ids that exist in Dotpoint. Throws if the reply has no usable mark.
  function parseFeedback(raw, ctx) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
    const n = Math.round(Number(raw.mark));
    if (!Number.isFinite(n)) throw new Error("no mark");
    const mark = Math.max(0, Math.min(ESSAY_MARKS, n));
    const essayText = looseText(ctx.essay);
    const inEssay = (q) => { const t = looseText(q); return t.length >= 3 && essayText.includes(t); };
    const evIds = new Set(ctx.evidence.map((e) => e.id));
    const statIds = new Set(ctx.stats.indicators.map((i) => i.id));
    const idx = dotpointIndex(ctx.syllabus);
    const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
    const byId = Object.fromEntries(list(raw.criteria).map((c) => [String(c.id), c]));
    const uniqueBy = (arr, key) => { const seen = new Set(); return arr.filter((x) => !seen.has(x[key]) && seen.add(x[key])); };
    return {
      mark, outOf: ESSAY_MARKS, band: bandFor(mark),
      summary: str(raw.summary, 600),
      criteria: CRITERIA.map((c) => {
        const r = byId[c.id] || {};
        const lv = Math.round(Number(r.level));
        return { id: c.id, name: c.name, level: lv >= 1 && lv <= 4 ? lv : null, comment: str(r.comment, 500) };
      }),
      strengths: list(raw.strengths).filter((s) => inEssay(s.quote)).slice(0, 3)
        .map((s) => ({ quote: str(s.quote, 200), why: str(s.why, 400) })),
      improvements: list(raw.improvements).map((x) => ({ where: str(x.where, 24), issue: str(x.issue, 400), action: str(x.action, 500) }))
        .filter((x) => x.issue || x.action).slice(0, 5),
      dataChecks: list(raw.dataChecks).filter((d) => CHECK_STATUS.includes(d.status) && inEssay(d.quote)).slice(0, 6)
        .map((d) => ({ quote: str(d.quote, 200), status: d.status, latest: str(d.latest, 300), statId: statIds.has(d.statId) ? d.statId : null })),
      examples: uniqueBy(list(raw.examples).filter((x) => evIds.has(x.id)), "id").slice(0, 3).map((x) => ({ id: x.id, why: str(x.why, 300) })),
      stats: uniqueBy(list(raw.stats).filter((x) => statIds.has(x.id)), "id").slice(0, 3).map((x) => ({ id: x.id, why: str(x.why, 300) })),
      dotpoints: [...new Set((Array.isArray(raw.dotpoints) ? raw.dotpoints : []).filter((id) => idx[id]))].slice(0, 5),
      nextStep: str(raw.nextStep, 400),
    };
  }

  const api = {
    DAY, INTERVALS, MAX_BOX, REPORT_REASONS,
    VERBS, CRITERIA, LEVELS, ESSAY_MARKS, ESSAY_MIN_WORDS, ESSAY_MAX_CHARS,
    wordCount, paragraphs, verbOf, bandFor, essayPrompt, parseFeedback,
    parseISO, toISO, fmtDate, fmtMonth, fmtPeriod, monthsBetween, freshness, ageText,
    grade, isDue, dueQueue, dayNumber,
    latest, yearChange, fmtValue, fmtDelta, periodOf, citationSentence, sentenceValue, sourceShort, isDaily,
    statCards, evidenceCards, termCards, buildDeck,
    slug, dotpointIndex, dotpointStatus, tokens, searchEvidence,
    emptyProgress, normaliseProgress, mergeProgress, suggestions, cleanReport,
    MASTERY, skillLevel, skillTree, branchRows, nextSkill, streak, points, relatedIndicators, relatedExamples,
    sequence, searchAll, timeAgo, recentNews, andList,
  };
  root.DP_LOGIC = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
