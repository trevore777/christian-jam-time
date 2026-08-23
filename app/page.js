'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { songs } from '../data/songs';
import LiveVideoPanel from '../components/LiveVideoPanel';

const NOTES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const INSTRUMENTS = ['Guitar', 'Bass', 'Piano', 'Drums', 'Vocals', 'Other'];

function transpose(note, shift) {
  const i = NOTES.indexOf(note);
  return i < 0 ? note || 'C' : NOTES[(i + shift + 120) % 12];
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
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState('Connected');
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return songs;
    return songs.filter(song => song.title.toLowerCase().includes(q) || String(song.number).includes(q));
  }, [query]);

  const playlist = room?.playlist || [];
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
        if (!stopped && mounted.current) {
          setRoom(payload.room);
          setSyncStatus('Connected');
        }
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId, name, instrument }),
    }).catch(() => {});
    beat();
    const timer = setInterval(beat, 10_000);
    return () => clearInterval(timer);
  }, [screen, room?.code, participantId, name, instrument]);

  async function createJam() {
    setBusy(true);
    setError('');
    try {
      const payload = await api('/api/rooms/create', {
        method: 'POST',
        body: JSON.stringify({ name, instrument }),
      });
      setParticipantId(payload.participantId);
      setRoom(payload.room);
      setScreen('room');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function joinJam(e) {
    e.preventDefault();
    const raw = joinCode.trim().toUpperCase();
    if (!raw) return;
    const code = raw.startsWith('CJT-') ? raw : `CJT-${raw}`;
    setBusy(true);
    setError('');
    try {
      const payload = await api(`/api/rooms/${encodeURIComponent(code)}/join`, {
        method: 'POST',
        body: JSON.stringify({ name, instrument }),
      });
      setParticipantId(payload.participantId);
      setRoom(payload.room);
      setScreen('room');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateShared(updates) {
    if (!leader || !room?.code) return;
    setSyncStatus('Saving…');
    try {
      const payload = await api(`/api/rooms/${room.code}`, {
        method: 'PATCH',
        body: JSON.stringify({ participantId, updates }),
      });
      setRoom(payload.room);
      setSyncStatus('Synced');
    } catch (err) {
      setSyncStatus(err.message);
    }
  }

  function addSong(song) {
    if (!leader) return;
    const existing = playlist.findIndex(item => item.number === song.number);
    if (existing >= 0) {
      updateShared({ playlist, currentIndex: existing, shift: 0 });
      return;
    }
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

  function leaveRoom() {
    setScreen('home');
    setRoom(null);
    setParticipantId('');
    setJoinCode('');
    setSyncStatus('Connected');
  }

  if (screen === 'home') {
    return (
      <main className="landing">
        <section className="hero">
          <div className="brandMark">♪</div>
          <p className="eyebrow">ONLINE WORSHIP & FELLOWSHIP</p>
          <h1>Christian Jam Time</h1>
          <p className="lead">Meet together online, choose songs from the shared songbook, build a playlist and worship from the same chord sheet.</p>

          <div className="profileFields">
            <label>Your name<input value={name} onChange={e => setName(e.target.value)} maxLength={40} /></label>
            <label>Instrument<select value={instrument} onChange={e => setInstrument(e.target.value)}>{INSTRUMENTS.map(item => <option key={item}>{item}</option>)}</select></label>
          </div>

          <div className="homeActions">
            <button className="primary large" onClick={createJam} disabled={busy}>{busy ? 'Connecting…' : 'Start a Jam'}</button>
            <span>or</span>
            <form className="joinForm" onSubmit={joinJam}>
              <input aria-label="Jam code" placeholder="CJT-4271" value={joinCode} onChange={e => setJoinCode(e.target.value)} maxLength={8} />
              <button className="secondary" type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Join Jam'}</button>
            </form>
          </div>
          {error && <div className="homeError" role="alert">{error}</div>}

          <div className="featureStrip">
            <div><b>Shared Songbook</b><span>Search older worship and praise songs.</span></div>
            <div><b>Live Playlist</b><span>Everyone follows the same song order.</span></div>
            <div><b>Chord View</b><span>Transpose the shared key while playing.</span></div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="topbar">
        <button className="brandButton" onClick={leaveRoom}><span>♪</span><b>Christian Jam Time</b></button>
        <div className="roomBadge">Room <b>{room?.code}</b></div>
        <div className="userBadge">{name || 'Guest'} · {instrument}{leader ? ' · Leader' : ''}</div>
      </header>

      <div className={`connectionBanner ${syncStatus === 'Connected' || syncStatus === 'Synced' ? 'online' : ''}`}>
        <span>●</span> {syncStatus} · {participants.length} online
        {!leader && <b> · Following leader</b>}
      </div>

      <div className="workspace">
        <aside className="sidebar">
          <section className="card">
            <div className="sectionHeading"><div><small>PEOPLE</small><h2>Jam Room</h2></div><span className="liveDot">● LIVE</span></div>
            <div className="peopleGrid">
              {participants.map(person => (
                <div className={`personCard ${person.isLeader ? 'leaderCard' : ''}`} key={person.id}>
                  <div className="avatar">{(person.name || '?')[0].toUpperCase()}</div>
                  <div><b>{person.name}</b><span>{person.instrument}{person.isLeader ? ' · Leader' : ''}</span></div>
                </div>
              ))}
            </div>
            <p className="hint">Share <b>{room?.code}</b> with friends. Their name appears here after they join. People disappear from the list about 35 seconds after disconnecting.</p>
          </section>

          <section className="card songbookCard">
            <div className="sectionHeading"><div><small>SONGBOOK</small><h2>Choose a song</h2></div><span>{songs.length} loaded</span></div>
            <input className="searchInput" type="search" placeholder="Search title or song number" value={query} onChange={e => setQuery(e.target.value)} />
            {!leader && <p className="hint followerHint">You can browse the songbook. The room leader controls tonight&apos;s shared playlist.</p>}
            <div className="songList">
              {filtered.map(song => (
                <div className="songItem" key={song.number}>
                  <button className="songInfo" onClick={() => addSong(song)} disabled={!leader}>
                    <b>{song.number}. {song.title}</b>
                    <span>Key {song.key || '—'} · Page {song.page}</span>
                  </button>
                  <button className="addButton" onClick={() => addSong(song)} aria-label={`Add ${song.title}`} disabled={!leader}>+</button>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className="mainColumn">
          <LiveVideoPanel participants={participants} participantId={participantId} />

          <section className="card songStage">
            <div className="stageHeader">
              <div>
                <small>NOW PLAYING</small>
                <h2>{currentSong ? currentSong.title : 'Choose a song from the songbook'}</h2>
                <p>{currentSong ? `Song ${currentSong.number} · Songbook page ${currentSong.page} · Original key ${currentSong.key}` : leader ? 'Build tonight’s playlist from the shared song list.' : 'Waiting for the leader to choose the first song.'}</p>
              </div>
              <div className="keyControl">
                <span>Shared key</span>
                <div><button onClick={() => currentSong && updateShared({ playlist, currentIndex, shift: shift - 1 })} disabled={!currentSong || !leader}>−</button><strong>{displayedKey}</strong><button onClick={() => currentSong && updateShared({ playlist, currentIndex, shift: shift + 1 })} disabled={!currentSong || !leader}>+</button></div>
              </div>
            </div>

            <div className="chordSheet">
              {currentSong ? <>
                <div className="chords">{[0,5,7,5].map((n,i) => <span key={i}>{transpose(currentSong.key, shift + n)}</span>)}</div>
                <p className="lyricsPlaceholder">Chord and lyric content for <b>{currentSong.title}</b> will be pulled from the original chord songbook. The selected song and key on this screen are now shared between devices.</p>
                <div className="chords second">{[0,9,5,7].map((n,i) => <span key={i}>{transpose(currentSong.key, shift + n)}</span>)}</div>
                <p className="lyricsPlaceholder muted">When the leader changes the song or key, every connected screen follows automatically.</p>
              </> : <div className="emptyStage"><span>♫</span><p>{leader ? 'Add a song to begin the Jam.' : 'Waiting for the leader.'}</p></div>}
            </div>

            <div className="playlistHeader"><div><small>TONIGHT&apos;S PLAYLIST</small><h3>{playlist.length ? `${playlist.length} song${playlist.length === 1 ? '' : 's'}` : 'No songs yet'}</h3></div></div>
            <div className="playlist">
              {playlist.map((song, index) => (
                <div className={`playlistItem ${index === currentIndex ? 'active' : ''}`} key={`${song.number}-${index}`}>
                  <button className="playlistSelect" disabled={!leader} onClick={() => updateShared({ playlist, currentIndex: index, shift: 0 })}><span>{index + 1}</span><div><b>{song.title}</b><small>Key {song.key}</small></div></button>
                  <button className="removeButton" disabled={!leader} onClick={() => removeSong(index)} aria-label={`Remove ${song.title}`}>×</button>
                </div>
              ))}
            </div>

            <div className="transport">
              <button className="secondary" disabled={!leader || currentIndex <= 0} onClick={() => updateShared({ playlist, currentIndex: currentIndex - 1, shift: 0 })}>← Previous</button>
              <div className="statusText">{leader ? 'You control the shared song view.' : 'The room leader controls the shared song view.'}</div>
              <button className="primary" disabled={!leader || currentIndex < 0 || currentIndex >= playlist.length - 1} onClick={() => updateShared({ playlist, currentIndex: currentIndex + 1, shift: 0 })}>Next Song →</button>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
