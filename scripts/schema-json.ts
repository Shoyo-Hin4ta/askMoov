/** Dev utility: print the JSON schema the SDK sends for each model-facing schema, so $defs and unsupported keywords are visible. */
import { outputSchemaJson } from "@ask-moov/agent";
import { Critique, PlannerOutput, presentationFor, Sketch } from "@ask-moov/shared";

for (const [name, schema] of Object.entries({ PlannerOutput, Sketch, Critique, Presentation: presentationFor(["a", "b"]) })) {
  const json = outputSchemaJson(schema as never);
  const defs = json["$defs"] as Record<string, unknown> | undefined;
  console.log(`${name}: root keys ${Object.keys(json).join(",")} | $defs: ${defs ? Object.keys(defs).join(", ") : "none"} | ${JSON.stringify(json).length} bytes`);
}
if (process.argv[2]) console.log(JSON.stringify(outputSchemaJson(PlannerOutput as never), null, 1).slice(0, 4000));
