import { pool } from "../../database";
import type { PoolClient } from "pg";
interface Bairro {
  bairro: string;
  valor: number;
  lanchonete_id: string;
}

export interface ListedBairro {
  id: string;
  bairro: string;
  frete: unknown;
  lanchonete_id: string | null;
  matches_address?: boolean;
}

export class bairroService {
  constructor(private readonly database: Pick<PoolClient, "query"> = pool) {}
  async criar({ bairro, valor, lanchonete_id }: Bairro) {
    const response = await this.database.query(
      "INSERT INTO bairros(bairro, frete, lanchonete_id) SELECT $1, $2, id FROM restaurants WHERE id = $3 RETURNING id, bairro, frete, lanchonete_id",
      [bairro, valor, lanchonete_id],
    );
    return response.rows[0];
  }
  async getBairro(lanchonete_id: string, neighborhood?: string, lock?: "share") {
    const queryText = `
       SELECT id, bairro, frete, lanchonete_id${neighborhood === undefined ? "" : ", lower(btrim(bairro)) = lower(btrim($2::text)) AS matches_address"}
       FROM bairros WHERE lanchonete_id = $1 AND EXISTS (SELECT 1 FROM restaurants r WHERE r.id::text = bairros.lanchonete_id::text)
       ${lock === "share" ? "FOR SHARE" : ""}
    `;
    const response = await this.database.query<ListedBairro>(queryText, neighborhood === undefined ? [lanchonete_id] : [lanchonete_id, neighborhood]);
    return response.rows; // Retorna o array com os bairros encontrados
  }

  async DeletarBairro(id: string, lanchonete_id: string) {
    const deletarBairro = await this.database.query(
      `DELETE FROM bairros WHERE id = $1 AND lanchonete_id = $2 RETURNING id, bairro, frete, lanchonete_id`,
      [id, lanchonete_id],
    );
    return deletarBairro.rows[0];
  }
  async edit(id: string, bairro: string, frete: number, lanchonete_id: string) {
    const editBairro = await this.database.query(
      `UPDATE bairros SET bairro = $2 , frete = $3 WHERE id = $1 AND lanchonete_id = $4 RETURNING id, bairro, frete, lanchonete_id`,
      [id, bairro, frete, lanchonete_id],
    );

    if (!editBairro.rows[0]) {
      return undefined;
    }
    return editBairro.rows[0];
  }
}
