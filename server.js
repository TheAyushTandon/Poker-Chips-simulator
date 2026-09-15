import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createInitialRoomState,
  reduceRoomAction,
  formatTime
} from './src/teenPattiEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

// Enable CORS for Vercel frontend & any origin
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// Explicit CORS headers middleware for all REST API responses & OPTIONS preflight
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true
});

// In-Memory Rooms State Store
const rooms = {};

// Health check endpoint for Render
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', activeRooms: Object.keys(rooms).length });
});

// REST endpoint to fetch room state
app.get('/api/rooms/:code', (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  if (rooms[code]) {
    res.json({ success: true, room: rooms[code] });
  } else {
    res.status(404).json({ success: false, error: 'Room not found' });
  }
});

// REST endpoint to create or update room state
app.post('/api/rooms', (req, res) => {
  const { roomState } = req.body || {};
  if (!roomState || !roomState.code) {
    return res.status(400).json({ success: false, error: 'Invalid room state' });
  }
  const code = roomState.code.toUpperCase();
  rooms[code] = roomState;
  io.to(code).emit('room_state', rooms[code]);
  res.json({ success: true, room: rooms[code] });
});

// Serve static frontend files if served from Render directly
app.use(express.static(path.join(__dirname, 'dist')));

// Socket.io Real-Time Event Handlers
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Join a Room Channel
  socket.on('join_room', ({ roomCode, name, playerId }) => {
    const code = (roomCode || '').toUpperCase();
    if (!code) return;

    socket.join(code);
    socket.roomCode = code;
    socket.playerId = playerId;

    if (rooms[code]) {
      // Dispatch JOIN_PLAYER action if room exists
      rooms[code] = reduceRoomAction(rooms[code], {
        type: 'JOIN_PLAYER',
        payload: { name, playerId }
      });
      // Broadcast updated room state to all clients in room
      io.to(code).emit('room_state', rooms[code]);
    }
  });

  // Create Room State on Server
  socket.on('create_room', ({ roomState }) => {
    if (!roomState || !roomState.code) return;
    const code = roomState.code.toUpperCase();
    rooms[code] = roomState;
    socket.join(code);
    socket.roomCode = code;
    io.to(code).emit('room_state', rooms[code]);
  });

  // Dispatch Action (Bet, Fold, Side Show, Start Round, Winner Collect, etc.)
  socket.on('dispatch_action', ({ roomCode, action }) => {
    const code = (roomCode || '').toUpperCase();
    if (!code || !rooms[code]) return;

    // Reduce action against current room state
    rooms[code] = reduceRoomAction(rooms[code], action);

    // Broadcast new room state immediately to all connected devices in room
    io.to(code).emit('room_state', rooms[code]);
  });

  // Fetch Room State
  socket.on('fetch_room', ({ roomCode }) => {
    const code = (roomCode || '').toUpperCase();
    if (rooms[code]) {
      socket.emit('room_state', rooms[code]);
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Real-Time Socket.io Server listening on port ${PORT}`);
});
