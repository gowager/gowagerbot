const { Pool } = require('pg');

// In-memory fallback store (used when DATABASE_URL is not set)
const memoryStore = {
  users: new Map(),
  games: new Map(),
  wallets: new Map(),
  transactions: new Map(),
};

let pool = null;
let useMemory = false;

async function initDb() {
  if (process.env.DATABASE_URL) {
    try {
      pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      await pool.query('SELECT 1');
      console.log('Connected to PostgreSQL database.');
      await createTables();
      return;
    } catch (err) {
      console.warn('Postgres connection failed, falling back to in-memory store:', err.message);
    }
  }
  useMemory = true;
  console.log('Using in-memory store (no DATABASE_URL provided).');
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      username TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      balance NUMERIC(12,2) DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS games (
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
      is_free BOOLEAN DEFAULT FALSE,
      status TEXT DEFAULT 'pending',
      current_round INTEGER DEFAULT 1,
      creator_score INTEGER DEFAULT 0,
      opponent_score INTEGER DEFAULT 0,
      pot NUMERIC(12,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      game_id TEXT,
      type TEXT,
      amount NUMERIC(12,2),
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
   `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_username TEXT`);
}

// ---- User helpers ----
async function getOrCreateUser(telegramId, username, tgUsername) {
  if (useMemory) {
    const existing = [...memoryStore.users.values()].find(u => u.telegram_id === telegramId);
    if (existing) {
      if (tgUsername) existing.tg_username = tgUsername;
      if (username) existing.username = username;
      return existing;
    }
    const user = { id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, telegram_id: telegramId, username: username || 'player', tg_username: tgUsername || null };
    memoryStore.users.set(user.id, user);
    memoryStore.wallets.set(user.id, { user_id: user.id, balance: 0 });
    return user;
  }
  const res = await pool.query(
    `INSERT INTO users (id, telegram_id, username, tg_username) VALUES ($1, $2, $3, $4)
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = EXCLUDED.username,
       tg_username = COALESCE(EXCLUDED.tg_username, users.tg_username)
     RETURNING *`,
    [`u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, telegramId, username, tgUsername || null]
  );
  const user = res.rows[0];
  await pool.query(
    `INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [user.id]
  );
  return user;
}

async function getUserByTelegramId(telegramId) {
  if (useMemory) {
    return [...memoryStore.users.values()].find(u => u.telegram_id === telegramId) || null;
  }
  const res = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  return res.rows[0] || null;
}

async function getUserByUsername(handle) {
  const h = String(handle || '').trim().replace(/^@/, '').toLowerCase();
  if (!h) return null;
  if (useMemory) {
    return [...memoryStore.users.values()].find(u => u.tg_username && u.tg_username.toLowerCase() === h) || null;
  }
  const res = await pool.query('SELECT * FROM users WHERE LOWER(tg_username) = $1', [h]);
  return res.rows[0] || null;
}

async function getUserById(id) {
  if (useMemory) {
    return memoryStore.users.get(id) || null;
  }
  const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return res.rows[0] || null;
}

// ---- Wallet helpers ----
async function getWallet(userId) {
  if (useMemory) {
    return memoryStore.wallets.get(userId) || { user_id: userId, balance: 0 };
  }
  const res = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
  return res.rows[0] || { user_id: userId, balance: 0 };
}

async function addFunds(userId, amount) {
  if (useMemory) {
    const wallet = memoryStore.wallets.get(userId) || { user_id: userId, balance: 0 };
    wallet.balance = Number(wallet.balance) + Number(amount);
    memoryStore.wallets.set(userId, wallet);
    return wallet;
  }
  const res = await pool.query(
    `UPDATE wallets SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1 RETURNING *`,
    [userId, amount]
  );
  return res.rows[0];
}

async function deductFunds(userId, amount) {
  if (useMemory) {
    const wallet = memoryStore.wallets.get(userId) || { user_id: userId, balance: 0 };
    if (Number(wallet.balance) < Number(amount)) throw new Error('Insufficient balance');
    wallet.balance = Number(wallet.balance) - Number(amount);
    memoryStore.wallets.set(userId, wallet);
    return wallet;
  }
  const res = await pool.query(
    `UPDATE wallets SET balance = balance - $2, updated_at = NOW() WHERE user_id = $1 AND balance >= $2 RETURNING *`,
    [userId, amount]
  );
  if (!res.rows[0]) throw new Error('Insufficient balance');
  return res.rows[0];
}

// ---- Game helpers ----
async function createGame(gameData) {
  const game = {
    id: `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    room_code: gameData.room_code,
    creator_id: gameData.creator_id,
    opponent_id: gameData.opponent_id,
    game_type: 'rps',
    rounds: gameData.rounds,
    amount_per_round: gameData.amount_per_round,
    round_seconds: gameData.round_seconds,
    payout_style: gameData.payout_style,
    resign_rule: gameData.resign_rule,
    resign_definition: gameData.resign_definition,
    is_free: gameData.is_free || false,
    status: 'pending',
    current_round: 1,
    creator_score: 0,
    opponent_score: 0,
    pot: 0,
    created_at: new Date().toISOString(),
  };
  if (useMemory) {
    memoryStore.games.set(game.id, game);
    return game;
  }
  const res = await pool.query(
    `INSERT INTO games (id, room_code, creator_id, opponent_id, game_type, rounds, amount_per_round, round_seconds, payout_style, resign_rule, resign_definition, is_free, status, current_round, creator_score, opponent_score, pot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [game.id, game.room_code, game.creator_id, game.opponent_id, game.game_type, game.rounds, game.amount_per_round, game.round_seconds, game.payout_style, game.resign_rule, game.resign_definition, game.is_free, game.status, game.current_round, game.creator_score, game.opponent_score, game.pot]
  );
  return res.rows[0];
}

async function getGameByRoomCode(roomCode) {
  if (useMemory) {
    return [...memoryStore.games.values()].find(g => g.room_code === roomCode) || null;
  }
  const res = await pool.query('SELECT * FROM games WHERE room_code = $1', [roomCode]);
  return res.rows[0] || null;
}

async function getGameById(id) {
  if (useMemory) {
    return memoryStore.games.get(id) || null;
  }
  const res = await pool.query('SELECT * FROM games WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function getGamesByUserAndStatus(userId, statuses) {
  if (useMemory) {
    return [...memoryStore.games.values()]
      .filter(g => (g.creator_id === userId || g.opponent_id === userId) && statuses.includes(g.status))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  const res = await pool.query(
    'SELECT * FROM games WHERE (creator_id = $1 OR opponent_id = $1) AND status = ANY($2) ORDER BY created_at DESC',
    [userId, statuses]
  );
  return res.rows;
}

async function deleteGame(id) {
  if (useMemory) {
    return memoryStore.games.delete(id);
  }
  const res = await pool.query('DELETE FROM games WHERE id = $1', [id]);
  return res.rowCount > 0;
}

async function updateGame(id, updates) {
  if (useMemory) {
    const game = memoryStore.games.get(id);
    if (!game) return null;
    Object.assign(game, updates);
    return game;
  }
  const keys = Object.keys(updates);
  const values = Object.values(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const res = await pool.query(`UPDATE games SET ${setClause} WHERE id = $1 RETURNING *`, [id, ...values]);
  return res.rows[0] || null;
}

// ---- Transaction helpers ----
async function createTransaction(tx) {
  if (useMemory) {
    const t = { id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, ...tx, created_at: new Date().toISOString() };
    memoryStore.transactions.set(t.id, t);
    return t;
  }
  const res = await pool.query(
    `INSERT INTO transactions (id, user_id, game_id, type, amount, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tx.id || `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, tx.user_id, tx.game_id, tx.type, tx.amount, tx.status || 'pending']
  );
  return res.rows[0];
}

async function getTransactionsByUser(userId) {
  if (useMemory) {
    return [...memoryStore.transactions.values()].filter(t => t.user_id === userId);
  }
  const res = await pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return res.rows;
}

module.exports = {
  initDb,
  getOrCreateUser,
  getUserByTelegramId,
  getUserByUsername,
  getUserById,
  getWallet,
  addFunds,
  deductFunds,
  createGame,
  getGameByRoomCode,
  getGameById,
  getGamesByUserAndStatus,
  deleteGame,
  updateGame,
  createTransaction,
  getTransactionsByUser,
};