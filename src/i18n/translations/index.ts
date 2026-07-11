/**
 * Extra interface languages beyond the RU/EN base held in ../messages.ts.
 * Each map is key → translated string; a missing key falls back to English.
 */
import ar from './ar';
import de from './de';
import kk from './kk';
import uz from './uz';

export const EXTRA: Record<string, Record<string, string>> = { ar, de, kk, uz };
