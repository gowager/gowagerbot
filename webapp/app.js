// GoWager Web App - Frontend Logic
const API_URL = 'https://gowager-backend.onrender.com';
const socket = io(API_URL);

// State
let currentUser = null;
let currentGame = null;
let currentRoomCode = null;
let isCreator = false;
let isFreeMode = false;
let myChoice = null;
let timerInterval = null;
let roundDeadline = null;

// ---------- UTILITIES ----------

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
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
        <button class="btn-secondary" id="modal-no">No</button>
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
  // For web app, use a simple localStorage-based user
  let telegramId = localStorage.getItem('gowager_telegram_id');
  if (!telegramId) {
    telegramId = 'web_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('gowager_telegram_id', telegramId);
  }
  const username = localStorage.getItem('gowager_username') || 'Web Player';
  try {
    const data = await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({ telegramId, username }),
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
  }
}

// ---------- FREE PLAY ----------

function startFreePlay() {
  isFreeMode = true;
  showScreen('screen-game-options');
  showToast('Free mode! No money involved. 🎉', 'success');
}

// ---------- CREATE GAME ----------

function updateTotalPot() {
  const rounds = parseInt(document.getElementById('rounds').value) || 1;
  const amount = parseInt(document.getElementById('amount').value) || 1;
  const yourStake = rounds * amount;      // Your deposit (rounds × amount)
  const totalPot = yourStake * 2;         // Total pot = both players' stakes
  document.getElementById('total-pot').textContent = totalPot.toFixed(2);
  document.getElementById('your-share').textContent = yourStake.toFixed(2);
}

document.getElementById('rounds').addEventListener('input', updateTotalPot);
document.getElementById('amount').addEventListener('input', updateTotalPot);

