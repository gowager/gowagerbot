# GoWager

**Wager with friends. Play games. Win real money.**

GoWager is a Telegram Mini App and Web App platform for friendly wagers between friends. Players create games, set rules, deposit funds, and play real-time games like Rock Paper Scissors. The winner takes the pot minus a 5% GoWager middle-man fee.

## Project Structure

```
nb88/
├── backend/          # Node.js + Express + Socket.IO + PostgreSQL backend
│   ├── server.js     # Main server with API routes and real-time game logic
│   ├── db.js         # Database layer (PostgreSQL with in-memory fallback)
│   ├── package.json  # Backend dependencies
│   └── .env.example  # Environment variables template
├── webapp/           # Web App version (light theme, desktop/mobile friendly)
│   ├── index.html    # Web app UI
│   ├── style.css     # Web app styles
│   └── app.js        # Web app logic
├── telegram/         # Telegram Mini App version (dark theme, Telegram WebApp API)
│   ├── index.html    # Telegram mini app UI
│   ├── style.css     # Telegram mini app styles
│   └── app.js        # Telegram mini app logic
└── docs/             # Documentation
    ├── howto.md      # Step-by-step hosting guide for beginners
    ├── learnings.md  # Project learnings and insights
    ├── execution.md  # Execution plan and implementation details
    ├── version-control.md  # Version control guide
    └── interface.md  # API and interface documentation
```

## Features

- **Welcome Screen** - "Wager with Friends" and "How To Use App" buttons
- **Game Selection** - 5 game slots per page with Next/Back navigation (Rock Paper Scissors is the first game)
- **Create Game** - Set opponent Telegram ID, rounds (1-25), amount per round (1-50 GHS), time per round (30/45/60s), payout style, and resign rules
- **Join Game** - Enter a unique room code, review rules, agree, and deposit
- **Real-time Gameplay** - Socket.IO powered Rock Paper Scissors with round timers
- **Resign System** - Confirmation dialog, auto-resign after 2 missed rounds
- **5% House Fee** - Automatic calculation and distribution
- **Wallet System** - Balance tracking, deposits, winnings, and withdrawals
- **Anti-Hack Measures** - Server-authoritative logic, rate limiting, input validation, and secure room codes

## How Money Works

Each player deposits their **full stake** (rounds × amount per round) into escrow. The **total pot** is both players' stakes combined.

**Example**: 4 rounds x 2 GHS per round
- Your deposit (your stake): **8 GHS**
- Opponent's deposit: **8 GHS**
- **Total pot: 16 GHS**

**Winner Takes All**: Winner receives **15.20 GHS** (95% of pot), GoWager fee: **0.80 GHS** (5%)

**Winner Per Game / Resign Per Game**: Each completed game is settled individually (winner gets 95% of that game's stake, GoWager takes 5% per game played). Unplayed games are refunded in full.

> **Note**: New accounts start with 0 GHS balance. During local testing, use the demo endpoint to credit your wallet:
> `POST /api/demo/credit` with body `{ "userId": "...", "amount": 100 }`

## Quick Start

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env  # Add your DATABASE_URL from Neon.tech
npm start
```

The backend runs on `http://localhost:3001` and serves the web app at the root.

### 2. Web App

Open `http://localhost:3001` in a browser (served by the backend).

### 3. Telegram Mini App

1. Deploy the `telegram/` folder to a static host (Vercel, Netlify, etc.)
2. Create a bot with [@BotFather](https://t.me/BotFather)
3. Set the Mini App URL to your deployed `telegram/index.html`
4. Update `API_URL` in `telegram/app.js` to point to your backend

## Anti-Hack Measures

1. **Server-Authoritative Logic** - All game outcomes, scores, and payouts are computed on the server. Clients cannot manipulate results.
2. **Rate Limiting** - API endpoints are rate-limited to prevent abuse.
3. **Input Validation** - All game parameters are validated server-side (rounds 1-25, amounts 1-50 GHS, etc.).
4. **Secure Room Codes** - Cryptographically random 6-character room codes.
5. **Balance Checks** - Server verifies sufficient balance before any deposit or withdrawal.
6. **Socket Authentication** - Users must join game rooms with their user ID.
7. **Server-Enforced Timers** - Round timers are enforced server-side; clients cannot extend them.

## Documentation

- [Hosting Guide (howto.md)](docs/howto.md) - Step-by-step guide to deploy for free
- [Learnings (learnings.md)](docs/learnings.md) - Project insights
- [Execution Plan (execution.md)](docs/execution.md) - Implementation details
- [Version Control (version-control.md)](docs/version-control.md) - Git workflow
- [Interface Docs (interface.md)](docs/interface.md) - API reference

## License

This project is for educational and personal use. All wagers are between consenting friends.