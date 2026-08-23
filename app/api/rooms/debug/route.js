import { NextResponse } from 'next/server';
import { realtimeConfigured, redis } from '../../../../lib/redis';

export async function GET() {
  const configured = realtimeConfigured();
  let ping = null;
  let error = null;
  if (configured) {
    try {
      ping = await redis(['PING']);
    } catch (err) {
      error = err?.message || 'Redis ping failed';
    }
  }

  return NextResponse.json({
    ok: configured && ping === 'PONG',
    configured,
    ping,
    error,
    environment: process.env.VERCEL_ENV || 'unknown',
    deployment: process.env.VERCEL_URL || 'unknown',
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
    hasUpstashUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    hasUpstashToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    hasKvUrl: Boolean(process.env.KV_REST_API_URL),
    hasKvToken: Boolean(process.env.KV_REST_API_TOKEN),
  });
}
