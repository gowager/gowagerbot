// GoWager Telegram Mini App - Frontend Logic
const API_URL = 'https://gowager-backend.onrender.com'; // Update with your deployed backend URL
const socket = io(API_URL);

// Telegram WebApp
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#17212b');
  tg.setBackgroundColor('#17212b');
}

// State
let currentUser = null;
let currentGame = null;
let currentRoomCode = null;
let isCreator = false;
let isFreeMode = false;
let myChoice = null;
let timerInterval = null;
let roundDeadline = null;
let opponentHistory = [];
let rbRoleIsDealer = false;
let rbSelectedRole = null;
const pendingGamesCache = {};

// ---------- UTILITIES ----------

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (tg) tg.HapticFeedback?.selectionChanged();
  if (id === 'screen-welcome') loadPendingGames();
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
  if (tg) {
    if (type === 'error') tg.HapticFeedback?.notificationOccurred('error');
    else if (type === 'success') tg.HapticFeedback?.notificationOccurred('success');
  }
}

function showModal(title, message, onYes, onNo) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="modal-buttons">
        <button class="btn-primary" id="modal-yes">Yes</button>
        <button class="btn-outline" id="modal-no">No</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('modal-yes').onclick = () => {
    overlay.remove();
    if (onYes) onYes();
  };
  document.getElementById('modal-no').onclick = () => {
    overlay.remove();
    if (onNo) onNo();
  };
}

async function api(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- USER AUTH ----------

async function initUser() {
  let telegramId;
  let username = 'Player';
  let tgUsername = null;

  // Get user from Telegram WebApp
  if (tg && tg.initDataUnsafe?.user) {
    telegramId = String(tg.initDataUnsafe.user.id);
    username = tg.initDataUnsafe.user.first_name || 'Player';
    tgUsername = tg.initDataUnsafe.user.username || null;
  } else {
    // Fallback for testing outside Telegram
    telegramId = localStorage.getItem('gowager_telegram_id');
    if (!telegramId) {
      telegramId = 'tg_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('gowager_telegram_id', telegramId);
    }
    username = localStorage.getItem('gowager_username') || 'Test Player';
  }

  try {
    const data = await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({ telegramId, username, tgUsername }),
    });
    currentUser = data.user;
    updateWallet(data.wallet.balance);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function updateWallet(balance) {
  document.getElementById('wallet-balance').textContent = Number(balance).toFixed(2);
  document.getElementById('wallet-balance-full').textContent = Number(balance).toFixed(2);
}

// ---------- GAME SELECTION ----------

function selectGame(game) {
  if (game === 'rps') {
    showScreen('screen-game-options');
  } else if (game === 'redblack') {
    rbSelectedRole = null;
    document.getElementById('rb-role-dealer-btn').style.opacity = '1';
    document.getElementById('rb-role-player-btn').style.opacity = '1';
    showScreen('screen-create-rb');
  }
}

// ---------- RED OR BLACK ----------

function setRbRole(role) {
  rbSelectedRole = role;
  document.getElementById('rb-role-dealer-btn').style.opacity = role === 'dealer' ? '1' : '0.45';
  document.getElementById('rb-role-player-btn').style.opacity = role === 'player' ? '1' : '0.45';
}

function updateRbPot() {
  const bet = parseInt(document.getElementById('rb-bet').value) || 1;
  const cards = parseInt(document.getElementById('rb-cards').value) || 1;
  const potEl = document.getElementById('rb-pot');
  const shareEl = document.getElementById('rb-share');
  if (potEl) potEl.textContent = (bet * cards * 2).toFixed(2);
  if (shareEl) shareEl.textContent = (bet * cards).toFixed(2);
}

async function createRbGame() {
  const opponentTelegramId = document.getElementById('rb-opponent-id').value.trim();
  const cards = parseInt(document.getElementById('rb-cards').value);
  const bet = parseInt(document.getElementById('rb-bet').value);

  if (!opponentTelegramId) return showToast('Enter your opponent\'s Telegram ID or @username', 'error');
  if (!rbSelectedRole) return showToast('Choose your role: Dealer or Player', 'error');
  if (cards < 1 || cards > 52) return showToast('Cards must be between 1 and 52', 'error');
  if (!isFreeMode && (bet < 1 || bet > 20)) return showToast('Bet must be between 1 and 20 GHS per card', 'error');

  try {
    const data = await api('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        creatorId: currentUser.id,
        opponentTelegramId,
        rounds: cards,
        amountPerRound: isFreeMode ? 0 : bet,
        roundSeconds: 60,
        payoutStyle: 'winner_takes_all',
        resignRule: 'full_pot',
        isFree: isFreeMode,
        gameType: 'redblack',
        creatorRole: rbSelectedRole,
      }),
    });

    currentGame = data.game;
    currentRoomCode = data.roomCode;
    isCreator = true;
    pendingGamesCache[data.game.id] = data.game;

    document.getElementById('room-code-display').textContent = data.roomCode;
    document.getElementById('edit-opponent-id').value = opponentTelegramId;
    showScreen('screen-room-code');
    applyLobbyState(data.game);

    const wallet = await api(`/api/wallet/${currentUser.id}`);
    updateWallet(wallet.balance);

    socket.emit('join_game_room', { gameId: currentGame.id, userId: currentUser.id });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function rbAmIDealer(game) {
  return isCreator ? game.creator_role === 'dealer' : game.creator_role === 'player';
}

