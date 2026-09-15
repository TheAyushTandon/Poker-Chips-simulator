// Real-time Socket.io Sync Engine (Render Backend + Vercel Frontend)

import { io } from 'socket.io-client';

const STORAGE_KEYS = {
  SERVER_URL: 'tp_socket_server_url',
  LOCAL_ROOM: 'tp_local_room_'
};

// Default Backend URL on Render
const DEFAULT_BACKEND_URL = 'https://poker-chips-simulator.onrender.com';

let socket = null;
let currentRoomCode = null;
let activeCallback = null;
let broadcastChannel = null;
let activeRoomState = null;

export function getBackendUrl() {
  return import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_SUPABASE_URL || localStorage.getItem(STORAGE_KEYS.SERVER_URL) || DEFAULT_BACKEND_URL;
}

export function saveBackendUrl(url) {
  if (url) {
    localStorage.setItem(STORAGE_KEYS.SERVER_URL, url.trim());
  } else {
    localStorage.removeItem(STORAGE_KEYS.SERVER_URL);
  }
  initSocket();
}

export function initSocket() {
  const serverUrl = getBackendUrl();
  if (socket) {
    socket.disconnect();
  }

  try {
    socket = io(serverUrl, {
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 15,
      reconnectionDelay: 1000
    });

    socket.on('connect', () => {
      console.log('⚡ Connected to Socket.io Realtime Backend:', serverUrl);
      // Auto re-register or rejoin room upon connection/reconnection
      if (activeRoomState && activeRoomState.code) {
        socket.emit('create_room', { roomState: activeRoomState });
      } else if (currentRoomCode) {
        socket.emit('join_room', { roomCode: currentRoomCode });
        socket.emit('fetch_room', { roomCode: currentRoomCode });
      }
    });

    socket.on('room_state', (roomState) => {
      if (!roomState || !roomState.code) return;
      const code = roomState.code.toUpperCase();
      activeRoomState = roomState;
      localStorage.setItem(STORAGE_KEYS.LOCAL_ROOM + code, JSON.stringify(roomState));

      if (activeCallback) {
        activeCallback(roomState);
      }
    });

    socket.on('connect_error', (err) => {
      console.warn('Socket.io connection warning:', err.message);
    });
  } catch (err) {
    console.warn('Socket initialization exception:', err);
  }

  return socket;
}

// Fetch room state from server (Socket.io acknowledgement primary, REST fallback)
export async function fetchRoom(roomCode) {
  const code = (roomCode || '').toUpperCase();
  if (!code) return null;

  // Check local cache first
  const cached = localStorage.getItem(STORAGE_KEYS.LOCAL_ROOM + code);
  let localState = cached ? JSON.parse(cached) : null;

  if (!socket) initSocket();

  // 1. Fetch via Socket.io acknowledgement (instant, zero CORS restrictions)
  const socketFetch = new Promise((resolve) => {
    if (!socket) return resolve(null);

    const askSocket = () => {
      try {
        socket.emit('fetch_room', { roomCode: code }, (res) => {
          if (res && res.success && res.room) {
            resolve(res.room);
          } else {
            resolve(null);
          }
        });
      } catch (err) {
        resolve(null);
      }
    };

    if (socket.connected) {
      askSocket();
    } else {
      const onConn = () => {
        socket.off('connect', onConn);
        askSocket();
      };
      socket.once('connect', onConn);
      setTimeout(() => {
        socket.off('connect', onConn);
        resolve(null);
      }, 2500);
    }
  });

  // 2. Parallel REST fetch fallback
  const restFetch = (async () => {
    try {
      const serverUrl = getBackendUrl();
      const res = await fetch(`${serverUrl}/api/rooms/${code}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.room) return data.room;
      }
    } catch (e) {
      // Ignore network/CORS errors silently
    }
    return null;
  })();

  const socketResult = await Promise.race([
    socketFetch,
    new Promise(r => setTimeout(() => r(null), 2500))
  ]);

  if (socketResult) {
    activeRoomState = socketResult;
    localStorage.setItem(STORAGE_KEYS.LOCAL_ROOM + code, JSON.stringify(socketResult));
    return socketResult;
  }

  const restResult = await restFetch;
  if (restResult) {
    activeRoomState = restResult;
    localStorage.setItem(STORAGE_KEYS.LOCAL_ROOM + code, JSON.stringify(restResult));
    return restResult;
  }

  return localState;
}

// Save & Broadcast updated room state
export async function syncRoomState(roomState) {
  if (!roomState || !roomState.code) return;
  const code = roomState.code.toUpperCase();
  activeRoomState = roomState;
  currentRoomCode = code;

  // Save to Local Storage always as instant backup
  localStorage.setItem(STORAGE_KEYS.LOCAL_ROOM + code, JSON.stringify(roomState));

  // Local BroadcastChannel sync for same-origin tabs
  if (window.BroadcastChannel) {
    if (!broadcastChannel || broadcastChannel.name !== `tp_room_${code}`) {
      if (broadcastChannel) broadcastChannel.close();
      broadcastChannel = new BroadcastChannel(`tp_room_${code}`);
    }
    broadcastChannel.postMessage({ type: 'ROOM_UPDATE', state: roomState });
  }

  // Socket.io Real-Time Broadcast to Render Server (Always emit - Socket.io queues if connecting)
  if (!socket) initSocket();
  if (socket) {
    socket.emit('create_room', { roomState });
  }

  // REST POST sync as backup
  try {
    const serverUrl = getBackendUrl();
    fetch(`${serverUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomState })
    }).catch(() => {});
  } catch (err) {}
}

// Send specific action to server reducer
export function dispatchSocketAction(roomCode, action) {
  if (!roomCode || !action) return;
  const code = roomCode.toUpperCase();

  if (!socket) initSocket();
  if (socket) {
    socket.emit('dispatch_action', { roomCode: code, action });
  }
}

// Subscribe to real-time changes for a room code
export function subscribeToRoom(roomCode, onStateUpdate) {
  const code = (roomCode || '').toUpperCase();
  currentRoomCode = code;
  activeCallback = onStateUpdate;

  // Local Tab Sync via BroadcastChannel
  if (window.BroadcastChannel) {
    if (broadcastChannel) broadcastChannel.close();
    broadcastChannel = new BroadcastChannel(`tp_room_${code}`);
    broadcastChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'ROOM_UPDATE') {
        onStateUpdate(event.data.state);
      }
    };
  }

  if (!socket) initSocket();
  if (socket) {
    socket.emit('join_room', { roomCode: code });
    socket.emit('fetch_room', { roomCode: code });
  }

  // Initial local fetch
  fetchRoom(code).then(state => {
    if (state) onStateUpdate(state);
  });
}

// Legacy compatibility stubs for UI settings modal
export function getSupabaseConfig() {
  return {
    url: getBackendUrl(),
    anonKey: 'Socket.io Server',
    isConfigured: true
  };
}

export function saveSupabaseConfig(url) {
  saveBackendUrl(url);
}

// Initialize socket connection on load
initSocket();
