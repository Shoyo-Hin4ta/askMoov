-- Raw event tables are not stored in the demo database.
-- Since 20261022042530 (derived_presence_device_hours) and 20261022043532 (denormalize_derived) every analytics view
-- reads the derived tables: presence_events, entry_events, device_hours. public.taps and public.device_heartbeats had
-- no reader left and held 329 MB of the database's 690 MB. The free plan quota is 500 MB; the platform's read-only
-- guard fired after the 2026-10-22 reseed (no write succeeded 14:19-14:28 UTC, see docs/sessions/2026-10-22.md).
-- The seed stops writing both tables in the same change; it already derives the stored rows in memory.
-- In production the ingest job that derives tap direction maintains the derived tables; the raw tap stream lives in
-- the operational store, not in the analytics database.
-- Plain DROP, no CASCADE: if anything still depends on either table, this migration must fail rather than drop a view.

drop table public.device_heartbeats;
drop table public.taps;
