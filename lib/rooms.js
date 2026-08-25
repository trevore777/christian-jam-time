import { redis, redisPipeline } from './redis';

const ROOM_TTL_SECONDS = 60 * 60 * 12;
const PRESENCE_WINDOW_MS = 35_000;
const DEFAULT_ACTIVE_MUSICIAN_LIMIT = 8;
const ALLOWED_ACTIVE_LIMITS = [4, 6, 8, 10];

const stateKey = code => `cjt:room:${code}:state`;
const memberHashKey = code => `cjt:room:${code}:members`;
const presenceKey = code => `cjt:room:${code}:presence`;

function cleanText(value, max = 60) {
  return String(value || '').trim().slice(0, max);
}

function normalizedName(value) {
  return cleanText(value, 40).toLocaleLowerCase();
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
    micOn: Boolean(input.micOn),
    cameraOn: Boolean(input.cameraOn),
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

async function activeParticipants(code) {
  const cutoff = Date.now() - PRESENCE_WINDOW_MS;
  await redis(['ZREMRANGEBYSCORE', presenceKey(code), 0, cutoff]);
  const ids = await redis(['ZRANGE', presenceKey(code), 0, -1]);
  if (!ids?.length) return [];
  const values = await redis(['HMGET', memberHashKey(code), ...ids]);
  return (values || []).filter(Boolean).map(value => {
    try { return JSON.parse(value); } catch { return null; }
  }).filter(Boolean);
}

function normalisePerformanceState(state) {
  if (!Array.isArray(state.activeMusicianIds)) state.activeMusicianIds = state.leaderId ? [state.leaderId] : [];
  if (!ALLOWED_ACTIVE_LIMITS.includes(Number(state.maxActiveMusicians))) state.maxActiveMusicians = DEFAULT_ACTIVE_MUSICIAN_LIMIT;
  if (state.leaderId && !state.activeMusicianIds.includes(state.leaderId)) state.activeMusicianIds.unshift(state.leaderId);
  state.activeMusicianIds = Array.from(new Set(state.activeMusicianIds)).slice(0, state.maxActiveMusicians);
  return state;
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
    bootedNames: [],
    activeMusicianIds: [leader.id],
    maxActiveMusicians: DEFAULT_ACTIVE_MUSICIAN_LIMIT,
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
  if (!state) return { error: 'ROOM_NOT_FOUND' };
  const participant = sanitizeParticipant(participantInput, false);
  const nameKey = normalizedName(participant.name);
  if ((state.bootedNames || []).includes(nameKey)) return { error: 'BOOTED' };
  const active = await activeParticipants(code);
  if (active.some(item => item.id !== participant.id && normalizedName(item.name) === nameKey)) {
    return { error: 'DUPLICATE_USER' };
  }

  const next = normalisePerformanceState({ ...state });
  if (next.activeMusicianIds.length < next.maxActiveMusicians) {
    next.activeMusicianIds.push(participant.id);
    next.updatedAt = Date.now();
    await redis(['SET', stateKey(code), JSON.stringify(next), 'EX', ROOM_TTL_SECONDS]);
  }

  await upsertParticipant(code, participant);
  return { room: await getRoom(code) };
}

export async function claimLeadership(code, participantId) {
  const state = await getState(code);
  if (!state) return { error: 'ROOM_NOT_FOUND' };
  const participant = await participantFor(code, participantId);
  if (!participant) return { error: 'NOT_PARTICIPANT' };

  const next = normalisePerformanceState({ ...state, leaderId: participantId, updatedAt: Date.now() });
  if (!next.activeMusicianIds.includes(participantId)) {
    if (next.activeMusicianIds.length >= next.maxActiveMusicians) {
      const removable = next.activeMusicianIds.find(id => id !== state.leaderId && id !== participantId);
      if (removable) next.activeMusicianIds = next.activeMusicianIds.filter(id => id !== removable);
      else next.activeMusicianIds = next.activeMusicianIds.slice(0, Math.max(0, next.maxActiveMusicians - 1));
    }
    next.activeMusicianIds.unshift(participantId);
  }
  next.activeMusicianIds = Array.from(new Set(next.activeMusicianIds)).slice(0, next.maxActiveMusicians);
  await redis(['SET', stateKey(code), JSON.stringify(next), 'EX', ROOM_TTL_SECONDS]);
  await upsertParticipant(code, sanitizeParticipant(participant, true));
  return { room: await getRoom(code) };
}

export async function heartbeat(code, participantInput) {
  const state = await getState(code);
  if (!state) return null;
  const existing = await participantFor(code, participantInput.id);
  if (!existing) return null;
  const participant = sanitizeParticipant({ ...existing, ...participantInput }, participantInput.id === state.leaderId);
  await upsertParticipant(code, participant);
  return true;
}

export async function updateMediaStatus(code, participantId, media = {}) {
  const state = await getState(code);
  if (!state) return { error: 'ROOM_NOT_FOUND' };
  const existing = await participantFor(code, participantId);
  if (!existing) return { error: 'NOT_PARTICIPANT' };
  const isActiveMusician = state.activeMusicianIds.includes(participantId);
  const participant = sanitizeParticipant({
    ...existing,
    micOn: isActiveMusician && Boolean(media.micOn),
    cameraOn: isActiveMusician && Boolean(media.cameraOn),
  }, participantId === state.leaderId);
  await upsertParticipant(code, participant);
  return { room: await getRoom(code) };
}

export async function bootParticipant(code, leaderId, targetParticipantId) {
  const state = await getState(code);
  if (!state) return { error: 'ROOM_NOT_FOUND' };
  if (!leaderId || leaderId !== state.leaderId) return { error: 'NOT_LEADER' };
  if (!targetParticipantId || targetParticipantId === state.leaderId) return { error: 'INVALID_TARGET' };
  const target = await participantFor(code, targetParticipantId);
  if (!target) return { error: 'NOT_PARTICIPANT' };

  const nameKey = normalizedName(target.name);
  const bootedNames = Array.from(new Set([...(state.bootedNames || []), nameKey])).slice(-100);
  const next = normalisePerformanceState({
    ...state,
    bootedNames,
    activeMusicianIds: state.activeMusicianIds.filter(id => id !== targetParticipantId),
    updatedAt: Date.now(),
  });
  await redisPipeline([
    ['SET', stateKey(code), JSON.stringify(next), 'EX', ROOM_TTL_SECONDS],
    ['ZREM', presenceKey(code), targetParticipantId],
    ['HDEL', memberHashKey(code), targetParticipantId],
  ]);
  await touchKeys(code);
  return { room: await getRoom(code) };
}

export async function setParticipantPerformanceMode(code, leaderId, targetParticipantId, makeActive) {
  const state = await getState(code);
  if (!state) return { error: 'ROOM_NOT_FOUND' };
  if (!leaderId || leaderId !== state.leaderId) return { error: 'NOT_LEADER' };
  if (!targetParticipantId) return { error: 'INVALID_TARGET' };
  const target = await participantFor(code, targetParticipantId);
  if (!target) return { error: 'NOT_PARTICIPANT' };

  const next = normalisePerformanceState({ ...state });
  if (makeActive) {
    if (!next.activeMusicianIds.includes(targetParticipantId)) {
      if (next.activeMusicianIds.length >= next.maxActiveMusicians) return { error: 'ACTIVE_LIMIT_REACHED' };
      next.activeMusicianIds.push(targetParticipantId);
    }
  } else {
    if (targetParticipantId === state.leaderId) return { error: 'CANNOT_DEMOTE_LEADER' };
    next.activeMusicianIds = next.activeMusicianIds.filter(id => id !== targetParticipantId);
    const muted = sanitizeParticipant({ ...target, micOn: false, cameraOn: false }, false);
    await upsertParticipant(code, muted);
  }
  next.updatedAt = Date.now();
  await redis(['SET', stateKey(code), JSON.stringify(next), 'EX', ROOM_TTL_SECONDS]);
  return { room: await getRoom(code) };
}

export async function setActiveMusicianLimit(code, leaderId, requestedLimit) {
  const state = await getState(code);
  if (!state) return { error: 'ROOM_NOT_FOUND' };
  if (!leaderId || leaderId !== state.leaderId) return { error: 'NOT_LEADER' };
  const limit = Number(requestedLimit);
  if (!ALLOWED_ACTIVE_LIMITS.includes(limit)) return { error: 'INVALID_LIMIT' };

  const current = normalisePerformanceState({ ...state });
  const keep = [state.leaderId, ...current.activeMusicianIds.filter(id => id !== state.leaderId)].slice(0, limit);
  const demotedIds = current.activeMusicianIds.filter(id => !keep.includes(id));
  for (const id of demotedIds) {
    const participant = await participantFor(code, id);
    if (participant) await upsertParticipant(code, sanitizeParticipant({ ...participant, micOn: false, cameraOn: false }, false));
  }
  const next = { ...current, maxActiveMusicians: limit, activeMusicianIds: keep, updatedAt: Date.now() };
  await redis(['SET', stateKey(code), JSON.stringify(next), 'EX', ROOM_TTL_SECONDS]);
  return { room: await getRoom(code) };
}

export async function getState(code) {
  const raw = await redis(['GET', stateKey(code)]);
  if (!raw) return null;
  const state = normalisePerformanceState(JSON.parse(raw));
  if (!Array.isArray(state.suggestions)) state.suggestions = [];
  if (!Array.isArray(state.bootedNames)) state.bootedNames = [];
  return state;
}

export async function getRoom(code) {
  const state = await getState(code);
  if (!state) return null;
  const participants = (await activeParticipants(code)).map(participant => ({
    ...participant,
    isLeader: participant.id === state.leaderId,
    isActiveMusician: state.activeMusicianIds.includes(participant.id),
  }));
  const { bootedNames, activeMusicianIds, ...safeState } = state;
  return {
    ...safeState,
    activeMusicianCount: participants.filter(person => person.isActiveMusician).length,
    suggestions: state.suggestions || [],
    participants,
  };
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
