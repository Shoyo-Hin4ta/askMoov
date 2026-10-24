/** Everything about the fictional district that is a constant, in one place. Minutes are minutes after midnight, school local time stored as UTC. */
export const FROZEN_NOW = { date: "2026-10-13", minute: 10 * 60 + 40 }; // Tuesday, 3rd period in progress
export const SCHOOL_DAYS = 40; // 8 weeks ending on the frozen day; stories need 6 weeks of drift and 8 Tuesdays

/** 8 periods of 50 minutes with 5-minute passing. 3rd period is 9:50 to 10:45. */
export const BELLS: { period: number; start: number; end: number }[] = [
  { period: 1, start: 8 * 60, end: 8 * 60 + 50 },
  { period: 2, start: 8 * 60 + 55, end: 9 * 60 + 45 },
  { period: 3, start: 9 * 60 + 50, end: 10 * 60 + 45 },
  { period: 4, start: 10 * 60 + 50, end: 11 * 60 + 40 },
  { period: 5, start: 11 * 60 + 45, end: 12 * 60 + 35 },
  { period: 6, start: 12 * 60 + 40, end: 13 * 60 + 30 },
  { period: 7, start: 13 * 60 + 35, end: 14 * 60 + 25 },
  { period: 8, start: 14 * 60 + 30, end: 15 * 60 + 20 },
];
export const FIRST_BELL = BELLS[0]!.start;
export const SCHOOL_OPEN = 7 * 60;
export const SCHOOL_CLOSE = 16 * 60;
export const HEARTBEAT_MINUTES = 2;

export const SCHOOLS = [
  { id: 1, name: "Springfield High", students: 1500, teachers: 90, classrooms: 80, kiosks: 5, handhelds: 6, presentRate: 0.96, prefix: "", studentIdBase: 1000, teacherIdBase: 1, roomIdBase: 100, sectionIdBase: 1, deviceIdBase: 1, busRiders: 180 },
  { id: 2, name: "Shelbyville High", students: 300, teachers: 20, classrooms: 20, kiosks: 2, handhelds: 2, presentRate: 0.96, prefix: "S", studentIdBase: 5000, teacherIdBase: 500, roomIdBase: 500, sectionIdBase: 500, deviceIdBase: 500, busRiders: 40 },
] as const;
export type SchoolConfig = (typeof SCHOOLS)[number];

export const RATES = {
  absentAllDay: 0.02,
  entryTap: 0.9,
  entryAfterBell: 0.08,
  periodTardy: 0.03,
  bathroomPass: 0.22,
  teacherPass: 0.03,
  manualAbsentAfterTap: 0.02,
  manualPresentNoTap: 0.01,
  activeTemp: 0.04,
  cafeteriaTap: 0.75, // share of students with no 5th-period class who tap the cafeteria kiosk at lunch
};

export const PASS_MINUTES = { median: 6, sigma: 0.45, min: 2, max: 25 };
