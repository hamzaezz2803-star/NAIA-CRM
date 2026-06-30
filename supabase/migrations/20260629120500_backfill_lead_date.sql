-- Migration to backfill lead_date from next_action_date for legacy leads
UPDATE public.crm_leads
SET lead_date = next_action_date
WHERE lead_date IS NULL AND next_action_date IS NOT NULL;
