# 🔌 GoWager - Interface Documentation

This document describes all API endpoints, Socket.IO events, and data structures used by GoWager.

---

## 🌐 Base URL

**Local Development**: `http://localhost:3001`
**Production**: `https://your-backend-url.onrender.com`

---

## 📡 REST API Endpoints

### Health Check

**GET** `/api/health`

Returns service status.

**Response**:
```json
{
  "status": "ok",
  "service": "GoWager"
}
```

---

### Register / Login User

**POST** `/api/users`

Creates a new user or returns an existing one.

**Request Body**:
```json
{
  "telegramId": "123456789",
  "username": "John"
}
```

**Response**:
```json
{
  "user": {
    "id": "u_1234567890_abc123",
    "telegram_id": "123456789",
    "username": "John"
  },
  "wallet": {
    "user_id": "u_1234567890_abc123",
    "balance": "0.00"
  }
}
```

---

### Get User by Telegram ID

**GET** `/api/users/:telegramId`

**Response**:
```json
{
  "user": {
    "id": "u_1234567890_abc123",
    "telegram_id": "123456789",
    "username": "John"
  },
  "wallet": {
    "user_id": "u_1234567890_abc123",
    "balance": "25.00"
  }
}
```

---

### Get Wallet

**GET** `/api/wallet/:userId`

**Response**:
```json
{
  "user_id": "u_1234567890_abc123",
  "balance": "25.00"
}
```

---

### Create Game

**POST** `/api/games`

Creates a new game and deducts the creator's deposit (their full stake: rounds × amount per round).

**Request Body**:
```json
{
  "creatorId": "u_1234567890_abc123",
  "opponentTelegramId": "987654321",
  "rounds": 5,
  "amountPerRound": 1,
  "roundSeconds": 60,
  "payoutStyle": "winner_takes_all",
  "resignRule": "full_pot"
}
```

**Validation Rules**:
- `rounds`: 1-25 (integer)
- `amountPerRound`: 1-50 (integer, GHS)
- `roundSeconds`: 30, 45, or 60
- `payoutStyle`: `winner_takes_all` or `winner_per_game`
- `resignRule`: `full_pot` or `per_game`

**Response**:
```json
{
  "game": {
    "id": "g_1234567890_abc123",
    "room_code": "A1B2C3",
    "creator_id": "u_1234567890_abc123",
    "opponent_id": "u_9876543210_def456",
    "game_type": "rps",
    "rounds": 5,
    "amount_per_round": "1.00",
    "round_seconds": 60,
    "payout_style": "winner_takes_all",
    "resign_rule": "full_pot",
    "resign_definition": "2_games_in_a_row",
    "status": "pending",
    "current_round": 1,
    "creator_score": 0,
    "opponent_score": 0,
    "pot": "0.00"
  },
  "roomCode": "A1B2C3"
}
```

---

### Get Game by Room Code

**GET** `/api/games/room/:roomCode`

**Response**:
```json
{
  "id": "g_1234567890_abc123",
  "room_code": "A1B2C3",
  "creator_id": "u_1234567890_abc123",
  "opponent_id": "u_9876543210_def456",
  "game_type": "rps",
  "rounds": 5,
  "amount_per_round": "1.00",
  "round_seconds": 60,
  "payout_style": "winner_takes_all",
  "resign_rule": "full_pot",
  "resign_definition": "2_games_in_a_row",
  "status": "pending",
  "current_round": 1,
  "creator_score": 0,
  "opponent_score": 0,
  "pot": "0.00"
}
```

---

### Join Game (Second Player Deposits Full Stake)

**POST** `/api/games/:roomCode/join`

Deducts the second player's deposit (their full stake: rounds × amount per round) and marks the game ready.

**Request Body**:
```json
{
  "playerId": "u_9876543210_def456"
}
```

**Response**:
```json
{
  "game": {
    "id": "g_1234567890_abc123",
    "room_code": "A1B2C3",
    "status": "ready",
    "pot": "8.00"
  }
}
```

