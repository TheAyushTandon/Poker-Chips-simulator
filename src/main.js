import { sounds } from './audio.js';
import {
  createInitialRoomState,
  reduceRoomAction,
  generateId,
  formatTime,
  calculateRequiredBet,
  getActivePlayers
} from './teenPattiEngine.js';
import {
  subscribeToRoom,
  syncRoomState,
  fetchRoom,
  getSupabaseConfig,
  saveSupabaseConfig
} from './supabase.js';

// Local storage key for persistent player identity
const MY_PLAYER_KEY = 'tp_my_player_id';
const LAST_ROOM_KEY = 'tp_last_room_code';

function getMyPlayerId() {
  let pid = localStorage.getItem(MY_PLAYER_KEY);
  if (!pid) {
    pid = generateId();
    localStorage.setItem(MY_PLAYER_KEY, pid);
  }
  return pid;
}

let room = null;
let activeTab = 'create'; // 'create' | 'join'
let selectedChip = 10;

// Check URL params for auto-join
const urlParams = new URLSearchParams(window.location.search);
const queryRoomCode = urlParams.get('room') || urlParams.get('code') || '';

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function esc(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function money(num) {
  return Number(num || 0).toLocaleString('en-IN');
}

function initials(name) {
  return (name || '').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function getRankBadge(i) {
  const medals = ['🥇', '🥈', '🥉'];
  return i < 3 ? medals[i] : '#' + (i + 1);
}

function triggerConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#f5c242', '#ffe89e', '#10b981', '#3b82f6', '#ffffff'];

  for (let i = 0; i < 75; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height * 0.4,
      r: Math.random() * 6 + 4,
      d: Math.random() * 75,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.floor(Math.random() * 10) - 10,
      tiltAngleIncremental: Math.random() * 0.07 + 0.05,
      tiltAngle: 0
    });
  }

  let animationFrame;
  let startTime = Date.now();

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
      ctx.stroke();

      p.tiltAngle += p.tiltAngleIncremental;
      p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
      p.tilt = Math.sin(p.tiltAngle) * 15;
    }

    if (Date.now() - startTime < 2500) {
      animationFrame = requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cancelAnimationFrame(animationFrame);
    }
  }

  draw();
}

// Initial Bootstrapping
async function initApp() {
  const lastCode = queryRoomCode || localStorage.getItem(LAST_ROOM_KEY) || '';

  if (queryRoomCode) {
    activeTab = 'join';
  }

  if (lastCode) {
    const existingRoom = await fetchRoom(lastCode);
    if (existingRoom) {
      room = existingRoom;
      subscribeToRoom(lastCode, handleRemoteStateUpdate);
    }
  }

  render();
}

function handleRemoteStateUpdate(newState) {
  if (!newState) return;
  const previousTurn = room ? room.currentTurnIndex : null;
  room = newState;

  // Sound triggers on turn change
  const myId = getMyPlayerId();
  if (room.status === 'playing' && room.players[room.currentTurnIndex]?.id === myId) {
    if (previousTurn !== room.currentTurnIndex) {
      sounds.playTurnSound();
      toast("It's your turn to bet!");
    }
  }

  render();
}

function dispatchAction(action) {
  if (!room) return;
  room = reduceRoomAction(room, action);
  syncRoomState(room);
  render();
}

// Render Router
function render() {
  const app = document.getElementById('app');
  if (!room) {
    app.innerHTML = renderLobbyHTML();
    bindLobbyEvents();
  } else {
    app.innerHTML = renderGameHTML();
    bindGameEvents();
  }
}

