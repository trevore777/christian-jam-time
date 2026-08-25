const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export function realtimeConfigured() {
  return Boolean(redisUrl && redisToken);
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

async function readRedisError(response, fallback) {
  try {
    const payload = await response.json();
    return payload?.error || payload?.message || fallback;
  } catch {
    try {
      const text = await response.text();
      return text || fallback;
    } catch {
      return fallback;
    }
  }
}

export async function redis(command) {
  if (!realtimeConfigured()) {
    const error = new Error('Realtime storage is not configured. Add Upstash Redis REST environment variables in Vercel.');
    error.code = 'REALTIME_NOT_CONFIGURED';
    throw error;
  }

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

export async function redisPipeline(commands) {
  if (!realtimeConfigured()) {
    const error = new Error('Realtime storage is not configured. Add Upstash Redis REST environment variables in Vercel.');
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
