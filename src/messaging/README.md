# Fundação de contratos — etapa 8.4A

Tipos/interfaces e validações runtime, sem implementação de motor, canal, worker,
API ou banco. Importar pelo index.ts; não importar server.ts nesta árvore.

- restaurant_id vem de infraestrutura autenticada. IDs em DTOs não autorizam acesso.
  Na integração futura, validar igualdade de restaurante/sessão/canal em todos os
  objetos aninhados e correspondência entre identidade e conta conectada.
- WhatsApp e Telegram têm namespaces distintos. subject_id e chat_id são opacos;
  telefone e nome de perfil não autenticam nem vinculam customers. profile_name
  é apenas sugestão. O nome precisa ser confirmado durante checkout.
- Navegação/carrinho não exigem cadastro. customer_id pode permanecer null; criação
  ou vinculação segura acontece no checkout. Um vínculo existente pode ser reutilizado.
- A API resolve city do restaurante e rejeita NULL, vazio ou cidade incompatível.
  Não usar cidade digitada pelo cliente como alternativa silenciosa. Cada restaurante
  atende sua própria cidade. neighborhood_id deve pertencer à lista do restaurante;
  a API resolve o nome canônico para address.neighborhood.
- DeliveryAddress preserva as cinco chaves do JSON existente. Complemento omitido
  pelo cliente é normalizado para null. A seleção por pedido não atualiza customers.
  O cadastro atual continua inalterado; requisitos do banco e da API serão tratados
  na futura integração. email_candidate não é e-mail verificado.
- Menus persistem o mapeamento número/alvo antes do envio. Validar números inteiros
  únicos, revisão/expiração, IDs reais, limites e contexto na futura implementação.
- Carrinho armazena escolhas, sem preços definitivos. A API valida quantidades,
  disponibilidade, limites, cidade/bairro, preço, frete, pagamento e pedido.
- O executor futuro precisa validar versão/época de controle, persistir estado e
  efeitos atomicamente e impedir respostas do bot durante atendimento humano.
  Resultado de envio unknown exige reconciliação; não garante exactly-once.
- Id/Instant são aliases, não valores já validados. validation.ts oferece validação
  runtime opt-in; não executa autenticação, autorização ou criptografia. Telegram
  é somente uma opção do tipo Channel.
- Operações comerciais, resultados assíncronos, persistência e ciclo de conexão
  serão especificados em etapas seguintes, sem duplicar regras do backend.

## Validação runtime — etapa 8.4B

Sem nova dependência. Os validadores rejeitam campos inesperados em todos os níveis,
não fazem coerção e lançam MessagingValidationError com caminho/código, sem valores
do payload. Usar objetos JSON simples, UUIDs canônicos minúsculos (versões 1–8),
instantes UTC no formato YYYY-MM-DDTHH:mm:ss.sssZ e revisões inteiras não negativas.
IDs externos continuam opacos, sem espaços, com no máximo 256 unidades UTF-16.

Limites exportados em VALIDATION_LIMITS: texto 4096, nome sugerido 120, rótulo 200,
50 opções/menu, números 1–999, 100 linhas/carrinho, quantidade 1–32767 e até 100
opções únicas/item. Endereço: cidade/bairro 120, rua 200, número 40, complemento
300; todas as cinco chaves obrigatórias, complemento null ou string (inclusive vazia).
Carrinho vazio é válido antes do checkout. Nenhum validador calcula preço.

validateNumericMenu valida estrutura e timestamp, inclusive para restaurar menus
expirados. resolveMenuChoice exige relógio atual explícito em milissegundos e
contexto/ID/revisão esperados do menu ativo carregado de armazenamento confiável.
Aceita somente a representação decimal exata de um número exibido. Nunca converter
entrada diretamente em ID. UUID bem formado não comprova existência ou propriedade
do recurso: somente a futura API pode conferir os IDs comerciais e limites reais.

assertConversationSession, assertMessageConversation e assertOutgoingConversation
conferem contexto aninhado, conta, remetente/destino e época de controle aplicável.
O contexto esperado e a sessão devem vir da infraestrutura autenticada, não do
payload. Esses guards não verificam plano, lease ativa, fencing ou permissão de API.
Validadores retornam a mesma referência; não autorizam uso posterior de objetos
mutáveis alterados. Persistência/executor deverão controlar esse ciclo de vida.

Nome confirmado/city_source são somente formato de contrato, não prova de origem.
A cidade válida do restaurante e bairro canônico devem ser resolvidos pela API;
restaurante sem cidade deve bloquear checkout. Validação estrutural não consulta
banco, valida e-mail/telefone como credencial nem altera cadastro/endereço/pedido.

Executar: node tests/messaging-validation.cjs e tsc --noEmit.
