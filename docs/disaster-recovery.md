# GoWager Disaster Recovery & Bot Failover

GoWager stores money balances in the database. All of the following steps assume
the backend is running against a **Postgres** database (`DATABASE_URL`).

> Check which mode the live backend is using: open
> `https://gowager-backend.onrender.com/api/health` and look at the `db` field.
> - `"db":"postgres"` → balances are durable and safe.
> - `"db":"memory"` → **everything resets on every restart/deploy**. Fix before
>   accepting real money. See "Switch to Postgres" below.

## Why bot bans don't lose money

- Player balances live in Postgres, keyed by the player's **Telegram user ID**
  (`telegram_id`, their account ID — the same across every bot).
- The GoWager backend is **bot-agnostic**: it never uses a Bot token and never
  calls the Bot API. It only serves `telegram_id` strings from Mini App initData.
- If Telegram bans/delists a bot, the backend, webapp, the database, and the
  Paystack integration all keep working. Only that bot's Mini App entry point
  disappears.

## Switch to Postgres (do this once, before real money)

1. Create a free Postgres at https://neon.tech (or any Postgres provider).
2. Copy the connection string that ends in `?sslmode=require`.
3. On Render → your backend service → **Environment**:
   - `DATABASE_URL` = the Neon connection string
   - `ENFORCE_DATABASE=1` (server refuses to boot without Postgres)
   - `ADMIN_PASSCODE` = a secret passcode
4. Deploy. The backend creates all tables automatically on boot.

## Back up the database (do daily)

On your machine with the repo:

1. `cp backend/.env.example backend/.env` and set `DATABASE_URL` to the real one.
2. `npm install` inside `backend/`.
3. `npm run db:backup` → writes `backup-<timestamp>.json` (users, wallets,
   transactions, withdrawal requests, games).
4. Store the `.json` somewhere safe (cloud drive). It contains personal data.

Test that a restore works before you need it:
`npm run db:restore -- some-backup.json --dry-run`

## If Telegram takes down your bot — spin up a new bot

The money and player data are untouched. You only replace the frontdoor:

1. **Create a new bot**: BotFather → `/newbot` → get the new token.
2. **Create the Mini App for the new bot** using the existing webapp URL:
   - BotFather → `/newapp` (or `/mybots` → your new bot → Mini App settings).
   - The Mini App URL can be the **same** hosted URL you already deploy
     (static webapp + telegram Mini App), or a fresh one — the code is identical.
3. **No database work is needed.** The new bot's players hit the same backend
   and the same Postgres, so wallets and history carry over automatically.
4. If you deploy a fresh copy of the frontends, make sure `API_URL` in
   `webapp/app.js` and `telegram/app.js` still points at your Render backend
   (`https://gowager-backend.onrender.com`). It does by default.
5. Update your bot's commands/menu if needed. That's it.

## Moving to a brand-new backend (whole new Render account)

1. Create the new Render service (root = repo, build `npm install`, start
   `npm start`, working dir = `backend`).
2. Set env vars as in "Switch to Postgres" — reuse the **same** Neon
   `DATABASE_URL` to keep all balances, or point a **new** database at it after
   restoring a backup: `npm run db:restore -- backup-<timestamp>.json`.
3. If using a new database, register the Paystack webhook URL at your new
   backend domain and re-verify deposits.
4. Update `API_URL` in both frontends to the new backend URL and redeploy.

## Quick checklist every day

- [ ] `https://gowager-backend.onrender.com/api/health` → `"db":"postgres"`
- [ ] A recent `backup-<timestamp>.json` exists off-machine
- [ ] Test restore dry-run occasionally
- [ ] Paystack webhook registered for the current backend URL