function renderRbHand(hand) {
  const el = document.getElementById('rb-hand');
  el.innerHTML = hand.map((c, i) => `<button onclick="rbPick(${i})">🂠</button>`).join('');
}

function rbPick(cardIndex) {
  socket.emit('rb_dealer_pick', { gameId: currentGame.id, cardIndex });
  document.getElementById('rb-hand').innerHTML = '';
  if (tg) tg.HapticFeedback?.impactOccurred('medium');
}

function rbGuess(color) {
  socket.emit('rb_player_guess', { gameId: currentGame.id, guess: color });
  document.getElementById('rb-red-btn').disabled = true;
  document.getElementById('rb-black-btn').disabled = true;
}

// ---------- FREE PLAY ----------

function startFreePlay() {
  isFreeMode = true;
  showScreen('screen-games');
  showToast('Free mode! No money involved. 🎉', 'success');
}

// ---------- STEPPER & SEGMENTED CONTROLS ----------

function stepValue(id, delta) {
  const input = document.getElementById(id);
  const min = parseInt(input.min);
  const max = parseInt(input.max);
  let val = parseInt(input.value) + delta;
  if (val < min) val = min;
  if (val > max) val = max;
  input.value = val;
  updateTotalPot();
  if (tg) tg.HapticFeedback?.impactOccurred('light');
}

function selectSeg(btn, hiddenId) {
  const parent = btn.parentElement;
  parent.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(hiddenId).value = btn.dataset.val;
  if (tg) tg.HapticFeedback?.selectionChanged();
}

function updateTotalPot() {
  const rounds = parseInt(document.getElementById('rounds').value) || 1;
  const amount = parseInt(document.getElementById('amount').value) || 1;
  const yourStake = rounds * amount;      // Your deposit (rounds × amount)
  const totalPot = yourStake * 2;         // Total pot = both players' stakes
  document.getElementById('total-pot').textContent = totalPot.toFixed(2) + ' GHS';
  document.getElementById('your-share').textContent = yourStake.toFixed(2);
}

// ---------- CREATE GAME ----------

