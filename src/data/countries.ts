/** Jurisdictions available in the top-bar country selector. */
export interface Country {
  code: string; // ISO 3166-1 alpha-2 (drives the flag image)
  name: string;
  nameEn: string;
  /** Russian genitive ("по праву Великобритании") for law-context phrases. */
  nameGen: string;
  law: string;
}

/** Country display name in the interface language. */
export const countryName = (c: Country, lang: string) => (lang === 'ru' ? c.name : c.nameEn);

export const COUNTRIES: Country[] = [
  { code: 'US', name: 'США', nameEn: 'United States', nameGen: 'США', law: 'US law' },
  { code: 'GB', name: 'Великобритания', nameEn: 'United Kingdom', nameGen: 'Великобритании', law: 'UK law' },
  { code: 'DE', name: 'Германия', nameEn: 'Germany', nameGen: 'Германии', law: 'German law' },
  { code: 'CA', name: 'Канада', nameEn: 'Canada', nameGen: 'Канады', law: 'Canadian law' },
  { code: 'KZ', name: 'Казахстан', nameEn: 'Kazakhstan', nameGen: 'Казахстана', law: 'Kazakh law' },
  { code: 'UZ', name: 'Узбекистан', nameEn: 'Uzbekistan', nameGen: 'Узбекистана', law: 'Uzbek law' },
  { code: 'AE', name: 'ОАЭ', nameEn: 'UAE', nameGen: 'ОАЭ', law: 'UAE law' },
];

/** Per-flag crop tuning so round flags stay centered on their emblem. */
export const FLAG_OBJECT_POSITION: Record<string, string> = {
  UZ: '15% 32%',
  US: '15% center',
  // Keep the red hoist band inside the circular crop.
  AE: '12% center',
};

export const flagUrl = (code: string) => `https://flagcdn.com/w160/${code.toLowerCase()}.png`;
