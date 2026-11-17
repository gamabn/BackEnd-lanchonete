import type { Request, Response } from "express";
import { ProductInputError, requiredText } from "../../service/product/productValidation";
import { productUuid } from "../../service/productTemplates/configuredProductInput";
import { PrivateTemplateService } from "../../service/privateTemplates/PrivateTemplateService";

function uuid(value: unknown) {
  if (typeof value !== 'string' || !productUuid.test(value)) throw new ProductInputError("ID inválido.");
  return value.toLowerCase();
}
function metadata(body: Record<string, unknown>) {
  const name = requiredText(body.name, 'Nome do modelo');
  const description = body.description ?? '';
  if (Array.from(name).length > 200 || typeof description !== 'string' || description.includes('\0') || Array.from(description).length > 4000) {
    throw new ProductInputError("Nome deve ter até 200 caracteres e descrição até 4.000.");
  }
  return { name, description: description.trim() };
}
function expected(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) throw new ProductInputError("Informe a versão atual do modelo.");
  return value;
}
type Action = 'list' | 'get' | 'create' | 'rename' | 'version' | 'remove' | 'copy';
export class PrivateTemplateController {
  list = (req: Request, res: Response) => this.perform('list', req, res);
  get = (req: Request, res: Response) => this.perform('get', req, res);
  create = (req: Request, res: Response) => this.perform('create', req, res);
  rename = (req: Request, res: Response) => this.perform('rename', req, res);
  version = (req: Request, res: Response) => this.perform('version', req, res);
  remove = (req: Request, res: Response) => this.perform('remove', req, res);
  copy = (req: Request, res: Response) => this.perform('copy', req, res);

  private async perform(action: Action, req: Request, res: Response) {
    res.set('Cache-Control', 'no-store');
    if (!req.user_id) return res.status(401).json({ error: "Estabelecimento não autenticado." });
    try {
      const service = new PrivateTemplateService();
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const tenant = req.user_id;
      let result: unknown;
      if (action === 'list') result = await service.list(tenant);
      else if (action === 'create') result = await service.create(tenant, uuid(body.productId), metadata(body));
      else if (action === 'copy') result = await service.copy(tenant, uuid(body.templateId), expected(body.expectedVersion));
      else {
        const id = uuid(req.params.templateId);
        if (action === 'get') result = await service.get(tenant, id);
        else if (action === 'rename') result = await service.rename(tenant, id, metadata(body));
        else if (action === 'version') result = await service.version(tenant, id, uuid(body.productId), expected(body.expectedVersion));
        else result = await service.remove(tenant, id);
      }
      return res.status(action === 'create' || action === 'copy' || action === 'version' ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof ProductInputError) return res.status(error.status).json({ error: error.message, details: error.details });
      const code = (error as { code?: string })?.code;
      if (code === '23505') return res.status(409).json({ error: "Nome ou versão já existente. Recarregue os modelos." });
      if (code === '23503') return res.status(409).json({ error: "A operação possui dependências e foi revertida." });
      return res.status(503).json({ error: "Não foi possível concluir a operação de modelo privado." });
    }
  }
}
