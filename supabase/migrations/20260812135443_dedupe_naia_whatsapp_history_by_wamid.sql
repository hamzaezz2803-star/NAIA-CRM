alter table public.naia_private_whatsapp_messages
  add column if not exists wamid text;

alter table public.naia_private_whatsapp_messages
  add constraint naia_private_whatsapp_messages_wamid_length_check
  check (wamid is null or char_length(wamid) between 1 and 512);

create unique index if not exists naia_private_whatsapp_messages_wamid_idx
  on public.naia_private_whatsapp_messages (wamid);
