import { pool } from "../../database";
import { customerColumns, type CustomerRecord } from "../../security/customerAccess";
import { brazilianNationalPhone } from "../../security/customerPhone";
import type { PoolClient } from "pg";
import type { StoredAddress } from "../../security/customerAddress";

export type WhatsAppCustomerMatch = Pick<CustomerRecord, "id" | "restaurant_id"> & {
  international_format: boolean;
  national_format: boolean;
};

class GetClientService {
  constructor(private readonly database: Pick<PoolClient, "query"> = pool) {}

  /** Internal transactional read: the caller verifies the WhatsApp linkage before disclosure. */
  async findAddressByOwner({ customer_id, restaurant_id }: { customer_id: string; restaurant_id: string }, lock: "share" | "update") {
    if (!customer_id.trim() || !restaurant_id.trim()) throw new Error("Consulta de endereço inválida.");
    const result = await this.database.query<StoredAddress & { id: string; restaurant_id: string }>(
      `SELECT id, restaurant_id, city::text AS city, street::text AS street, number::text AS number,
              neighborhood::text AS neighborhood, complement::text AS complement
       FROM public.customers WHERE id = $1 AND restaurant_id = $2 FOR ${lock === "update" ? "UPDATE" : "SHARE"}`,
      [customer_id, restaurant_id],
    );
    if (result.rows.length > 1) throw new Error("Consulta de endereço ambígua.");
    return result.rows[0];
  }
  /** Bot-only lookup: mandatory tenant and full international digits, no profile data. */
  async findByWhatsAppPhone({ restaurant_id, phone }: { restaurant_id: string; phone: string }, lock?: "share") {
    if (!restaurant_id?.trim() || !/^[1-9][0-9]{6,14}$/.test(phone)) {
      throw new Error("Parâmetros de consulta inválidos.");
    }
    const nationalPhone = brazilianNationalPhone(phone);
    const clients = await this.database.query<WhatsAppCustomerMatch>(
      `SELECT id, restaurant_id, left(btrim(phone::text), 1) = '+' AS international_format,
       ($3::text IS NOT NULL AND left(btrim(phone::text), 1) <> '+'
        AND regexp_replace(btrim(phone::text), '[+ ().-]', '', 'g') = $3) AS national_format
       FROM customers WHERE restaurant_id = $1
       AND length(btrim(phone::text)) <= 64
       AND btrim(phone::text) ~ '^[+]?[(]?[0-9][0-9 ().-]*$'
       AND (regexp_replace(btrim(phone::text), '[+ ().-]', '', 'g') = $2
        OR ($3::text IS NOT NULL AND left(btrim(phone::text), 1) <> '+'
         AND regexp_replace(btrim(phone::text), '[+ ().-]', '', 'g') = $3))
       LIMIT 2${lock === "share" ? " FOR SHARE" : ""}`,
      [restaurant_id, phone, nationalPhone ?? null],
    );
    return clients.rows;
  }

  async execute({ restaurant_id, phone, customer_id }: { restaurant_id: string; phone?: string; customer_id?: string }) {
    const clients = await this.database.query<CustomerRecord>(
      `SELECT ${customerColumns} FROM customers WHERE restaurant_id = $1
       AND ($2::text IS NULL OR phone::text = $2)
       ${customer_id === undefined ? "" : "AND id = $3"}`,
      customer_id === undefined ? [restaurant_id, phone || null] : [restaurant_id, phone || null, customer_id],
    );
    return clients.rows;
  }
}
export { GetClientService };
