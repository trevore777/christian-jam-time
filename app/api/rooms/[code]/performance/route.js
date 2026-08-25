import { NextResponse } from 'next/server';
import { normalizeCode, setActiveMusicianLimit, setParticipantPerformanceMode } from '../../../../../lib/rooms';

function resultError(result) {
  const messages = {
    ROOM_NOT_FOUND: ['Room not found or expired.', 404],
    NOT_LEADER: ['Only the Jam leader can change performance settings.', 403],
    NOT_PARTICIPANT: ['That participant is no longer in the room.', 404],
    ACTIVE_LIMIT_REACHED: ['The active musician limit has been reached. Move another musician to Listener first, or increase the limit.', 409],
    CANNOT_DEMOTE_LEADER: ['The leader must remain an active musician.', 400],
    INVALID_LIMIT: ['Choose an active musician limit of 4, 6, 8 or 10.', 400],
    INVALID_TARGET: ['Choose a valid participant.', 400],
  };
  const [message, status] = messages[result?.error] || ['Unable to update performance settings.', 400];
  return NextResponse.json({ ok: false, error: message, code: result?.error || 'UPDATE_FAILED' }, { status });
}

export async function POST(request, { params }) {
  try {
    const { code: rawCode } = await params;
    const code = normalizeCode(rawCode);
    if (!code) return NextResponse.json({ ok: false, error: 'Invalid room code.' }, { status: 400 });
    const body = await request.json();

    let result;
    if (body.action === 'set-limit') {
      result = await setActiveMusicianLimit(code, body.participantId, body.limit);
    } else if (body.action === 'set-mode') {
      result = await setParticipantPerformanceMode(code, body.participantId, body.targetParticipantId, body.mode === 'musician');
    } else {
      return NextResponse.json({ ok: false, error: 'Unknown performance action.' }, { status: 400 });
    }

    if (result?.error) return resultError(result);
    return NextResponse.json({ ok: true, room: result.room });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to update performance settings.' }, { status: 500 });
  }
}
