// Teen Patti Multiplayer Engine & Rules Manager

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars like 0, O, 1, I
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

export function createInitialRoomState({ tableName = 'Friday Night', startingChips = 1000, bootAmount = 10, hostName = 'Host' }) {
  const hostId = generateId();
  const roomCode = generateRoomCode();

  const hostPlayer = {
    id: hostId,
    name: hostName,
    balance: startingChips,
    start: startingChips,
    isBlind: true,
    isFolded: false,
    betThisRound: 0,
    totalBet: 0,
    wins: 0,
    isHost: true,
    joinedAt: Date.now()
  };

  return {
    code: roomCode,
    tableName: tableName.trim() || 'Teen Patti Table',
    startingChips: Number(startingChips) || 1000,
    bootAmount: Number(bootAmount) || 10,
    pot: 0,
    currentChaal: Number(bootAmount) || 10,
    round: 1,
    dealerIndex: 0,
    currentTurnIndex: 0,
    status: 'lobby', // 'lobby' | 'playing' | 'round_over'
    players: [hostPlayer],
    history: [{
      text: `Table created by ${hostName} (${startingChips} chips start, ${bootAmount} boot)`,
      time: formatTime()
    }],
    sideShowRequest: null,
    denominations: [5, 10, 20, 50, 100, 200, 500]
  };
}

