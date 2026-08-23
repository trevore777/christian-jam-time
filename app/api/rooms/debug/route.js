import { NextResponse } from 'next/server';
import { realtimeConfigured, redis } from '../../../../lib/redis';
import { normalizeCode } from '../../../../lib/rooms';

export async function GET(request) {
  const configured = realtimeConfigured();
  let ping = null;
  let error = null;
  let roomCode = null;
  let roomExists = null;

  if (configured) {
    try {
      ping = await redis(['PING']);
      const requested = new URL(request.url).searchParams.get('code');
      roomCode = requested ? normalizeCode(requested) : null;
      if (roomCode) {
        roomExists = Number(await redis(['EXISTS', `cjt:room:${roomCode}:state`])) === 1;
      }
    } catch (err) {
      error = err?.message || 'Redis check failed';
    }
  }

  return NextResponse.json({
    ok: configured && ping === 'PONG',
    configured,
    ping,
    error,
    roomCode,
    roomExists,
    environment: process.env.VERCEL_ENV || 'unknown',
    deployment: process.env.VERCEL_URL || 'unknown',
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
    hasUpstashUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    hasUpstashToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    hasKvUrl: Boolean(process.env.KV_REST_API_URL),
    hasKvToken: Boolean(process.env.KV_REST_API_TOKEN),
  });
}
