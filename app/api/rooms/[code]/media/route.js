import { NextResponse } from 'next/server';
import { normalizeCode, updateMediaStatus } from '../../../../../lib/rooms';

export async function POST(request, { params }) {
  try {
    const { code: rawCode } = await params;
    const code = normalizeCode(rawCode);
    if (!code) return NextResponse.json({ ok: false, error: 'Invalid Jam code.' }, { status: 400 });
    const body = await request.json();
    const result = await updateMediaStatus(code, body.participantId, { micOn: body.micOn, cameraOn: body.cameraOn });
    if (result?.error === 'ROOM_NOT_FOUND') return NextResponse.json({ ok: false, error: 'Room not found or expired.' }, { status: 404 });
    if (result?.error === 'NOT_PARTICIPANT') return NextResponse.json({ ok: false, error: 'Participant is no longer in this Jam.' }, { status: 403 });
    return NextResponse.json({ ok: true, room: result.room });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to update media status.' }, { status: 500 });
  }
}
