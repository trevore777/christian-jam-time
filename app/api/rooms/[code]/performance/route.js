import { NextResponse } from 'next/server';
import { normalizeCode, setSongLeader, setParticipantPerformanceMode } from '../../../../../lib/rooms';

function resultError(result) {
  const messages = {
    ROOM_NOT_FOUND: ['Room not found or expired.', 404],
    NOT_LEADER: ['Only the Jam leader can choose the Song Leader.', 403],
    NOT_PARTICIPANT: ['That participant is no longer in the room.', 404],
    INVALID_TARGET: ['Choose a valid participant.', 400],
  };
  const [message, status] = messages[result?.error] || ['Unable to update the Song Leader.', 400];
  return NextResponse.json({ ok: false, error: message, code: result?.error || 'UPDATE_FAILED' }, { status });
}

export async function POST(request, { params }) {
  try {
    const { code: rawCode } = await params;
    const code = normalizeCode(rawCode);
    if (!code) return NextResponse.json({ ok: false, error: 'Invalid room code.' }, { status: 400 });
    const body = await request.json();

    let result;
    if (body.action === 'set-song-leader') {
      result = await setSongLeader(code, body.participantId, body.targetParticipantId);
    } else if (body.action === 'set-mode') {
      // Backward compatibility for an older browser tab during deployment.
      result = await setParticipantPerformanceMode(code, body.participantId, body.targetParticipantId, body.mode === 'musician');
    } else if (body.action === 'set-limit') {
      // Single Song Leader mode always has one broadcaster. Return current room rather than failing an older tab.
      result = await setParticipantPerformanceMode(code, body.participantId, body.participantId, false);
    } else {
      return NextResponse.json({ ok: false, error: 'Unknown performance action.' }, { status: 400 });
    }

    if (result?.error) return resultError(result);
    return NextResponse.json({ ok: true, room: result.room });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to update the Song Leader.' }, { status: 500 });
  }
}
