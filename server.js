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

// CORS configuration allowing all origins without credentials conflict
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS']
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
  res.header('Access-Control-Allow-Origin', '*');
  const code = (req.params.code || '').toUpperCase();
  if (rooms[code]) {
    res.json({ success: true, room: rooms[code] });
  } else {
    res.status(404).json({ success: false, error: 'Room not found' });
  }
});

// REST endpoint to create or update room state
app.post('/api/rooms', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
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
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Socket.io Real-Time Event Handlers
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Join a Room Channel
  socket.on('join_room', ({ roomCode, name, playerId }, callback) => {
    const code = (roomCode || '').toUpperCase();
    if (!code) {
      if (typeof callback === 'function') callback({ success: false, error: 'Missing room code' });
      return;
    }

    socket.join(code);
    socket.roomCode = code;
    socket.playerId = playerId;

    if (rooms[code]) {
      if (name && playerId) {
        try {
          rooms[code] = reduceRoomAction(rooms[code], {
            type: 'JOIN_PLAYER',
            payload: { name, playerId }
          });
        } catch (err) {
          console.error('Error reducing JOIN_PLAYER:', err);
        }
      }
      io.to(code).emit('room_state', rooms[code]);
      if (typeof callback === 'function') callback({ success: true, room: rooms[code] });
    } else {
      if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
    }
  });

  // Create or Update Room State on Server
  socket.on('create_room', ({ roomState }, callback) => {
    if (!roomState || !roomState.code) {
      if (typeof callback === 'function') callback({ success: false, error: 'Invalid room state' });
      return;
    }
    const code = roomState.code.toUpperCase();
    rooms[code] = roomState;
    socket.join(code);
    socket.roomCode = code;
    io.to(code).emit('room_state', rooms[code]);
    if (typeof callback === 'function') callback({ success: true, room: rooms[code] });
  });

  // Dispatch Action (Bet, Fold, Side Show, Start Round, Winner Collect, etc.)
  socket.on('dispatch_action', ({ roomCode, action }, callback) => {
    const code = (roomCode || '').toUpperCase();
    if (!code || !rooms[code]) {
      if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
      return;
    }

    try {
      rooms[code] = reduceRoomAction(rooms[code], action);
      io.to(code).emit('room_state', rooms[code]);
      if (typeof callback === 'function') callback({ success: true, room: rooms[code] });
    } catch (err) {
      console.error('Error reducing action:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // Fetch Room State via Socket
  socket.on('fetch_room', ({ roomCode }, callback) => {
    const code = (roomCode || '').toUpperCase();
    if (rooms[code]) {
      socket.emit('room_state', rooms[code]);
      if (typeof callback === 'function') callback({ success: true, room: rooms[code] });
    } else {
      if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
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
