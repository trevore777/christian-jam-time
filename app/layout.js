import './globals.css';

export const metadata = {
  title: 'Christian Jam Time',
  description: 'Meet online, choose worship songs, share playlists and play together.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
