import { createClient } from 'redis';

const localRedisUrl = process.env.REDIS_URL;
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let localClient;
let localClientPromise;

export function realtimeConfigured() {
  return Boolean(localRedisUrl || (redisUrl && redisToken));
}

function redisFailure(message, status) {
  const text = String(message || `Redis request failed (${status})`);
  const error = new Error(text);
  error.status = status;
  if (/max (daily )?requests? limit exceeded|max monthly request|quota/i.test(text)) {
    error.code = 'REDIS_REQUEST_LIMIT';
  } else if (/capacity quota exceeded|storage limit/i.test(text)) {
    error.code = 'REDIS_CAPACITY_LIMIT';
  } else {
    error.code = 'REDIS_ERROR';
  }
  return error;
}

async function getLocalClient() {
  if (!localRedisUrl) return null;
  if (localClient?.isReady) return localClient;

  if (!localClientPromise) {
    localClient = createClient({ url: localRedisUrl });
    localClient.on('error', error => {
      console.error('Local Redis error:', error?.message || error);
    });

    localClientPromise = localClient.connect()
      .then(() => localClient)
      .catch(error => {
        localClientPromise = null;
        throw redisFailure(error?.message || 'Unable to connect to local Redis.');
      });
  }

  return localClientPromise;
}

function normalizeCommand(command) {
  if (!Array.isArray(command) || !command.length) {
    throw redisFailure('Invalid Redis command.');
  }
  return command.map(value => String(value));
}

async function runLocal(command) {
  const client = await getLocalClient();
  return client.sendCommand(normalizeCommand(command));
}

async function readRedisError(response, fallback) {
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const payload = JSON.parse(text);
      return payload?.error || payload?.message || text;
    } catch {
      return text;
    }
  } catch {
    return fallback;
  }
}

async function runRest(command) {
  const response = await fetch(redisUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = await readRedisError(response, `Redis request failed (${response.status})`);
    throw redisFailure(message, response.status);
  }

  const payload = await response.json();
  if (payload.error) throw redisFailure(payload.error, response.status);
  return payload.result;
}

export async function redis(command) {
  if (localRedisUrl) return runLocal(command);

  if (!(redisUrl && redisToken)) {
    const error = new Error('Realtime storage is not configured. Set REDIS_URL for AWS/local Redis or configure Upstash Redis REST variables.');
    error.code = 'REALTIME_NOT_CONFIGURED';
    throw error;
  }

  return runRest(command);
}

export async function redisPipeline(commands) {
  if (!Array.isArray(commands)) throw redisFailure('Invalid Redis pipeline.');

  if (localRedisUrl) {
    const client = await getLocalClient();
    return Promise.all(commands.map(command => client.sendCommand(normalizeCommand(command))));
  }

  if (!(redisUrl && redisToken)) {
    const error = new Error('Realtime storage is not configured. Set REDIS_URL for AWS/local Redis or configure Upstash Redis REST variables.');
    error.code = 'REALTIME_NOT_CONFIGURED';
    throw error;
  }

  const base = String(redisUrl).replace(/\/+$/, '');
  const response = await fetch(`${base}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = await readRedisError(response, `Redis pipeline failed (${response.status})`);
    throw redisFailure(message, response.status);
  }

  const payload = await response.json();
  const failed = Array.isArray(payload) ? payload.find(item => item?.error) : null;
  if (failed?.error) throw redisFailure(failed.error, response.status);
  return payload.map(item => item.result);
}
