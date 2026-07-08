/** Jurisdictions available in the top-bar country selector. */
export interface Country {
  code: string; // ISO 3166-1 alpha-2 (drives the flag image)
  name: string;
  law: string;
}

export const COUNTRIES: Country[] = [
  { code: 'US', name: 'США', law: 'US law' },
  { code: 'GB', name: 'Великобритания', law: 'UK law' },
  { code: 'DE', name: 'Германия', law: 'German law' },
  { code: 'CA', name: 'Канада', law: 'Canadian law' },
  { code: 'KZ', name: 'Казахстан', law: 'Kazakh law' },
  { code: 'UZ', name: 'Узбекистан', law: 'Uzbek law' },
  { code: 'AE', name: 'ОАЭ', law: 'UAE law' },
];

/** Per-flag crop tuning so round flags stay centered on their emblem. */
export const FLAG_OBJECT_POSITION: Record<string, string> = {
  UZ: '15% 32%',
  US: '15% center',
};

export const flagUrl = (code: string) => `https://flagcdn.com/w160/${code.toLowerCase()}.png`;
