'use client';

import { useEffect, useRef, useState } from 'react';

const AUDIO_SETTINGS_KEY = 'cjtAudioSettings';
const defaultAudioSettings = { inputDeviceId: '', outputDeviceId: '', musicMode: true, connectionQuality: 'balanced' };
const QUALITY = {
  high: { label: 'High Quality', width: 1280, height: 720, fps: 30, maxBitrate: 1800000, scale: 1 },
  balanced: { label: 'Balanced', width: 854, height: 480, fps: 24, maxBitrate: 850000, scale: 1 },
  low: { label: 'Low Bandwidth', width: 640, height: 360, fps: 15, maxBitrate: 320000, scale: 1 },
  audio: { label: 'Audio Only', width: 0, height: 0, fps: 0, maxBitrate: 0, scale: 1 },
};
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

export default function LiveVideoPanel({ participants = [], participantId = '', roomCode = '' }) {
  const localVideoRef = useRef(null);
  const streamRef = useRef(null);
  const peersRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const negotiatingRef = useRef(new Set());
  const statsPreviousRef = useRef(new Map());
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [remoteStreams, setRemoteStreams] = useState({});
  const [connectionStates, setConnectionStates] = useState({});
  const [audioSettings, setAudioSettings] = useState(defaultAudioSettings);
  const [networkQuality, setNetworkQuality] = useState('Checking…');
  const [networkDetail, setNetworkDetail] = useState('');

  const me = participants.find(person => person.id === participantId);
  const others = participants.filter(person => person.id !== participantId);

  useEffect(() => {
    const refresh = () => {
      const next = readAudioSettings();
      setAudioSettings(next);
      applyQualityToAllSenders(next).catch(() => {});
      if (next.connectionQuality === 'audio') {
        streamRef.current?.getVideoTracks().forEach(track => { track.enabled = false; });
        setCameraOn(false);
      }
    };
    refresh();
    window.addEventListener('cjt-audio-settings-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('cjt-audio-settings-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  async function applyQualityToSender(sender, settings = audioSettings) {
    if (!sender?.track || sender.track.kind !== 'video' || typeof sender.getParameters !== 'function') return;
    const q = QUALITY[settings.connectionQuality] || QUALITY.balanced;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.degradationPreference = 'maintain-framerate';
    if (settings.connectionQuality === 'audio') {
      params.encodings[0].active = false;
    } else {
      params.encodings[0].active = true;
      params.encodings[0].maxBitrate = q.maxBitrate;
      params.encodings[0].maxFramerate = q.fps;
      params.encodings[0].scaleResolutionDownBy = q.scale;
    }
    await sender.setParameters(params).catch(() => {});
  }

  async function applyQualityToAllSenders(settings = audioSettings) {
    const jobs = [];
    for (const pc of peersRef.current.values()) {
      for (const sender of pc.getSenders()) jobs.push(applyQualityToSender(sender, settings));
    }
    await Promise.allSettled(jobs);
  }

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
    statsPreviousRef.current.delete(peerId);
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

    streamRef.current?.getTracks().forEach(track => {
      const sender = pc.addTrack(track, streamRef.current);
      if (track.kind === 'video') applyQualityToSender(sender, readAudioSettings()).catch(() => {});
    });

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
      if (sender) {
        await sender.replaceTrack(track);
        if (track.kind === 'video') await applyQualityToSender(sender, readAudioSettings());
      } else {
        const added = pc.addTrack(track, stream);
        if (track.kind === 'video') await applyQualityToSender(added, readAudioSettings());
      }
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
    if (!participantId || !roomCode) return;
    const readStats = async () => {
      const samples = [];
      for (const [peerId, pc] of peersRef.current.entries()) {
        if (pc.connectionState !== 'connected') continue;
        try {
          const reports = await pc.getStats();
          let packetsLost = 0;
          let packetsReceived = 0;
          let jitter = 0;
          let rtt = 0;
          reports.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
              packetsLost += Number(report.packetsLost || 0);
              packetsReceived += Number(report.packetsReceived || 0);
              jitter = Math.max(jitter, Number(report.jitter || 0));
            }
            if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime != null) {
              rtt = Math.max(rtt, Number(report.currentRoundTripTime || 0));
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
        return;
      }
      const worst = samples.reduce((a, b) => ({ packetLoss: Math.max(a.packetLoss, b.packetLoss), rtt: Math.max(a.rtt, b.rtt), jitter: Math.max(a.jitter, b.jitter) }), { packetLoss: 0, rtt: 0, jitter: 0 });
      setNetworkQuality(qualityFromStats(worst));
      setNetworkDetail(`${worst.packetLoss.toFixed(1)}% loss · ${Math.round(worst.rtt * 1000)} ms RTT · ${Math.round(worst.jitter * 1000)} ms jitter`);
    };
    readStats();
    const timer = setInterval(readStats, 4000);
    return () => clearInterval(timer);
  }, [participantId, roomCode, others.length]);

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
      const wantsVideo = video && selectedAudio.connectionQuality !== 'audio';
      let stream = streamRef.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: wantsVideo ? buildVideoConstraints(selectedAudio) : false,
          audio: audio ? buildAudioConstraints(selectedAudio) : false,
        });
        streamRef.current = stream;
      } else {
        const hasVideo = stream.getVideoTracks().length > 0;
        const hasAudio = stream.getAudioTracks().length > 0;
        if ((wantsVideo && !hasVideo) || (audio && !hasAudio)) {
          const extra = await navigator.mediaDevices.getUserMedia({
            video: wantsVideo && !hasVideo ? buildVideoConstraints(selectedAudio) : false,
            audio: audio && !hasAudio ? buildAudioConstraints(selectedAudio) : false,
          });
          extra.getTracks().forEach(track => stream.addTrack(track));
        }
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      await applyQualityToAllSenders(selectedAudio);
      return stream;
    } catch (error) {
      const message = error?.name === 'NotAllowedError'
        ? 'Camera or microphone permission was blocked. Allow access in your browser and try again.'
        : error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError'
          ? 'The selected audio interface or camera setting is not available. Open Audio Setup and choose an available device or lower quality.'
          : 'Unable to access the camera or microphone on this device.';
      setMediaError(message);
      return null;
    }
  }

  async function toggleCamera() {
    const selected = readAudioSettings();
    if (selected.connectionQuality === 'audio') {
      setMediaError('Audio Only mode is active. Change Music Priority in Audio Setup to enable the camera.');
      return;
    }
    if (!cameraOn) {
      const stream = await ensureStream({ video: true, audio: micOn });
      if (!stream) return;
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      await track.applyConstraints(buildVideoConstraints(selected)).catch(() => {});
      track.enabled = true;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setCameraOn(true);
      await announceMediaChange();
      await applyQualityToAllSenders(selected);
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

  const mode = QUALITY[audioSettings.connectionQuality] || QUALITY.balanced;
  const qualityBackground = networkQuality === 'Poor' ? '#f7e9e6' : networkQuality === 'Weak' ? '#fff3d8' : '#edf5ee';
  const qualityColor = networkQuality === 'Poor' ? '#74352f' : networkQuality === 'Weak' ? '#765a1e' : '#315d3f';

  return (
    <section className="card videoCard">
      <div className="sectionHeading">
        <div><small>ONLINE TOGETHER</small><h2>Live Jam</h2></div>
        <div style={controlRow}>
          <a href="/audio-setup" style={{ ...controlButton, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>🎚️ Audio Setup</a>
          <button style={cameraOn ? activeButton : controlButton} type="button" onClick={toggleCamera} disabled={audioSettings.connectionQuality === 'audio'}>{audioSettings.connectionQuality === 'audio' ? 'Camera Off · Audio Only' : cameraOn ? 'Camera On' : 'Start Camera'}</button>
          <button style={micOn ? activeButton : controlButton} type="button" onClick={toggleMic}>{micOn ? 'Mic On' : 'Start Mic'}</button>
          {(cameraOn || micOn) && <button style={stopButton} type="button" onClick={stopMedia}>Stop</button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {audioSettings.musicMode && <div style={{ padding: '9px 12px', borderRadius: 10, background: '#edf5ee', color: '#315d3f', fontSize: 12, fontWeight: 800 }}>Music Mode · audio processing off</div>}
        <div style={{ padding: '9px 12px', borderRadius: 10, background: '#eef0f3', color: '#33414b', fontSize: 12, fontWeight: 800 }}>Music Priority: {mode.label}</div>
        <div style={{ padding: '9px 12px', borderRadius: 10, background: qualityBackground, color: qualityColor, fontSize: 12, fontWeight: 800 }}>Connection: {networkQuality}{networkDetail ? ` · ${networkDetail}` : ''}</div>
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

        {others.map(person => {
          const remoteStream = remoteStreams[person.id];
          const state = connectionStates[person.id] || 'waiting';
          return (
            <div className="videoTile" key={person.id}>
              <RemoteVideo stream={remoteStream} outputDeviceId={audioSettings.outputDeviceId} />
              {!remoteStream && <div className="videoInitial">{(person.name || '?')[0].toUpperCase()}</div>}
              <span style={{ zIndex: 2 }}>{person.name} · {person.instrument}{person.isLeader ? ' · Leader' : ''}</span>
              <div style={waitBadge}>{remoteStream ? 'Connected' : state === 'connecting' || state === 'new' ? 'Connecting…' : state === 'signal error' ? 'Signal error' : state === 'failed' ? 'Connection failed' : 'Waiting for stream'}</div>
            </div>
          );
        })}

        {!participants.length && <div className="videoTile"><div className="videoInitial">♪</div><span>Waiting for participants</span></div>}
      </div>

      <p className="hint">If the connection becomes weak, open <b>Audio Setup</b> and choose <b>Low Bandwidth</b> or <b>Audio Only</b>. Christian Jam Time reduces video before sacrificing the music stream. This improves stability and congestion, but cannot remove the physical internet delay between locations.</p>
    </section>
  );
}