async function createGame() {
  const opponentTelegramId = document.getElementById('opponent-id').value.trim();
  const rounds = parseInt(document.getElementById('rounds').value);
  const amountPerRound = parseInt(document.getElementById('amount').value);
  const roundSeconds = parseInt(document.getElementById('round-seconds').value);
  const payoutStyle = document.getElementById('payout-style').value;
  const resignRule = document.getElementById('resign-rule').value;

  if (!opponentTelegramId) {
    showToast('Enter your opponent\'s Telegram ID or @username', 'error');
    return;
  }
  if (rounds < 1 || rounds > 25) {
    showToast('Rounds must be 1-25', 'error');
    return;
  }
  if (!isFreeMode && (amountPerRound < 1 || amountPerRound > 50)) {
    showToast('Amount must be 1-50 GHS', 'error');
    return;
  }

  try {
    const data = await api('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        creatorId: currentUser.id,
        opponentTelegramId,
        rounds,
        amountPerRound: isFreeMode ? 0 : amountPerRound,
        roundSeconds,
        payoutStyle,
        resignRule,
        isFree: isFreeMode,
      }),
    });

    currentGame = data.game;
    currentRoomCode = data.roomCode;
    isCreator = true;
    pendingGamesCache[data.game.id] = data.game;

    document.getElementById('room-code-display').textContent = data.roomCode;
    document.getElementById('edit-opponent-id').value = opponentTelegramId;
    showScreen('screen-room-code');
    applyLobbyState(data.game);

    const wallet = await api(`/api/wallet/${currentUser.id}`);
    updateWallet(wallet.balance);

    socket.emit('join_game_room', { gameId: currentGame.id, userId: currentUser.id });
    showToast('Game created! Share the room code.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function copyRoomCode() {
  const code = document.getElementById('room-code-display').textContent;
  navigator.clipboard.writeText(code).then(() => {
    showToast('Room code copied!', 'success');
  });
}

async function editOpponent() {
  const newOpponentId = document.getElementById('edit-opponent-id').value.trim();
  if (!newOpponentId) {
    showToast('Enter a new Telegram ID', 'error');
    return;
  }
  showToast('Opponent ID updated', 'success');
}

// ---------- JOIN GAME ----------

function renderRulesContent(game) {
  const rulesContent = document.getElementById('rules-content');
  const isFree = !!game.is_free;
  const isRb = game.game_type === 'redblack';
  // Stake is the same for both games: rounds (cards) × amount per round
  const stake = Number(game.rounds) * Number(game.amount_per_round);
  let rows;
  if (isRb) {
    rows = `
      <div class="rule-row"><span class="rule-label">Game</span><span class="rule-value">Red or Black 🃏</span></div>
      <div class="rule-row"><span class="rule-label">Mode</span><span class="rule-value">${isFree ? '🎉 FREE' : '💰 Paid'}</span></div>
      <div class="rule-row"><span class="rule-label">Cards</span><span class="rule-value">${game.rounds}</span></div>
      <div class="rule-row"><span class="rule-label">Bet per Card</span><span class="rule-value">${isFree ? 'FREE' : game.amount_per_round + ' GHS'}</span></div>
      <div class="rule-row"><span class="rule-label">Total Pot</span><span class="rule-value">${isFree ? 'FREE' : (stake * 2).toFixed(2) + ' GHS'}</span></div>
      <div class="rule-row"><span class="rule-label">Your Deposit (Stake)</span><span class="rule-value">${isFree ? 'FREE' : stake.toFixed(2) + ' GHS'}</span></div>
      <div class="rule-row"><span class="rule-label">Creator's Role</span><span class="rule-value">${game.creator_role === 'dealer' ? '🎩 Dealer' : '🎯 Player'}</span></div>
      <div class="rule-row"><span class="rule-label">How It Works</span><span class="rule-value">Dealer picks a hidden card - player guesses Red or Black</span></div>
    `;
  } else {
    rows = `
      <div class="rule-row"><span class="rule-label">Game</span><span class="rule-value">Rock Paper Scissors</span></div>
      <div class="rule-row"><span class="rule-label">Mode</span><span class="rule-value">${isFree ? '🎉 FREE' : '💰 Paid'}</span></div>
      <div class="rule-row"><span class="rule-label">Rounds</span><span class="rule-value">${game.rounds}</span></div>
      <div class="rule-row"><span class="rule-label">Amount per Round</span><span class="rule-value">${isFree ? 'FREE' : game.amount_per_round + ' GHS'}</span></div>
      <div class="rule-row"><span class="rule-label">Total Pot</span><span class="rule-value">${isFree ? 'FREE' : (stake * 2).toFixed(2) + ' GHS'}</span></div>
      <div class="rule-row"><span class="rule-label">Your Deposit (Stake)</span><span class="rule-value">${isFree ? 'FREE' : stake.toFixed(2) + ' GHS'}</span></div>
      <div class="rule-row"><span class="rule-label">Time/Round</span><span class="rule-value">${game.round_seconds}s</span></div>
      <div class="rule-row"><span class="rule-label">Payout</span><span class="rule-value">${game.payout_style === 'winner_takes_all' ? 'Winner Takes All' : 'Per Game'}</span></div>
      <div class="rule-row"><span class="rule-label">Resign Rule</span><span class="rule-value">${game.resign_rule === 'full_pot' ? 'Full Pot' : 'Per Game'}</span></div>
      <div class="rule-row"><span class="rule-label">Resignation</span><span class="rule-value">No choice 2 rounds</span></div>
    `;
  }
  rulesContent.innerHTML = rows;
}

