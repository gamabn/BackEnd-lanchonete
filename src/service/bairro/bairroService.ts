import { pool } from "../../database";
interface Bairro {
  bairro: string;
  valor: number;
  lanchonete_id: string;
}

export class bairroService {
  async criar({ bairro, valor, lanchonete_id }: Bairro) {
    const response = await pool.query(
      "INSERT INTO bairros(bairro, frete, lanchonete_id) SELECT $1, $2, id FROM restaurants WHERE id = $3 RETURNING id, bairro, frete, lanchonete_id",
      [bairro, valor, lanchonete_id],
    );
    return response.rows[0];
  }
  async getBairro(lanchonete_id: string) {
    const queryText = `
       SELECT id, bairro, frete, lanchonete_id FROM bairros WHERE lanchonete_id = $1 AND EXISTS (SELECT 1 FROM restaurants r WHERE r.id::text = bairros.lanchonete_id::text)
    `;
    const response = await pool.query(queryText, [lanchonete_id]);
    return response.rows; // Retorna o array com os bairros encontrados
  }

  async DeletarBairro(id: string, lanchonete_id: string) {
    const deletarBairro = await pool.query(
      `DELETE FROM bairros WHERE id = $1 AND lanchonete_id = $2 RETURNING id, bairro, frete, lanchonete_id`,
      [id, lanchonete_id],
    );
    return deletarBairro.rows[0];
  }
  async edit(id: string, bairro: string, frete: number, lanchonete_id: string) {
    const editBairro = await pool.query(
      `UPDATE bairros SET bairro = $2 , frete = $3 WHERE id = $1 AND lanchonete_id = $4 RETURNING id, bairro, frete, lanchonete_id`,
      [id, bairro, frete, lanchonete_id],
    );

    if (!editBairro.rows[0]) {
      return undefined;
    }
    return editBairro.rows[0];
  }
}
