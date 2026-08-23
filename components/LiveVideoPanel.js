'use client';

import { useEffect, useRef, useState } from 'react';

const controlRow = { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' };
const controlButton = { border: 0, borderRadius: 10, padding: '9px 12px', minHeight: 40, fontWeight: 800, background: '#eee6d7', color: '#1e2a22' };
const activeButton = { ...controlButton, background: '#2c7c49', color: '#fff' };
const stopButton = { ...controlButton, background: '#8b3f3f', color: '#fff' };
const videoStyle = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 };
const badgeRow = { position: 'absolute', right: 8, top: 8, display: 'flex', gap: 5, zIndex: 2 };
const badge = { background: 'rgba(25,29,25,.7)', color: '#fff', borderRadius: 8, padding: '4px 6px', fontSize: 12 };
const waitBadge = { position: 'absolute', right: 8, top: 8, background: 'rgba(255,255,255,.8)', color: '#39433c', borderRadius: 8, padding: '4px 6px', fontSize: 10, fontWeight: 800, zIndex: 2 };

export default function LiveVideoPanel({ participants = [], participantId = '' }) {
  const localVideoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [mediaError, setMediaError] = useState('');

  const me = participants.find(person => person.id === participantId);
  const others = participants.filter(person => person.id !== participantId);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, []);

  async function ensureStream({ video, audio }) {
    setMediaError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMediaError('Camera and microphone access is not supported by this browser.');
        return null;
      }

      let stream = streamRef.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
          audio: audio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
        });
        streamRef.current = stream;
      } else {
        const hasVideo = stream.getVideoTracks().length > 0;
        const hasAudio = stream.getAudioTracks().length > 0;
        if ((video && !hasVideo) || (audio && !hasAudio)) {
          const extra = await navigator.mediaDevices.getUserMedia({
            video: video && !hasVideo ? { facingMode: 'user' } : false,
            audio: audio && !hasAudio ? { echoCancellation: true, noiseSuppression: true } : false,
          });
          extra.getTracks().forEach(track => stream.addTrack(track));
        }
      }

      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    } catch (error) {
      const message = error?.name === 'NotAllowedError'
        ? 'Camera or microphone permission was blocked. Allow access in your browser and try again.'
        : error?.name === 'NotFoundError'
          ? 'No camera or microphone was found on this device.'
          : 'Unable to access the camera or microphone on this device.';
      setMediaError(message);
      return null;
    }
  }

  async function toggleCamera() {
    if (!cameraOn) {
      const stream = await ensureStream({ video: true, audio: micOn });
      if (!stream) return;
      stream.getVideoTracks().forEach(track => { track.enabled = true; });
      setCameraOn(true);
      return;
    }
    streamRef.current?.getVideoTracks().forEach(track => { track.enabled = false; });
    setCameraOn(false);
  }

  async function toggleMic() {
    if (!micOn) {
      const stream = await ensureStream({ video: cameraOn, audio: true });
      if (!stream) return;
      stream.getAudioTracks().forEach(track => { track.enabled = true; });
      setMicOn(true);
      return;
    }
    streamRef.current?.getAudioTracks().forEach(track => { track.enabled = false; });
    setMicOn(false);
  }

  function stopMedia() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setCameraOn(false);
    setMicOn(false);
    setMediaError('');
  }

  return (
    <section className="card videoCard">
      <div className="sectionHeading">
        <div><small>ONLINE TOGETHER</small><h2>Live Jam</h2></div>
        <div style={controlRow}>
          <button style={cameraOn ? activeButton : controlButton} type="button" onClick={toggleCamera}>
            {cameraOn ? 'Camera On' : 'Start Camera'}
          </button>
          <button style={micOn ? activeButton : controlButton} type="button" onClick={toggleMic}>
            {micOn ? 'Mic On' : 'Start Mic'}
          </button>
          {(cameraOn || micOn) && <button style={stopButton} type="button" onClick={stopMedia}>Stop</button>}
        </div>
      </div>

      {mediaError && <div role="alert" style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: '#f7e9e6', color: '#74352f', fontSize: 13 }}>{mediaError}</div>}

      <div className="videoGrid">
        {me && (
          <div className="videoTile">
            {cameraOn && <video ref={localVideoRef} autoPlay muted playsInline style={videoStyle} />}
            {!cameraOn && <div className="videoInitial">{(me.name || '?')[0].toUpperCase()}</div>}
            <span style={{ zIndex: 2 }}>{me.name} · {me.instrument}{me.isLeader ? ' · Leader' : ''} · You</span>
            <div style={badgeRow}><b style={badge}>{cameraOn ? '📹' : '🚫📹'}</b><b style={badge}>{micOn ? '🎙️' : '🔇'}</b></div>
          </div>
        )}

        {others.map(person => (
          <div className="videoTile" key={person.id}>
            <div className="videoInitial">{(person.name || '?')[0].toUpperCase()}</div>
            <span>{person.name} · {person.instrument}{person.isLeader ? ' · Leader' : ''}</span>
            <div style={waitBadge}>Video connection next</div>
          </div>
        ))}

        {!participants.length && (
          <div className="videoTile"><div className="videoInitial">♪</div><span>Waiting for participants</span></div>
        )}
      </div>

      <p className="hint">Your camera and microphone now work inside the Jam Room. The next connection step sends this media to the other people in the same room using WebRTC.</p>
    </section>
  );
}
