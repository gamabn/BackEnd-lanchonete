import type { Request, Response } from 'express'
import { GetStoreService } from '../../service/user/GetStoreService'



class GetStoreController {

  async handle(req: Request, res: Response) {
   

    const getStore = new GetStoreService();

    const store = await getStore.execute()

    return res.json(store)
  }

}
export { GetStoreController }