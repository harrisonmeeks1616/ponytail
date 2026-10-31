# Phone test batch (real iPhone)

These are the only acceptance checks that cannot be done from the cloud build. Do them in one sitting (about 25 minutes) after the deploy in `docs/DEPLOY.md`. Record each result in ACCEPTANCE.md as pass, fail or not tested, with the time, iOS version and what you saw. Desktop results never count for these.

## Tonight, before 2:00 AM EDT (DST ends November 1, 2026)

**P0 DST baseline (A10).** Create a daily reminder for 8:00 AM, titled "DST check". Lock the phone. Tomorrow, note whether the alert arrived at 8:00 AM EST (wall clock) and not at 7:00 or 9:00. If you miss tonight, the deterministic DST tests still stand; only the real-device observation for this transition is lost.

## Batch

1. **Install (A21).** In Safari, open the Worker URL, sign in through Access, then Share > Add to Home Screen. Open the app from the Home Screen icon. Check: no horizontal scrolling, nothing hidden under the notch or home bar, readable with Larger Text on.
2. **Capture online (A1).** Capture "Test 1 order 3 filters" in Work. Time from tapping Save to "Saved". Review it, then check that one task appears.
3. **Offline capture (A2).** Turn on Airplane Mode. Capture "Test 2 offline", then fully close the app (swipe it away). Reopen it: the capture should be listed under "On this phone". Turn off Airplane Mode: it should sync once. Search Memory for "Test 2": exactly one capture.
4. **Session expiry (A3).** In Access, revoke this app's session for your user (Zero Trust > My Team > Users > your user > Revoke, for the Harrison OS app only, not every app). Capture "Test 3 after expiry" in the app: it should say "Sign in again" and keep the capture. Sign in again: it syncs, and other apps' sessions are unaffected.
5. **Alerts (A9).** Memory > Turn on alerts > Allow. Create a reminder 3 minutes ahead. Lock the phone and set it face down. Record whether the alert appears on the Lock Screen, the delay, and the text shown.
6. **Notification tap after expiry (A11).** Create another reminder 3 minutes ahead. While waiting, revoke the session again (step 4). When the alert arrives, tap it: the app should open and keep the acknowledgement pending. Sign in: the acknowledgement is sent once (Memory shows the delivery acknowledged).
7. **Denied permission (A9).** In Settings > Notifications > Harrison OS, turn off Allow Notifications. Open the app: it should say alerts are off on this phone. The reminder stays scheduled and is not silently removed.
8. **Accessibility (A21).** Turn on VoiceOver and move through Today, Capture and Memory: every control is announced with a name. Turn on Reduce Motion: completing a task shows no animation.
9. **Shortcut (optional).** Follow `docs/SHORTCUT.md`. Run the Shortcut online once and offline once. It needs a connection: offline it should fail visibly, not pretend to save.

## Not covered by this batch

- The two-week pilot (adoption, correction burden, missed follow-ups) is later validation.
- AI, calendar and PM live checks need their credentials or authorization (see ACCEPTANCE.md A14, A15).
