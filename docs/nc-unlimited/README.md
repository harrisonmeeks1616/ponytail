# NC Unlimited Exam Coach

Study, practice and readiness tracking for the North Carolina Unlimited Electrical Contractor exam (booked Monday, Dec 7, 2026, 10:00 AM ET, PSI Charlotte Tyvola). Built from the Harrison OS Notion plan under **NC Unlimited**. One static page, no build step, no accounts, works offline.

Exam reference set: **2020 NEC**, **2013 NFPA 72**, **NASCLA North Carolina Electrical 14th edition**. 100 questions, six hours, 70% to pass.

| File | What it is |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The app: Today, Plan, Practice, Law, Study, Tools, Progress, Exam day |
| `logic.js` | Pure logic: Eastern-time countdown, spaced repetition, readiness gates, calculators |
| `data-plan.js` | Exam facts, books and tab rules, the 47 dated sessions, your Oct 25 condensed calendar, gates |
| `data-study.js` | The 11 categories, article map, NFPA 72 chapter map, plan reading, worked examples, optional starter |
| `data-law.js` | 60 NC law and business recall cards, 15 worked scenarios |
| `data-bank.js` | The 100-item learning bank (32 keyed, 68 book-lookup) |
| `data-packets.js` | Practice packets from each of the 47 Notion session pages (212 questions) |

## What it will not do

- It never counts a book-lookup item as scored. You answer from the designated book, record the citation and grade yourself.
- It never counts an exposed form as a fresh mock. Readiness needs two fresh, unassisted, full 100-question mocks at 82%+ within six hours, no category below 70% on 15+ fresh questions.
- It never predicts a pass. The AI content-validation record stays at 0/3 until real reviewed runs exist.
- The error log starts empty. Nothing is pre-filled and no session is pre-checked.

## Put it online

Same GitHub Pages setup as the other apps: **Settings, Pages, Deploy from a branch**, branch `main`, folder `/docs`. Then it lives at `https://harrisonmeeks1616.github.io/ponytail/nc-unlimited/`.

## Storage

Progress is saved in this browser (`localStorage`). **Progress, Backup** exports and restores a JSON file; use it before clearing site data or changing phones.

## Check

`node --test tests/nc-unlimited.test.js` verifies the 100/100/47/60/15 data counts, the 11-category blueprint, the calendar (no gaps Oct 26 to Dec 7), the Eastern-time countdown, every worked example from the Notion guide, the business scenarios, the error-log mastery rule, the Leitner boxes and the readiness gates.

## Known open items

- Board authorization start and expiry are not in the Sept 10 email. Enter them on **Today**.
- Technical keys for the 68 lookup items need the designated books. Nothing here replaces them.
- ncbeec.org could not be reached when this was built, so nothing was re-verified against the primary source. Conflicts found on secondary sites are listed under **Plan, Open verifications** and **Exam day**.