// ----------------------------------------------------
// LOBBY / SETUP SCREEN
// ----------------------------------------------------
function renderLobbyHTML() {
  const { isConfigured } = getSupabaseConfig();
  const isCreate = activeTab === 'create';
  const isJoin = activeTab === 'join';

  return `
    <div class="top">
      <div class="brand">
        <div class="logo">♠</div>
        <div>
          <h1>Teen Patti Chips</h1>
          <p>Monte Carlo VIP Edition</p>
        </div>
      </div>
      <div class="pill ${isConfigured ? 'live' : ''}">${isConfigured ? 'SUPABASE ONLINE' : 'LOCAL / DEMO'}</div>
    </div>

    <div class="tab-switcher">
      <button class="tab-btn ${isCreate ? 'active' : ''}" id="tabCreate">Host New Table</button>
      <button class="tab-btn ${isJoin ? 'active' : ''}" id="tabJoin">Join Table</button>
    </div>

    ${isCreate ? renderCreateFormHTML() : renderJoinFormHTML()}

    <section class="card">
      <h2>How Multiplayer Works</h2>
      <div class="small muted" style="line-height:1.6">
        1. <strong>Host</strong> creates a room code and shares it or shows the QR Code.<br>
        2. <strong>Friends</strong> scan or enter the code on their phones to join.<br>
        3. <strong>Turns & Chaal</strong> are tracked automatically live on everyone's screen with chip sounds!
      </div>
    </section>

    <div style="text-align:center;margin-top:16px">
      <button id="btnSupabaseSetup" class="btn" style="background:#151a16;font-size:11px">⚙️ Backend Settings (Supabase Key)</button>
    </div>
  `;
}

function renderCreateFormHTML() {
  return `
    <section class="card">
      <h2>Create a Virtual Room</h2>
      <div class="setup-grid">
        <div>
          <div class="small muted" style="margin-bottom:6px">Table Name</div>
          <input id="createTableName" value="Monte Carlo Patti" placeholder="e.g. Royal Club">
        </div>
        <div>
          <div class="small muted" style="margin-bottom:6px">Your Name (Host)</div>
          <input id="createHostName" value="Host Player" placeholder="e.g. Ayush">
        </div>
        <div class="row">
          <div>
            <div class="small muted" style="margin-bottom:6px">Starting Chips</div>
            <input id="createStartChips" type="number" min="100" value="1000">
          </div>
          <div>
            <div class="small muted" style="margin-bottom:6px">Boot Amount</div>
            <input id="createBoot" type="number" min="1" value="10">
          </div>
        </div>
        <button id="btnCreateRoom" class="btn gold" style="width:100%;margin-top:8px">Create Room & Get Code</button>
      </div>
    </section>
  `;
}

function renderJoinFormHTML() {
  return `
    <section class="card">
      <h2>Join Existing Room</h2>
      <div class="setup-grid">
        <div>
          <div class="small muted" style="margin-bottom:6px">Room Code</div>
          <input id="joinRoomCode" value="${esc(queryRoomCode.toUpperCase())}" placeholder="6-digit code e.g. PATTI8" style="text-transform:uppercase;font-size:18px;font-weight:800;letter-spacing:0.1em">
        </div>
        <div>
          <div class="small muted" style="margin-bottom:6px">Your Name</div>
          <input id="joinPlayerName" placeholder="Enter your display name">
        </div>
        <button id="btnJoinRoom" class="btn gold" style="width:100%;margin-top:8px">Join Table</button>
      </div>
    </section>
  `;
}

function bindLobbyEvents() {
  document.getElementById('tabCreate')?.addEventListener('click', () => { activeTab = 'create'; render(); });
  document.getElementById('tabJoin')?.addEventListener('click', () => { activeTab = 'join'; render(); });

  document.getElementById('btnCreateRoom')?.addEventListener('click', async () => {
    const tableName = document.getElementById('createTableName').value.trim() || 'Friday Night';
    const hostName = document.getElementById('createHostName').value.trim() || 'Host';
    const startingChips = Number(document.getElementById('createStartChips').value) || 1000;
    const bootAmount = Number(document.getElementById('createBoot').value) || 10;

    const initial = createInitialRoomState({ tableName, startingChips, bootAmount, hostName });
    const myId = getMyPlayerId();
    initial.players[0].id = myId;

    room = initial;
    localStorage.setItem(LAST_ROOM_KEY, room.code);
    await syncRoomState(room);
    subscribeToRoom(room.code, handleRemoteStateUpdate);

    sounds.playWinSound();
    triggerConfetti();
    toast(`Room ${room.code} created!`);
    render();
  });

  document.getElementById('btnJoinRoom')?.addEventListener('click', async () => {
    const code = document.getElementById('joinRoomCode').value.trim().toUpperCase();
    const name = document.getElementById('joinPlayerName').value.trim();

    if (!code) return toast('Please enter a Room Code');
    if (!name) return toast('Please enter your name');

    const fetched = await fetchRoom(code);
    if (!fetched) {
      return toast('Room not found. Check code!');
    }

    room = fetched;
    const myId = getMyPlayerId();
    dispatchAction({ type: 'JOIN_PLAYER', payload: { name, playerId: myId } });

    localStorage.setItem(LAST_ROOM_KEY, code);
    subscribeToRoom(code, handleRemoteStateUpdate);

    sounds.playTurnSound();
    toast(`Joined table ${code}`);
    render();
  });

  document.getElementById('btnSupabaseSetup')?.addEventListener('click', openSupabaseSettingsModal);
}

