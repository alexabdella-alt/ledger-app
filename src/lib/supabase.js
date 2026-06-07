import { createClient } from "@supabase/supabase-js";

// Prefer Vercel/Vite environment variables; fall back to the known public
// values so local builds and existing deploys keep working. The anon key is
// public by design (RLS is the real boundary) — set VITE_SUPABASE_* in Vercel.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://hhhuvoycumjzcjbawwff.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoaHV2b3ljdW1qemNqYmF3d2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTM0MDQsImV4cCI6MjA4ODY4OTQwNH0.y5zZcLmdhO-o3D30tnfrU6DzmSeg-Tq_IuC628zT0kQ";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Module-level auth token — updated whenever session changes
let _authToken = "";
supabase.auth.onAuthStateChange((_event, session) => {
  _authToken = session?.access_token || "";
});
supabase.auth.getSession().then(({ data: { session } }) => {
  _authToken = session?.access_token || "";
});

function getAuthHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${_authToken}`
  };
}


export { supabase, getAuthHeaders };
