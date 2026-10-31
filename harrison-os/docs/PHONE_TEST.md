# Phone test batch (real iPhone)

These are the only acceptance checks that cannot be done from the cloud build. Do them in one sitting (about 25 minutes) after the deploy in `docs/DEPLOY.md`. Record each result in ACCEPTANCE.md as pass, fail or not tested, with the time, iOS version and what you saw. Desktop results never count for these.

## Tonight, before 2:00 AM EDT (DST ends November 1, 2026)

**P0 DST across the transition (A10).** Create one daily reminder for **11:00 PM**, titled "DST check", before 10:55 PM tonight. It fires once before the change (Saturday 11:00 PM EDT) and once after (Sunday 11:00 PM EST), so the same recurrence is observed on both sides. Record both arrival times by the wall clock; a pass is 11:00 PM both nights, not 10:00 or midnight. If you can only create it after 11:00 PM tonight, its first firing is Sunday: label that result "post-transition first fire only", not a cross-transition pass. The deterministic DST tests in `tests/time.test.mjs` are separate evidence and never stand in for this observation; nothing is recorded until it is actually seen.

## Batch

1. **Install (A21).** In Safari, open the Worker URL, sign in through Access, then Share > Add to Home Screen. Open the app from the Home Screen icon. Check: no horizontal scrolling, nothing hidden under the notch or home bar, readable with Larger Text on.
2. **Capture online (A1).** Capture "Test 1 order 3 filters" in Work. Time from tapping Save to "Saved". Review it, then check that one task appears.
3. **Offline capture (A2).** Turn on Airplane Mode. Capture "Test 2 offline", then fully close the app (swipe it away). Reopen it: the capture should be listed under "On this phone". Turn off Airplane Mode: it should sync once. Search Memory for "Test 2": exactly one capture.
4. **Session expiry (A3), app only.** Do **not** revoke from the user list (Zero Trust > My Team > Users): that ends your sessions for every Access application, including the PM and Field Hub apps. Instead, end only Harrison OS's session: in Access > Applications, open the Harrison OS application and set its session duration to the shortest value (15 minutes), then wait it out. An application-level "revoke existing tokens" control may exist on that application's own page; use it only if it is clearly scoped to that one application. This path could not be checked against Cloudflare's current documentation from the build session (their docs host was not reachable), so confirm the wording on screen before clicking. When the session has expired, capture "Test 3 after expiry": the app should say "Sign in again" and keep the capture. Sign in again: it syncs. Check that one other Access app is still signed in. Restore the normal session duration afterwards.
5. **Alerts (A9).** Memory > Turn on alerts > Allow. Create a reminder 3 minutes ahead. Lock the phone and set it face down. Record whether the alert appears on the Lock Screen, the delay, and the text shown.
6. **Notification tap after expiry (A11).** Create another reminder 3 minutes ahead. Before creating it, set the Harrison OS app's session duration short again (step 4, app only), so the session has expired when the alert arrives. When the alert arrives, tap it: the app should open and keep the acknowledgement pending. Sign in: the acknowledgement is sent once (Memory shows the delivery acknowledged).
7. **Denied permission (A9).** In Settings > Notifications > Harrison OS, turn off Allow Notifications. Open the app: it should say alerts are off on this phone. The reminder stays scheduled and is not silently removed.
8. **Accessibility (A21).** Turn on VoiceOver and move through Today, Capture and Memory: every control is announced with a name. Turn on Reduce Motion: completing a task shows no animation.
9. **Shortcut (optional).** Follow `docs/SHORTCUT.md`. Run the Shortcut online once and offline once. It needs a connection: offline it should fail visibly, not pretend to save.

## Not covered by this batch

- The two-week pilot (adoption, correction burden, missed follow-ups) is later validation.
- AI, calendar and PM live checks need their credentials or authorization (see ACCEPTANCE.md A14, A15).
