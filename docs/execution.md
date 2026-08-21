# ⚡ GoWager - Execution Plan

This document outlines the execution plan, implementation details, and technical decisions for GoWager.

---

## 🎯 Project Overview

**Goal**: Build a Telegram Mini App and Web App for wagers between friends.

**Name**: GoWager

**Core Features**:
1. Welcome screen with "Wager with Friends" and "How To Use App"
2. Game selection (5 games per page, Rock Paper Scissors first)
3. Create game with rules configuration
4. Join game with room code
5. Real-time Rock Paper Scissors gameplay
6. Resign system with confirmation
7. 5% house fee on winnings
8. Wallet system with withdrawals
9. Anti-hack measures

---

## 📋 Execution Phases

### Phase 1: Backend Foundation ✅
- [x] Set up Express server
- [x] Set up Socket.IO for real-time
- [x] Set up PostgreSQL database layer
- [x] Add in-memory fallback for development
- [x] Create user registration endpoint
- [x] Create wallet system
- [x] Create game creation endpoint
- [x] Create game joining endpoint
- [x] Create withdrawal endpoint
- [x] Add rate limiting
- [x] Add input validation

### Phase 2: Web App ✅
- [x] Welcome screen
- [x] How To Use screen
- [x] Game selection screen (5 slots, Next/Back)
- [x] Create game form
- [x] Room code display
- [x] Join game flow
- [x] Game rules review
- [x] Deposit flow
- [x] Game lobby
- [x] Real-time gameplay
- [x] Game over summary
- [x] Wallet screen

### Phase 3: Telegram Mini App ✅
- [x] Telegram WebApp API integration
- [x] Dark theme design
- [x] Welcome screen
- [x] How To Use screen
- [x] Game selection
- [x] Create game with steppers
- [x] Join game flow
- [x] Real-time gameplay
- [x] Wallet screen
- [x] Haptic feedback

### Phase 4: Documentation ✅
- [x] README.md
- [x] docs/howto.md (hosting guide)
- [x] docs/learnings.md
- [x] docs/execution.md
- [x] docs/version-control.md
- [x] docs/interface.md

---

## 🏗️ Technical Architecture

### Backend Stack
```
Node.js + Express + Socket.IO + PostgreSQL
```

### Frontend Stack
```
HTML + CSS + Vanilla JavaScript + Socket.IO Client
```

### Database Schema

```sql
-- Users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  telegram_id TEXT UNIQUE,
  username TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Wallets table
CREATE TABLE wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  balance NUMERIC(12,2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Games table
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  room_code TEXT UNIQUE,
  creator_id TEXT REFERENCES users(id),
  opponent_id TEXT,
  game_type TEXT DEFAULT 'rps',
  rounds INTEGER,
  amount_per_round NUMERIC(12,2),
  round_seconds INTEGER,
  payout_style TEXT,
  resign_rule TEXT,
  resign_definition TEXT,
  status TEXT DEFAULT 'pending',
  current_round INTEGER DEFAULT 1,
  creator_score INTEGER DEFAULT 0,
  opponent_score INTEGER DEFAULT 0,
  pot NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Transactions table
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  game_id TEXT,
  type TEXT,
  amount NUMERIC(12,2),
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🔄 Game Flow

### Create Game Flow
1. Player 1 opens app → Welcome screen
2. Clicks "Wager with Friends" → Game selection
3. Selects Rock Paper Scissors → Create/Join options
4. Clicks "Create Game" → Create game form
5. Enters opponent's Telegram ID
6. Sets rounds (1-25), amount (1-50 GHS), time (30/45/60s)
7. Sets payout style and resign rules
8. Clicks "Create & Deposit"
9. Server validates and deducts deposit
10. Server generates unique room code
11. Player 1 shares room code with Player 2

### Join Game Flow
1. Player 2 opens app → Welcome screen
2. Clicks "Wager with Friends" → Game selection
3. Selects Rock Paper Scissors → Create/Join options
4. Clicks "Join Game" → Enter room code
5. Server fetches game details
6. Player 2 reviews rules → "I Agree"
7. Player 2 deposits their share
8. Player 2 clicks "Start Game"
9. Game begins

### Gameplay Flow
1. Server starts round timer
2. Both players choose Rock/Paper/Scissors
3. Server resolves round
4. Results broadcast to both players
5. Next round starts
6. Game continues until all rounds complete
7. Server calculates winner and payouts
8. Game over summary shown

### Resign Flow
1. Player clicks "Resign"
2. Confirmation dialog: "Are you sure you want to quit?"
3. If Yes:
   - Server determines winner based on resign rule
   - Full pot → winner gets 95% of pot
   - Per game → winner gets paid for games played
4. Game over summary shown

### Auto-Resign Flow
1. Player doesn't choose for 2 rounds in a row
2. Server automatically marks them as resigned
3. Other player wins based on resign rule

---

## 💰 Payout Calculations

> **Deposit model**: Each player deposits their **full stake** (rounds × amount per round) into escrow.
> **Total Pot** = both players' stakes combined = 2 × (rounds × amount per round).

### Winner Takes All
```
Your Stake = rounds × amount_per_round
Total Pot = Your Stake × 2
Winner Gets = Total Pot × 0.95
GoWager Fee = Total Pot × 0.05
```

### Winner Per Game / Resign Per Game
```
Each completed game is settled individually:
  Game Stake = 2 × amount_per_round
  Game Winner Gets = Game Stake × 0.95
  GoWager Fee per Game = Game Stake × 0.05
