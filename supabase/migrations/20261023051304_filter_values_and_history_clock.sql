-- 1. Allowed values of the enumerated columns, as column comments. The planner is told filter names and the Spec schema
--    enforces their values, but a model writing tier-3 SQL reads the view columns, and "destination (text)" said nothing.
--    Schema knowledge comes from migrations (principle 5): the schema document picks these up and schema_version changes once.
--    CREATE OR REPLACE VIEW keeps column comments as long as the column list is unchanged.
comment on column analytics.v_passes.destination is 'bathroom, nurse, office, library, counselor, other. Bathroom is assumed, not verified by a tap.';
comment on column analytics.v_passes.issuer is 'tap_out (the student tapped out on the classroom reader), teacher (teacher-created pass), handheld (staff handheld).';
comment on column analytics.v_passes.ab_day is 'A or B, the rotation day.';
comment on column analytics.v_attendance_daily.status is 'present, absent, tardy. Attended means present or tardy.';
comment on column analytics.v_attendance_daily.ab_day is 'A or B, the rotation day.';
comment on column analytics.v_presence.device_type is 'reader, kiosk, handheld.';
comment on column analytics.v_presence.location_kind is 'classroom, bathroom, cafeteria, gym, library, office, entrance, hallway, nurse, counselor.';
comment on column analytics.v_presence.left_by_kind is 'exit_tap and pass_tap_out are measured departures; next_arrival and end_of_day are inferred.';
comment on column analytics.v_device_uptime.device_type is 'reader, kiosk, handheld.';
comment on column analytics.v_entry.result is 'authorized, blocked, no_card.';
comment on column analytics.v_tardies.kind is 'entry (late to the building) or period (late to class).';
comment on column analytics.v_cards.type is 'permanent or temp.';
comment on column analytics.v_cards.status is 'active, lost, deactivated.';
comment on column analytics.v_cards.active_card_type is 'permanent or temp: the type of the student''s currently active card.';
comment on column analytics.v_entities.type is 'student, teacher, section, room, wing, school.';

-- 2. Two clocks. Data lives on the frozen timeline (2026-10-13 10:40). History (ops.runs.created_at) is stamped in real
--    time, so "what did I ask last week" resolved against the frozen now could never match a row. resolve_dates now takes
--    clock = history for those phrases; the domain note and the column comment say so.
comment on column analytics.v_my_history.asked_at is 'Real clock: when the question was asked. Not the frozen data timeline.';
update memory.domain_notes
   set text = text || ' History rows are stamped with the real clock, not the frozen data timeline, and span every calendar day: resolve their date phrases with clock = history.'
 where topic = 'history';
