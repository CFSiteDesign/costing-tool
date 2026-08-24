import { createClient } from "@supabase/supabase-js";

// The URL and anon key are publishable values (they ship in every client bundle
// by design; RLS is the security boundary). Env vars override when present —
// the literals keep the build working regardless of hosting env config.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || "https://avftyexxqyykppzmrjxn.supabase.co",
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2ZnR5ZXh4cXl5a3Bwem1yanhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0OTgyNzAsImV4cCI6MjEwMzA3NDI3MH0.jmXCijjRJU3I6xtylc4mlFEWlGFhtyeUIiYT799zeQc",
);
