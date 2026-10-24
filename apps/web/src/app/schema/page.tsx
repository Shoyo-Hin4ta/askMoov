import { PolicySection } from "@/components/schema/policy-section";
import { PrivilegeSection } from "@/components/schema/privilege-section";
import { SchemaDocSection } from "@/components/schema/schema-doc-section";
import { PageHeader } from "@/components/ui/page-header";
import { parseSchemaDoc } from "@/lib/schema-doc-parse";
import { schemaPageData } from "@/lib/schema-queries";

export const dynamic = "force-dynamic";

/** What the agent can read and who can see what, every fact read from the database at request time. Server component. */
export default async function SchemaPage() {
  const data = await schemaPageData();
  return (
    <main className="min-h-dvh bg-page text-ink">
      <PageHeader title="Schema" links={[{ href: "/", label: "Back to chat" }, { href: "/ops", label: "Operations" }]} />
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-6 lg:grid-cols-2">
        <SchemaDocSection doc={parseSchemaDoc(data.doc.text)} version={data.doc.version} raw={data.doc.text} />
        <PolicySection policies={data.policies} />
        <PrivilegeSection columns={data.columns} roles={data.roles} />
      </div>
    </main>
  );
}
