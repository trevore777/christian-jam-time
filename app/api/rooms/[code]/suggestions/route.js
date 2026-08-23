import { NextResponse } from 'next/server';
import { addSongSuggestion, normalizeCode, resolveSongSuggestion } from '../../../../../lib/rooms';

function fail(message, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request, { params }) {
  try {
    const { code: rawCode } = await params;
    const code = normalizeCode(rawCode);
    if (!code) return fail('Invalid room code.');
    const body = await request.json();
    const result = await addSongSuggestion(code, body.participantId, body.song);
    if (result.error === 'ROOM_NOT_FOUND') return fail('Room not found or expired.', 404);
    if (result.error === 'NOT_PARTICIPANT') return fail('You are no longer connected to this Jam Room.', 403);
    if (result.error === 'INVALID_SONG') return fail('Choose a valid song to suggest.');
    if (result.error === 'ALREADY_EXISTS') return fail('That song is already in the playlist or suggestion queue.', 409);
    if (result.error) return fail('Unable to suggest that song.');
    return NextResponse.json({ ok: true, room: result.room });
  } catch (error) {
    return fail(error?.message || 'Unable to suggest that song.', 500);
  }
}

export async function PATCH(request, { params }) {
  try {
    const { code: rawCode } = await params;
    const code = normalizeCode(rawCode);
    if (!code) return fail('Invalid room code.');
    const body = await request.json();
    const result = await resolveSongSuggestion(code, body.participantId, body.suggestionId, body.action);
    if (result.error === 'ROOM_NOT_FOUND') return fail('Room not found or expired.', 404);
    if (result.error === 'NOT_LEADER') return fail('Only the room leader can approve or dismiss suggestions.', 403);
    if (result.error === 'SUGGESTION_NOT_FOUND') return fail('That suggestion is no longer available.', 404);
    if (result.error === 'INVALID_ACTION') return fail('Invalid suggestion action.');
    if (result.error) return fail('Unable to update that suggestion.');
    return NextResponse.json({ ok: true, room: result.room });
  } catch (error) {
    return fail(error?.message || 'Unable to update that suggestion.', 500);
  }
}
