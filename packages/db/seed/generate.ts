/**
 * Deterministic seed. `npm run seed -- --seed 42 --scale 1 [--no-stories]`
 * Two schools, 40 school days ending on the frozen now (Tue 2026-10-13 10:40, 3rd period in progress).
 * Design doc section 7. Same seed, same rows.
 * Taps are generated in memory and stored only in derived form (presence_events, entry_events, device_hours, passes, attendance).
 * Nothing reads raw taps or heartbeats; the two raw tables held half the database (migration 20261023034510 dropped them).
 */
import { getAdminPool } from "../src/index";
import { BELLS, FIRST_BELL, FROZEN_NOW, HEARTBEAT_MINUTES, PASS_MINUTES, RATES, SCHOOL_CLOSE, SCHOOL_DAYS, SCHOOL_OPEN, SCHOOLS, type SchoolConfig } from "./config";
import { CANON_STUDENTS as C, CANON_TEACHERS as T, COURSES, uniqueNames } from "./names";
import { Rng } from "./rng";
import { Stories, type Day } from "./stories";
import { TableWriter } from "./writer";

type Args = { seed: number; scale: number; stories: boolean };
function parseArgs(argv: string[]): Args {
  const a: Args = { seed: 42, scale: 1, stories: true };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    if (v === "--seed") a.seed = Number(argv[++i]);
    else if (v === "--scale") a.scale = Number(argv[++i]);
    else if (v === "--no-stories") a.stories = false;
    else throw new Error(`unknown argument ${v}`);
  }
  if (!Number.isFinite(a.seed) || !(a.scale > 0)) throw new Error("bad --seed or --scale");
  return a;
}

/* ---------- time ---------- */
const DAY_MS = 86_400_000;
function isoDow(d: Date): number { return ((d.getUTCDay() + 6) % 7) + 1; }
function at(date: string, minute: number): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, Math.floor(minute / 60), Math.floor(minute % 60), Math.round((minute % 1) * 60)));
}
function schoolDays(): Day[] {
  const out: Day[] = [];
  let d = new Date(FROZEN_NOW.date + "T00:00:00Z");
  while (out.length < SCHOOL_DAYS) {
    const dow = isoDow(d);
    if (dow <= 5) out.unshift({ idx: 0, date: d.toISOString().slice(0, 10), dow, ab: "A", week: 0 });
    d = new Date(d.getTime() - DAY_MS);
  }
  const first = new Date(out[0]!.date + "T00:00:00Z");
  const firstMonday = new Date(first.getTime() - (isoDow(first) - 1) * DAY_MS);
  out.forEach((day, i) => {
    day.idx = i;
    day.week = Math.floor((new Date(day.date + "T00:00:00Z").getTime() - firstMonday.getTime()) / (7 * DAY_MS)); // calendar week
    day.ab = i % 2 === 0 ? "A" : "B";
  });
  return out;
}

/* ---------- model ---------- */
type Room = { id: number; name: string; wing: string | null; floor: number; kind: string; reader: number | null };
type Teacher = { id: number; name: string; roomId: number };
type Section = { id: number; teacherId: number; course: string; period: number; roomId: number };
type Student = { id: number; name: string; grade: number; sections: Map<number, Section>; permanentCard: number; tempCards: { id: number; issued: string }[]; bus: boolean };
type Device = { id: number; type: "reader" | "kiosk" | "handheld"; locationId: number | null };

type School = {
  cfg: SchoolConfig;
  rooms: Room[];
  roomById: Map<number, Room>;
  teachers: Teacher[];
  sections: Section[];
  students: Student[];
  devices: Device[];
  entrances: Room[];
  hallways: Room[];
  readerOf: Map<number, number>; // roomId -> device id
};