---

### Start Game

**POST** `/api/games/:roomCode/start`

Starts the game. Only the second player (opponent) can start.

**Request Body**:
```json
{
  "playerId": "u_9876543210_def456"
}
```

**Response**:
```json
{
  "game": {
    "id": "g_1234567890_abc123",
    "room_code": "A1B2C3",
    "status": "in_progress"
  }
}
```

---

### Withdraw

**POST** `/api/withdraw`

Requests a withdrawal from the player's wallet.

**Request Body**:
```json
{
  "userId": "u_1234567890_abc123",
  "amount": 10
}
```

**Response**:
```json
{
  "success": true,
  "transaction": {
    "id": "t_1234567890_abc123",
    "user_id": "u_1234567890_abc123",
    "type": "withdrawal",
    "amount": "10.00",
    "status": "pending"
  },
  "wallet": {
    "user_id": "u_1234567890_abc123",
    "balance": "15.00"
  }
}
```

---

### Get Transactions

**GET** `/api/transactions/:userId`

**Response**:
```json
[
  {
    "id": "t_1234567890_abc123",
    "user_id": "u_1234567890_abc123",
    "game_id": "g_1234567890_abc123",
    "type": "game_win",
    "amount": "4.75",
    "status": "completed"
  }
]
```

**Transaction Types**:
- `game_deposit` - Player deposited into a game (full stake: rounds × amount per round)
- `game_win` - Player won a game
- `game_refund` - Player got a refund (tie game)
- `withdrawal` - Player withdrew funds
- `demo_credit` - Demo-only fake money added for local testing

---

### Demo Credit (Local Testing Only)

**POST** `/api/demo/credit`

Credits a user's wallet with fake money. **Remove this endpoint in production.**

**Request Body**:
```json
{
  "userId": "u_1234567890_abc123",
  "amount": 100
}
```

**Response**:
```json
{
  "success": true,
  "wallet": {
    "user_id": "u_1234567890_abc123",
    "balance": "100.00"
  }
}
```

---

## 🔌 Socket.IO Events

### Client → Server

#### Join Game Room
```javascript
socket.emit('join_game_room', {
  gameId: 'g_1234567890_abc123',
  userId: 'u_1234567890_abc123'
});
```

#### Submit Choice
```javascript
socket.emit('submit_choice', {
  gameId: 'g_1234567890_abc123',
  choice: 'rock' // 'rock' | 'paper' | 'scissors'
});
```

#### Resign
```javascript
socket.emit('resign', {
  gameId: 'g_1234567890_abc123'
});
```

---

### Server → Client

#### Game State
```javascript
socket.on('game_state', (data) => {
  // data = {
  //   game: { ...game object },
  //   round: 1,
  //   deadline: 1234567890
  // }
});
```

#### Round Started
```javascript
socket.on('round_started', (data) => {
  // data = {
  //   round: 2,
  //   deadline: 1234567890,
  //   seconds: 60
  // }
});
```

#### Round Result
```javascript
socket.on('round_result', (data) => {
  // data = {
  //   round: 1,
  //   creatorChoice: 'rock',
  //   opponentChoice: 'scissors',
  //   roundWinner: 'u_1234567890_abc123', // or 'tie'
  //   creatorScore: 1,
  //   opponentScore: 0
  // }
});
```

#### Game Over
```javascript
socket.on('game_over', (data) => {
  // data = {
  //   game: { ...game object },
  //   winnerId: 'u_1234567890_abc123',
  //   winnerAmount: 4.75,
  //   fee: 0.25,
  //   reason: 'completed' | 'resignation' | 'auto_resign_timeout',
  //   tie: false
  // }
});
```

#### Choice Confirmed
```javascript
socket.on('choice_confirmed', (data) => {
  // data = { choice: 'rock' }
});
```

#### Player Joined
```javascript
socket.on('player_joined', (data) => {
  // data = { userId: 'u_9876543210_def456' }
});
```