// ----------------------------------------------------
// GAME ROOM SCREEN
// ----------------------------------------------------
function renderGameHTML() {
  const myId = getMyPlayerId();
  const me = room.players.find(p => p.id === myId) || { name: 'Spectator', balance: 0 };
  const currentTurnPlayer = room.players[room.currentTurnIndex] || room.players[0];
  const isMyTurn = currentTurnPlayer?.id === myId;
  const isHost = me.isHost || room.players[0]?.id === myId;
  const activePlayers = getActivePlayers(room);

  const { minBet, canAllIn } = calculateRequiredBet(room, myId);

  return `
    <div class="top">
      <div class="brand">
        <div class="logo">♠</div>
        <div>
          <h1>${esc(room.tableName)}</h1>
          <p>Round ${room.round} • ${room.players.length} Players</p>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button id="btnSoundToggle" class="btn" style="padding:6px 10px;min-height:34px;font-size:12px">${sounds.muted ? '🔇 Muted' : '🔊 Sound'}</button>
        <button id="btnShareQR" class="pill live" style="cursor:pointer">CODE: ${room.code} 📱</button>
      </div>
    </div>

    <!-- OVAL POKER FELT TABLE -->
    <div class="poker-table">
      <div class="table-watermark">♠ ♥ ♦ ♣</div>
      <div class="pot">
        <div class="label">CURRENT POT</div>
        <div class="value">${money(room.pot)}</div>
        <div class="meta">
          Base Chaal: <strong style="color:var(--gold-main)">${money(room.currentChaal)}</strong> • Boot: ${money(room.bootAmount)}
        </div>

        ${room.status === 'playing' ? `
          <div class="row" style="margin-top:16px">
            <button id="btnCollectPot" class="btn gold collect">
              👑 Declare Winner
            </button>
            <button id="btnSkipTurn" class="btn" style="min-height:50px;font-size:12px" title="Skip turn if player is AFK">
              ⏩ Skip Turn
            </button>
          </div>
        ` : `
          <button id="btnStartRound" class="btn gold collect">
            🃏 Start Round ${room.round} (Collect Boot)
          </button>
        `}
      </div>
    </div>

    <!-- SIDE SHOW REQUEST ALERT -->
    ${room.sideShowRequest ? renderSideShowBannerHTML(myId) : ''}

    <!-- PLAYERS LIST -->
    <section class="card">
      <h2>
        <span>Players Table (${room.players.length})</span>
        <span class="small muted">Turn Order ↻</span>
      </h2>
      <div class="player-list">
        ${renderPlayerListHTML(myId, isHost)}
      </div>
    </section>

    <!-- BETTING & ACTION PANEL -->
    ${room.status === 'playing' ? renderActionPanelHTML(me, myId, isMyTurn, minBet, canAllIn, activePlayers.length) : ''}

    <!-- LEADERBOARD -->
    <section class="card">
      <h2>Leaderboard</h2>
      <div class="leader">
        ${renderLeaderboardHTML()}
      </div>
    </section>

    <!-- ACTION LOG -->
    <section class="card">
      <h2>Round History</h2>
      <div class="history">
        ${renderHistoryHTML()}
      </div>
    </section>

    <!-- FIXED BOTTOM BAR -->
    <div class="bottom">
      <div class="bottom-inner">
        <button id="btnBottomShare" class="btn">📱 Invite</button>
        <button id="btnBottomReset" class="btn">🔄 Reset</button>
        <button id="btnBottomSettings" class="btn">⚙️ Table</button>
        <button id="btnBottomLeave" class="btn danger">🚪 Leave</button>
      </div>
    </div>
  `;
}

