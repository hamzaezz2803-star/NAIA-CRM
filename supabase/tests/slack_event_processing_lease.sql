set local statement_timeout = '10s';

do $test$
declare
  event_id constant text := 'EvSlackLeaseFixture95';
  expired_event_id constant text := 'EvSlackLeaseExpired95';
  first_token constant uuid := '30000000-0000-0000-0000-000000000095';
  second_token constant uuid := '30000000-0000-0000-0000-000000000096';
  third_token constant uuid := '30000000-0000-0000-0000-000000000097';
  acquired boolean;
  replayed boolean;
  old_publisher boolean;
  new_publisher boolean;
  completed boolean;
begin
  select public.lease_slack_event(event_id, first_token, false, 30, 300)
  into acquired;
  select public.lease_slack_event(event_id, second_token, false, 30, 300)
  into replayed;
  if not acquired or replayed then
    raise exception 'Concurrent initial Slack lease was not deduplicated';
  end if;

  select public.lease_slack_event(event_id, second_token, true, 30, 300)
  into replayed;
  select public.begin_slack_event_publish(event_id, first_token)
  into old_publisher;
  select public.begin_slack_event_publish(event_id, second_token)
  into new_publisher;
  select public.complete_slack_event_publish(event_id, second_token)
  into completed;
  if not replayed or old_publisher or not new_publisher or not completed then
    raise exception 'Slack force takeover did not fence the stale worker';
  end if;

  select public.lease_slack_event(event_id, third_token, true, 30, 300)
  into replayed;
  if replayed then
    raise exception 'Completed Slack publication was reclaimable';
  end if;

  select public.lease_slack_event(
    expired_event_id, first_token, false, 30, 300
  ) into acquired;
  update public.slack_event_claims
  set lease_expires_at = now() - interval '1 second'
  where slack_event_claims.event_id = expired_event_id;
  select public.lease_slack_event(
    expired_event_id, third_token, false, 30, 300
  ) into replayed;
  if not acquired or not replayed then
    raise exception 'Expired pre-publish Slack lease was not reclaimable';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.begin_slack_event_publish(text,uuid)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.complete_slack_event_publish(text,uuid)',
    'execute'
  ) then
    raise exception 'Slack lease fencing RPC grants are too broad';
  end if;
end
$test$;
