import { pool } from "../../database";
import { customerColumns, type CustomerData, type CustomerRecord } from "../../security/customerAccess";
import type { PoolClient } from "pg";
import { CustomerAddressError, normalizeDeliveryAddress, type StoredAddress } from "../../security/customerAddress";
import { readCustomerAddressLimits } from "./customerAddressSchema";

class UpdateClientService {
  constructor(private readonly database: Pick<PoolClient, "query"> = pool) {}

  /** Address-only update, used inside CustomerAddressService's authorized transaction. */
  async updateAddress({ customer_id, restaurant_id, address, officialNeighborhood }: { customer_id: string; restaurant_id: string; address: unknown; officialNeighborhood?: string }) {
    if (!customer_id.trim() || !restaurant_id.trim()) throw new CustomerAddressError("forbidden");
    const limits = await readCustomerAddressLimits(this.database);
    const valid = normalizeDeliveryAddress(address, limits, officialNeighborhood);
    if (!valid) throw new CustomerAddressError("invalid");
    const result = await this.database.query<StoredAddress & { id: string; restaurant_id: string }>(
      `UPDATE public.customers SET city = $1, street = $2, number = $3, neighborhood = $4, complement = $5
       WHERE id = $6 AND restaurant_id = $7
       RETURNING id, restaurant_id, city::text AS city, street::text AS street, number::text AS number,
                 neighborhood::text AS neighborhood, complement::text AS complement`,
      [valid.city, valid.street, valid.number, valid.neighborhood, valid.complement, customer_id, restaurant_id],
    );
    const row = result.rows[0];
    if (result.rows.length !== 1 || row?.id !== customer_id || row.restaurant_id !== restaurant_id) throw new CustomerAddressError("forbidden");
    return row;
  }

  async execute({ id, name, phone, city, street, number, neighborhood, complement, restaurant_id }: CustomerData & { id: string; restaurant_id: string }) {
    const client = await this.database.query<CustomerRecord>(
      `UPDATE customers SET name = $1, phone = $2, city = $3, street = $4,
       number = $5, neighborhood = $6, complement = $7
       WHERE id = $8 AND restaurant_id = $9 RETURNING ${customerColumns}`,
      [name, phone, city, street, number, neighborhood, complement, id, restaurant_id],
    );
    return client.rows[0];
  }
}
export { UpdateClientService };
