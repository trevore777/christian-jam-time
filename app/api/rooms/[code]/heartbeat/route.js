import { NextResponse } from 'next/server';
import { heartbeat, normalizeCode, sanitizeParticipant } from '../../../../../lib/rooms';

export async function POST(request, { params }) {
  try {
    const { code: rawCode } = await params;
    const code = normalizeCode(rawCode);
    if (!code) return NextResponse.json({ ok: false, error: 'Invalid room code.' }, { status: 400 });
    const body = await request.json();
    const participant = sanitizeParticipant({ id: body.participantId, name: body.name, instrument: body.instrument }, false);
    if (!participant.id) return NextResponse.json({ ok: false, error: 'Missing participant.' }, { status: 400 });
    const result = await heartbeat(code, participant);
    if (!result) return NextResponse.json({ ok: false, error: 'Room not found or expired.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error?.code === 'REALTIME_NOT_CONFIGURED'
      ? 'Realtime rooms need a Redis database connected in Vercel.'
      : error?.message || 'Heartbeat failed.';
    return NextResponse.json({ ok: false, error: message, code: error?.code || 'SERVER_ERROR' }, { status: 500 });
  }
}
