'use client';

import { useEffect, useMemo, useState } from 'react';

const NOTES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const ALIASES = { 'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb' };

function transposeRoot(root, shift) {
  const normal = ALIASES[root] || root;
  const index = NOTES.indexOf(normal);
  return index < 0 ? root : NOTES[(index + shift + 120) % 12];
}

function transposeChord(chord, shift) {
  if (!shift || !chord) return chord;
  const parts = chord.split('/');
  const move = value => value.replace(/^([A-G](?:#|b)?)(.*)$/, (_, root, suffix) => `${transposeRoot(root, shift)}${suffix}`);
  return parts.map(move).join('/');
}

function stripDirectives(text) {
  return String(text || '').split('\n').filter(line => !/^\s*\{[^}]+\}\s*$/.test(line));
}

function SongLine({ line, shift }) {
  if (!line.trim()) return <div className="cpBlank">&nbsp;</div>;
  if (/^\s*\[[^\]]+\]\s*$/.test(line)) return <div className="cpSection">{line.replace(/[\[\]]/g, '')}</div>;
  const parts = line.split(/(\[[^\]]+\])/g).filter(Boolean);
  return <div className="cpLine">{parts.map((part, index) => {
    const match = part.match(/^\[([^\]]+)\]$/);
    if (match) return <span className="cpChord" key={index}>{transposeChord(match[1], shift)}</span>;
    return <span key={index}>{part}</span>;
  })}</div>;
}

export default function ChordSheetEditor({ song, shift = 0, canEdit = false, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(song?.lyricsChordPro || '');
  const [draftKey, setDraftKey] = useState(song?.key || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setDraft(song?.lyricsChordPro || '');
    setDraftKey(song?.key || '');
    setEditing(false);
    setMessage('');
  }, [song?.number, song?.lyricsChordPro, song?.key]);

  const lines = useMemo(() => stripDirectives(song?.lyricsChordPro), [song?.lyricsChordPro]);

  if (!song) return <div className="emptyStage"><span>♫</span><p>Choose a song to begin.</p></div>;

  async function save() {
    setSaving(true); setMessage('');
    try {
      await onSave({ key: draftKey, lyricsChordPro: draft });
      setEditing(false);
      setMessage('Saved to the master songbook.');
    } catch (error) {
      setMessage(error.message || 'Unable to save changes.');
    } finally { setSaving(false); }
  }

  if (editing) {
    return <div className="chordEditor">
      <div className="editorToolbar">
        <label>Original key<select value={draftKey} onChange={e => setDraftKey(e.target.value)}><option value="">—</option>{NOTES.map(note => <option key={note}>{note}</option>)}</select></label>
        <div className="editorHelp"><b>Move a chord:</b> cut the bracketed chord such as <code>[G]</code> and paste it immediately before the word where it should change.</div>
      </div>
      <textarea value={draft} onChange={e => setDraft(e.target.value)} spellCheck="false" aria-label="ChordPro song editor" />
      <div className="editorActions"><button className="secondary" type="button" onClick={() => { setDraft(song.lyricsChordPro || ''); setDraftKey(song.key || ''); setEditing(false); }}>Cancel</button><button className="primary" type="button" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save to Master Songbook'}</button></div>
      {message && <p className="editMessage">{message}</p>}
    </div>;
  }

  return <div>
    <div className="sheetActions">
      <span>{song.lyricsChordPro ? 'ChordPro song sheet' : 'No chord sheet has been entered for this song yet.'}</span>
      {canEdit && <button className="secondary compact" type="button" onClick={() => setEditing(true)}>{song.lyricsChordPro ? 'Edit Song / Chords' : 'Add Lyrics & Chords'}</button>}
    </div>
    <div className="renderedChordSheet">
      {lines.length ? lines.map((line, index) => <SongLine key={index} line={line} shift={shift} />) : <div className="emptyStage"><span>♫</span><p>{canEdit ? 'Select “Add Lyrics & Chords” to build this song.' : 'Chord sheet not yet available.'}</p></div>}
    </div>
    {message && <p className="editMessage">{message}</p>}
  </div>;
}
