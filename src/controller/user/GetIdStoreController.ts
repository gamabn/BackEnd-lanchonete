import type { Request, Response } from 'express'
import { GetIdStoreService } from '../../service/user/GetIdStoreService'



class GetIdStoreController {

  async handle(req: Request, res: Response) {

    try {
      const id = req.params.id

      if (!id) {
        return res.status(400).json({ error: 'ID é obrigatório' })
      }

      const getIdStore = new GetIdStoreService()
      const store = await getIdStore.execute(id)

      if (!store) {
        return res.status(404).json({ error: 'Loja não encontrada' })
      }

      return res.json(store)
    } catch (error) {
      console.error(error)
      return res.status(500).json({ error: 'Erro interno no servidor' })
    }
  }
}

export { GetIdStoreController }