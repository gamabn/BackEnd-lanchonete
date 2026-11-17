# Gama Bot — Etapa 8.6B.6.3B

## Comportamento

Se a consulta pelo WhatsApp e pelo restaurante retornar cliente inexistente,
ConversationMenu entra em CUSTOMER_NAME e pergunta o nome. O cliente digita o
nome, recebe o resumo e escolhe 1 para confirmar, 2 para corrigir ou 0 para voltar.
Nome de perfil do WhatsApp não é usado como nome confirmado.

normalizeCustomerName aplica NFC, remove espaços nas extremidades e reduz espaços
repetidos. Aceita nomes de 2 a 80 caracteres com letras Unicode, marcas de acento,
espaços, apóstrofos, pontos e hífens em posições previstas. Rejeita comandos de
menu, números, caracteres de controle, quebras de linha e entradas excessivas.
Não se trunca o nome para contornar limites do banco.

Nenhuma gravação acontece antes do 1 explícito no estado de confirmação.
O nome preparado fica vinculado à identidade telefônica da conversa. Se o telefone
mudar, o rascunho e a associação anterior são descartados e a identidade é consultada
novamente. Nome e telefone digitado manualmente não verificam uma identidade.

Estados adicionados:

- CUSTOMER_NAME: aguardar nome;
- CUSTOMER_NAME_CONFIRM: aguardar confirmação explícita;
- CUSTOMER_NAME_CORRECT: receber correção;
- CUSTOMER_REGISTERING: operação em andamento;
- CUSTOMER_REGISTERED: cadastro inicial concluído;
- CUSTOMER_REGISTRATION_ERROR: erro ou incompatibilidade com cadastro parcial.

Cliente existente permanece em CUSTOMER_FOUND, com customerId, sem coletar nome
ou sobrescrever cadastro. O identificador também é guardado após cadastro novo.
0 retorna ao carrinho em todos os estados e limpa o rascunho. Nenhum item,
quantidade, variante ou adicional é modificado por esse fluxo. Como na consulta
anterior, ao sair com 0 a associação temporária é limpa e uma nova finalização
consulta novamente o cadastro.

## Compatibilidade com PostgreSQL

A fixture local tests/fixtures/runtime-role-schema.sql define city, street, number,
neighborhood e complement como TEXT nullable. A interface CustomerData da API,
por outro lado, exige city; não foi afrouxada e o cadastro existente da API continua
com a mesma assinatura e validação.

A tentativa de ler somente os metadados do Neon nesta execução não conseguiu
conectar. Portanto, a compatibilidade do banco real NÃO está confirmada. Não houve
consulta de registros reais nem gravação no Neon pelo agente.

O método novo CreateClientService.createInitialForWhatsApp verifica os metadados
reais, em tempo de execução, antes de inserir:

- Os cinco campos de endereço devem existir e permitir NULL.
- Nome e telefone precisam ser textuais e comportar o conteúdo completo, incluindo
  o + internacional. Tipo numérico ou limite insuficiente não é contornado.
- Outros campos obrigatórios precisam ser os três campos fornecidos ou possuir
  default/geração pelo banco.
- Metadados ausentes, não acessíveis ou incompatíveis bloqueiam a gravação.

Se compatível, insere nome confirmado, telefone internacional com + e restaurant_id,
com NULL explícito nos cinco campos de endereço. Não usa endereços fictícios nem
defaults de endereço. Retorna somente id e restaurant_id. NOT NULL ou CHECK que
rejeite o registro parcial provoca rollback e mensagem de indisponibilidade; outras
falhas são genéricas. Nenhuma constraint, trigger ou configuração é alterada.

Para confirmar o esquema real, o operador pode executar o arquivo somente de
leitura ops/customer-initial-registration-check.sql no Neon SQL Editor. Ele mostra
colunas, restrições e triggers, sem consultar dados de clientes.

Se o banco exigir endereço, a proposta para outra etapa é revisar os consumidores
de perfis incompletos e preparar uma migração específica para tornar os campos de
endereço opcionais no perfil, mantendo as exigências do endereço no checkout.
Essa proposta exige revisão e autorização antes de qualquer alteração de esquema.
Nenhuma migração foi escrita ou executada nesta etapa.

## Concorrência e isolamento

CreateClientService utiliza a conexão da mesma transação em GetClientService.
A operação começa em READ COMMITTED, adquire pg_advisory_xact_lock por restaurante
e telefone internacional e então repete a consulta de correspondências brasileiras
e internacionais. Se um cliente foi criado após a busca inicial, apenas reutiliza
o ID de uma correspondência segura e única; não altera o nome desse cliente.
Duplicidades ou números ambíguos impedem INSERT. A consulta continua obrigatoriamente
filtrada por restaurant_id. O INSERT verifica a existência do restaurante e o ID
retornado precisa pertencer ao mesmo restaurante.