function buildSchool(cfg: SchoolConfig, rng: Rng, stories: Stories, scale: number): School {
  const r = rng.fork(`school-${cfg.id}`);
  const p = cfg.prefix;
  const rooms: Room[] = [];
  let deviceId = cfg.deviceIdBase;
  const devices: Device[] = [];
  const readerOf = new Map<number, number>();
  const addRoom = (name: string, wing: string | null, floor: number, kind: string, withReader: boolean): Room => {
    const room: Room = { id: cfg.roomIdBase + rooms.length, name, wing, floor, kind, reader: null };
    if (withReader) { room.reader = deviceId; devices.push({ id: deviceId++, type: "reader", locationId: room.id }); readerOf.set(room.id, room.reader); }
    rooms.push(room);
    return room;
  };
  const classroomCount = Math.max(8, Math.round(cfg.classrooms * scale));
  for (let i = 0; i < classroomCount; i++) {
    const floor = i < cfg.classrooms / 2 ? 1 : 2;
    const number = floor === 1 ? 101 + i : 201 + (i - cfg.classrooms / 2);
    const wing = (i % (cfg.classrooms / 2)) < cfg.classrooms / 4 ? "East" : "West";
    addRoom(`${p}${number}`, wing, floor, "classroom", true);
  }
  for (const [w, f] of [["East", 1], ["West", 1], ["East", 2], ["West", 2]] as const) addRoom(`${p}Bathroom ${w[0]}${f}`, w, f, "bathroom", false);
  const cafeteria = addRoom(`${p}Cafeteria`, null, 1, "cafeteria", false);
  const gym = addRoom(`${p}Gym`, null, 1, "gym", false);
  const library = addRoom(`${p}Library`, null, 1, "library", true);
  const office = addRoom(`${p}Main Office`, null, 1, "office", true);
  addRoom(`${p}Nurse`, null, 1, "nurse", true);
  addRoom(`${p}Counselor`, null, 1, "counselor", true);
  const entrances = [addRoom(`${p}Entrance 1 (Main)`, null, 1, "entrance", false)];
  if (cfg.kiosks >= 5) entrances.push(addRoom(`${p}Entrance 2 (Bus Loop)`, null, 1, "entrance", false));
  const hallways = [addRoom(`${p}Hallway East`, "East", 1, "hallway", false), addRoom(`${p}Hallway West`, "West", 1, "hallway", false)];
  for (const e of entrances) devices.push({ id: deviceId++, type: "kiosk", locationId: e.id });
  for (const k of [cafeteria, gym, office].slice(0, cfg.kiosks - entrances.length)) {
    devices.push({ id: deviceId, type: "kiosk", locationId: k.id });
    if (k === gym) readerOf.set(gym.id, deviceId); // the gym has no reader: its kiosk records arrivals for PE sections
    deviceId++;
  }
  for (let i = 0; i < cfg.handhelds; i++) devices.push({ id: deviceId++, type: "handheld", locationId: hallways[i % 2]!.id });
  void library;

  const taken = new Set<string>();
  const teacherCount = Math.max(cfg.id === 1 ? 17 : 4, Math.round(cfg.teachers * scale));
  const teacherNames = uniqueNames(r, teacherCount, taken);
  const classrooms = rooms.filter((x) => x.kind === "classroom");
  const teachers: Teacher[] = teacherNames.map((name, i) => ({ id: cfg.teacherIdBase + i, name, roomId: classrooms[i % classrooms.length]!.id }));
  if (cfg.id === 1) {
    teachers[T.krabappel.id - 1]!.name = T.krabappel.name;
    teachers[T.hoover.id - 1]!.name = T.hoover.name;
  }

  const sections: Section[] = [];
  const injection = cfg.id === 2 ? stories.injectionCourseName() : null;
  const fixedPeriods: Record<number, number[]> = cfg.id === 1 ? { [T.krabappel.id]: [1, 2, 4, 6, 7], [T.hoover.id]: [2, 3, 5, 6, 8] } : {};
  for (const t of teachers) {
    const course = r.pick(COURSES);
    // PE meets in the gym where the gym has a device (Springfield). Room 214 stays a classroom: story 6 drops taps there.
    const inGym = course === "Physical Education" && readerOf.has(gym.id) && rooms.find((x) => x.id === t.roomId)?.name !== `${p}214`;
    const roomId = inGym ? gym.id : t.roomId;
    // the Room 214 teacher always teaches 3rd period, so story 6's outage (9:50-10:20 on Oct 6 and 8) drops real classroom taps
    const in214 = rooms.find((x) => x.id === t.roomId)?.name === `${p}214`;
    const periods = fixedPeriods[t.id] ?? (in214 ? [3, ...r.sample([1, 2, 4, 5, 6, 7, 8], 4)] : r.sample([1, 2, 3, 4, 5, 6, 7, 8], 5)).sort((a, b) => a - b);
    for (const period of periods) {
      sections.push({ id: cfg.sectionIdBase + sections.length, teacherId: t.id, course, period, roomId });
    }
  }
  if (injection && sections.length) sections[sections.length - 1]!.course = injection;
  const byPeriod = new Map<number, Section[]>();
  for (const s of sections) byPeriod.set(s.period, [...(byPeriod.get(s.period) ?? []), s]);
  const sectionOf = (teacherId: number, period: number) => sections.find((s) => s.teacherId === teacherId && s.period === period);

  const studentCount = Math.max(20, Math.round(cfg.students * scale));
  const canon = cfg.id === 1 ? Object.values(C) : [];
  for (const c of canon) taken.add(c.name);
  const genericNames = uniqueNames(r, studentCount, taken);
  const students: Student[] = genericNames.map((name, i) => ({ id: cfg.studentIdBase + i, name, grade: r.int(9, 12), sections: new Map(), permanentCard: 0, tempCards: [], bus: false }));
  for (const c of canon) {
    const existing = students.find((s) => s.id === c.id);
    if (existing) { existing.name = c.name; existing.grade = c.grade; }
    else students.push({ id: c.id, name: c.name, grade: c.grade, sections: new Map(), permanentCard: 0, tempCards: [], bus: false });
  }
  const pin = (studentId: number, section: Section | undefined) => { if (section) students.find((s) => s.id === studentId)!.sections.set(section.period, section); };
  if (cfg.id === 1) {
    const kr = T.krabappel.id, ho = T.hoover.id;
    const krP4 = sectionOf(kr, 4) ?? sectionOf(kr, [...(byPeriod.keys())][0]!);
    pin(C.bartSimpson.id, krP4);
    pin(C.ralph.id, sectionOf(kr, 1) ?? sections.find((s) => s.teacherId === kr));
    pin(C.lisa.id, sectionOf(ho, 2) ?? sections.find((s) => s.teacherId === ho));
    const p3 = (byPeriod.get(3) ?? []).filter((s) => s.teacherId !== kr);
    const a = p3[0], b = p3.find((s) => s.roomId !== a?.roomId);
    pin(C.nelson.id, a); pin(C.jimbo.id, b);
    pin(C.milhouse.id, (byPeriod.get(4) ?? []).find((s) => s.teacherId !== kr));
  }
  for (const st of students) {
    const free = r.int(1, 8);
    for (let period = 1; period <= 8; period++) {
      if (period === free || st.sections.has(period)) continue;
      const choices = (byPeriod.get(period) ?? []).filter((s) => !(cfg.id === 1 && (st.id === C.bartReyes.id || st.id === C.nelson.id || st.id === C.jimbo.id) && s.teacherId === T.krabappel.id));
      if (choices.length) st.sections.set(period, r.pick(choices));
    }
    st.permanentCard = st.id * 10;
    for (const [i, issued] of stories.martinTempCardDates(st.id).entries()) st.tempCards.push({ id: st.id * 10 + 1 + i, issued });
    if (st.tempCards.length === 0 && r.chance(RATES.activeTemp)) st.tempCards.push({ id: st.id * 10 + 1, issued: "2026-09-10" });
  }
  for (const st of r.sample(students, Math.round(cfg.busRiders * scale))) st.bus = true;

  return { cfg, rooms, roomById: new Map(rooms.map((x) => [x.id, x])), teachers, sections, students, devices, entrances, hallways, readerOf };
}

