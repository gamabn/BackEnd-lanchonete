/** A typed name must be explicitly confirmed; profile suggestions never reach this path. */
export function normalizeCustomerName(value: unknown): string | undefined {
  if (typeof value !== "string" || /[\p{C}\r\n\t]/u.test(value)) return undefined;
  const name = value.normalize("NFC").trim().replace(/ +/g, " ");
  if (name.length < 2 || name.length > 80 ||
      !/^[\p{L}\p{M}]+(?:[ '’.-][\p{L}\p{M}]+)*\.?$/u.test(name)) return undefined;
  if (/^(?:menu(?: inicial)?|ver card[aá]pio|meus pedidos|adicionar(?: outro produto)?|remover(?: produto)?|voltar(?: ao carrinho)?|cancelar|confirmar(?: nome)?|corrigir(?: nome)?|finalizar(?: pedido)?|sim|n[aã]o|oi|ol[aá])$/iu.test(name)) return undefined;
  return name;
}
