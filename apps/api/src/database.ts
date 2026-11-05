import "./env";
import { Pool, PoolClient, QueryResultRow, types } from "pg";
import Decimal from "decimal.js";
export interface SqlConnection {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<T[]>;
}
export class Database implements SqlConnection {
  private readonly pool: Pool;
  constructor(
    connectionString = process.env.DATABASE_URL ||
      "postgresql://contracts:contracts_local@localhost:5540/contracts",
    private readonly client?: PoolClient,
    pool?: Pool,
  ) {
    this.pool =
      pool ??
      new Pool({
        connectionString,
        connectionTimeoutMillis: 10000,
        options: "-c timezone=UTC",
        types: {
          getTypeParser(oid, format) {
            if (oid === 1700)
              return (value: string) => new Decimal(value).toFixed();
            // Existing audit columns are timestamp without time zone, written in UTC.
            if (oid === 1114) return (value: string) => new Date(value + "Z");
            return types.getTypeParser(oid, format);
          },
        },
      });
    if (!pool)
      this.pool.on("error", (error) =>
        console.error("Conexão PostgreSQL indisponível:", error.message),
      );
  }
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    return (
      await (this.client ?? this.pool).query<T>(
        text,
        values.map((value) =>
          value instanceof Date ? value.toISOString() : value,
        ),
      )
    ).rows;
  }
  async transaction<T>(
    run: (db: Database) => Promise<T>,
    options: {
      serializable?: boolean;
      timeout?: number;
    } = {},
  ): Promise<T> {
    if (this.client) return run(this);
    const client = await this.pool.connect();
    try {
      await client.query(
        options.serializable ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN",
      );
      await client.query("SET LOCAL TIME ZONE 'UTC'");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        String(options.timeout ?? 60000),
      ]);
      const result = await run(new Database(undefined, client, this.pool));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    if (!this.client) await this.pool.end();
  }
}
