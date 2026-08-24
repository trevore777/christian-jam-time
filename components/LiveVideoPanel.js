'use client';

import { useEffect, useRef, useState } from 'react';

const AUDIO_SETTINGS_KEY = 'cjtAudioSettings';
const defaultAudioSettings = { inputDeviceId: '', outputDeviceId: '', musicMode: true };
const controlRow = { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' };
const controlButton = { border: 0, borderRadius: 10, padding: '9px 12px', minHeight: 40, fontWeight: 800, background: '#eee6d7', color: '#1e2a22' };
const activeButton = { ...controlButton, background: '#2c7c49', color: '#fff' };
const stopButton = { ...controlButton, background: '#8b3f3f', color: '#fff' };
const videoStyle = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 };
const badgeRow = { position: 'absolute', right: 8, top: 8, display: 'flex', gap: 5, zIndex: 2 };
const badge = { background: 'rgba(25,29,25,.7)', color: '#fff', borderRadius: 8, padding: '4px 6px', fontSize: 12 };
const waitBadge = { position: 'absolute', right: 8, top: 8, background: 'rgba(255,255,255,.84)', color: '#39433c', borderRadius: 8, padding: '4px 6px', fontSize: 10, fontWeight: 800, zIndex: 2 };

function readAudioSettings() {
  if (typeof window === 'undefined') return defaultAudioSettings;
  try {
    return { ...defaultAudioSettings, ...JSON.parse(localStorage.getItem(AUDIO_SETTINGS_KEY) || '{}') };
  } catch {
    return defaultAudioSettings;
  }
}

function buildAudioConstraints(settings) {
  return {
    ...(settings.inputDeviceId ? { deviceId: { exact: settings.inputDeviceId } } : {}),
    echoCancellation: !settings.musicMode,
    noiseSuppression: !settings.musicMode,
    autoGainControl: !settings.musicMode,
    channelCount: settings.musicMode ? { ideal: 2 } : { ideal: 1 },
    latency: { ideal: 0.01 },
  };
}

