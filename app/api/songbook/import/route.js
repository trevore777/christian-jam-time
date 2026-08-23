import { NextResponse } from 'next/server';
import { mergeSongbook, saveMasterSongbook } from '../../../../lib/songbookStore';

export async function POST(request) {
  try {
    const body = await request.json();
    const catalog = Array.isArray(body.catalog) ? body.catalog : null;
    const detailed = Array.isArray(body.detailed?.songs) ? body.detailed.songs : (Array.isArray(body.detailed) ? body.detailed : null);
    if (!catalog || !detailed) {
      return NextResponse.json({ ok: false, error: 'Expected catalog array and detailed song export.' }, { status: 400 });
    }
    if (catalog.length < 300 || detailed.length < 50) {
      return NextResponse.json({ ok: false, error: 'Songbook files appear incomplete.' }, { status: 400 });
    }
    const songs = mergeSongbook(catalog, detailed);
    await saveMasterSongbook(songs);
    return NextResponse.json({ ok: true, count: songs.length, withChordSheets: songs.filter(song => song.lyricsChordPro).length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to import songbook.' }, { status: 500 });
  }
}
