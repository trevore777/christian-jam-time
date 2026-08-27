'use client';

import { useEffect, useRef, useState } from 'react';

const AUDIO_SETTINGS_KEY = 'cjtAudioSettings';
const defaultAudioSettings = { inputDeviceId: '', outputDeviceId: '', musicMode: true, connectionQuality: 'balanced' };
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const QUALITY = {
  high: { label: 'High Quality', width: 1280, height: 720, fps: 30, maxBitrate: 1800000 },
  balanced: { label: 'Balanced', width: 854, height: 480, fps: 24, maxBitrate: 850000 },
  low: { label: 'Low Bandwidth', width: 640, height: 360, fps: 15, maxBitrate: 320000 },
  audio: { label: 'Audio Only', width: 0, height: 0, fps: 0, maxBitrate: 0 },
};
const controlButton = { border: 0, borderRadius: 10, padding: '9px 12px', minHeight: 40, fontWeight: 800, background: '#eee6d7', color: '#1e2a22' };
const activeButton = { ...controlButton, background: '#2c7c49', color: '#fff' };
const stopButton = { ...controlButton, background: '#8b3f3f', color: '#fff' };
const videoStyle = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 };
const badge = { background: 'rgba(25,29,25,.72)', color: '#fff', borderRadius: 8, padding: '4px 6px', fontSize: 12 };