function RemoteVideo({ stream, outputDeviceId = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  useEffect(() => {
    const video = ref.current;
    if (!video || !outputDeviceId || typeof video.setSinkId !== 'function') return;
    video.setSinkId(outputDeviceId).catch(() => {});
  }, [outputDeviceId, stream]);
  return stream ? <video ref={ref} autoPlay playsInline style={videoStyle} /> : null;
}

export default function LiveVideoPanel({ participants = [], participantId = '', roomCode = '' }) {
  const localVideoRef = useRef(null);
  const streamRef = useRef(null);
  const peersRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const negotiatingRef = useRef(new Set());
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [remoteStreams, setRemoteStreams] = useState({});
  const [connectionStates, setConnectionStates] = useState({});
  const [audioSettings, setAudioSettings] = useState(defaultAudioSettings);

  const me = participants.find(person => person.id === participantId);
  const others = participants.filter(person => person.id !== participantId);

  useEffect(() => {
    const refresh = () => setAudioSettings(readAudioSettings());
    refresh();
    window.addEventListener('cjt-audio-settings-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('cjt-audio-settings-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  async function sendSignal(to, signal) {
    if (!roomCode || !participantId || !to) return;
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: participantId, to, signal }),
    });
    if (!response.ok) throw new Error(`Signal send failed (${response.status})`);
  }

  function closePeer(peerId) {
    const pc = peersRef.current.get(peerId);
    if (pc) pc.close();
    peersRef.current.delete(peerId);
    pendingCandidatesRef.current.delete(peerId);
    negotiatingRef.current.delete(peerId);
    setRemoteStreams(prev => {
      if (!prev[peerId]) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setConnectionStates(prev => ({ ...prev, [peerId]: 'disconnected' }));
  }

  function makePeer(peerId) {
    const existing = peersRef.current.get(peerId);
    if (existing && existing.connectionState !== 'closed') return existing;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    peersRef.current.set(peerId, pc);
    pendingCandidatesRef.current.set(peerId, []);
    setConnectionStates(prev => ({ ...prev, [peerId]: 'connecting' }));

    streamRef.current?.getTracks().forEach(track => pc.addTrack(track, streamRef.current));

    pc.onicecandidate = event => {
      if (event.candidate) sendSignal(peerId, { type: 'candidate', candidate: event.candidate }).catch(() => {});
    };

    pc.ontrack = event => {
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      setRemoteStreams(prev => ({ ...prev, [peerId]: stream }));
    };

    pc.onconnectionstatechange = () => {
      setConnectionStates(prev => ({ ...prev, [peerId]: pc.connectionState }));
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(peerId);
    };

    return pc;
  }

  async function attachLocalTracks(pc) {
    const stream = streamRef.current;
    if (!stream) return;
    const senders = pc.getSenders();
    for (const track of stream.getTracks()) {
      const sender = senders.find(item => item.track?.kind === track.kind);
      if (sender) await sender.replaceTrack(track);
      else pc.addTrack(track, stream);
    }
  }

  async function createOffer(peerId) {
    if (negotiatingRef.current.has(peerId)) return;
    negotiatingRef.current.add(peerId);
    try {
      const pc = makePeer(peerId);
      await attachLocalTracks(pc);
      if (pc.signalingState !== 'stable') return;
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      await sendSignal(peerId, { type: 'offer', sdp: pc.localDescription });
    } catch (error) {
      console.warn('Offer failed', error);
      setConnectionStates(prev => ({ ...prev, [peerId]: 'signal error' }));
    } finally {
      negotiatingRef.current.delete(peerId);
    }
  }

  async function flushCandidates(peerId, pc) {
    const queued = pendingCandidatesRef.current.get(peerId) || [];
    for (const candidate of queued) {
      try { await pc.addIceCandidate(candidate); } catch {}
    }
    pendingCandidatesRef.current.set(peerId, []);
  }

  async function handleSignal(message) {
    const peerId = message.from;
    if (!peerId || peerId === participantId) return;
    const signal = message.signal || {};
    const pc = makePeer(peerId);

    try {
      if (signal.type === 'offer' && signal.sdp) {
        const collision = pc.signalingState !== 'stable';
        if (collision) {
          if (participantId < peerId) return;
          await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
        }
        await pc.setRemoteDescription(signal.sdp);
        await attachLocalTracks(pc);
        await flushCandidates(peerId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal(peerId, { type: 'answer', sdp: pc.localDescription });
      } else if (signal.type === 'answer' && signal.sdp) {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(signal.sdp);
          await flushCandidates(peerId, pc);
        }
      } else if (signal.type === 'candidate' && signal.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
        else pendingCandidatesRef.current.set(peerId, [...(pendingCandidatesRef.current.get(peerId) || []), signal.candidate]);
      } else if (signal.type === 'renegotiate') {
        if (participantId < peerId) await createOffer(peerId);
      }
    } catch (error) {
      console.warn('Signal handling failed', error);
      setConnectionStates(prev => ({ ...prev, [peerId]: 'signal error' }));
    }
  }

  useEffect(() => {
    if (!participantId || !roomCode) return;
    let stopped = false;

    const pollSignals = async () => {
      if (stopped) return;
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/signal?participantId=${encodeURIComponent(participantId)}`, { cache: 'no-store' });
        const payload = await response.json();
        for (const message of payload.signals || []) await handleSignal(message);
      } catch {}
    };

    pollSignals();
    const timer = setInterval(pollSignals, 700);
    return () => { stopped = true; clearInterval(timer); };
  }, [participantId, roomCode]);

  useEffect(() => {
    const activeIds = new Set(others.map(person => person.id));
    for (const peerId of peersRef.current.keys()) {
      if (!activeIds.has(peerId)) closePeer(peerId);
    }

    if (!streamRef.current) return;
    for (const person of others) {
      const peerId = person.id;
      if (!peerId) continue;
      const pc = makePeer(peerId);
      attachLocalTracks(pc).then(async () => {
        if (participantId < peerId) await createOffer(peerId);
        else await sendSignal(peerId, { type: 'renegotiate' });
      }).catch(() => {});
    }
  }, [participants.map(person => person.id).join('|'), participantId, roomCode]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      for (const pc of peersRef.current.values()) pc.close();
      peersRef.current.clear();
    };
  }, []);

  async function announceMediaChange() {
    for (const person of others) {
      const pc = makePeer(person.id);
      await attachLocalTracks(pc);
      if (participantId < person.id) await createOffer(person.id);
      else await sendSignal(person.id, { type: 'renegotiate' });
    }
  }

  async function ensureStream({ video, audio }) {
    setMediaError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMediaError('Camera and microphone access is not supported by this browser.');
        return null;
      }

      const selectedAudio = readAudioSettings();
      setAudioSettings(selectedAudio);
      let stream = streamRef.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
          audio: audio ? buildAudioConstraints(selectedAudio) : false,
        });
        streamRef.current = stream;
      } else {
        const hasVideo = stream.getVideoTracks().length > 0;
        const hasAudio = stream.getAudioTracks().length > 0;
        if ((video && !hasVideo) || (audio && !hasAudio)) {
          const extra = await navigator.mediaDevices.getUserMedia({
            video: video && !hasVideo ? { facingMode: 'user' } : false,
            audio: audio && !hasAudio ? buildAudioConstraints(selectedAudio) : false,
          });
          extra.getTracks().forEach(track => stream.addTrack(track));
        }
      }

      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    } catch (error) {
      const message = error?.name === 'NotAllowedError'
        ? 'Camera or microphone permission was blocked. Allow access in your browser and try again.'
        : error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError'
          ? 'The selected audio interface is not available. Open Musician Audio Setup and choose an available input.'
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
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setCameraOn(true);
      await announceMediaChange();
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
      await announceMediaChange();
      return;
    }
    streamRef.current?.getAudioTracks().forEach(track => { track.enabled = false; });
    setMicOn(false);
  }

  function stopMedia() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    for (const peerId of [...peersRef.current.keys()]) closePeer(peerId);
    setCameraOn(false);
    setMicOn(false);
    setMediaError('');
  }

  return (
    <section className="card videoCard">
      <div className="sectionHeading">
        <div><small>ONLINE TOGETHER</small><h2>Live Jam</h2></div>
        <div style={controlRow}>
          <a href="/audio-setup" style={{ ...controlButton, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>🎚️ Audio Setup</a>
          <button style={cameraOn ? activeButton : controlButton} type="button" onClick={toggleCamera}>{cameraOn ? 'Camera On' : 'Start Camera'}</button>
          <button style={micOn ? activeButton : controlButton} type="button" onClick={toggleMic}>{micOn ? 'Mic On' : 'Start Mic'}</button>
          {(cameraOn || micOn) && <button style={stopButton} type="button" onClick={stopMedia}>Stop</button>}
        </div>
      </div>

      {audioSettings.musicMode && <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 10, background: '#edf5ee', color: '#315d3f', fontSize: 12, fontWeight: 800 }}>Music Mode ready{audioSettings.inputDeviceId ? ' · selected USB/audio input will be used' : ' · using the default audio input'}.</div>}
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

        {others.map(person => {
          const remoteStream = remoteStreams[person.id];
          const state = connectionStates[person.id] || 'waiting';
          return (
            <div className="videoTile" key={person.id}>
              <RemoteVideo stream={remoteStream} outputDeviceId={audioSettings.outputDeviceId} />
              {!remoteStream && <div className="videoInitial">{(person.name || '?')[0].toUpperCase()}</div>}
              <span style={{ zIndex: 2 }}>{person.name} · {person.instrument}{person.isLeader ? ' · Leader' : ''}</span>
              <div style={waitBadge}>{remoteStream ? 'Connected' : state === 'connecting' || state === 'new' ? 'Connecting…' : state === 'signal error' ? 'Signal error' : state === 'failed' ? 'Connection failed' : 'Waiting for camera'}</div>
            </div>
          );
        })}

        {!participants.length && <div className="videoTile"><div className="videoInitial">♪</div><span>Waiting for participants</span></div>}
      </div>

      <p className="hint">For instruments and singing, use <b>Audio Setup</b> before starting the mic. A Scarlett 2i2 or similar USB interface with wired headphones will improve local audio quality and reduce local latency; internet latency still depends on the connection between musicians.</p>
    </section>
  );
}
