# NC Unlimited Exam Coach

Study, practice and readiness tracking for the North Carolina Unlimited Electrical Contractor exam (booked Monday, Dec 7, 2026, 10:00 AM ET, PSI Charlotte Tyvola). Built from the Harrison OS Notion plan under **NC Unlimited**, as rebuilt on Oct 31, 2026 (Day 01 is Oct 31). One static page, no build step, no accounts, works offline.

Exam reference set: **2020 NEC**, **2013 NFPA 72**, **NASCLA North Carolina Electrical (current edition; the publisher offers the 14th, confirm your copy)**. 100 questions, six hours, 70% to pass.

| File | What it is |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The app: Today, Plan, Practice, Law, Study, Tools, Progress, Exam day |
| `logic.js` | Pure logic: Eastern-time countdown, spaced repetition, readiness gates, calculators, NEC table lookups |
| `data-plan.js` | Exam facts, books and tab rules, key dates, fresh-form checklist, gates |
| `data-sessions.js` | The 37-day sprint (Oct 31 to Dec 6, 94.5 hours) rebuilt in Notion on Oct 31 |
| `data-packets.js` | Practice packets from each of the 37 Notion session pages |
| `data-study.js` | The 11 categories, article map, NFPA 72 chapter map, plan reading, worked examples, optional starter |
| `data-law.js` | 60 NC law and business recall cards (with the Oct 31 corrections), 15 worked scenarios |
| `data-bank.js` | The 100-item learning bank (32 keyed, 68 book-lookup) |
| `data-nec.js` | NEC 2020 / NFPA 72 (2013) quick reference. Each table carries a confidence tag: V (read in NFPA LiNK by Harrison/Codex, relayed), S (secondary sources agreed) or R (recalled) |
| `LOOKUPS.md` | Generated status of the 68 book-lookup questions: resolved, partly resolved, still open |

## What it will not do

- It never counts a book-lookup item as scored. You answer from the designated book, record the citation and grade yourself.
- It never counts an exposed form as a fresh mock. Readiness needs two fresh, unassisted, full 100-question mocks at 82%+ within six hours, no category below 70% on 15+ fresh questions.
- It only labels an NEC value verified where Harrison/Codex read it in NFPA LiNK (2020 NFPA 70) on 2026-10-31 and relayed it; the app's author did not read the book and says so. Everything else is tagged S or R. Every row also has a "verified in my 2020 book" checkbox with a page field that only you can tick.
- It never predicts a pass. The AI content-validation record stays at 0/3 until real reviewed runs exist.
- The error log starts empty. Nothing is pre-filled and no session is pre-checked.

## How to open it

- **Single file (easiest):** open `nc-unlimited.html` in Chrome, Safari or Edge (double-click it, or File, Open File). No internet, install or account needed. Use a normal window: private or embedded windows can block storage, and the app then shows a red "Progress is not being saved" notice.
- **Zip:** unzip `nc-unlimited-app.zip` and open `index.html`.
- **Phone:** send the single file to yourself and open it in the browser (iPhone Files and Android Files work). Keep one device as the main one, since progress does not sync between devices; use Progress, Backup to move it.
- **GitHub Pages:** Pages serves only the `main` branch from `/docs`. This work is on an unmerged draft pull request, so no hosted link exists until it is merged and Pages is enabled (Settings, Pages, branch `main`, folder `/docs`). Then it would live at `https://harrisonmeeks1616.github.io/ponytail/nc-unlimited/`; confirm it loads before relying on it.

## Storage

Progress is saved in this browser (`localStorage`). **Progress, Backup** exports and restores a JSON file; use it before clearing site data or changing phones.

## Check

`node --test tests/nc-unlimited.test.js` runs 40 checks: the data counts (100 bank items, 37 sprint days, 37 packets, 60 cards, 15 scenarios), the 11-category blueprint, the sprint calendar (one session per day, Oct 31 to Dec 6; mocks on Nov 14, 21 and 28 only), the Eastern-time countdown, every worked example from the Notion guide, the business scenarios, the NEC table structure and lookups (anchored to your Notion worked examples), the error-log mastery rule, the Leitner boxes and the readiness gates.

## Known open items

- Board authorization start and expiry dates are not confirmed. Enter them on **Today** from your actual approval notice; the app never infers them.
- Which physical NASCLA edition you own is unconfirmed (the publisher's page lists the 14th).
- Limited license cap: the July 2026 handbook (p26) and G.S. 87-43.3(a)(1) say 1,000 V, the Board's licensing webpage says 600 V, and your instruction is to study 600 V. The app shows the discrepancy.
- Book lookups: 6 of 68 are resolved from NFPA LiNK readings relayed by Harrison/Codex (B02, D03, G02, O04, W01, W04), 6 more are partly resolved (G04, G05, G08, L08, L09, O07), and the rest are open. See `LOOKUPS.md`. Lookup items are never scored.
- Verified tables (relayed, read in NFPA LiNK): 250.66 copper rows, 250.122, 310.16 copper 14 to 500 kcmil, 310.15(B)(1) and (C)(1), 314.16(B), 430.52, 220.42, 240.6(A). The aluminum parts of 250.66 and 310.16, Chapter 9, 220.12 and the other groups in `LOOKUPS.md` are not verified.
- NFPA 72 (2013) and the NASCLA guide content have not been checked against the books.
- The author's own network could not reach ncbeec.org or any code-text site. Board facts come from Notion and the July 2026 handbook as read by Harrison/Codex.
