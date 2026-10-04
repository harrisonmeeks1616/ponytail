# Electrical PM Mastery

A 365-day, day-by-day program for a commercial electrical project manager working toward 20-year-veteran judgment, built from free and low-cost resources. One page, no build step, no accounts.

| File | What it is |
| --- | --- |
| `index.html` | The app: Today, Panel (all 365 days as breakers), Drill, Toolkit, Skills, Path, Library |
| `plan.js` | The curriculum (52 weeks in 5 phases, 104 check questions, 29 resources) and the calculators |

The Toolkit has nine calculators: labor productivity factor, WIP and over/under billing, change order pricing, voltage drop with an ampacity check, kVA and amps, measured mile, crew size, submit-by date, and break-even revenue. They are screening tools; the engineer of record and your contract govern.

## Put it online

Same GitHub Pages setup as the Schwab apps: repo **Settings → Pages**, **Deploy from a branch**, branch `main`, folder **`/docs`**. Once this is on `main`, the app is at `https://harrisonmeeks1616.github.io/ponytail/electrical-pm-mastery/`.

## Two copies, two kinds of storage

- **claude.ai copy** ([open it](https://claude.ai/artifact/7RceKcUWqncFnDy1Vdn2Vm)): progress syncs to your Claude account across devices, and the "Ask the 20-year master" coach works.
- **GitHub Pages copy, or the file opened directly:** progress stays in that browser and the coach is hidden.
- To move progress between them, use **Settings → Copy backup** in one and **Settings → Restore** in the other.

## Check

`node --test tests/electrical-pm-mastery.test.js` covers the curriculum (365 filled days, every resource resolves), the spaced-repetition schedule, and every calculator.
