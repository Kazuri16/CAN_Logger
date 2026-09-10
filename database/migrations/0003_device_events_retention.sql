-- CAN Logger Dashboard - device_events retention.
-- Apply in the Supabase SQL editor or via `supabase db push` after
-- 0002_lock_down_handle_new_user_rpc.sql.
--
-- (Was 0002_device_events_retention.sql; renumbered to 0003 so the repo history
-- matches the cloud project, where 0002 is the handle_new_user RPC lockdown.)
--
-- device_events has no natural bound: the ESP32 inserts a row on every fault /
-- recovery transition and nothing prunes it. This caps the table at the newest
-- EVENTS_PER_DEVICE rows per device with an AFTER INSERT trigger, so a long-
-- running device cannot fill the project's storage quota. No pg_cron / extension
-- needed. Reads already cap at 100-200 rows, so trimming older history is safe.

begin;

create or replace function public.trim_device_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  events_per_device constant integer := 500;
begin
  delete from public.device_events e
  where e.device_id = new.device_id
    and e.id not in (
      select id
      from public.device_events
      where device_id = new.device_id
      order by received_at desc, id desc
      limit events_per_device
    );
  return null;
end;
$$;

drop trigger if exists device_events_retention on public.device_events;

create trigger device_events_retention
  after insert on public.device_events
  for each row
  execute function public.trim_device_events();

commit;
