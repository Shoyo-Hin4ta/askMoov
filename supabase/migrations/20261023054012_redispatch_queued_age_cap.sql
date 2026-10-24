-- A run that is queued but never claimed stays queued forever: attempt only increments on a claim, so the
-- "attempts exhausted" rule never fires, and ops.redispatch() re-POSTs it every minute (three such runs sat 15-23 hours,
-- POSTed to a localhost APP_URL that Supabase cannot reach). Fail a run that nobody claims within 10 minutes of being
-- queued: that is ten dispatch attempts. Everything else in the function is unchanged.

create or replace function ops.redispatch() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  app_url text;
  secret text;
  n int := 0;
  r record;
begin
  select decrypted_secret into app_url from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'worker_secret';
  if app_url is null or secret is null then
    raise warning 'ops.redispatch: vault secrets app_url / worker_secret are missing';
    return 0;
  end if;

  -- a worker that stopped heartbeating is dead: back to the queue, or failed after 3 attempts
  update ops.runs set status = 'queued', queued_at = now()
   where status = 'running' and heartbeat_at < now() - interval '2 minutes' and attempt < 3;
  update ops.runs set status = 'failed', finished_at = now(), error = 'attempts exhausted: worker stopped heartbeating'
   where status = 'running' and heartbeat_at < now() - interval '2 minutes' and attempt >= 3;
  update ops.runs set status = 'failed', finished_at = now(), error = 'attempts exhausted'
   where status = 'queued' and attempt >= 3;
  -- nobody claimed it in ten dispatch attempts: the worker URL is unreachable or the worker is down
  update ops.runs set status = 'failed', finished_at = now(), error = 'not claimed within 10 minutes of being queued'
   where status = 'queued' and queued_at < now() - interval '10 minutes';

  for r in select id from ops.runs where status = 'queued' and queued_at < now() - interval '1 minute' and attempt < 3 loop
    perform net.http_post(
      url := app_url || '/api/worker',
      body := jsonb_build_object('run_id', r.id),
      headers := jsonb_build_object('content-type', 'application/json', 'x-worker-secret', secret)
    );
    n := n + 1;
  end loop;
  return n;
end
$$;
comment on function ops.redispatch() is 'Safety net for the worker ping. Idempotent: the worker claim UPDATE makes a duplicate dispatch a no-op. A run nobody claims within 10 minutes is failed.';
