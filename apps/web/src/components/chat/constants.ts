import type { PersonaKey } from "@ask-moov/shared";

/** All three mirror analytics.frozen_now() in the seed. The data stops here, so the UI says so. */
export const DATA_AS_OF_ISO = "2026-10-13T10:40";
export const DATA_AS_OF = "Tue, Oct 13 2026, 10:40";
export const DATA_AS_OF_SHORT = "Oct 13";

export const EXAMPLES: Record<PersonaKey, string[]> = {
  teacher: [
    "How many bathroom passes did Bart take this month?",
    "What's the attendance rate in my 4th period this month?",
    "Show me Ralph's attendance this month",
    "How many more classes does Bart need to hit 90% in my class?",
  ],
  admin: [
    "Which period has the most bathroom passes, by wing?",
    "Who is out of class right now?",
    "Was the Room 214 reader online during 3rd period on October 6?",
    "When does the morning rush hit Entrance 2?",
  ],
  super_admin: [
    "Compare attendance rates between Springfield and Shelbyville this month",
    "Top 10 students by minutes out of class this week",
    "How many temp IDs has Martin had this month?",
    "Tardies week over week since September for Bart",
  ],
};
