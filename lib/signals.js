import { redis, redisPipeline } from './redis';
import { getState } from './rooms';

const SIGNAL_TTL_SECONDS = 60 * 10;
const signalKey = (code, participantId) => `cjt:room:${code}:signals:${participantId}`;

export async function sendSignal(code, from, to, signal) {
  const state = await getState(code);
  if (!state) return { error: 'ROOM_NOT_FOUND' };
  if (!from || !to || !signal || typeof signal !== 'object') return { error: 'INVALID_SIGNAL' };

  const envelope = JSON.stringify({
    id: crypto.randomUUID(),
    from: String(from).slice(0, 80),
    to: String(to).slice(0, 80),
    signal,
    createdAt: Date.now(),
  });

  await redisPipeline([
    ['RPUSH', signalKey(code, to), envelope],
    ['EXPIRE', signalKey(code, to), SIGNAL_TTL_SECONDS],
  ]);
  return { ok: true };
}

export async function drainSignals(code, participantId) {
  const state = await getState(code);
  if (!state) return { error: 'ROOM_NOT_FOUND' };
  if (!participantId) return { error: 'INVALID_PARTICIPANT' };

  const key = signalKey(code, participantId);
  const messages = await redis(['LRANGE', key, 0, 99]);
  if (messages?.length) await redis(['LTRIM', key, messages.length, -1]);
  return {
    signals: (messages || []).map(item => {
      try { return JSON.parse(item); } catch { return null; }
    }).filter(Boolean),
  };
}
