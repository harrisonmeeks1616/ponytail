/* NC Unlimited Exam Coach: UI. Data lives in data-*.js, rules in logic.js. All state is one object in localStorage. */
(function () {
  "use strict";
  const NC = window.NC, L = window.NCLogic, C = L.calc;
  const KEY = "ncu.v1";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const t = (s) => esc(String(s == null ? "" : s).replace(/\s[—–]\s/g, " - ").replace(/[—]/g, "-"));
  const today = () => L.nyDate();
  const fmtD = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" });
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // ---------- state ----------
  const blank = () => ({ done: {}, log: [], attempts: {}, ver: {}, errs: [], mocks: [], cards: {}, check: {}, auth: { start: "", expiry: "" }, strong: {}, lookups: [], theme: "", examTimer: null, verif: {}, sc: {}, nav: {} });
  let S;
  try { S = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { S = blank(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast("Could not save: storage is full or blocked. Use Backup now."); } };
  const toast = (m) => { const d = document.createElement("div"); d.className = "toast"; d.textContent = m; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); };
  if (S.theme) document.documentElement.dataset.theme = S.theme;

  // ---------- derived ----------
  const bank = NC.bank, byId = Object.fromEntries(bank.map((b) => [b.id, b]));
  const domName = Object.fromEntries(NC.domains);
  const mockCats = () => NC.blueprint.map(([id, name, w]) => {
    let r = 0, n = 0;
    for (const m of S.mocks) if (m.form === "full" && m.fresh && !m.assisted && m.cats && m.cats[id]) { r += m.cats[id][0]; n += m.cats[id][1]; }
    return { id, name, weight: w, n, pct: n ? Math.round((r / n) * 100) : 0 };
  });
  const dueCount = () => L.dueErrors(S.errs, today()).length;
  const weekMinutes = () => { const d = today(); const dow = (new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7; const mon = L.addDays(d, -dow); return S.log.filter((x) => x.date >= mon).reduce((s, x) => s + x.min, 0); };
  const streak = () => { const days = new Set(S.log.map((x) => x.date).concat(Object.values(S.done).map((x) => x.at))); let n = 0, d = today(); if (!days.has(d)) d = L.addDays(d, -1); while (days.has(d)) { n++; d = L.addDays(d, -1); } return n; };

  // ---------- ui bits ----------
  const ring = (p, color) => { const R = 38, Cc = 2 * Math.PI * R; return `<div class="ring"><svg width="92" height="92" viewBox="0 0 92 92"><circle cx="46" cy="46" r="${R}" fill="none" stroke="var(--line)" stroke-width="9"/><circle cx="46" cy="46" r="${R}" fill="none" stroke="${color || "var(--amber)"}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${Cc}" stroke-dashoffset="${Cc * (1 - Math.min(p, 100) / 100)}"/></svg><b>${Math.round(p)}%</b></div>`; };
  const bar = (p, cls) => `<div class="bar ${cls || ""}"><i style="width:${Math.max(0, Math.min(100, p))}%"></i></div>`;
  const chip = (txt, c) => `<span class="chip ${c || ""}">${t(txt)}</span>`;
  const sect = (title, sub, right) => `<div class="top"><div><h2>${t(title)}</h2>${sub ? `<p>${t(sub)}</p>` : ""}</div>${right || ""}</div>`;
  const det = (title, body, open) => `<details ${open ? "open" : ""}><summary>${title}</summary><div class="body">${body}</div></details>`;
  const link = (u, txt) => `<a href="${esc(u)}" target="_blank" rel="noopener">${t(txt)}</a>`;
  const catColor = { S: "cyan", L: "amber", G: "green", M: "violet", V: "violet", H: "red", O: "red", F: "amber", X: "cyan" };

  // ---------- views ----------
  const V = {};
  let view = S.nav.view || "today";
  const NAV = [["today", "⚡", "Today"], ["plan", "\u{1F4C5}", "Plan"], ["practice", "\u{1F9E0}", "Practice"], ["law", "⚖️", "Law"], ["study", "\u{1F4D8}", "Study"], ["tools", "\u{1F9EE}", "Tools"], ["progress", "\u{1F4CA}", "Progress"], ["exam", "\u{1F3AF}", "Exam day"]];

  function renderNav() {
    const due = dueCount();
    $("#nav").innerHTML = NAV.map(([k, ic, n]) => `<button data-act="nav" data-v="${k}" ${view === k ? 'aria-current="page"' : ""}><span class="ic">${ic}</span>${n}${k === "progress" && due ? `<span class="badge">${due}</span>` : ""}</button>`).join("");
  }
  function render() { renderNav(); $("#view").innerHTML = V[view](); if (V["after_" + view]) V["after_" + view](); }
  function go(v) { view = v; S.nav.view = v; save(); render(); window.scrollTo(0, 0); }

  // ===== TODAY =====
  V.today = () => {
    const d = today(), ex = NC.exam, cd = L.countdown(new Date(), ex.startISO);
    const blk = L.calendarFor(NC.calendar, d), next = L.nextSession(NC.sessions, S.done), hrs = L.hours(NC.sessions, S.done);
    const due = dueCount(), cardsDue = L.dueCards(NC.cards.map((c) => c[0]), S.cards, d).length;
    const keyed = bank.filter((b) => !b.lookup), tried = keyed.filter((b) => S.attempts[b.id]), right = tried.filter((b) => S.attempts[b.id].ok);
    const cut = L.countdown(new Date(), ex.cutoffISO);
    const authLeft = S.auth.expiry ? L.diffDays(d, S.auth.expiry) : null;
    let mode = "";
    if (d < "2026-10-26") mode = "The condensed calendar starts Monday Oct 26.";
    else if (d > ex.date) mode = "The exam date has passed. Record your result and open Exam day for the Board licensing steps.";
    return `
    <div class="hero stack"><div class="row between"><div><span class="chip amber">Exam booked</span> <span class="chip">${t(fmtD(ex.date))} &middot; 10:00 AM to 4:00 PM ET</span></div><span class="chip">PSI Charlotte &middot; Tyvola</span></div>
      <h1>${cd.over ? "Exam window open or past" : "Pass the NC Unlimited exam."}</h1>
      <div class="count" data-clockbox><div><b data-cd="d">${cd.days}</b><span>days</span></div><div><b data-cd="h">${cd.hours}</b><span>hours</span></div><div><b data-cd="m">${cd.minutes}</b><span>min</span></div></div>
      <p class="mut sm">Open book. 100 questions, 6 hours, 70% to pass. Your coaching gate is stricter: two fresh full mocks at ${NC.gates.mockPct}%+. ${t(ex.cutoffText)}${!cut.over ? ` Cutoff is in ${cut.days}d ${cut.hours}h.` : ""}</p></div>

    <div class="grid g2" style="margin-top:14px">
      <div class="card glow stack"><div class="row between"><h3>Today's block</h3>${blk ? chip(fmtD(d), "amber") : ""}</div>
        ${blk ? `<div><b>${t(blk.title)}</b><p class="mut sm">${t(blk.detail)}</p></div>` : `<p class="mut">${t(mode || "No block scheduled today.")}</p>`}
        ${next ? `<hr><div class="row between"><div><span class="xs mut">NEXT UNFINISHED SESSION (earliest first)</span><br><b>#${next[0]} ${t(next[5])}</b><br><span class="mut sm">${next[3]}h target &middot; planned ${t(fmtD(next[1]))} &middot; ${t(NC.catNames[next[4]])}</span></div><button class="btn pri" data-act="openSession" data-n="${next[0]}">Open</button></div>` : `<hr><p class="green">All 47 sessions are checked off.</p>`}
        <div class="notice sm">Hard-day minimum: 20 minutes. Recall one concept, solve one question, correct one miss. It counts as 20 minutes, not two hours.</div>
        <div class="row"><button class="btn" data-act="quick20">Start 20-minute minimum</button><button class="btn" data-act="logForm">Log study time</button></div>
        <div id="logbox"></div></div>

      <div class="card stack"><h3>Due now</h3>
        <div class="row between"><span>Error retests due</span><button class="btn sm ${due ? "pri" : ""}" data-act="nav" data-v="progress">${due} due</button></div>
        <div class="row between"><span>Law cards due or new</span><button class="btn sm ${cardsDue ? "pri" : ""}" data-act="lawStart">${cardsDue}</button></div>
        <div class="row between"><span>Keyed practice missed</span><button class="btn sm" data-act="startMisses">${tried.length - right.length}</button></div>
        <hr>
        <div class="row"><div class="stat"><b>${hrs.done}<span class="dim">/${hrs.total}</span></b><span>session hours</span></div><div class="stat"><b>${Object.keys(S.done).length}<span class="dim">/47</span></b><span>sessions</span></div><div class="stat"><b>${streak()}</b><span>day streak</span></div></div>
        <div class="row"><div class="stat"><b>${weekMinutes()}</b><span>min this week</span></div><div class="stat"><b>${tried.length ? pct(right.length, tried.length) + "%" : "n/a"}</b><span>keyed accuracy</span></div></div></div>
    </div>

    <div class="grid g2" style="margin-top:14px">
      <div class="card stack"><h3>Reality check</h3>
        <div class="row between"><span>Fresh full mocks logged</span><b class="mono ${S.mocks.length ? "" : "amber"}">${S.mocks.filter((m) => m.form === "full" && m.fresh).length}</b></div>
        <div class="row between"><span>AI content validation (3 perfect runs)</span><b class="mono amber">0/3</b></div>
        <div class="row between"><span>Median lookup time</span><b class="mono">${S.lookups.length ? Math.round(median(S.lookups.map((x) => x.secs))) + "s" : "n/a"}<span class="dim"> / ${NC.gates.lookupSeconds}s goal</span></b></div>
        <p class="mut sm">Notion says all 47 sessions were unchecked as of Oct 25 and the calendar was rebuilt around real results. This app starts from zero too: nothing is credited until you do it.</p>
        <div class="grid g2"><div><label class="f">Board authorization start</label><input type="date" id="authStart" value="${esc(S.auth.start)}"></div><div><label class="f">Authorization expiry</label><input type="date" id="authExp" value="${esc(S.auth.expiry)}"></div></div>
        <button class="btn sm" data-act="saveAuth">Save dates</button>
        ${authLeft != null ? `<p class="${authLeft < 14 ? "red" : "green"} sm">${authLeft} days until authorization expires.</p>` : `<p class="amber sm">Open item: the Sept 10 approval email states no expiry. Enter the dates from the Board notice.</p>`}</div>
      <div class="card stack"><h3>Arc's five rules</h3><ol class="sm" style="padding-left:1.2em;margin:0">${NC.arc.map((x) => `<li>${t(x)}</li>`).join("")}</ol>
        <div class="notice cyan sm">Highest-yield gaps for someone who passed Limited: load calculations at scale, motors and transformers, special occupancies and equipment, NASCLA business, NC law. Navigation is the exam.</div></div>
    </div>`;
  };
  V.after_today = () => {};

  // ===== PLAN =====
  let planTab = "calendar";
  V.plan = () => {
    const d = today();
    const tabs = [["calendar", "Active calendar"], ["sessions", "47 sessions"], ["starter", "Optional starter"], ["verify", "Open verifications"]];
    let body = "";
    if (planTab === "calendar") {
      body = `<div class="notice sm">Active calendar = your Oct 25 condensed rebuild: Mon-Thu two 1-hour blocks, Saturday timed work, Fri/Sun off except Nov 22, Thanksgiving off, cram block Dec 5-6. The 47-session list holds the curriculum content; tick sessions as you actually finish them.</div><div style="margin-top:12px">` +
        NC.calendar.map((c) => `<div class="sess ${d >= c.from && d <= c.to ? "today" : ""}" style="grid-template-columns:1fr"><div class="row between"><b>${t(c.title)}</b><span class="chip ${d >= c.from && d <= c.to ? "amber" : ""}">${t(fmtD(c.from))}${c.to !== c.from ? " to " + t(fmtD(c.to)) : ""}</span></div><p class="mut sm" style="margin:6px 0 0">${t(c.detail)}</p></div>`).join("") + `</div>`;
    } else if (planTab === "sessions") {
      const weeks = {};
      NC.sessions.forEach((s) => (weeks[s[2]] = weeks[s[2]] || []).push(s));
      body = Object.keys(weeks).map((w) => {
        const list = weeks[w], done = list.filter((s) => S.done[s[0]]).length;
        return `<h3 style="margin:18px 0 8px">Week ${w} <span class="chip">${done}/${list.length}</span></h3>` + list.map((s) => {
          const n = s[0], dn = S.done[n], p = NC.packets && NC.packets[n];
          return `<div class="sess ${dn ? "done" : ""} ${s[1] === d ? "today" : ""}" id="s${n}"><button class="chk ${dn ? "on" : ""}" data-act="toggleSession" data-n="${n}" aria-label="Mark session ${n}">${dn ? "✓" : ""}</button>
            <div><b>#${n} ${t(s[5])}</b><div class="row" style="margin-top:4px">${chip(NC.catNames[s[4]], catColor[s[4]])}${chip(s[3] + "h")}${chip(fmtD(s[1]))}${dn ? chip("done " + fmtD(dn.at) + " &middot; " + dn.min + " min", "green").replace("&middot;", "&middot;") : ""}</div>
            <details style="margin-top:8px;background:transparent"><summary class="sm">Action and packet</summary><div class="body"><p class="sm">${t(s[6])}</p>${p ? packetHtml(p) : `<p class="xs dim">Practice packet for this session is in the Notion session page; the Practice tab has the 100-item bank and weekly sets.</p>`}</div></details></div><span></span></div>`;
        }).join("");
      }).join("");
    } else if (planTab === "starter") {
      body = `<div class="notice sm">Seven hours across six sessions. A menu for an unfinished baseline or a reduced schedule, not extra required curriculum. A cold diagnostic measures recall, not an open-book score.</div>` + NC.starter.map((s) => det(`<b>${t(s[0])}</b>`, `<p class="sm">${t(s[1])}</p>`)).join("") + `<h3 style="margin:16px 0 8px">Starter exit checklist</h3>` + NC.starterExit.map((x, i) => `<label class="row sm" style="margin:6px 0"><input type="checkbox" data-act="tick" data-k="starter${i}" ${S.check["starter" + i] ? "checked" : ""}> ${t(x)}</label>`).join("") + `<p class="sm mut">Pick the next priority from evidence: Category 11 and Limited-to-Unlimited gaps first, then grounding, calculations, motors; then weight x observed error rate. Small samples are leads, not percentages.</p>`;
    } else {
      body = `<p class="mut sm">The plan's single remaining-verification list. Tick when you have the evidence in hand.</p>` + NC.verification.map((x, i) => `<label class="row sm" style="margin:8px 0;align-items:flex-start"><input type="checkbox" data-act="tickV" data-k="${i}" ${S.verif[i] ? "checked" : ""}> <span>${t(x)}</span></label>`).join("") + `<hr><h3>Research that disagrees with your notes</h3>` + conflictsHtml();
    }
    return sect("Plan", "Dec 7 is booked. Scheduled dates never imply completed work.") + `<div class="tabs">${tabs.map(([k, n]) => `<button data-act="planTab" data-k="${k}" aria-pressed="${planTab === k}">${n}</button>`).join("")}</div>` + body;
  };
  function packetHtml(p) {
    let h = "";
    if (p.objective) h += `<p class="sm"><b>Objective:</b> ${t(p.objective)}</p>`;
    if (p.steps && p.steps.length) h += `<ol class="sm">${p.steps.map((x) => `<li>${t(x)}</li>`).join("")}</ol>`;
    if (p.questions && p.questions.length) h += `<h4>Practice from this session</h4>` + p.questions.map((q, i) => `<details style="margin-top:6px;background:var(--bg2)"><summary class="sm">${i + 1}. ${t(q.q)}</summary><div class="body sm"><p><b>Key:</b> ${t(q.a)}</p>${q.src ? `<p class="mut xs">${t(q.src)}</p>` : ""}</div></details>`).join("");
    if (p.checks && p.checks.length) h += `<h4 style="margin-top:8px">Source checks</h4><ul class="sm">${p.checks.map((x) => `<li>${t(x)}</li>`).join("")}</ul>`;
    if (p.notes) h += `<p class="mut xs">${t(p.notes)}</p>`;
    return h;
  }
  function conflictsHtml() {
    const rows = [
      ["Who supplies the code books?", "Some prep sites say PSI provides the NEC and NFPA 72 at the center. Your handbook-based notes say you bring complete, permanently tabbed books and the center supplies only calculator, scratch paper and pencils.", "Read your PSI confirmation and the handbook. Until resolved, plan to bring all three books."],
      ["Passing score", "One secondary site says 75%. Your notes (handbook) say 70%.", "Handbook governs. Coaching gate stays 82% on fresh mocks regardless."],
      ["Experience requirement", "Secondary sites mix 5 to 7 years with voucher statements. Your notes cite 21 NCAC 18B .0201: 9,000 hours total, 8,000 primary.", "Rule text governs. Your eligibility is already approved (Sept 10)."],
      ["Which exam is this?", "Some sites blur the NC state exam with the NASCLA Accredited Electrical Exam.", "Yours is the NC state Unlimited exam. NASCLA NC Electrical 14th is a reference book, not the exam."],
      ["Fresh-form claims", "Prep-site 'verified answers' claims are not answer authority.", "Use the designated books; mark unresolved items Book lookup required."]
    ];
    return `<div class="notice red sm">The build environment could not reach ncbeec.org, so none of these were re-checked against the primary source today. Allowing ncbeec.org in the network settings would let this be verified.</div><div class="scroll"><table><tr><th>Item</th><th>What the sources say</th><th>What to do</th></tr>${rows.map((r) => `<tr><td><b>${t(r[0])}</b></td><td>${t(r[1])}</td><td>${t(r[2])}</td></tr>`).join("")}</table></div>`;
  }

  // ===== PRACTICE =====
  let P = null, pcfg = { domain: 0, kind: "all", count: 20, order: "shuffle" };
  V.practice = () => {
    if (P && P.queue) return practiceRun();
    const stats = L.bankStats(bank, S.attempts, S.ver);
    const doms = NC.blueprint.map(([id, name, w]) => {
      const s = stats.find((x) => x.d === id) || {};
      const acc = s.tried ? pct(s.right, s.tried) : null;
      return `<div class="catbar"><div><div class="row between"><span>${id}. ${t(name)}</span><span class="xs dim">${s.keyed} keyed &middot; ${s.lookupDone}/${s.lookup} lookups verified</span></div>${bar(acc == null ? 0 : acc)}</div><b class="mono" style="text-align:right">${acc == null ? "n/a" : acc + "%"}</b></div>`;
    }).join("");
    const wk = NC.weeklyPackets.map(([n, name]) => `<button class="btn sm" data-act="startWeek" data-n="${n}">Wk ${n}: ${t(name)}</button>`).join(" ");
    return sect("Practice", "100-item learning bank, weekly sets, article navigation drills.") + `
    <div class="notice sm">Honest labels: 32 items are keyed arithmetic or current-law drills and are scored. The other 68 are <b>Book lookup required</b>: you answer from the designated book, record the citation, and mark yourself. Nothing here counts as a fresh mock, because you have seen the answers and AI-written keys are not independently validated.</div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card stack"><h3>Build a set</h3>
        <div class="grid g2"><div><label class="f">Domain</label><select id="pDom"><option value="0">All 11 domains</option>${NC.blueprint.map(([id, n]) => `<option value="${id}" ${pcfg.domain == id ? "selected" : ""}>${id}. ${esc(n)}</option>`).join("")}</select></div>
        <div><label class="f">Type</label><select id="pKind"><option value="all">Keyed + lookup</option><option value="keyed" ${pcfg.kind === "keyed" ? "selected" : ""}>Keyed (scored)</option><option value="lookup" ${pcfg.kind === "lookup" ? "selected" : ""}>Book lookup only</option></select></div>
        <div><label class="f">Questions</label><input type="number" id="pCount" min="1" max="100" value="${pcfg.count}"></div>
        <div><label class="f">Order</label><select id="pOrder"><option value="shuffle">Shuffled</option><option value="bank" ${pcfg.order === "bank" ? "selected" : ""}>Bank order</option></select></div></div>
        <button class="btn pri" data-act="startSet">Start set</button>
        <hr><h4>Weekly 10-question learning sets</h4><div class="row">${wk}</div>
        <div class="row"><button class="btn sm" data-act="startMisses">Retry my misses</button><button class="btn sm" data-act="navDrill">Article navigation drill</button></div></div>
      <div class="card"><h3>By domain</h3><p class="xs dim">Bar = keyed accuracy so far. Domain 11 mixes law, plans and NFPA 72.</p>${doms}</div>
    </div>`;
  };
  function startQueue(ids, label) {
    if (!ids.length) return toast("Nothing matches that set.");
    P = { queue: ids, i: 0, label, res: {}, t0: Date.now(), q0: Date.now(), reveal: false, pick: null, commit: false };
    render();
  }
  function practiceRun() {
    if (P.nav) return navRun();
    if (P.i >= P.queue.length) {
      const sc = P.queue.filter((id) => !byId[id].lookup && P.res[id] != null), r = sc.filter((id) => P.res[id]).length;
      const mins = Math.round((Date.now() - P.t0) / 60000);
      return `${sect("Set complete", P.label)}<div class="card stack"><div class="row"><div class="stat"><b>${sc.length ? r + "/" + sc.length : "n/a"}</b><span>keyed score</span></div><div class="stat"><b>${P.queue.length - sc.length}</b><span>lookups</span></div><div class="stat"><b>${mins}</b><span>minutes</span></div></div><p class="mut sm">Log any real miss to the error log so it comes back on the 1, 3, 7, 14 day schedule. Do not call a topic mastered until two clean re-solves on separate days.</p><div class="row"><button class="btn pri" data-act="endPractice">Back to practice</button><button class="btn" data-act="logStudy20">Log ${mins} min as study time</button></div></div>`;
    }
    const it = byId[P.queue[P.i]], n = P.queue.length;
    let body = "";
    if (!it.lookup) {
      const done = P.reveal;
      body = Object.entries(it.opts).map(([k, v]) => `<div class="opt ${done ? (k === it.ans ? "right" : k === P.pick ? "wrong" : "") : P.pick === k ? "sel" : ""}" data-act="pick" data-k="${k}"><b>${k}</b><span>${t(v)}</span></div>`).join("") +
        (done ? `<div class="notice ${P.pick === it.ans ? "green" : "red"}" style="margin-top:12px"><b>${P.pick === it.ans ? "Correct" : "Missed. Key: " + it.ans}</b><p class="sm" style="margin:6px 0 0">${t(it.why)}</p><p class="xs dim" style="margin:6px 0 0">${t(it.ref)}</p></div><div class="row" style="margin-top:12px">${P.pick !== it.ans ? `<button class="btn bad" data-act="logMiss">Add to error log</button>` : ""}<button class="btn pri" data-act="next">${P.i + 1 < n ? "Next" : "Finish"}</button></div>` : `<div class="row" style="margin-top:12px"><button class="btn pri" data-act="check" ${P.pick ? "" : "disabled"}>Commit answer</button><button class="btn" data-act="skip">Skip</button></div>`);
    } else {
      body = `<div class="notice sm"><b>Book lookup required.</b> Open ${t(it.book)}, find the governing section, solve, and record the citation. Lookup clock: <span class="mono" data-lk>0:00</span> (goal under ${NC.gates.lookupSeconds}s for routine lookups).</div>
        <label class="f" style="margin-top:10px">Your answer</label><textarea id="lkAns" ${P.commit ? "disabled" : ""}>${esc(P.ans || "")}</textarea>
        <label class="f" style="margin-top:8px">Exact citation (edition, section/page, exception)</label><input type="text" id="lkCite" value="${esc(P.cite || "")}" placeholder="e.g. 2020 NEC 250.66, Table, exception" ${P.commit ? "disabled" : ""}>
        ${P.commit ? `<div class="notice cyan" style="margin-top:12px"><b>Starting route:</b> ${t(it.route || "see book")}<p class="sm" style="margin:6px 0 0">${t(it.hint)}</p><p class="xs dim" style="margin:6px 0 0">The key is a prompt, not a verified answer. Grade yourself against the designated book.</p></div><div class="row" style="margin-top:12px"><button class="btn ok" data-act="lkRight">Verified in the book, I was right</button><button class="btn bad" data-act="lkWrong">I was wrong</button><button class="btn" data-act="lkSkip">Could not verify yet</button></div>` : `<div class="row" style="margin-top:12px"><button class="btn pri" data-act="lkCommit">Commit and show route</button><button class="btn" data-act="skip">Skip</button></div>`}`;
    }
    return `<div class="row between"><div><span class="chip violet">${t(domName[it.d])}</span> <span class="chip">${it.id}</span> ${it.lookup ? chip("Book lookup", "amber") : chip("Keyed", "green")}</div><div class="row"><span class="mono mut">${P.i + 1}/${n}</span><button class="btn sm" data-act="endPractice">Quit</button></div></div>${bar(((P.i) / n) * 100, "amber")}
      <div class="card" style="margin-top:12px"><h3 style="font-size:1.2rem;line-height:1.35;margin-bottom:10px">${t(it.q)}</h3>${body}</div>`;
  }
  V.after_practice = () => { const it = P && !P.nav && P.queue && byId[P.queue[P.i]]; if (it && it.lookup) tickLk(); };
  function tickLk() { const el = $("[data-lk]"); if (!el) return; const s = Math.floor((Date.now() - P.q0) / 1000); el.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  // article navigation drill
  function navRun() {
    const N = P.nav, i = N.i;
    if (i >= N.q.length) { const ok = N.res.filter(Boolean).length, md = median(N.times); return `${sect("Navigation drill done")}<div class="card stack"><div class="row"><div class="stat"><b>${ok}/${N.q.length}</b><span>located</span></div><div class="stat"><b>${md == null ? "n/a" : Math.round(md) + "s"}</b><span>median time</span></div></div><button class="btn pri" data-act="endPractice">Done</button></div>`; }
    const q = NC.nav[N.q[i]];
    return `<div class="row between"><span class="chip cyan">Where do I look?</span><div class="row"><span class="mono mut">${i + 1}/${N.q.length}</span><button class="btn sm" data-act="endPractice">Quit</button></div></div>${bar((i / N.q.length) * 100)}
    <div class="card flash" style="margin-top:12px"><div class="q">${t(q[0])}</div>${N.show ? `<div class="a"><b>${t(q[1])}</b>${q[2] ? `<p class="sm" style="margin:6px 0 0">${t(q[2])}</p>` : ""}</div><div class="row"><button class="btn ok" data-act="navRes" data-ok="1">Found it</button><button class="btn bad" data-act="navRes" data-ok="0">Missed or slow</button></div>` : `<p class="mut sm">Find it in the 2020 NEC contents or index first. Stopwatch runs. Reveal when you have your answer.</p><button class="btn pri" data-act="navShow">Reveal</button>`}</div>`;
  }

  // ===== LAW =====
  let lawTab = "drill", lawQ = null, lawGroup = -1;
  V.law = () => {
    const d = today();
    const tabs = [["drill", "Recall drill"], ["browse", "All 60 cards"], ["cases", "15 scenarios"]];
    const head = sect("Law and business", "Actor + trigger + action + deadline + exception. Recall first, then verify, then page-key your NASCLA 14th.") + `<div class="tabs">${tabs.map(([k, n]) => `<button data-act="lawTab" data-k="${k}" aria-pressed="${lawTab === k}">${n}</button>`).join("")}</div>`;
    if (lawTab === "drill") {
      if (lawQ && lawQ.i < lawQ.ids.length) {
        const c = NC.cards.find((x) => x[0] === lawQ.ids[lawQ.i]);
        return head + `<div class="row between"><span class="chip">${t(NC.lawGroups[c[1]])}</span><span class="mono mut">${lawQ.i + 1}/${lawQ.ids.length}</span></div>${bar((lawQ.i / lawQ.ids.length) * 100, "amber")}
        <div class="card flash" style="margin-top:12px"><div class="mut xs">CARD ${c[0]}</div><div class="q">${t(c[2])}</div>${lawQ.show ? `<div class="a">${t(c[3])}<p class="xs dim" style="margin:8px 0 0">${t(c[4])}</p></div><div class="row"><button class="btn ok" data-act="lawRes" data-ok="1">Got it, complete</button><button class="btn bad" data-act="lawRes" data-ok="0">Missed a piece</button></div>` : `<p class="mut sm">Say the full answer aloud: number, trigger, exception. Then reveal.</p><button class="btn pri" data-act="lawShow">Reveal</button>`}</div>`;
      }
      const ids = NC.cards.map((c) => c[0]), due = L.dueCards(ids, S.cards, d), seen = ids.filter((i) => S.cards[i]).length;
      const boxes = [1, 2, 3, 4, 5].map((b) => ids.filter((i) => S.cards[i] && S.cards[i].box === b).length);
      return head + `<div class="card stack"><div class="row"><div class="stat"><b>${due.length}</b><span>due or new</span></div><div class="stat"><b>${seen}/60</b><span>seen</span></div><div class="stat"><b>${boxes[3] + boxes[4]}</b><span>in boxes 4-5</span></div></div>
        <div><label class="f">Group</label><select id="lawGroup"><option value="-1">All groups</option>${NC.lawGroups.map((g, i) => `<option value="${i}" ${lawGroup == i ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></div>
        <div class="row"><button class="btn pri" data-act="lawStart">Start round (up to 15)</button><button class="btn" data-act="lawStartAll">Drill all in group</button></div>
        <p class="mut sm">Plan target: the first 15 cards at 12/15 on the first scored recall pass. Right answers climb the boxes (1, 3, 7, 14, 30 days); a miss drops to box 1.</p></div>`;
    }
    if (lawTab === "browse") {
      return head + `<input type="text" id="lawSearch" placeholder="Search cards (e.g. lien, five days, QI, 1099)" style="margin-bottom:12px">` + NC.lawGroups.map((g, gi) => `<h3 style="margin:14px 0 8px">${t(g)}</h3>` + NC.cards.filter((c) => c[1] === gi).map((c) => `<details data-s="${esc((c[2] + " " + c[3]).toLowerCase())}"><summary><span class="mono dim">${String(c[0]).padStart(2, "0")}</span> ${t(c[2])}</summary><div class="body"><p class="sm">${t(c[3])}</p><p class="xs dim">${t(c[4])}</p></div></details>`).join("")).join("");
    }
    return head + NC.scenarios.map((s, i) => `<details><summary><span class="mono dim">${String(i + 1).padStart(2, "0")}</span> ${t(s[0])} ${S.sc[i] ? chip("solved", "green") : ""}</summary><div class="body"><p class="sm">${t(s[1])}</p><details style="background:var(--bg2)"><summary class="sm">Solution (solve first)</summary><div class="body sm">${t(s[2])}<div class="row" style="margin-top:8px"><button class="btn sm ok" data-act="scSolved" data-i="${i}">I solved it before looking</button></div></div></details></div></details>`).join("") + `<p class="mut sm" style="margin-top:12px">Explain the denominator, trigger and assumption; then change an input and solve again. Round at the final step, and round whole quantities up when the question needs sufficient units.</p>`;
  };
  V.after_law = () => {
    const s = $("#lawSearch");
    if (s) s.addEventListener("input", () => { const q = s.value.toLowerCase(); $$("[data-s]").forEach((d) => (d.hidden = q && !d.dataset.s.includes(q))); });
  };

  // ===== STUDY =====
  let studyTab = "cats";
  V.study = () => {
    const tabs = [["cats", "11 categories"], ["nav", "Article map"], ["nfpa", "NFPA 72 and plans"], ["unl", "Unlimited additions"], ["worked", "Worked examples"], ["research", "Research and sources"]];
    let body = "";
    if (studyTab === "cats") {
      body = `<p class="mut sm">Board counts are approximate and total 100. Move a strong area to maintenance after two separated sets at 80%+, then keep occasional fresh questions. Study explanations only: confirm numbers in the 2020 NEC.</p>` + NC.categories.map((c) => det(`<span class="chip violet">${c.q}q</span> ${c.id}. ${t(c.name)} ${S.strong[c.id] ? chip("maintenance", "green") : ""}`, `<p>${t(c.purpose)}</p><h4>Key definitions</h4><ul class="sm">${c.defs.map((x) => `<li>${t(x)}</li>`).join("")}</ul><p class="sm"><b>Covers:</b> ${t(c.sections)}</p><p class="sm"><b>Lookup path:</b> ${t(c.path)}</p><div class="notice red sm"><b>Common mistake:</b> ${t(c.mistake)}</div><p class="sm" style="margin-top:8px"><b>Demonstrate:</b> ${t(c.demo)}</p><div class="row"><button class="btn sm" data-act="drillDomain" data-d="${c.id}">Drill this domain</button><label class="row sm"><input type="checkbox" data-act="strong" data-k="${c.id}" ${S.strong[c.id] ? "checked" : ""}> Two separated sets at 80%+</label></div>`)).join("") + `<h3 style="margin:18px 0 8px">Before you call a topic mastered</h3>` + NC.masteryChecks.map((m) => `<div class="card" style="margin-bottom:8px"><b>${t(m[0])}</b><p class="sm" style="margin:4px 0 0">${t(m[1])}</p></div>`).join("");
    } else if (studyTab === "nav") {
      body = `<input type="text" id="navSearch" placeholder="Search topics or articles" style="margin-bottom:10px"><div class="scroll"><table><tr><th>If the question is about</th><th>Go to</th><th>Note</th></tr>${NC.nav.map((r) => `<tr data-s="${esc((r[0] + " " + r[1] + " " + r[2]).toLowerCase())}"><td>${t(r[0])}</td><td><b class="amber">${t(r[1])}</b></td><td class="mut">${t(r[2])}</td></tr>`).join("")}</table></div><p class="mut sm">Article-level map only. Verify exact sections and exceptions in your own 2020 book and tab them permanently.</p><button class="btn pri" data-act="navDrill">Start timed drill</button>`;
    } else if (studyTab === "nfpa") {
      body = `<h3>NFPA 72 (2013): navigate by function</h3><ul class="sm">${NC.nfpa.defs.map((x) => `<li>${t(x)}</li>`).join("")}</ul><div class="scroll"><table><tr><th>Ch.</th><th>Section</th><th>What to understand</th></tr>${NC.nfpa.chapters.map((c) => `<tr><td class="mono">${c[0]}</td><td>${t(c[1])}</td><td class="mut">${t(c[2])}</td></tr>`).join("")}</table></div><div class="notice sm">${t(NC.nfpa.drill)} This map gives chapters, not numbers. Read the exact 2013 requirement and exceptions; never substitute a later edition.</div><h4 style="margin-top:14px">Numerical worksheet to complete in your 2013 book</h4><div class="scroll"><table><tr><th>Task</th><th>Start</th><th>Evidence to capture</th></tr>${NC.nfpa.worksheet.map((r) => `<tr><td>${t(r[0])}</td><td class="mono">${t(r[1])}</td><td class="mut">${t(r[2])}</td></tr>`).join("")}</table></div>
      <h3 style="margin-top:22px">Reading the official Lighting and Power Plans</h3><div class="scroll"><table><tr><th>Element</th><th>Use</th></tr>${NC.plans.elements.map((r) => `<tr><td><b>${t(r[0])}</b></td><td>${t(r[1])}</td></tr>`).join("")}</table></div><div class="row" style="margin:8px 0">${NC.plans.steps.map((s, i) => chip(i + 1 + ". " + s, "cyan")).join("")}</div><p class="sm">${t(NC.plans.traps)}</p>
      <h4>${t(NC.plans.q2.title)}</h4><p class="xs dim">${t(NC.plans.q2.note)}</p><div class="scroll"><table><tr><th>Fixture</th><th>Count</th><th>Lamp W each</th><th>Extension</th></tr>${NC.plans.q2.rows.map((r) => `<tr><td>${r[0]}</td><td class="mono">${r[1]}</td><td class="mono">${r[2]}</td><td class="mono">${r[1] * r[2]} W</td></tr>`).join("")}</table></div><p class="sm"><b>${t(NC.plans.q2.total)}</b>. The miss was an incomplete circuit inventory.</p>
      <h4>Official sample: corrected methods</h4>${NC.plans.sample.map((s) => det(`<b>${s[0]}</b>`, `<p class="sm">${t(s[1])}</p>`)).join("")}`;
    } else if (studyTab === "unl") {
      body = `<p class="sm">The official outline adds topics and difficulty beyond Limited. Aircraft hangars are marked for Unlimited alone. These are topics inside the existing categories, not extra guaranteed question counts.</p><div class="scroll"><table><tr><th>Area</th><th>Adds beyond Limited</th></tr>${[["Grounding/bonding", "High-voltage specifications"], ["Overcurrent protection", "High-voltage provisions"], ["Wiring methods", "Traveling cables/controls and high voltage"], ["Special occupancies", "Emergency systems, health care, assembly/theaters, hazardous locations"], ["Unlimited-specific", "Aircraft hangars (Art. 513)"], ["Load calculations", "High-voltage protection cases"], ["Equipment", "Machine room (elevator applications)"]].map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td></tr>`).join("")}</table></div>
      <div class="notice sm"><b>Higher voltage:</b> the handbook uses 'high-voltage' as a scope label, not one numerical threshold for every rule. Workflow: state the actual voltage, find the 2020 article/part for that range, then check grounding, protection, conductor, clearance and equipment rules. The saved 2023 book reorganizes some of this: do not use its headings as a 2020 map.</div>
      <h4 style="margin-top:14px">Hazardous locations: identify the hazard before the rule</h4><p class="sm">Class/Division and Zone describe the material and the circumstances of a hazardous atmosphere. Groups and temperature ratings concern suitability. Sealing limits flame/gas communication where required. Intrinsic safety limits circuit energy. Never infer boundary, wiring method, seal distance or equipment rating from a building label; there is no universal hazardous distance.</p>
      <div class="scroll"><table><tr><th>Article</th><th>Label</th><th>Key question</th></tr>${[["500-506", "Classified-location frameworks", "Which system and protection method?"], ["511", "Commercial garages", "What operations and classified areas?"], ["513", "Aircraft hangars", "Where do hangar-specific areas and equipment rules apply?"], ["514", "Motor fuel dispensing", "Circuits, disconnecting, seals, boundaries?"], ["515", "Bulk storage plants", "Where is storage/transfer; how is it classified?"], ["516", "Spray, dipping, coating", "How do process and ventilation change classification?"], ["517", "Health care", "Patient-care context, grounding reliability, essential electrical systems."], ["518", "Assembly", "Identify the actual assembly occupancy."], ["520", "Theaters", "Stage/audience equipment and wiring conditions."], ["550", "Mobile homes and parks", "Home supply equipment, service/feeder, park context."], ["680", "Pools", "Equipotential bonding, grounding, GFCI, underwater lighting each differ."], ["700", "Emergency systems", "Legally required life safety; contrast 701 standby and 702 optional standby."], ["620", "Elevators", "Traveling cables, controllers, disconnects, machine rooms."]].map((r) => `<tr><td class="mono">${r[0]}</td><td>${r[1]}</td><td class="mut">${r[2]}</td></tr>`).join("")}</table></div>
      <h4 style="margin-top:14px">Make each lookup teach a reusable distinction</h4><ol class="sm"><li>Occupancy/process or system.</li><li>Trigger words that establish the special condition.</li><li>Governing 2020 article, section and exception.</li><li>One sentence on why the ordinary general-rule answer would be incomplete.</li></ol>`;
    } else if (studyTab === "worked") {
      body = `<p class="sm mut">Solve in layers: inputs, governing rule, arithmetic, conductor/equipment/protection decision. Keep three checks separate: continuous-load sizing at the terminals, adjusted ampacity against actual load, and overcurrent protection.</p>` + NC.worked.map((w) => `<div class="card" style="margin-bottom:8px"><b>${t(w[0])}</b><p class="sm" style="margin:4px 0 0">${t(w[1])}</p></div>`).join("") + `<div class="notice sm">Each of these is verified in the test suite. Open Tools to rerun them with your own numbers.</div>`;
    } else {
      body = researchHtml();
    }
    return sect("Study guide", "Everything from your Notion study pages, organized for lookup.") + `<div class="tabs">${tabs.map(([k, n]) => `<button data-act="studyTab" data-k="${k}" aria-pressed="${studyTab === k}">${n}</button>`).join("")}</div>` + body;
  };
  V.after_study = () => {
    const s = $("#navSearch");
    if (s) s.addEventListener("input", () => { const q = s.value.toLowerCase(); $$("tr[data-s]").forEach((r) => (r.hidden = q && !r.dataset.s.includes(q))); });
  };
  function researchHtml() {
    const R = NC.research;
    let h = `<h3>Where the plan came from</h3><p class="sm">Every section of the Harrison OS Notion plan under NC Unlimited was read for this app: Study dashboard, Exam Plan and Readiness, Electrical Study Guide, NC Law and Business (60 cards, 15 scenarios), Fire Alarms and Plan Reading, Sources and Review Notes, Optional Starter, the 47 session pages, the 100-item bank and weekly packets, the error-log schema, the tutor instructions, and the Pass-the-exam outcome page.</p>`;
    h += `<h3 style="margin-top:16px">Test-taker reports (anecdotal)</h3><ul class="sm"><li>Jan 2026 Charlotte Unlimited pass: JCR practice tests; stress motor calculations, hazardous locations, load/box/raceway-fill accuracy, NEC navigation, law basics, knowing the fire-alarm book.</li><li>Mar/Sep 2026 Limited-to-Unlimited thread: business law/regulations and medium-voltage material; code navigation is a learned skill.</li><li>Feb 2025: practice questions first, study missed articles and calculations, tab NFPA 72.</li><li>2010-2011 Mike Holt thread: business/rules, NFPA 72, hazardous locations, higher voltage. Old: do not carry counts, prices or editions forward.</li></ul><p class="xs dim">Forum accounts are firsthand claims, not authenticated scores. They guide topic priority, not exam rules or wording.</p>`;
    h += `<h3 style="margin-top:16px">Open-book strategy (general method, adapt it)</h3><ul class="sm"><li><b>Two passes.</b> Pass one: answer anything you can in about 3 minutes, flag the rest. Pass two: spend the saved time on flagged calculations. Plan checkpoints: Q25 at 1:15, Q50 at 2:30, Q75 at 3:45, Q100 at 5:00, leaving an hour for flags.</li><li><b>Write the setup before the arithmetic.</b> Inputs with units, governing rule, then math. Most lost points are setup errors, not arithmetic.</li><li><b>Edition traps.</b> Answer from the 2020 NEC and 2013 NFPA 72 even if you remember a newer rule.</li><li><b>Read the choices for assumptions.</b> If two answers differ by a factor of 1.25 or sqrt3, the question is testing which rule applies.</li><li><b>Lookup beats memory.</b> Tab Articles 250, 310, 430 and Chapter 9 tables permanently and learn the contents page of each.</li><li><b>Do not guess a section number.</b> If the book has it, find it.</li></ul>`;
    if (R && R.sections) h += R.sections.map((s) => `<h3 style="margin-top:16px">${t(s.title)}</h3>${s.items.map((i) => `<p class="sm">${t(i.text)} ${i.url ? link(i.url, "source") : ""} ${chip(i.conf || "Unverified", i.conf === "Certain" ? "green" : "amber")}</p>`).join("")}`).join("");
    h += `<h3 style="margin-top:16px">Official links</h3><ul class="sm">${NC.exam.links.map((l) => `<li>${link(l[1], l[0])}</li>`).join("")}</ul><h3 style="margin-top:16px">Source authority</h3><p class="sm">Current statute controls legal wording; current Board rules control rule limits; the current handbook and Board instructions control exam administration; the designated book edition controls technical answers. A newer file date or a filename containing 2020 does not prove the edition.</p>`;
    return h;
  }

  // ===== TOOLS =====
  const CALCS = [
    { id: "amp3", title: "Three-phase current", f: [["kva", "kVA", 30], ["v", "Line-to-line volts", 208]], run: (v) => `<b>${C.ampsThree(v.kva, v.v)} A</b> line current<br><span class="dim">I = 1000 x kVA / (sqrt3 x V_LL). Load current, not a conductor or breaker size.</span>` },
    { id: "amp1", title: "Single-phase current", f: [["kva", "kVA", 28.8], ["v", "Volts", 240]], run: (v) => `<b>${C.ampsSingle(v.kva, v.v)} A</b>` },
    { id: "kva3", title: "kVA from amps (three-phase)", f: [["a", "Line amps", 83.27], ["v", "Line-to-line volts", 208]], run: (v) => `<b>${C.kvaThree(v.a, v.v)} kVA</b>` },
    { id: "xfmr", title: "Transformer primary and secondary", f: [["kva", "kVA", 45], ["vp", "Primary V", 480], ["vs", "Secondary V", 208]], run: (v) => { const x = C.transformer(v.kva, v.vp, v.vs); return `Primary <b>${x.primary} A</b> &middot; Secondary <b>${x.secondary} A</b><br><span class="dim">Then evaluate OCP, primary conductors, secondary conductors and grounding as separate decisions.</span>`; } },
    { id: "isc", title: "Transformer fault current (secondary terminals)", f: [["kva", "kVA", 1000], ["vs", "Secondary V", 480], ["z", "Impedance %", 5]], run: (v) => { const x = C.faultAtSecondary(v.kva, v.vs, v.z); return `I_FL <b>${x.fl} A</b> &middot; I_SC <b>${x.isc.toLocaleString()} A</b> (${x.ka} kA)<br><span class="dim">Stiff source, three-phase bolted fault at the terminals. Ignores upstream and conductor impedance and motor contribution. Not arc flash.</span>`; } },
    { id: "cont", title: "Continuous plus noncontinuous (125% rule)", f: [["c", "Continuous amps", 40], ["n", "Noncontinuous amps", 20]], run: (v) => `<b>${C.continuous(v.c, v.n)} A</b><br><span class="dim">1.25 x continuous + noncontinuous, where the applicable rule requires it. Not every load or listed assembly.</span>` },
    { id: "adj", title: "Ampacity correction and adjustment", f: [["b", "Starting ampacity (A)", 100], ["f1", "Factor 1 (ambient)", 0.91], ["f2", "Factor 2 (adjustment)", 0.8], ["cap", "Terminal limit (A, 0 = none)", 0]], run: (v) => { const x = C.adjust(v.b, [v.f1, v.f2], v.cap || 0); return `Adjusted <b>${x.adjusted} A</b> &middot; Usable <b>${x.usable} A</b><br><span class="dim">Compare against actual load and the separate overcurrent protection rule. Do not round up to a breaker without the 240.4 conditions.</span>`; } },
    { id: "mot", title: "Motor branch conductor (125% of table FLC)", f: [["flc", "Table FLC (A)", 28]], run: (v) => `Minimum <b>${C.motorConductor(v.flc)} A</b> conductor ampacity<br><span class="dim">Conductor only. Overload (430.32, nameplate), branch protection (430.52) and feeder (430.62) are separate answers.</span>` },
    { id: "vd3", title: "Voltage drop, three-phase approximation", f: [["k", "K (Cu 12.9, Al 21.2 typical at 75C)", 12.9], ["i", "Line amps", 83], ["d", "One-way feet", 150], ["cm", "Circular mils", 66360], ["v", "Line-to-line volts", 208]], run: (v) => { const x = C.vdThree(v.k, v.i, v.d, v.cm, v.v); return `<b>${x.vd} V</b> &middot; <b>${x.pct}%</b><br><span class="dim">VD = sqrt3 x K x I x D / CM. D is ONE-WAY feet. 250 kcmil = 250,000 CM. Use AC impedance and PF when the question gives them. Confirm K per the problem.</span>`; } },
    { id: "vd1", title: "Voltage drop, single-phase", f: [["k", "K", 12.9], ["i", "Amps", 20], ["d", "One-way feet", 100], ["cm", "Circular mils", 6530], ["v", "Volts", 120]], run: (v) => { const x = C.vdSingle(v.k, v.i, v.d, v.cm, v.v); return `<b>${x.vd} V</b> &middot; <b>${x.pct}%</b>`; } },
    { id: "pull", title: "Pull box (314.28 ordinary rows)", f: [["a", "Largest raceway, inches", 3], ["b", "Other raceway in same row, inches (0 = straight)", 2]], run: (v) => `Straight pull: <b>${C.pullStraight(v.a)} in</b> &middot; Angle/U (this row): <b>${C.pullAngle(v.b ? [v.a, v.b] : [v.a])} in</b><br><span class="dim">Also check other rows, the other wall, same-conductor entry spacing and exceptions. One dimension is not the whole box.</span>` },
    { id: "mk", title: "Markup vs margin", f: [["c", "Cost basis ($)", 1000], ["p", "Percent", 20]], run: (v) => `Markup price <b>$${C.priceMarkup(v.c, v.p).toLocaleString()}</b> (margin ${C.marginOfMarkup(v.p)}%)<br>Margin price <b>$${C.priceMargin(v.c, v.p).toLocaleString()}</b>` },
    { id: "be", title: "Break-even sales", f: [["fx", "Fixed costs ($)", 24000], ["vp", "Variable cost % of sales", 60]], run: (v) => `<b>$${C.breakEven(v.fx, v.vp).toLocaleString()}</b><br><span class="dim">Fixed / contribution-margin ratio.</span>` },
    { id: "pp", title: "Progress payment and retainage", f: [["k", "Contract ($)", 100000], ["ch", "Approved changes ($)", 10000], ["e", "Eligible work to date ($)", 66000], ["r", "Retainage %", 10], ["p", "Prior net payments ($)", 40000]], run: (v) => { const x = C.progress(v.k, v.ch, v.e, v.r, v.p); return `Revised <b>$${x.revised.toLocaleString()}</b> &middot; retainage <b>$${x.retainage.toLocaleString()}</b> &middot; net earned <b>$${x.netEarned.toLocaleString()}</b><br>Due now <b>$${x.due.toLocaleString()}</b> &middot; ${x.pctComplete}% complete`; } },
    { id: "ot", title: "Overtime wages", f: [["h", "Hours in workweek", 46], ["r", "Regular rate ($)", 30]], run: (v) => `<b>$${C.overtime(v.h, v.r).toLocaleString()}</b> gross<br><span class="dim">1.5x after 40 hours in the workweek. Not take-home or burdened cost.</span>` },
    { id: "int", title: "Simple interest", f: [["p", "Principal ($)", 20000], ["a", "APR %", 9], ["d", "Days", 90], ["b", "Day-count basis (360/365)", 360]], run: (v) => `<b>$${C.simpleInterest(v.p, v.a, v.d, v.b)}</b><br><span class="dim">Follow the day-count basis the question states.</span>` }
  ];
  V.tools = () => {
    const lk = S.lookups.map((x) => x.secs), md = median(lk);
    return sect("Tools", "Screening calculators. The 2020 NEC, your contract and the engineer of record govern.") + `<div class="grid g2">${CALCS.map((c) => `<div class="card stack calc" data-c="${c.id}"><h4>${t(c.title)}</h4><div class="grid g2">${c.f.map((f) => `<div><label class="f">${t(f[1])}</label><input type="number" step="any" data-k="${f[0]}" value="${f[2]}"></div>`).join("")}</div><div class="notice cyan sm out"></div></div>`).join("")}
      <div class="card stack"><h4>Lookup stopwatch</h4><p class="sm mut">Time real lookups in your tabbed book. Goal: median under ${NC.gates.lookupSeconds}s for routine lookups.</p><div class="timer" id="sw">0.0s</div><input type="text" id="swLabel" placeholder="What did you look up? (e.g. GEC table)"><div class="row"><button class="btn pri" data-act="swStart">Start</button><button class="btn ok" data-act="swStop">Stop and record</button></div><p class="sm">Recorded: <b>${lk.length}</b> &middot; median <b>${md == null ? "n/a" : Math.round(md) + "s"}</b> ${md != null ? chip(md <= NC.gates.lookupSeconds ? "on target" : "slow", md <= NC.gates.lookupSeconds ? "green" : "amber") : ""}</p>${S.lookups.slice(-5).reverse().map((x) => `<div class="row between xs"><span>${t(x.label || "lookup")}</span><span class="mono">${x.secs}s</span></div>`).join("")}</div></div>`;
  };
  V.after_tools = () => {
    $$(".calc").forEach((box) => {
      const c = CALCS.find((x) => x.id === box.dataset.c);
      const upd = () => { const v = {}; $$("input", box).forEach((i) => (v[i.dataset.k] = parseFloat(i.value))); $(".out", box).innerHTML = Object.values(v).some((x) => isNaN(x) || !isFinite(x)) ? "Enter all values." : c.run(v); };
      box.addEventListener("input", upd); upd();
    });
  };
  let sw = null;

  // ===== PROGRESS =====
  V.progress = () => {
    const cats = mockCats(), rd = L.readiness(S.mocks, NC.gates, cats), wk = L.weakest(cats), g = NC.gates;
    const d = today(), due = L.dueErrors(S.errs, d);
    const typeCount = {}; S.errs.forEach((e) => (typeCount[e.type || "untagged"] = (typeCount[e.type || "untagged"] || 0) + 1));
    return sect("Progress and readiness", "Coaching gates are stricter than the Board's 70% pass line, and they never predict a pass.") + `
    <div class="grid g2"><div class="card glow stack"><div class="row between"><h3>Readiness gate</h3>${rd.met ? chip("met", "green") : chip("not met", "amber")}</div>
      <p class="sm">Two fresh, unassisted, full 100-question mocks at ${g.mockPct}%+ within ${g.maxMinutes} minutes, no persistent category below ${g.categoryFloor}% (needs ${g.adequateSample}+ fresh questions per category), and delayed clean re-solves of recurring errors.</p>
      <ul class="sm">${rd.reasons.length ? rd.reasons.map((r) => `<li class="amber">${t(r)}</li>`).join("") : `<li class="green">All coaching gates are met on the evidence logged.</li>`}</ul>
      <p class="xs dim">Week 4 checkpoint: ${g.week4Pct}% on a fresh 30-question timed mixed set. No pass probability has been measured. Exposed or repeated forms never count as fresh.</p></div>
    <div class="card stack"><h3>Weakest categories</h3>${wk.length ? wk.slice(0, 4).map((c) => `<div class="catbar"><div>${c.id}. ${t(c.name)} <span class="xs dim">(${c.n} fresh q)</span>${bar(c.pct)}</div><b class="mono" style="text-align:right">${c.pct}%</b></div>`).join("") : `<p class="mut sm">Log a mock with category results to rank weaknesses by weight x error rate.</p>`}<p class="xs dim">Small samples are leads, not percentages.</p></div></div>

    <h3 style="margin:20px 0 8px">Mock and timed-set log</h3>
    <div class="card stack"><form id="mockForm" class="stack"><div class="grid g4">
      <div><label class="f">Label</label><input type="text" name="label" placeholder="Mock A" required></div>
      <div><label class="f">Date</label><input type="date" name="date" value="${d}" required></div>
      <div><label class="f">Form</label><select name="form"><option value="full">Full 100 (one sitting)</option><option value="set50">Timed 50</option><option value="set30">Timed 30 checkpoint</option><option value="split">Split full form</option></select></div>
      <div><label class="f">Minutes used</label><input type="number" name="minutes" min="1" max="600" value="${S.examTimer ? Math.round((Date.now() - S.examTimer.start) / 60000) : 360}" required></div>
      <div><label class="f">Score %</label><input type="number" name="score" min="0" max="100" step="0.1" required></div></div>
      <div class="row"><label class="row sm"><input type="checkbox" name="fresh" checked> Fresh (never seen)</label><label class="row sm"><input type="checkbox" name="assisted"> AI or other assistance</label></div>
      <details style="background:var(--bg2)"><summary class="sm">Category results (right / total) for fresh full mocks</summary><div class="body"><div class="grid g3">${NC.blueprint.map(([id, n, w]) => `<div><label class="f">${id}. ${esc(n.split(",")[0])} (${w})</label><div class="row"><input type="number" name="r${id}" min="0" placeholder="right" style="width:46%"><input type="number" name="t${id}" min="0" placeholder="of" style="width:46%"></div></div>`).join("")}</div></div></details>
      <button class="btn pri" type="submit">Save result</button></form>
      ${S.mocks.length ? `<div class="scroll"><table><tr><th>Date</th><th>Label</th><th>Form</th><th>Score</th><th>Min</th><th>Counts as</th><th></th></tr>${S.mocks.slice().reverse().map((m) => `<tr><td>${t(fmtD(m.date))}</td><td>${t(m.label)}</td><td>${t(m.form)}</td><td class="mono">${m.score}%</td><td class="mono">${m.minutes}</td><td>${m.form === "full" && m.fresh && !m.assisted && m.minutes <= g.maxMinutes ? chip("fresh readiness", "green") : chip("learning only", "")}</td><td><button class="btn sm" data-act="delMock" data-id="${m.id}">Delete</button></td></tr>`).join("")}</table></div>` : `<p class="mut sm">Planned fresh mocks: Oct 31 (A), Nov 7 (B), Nov 14 (C), Nov 21 (D). Under your condensed calendar the Oct 31 block is a 25-question diagnostic. Mocks need legitimate fresh 100-question forms with separate keys; if only three exist, D becomes a timed 50.</p>`}</div>

    <h3 style="margin:20px 0 8px">Active recall and error log</h3>
    <div class="card stack"><div class="row between"><b>${due.length} retests due</b><span class="xs dim">1, 3, 7, 14 days. Mastered = two clean re-solves on separate days.</span></div>
      <details style="background:var(--bg2)"><summary class="sm">Add a real miss</summary><div class="body"><form id="errForm" class="stack"><div><label class="f">Question concept</label><input type="text" name="concept" required></div><div class="grid g2"><div><label class="f">What I got wrong</label><textarea name="wrong"></textarea></div><div><label class="f">The correct rule/formula</label><textarea name="rule"></textarea></div></div><div class="grid g3"><div><label class="f">Source material</label><select name="source">${NC.sourceMaterials.map((x) => `<option>${esc(x)}</option>`).join("")}</select></div><div><label class="f">Error type</label><select name="type">${NC.errorTypes.map((x) => `<option>${esc(x)}</option>`).join("")}</select></div><div><label class="f">Governing reference (edition, section/page, question ID)</label><input type="text" name="ref"></div></div><button class="btn pri" type="submit">Log it</button></form></div></details>
      ${S.errs.length ? S.errs.slice().sort((a, b) => ((a.mastered ? 1 : 0) - (b.mastered ? 1 : 0)) || ((a.next || "9") < (b.next || "9") ? -1 : 1)).map((e) => `<div class="sess" style="grid-template-columns:1fr auto"><div><b>${t(e.concept)}</b> ${e.mastered ? chip("mastered", "green") : e.next && e.next <= d ? chip("due " + fmtD(e.next), "amber") : chip("next " + (e.next ? fmtD(e.next) : "-"))} ${chip(e.type || "untagged")} ${chip(e.source || "")}<p class="sm" style="margin:6px 0 0">${e.wrong ? `<span class="mut">Wrong:</span> ${t(e.wrong)}<br>` : ""}${e.rule ? `<span class="mut">Rule:</span> ${t(e.rule)}<br>` : ""}${e.ref ? `<span class="xs dim">${t(e.ref)}</span>` : ""}</p></div><div class="stack">${e.mastered ? "" : `<button class="btn sm ok" data-act="errClean" data-id="${e.id}">Clean re-solve</button><button class="btn sm bad" data-act="errMiss" data-id="${e.id}">Missed again</button>`}<button class="btn sm" data-act="errDel" data-id="${e.id}">Delete</button></div></div>`).join("") : `<p class="mut sm">Empty on purpose. Record only real misses: nothing is pre-filled.</p>`}
      ${S.errs.length ? `<p class="xs dim">By type: ${Object.entries(typeCount).map(([k, v]) => k + " " + v).join(" &middot; ")}</p>` : ""}</div>

    <h3 style="margin:20px 0 8px">Weekly scorecard</h3>
    <div class="card"><div class="grid g4"><div class="stat"><b>${weekMinutes()}</b><span>study minutes (actual)</span></div><div class="stat"><b>${S.mocks.filter((m) => m.date >= L.addDays(d, -6)).length}</b><span>timed sets (7d)</span></div><div class="stat"><b>${S.errs.filter((e) => e.mastered).length}/${S.errs.length}</b><span>errors mastered</span></div><div class="stat"><b>${L.diffDays(d, NC.exam.date)}</b><span>days to exam</span></div></div>
      <p class="sm mut">Weekly update line: "Studied ${weekMinutes()} min; slowest topic __; repeated miss __; appointment Dec 7; next week's available time __."</p></div>

    <h3 style="margin:20px 0 8px">Backup</h3><div class="card stack"><p class="sm">Everything is stored in this browser only. Export before clearing site data or switching phones.</p><div class="row"><button class="btn" data-act="export">Download backup</button><button class="btn" data-act="copyBackup">Copy backup</button><label class="btn">Restore file<input type="file" id="restoreFile" accept="application/json" hidden></label><button class="btn" data-act="theme">Toggle light/dark</button><button class="btn bad" data-act="reset">Erase all progress</button></div><textarea id="restoreTxt" placeholder="Or paste a backup here"></textarea><button class="btn sm" data-act="restoreTxt">Restore pasted backup</button></div>`;
  };
  V.after_progress = () => {
    const mf = $("#mockForm");
    if (mf) mf.addEventListener("submit", (e) => {
      e.preventDefault(); const f = new FormData(mf), cats = {};
      NC.blueprint.forEach(([id]) => { const r = parseInt(f.get("r" + id), 10), tt = parseInt(f.get("t" + id), 10); if (tt > 0 && r >= 0 && r <= tt) cats[id] = [r, tt]; });
      S.mocks.push({ id: "m" + Date.now(), label: f.get("label"), date: f.get("date"), form: f.get("form"), minutes: +f.get("minutes"), score: +f.get("score"), fresh: !!f.get("fresh"), assisted: !!f.get("assisted"), cats });
      S.mocks.sort((a, b) => (a.date < b.date ? -1 : 1)); S.examTimer = null; save(); toast("Result saved."); render();
    });
    const ef = $("#errForm");
    if (ef) ef.addEventListener("submit", (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(ef)); S.errs.push(L.newError(f, today())); save(); toast("Logged. First retest tomorrow."); render(); });
    const rf = $("#restoreFile");
    if (rf) rf.addEventListener("change", () => { const r = new FileReader(); r.onload = () => doRestore(r.result); rf.files[0] && r.readAsText(rf.files[0]); });
  };
  function doRestore(txt) { try { S = Object.assign(blank(), L.importState(txt)); save(); toast("Backup restored."); render(); } catch (e) { toast("Restore failed: " + e.message); } }

  // ===== EXAM DAY =====
  V.exam = () => {
    const ex = NC.exam, st = S.examTimer;
    const list = (arr) => `<ul class="sm">${arr.map((x) => `<li>${t(x)}</li>`).join("")}</ul>`;
    const ck = (k, txt) => `<label class="row sm" style="margin:7px 0;align-items:flex-start"><input type="checkbox" data-act="tick" data-k="${k}" ${S.check[k] ? "checked" : ""}> <span>${t(txt)}</span></label>`;
    const items = ["Appointment confirmation printed or saved offline", "Route driven or mapped; leave to arrive by 9:30 (check-in by 9:45)", "Two valid, unexpired signed IDs, one government photo ID, names match registration", "2020 NEC, complete and bound, permanent tabs only", "2013 NFPA 72, complete and bound, permanent tabs only", "NASCLA North Carolina Electrical, 14th edition, page-keyed", "No loose papers, stapled tabs, divider tabs or temporary flags in any book", "Books tabbed to Articles 90, 100, 110, 210, 220, 230, 240, 250, 310, 430, 450, Chapter 9 tables, NFPA 72 chapters", "Read your PSI confirmation: confirm whether the center supplies reference books", "Sleep protected on Dec 6 (hard stop in the evening)", "Water, snack, layers, medications for a six-hour sitting"];
    return sect("Exam day", "Dec 7, 2026 at PSI Charlotte, Tyvola.") + `
    <div class="grid g2"><div class="card glow stack"><h3>Logistics</h3><p class="sm">${t(ex.center)}</p><p class="sm">${t(ex.window)}</p><p class="sm"><b>IDs:</b> ${t(ex.ids)}</p><p class="sm amber">${t(ex.cutoffText)} The handbook and FAQ word cancellation differently: get your appointment-specific PSI terms. A changed appointment does not extend authorization.</p><p class="xs dim">${t(ex.contacts)}</p></div>
      <div class="card stack"><h3>Six-hour timer</h3><p class="sm mut">Use for mocks and rehearsals. Checkpoints keep a full hour for flagged items: Q25 at 1:15, Q50 at 2:30, Q75 at 3:45, Q100 at 5:00.</p><div class="timer" id="exClock">${st ? "" : "0:00:00"}</div><div id="exNext" class="sm mut"></div><div class="row">${st ? `<button class="btn bad" data-act="exStop">Stop and log result</button>` : `<button class="btn pri" data-act="exStart">Start clock</button>`}</div></div></div>
    <h3 style="margin:20px 0 8px">Books and what is admitted</h3><div class="scroll"><table><tr><th>Material</th><th>Treatment</th></tr>${ex.books.map((b) => `<tr><td><b>${t(b[0])}</b></td><td>${t(b[1])}</td></tr>`).join("")}</table></div>
    <h3 style="margin:20px 0 8px">Prepare compliant books</h3>${list(ex.bookRules)}
    <h3 style="margin:20px 0 8px">Packing and readiness checklist</h3><div class="card">${items.map((x, i) => ck("pack" + i, x)).join("")}</div>
    <div class="grid g2" style="margin-top:20px"><div class="card stack"><h3>Final 48 hours</h3>${list(["Normal sleep. Known-error glance only if it helps.", "Confirmation and route checked; approved books and matching IDs ready.", "No new six-hour exam. Dec 5-6 are the cram block under your condensed plan: weakest topics and miss list, then rapid-fire formulas and index speed, hard stop in the evening.", "Dec 7, 5:00 AM: a 45-minute rapid review, then the exam."])}</div>
      <div class="card stack"><h3>After you pass</h3>${list(["Passing, Board qualification and issuance/upgrade of the business license are separate steps.", "Save the result. Identify the Board licensing/upgrade step: the license application, the qualified-individual certification and the financial evidence for Unlimited (projects above $150,000).", "Listed QI added or lost: tell the Board within five days. Address or contact changes: 30 days.", "You already hold Limited: do not assume the new-QI four-hour Laws and Rules course restarts on an upgrade without Board confirmation.", "South Carolina work needs its own licensing path; an NC license does not authorize it."])}</div></div>
    <h3 style="margin:20px 0 8px">Source conflicts to verify</h3>${conflictsHtml()}`;
  };
  V.after_exam = () => tickClock();
  function fmtClock(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 3600) + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
  function tickClock() {
    const el = $("#exClock");
    if (el && S.examTimer) {
      const ms = Date.now() - S.examTimer.start; el.textContent = fmtClock(ms); el.className = "timer" + (ms > 360 * 60000 ? " red" : "");
      const cps = [[25, 75], [50, 150], [75, 225], [100, 300]], m = ms / 60000, nx = cps.find((c) => m < c[1]);
      $("#exNext").innerHTML = nx ? `Next checkpoint: <b>Q${nx[0]}</b> by ${fmtClock(nx[1] * 60000).slice(0, 4)} (${Math.ceil(nx[1] - m)} min away)` : `Review window. ${Math.max(0, Math.ceil(360 - m))} min left.`;
    }
  }

  // ---------- events ----------
  const A = {
    nav: (el) => go(el.dataset.v),
    planTab: (el) => { planTab = el.dataset.k; render(); },
    studyTab: (el) => { studyTab = el.dataset.k; render(); },
    lawTab: (el) => { lawTab = el.dataset.k; render(); },
    openSession: (el) => { planTab = "sessions"; go("plan"); setTimeout(() => { const n = $("#s" + el.dataset.n); if (n) { n.scrollIntoView({ block: "center" }); $("details", n).open = true; } }, 30); },
    toggleSession: (el) => {
      const n = +el.dataset.n, s = NC.sessions.find((x) => x[0] === n);
      if (S.done[n]) { delete S.done[n]; save(); return render(); }
      const m = prompt(`Actual minutes spent on session ${n}? (target ${s[3] * 60})`, String(Math.round(s[3] * 60)));
      if (m === null) return;
      const min = Math.max(0, parseInt(m, 10) || 0);
      S.done[n] = { at: today(), min }; if (min) S.log.push({ date: today(), min, note: "Session " + n }); save(); render();
    },
    tick: (el) => { S.check[el.dataset.k] = el.checked; save(); },
    tickV: (el) => { S.verif[el.dataset.k] = el.checked; save(); },
    strong: (el) => { S.strong[el.dataset.k] = el.checked; save(); },
    saveAuth: () => { S.auth = { start: $("#authStart").value, expiry: $("#authExp").value }; save(); toast("Saved."); render(); },
    logForm: () => { $("#logbox").innerHTML = `<div class="row" style="margin-top:8px"><input type="number" id="logMin" placeholder="minutes" style="width:110px" min="1"><input type="text" id="logNote" placeholder="what you did" style="flex:1"><button class="btn pri" data-act="logSave">Save</button></div>`; $("#logMin").focus(); },
    logSave: () => { const m = parseInt($("#logMin").value, 10); if (!m) return; S.log.push({ date: today(), min: m, note: $("#logNote").value }); save(); toast(m + " minutes logged."); render(); },
    logStudy20: () => { const m = Math.max(1, Math.round((Date.now() - P.t0) / 60000)); S.log.push({ date: today(), min: m, note: "Practice set" }); save(); P = null; toast(m + " minutes logged."); render(); },
    quick20: () => { const ids = shuffle(bank.filter((b) => !b.lookup).map((b) => b.id)).slice(0, 1); P = null; lawQ = null; go("practice"); startQueue(ids, "20-minute minimum: solve one question, then recall one card, then correct one miss"); },
    // practice
    startSet: () => {
      pcfg = { domain: +$("#pDom").value, kind: $("#pKind").value, count: Math.max(1, Math.min(100, parseInt($("#pCount").value, 10) || 10)), order: $("#pOrder").value };
      let ids = bank.filter((b) => (!pcfg.domain || b.d === pcfg.domain) && (pcfg.kind === "all" || (pcfg.kind === "lookup") === !!b.lookup)).map((b) => b.id);
      if (pcfg.order === "shuffle") ids = shuffle(ids); startQueue(ids.slice(0, pcfg.count), "Custom set");
    },
    startWeek: (el) => { const w = NC.weeklyPackets.find((x) => x[0] === +el.dataset.n); startQueue(w[2].slice(), "Week " + w[0] + ": " + w[1]); },
    startMisses: () => { const ids = bank.filter((b) => S.attempts[b.id] && !S.attempts[b.id].ok).map((b) => b.id); if (view !== "practice") { view = "practice"; } startQueue(ids, "Retry misses"); },
    drillDomain: (el) => { pcfg.domain = +el.dataset.d; go("practice"); },
    navDrill: () => { view = "practice"; P = { nav: { q: shuffle(NC.nav.map((_, i) => i)).slice(0, 15), i: 0, show: false, res: [], times: [], t0: Date.now() }, queue: [0], i: 0, label: "nav" }; render(); },
    navShow: () => { P.nav.show = true; P.nav.dt = (Date.now() - P.nav.t0) / 1000; render(); },
    navRes: (el) => { P.nav.res.push(el.dataset.ok === "1"); P.nav.times.push(P.nav.dt); if (P.nav.dt) S.lookups.push({ label: "nav: " + NC.nav[P.nav.q[P.nav.i]][1], secs: Math.round(P.nav.dt), date: today() }); P.nav.i++; P.nav.show = false; P.nav.t0 = Date.now(); save(); render(); },
    pick: (el) => { if (P.reveal) return; P.pick = el.dataset.k; render(); },
    check: () => { const it = byId[P.queue[P.i]]; P.reveal = true; const ok = P.pick === it.ans; P.res[it.id] = ok; const a = S.attempts[it.id] || { n: 0 }; S.attempts[it.id] = { ok, n: a.n + 1, last: today() }; save(); render(); },
    skip: () => A.next(),
    next: () => { P.i++; P.reveal = false; P.pick = null; P.commit = false; P.ans = ""; P.cite = ""; P.q0 = Date.now(); render(); },
    lkCommit: () => { P.ans = $("#lkAns").value; P.cite = $("#lkCite").value; P.commit = true; P.secs = Math.round((Date.now() - P.q0) / 1000); render(); },
    lkRight: () => lkDone(true), lkWrong: () => lkDone(false), lkSkip: () => A.next(),
    logMiss: () => { const it = byId[P.queue[P.i]]; S.errs.push(L.newError({ concept: it.id + " " + domName[it.d] + ": " + it.q.slice(0, 70), wrong: P.pick ? "Chose " + P.pick + ": " + it.opts[P.pick] : (P.ans || ""), rule: it.why || it.hint || "", source: it.lookup ? (it.book === "2013 NFPA 72" ? "2013 NFPA 72" : it.book === "2020 NEC" ? "2020 NEC" : "NASCLA") : (it.kind === "law" ? "NC Board Rules" : "2020 NEC"), ref: "Bank " + it.id + (it.ref ? ". " + it.ref : P.cite ? ". " + P.cite : ""), type: it.kind === "calc" ? "Setup Error" : "Code Lookup Miss" }, today())); save(); toast("Added to the error log. Retest tomorrow."); },
    endPractice: () => { P = null; render(); },
    // law
    lawStart: () => { lawTab = "drill"; const g = $("#lawGroup"); if (g) lawGroup = +g.value; const ids = NC.cards.filter((c) => lawGroup < 0 || c[1] === lawGroup).map((c) => c[0]); lawQ = { ids: shuffle(L.dueCards(ids, S.cards, today())).slice(0, 15), i: 0, show: false }; if (!lawQ.ids.length) { toast("Nothing due in that group."); lawQ = null; } go("law"); },
    lawStartAll: () => { const g = $("#lawGroup"); lawGroup = +g.value; lawQ = { ids: shuffle(NC.cards.filter((c) => lawGroup < 0 || c[1] === lawGroup).map((c) => c[0])), i: 0, show: false }; render(); },
    lawShow: () => { lawQ.show = true; render(); },
    lawRes: (el) => { const id = lawQ.ids[lawQ.i]; S.cards[id] = L.review(S.cards[id], el.dataset.ok === "1", today()); lawQ.i++; lawQ.show = false; save(); render(); },
    scSolved: (el) => { S.sc[el.dataset.i] = true; save(); render(); },
    // tools
    swStart: () => { sw = Date.now(); },
    swStop: () => { if (!sw) return; const secs = Math.round((Date.now() - sw) / 100) / 10; S.lookups.push({ label: $("#swLabel").value, secs: Math.round(secs), date: today() }); sw = null; save(); render(); },
    // progress
    errClean: (el) => { S.errs = S.errs.map((e) => (e.id === el.dataset.id ? L.retest(e, today(), true) : e)); save(); render(); },
    errMiss: (el) => { S.errs = S.errs.map((e) => (e.id === el.dataset.id ? L.retest(e, today(), false) : e)); save(); render(); },
    errDel: (el) => { if (confirm("Delete this entry?")) { S.errs = S.errs.filter((e) => e.id !== el.dataset.id); save(); render(); } },
    delMock: (el) => { if (confirm("Delete this result?")) { S.mocks = S.mocks.filter((m) => m.id !== el.dataset.id); save(); render(); } },
    export: () => { const b = new Blob([L.exportState(S)], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "nc-unlimited-backup-" + today() + ".json"; a.click(); },
    copyBackup: () => { navigator.clipboard ? navigator.clipboard.writeText(L.exportState(S)).then(() => toast("Backup copied.")) : ($("#restoreTxt").value = L.exportState(S)); },
    restoreTxt: () => doRestore($("#restoreTxt").value),
    theme: () => { const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"); S.theme = cur === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = S.theme; save(); },
    reset: () => { if (confirm("Erase ALL progress on this device? Download a backup first.") && confirm("Really erase everything?")) { S = blank(); save(); render(); } },
    exStart: () => { S.examTimer = { start: Date.now() }; save(); render(); },
    exStop: () => { go("progress"); toast("Timer minutes are prefilled in the result form."); }
  };
  function lkDone(ok) {
    const it = byId[P.queue[P.i]];
    S.ver[it.id] = { cite: P.cite || "", secs: P.secs, ok, date: today() };
    if (P.secs) S.lookups.push({ label: it.id, secs: P.secs, date: today() });
    P.res[it.id] = ok; save();
    if (ok) A.next(); else { A.logMiss(); A.next(); }
  }
  document.addEventListener("click", (e) => { const el = e.target.closest("[data-act]"); if (!el || el.tagName === "INPUT") return; const f = A[el.dataset.act]; if (f) f(el); });
  document.addEventListener("change", (e) => { const el = e.target; if (el.tagName === "INPUT" && el.type === "checkbox" && el.dataset.act && A[el.dataset.act]) A[el.dataset.act](el); });
  setInterval(() => { tickClock(); if (P && P.queue && !P.nav && P.i < P.queue.length && byId[P.queue[P.i]] && byId[P.queue[P.i]].lookup && !P.commit) tickLk(); const swEl = $("#sw"); if (swEl && sw) swEl.textContent = ((Date.now() - sw) / 1000).toFixed(1) + "s";
    const cd = L.countdown(new Date(), NC.exam.startISO), q = (k) => $("[data-cd=" + k + "]"); if (q("d")) { q("d").textContent = cd.days; q("h").textContent = cd.hours; q("m").textContent = cd.minutes; } }, 1000);
  window.addEventListener("keydown", (e) => { if (e.target.matches("input,textarea,select")) return; const i = NAV.findIndex((n) => n[0] === view); if (e.key === "]" ) go(NAV[(i + 1) % NAV.length][0]); if (e.key === "[") go(NAV[(i + NAV.length - 1) % NAV.length][0]); });
  render();
})();
