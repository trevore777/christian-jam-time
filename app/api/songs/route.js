import { NextResponse } from 'next/server';
import { getMasterSongbook } from '../../../lib/songbookStore';

export async function GET() {
  try {
    const songs = await getMasterSongbook();
    return NextResponse.json({ ok: true, songs: songs || [], ready: Boolean(songs?.length) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to load songbook.' }, { status: 500 });
  }
}
