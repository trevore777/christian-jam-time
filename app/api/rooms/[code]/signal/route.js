import { NextResponse } from 'next/server';
import { normalizeCode } from '../../../../../lib/rooms';
import { drainSignals, sendSignal } from '../../../../../lib/signals';

function fail(message, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request, { params }) {
  const { code: rawCode } = await params;
  const code = normalizeCode(rawCode);
  if (!code) return fail('Invalid room code.');
  const participantId = new URL(request.url).searchParams.get('participantId');
  const result = await drainSignals(code, participantId);
  if (result.error === 'ROOM_NOT_FOUND') return fail('Room not found or expired.', 404);
  if (result.error) return fail('Unable to read signaling messages.');
  return NextResponse.json({ ok: true, signals: result.signals });
}

export async function POST(request, { params }) {
  const { code: rawCode } = await params;
  const code = normalizeCode(rawCode);
  if (!code) return fail('Invalid room code.');
  const body = await request.json();
  const result = await sendSignal(code, body.from, body.to, body.signal);
  if (result.error === 'ROOM_NOT_FOUND') return fail('Room not found or expired.', 404);
  if (result.error) return fail('Unable to send signaling message.');
  return NextResponse.json({ ok: true });
}