function renderPlayerListHTML(myId, isHost) {
  return room.players.map((p, idx) => {
    const isTurn = idx === room.currentTurnIndex && room.status === 'playing';
    const isDealer = idx === room.dealerIndex;
    const isFolded = p.isFolded;
    const isMe = p.id === myId;

    let tagHTML = '';
    if (isFolded) {
      tagHTML = '<span class="tag folded">Pack</span>';
    } else if (p.isBlind) {
      tagHTML = '<span class="tag blind">Blind</span>';
    } else {
      tagHTML = '<span class="tag seen">Seen</span>';
    }

    return `
      <div class="player ${isTurn ? 'is-turn' : ''} ${isFolded ? 'is-folded' : ''}">
        ${isTurn ? '<div class="turn-badge">YOUR TURN</div>' : ''}
        <div class="avatar">${initials(p.name)}</div>
        <div class="pinfo">
          <div class="pname-row">
            <div class="pname">${esc(p.name)} ${isMe ? '(You)' : ''} ${p.isHost ? '👑' : ''}</div>
            ${isDealer ? '<span class="tag dealer">Dealer</span>' : ''}
            ${tagHTML}
          </div>
          <div class="balance">${money(p.balance)} <span class="small muted">chips</span></div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn green" data-rebuy="${p.id}" style="min-height:36px;padding:4px 8px;font-size:11px" title="Top up 1000 chips">+💵</button>
          ${isHost && !isMe ? `
            <button class="btn danger" data-kick="${p.id}" style="min-height:36px;padding:4px 8px;font-size:11px">Kick</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderActionPanelHTML(me, myId, isMyTurn, minBet, canAllIn, activeCount) {
  const denoms = room.denominations || [5, 10, 20, 50, 100];
  const isFolded = me.isFolded;
  const isBlind = me.isBlind;

  return `
    <section class="card" style="${isMyTurn ? 'border-color:var(--gold-main);box-shadow:0 0 25px var(--gold-glow)' : ''}">
      <h2>
        <span>Your Actions (${esc(me.name)})</span>
        <span class="small muted">${isBlind ? 'BLIND (1x)' : 'SEEN (2x)'}</span>
      </h2>

      <div class="bet-box">
        <div class="bet-info">
          <span>Status: <strong>${isBlind ? '🙈 Blind' : '👁️ Seen'}</strong></span>
          <span>Min Chaal: <strong style="color:var(--gold-main)">${money(minBet)} chips</strong></span>
        </div>

        ${isBlind ? `
          <button id="btnSeeCards" class="btn green" style="width:100%;margin-top:10px;min-height:44px;font-size:13px">
            👁️ See Cards (Switch to 2x Chaal)
          </button>
        ` : ''}
      </div>

      <div class="chip-row">
        ${denoms.map(denom => `
          <button class="chip ${denom === selectedChip ? 'active' : ''}" data-chip="${denom}">${denom}</button>
        `).join('')}
      </div>

      <div class="quick-bets">
        <button data-quick="1">1x (${money(minBet)})</button>
        <button data-quick="2">2x (${money(minBet * 2)})</button>
        <button data-quick="3">3x (${money(minBet * 3)})</button>
        <button data-quick="5">5x (${money(minBet * 5)})</button>
      </div>

      <div class="row" style="margin-top:10px">
        <button id="btnFold" class="btn danger" ${isFolded ? 'disabled' : ''}>
          ❌ Pack / Fold
        </button>

        ${activeCount === 2 ? `
          <button id="btnShowCards" class="btn gold" ${isFolded || !isMyTurn ? 'disabled' : ''}>
            👀 Show Cards (${money(minBet)})
          </button>
        ` : `
          <button id="btnSideShow" class="btn" ${isFolded || activeCount < 3 ? 'disabled' : ''}>
            🤝 Side Show
          </button>
        `}

        ${canAllIn ? `
          <button id="btnAllIn" class="btn danger" ${isFolded || !isMyTurn ? 'disabled' : ''} style="flex:2">
            🔥 ALL-IN (${money(me.balance)})
          </button>
        ` : `
          <button id="btnBet" class="btn gold" ${isFolded || !isMyTurn || me.balance < minBet ? 'disabled' : ''} style="flex:2">
            💰 Chaal • ${money(selectedChip < minBet ? minBet : selectedChip)}
          </button>
        `}
      </div>
    </section>
  `;
}

function renderLeaderboardHTML() {
  const sorted = [...room.players].sort((a, b) => b.balance - a.balance);
  return sorted.map((p, i) => `
    <div class="rank">
      <span>${getRankBadge(i)} &nbsp; ${esc(p.name)}</span>
      <strong>${money(p.balance)} chips</strong>
    </div>
  `).join('');
}

function renderHistoryHTML() {
  if (!room.history || room.history.length === 0) {
    return '<div class="muted small">No actions yet.</div>';
  }
  return room.history.map(h => `
    <div class="history-item">
      <span>${esc(h.text)}</span>
      <span>${h.time}</span>
    </div>
  `).join('');
}

function renderSideShowBannerHTML(myId) {
  const req = room.sideShowRequest;
  const isForMe = req.toId === myId;
  const isFromMe = req.fromId === myId;

  return `
    <section class="card" style="border-color:var(--gold-main);background:#1a190f">
      <h3 style="margin:0 0 6px;color:var(--gold-main)">🤝 Side Show Requested</h3>
      <p style="font-size:13px;margin:0 0 10px;color:var(--text-muted)">
        <strong>${esc(req.fromName)}</strong> requested a side show with <strong>${esc(req.toName)}</strong>.
      </p>
      ${isForMe ? `
        <div class="row">
          <button id="btnAcceptSideShow" class="btn gold">✅ Accept Side Show</button>
          <button id="btnDeclineSideShow" class="btn danger">❌ Decline</button>
        </div>
      ` : (isFromMe || isForMe ? `
        <div class="small muted">Waiting for response... Choose who lost hand if accepted:</div>
        <div class="row" style="margin-top:6px">
          <button class="btn danger" data-sideshow-loser="${req.fromId}">${esc(req.fromName)} Lost Hand</button>
          <button class="btn danger" data-sideshow-loser="${req.toId}">${esc(req.toName)} Lost Hand</button>
        </div>
      ` : `
        <div class="small muted">Waiting for ${esc(req.toName)} to respond...</div>
      `)}
    </section>
  `;
}

function bindGameEvents() {
  const myId = getMyPlayerId();

  document.getElementById('btnSoundToggle')?.addEventListener('click', () => {
    sounds.toggleMute();
    render();
  });

  document.getElementById('btnShareQR')?.addEventListener('click', openQRModal);
  document.getElementById('btnBottomShare')?.addEventListener('click', openQRModal);

  document.getElementById('btnStartRound')?.addEventListener('click', () => {
    sounds.playBootSound();
    dispatchAction({ type: 'START_ROUND' });
    toast('Round started! Boot collected.');
  });

  document.getElementById('btnCollectPot')?.addEventListener('click', openWinnerModal);

  document.getElementById('btnSkipTurn')?.addEventListener('click', () => {
    dispatchAction({ type: 'SKIP_TURN' });
    toast('Turn skipped!');
  });

  document.querySelectorAll('[data-chip]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedChip = Number(btn.dataset.chip);
      render();
    });
  });

  document.querySelectorAll('[data-quick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mult = Number(btn.dataset.quick);
      const { minBet } = calculateRequiredBet(room, myId);
      const amount = minBet * mult;
      placeBet(amount);
    });
  });

  document.getElementById('btnBet')?.addEventListener('click', () => {
    const { minBet } = calculateRequiredBet(room, myId);
    const amount = Math.max(selectedChip, minBet);
    placeBet(amount);
  });

  document.getElementById('btnAllIn')?.addEventListener('click', () => {
    sounds.playChipSound();
    dispatchAction({ type: 'ALL_IN', payload: { playerId: myId } });
    toast('ALL-IN placed!');
  });

  document.getElementById('btnShowCards')?.addEventListener('click', () => {
    dispatchAction({ type: 'TRIGGER_SHOW', payload: { playerId: myId } });
    sounds.playWinSound();
    triggerConfetti();
    openWinnerModal();
  });

  document.getElementById('btnSeeCards')?.addEventListener('click', () => {
    dispatchAction({ type: 'TOGGLE_SEE_CARDS', payload: { playerId: myId } });
    toast('You are now SEEN!');
  });

  document.getElementById('btnFold')?.addEventListener('click', () => {
    sounds.playFoldSound();
    dispatchAction({ type: 'FOLD_PLAYER', payload: { playerId: myId } });
    toast('You folded (Pack)');
  });

  document.getElementById('btnSideShow')?.addEventListener('click', () => {
    dispatchAction({ type: 'REQUEST_SIDESHOW', payload: { fromId: myId } });
    toast('Side show requested!');
  });

  document.getElementById('btnAcceptSideShow')?.addEventListener('click', () => {
    dispatchAction({ type: 'RESPOND_SIDESHOW', payload: { accepted: true } });
  });

  document.getElementById('btnDeclineSideShow')?.addEventListener('click', () => {
    dispatchAction({ type: 'RESPOND_SIDESHOW', payload: { accepted: false } });
  });

  document.querySelectorAll('[data-sideshow-loser]').forEach(btn => {
    btn.addEventListener('click', () => {
      const loserId = btn.dataset.sideshowLoser;
      dispatchAction({ type: 'RESPOND_SIDESHOW', payload: { accepted: true, loserId } });
      toast('Side show resolved');
    });
  });

  document.querySelectorAll('[data-rebuy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.rebuy;
      dispatchAction({ type: 'REBUY_CHIPS', payload: { playerId: pid, amount: 1000 } });
      toast('Topped up 1000 chips!');
    });
  });

  document.querySelectorAll('[data-kick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.kick;
      dispatchAction({ type: 'REMOVE_PLAYER', payload: { playerId: pid } });
    });
  });

  document.getElementById('btnBottomReset')?.addEventListener('click', () => {
    if (confirm('Reset all player balances to starting chips?')) {
      dispatchAction({ type: 'RESET_CHIPS' });
      toast('Chips reset');
    }
  });

  document.getElementById('btnBottomSettings')?.addEventListener('click', openTableSettingsModal);

  document.getElementById('btnBottomLeave')?.addEventListener('click', () => {
    if (confirm('Leave this room table?')) {
      dispatchAction({ type: 'REMOVE_PLAYER', payload: { playerId: myId } });
      localStorage.removeItem(LAST_ROOM_KEY);
      room = null;
      render();
    }
  });
}