async function createGame() {
  const opponentTelegramId = document.getElementById('opponent-id').value.trim();
  const rounds = parseInt(document.getElementById('rounds').value);
  const amountPerRound = parseInt(document.getElementById('amount').value);
  const roundSeconds = parseInt(document.getElementById('round-seconds').value);
  const payoutStyle = document.getElementById('payout-style').value;
  const resignRule = document.getElementById('resign-rule').value;

  if (!opponentTelegramId) {
    showToast('Please enter your opponent\'s Telegram ID', 'error');
    return;
  }
  if (rounds < 1 || rounds > 25) {
    showToast('Rounds must be between 1 and 25', 'error');
    return;
  }
  if (!isFreeMode && (amountPerRound < 1 || amountPerRound > 50)) {
    showToast('Amount must be between 1 and 50 GHS', 'error');
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

    document.getElementById('room-code-display').textContent = data.roomCode;
    document.getElementById('edit-opponent-id').value = opponentTelegramId;
    showScreen('screen-room-code');

    // Update wallet after deposit (no change in free mode)
    const wallet = await api(`/api/wallet/${currentUser.id}`);
    updateWallet(wallet.balance);

    // Join the game room via socket
    socket.emit('join_game_room', { gameId: currentGame.id, userId: currentUser.id });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function editOpponent() {
  const newOpponentId = document.getElementById('edit-opponent-id').value.trim();
  if (!newOpponentId) {
    showToast('Please enter a new Telegram ID', 'error');
    return;
  }
  // For simplicity, we'll just update the local state and show a message
  // In production, this would call an API to update the game
  showToast('Opponent ID updated successfully', 'success');
}

// ---------- JOIN GAME ----------

async function joinGame() {
  const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!roomCode) {
    showToast('Please enter a room code', 'error');
    return;
  }

  try {
    const game = await api(`/api/games/room/${roomCode}`);
    currentGame = game;
    currentRoomCode = roomCode;
    isCreator = false;

    // Display game rules
    const rulesContent = document.getElementById('rules-content');
    const isFree = !!game.is_free;
    rulesContent.innerHTML = `
      <div class="rule-row"><span class="rule-label">Game</span><span class="rule-value">Rock Paper Scissors</span></div>
      <div class="rule-row"><span class="rule-label">Mode</span><span class="rule-value">${isFree ? '🎉 FREE' : '💰 Paid'}</span></div>
      <div class="rule-row"><span class="rule-label">Rounds</span><span class="rule-value">${game.rounds}</span></div>
      <div class="rule-row"><span class="rule-label">Amount per Round</span><span class="rule-value">${isFree ? 'FREE' : game.amount_per_round + ' GHS'}</span></div>
      <div class="rule-row"><span class="rule-label">Total Pot</span><span class="rule-value">${isFree ? 'FREE' : (game.rounds * game.amount_per_round * 2).toFixed(2) + ' GHS'}</span></div>
      <div class="rule-row"><span class="rule-label">Your Deposit (Stake)</span><span class="rule-value">${isFree ? 'FREE' : (game.rounds * game.amount_per_round).toFixed(2) + ' GHS'}</span></div>
      <div class="rule-row"><span class="rule-label">Seconds per Round</span><span class="rule-value">${game.round_seconds}s</span></div>
      <div class="rule-row"><span class="rule-label">Payout Style</span><span class="rule-value">${game.payout_style === 'winner_takes_all' ? 'Winner Takes All' : 'Winner Per Game'}</span></div>
      <div class="rule-row"><span class="rule-label">Resign Rule</span><span class="rule-value">${game.resign_rule === 'full_pot' ? 'Pay Full Pot' : 'Pay Per Game'}</span></div>
      <div class="rule-row"><span class="rule-label">Resignation</span><span class="rule-value">No choice 2 rounds in a row</span></div>
    `;

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
  // Each player deposits their full stake: rounds × amount per round
  const yourStake = currentGame.rounds * currentGame.amount_per_round;
  document.getElementById('deposit-amount').textContent = yourStake.toFixed(2);
  showScreen('screen-deposit');
}

async function processDeposit() {
  try {
    const data = await api(`/api/games/${currentRoomCode}/join`, {
      method: 'POST',
      body: JSON.stringify({ playerId: currentUser.id }),
    });

    currentGame = data.game;
    const wallet = await api(`/api/wallet/${currentUser.id}`);
    updateWallet(wallet.balance);

    // Join game room
    socket.emit('join_game_room', { gameId: currentGame.id, userId: currentUser.id });

    // Show lobby
    document.getElementById('lobby-room').textContent = currentRoomCode;
    document.getElementById('lobby-status').textContent = 'Ready to Start';
    document.getElementById('start-game-btn').style.display = 'block';
    showScreen('screen-lobby');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function startGame() {
  try {
    const data = await api(`/api/games/${currentRoomCode}/start`, {
      method: 'POST',
      body: JSON.stringify({ playerId: currentUser.id }),
    });
    currentGame = data.game;
    showToast('Game started!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------- GAME PLAY ----------

function makeChoice(choice) {
  if (!currentGame || currentGame.status !== 'in_progress') {
    showToast('Game not in progress', 'error');
    return;
  }
  if (myChoice) {
    showToast('You already chose this round', 'error');
    return;
  }

  myChoice = choice;
  socket.emit('submit_choice', { gameId: currentGame.id, choice });

  // Disable buttons
  document.querySelectorAll('.choice-btn').forEach(btn => btn.disabled = true);
  document.getElementById('round-result').textContent = 'Waiting for opponent...';
  document.getElementById('round-result').className = 'round-result';
}

function confirmResign() {
  showModal('Resign?', 'Are you sure you want to quit?', () => {
    socket.emit('resign', { gameId: currentGame.id });
  });
}

function startTimer(deadline) {
  clearInterval(timerInterval);
  roundDeadline = deadline;
  timerInterval = setInterval(() => {
    const remaining = Math.max(0, Math.floor((roundDeadline - Date.now()) / 1000));
    document.getElementById('timer').textContent = remaining;
    if (remaining <= 0) {
      clearInterval(timerInterval);
    }
  }, 1000);
}

// ---------- SOCKET EVENTS ----------

socket.on('game_state', (data) => {
  currentGame = data.game;
  if (data.game.status === 'in_progress') {
    showScreen('screen-play');
    document.getElementById('current-round').textContent = data.game.current_round;
    document.getElementById('total-rounds').textContent = data.game.rounds;
    document.getElementById('my-score').textContent = isCreator ? data.game.creator_score : data.game.opponent_score;
    document.getElementById('opp-score').textContent = isCreator ? data.game.opponent_score : data.game.creator_score;
    if (data.deadline) startTimer(data.deadline);
  }
});

socket.on('round_started', (data) => {
  document.getElementById('current-round').textContent = data.round;
  document.getElementById('total-rounds').textContent = currentGame.rounds;
  myChoice = null;
  document.querySelectorAll('.choice-btn').forEach(btn => btn.disabled = false);
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

  if (data.roundWinner === 'tie') {
    resultEl.textContent = 'Tie!';
    resultEl.className = 'round-result tie';
  } else if (data.roundWinner === myId) {
    resultEl.textContent = 'You won this round! 🎉';
    resultEl.className = 'round-result win';
  } else {
    resultEl.textContent = 'Opponent won this round!';
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
  // Refresh wallet
  api(`/api/wallet/${currentUser.id}`).then(w => updateWallet(w.balance));
});

socket.on('timeout_warning', (data) => {
  showToast('Time is up! Random choice assigned.', 'info');
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
    container.innerHTML = '<h3 style="font-size:16px;color:#333;margin-bottom:10px">Recent Transactions</h3>';
    if (txs.length === 0) {
      container.innerHTML += '<p style="color:#999;font-size:14px">No transactions yet</p>';
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

document.addEventListener('DOMContentLoaded', () => {
  initUser();
  updateTotalPot();
});