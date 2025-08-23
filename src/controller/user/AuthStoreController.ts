import type { Request, Response } from 'express'
import { AuthStoreService } from '../../service/user/AuthStoreService'


class AuthStoreController {

  async handle(req: Request, res: Response) {
     const { email , password} = req.body
   // console.log(req.body)

    const getStore = new AuthStoreService();
    const store = await getStore.execute({ email , password})
    return res.json(store)



  }

}


export { AuthStoreController}