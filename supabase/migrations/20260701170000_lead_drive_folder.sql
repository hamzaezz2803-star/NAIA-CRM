-- Add drive_folder_url column to crm_leads
-- Stores the Google Drive folder link directly on the lead (not in notes)

alter table public.crm_leads
  add column if not exists drive_folder_url text;
