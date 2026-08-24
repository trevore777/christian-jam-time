'use client';

// Deployment refresh: ensures Vercel builds the current master containing this route and its API.
import { useState } from 'react';

export default function SongbookUpdatePage() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function applyUpdate() {
    if (!file) return setStatus('Choose the converted Songs 90–355 JSON file first.');
    setBusy(true);
    setResult(null);
    setStatus('Reading converted songs…');
    try {
      const entries = JSON.parse(await file.text());
      if (!Array.isArray(entries)) throw new Error('The update file must contain a JSON song array.');
      setStatus(`Checking ${entries.length} converted song records…`);
      const response = await fetch('/api/songbook/pdf-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Songbook update failed.');
      setResult(payload);
      setStatus('Songbook update complete.');
    } catch (error) {
      setStatus(error?.message || 'Unable to update the songbook.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="landing" style={{placeItems:'start center'}}>
    <section className="hero" style={{maxWidth:820,textAlign:'left'}}>
      <div style={{textAlign:'center'}}>
        <div className="brandMark">♪</div>
        <p className="eyebrow">SONGBOOK MAINTENANCE</p>
        <h1 style={{fontSize:'clamp(36px,6vw,60px)'}}>Update Songs 90–355</h1>
        <p className="lead">Apply the converted PDF lyrics and chords to the existing Christian Jam Time master songbook.</p>
      </div>

      <div style={{background:'#fffdf8',border:'1px solid #ded6c5',borderRadius:18,padding:20,marginTop:24}}>
        <h2 style={{marginTop:0}}>PDF conversion update</h2>
        <p style={{color:'#6f786f',lineHeight:1.6}}>This update matches songs by number and only fills songs that currently have no lyrics/chords. Existing corrected songs are left untouched.</p>
        <label style={{display:'block',fontWeight:800,fontSize:13,marginTop:16}}>
          Converted Songs 90–355 JSON
          <input type="file" accept="application/json,.json" onChange={e => setFile(e.target.files?.[0] || null)} style={{display:'block',marginTop:8,width:'100%'}} />
        </label>
        <button className="primary large" type="button" onClick={applyUpdate} disabled={busy || !file} style={{marginTop:18}}>
          {busy ? 'Applying update…' : 'Apply Songs 90–355'}
        </button>
        {status && <p style={{fontWeight:800,marginTop:16}}>{status}</p>}
        {result && <div style={{marginTop:16,padding:16,borderRadius:14,background:'#f4f0e7',lineHeight:1.7}}>
          <b>{result.applied} songs updated</b><br />
          {result.skippedExisting} already had lyrics/chords and were preserved.<br />
          {result.skippedInvalid} invalid/unmatched records were skipped.<br />
          Master songbook total: {result.totalSongs} songs.
        </div>}
        <p style={{fontSize:12,color:'#6f786f',lineHeight:1.5,marginTop:18}}>The imported PDF material remains marked as an OCR draft so chord or word corrections can be made later with Edit Song / Chords and saved back to the master list.</p>
      </div>

      <div style={{textAlign:'center',marginTop:20}}><a href="/" style={{color:'#77562d',fontWeight:900}}>← Back to Christian Jam Time</a></div>
    </section>
  </main>;
}
