'use client';

import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'cjtAudioSettings';

const page = { minHeight: '100vh', background: '#f3efe5', padding: '28px 16px', color: '#1f2a22' };
const card = { maxWidth: 820, margin: '0 auto', background: '#fffdf8', border: '1px solid #ded6c5', borderRadius: 22, padding: 24, boxShadow: '0 18px 50px rgba(48,45,36,.08)' };
const field = { display: 'grid', gap: 7, marginTop: 16, fontWeight: 800 };
const selectStyle = { width: '100%', padding: '12px 14px', borderRadius: 11, border: '1px solid #cfc6b5', background: '#fff', fontSize: 15 };
const primary = { border: 0, borderRadius: 11, padding: '12px 16px', background: '#2d6846', color: '#fff', fontWeight: 900, cursor: 'pointer' };
const secondary = { ...primary, background: '#eee6d7', color: '#26342b' };

export default function AudioSetupPage() {
  const [inputs, setInputs] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [inputDeviceId, setInputDeviceId] = useState('');
  const [outputDeviceId, setOutputDeviceId] = useState('');
  const [musicMode, setMusicMode] = useState(true);
  const [status, setStatus] = useState('Connect your USB interface, then allow microphone access.');
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      setInputDeviceId(saved.inputDeviceId || '');
      setOutputDeviceId(saved.outputDeviceId || '');
      setMusicMode(saved.musicMode !== false);
    } catch {}
    return stopTest;
  }, []);

  async function loadDevices(requestPermission = false) {
    try {
      let permissionStream = null;
      if (requestPermission) {
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs(devices.filter(d => d.kind === 'audioinput'));
      setOutputs(devices.filter(d => d.kind === 'audiooutput'));
      permissionStream?.getTracks().forEach(track => track.stop());
      setStatus('Audio devices detected. Choose your interface and test the input.');
    } catch (error) {
      setStatus(error?.name === 'NotAllowedError' ? 'Microphone permission was blocked. Allow microphone access in Chrome and try again.' : 'Could not read the available audio devices.');
    }
  }

  useEffect(() => {
    if (!navigator.mediaDevices) return;
    loadDevices(false);
    const handler = () => loadDevices(false);
    navigator.mediaDevices.addEventListener?.('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', handler);
  }, []);

  function stopTest() {
    cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    audioContextRef.current?.close?.().catch(() => {});
    audioContextRef.current = null;
    setTesting(false);
    setLevel(0);
  }

  async function testInput() {
    stopTest();
    try {
      const audio = {
        ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
        echoCancellation: !musicMode,
        noiseSuppression: !musicMode,
        autoGainControl: !musicMode,
        channelCount: musicMode ? { ideal: 2 } : { ideal: 1 },
        latency: { ideal: 0.01 },
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      streamRef.current = stream;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContext({ latencyHint: 'interactive' });
      audioContextRef.current = context;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const draw = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const sample = (value - 128) / 128;
          sum += sample * sample;
        }
        setLevel(Math.min(100, Math.round(Math.sqrt(sum / data.length) * 260)));
        animationRef.current = requestAnimationFrame(draw);
      };
      draw();
      setTesting(true);
      const track = stream.getAudioTracks()[0];
      setStatus(`Input test running: ${track?.label || 'selected audio input'}. Play or sing and watch the meter.`);
      await loadDevices(false);
    } catch (error) {
      setStatus(error?.name === 'OverconstrainedError' ? 'That saved interface is no longer available. Choose another input.' : 'Could not start the selected audio input. Check the cable and microphone permission.');
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ inputDeviceId, outputDeviceId, musicMode }));
    window.dispatchEvent(new Event('cjt-audio-settings-changed'));
    setStatus('Saved. Christian Jam Time will use these settings the next time you start the microphone.');
  }

  const outputSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

  return <main style={page}>
    <section style={card}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>🎚️</div>
        <p style={{ margin: '4px 0', fontSize: 12, fontWeight: 900, letterSpacing: '.14em', color: '#69746b' }}>MUSICIAN AUDIO SETUP</p>
        <h1 style={{ margin: '6px 0 10px', fontSize: 'clamp(32px,6vw,54px)' }}>Set up your audio interface</h1>
        <p style={{ maxWidth: 680, margin: '0 auto', lineHeight: 1.6, color: '#657067' }}>For a Focusrite Scarlett 2i2 or similar USB interface, connect it before opening the Jam. Use wired headphones from the interface where possible.</p>
      </div>

      <div style={{ marginTop: 24, padding: 18, borderRadius: 16, background: '#f3efe5' }}>
        <b>Recommended for instruments and singing</b>
        <p style={{ marginBottom: 0, lineHeight: 1.55, color: '#657067' }}>Music Mode turns off browser echo cancellation, noise suppression and automatic gain control. Those features are useful for speech calls but can pump, gate or distort musical audio.</p>
      </div>

      <div style={field}>
        <label>Audio input / USB interface</label>
        <select style={selectStyle} value={inputDeviceId} onChange={e => setInputDeviceId(e.target.value)}>
          <option value="">Default microphone</option>
          {inputs.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Audio input ${i + 1}`}</option>)}
        </select>
      </div>

      <div style={field}>
        <label>Audio output / headphones</label>
        <select style={selectStyle} value={outputDeviceId} onChange={e => setOutputDeviceId(e.target.value)} disabled={!outputSupported}>
          <option value="">Default output</option>
          {outputs.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Audio output ${i + 1}`}</option>)}
        </select>
        {!outputSupported && <span style={{ fontSize: 12, color: '#7a6653' }}>This browser does not allow websites to choose the output device. Select the Scarlett as the Mac/Windows system output instead.</span>}
      </div>

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 20, fontWeight: 900 }}>
        <input type="checkbox" checked={musicMode} onChange={e => setMusicMode(e.target.checked)} style={{ marginTop: 3 }} />
        <span>Music Mode <small style={{ display: 'block', fontWeight: 500, lineHeight: 1.5, color: '#657067' }}>Disable echo cancellation, noise suppression and auto gain control for a more natural instrument/vocal signal.</small></span>
      </label>

      <div style={{ marginTop: 20 }}>
        <div style={{ height: 18, borderRadius: 999, overflow: 'hidden', background: '#e5dfd2' }}><div style={{ width: `${level}%`, height: '100%', background: level > 85 ? '#9c413b' : '#397454', transition: 'width 80ms linear' }} /></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12, color: '#6b746e' }}><span>Input level</span><span>{level}%</span></div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
        <button type="button" style={secondary} onClick={() => loadDevices(true)}>Allow access / Refresh devices</button>
        <button type="button" style={secondary} onClick={testing ? stopTest : testInput}>{testing ? 'Stop input test' : 'Test selected input'}</button>
        <button type="button" style={primary} onClick={save}>Save audio setup</button>
      </div>

      <p role="status" style={{ marginTop: 18, padding: '12px 14px', borderRadius: 12, background: '#f7f4ec', lineHeight: 1.5 }}>{status}</p>

      <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid #e0d8c8', lineHeight: 1.6, color: '#657067' }}>
        <b style={{ color: '#243129' }}>Scarlett 2i2 setup:</b> microphone or instrument → Scarlett input → USB to computer → wired headphones from Scarlett. Keep the computer on wired Ethernet where practical. The interface improves local audio quality and latency, but internet latency still depends on the connection between musicians.
      </div>

      <div style={{ textAlign: 'center', marginTop: 22 }}><a href="/" style={{ color: '#77562d', fontWeight: 900 }}>← Back to Christian Jam Time</a></div>
    </section>
  </main>;
}
