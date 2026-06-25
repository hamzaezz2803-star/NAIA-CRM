-- Migration to add lead_date column to crm_leads table
alter table public.crm_leads add column lead_date timestamptz;
comment on column public.crm_leads.lead_date is 'La date et heure détectée dans le message ou la phrase analysée';
