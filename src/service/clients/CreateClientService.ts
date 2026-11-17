import { pool } from "../../database";
import { customerColumns, type CustomerData, type CustomerRecord } from "../../security/customerAccess";
import { normalizeCustomerName } from "../../security/customerName";
import { brazilianNationalPhone } from "../../security/customerPhone";
import { GetClientService } from "./GetClientService";

export type InitialCustomerResult =
  | { kind: "created" | "existing"; customerId: string }
  | { kind: "ambiguous" | "schema_unsupported" | "error" };

interface CustomerColumn {
  column_name: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
  is_generated: string;
  data_type: string;
  character_maximum_length: number | null;
}

class CreateClientService {
  /** Internal bot path. Caller must supply transport-verified phone and confirmed name. */
  async createInitialForWhatsApp({ name, phone, restaurant_id }: { name: string; phone: string; restaurant_id: string }): Promise<InitialCustomerResult> {
    if (normalizeCustomerName(name) !== name || !/^[1-9][0-9]{6,14}$/.test(phone) || !restaurant_id.trim()) {
      return { kind: "error" };
    }
    const client = await pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        JSON.stringify(["gama:initial-customer:v1", restaurant_id, phone]),
      ]);
      // After obtaining the lock, a concurrent bot transaction's committed row is visible.
      const matches = await new GetClientService(client).findByWhatsAppPhone({ restaurant_id, phone });
      let result: InitialCustomerResult;
      if (matches.some(row => row.restaurant_id !== restaurant_id || !row.id)) {
        result = { kind: "error" };
      } else if (matches.length > 1) {
        result = { kind: "ambiguous" };
      } else if (matches.length === 1) {
        const match = matches[0];
        result = match.international_format || (match.national_format && brazilianNationalPhone(phone))
          ? { kind: "existing", customerId: match.id } : { kind: "ambiguous" };
      } else {
        // Do not assume the fixture reflects Neon. Check every address column before INSERT.
        const columns = await client.query<CustomerColumn>(
          `SELECT column_name, is_nullable, column_default, is_identity, is_generated,
                  data_type, character_maximum_length
           FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers'`,
        );
        const address = ["city", "street", "number", "neighborhood", "complement"];
        const acceptsText = (field: string, length: number) => columns.rows.some(column =>
          column.column_name === field && ["text", "character varying", "character"].includes(column.data_type) &&
          (column.character_maximum_length === null || column.character_maximum_length >= length));
        const supported = acceptsText("phone", phone.length + 1) && acceptsText("name", name.length) &&
          address.every(field => columns.rows.some(column => column.column_name === field && column.is_nullable === "YES")) &&
          columns.rows.every(column => column.is_nullable === "YES" || column.column_default !== null ||
            column.is_identity === "YES" || column.is_generated !== "NEVER" ||
            ["name", "phone", "restaurant_id"].includes(column.column_name));
        if (!supported) {
          result = { kind: "schema_unsupported" };
        } else {
          // Explicit NULLs prevent address defaults from inventing customer data.
          const inserted = await client.query<Pick<CustomerRecord, "id" | "restaurant_id">>(
            `INSERT INTO public.customers (name, phone, city, street, number, neighborhood, complement, restaurant_id)
             SELECT $1, $2, NULL, NULL, NULL, NULL, NULL, r.id FROM public.restaurants r WHERE r.id = $3
             RETURNING id, restaurant_id`,
            [name, `+${phone}`, restaurant_id],
          );
          const row = inserted.rows[0];
          if (inserted.rows.length !== 1 || !row?.id || row.restaurant_id !== restaurant_id) {
            throw new Error("Cadastro inicial não confirmado.");
          }
          result = { kind: "created", customerId: row.id };
        }
      }
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      try { await client.query("ROLLBACK"); } catch { discard = true; }
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "23502" || code === "23514") return { kind: "schema_unsupported" };
      if (code === "23505") return { kind: "ambiguous" };
      return { kind: "error" };
    } finally {
      client.release(discard);
    }
  }

  async execute({ name, phone, city, street, number, neighborhood, complement, restaurant_id }: CustomerData & { restaurant_id: string }) {
    const nullable = (value: string | null | undefined) => typeof value === "string" ? value.trim() || null : null;
    const clients = await pool.query<CustomerRecord>(
      `INSERT INTO customers (name, phone, city, street, number, neighborhood, complement, restaurant_id)
       SELECT $1, $2, $3, $4, $5, $6, $7, r.id FROM restaurants r WHERE r.id = $8
       RETURNING ${customerColumns}`,
      [name, phone, nullable(city), nullable(street), nullable(number), nullable(neighborhood), nullable(complement), restaurant_id],
    );
    return clients.rows[0];
  }
}
export { CreateClientService };
