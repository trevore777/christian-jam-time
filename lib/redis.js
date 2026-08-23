const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export function realtimeConfigured() {
  return Boolean(redisUrl && redisToken);
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
    throw new Error(`Redis request failed (${response.status})`);
  }

  const payload = await response.json();
  if (payload.error) throw new Error(payload.error);
  return payload.result;
}

export async function redisPipeline(commands) {
  if (!realtimeConfigured()) {
    const error = new Error('Realtime storage is not configured. Add Upstash Redis REST environment variables in Vercel.');
    error.code = 'REALTIME_NOT_CONFIGURED';
    throw error;
  }

  const response = await fetch(`${redisUrl}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Redis pipeline failed (${response.status})`);
  }

  const payload = await response.json();
  return payload.map(item => item.result);
}