function placeBet(amount) {
  const myId = getMyPlayerId();
  sounds.playChipSound();
  dispatchAction({
    type: 'PLACE_BET',
    payload: {
      playerId: myId,
      amount,
      newBaseChaal: Math.max(room.currentChaal, Math.floor(amount / 2))
    }
  });
}

// ----------------------------------------------------
// MODALS (Winner, QR Code, Settings)
// ----------------------------------------------------
function openWinnerModal() {
  if (!room.pot) return toast('Pot is empty!');

  const active = getActivePlayers(room);

  modal(`
    <h3>Select Round Winner</h3>
    <p class="muted small" style="margin-bottom:14px">
      Who should receive the current pot of <strong style="color:var(--gold-main)">${money(room.pot)} chips</strong>?
    </p>
    <div class="sheet-grid">
      ${active.map(p => `
        <button class="btn gold" data-winner="${p.id}">${esc(p.name)}</button>
      `).join('')}
    </div>
    <button class="btn full" id="btnCloseModal">Cancel</button>
  `);

  document.querySelectorAll('[data-winner]').forEach(btn => {
    btn.addEventListener('click', () => {
      const winnerId = btn.dataset.winner;
      sounds.playWinSound();
      triggerConfetti();
      dispatchAction({ type: 'COLLECT_WINNER', payload: { winnerId } });
      closeModal();
    });
  });

  document.getElementById('btnCloseModal').addEventListener('click', closeModal);
}

