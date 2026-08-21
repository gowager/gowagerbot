# 📚 GoWager - Learnings

This document captures the key learnings, decisions, and insights from building GoWager.

---

## 🏗️ Architecture Learnings

### 1. Server-Authoritative Design
**Learning**: Never trust the client. All game logic, scoring, and payouts must be computed on the server.

**Implementation**:
- Game outcomes are determined server-side
- Scores are stored in the database, not the client
- The 5% house fee is calculated on the server
- Clients only send their choices; the server decides the result

### 2. Real-Time Communication
**Learning**: Socket.IO is the right choice for real-time games.

**Why**:
- WebSockets provide low-latency bidirectional communication
- Socket.IO handles reconnection automatically
- Room-based broadcasting makes it easy to send events to both players

**Implementation**:
- Players join a room named `game_{gameId}`
- Round results are broadcast to the room
- Timer events are pushed from the server

### 3. Database Design
**Learning**: A simple relational schema is sufficient for this use case.

**Tables**:
- `users` - Player accounts
- `wallets` - Player balances
- `games` - Game records with all rules
- `transactions` - Money movement history

**Key insight**: Using `NUMERIC(12,2)` for money avoids floating-point errors.

### 4. In-Memory Fallback
**Learning**: Having a fallback database mode makes development and testing much easier.

**Implementation**: If `DATABASE_URL` is not set, the app uses in-memory Maps. This lets you test without setting up a database.

---

## 🎮 Game Design Learnings

### 1. Room Codes
**Learning**: Short, human-readable room codes are better than long UUIDs for sharing between friends.

**Implementation**: 6-character hex codes (e.g., `A1B2C3`) generated with `crypto.randomBytes()`.

### 2. Round Timers
**Learning**: Timers must be server-enforced to prevent cheating.

**Implementation**:
- Server sets a deadline timestamp
- Clients display a countdown
- If a player doesn't choose in time, a random choice is assigned
- Missing 2 rounds in a row = auto-resign

### 3. Payout Logic
**Learning**: The payout calculation depends on multiple rules that must be clearly defined.

**Rules**:
- **Winner Takes All**: Winner gets 95% of the pot (5% fee)
- **Winner Per Game**: Each round won pays out proportionally
- **Resign - Full Pot**: If someone resigns, opponent gets 95% of pot
- **Resign - Per Game**: If someone resigns, opponent gets paid for games played

### 4. House Fee & Full-Stake Deposits
**Learning**: A 5% fee is simple to implement and understand. Each player deposits their **full stake** (rounds × amount per round) into escrow. The total pot is both players' stakes combined.

**Example**: 4 rounds × 2 GHS per round
- Your deposit (your stake): **8 GHS**
- Opponent's deposit: **8 GHS**
- **Total pot: 16 GHS**

**Winner Takes All**: Winner receives **15.20 GHS** (95% of pot), GoWager fee: **0.80 GHS** (5%)

**Winner Per Game / Resign Per Game**: Each completed game is settled individually (winner gets 95% of that game's stake, GoWager takes 5% per game played). Unplayed games are refunded in full.

---

## 🛡️ Anti-Hack Learnings

### 1. Rate Limiting
**Learning**: Simple in-memory rate limiting prevents basic abuse.

**Implementation**: A Map tracking request counts per IP with a sliding window.

### 2. Input Validation
**Learning**: All inputs must be validated on the server, not just the client.

**Validations**:
- Rounds: 1-25 (integer)
- Amount: 1-50 GHS (integer)
- Round seconds: 30, 45, or 60
- Payout style: winner_takes_all or winner_per_game
- Resign rule: full_pot or per_game

### 3. Balance Verification
**Learning**: Always check balance before deducting funds.

**Implementation**: The `deductFunds` function uses `WHERE balance >= amount` to prevent negative balances.

### 4. Socket Authentication
**Learning**: Socket connections need to be tied to user identities.

**Implementation**: Users must emit `join_game_room` with their user ID before participating.

---

## 🚀 Deployment Learnings

### 1. Free Tier Limitations
**Learning**: Free tiers have significant limitations.

**Render**:
- Sleeps after 15 minutes of inactivity
- First request after sleep takes ~30 seconds
- 750 hours/month limit

**Vercel**:
- Great for static sites
- Serverless functions have cold starts
- 100GB bandwidth/month

**Neon.tech**:
- 0.5GB storage
- 190 compute hours/month
- Connection pooling recommended

### 2. CORS Configuration
**Learning**: CORS must be explicitly configured for production.

**Implementation**: Allow specific origins (your Vercel domains) rather than `*`.

### 3. Environment Variables
**Learning**: Never hardcode secrets in code.

**Implementation**: Use `.env` files locally and environment variables in production.

---

## 💡 Future Improvements

1. **More Games** - Add more games to the 5 slots per page
2. **Payment Integration** - Integrate with mobile money (MTN MoMo, Vodafone Cash) for real deposits
3. **Redis** - Use Redis for shared game state if scaling to multiple server instances
4. **Webhook Notifications** - Notify players via Telegram bot when it's their turn
5. **Game History** - Show past games and statistics
6. **Leaderboards** - Track wins/losses per player
7. **Anti-Cheat Enhancements** - Add hash-commitment scheme for choices to prevent peeking
8. **Multi-language Support** - Add French, Twi, and other languages

---

## 🐛 Common Issues & Solutions

### Issue: Game state lost on server restart
**Solution**: Store game state in the database, not just in memory. The current implementation stores game data in the DB but active round state is in memory.

### Issue: Socket disconnections during gameplay
**Solution**: Implement reconnection logic. When a player reconnects, they should re-join the game room and receive the current state.

### Issue: Floating point money errors
**Solution**: Use `NUMERIC(12,2)` in PostgreSQL and `Number()` conversions carefully in JavaScript.

### Issue: Timezone issues with timers
**Solution**: Use `Date.now()` (UTC) for all timestamps and deadlines, not local time.

---

## 📊 Key Metrics to Track

- Number of games created per day
- Average game duration
- Win/loss ratios
- Deposit/withdrawal volumes
- House fee revenue
- User retention (returning players)