import { NextResponse } from 'next/server';
import { getState, normalizeCode } from '../../../lib/rooms';
import { getMasterSongbook, saveMasterSongbook } from '../../../lib/songbookStore';

export async function POST(request) {
  try {
    const body = await request.json();
    const code = normalizeCode(body.roomCode);
    const participantId = String(body.participantId || '');
    if (!code || !participantId) return NextResponse.json({ ok: false, error: 'A Jam leader session is required.' }, { status: 400 });
    const room = await getState(code);
    if (!room || room.leaderId !== participantId) return NextResponse.json({ ok: false, error: 'Only the Jam leader can add songs.' }, { status: 403 });
    const title = String(body.title || '').trim().slice(0, 180);
    if (!title) return NextResponse.json({ ok: false, error: 'A song title is required.' }, { status: 400 });
    const songs = await getMasterSongbook();
    if (!songs) return NextResponse.json({ ok: false, error: 'Master songbook is not available.' }, { status: 503 });
    // Redis-backed ID allocation prevents duplicates from simultaneous leader requests.
    const { redis } = await import('../../../lib/redis');
    const highest = Math.max(0, ...songs.map(song => Number(song.number) || 0));
    const next = await redis(['INCR', 'cjt:songbook:next-number:v1']);
    const number = highest + Number(next);
    const song = {
      id: 'custom-' + number, number, title,
      firstLine: '', key: String(body.key || '').slice(0, 12),
      pages: [], section: 'Added Songs', scriptureRefs: [], alternateTitles: [],
      chorusFirstLine: '', tags: [], categories: [], videoExample: null,
      lyricsChordPro: String(body.lyricsChordPro || '').slice(0, 50000),
      editedAt: new Date().toISOString()
    };
    // Shared songbook must be updated under a lock to avoid lost concurrent writes.
    const lock = 'cjt:songbook:add-lock:v1';
    const token = crypto.randomUUID();
    const acquired = await redis(['SET', lock, token, 'NX', 'EX', 10]);
    if (acquired !== 'OK') return NextResponse.json({ ok: false, error: 'Another song is being saved. Please retry.' }, { status: 409 });
    try {
      const latest = await getMasterSongbook();
      song.number = Math.max(number, 1 + Math.max(0, ...latest.map(item => Number(item.number) || 0)));
      song.id = 'custom-' + song.number;
      latest.push(song);
      await saveMasterSongbook(latest);
    } finally {
      if (await redis(['GET', lock]) === token) await redis(['DEL', lock]);
    }
    return NextResponse.json({ ok: true, song }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to add song.' }, { status: 500 });
  }
}
