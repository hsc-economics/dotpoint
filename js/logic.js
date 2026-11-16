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

  // Every dot point in both years rated (or drilled to) confident: the gold finish easter egg.
  function syllabusComplete(syllabus, progress, deck, today) {
    const all = syllabus.focusAreas.flatMap((fa) => fa.dotpoints);
    return all.length > 0 && all.every((dp) => dotpointStatus(dp.id, progress, deck, today) === "confident");
  }

  // ---------- admin tools: progress backups and data ages ----------

  // A backup file: the whole saved progress, labelled so a stray file can't be loaded by mistake.
  function progressBackup(progress, nowMs) {
    return { app: "dotpoint", kind: "progress", version: 1, exportedAt: new Date(nowMs).toISOString(), progress };
  }

  // Reads a backup file's text. Returns { progress, exportedAt } or { error } in plain words.
  function readBackup(text) {
    let data;
    try { data = JSON.parse(String(text)); } catch (e) { return { error: "That file isn't a Dotpoint backup: it can't be read." }; }
    if (!isPlain(data) || data.app !== "dotpoint" || data.kind !== "progress" || !isPlain(data.progress)) {
      return { error: "That file isn't a Dotpoint progress backup." };
    }
    return { progress: normaliseProgress(data.progress), exportedAt: String(data.exportedAt || "").slice(0, 30) };
  }

  // Whole days between an ISO date or timestamp and now, or null when the date can't be read.
  function daysSince(iso, nowMs) {
    const t = Date.parse(String(iso || ""));
    return Number.isNaN(t) ? null : Math.max(0, Math.floor((nowMs - t) / 86400000));
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

  // What a reset would clear, counted for the settings panel.
  function progressCounts(p) {
    const n = normaliseProgress(p);
    const size = (o) => Object.keys(o).length;
    return { dots: size(n.dotStatus), cards: size(n.cards), days: size(n.days), examples: size(n.seenEvidence) };
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

  // News reports kept by tools/update_news.py, shaped like example cards so the Examples page can list,
  // filter and search them alongside the checked examples. The quote is the outlet's own one-line
  // summary of the story; there is no summary in our own words, because nobody has written one.
  function newsReports(archive, dpIndex) {
    const lead = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s); // "Setting the cash rate" -> "setting…", "RBA objectives" stays
    return (archive || []).map((n) => {
      const dps = (n.dotpoints || []).filter((id) => dpIndex[id]);
      return {
        id: n.id, title: n.title, date: n.date, type: "News report", keyFigure: n.keyFigure || "",
        quote: n.desc ? { text: n.desc, by: n.outlet, url: n.url } : null,
        summary: "",
        useFor: `Recent news on ${andList(dps.map((id) => lead(dpIndex[id].short)))}. Read the full article before you quote figures from it.`,
        dotpoints: dps, source: { name: n.outlet, url: n.url }, also: n.also || [], auto: true,
      };
    }).filter((e) => e.dotpoints.length);
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

  // ---------- essay checker ----------
  // Instant checks that run in the browser with no AI: are the figures current, does the response do
  // what the question's verb asks, is it structured like an extended response, does it use the key
  // terms, and what evidence could it add. It never gives a mark and never rewrites anything.

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
  const ESSAY_MIN_WORDS = 80;
  const ESSAY_MAX_CHARS = 25000;

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

  function sentences(text) {
    return String(text || "").replace(/\s+/g, " ").replace(/([.!?])\s+(?=["“‘(]?[A-Z0-9])/g, "$1\n").split("\n").map((s) => s.trim()).filter(Boolean);
  }

  // Words that tie a figure in a sentence to one of Dotpoint's statistics. Longer phrases win, so
  // "underlying inflation" is never read as headline inflation.
  const STAT_WORDS = {
    "cash-rate": ["cash rate", "cash rate target", "official interest rate", "official cash rate"],
    "mortgage-rate": ["mortgage rate", "mortgage rates", "variable mortgage", "home loan rate", "home loan rates"],
    "trimmed-mean": ["underlying inflation", "trimmed mean", "trimmed-mean", "core inflation"],
    cpi: ["inflation", "headline inflation", "cpi", "consumer price index", "consumer prices"],
    unemployment: ["unemployment", "unemployment rate", "jobless rate"],
    participation: ["participation", "participation rate"],
    "gdp-growth": ["gdp", "real gdp", "economic growth", "gdp growth", "the economy grew"],
    "current-account": ["current account", "current account deficit", "current account balance"],
    "wage-growth": ["wage growth", "wages", "wage price index", "wpi"],
    productivity: ["productivity", "labour productivity"],
    "employment-growth": ["employment growth"],
    vacancies: ["vacancy rate", "job vacancies", "vacancies"],
    "bond-10y": ["10-year bond", "ten-year bond", "bond yield", "bond yields"],
    "housing-credit": ["housing credit"],
    "consumption-growth": ["consumption growth", "household consumption", "consumer spending", "household spending"],
    "saving-ratio": ["saving ratio", "savings ratio", "household saving"],
  };
  const PERIOD_WORDS = /\b(?:19|20)\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\bquarter\b|\byear to\b|\bfinancial year\b|\bin 20\d{2}/i;
  const NOT_A_LEVEL = /\b(?:target|targets|band|forecast|forecasts|expected|expects|predicts|projected|projects|could|would)\b/i;

  function statMentions(sentence) {
    const low = sentence.toLowerCase();
    const found = [];
    for (const [id, words] of Object.entries(STAT_WORDS)) {
      for (const w of words) {
        const re = new RegExp(`(^|[^a-z-])(${w.replace(/[-]/g, "[- ]")})(?![a-z])`, "g");
        let m;
        while ((m = re.exec(low))) {
          const at = m.index + m[1].length;
          found.push({ id, at, end: at + m[2].length });
          re.lastIndex = at + 1;
        }
      }
    }
    found.sort((a, b) => (b.end - b.at) - (a.end - a.at)); // longest first
    const kept = [];
    for (const f of found) if (!kept.some((k) => f.at < k.end && k.at < f.end)) kept.push(f);
    return kept;
  }

  // Every percentage in the response that sits beside one of Dotpoint's statistics, checked against
  // that statistic's history: the latest figure, an older one (and whether its year is given), or none.
  function checkFigures(essay, stats) {
    const byId = Object.fromEntries(stats.indicators.map((i) => [i.id, i]));
    const out = [];
    for (const s of sentences(essay)) {
      const mentions = statMentions(s);
      if (!mentions.length) continue;
      const re = /(^|[^\d.])([-−]|minus\s)?(\d{1,3}(?:\.\d+)?)\s?(?:%|per\s?cent)(?![a-z])/gi;
      let raw;
      while ((raw = re.exec(s))) {
        // the figure itself, without the character matched in front of it
        const m = Object.assign(raw.slice(1), { index: raw.index + raw[1].length });
        m[0] = raw[0].slice(raw[1].length);
        re.lastIndex = m.index + m[0].length;
        const before = s.slice(0, m.index), after = s.slice(m.index + m[0].length);
        if (/\d\s?(?:–|-|to)\s?$/.test(before) || /^\s?(?:–|-|to)\s?\d/.test(after)) continue; // a range, like 2–3%
        if (/\bby\s*$/i.test(before)) continue; // a change ("rose by 0.25%"), not a level
        const near = mentions.map((x) => ({ ...x, d: x.end <= m.index ? m.index - x.end : x.at >= m.index + m[0].length ? (x.at - m.index - m[0].length) * 1.5 : 0 }))
          .filter((x) => x.d <= 90).sort((a, b) => a.d - b.d)[0];
        if (!near || !byId[near.id]) continue;
        const ind = byId[near.id];
        const v = (m[1] ? -1 : 1) * Number(m[2]);
        const dec = (m[2].split(".")[1] || "").length;
        const same = (x) => Math.abs(x - v) <= 0.5 * Math.pow(10, -dec) + 1e-9;
        const lastV = ind.points[ind.points.length - 1][1];
        // every observation Dotpoint has, newest first: the recent series, then any longer history (quarterly CPI from 2020)
        const seen = new Set(ind.points.map((x) => x[0]));
        const older = ind.points.slice(0, -1).map((x) => [...x, ind.frequency])
          .concat(((ind.history && ind.history.points) || []).filter((x) => !seen.has(x[0])).map((x) => [...x, ind.history.frequency]))
          .sort((a, b) => (a[0] < b[0] ? 1 : -1));
        const quote = s.length > 160 ? s.slice(Math.max(0, m.index - 70), m.index + m[0].length + 50).trim() : s;
        const base = { quote, value: m[0].trim(), statId: ind.id, latest: `${fmtValue(ind, lastV)} (${periodOf(ind)})`, dated: PERIOD_WORDS.test(s) };
        if (same(lastV)) { out.push({ ...base, status: "current" }); continue; }
        const years = (s.match(/\b(?:19|20)\d{2}\b/g) || []);
        const exact = older.find((x) => same(x[1]));
        // a figure for a year the sentence names: official figures get revised, so allow a tenth either way
        const inYear = years.length && older.find((x) => years.includes(x[0].slice(0, 4)) && Math.abs(x[1] - v) <= 0.15);
        const firstYear = older.length ? older[older.length - 1][0].slice(0, 4) : "9999";
        if (inYear) out.push({ ...base, status: "historical", then: fmtPeriod(inYear[0], inYear[2]) });
        else if (years.length && years.every((y) => y < firstYear)) out.push({ ...base, status: "untracked", then: fmtPeriod(older[older.length - 1][0], older[older.length - 1][2]) });
        else if (exact && !years.length) out.push({ ...base, status: "outdated", then: fmtPeriod(exact[0], exact[2]) });
        else if (!NOT_A_LEVEL.test(s)) out.push({ ...base, status: "unmatched" });
      }
    }
    return out;
  }

  // The dot points a question draws on: listed for the practice questions, otherwise the dot points
  // whose words the question shares most.
  function questionDotpoints(question, syllabus, listed) {
    const idx = dotpointIndex(syllabus);
    if (listed && listed.length) return listed.filter((id) => idx[id]);
    const skip = new Set(["the", "and", "of", "in", "on", "to", "a", "an", "its", "with", "for", "since", "recent", "years", "australia", "australian", "economy", "reference", ...Object.keys(VERBS)]);
    const q = tokens(question).filter((t) => !skip.has(t) && t.length > 2);
    const scored = Object.values(idx).map((dp) => {
      const words = tokens([dp.text, dp.short, (dp.terms || []).map((t) => t[0]).join(" ")].join(" "));
      return [q.filter((t) => words.some((w) => w === t || (t.length > 4 && w.startsWith(t.slice(0, -1))))).length, dp.id];
    }).filter((x) => x[0] >= 1).sort((a, b) => b[0] - a[0]);
    return scored.slice(0, 3).map((x) => x[1]);
  }

  const JUDGEMENT = /\b(?:effective|ineffective|effectively|successful|unsuccessful|to a (?:large|great|limited|small|significant|lesser|greater) extent|largely|partly|partially|outweigh|outweighs|outweighed|most important|more important|most significant|on balance|overall|significant(?:ly)?|limited|crucial|primary|main reason|clearly)\b/i;
  const CONTRAST = /\b(?:however|on the other hand|although|whereas|conversely|in contrast|nevertheless|despite|yet|while)\b/gi;
  const CAUSE = /\b(?:because|therefore|as a result|leads? to|led to|leading to|causing|caused|causes|resulting in|results? in|which means|this means|means that|thereby|consequently|due to|in turn|so that|shows?|showing|suggests?|driven by|drives|contribut(?:ed|es|ing) to|in response to|reduc(?:es|ed|ing)|increas(?:es|ed|ing)|lower(?:s|ed|ing)|rais(?:es|ed|ing))\b/gi;
  const CONCLUDES = /\b(?:in conclusion|to conclude|overall|ultimately|in summary|therefore|thus)\b/i;
  const count = (re, s) => (String(s).match(re) || []).length;

  // Does the response do what the verb asks? Each item is { ok, text }.
  function verbChecks(verb, paras) {
    const out = [];
    if (!verb) return [{ ok: false, text: "The question doesn't start with a key verb, so check you know whether it wants a judgement, an explanation or both sides." }];
    const intro = paras[0] || "", end = paras[paras.length - 1] || "", body = paras.slice(1, -1);
    if (["assess", "evaluate", "justify"].includes(verb)) {
      out.push(JUDGEMENT.test(intro)
        ? { ok: true, text: "Your introduction states a judgement." }
        : { ok: false, text: `"${verb[0].toUpperCase() + verb.slice(1)}" asks for a judgement. Say in your introduction how effective, significant or important you think it is.` });
      out.push(JUDGEMENT.test(end)
        ? { ok: true, text: "Your conclusion comes back to a judgement." }
        : { ok: false, text: "Your conclusion should answer the question directly with your final judgement." });
      const judged = body.filter((p) => JUDGEMENT.test(p)).length;
      if (body.length) out.push(judged >= Math.ceil(body.length / 2)
        ? { ok: true, text: `${judged} of ${body.length} body paragraphs make a judgement, not just a description.` }
        : { ok: false, text: `Only ${judged} of ${body.length} body paragraphs make a judgement. End each one by saying what it shows about the question.` });
    } else if (["discuss", "compare"].includes(verb)) {
      const n = paras.reduce((s, p) => s + count(CONTRAST, p), 0);
      out.push(n >= 2
        ? { ok: true, text: `You weigh up more than one side (${n} contrasting links such as "however").` }
        : { ok: false, text: `"${verb[0].toUpperCase() + verb.slice(1)}" needs more than one side. Add points against, or differences, linked with words like "however" or "on the other hand".` });
    }
    if (["analyse", "explain", "examine", "assess", "evaluate", "discuss"].includes(verb) && body.length) {
      const linked = body.filter((p) => count(CAUSE, p) >= 1).length;
      out.push(linked === body.length
        ? { ok: true, text: "Every body paragraph links cause and effect." }
        : { ok: false, text: `${body.length - linked} of ${body.length} body paragraphs have no cause-and-effect link ("because", "leads to", "as a result"). Show how one thing causes another.` });
    }
    return out;
  }

  function structureChecks(question, paras, words) {
    const out = [];
    if (words < 400) out.push({ ok: false, text: `${words} words is short for an extended response. Most strong responses are about 800 to 1,200 words.` });
    else if (words < 750) out.push({ ok: false, text: `${words} words is on the short side. Most strong responses are about 800 to 1,200 words.` });
    else if (words > 1600) out.push({ ok: false, text: `${words} words is long for the time you'd have in an exam. Check every paragraph earns its place.` });
    else out.push({ ok: true, text: `${words} words is a good length for an extended response.` });
    out.push(paras.length >= 4
      ? { ok: true, text: `${paras.length} paragraphs: an introduction, ${paras.length - 2} body paragraphs and a conclusion.` }
      : { ok: false, text: `${paras.length} paragraph${paras.length === 1 ? "" : "s"}. Aim for an introduction, three or four body paragraphs and a conclusion, with a blank line between them.` });
    const skip = new Set(Object.keys(VERBS).concat(["the", "and", "of", "in", "on", "to", "its", "with", "for", "since", "recent", "years", "reference", "australia", "australian", "economy"]));
    const key = [...new Set(tokens(question).filter((t) => t.length > 3 && !skip.has(t)))];
    const intro = tokens(paras[0] || "");
    const used = key.filter((t) => intro.some((w) => w.startsWith(t.slice(0, Math.max(4, t.length - 2)))));
    if (key.length) out.push(used.length >= Math.min(2, key.length)
      ? { ok: true, text: "Your introduction uses the question's own words, so the marker sees you're answering it." }
      : { ok: false, text: `Your introduction doesn't pick up the question's key words (${key.slice(0, 4).join(", ")}). Use them to show you're answering this question.` });
    if (paras.length >= 3) out.push(CONCLUDES.test(paras[paras.length - 1])
      ? { ok: true, text: "Your last paragraph reads as a conclusion." }
      : { ok: false, text: "Your last paragraph doesn't read as a conclusion. Sum up your argument and answer the question." });
    const long = paras.slice(1, -1).map((p, i) => [wordCount(p), i + 2]).filter(([n]) => n > 320);
    if (long.length) out.push({ ok: false, text: `Paragraph ${long.map((x) => x[1]).join(" and ")} ${long.length > 1 ? "are" : "is"} over 320 words. Split ${long.length > 1 ? "them" : "it"} so each paragraph makes one point.` });
    return out;
  }

  function checkEssay({ question, listedDotpoints, essay, syllabus, evidence, stats }) {
    const idx = dotpointIndex(syllabus);
    const paras = paragraphs(essay);
    const words = wordCount(essay);
    const verb = verbOf(question);
    const dps = questionDotpoints(question, syllabus, listedDotpoints);
    const low = String(essay).toLowerCase();
    const termList = [];
    for (const id of dps) for (const [t] of idx[id].terms || []) if (!termList.includes(t)) termList.push(t);
    const used = (t) => { const s = t.toLowerCase().replace(/[()]/g, ""); return low.includes(s) || low.includes(s.replace(/s$/, "")); };
    const figures = checkFigures(essay, stats);
    const citedStats = new Set(figures.map((f) => f.statId));
    const overlap = (list) => list.filter((id) => dps.includes(id)).length;
    const addStats = stats.indicators.filter((i) => !citedStats.has(i.id) && overlap(i.dotpoints))
      .sort((a, b) => overlap(b.dotpoints) - overlap(a.dotpoints)).slice(0, 4).map((i) => i.id);
    // an example whose key number is already in the response is probably already used
    const usedFigure = (e) => { const n = (String(e.keyFigure || "").match(/[-−]?\$?\d[\d.,]*%?/) || [""])[0]; return n.length > 1 && low.includes(n.toLowerCase()); };
    const addExamples = evidence.filter((e) => overlap(e.dotpoints) && !usedFigure(e))
      .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4).map((e) => e.id);
    return {
      words, paragraphs: paras.length, verb, dotpoints: dps, figures,
      question: verbChecks(verb, paras),
      structure: structureChecks(question, paras, words),
      terms: { used: termList.filter(used), missing: termList.filter((t) => !used(t)) },
      addStats, addExamples,
    };
  }

  const api = {
    DAY, INTERVALS, MAX_BOX, REPORT_REASONS,
    VERBS, ESSAY_MIN_WORDS, ESSAY_MAX_CHARS,
    wordCount, paragraphs, verbOf, sentences, checkFigures, questionDotpoints, checkEssay,
    parseISO, toISO, fmtDate, fmtMonth, fmtPeriod, monthsBetween, freshness, ageText,
    grade, isDue, dueQueue, dayNumber,
    latest, yearChange, fmtValue, fmtDelta, periodOf, citationSentence, sentenceValue, sourceShort, isDaily,
    statCards, evidenceCards, termCards, buildDeck,
    slug, dotpointIndex, dotpointStatus, syllabusComplete, progressBackup, readBackup, daysSince, tokens, searchEvidence,
    emptyProgress, normaliseProgress, progressCounts, mergeProgress, suggestions, cleanReport,
    MASTERY, skillLevel, skillTree, branchRows, nextSkill, streak, points, relatedIndicators, relatedExamples,
    sequence, searchAll, timeAgo, recentNews, andList, newsReports,
  };
  root.DP_LOGIC = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
