import { NextResponse } from 'next/server';
import { claimLeadership, normalizeCode } from '../../../../../lib/rooms';
import { verifyLeaderPin } from '../../../../../lib/leaderPin';

export async function POST(request, { params }) {
  try {
    const { code: rawCode } = await params;
    const code = normalizeCode(rawCode);
    if (!code) return NextResponse.json({ ok: false, error: 'Invalid room code.' }, { status: 400 });

    const body = await request.json();
    if (!verifyLeaderPin(body.leaderPin)) {
      return NextResponse.json({ ok: false, error: 'Incorrect leader PIN.' }, { status: 403 });
    }

    const result = await claimLeadership(code, String(body.participantId || ''));
    if (result.error === 'ROOM_NOT_FOUND') return NextResponse.json({ ok: false, error: 'Room not found or expired.' }, { status: 404 });
    if (result.error === 'NOT_PARTICIPANT') return NextResponse.json({ ok: false, error: 'Join the room before taking leader control.' }, { status: 403 });
    return NextResponse.json({ ok: true, room: result.room });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to take leader control.' }, { status: 500 });
  }
}
