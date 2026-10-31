// Source: Harrison OS Notion, NC Unlimited · Study (Exam Plan & Readiness, 8-Week Study Execution Plan). Read 2026-10-31.
(function (g) {
  g.NC = g.NC || {};

  g.NC.exam = {
    startISO: "2026-12-07T15:00:00Z", // Mon Dec 7 2026 10:00 AM EST (UTC-5)
    date: "2026-12-07",
    center: "PSI Charlotte, Tyvola Executive Park, 5701 Westpark Drive, Suite 101, Charlotte, NC 28217 (I-77 exit 5, Tyvola Rd, Westpark Dr)",
    window: "10:00 AM to 4:00 PM ET (360 minutes). Be there by 9:30; check in by 9:45. Starting more than 15 minutes late forfeits the booking.",
    questions: 100, minutes: 360, passPct: 70,
    cutoffISO: "2026-12-05T15:00:00Z", // PSI 48h cutoff: Sat Dec 5 10:00 AM
    cutoffText: "PSI cancel/reschedule cutoff: Saturday Dec 5, 10:00 AM (48 hours). Final readiness decision Wed Dec 2; personal go/no-go Fri Dec 4.",
    books: [
      ["2020 NEC (complete bound)", "Required and permitted. Timed navigation, exact 2020 provisions, calculations, exceptions."],
      ["2013 NFPA 72 (complete bound)", "Required and permitted for Unlimited. Chapter navigation plus system-specific numbers."],
      ["NASCLA North Carolina Electrical, 14th edition", "Admitted under the current handbook. Only the 14th edition is allowed from June 16, 2026. Recall first, then verify and page-key it."],
      ["G.S. 87 Art. 4 and 21 NCAC 18B", "STUDY sources only. Separate law/rules documents are not on the admitted list. Content inside NASCLA can be consulted."],
      ["Official Lighting and Power Plans", "Tested. Study drawings are at the back of the NCBEEC/PSI handbook (printed pp. 69-70). No personal plan packet is authorized."],
      ["2023 NEC (saved copy)", "Supporting explanation only. NOT the exam edition. Article 220 and higher-voltage layout differ from 2020."]
    ],
    bookRules: [
      "Complete softbound, spiral or hardbound books only. No loose-leaf, no partial references.",
      "Highlighting, underlining and notes already on the pages are permitted. Highlight pencil notes; pen notes need not be highlighted.",
      "No writing in books during the exam. No inserted papers, loose or attached.",
      "Permanent tabs meeting the current handbook rules only. Temporary flags, stapled tabs and divider tabs are prohibited. A brand name alone does not prove compliance; compare the product against the handbook.",
      "NFPA 13 is outside this exam's reference set. NFPA 70E is optional enrichment, not an admitted reference.",
      "Test center supplies calculator, scratch paper and pencils."
    ],
    ids: "Two valid, unexpired signed IDs, at least one government photo ID, names matching registration.",
    contacts: "NCBEEC office@ncbeec.org (919) 733-9042. PSI examschedule@psionline.com (855) 746-8173. Verify details in your actual confirmation.",
    links: [
      ["NCBEEC/PSI current handbook", "https://www.ncbeec.org/psi-exam-book-2026-002-2/"],
      ["Board examinations", "https://www.ncbeec.org/examinations/"],
      ["Board FAQ", "https://www.ncbeec.org/faq/"],
      ["Board rules, 21 NCAC 18B", "https://www.ncbeec.org/title-21-ncac-18b/"],
      ["G.S. Chapter 87", "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByChapter/Chapter_87.html"],
      ["PSI NCBEEC portal", "https://test-takers.psiexams.com/ncbeec"],
      ["NASCLA NC Electrical 14th notice", "https://store.nascla.org/products/north-carolina-electrical-14th-edition"],
      ["NFPA free access: NEC 2020", "https://link.nfpa.org/free-access/publications/70/2020"],
      ["NFPA free access: NFPA 72 (2013)", "https://link.nfpa.org/free-access/publications/72/2013"]
    ]
  };

  // Official approximate blueprint (sums to 100).
  g.NC.blueprint = [
    [1, "Bonding and grounding", 11], [2, "Overcurrent protection", 9], [3, "Wiring methods and terminations", 10],
    [4, "Boxes and fittings", 7], [5, "Service entrance and equipment", 9], [6, "Motors and control wiring", 9],
    [7, "Special occupancies and hazardous locations", 9], [8, "Load calculations", 11],
    [9, "Appliances, equipment, and lighting", 7], [10, "General definitions and installation", 3],
    [11, "Law, business, plans, NFPA 72 (mixed, no fixed subcounts)", 15]
  ];

  // Coaching gates (separate from the Board's 70% pass line).
  g.NC.gates = { mockPct: 82, mockCount: 2, maxMinutes: 360, categoryFloor: 70, adequateSample: 15, checkpointPct: 75, checkpoints: ["2026-11-06", "2026-11-13", "2026-12-02"], lookupSeconds: 90 };

  // Sprint rebuilt by Harrison OS on Oct 31, 2026 (Day 01 = today). 37 dated sessions live in data-sessions.js; total 94.5 planned hours.
  g.NC.sprint = { start: "2026-10-31", end: "2026-12-06", hours: 94.5, rhythm: "Ordinary day 2 h (7 to 9 PM). Weekends: two 2 h blocks (9 to 11 AM and 1 to 3 PM) on Sundays and Nov 7. Saturday mocks 6 h (10 AM to 4 PM). Thanksgiving 0.5 h. Difficult-day minimum 20 minutes." };
  g.NC.rules = [
    "A scheduled date is never proof of completed work. Check Status only when the session is actually done.",
    "Ordinary two-hour block: 5 min launch and recall, 25 main learning, 5 break, 25 practice, 5 break, 20 rotating law/NFPA 72/plans, 30 correct and re-solve, 5 record.",
    "Difficult day (20 min): recall one due item (5), solve one question (10), record the actual 20 minutes (5). Carry unfinished items into the next two rows' correction slots, at most two per day. Never double tomorrow; never drop a domain.",
    "Mastered means two clean delayed re-solves on separate days. Try about 1, 3, 7 and 14 days after a miss.",
    "Book lookup required: grade only after reading the exact 2020 NEC / 2013 NFPA 72 / NASCLA text. Commit every answer before opening the key; write answer, exact source, condition/exception, elapsed time.",
    "Navigation is the exam. Open-book and lookup-heavy: find-it-fast beats rereading. Routine lookup median under 90 seconds."
  ];
  // Key dates and decisions
  g.NC.keyDates = [
    ["2026-11-03", "Borrowed books target", "Have the NASCLA NC Electrical (14th) and the 2013 NFPA 72 in hand (Day 04 check)."],
    ["2026-11-06", "Checkpoint 1 and fresh-form decision", "30-question checkpoint (aim 75%+). Decide where fresh full forms come from (acquisition checklist below)."],
    ["2026-11-13", "Checkpoint 2", "Mixed checkpoint and Mock A preparation (aim 75%+)."],
    ["2026-11-14", "Mock A", "Full 100-question form, 10 AM to 4 PM, admitted books, no assistance."],
    ["2026-11-21", "Mock B", "Second fresh full form."],
    ["2026-11-23", "14-day readiness review", "Review Mocks A and B, category evidence and recurring errors. Decide early about targeted instruction or an in-window date change."],
    ["2026-11-28", "Mock C", "Third fresh full form."],
    ["2026-12-02", "Final readiness decision and checkpoint 3", "Fresh targeted checkpoint (aim 75%+), then the final readiness decision."],
    ["2026-12-04", "Personal go/no-go", "Final book/tab/ID/route/authorization checks. Decide before the PSI cutoff."],
    ["2026-12-05", "PSI cutoff 10:00 AM", "Cancel or reschedule at least 48 hours ahead. Your confirmation's terms govern. Dec 5 is a 2 h targeted set only; no full mock."],
    ["2026-12-06", "Light review, pack, sleep", "0.5 h. Normal sleep."],
    ["2026-12-07", "EXAM", "10:00 AM to 4:00 PM at PSI Charlotte Tyvola. Arrive by 9:30; check in by 9:45."]
  ];
  g.NC.acquire = {
    title: "Fresh full-form acquisition checklist (due Fri Nov 6)",
    items: ["NC Unlimited scope (not a generic or NASCLA-accredited exam)", "100 multiple-choice items weighted 11/9/10/7/9/9/9/11/7/3/15", "Keyed to 2020 NEC, 2013 NFPA 72 and NASCLA NC", "A separate answer key, never shown while studying", "Never seen before", "Enough distinct forms for three mocks", "Provider and form ID recorded"],
    note: "None was found free and nothing has been purchased. Providers to evaluate (not endorsements, accuracy not reviewed): LicenseExams NC Unlimited (577-question pool; random forms may repeat) and JCR Productions NC self-study. If nothing qualifies, Mocks A to C run as labeled LEARNING/ENDURANCE runs with no readiness credit."
  };

  g.NC.catNames = { S: "Code speed", P: "OCP and services", W: "Wiring and boxes", C: "Load calcs", R: "Review and readiness", L: "Law and business", G: "Grounding/bonding", M: "Math/transformers", V: "Motors/VD", H: "High voltage", O: "Special occupancies", F: "NFPA 72", X: "Full mock" };

  g.NC.verification = [
    "Board authorization start and expiry dates (the Sept 10 eligibility email gives no expiry; Dec 9 was an old inference, not a limit).",
    "2020 NEC: check edition-sensitive values and exceptions in the book: ampacity, box-fill grounds, GFCI scope, service disconnects, lighting factors, higher voltage.",
    "2013 NFPA 72: complete the numerical worksheet (system type, number, unit, condition, exception, exact section).",
    "NASCLA 14th: add page references to the 60 law/business cards; read every chapter.",
    "Sample assumptions: lighting-duty in official Q22-23, receptacle/duty in Q26 stay explicit.",
    "Fresh practice: obtain full forms with separate keys (checklist due Nov 6); record your own timed results.",
    "Borrowed books: NASCLA NC Electrical 14th and 2013 NFPA 72 in hand by Nov 3.",
    "Business-card corrections made Oct 31 (cards 2, 3, 23, 60): re-read them in NC Law and cross-check the book."
  ];
})(typeof window !== "undefined" ? window : globalThis);
