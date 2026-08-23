# Design

Technical architecture of GoWager.

## Stack
- **Backend**: Node.js + Express + Socket.IO (`backend/server.js`, single entry point, port 3001).
- **Database**: PostgreSQL-style data layer in `backend/db.js` (in-memory for local dev; swap the module for a real Postgres pool in production — the API surface is already async).
- **Frontends**: vanilla HTML/CSS/JS. `webapp/` (light) and `telegram/` (dark, Telegram WebApp API). No build step.
- **Hosting**: Render web service running `node server.js`; Express serves both frontends statically and the API + WebSocket from the same origin.

## Directory Layout
```
nb88/
├── backend/
│   ├── server.js      # API routes, socket handlers, game engines
│   ├── db.js          # users, wallets, games, transactions
│   └── package.json
├── webapp/            # light-theme client (index.html, app.js, style.css)
├── telegram/          # dark-theme Telegram Mini App client
├── learnings.md / features.md / design.md
```

## Data Model
- **users**: `id` (internal `u_*`), `telegram_id` (unique login key), `username`, `tg_username`
- **wallets**: `user_id`, `balance`
- **games**: `id`, `room_code` (6 chars), `creator_id`, `opponent_id`, `game_type` (`rps` | `redblack`), `status` (`pending` → `ready` → `in_progress` → `completed` | `cancelled`), `rounds`, `amount_per_round`, `round_seconds`, `payout_style`, `resign_rule`, `is_free`, `pot`, `creator_role` (redblack only)
- **transactions**: `user_id`, `type` (deposit/game_deposit/payout/refund), `amount`, `status`

## Money Rules (single source of truth)
```
stake      = rounds × amount_per_round   // per player; redblack: rounds = cards
total_pot  = stake × 2                   // set when opponent joins
winner_pay = pot × 0.95                  // 5% platform fee
refund     = exact amount deposited
```

## API Routes
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/users` | register/login by telegramId |
| GET | `/api/users/:telegramId` | fetch user |
| GET | `/api/wallet/:userId` | balance |
| POST | `/api/games` | create game (+stake deduction, validation) |
| GET | `/api/games/room/:roomCode` | lookup for join flow |
| POST | `/api/games/:roomCode/join` | opponent deposits & locks game |
| GET | `/api/games/player/:userId/pending` | welcome-screen list |
| POST | `/api/games/:id/cancel` | delete pending game + refund |
| POST | `/api/demo/credit` | test-only faucet |

Rate limits: 20 req/min default per IP, 10/min on game creation/join, 5/min on demo credit.

## Socket.IO Protocol
Rooms: `game_<id>` per game; sockets tagged with `userId`.

**Lobby**: `player_ready` (both ready + connected → start), `lobby_update`, `game_started`, `game_cancelled`.

**RPS**: `rps_choice` → per-round `round_result` → `game_over`.

**Red or Black**:
| Event | Direction | Payload |
|---|---|---|
| `rb_round_started` | S→room | `{round, totalCards}` |
| `rb_your_hand` | S→dealer only | `{hand}` full private hand each round |
| `rb_wait_dealer` | S→player | disables guess buttons |
| `rb_dealer_pick` | C→S dealer | `{gameId, cardIndex}` |
| `rb_dealer_picked` | S→room | enables player guess |
| `rb_dealer_card` | S→dealer only | `{card}` face-up table card |
| `rb_player_guess` | C→S player | `{gameId, guess}` |
| `rb_round_result` | S→room | card, guess, scores, roundWinner |
| `game_over` | S→room | winner, final score, payout |

## Game Engines
- **Active games map**: `Map<gameId, {game, creatorSocket, opponentSocket, readyPlayers:Set, rb?}>`.
- **RPS**: choices stored per round; timeout = no choice; two consecutive timeouts triggers resignation settlement.
- **Red or Black**: `buildShoe()` = 4×52 shuffled with `crypto.randomInt`; `state.rb = {hand, pickedCard, scores}`; dealer's pick splices from hand server-side; loop until hand empty → `settleGame({reason:'completed'})`.

## Frontend Structure
Both clients are screen-div SPAs (`showScreen('screen-x')`) sharing logic patterns:
- `selectGame()` routes to a per-game options screen (Create / Join), remembering origin via `lastSelectedGame`.
- Join flow screens: room code → rules (rendered game-aware by `renderRulesContent`) → deposit → lobby → play.
- Live pot/deposit math recalculated on every input event.
- Telegram client mirrors all features with dark styling and `tg.HapticFeedback` touches.

## Security Notes
- Server validates every action against game state and role (only the dealer picks, only the invited opponent joins).
- Private information (dealer hand, picks) is emitted only to the owner's socket.
- Fee, stakes, and payouts computed only on the server.
- Demo credit endpoint must be removed before production launch.
