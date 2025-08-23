import { pool } from "../../database";

interface ClientRequest {
  restaurant_id: string;
  phone: string;
}



class GetClientService {
  async execute({ restaurant_id, phone }: ClientRequest) {
    const clients = await pool.query(
      "SELECT * FROM customers WHERE restaurant_id = $1 AND phone = $2",
      [restaurant_id, phone]
    );
    return clients.rows;
  }
}

export { GetClientService };
