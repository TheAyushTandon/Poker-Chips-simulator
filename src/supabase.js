// Supabase Client & Realtime Sync Engine for Teen Patti Chips

import { createClient } from '@supabase/supabase-js';

const STORAGE_KEYS = {
  URL: 'tp_supabase_url',
  KEY: 'tp_supabase_anon_key',
  LOCAL_ROOM: 'tp_local_room_'
};

let supabaseClient = null;
let activeChannel = null;
let broadcastChannel = null;

export function getSupabaseConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem(STORAGE_KEYS.URL) || '';
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem(STORAGE_KEYS.KEY) || '';
  return { url, anonKey, isConfigured: Boolean(url && anonKey) };
}

export function saveSupabaseConfig(url, anonKey) {
  if (url) localStorage.setItem(STORAGE_KEYS.URL, url.trim());
  else localStorage.removeItem(STORAGE_KEYS.URL);

  if (anonKey) localStorage.setItem(STORAGE_KEYS.KEY, anonKey.trim());
  else localStorage.removeItem(STORAGE_KEYS.KEY);

  initSupabase();
}

export function initSupabase() {
  const { url, anonKey, isConfigured } = getSupabaseConfig();
  if (isConfigured) {
    try {
      supabaseClient = createClient(url, anonKey, {
        realtime: { params: { eventsPerSecond: 10 } }
      });
      return supabaseClient;
    } catch (err) {
      console.warn('Supabase initialization failed:', err);
      supabaseClient = null;
    }
  } else {
    supabaseClient = null;
  }
  return null;
}

// Fetch room state from Supabase (or LocalStorage fallback)
export async function fetchRoom(roomCode) {
  const code = roomCode.toUpperCase();
  const { isConfigured } = getSupabaseConfig();

  if (supabaseClient && isConfigured) {
    try {
      const { data, error } = await supabaseClient
        .from('rooms')
        .select('state')
        .eq('code', code)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Supabase fetch room error:', error);
      }
      if (data && data.state) {
        return data.state;
      }
    } catch (err) {
      console.warn('Supabase fetch exception:', err);
    }
  }

  // Fallback to local storage
  const localData = localStorage.getItem(STORAGE_KEYS.LOCAL_ROOM + code);
  return localData ? JSON.parse(localData) : null;
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

  const { isConfigured } = getSupabaseConfig();
  if (supabaseClient && isConfigured) {
    try {
      // Upsert room state in Supabase DB
      const { error } = await supabaseClient
        .from('rooms')
        .upsert({ code, state: roomState }, { onConflict: 'code' });

      if (error) {
        console.error('Supabase sync error:', error);
      }

      // Also send realtime broadcast payload
      if (activeChannel) {
        activeChannel.send({
          type: 'broadcast',
          event: 'state_update',
          payload: roomState
        });
      }
    } catch (err) {
      console.warn('Supabase sync exception:', err);
    }
  }
}

// Subscribe to real-time changes for a room code
export function subscribeToRoom(roomCode, onStateUpdate) {
  const code = roomCode.toUpperCase();

  // Cleanup old channel
  if (activeChannel) {
    activeChannel.unsubscribe();
    activeChannel = null;
  }

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

  const { isConfigured } = getSupabaseConfig();
  if (supabaseClient && isConfigured) {
    // 1. Listen to Realtime Broadcast channel
    activeChannel = supabaseClient.channel(`tp_channel_${code}`, {
      config: { broadcast: { self: false } }
    });

    activeChannel
      .on('broadcast', { event: 'state_update' }, (payload) => {
        if (payload && payload.payload) {
          onStateUpdate(payload.payload);
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'rooms',
        filter: `code=eq.${code}`
      }, (payload) => {
        if (payload && payload.new && payload.new.state) {
          onStateUpdate(payload.new.state);
        }
      })
      .subscribe((status) => {
        console.log(`Supabase Realtime status for room ${code}:`, status);
      });
  }

  // Initial fetch
  fetchRoom(code).then(state => {
    if (state) onStateUpdate(state);
  });
}

// Initialize Supabase on import
initSupabase();
