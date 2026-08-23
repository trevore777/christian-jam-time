'use client';

import { useMemo, useState } from 'react';
import { songs } from '../data/songs';

const NOTES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const INSTRUMENTS = ['Guitar', 'Bass', 'Piano', 'Drums', 'Vocals', 'Other'];

function transpose(note, shift) {
  const i = NOTES.indexOf(note);
  return i < 0 ? note || 'C' : NOTES[(i + shift + 120) % 12];
}

function newRoomCode() {
  return `CJT-${Math.floor(1000 + Math.random() * 9000)}`;
}

export default function HomePage() {
  const [screen, setScreen] = useState('home');
  const [name, setName] = useState('Trevor');
  const [instrument, setInstrument] = useState('Guitar');
  const [joinCode, setJoinCode] = useState('');
  const [roomCode, setRoomCode] = useState('CJT-4271');
  const [query, setQuery] = useState('');
  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [shift, setShift] = useState(0);
  const [leader, setLeader] = useState(true);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return songs;
    return songs.filter(song => song.title.toLowerCase().includes(q) || String(song.number).includes(q));
  }, [query]);

  const currentSong = currentIndex >= 0 ? playlist[currentIndex] : null;
  const displayedKey = currentSong ? transpose(currentSong.key, shift) : '—';

  function createJam() {
    setRoomCode(newRoomCode());
    setLeader(true);
    setScreen('room');
  }

  function joinJam(e) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setRoomCode(code.startsWith('CJT-') ? code : `CJT-${code}`);
    setLeader(false);
    setScreen('room');
  }

  function addSong(song) {
    const existing = playlist.findIndex(item => item.number === song.number);
    if (existing >= 0) {
      setCurrentIndex(existing);
      setShift(0);
      return;
    }
    setPlaylist(prev => [...prev, song]);
    setCurrentIndex(playlist.length);
    setShift(0);
  }

  function removeSong(index) {
    const next = playlist.filter((_, i) => i !== index);
    setPlaylist(next);
    if (!next.length) setCurrentIndex(-1);
    else if (currentIndex >= next.length) setCurrentIndex(next.length - 1);
    else if (index < currentIndex) setCurrentIndex(currentIndex - 1);
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
            <label>Your name<input value={name} onChange={e => setName(e.target.value)} /></label>
            <label>Instrument<select value={instrument} onChange={e => setInstrument(e.target.value)}>{INSTRUMENTS.map(item => <option key={item}>{item}</option>)}</select></label>
          </div>

          <div className="homeActions">
            <button className="primary large" onClick={createJam}>Start a Jam</button>
            <span>or</span>
            <form className="joinForm" onSubmit={joinJam}>
              <input aria-label="Jam code" placeholder="Enter room code" value={joinCode} onChange={e => setJoinCode(e.target.value)} />
              <button className="secondary" type="submit">Join Jam</button>
            </form>
          </div>

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
        <button className="brandButton" onClick={() => setScreen('home')}><span>♪</span><b>Christian Jam Time</b></button>
        <div className="roomBadge">Room <b>{roomCode}</b></div>
        <div className="userBadge">{name || 'Guest'} · {instrument}{leader ? ' · Leader' : ''}</div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <section className="card">
            <div className="sectionHeading"><div><small>PEOPLE</small><h2>Jam Room</h2></div><span className="liveDot">● LIVE</span></div>
            <div className="peopleGrid">
              <div className="personCard leaderCard"><div className="avatar">{(name || 'T')[0]}</div><div><b>{name || 'Trevor'}</b><span>{instrument} {leader ? '· Leader' : ''}</span></div></div>
              <div className="personCard"><div className="avatar">J</div><div><b>John</b><span>Bass</span></div></div>
              <div className="personCard"><div className="avatar">S</div><div><b>Sarah</b><span>Piano</span></div></div>
              <div className="personCard"><div className="avatar">D</div><div><b>David</b><span>Vocals</span></div></div>
            </div>
            <p className="hint">Video tiles are placeholders in this first build. Real camera/microphone rooms come next.</p>
          </section>

          <section className="card songbookCard">
            <div className="sectionHeading"><div><small>SONGBOOK</small><h2>Choose a song</h2></div><span>{songs.length} loaded</span></div>
            <input className="searchInput" type="search" placeholder="Search title or song number" value={query} onChange={e => setQuery(e.target.value)} />
            <div className="songList">
              {filtered.map(song => (
                <div className="songItem" key={song.number}>
                  <button className="songInfo" onClick={() => addSong(song)}>
                    <b>{song.number}. {song.title}</b>
                    <span>Key {song.key || '—'} · Page {song.page}</span>
                  </button>
                  <button className="addButton" onClick={() => addSong(song)} aria-label={`Add ${song.title}`}>+</button>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className="mainColumn">
          <section className="card videoCard">
            <div className="sectionHeading"><div><small>ONLINE TOGETHER</small><h2>Live Jam</h2></div><button className="secondary compact" disabled>Camera coming next</button></div>
            <div className="videoGrid">
              {[name || 'Trevor','John','Sarah','David'].map((person, index) => <div className="videoTile" key={person}><div className="videoInitial">{person[0]}</div><span>{person}{index === 0 ? ` · ${instrument}` : ''}</span></div>)}
            </div>
          </section>

          <section className="card songStage">
            <div className="stageHeader">
              <div>
                <small>NOW PLAYING</small>
                <h2>{currentSong ? currentSong.title : 'Choose a song from the songbook'}</h2>
                <p>{currentSong ? `Song ${currentSong.number} · Songbook page ${currentSong.page} · Original key ${currentSong.key}` : 'Build tonight’s playlist from the shared song list.'}</p>
              </div>
              <div className="keyControl">
                <span>Shared key</span>
                <div><button onClick={() => currentSong && setShift(s => s - 1)} disabled={!currentSong}>−</button><strong>{displayedKey}</strong><button onClick={() => currentSong && setShift(s => s + 1)} disabled={!currentSong}>+</button></div>
              </div>
            </div>

            <div className="chordSheet">
              {currentSong ? <>
                <div className="chords">{[0,5,7,5].map((n,i) => <span key={i}>{transpose(currentSong.key, shift + n)}</span>)}</div>
                <p className="lyricsPlaceholder">Chord and lyric content for <b>{currentSong.title}</b> will be pulled from the original chord songbook. This first build proves the room, song selection, playlist and transposition workflow.</p>
                <div className="chords second">{[0,9,5,7].map((n,i) => <span key={i}>{transpose(currentSong.key, shift + n)}</span>)}</div>
                <p className="lyricsPlaceholder muted">Everyone in the room will see this same song and key when live room synchronisation is connected.</p>
              </> : <div className="emptyStage"><span>♫</span><p>Add a song to begin the Jam.</p></div>}
            </div>

            <div className="playlistHeader"><div><small>TONIGHT&apos;S PLAYLIST</small><h3>{playlist.length ? `${playlist.length} song${playlist.length === 1 ? '' : 's'}` : 'No songs yet'}</h3></div></div>
            <div className="playlist">
              {playlist.map((song, index) => (
                <div className={`playlistItem ${index === currentIndex ? 'active' : ''}`} key={song.number}>
                  <button className="playlistSelect" onClick={() => { setCurrentIndex(index); setShift(0); }}><span>{index + 1}</span><div><b>{song.title}</b><small>Key {song.key}</small></div></button>
                  <button className="removeButton" onClick={() => removeSong(index)} aria-label={`Remove ${song.title}`}>×</button>
                </div>
              ))}
            </div>

            <div className="transport">
              <button className="secondary" disabled={currentIndex <= 0} onClick={() => { setCurrentIndex(i => i - 1); setShift(0); }}>← Previous</button>
              <div className="statusText">{leader ? 'You control the shared song view.' : 'Following the room leader.'}</div>
              <button className="primary" disabled={currentIndex < 0 || currentIndex >= playlist.length - 1} onClick={() => { setCurrentIndex(i => i + 1); setShift(0); }}>Next Song →</button>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