function readAudioSettings() {
  if (typeof window === 'undefined') return defaultAudioSettings;
  try {
    const parsed = JSON.parse(localStorage.getItem(AUDIO_SETTINGS_KEY) || '{}');
    const merged = { ...defaultAudioSettings, ...parsed };
    if (!QUALITY[merged.connectionQuality]) merged.connectionQuality = 'balanced';
    return merged;
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

function buildVideoConstraints(settings) {
  const q = QUALITY[settings.connectionQuality] || QUALITY.balanced;
  if (settings.connectionQuality === 'audio') return false;
  return {
    width: { ideal: q.width },
    height: { ideal: q.height },
    frameRate: { ideal: q.fps, max: q.fps },
    facingMode: 'user',
  };
}

function qualityFromStats({ packetLoss = 0, rtt = 0, jitter = 0 }) {
  if (packetLoss > 8 || rtt > 0.35 || jitter > 0.08) return 'Poor';
  if (packetLoss > 3 || rtt > 0.18 || jitter > 0.04) return 'Weak';
  if (packetLoss > 1 || rtt > 0.1 || jitter > 0.025) return 'Fair';
  return 'Good';
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

export default function LiveVideoPanel({ participants = [], participantId = '', roomCode = '', canBroadcast = false, songLeaderId = '' }) {
  const localVideoRef = useRef(null);
  const streamRef = useRef(null);
  const peersRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const negotiatingRef = useRef(new Set());
  const statsPreviousRef = useRef(new Map());
  const signalSocketRef = useRef(null);
  const signalSocketReadyRef = useRef(false);
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const [iceReady, setIceReady] = useState(false);
  const [turnAvailable, setTurnAvailable] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [remoteStreams, setRemoteStreams] = useState({});
  const [connectionStates, setConnectionStates] = useState({});
  const [audioSettings, setAudioSettings] = useState(defaultAudioSettings);
  const [networkQuality, setNetworkQuality] = useState('Checking…');
  const [networkDetail, setNetworkDetail] = useState('');
  const [connectionRoute, setConnectionRoute] = useState('');

  const me = participants.find(person => person.id === participantId);
  const others = participants.filter(person => person.id !== participantId);
  const songLeader = participants.find(person => person.id === songLeaderId);

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

  useEffect(() => {
    if (!roomCode || !participantId) {
      setIceReady(false);
      return;
    }
    let stopped = false;
    setIceReady(false);
    setTurnAvailable(false);
    const loadIceServers = async () => {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/turn?participantId=${encodeURIComponent(participantId)}`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || !payload.ok || !Array.isArray(payload.iceServers)) throw new Error(payload.error || 'TURN unavailable');
        if (stopped) return;
        iceServersRef.current = [...DEFAULT_ICE_SERVERS, ...payload.iceServers];
        setTurnAvailable(payload.iceServers.some(server => String(Array.isArray(server.urls) ? server.urls.join(' ') : server.urls || '').includes('turn:')));
      } catch {
        if (stopped) return;
        iceServersRef.current = DEFAULT_ICE_SERVERS;
        setTurnAvailable(false);
      } finally {
        if (!stopped) setIceReady(true);
      }
    };
    loadIceServers();
    return () => { stopped = true; };
  }, [roomCode, participantId]);

  async function sendSignal(to, signal) {
    if (!roomCode || !participantId || !to) return;
    const socket = signalSocketRef.current;
    if (socket && signalSocketReadyRef.current && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'signal', to, signal }));
      return;
    }
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
    statsPreviousRef.current.delete(peerId);
    setRemoteStreams(prev => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }

  async function applyVideoQuality(sender) {
    if (!sender?.track || sender.track.kind !== 'video' || typeof sender.getParameters !== 'function') return;
    const settings = readAudioSettings();
    const q = QUALITY[settings.connectionQuality] || QUALITY.balanced;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.degradationPreference = 'maintain-framerate';
    params.encodings[0].active = settings.connectionQuality !== 'audio';
    if (settings.connectionQuality !== 'audio') {
      params.encodings[0].maxBitrate = q.maxBitrate;
      params.encodings[0].maxFramerate = q.fps;
    }
    await sender.setParameters(params).catch(() => {});
  }

  function makePeer(peerId) {
    const existing = peersRef.current.get(peerId);
    if (existing && existing.connectionState !== 'closed') return existing;
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    peersRef.current.set(peerId, pc);
    pendingCandidatesRef.current.set(peerId, []);
    setConnectionStates(prev => ({ ...prev, [peerId]: 'connecting' }));
    if (canBroadcast && streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        const sender = pc.addTrack(track, streamRef.current);
        if (track.kind === 'video') applyVideoQuality(sender).catch(() => {});
      });
    }
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
    if (!canBroadcast || !streamRef.current) return;
    const senders = pc.getSenders();
    for (const track of streamRef.current.getTracks()) {
      const sender = senders.find(item => item.track?.kind === track.kind);
      if (sender) await sender.replaceTrack(track);
      else {
        const added = pc.addTrack(track, streamRef.current);
        if (track.kind === 'video') await applyVideoQuality(added);
      }
    }
  }

  async function createOffer(peerId) {
    if (!canBroadcast || !iceReady || negotiatingRef.current.has(peerId)) return;
    negotiatingRef.current.add(peerId);
    try {
      const pc = makePeer(peerId);
      await attachLocalTracks(pc);
      if (pc.signalingState !== 'stable') return;
      const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
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
    if (!iceReady) return;
    const peerId = message.from;
    if (!peerId || peerId === participantId) return;
    const signal = message.signal || {};
    const pc = makePeer(peerId);
    try {
      if (signal.type === 'offer' && signal.sdp) {
        await pc.setRemoteDescription(signal.sdp);
        await flushCandidates(peerId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal(peerId, { type: 'answer', sdp: pc.localDescription });
      } else if (signal.type === 'answer' && signal.sdp && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(signal.sdp);
        await flushCandidates(peerId, pc);
      } else if (signal.type === 'candidate' && signal.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
        else pendingCandidatesRef.current.set(peerId, [...(pendingCandidatesRef.current.get(peerId) || []), signal.candidate]);
      } else if (signal.type === 'renegotiate' && canBroadcast) {
        await createOffer(peerId);
      }
    } catch (error) {
      console.warn('Signal handling failed', error);
      setConnectionStates(prev => ({ ...prev, [peerId]: 'signal error' }));
    }
  }

  useEffect(() => {
    if (!participantId || !roomCode || !iceReady) return;
    let stopped = false;
    let fallbackTimer = null;
    let reconnectTimer = null;

    const pollOnce = async () => {
      if (stopped || signalSocketReadyRef.current) return;
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/signal?participantId=${encodeURIComponent(participantId)}`, { cache: 'no-store' });
        const payload = await response.json();
        for (const message of payload.signals || []) await handleSignal(message);
      } catch {}
      if (!stopped && !signalSocketReadyRef.current) fallbackTimer = setTimeout(pollOnce, 2000);
    };

    const connectSocket = () => {
      if (stopped) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws?room=${encodeURIComponent(roomCode)}&participantId=${encodeURIComponent(participantId)}`;
      const socket = new WebSocket(url);
      signalSocketRef.current = socket;
      socket.onopen = () => {
        signalSocketReadyRef.current = true;
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
      };
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'signal') handleSignal(message).catch(() => {});
        } catch {}
      };
      socket.onerror = () => { signalSocketReadyRef.current = false; };
      socket.onclose = () => {
        if (signalSocketRef.current === socket) signalSocketRef.current = null;
        signalSocketReadyRef.current = false;
        if (!stopped) {
          if (!fallbackTimer) pollOnce();
          reconnectTimer = setTimeout(connectSocket, 3000);
        }
      };
    };

    connectSocket();
    const socketFallback = setTimeout(() => {
      if (!signalSocketReadyRef.current) pollOnce();
    }, 1500);

    return () => {
      stopped = true;
      clearTimeout(socketFallback);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      signalSocketReadyRef.current = false;
      const socket = signalSocketRef.current;
      signalSocketRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    };
  }, [participantId, roomCode, canBroadcast, songLeaderId, iceReady]);

  useEffect(() => {
    const validIds = new Set(others.map(person => person.id));
    for (const peerId of peersRef.current.keys()) if (!validIds.has(peerId)) closePeer(peerId);
    if (!canBroadcast || !streamRef.current || !iceReady) return;
    for (const person of others) createOffer(person.id).catch(() => {});
  }, [participants.map(person => person.id).join('|'), canBroadcast, participantId, iceReady]);

  useEffect(() => {
    if (canBroadcast) return;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setCameraOn(false);
    setMicOn(false);
  }, [canBroadcast]);

  useEffect(() => {
    if (!participantId || !roomCode) return;
    const readStats = async () => {
      const samples = [];
      let usedRelay = false;
      for (const [peerId, pc] of peersRef.current.entries()) {
        if (pc.connectionState !== 'connected') continue;
        try {
          const reports = await pc.getStats();
          let packetsLost = 0, packetsReceived = 0, jitter = 0, rtt = 0;
          reports.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
              packetsLost += Number(report.packetsLost || 0);
              packetsReceived += Number(report.packetsReceived || 0);
              jitter = Math.max(jitter, Number(report.jitter || 0));
            }
            if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime != null) {
              rtt = Math.max(rtt, Number(report.currentRoundTripTime || 0));
              const local = reports.get(report.localCandidateId);
              const remote = reports.get(report.remoteCandidateId);
              if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') usedRelay = true;
            }
          });
          const previous = statsPreviousRef.current.get(peerId);
          let packetLoss = 0;
          if (previous) {
            const lostDelta = Math.max(0, packetsLost - previous.packetsLost);
            const receivedDelta = Math.max(0, packetsReceived - previous.packetsReceived);
            const total = lostDelta + receivedDelta;
            packetLoss = total ? (lostDelta / total) * 100 : 0;
          }
          statsPreviousRef.current.set(peerId, { packetsLost, packetsReceived });
          samples.push({ packetLoss, rtt, jitter });
        } catch {}
      }
      if (!samples.length) {
        setNetworkQuality(others.length ? 'Connecting…' : 'Ready');
        setNetworkDetail('');
        setConnectionRoute(turnAvailable ? 'TURN available' : 'Direct only');
        return;
      }
      const worst = samples.reduce((a, b) => ({ packetLoss: Math.max(a.packetLoss, b.packetLoss), rtt: Math.max(a.rtt, b.rtt), jitter: Math.max(a.jitter, b.jitter) }), { packetLoss: 0, rtt: 0, jitter: 0 });
      setNetworkQuality(qualityFromStats(worst));
      setNetworkDetail(`${worst.packetLoss.toFixed(1)}% loss · ${Math.round(worst.rtt * 1000)} ms RTT · ${Math.round(worst.jitter * 1000)} ms jitter`);
      setConnectionRoute(usedRelay ? 'TURN relay' : 'Direct');
    };
    readStats();
    const timer = setInterval(readStats, 4000);
    return () => clearInterval(timer);
  }, [participantId, roomCode, others.length, turnAvailable]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    for (const pc of peersRef.current.values()) pc.close();
    peersRef.current.clear();
  }, []);

  async function announceMediaChange() {
    for (const person of others) await createOffer(person.id);
  }

  async function ensureStream({ video, audio }) {
    if (!canBroadcast) return null;
    setMediaError('');
    try {
      const settings = readAudioSettings();
      setAudioSettings(settings);
      const wantsVideo = video && settings.connectionQuality !== 'audio';
      let stream = streamRef.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: wantsVideo ? buildVideoConstraints(settings) : false,
          audio: audio ? buildAudioConstraints(settings) : false,
        });
        streamRef.current = stream;
      } else {
        const hasVideo = stream.getVideoTracks().length > 0;
        const hasAudio = stream.getAudioTracks().length > 0;
        if ((wantsVideo && !hasVideo) || (audio && !hasAudio)) {
          const extra = await navigator.mediaDevices.getUserMedia({
            video: wantsVideo && !hasVideo ? buildVideoConstraints(settings) : false,
            audio: audio && !hasAudio ? buildAudioConstraints(settings) : false,
          });
          extra.getTracks().forEach(track => stream.addTrack(track));
        }
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    } catch (error) {
      setMediaError(error?.name === 'NotAllowedError' ? 'Camera or microphone permission was blocked.' : 'Unable to access the camera or microphone on this device.');
      return null;
    }
  }

  async function toggleCamera() {
    if (!canBroadcast) return;
    const settings = readAudioSettings();
    if (settings.connectionQuality === 'audio') return setMediaError('Audio Only mode is active.');
    if (!cameraOn) {
      const stream = await ensureStream({ video: true, audio: micOn });
      const track = stream?.getVideoTracks()[0];
      if (!track) return;
      track.enabled = true;
      setCameraOn(true);
      await announceMediaChange();
    } else {
      streamRef.current?.getVideoTracks().forEach(track => { track.enabled = false; });
      setCameraOn(false);
    }
  }

  async function toggleMic() {
    if (!canBroadcast) return;
    if (!micOn) {
      const stream = await ensureStream({ video: cameraOn, audio: true });
      if (!stream) return;
      stream.getAudioTracks().forEach(track => { track.enabled = true; });
      setMicOn(true);
      await announceMediaChange();
    } else {
      streamRef.current?.getAudioTracks().forEach(track => { track.enabled = false; });
      setMicOn(false);
    }
  }

  function stopMedia() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setCameraOn(false);
    setMicOn(false);
    for (const peerId of [...peersRef.current.keys()]) closePeer(peerId);
  }

  const mode = QUALITY[audioSettings.connectionQuality] || QUALITY.balanced;
  const remoteSongLeaderStream = songLeaderId && songLeaderId !== participantId ? remoteStreams[songLeaderId] : null;
  const songLeaderState = songLeaderId && songLeaderId !== participantId ? connectionStates[songLeaderId] || 'waiting' : '';

  return (
    <section className="card videoCard">
      <div className="sectionHeading">
        <div><small>{canBroadcast ? 'YOU ARE LEADING THIS SONG' : 'FOLLOWING THE SONG LEADER'}</small><h2>{canBroadcast ? 'Song Leader Live' : `Following ${songLeader?.name || 'Song Leader'}`}</h2></div>
        {canBroadcast && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <a href="/audio-setup" style={{ ...controlButton, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>🎚️ Audio Setup</a>
          <button style={cameraOn ? activeButton : controlButton} type="button" onClick={toggleCamera} disabled={audioSettings.connectionQuality === 'audio'}>{cameraOn ? 'Camera On' : 'Start Camera'}</button>
          <button style={micOn ? activeButton : controlButton} type="button" onClick={toggleMic}>{micOn ? 'Mic On' : 'Start Mic'}</button>
          {(cameraOn || micOn) && <button style={stopButton} type="button" onClick={stopMedia}>Stop</button>}
        </div>}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {canBroadcast && audioSettings.musicMode && <div style={{ padding: '9px 12px', borderRadius: 10, background: '#edf5ee', color: '#315d3f', fontSize: 12, fontWeight: 800 }}>Music Mode</div>}
        <div style={{ padding: '9px 12px', borderRadius: 10, background: '#eef0f3', color: '#33414b', fontSize: 12, fontWeight: 800 }}>Music Priority: {mode.label}</div>
        <div style={{ padding: '9px 12px', borderRadius: 10, background: '#edf5ee', color: '#315d3f', fontSize: 12, fontWeight: 800 }}>Connection: {networkQuality}{networkDetail ? ` · ${networkDetail}` : ''}{connectionRoute ? ` · ${connectionRoute}` : ''}</div>
      </div>

      {mediaError && <div role="alert" style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: '#f7e9e6', color: '#74352f' }}>{mediaError}</div>}

      <div className="videoGrid">
        {canBroadcast && me && <div className="videoTile">
          {cameraOn && <video ref={localVideoRef} autoPlay muted playsInline style={videoStyle} />}
          {!cameraOn && <div className="videoInitial">{(me.name || '?')[0].toUpperCase()}</div>}
          <span style={{ zIndex: 2 }}>{me.name} · Song Leader · You</span>
          <div style={{ position: 'absolute', right: 8, top: 8, display: 'flex', gap: 5, zIndex: 2 }}><b style={badge}>{cameraOn ? '📹' : '🚫📹'}</b><b style={badge}>{micOn ? '🎙️' : '🔇'}</b></div>
        </div>}

        {!canBroadcast && <div className="videoTile" style={{ minHeight: 260 }}>
          <RemoteVideo stream={remoteSongLeaderStream} outputDeviceId={audioSettings.outputDeviceId} />
          {!remoteSongLeaderStream && <div className="videoInitial">{(songLeader?.name || '?')[0].toUpperCase()}</div>}
          <span style={{ zIndex: 2 }}>{songLeader?.name || 'Song Leader'} · {songLeader?.instrument || ''} · Song Leader</span>
          <div style={{ position: 'absolute', right: 8, top: 8, zIndex: 2 }}><b style={badge}>{remoteSongLeaderStream ? 'Connected' : !iceReady ? 'Preparing secure relay…' : songLeaderState === 'failed' ? 'Connection failed' : 'Connecting…'}</b></div>
        </div>}
      </div>

      <p className="hint">Only the selected Song Leader can broadcast microphone and camera. Everyone else follows with their own mic and camera off. Direct connections are preferred; the AWS TURN relay is used automatically when mobile or restricted networks cannot connect directly.</p>
    </section>
  );
}
