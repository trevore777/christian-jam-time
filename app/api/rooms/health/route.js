import { NextResponse } from 'next/server';
import { realtimeConfigured } from '../../../../lib/redis';

export async function GET() {
  return NextResponse.json({ ok: true, realtimeConfigured: realtimeConfigured() });
}
