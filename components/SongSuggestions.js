'use client';

export default function SongSuggestions({ suggestions = [], leader = false, onResolve }) {
  if (!suggestions.length) {
    return <section className="card"><div className="sectionHeading"><div><small>SONG SUGGESTIONS</small><h2>Suggestions</h2></div><span>0 waiting</span></div><p className="hint">Other participants can suggest songs from the master songbook. Suggestions will appear here for the leader to review.</p></section>;
  }

  return <section className="card">
    <div className="sectionHeading"><div><small>SONG SUGGESTIONS</small><h2>Suggestions</h2></div><span>{suggestions.length} waiting</span></div>
    <div style={{ display: 'grid', gap: 10 }}>
      {suggestions.map(item => <div key={item.id} style={{ border: '1px solid #e1d5bf', borderRadius: 14, padding: 12, display: 'grid', gap: 8 }}>
        <div><b>{item.song.number}. {item.song.title}</b><div style={{ fontSize: 13, opacity: .72, marginTop: 3 }}>Suggested by {item.suggestedBy?.name || 'Participant'} · {item.suggestedBy?.instrument || 'Other'}</div></div>
        {leader ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="primary" type="button" onClick={() => onResolve(item.id, 'approve')}>Add to Playlist</button>
          <button className="secondary" type="button" onClick={() => onResolve(item.id, 'dismiss')}>Dismiss</button>
        </div> : <div className="hint">Waiting for the leader to review.</div>}
      </div>)}
    </div>
  </section>;
}
