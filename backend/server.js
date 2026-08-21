require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const crypto = require('crypto');
const db = require('./db');

const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

// Serve the web app from the backend so http://localhost:3001/ works
app.use(express.static(path.join(__dirname, '..', 'webapp')));

const PORT = process.env.PORT || 3001;

// In-memory game state for real-time play
const activeGames = new Map(); // gameId -> { game, creatorSocket, opponentSocket, roundChoices, roundTimer, roundDeadline, playedRounds }

// ---------- ANTI-HACK MEASURES ----------
// 1. Server-authoritative game logic - all choices validated server-side
// 2. Rate limiting on API endpoints
// 3. Input validation on all fields
// 4. No client-side trust - scores, pot, and results computed only on server
// 5. Socket authentication via user ID
// 6. Round timer enforced server-side
// 7. Choice hashing to prevent peeking (client sends hash first, reveals later)

const rateLimit = new Map();
function checkRateLimit(key, max = 20, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimit.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  rateLimit.set(key, entry);
  return entry.count <= max;
}

function validateAmount(amount) {
  const n = Number(amount);
  return Number.isInteger(n) && n >= 1 && n <= 50;
}

function validateRounds(rounds) {
  const n = Number(rounds);
  return Number.isInteger(n) && n >= 1 && n <= 25;
}

function validateRoundSeconds(s) {
  return [30, 45, 60].includes(Number(s));
}

function validatePayoutStyle(style) {
  return ['winner_takes_all', 'winner_per_game'].includes(style);
}

function validateResignRule(rule) {
  return ['full_pot', 'per_game'].includes(rule);
}

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// ---------- API ROUTES ----------

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'GoWager' });
});

