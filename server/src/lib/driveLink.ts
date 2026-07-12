/**
 * Google Drive share-link parsing for the cookie-free import fallback.
 * The embedded Google Picker needs third-party cookies (blocked in Safari /
 * incognito); pasting a "anyone with the link" URL works everywhere and still
 * matches the drive.file philosophy — we only ever touch files the user chose.
 */

export interface DriveLink {
  id: string;
  /** Google Doc (needs export to .docx) vs a regular binary file. */
  kind: 'doc' | 'file';
}

const ID = /^[\w-]{10,}$/;

export function parseDriveLink(url: string): DriveLink | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.hostname === 'drive.google.com') {
    const m = u.pathname.match(/\/file\/d\/([\w-]{10,})/);
    if (m) return { id: m[1], kind: 'file' };
    const id = u.searchParams.get('id');
    if ((u.pathname.startsWith('/open') || u.pathname.startsWith('/uc')) && id && ID.test(id)) {
      return { id, kind: 'file' };
    }
    return null;
  }
  if (u.hostname === 'docs.google.com') {
    const m = u.pathname.match(/\/document\/d\/([\w-]{10,})/);
    if (m) return { id: m[1], kind: 'doc' };
    return null;
  }
  return null;
}

/** File name from a Content-Disposition header ("attachment; filename=…"). */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]).trim() || null;
    } catch {
      /* fall through */
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() || null : null;
}
