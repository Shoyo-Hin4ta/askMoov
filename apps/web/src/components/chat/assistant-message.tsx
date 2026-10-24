"use client";
import type { ClarificationOption } from "@/lib/client/api";
import { AnswerCard } from "./answer-card";
import { RunCard } from "./run-card";
import { statusLine } from "./trail";
import type { AssistantMsg } from "./use-ask";

/** Pending, failed, or answered: the same card, the trail on top, the body by state. */
export function AssistantMessage({ msg, onChip }: { msg: AssistantMsg; onChip: (option: ClarificationOption, question: string) => void }) {
  const { view, error } = msg;
  if (error) return <RunCard view={view}><p className="text-sm text-danger">{error}</p></RunCard>;
  if (view?.status === "succeeded" && view.output) return <AnswerCard view={{ ...view, output: view.output }} onChip={onChip} />;
  if (view?.status === "failed") return <RunCard view={view}><p className="text-sm text-danger">Could not answer. {view.error}</p></RunCard>;
  return <RunCard view={view}><p className="text-sm text-ink-2">{statusLine(view)}</p></RunCard>;
}