/* ---------- generation ---------- */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rng = new Rng(args.seed);
  const days = schoolDays();
  const stories = new Stories(args.stories, days);
  const frozen = days[days.length - 1]!;
  if (frozen.date !== FROZEN_NOW.date) throw new Error("calendar does not end on the frozen day");
  const pool = getAdminPool();
  const started = Date.now();
  console.log(`seed=${args.seed} scale=${args.scale} stories=${args.stories} days=${days[0]!.date}..${frozen.date}`);

  await pool.query("TRUNCATE public.entry_events, public.presence_events, public.device_hours, public.passes, public.attendance, public.rosters, public.cards, public.sections, public.devices, public.students, public.teachers, public.rooms, public.bell_schedule, public.school_calendar, public.schools RESTART IDENTITY CASCADE");

  const w = {
    schools: new TableWriter(pool, "public.schools", ["id", "name"], ["int", "text"]),
    calendar: new TableWriter(pool, "public.school_calendar", ["school_id", "date", "is_school_day", "ab_day"], ["int", "date", "boolean", "text"]),
    bells: new TableWriter(pool, "public.bell_schedule", ["school_id", "period", "starts_at", "ends_at"], ["int", "int", "time", "time"]),
    rooms: new TableWriter(pool, "public.rooms", ["id", "school_id", "name", "wing", "floor", "kind"], ["int", "int", "text", "text", "int", "text"]),
    teachers: new TableWriter(pool, "public.teachers", ["id", "school_id", "name", "email"], ["int", "int", "text", "text"]),
    students: new TableWriter(pool, "public.students", ["id", "school_id", "name", "grade"], ["int", "int", "text", "int"]),
    cards: new TableWriter(pool, "public.cards", ["id", "school_id", "student_id", "type", "status", "issued_at"], ["int", "int", "int", "text", "text", "timestamptz"]),
    sections: new TableWriter(pool, "public.sections", ["id", "school_id", "teacher_id", "course", "period", "room_id"], ["int", "int", "int", "text", "int", "int"]),
    rosters: new TableWriter(pool, "public.rosters", ["school_id", "section_id", "student_id"], ["int", "int", "int"]),
    devices: new TableWriter(pool, "public.devices", ["id", "school_id", "type", "location_id", "status"], ["int", "int", "text", "int", "text"]),
    presence: new TableWriter(pool, "public.presence_events", ["school_id", "student_id", "location_id", "device_id", "arrived_at", "left_by", "left_by_kind", "next_location_id", "location", "location_kind", "device_type", "next_location"], ["int", "int", "int", "int", "timestamptz", "timestamptz", "text", "int", "text", "text", "text", "text"]),
    entry: new TableWriter(pool, "public.entry_events", ["school_id", "student_id", "ts", "result", "device_id", "location_id", "minutes_after_bell", "tardy"], ["int", "int", "timestamptz", "text", "int", "int", "int", "boolean"]),
    deviceHours: new TableWriter(pool, "public.device_hours", ["school_id", "device_id", "hour", "online_ratio", "offline_minutes"], ["int", "int", "timestamptz", "numeric", "int"]),
    passes: new TableWriter(pool, "public.passes", ["school_id", "student_id", "section_id", "origin_room_id", "destination", "issuer", "started_at", "ended_at"], ["int", "int", "int", "int", "text", "text", "timestamptz", "timestamptz"]),
    attendance: new TableWriter(pool, "public.attendance", ["school_id", "section_id", "date", "student_id", "status", "source"], ["int", "int", "date", "int", "text", "text"]),
  };

  for (const cfg of SCHOOLS) {
    const school = buildSchool(cfg, rng, stories, args.scale);
    const sid = cfg.id;
    w.schools.push([sid, cfg.name]);
    for (const d of days) w.calendar.push([sid, d.date, true, d.ab]);
    for (const b of BELLS) w.bells.push([sid, b.period, minuteToTime(b.start), minuteToTime(b.end)]);
    for (const room of school.rooms) w.rooms.push([room.id, sid, room.name, room.wing, room.floor, room.kind]);
    for (const t of school.teachers) w.teachers.push([t.id, sid, t.name, `${t.name.toLowerCase().replace(/[^a-z]+/g, ".")}@${cfg.prefix ? "shelbyville" : "springfield"}.edu`]);
    for (const st of school.students) {
      w.students.push([st.id, sid, st.name, st.grade]);
      const permanentStatus = st.tempCards.length ? "deactivated" : "active";
      w.cards.push([st.permanentCard, sid, st.id, "permanent", permanentStatus, at("2026-08-20", 9 * 60)]);
      st.tempCards.forEach((c, i) => w.cards.push([c.id, sid, st.id, "temp", i === st.tempCards.length - 1 ? "active" : "deactivated", at(c.issued, 8 * 60 + 30)]));
      for (const sec of st.sections.values()) w.rosters.push([sid, sec.id, st.id]);
    }
    for (const s of school.sections) w.sections.push([s.id, sid, s.teacherId, s.course, s.period, s.roomId]);
    for (const dv of school.devices) w.devices.push([dv.id, sid, dv.type, dv.locationId, "active"]);
    await flushAll(w); // sequential, in foreign-key order

    const entranceKiosks = school.devices.filter((d) => d.type === "kiosk" && school.entrances.some((e) => e.id === d.locationId));
    const deviceById = new Map(school.devices.map((d) => [d.id, d]));
    const cafeteriaKiosk = school.devices.find((d) => d.type === "kiosk" && d.locationId !== null && school.roomById.get(d.locationId)?.kind === "cafeteria");
    const presentRate = stories.presentRate(sid, cfg.presentRate);
    const dayRng = rng.fork(`days-${sid}`);

    for (const day of days) {
      const isFrozen = day.idx === frozen.idx;
      const cutoff = isFrozen ? FROZEN_NOW.minute : Infinity;
      const dr = dayRng.fork(day.date);
      const lr = dayRng.fork(`lunch-${day.date}`); // own sub-stream: lunch draws never move the day's other draws
      const livePassStarts = isFrozen ? stories.livePassStarts(sid) : null;
      const suppressOpen = isFrozen && stories.enabled; // with stories on, only the planned live passes are open at the frozen moment
      let liveAssigned = 0;

      // device hours: one heartbeat every two minutes aggregated per hour; the raw heartbeats are not stored
      for (const dv of school.devices) {
        const room = dv.locationId ? school.roomById.get(dv.locationId) : undefined;
        const offline = room ? stories.readerOffline(room.name, day) : null;
        const perHour = new Map<number, { total: number; off: number }>();
        for (let m = SCHOOL_OPEN; m < Math.min(SCHOOL_CLOSE, cutoff); m += HEARTBEAT_MINUTES) {
          const online = !(offline && m >= offline.start && m < offline.end);
          const h = Math.floor(m / 60);
          const acc = perHour.get(h) ?? { total: 0, off: 0 };
          acc.total++; if (!online) acc.off++;
          perHour.set(h, acc);
        }
        for (const [h, acc] of perHour) w.deviceHours.push([sid, dv.id, at(day.date, h * 60), ((acc.total - acc.off) / acc.total).toFixed(4), acc.off * HEARTBEAT_MINUTES]);
      }

      for (const st of school.students) {
        type DayTap = { deviceId: number; locationId: number; minute: number; kind: string; result: string };
        const dayTaps: DayTap[] = [];
        // row is in the raw tap layout [school, device, location, card, student, ts, direction, kind, result]; it stays in memory for the day and is derived into presence and entry rows below
        const tap = (minute: number, row: unknown[]): void => {
          dayTaps.push({ deviceId: row[1] as number, locationId: row[2] as number, minute, kind: row[7] as string, result: row[8] as string });
        };
        const cardAt = (minute: number): number => {
          const temp = [...st.tempCards].reverse().find((c) => c.issued <= day.date);
          void minute;
          return temp ? temp.id : st.permanentCard;
        };
        const absentAll = dr.chance(RATES.absentAllDay) && stories.leavesAfterPeriod(st.id, day) === null && !isCanon(st.id);
        const leavesAfter = stories.leavesAfterPeriod(st.id, day);
        const bart = stories.bartTardies(st.id, day);

        if (!absentAll && (dr.chance(RATES.entryTap) || leavesAfter !== null || bart.entry)) {
          let minute: number;
          let kiosk = dr.pick(entranceKiosks);
          if (bart.entry) minute = dr.uniform(FIRST_BELL + 7, FIRST_BELL + 20);
          else if (st.bus && stories.busSurge() && entranceKiosks.length > 1) { minute = dr.uniform(7 * 60 + 52, 7 * 60 + 58); kiosk = entranceKiosks[1]!; }
          else minute = !isCanon(st.id) && dr.chance(RATES.entryAfterBell) ? dr.uniform(FIRST_BELL + 5.5, FIRST_BELL + 20) : dr.uniform(7 * 60 + 30, FIRST_BELL + 5);
          if (minute <= cutoff) {
            const noCard = dr.chance(0.01);
            tap(minute, [sid, kiosk.id, kiosk.locationId, noCard ? null : cardAt(minute), st.id, at(day.date, minute), "in", "arrival", noCard ? "no_card" : "authorized"]);
            w.entry.push([sid, st.id, at(day.date, minute), noCard ? "no_card" : "authorized", kiosk.id, kiosk.locationId, Math.round(minute - FIRST_BELL), minute > FIRST_BELL + 5]);
          }
        }

        let periodTardiesLeft = bart.periods;
        for (const sec of [...st.sections.values()].sort((a, b) => a.period - b.period)) {
          const bell = BELLS[sec.period - 1]!;
          if (bell.start > cutoff) break;
          const room = school.roomById.get(sec.roomId)!;
          const reader = school.readerOf.get(sec.roomId)!;
          const forcedAbsent = absentAll || (leavesAfter !== null && sec.period > leavesAfter) || stories.lisaAbsent(st.id, sec.teacherId, day);
          const forcedPresent = (stories.coTapOut(st.id, day) !== null && sec.period === 3) || stories.krabappelOverride(st.id, sec.teacherId, day) || stories.milhouseDailyPeriod(st.id) === sec.period;
          const present = !forcedAbsent && (forcedPresent || isCanon(st.id) || dr.chance(presentRate)); // canon students only get planted absences

          if (!present) {
            const manual = !forcedAbsent && dr.chance(RATES.manualPresentNoTap);
            w.attendance.push([sid, sec.id, day.date, st.id, manual ? "present" : "absent", manual ? "manual" : "tap"]);
            continue;
          }

          let tardy = !isCanon(st.id) && dr.chance(RATES.periodTardy); // canon students only get planted tardies
          if (periodTardiesLeft > 0) { tardy = true; periodTardiesLeft--; }
          const tapMinute = bell.start + (tardy ? dr.uniform(6, 15) : dr.uniform(0, 6));
          const offline = stories.readerOffline(room.name, day);
          const dropped = offline !== null && tapMinute >= offline.start && tapMinute < offline.end;
          if (dropped || tapMinute > cutoff) {
            w.attendance.push([sid, sec.id, day.date, st.id, "absent", "tap"]);
            continue;
          }
          tap(tapMinute, [sid, reader, sec.roomId, cardAt(tapMinute), st.id, at(day.date, tapMinute), "in", "arrival", "authorized"]);
          const override = stories.krabappelOverride(st.id, sec.teacherId, day) || (!isCanon(st.id) && dr.chance(RATES.manualAbsentAfterTap));
          w.attendance.push([sid, sec.id, day.date, st.id, override ? "absent" : tardy ? "tardy" : "present", override ? "manual" : "tap"]);

          // bathroom pass
          const co = stories.coTapOut(st.id, day);
          const driftMedian = stories.milhouseMedian(st.id, day);
          let bathroom = dr.chance(RATES.bathroomPass * stories.passRateMultiplier(sec.period, room.wing)) || stories.milhouseDailyPeriod(st.id) === sec.period;
          let start: number | null = null;
          let duration = driftMedian !== null
            ? dr.lognormal(driftMedian, 0.15, 3, 19.5)
            : dr.lognormal(PASS_MINUTES.median, PASS_MINUTES.sigma, PASS_MINUTES.min, PASS_MINUTES.max);
          if (co !== null && sec.period === 3) { bathroom = true; start = bell.start + co; duration = dr.uniform(6, 9); }
          else if (bathroom) start = Math.max(tapMinute + 2, bell.start + dr.uniform(8, 32));
          if (livePassStarts && sec.period === 3 && liveAssigned < livePassStarts.length && !isCanon(st.id) && tapMinute <= bell.start + 6) {
            bathroom = true; start = livePassStarts[liveAssigned++]!; duration = 60; // still out at 10:40
          } else if (suppressOpen && start !== null && start + duration > cutoff) {
            bathroom = false;
          }
          if (bathroom && start !== null && start <= cutoff) {
            const end = start + duration;
            const ended = end <= cutoff;
            tap(start, [sid, reader, sec.roomId, cardAt(start), st.id, at(day.date, start), "out", "pass_start", "authorized"]);
            if (ended) tap(end, [sid, reader, sec.roomId, cardAt(end), st.id, at(day.date, end), "in", "pass_end", "authorized"]);
            w.passes.push([sid, st.id, sec.id, sec.roomId, "bathroom", "tap_out", at(day.date, start), ended ? at(day.date, end) : null]);
          }

          // teacher-issued pass to a room with a reader
          if (!bathroom && dr.chance(RATES.teacherPass)) {
            const destKind = dr.pick(["nurse", "office", "library", "counselor"] as const);
            const dest = school.rooms.find((x) => x.kind === destKind)!;
            const s2 = tapMinute + dr.uniform(5, 25);
            const d2 = dr.lognormal(12, 0.4, 5, 30);
            if (s2 <= cutoff && !(suppressOpen && s2 + d2 > cutoff)) {
              const e2 = s2 + d2;
              const ended = e2 <= cutoff;
              tap(s2, [sid, reader, sec.roomId, cardAt(s2), st.id, at(day.date, s2), "out", "pass_start", "authorized"]);
              if (dest.reader && s2 + 3 <= cutoff) tap(s2 + 3, [sid, dest.reader, dest.id, cardAt(s2 + 3), st.id, at(day.date, s2 + 3), "in", "arrival", "authorized"]);
              if (ended) tap(e2, [sid, reader, sec.roomId, cardAt(e2), st.id, at(day.date, e2), "in", "pass_end", "authorized"]);
              w.passes.push([sid, st.id, sec.id, sec.roomId, destKind, "teacher", at(day.date, s2), ended ? at(day.date, e2) : null]);
            }
          }
        }
        // lunch: a student with no 5th-period class taps the cafeteria kiosk early in the period
        const lunch = BELLS[4]!;
        if (cafeteriaKiosk && !absentAll && !st.sections.has(lunch.period) && (leavesAfter === null || leavesAfter >= lunch.period) && lr.chance(RATES.cafeteriaTap)) {
          const m = lunch.start + lr.uniform(0, 10);
          if (m <= cutoff) tap(m, [sid, cafeteriaKiosk.id, cafeteriaKiosk.locationId, cardAt(m), st.id, at(day.date, m), "in", "arrival", "authorized"]);
        }
        // presence: one row per authorized arrival, left_by = next tap the same day, else end of day (null on the frozen day)
        dayTaps.sort((a, b) => a.minute - b.minute);
        for (let i = 0; i < dayTaps.length; i++) {
          const t = dayTaps[i]!;
          if (t.result !== "authorized" || (t.kind !== "arrival" && t.kind !== "pass_end")) continue;
          const next = dayTaps[i + 1];
          const leftBy = next ? at(day.date, next.minute) : isFrozen ? null : at(day.date, BELLS[BELLS.length - 1]!.end);
          const kind = !next ? "end_of_day" : next.kind === "departure" ? "exit_tap" : next.kind === "pass_start" ? "pass_tap_out" : "next_arrival";
          const room = school.roomById.get(t.locationId)!;
          w.presence.push([sid, st.id, t.locationId, t.deviceId, at(day.date, t.minute), leftBy, kind, next?.locationId ?? null,
            room.name, room.kind, deviceById.get(t.deviceId)?.type ?? "reader", next ? school.roomById.get(next.locationId)?.name ?? null : null]);
        }
        await w.presence.maybeFlush();
        await w.entry.maybeFlush();
        await w.attendance.maybeFlush();
        await w.passes.maybeFlush();
      }

      // handheld hallway checks are not arrivals and no view reads them; they existed only in the raw taps table and are not generated
      await w.deviceHours.maybeFlush();
      if (day.idx % 10 === 9 || isFrozen) console.log(`  ${cfg.name}: through ${day.date} (${Math.round((Date.now() - started) / 1000)}s)`);
    }
    await flushAll(w);
  }

  await pool.query("ANALYZE");
  const counts = await pool.query(`
    select 'presence_events' t, count(*) n, md5(coalesce(sum(student_id),0)::text || coalesce(sum(extract(epoch from arrived_at)),0)::bigint::text) sig from public.presence_events
    union all select 'entry_events', count(*), md5(coalesce(sum(student_id),0)::text || coalesce(sum(extract(epoch from ts)),0)::bigint::text) from public.entry_events
    union all select 'device_hours', count(*), md5(sum(offline_minutes)::text || count(*) filter (where online_ratio < 1)::text) from public.device_hours
    union all select 'passes', count(*), md5(coalesce(sum(student_id),0)::text || coalesce(sum(extract(epoch from started_at)),0)::bigint::text) from public.passes
    union all select 'attendance', count(*), md5(count(*) filter (where status='present')::text || count(*) filter (where source='manual')::text) from public.attendance
    union all select 'students', count(*), md5(string_agg(name, ',' order by id)) from public.students
    union all select 'sections', count(*), md5(string_agg(course, ',' order by id)) from public.sections
    union all select 'rosters', count(*), md5(sum(student_id)::text) from public.rosters
    union all select 'cards', count(*), md5(count(*) filter (where type='temp')::text) from public.cards`);
  console.table(counts.rows.map((r) => ({ table: r.t, rows: Number(r.n), checksum: String(r.sig).slice(0, 12) })));
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
  await pool.end();
}

/** Writers are flushed one at a time in declaration order, which is foreign-key order. */
async function flushAll(w: Record<string, TableWriter>): Promise<void> {
  for (const x of Object.values(w)) await x.flush();
}

function minuteToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
}
function isCanon(id: number): boolean {
  return Object.values(C).some((c) => c.id === id);
}

main().catch((e) => { console.error(e); process.exit(1); });
