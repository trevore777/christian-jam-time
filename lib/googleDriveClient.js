// Browser-only Google Identity Services token flow: no refresh token or OAuth secret is stored.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Christian Jam Time - Practice Recordings';
let loader;
let client;
let token = null;
let expiration = 0;
function googleReady() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Google Drive requires a browser.'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!loader) loader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => window.google?.accounts?.oauth2 ? resolve() : reject(new Error('Google login did not load.'));
    script.onerror = () => reject(new Error('Google login could not load. Check your connection.'));
    document.head.appendChild(script);
  });
  return loader;
}
export async function connectDrive() {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('Google Drive is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID and rebuild.');
  await googleReady();
  if (token && Date.now() < expiration - 60000) return token;
  return new Promise((resolve, reject) => {
    if (!client) client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE, callback: () => {}
    });
    client.callback = response => {
      if (response.error || !response.access_token) return reject(new Error(response.error_description || response.error || 'Google sign-in was cancelled.'));
      token = response.access_token;
      expiration = Date.now() + (Number(response.expires_in) || 3600) * 1000;
      resolve(token);
    };
    client.error_callback = () => reject(new Error('Google sign-in was closed or blocked. Try opening this page directly in Safari or Chrome.'));
    client.requestAccessToken({ prompt: token ? '' : 'consent' });
  });
}
export function disconnectDrive() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => {});
  token = null; expiration = 0;
}
export function driveConnected() { return Boolean(token && Date.now() < expiration - 60000); }
async function requestDrive(url, options = {}, accessToken) {
  const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: 'Bearer ' + accessToken } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body.error?.message || ('Google Drive returned ' + response.status);
    if (response.status === 401) { token = null; expiration = 0; }
    throw new Error(message);
  }
  return response.json();
}
async function folder(accessToken) {
  const query = encodeURIComponent("name = '" + FOLDER_NAME + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const found = await requestDrive('https://www.googleapis.com/drive/v3/files?q=' + query + '&fields=files(id,name)&pageSize=20', {}, accessToken);
  if (found.files?.[0]?.id) return found.files[0].id;
  const created = await requestDrive('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  }, accessToken);
  return created.id;
}
export async function uploadPractice({ blob, filename }) {
  // Only files the user explicitly saves are uploaded. Keep local copy after upload.
  const accessToken = await connectDrive();
  const parent = await folder(accessToken);
  const boundary = 'cjt_' + crypto.randomUUID();
  const metadata = { name: filename, parents: [parent], mimeType: blob.type.split(';')[0] || 'audio/webm' };
  const body = new Blob([
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    '\r\n--' + boundary + '\r\nContent-Type: ' + metadata.mimeType + '\r\n\r\n',
    blob,
    '\r\n--' + boundary + '--'
  ]);
  const created = await requestDrive('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
  }, accessToken);
  return { id: created.id, url: created.webViewLink || ('https://drive.google.com/file/d/' + encodeURIComponent(created.id) + '/view') };
}
