import type { ReactNode } from "react";
import { Card, CardBody } from "@/components/ui/card";
import type { RunView } from "@/lib/client/api";
import { RunTrail } from "./run-trail";

/** Every assistant message, in any state, sits under its trail. */
export function RunCard({ view, children }: { view: RunView | null; children: ReactNode }) {
  return (
    <Card>
      <div className="border-b border-line px-4 py-2">
        <RunTrail view={view} />
      </div>
      <CardBody className="pt-4">{children}</CardBody>
    </Card>
  );
}
