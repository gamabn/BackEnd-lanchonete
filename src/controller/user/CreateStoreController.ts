import type { Request, Response } from 'express'
import { CreateStoreService } from '../../service/user/CreateStoreService'

class CreateUserController {

  async handle(req: Request, res: Response) {
    const { name, email, password, phone, city,  neighborhood, street, number } = req.body
   // console.log(req.body)
   const createStore = new CreateStoreService();

    const store = await createStore.execute({ name, email, password, phone, city,  neighborhood, street, number })
    return res.json(store)
  }

}

export { CreateUserController }