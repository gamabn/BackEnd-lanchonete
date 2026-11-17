# Etapa 8.6B.6.8 — menu inicial personalizado

## Arquivos alterados nesta etapa

- `src/messaging/core/initialMenu.ts` (novo): formatação centralizada e carregamento com cache.
- `src/messaging/core/conversationMenu.ts`: integração em todos os retornos ao menu e validação de disponibilidade antes das ações do estado MENU.
- `src/messaging/channels/whatsapp/messages.ts`: remoção dos contratos antigos comentados e injeção opcional de ConversationMenu para testar o processador real sem persistência externa.
- `tests/whatsapp-initial-menu.cjs` (novo): saudação, endereço parcial, bloqueios, erros, navegação, preservação e concorrência.
- `tests/whatsapp-local.cjs`: testes atualizados para o contrato ativo de ConversationMenu.
- `tests/data-isolation.cjs`: expectativa SQL corrigida para o alias existente de products.
- Este relatório.

## Funcionamento

`buildInitialMenu` é a única função que formata a saudação. As opções continuam exatamente 1 (cardápio), 2 (meus pedidos) e 0 (menu inicial). O nome recebe destaque com asteriscos do WhatsApp. Cada campo ausente ou inválido é omitido individualmente, sem vírgulas sobrando. Valores objetos, null, undefined, strings equivalentes e caracteres de controle não aparecem na mensagem.

`InitialMenu` recebe diretamente o leitor existente `GetIdStoreService`, que executa o SELECT parametrizado em restaurants. A instância padrão de ConversationMenu reutiliza o leitor já disponível para retirada; não há HTTP, endpoint novo ou alteração no serviço. O ID vem exclusivamente do contexto WhatsApp já validado e passado a `handle`; a mensagem do cliente não escolhe restaurante. O resultado deve possuir o mesmo ID solicitado.

Todas as referências ativas a INITIAL_MENU foram substituídas pelo carregamento centralizado. A primeira interação que antes mostrava o menu e os retornos ao menu usam a mesma mensagem. Os comandos que já navegavam diretamente mantêm sua lógica. Não foi reintroduzida initialReply: ela pertencia a uma implementação comentada e não era utilizada pelo processador.

A regra de disponibilidade segue `status === true`, já usada no sistema e na retirada. Registro ausente, ID divergente ou status diferente de true impedem a saudação e as ações de MENU. Endereço parcial ou ausente não bloqueia restaurante aberto. Em falha de consulta, registra-se somente `[bot:initial_menu] motivo=RESTAURANT_LOOKUP_ERROR`, sem erro bruto, IDs, credenciais ou dados pessoais. A resposta pede nova tentativa e não apresenta opções que contornem o bloqueio; erros não são armazenados em cache.

## Cache

Cache em memória por instância de ConversationMenu, indexado exclusivamente por restaurantId, com até 200 resultados bem-sucedidos e validade de 30 segundos a partir da leitura concluída. A próxima consulta após expirar atualiza nome, endereço e disponibilidade. Consultas simultâneas do mesmo restaurante compartilham a promessa pendente; restaurantes diferentes não compartilham resultados. Não existe variável global com o último restaurante. Não são feitas consultas de saudação em mensagens de checkout, endereço ou retirada. O cache não altera a reconsulta obrigatória da confirmação PICKUP.

Limite explícito: mudanças de nome/endereço/status podem levar até 30 segundos para aparecer no menu de uma instância que já tenha uma leitura válida. Não há uso de dados expirados como fallback em caso de erro.

## Regressões investigadas

No início desta etapa, `conversationMenu.ts` continha uma função buildInitialMenu parcial e a constante INITIAL_MENU comentada, mas 13 referências ainda ativas. Isso causava 13 erros TS2304. A integração centralizada corrige esse defeito dentro do escopo solicitado.

As duas falhas antigas de whatsapp-local eram expectativas de uma implementação abandonada: initialReply não era exportada e o teste ainda esperava três placeholders, incluindo falar com atendente. Os testes agora exercitam ConversationMenu e LocalMessageProcessor reais, com leitor de restaurante simulado. A opção 2 continua sendo o placeholder real de consulta a pedidos; a opção 1 não foi alterada.

A falha antiga de data-isolation foi reproduzida antes da implementação: a expressão esperava `WHERE restaurant_id = $1`, mas o SQL existente utiliza `FROM public.products p` e `WHERE p.restaurant_id = $1`. A expectativa agora verifica a tabela, o alias correto e os parâmetros completos. Nenhum código de catálogo foi alterado.

## Validação

- `npx tsc --noEmit`: passou.
- `git diff --check`: passou.
- Execução direta com `node tests/<suite>.cjs`:

| Suíte | Resultado |
| --- | --- |
| whatsapp-initial-menu | 10/10 |
| whatsapp-local | 14/14 |
| whatsapp-fulfillment | 15/15 |
| whatsapp-address | 26/26 |
| whatsapp-delivery-regions | 21/21 |
| whatsapp-neighborhood-selection | 21/21 |
| whatsapp-pickup | 57/57 |
| whatsapp-customer-lookup | 24/24 |
| whatsapp-customer-registration | 24/24 |
| whatsapp-phone-identity | 5/5 |
| messaging-validation | 16/16 |
| data-isolation | 19/19 |

Total: 252 testes aprovados. Testes de carrinho/configurações, alternância de modalidade e preservação de checkout estão incluídos em fulfillment e pickup. Dependências externas usam mocks; na execução das regressões também foi usado um preload temporário que bloqueia query/connect reais de pg.Pool. Nenhum dado real do Neon foi alterado. Nenhuma falha remanescente nas suítes acima. Suítes que exigem PostgreSQL real não foram executadas.

## Teste real no WhatsApp

1. Com um restaurante de teste aberto e endereço preenchido, enviar Oi. Conferir nome destacado, rua, número, bairro, cidade e opções 1/2/0 contra o cadastro real.
2. Entrar no cardápio e retornar ao menu pelas opções já existentes. A saudação deve permanecer consistente.
3. Adicionar produto simples e configurado, com quantidade e adicionais; abrir o carrinho e enviar 0. Conferir a saudação; reabrir o carrinho e conferir todos os itens e valores.
4. Percorrer DELIVERY e PICKUP e conferir que cadastro, endereço do cliente, bairro, frete e confirmação de retirada mantêm o comportamento validado.
5. Repetir simultaneamente em outro restaurante/sessão de teste: cada conversa deve mostrar seu próprio nome e endereço.
6. Em cadastro de teste com endereço parcial, conferir que somente os campos disponíveis aparecem; sem endereço, conferir nome e opções.
7. Alterar nome/endereço pelo painel de teste, aguardar mais de 30 segundos e enviar 0: conferir a atualização.
8. Fechar o restaurante de teste, aguardar a expiração e retornar ao menu: deve informar indisponibilidade; 1 e 2 não devem contornar o bloqueio. Reabrir e tentar novamente.
9. Em ambiente controlado, simular erro de leitura e registro ausente: resposta segura sem dados antigos/estrangeiros; restaurar e confirmar recuperação.

A validação real pelo WhatsApp não foi executada nesta implementação. Não houve mudança de schema, migrations, clientes, endereços, pedidos, pagamentos, frete ou OrderSalesService.
