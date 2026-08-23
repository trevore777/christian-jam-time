import { NextResponse } from 'next/server';
import { getState, normalizeCode } from '../../../../lib/rooms';
import { updateMasterSong } from '../../../../lib/songbookStore';

export async function PUT(request, { params }) {
  try {
    const { number } = await params;
    const body = await request.json();
    const code = normalizeCode(body.roomCode);
    const participantId = String(body.participantId || '');
    if (!code || !participantId) {
      return NextResponse.json({ ok: false, error: 'A live Jam Room is required to edit the master songbook.' }, { status: 400 });
    }
    const room = await getState(code);
    if (!room) return NextResponse.json({ ok: false, error: 'Jam Room not found or expired.' }, { status: 404 });
    if (room.leaderId !== participantId) {
      return NextResponse.json({ ok: false, error: 'Only the Jam leader can save changes to the master songbook.' }, { status: 403 });
    }
    const song = await updateMasterSong(Number(number), body.changes || {});
    if (!song) return NextResponse.json({ ok: false, error: 'Song not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, song });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to save song.' }, { status: 500 });
  }
}
