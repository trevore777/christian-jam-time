'use client';

import { useEffect, useRef, useState } from 'react';

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
      <div className="sectionHeading videoHeading">
        <div><small>ONLINE TOGETHER</small><h2>Live Jam</h2></div>
        <div className="mediaControls">
          <button className={cameraOn ? 'mediaButton active' : 'mediaButton'} type="button" onClick={toggleCamera}>
            {cameraOn ? 'Camera On' : 'Start Camera'}
          </button>
          <button className={micOn ? 'mediaButton active' : 'mediaButton'} type="button" onClick={toggleMic}>
            {micOn ? 'Mic On' : 'Start Mic'}
          </button>
          {(cameraOn || micOn) && <button className="mediaButton danger" type="button" onClick={stopMedia}>Stop</button>}
        </div>
      </div>

      {mediaError && <div className="mediaError" role="alert">{mediaError}</div>}

      <div className="videoGrid">
        {me && (
          <div className="videoTile localVideoTile">
            <video ref={localVideoRef} autoPlay muted playsInline className={cameraOn ? 'participantVideo visible' : 'participantVideo'} />
            {!cameraOn && <div className="videoInitial">{(me.name || '?')[0].toUpperCase()}</div>}
            <span>{me.name} · {me.instrument}{me.isLeader ? ' · Leader' : ''} · You</span>
            <div className="mediaBadges"><b>{cameraOn ? '📹' : '🚫📹'}</b><b>{micOn ? '🎙️' : '🔇'}</b></div>
          </div>
        )}

        {others.map(person => (
          <div className="videoTile" key={person.id}>
            <div className="videoInitial">{(person.name || '?')[0].toUpperCase()}</div>
            <span>{person.name} · {person.instrument}{person.isLeader ? ' · Leader' : ''}</span>
            <div className="waitingBadge">Video connection next</div>
          </div>
        ))}

        {!participants.length && (
          <div className="videoTile"><div className="videoInitial">♪</div><span>Waiting for participants</span></div>
        )}
      </div>

      <p className="hint videoHint">Your camera and microphone now work inside the Jam Room. The next connection step sends this media to the other people in the same room using WebRTC.</p>
    </section>
  );
}
