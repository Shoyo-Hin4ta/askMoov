import type { PersonaKey } from "@ask-moov/shared";
import { Chip } from "@/components/ui/chip";
import { EXAMPLES } from "./constants";
import { personaParts } from "./persona";

/** "What can I ask?": example questions for the current persona, each one a shape the registry can answer. */
export function ExamplePrompts({ persona, onPick }: { persona: PersonaKey; onPick: (q: string) => void }) {
  const { name } = personaParts(persona);
  return (
    <section className="rounded-card border border-dashed border-line px-5 py-5">
      <h2 className="text-sm font-medium text-ink">What can I ask?</h2>
      <p className="mt-1 text-xs text-ink-2">Anything about taps, passes, attendance and devices, limited to what {name} is allowed to see. Try one:</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES[persona].map((q) => <Chip key={q} onClick={() => onPick(q)}>{q}</Chip>)}
      </div>
    </section>
  );
}
