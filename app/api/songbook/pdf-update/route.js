import { NextResponse } from 'next/server';
import { applyPdfSongUpdate } from '../../../../lib/songbookStore';

export async function POST(request) {
  try {
    const body = await request.json();
    const entries = Array.isArray(body?.entries) ? body.entries : [];
    if (!entries.length) {
      return NextResponse.json({ ok: false, error: 'No converted songs were supplied.' }, { status: 400 });
    }
    if (entries.length > 400) {
      return NextResponse.json({ ok: false, error: 'Too many song records in one update.' }, { status: 400 });
    }

    const result = await applyPdfSongUpdate(entries);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to update the songbook.' }, { status: 500 });
  }
}
