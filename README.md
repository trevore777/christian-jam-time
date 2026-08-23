# Christian Jam Time

Prototype web app for small online worship groups.

## Current features
- Start or join a Jam Room
- Name and instrument selection
- Shared worship-song catalogue structure
- Search by song title or number
- Add/remove songs from a session playlist
- Current-song view
- Key transposition controls
- Previous/next leader controls
- Responsive desktop/tablet/mobile layout
- Video-room placeholders ready for a later live video integration

## Run locally
```bash
npm install
npm run dev
```

## Production build
```bash
npm run build
npm start
```

## Next development stage
1. Import the complete cleaned songbook JSON.
2. Attach chord/lyric content from the original chord-songbook source.
3. Add server-backed Jam Rooms and live state synchronisation.
4. Add real video/audio conferencing.
5. Add accounts, favourites and scheduled Jam sessions.
