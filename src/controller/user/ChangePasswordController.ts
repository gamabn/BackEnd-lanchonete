import type { Request, Response } from 'express'
import { ChangePasswordService } from '../../service/user/ChangePasswordService'


class ChangePasswordController {

  async handle(req: Request, res: Response) {
    const { email } = req.body
   // console.log(req.body)
   const changePassword = new ChangePasswordService();


    const passwordStore = await changePassword.execute({ email })
    return res.json(passwordStore)
  }

}

export { ChangePasswordController }