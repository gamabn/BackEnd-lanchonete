# Etapa 8.6B.6.3A — consulta segura de cliente

Atualizado pela correção de compatibilidade 8.6B.6.3A.1.

## Escopo e investigação

Baileys permanece em 6.7.23. Não houve atualização, migração, acesso a linhas de
produção, cadastro de cliente, criação de pedido ou alteração de autenticação.

O esquema local de referência tests/fixtures/runtime-role-schema.sql define
customers.phone como TEXT e restaurant_id como UUID. CreateClientService grava
phone sem conversão; readCustomerData apenas remove espaços nas extremidades.
Não existe um contrato obrigatório de país/DDI nesses caminhos. Isso não confirma
a distribuição dos formatos atualmente armazenados no Neon; não foram consultados
telefones reais nem inspecionado o catálogo de produção nesta execução.

phoneIdentity.ts resolve remoteJidAlt, remoteJid telefônico, senderPn ou evento
phoneNumberShare. Somente mensagens diretas aceitas pelo normalizador encaminham
essa evidência ao quinto argumento de ConversationMenu.handle. O corpo da mensagem
não preenche esse argumento. O cache de compartilhamento pertence ao processor da
sessão/restaurante e distingue conta e LID; sockets antigos são ignorados.
Nenhuma mudança nesse caminho ou nos arquivos de conexão foi necessária.

## Normalização e segurança

normalizeCustomerPhone aceita dígitos e formatação simples (+ inicial, espaço,
parênteses, ponto e hífen). Preserva todos os dígitos e exige 7–15 dígitos com
primeiro diferente de zero. A normalização base não deduz país, não interpreta 00, não altera nono dígito
e não tenta correspondência por sufixo. A função brazilianNationalPhone gera
uma representação adicional somente para DDI 55 com DDD válido e número
geográfico fixo (8 dígitos, iniciado em 2–5) ou celular (9 dígitos, iniciado em 9).
Remove exclusivamente o DDI 55 dessa representação adicional; o número
internacional original permanece disponível. Nenhum outro país é convertido.

O telefone vindo do transporte precisa já estar em dígitos completos; origem
manual, formato inválido ou origem desconhecida não provocam SQL.

GetClientService.findByWhatsAppPhone exige restaurant_id e phone. SQL parametrizado
filtra obrigatoriamente restaurant_id = $1 e compara os dígitos completos com
o internacional $2 ou o nacional brasileiro $3, quando válido. A comparação
nacional aceita somente cadastros sem +, incluindo DDD entre parênteses.
A consulta única considera ambos os formatos antes de aplicar LIMIT 2, sem LIKE
ou comparação de últimos dígitos. Retorna id, restaurant_id e os
booleanos international_format e national_format; não retorna telefone, nome, endereço nem e-mail.
LIMIT 2 detecta multiplicidade, sem selecionar arbitrariamente a primeira linha.
O método execute existente e suas regras para a API não foram modificados.

Para vincular automaticamente é necessário exatamente um registro no restaurante:

- Internacional explícito, com + no início, como antes; ou
- Nacional brasileiro completo, gerado a partir do DDI 55 e validado como descrito.

Exemplos: WhatsApp +5577999999999 encontra 77999999999; WhatsApp +5521999999999
encontra 21999999999. Também é aceita formatação como (77) 99999-9999.
Uma coincidência internacional sem +, fora dessa exceção nacional, permanece
ambígua. Cadastros nacionais e internacionais distintos que correspondam ao mesmo
WhatsApp geram ambiguidade: nenhum tem preferência. Não se adiciona nem remove
nono dígito para tentar reconhecer números antigos.

O usuário informou que a consulta agregada real do Neon encontrou quatro números
nacionais brasileiros de 11 dígitos (três DDD 21 e um DDD 77). A correção usa esse
contexto sem consultar ou modificar registros no Neon nesta execução.

