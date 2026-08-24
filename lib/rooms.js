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

function sanitizeSong(song = {}) {
  return {
    number: Number(song.number),
    title: cleanText(song.title, 120),
    key: cleanText(song.key, 12),
    pages: Array.isArray(song.pages) ? song.pages.slice(0, 10).map(Number).filter(Boolean) : [],
    firstLine: cleanText(song.firstLine, 240),
    scriptureRefs: Array.isArray(song.scriptureRefs) ? song.scriptureRefs.slice(0, 20).map(item => cleanText(item, 80)) : [],
    alternateTitles: Array.isArray(song.alternateTitles) ? song.alternateTitles.slice(0, 20).map(item => cleanText(item, 160)) : [],
    categories: Array.isArray(song.categories) ? song.categories.slice(0, 20).map(item => cleanText(item, 80)) : [],
    videoExample: song.videoExample ? cleanText(song.videoExample, 500) : null,
    lyricsChordPro: typeof song.lyricsChordPro === 'string' ? song.lyricsChordPro.slice(0, 50000) : '',
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

async function participantFor(code, participantId) {
  if (!participantId) return null;
  const raw = await redis(['HGET', memberHashKey(code), participantId]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
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
    suggestions: [],
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

export async function claimLeadership(code, participantId) {
  const state = await getState(code);
  if (!state) return { error: 'ROOM_NOT_FOUND' };
  const participant = await participantFor(code, participantId);
  if (!participant) return { error: 'NOT_PARTICIPANT' };

  const next = { ...state, leaderId: participantId, updatedAt: Date.now() };
  await redis(['SET', stateKey(code), JSON.stringify(next), 'EX', ROOM_TTL_SECONDS]);
  await upsertParticipant(code, sanitizeParticipant(participant, true));
  return { room: await getRoom(code) };
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
  if (!raw) return null;
  const state = JSON.parse(raw);
  if (!Array.isArray(state.suggestions)) state.suggestions = [];
  return state;
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
    participants = (values || []).filter(Boolean).map(value => {
      const participant = JSON.parse(value);
      return { ...participant, isLeader: participant.id === state.leaderId };
    });
  }

  return { ...state, suggestions: state.suggestions || [], participants };
}

export async function addSongSuggestion(code, participantId, song) {
  const state = await getState(code);
  if (!state) return { error: 'ROOM_NOT_FOUND' };
  const participant = await participantFor(code, participantId);
  if (!participant) return { error: 'NOT_PARTICIPANT' };
  if (!song?.number || !song?.title) return { error: 'INVALID_SONG' };

  const suggestions = Array.isArray(state.suggestions) ? [...state.suggestions] : [];
  const alreadyQueued = suggestions.some(item => Number(item.song?.number) === Number(song.number));
  const alreadyInPlaylist = (state.playlist || []).some(item => Number(item.number) === Number(song.number));
  if (alreadyQueued || alreadyInPlaylist) return { error: 'ALREADY_EXISTS' };

  suggestions.push({
    id: crypto.randomUUID(),
    song: sanitizeSong(song),
    suggestedBy: { id: participant.id, name: participant.name, instrument: participant.instrument },
    createdAt: Date.now(),
  });

  const next = { ...state, suggestions: suggestions.slice(-50), updatedAt: Date.now() };
  await redis(['SET', stateKey(code), JSON.stringify(next), 'EX', ROOM_TTL_SECONDS]);
  return { room: await getRoom(code) };
}

export async function resolveSongSuggestion(code, participantId, suggestionId, action) {
  const state = await getState(code);
  if (!state) return { error: 'ROOM_NOT_FOUND' };
  if (!participantId || participantId !== state.leaderId) return { error: 'NOT_LEADER' };

  const suggestions = Array.isArray(state.suggestions) ? [...state.suggestions] : [];
  const index = suggestions.findIndex(item => item.id === suggestionId);
  if (index < 0) return { error: 'SUGGESTION_NOT_FOUND' };
  const [suggestion] = suggestions.splice(index, 1);
  const next = { ...state, suggestions, updatedAt: Date.now() };

  if (action === 'approve') {
    const exists = (next.playlist || []).some(item => Number(item.number) === Number(suggestion.song.number));
    if (!exists) next.playlist = [...(next.playlist || []), sanitizeSong(suggestion.song)].slice(0, 100);
  } else if (action !== 'dismiss') {
    return { error: 'INVALID_ACTION' };
  }

  await redis(['SET', stateKey(code), JSON.stringify(next), 'EX', ROOM_TTL_SECONDS]);
  return { room: await getRoom(code) };
}

export async function updateRoomState(code, participantId, updates = {}) {
  const state = await getState(code);
  if (!state) return { error: 'ROOM_NOT_FOUND' };
  if (!participantId || participantId !== state.leaderId) return { error: 'NOT_LEADER' };

  const next = { ...state };
  if (Array.isArray(updates.playlist)) {
    next.playlist = updates.playlist.slice(0, 100).map(sanitizeSong);
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
