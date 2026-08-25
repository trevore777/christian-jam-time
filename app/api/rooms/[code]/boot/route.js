import { NextResponse } from 'next/server';
import { bootParticipant, normalizeCode } from '../../../../../lib/rooms';

export async function POST(request, { params }) {
  try {
    const { code: rawCode } = await params;
    const code = normalizeCode(rawCode);
    if (!code) return NextResponse.json({ ok: false, error: 'Invalid Jam code.' }, { status: 400 });
    const body = await request.json();
    const result = await bootParticipant(code, body.participantId, body.targetParticipantId);
    if (result?.error === 'ROOM_NOT_FOUND') return NextResponse.json({ ok: false, error: 'Room not found or expired.' }, { status: 404 });
    if (result?.error === 'NOT_LEADER') return NextResponse.json({ ok: false, error: 'Only the Jam leader can remove participants.' }, { status: 403 });
    if (result?.error === 'INVALID_TARGET') return NextResponse.json({ ok: false, error: 'The leader cannot remove themselves.' }, { status: 400 });
    if (result?.error === 'NOT_PARTICIPANT') return NextResponse.json({ ok: false, error: 'That participant is no longer in the Jam.' }, { status: 404 });
    return NextResponse.json({ ok: true, room: result.room });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to remove participant.' }, { status: 500 });
  }
}
