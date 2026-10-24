-- filters.location is a name; the compiler filters presence rows by it. Index it so a school-wide "visits to X by time" stays under the 5s cap.
create index presence_location_name_arrived on public.presence_events (location, arrived_at);
create index presence_kind_arrived on public.presence_events (location_kind, arrived_at);