Unplayed games are refunded in full.
```

### Resign - Full Pot
```
Winner Gets = Total Pot × 0.95
GoWager Fee = Total Pot × 0.05
```

### Resign - Per Game
```
Games Played = current_round - 1
Each completed game settled individually (winner gets 95% of that game's stake)
Unplayed games refunded in full
GoWager Fee = Games Played × (2 × amount_per_round) × 0.05
```

### Tie Game
```
Refund Each = (Total Pot / 2) × 0.95
GoWager Fee = Total Pot × 0.05
```

### Worked Example (4 rounds × 2 GHS)
```
Your Stake = 4 × 2 = 8 GHS
Opponent's Stake = 8 GHS
Total Pot = 16 GHS
Winner (winner-takes-all) receives = 16 × 0.95 = 15.20 GHS
GoWager fee = 16 × 0.05 = 0.80 GHS
```

---

## 🛡️ Anti-Hack Measures

### Implemented
1. **Server-Authoritative Logic** - All game outcomes computed server-side
2. **Rate Limiting** - Per-IP request limits
3. **Input Validation** - All parameters validated server-side
4. **Balance Checks** - `WHERE balance >= amount` prevents overdrafts
5. **Secure Room Codes** - Cryptographically random
6. **Socket Authentication** - User ID required to join game rooms
7. **Server-Enforced Timers** - Clients cannot extend round time

### Future Enhancements
1. **Hash Commitment** - Players send SHA-256 hash of choice first, reveal later
2. **JWT Authentication** - Replace simple user IDs with signed tokens
3. **HTTPS Enforcement** - All traffic encrypted
4. **Audit Logs** - Track all game actions
5. **IP Blocking** - Block known malicious IPs

---

## 📁 File Structure

```
nb88/
├── backend/
│   ├── server.js         # Main server (API + Socket.IO + game logic)
│   ├── db.js             # Database layer
│   ├── package.json      # Dependencies
│   └── .env.example      # Environment template
├── webapp/
│   ├── index.html        # Web app UI
│   ├── style.css         # Web app styles
│   └── app.js            # Web app logic
├── telegram/
│   ├── index.html        # Telegram mini app UI
│   ├── style.css         # Telegram mini app styles
│   └── app.js            # Telegram mini app logic
├── docs/
│   ├── howto.md          # Hosting guide
│   ├── learnings.md      # Project learnings
│   ├── execution.md      # This file
│   ├── version-control.md # Git guide
│   └── interface.md      # API reference
└── README.md             # Project overview
```

---

## 🚀 Deployment Checklist

### Backend (Render)
- [ ] Create Render account
- [ ] Connect GitHub repository
- [ ] Set environment variables (DATABASE_URL, PORT)
- [ ] Deploy and verify health endpoint

### Database (Neon.tech)
- [ ] Create Neon.tech account
- [ ] Create project
- [ ] Copy connection string
- [ ] Add to Render environment variables

### Web App (Vercel)
- [ ] Create Vercel account
- [ ] Deploy webapp folder
- [ ] Update API_URL in app.js
- [ ] Verify CORS settings

### Telegram Mini App (Vercel)
- [ ] Deploy telegram folder
- [ ] Update API_URL in app.js
- [ ] Create bot with BotFather
- [ ] Set Web App URL
- [ ] Test in Telegram

---

## 📈 Success Metrics

- **User Adoption**: Number of active players
- **Game Volume**: Games created per day
- **Retention**: Players returning after first game
- **Revenue**: House fee collected
- **Reliability**: Uptime and error rates
- **Security**: No successful hacks or exploits