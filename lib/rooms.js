import { redis, redisPipeline } from './redis';

const ROOM_TTL_SECONDS = 60 * 60 * 12;
const PRESENCE_WINDOW_MS = 35_000;

const stateKey = code => `cjt:room:${code}:state`;
const memberHashKey = code => `cjt:room:${code}:members`;
const presenceKey = code => `cjt:room:${code}:presence`;

function cleanText(value, max = 60) {
  return String(value || '').trim().slice(0, max);
}

export function normalizeCode(value) {
  const raw = cleanText(value, 20).toUpperCase();
  const code = raw.startsWith('CJT-') ? raw : `CJT-${raw}`;
  return /^CJT-\d{4}$/.test(code) ? code : null;
}

export function sanitizeParticipant(input = {}, isLeader = false) {
  return {
    id: cleanText(input.id, 80),
    name: cleanText(input.name, 40) || 'Guest',
    instrument: cleanText(input.instrument, 30) || 'Other',
    isLeader: Boolean(isLeader),
  };
}

async function touchKeys(code) {
  await redisPipeline([
    ['EXPIRE', stateKey(code), ROOM_TTL_SECONDS],
    ['EXPIRE', memberHashKey(code), ROOM_TTL_SECONDS],
    ['EXPIRE', presenceKey(code), ROOM_TTL_SECONDS],
  ]);
}

async function upsertParticipant(code, participant) {
  const now = Date.now();
  await redisPipeline([
    ['HSET', memberHashKey(code), participant.id, JSON.stringify(participant)],
    ['ZADD', presenceKey(code), now, participant.id],
  ]);
  await touchKeys(code);
}

export async function roomExists(code) {
  return Number(await redis(['EXISTS', stateKey(code)])) === 1;
}

export async function createRoom({ code, participant }) {
  const leader = sanitizeParticipant(participant, true);
  const now = Date.now();
  const state = {
    code,
    leaderId: leader.id,
    playlist: [],
    currentIndex: -1,
    shift: 0,
    createdAt: now,
    updatedAt: now,
  };

  await redis(['SET', stateKey(code), JSON.stringify(state), 'EX', ROOM_TTL_SECONDS]);
  await upsertParticipant(code, leader);
  return getRoom(code);
}

export async function joinRoom(code, participantInput) {
  const state = await getState(code);
  if (!state) return null;
  const participant = sanitizeParticipant(participantInput, false);
  await upsertParticipant(code, participant);
  return getRoom(code);
}

export async function heartbeat(code, participantInput) {
  const state = await getState(code);
  if (!state) return null;
  const participant = sanitizeParticipant(participantInput, participantInput.id === state.leaderId);
  await upsertParticipant(code, participant);
  return true;
}

export async function getState(code) {
  const raw = await redis(['GET', stateKey(code)]);
  return raw ? JSON.parse(raw) : null;
}

export async function getRoom(code) {
  const state = await getState(code);
  if (!state) return null;

  const cutoff = Date.now() - PRESENCE_WINDOW_MS;
  await redis(['ZREMRANGEBYSCORE', presenceKey(code), 0, cutoff]);
  const ids = await redis(['ZRANGE', presenceKey(code), 0, -1]);
  let participants = [];

  if (ids?.length) {
    const values = await redis(['HMGET', memberHashKey(code), ...ids]);
    participants = (values || []).filter(Boolean).map(value => JSON.parse(value));
  }

  return { ...state, participants };
}

export async function updateRoomState(code, participantId, updates = {}) {
  const state = await getState(code);
  if (!state) return { error: 'ROOM_NOT_FOUND' };
  if (!participantId || participantId !== state.leaderId) return { error: 'NOT_LEADER' };

  const next = { ...state };
  if (Array.isArray(updates.playlist)) {
    next.playlist = updates.playlist.slice(0, 100).map(song => ({
      number: Number(song.number),
      title: cleanText(song.title, 120),
      key: cleanText(song.key, 5),
      page: Number(song.page) || 0,
    }));
  }
  if (Number.isInteger(updates.currentIndex)) {
    next.currentIndex = Math.max(-1, Math.min(updates.currentIndex, next.playlist.length - 1));
  }
  if (Number.isInteger(updates.shift)) {
    next.shift = Math.max(-24, Math.min(24, updates.shift));
  }
  next.updatedAt = Date.now();

  await redis(['SET', stateKey(code), JSON.stringify(next), 'EX', ROOM_TTL_SECONDS]);
  return { room: await getRoom(code) };
}
