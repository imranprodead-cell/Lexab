/** Full-colour brand marks for the cloud integrations (Settings + import). */

interface LogoProps {
  size?: number;
}

export function GoogleDriveLogo({ size = 22 }: LogoProps) {
  return (
    <svg width={size} height={size * (78 / 87.3)} viewBox="0 0 87.3 78" aria-hidden="true" style={{ display: 'block' }}>
      <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00ac47" d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" />
      <path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" />
      <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="M59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  );
}

export function Microsoft365Logo({ size = 22 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 23 23" aria-hidden="true" style={{ display: 'block' }}>
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}

export function DropboxLogo({ size = 22 }: LogoProps) {
  return (
    <svg width={size} height={size * (43 / 50)} viewBox="0 0 50 43" aria-hidden="true" style={{ display: 'block' }}>
      <path
        fill="#0061ff"
        d="M12.5 0 25 8l-12.5 8L0 8zM37.5 0 50 8l-12.5 8L25 8zM0 24l12.5-8L25 24l-12.5 8zM37.5 16 50 24l-12.5 8L25 24zM12.5 34.7l12.5-8 12.5 8-12.5 8z"
      />
    </svg>
  );
}

export function BrandLogo({ provider, size = 22 }: { provider: 'google-drive' | 'microsoft' | 'dropbox'; size?: number }) {
  if (provider === 'google-drive') return <GoogleDriveLogo size={size} />;
  if (provider === 'microsoft') return <Microsoft365Logo size={size} />;
  return <DropboxLogo size={size} />;
}
