import type { PoolClient } from "pg";
import { pool } from "../../database";

export async function productTransaction<T>(execute: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discardClient = false;
  try {
    await client.query("BEGIN");
    const result = await execute(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
      // Do not log driver errors: they may contain SQL, parameters or credentials.
      try {
        console.error("productTransaction: ROLLBACK failed; discarding database connection.");
      } catch {
        // Logging must not replace the original transaction error.
      }
    }
    throw error;
  } finally {
    if (discardClient) client.release(true);
    else client.release();
  }
}
