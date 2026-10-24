import type { ReactNode } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import type { PersonaKey } from "@ask-moov/shared";
import type { Thread } from "@/lib/client/api";
import { PersonaSwitcher } from "./persona-switcher";
import { ThreadList } from "./thread-list";

export type SidebarProps = {
  persona: PersonaKey;
  onPersona: (k: PersonaKey) => void;
  threads: Thread[];
  threadId: string;
  onOpenThread: (t: Thread) => void;
  onNewThread: () => void;
  /** Radio group name; the desktop aside and the phone drawer each need their own. */
  groupName?: string;
  /** Id for the title, so a drawer can be labelled by it. */
  titleId?: string;
  /** Right-aligned control beside the title (the drawer's close button). */
  action?: ReactNode;
};

/** Brand, persona switcher, thread list, Operations link. Rendered by the desktop aside and by the phone drawer. No hooks. */
export function Sidebar({ persona, onPersona, threads, threadId, onOpenThread, onNewThread, groupName, titleId, action }: SidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-2 px-4 pb-3 pt-4">
        <div>
          <h1 id={titleId} className="text-base font-semibold tracking-tight text-ink">Ask MOOV</h1>
          <p className="text-xs text-ink-3">Tap data, answered with its SQL</p>
        </div>
        {action}
      </div>
      <div className="px-2">
        <PersonaSwitcher value={persona} onChange={onPersona} name={groupName} />
      </div>
      <ThreadList threads={threads} activeId={threadId} onOpen={onOpenThread} onNew={onNewThread} />
      <Link href="/ops" className="flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-ink-2 hover:text-ink">
        <Activity className="h-3.5 w-3.5" aria-hidden />
        Operations
      </Link>
    </div>
  );
}
