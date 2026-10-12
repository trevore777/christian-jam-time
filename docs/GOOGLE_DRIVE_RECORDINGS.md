# Google Drive recording upload setup

Practice recordings remain in browser IndexedDB. Google Drive is an optional, user-initiated backup: connect, rename, click **Save to Google Drive**. No Google token is stored in Redis, localStorage, or the AWS server.

## Google Cloud configuration
1. Open Google Cloud Console and select/create a project.
2. Enable **Google Drive API**.
3. Configure Google Auth Platform / OAuth consent. Use External for personal Google accounts; add test users while the app is in Testing (Google may limit test tokens). Explain that recordings upload to the user's own Drive.
4. Create OAuth client ID of type **Web application**.
5. Add the exact production *origin*, such as `https://your-domain.example`, to **Authorized JavaScript origins**. Origin is scheme + host (+ port), **not** a path; use HTTPS.
6. Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID=...apps.googleusercontent.com` in the production application's `.env.local` (or actual environment source) and rebuild with `npm run build` because NEXT_PUBLIC variables are embedded at build time.
7. Restart **christian-jam** PM2 only after a successful build. Do not restart the signalling process.
8. On Mac and iPhone, test Connect, Rename, Save, Open in Drive. Popups must be permitted, and an OAuth test user must be allowed on the Google consent screen.

Uses browser Google Identity Services token model with scope `https://www.googleapis.com/auth/drive.file`. Tokens last for a limited time and users must reconnect after expiry or page reload. Files are uploaded to the **Christian Jam Time - Practice Recordings** folder in the Google account they selected. The app only has file scope for files it creates, not full access to Google Drive.

Failure never deletes the original local recording. Save to Drive can create an additional copy if clicked again; rename changes only the local name and does not rename an already-uploaded Google Drive copy.

Recording storage on the device is browser-local, so don't remove browser website data until Drive upload is checked.
