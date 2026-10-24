import { PERSONA_KEYS, type PersonaKey } from "@ask-moov/shared";
import { cn } from "@/components/ui/cn";
import { personaParts } from "./persona";

type Props = { value: PersonaKey; onChange: (k: PersonaKey) => void; name?: string };

/** Three exclusive personas as native radios: keyboard, focus and state come from the platform. Switching starts a new thread; the caller owns that. */
export function PersonaSwitcher({ value, onChange, name = "persona" }: Props) {
  return (
    <fieldset>
      <legend className="px-2 pb-1 text-xs font-medium text-ink-2">Asking as</legend>
      <div className="flex flex-col gap-0.5">
        {PERSONA_KEYS.map((k) => {
          const { role, name: who } = personaParts(k);
          const active = k === value;
          return (
            <label key={k} className="group flex cursor-pointer items-center gap-2.5 rounded-control px-2 py-2 transition-colors hover:bg-surface-2/60 has-checked:bg-surface-2 has-focus-visible:outline-2 has-focus-visible:outline-series">
              <input type="radio" name={name} value={k} checked={active} onChange={() => onChange(k)} className="sr-only" />
              <span className="h-2 w-2 shrink-0 rounded-full border border-ink bg-transparent group-has-checked:bg-ink" aria-hidden />
              <span className="min-w-0">
                <span className={cn("block truncate text-sm", active ? "font-medium text-ink" : "text-ink-2")}>{who}</span>
                <span className="block text-[11px] text-ink-3">{role}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
