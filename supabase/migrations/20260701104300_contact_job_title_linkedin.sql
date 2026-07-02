-- Add contact_job_title and contact_linkedin_url to crm_leads
-- Add linkedin_url to crm_contacts

alter table public.crm_leads
  add column if not exists contact_job_title text,
  add column if not exists contact_linkedin_url text;

alter table public.crm_contacts
  add column if not exists linkedin_url text;
