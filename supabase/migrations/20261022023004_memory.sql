-- Ask MOOV memory schema (design doc 6.2, 005_memory). No vector extension. No names, no result rows.

create schema memory;

create table memory.episodes (
  id bigint generated always as identity primary key,
  role text not null,
  question_templated text not null,
  plan jsonb not null,
  metrics text[] not null,
  shape text not null,
  critique jsonb,
  score int not null default 1,
  schema_version text not null,
  git_sha text,
  created_at timestamptz not null default now()
);
create index episodes_metrics on memory.episodes using gin (metrics);
create index episodes_question_trgm on memory.episodes using gin (question_templated extensions.gin_trgm_ops);
create index episodes_role_score on memory.episodes (role, score);
comment on table memory.episodes is 'Plans that worked, keyed by metrics and shape. question_templated has every entity replaced by {student}, {section}, {teacher}, {room}, {date_range}. Never stores names or rows.';

create table memory.episode_feedback (
  id bigint generated always as identity primary key,
  episode_id bigint not null references memory.episodes (id) on delete cascade,
  run_id uuid not null,
  user_id int not null,
  vote smallint not null check (vote in (1, -1)),
  created_at timestamptz not null default now()
);
create index episode_feedback_episode on memory.episode_feedback (episode_id);

create table memory.domain_notes (
  topic text primary key,
  text text not null
);
comment on table memory.domain_notes is 'Curated domain knowledge loaded into the planner prompt. Changes only by migration. This is not memory the agent writes.';

create table memory.schema_examples (
  id bigint generated always as identity primary key,
  view_name text not null,
  question text not null,
  spec jsonb not null,
  sql text
);

insert into memory.domain_notes (topic, text) values
  ('taps', 'A tap on a classroom reader has no intrinsic direction. First tap of the period marks present. A tap while present starts a pass. A tap while out ends the pass. Direction is derived by the backend.'),
  ('exit_taps', 'Kiosks can record exits when set to an exit mode, but this school does not use one. The only departure events are pass tap-outs on classroom readers. "Who has left" is inferred from the absence of later taps and must be labeled inferred.'),
  ('kiosk_location', 'A kiosk''s location is set on its screen by staff. taps.location_id is the kiosk''s location at tap time. Treat it as authoritative.'),
  ('one_active_card', 'Only one ID is active per student at a time. Issuing a temp ID deactivates the permanent card. "Two active cards" cannot occur; use temp_id_count and active_card_type instead.'),
  ('bathroom', 'Bathroom passes default to the nearest bathroom and have no destination tap. Destination is assumed, not verified.'),
  ('attendance', 'attendance_rate = attended (present or tardy) / scheduled meetings for the student in that section over the range. Scheduled meetings come from school_calendar and the section''s period.'),
  ('tardy', 'Entry tardy = kiosk tap after first bell + 5 minute grace. Period tardy = classroom tap more than 5 minutes after period start.'),
  ('manual', 'attendance.source = manual means the teacher changed the status while saving. A manual absent after a tap means the teacher did not see the student in the room.'),
  ('devices', 'If a device has no online heartbeat for a window, taps in that window are missing, not absent. Always check v_device_uptime for the room and window before interpreting a gap as absences.'),
  ('scope', 'Teachers see their rosters and sections. Admins see their school. Super admins see all schools. Results are already filtered by the database; do not re-filter by role.'),
  ('ab_day', 'The school runs an A/B rotation. Period numbers are the same on both; room assignments can differ.'),
  ('now', '"Now" for live questions is the frozen timestamp given in the prompt (analytics.frozen_now() in SQL), not the wall clock.'),
  ('timezone', 'All timestamps are school local time stored as UTC. 07:52 in the data means 7:52 in the morning at school.'),
  ('history', 'v_my_history is what the current user asked before, across threads. It is recall, not evidence about a student. "This student" with no name resolves from history or asks; it is never guessed.');

insert into memory.schema_examples (view_name, question, spec) values
  ('v_passes', 'How many bathroom passes did {student} take {date_range}?', '{"metric":"pass_count","entity":{"type":"student","id":"<id>"},"filters":{"destination":"bathroom"},"time_range":{"start":"<start>","end":"<end>"}}'),
  ('v_attendance_daily', 'What is the attendance rate in {section} {date_range}?', '{"metric":"attendance_rate","entity":{"type":"section","id":"<id>"},"time_range":{"start":"<start>","end":"<end>"}}'),
  ('v_tardies', 'Tardies week over week for {student} since September', '{"metric":"tardy_count","entity":{"type":"student","id":"<id>"},"time_range":{"start":"<start>","end":"<end>"},"group_by":["week"]}'),
  ('v_passes', 'Top 10 students by minutes out of class {date_range}', '{"metric":"out_minutes","time_range":{"start":"<start>","end":"<end>"},"group_by":["student"],"order":{"by":"value","dir":"desc"},"limit":10}'),
  ('v_entry', 'When does the morning rush hit the entrance?', '{"metric":"entry_count","time_range":{"start":"<start>","end":"<end>"},"group_by":["minute_bucket"]}'),
  ('v_presence', 'Who was in the gym at 2:10 today?', '{"metric":"who_was_where","filters":{"location":"Gym"},"time_point":"<today>T14:10:00Z","time_range":{"start":"<today>","end":"<today>"}}'),
  ('v_device_uptime', 'Was the Room 214 reader online during 3rd period on October 6?', '{"metric":"device_uptime","entity":{"type":"room","id":"<id>"},"time_range":{"start":"2026-10-06","end":"2026-10-06"},"group_by":["hour_bucket"]}'),
  ('v_attendance_daily', 'How many more classes does {student} need to reach 90% in {section}? (two spec steps then calc classes_to_target with attended=$a.value, scheduled=$b.value, target=0.9)', '{"metric":"present_count","entity":{"type":"student","id":"<id>"},"time_range":{"start":"<start>","end":"<end>"}}');
