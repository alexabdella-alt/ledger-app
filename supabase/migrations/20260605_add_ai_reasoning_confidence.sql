-- Persist the AI's GL-coding rationale and confidence on each journal entry
-- so they survive a reload instead of showing "Loaded from database".
--
-- Run this in the Supabase dashboard SQL editor (or via `supabase db push`)
-- before deploying the matching app changes. persistJournalEntry falls back
-- to inserting without these columns if they are absent, so booking keeps
-- working in the meantime — but reasoning/confidence won't be saved until
-- this migration is applied.

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS ai_reasoning text;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS ai_confidence numeric;