Referências de numeração: [Anatel — códigos nacionais e formato de fixos/celulares](https://www.gov.br/anatel/pt-br/regulado/numeracao/codigos-nacionais/perguntas-frequentes)
e [Anatel — nono dígito](https://www.gov.br/anatel/pt-br/regulado/numeracao/nono-digito).

## Conversa

Ao escolher 3 com carrinho preenchido, consulta apenas a evidência interna da
conversa. O estado guarda somente customerId quando há correspondência segura.
A chave da conversa inclui restaurante e a chave de sessão/conta/chat construída
pelo processor, além do remetente. Mensagens não podem escolher o restaurante.
O retorno do serviço também é conferido contra o restaurante solicitado.

Estados:
- CUSTOMER_LOOKUP: consulta pendente;
- CUSTOMER_FOUND: cliente único identificado;
- CUSTOMER_NOT_FOUND: nenhuma correspondência;
- CUSTOMER_IDENTIFICATION: identidade manual/ausente/inválida pendente de verificação;
- CUSTOMER_AMBIGUOUS: duplicidade ou formato sem país explícito;
- CUSTOMER_LOOKUP_ERROR: falha na consulta.

0 retorna ao carrinho em todos esses estados e limpa a associação temporária.
Uma resposta atrasada não sobrescreve retorno ao carrinho, nova consulta ou mudança
de telefone. Mudança da evidência telefônica invalida o customerId anterior.
Não há avanço para cadastro/checkout: os estados apenas apresentam as mensagens
desta etapa. Para repetir a consulta após erro, usar 0 e depois 3.

A consulta não emite credenciais de acesso à API nem altera customerAccess.
Exceções são convertidas em erro genérico sem registrar o conteúdo. Sem telefone
verificado, a mensagem pede confirmação e nenhum cadastro é consultado.

## Verificação executada

- npx tsc --noEmit: passou.
- node tests/whatsapp-customer-lookup.cjs: 24/24.
- node tests/whatsapp-phone-identity.cjs: 5/5 (expectativas ajustadas à consulta).
- node tests/customer-access.cjs: 10/10.
- node tests/messaging-validation.cjs: 16/16.
- node tests/whatsapp-local.cjs: 12/14; mesmas duas falhas legadas já documentadas
  na etapa anterior: initialReply comentado/não exportado e INITIAL_MENU antigo.
  Testes de autenticação, QR, locks, reconexão e encerramento passaram.

Os testes usam leitores/banco simulados; o teste SQL verifica projeção, escopo,
parâmetros, guarda de entrada e limite. Uma tentativa de iniciar PostgreSQL temporário para validar o SQL real foi
bloqueada pelo ambiente (criação de socket Unix não permitida). Os testes
não executam o SQL contra PostgreSQL real,
nem confirmam performance no Neon ou recebimento real do WhatsApp nesta etapa.
A expressão de normalização pode exigir varredura dos clientes do restaurante;
nenhum índice/migração foi adicionado. O timeout de conexão segue o pool existente.

## Teste manual no WhatsApp

Usar ambiente/restaurante de teste com dados já existentes, sem alterar produção.
1. Iniciar npm run dev:bot no terminal configurado com a sessão e conexão de banco
   existentes. Não modificar credenciais, autenticação ou locks para este teste.
2. De conta cujo telefone brasileiro esteja cadastrado uma única vez nesse
   restaurante (nacional com DDD 21 ou 77, ou internacional explícito), adicionar produtos simples/configuráveis e selecionar 3.
   Esperado: 'Encontramos seu cadastro', sem mostrar telefone ou dados pessoais.
3. Usar 0 e verificar itens, quantidades, variantes e adicionais preservados.
4. Com conta sem correspondência completa, conferir mensagem de cadastro necessário;
   enviar textos não deve criar cliente ou pedido.
5. Se houver dados de teste já duplicados, conferir confirmação pendente e ausência
   de escolha automática, inclusive duplicidade entre nacional e internacional.
   Um único nacional brasileiro válido deve ser encontrado; outros formatos
   internacionais sem + continuam pendentes.
6. Conferir que conta cadastrada apenas em outro restaurante não é vinculada.
   Repetir cada restaurante em sua própria sessão/diretório de autenticação.
7. Quando a conta entregar somente LID sem mapeamento/PN, conferir mensagem de
   confirmação. Digitar telefone ou restaurant_id não deve consultar clientes.
8. Em ambiente de teste com banco indisponível, conferir erro genérico; usar 0 e
   verificar o carrinho. Reconectar ao banco, voltar ao carrinho e repetir 3.
9. Conferir que logs e respostas não mostram telefones, LIDs, registros ou erros SQL.

Não é possível garantir apenas por texto que o WhatsApp entregue somente LID.
Nenhum cenário manual desta etapa foi executado pelo agente.
