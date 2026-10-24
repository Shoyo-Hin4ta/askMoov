-- Ask MOOV durability and retention (design doc 6.2, 007_cron). No Database Webhooks.
-- Every minute: re-dispatch runs queued > 1 min or running with a heartbeat > 2 min by POSTing /api/worker through pg_net.
-- APP_URL and WORKER_SECRET live in Supabase Vault (set by `npm run db:roles`), never in a migration.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
create extension if not exists pg_net; -- creates its own schema "net"

create function ops.redispatch() returns int
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
comment on function ops.redispatch() is 'Safety net for the worker ping. Idempotent: the worker claim UPDATE makes a duplicate dispatch a no-op.';

-- Retention: trace rows that can hold names or result rows expire after 30 days. runs and run_steps are kept.
create function ops.retention() returns void
language sql security definer set search_path = ''
as $$
  delete from ops.run_results where created_at < now() - interval '30 days';
  delete from ops.tool_calls where created_at < now() - interval '30 days';
  update ops.llm_calls set response_excerpt = null where created_at < now() - interval '30 days' and response_excerpt is not null;
$$;

select cron.schedule('redispatch', '* * * * *', $$select ops.redispatch()$$);
select cron.schedule('retention', '17 3 * * *', $$select ops.retention()$$);
