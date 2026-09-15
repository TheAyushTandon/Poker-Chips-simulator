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

export function getBackendUrl() {
  return import.meta.env.VITE_BACKEND_URL || localStorage.getItem(STORAGE_KEYS.SERVER_URL) || DEFAULT_BACKEND_URL;
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
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    socket.on('connect', () => {
      console.log('⚡ Connected to Socket.io Realtime Backend:', serverUrl);
      if (currentRoomCode && activeCallback) {
        socket.emit('fetch_room', { roomCode: currentRoomCode });
      }
    });

    socket.on('room_state', (roomState) => {
      if (!roomState || !roomState.code) return;
      const code = roomState.code.toUpperCase();
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

// Fetch room state from server (or LocalStorage fallback)
export async function fetchRoom(roomCode) {
  const code = (roomCode || '').toUpperCase();
  if (!code) return null;

  // Check local cache first for instant render
  const cached = localStorage.getItem(STORAGE_KEYS.LOCAL_ROOM + code);
  let state = cached ? JSON.parse(cached) : null;

  try {
    const serverUrl = getBackendUrl();
    const res = await fetch(`${serverUrl}/api/rooms/${code}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.room) {
        state = data.room;
        localStorage.setItem(STORAGE_KEYS.LOCAL_ROOM + code, JSON.stringify(state));
      }
    }
  } catch (err) {
    console.warn('REST fetch room fallback:', err);
  }

  return state;
}

// Save & Broadcast updated room state
export async function syncRoomState(roomState) {
  if (!roomState || !roomState.code) return;
  const code = roomState.code.toUpperCase();

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

  // Socket.io Real-Time Broadcast to Render Server
  if (!socket) initSocket();
  if (socket && socket.connected) {
    socket.emit('create_room', { roomState });
  }
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
