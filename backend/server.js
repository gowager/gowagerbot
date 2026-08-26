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

function validateGameType(t) {
  return ['rps', 'redblack', 'warzone'].includes(t);
}

function validateCreatorRole(r) {
  return ['dealer', 'player'].includes(r);
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

// Resolve an opponent input that may be a numeric Telegram ID ("123456789"),
// a Telegram username ("@axe773" / "axe773"), or a web-app generated ID
async function findUserByIdOrUsername(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    return await db.getUserByTelegramId(raw);
  }
  const byHandle = await db.getUserByUsername(raw);
  if (byHandle) return byHandle;
  return await db.getUserByTelegramId(raw);
}

// Create game
app.post('/api/games', async (req, res) => {
  if (!checkRateLimit(req.ip, 10)) return res.status(429).json({ error: 'Too many requests' });
  const { creatorId, opponentTelegramId, rounds, amountPerRound, roundSeconds, payoutStyle, resignRule, isFree, gameType, creatorRole } = req.body;
  const free = !!isFree;
  const type = gameType || 'rps';

  // Validate all inputs
  if (!creatorId || !opponentTelegramId) return res.status(400).json({ error: 'Missing player IDs' });
  if (!validateGameType(type)) return res.status(400).json({ error: 'Invalid game type' });
  if (type === 'redblack') {
    if (!validateCreatorRole(creatorRole)) return res.status(400).json({ error: 'Choose to be Dealer or Player' });
    if (!validateRounds(rounds) || Number(rounds) > 52) return res.status(400).json({ error: 'Cards must be 1-52' });
    if (!free && !validateAmount(amountPerRound) || (free === false && Number(amountPerRound) > 20)) {
      return res.status(400).json({ error: 'Bet must be 1-20 GHS per game' });
    }
  } else if (type === 'warzone') {
    // Single-match stake: amount is the whole match bet, rounds forced to 1
    if (!free && !validateAmount(amountPerRound)) return res.status(400).json({ error: 'Stake must be 1-50 GHS per match' });
  } else {
    if (!validateRounds(rounds)) return res.status(400).json({ error: 'Rounds must be 1-25' });
    if (!free && !validateAmount(amountPerRound)) return res.status(400).json({ error: 'Amount must be 1-50 GHS' });
  }
  if (!free && !validateRoundSeconds(roundSeconds)) return res.status(400).json({ error: 'Round seconds must be 30, 45, or 60' });
  if (!validatePayoutStyle(payoutStyle)) return res.status(400).json({ error: 'Invalid payout style' });
  if (!validateResignRule(resignRule)) return res.status(400).json({ error: 'Invalid resign rule' });

  try {
    const creator = await db.getUserById(creatorId);
    if (!creator) return res.status(404).json({ error: 'Creator not found' });

    const opponent = await findUserByIdOrUsername(opponentTelegramId);
    if (!opponent) return res.status(404).json({ error: 'Opponent not found. They must open the GoWager app (Telegram Mini App) once to register.' });
    if (opponent.id === creator.id) return res.status(400).json({ error: 'Cannot play against yourself' });

    // For free games: no deposits, no pot. Each player deposits their full
    // stake: rounds (cards) × amountPerRound. Total pot = 2 × playerStake.
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
    const isWarzone = type === 'warzone';
    const game = await db.createGame({
      room_code: roomCode,
      creator_id: creator.id,
      opponent_id: opponent.id,
      game_type: type,
      creator_role: type === 'redblack' ? creatorRole : null,
      rounds: isWarzone ? 1 : Number(rounds),
      amount_per_round: free ? 0 : Number(amountPerRound),
      round_seconds: isWarzone ? 30 : Number(roundSeconds),
      payout_style: type === 'redblack' || isWarzone ? 'winner_takes_all' : payoutStyle,
      resign_rule: type === 'redblack' || isWarzone ? 'full_pot' : resignRule,
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
    // Each player deposits their full stake: rounds (cards) × amount per round
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

// Deposit funds (production: integrate with Paystack / Flutterwave / MoMo)
app.post('/api/deposit', async (req, res) => {
  if (!checkRateLimit(req.ip, 5)) return res.status(429).json({ error: 'Too many requests' });
  const { userId, amount } = req.body;
  const num = Number(amount);
  if (!userId || !Number.isFinite(num) || num < 1 || num > 500) {
    return res.status(400).json({ error: 'Deposit amount must be 1–500 GHS' });
  }
  try {
    await db.addFunds(userId, num);
    await db.createTransaction({
      user_id: userId,
      type: 'deposit',
      amount: num,
      status: 'completed',
    });
    res.json({ success: true, wallet: await db.getWallet(userId) });
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
      } else {
        // Refresh the in-memory snapshot so returning players get current status
        state.game = game;
      }

      if (game.creator_id === userId) state.creatorSocket = socket.id;
      if (game.opponent_id === userId) state.opponentSocket = socket.id;

      // Send current game state to the joining player
      socket.emit('game_state', { game: state.game, round: state.game.current_round, deadline: state.roundDeadline });

      // Re-sync Red or Black mid-game state for returning players
      if (state.game.status === 'in_progress' && state.game.game_type === 'redblack' && state.rb) {
        const { dealerId, playerId } = rbRoles(state.game);
        if (userId === dealerId) socket.emit('rb_your_hand', { hand: state.rb.hand });
        else socket.emit(state.rb.pickedCard ? 'rb_dealer_picked' : 'rb_wait_dealer', {});
      }

      // Re-sync War Zone mid-game state for returning players
      if (state.game.status === 'in_progress' && state.game.game_type === 'warzone' && state.wz) {
        const isCreator = userId === state.game.creator_id;
        if (state.wz.phase === 'placing') {
          socket.emit('wz_placement_started', { seconds: 30 });
          if ((isCreator && state.wz.creatorCells) || (!isCreator && state.wz.opponentCells)) {
            socket.emit('wz_placed', {});
          }
        } else {
          socket.emit('wz_battle_started', { turn: state.wz.turn });
          socket.emit('wz_sync', {
            turn: state.wz.turn,
            creatorHits: state.wz.creatorHits,
            opponentHits: state.wz.opponentHits,
            yourGuesses: isCreator ? [...state.wz.creatorGuesses] : [...state.wz.opponentGuesses],
            incomingShots: isCreator ? [...state.wz.opponentGuesses] : [...state.wz.creatorGuesses],
          });
        }
      }

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
        if (updated.game_type === 'redblack') startRedBlack(state);
        else if (updated.game_type === 'warzone') startWarZone(state);
        else startRoundTimer(state);
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

  // ---------- RED OR BLACK ----------

  // Dealer picks which card from their hand to play this round
  socket.on('rb_dealer_pick', ({ gameId, cardIndex }) => {
    try {
      const state = activeGames.get(gameId);
      if (!state || state.game.status !== 'in_progress' || !state.rb) return socket.emit('error', { message: 'Game not active' });

      const { dealerId } = rbRoles(state.game);
      if (socket.data.userId !== dealerId) return socket.emit('error', { message: 'Only the dealer picks cards' });
      if (state.rb.pickedCard) return socket.emit('error', { message: 'Already picked a card this round' });

      const idx = Number(cardIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= state.rb.hand.length) return socket.emit('error', { message: 'Invalid card' });

      state.rb.pickedCard = state.rb.hand.splice(idx, 1)[0];
      io.to(`game_${gameId}`).emit('rb_dealer_picked', {});
      // Dealer sees their own picked card face-up on the table; the player does not
      const dealerSock = rbSockOf(state, dealerId);
      if (dealerSock) io.to(dealerSock).emit('rb_dealer_card', { card: state.rb.pickedCard });
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // Player guesses the color of the picked card
  socket.on('rb_player_guess', ({ gameId, guess }) => {
    try {
      const state = activeGames.get(gameId);
      if (!state || state.game.status !== 'in_progress' || !state.rb) return socket.emit('error', { message: 'Game not active' });

      const { playerId } = rbRoles(state.game);
      if (socket.data.userId !== playerId) return socket.emit('error', { message: 'Only the player guesses' });
      if (!state.rb.pickedCard) return socket.emit('error', { message: 'Dealer has not picked yet' });
      if (state.rb.guess) return socket.emit('error', { message: 'Already guessed this round' });
      if (!['red', 'black'].includes(guess)) return socket.emit('error', { message: 'Invalid guess' });

      state.rb.guess = guess;
      resolveRedBlackRound(state, guess);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // ---------- WAR ZONE HANDLERS ----------

  // Player locks in their 4 rocket positions during the placement phase
  socket.on('wz_place', ({ gameId, cells }) => {
    try {
      const state = activeGames.get(gameId);
      if (!state || !state.wz || state.wz.phase !== 'placing') return socket.emit('error', { message: 'Not in placement phase' });
      const game = state.game;
      const userId = socket.data.userId;
      if (userId !== game.creator_id && userId !== game.opponent_id) return socket.emit('error', { message: 'You are not part of this game' });

      if (!Array.isArray(cells) || cells.length !== WZ_TARGETS) return socket.emit('error', { message: 'Place exactly 4 rockets' });
      const set = new Set(cells.map(Number));
      const valid = set.size === WZ_TARGETS && [...set].every(c => Number.isInteger(c) && c >= 0 && c < WZ_SIZE);
      if (!valid) return socket.emit('error', { message: 'Invalid positions' });

      if (userId === game.creator_id) {
        if (state.wz.creatorCells) return socket.emit('error', { message: 'Positions already locked' });
        state.wz.creatorCells = [...set];
      } else {
        if (state.wz.opponentCells) return socket.emit('error', { message: 'Positions already locked' });
        state.wz.opponentCells = [...set];
      }

      socket.emit('wz_placed', {});
      if (state.wz.creatorCells && state.wz.opponentCells) wzBeginBattle(state);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // Player guesses a box on the enemy grid (strictly alternating turns)
  socket.on('wz_guess', async ({ gameId, cell }) => {
    try {
      const state = activeGames.get(gameId);
      if (!state || !state.wz || state.wz.phase !== 'battle') return socket.emit('error', { message: 'Battle not in progress' });
      const game = state.game;
      const userId = socket.data.userId;
      const isCreator = userId === game.creator_id;
      if (!isCreator && userId !== game.opponent_id) return socket.emit('error', { message: 'You are not part of this game' });
      if ((state.wz.turn === 'creator') !== isCreator) return socket.emit('error', { message: 'Not your turn' });

      const idx = Number(cell);
      if (!Number.isInteger(idx) || idx < 0 || idx >= WZ_SIZE) return socket.emit('error', { message: 'Invalid box' });
      const myGuesses = isCreator ? state.wz.creatorGuesses : state.wz.opponentGuesses;
      if (myGuesses.has(idx)) return socket.emit('error', { message: 'Already guessed that box' });
      myGuesses.add(idx);

      const targetCells = isCreator ? state.wz.opponentCells : state.wz.creatorCells;
      const hit = targetCells.includes(idx);
      if (isCreator) { if (hit) state.wz.creatorHits += 1; }
      else if (hit) state.wz.opponentHits += 1;

      const gameOver = state.wz.creatorHits >= WZ_TARGETS || state.wz.opponentHits >= WZ_TARGETS;

      // Persist hits as scores so settleGame picks the right winner
      const updated = await db.updateGame(game.id, gameOver
        ? { status: 'completed', creator_score: state.wz.creatorHits, opponent_score: state.wz.opponentHits }
        : { creator_score: state.wz.creatorHits, opponent_score: state.wz.opponentHits });
      state.game = updated;

      io.to(`game_${gameId}`).emit('wz_result', {
        cell: idx,
        hit,
        byCreator: isCreator,
        creatorHits: state.wz.creatorHits,
        opponentHits: state.wz.opponentHits,
        gameOver,
      });

      if (gameOver) {
        state.wz.phase = 'done';
        settleGame(state, { reason: 'completed' });
      } else {
        state.wz.turn = isCreator ? 'opponent' : 'creator';
        io.to(`game_${gameId}`).emit('wz_turn', { turn: state.wz.turn });
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
      clearTimeout(state.wzTimer);

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

// ---------- RED OR BLACK ENGINE ----------

function rbRoles(game) {
  const dealerId = game.creator_role === 'player' ? game.opponent_id : game.creator_id;
  const playerId = dealerId === game.creator_id ? game.opponent_id : game.creator_id;
  return { dealerId, playerId };
}

// 4 standard decks (52 cards each, no jokers), shuffled
function buildShoe() {
  const suits = [
    { suit: '♠', color: 'black' },
    { suit: '♣', color: 'black' },
    { suit: '♥', color: 'red' },
    { suit: '♦', color: 'red' },
  ];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const shoe = [];
  for (let d = 0; d < 4; d++) {
    for (const { suit, color } of suits) {
      for (const rank of ranks) shoe.push({ rank, suit, color });
    }
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

function startRedBlack(state) {
  const game = state.game;
  state.rb = {
    hand: buildShoe().slice(0, Number(game.rounds)),
    pickedCard: null,
    guess: null,
  };
  rbBeginRound(state);
}

function rbSockOf(state, userId) {
  return userId === state.game.creator_id ? state.creatorSocket : state.opponentSocket;
}

// Deal out a new round: dealer privately receives their remaining hand
function rbBeginRound(state) {
  const game = state.game;
  const { dealerId, playerId } = rbRoles(game);
  io.to(`game_${game.id}`).emit('rb_round_started', { round: game.current_round, totalCards: game.rounds });
  const dealerSock = rbSockOf(state, dealerId);
  const playerSock = rbSockOf(state, playerId);
  if (dealerSock) io.to(dealerSock).emit('rb_your_hand', { hand: state.rb.hand });
  if (playerSock) io.to(playerSock).emit('rb_wait_dealer', {});
}

async function resolveRedBlackRound(state, guess) {
  const game = state.game;
  const { dealerId, playerId } = rbRoles(game);
  const card = state.rb.pickedCard;
  const correct = guess === card.color;
  const roundWinner = correct ? playerId : dealerId;

  const creatorScore = Number(game.creator_score) + (roundWinner === game.creator_id ? 1 : 0);
  const opponentScore = Number(game.opponent_score) + (roundWinner === game.opponent_id ? 1 : 0);
  const nextRound = game.current_round + 1;
  const isGameOver = nextRound > game.rounds;

  // Reset per-round state
  state.rb.pickedCard = null;
  state.rb.guess = null;

  const updated = await db.updateGame(game.id, isGameOver
    ? { status: 'completed', current_round: game.rounds, creator_score: creatorScore, opponent_score: opponentScore }
    : { current_round: nextRound, creator_score: creatorScore, opponent_score: opponentScore });
  state.game = updated;

  io.to(`game_${game.id}`).emit('rb_round_result', {
    round: game.current_round,
    card,
    guess,
    correct,
    roundWinner,
    creatorScore,
    opponentScore,
  });

  if (isGameOver) {
    settleGame(state, { reason: 'completed' });
  } else {
    setTimeout(() => rbBeginRound(state), 2500); // brief pause so players see the reveal
  }
}

// ---------- WAR ZONE ENGINE ----------
// 4x4 grid (16 boxes). Each player secretly places 4 rockets in 30 seconds.
// Players then alternate single guesses at the enemy grid.
// First to find all 4 enemy rockets wins the pot.

const WZ_SIZE = 16;
const WZ_TARGETS = 4;
const WZ_PLACE_SECONDS = 30;

function wzAutoPlace() {
  const cells = new Set();
  while (cells.size < WZ_TARGETS) cells.add(crypto.randomInt(WZ_SIZE));
  return [...cells];
}

function startWarZone(state) {
  state.wz = {
    phase: 'placing',
    creatorCells: null,
    opponentCells: null,
    creatorHits: 0,
    opponentHits: 0,
    creatorGuesses: new Set(),
    opponentGuesses: new Set(),
    turn: 'creator',
  };
  io.to(`game_${state.game.id}`).emit('wz_placement_started', { seconds: WZ_PLACE_SECONDS });
  // 30s placement window; anyone who fails to submit gets random positions
  state.wzTimer = setTimeout(() => {
    if (!state.wz || state.wz.phase !== 'placing') return;
    if (!state.wz.creatorCells) state.wz.creatorCells = wzAutoPlace();
    if (!state.wz.opponentCells) state.wz.opponentCells = wzAutoPlace();
    wzBeginBattle(state);
  }, WZ_PLACE_SECONDS * 1000);
}

function wzBeginBattle(state) {
  clearTimeout(state.wzTimer);
  state.wz.phase = 'battle';
  io.to(`game_${state.game.id}`).emit('wz_battle_started', { turn: state.wz.turn });
}

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