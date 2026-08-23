import { redis, realtimeConfigured } from './redis';

const MASTER_KEY = 'cjt:songbook:master:v1';

export function mergeSongbook(catalog = [], detailed = []) {
  const candidates = new Map();

  for (const song of detailed || []) {
    const number = Number(song.songNumber);
    if (!number) continue;
    const chordPro = String(song.lyricsChordPro || '');
    const rebuilt = /\{status:\s*chord_rebuilt/i.test(chordPro);
    const score = (rebuilt ? 100 : 0) + (song.key ? 10 : 0);
    const previous = candidates.get(number);
    if (!previous || score >= previous.score) candidates.set(number, { score, song });
  }

  return (catalog || []).map(base => {
    const detailedSong = candidates.get(Number(base.number))?.song;
    return {
      id: base.id,
      number: Number(base.number),
      title: detailedSong?.title || base.title || `Song ${base.number}`,
      firstLine: base.firstLine || '',
      key: detailedSong?.key || base.key || '',
      pages: Array.isArray(base.pages) ? base.pages : [],
      section: base.section || 'Songs',
      scriptureRefs: detailedSong?.scriptures?.length ? detailedSong.scriptures : (base.scriptureRefs || []),
      alternateTitles: base.alternateTitles || [],
      chorusFirstLine: base.chorusFirstLine || '',
      tags: base.tags || [],
      categories: detailedSong?.categories || [],
      videoExample: detailedSong?.videoExample || null,
      lyricsChordPro: detailedSong?.lyricsChordPro || '',
      editedAt: null,
    };
  }).sort((a, b) => a.number - b.number);
}

export async function saveMasterSongbook(songs) {
  if (!realtimeConfigured()) throw new Error('Song storage is not configured.');
  await redis(['SET', MASTER_KEY, JSON.stringify(songs)]);
  return songs;
}

export async function getMasterSongbook() {
  if (!realtimeConfigured()) return null;
  const raw = await redis(['GET', MASTER_KEY]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function updateMasterSong(number, changes) {
  const songs = await getMasterSongbook();
  if (!songs) return null;
  const index = songs.findIndex(song => Number(song.number) === Number(number));
  if (index < 0) return null;
  const current = songs[index];
  const updated = {
    ...current,
    title: typeof changes.title === 'string' ? changes.title.slice(0, 180) : current.title,
    key: typeof changes.key === 'string' ? changes.key.slice(0, 12) : current.key,
    lyricsChordPro: typeof changes.lyricsChordPro === 'string' ? changes.lyricsChordPro.slice(0, 50000) : current.lyricsChordPro,
    scriptureRefs: Array.isArray(changes.scriptureRefs) ? changes.scriptureRefs.slice(0, 20).map(String) : current.scriptureRefs,
    editedAt: new Date().toISOString(),
  };
  songs[index] = updated;
  await saveMasterSongbook(songs);
  return updated;
}
