export interface ShowInfo {
  name: string;
  city: string;
  country: string;
  industry?: string;
}

export const VERIFIED_SHOWS: ShowInfo[] = [
  { name: 'Interpack', city: 'Düsseldorf', country: 'Germany', industry: 'Packaging' },
  { name: 'Arab Health', city: 'Dubai', country: 'UAE', industry: 'Healthcare' },
  { name: 'ISE', city: 'Barcelona', country: 'Spain', industry: 'AV/Technology' },
  { name: 'Intersolar Europe', city: 'Munich', country: 'Germany', industry: 'Solar/Energy' },
  { name: 'SNEC', city: 'Shanghai', country: 'China', industry: 'Solar/Energy' },
  { name: 'Hannover Messe', city: 'Hannover', country: 'Germany', industry: 'Industrial' },
  { name: 'MEDICA', city: 'Düsseldorf', country: 'Germany', industry: 'Medical' },
  { name: 'SIAL Paris', city: 'Paris', country: 'France', industry: 'Food' },
  { name: 'Gulfood', city: 'Dubai', country: 'UAE', industry: 'Food' },
];

export function validateShow(showName: string): { valid: boolean; match: ShowInfo | null; confidence: 'HIGH' | 'MEDIUM' | 'LOW' } {
  // Exact match
  const exact = VERIFIED_SHOWS.find(s => s.name.toLowerCase() === showName.toLowerCase());
  if (exact) return { valid: true, match: exact, confidence: 'HIGH' };

  // Fuzzy match — check if the show name contains a verified show name or vice versa
  const fuzzy = VERIFIED_SHOWS.find(s =>
    s.name.toLowerCase().includes(showName.toLowerCase()) ||
    showName.toLowerCase().includes(s.name.toLowerCase())
  );
  if (fuzzy) return { valid: true, match: fuzzy, confidence: 'MEDIUM' };

  return { valid: false, match: null, confidence: 'LOW' };
}
