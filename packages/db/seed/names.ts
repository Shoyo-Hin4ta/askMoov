import type { Rng } from "./rng";

/** Name pools. Canonical characters get fixed ids so the planted stories and the eval personas can find them. */
export const FIRST = ["Aiden", "Amara", "Ana", "Arjun", "Ava", "Ben", "Bianca", "Caleb", "Camila", "Chloe", "Daniel", "Diego", "Elena", "Eli", "Emma", "Ethan", "Fatima", "Felix", "Grace", "Hana", "Henry", "Isabella", "Ivan", "Jade", "Jamal", "Jonah", "Julia", "Kai", "Kenji", "Layla", "Leo", "Liam", "Lucia", "Maya", "Mia", "Miles", "Nadia", "Noah", "Nora", "Omar", "Owen", "Priya", "Quinn", "Rafael", "Riley", "Rosa", "Sam", "Sofia", "Tariq", "Tessa", "Theo", "Uma", "Victor", "Wei", "Xavier", "Yara", "Zoe", "Zara", "Marcus", "Ines"];
export const LAST = ["Adams", "Alvarez", "Baker", "Bell", "Brooks", "Campbell", "Carter", "Chen", "Collins", "Cooper", "Cruz", "Diaz", "Edwards", "Evans", "Flores", "Foster", "Garcia", "Gomez", "Gray", "Green", "Hall", "Hayes", "Hill", "Howard", "Hughes", "Jackson", "James", "Jenkins", "Johnson", "Kelly", "Kim", "King", "Lee", "Long", "Lopez", "Martin", "Mendoza", "Mitchell", "Moore", "Morgan", "Murphy", "Nelson", "Nguyen", "Ortiz", "Patel", "Perez", "Peterson", "Powell", "Ramirez", "Reed", "Reyes", "Richardson", "Rivera", "Roberts", "Rogers", "Ross", "Russell", "Sanchez", "Sanders", "Scott", "Shah", "Singh", "Stewart", "Torres", "Turner", "Walker", "Ward", "Watson", "Wood", "Wright", "Young", "Okafor", "Haddad", "Novak", "Silva"];

export const COURSES = ["Algebra I", "Geometry", "Algebra II", "Pre-Calculus", "Biology", "Chemistry", "Physics", "Earth Science", "English 9", "English 10", "English 11", "English 12", "World History", "US History", "Government", "Economics", "Spanish I", "Spanish II", "French I", "Art", "Music", "Computer Science", "Health", "Physical Education"];

/** Canonical students: fixed ids at the top of the Springfield range. */
export const CANON_STUDENTS = {
  bartSimpson: { id: 1203, name: "Bart Simpson", grade: 9 },
  bartReyes: { id: 1204, name: "Bart Reyes", grade: 11 },
  lisa: { id: 1205, name: "Lisa Simpson", grade: 10 },
  milhouse: { id: 1206, name: "Milhouse Van Houten", grade: 9 },
  nelson: { id: 1207, name: "Nelson Muntz", grade: 10 },
  jimbo: { id: 1208, name: "Jimbo Jones", grade: 11 },
  ralph: { id: 1209, name: "Ralph Wiggum", grade: 9 },
  martin: { id: 1210, name: "Martin Prince", grade: 9 },
} as const;

/** Canonical teachers. 12 and 17 match the ids the design doc uses in its examples and tests. */
export const CANON_TEACHERS = {
  krabappel: { id: 12, name: "Edna Krabappel" },
  hoover: { id: 17, name: "Elizabeth Hoover" },
} as const;

export function uniqueNames(rng: Rng, n: number, taken: Set<string>): string[] {
  const out: string[] = [];
  let guard = 0;
  while (out.length < n) {
    const name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    if (!taken.has(name)) { taken.add(name); out.push(name); }
    if (++guard > n * 50) throw new Error("could not generate enough unique names");
  }
  return out;
}
