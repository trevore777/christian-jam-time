import { NextResponse } from 'next/server';
import { createRoom, roomExists, sanitizeParticipant } from '../../../../lib/rooms';
import { verifyLeaderPin } from '../../../../lib/leaderPin';

function apiError(error, status = 500) {
  const message = error?.code === 'REALTIME_NOT_CONFIGURED'
    ? 'Realtime rooms need a Redis database connected in Vercel.'
    : error?.message || 'Unable to create room.';
  return NextResponse.json({ ok: false, error: message, code: error?.code || 'SERVER_ERROR' }, { status });
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!verifyLeaderPin(body.leaderPin)) {
      return NextResponse.json({ ok: false, error: 'Incorrect leader PIN.' }, { status: 403 });
    }

    const id = crypto.randomUUID();
    const participant = sanitizeParticipant({ id, name: body.name, instrument: body.instrument }, true);

    let code = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = `CJT-${Math.floor(1000 + Math.random() * 9000)}`;
      if (!(await roomExists(candidate))) {
        code = candidate;
        break;
      }
    }

    if (!code) return NextResponse.json({ ok: false, error: 'Could not allocate a room code. Try again.' }, { status: 503 });
    const room = await createRoom({ code, participant });
    return NextResponse.json({ ok: true, room, participantId: id });
  } catch (error) {
    return apiError(error);
  }
}
