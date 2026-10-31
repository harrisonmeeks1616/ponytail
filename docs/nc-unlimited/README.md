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
| `data-nec.js` | NEC 2020 / NFPA 72 (2013) quick reference: tables and rules, each tagged S (sources agreed) or R (recalled) and **not verified** |

## What it will not do

- It never counts a book-lookup item as scored. You answer from the designated book, record the citation and grade yourself.
- It never counts an exposed form as a fresh mock. Readiness needs two fresh, unassisted, full 100-question mocks at 82%+ within six hours, no category below 70% on 15+ fresh questions.
- It never presents an NEC value as verified. Every row in the NEC reference has a confidence tag and a "verified in my 2020 book" checkbox with a page field; nothing counts until you tick it.
- It never predicts a pass. The AI content-validation record stays at 0/3 until real reviewed runs exist.
- The error log starts empty. Nothing is pre-filled and no session is pre-checked.

## Put it online

Same GitHub Pages setup as the other apps: **Settings, Pages, Deploy from a branch**, branch `main`, folder `/docs`. Then it lives at `https://harrisonmeeks1616.github.io/ponytail/nc-unlimited/`.

## Storage

Progress is saved in this browser (`localStorage`). **Progress, Backup** exports and restores a JSON file; use it before clearing site data or changing phones.

## Check

`node --test tests/nc-unlimited.test.js` verifies the data counts (100 bank items, 37 sprint days, 37 packets, 60 cards, 15 scenarios), the 11-category blueprint, the sprint calendar (one session per day, Oct 31 to Dec 6; mocks on Nov 14, 21 and 28 only), the Eastern-time countdown, every worked example from the Notion guide, the business scenarios, the NEC table structure and lookups (anchored to your Notion worked examples), the error-log mastery rule, the Leitner boxes and the readiness gates.

## Known open items

- Board authorization start and expiry are not in the Sept 10 email. Enter them on **Today**.
- Technical keys for the 68 lookup items need the designated books. Nothing here replaces them.
- ncbeec.org and every code-text site were unreachable when this was built, so no NEC or Board value was read in a primary source. The NEC reference was cross-checked only against search-engine summaries. Conflicts found on secondary sites are listed under **Plan, Open verifications** and **Exam day**.
