import type { Pool } from "pg";

/**
 * Columnar batch writer. Rows are buffered per column and flushed as one
 * INSERT ... SELECT FROM unnest($1::type[], $2::type[], ...) so a 20k-row batch is a single statement with one
 * parameter per column. Identity columns are simply not listed.
 */
export class TableWriter {
  private cols: unknown[][];
  private n = 0;
  total = 0;

  constructor(
    private readonly pool: Pool,
    private readonly table: string,
    private readonly columns: readonly string[],
    private readonly types: readonly string[],
    private readonly batch = 20_000,
  ) {
    if (columns.length !== types.length) throw new Error(`${table}: columns/types mismatch`);
    this.cols = columns.map(() => []);
  }

  push(row: readonly unknown[]): void {
    if (row.length !== this.columns.length) throw new Error(`${this.table}: expected ${this.columns.length} values, got ${row.length}`);
    for (let i = 0; i < row.length; i++) this.cols[i]!.push(row[i]);
    this.n++;
  }

  async maybeFlush(): Promise<void> {
    if (this.n >= this.batch) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.n === 0) return;
    const params = this.types.map((t, i) => `$${i + 1}::${t}[]`).join(", ");
    const sql = `INSERT INTO ${this.table} (${this.columns.join(", ")}) SELECT * FROM unnest(${params})`;
    // a dropped connection (ECONNRESET, admin shutdown) mid-load wastes minutes; the batch is atomic, so retrying is safe
    for (let attempt = 1; ; attempt++) {
      try {
        await this.pool.query(sql, this.cols);
        break;
      } catch (e) {
        const code = (e as { code?: string }).code ?? "";
        const transient = ["ECONNRESET", "ETIMEDOUT", "EPIPE", "57P01", "08006", "08003"].includes(code);
        if (!transient || attempt >= 3) throw e;
        console.warn(`  ${this.table}: ${code} on flush, retry ${attempt}`);
        await new Promise((r) => setTimeout(r, 2_000 * attempt));
      }
    }
    this.total += this.n;
    this.cols = this.columns.map(() => []);
    this.n = 0;
  }
}