#### Timeout Warning
```javascript
socket.on('timeout_warning', (data) => {
  // data = {
  //   missing: ['u_9876543210_def456'],
  //   missedCounts: { 'u_9876543210_def456': 1 }
  // }
});
```

#### Error
```javascript
socket.on('error', (message) => {
  // message = "Insufficient balance"
});
```

---

## 💾 Data Models

### User
```javascript
{
  id: 'u_1234567890_abc123',
  telegram_id: '123456789',
  username: 'John',
  created_at: '2026-01-01T00:00:00.000Z'
}
```

### Wallet
```javascript
{
  user_id: 'u_1234567890_abc123',
  balance: '25.00',
  updated_at: '2026-01-01T00:00:00.000Z'
}
```

### Game
```javascript
{
  id: 'g_1234567890_abc123',
  room_code: 'A1B2C3',
  creator_id: 'u_1234567890_abc123',
  opponent_id: 'u_9876543210_def456',
  game_type: 'rps',
  rounds: 5,
  amount_per_round: '1.00',
  round_seconds: 60,
  payout_style: 'winner_takes_all',
  resign_rule: 'full_pot',
  resign_definition: '2_games_in_a_row',
  status: 'pending', // 'pending' | 'ready' | 'in_progress' | 'completed'
  current_round: 1,
  creator_score: 0,
  opponent_score: 0,
  pot: '10.00',
  created_at: '2026-01-01T00:00:00.000Z'
}
```

### Transaction
```javascript
{
  id: 't_1234567890_abc123',
  user_id: 'u_1234567890_abc123',
  game_id: 'g_1234567890_abc123',
  type: 'game_win',
  amount: '9.50',
  status: 'completed', // 'pending' | 'completed'
  created_at: '2026-01-01T00:00:00.000Z'
}
```

---

## 🎮 Game States

| State | Description |
|-------|-------------|
| `pending` | Game created, waiting for opponent to join |
| `ready` | Both players deposited, ready to start |
| `in_progress` | Game is being played |
| `completed` | Game finished, payouts distributed |

---

## 💰 Payout Rules

> **Deposit model**: Each player deposits their **full stake** (rounds × amount per round) into escrow. **Total pot** = both players' stakes combined.

### Winner Takes All
- Winner gets: `pot × 0.95`
- GoWager fee: `pot × 0.05`

### Winner Per Game / Resign Per Game
- Each completed game is settled individually (winner gets 95% of that game's stake, GoWager takes 5% per game played). Unplayed games are refunded in full.

### Resign - Full Pot
- Winner gets: `pot × 0.95`
- GoWager fee: `pot × 0.05`

### Resign - Per Game
- Winner gets: `(pot / games) × games_played × 0.95`
- GoWager fee: `pot - winner_amount`

### Tie Game
- Each player gets: `(pot / 2) × 0.95`
- GoWager fee: `pot × 0.05`

---

## 🔒 Error Codes

| HTTP Status | Error | Description |
|-------------|-------|-------------|
| 400 | `Invalid telegram ID` | Missing or invalid telegram ID |
| 400 | `Rounds must be 1-25` | Invalid rounds value |
| 400 | `Amount must be 1-50 GHS` | Invalid amount value |
| 400 | `Round seconds must be 30, 45, or 60` | Invalid time value |
| 400 | `Invalid payout style` | Invalid payout style |
| 400 | `Invalid resign rule` | Invalid resign rule |
| 400 | `Insufficient balance` | Not enough funds |
| 400 | `Cannot play against yourself` | Same player as opponent |
| 403 | `You are not the invited opponent` | Wrong player trying to join |
| 404 | `User not found` | User doesn't exist |
| 404 | `Game not found` | Room code doesn't exist |
| 429 | `Too many requests` | Rate limit exceeded |
| 500 | `Internal server error` | Server error |

</final_file_content>

IMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference. This content reflects the current state of the file, including any auto-formatting (e.g., if you used single quotes but the formatter converted them to double quotes). Always base your SEARCH/REPLACE operations on this final version to ensure accuracy.</environment_details>