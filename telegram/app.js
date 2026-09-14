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
let lastRoundInfo = null;
let rbRoleIsDealer = false;
let rbSelectedRole = null;
const pendingGamesCache = {};
let activeScreen = 'screen-welcome';

// ---------- UTILITIES ----------

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  activeScreen = id;
  if (tg) tg.HapticFeedback?.selectionChanged();
  if (id === 'screen-welcome') { loadPendingGames(); isFreeMode = false; }
  if (id === 'screen-create-game') applyFreeModeUI('rps');
  if (id === 'screen-create-rb') applyFreeModeUI('rb');
  if (id === 'screen-create-wz') applyFreeModeUI('wz');
  if (id === 'screen-create-ttt') applyFreeModeUI('ttt');
}

function applyFreeModeUI(type) {
  const free = isFreeMode;
  const prefix = type === 'rps' ? 'rps' : type === 'rb' ? 'rb' : type === 'wz' ? 'wz' : 'ttt';
  const potDisplay = document.getElementById(`${prefix}-pot-display`);
  const freeBadge  = document.getElementById(`${prefix}-free-badge`);
  if (potDisplay) potDisplay.style.display = free ? 'none' : '';
  if (freeBadge)  freeBadge.style.display  = free ? '' : 'none';
  const shareRow = document.getElementById(`${prefix}-share-row`);
  if (shareRow) shareRow.style.display = free ? 'none' : '';
  const amountIds = {
    rps: ['rps-amount-group'],
    rb:  ['rb-bet-group'],
    wz:  ['wz-stake-group'],
    ttt: ['ttt-stake-group'],
  };
  (amountIds[type] || []).forEach(elId => {
    const el = document.getElementById(elId);
    if (el) el.style.display = free ? 'none' : '';
  });
  if (!free && currentUser) {
    api(`/api/wallet/${currentUser.id}`).then(w => updateWallet(w.balance));
  }
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

let lastSelectedGame = null;

function selectGame(game) {
  lastSelectedGame = game;
  if (game === 'rps') {
    showScreen('screen-game-options');
  } else if (game === 'redblack') {
    rbSelectedRole = null;
    document.getElementById('rb-role-dealer-btn').style.opacity = '1';
    document.getElementById('rb-role-player-btn').style.opacity = '1';
    showScreen('screen-rb-options');
  } else if (game === 'warzone') {
    showScreen('screen-wz-options');
  } else if (game === 'tictactoe') {
    showScreen('screen-ttt-options');
  }
}

// Join screen back button returns to whichever game's options screen sent us there
function backToOptions() {
  if (lastSelectedGame === 'redblack') showScreen('screen-rb-options');
  else if (lastSelectedGame === 'warzone') showScreen('screen-wz-options');
  else if (lastSelectedGame === 'tictactoe') showScreen('screen-ttt-options');
  else showScreen('screen-game-options');
}

// ---------- RED OR BLACK ----------

function setRbRole(role) {
  rbSelectedRole = role;
  document.getElementById('rb-role-dealer-btn').style.opacity = role === 'dealer' ? '1' : '0.45';
  document.getElementById('rb-role-player-btn').style.opacity = role === 'player' ? '1' : '0.45';
}

function updateRbPot() {
  const bet = parseInt(document.getElementById('rb-bet').value) || 50;
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
  if (!isFreeMode && (bet < 50 || bet > 500 || bet % 10 !== 0)) return showToast('Bet must be 50-500 NGN per card, in multiples of 10', 'error');

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

// ---------- WAR ZONE ----------

const WZ_EMOJI = '🚀';
const WZ_CELL_IDS = [
  'A1', 'A2', 'A3', 'A4',
  'B1', 'B2', 'B3', 'B4',
  'C1', 'C2', 'C3', 'C4',
  'D1', 'D2', 'D3', 'D4',
];
let wzMyCells = new Set();
let wzPlaced = false;
let wzSubmitted = false;
let wzBattle = false;
let wzMyTurn = false;
let wzTimerInt = null;
let wzLastChance = false;
let wzMoveTimerInt = null;

function wzStartMoveCountdown(deadline) {
  clearInterval(wzMoveTimerInt);
  const el = document.getElementById('wz-move-timer');
  if (!el || !deadline) return;
  el.style.display = 'block';
  const tick = () => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    el.textContent = `⏱ ${left}s`;
    if (left <= 0) clearInterval(wzMoveTimerInt);
  };
  tick();
  wzMoveTimerInt = setInterval(tick, 500);
}
let wzEnemyMarks = new Map();
let wzIncomingMarks = new Map();

function wzRenderMyGrid() {
  const grid = document.getElementById('wz-my-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const id = WZ_CELL_IDS[i];
    const placed = wzMyCells.has(id);
    const incoming = wzIncomingMarks.get(id);
    const cell = document.createElement('div');
    cell.dataset.id = id;
    cell.className = 'wz-cell' + (placed ? ' mine' : '');
    if (placed && incoming) cell.classList.add('sunk');
    const face = incoming ? incoming.txt : (placed ? WZ_EMOJI : '');
    cell.innerHTML = `<span class="wz-cell-id">${id}</span><span class="wz-cell-face">${face}</span>`;
    grid.appendChild(cell);
  }
}

function updateWzPot() {
  const stake = parseInt(document.getElementById('wz-stake').value) || 50;
  const potEl = document.getElementById('wz-pot');
  const shareEl = document.getElementById('wz-share');
  if (potEl) potEl.textContent = (stake * 2).toFixed(2);
  if (shareEl) shareEl.textContent = stake.toFixed(2);
}

async function createWzGame() {
  const opponentTelegramId = document.getElementById('wz-opponent-id').value.trim();
  const stake = parseInt(document.getElementById('wz-stake').value);
  if (!opponentTelegramId) return showToast('Enter your opponent\'s Telegram ID or @username', 'error');
  if (!isFreeMode && (stake < 50 || stake > 500 || stake % 10 !== 0)) return showToast('Stake must be 50-500 NGN per match, in multiples of 10', 'error');
  try {
    const data = await api('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        creatorId: currentUser.id,
        opponentTelegramId,
        rounds: 1,
        amountPerRound: isFreeMode ? 0 : stake,
        roundSeconds: parseInt(document.getElementById('wz-move-seconds').value) || 20,
        payoutStyle: 'winner_takes_all',
        resignRule: 'full_pot',
        isFree: isFreeMode,
        gameType: 'warzone',
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

function wzResetLocal() {
  clearInterval(wzTimerInt);
  clearInterval(wzMoveTimerInt);
  const mt = document.getElementById('wz-move-timer');
  if (mt) mt.style.display = 'none';
  wzMyCells = new Set();
  wzPlaced = false;
  wzSubmitted = false;
  wzBattle = false;
  wzMyTurn = false;
  wzEnemyMarks = new Map();
  document.getElementById('wz-my-hits').textContent = '0';
  document.getElementById('wz-opp-hits').textContent = '0';
  document.getElementById('wz-result-msg').textContent = '';
  document.getElementById('wz-status').textContent = '';
  document.getElementById('wz-timer-box').style.display = 'none';
  document.getElementById('wz-confirm-box').style.display = 'none';
  document.getElementById('wz-enemy-section').style.display = 'none';
  document.getElementById('wz-my-grid').innerHTML = '';
  document.getElementById('wz-enemy-grid').innerHTML = '';
  document.getElementById('wz-phase-label').textContent = 'Placing rockets';
}

function wzRenderPlacementGrid() {
  const grid = document.getElementById('wz-my-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const id = WZ_CELL_IDS[i];
    const placed = wzMyCells.has(id);
    const cell = document.createElement('button');
    cell.dataset.id = id;
    cell.className = 'wz-cell' + (placed ? ' mine' : '');
    cell.innerHTML = `<span class="wz-cell-id">${id}</span><span class="wz-cell-face">${placed ? WZ_EMOJI : ''}</span>`;
    cell.onclick = () => {
      if (wzPlaced || wzBattle) return;
      wzToggleCell(id);
      if (tg) tg.HapticFeedback?.selectionChanged();
    };
    grid.appendChild(cell);
  }
  document.getElementById('wz-place-count').textContent = `${wzMyCells.size} / 4 placed`;
  document.getElementById('wz-confirm-btn').disabled = wzMyCells.size === 0 || wzPlaced;
}

function wzToggleCell(id) {
  if (wzPlaced || wzBattle) return;
  if (wzMyCells.has(id)) wzMyCells.delete(id);
  else if (wzMyCells.size < 4) wzMyCells.add(id);
  const cell = document.querySelector(`#wz-my-grid [data-id="${id}"]`);
  if (cell) {
    cell.classList.toggle('mine', wzMyCells.has(id));
    const face = cell.querySelector('.wz-cell-face');
    if (face) face.textContent = wzMyCells.has(id) ? WZ_EMOJI : '';
  }
  document.getElementById('wz-place-count').textContent = `${wzMyCells.size} / 4 placed`;
  document.getElementById('wz-confirm-btn').disabled = wzMyCells.size === 0 || wzPlaced;
  if (wzMyCells.size === 4) setTimeout(wzConfirm, 350);
}

function wzStartPlacementCountdown(seconds) {
  document.getElementById('wz-timer-box').style.display = 'block';
  const label = document.getElementById('wz-timer');
  let left = seconds;
  label.textContent = left;
  clearInterval(wzTimerInt);
  wzTimerInt = setInterval(() => {
    left -= 1;
    label.textContent = Math.max(left, 0);
    if (left === 2 && !wzPlaced && !wzSubmitted && wzMyCells.size >= 1) wzConfirm();
    if (left <= 0) clearInterval(wzTimerInt);
  }, 1000);
}

function wzConfirm() {
  if (wzPlaced || wzSubmitted || wzMyCells.size < 1) return;
  wzSubmitted = true;
  socket.emit('wz_place', { gameId: currentGame.id, cells: [...wzMyCells] });
}

socket.on('wz_placement_started', (data) => {
  wzResetLocal();
  document.getElementById('wz-timer-box').style.display = 'block';
  wzRenderPlacementGrid();
  wzStartPlacementCountdown(data.seconds || 30);
});

socket.on('wz_placed', () => {
  wzPlaced = true;
  document.getElementById('wz-confirm-box').style.display = 'none';
  document.getElementById('wz-status').textContent = 'Positions locked. Waiting for opponent...';
  wzRenderPlacementGrid();
});

socket.on('wz_battle_started', (data) => {
  clearInterval(wzTimerInt);
  wzBattle = true;
  wzPlaced = true;
  document.getElementById('wz-timer-box').style.display = 'none';
  document.getElementById('wz-confirm-box').style.display = 'none';
  document.getElementById('wz-phase-label').textContent = 'Battle!';
  if (data.creatorCells && data.opponentCells) {
    wzMyCells = new Set(isCreator ? data.creatorCells : data.opponentCells);
  }
  wzIncomingMarks = new Map();
  wzRenderMyGrid();
  wzEnemyMarks = new Map();
  wzMyTurn = isCreator ? data.turn === 'creator' : data.turn === 'opponent';
  wzRenderEnemyGrid();
  document.getElementById('wz-enemy-section').style.display = 'block';
  wzStartMoveCountdown(data.moveDeadline);
  wzUpdateBattleStatus();
});

function wzRenderEnemyGrid() {
  const grid = document.getElementById('wz-enemy-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const id = WZ_CELL_IDS[i];
    const marked = wzEnemyMarks.get(id);
    const cell = document.createElement('button');
    cell.dataset.id = id;
    cell.className = 'wz-cell' + (marked ? ` ${marked.cls}` : '');
    cell.innerHTML = `<span class="wz-cell-id">${id}</span><span class="wz-cell-face">${marked ? marked.txt : ''}</span>`;
    cell.disabled = !wzMyTurn || !!marked;
    cell.onclick = () => {
      if (!wzMyTurn || wzEnemyMarks.has(id)) return;
      wzMyTurn = false;
      cell.disabled = true;
      socket.emit('wz_guess', { gameId: currentGame.id, cell: id });
      wzUpdateBattleStatus();
      if (tg) tg.HapticFeedback?.impactOccurred('medium');
    };
    grid.appendChild(cell);
  }
}

function wzUpdateBattleStatus() {
  const status = document.getElementById('wz-status');
  if (wzLastChance) {
    if (wzMyTurn) status.textContent = '⚡ FINAL SHOT - hit to tie, miss and you lose!';
    else status.textContent = '⚡ Opponent\'s final shot - it\'s all or nothing!';
  } else if (wzMyTurn) status.textContent = '🎯 Your turn - fire at the enemy grid!';
  else status.textContent = '⏳ Waiting for opponent\'s shot...';
}

socket.on('wz_sync', (data) => {
  wzEnemyMarks = new Map();
  const wzEnemyHitSet = new Set(data.yourHits || []);
  (data.yourGuesses || []).forEach(c => wzEnemyMarks.set(c, wzEnemyHitSet.has(c) ? { cls: 'hit', txt: '🔥' } : { cls: 'miss', txt: '❌' }));
  if (data.yourCells) wzMyCells = new Set(data.yourCells);
  wzIncomingMarks = new Map();
  (data.incomingShots || []).forEach(c => {
    wzIncomingMarks.set(c, wzMyCells.has(c) ? { cls: 'sunk', txt: '💥' } : { cls: 'miss', txt: '💧' });
  });
  wzRenderMyGrid();
  wzMyTurn = isCreator ? data.turn === 'creator' : data.turn === 'opponent';
  wzLastChance = !!data.lastChance;
  document.getElementById('wz-my-hits').textContent = isCreator ? data.creatorHits : data.opponentHits;
  document.getElementById('wz-opp-hits').textContent = isCreator ? data.opponentHits : data.creatorHits;
  wzRenderEnemyGrid();
  wzStartMoveCountdown(data.moveDeadline);
  wzUpdateBattleStatus();
});

socket.on('wz_result', (data) => {
  const myShot = data.byCreator === isCreator;
  const msg = document.getElementById('wz-result-msg');
  document.getElementById('wz-my-hits').textContent = isCreator ? data.creatorHits : data.opponentHits;
  document.getElementById('wz-opp-hits').textContent = isCreator ? data.opponentHits : data.creatorHits;

  if (myShot) {
    wzEnemyMarks.set(data.cell, data.hit ? { cls: 'hit', txt: '🔥' } : { cls: 'miss', txt: '❌' });
    msg.textContent = data.hit ? '💥 HIT! Enemy rocket found!' : '💧 Miss — splash!';
  } else if (data.hit && wzMyCells.has(data.cell)) {
    wzIncomingMarks.set(data.cell, { cls: 'sunk', txt: '💥' });
    const c = document.querySelector(`#wz-my-grid [data-id="${data.cell}"]`);
    if (c) {
      c.classList.add('sunk');
      const face = c.querySelector('.wz-cell-face');
      if (face) face.textContent = '💥';
      else c.textContent = '💥';
    }
    msg.textContent = '😱 Your rocket was hit!';
  } else {
    wzIncomingMarks.set(data.cell, { cls: 'miss', txt: '💧' });
    msg.textContent = '😌 Opponent missed your waters.';
  }

  if (data.lastChance) {
    msg.textContent += ' ⚡ All 4 rockets hit! Opponent gets ONE final shot.';
  } else if (data.gameOver && data.tie) {
    msg.textContent = '🤝 TIE 4-4 - stakes refunded!';
  } else if (data.gameOver) {
    const myHits = isCreator ? data.creatorHits : data.opponentHits;
    const theirHits = isCreator ? data.opponentHits : data.creatorHits;
    msg.textContent = myHits > theirHits ? '🏆 YOU WIN! All enemy rockets gone!' : '😔 You lose - opponent sank your fleet.';
  }

  if (data.gameOver) wzMyTurn = false;
  wzRenderEnemyGrid();
  if (!data.gameOver) wzUpdateBattleStatus();
});

socket.on('wz_turn', (data) => {
  wzMyTurn = isCreator ? data.turn === 'creator' : data.turn === 'opponent';
  wzLastChance = !!data.lastChance;
  wzRenderEnemyGrid();
  wzStartMoveCountdown(data.moveDeadline);
  wzUpdateBattleStatus();
});

socket.on('wz_move_skipped', (data) => {
  const skippedMe = isCreator ? data.skippedTurn === 'creator' : data.skippedTurn === 'opponent';
  showToast(skippedMe ? '⏰ Time up - your turn was skipped!' : '⏰ Opponent took too long - turn skipped.', 'info');
});

// ---------- TIC TAC TOE ----------

let tttTimerInt = null;
let tttGameOver = false;
let tttMyMark = 'X';

function updateTttPot() {
  const stake = parseInt(document.getElementById('ttt-stake').value) || 50;
  const potEl = document.getElementById('ttt-pot');
  const shareEl = document.getElementById('ttt-share');
  if (potEl) potEl.textContent = (stake * 2).toFixed(2);
  if (shareEl) shareEl.textContent = stake.toFixed(2);
}

async function createTttGame() {
  const opponentTelegramId = document.getElementById('ttt-opponent-id').value.trim();
  const stake = parseInt(document.getElementById('ttt-stake').value);
  if (!opponentTelegramId) return showToast('Enter your opponent\'s Telegram ID or @username', 'error');
  if (!isFreeMode && (stake < 50 || stake > 500 || stake % 10 !== 0)) return showToast('Stake must be 50-500 NGN per match, in multiples of 10', 'error');
  try {
    const data = await api('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        creatorId: currentUser.id,
        opponentTelegramId,
        rounds: 1,
        amountPerRound: isFreeMode ? 0 : stake,
        roundSeconds: parseInt(document.getElementById('ttt-move-seconds').value) || 15,
        payoutStyle: 'winner_takes_all',
        resignRule: 'full_pot',
        isFree: isFreeMode,
        gameType: 'tictactoe',
      }),
    });
    currentGame = data.game;
    currentRoomCode = data.roomCode;
    isCreator = true;
    pendingGamesCache[data.game.id] = data.game;
    showScreen('screen-room-code');
    document.getElementById('room-code-display').textContent = data.roomCode;
    document.getElementById('edit-opponent-id').value = opponentTelegramId;
    applyLobbyState(data.game);
    api(`/api/wallet/${currentUser.id}`).then(w => updateWallet(w.balance));
    socket.emit('join_game_room', { gameId: currentGame.id, userId: currentUser.id });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function tttStartCountdown(deadline) {
  clearInterval(tttTimerInt);
  const el = document.getElementById('ttt-move-timer');
  if (!el || !deadline) return;
  el.style.display = 'block';
  const tick = () => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    el.textContent = `⏱ ${left}s`;
    if (left <= 0) clearInterval(tttTimerInt);
  };
  tick();
  tttTimerInt = setInterval(tick, 500);
}

function tttRenderBoard(state) {
  const board = state.board || [];
  const turn = state.turn;
  const winLine = state.winLine || [];
  tttGameOver = !!state.gameOver;
  const myTurn = tttGameOver ? false : (isCreator ? turn === 'creator' : turn === 'opponent');
  const grid = document.getElementById('ttt-board');
  grid.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('button');
    cell.className = 'ttt-cell';
    cell.textContent = board[i] || '';
    cell.disabled = !myTurn || !!board[i];
    if (board[i]) cell.classList.add(board[i].toLowerCase());
    if (winLine.includes(i)) cell.classList.add('win');
    cell.onclick = () => {
      if (!myTurn || board[i]) return;
      socket.emit('ttt_move', { gameId: currentGame.id, index: i });
    };
    grid.appendChild(cell);
  }
  const status = document.getElementById('ttt-status');
  const result = document.getElementById('ttt-result');
  const myMark = isCreator ? 'X' : 'O';
  const oppMark = isCreator ? 'O' : 'X';
  if (tttGameOver) {
    const winnerIsMe = state.winner === (isCreator ? 'creator' : 'opponent');
    if (state.tie) result.textContent = '🤝 It\'s a tie!';
    else result.textContent = winnerIsMe ? '🎉 You win!' : '😔 You lose.';
    status.textContent = '';
  } else {
    result.textContent = '';
    status.textContent = myTurn
      ? `🎯 Your turn (${myMark}) - place your mark!`
      : `⏳ Waiting for opponent's move (${oppMark})...`;
  }
  tttStartCountdown(state.moveDeadline);
}

socket.on('ttt_state', (data) => {
  tttRenderBoard(data);
});

socket.on('ttt_move_skipped', (data) => {
  const skippedMe = isCreator ? data.skippedTurn === 'creator' : data.skippedTurn === 'opponent';
  showToast(skippedMe ? '⏰ Time up - your turn was skipped!' : '⏰ Opponent took too long - turn skipped.', 'info');
});

function renderRbHand(hand) {
  const el = document.getElementById('rb-hand');
  el.innerHTML = hand.map((c, i) => `
    <button data-idx="${i}" onclick="rbPick(${i})" class="${c.color === 'red' ? 'rb-face-red' : 'rb-face-black'}">
      <span class="rb-face-rank">${c.rank}</span>
      <span class="rb-face-suit">${c.suit}</span>
    </button>`).join('');
}

function rbPick(cardIndex) {
  socket.emit('rb_dealer_pick', { gameId: currentGame.id, cardIndex });
  const btn = document.querySelector(`#rb-hand button[data-idx="${cardIndex}"]`);
  if (btn) btn.remove();
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
  const step = parseInt(input.step || '1');
  let val = parseInt(input.value || min) + delta * step;
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
  const amount = parseInt(document.getElementById('amount').value) || 50;
  const yourStake = rounds * amount;      // Your deposit (rounds × amount)
  const totalPot = yourStake * 2;         // Total pot = both players' stakes
  document.getElementById('total-pot').textContent = totalPot.toFixed(2) + ' NGN';
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
  if (!isFreeMode && (amountPerRound < 50 || amountPerRound > 500 || amountPerRound % 10 !== 0)) {
    showToast('Amount must be 50-500 NGN, in multiples of 10', 'error');
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
  try {
    await api(`/api/games/${currentGame.id}/opponent`, {
      method: 'PATCH',
      body: JSON.stringify({ playerId: currentUser.id, opponentTelegramId: newOpponentId }),
    });
    const fresh = await api(`/api/games/room/${currentRoomCode}`);
    currentGame = fresh;
    applyLobbyState(fresh);
    showToast('Opponent ID updated', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------- JOIN GAME ----------

function renderRulesContent(game) {
  const rulesContent = document.getElementById('rules-content');
  const isFree = !!game.is_free;
  const isRb = game.game_type === 'redblack';
  const isWz = game.game_type === 'warzone';
  const isTtt = game.game_type === 'tictactoe';
  // Stake is the same for both games: rounds (cards) × amount per round
  const stake = Number(game.rounds) * Number(game.amount_per_round);
  let rows;
  if (isTtt) {
    rows = `
      <div class="rule-row"><span class="rule-label">Game</span><span class="rule-value">Tic Tac Toe ⭕❌</span></div>
      <div class="rule-row"><span class="rule-label">Mode</span><span class="rule-value">${isFree ? '🎉 FREE' : '💰 Paid'}</span></div>
      <div class="rule-row"><span class="rule-label">Stake</span><span class="rule-value">${isFree ? 'FREE' : game.amount_per_round + ' NGN'}</span></div>
      <div class="rule-row"><span class="rule-label">Total Pot</span><span class="rule-value">${isFree ? 'FREE' : (stake * 2).toFixed(2) + ' NGN'}</span></div>
      <div class="rule-row"><span class="rule-label">Your Deposit (Stake)</span><span class="rule-value">${isFree ? 'FREE' : stake.toFixed(2) + ' NGN'}</span></div>
      <div class="rule-row"><span class="rule-label">Move Time</span><span class="rule-value">${game.round_seconds}s to move - skip turn if you run out</span></div>
      <div class="rule-row"><span class="rule-label">How It Works</span><span class="rule-value">Creator is X and goes first, opponent is O. Get three in a row to win. Draws refund both.</span></div>
      <div class="rule-row"><span class="rule-label">Payout</span><span class="rule-value">Winner Takes All (ties refund both)</span></div>
    `;
  } else if (isRb) {
    rows = `
      <div class="rule-row"><span class="rule-label">Game</span><span class="rule-value">Red or Black 🃏</span></div>
      <div class="rule-row"><span class="rule-label">Mode</span><span class="rule-value">${isFree ? '🎉 FREE' : '💰 Paid'}</span></div>
      <div class="rule-row"><span class="rule-label">Cards</span><span class="rule-value">${game.rounds}</span></div>
      <div class="rule-row"><span class="rule-label">Bet per Card</span><span class="rule-value">${isFree ? 'FREE' : game.amount_per_round + ' NGN'}</span></div>
      <div class="rule-row"><span class="rule-label">Total Pot</span><span class="rule-value">${isFree ? 'FREE' : (stake * 2).toFixed(2) + ' NGN'}</span></div>
      <div class="rule-row"><span class="rule-label">Your Deposit (Stake)</span><span class="rule-value">${isFree ? 'FREE' : stake.toFixed(2) + ' NGN'}</span></div>
      <div class="rule-row"><span class="rule-label">Creator's Role</span><span class="rule-value">${game.creator_role === 'dealer' ? '🎩 Dealer' : '🎯 Player'}</span></div>
      <div class="rule-row"><span class="rule-label">How It Works</span><span class="rule-value">Dealer picks a hidden card - player guesses Red or Black</span></div>
    `;
  } else if (isWz) {
    rows = `
      <div class="rule-row"><span class="rule-label">Game</span><span class="rule-value">War Zone 🚀</span></div>
      <div class="rule-row"><span class="rule-label">Mode</span><span class="rule-value">${isFree ? '🎉 FREE' : '💰 Paid'}</span></div>
      <div class="rule-row"><span class="rule-label">Stake</span><span class="rule-value">${isFree ? 'FREE' : game.amount_per_round + ' NGN'}</span></div>
      <div class="rule-row"><span class="rule-label">Total Pot</span><span class="rule-value">${isFree ? 'FREE' : (stake * 2).toFixed(2) + ' NGN'}</span></div>
      <div class="rule-row"><span class="rule-label">Your Deposit (Stake)</span><span class="rule-value">${isFree ? 'FREE' : stake.toFixed(2) + ' NGN'}</span></div>
      <div class="rule-row"><span class="rule-label">Rockets</span><span class="rule-value">4 per player</span></div>
      <div class="rule-row"><span class="rule-label">Placement Time</span><span class="rule-value">30s</span></div>
      <div class="rule-row"><span class="rule-label">Move Time</span><span class="rule-value">${game.round_seconds}s to fire - skip turn if you run out</span></div>
      <div class="rule-row"><span class="rule-label">How It Works</span><span class="rule-value">Place 4 rockets in 30s, then take turns firing at the enemy grid. Sink all 4 to win - the opponent gets one final shot to force a tie.</span></div>
      <div class="rule-row"><span class="rule-label">Payout</span><span class="rule-value">Winner Takes All (ties refund both)</span></div>
    `;
  } else {
    rows = `
      <div class="rule-row"><span class="rule-label">Game</span><span class="rule-value">Rock Paper Scissors</span></div>
      <div class="rule-row"><span class="rule-label">Mode</span><span class="rule-value">${isFree ? '🎉 FREE' : '💰 Paid'}</span></div>
      <div class="rule-row"><span class="rule-label">Rounds</span><span class="rule-value">${game.rounds}</span></div>
      <div class="rule-row"><span class="rule-label">Amount per Round</span><span class="rule-value">${isFree ? 'FREE' : game.amount_per_round + ' NGN'}</span></div>
      <div class="rule-row"><span class="rule-label">Total Pot</span><span class="rule-value">${isFree ? 'FREE' : (stake * 2).toFixed(2) + ' NGN'}</span></div>
      <div class="rule-row"><span class="rule-label">Your Deposit (Stake)</span><span class="rule-value">${isFree ? 'FREE' : stake.toFixed(2) + ' NGN'}</span></div>
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
  // Stake is already deducted from wallet at game creation / join — no separate deposit step
  await processDeposit();
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
      : 'Opponent is in. Both players press Start Game to begin.';
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
    games.forEach(g => { pendingGamesCache[g.id] = g; });
    updatePendingGamesButton(games);
    if (activeScreen === 'screen-pending') {
      renderPendingGames(document.getElementById('pending-games-list'), games);
    }
  } catch (err) {
    console.error('Failed to load pending games:', err);
  }
}

function updatePendingGamesButton(games) {
  const btn = document.getElementById('pending-games-btn');
  if (!btn) return;
  btn.disabled = !games || games.length === 0;
}

function openPendingGames() {
  showScreen('screen-pending');
  loadPendingGames();
}

function renderPendingGames(container, games) {
  if (!container) return;
  if (!games || games.length === 0) {
    container.innerHTML = '<p style="color:var(--tg-hint);font-size:14px">No pending games right now.</p>';
    return;
  }
  container.innerHTML = games.map(g => {
    const inProgress = g.status === 'in_progress';
    const statusText = inProgress ? 'In progress — rejoin' : (g.status === 'ready' ? 'Ready to start' : 'Waiting for opponent');
    const actionLabel = inProgress ? 'Rejoin' : 'Enter';
    return `
    <div style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #35465c;border-radius:10px;margin-bottom:8px;">
      <span style="flex:1;font-size:14px;">
        <strong>${g.room_code}</strong> · ${statusText}${g.is_free ? ' · FREE' : ''}
      </span>
      <button class="btn-outline btn-sm" onclick="enterPendingGame('${g.id}')">${actionLabel}</button>
      ${g.creator_id === currentUser.id && !inProgress ? `<button class="btn-outline btn-sm" onclick="cancelPendingGame('${g.id}')">Delete</button>` : ''}
    </div>
  `;
  }).join('');
}

function enterPendingGame(gameId) {
  const game = pendingGamesCache[gameId];
  if (!game || !currentUser) return;
  currentGame = game;
  currentRoomCode = game.room_code;
  isCreator = game.creator_id === currentUser.id;
  socket.emit('join_game_room', { gameId: game.id, userId: currentUser.id });

  if (game.status === 'in_progress') {
    if (game.game_type === 'redblack') {
      rbRoleIsDealer = rbAmIDealer(game);
      document.getElementById('rb-role-label').textContent = rbRoleIsDealer ? 'You are the Dealer 🎩' : 'You are the Player 🎯';
      showScreen('screen-play-rb');
    } else if (game.game_type === 'warzone') {
      showScreen('screen-play-wz');
    } else if (game.game_type === 'tictactoe') {
      tttMyMark = isCreator ? 'X' : 'O';
      document.getElementById('ttt-role-label').textContent = `You are ${tttMyMark}`;
      tttGameOver = false;
      showScreen('screen-play-ttt');
    } else {
      showScreen('screen-play');
    }
  } else if (game.status === 'pending' && !isCreator) {
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

function updateLastRoundSummary() {
  const el = document.getElementById('last-round-summary');
  if (!el) return;
  if (!lastRoundInfo) { el.textContent = ''; return; }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const EMOJI = { rock: '✊', paper: '✋', scissors: '✂️' };
  const { round, myChoice, oppChoice, outcome } = lastRoundInfo;
  const me = `${EMOJI[myChoice]} ${cap(myChoice)}`;
  const opp = `${EMOJI[oppChoice]} ${cap(oppChoice)}`;
  const res = outcome === 'win' ? 'You won! 🎉' : outcome === 'lose' ? 'Opponent won.' : "It's a tie.";
  el.textContent = `Round ${round}: You chose ${me}, Opponent chose ${opp}. ${res}`;
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

  document.querySelectorAll('.rps-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.getAttribute('data-choice') === choice) btn.classList.add('picked');
  });
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
  lastRoundInfo = null;
  updateOpponentHint();
  updateLastRoundSummary();
if (data.game.status === 'in_progress') {
    if (data.game.game_type === 'redblack') {
      rbRoleIsDealer = rbAmIDealer(data.game);
      document.getElementById('rb-role-label').textContent = rbRoleIsDealer ? 'You are the Dealer 🎩' : 'You are the Player 🎯';
      document.getElementById('rb-round-display').textContent = data.game.current_round + '/' + data.game.rounds;
      showScreen('screen-play-rb');
} else if (data.game.game_type === 'warzone') {
      showScreen('screen-play-wz');
    } else if (data.game.game_type === 'tictactoe') {
      tttMyMark = isCreator ? 'X' : 'O';
      document.getElementById('ttt-role-label').textContent = `You are ${tttMyMark}`;
      tttGameOver = false;
      showScreen('screen-play-ttt');
    } else {
      showScreen('screen-play');
    }
    document.getElementById('round-display').textContent = `${data.game.current_round}/${data.game.rounds}`;
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

socket.on('game_opponent_updated', (data) => {
  if (currentGame && data && data.game) currentGame = data.game;
  if (currentUser && data && data.opponentId && data.opponentId !== currentUser.id && !(currentGame && currentGame.creator_id === currentUser.id)) {
    showToast('You are no longer invited to this game', 'info');
    showScreen('screen-welcome');
  }
});

socket.on('opponent_absence', (data) => {
  showToast(`Opponent disconnected. They have ${data.minutes} minutes to rejoin, or the game settles with current results.`, 'info');
});

socket.on('opponent_rejoined', () => {
  showToast('Opponent has rejoined — game resumed!', 'success');
});

socket.on('game_started', (data) => {
  currentGame = data.game;
  myChoice = null;
  opponentHistory = [];
  lastRoundInfo = null;
  updateOpponentHint();
  updateLastRoundSummary();
  if (data.game.game_type === 'redblack') {
    rbRoleIsDealer = rbAmIDealer(data.game);
    document.getElementById('rb-role-label').textContent = rbRoleIsDealer ? 'You are the Dealer 🎩' : 'You are the Player 🎯';
    document.getElementById('rb-my-score').textContent = 0;
    document.getElementById('rb-opp-score').textContent = 0;
    document.getElementById('rb-round-display').textContent = '1/' + data.game.rounds;
    document.getElementById('rb-result').textContent = '';
    document.getElementById('rb-hand').innerHTML = '';
    document.getElementById('rb-card-area').innerHTML = '<div class="rb-card-face-down">🂠</div>';
    showScreen('screen-play-rb');
  } else if (data.game.game_type === 'warzone') {
    wzResetLocal();
    showScreen('screen-play-wz');
  } else if (data.game.game_type === 'tictactoe') {
    tttMyMark = isCreator ? 'X' : 'O';
    document.getElementById('ttt-role-label').textContent = `You are ${tttMyMark}`;
    tttGameOver = false;
    document.getElementById('ttt-status').textContent = '';
    document.getElementById('ttt-result').textContent = '';
    showScreen('screen-play-ttt');
  } else {
    document.getElementById('round-display').textContent = `1/${data.game.rounds}`;
    document.getElementById('my-score').textContent = 0;
    document.getElementById('opp-score').textContent = 0;
    showToast('Both players ready — game started!', 'success');
    showScreen('screen-play');
  }
});

// ---------- RED OR BLACK SOCKET EVENTS ----------

socket.on('rb_round_started', (data) => {
  document.getElementById('rb-round-display').textContent = data.round + '/' + data.totalCards;
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

// Dealer's own picked card appears face-up on their screen only
socket.on('rb_dealer_card', (data) => {
  const c = data.card;
  document.getElementById('rb-card-area').innerHTML =
    `<div class="rb-card ${c.color}">${c.rank}<br>${c.suit}</div>`;
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
  document.getElementById('round-display').textContent = `${data.round}/${currentGame.rounds}`;
  myChoice = null;
  document.querySelectorAll('.rps-btn').forEach(btn => { btn.disabled = false; btn.classList.remove('picked'); });
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
  const CHOICE_EMOJI = { rock: '✊', paper: '✋', scissors: '✂️' };
  const WHY = {
    'rock-scissors': 'Rock crushes Scissors',
    'scissors-paper': 'Scissors cuts Paper',
    'paper-rock': 'Paper covers Rock',
  };
  const myChoiceMade = isCreator ? data.creatorChoice : data.opponentChoice;
  const oppChoiceMade = isCreator ? data.opponentChoice : data.creatorChoice;
  const myEmoji = CHOICE_EMOJI[myChoiceMade] || '';
  const oppEmoji = CHOICE_EMOJI[oppChoiceMade] || '';
  if (data.roundWinner === 'tie') {
    resultEl.textContent = `You both chose ${myEmoji} ${cap(myChoiceMade)} — It's a tie!`;
    resultEl.className = 'round-result tie';
  } else if (data.roundWinner === myId) {
    const why = WHY[`${myChoiceMade}-${oppChoiceMade}`];
    resultEl.textContent = `You chose ${myEmoji} ${cap(myChoiceMade)}, opponent chose ${oppEmoji} ${cap(oppChoiceMade)} — ${why ? why + '. ' : ''}You win! 🎉`;
    resultEl.className = 'round-result win';
    bumpScore('my-score');
  } else {
    const why = WHY[`${oppChoiceMade}-${myChoiceMade}`];
    resultEl.textContent = `You chose ${myEmoji} ${cap(myChoiceMade)}, opponent chose ${oppEmoji} ${cap(oppChoiceMade)} — ${why ? why + '. ' : ''}You lose!`;
    resultEl.className = 'round-result lose';
    bumpScore('opp-score');
  }
  lastRoundInfo = {
    round: data.round,
    myChoice: myChoiceMade,
    oppChoice: oppChoiceMade,
    outcome: data.roundWinner === 'tie' ? 'tie' : (data.roundWinner === myId ? 'win' : 'lose'),
  };
  updateLastRoundSummary();
});

function bumpScore(id) {
  const el = document.getElementById(id);
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

socket.on('game_over', (data) => {
  clearInterval(timerInterval);
  const content = document.getElementById('game-over-content');
  const myId = currentUser.id;
  const isWinner = data.winnerId === myId;
  const isFree = data.isFree || currentGame?.is_free;
  const reasonText =
    data.reason === 'resignation' ? 'Opponent resigned' :
    data.reason === 'auto_resign_timeout' ? 'Opponent timed out' :
    data.reason === 'abandoned' ? 'Opponent never returned — settled by current score' :
    'Game completed';

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
        <p>${reasonText}</p>
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
      <div class="amount">${Number(data.winnerAmount).toFixed(2)} NGN each</div>
      <div class="fee">GoWager fee: ${Number(data.fee).toFixed(2)} NGN</div>
    `;
  } else if (isWinner) {
    content.innerHTML = `
      <div class="winner">You Won! 🏆</div>
      <div class="amount">+${Number(data.winnerAmount).toFixed(2)} NGN</div>
      <div class="fee">GoWager fee: ${Number(data.fee).toFixed(2)} NGN</div>
      <p>${reasonText}</p>
    `;
  } else {
    content.innerHTML = `
      <div class="winner">You Lost</div>
      <p>Better luck next time!</p>
      <div class="fee">GoWager fee: ${Number(data.fee).toFixed(2)} NGN</div>
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

async function openWallet() {
  showScreen('screen-wallet');
  if (currentUser) {
    const wallet = await api(`/api/wallet/${currentUser.id}`);
    updateWallet(wallet.balance);
    loadTransactions();
    loadWithdrawalRequests();
    const emailInput = document.getElementById('wallet-email');
    const savedEmail = localStorage.getItem('gowager_email') || currentUser.email || '';
    if (savedEmail) emailInput.value = savedEmail;
  }
}

async function depositFunds() {
  const amount = parseInt(document.getElementById('deposit-wallet-amount').value);
  if (!amount || amount < 100 || amount > 5000 || amount % 50 !== 0) {
    showToast('Enter 100–5,000 NGN in multiples of 50', 'error');
    return;
  }
  const emailInput = document.getElementById('wallet-email');
  let email = (emailInput.value || '').trim();
  if (!email && currentUser.email) email = currentUser.email;
  if (!email) {
    showToast('Enter your email to deposit', 'error');
    emailInput.focus();
    return;
  }
  const btn = document.getElementById('deposit-btn');
  btn.disabled = true;
  btn.textContent = 'Opening Paystack…';
  try {
    if (email !== currentUser.email) {
      const saved = await api(`/api/users/${currentUser.id}`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      currentUser.email = saved.user.email;
    }
    localStorage.setItem('gowager_email', email);
    const data = await api('/api/paystack/initialize', {
      method: 'POST',
      body: JSON.stringify({
        userId: currentUser.id,
        amount,
        email,
        callbackUrl: window.location.origin + window.location.pathname,
      }),
    });
    window.location.href = data.authorization_url;
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Deposit';
  }
}

async function handleDepositCallback() {
  const ref = new URLSearchParams(window.location.search).get('gwg_deposit');
  if (!ref) return;
  const btn = document.getElementById('deposit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Confirming…'; }
  try {
    const data = await api(`/api/paystack/verify/${ref}`);
    updateWallet(data.wallet.balance);
    showToast('Deposit successful!', 'success');
    loadTransactions();
    window.history.replaceState({}, '', window.location.pathname);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Deposit'; }
  }
}

const WITHDRAW_CANCEL_WINDOW_MS = 15 * 60 * 1000;

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function requestWithdrawal() {
  const fullName = document.getElementById('wdr-name').value.trim();
  const bankName = document.getElementById('wdr-bank').value.trim();
  const accountNumber = document.getElementById('wdr-account').value.trim();
  const amount = parseInt(document.getElementById('withdraw-amount').value);
  if (fullName.length < 3) return showToast('Enter the full name on the account', 'error');
  if (bankName.length < 2) return showToast('Enter your bank name', 'error');
  if (!/^\d{10,12}$/.test(accountNumber)) return showToast('Enter a valid account number', 'error');
  if (!amount || amount < 100 || amount > 10000) {
    return showToast('Amount must be 100–10,000 NGN', 'error');
  }
  const btn = document.getElementById('withdraw-btn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  try {
    const data = await api('/api/withdrawal-request', {
      method: 'POST',
      body: JSON.stringify({ userId: currentUser.id, fullName, bankName, accountNumber, amount }),
    });
    updateWallet(data.wallet.balance);
    showToast('Withdrawal request submitted! You have 15 minutes to cancel.', 'success');
    loadWithdrawalRequests();
    loadTransactions();
    ['wdr-name', 'wdr-bank', 'wdr-account', 'withdraw-amount'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Request Withdrawal';
  }
}

function cancelWindowMs(createdAt) {
  return Math.max(0, WITHDRAW_CANCEL_WINDOW_MS - (Date.now() - new Date(createdAt).getTime()));
}

async function loadWithdrawalRequests() {
  if (!currentUser) return;
  try {
    const reqs = await api(`/api/withdrawal-requests/${currentUser.id}`);
    const container = document.getElementById('withdrawal-requests');
    container.innerHTML = '<h3 style="font-size:15px;color:var(--tg-hint);margin-bottom:10px">My Withdrawal Requests</h3>';
    if (reqs.length === 0) {
      container.innerHTML += '<p style="color:var(--tg-hint);font-size:13px">No withdrawal requests yet</p>';
      return;
    }
    const statusLabels = { pending: '⏳ Pending', completed: '✅ Completed', cancelled: '✖️ Cancelled', rejected: '↩️ Rejected', processed: '✅ Completed' };
    reqs.forEach(wr => {
      const canCancel = wr.status === 'pending' && cancelWindowMs(wr.created_at) > 0;
      const statusColor = wr.status === 'completed' || wr.status === 'processed' ? '#4ade80' : wr.status === 'pending' ? '#facc15' : 'var(--tg-hint)';
      container.innerHTML += `
        <div class="wr-item">
          <div class="wr-top">
            <strong>${Number(wr.amount).toFixed(2)} NGN</strong>
            <span class="wr-status" style="color:${statusColor}">${statusLabels[wr.status] || wr.status}</span>
          </div>
          <div class="wr-details">${escHtml(wr.full_name)} · ${escHtml(wr.bank_name)} · ${escHtml(wr.account_number)}</div>
          <div class="wr-meta">${new Date(wr.created_at).toLocaleString()}</div>
          ${canCancel ? `<button class="btn-secondary btn-sm" onclick="cancelWithdrawalRequest('${wr.id}')">Cancel Request</button>` : ''}
        </div>
      `;
    });
  } catch (err) {
    console.error('Failed to load withdrawal requests:', err);
  }
}

async function cancelWithdrawalRequest(id) {
  showModal('Cancel withdrawal request?',
    'Your balance will be refunded. You can only cancel within 15 minutes of the request.',
    async () => {
      try {
        const data = await api(`/api/withdrawal-request/${id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ userId: currentUser.id }),
        });
        updateWallet(data.wallet.balance);
        showToast('Request cancelled — balance refunded', 'success');
        loadWithdrawalRequests();
        loadTransactions();
      } catch (err) {
        showToast(err.message, 'error');
      }
    },
    () => {});
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
      const isPositive = ['game_win', 'game_refund', 'withdrawal_refund', 'deposit'].includes(tx.type);
      const typeLabels = {
        game_deposit: 'Game Deposit',
        game_win: 'Game Win',
        game_refund: 'Game Refund',
        deposit: 'Deposit',
        withdrawal_request: 'Withdrawal Request',
        withdrawal_refund: 'Withdrawal Refund',
        demo_credit: 'Demo Credit',
      };
      container.innerHTML += `
        <div class="tx-item">
          <span class="tx-type">${typeLabels[tx.type] || tx.type}</span>
          <span class="tx-amount ${isPositive ? 'positive' : 'negative'}">${isPositive ? '+' : '-'}${Number(tx.amount).toFixed(2)} NGN</span>
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
  handleDepositCallback();
  document.getElementById('rb-bet').addEventListener('input', updateRbPot);
  const wzStakeInput = document.getElementById('wz-stake');
  if (wzStakeInput) wzStakeInput.addEventListener('input', updateWzPot);
  const tttStakeInput = document.getElementById('ttt-stake');
  if (tttStakeInput) tttStakeInput.addEventListener('input', updateTttPot);
  const rbCardsInput = document.getElementById('rb-cards');
  if (rbCardsInput) rbCardsInput.addEventListener('input', updateRbPot);
});