export function formatTime(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Get active (non-folded) players
export function getActivePlayers(room) {
  if (!room || !room.players) return [];
  return room.players.filter(p => !p.isFolded);
}

// Get next active player index starting after a given index
export function getNextActiveTurnIndex(room, fromIndex) {
  if (!room || !room.players || room.players.length === 0) return 0;
  let idx = (fromIndex + 1) % room.players.length;
  let count = 0;
  while (room.players[idx].isFolded && count < room.players.length) {
    idx = (idx + 1) % room.players.length;
    count++;
  }
  return idx;
}

// Get required bet amount based on player's Blind/Seen status and base chaal
export function calculateRequiredBet(room, playerId) {
  const player = room?.players?.find(p => p.id === playerId);
  if (!player) return { minBet: 0, isBlind: true, canAllIn: false };

  const baseChaal = room.currentChaal || room.bootAmount || 10;
  // Blind player bets 1x baseChaal; Seen player bets 2x baseChaal
  const minBet = player.isBlind ? baseChaal : baseChaal * 2;
  const canAllIn = player.balance > 0 && player.balance < minBet;

  return { minBet, isBlind: player.isBlind, baseChaal, canAllIn };
}

// Engine Actions Reducer (Returns new mutated room state)
export function reduceRoomAction(room, action) {
  const state = JSON.parse(JSON.stringify(room)); // Deep clone state

  switch (action.type) {
    case 'JOIN_PLAYER': {
      const { name, playerId } = action.payload;
      const existing = state.players.find(p => p.id === playerId || p.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        existing.id = playerId; // Reconnect
        existing.name = name.trim();
        return state;
      }
      state.players.push({
        id: playerId,
        name: name.trim(),
        balance: state.startingChips,
        start: state.startingChips,
        isBlind: true,
        isFolded: state.status === 'playing', // Join folded if round in progress
        betThisRound: 0,
        totalBet: 0,
        wins: 0,
        isHost: state.players.length === 0,
        joinedAt: Date.now()
      });
      state.history.unshift({
        text: `${name} joined the table`,
        time: formatTime()
      });
      return state;
    }

    case 'REMOVE_PLAYER': {
      const { playerId } = action.payload;
      const p = state.players.find(x => x.id === playerId);
      if (!p) return state;

      const wasHost = p.isHost;
      state.players = state.players.filter(x => x.id !== playerId);

      // Reassign host if host left
      if (wasHost && state.players.length > 0) {
        state.players[0].isHost = true;
        state.history.unshift({
          text: `👑 Host left. ${state.players[0].name} is now the table Host`,
          time: formatTime()
        });
      }

      state.history.unshift({
        text: `${p.name} left the room`,
        time: formatTime()
      });

      // Adjust turn index if needed
      if (state.currentTurnIndex >= state.players.length) {
        state.currentTurnIndex = 0;
      } else {
        state.currentTurnIndex = getNextActiveTurnIndex(state, state.currentTurnIndex);
      }
      return state;
    }

    case 'START_ROUND': {
      state.status = 'playing';
      state.pot = 0;
      state.currentChaal = state.bootAmount;
      state.sideShowRequest = null;

      // Reset players state & collect Boot
      let bootTotal = 0;
      state.players.forEach(p => {
        p.isFolded = false;
        p.isBlind = true; // All players start Blind by default
        p.betThisRound = 0;

        const boot = Math.min(p.balance, state.bootAmount);
        p.balance -= boot;
        p.betThisRound += boot;
        p.totalBet += boot;
        bootTotal += boot;
      });

      state.pot = bootTotal;

      // Set turn to player after dealer
      state.currentTurnIndex = getNextActiveTurnIndex(state, state.dealerIndex);

      state.history.unshift({
        text: `Round ${state.round} started — Boot (${state.bootAmount} chips) collected (${bootTotal} total pot)`,
        time: formatTime()
      });

      return state;
    }

    case 'TOGGLE_SEE_CARDS': {
      const { playerId } = action.payload;
      const p = state.players.find(x => x.id === playerId);
      if (p && p.isBlind) {
        p.isBlind = false;
        state.history.unshift({
          text: `${p.name} saw their cards (Now SEEN)`,
          time: formatTime()
        });
      }
      return state;
    }

    case 'PLACE_BET': {
      const { playerId, amount, newBaseChaal } = action.payload;
      const p = state.players.find(x => x.id === playerId);
      if (!p || p.isFolded) return state;

      const actualAmount = Math.min(p.balance, Math.max(1, amount));
      if (actualAmount <= 0) return state;

      p.balance -= actualAmount;
      p.betThisRound += actualAmount;
      p.totalBet += actualAmount;
      state.pot += actualAmount;

      if (newBaseChaal && newBaseChaal > state.currentChaal) {
        state.currentChaal = newBaseChaal;
      }

      state.history.unshift({
        text: `${p.name} (${p.isBlind ? 'Blind' : 'Seen'}) bet ${actualAmount} chips`,
        time: formatTime()
      });

      // Advance turn
      state.currentTurnIndex = getNextActiveTurnIndex(state, state.currentTurnIndex);
      return state;
    }

    case 'ALL_IN': {
      const { playerId } = action.payload;
      const p = state.players.find(x => x.id === playerId);
      if (!p || p.isFolded || p.balance <= 0) return state;

      const allInAmount = p.balance;
      p.balance = 0;
      p.betThisRound += allInAmount;
      p.totalBet += allInAmount;
      state.pot += allInAmount;

      state.history.unshift({
        text: `🔥 ${p.name} went ALL-IN with ${allInAmount} chips!`,
        time: formatTime()
      });

      state.currentTurnIndex = getNextActiveTurnIndex(state, state.currentTurnIndex);
      return state;
    }

    case 'FOLD_PLAYER': {
      const { playerId } = action.payload;
      const p = state.players.find(x => x.id === playerId);
      if (!p || p.isFolded) return state;

      p.isFolded = true;
      state.history.unshift({
        text: `${p.name} folded (Pack)`,
        time: formatTime()
      });

      // Check remaining active players
      const active = getActivePlayers(state);
      if (active.length === 1) {
        // Auto-win last standing player!
        const winner = active[0];
        winner.balance += state.pot;
        winner.wins += 1;
        state.history.unshift({
          text: `🏆 ${winner.name} won ${state.pot} chips (All others folded)!`,
          time: formatTime()
        });
        state.pot = 0;
        state.status = 'round_over';
        state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
        state.round += 1;
      } else {
        // Advance turn
        state.currentTurnIndex = getNextActiveTurnIndex(state, state.currentTurnIndex);
      }
      return state;
    }

    case 'SKIP_TURN': {
      const p = state.players[state.currentTurnIndex];
      if (p) {
        state.history.unshift({
          text: `⏩ ${p.name}'s turn was skipped`,
          time: formatTime()
        });
      }
      state.currentTurnIndex = getNextActiveTurnIndex(state, state.currentTurnIndex);
      return state;
    }

    case 'REQUEST_SIDESHOW': {
      const { fromId } = action.payload;
      const fromPlayer = state.players.find(p => p.id === fromId);
      if (!fromPlayer) return state;

      // Find previous active player in turn order
      let prevIdx = (state.currentTurnIndex - 1 + state.players.length) % state.players.length;
      while (state.players[prevIdx].isFolded && prevIdx !== state.currentTurnIndex) {
        prevIdx = (prevIdx - 1 + state.players.length) % state.players.length;
      }
      const toPlayer = state.players[prevIdx];
      if (!toPlayer || toPlayer.id === fromId) return state;

      state.sideShowRequest = {
        fromId: fromPlayer.id,
        fromName: fromPlayer.name,
        toId: toPlayer.id,
        toName: toPlayer.name,
        status: 'pending'
      };

      state.history.unshift({
        text: `🤝 ${fromPlayer.name} requested Side Show with ${toPlayer.name}`,
        time: formatTime()
      });
      return state;
    }

    case 'RESPOND_SIDESHOW': {
      const { accepted, loserId } = action.payload;
      if (!state.sideShowRequest) return state;

      const { fromName, toName } = state.sideShowRequest;

      if (accepted) {
        state.history.unshift({
          text: `✅ ${toName} accepted Side Show from ${fromName}`,
          time: formatTime()
        });

        if (loserId) {
          const loser = state.players.find(p => p.id === loserId);
          if (loser) {
            loser.isFolded = true;
            state.history.unshift({
              text: `📉 ${loser.name} lost Side Show and folded!`,
              time: formatTime()
            });

            // Check if 1 player left
            const active = getActivePlayers(state);
            if (active.length === 1) {
              const winner = active[0];
              winner.balance += state.pot;
              winner.wins += 1;
              state.history.unshift({
                text: `🏆 ${winner.name} won ${state.pot} chips!`,
                time: formatTime()
              });
              state.pot = 0;
              state.status = 'round_over';
              state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
              state.round += 1;
            }
          }
        }
      } else {
        state.history.unshift({
          text: `❌ ${toName} declined Side Show from ${fromName}`,
          time: formatTime()
        });
      }
      state.sideShowRequest = null;
      return state;
    }

    case 'TRIGGER_SHOW': {
      const { playerId } = action.payload;
      const p = state.players.find(x => x.id === playerId);
      if (!p || p.isFolded) return state;

      const { minBet } = calculateRequiredBet(state, playerId);
      const fee = Math.min(p.balance, minBet);
      p.balance -= fee;
      p.betThisRound += fee;
      p.totalBet += fee;
      state.pot += fee;

      state.history.unshift({
        text: `👀 ${p.name} called SHOW! (${fee} chips fee paid to pot)`,
        time: formatTime()
      });
      return state;
    }

    case 'COLLECT_WINNER': {
      const { winnerId } = action.payload;
      const winner = state.players.find(p => p.id === winnerId);
      if (!winner) return state;

      const winAmount = state.pot;
      winner.balance += winAmount;
      winner.wins += 1;

      state.history.unshift({
        text: `🎉 ${winner.name} won the pot of ${winAmount} chips!`,
        time: formatTime()
      });

      state.pot = 0;
      state.status = 'round_over';
      state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
      state.round += 1;
      return state;
    }

    case 'REBUY_CHIPS': {
      const { playerId, amount } = action.payload;
      const p = state.players.find(x => x.id === playerId);
      if (!p) return state;

      const rebuyVal = Number(amount) || 1000;
      p.balance += rebuyVal;
      state.history.unshift({
        text: `💵 ${p.name} topped up +${rebuyVal} chips`,
        time: formatTime()
      });
      return state;
    }

    case 'UPDATE_SETTINGS': {
      const { tableName, bootAmount, startingChips, denominations } = action.payload;
      if (tableName) state.tableName = tableName.trim();
      if (bootAmount) state.bootAmount = Number(bootAmount);
      if (startingChips) state.startingChips = Number(startingChips);
      if (denominations && Array.isArray(denominations)) state.denominations = denominations;

      state.history.unshift({
        text: `⚙️ Table settings updated by Host`,
        time: formatTime()
      });
      return state;
    }

    case 'RESET_CHIPS': {
      state.players.forEach(p => {
        p.balance = state.startingChips;
        p.start = state.startingChips;
        p.betThisRound = 0;
        p.totalBet = 0;
        p.wins = 0;
        p.isFolded = false;
      });
      state.pot = 0;
      state.round = 1;
      state.status = 'lobby';
      state.history.unshift({
        text: `🔄 All player chips reset to ${state.startingChips}`,
        time: formatTime()
      });
      return state;
    }

    default:
      return state;
  }
}
