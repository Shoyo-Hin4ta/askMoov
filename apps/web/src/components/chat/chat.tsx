"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { PERSONAS, type PersonaKey } from "@ask-moov/shared";
import { Button } from "@/components/ui/button";
import type { ClarificationOption, Pin, Thread } from "@/lib/client/api";
import { AssistantMessage } from "./assistant-message";
import { Composer } from "./composer";
import { DATA_AS_OF, DATA_AS_OF_ISO, DATA_AS_OF_SHORT } from "./constants";
import { ExamplePrompts } from "./example-prompts";
import { initials, personaParts } from "./persona";
import { QuestionBlock } from "./question-block";
import { Sidebar } from "./sidebar";
import { SidebarDrawer } from "./sidebar-drawer";
import { useAsk } from "./use-ask";
import { useThreads } from "./use-threads";

const newThreadId = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const DRAWER_TITLE_ID = "drawer-title";

/** Composition only: persona and thread state, the sidebar (aside on md+, drawer below), the transcript, the composer. Asking and polling live in useAsk. */
export function Chat() {
  const [persona, setPersona] = useState<PersonaKey>("teacher");
  const [threadId, setThreadId] = useState<string>(newThreadId);
  const [input, setInput] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { threads, refresh } = useThreads(persona);
  const { messages, busy, submit, reset, open } = useAsk(persona, threadId, refresh);
  const endRef = useRef<HTMLDivElement>(null);

  // Only on append and on settle: polling replaces the array every second and must not yank the reader to the bottom.
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, busy]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const startThread = (next: PersonaKey = persona) => { setPersona(next); setThreadId(newThreadId()); reset(); setHelpOpen(false); setMenuOpen(false); };
  const openThread = (t: Thread) => { setThreadId(t.thread_id); void open(t.thread_id, `Reopened "${t.first_question}". Names pinned in this thread still apply.`); setHelpOpen(false); setMenuOpen(false); };
  const send = (q: string, opts?: { pin?: Pin; display?: string }) => { setInput(""); setHelpOpen(false); void submit(q, opts); };
  /** A chip re-asks the question of its own card (not the thread's last one): with an entity, pinned by id; without one (a vague metric), as plain text. */
  const clarify = (o: ClarificationOption, question: string) => {
    const e = o.entity;
    if (e?.label) send(question, { pin: { type: e.type, id: e.id, label: e.label, ...(e.detail ? { detail: e.detail } : {}) }, display: o.label });
    else send(`${o.label}. ${question}`);
  };
  const { name } = personaParts(persona);
  const showExamples = messages.length === 0 || helpOpen;
  const sidebarProps = { persona, onPersona: startThread, threads, threadId, onOpenThread: openThread, onNewThread: () => startThread() };

  return (
    <div className="flex h-dvh">
      <aside aria-label="Personas and threads" className="hidden shrink-0 flex-col border-r border-line bg-surface md:flex md:w-64 lg:w-72">
        <Sidebar {...sidebarProps} />
      </aside>
      <SidebarDrawer open={menuOpen} onClose={closeMenu} labelledBy={DRAWER_TITLE_ID}>
        <Sidebar
          {...sidebarProps}
          groupName="persona-drawer"
          titleId={DRAWER_TITLE_ID}
          action={
            <Button variant="ghost" size="icon" className="h-10 w-10" aria-label="Close menu" onClick={closeMenu}>
              <X className="h-5 w-5" aria-hidden />
            </Button>
          }
        />
      </SidebarDrawer>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-2 border-b border-line bg-surface px-3 md:gap-4 md:px-6">
          <Button variant="ghost" size="icon" className="h-10 w-10 md:hidden" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
            <Menu className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="shrink-0 font-semibold text-ink md:hidden">Ask MOOV</h1>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
            <span className="md:hidden">{name}</span>
            <span className="hidden md:inline">Answering as {PERSONAS[persona].scope_summary}</span>
          </span>
          <time dateTime={DATA_AS_OF_ISO} className="shrink-0 text-xs text-ink-3">
            <span className="lg:hidden">Data as of {DATA_AS_OF_SHORT}</span>
            <span className="hidden lg:inline">Data as of {DATA_AS_OF}</span>
          </time>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-y-contain px-3 py-4 sm:px-4 sm:py-6 md:px-6 md:py-8">
          <div className="mx-auto max-w-3xl space-y-6 md:space-y-8">
            {showExamples && <ExamplePrompts persona={persona} onPick={send} />}
            {messages.map((m) => {
              if (m.role === "user") return <QuestionBlock key={m.id} text={m.text} initials={initials(name)} />;
              if (m.role === "note") return <p key={m.id} className="text-xs text-ink-3">{m.text}</p>;
              return <AssistantMessage key={m.id} msg={m} onChip={clarify} />;
            })}
            <div ref={endRef} />
          </div>
        </div>

        <Composer value={input} onChange={setInput} onSubmit={() => send(input)} busy={busy} helpOpen={helpOpen} onToggleHelp={() => setHelpOpen((o) => !o)} />
      </main>
    </div>
  );
}
