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
    const result = await joinRoom(code, participant);
    if (result?.error === 'ROOM_NOT_FOUND') return NextResponse.json({ ok: false, error: 'Room not found or expired.' }, { status: 404 });
    if (result?.error === 'DUPLICATE_USER') return NextResponse.json({ ok: false, error: 'That name is already active in this Jam. Only one active participant per name is allowed.' }, { status: 409 });
    if (result?.error === 'BOOTED') return NextResponse.json({ ok: false, error: 'This participant has been removed from the Jam by the leader.' }, { status: 403 });
    if (!result?.room) return NextResponse.json({ ok: false, error: 'Unable to join this Jam.' }, { status: 400 });
    return NextResponse.json({ ok: true, room: result.room, participantId: id });
  } catch (error) {
    return apiError(error);
  }
}