async function joinGame() {
  const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!roomCode) {
    showToast('Enter a room code', 'error');
    return;
  }

  try {
    const game = await api(`/api/games/room/${roomCode}`);
    currentGame = game;
    currentRoomCode = roomCode;
    isCreator = false;

    renderRulesContent(game);

    showScreen('screen-game-rules');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function agreeAndDeposit() {
  // Free games: skip deposit screen, join directly
  if (currentGame.is_free) {
    await processDeposit();
    return;
  }
  // Each player deposits their full stake: rounds (cards) × amount per round
  const yourStake = currentGame.rounds * currentGame.amount_per_round;
  document.getElementById('deposit-amount').textContent = yourStake.toFixed(2) + ' GHS';
  showScreen('screen-deposit');
}

async function processDeposit() {
  try {
    const data = await api(`/api/games/${currentRoomCode}/join`, {
      method: 'POST',
      body: JSON.stringify({ playerId: currentUser.id }),
    });

    currentGame = data.game;
    pendingGamesCache[data.game.id] = data.game;
    const wallet = await api(`/api/wallet/${currentUser.id}`);
    updateWallet(wallet.balance);

    socket.emit('join_game_room', { gameId: currentGame.id, userId: currentUser.id });

    document.getElementById('lobby-room').textContent = currentRoomCode;
    showScreen('screen-lobby');
    applyLobbyState(data.game);
    showToast('Deposit successful!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function startGame() {
  if (!currentGame) return;
  socket.emit('player_ready', { gameId: currentGame.id });
  applyLobbyState({ ...currentGame, status: 'ready' }, [currentUser.id]);
}

// ---------- LOBBY / PENDING GAMES ----------

function applyLobbyState(game, readyPlayers = []) {
  if (!game || !currentUser) return;
  currentGame = game;
  const iAmReady = readyPlayers.includes(currentUser.id);
  let statusText, showStart;
  if (game.status === 'pending') {
    statusText = 'Waiting for opponent to join...';
    showStart = false;
  } else if (game.status === 'ready') {
    showStart = !iAmReady;
    statusText = iAmReady
      ? 'You are ready. Waiting for opponent to press Start...'
      : 'Opponent is in! Both players press Start to begin.';
  } else {
    return;
  }
  [['start-game-btn', 'lobby-status'], ['creator-start-btn', 'creator-lobby-status']].forEach(([btnId, statusId]) => {
    const btn = document.getElementById(btnId);
    const st = document.getElementById(statusId);
    if (btn) btn.style.display = showStart ? 'block' : 'none';
    if (st) st.textContent = statusText;
  });
}

async function loadPendingGames() {
  if (!currentUser) return;
  try {
    const games = await api(`/api/games/player/${currentUser.id}/pending`);
    const container = document.getElementById('pending-games');
    if (!container) return;
    games.forEach(g => { pendingGamesCache[g.id] = g; });
    if (games.length === 0) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = '<h3 style="margin:14px 0 8px;font-size:16px;">My Games</h3>' + games.map(g => `
      <div style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #35465c;border-radius:10px;margin-bottom:8px;">
        <span style="flex:1;font-size:14px;">
          <strong>${g.room_code}</strong> · ${g.status === 'ready' ? 'Ready to start' : 'Waiting for opponent'}${g.is_free ? ' · FREE' : ''}
        </span>
        <button class="btn-outline btn-sm" onclick="enterPendingGame('${g.id}')">Enter</button>
        ${g.creator_id === currentUser.id ? `<button class="btn-outline btn-sm" onclick="cancelPendingGame('${g.id}')">Delete</button>` : ''}
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load pending games:', err);
  }
}

function enterPendingGame(gameId) {
  const game = pendingGamesCache[gameId];
  if (!game || !currentUser) return;
  currentGame = game;
  currentRoomCode = game.room_code;
  isCreator = game.creator_id === currentUser.id;
  socket.emit('join_game_room', { gameId: game.id, userId: currentUser.id });

  if (game.status === 'pending' && !isCreator) {
    renderRulesContent(game);
    showScreen('screen-game-rules');
  } else if (isCreator) {
    document.getElementById('room-code-display').textContent = game.room_code;
    showScreen('screen-room-code');
    applyLobbyState(game);
  } else {
    document.getElementById('lobby-room').textContent = game.room_code;
    showScreen('screen-lobby');
    applyLobbyState(game);
  }
}

function cancelPendingGame(gameId) {
  showModal('Delete this game?', 'The room will be closed and any deposited stakes refunded in full.', async () => {
    try {
      await api(`/api/games/${gameId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ playerId: currentUser.id }),
      });
      showToast('Game deleted. Stake refunded.', 'success');
      loadPendingGames();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// ---------- OPPONENT PATTERN HINT ----------

function updateOpponentHint() {
  const el = document.getElementById('opponent-hint');
  if (!el) return;
  const h = opponentHistory;
  if (h.length < 2) { el.textContent = ''; return; }
  const counters = { rock: 'Paper', paper: 'Scissors', scissors: 'Rock' };
  let predicted, reason;
  if (h[h.length - 1] === h[h.length - 2]) {
    predicted = h[h.length - 1];
    reason = `has played ${predicted} twice in a row`;
  } else {
    const counts = { rock: 0, paper: 0, scissors: 0 };
    h.slice(-6).forEach(c => counts[c]++);
    predicted = Object.keys(counts).reduce((a, b) => (counts[a] >= counts[b] ? a : b));
    reason = `favors ${predicted}`;
  }
  el.textContent = `💡 Opponent ${reason} — try ${counters[predicted]}!`;
}

// ---------- GAME PLAY ----------

function makeChoice(choice) {
  if (!currentGame || currentGame.status !== 'in_progress') {
    showToast('Game not in progress', 'error');
    return;
  }
  if (myChoice) {
    showToast('Already chose this round', 'error');
    return;
  }

  myChoice = choice;
  socket.emit('submit_choice', { gameId: currentGame.id, choice });

  document.querySelectorAll('.rps-btn').forEach(btn => btn.disabled = true);
  document.getElementById('round-result').textContent = 'Waiting for opponent...';
  document.getElementById('round-result').className = 'round-result';
  if (tg) tg.HapticFeedback?.impactOccurred('medium');
}

function confirmResign() {
  showModal('Resign?', 'Are you sure you want to quit?', () => {
    socket.emit('resign', { gameId: currentGame.id });
  });
}

function startTimer(deadline) {
  clearInterval(timerInterval);
  roundDeadline = deadline;
  const totalSeconds = currentGame?.round_seconds || 60;
  timerInterval = setInterval(() => {
    const remaining = Math.max(0, Math.floor((roundDeadline - Date.now()) / 1000));
    document.getElementById('timer').textContent = remaining;
    const fill = document.getElementById('timer-fill');
    if (fill) fill.style.width = `${(remaining / totalSeconds) * 100}%`;
    if (remaining <= 0) {
      clearInterval(timerInterval);
    }
  }, 1000);
}

// ---------- SOCKET EVENTS ----------

socket.on('game_state', (data) => {
  currentGame = data.game;
  opponentHistory = [];
  updateOpponentHint();
  if (data.game.status === 'in_progress') {
    if (data.game.game_type === 'redblack') {
      rbRoleIsDealer = rbAmIDealer(data.game);
      document.getElementById('rb-role-label').textContent = rbRoleIsDealer ? 'You are the Dealer 🎩' : 'You are the Player 🎯';
      document.getElementById('rb-total').textContent = data.game.rounds;
      showScreen('screen-play-rb');
    } else {
      showScreen('screen-play');
    }
    document.getElementById('current-round').textContent = data.game.current_round;
    document.getElementById('total-rounds').textContent = data.game.rounds;
    document.getElementById('my-score').textContent = isCreator ? data.game.creator_score : data.game.opponent_score;
    document.getElementById('opp-score').textContent = isCreator ? data.game.opponent_score : data.game.creator_score;
    if (data.deadline) startTimer(data.deadline);
  } else if (data.game.status === 'pending' || data.game.status === 'ready') {
    applyLobbyState(data.game, data.readyPlayers || []);
  }
});

socket.on('lobby_update', (data) => {
  applyLobbyState(data.game, data.readyPlayers || []);
});

socket.on('game_started', (data) => {
  currentGame = data.game;
  myChoice = null;
  opponentHistory = [];
  updateOpponentHint();
  if (data.game.game_type === 'redblack') {
    rbRoleIsDealer = rbAmIDealer(data.game);
    document.getElementById('rb-role-label').textContent = rbRoleIsDealer ? 'You are the Dealer 🎩' : 'You are the Player 🎯';
    document.getElementById('rb-my-score').textContent = 0;
    document.getElementById('rb-opp-score').textContent = 0;
    document.getElementById('rb-round').textContent = 1;
    document.getElementById('rb-total').textContent = data.game.rounds;
    document.getElementById('rb-result').textContent = '';
    document.getElementById('rb-hand').innerHTML = '';
    document.getElementById('rb-card-area').innerHTML = '<div class="rb-card-face-down">🂠</div>';
    showScreen('screen-play-rb');
  } else {
    document.getElementById('current-round').textContent = 1;
    document.getElementById('total-rounds').textContent = data.game.rounds;
    document.getElementById('my-score').textContent = 0;
    document.getElementById('opp-score').textContent = 0;
    showToast('Both players ready — game started!', 'success');
    showScreen('screen-play');
  }
});

// ---------- RED OR BLACK SOCKET EVENTS ----------

socket.on('rb_round_started', (data) => {
  document.getElementById('rb-round').textContent = data.round;
  document.getElementById('rb-total').textContent = data.totalCards;
  document.getElementById('rb-result').textContent = '';
  document.getElementById('rb-card-area').innerHTML = '<div class="rb-card-face-down">🂠</div>';
  document.getElementById('rb-status').textContent = rbRoleIsDealer ? 'Pick a card to play' : 'Dealer is picking a card...';
});

socket.on('rb_your_hand', (data) => {
  renderRbHand(data.hand);
});

socket.on('rb_wait_dealer', () => {
  document.getElementById('rb-hand').innerHTML = '';
  document.getElementById('rb-red-btn').disabled = true;
  document.getElementById('rb-black-btn').disabled = true;
});

socket.on('rb_dealer_picked', () => {
  if (rbRoleIsDealer) {
    document.getElementById('rb-status').textContent = 'Waiting for opponent\'s guess...';
  } else {
    document.getElementById('rb-status').textContent = 'Card picked! Guess Red or Black';
    document.getElementById('rb-red-btn').disabled = false;
    document.getElementById('rb-black-btn').disabled = false;
  }
});

socket.on('rb_round_result', (data) => {
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  document.getElementById('rb-card-area').innerHTML =
    `<div class="rb-card ${data.card.color}">${data.card.rank}<br>${data.card.suit}</div>`;
  const guessText = rbRoleIsDealer ? `Player guessed ${cap(data.guess)}` : `You guessed ${cap(data.guess)}`;
  const outcome = data.roundWinner === currentUser.id ? 'You win the card! 🎉' : 'You lose the card!';
  document.getElementById('rb-result').textContent =
    `${data.card.rank}${data.card.suit} is ${cap(data.card.color)} — ${guessText}. ${outcome}`;
  document.getElementById('rb-my-score').textContent = isCreator ? data.creatorScore : data.opponentScore;
  document.getElementById('rb-opp-score').textContent = isCreator ? data.opponentScore : data.creatorScore;
  document.getElementById('rb-red-btn').disabled = true;
  document.getElementById('rb-black-btn').disabled = true;
});

socket.on('game_cancelled', (data) => {
  showToast(data.message || 'Game cancelled', 'error');
  currentGame = null;
  loadPendingGames();
  showScreen('screen-welcome');
});

socket.on('round_started', (data) => {
  document.getElementById('current-round').textContent = data.round;
  document.getElementById('total-rounds').textContent = currentGame.rounds;
  myChoice = null;
  document.querySelectorAll('.rps-btn').forEach(btn => btn.disabled = false);
  document.getElementById('round-result').textContent = '';
  document.getElementById('round-result').className = 'round-result';
  startTimer(data.deadline);
});

socket.on('round_result', (data) => {
  clearInterval(timerInterval);
  const resultEl = document.getElementById('round-result');
  const myId = currentUser.id;
  const myScore = isCreator ? data.creatorScore : data.opponentScore;
  const oppScore = isCreator ? data.opponentScore : data.creatorScore;
  document.getElementById('my-score').textContent = myScore;
  document.getElementById('opp-score').textContent = oppScore;

  opponentHistory.push(isCreator ? data.opponentChoice : data.creatorChoice);
  updateOpponentHint();

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const myChoiceMade = isCreator ? data.creatorChoice : data.opponentChoice;
  const oppChoiceMade = isCreator ? data.opponentChoice : data.creatorChoice;
  if (data.roundWinner === 'tie') {
    resultEl.textContent = `You chose ${cap(myChoiceMade)}, opponent chose ${cap(oppChoiceMade)} — It's a tie!`;
    resultEl.className = 'round-result tie';
  } else if (data.roundWinner === myId) {
    resultEl.textContent = `You chose ${cap(myChoiceMade)}, opponent chose ${cap(oppChoiceMade)} — You win! 🎉`;
    resultEl.className = 'round-result win';
  } else {
    resultEl.textContent = `You chose ${cap(myChoiceMade)}, opponent chose ${cap(oppChoiceMade)} — You lose!`;
    resultEl.className = 'round-result lose';
  }
});

socket.on('game_over', (data) => {
  clearInterval(timerInterval);
  const content = document.getElementById('game-over-content');
  const myId = currentUser.id;
  const isWinner = data.winnerId === myId;
  const isFree = data.isFree || currentGame?.is_free;

  if (isFree) {
    if (data.tie) {
      content.innerHTML = `
        <div class="winner">It's a Tie!</div>
        <p>Great game! No money involved. 🎉</p>
      `;
    } else if (isWinner) {
      content.innerHTML = `
        <div class="winner">You Won! 🏆</div>
        <p>Bragging rights earned! No money involved. 🎉</p>
        <p>${data.reason === 'resignation' ? 'Opponent resigned' : data.reason === 'auto_resign_timeout' ? 'Opponent timed out' : 'Game completed'}</p>
      `;
    } else {
      content.innerHTML = `
        <div class="winner">You Lost</div>
        <p>Better luck next time! No money involved. 🎉</p>
      `;
    }
  } else if (data.tie) {
    content.innerHTML = `
      <div class="winner">It's a Tie!</div>
      <p>Both players get a refund.</p>
      <div class="amount">${Number(data.winnerAmount).toFixed(2)} GHS each</div>
      <div class="fee">GoWager fee: ${Number(data.fee).toFixed(2)} GHS</div>
    `;
  } else if (isWinner) {
    content.innerHTML = `
      <div class="winner">You Won! 🏆</div>
      <div class="amount">+${Number(data.winnerAmount).toFixed(2)} GHS</div>
      <div class="fee">GoWager fee: ${Number(data.fee).toFixed(2)} GHS</div>
      <p>${data.reason === 'resignation' ? 'Opponent resigned' : data.reason === 'auto_resign_timeout' ? 'Opponent timed out' : 'Game completed'}</p>
    `;
  } else {
    content.innerHTML = `
      <div class="winner">You Lost</div>
      <p>Better luck next time!</p>
      <div class="fee">GoWager fee: ${Number(data.fee).toFixed(2)} GHS</div>
    `;
  }

  showScreen('screen-game-over');
  api(`/api/wallet/${currentUser.id}`).then(w => updateWallet(w.balance));
});

socket.on('timeout_warning', (data) => {
  showToast('Time up! Random choice assigned.', 'info');
});

socket.on('error', (message) => {
  showToast(message, 'error');
});

// ---------- WALLET ----------

async function withdraw() {
  const amount = parseInt(document.getElementById('withdraw-amount').value);
  if (!amount || amount < 1 || amount > 50) {
    showToast('Enter a valid amount (1-50 GHS)', 'error');
    return;
  }
  try {
    const data = await api('/api/withdraw', {
      method: 'POST',
      body: JSON.stringify({ userId: currentUser.id, amount }),
    });
    updateWallet(data.wallet.balance);
    showToast('Withdrawal request submitted!', 'success');
    loadTransactions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadTransactions() {
  if (!currentUser) return;
  try {
    const txs = await api(`/api/transactions/${currentUser.id}`);
    const container = document.getElementById('transactions');
    container.innerHTML = '<h3 style="font-size:15px;color:var(--tg-hint);margin-bottom:10px">Recent Transactions</h3>';
    if (txs.length === 0) {
      container.innerHTML += '<p style="color:var(--tg-hint);font-size:13px">No transactions yet</p>';
      return;
    }
    txs.forEach(tx => {
      const isPositive = ['game_win', 'game_refund'].includes(tx.type);
      const typeLabels = {
        game_deposit: 'Game Deposit',
        game_win: 'Game Win',
        game_refund: 'Game Refund',
        withdrawal: 'Withdrawal',
      };
      container.innerHTML += `
        <div class="tx-item">
          <span class="tx-type">${typeLabels[tx.type] || tx.type}</span>
          <span class="tx-amount ${isPositive ? 'positive' : 'negative'}">${isPositive ? '+' : '-'}${Number(tx.amount).toFixed(2)} GHS</span>
        </div>
      `;
    });
  } catch (err) {
    console.error('Failed to load transactions:', err);
  }
}

// ---------- INIT ----------

document.addEventListener('DOMContentLoaded', async () => {
  await initUser();
  updateTotalPot();
  loadPendingGames();
  document.getElementById('rb-bet').addEventListener('input', updateRbPot);
  const rbCardsInput = document.getElementById('rb-cards');
  if (rbCardsInput) rbCardsInput.addEventListener('input', updateRbPot);
});