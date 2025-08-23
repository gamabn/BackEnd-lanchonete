import { pool } from "../../database";

class EditStatusService{

  async execute({ id, status }: { id: string, status: boolean }) {
    const updatedStore = await pool.query(
      `UPDATE restaurants SET 
        status = $1
      WHERE id = $2 RETURNING *`,
      [status, id]
    );

    return updatedStore.rows[0];
  }

}
export { EditStatusService }