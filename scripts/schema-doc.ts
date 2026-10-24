/** Print the schema document exactly as the planner will see it, plus its version. Dev utility. */
import { loadSchemaDoc } from "@ask-moov/agent";
import { getAppPool } from "@ask-moov/db";

const pool = getAppPool();
const doc = await loadSchemaDoc(async (sql, params) => (await pool.query(sql, params)).rows);
console.log(`schema_version: ${doc.version}\n`);
console.log(doc.text);
await pool.end();
