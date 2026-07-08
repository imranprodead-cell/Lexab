/**
 * Database types for Supabase.
 *
 * There are no tables in the project yet, so this is a typed placeholder.
 * Once you create tables, generate real types with the Supabase CLI:
 *
 *   npx supabase gen types typescript --project-id pnwtxzcaxtgyiclhabgb > src/lib/supabase/types.ts
 *
 * (or `--local` when developing against a local Supabase instance) and the
 * client in ./client.ts picks them up automatically.
 */
export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
