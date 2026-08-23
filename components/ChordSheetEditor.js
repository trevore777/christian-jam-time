'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './ChordSheetEditor.module.css';

const NOTES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const ALIASES = { 'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb' };

function transposeRoot(root, shift) {
  const normal = ALIASES[root] || root;
  const index = NOTES.indexOf(normal);
  return index < 0 ? root : NOTES[(index + shift + 120) % 12];
}

function transposeChord(chord, shift) {
  if (!shift || !chord) return chord;
  return chord.split('/').map(value => value.replace(/^([A-G](?:#|b)?)(.*)$/, (_, root, suffix) => `${transposeRoot(root, shift)}${suffix}`)).join('/');
}

function stripDirectives(text) {
  return String(text || '').split('\n').filter(line => !/^\s*\{[^}]+\}\s*$/.test(line));
}

function SongLine({ line, shift }) {
  if (!line.trim()) return <div className={styles.blank}>&nbsp;</div>;
  if (/^\s*\[[^\]]+\]\s*$/.test(line)) return <div className={styles.section}>{line.replace(/[\[\]]/g, '')}</div>;
  const parts = line.split(/(\[[^\]]+\])/g).filter(Boolean);
  return <div className={styles.line}>{parts.map((part, index) => {
    const match = part.match(/^\[([^\]]+)\]$/);
    if (match) return <span className={styles.chord} key={index}>{transposeChord(match[1], shift)}</span>;
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

  if (!song) return <div className={styles.empty}><span>♫</span><p>Choose a song to begin.</p></div>;

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

  if (editing) return <div className={styles.editor}>
    <div className={styles.toolbar}>
      <label>Original key<select value={draftKey} onChange={e => setDraftKey(e.target.value)}><option value="">—</option>{NOTES.map(note => <option key={note}>{note}</option>)}</select></label>
      <div className={styles.help}><b>Editing uses ChordPro.</b> A chord such as <code>[G]</code> sits immediately before the word or syllable where the chord changes. To move a chord, cut the bracketed chord and paste it at the new position. You can also add or remove chords and correct lyrics here.</div>
    </div>
    <textarea value={draft} onChange={e => setDraft(e.target.value)} spellCheck="false" aria-label="ChordPro song editor" />
    <div className={styles.editorActions}><button className="secondary" type="button" onClick={() => { setDraft(song.lyricsChordPro || ''); setDraftKey(song.key || ''); setEditing(false); }}>Cancel</button><button className="primary" type="button" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save to Master Songbook'}</button></div>
    {message && <p className={styles.message}>{message}</p>}
  </div>;

  return <div>
    <div className={styles.actions}><span>{song.lyricsChordPro ? 'ChordPro song sheet · shared with everyone in the Jam' : 'No chord sheet has been entered for this song yet.'}</span>{canEdit && <button className="secondary compact" type="button" onClick={() => setEditing(true)}>{song.lyricsChordPro ? 'Edit Song / Chords' : 'Add Lyrics & Chords'}</button>}</div>
    <div className={styles.sheet}>{lines.length ? lines.map((line, index) => <SongLine key={index} line={line} shift={shift} />) : <div className={styles.empty}><span>♫</span><p>{canEdit ? 'Select “Add Lyrics & Chords” to build this song.' : 'Chord sheet not yet available.'}</p></div>}</div>
    {message && <p className={styles.message}>{message}</p>}
  </div>;
}
