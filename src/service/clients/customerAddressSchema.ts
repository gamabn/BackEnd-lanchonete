import type { PoolClient } from "pg";
import { addressLimitsFromColumns, type AddressColumn } from "../../security/customerAddress";

export async function readCustomerAddressLimits(database: Pick<PoolClient, "query">) {
  const columns = await database.query<AddressColumn>(
    `SELECT column_name, data_type, character_maximum_length, is_nullable, is_generated, is_identity
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers'
     AND column_name IN ('city', 'street', 'number', 'neighborhood', 'complement')`,
  );
  return addressLimitsFromColumns(columns.rows);
}
