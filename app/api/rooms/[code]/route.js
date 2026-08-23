import { NextResponse } from 'next/server';
import { getRoom, normalizeCode, updateRoomState } from '../../../../lib/rooms';
import { getMasterSongbook } from '../../../../lib/songbookStore';

function apiError(error, status = 500) {
  const message = error?.code === 'REALTIME_NOT_CONFIGURED'
    ? 'Realtime rooms need a Redis database connected in Vercel.'
    : error?.message || 'Room request failed.';
  return NextResponse.json({ ok: false, error: message, code: error?.code || 'SERVER_ERROR' }, { status });
}

async function hydrateRoom(room) {
  if (!room) return room;
  const masterSongs = await getMasterSongbook();
  if (!Array.isArray(masterSongs) || !masterSongs.length) return room;

  const byNumber = new Map(masterSongs.map(song => [Number(song.number), song]));
  const playlist = (room.playlist || []).map(song => {
    const master = byNumber.get(Number(song.number));
    return master ? { ...song, ...master } : song;
  });

  return { ...room, playlist };
}

export async function GET(_request, { params }) {
  try {
    const { code: rawCode } = await params;
    const code = normalizeCode(rawCode);
    if (!code) return NextResponse.json({ ok: false, error: 'Invalid room code.' }, { status: 400 });
    const room = await getRoom(code);
    if (!room) return NextResponse.json({ ok: false, error: 'Room not found or expired.' }, { status: 404 });
    return NextResponse.json({ ok: true, room: await hydrateRoom(room) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request, { params }) {
  try {
    const { code: rawCode } = await params;
    const code = normalizeCode(rawCode);
    if (!code) return NextResponse.json({ ok: false, error: 'Invalid room code.' }, { status: 400 });
    const body = await request.json();
    const result = await updateRoomState(code, body.participantId, body.updates || {});
    if (result.error === 'ROOM_NOT_FOUND') return NextResponse.json({ ok: false, error: 'Room not found or expired.' }, { status: 404 });
    if (result.error === 'NOT_LEADER') return NextResponse.json({ ok: false, error: 'Only the room leader can change the shared song view.' }, { status: 403 });
    return NextResponse.json({ ok: true, room: await hydrateRoom(result.room) });
  } catch (error) {
    return apiError(error);
  }
}
