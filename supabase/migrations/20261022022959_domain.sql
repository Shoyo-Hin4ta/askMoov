-- Ask MOOV domain tables (design doc 6.2, 001_domain). Synthetic school tap data.
-- school_id is on every table so scope is always a predicate, never "no predicate".
-- All timestamps are school local time stored as UTC.

create extension if not exists pg_trgm with schema extensions;

create table public.schools (
  id int primary key,
  name text not null
);

create table public.school_calendar (
  school_id int not null references public.schools(id),
  date date not null,
  is_school_day boolean not null,
  ab_day text check (ab_day in ('A', 'B')),
  primary key (school_id, date)
);

create table public.bell_schedule (
  school_id int not null references public.schools(id),
  period int not null,
  starts_at time not null,
  ends_at time not null,
  primary key (school_id, period)
);

create table public.rooms (
  id int primary key,
  school_id int not null references public.schools(id),
  name text not null,
  wing text,
  floor int,
  kind text not null check (kind in ('classroom', 'bathroom', 'cafeteria', 'gym', 'library', 'office', 'entrance', 'hallway', 'nurse', 'counselor'))
);

create table public.teachers (
  id int primary key,
  school_id int not null references public.schools(id),
  name text not null,
  email text not null
);

create table public.students (
  id int primary key,
  school_id int not null references public.schools(id),
  name text not null,
  grade int not null
);

create table public.cards (
  id int primary key,
  school_id int not null references public.schools(id),
  student_id int not null references public.students(id),
  type text not null check (type in ('permanent', 'temp')),
  status text not null check (status in ('active', 'lost', 'deactivated')),
  issued_at timestamptz not null
);

create table public.sections (
  id int primary key,
  school_id int not null references public.schools(id),
  teacher_id int not null references public.teachers(id),
  course text not null,
  period int not null,
  room_id int not null references public.rooms(id)
);

create table public.rosters (
  school_id int not null references public.schools(id),
  section_id int not null references public.sections(id),
  student_id int not null references public.students(id),
  primary key (section_id, student_id)
);

create table public.devices (
  id int primary key,
  school_id int not null references public.schools(id),
  type text not null check (type in ('reader', 'kiosk', 'handheld')),
  location_id int references public.rooms(id),
  status text not null default 'active'
);

create table public.device_heartbeats (
  school_id int not null references public.schools(id),
  device_id int not null references public.devices(id),
  ts timestamptz not null,
  online boolean not null,
  primary key (device_id, ts)
);

create table public.taps (
  id bigint generated always as identity primary key,
  school_id int not null references public.schools(id),
  device_id int not null references public.devices(id),
  location_id int references public.rooms(id),
  card_id int references public.cards(id),
  student_id int references public.students(id),
  ts timestamptz not null,
  direction text not null check (direction in ('in', 'out')),
  kind text not null check (kind in ('arrival', 'departure', 'pass_start', 'pass_end', 'check')),
  result text not null check (result in ('authorized', 'blocked', 'no_card'))
);

create table public.passes (
  id bigint generated always as identity primary key,
  school_id int not null references public.schools(id),
  student_id int not null references public.students(id),
  section_id int references public.sections(id),
  origin_room_id int references public.rooms(id),
  destination text not null check (destination in ('bathroom', 'nurse', 'office', 'library', 'counselor', 'other')),
  issuer text not null check (issuer in ('tap_out', 'teacher', 'handheld')),
  started_at timestamptz not null,
  ended_at timestamptz
);

create table public.attendance (
  school_id int not null references public.schools(id),
  section_id int not null references public.sections(id),
  date date not null,
  student_id int not null references public.students(id),
  status text not null check (status in ('present', 'absent', 'tardy')),
  source text not null check (source in ('tap', 'manual')),
  primary key (section_id, date, student_id)
);

-- Indexes from the design doc plus the columns RLS policies and the compiler filter on.
create index taps_student_ts on public.taps (student_id, ts);
create index taps_device_ts on public.taps (device_id, ts);
create index taps_location_ts on public.taps (location_id, ts);
create index taps_school_ts on public.taps (school_id, ts);
create index passes_student_started on public.passes (student_id, started_at);
create index passes_section_started on public.passes (section_id, started_at);
create index attendance_section_date on public.attendance (section_id, date);
create index attendance_student_date on public.attendance (student_id, date);
create index rosters_student on public.rosters (student_id);
create index sections_teacher on public.sections (teacher_id);
create index cards_student on public.cards (student_id);
create index students_name_trgm on public.students using gin (name extensions.gin_trgm_ops);
create index teachers_name_trgm on public.teachers using gin (name extensions.gin_trgm_ops);

comment on table public.taps is 'One row per card tap. location_id is copied from the device at tap time so history stays right if a kiosk is later moved.';
comment on column public.taps.kind is 'arrival, departure, pass_start, pass_end, check. A classroom reader tap has no intrinsic direction: first tap of the period marks present, a tap while present starts a pass, a tap while out ends it.';
comment on column public.attendance.source is 'tap = marked present by reader tap. manual = teacher changed the status when saving attendance.';