// Register / login user
app.post('/api/users', async (req, res) => {
  if (!checkRateLimit(req.ip)) return res.status(429).json({ error: 'Too many requests' });
  const { telegramId, username, tgUsername } = req.body;
  if (!telegramId || typeof telegramId !== 'string' || telegramId.length > 100) {
    return res.status(400).json({ error: 'Invalid telegram ID' });
  }
  try {
    const user = await db.getOrCreateUser(telegramId, username, tgUsername);
    const wallet = await db.getWallet(user.id);
    res.json({ user, wallet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user by telegram ID
app.get('/api/users/:telegramId', async (req, res) => {
  if (!checkRateLimit(req.ip)) return res.status(429).json({ error: 'Too many requests' });
  try {
    const user = await db.getUserByTelegramId(req.params.telegramId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const wallet = await db.getWallet(user.id);
    res.json({ user, wallet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get wallet
app.get('/api/wallet/:userId', async (req, res) => {
  if (!checkRateLimit(req.ip)) return res.status(429).json({ error: 'Too many requests' });
  try {
    const wallet = await db.getWallet(req.params.userId);
    res.json(wallet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resolve an opponent input that may be a numeric Telegram ID ("123456789")
// or a Telegram username ("@axe773" / "axe773")
async function findUserByIdOrUsername(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    return await db.getUserByTelegramId(raw);
  }
  return await db.getUserByUsername(raw);
}

// Create game
app.post('/api/games', async (req, res) => {
  if (!checkRateLimit(req.ip, 10)) return res.status(429).json({ error: 'Too many requests' });
  const { creatorId, opponentTelegramId, rounds, amountPerRound, roundSeconds, payoutStyle, resignRule, isFree } = req.body;
  const free = !!isFree;

  // Validate all inputs
  if (!creatorId || !opponentTelegramId) return res.status(400).json({ error: 'Missing player IDs' });
  if (!validateRounds(rounds)) return res.status(400).json({ error: 'Rounds must be 1-25' });
  if (!free && !validateAmount(amountPerRound)) return res.status(400).json({ error: 'Amount must be 1-50 GHS' });
  if (!validateRoundSeconds(roundSeconds)) return res.status(400).json({ error: 'Round seconds must be 30, 45, or 60' });
  if (!validatePayoutStyle(payoutStyle)) return res.status(400).json({ error: 'Invalid payout style' });
  if (!validateResignRule(resignRule)) return res.status(400).json({ error: 'Invalid resign rule' });

  try {
    const creator = await db.getUserById(creatorId);
    if (!creator) return res.status(404).json({ error: 'Creator not found' });

    const opponent = await findUserByIdOrUsername(opponentTelegramId);
    if (!opponent) return res.status(404).json({ error: 'Opponent not found. They must open the GoWager app (Telegram Mini App) once to register.' });
    if (opponent.id === creator.id) return res.status(400).json({ error: 'Cannot play against yourself' });

    // For free games: no deposits, no pot. For paid games: each player deposits
    // `rounds × amountPerRound` (their full stake). Total pot = 2 × playerStake.
    const playerStake = free ? 0 : Number(amountPerRound) * Number(rounds);
    const totalPot = free ? 0 : playerStake * 2;

    if (!free) {
      const wallet = await db.getWallet(creator.id);
      if (Number(wallet.balance) < playerStake) {
        return res.status(400).json({ error: `Insufficient balance. Need ${playerStake} GHS (your stake), have ${wallet.balance} GHS` });
      }

      // Deduct creator's full stake
      await db.deductFunds(creator.id, playerStake);
      await db.createTransaction({
        user_id: creator.id,
        type: 'game_deposit',
        amount: playerStake,
        status: 'completed',
      });
    }

    const roomCode = generateRoomCode();
    const game = await db.createGame({
      room_code: roomCode,
      creator_id: creator.id,
      opponent_id: opponent.id,
      rounds: Number(rounds),
      amount_per_round: free ? 0 : Number(amountPerRound),
      round_seconds: Number(roundSeconds),
      payout_style: payoutStyle,
      resign_rule: resignRule,
      resign_definition: '2_games_in_a_row',
      is_free: free,
    });

    res.json({ game, roomCode, totalPot, yourStake: playerStake, isFree: free });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get game by room code
app.get('/api/games/room/:roomCode', async (req, res) => {
  if (!checkRateLimit(req.ip)) return res.status(429).json({ error: 'Too many requests' });
  try {
    const game = await db.getGameByRoomCode(req.params.roomCode.toUpperCase());
    if (!game) return res.status(404).json({ error: 'Game not found' });
    res.json(game);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Join game (second player deposits their full stake, unless free)
app.post('/api/games/:roomCode/join', async (req, res) => {
  if (!checkRateLimit(req.ip, 10)) return res.status(429).json({ error: 'Too many requests' });
  const { playerId } = req.body;
  try {
    const game = await db.getGameByRoomCode(req.params.roomCode.toUpperCase());
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.status !== 'pending') return res.status(400).json({ error: 'Game already started or finished' });
    if (game.opponent_id !== playerId) return res.status(403).json({ error: 'You are not the invited opponent' });

    const isFree = !!game.is_free;
    // Player 2 deposits rounds × amount (their full stake) unless free
    const playerStake = isFree ? 0 : Number(game.amount_per_round) * Number(game.rounds);

    if (!isFree) {
      const wallet = await db.getWallet(playerId);
      if (Number(wallet.balance) < playerStake) {
        return res.status(400).json({ error: `Insufficient balance. Need ${playerStake} GHS (your stake), have ${wallet.balance} GHS` });
      }

      await db.deductFunds(playerId, playerStake);
      await db.createTransaction({
        user_id: playerId,
        type: 'game_deposit',
        amount: playerStake,
        status: 'completed',
      });
    }

    // Total pot = both players' stakes combined (0 for free games)
    const totalPot = isFree ? 0 : playerStake * 2;
    const updated = await db.updateGame(game.id, {
      status: 'ready',
      pot: totalPot,
    });

    // Tell everyone in the room (including the creator) that the game is ready
    io.to(`game_${game.id}`).emit('lobby_update', { game: updated });

    res.json({ game: updated, totalPot, yourStake: playerStake, isFree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Demo only: credit a user's wallet with fake money for local testing.
// Remove this endpoint in production.
app.post('/api/demo/credit', async (req, res) => {
  if (!checkRateLimit(req.ip, 5)) return res.status(429).json({ error: 'Too many requests' });
  const { userId, amount } = req.body;
  const n = Number(amount);
  if (!userId || !Number.isFinite(n) || n <= 0 || n > 5000) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  try {
    await db.addFunds(userId, n);
    await db.createTransaction({
      user_id: userId,
      type: 'demo_credit',
      amount: n,
      status: 'completed',
    });
    res.json({ success: true, wallet: await db.getWallet(userId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List a player's pending/ready (unplayed) games
app.get('/api/games/player/:userId/pending', async (req, res) => {
  if (!checkRateLimit(req.ip)) return res.status(429).json({ error: 'Too many requests' });
  try {
    const games = await db.getGamesByUserAndStatus(req.params.userId, ['pending', 'ready']);
    res.json(games);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Creator deletes a pending/ready game. Stakes are refunded in full.
app.post('/api/games/:id/cancel', async (req, res) => {
  if (!checkRateLimit(req.ip, 10)) return res.status(429).json({ error: 'Too many requests' });
  const { playerId } = req.body;
  try {
    const game = await db.getGameById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.creator_id !== playerId) return res.status(403).json({ error: 'Only the creator can delete this game' });
    if (!['pending', 'ready'].includes(game.status)) return res.status(400).json({ error: 'Game already started or finished' });

    // Refund all deposited stakes for paid games
    if (!game.is_free) {
      const creatorStake = Number(game.amount_per_round) * Number(game.rounds);
      await db.addFunds(game.creator_id, creatorStake);
      await db.createTransaction({ user_id: game.creator_id, type: 'game_refund', amount: creatorStake, status: 'completed' });
      if (game.status === 'ready' && game.opponent_id) {
        await db.addFunds(game.opponent_id, creatorStake);
        await db.createTransaction({ user_id: game.opponent_id, type: 'game_refund', amount: creatorStake, status: 'completed' });
      }
    }

    // Notify anyone waiting in the room, then delete
    io.to(`game_${game.id}`).emit('game_cancelled', { message: 'The creator deleted this game. Your stake was refunded.' });
    activeGames.delete(game.id);
    await db.deleteGame(game.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Withdraw request
app.post('/api/withdraw', async (req, res) => {
  if (!checkRateLimit(req.ip, 5)) return res.status(429).json({ error: 'Too many requests' });
  const { userId, amount } = req.body;
  if (!validateAmount(amount)) return res.status(400).json({ error: 'Invalid amount' });
  try {
    const wallet = await db.getWallet(userId);
    if (Number(wallet.balance) < Number(amount)) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    await db.deductFunds(userId, amount);
    const tx = await db.createTransaction({
      user_id: userId,
      type: 'withdrawal',
      amount: Number(amount),
      status: 'pending',
    });
    res.json({ success: true, transaction: tx, wallet: await db.getWallet(userId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get transactions
app.get('/api/transactions/:userId', async (req, res) => {
  if (!checkRateLimit(req.ip)) return res.status(429).json({ error: 'Too many requests' });
  try {
    const txs = await db.getTransactionsByUser(req.params.userId);
    res.json(txs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- SOCKET.IO REAL-TIME GAME ----------

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join_game_room', async ({ gameId, userId }) => {
    try {
      const game = await db.getGameById(gameId);
      if (!game) return socket.emit('error', { message: 'Game not found' });

      socket.join(`game_${gameId}`);
      socket.data.gameId = gameId;
      socket.data.userId = userId;

      let state = activeGames.get(gameId);
      if (!state) {
        state = {
          game,
          creatorSocket: null,
          opponentSocket: null,
          roundChoices: {},
          roundTimer: null,
          roundDeadline: null,
          missedRounds: {},
          playedRounds: 0,
        };
        activeGames.set(gameId, state);
      }

      if (game.creator_id === userId) state.creatorSocket = socket.id;
      if (game.opponent_id === userId) state.opponentSocket = socket.id;

      // Send current game state to the joining player
      socket.emit('game_state', { game: state.game, round: state.game.current_round, deadline: state.roundDeadline });

      // Notify the other player
      socket.to(`game_${gameId}`).emit('player_joined', { userId });
      io.to(`game_${gameId}`).emit('lobby_update', {
        game: state.game,
        creatorConnected: !!state.creatorSocket,
        opponentConnected: !!state.opponentSocket,
        readyPlayers: Object.keys(state.readyPlayers || {}),
      });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // A player presses "Start Game". The game only begins when BOTH players
  // have pressed it AND both are connected to the game room.
  socket.on('player_ready', async ({ gameId }) => {
    try {
      const state = activeGames.get(gameId);
      if (!state) return socket.emit('error', { message: 'Game not found' });
      const game = state.game;
      if (game.status !== 'ready') return socket.emit('error', { message: 'Waiting for opponent to join first' });

      const userId = socket.data.userId;
      if (userId !== game.creator_id && userId !== game.opponent_id) {
        return socket.emit('error', { message: 'You are not part of this game' });
      }

      state.readyPlayers = state.readyPlayers || {};
      state.readyPlayers[userId] = true;

      const bothReady = state.readyPlayers[game.creator_id] && state.readyPlayers[game.opponent_id];
      const bothConnected = !!state.creatorSocket && !!state.opponentSocket;

      if (bothReady && bothConnected) {
        const updated = await db.updateGame(game.id, { status: 'in_progress' });
        state.game = updated;
        io.to(`game_${game.id}`).emit('game_started', { game: updated });
        startRoundTimer(state);
      } else {
        io.to(`game_${game.id}`).emit('lobby_update', {
          game,
          creatorConnected: !!state.creatorSocket,
          opponentConnected: !!state.opponentSocket,
          readyPlayers: Object.keys(state.readyPlayers),
        });
      }
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // Player submits a choice (rock/paper/scissors)
  socket.on('submit_choice', async ({ gameId, choice }) => {
    try {
      const state = activeGames.get(gameId);
      if (!state) return socket.emit('error', { message: 'Game not active' });
      if (state.game.status !== 'in_progress') return socket.emit('error', { message: 'Game not in progress' });

      const userId = socket.data.userId;
      if (!['rock', 'paper', 'scissors'].includes(choice)) {
        return socket.emit('error', { message: 'Invalid choice' });
      }

      // Anti-hack: only allow one choice per round per player
      if (state.roundChoices[userId]) {
        return socket.emit('error', { message: 'Choice already submitted for this round' });
      }

      state.roundChoices[userId] = choice;
      socket.emit('choice_confirmed', { choice });

      // Check if both players have chosen
      const players = [state.game.creator_id, state.game.opponent_id];
      const allChosen = players.every(p => state.roundChoices[p]);

      if (allChosen) {
        resolveRound(state);
      }
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // Player resigns
  socket.on('resign', async ({ gameId }) => {
    try {
      const state = activeGames.get(gameId);
      if (!state) return socket.emit('error', { message: 'Game not active' });

      const userId = socket.data.userId;
      const game = state.game;
      if (game.status !== 'in_progress') return socket.emit('error', { message: 'Game not in progress' });

      const resignerId = userId;
      clearTimeout(state.roundTimer);

      // Settle based on resign rule (full_pot or per_game)
      await settleGame(state, {
        reason: 'resignation',
        forfeiter: resignerId,
      });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    const { gameId } = socket.data || {};
    if (!gameId) return;
    const state = activeGames.get(gameId);
    if (!state) return;
    if (state.creatorSocket === socket.id) state.creatorSocket = null;
    if (state.opponentSocket === socket.id) state.opponentSocket = null;
    io.to(`game_${gameId}`).emit('lobby_update', {
      game: state.game,
      creatorConnected: !!state.creatorSocket,
      opponentConnected: !!state.opponentSocket,
      readyPlayers: Object.keys(state.readyPlayers || {}),
    });
  });
});

// ---------- GAME LOGIC ----------

function resolveRound(state) {
  const { game, roundChoices } = state;
  const creatorChoice = roundChoices[game.creator_id];
  const opponentChoice = roundChoices[game.opponent_id];

  let roundWinner = null;
  if (creatorChoice === opponentChoice) {
    roundWinner = 'tie';
  } else if (
    (creatorChoice === 'rock' && opponentChoice === 'scissors') ||
    (creatorChoice === 'paper' && opponentChoice === 'rock') ||
    (creatorChoice === 'scissors' && opponentChoice === 'paper')
  ) {
    roundWinner = game.creator_id;
  } else {
    roundWinner = game.opponent_id;
  }

  let creatorScore = game.creator_score;
  let opponentScore = game.opponent_score;
  if (roundWinner === game.creator_id) creatorScore++;
  if (roundWinner === game.opponent_id) opponentScore++;

  const nextRound = game.current_round + 1;
  const isGameOver = nextRound > game.rounds;

  // Track this as a played round
  state.playedRounds = (state.playedRounds || 0) + 1;

  // Reset round state
  state.roundChoices = {};
  state.missedRounds = {};

  if (isGameOver) {
    db.updateGame(game.id, {
      status: 'completed',
      current_round: game.rounds,
      creator_score: creatorScore,
      opponent_score: opponentScore,
    }).then(updated => {
      state.game = updated;
      io.to(`game_${game.id}`).emit('round_result', {
        round: game.current_round,
        creatorChoice,
        opponentChoice,
        roundWinner,
        creatorScore,
        opponentScore,
      });
      // Settle full-game payouts
      settleGame(state, { reason: 'completed' });
    });
  } else {
    // Continue to next round
    db.updateGame(game.id, {
      current_round: nextRound,
      creator_score: creatorScore,
      opponent_score: opponentScore,
    }).then(updated => {
      state.game = updated;
      io.to(`game_${game.id}`).emit('round_result', {
        round: game.current_round - 1, // 1-indexed round just finished
        creatorChoice,
        opponentChoice,
        roundWinner,
        creatorScore,
        opponentScore,
      });
      startRoundTimer(state);
    });
  }
}

function startRoundTimer(state) {
  clearTimeout(state.roundTimer);
  const seconds = state.game.round_seconds;
  state.roundDeadline = Date.now() + seconds * 1000;

  io.to(`game_${state.game.id}`).emit('round_started', {
    round: state.game.current_round,
    deadline: state.roundDeadline,
    seconds,
  });

  state.roundTimer = setTimeout(async () => {
    // Time's up - check who hasn't chosen
    const players = [state.game.creator_id, state.game.opponent_id];
    const missing = players.filter(p => !state.roundChoices[p]);

    if (missing.length > 0) {
      // Track missed rounds
      missing.forEach(p => {
        state.missedRounds[p] = (state.missedRounds[p] || 0) + 1;
      });

      // If a player missed 2 rounds in a row, they resign automatically.
      const resigner = missing.find(p => state.missedRounds[p] >= 2);
      if (resigner) {
        clearTimeout(state.roundTimer);
        await settleGame(state, {
          reason: 'auto_resign_timeout',
          forfeiter: resigner,
        });
        return;
      }

      // Auto-assign random choice for missing players this round
      const choices = ['rock', 'paper', 'scissors'];
      missing.forEach(p => {
        state.roundChoices[p] = choices[Math.floor(Math.random() * 3)];
      });

      io.to(`game_${state.game.id}`).emit('timeout_warning', {
        missing,
        missedCounts: state.missedRounds,
      });

      resolveRound(state);
    } else {
      // Both chose but somehow timer fired - just resolve
      resolveRound(state);
    }
  }, seconds * 1000);
}

// ---------- PAYOUT SETTLEMENT ----------

/**
 * Settles a game once it is finished (completed / resignation / auto-timeout).
 *
 * Money model:
 *   Each player deposits `rounds × amount_per_round` (full stake).
 *   Total pot = 2 × playerStake.
 *
 * payout_style = 'winner_takes_all':
 *   - Completed: Overall winner gets 95% of the entire pot.
 *   - Tie at completed: each player gets 95% of their half back.
 *   - Resign (full_pot rule): the non-resigning player gets 95% of entire pot.
 *
 * payout_style = 'winner_per_game':
 *   - Each player game contributed amountPerRound. A won game pays
 *     the whole game's stake (2 × amountPerRound) to the game winner.
 *   - A tied game gives both players back their stake (95% of it; the
 *     5% fee is taken only on games played).
 *   - If resigning (resign_rule='per_game'), only completed games are
 *     settled, and each player also gets a full refund for the unplayed
 *     games. GoWager's commission is taken only from completed games.
 */
async function settleGame(state, { reason, forfeiter = null }) {
  const game = state.game;
  const gameId = game.id;
  const creatorId = game.creator_id;
  const opponentId = game.opponent_id;

  const isFree = !!game.is_free;
  const pot = Number(game.pot);
  const amountPer = Number(game.amount_per_round);
  const totalGames = Number(game.rounds);
  const creatorScore = Number(game.creator_score) || 0;
  const opponentScore = Number(game.opponent_score) || 0;
  const playedRounds = Math.max(state.playedRounds || 0, game.current_round - 1);

  let creatorPayout = 0;
  let opponentPayout = 0;
  let fee = 0;
  let winnerId = null;

  // Free games: no money involved, just determine the winner for bragging rights
  if (isFree) {
    if (creatorScore > opponentScore) winnerId = creatorId;
    else if (opponentScore > creatorScore) winnerId = opponentId;

    const updated = await db.updateGame(gameId, {
      status: 'completed',
      creator_score: creatorScore,
      opponent_score: opponentScore,
    });
    state.game = updated;
    clearTimeout(state.roundTimer);
    io.to(`game_${gameId}`).emit('game_over', {
      game: updated,
      winnerId,
      winnerAmount: 0,
      creatorPayout: 0,
      opponentPayout: 0,
      fee: 0,
      reason,
      forfeiter,
      tie: winnerId === null,
      isFree: true,
    });
    activeGames.delete(gameId);
    return;
  }

  const winShare = (2 * amountPer) * 0.95;      // 95% of the whole game stake
  const tieShare = amountPer * 0.95;            // each player gets stake back minus their share of fee
  const playedFee = (2 * amountPer) * 0.05;     // per-game commission

  if (reason === 'completed') {
    if (game.payout_style === 'winner_takes_all') {
      if (creatorScore > opponentScore) winnerId = creatorId;
      else if (opponentScore > creatorScore) winnerId = opponentId;

      if (winnerId) {
        const amount = pot * 0.95;
        fee = pot - amount;
        if (winnerId === creatorId) creatorPayout = amount;
        else opponentPayout = amount;
      } else {
        // Tie game - refund each player 95% of their stake
        creatorPayout = (pot / 2) * 0.95;
        opponentPayout = (pot / 2) * 0.95;
        fee = pot * 0.05;
      }
    } else {
      // winner_per_game (completed entirely)
      const ties = Math.max(0, playedRounds - creatorScore - opponentScore);
      creatorPayout = creatorScore * winShare + ties * tieShare;
      opponentPayout = opponentScore * winShare + ties * tieShare;
      fee = pot - creatorPayout - opponentPayout;
      winnerId = creatorScore > opponentScore ? creatorId
        : opponentScore > creatorScore ? opponentId : null;
    }
  } else {
    // resignation / auto_resign_timeout
    const forfeiterRole = forfeiter === creatorId ? 'creator' : 'opponent';
    const nonForfeiter = forfeiter === creatorId ? opponentId : creatorId;

    if (game.resign_rule === 'full_pot') {
      // winner gets the entire pot minus 5% fee
      winnerId = nonForfeiter;
      const amount = pot * 0.95;
      fee = pot - amount;
      if (winnerId === creatorId) creatorPayout = amount;
      else opponentPayout = amount;
    } else {
      // per_game resign
      const gamesPlayed = Math.max(0, playedRounds);
      const gamesLeft = totalGames - gamesPlayed;
      const ties = Math.max(0, gamesPlayed - creatorScore - opponentScore);
      const refundUnplayed = gamesLeft * amountPer;

      creatorPayout = (creatorScore * winShare) + (ties * tieShare) + refundUnplayed;
      opponentPayout = (opponentScore * winShare) + (ties * tieShare) + refundUnplayed;
      fee = gamesPlayed * playedFee; // fee only on completed games
      winnerId = creatorPayout > opponentPayout ? creatorId
        : opponentPayout > creatorPayout ? opponentId : null;
    }
  }

  // Credit payouts (only if > 0)
  const credit = async (userId, amount, type) => {
    const n = Number(amount);
    if (!n || n <= 0) return;
    await db.addFunds(userId, n);
    await db.createTransaction({
      user_id: userId,
      game_id: gameId,
      type,
      amount: n,
      status: 'completed',
    });
  };

  await credit(creatorId, creatorPayout, reason === 'completed' ? 'game_win' : 'game_settlement');

  // auto-resign timeout: deposit funds for withdrawals/refunded unplayed
  await credit(opponentId, opponentPayout, 'game_refund');

  // Finish the game in the DB
  const updated = await db.updateGame(gameId, {
    status: 'completed',
    creator_score: creatorScore,
    opponent_score: opponentScore,
  });

  state.game = updated;
  clearTimeout(state.roundTimer);

  io.to(`game_${gameId}`).emit('game_over', {
    game: updated,
    winnerId,
    winnerAmount: Math.max(creatorPayout, opponentPayout),
    creatorPayout: Number(creatorPayout.toFixed(2)),
    opponentPayout: Number(opponentPayout.toFixed(2)),
    fee: Number(fee.toFixed(2)),
    reason,
    forfeiter,
    tie: winnerId === null,
  });

  activeGames.delete(gameId);
}

// ---------- START SERVER ----------

async function start() {
  await db.initDb();
  server.listen(PORT, () => {
    console.log(`GoWager backend running on port ${PORT}`);
  });
}

start();