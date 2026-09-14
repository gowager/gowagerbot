const { Pool } = require('pg');

// In-memory fallback store (used when DATABASE_URL is not set)
const memoryStore = {
  users: new Map(),
  games: new Map(),
  wallets: new Map(),
  transactions: new Map(),
  withdrawalRequests: new Map(),
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
      if (process.env.ENFORCE_DATABASE === '1') {
        console.error('ENFORCE_DATABASE=1 but Postgres is unavailable — refusing to start on the volatile in-memory store.');
        process.exit(1);
      }
    }
  }
  useMemory = true;
  console.log('Using in-memory store (no DATABASE_URL provided).');
  if (process.env.ENFORCE_DATABASE === '1') {
    console.error('ENFORCE_DATABASE=1 but DATABASE_URL is not set — refusing to start on the volatile in-memory store.');
    process.exit(1);
  }
}

function getDbMode() {
  return useMemory ? 'memory' : 'postgres';
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      username TEXT,
      email TEXT,
      recipient_code TEXT,
      account_name TEXT,
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
      paystack_reference TEXT,
      transfer_code TEXT,
      recipient_code TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      full_name TEXT,
      account_number TEXT,
      bank_name TEXT,
      amount NUMERIC(12,2),
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
   `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_username TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS recipient_code TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_name TEXT`);
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS paystack_reference TEXT`);
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_code TEXT`);
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recipient_code TEXT`);
  await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS creator_role TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user ON withdrawal_requests(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_games_creator ON games(creator_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_games_opponent ON games(opponent_id)`);
}