Repetições de 1 na mesma conversa ficam em CUSTOMER_REGISTERING ou no resultado
concluído. Entre conversas/processos que usam este método, a trava do PostgreSQL
serializa a operação e a segunda transação encontra o cadastro já criado.
A trava não é compartilhada pelo cadastro da API existente ou por scripts externos;
sem uma constraint única adequada, outros escritores não cooperantes ainda podem
produzir duplicidades. Não foi introduzida uma garantia global via migração.

A transação usa lock_timeout de 5s e statement_timeout de 10s, sem alterar o pool
global. Rollback que falhar descarta a conexão. Erro de unicidade não revela a
linha conflitante. Se a resposta de COMMIT for incerta, o bot não repete INSERT
automaticamente; voltar com 0 e tentar finalizar novamente recupera por consulta.

Depois de confirmar, voltar com 0 enquanto a transação está em andamento não
cancela uma gravação já autorizada: ela pode concluir. A resposta atrasada não
sobrescreve o estado do carrinho. Nova finalização consulta o banco novamente.

Não são emitidos tokens da API, nomes de outros cadastros ou detalhes de banco.
Logs do fluxo não incluem nomes, telefones ou LIDs. O nome digitado aparece somente
na resposta de confirmação solicitada, na própria conversa.

## Validação executada

- npx tsc --noEmit: passou.
- node tests/whatsapp-customer-registration.cjs: 24/24.
- node tests/whatsapp-customer-lookup.cjs: 24/24.
- node tests/customer-access.cjs: 10/10.
- node tests/whatsapp-phone-identity.cjs: 5/5.
- node tests/messaging-validation.cjs: 16/16.
- node tests/whatsapp-local.cjs: 12/14, mantendo as duas expectativas legadas
  incompatíveis com initialReply/menu inicial. Autenticação, locks locais, QR,
  reconexão e encerramento simulados passaram.

Os testes de cadastro utilizam banco simulado, incluindo transação, espera de
trava, reconsulta, commit e rollback. Cobrem nomes, confirmação/correção, estados,
cliente existente, duplicidades, concorrência, falhas, nullabilidade, telefone não
verificado, isolamento, preservação do carrinho e ausência de PII nos diagnósticos.
Não validam execução real do SQL, restrições/triggers do Neon ou WhatsApp real.

## Roteiro manual

1. Executar a inspeção de esquema somente de leitura no Neon SQL Editor. Confirmar
   a nullabilidade dos cinco campos e revisar defaults, CHECKs e triggers. Se houver
   bloqueio, não alterar o banco nesta etapa: o fluxo deve informar indisponibilidade.
2. Iniciar npm run dev:bot com a configuração existente de restaurante/sessão, sem
   mudar a autenticação, locks ou Baileys (permanece 6.7.23).
3. De uma conta de teste com telefone verificado e sem cadastro nesse restaurante,
   adicionar produto simples e produto configurado com quantidade/adicionais.
   Escolher 3 e conferir a pergunta do nome.
4. Enviar vazio, número de menu ou nome excessivo: deve pedir nome válido. Enviar
   João Silva: deve apresentar 1 confirmar / 2 corrigir / 0 voltar, sem gravar ainda.
5. Escolher 2, corrigir o nome e depois 1. Em banco compatível, deve concluir somente
   o cadastro inicial. Conferir o registro no restaurante de teste: nome confirmado,
   telefone internacional e endereço NULL. Nenhum pedido deve existir por esse fluxo.
6. Repetir 1: não deve criar outro cadastro. Usar 0, conferir todo o carrinho e
   finalizar novamente: deve reconhecer o cliente sem pedir nome.
7. Usar cliente já existente: deve pular o nome e manter o ID, sem alteração do perfil.
   Duplicidades de teste devem impedir escolha automática, inclusive entre formatos.
8. Testar outra sessão/restaurante com autenticação própria. Não deve reutilizar
   cliente ou rascunho da primeira sessão. Apenas LID sem PN/mapeamento, ou telefone
   digitado manualmente, não pode liberar a gravação.
9. Em ambiente de teste com banco indisponível, conferir erro genérico e retorno
   com 0 preservando carrinho. Não apagar credenciais para forçar o cenário.
10. Conferir que logs não mostram nomes, telefone completo, LID ou erros SQL.

Nenhuma etapa de endereço, taxa, entrega/retirada, pagamento ou pedidos foi
implementada. A próxima etapa do checkout permanece fora deste trabalho.