function openQRModal() {
  const joinUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}`;

  modal(`
    <h3 style="text-align:center">Room Code: <span style="color:var(--gold-main)">${room.code}</span></h3>
    <p style="text-align:center;font-size:12px;color:var(--text-muted);margin:0 0 10px">
      Scan with phone camera or tap share to invite friends!
    </p>
    <div class="qr-box">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(joinUrl)}" alt="Room QR Code" width="160" height="160" style="border-radius:8px">
    </div>
    <div class="row" style="margin-top:14px">
      <button id="btnCopyLink" class="btn">📋 Copy Link</button>
      <button id="btnNativeShare" class="btn gold">📱 Share Room</button>
    </div>
    <button class="btn full" id="btnCloseModal">Close</button>
  `);

  document.getElementById('btnCopyLink').addEventListener('click', () => {
    navigator.clipboard.writeText(joinUrl);
    toast('Link copied to clipboard!');
  });

  document.getElementById('btnNativeShare').addEventListener('click', () => {
    if (navigator.share) {
      navigator.share({
        title: `Join Teen Patti Table ${room.tableName}`,
        text: `Play Teen Patti Virtual Chips with code ${room.code}!`,
        url: joinUrl
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(joinUrl);
      toast('Link copied to clipboard!');
    }
  });

  document.getElementById('btnCloseModal').addEventListener('click', closeModal);
}

function openTableSettingsModal() {
  const { url, anonKey } = getSupabaseConfig();

  modal(`
    <h3>Table & Backend Settings</h3>
    <div class="setup-grid">
      <div>
        <div class="small muted" style="margin-bottom:6px">Table Name</div>
        <input id="setTableName" value="${esc(room.tableName)}">
      </div>
      <div class="row">
        <div>
          <div class="small muted" style="margin-bottom:6px">Boot Amount</div>
          <input id="setBoot" type="number" value="${room.bootAmount}">
        </div>
        <div>
          <div class="small muted" style="margin-bottom:6px">Starting Chips</div>
          <input id="setStartChips" type="number" value="${room.startingChips}">
        </div>
      </div>
      <button id="btnSaveTableConfig" class="btn gold">Save Table Settings</button>

      <hr style="border:0;border-top:1px solid var(--panel-glass-border);margin:10px 0">

      <h3>Supabase Backend URL & Key</h3>
      <div class="small muted">Plug in your Supabase project credentials for instant global real-time sync across any network!</div>
      <input id="supaUrl" value="${esc(url)}" placeholder="https://xyz.supabase.co">
      <input id="supaKey" value="${esc(anonKey)}" placeholder="sbp_anon_key_here">
      <button id="btnSaveSupa" class="btn green">Save Supabase Credentials</button>
    </div>
    <button class="btn full" id="btnCloseModal" style="margin-top:12px">Close</button>
  `);

  document.getElementById('btnSaveTableConfig').addEventListener('click', () => {
    const tableName = document.getElementById('setTableName').value;
    const bootAmount = document.getElementById('setBoot').value;
    const startingChips = document.getElementById('setStartChips').value;

    dispatchAction({
      type: 'UPDATE_SETTINGS',
      payload: { tableName, bootAmount, startingChips }
    });
    toast('Settings updated');
    closeModal();
  });

  document.getElementById('btnSaveSupa').addEventListener('click', () => {
    const u = document.getElementById('supaUrl').value;
    const k = document.getElementById('supaKey').value;
    saveSupabaseConfig(u, k);
    toast('Supabase config saved');
    closeModal();
  });

  document.getElementById('btnCloseModal').addEventListener('click', closeModal);
}

function openSupabaseSettingsModal() {
  openTableSettingsModal();
}

function modal(content) {
  const el = document.getElementById('modal');
  el.innerHTML = `<div class="sheet">${content}</div>`;
  el.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

// Start application
initApp();
