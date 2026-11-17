import type { Pool, PoolClient } from "pg";
import { pool } from "../../database";
import {
  CustomerAddressError, isStoredAddress, normalizeDeliveryAddress, sameAddress,
  type StoredAddress, type DeliveryAddress, type AddressLimits, type AddressErrorKind,
} from "../../security/customerAddress";
import { brazilianNationalPhone } from "../../security/customerPhone";
import { GetClientService } from "./GetClientService";
import { UpdateClientService } from "./UpdateClientService";
import { readCustomerAddressLimits } from "./customerAddressSchema";
import { bairroService } from "../bairro/bairroService";
import { deliveryFee } from "../../security/deliveryFee";

export interface AddressOwner { customer_id: string; restaurant_id: string; phone: string }
export interface AddressRegionReference { bairro_id: string; fee: string }
export type AddressLoadResult = { kind: "loaded"; address: StoredAddress; limits: AddressLimits } | { kind: AddressErrorKind };
export type AddressSaveResult = { kind: "saved"; address: DeliveryAddress } | { kind: AddressErrorKind };

export class CustomerAddressService {
  constructor(private readonly database: Pick<Pool, "connect"> = pool) {}

  private async transaction<T>(owner: AddressOwner, lock: "share" | "update",
    operation: (client: PoolClient, original: StoredAddress, limits: AddressLimits) => Promise<T>): Promise<T> {
    if (!owner.customer_id.trim() || !owner.restaurant_id.trim() || !/^[1-9][0-9]{6,14}$/.test(owner.phone)) throw new CustomerAddressError("forbidden");
    const client = await this.database.connect();
    let discard = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '10s'");
      const reader = new GetClientService(client);
      const row = await reader.findAddressByOwner(owner, lock);
      if (!row || row.id !== owner.customer_id || row.restaurant_id !== owner.restaurant_id) throw new CustomerAddressError("forbidden");
      // The row lock pins this customer's phone while its ownership is checked again.
      const matches = await reader.findByWhatsAppPhone(owner);
      if (matches.length !== 1 || matches[0].id !== owner.customer_id || matches[0].restaurant_id !== owner.restaurant_id ||
          !(matches[0].international_format || (matches[0].national_format && brazilianNationalPhone(owner.phone)))) throw new CustomerAddressError("forbidden");
      const original: StoredAddress = { city: row.city, street: row.street, number: row.number, neighborhood: row.neighborhood, complement: row.complement };
      if (!isStoredAddress(original)) throw new CustomerAddressError("unsupported");
      const limits = await readCustomerAddressLimits(client);
      const result = await operation(client, original, limits);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      try { await client.query("ROLLBACK"); } catch { discard = true; }
      throw error;
    } finally { client.release(discard); }
  }

  private failure(error: unknown): { kind: AddressErrorKind } {
    return { kind: error instanceof CustomerAddressError ? error.kind : "error" };
  }

  async load(owner: AddressOwner): Promise<AddressLoadResult> {
    try {
      return await this.transaction(owner, "share", async (_client, address, limits) => ({ kind: "loaded" as const, address, limits }));
    } catch (error: unknown) { return this.failure(error); }
  }

  async save(owner: AddressOwner, expected: StoredAddress, address: unknown, region?: AddressRegionReference): Promise<AddressSaveResult> {
    try {
      return await this.transaction(owner, "update", async (client, original, limits) => {
        let officialNeighborhood: string | undefined;
        if (region) {
          const catalog = new bairroService(client);
          const rows = await catalog.getBairro(owner.restaurant_id, undefined, "share");
          const choices = rows.filter(row => row.id === region.bairro_id && row.lanchonete_id === owner.restaurant_id);
          const chosen = choices[0];
          if (choices.length !== 1 || !chosen || typeof chosen.bairro !== "string" ||
              deliveryFee(region.fee) !== region.fee || deliveryFee(chosen.frete) !== region.fee) throw new CustomerAddressError("region_changed");
          const equivalent = (await catalog.getBairro(owner.restaurant_id, chosen.bairro, "share"))
            .filter(row => row.lanchonete_id === owner.restaurant_id && row.matches_address === true);
          if (equivalent.length !== 1 || equivalent[0].id !== region.bairro_id) throw new CustomerAddressError("region_changed");
          officialNeighborhood = chosen.bairro;
        }
        const valid = normalizeDeliveryAddress(address, limits, officialNeighborhood);
        if (!valid || !isStoredAddress(expected)) throw new CustomerAddressError("invalid");
        // Idempotent retry: do not issue another UPDATE if this exact address is already stored.
        if (sameAddress(original, valid)) return { kind: "saved" as const, address: valid };
        if (!sameAddress(original, expected)) throw new CustomerAddressError("conflict");
        const saved = await new UpdateClientService(client).updateAddress({ ...owner, address: valid, officialNeighborhood });
        const normalized = normalizeDeliveryAddress({ city: saved.city, street: saved.street, number: saved.number, neighborhood: saved.neighborhood, complement: saved.complement }, limits, officialNeighborhood);
        if (!normalized || !sameAddress(normalized, valid)) throw new CustomerAddressError("invalid");
        return { kind: "saved" as const, address: normalized };
      });
    } catch (error: unknown) { return this.failure(error); }
  }
}
