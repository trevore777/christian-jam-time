'use client';
import { useEffect, useRef, useState } from 'react';

const FAVORITES_KEY = 'cjt:favorites:v1';
const DB_NAME = 'cjt-practice-v1';
const STORE = 'recordings';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readRecords(songNumber) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).filter(r => r.songNumber === songNumber).sort((a,b) => b.createdAt.localeCompare(a.createdAt)));
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}
async function writeRecord(record, remove = false) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      if (remove) tx.objectStore(STORE).delete(record.id);
      else tx.objectStore(STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
function formatDate(iso) { return new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }); }
export default function PracticeLibrary({ songs, selectedSong, onAddSong, canAddSong }) {
  const [favourites, setFavourites] = useState([]);
  const [showOnly, setShowOnly] = useState(false);
  const [records, setRecords] = useState([]);
  const [recording, setRecording] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState('');
  const [newSong, setNewSong] = useState(false);
  const [title, setTitle] = useState('');
  const [songKey, setSongKey] = useState('G');
  const [lyrics, setLyrics] = useState('');
  const [saving, setSaving] = useState(false);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const urlsRef = useRef([]);
  const [playable, setPlayable] = useState([]);
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); if (Array.isArray(saved)) setFavourites(saved.filter(Number.isFinite)); } catch {} }, []);
  useEffect(() => { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favourites)); }, [favourites]);
  useEffect(() => {
    let disposed = false;
    for (const u of urlsRef.current) URL.revokeObjectURL(u);
    urlsRef.current = [];
    if (!selectedSong) { setRecords([]); setPlayable([]); return; }
    readRecords(selectedSong.number).then(items => {
      if (disposed) return;
      setRecords(items);
      const withUrls = items.map(item => ({ ...item, url: URL.createObjectURL(item.blob) }));
      urlsRef.current = withUrls.map(item => item.url);
      setPlayable(withUrls);
    }).catch(err => setMessage(err.message));
    return () => { disposed = true; };
  }, [selectedSong?.number, refresh]);
  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
    urlsRef.current.forEach(u => URL.revokeObjectURL(u));
  }, []);
  const toggle = number => setFavourites(list => list.includes(number) ? list.filter(n => n !== number) : [...list, number]);
  async function beginRecording() {
    if (!selectedSong) return;
    try {
      setMessage('');
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Audio recording is unavailable in this browser. Use HTTPS and an up-to-date browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false }, video: false });
      streamRef.current = stream;
      const preferred = ['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, { ...(preferred ? { mimeType: preferred } : {}), audioBitsPerSecond: 64000 });
      recorderRef.current = recorder;
      chunksRef.current = [];
      const number = selectedSong.number;
      recorder.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size) {
          try {
            const label = window.prompt('Name this practice recording:', 'Group practice') || 'Group practice';
            await writeRecord({ id: crypto.randomUUID(), songNumber: number, label: label.slice(0, 80), createdAt: new Date().toISOString(), blob });
            setMessage('Recording saved on this device.');
          } catch (error) { setMessage('Could not save recording: ' + error.message); }
        }
        setRecording(false);
        setRefresh(v => v + 1);
      };
      recorder.start(1000);
      setRecording(true);
    } catch (error) { streamRef.current?.getTracks().forEach(t => t.stop()); setMessage(error.message); }
  }
  function stopRecording() { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); }
  async function removeRecord(item) {
    if (!window.confirm('Delete this recording from this device?')) return;
    await writeRecord(item, true);
    setRefresh(v => v + 1);
  }
  async function saveSong(event) {
    event.preventDefault();
    setSaving(true); setMessage('');
    try {
      await onAddSong({ title, key: songKey, lyricsChordPro: lyrics });
      setTitle(''); setSongKey('G'); setLyrics(''); setNewSong(false); setMessage('New song added to master songbook.');
    } catch (error) { setMessage(error.message); } finally { setSaving(false); }
  }
  return <section className="card" style={{marginTop:12}}>
    <div className="sectionHeading"><div><small>PERSONAL LIBRARY</small><h2>Favourites & Practice</h2></div></div>
    <p className="hint">Favourites and audio recordings are stored on this device. Download recordings to keep a backup or share them.</p>
    <label style={{display:'flex',gap:8,alignItems:'center',marginBottom:10}}><input type="checkbox" checked={showOnly} onChange={e => setShowOnly(e.target.checked)}/> Show favourites only ({favourites.length})</label>
    <div style={{maxHeight:180,overflow:'auto'}}>
      {songs.filter(s => !showOnly || favourites.includes(s.number)).map(song => <div key={song.number} style={{display:'flex',alignItems:'center',gap:8,padding:'3px 0'}}>
        <button type="button" aria-label={favourites.includes(song.number) ? 'Remove favourite' : 'Add favourite'} onClick={() => toggle(song.number)} style={{minWidth:40}}>{favourites.includes(song.number) ? '★' : '☆'}</button>
        <span style={{fontSize:12}}>{song.number}. {song.title}</span>
      </div>)}
    </div>
    {selectedSong && <div style={{borderTop:'1px solid #ddd',marginTop:12,paddingTop:12}}>
      <b>Record: {selectedSong.title}</b><p className="hint">Audio only · compressed where supported · microphone permission required.</p>
      <button type="button" className={recording ? 'secondary' : 'primary'} onClick={recording ? stopRecording : beginRecording}>{recording ? '■ Stop & Save' : '● Record Practice'}</button>
      {playable.map(item => <div key={item.id} style={{padding:'9px 0',borderBottom:'1px solid #ddd'}}>
        <div><b>{item.label}</b> · <small>{formatDate(item.createdAt)} · {(item.blob.size / 1048576).toFixed(2)} MB</small></div>
        <audio controls preload="none" src={item.url} style={{width:'100%',maxWidth:360}}/>
        <div style={{display:'flex',gap:8}}><a href={item.url} download={`practice-${item.songNumber}-${item.id}.${item.blob.type.includes('mp4') ? 'm4a' : 'webm'}`}>Download</a><button type="button" onClick={() => removeRecord(item)}>Delete</button></div>
      </div>)}
    </div>}
    {canAddSong && <div style={{borderTop:'1px solid #ddd',marginTop:12,paddingTop:12}}>
      <button type="button" className="secondary" onClick={() => setNewSong(v => !v)}>{newSong ? 'Cancel New Song' : '+ Add Song to Master Songbook'}</button>
      {newSong && <form onSubmit={saveSong} style={{display:'grid',gap:8,marginTop:10}}>
        <label>Song title<input required maxLength={180} value={title} onChange={e => setTitle(e.target.value)}/></label>
        <label>Original key<input maxLength={12} value={songKey} onChange={e => setSongKey(e.target.value)}/></label>
        <label>Lyrics and chords<textarea rows={7} maxLength={50000} value={lyrics} onChange={e => setLyrics(e.target.value)}/></label>
        <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save New Song'}</button>
      </form>}
    </div>}
    {message && <p role="status" className="hint">{message}</p>}
  </section>;
}
