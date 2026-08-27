import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getRoom, normalizeCode } from '../../../../../lib/rooms';

const CREDENTIAL_TTL_SECONDS = 60 * 60;

export async function GET(request, { params }) {
  try {
    const { code: rawCode } = await params;
    const code = normalizeCode(rawCode);
    if (!code) return NextResponse.json({ ok: false, error: 'Invalid room code.' }, { status: 400 });

    const participantId = String(new URL(request.url).searchParams.get('participantId') || '').trim();
    if (!participantId) return NextResponse.json({ ok: false, error: 'Participant required.' }, { status: 400 });

    const room = await getRoom(code);
    if (!room) return NextResponse.json({ ok: false, error: 'Room not found or expired.' }, { status: 404 });
    if (!(room.participants || []).some(person => person.id === participantId)) {
      return NextResponse.json({ ok: false, error: 'Participant is not active in this room.' }, { status: 403 });
    }

    const host = String(process.env.TURN_HOST || '').trim();
    const port = Number(process.env.TURN_PORT || 3478);
    const secret = String(process.env.TURN_SECRET || '');
    if (!host || !secret) {
      return NextResponse.json({ ok: false, error: 'TURN is not configured.' }, { status: 503 });
    }

    const expiresAt = Math.floor(Date.now() / 1000) + CREDENTIAL_TTL_SECONDS;
    const username = `${expiresAt}:${participantId}`;
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');

    return NextResponse.json({
      ok: true,
      expiresAt,
      iceServers: [
        { urls: `stun:${host}:${port}` },
        { urls: [`turn:${host}:${port}?transport=udp`, `turn:${host}:${port}?transport=tcp`], username, credential },
      ],
    }, {
      headers: {
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to create TURN credentials.' }, { status: 500 });
  }
}
