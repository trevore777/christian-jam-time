'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import LiveVideoPanel from '../components/LiveVideoPanel';
import ChordSheetEditor from '../components/ChordSheetEditor';
import SongbookImporter from '../components/SongbookImporter';
import SongSuggestions from '../components/SongSuggestions';

const NOTES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const INSTRUMENTS = ['Guitar', 'Bass', 'Piano', 'Drums', 'Vocals', 'Other'];

function transpose(note, shift) {
  const i = NOTES.indexOf(note);
  return i < 0 ? note || '—' : NOTES[(i + shift + 120) % 12];
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}

export default function HomePage() {
  const [screen, setScreen] = useState('home');
  const [name, setName] = useState('Trevor');
  const [instrument, setInstrument] = useState('Guitar');
  const [joinCode, setJoinCode] = useState('');
  const [room, setRoom] = useState(null);
  const [participantId, setParticipantId] = useState('');
  const [songs, setSongs] = useState([]);
  const [songbookReady, setSongbookReady] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState('Connected');
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  async function loadSongs() {
    try {
      const payload = await api('/api/songs');
      if (mounted.current) {
        setSongs(payload.songs || []);
        setSongbookReady(Boolean(payload.ready));
      }
    } catch (err) {
      if (mounted.current) setError(err.message);
    }
  }

  useEffect(() => { loadSongs(); }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return songs;
    return songs.filter(song => {
      const text = [song.title, song.firstLine, ...(song.alternateTitles || []), ...(song.scriptureRefs || [])].join(' ').toLowerCase();
      return text.includes(q) || String(song.number).includes(q);
    });
  }, [query, songs]);

  const playlist = room?.playlist || [];
  const suggestions = room?.suggestions || [];
  const currentIndex = room?.currentIndex ?? -1;
  const shift = room?.shift ?? 0;
  const currentSong = currentIndex >= 0 ? playlist[currentIndex] : null;
  const displayedKey = currentSong ? transpose(currentSong.key, shift) : '—';
  const leader = Boolean(room && participantId && room.leaderId === participantId);
  const participants = room?.participants || [];

  useEffect(() => {
    if (screen !== 'room' || !room?.code || !participantId) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const payload = await api(`/api/rooms/${room.code}`);
        if (!stopped && mounted.current) { setRoom(payload.room); setSyncStatus('Connected'); }
      } catch (err) {
        if (!stopped && mounted.current) setSyncStatus(err.message || 'Reconnecting…');
      }
    };
    refresh();
    const poll = setInterval(refresh, 1500);
    return () => { stopped = true; clearInterval(poll); };
  }, [screen, room?.code, participantId]);

  useEffect(() => {
    if (screen !== 'room' || !room?.code || !participantId) return;
    const beat = () => fetch(`/api/rooms/${room.code}/heartbeat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participantId, name, instrument }),
    }).catch(() => {});
    beat(); const timer = setInterval(beat, 10_000); return () => clearInterval(timer);
  }, [screen, room?.code, participantId, name, instrument]);

  async function createJam() {
    setBusy(true); setError('');
    try {
      const payload = await api('/api/rooms/create', { method: 'POST', body: JSON.stringify({ name, instrument }) });
      setParticipantId(payload.participantId); setRoom(payload.room); setScreen('room');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function joinJam(e) {
    e.preventDefault();
    const digits = joinCode.replace(/\D/g, '').slice(0, 4);
    if (digits.length !== 4) {
      setError('Enter the four-digit Jam number.');
      return;
    }
    const code = `CJT-${digits}`;
    setBusy(true); setError('');
    try {
      const payload = await api(`/api/rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: JSON.stringify({ name, instrument }) });
      setParticipantId(payload.participantId); setRoom(payload.room); setScreen('room');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function updateShared(updates) {
    if (!leader || !room?.code) return;
    setSyncStatus('Saving…');
    try {
      const payload = await api(`/api/rooms/${room.code}`, { method: 'PATCH', body: JSON.stringify({ participantId, updates }) });
      setRoom(payload.room); setSyncStatus('Synced');
    } catch (err) { setSyncStatus(err.message); }
  }

  async function suggestSong(song) {
    if (!room?.code || !participantId) return;
    setSyncStatus('Sending suggestion…');
    try {
      const payload = await api(`/api/rooms/${room.code}/suggestions`, {
        method: 'POST',
        body: JSON.stringify({ participantId, song }),
      });
      setRoom(payload.room);
      setSyncStatus('Suggested');
    } catch (err) {
      setSyncStatus(err.message);
    }
  }

  async function resolveSuggestion(suggestionId, action) {
    if (!leader || !room?.code) return;
    setSyncStatus(action === 'approve' ? 'Adding suggestion…' : 'Dismissing suggestion…');
    try {
      const payload = await api(`/api/rooms/${room.code}/suggestions`, {
        method: 'PATCH',
        body: JSON.stringify({ participantId, suggestionId, action }),
      });
      setRoom(payload.room);
      setSyncStatus(action === 'approve' ? 'Added to playlist' : 'Suggestion dismissed');
    } catch (err) {
      setSyncStatus(err.message);
    }
  }

  function addSong(song) {
    if (!leader) return suggestSong(song);
    const existing = playlist.findIndex(item => item.number === song.number);
    if (existing >= 0) return updateShared({ playlist, currentIndex: existing, shift: 0 });
    const next = [...playlist, song];
    updateShared({ playlist: next, currentIndex: next.length - 1, shift: 0 });
  }

  function removeSong(index) {
    if (!leader) return;
    const next = playlist.filter((_, i) => i !== index);
    let nextIndex = currentIndex;
    if (!next.length) nextIndex = -1;
    else if (currentIndex >= next.length) nextIndex = next.length - 1;
    else if (index < currentIndex) nextIndex = currentIndex - 1;
    updateShared({ playlist: next, currentIndex: nextIndex, shift });
  }

  async function saveCurrentSong(changes) {
    if (!leader || !currentSong) throw new Error('Only the Jam leader can edit the master songbook.');
    const payload = await api(`/api/songs/${currentSong.number}`, {
      method: 'PUT', body: JSON.stringify({ roomCode: room.code, participantId, changes }),
    });
    const saved = payload.song;
    setSongs(previous => previous.map(song => song.number === saved.number ? saved : song));
    const nextPlaylist = playlist.map(song => song.number === saved.number ? { ...song, ...saved } : song);
    await updateShared({ playlist: nextPlaylist, currentIndex, shift: 0 });
  }

  function leaveRoom() {
    setScreen('home'); setRoom(null); setParticipantId(''); setJoinCode(''); setSyncStatus('Connected');
  }

  if (screen === 'home') {
    return <main className="landing"><section className="hero">
      <div className="brandMark">♪</div><p className="eyebrow">ONLINE WORSHIP & FELLOWSHIP</p><h1>Christian Jam Time</h1>
      <p className="lead">Meet together online, choose songs from the shared songbook, build a playlist and worship from the same chord sheet.</p>
      <div className="profileFields"><label>Your name<input value={name} onChange={e => setName(e.target.value)} maxLength={40} /></label><label>Instrument<select value={instrument} onChange={e => setInstrument(e.target.value)}>{INSTRUMENTS.map(item => <option key={item}>{item}</option>)}</select></label></div>
      <div className="homeActions"><button className="primary large" onClick={createJam} disabled={busy || !songbookReady}>{busy ? 'Connecting…' : 'Start a Jam'}</button><span>or</span><form className="joinForm" onSubmit={joinJam}><span style={{display:'flex',alignItems:'center',fontWeight:900,padding:'0 2px'}}>CJT-</span><input aria-label="Four digit Jam number" placeholder="4271" value={joinCode} onChange={e => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" pattern="[0-9]*" autoComplete="off" autoCorrect="off" spellCheck="false" maxLength={4} /><button className="secondary" type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Join Jam'}</button></form></div>
      {error && <div className="homeError" role="alert">{error}</div>}
      <div className="featureStrip"><div><b>Shared Songbook</b><span>{songbookReady ? `${songs.length} songs loaded from the master list.` : 'Master songbook needs its one-time import.'}</span></div><div><b>Song Suggestions</b><span>Participants can suggest songs for the leader to approve.</span></div><div><b>Editable Chords</b><span>Leader corrections can be saved back to the master songbook.</span></div></div>
      {!songbookReady && <SongbookImporter onImported={loadSongs} />}
    </section></main>;
  }

  return <main className="appShell">
    <header className="topbar"><button className="brandButton" onClick={leaveRoom}><span>♪</span><b>Christian Jam Time</b></button><div className="roomBadge">Room <b>{room?.code}</b></div><div className="userBadge">{name || 'Guest'} · {instrument}{leader ? ' · Leader' : ''}</div></header>
    <div className={`connectionBanner ${syncStatus === 'Connected' || syncStatus === 'Synced' || syncStatus === 'Suggested' || syncStatus === 'Added to playlist' ? 'online' : ''}`}><span>●</span> {syncStatus} · {participants.length} online {!leader && <b> · Following leader</b>}</div>
    <div className="workspace">
      <aside className="sidebar">
        <section className="card"><div className="sectionHeading"><div><small>PEOPLE</small><h2>Jam Room</h2></div><span className="liveDot">● LIVE</span></div><div className="peopleGrid">{participants.map(person => <div className={`personCard ${person.isLeader ? 'leaderCard' : ''}`} key={person.id}><div className="avatar">{(person.name || '?')[0].toUpperCase()}</div><div><b>{person.name}</b><span>{person.instrument}{person.isLeader ? ' · Leader' : ''}</span></div></div>)}</div><p className="hint">Share <b>{room?.code}</b> with friends. Everyone sees the leader&apos;s song, key and saved chord-sheet changes.</p></section>
        <section className="card songbookCard"><div className="sectionHeading"><div><small>MASTER SONGBOOK</small><h2>{leader ? 'Choose a song' : 'Suggest a song'}</h2></div><span>{songs.length} loaded</span></div><input className="searchInput" type="search" placeholder="Search title, first line, scripture or number" value={query} onChange={e => setQuery(e.target.value)} />{!leader && <p className="hint followerHint">Choose any song and press <b>Suggest</b>. The leader can then add it to tonight&apos;s playlist.</p>}<div className="songList">{filtered.map(song => <div className="songItem" key={song.number}><button className="songInfo" onClick={() => addSong(song)}><b>{song.number}. {song.title}</b><span>Key {song.key || '—'} · Page {(song.pages || []).join(', ') || '—'} {song.lyricsChordPro ? '· Chords ✓' : ''}</span></button><button className="addButton" onClick={() => addSong(song)} aria-label={`${leader ? 'Add' : 'Suggest'} ${song.title}`}>{leader ? '+' : 'Suggest'}</button></div>)}</div></section>
        <SongSuggestions suggestions={suggestions} leader={leader} onResolve={resolveSuggestion} />
      </aside>
      <section className="mainColumn">
        <LiveVideoPanel participants={participants} participantId={participantId} roomCode={room?.code || ''} />
        <section className="card songStage">
          <div className="stageHeader"><div><small>NOW PLAYING</small><h2>{currentSong ? currentSong.title : 'Choose a song from the songbook'}</h2><p>{currentSong ? `Song ${currentSong.number} · Songbook page ${(currentSong.pages || []).join(', ') || '—'} · Original key ${currentSong.key || '—'}` : leader ? 'Build tonight’s playlist from the master song list.' : 'Waiting for the leader to choose the first song.'}</p></div><div className="keyControl"><span>Shared key</span><div><button onClick={() => currentSong && updateShared({ playlist, currentIndex, shift: shift - 1 })} disabled={!currentSong || !leader}>−</button><strong>{displayedKey}</strong><button onClick={() => currentSong && updateShared({ playlist, currentIndex, shift: shift + 1 })} disabled={!currentSong || !leader}>+</button></div></div></div>
          <div className="chordSheet"><ChordSheetEditor song={currentSong} shift={shift} canEdit={leader} onSave={saveCurrentSong} /></div>
          <div className="playlistHeader"><div><small>TONIGHT&apos;S PLAYLIST</small><h3>{playlist.length ? `${playlist.length} song${playlist.length === 1 ? '' : 's'}` : 'No songs yet'}</h3></div></div><div className="playlist">{playlist.map((song, index) => <div className={`playlistItem ${index === currentIndex ? 'active' : ''}`} key={`${song.number}-${index}`}><button className="playlistSelect" disabled={!leader} onClick={() => updateShared({ playlist, currentIndex: index, shift: 0 })}><span>{index + 1}</span><div><b>{song.title}</b><small>Key {song.key || '—'} {song.lyricsChordPro ? '· Chords ✓' : ''}</small></div></button><button className="removeButton" disabled={!leader} onClick={() => removeSong(index)} aria-label={`Remove ${song.title}`}>×</button></div>)}</div>
          <div className="transport"><button className="secondary" disabled={!leader || currentIndex <= 0} onClick={() => updateShared({ playlist, currentIndex: currentIndex - 1, shift: 0 })}>← Previous</button><div className="statusText">{leader ? 'You control the shared song and review participant suggestions.' : 'Suggest songs from the songbook; the leader controls the shared playlist.'}</div><button className="primary" disabled={!leader || currentIndex < 0 || currentIndex >= playlist.length - 1} onClick={() => updateShared({ playlist, currentIndex: currentIndex + 1, shift: 0 })}>Next Song →</button></div>
        </section>
      </section>
    </div>
  </main>;
}
