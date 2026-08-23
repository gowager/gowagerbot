# Learnings

Lessons learned while building GoWager.

## Hosting & Deployment
- **Vercel does not work for this app.** The API is subfolder-based (`backend/`) and depends on Socket.IO (WebSockets), which needs a long-running server. Vercel's serverless functions killed the socket connections.
- **Render works**: deploy `backend/` as a Web Service, set the start command to `node server.js`. Frontends are static files served by Express itself, so one service hosts everything.
- `API_URL` is hardcoded in `webapp/app.js` and `telegram/app.js` — must be updated when moving between localhost and production.

## Git & GitHub
- A fresh repo with a clean single-commit history is easy to make: delete `.git`, `git init`, add a proper `.gitignore` (`node_modules/`, `.env`), commit once, force-push.
- Never commit `node_modules` — it makes pushes huge and slow. Install test-only deps with `npm install --no-save` so `package.json` stays untouched.
- CRLF/LF warnings on Windows are harmless; files still push correctly.

## Realtime / Socket.IO
- **Register event listeners BEFORE emitting**, not after. Waiting on an event that fires between your `emit()` and your `on()` registration silently times out. Pre-register promises for every expected event, then emit.
- Both players must be verified as *connected AND ready* before a paid game starts — otherwise a player who closed their tab gets dealt into a live game.
- When a returning player rejoins a room mid-game, always re-send fresh state (`state.game` + hand). Client-side snapshots go stale after disconnects.
- Emit role-scoped events separately: the dealer's private hand/picked card goes only to the dealer's socket, never broadcast to the room.

## Money & Game Rules
- **Confirm bet semantics early.** "Bet 1–20" was first built as *one stake per game*, then corrected to *per card* (20 cards × 2 GHS = 40 GHS deposit each, 80 GHS pot). Changing money models late touches validation, create/join endpoints, cancel refunds, rules screens, and deposit math — in both frontends.
- Single source of truth for pot math on the server: `stake = rounds × amount_per_round`, `pot = stake × 2`, winner receives `pot × 0.95`.
- Cancel/refund logic must mirror the exact deposit formula or it will over/under-refund.

## Testing
- The in-memory database resets on every server restart — user IDs change each run; never hardcode IDs across restarts.
- Rate limiting (10/min on game endpoints, 5/min on demo credit) breaks rapid test loops. Restart the server between test runs or space out calls.
- Print actual response bodies on failure — several "bugs" were wrong field names in the test script itself (`userId` vs `playerId`, `id` vs `telegram_id`).

## Frontend Patterns
- Two frontends (`webapp/` light, `telegram/` dark) share identical logic but different markup/classes — every feature must be implemented twice, kept in sync deliberately.
- Reuse existing screens where possible: the Join-by-room-code screen is shared by both games; only the rules content is game-aware.
- Back buttons need memory of where the user came from (`lastSelectedGame`) when a screen is reachable from two different flows.
