# RVU Tracker — Spencer edition

A web app for tracking clinic productivity (CPT codes and RVUs), note completion, and Medical Director / APD hours.

**Open it:** https://shawnjspencer.github.io/RVU-tracker/ — on iPhone/iPad, tap Share → *Add to Home Screen*.

This repo holds only the app's code. All of your data lives in the private `RVU-tracker-data` repo, which the app reads and writes with a personal access token saved on each device (Settings → Sync).

Files: `index.html` (shell), `app.js` (UI), `core.js` (schedule, billing and summary logic — also used by the Friday email job), `fx.js` (celebrations), `styles.css` (themes), `sw.js` (offline support).
