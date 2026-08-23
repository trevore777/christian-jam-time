'use client';

import { useState } from 'react';

export default function SongbookImporter({ onImported }) {
  const [catalogFile, setCatalogFile] = useState(null);
  const [detailFile, setDetailFile] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function importFiles() {
    if (!catalogFile || !detailFile) return setStatus('Select both JSON files first.');
    setBusy(true); setStatus('Reading and merging songbooks…');
    try {
      const [catalog, detailed] = await Promise.all([
        catalogFile.text().then(JSON.parse),
        detailFile.text().then(JSON.parse),
      ]);
      const response = await fetch('/api/songbook/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalog, detailed }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Import failed.');
      setStatus(`Imported ${payload.count} songs. ${payload.withChordSheets} have chord sheets ready.`);
      await onImported?.();
    } catch (error) {
      setStatus(error.message || 'Unable to import the songbook.');
    } finally { setBusy(false); }
  }

  return <div style={{maxWidth:760,margin:'26px auto 0',padding:18,border:'1px solid #ded6c5',borderRadius:16,background:'rgba(255,253,248,.88)',textAlign:'left'}}>
    <b style={{display:'block',marginBottom:5}}>One-time songbook setup</b>
    <span style={{display:'block',fontSize:13,color:'#6f786f',lineHeight:1.5,marginBottom:14}}>Select <b>songs.json</b> for the full catalogue and <b>swiftui-songs.json</b> for the detailed ChordPro songs. Christian Jam Time will merge them into one shared master list.</span>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:10}}>
      <label style={{fontSize:12,fontWeight:800}}>Full catalogue<input type="file" accept="application/json,.json" onChange={e => setCatalogFile(e.target.files?.[0] || null)} style={{display:'block',width:'100%',marginTop:5}} /></label>
      <label style={{fontSize:12,fontWeight:800}}>ChordPro export<input type="file" accept="application/json,.json" onChange={e => setDetailFile(e.target.files?.[0] || null)} style={{display:'block',width:'100%',marginTop:5}} /></label>
    </div>
    <button className="primary" type="button" disabled={busy || !catalogFile || !detailFile} onClick={importFiles} style={{marginTop:14}}>{busy ? 'Importing…' : 'Build Master Songbook'}</button>
    {status && <div style={{fontSize:12,fontWeight:700,marginTop:10,color:'#2c7c49'}}>{status}</div>}
  </div>;
}
