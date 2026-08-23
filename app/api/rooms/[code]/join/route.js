import { NextResponse } from 'next/server';
import { joinRoom, normalizeCode, sanitizeParticipant } from '../../../../../lib/rooms';

function apiError(error, status = 500) {
  const message = error?.code === 'REALTIME_NOT_CONFIGURED'
    ? 'Realtime rooms need a Redis database connected in Vercel.'
    : error?.message || 'Unable to join room.';
  return NextResponse.json({ ok: false, error: message, code: error?.code || 'SERVER_ERROR' }, { status });
}

export async function POST(request, { params }) {
  try {
    const { code: rawCode } = await params;
    const code = normalizeCode(rawCode);
    if (!code) return NextResponse.json({ ok: false, error: 'Enter a room code such as CJT-4271.' }, { status: 400 });
    const body = await request.json();
    const id = crypto.randomUUID();
    const participant = sanitizeParticipant({ id, name: body.name, instrument: body.instrument }, false);
    const room = await joinRoom(code, participant);
    if (!room) return NextResponse.json({ ok: false, error: 'Room not found or expired.' }, { status: 404 });
    return NextResponse.json({ ok: true, room, participantId: id });
  } catch (error) {
    return apiError(error);
  }
}
