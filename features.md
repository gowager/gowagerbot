# Features

GoWager — a Telegram Mini App and Web App for friendly wagers between two players.

## Platform
- **Two frontends, one backend**: light-theme Web App (`webapp/`) and dark-theme Telegram Mini App (`telegram/`), both served by the same Express server.
- **Telegram authentication**: Mini App users register with their real Telegram ID + @username. Web App users get auto-generated IDs.
- **Wallet system**: GHS balances, deposits ledger, transaction history, demo credit endpoint for testing.
- **Opponent lookup**: invite by numeric Telegram ID, `@username`, plain username, or webapp-style ID.

## Lobby & Game Flow
- **Create game**: pick opponent, settings, see live Total Pot + Your Deposit before committing.
- **Join game**: enter a 6-character room code → rules review screen (game-specific) → "I Agree & Deposit" → deposit screen → lobby.
- **Pending games list**: welcome screen shows games waiting for you; enter or delete (delete fully refunds the creator).
- **Dual-ready start**: paid games begin only when both players press Start AND both sockets are connected.
- **Rejoin safety**: refreshing mid-game re-syncs full state, including private hands.
- **Resignation rule**: two consecutive non-choices counts as resigning; resigner pays per the agreed rule.

## Games

### Rock Paper Scissors
- 1–25 rounds, 1–50 GHS per round, 30/45/60s round timer.
- Payout styles: winner-takes-all or winner-per-game.
- Resign rules: pay full pot or pay per games played.
- Opponent pattern hint based on their throw history.
- Explicit round results ("You chose Rock, opponent chose Scissors — You win!").
- Live scoreboard, round timer bar, tie handling.

### Red or Black 🃏
- Creator chooses role: 🎩 Dealer (picks cards) or 🎯 Player (guesses colors).
- Dealer receives a private hand dealt from 4 shuffled decks (208 cards, no jokers).
- 1–52 cards per game, bet of 1–20 GHS **per card** (stake = cards × bet; pot = stake × 2).
- Each round: dealer secretly picks any card from hand → player guesses 🔴/⚫ → card reveals → correct guess wins the card.
- Dealer sees their own hand and picked card face-up; player never sees them until reveal.
- Most cards won takes the pot minus the 5% platform fee.

## Shared Systems
- **Server-authoritative engines**: all choices, timers, scoring, and payouts run on the backend; clients only display state.
- **Socket.IO events** for lobby updates, round flow, reveals, and game-over with automatic settlement.
- **Cancel/refund**: pending games refund both parties' exact stakes.
- **5% fee** on all won pots.