// ---- User helpers ----
async function getOrCreateUser(telegramId, username, tgUsername, email) {
  if (useMemory) {
    const existing = [...memoryStore.users.values()].find(u => u.telegram_id === telegramId);
    if (existing) {
      if (tgUsername) existing.tg_username = tgUsername;
      if (username) existing.username = username;
      if (email) existing.email = email;
      return existing;
    }
    const user = { id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, telegram_id: telegramId, username: username || 'player', tg_username: tgUsername || null, email: email || null, recipient_code: null, account_name: null };
    memoryStore.users.set(user.id, user);
    memoryStore.wallets.set(user.id, { user_id: user.id, balance: 0 });
    return user;
  }
  const res = await pool.query(
    `INSERT INTO users (id, telegram_id, username, tg_username, email) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = EXCLUDED.username,
       tg_username = COALESCE(EXCLUDED.tg_username, users.tg_username),
       email = COALESCE(EXCLUDED.email, users.email)
     RETURNING *`,
    [`u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, telegramId, username, tgUsername || null, email || null]
  );
  const user = res.rows[0];
  await pool.query(
    `INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [user.id]
  );
  return user;
}

async function updateUser(id, updates) {
  if (useMemory) {
    const user = memoryStore.users.get(id);
    if (!user) return null;
    Object.assign(user, updates);
    return user;
  }
  const keys = Object.keys(updates);
  const values = Object.values(updates);
  if (!keys.length) return null;
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const res = await pool.query(`UPDATE users SET ${setClause} WHERE id = $1 RETURNING *`, [id, ...values]);
  return res.rows[0] || null;
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
    game_type: gameData.game_type || 'rps',
    creator_role: gameData.creator_role || null,
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
    `INSERT INTO games (id, room_code, creator_id, opponent_id, game_type, creator_role, rounds, amount_per_round, round_seconds, payout_style, resign_rule, resign_definition, is_free, status, current_round, creator_score, opponent_score, pot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [game.id, game.room_code, game.creator_id, game.opponent_id, game.game_type, game.creator_role, game.rounds, game.amount_per_round, game.round_seconds, game.payout_style, game.resign_rule, game.resign_definition, game.is_free, game.status, game.current_round, game.creator_score, game.opponent_score, game.pot]
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

async function getGamesByStatus(statuses) {
  if (useMemory) {
    return [...memoryStore.games.values()]
      .filter(g => statuses.includes(g.status))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  const res = await pool.query(
    'SELECT * FROM games WHERE status = ANY($1) ORDER BY created_at DESC',
    [statuses]
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
    `INSERT INTO transactions (id, user_id, game_id, type, amount, status, paystack_reference, transfer_code, recipient_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      tx.id || `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tx.user_id,
      tx.game_id || null,
      tx.type,
      tx.amount,
      tx.status || 'pending',
      tx.paystack_reference || null,
      tx.transfer_code || null,
      tx.recipient_code || null,
    ]
  );
  return res.rows[0];
}

async function getTransactionByReference(reference) {
  if (!reference) return null;
  if (useMemory) {
    return [...memoryStore.transactions.values()].find(t => t.paystack_reference === reference) || null;
  }
  const res = await pool.query('SELECT * FROM transactions WHERE paystack_reference = $1 LIMIT 1', [reference]);
  return res.rows[0] || null;
}

async function updateTransaction(id, updates) {
  if (useMemory) {
    const tx = memoryStore.transactions.get(id);
    if (!tx) return null;
    Object.assign(tx, updates);
    return tx;
  }
  const keys = Object.keys(updates);
  const values = Object.values(updates);
  if (!keys.length) return null;
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const res = await pool.query(`UPDATE transactions SET ${setClause} WHERE id = $1 RETURNING *`, [id, ...values]);
  return res.rows[0] || null;
}

async function getTransactionsByUser(userId) {
  if (useMemory) {
    return [...memoryStore.transactions.values()].filter(t => t.user_id === userId);
  }
  const res = await pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return res.rows;
}

// ---- Withdrawal request helpers ----
async function createWithdrawalRequest(wr) {
  const w = {
    id: `wr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    user_id: wr.user_id,
    full_name: wr.full_name,
    account_number: wr.account_number,
    bank_name: wr.bank_name,
    amount: wr.amount,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  if (useMemory) {
    memoryStore.withdrawalRequests.set(w.id, w);
    return w;
  }
  await pool.query(
    `INSERT INTO withdrawal_requests (id, user_id, full_name, account_number, bank_name, amount, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [w.id, w.user_id, w.full_name, w.account_number, w.bank_name, w.amount, w.status]
  );
  return w;
}

async function getWithdrawalRequest(id) {
  if (useMemory) {
    return memoryStore.withdrawalRequests.get(id) || null;
  }
  const res = await pool.query('SELECT * FROM withdrawal_requests WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function getWithdrawalRequestsByUser(userId) {
  if (useMemory) {
    return [...memoryStore.withdrawalRequests.values()]
      .filter(w => w.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  const res = await pool.query('SELECT * FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return res.rows;
}

async function getAllWithdrawalRequests(status) {
  if (useMemory) {
    const rows = [...memoryStore.withdrawalRequests.values()];
    const filtered = status ? rows.filter(w => w.status === status) : rows;
    return filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  const res = status
    ? await pool.query('SELECT * FROM withdrawal_requests WHERE status = $1 ORDER BY created_at DESC', [status])
    : await pool.query('SELECT * FROM withdrawal_requests ORDER BY created_at DESC');
  return res.rows;
}

async function updateWithdrawalRequest(id, updates) {
  if (useMemory) {
    const w = memoryStore.withdrawalRequests.get(id);
    if (!w) return null;
    Object.assign(w, updates);
    return w;
  }
  const keys = Object.keys(updates);
  const values = Object.values(updates);
  if (!keys.length) return null;
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const res = await pool.query(`UPDATE withdrawal_requests SET ${setClause} WHERE id = $1 RETURNING *`, [id, ...values]);
  return res.rows[0] || null;
}

async function getAllGames(limit = 200) {
  if (useMemory) {
    return [...memoryStore.games.values()]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }
  const res = await pool.query(
    'SELECT * FROM games ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return res.rows;
}

async function getAllUsersWithBalance() {
  if (useMemory) {
    const users = [...memoryStore.users.values()].map(u => {
      const wallet = memoryStore.wallets.get(u.id) || { balance: 0 };
      return { ...u, balance: wallet.balance };
    });
    return users.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
  }
  const res = await pool.query(
    'SELECT u.id, u.telegram_id, u.username, u.tg_username, u.email, COALESCE(w.balance, 0)::numeric AS balance, u.created_at ' +
    'FROM users u LEFT JOIN wallets w ON u.id = w.user_id ORDER BY u.username ASC'
  );
  return res.rows;
}

module.exports = {
  initDb,
  getDbMode,
  getOrCreateUser,
  getUserByTelegramId,
  getUserByUsername,
  getUserById,
  updateUser,
  getWallet,
  addFunds,
  deductFunds,
  createGame,
  getGameByRoomCode,
  getGameById,
  getGamesByUserAndStatus,
  getGamesByStatus,
  deleteGame,
  updateGame,
  createTransaction,
  getTransactionByReference,
  updateTransaction,
  getTransactionsByUser,
  createWithdrawalRequest,
  getWithdrawalRequest,
  getWithdrawalRequestsByUser,
  getAllWithdrawalRequests,
  updateWithdrawalRequest,
  getAllGames,
  getAllUsersWithBalance,
};