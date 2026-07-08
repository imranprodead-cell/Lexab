/**
 * In-memory mock database.
 *
 * Seed data is cloned once at module load so the app can mutate it during a
 * session (accept redlines, send signature requests) without corrupting the
 * canonical seed. Reloading the page resets it — exactly the behaviour we want
 * from a stub backend.
 */
import {
  ANALYTICS,
  CHAT_SESSIONS,
  CURRENT_USER,
  DEMO_ANALYSIS,
  DOCUMENTS,
  SIGNATURES,
  TEMPLATES,
  VERSIONS,
} from '@/data/seed';
import { clone } from '../util';

export const db = {
  user: clone(CURRENT_USER),
  sessions: clone(CHAT_SESSIONS),
  analysis: clone(DEMO_ANALYSIS),
  documents: clone(DOCUMENTS),
  templates: clone(TEMPLATES),
  signatures: clone(SIGNATURES),
  versions: clone(VERSIONS),
  analytics: clone(ANALYTICS),
};

export type MockDb = typeof db;
