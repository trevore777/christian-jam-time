import { WebSocketServer, WebSocket } from 'ws';
import { createClient } from 'redis';

const HOST = process.env.SIGNAL_HOST || '127.0.0.1';
const PORT = Number(process.env.SIGNAL_PORT || 3110);
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const redis = createClient({ url: REDIS_URL });
redis.on('error', error => console.error('[signal] Redis error:', error.message));
await redis.connect();

const socketsByRoom = new Map();

function normalizeCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  const code = raw.startsWith('CJT-') ? raw : `CJT-${raw}`;
  return /^CJT-\d{4}$/.test(code) ? code : null;
}

function memberKey(code) {
  return `cjt:room:${code}:members`;
}

function getRoomMap(code) {
  let room = socketsByRoom.get(code);
  if (!room) {
    room = new Map();
    socketsByRoom.set(code, room);
  }
  return room;
}

async function participantExists(code, participantId) {
  if (!code || !participantId) return false;
  return Boolean(await redis.hGet(memberKey(code), participantId));
}

function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function removeSocket(code, participantId, socket) {
  const room = socketsByRoom.get(code);
  if (!room) return;
  if (room.get(participantId) === socket) room.delete(participantId);
  if (!room.size) socketsByRoom.delete(code);
}

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on('connection', async (socket, request) => {
  let code = null;
  let participantId = '';

  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    code = normalizeCode(url.searchParams.get('room'));
    participantId = String(url.searchParams.get('participantId') || '').trim().slice(0, 80);

    if (!code || !participantId || !(await participantExists(code, participantId))) {
      sendJson(socket, { type: 'error', error: 'Invalid room or participant.' });
      socket.close(1008, 'Invalid participant');
      return;
    }

    const room = getRoomMap(code);
    const previous = room.get(participantId);
    if (previous && previous !== socket) previous.close(1000, 'Reconnected');
    room.set(participantId, socket);

    sendJson(socket, { type: 'ready', room: code, participantId });

    socket.on('message', async raw => {
      try {
        const message = JSON.parse(String(raw || ''));
        if (message?.type === 'ping') {
          sendJson(socket, { type: 'pong', at: Date.now() });
          return;
        }

        if (message?.type !== 'signal') return;
        const to = String(message.to || '').trim().slice(0, 80);
        if (!to || to === participantId) return;
        if (!(await participantExists(code, to))) return;

        const target = socketsByRoom.get(code)?.get(to);
        if (!target) {
          sendJson(socket, { type: 'target-offline', to });
          return;
        }

        sendJson(target, {
          type: 'signal',
          from: participantId,
          to,
          signal: message.signal || {},
          sentAt: Date.now(),
        });
      } catch (error) {
        sendJson(socket, { type: 'error', error: 'Invalid signalling message.' });
      }
    });

    socket.on('close', () => removeSocket(code, participantId, socket));
    socket.on('error', () => removeSocket(code, participantId, socket));
  } catch (error) {
    console.error('[signal] Connection error:', error.message);
    socket.close(1011, 'Signal server error');
  }
});

const heartbeat = setInterval(() => {
  for (const room of socketsByRoom.values()) {
    for (const socket of room.values()) {
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }
  }
}, 30_000);
heartbeat.unref();

function shutdown(signal) {
  console.log(`[signal] ${signal} received, shutting down`);
  clearInterval(heartbeat);
  wss.close(async () => {
    await redis.quit().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`[signal] WebSocket signalling listening on ws://${HOST}:${PORT}`);
