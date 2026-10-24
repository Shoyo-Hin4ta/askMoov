import { Chip } from "@/components/ui/chip";
import type { ClarificationOption } from "@/lib/client/api";

/** Options from a needs_clarification plan. Picking one re-asks the question with that entity pinned by id. */
export function ClarificationChips({ options, onPick }: { options: ClarificationOption[]; onPick: (option: ClarificationOption) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => <Chip key={o.label} onClick={() => onPick(o)}>{o.label}</Chip>)}
    </div>
  );
}
