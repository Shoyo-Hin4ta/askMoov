"use client";
import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { vote } from "@/lib/client/api";

/** Thumbs up or down, once per answer. The vote scores the episode behind this run; a stored vote shows as already cast after a reopen. */
export function Feedback({ runId, initial }: { runId: string; initial: 1 | -1 | null }) {
  const [voted, setVoted] = useState<1 | -1 | null>(initial);
  const cast = async (v: 1 | -1) => {
    if (voted !== null) return;
    if (await vote(runId, v)) setVoted(v);
  };
  return (
    <div className="flex items-center gap-1 text-xs text-ink-2">
      <span className="mr-1">{voted === null ? "Was this right?" : "Thanks, recorded."}</span>
      <Button variant="ghost" size="icon" aria-label="Yes, this was right" aria-pressed={voted === 1} disabled={voted === -1} onClick={() => void cast(1)}>
        <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button variant="ghost" size="icon" aria-label="No, this was wrong" aria-pressed={voted === -1} disabled={voted === 1} onClick={() => void cast(-1)}>
        <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}
