# H.6B — registro durável e recuperação preparados, sem ativação

## Operações e limites

DurableCheckoutSessions é uma operação interna com banco injetado, sem pool padrão.
Não é importada nem chamada por conversationMenu/messages. A simulação continua
com as mesmas mensagens, sem flags de ativação, SQL novo no fluxo WhatsApp,
submissão comercial ou Socket.IO. Nenhuma migration foi alterada nesta etapa.

register(coordinator, authorization) utiliza a autorização H.2 e seu getter vivo,
com BEGIN SERIALIZABLE, reidentificação por telefone/restaurante e validação final
antes do COMMIT. Reutiliza prepareCheckoutIntent da H.4 e a mesma tabela/PK/hash.
Não insere pedidos. A preparação só fica DURABLE depois de COMMIT confirmado.
createRegisteredSubmission apenas monta o DTO H.5A após esse reconhecimento;
recusa registro pendente/incerto/falho e intenção conhecida como COMPLETED.
Não chama WhatsAppCheckoutSubmission.submit. A H.5A continua responsável por
revalidar autorização, snapshot, preços e intenção na transação da criação futura.

recover(identityGetter, intentId) não depende de carrinho/snapshot em memória.
Revalida contexto/sessão/conta/remetente/telefone atuais com o helper compartilhado
da H.2 e identifyCustomer. O cliente é obtido da consulta por telefone dentro do
restaurante, nunca do payload recuperado ou de texto. Faz a consulta da chave sob
FOR UPDATE na mesma transação curta e verifica a identidade antes e depois do
COMMIT. A recuperação não promove RECOVERABLE_FAILURE para PENDING.

- COMPLETED retorna o orderId original, sem draft para criação e sem consultar
  disponibilidade do catálogo. O replay do pedido exige autorização atual.
- PENDING/RECOVERABLE_FAILURE retorna review_required. Quando os dados são
  compatíveis, fornece um novo estado reconstruído para APRESENTAR revisão nova.
  Não restaura snapshot, autorização ou confirmação antiga.
- Ausência da chave retorna not_found/reuseSameKey. Não significa autorização para
  gerar outra chave nem prova que um registro concorrente não será commitado.
- 40001/40P01 e falhas de conexão retornam falha recuperável. A retomada usa a mesma
  chave e nova autorização; COMMIT_UNKNOWN nunca é tratado como rollback comprovado.

O estado reconstruído usa somente a identidade fresca do transporte. Dados do
checkout são verificados pelo hash e por roundtrip através de H.1/H.4. Alterar
carrinho, modalidade, pagamento ou endereço não pode adotar a chave antiga.
LiveCheckoutSession.presentRecoveredReview captura outro snapshot na apresentação
da revisão recuperada. Antes de qualquer criação futura, exigir nova confirmação,
autorização H.2 e revalidação H.3 no caminho H.5A. Não manter transação aberta para
apresentação, resposta ou envio WhatsApp.

## Geração da identidade e compatibilidade

A 008 permite propriedades adicionais no canonical_checkout (versão 1). Novas
intenções incluem identityRevision como inteiro seguro não negativo, coberto pelo
SHA-256 e pelo trigger de imutabilidade existentes. Não foi necessário ALTER TABLE,
nem campo de geração paralelo ao modelo H.4. As colunas de escopo/FKs continuam
protegendo restaurante e cliente; nenhuma intenção é transferida para outro dono.

Payloads antigos continuam legíveis. Se não possuem geração, recuperação pendente
retorna LEGACY_METADATA sem inventar geração zero; COMPLETED ainda pode informar
o pedido existente. Não reescrever hashes ou linhas históricas. Um rollback de código deve manter
o leitor do novo campo: versões anteriores não recalculam o mesmo hash das
intenções novas; nunca apagar/recriar chaves para contornar essa incompatibilidade. Novas tentativas
contra a mesma chave com conteúdo diferente conflitam, como antes.

A geração conhecida da sessão deve coincidir com a armazenada antes de reconstruir
uma revisão elegível. Divergência retorna IDENTITY_GENERATION_CHANGED, sem reset
silencioso. Após reinício, o futuro bootstrap precisa reconciliar essa baseline
com o registro durável e transporte validado antes de processar eventos. Nunca
reduzir uma geração já observada. O serviço retorna a geração armazenada, mas não
altera automaticamente a geração viva. A mudança de origem de metadados de telefone
continua sujeita às regras H.2/H.5B, sem usar telefone antigo como evidência atual.

## Chave, concorrência e falhas

A chave é criada na apresentação e registrada antes de permitir uma futura
confirmação real. REGISTERING impede registro concorrente da mesma preparação;
REGISTRATION_FAILED/COMMIT_UNKNOWN conservam a referência original. Mesmo um
rollback local não prova que outro worker não registrou a mesma chave. Não descartar
essa referência ou criar chave substituta automaticamente. Um registro repetido
usa INSERT ON CONFLICT + comparação de conteúdo H.4; processos diferentes são
coordenados pela unicidade/locks PostgreSQL, não só pelo lock local.

Se a identidade muda durante o registro, a H.2 rejeita/aborta; se mudar durante
COMMIT, a preparação não é marcada como atual. Após COMMIT incerto, reidentificar
e recuperar a chave original em conexão nova. Um registro inicial ainda invisível
pode aparecer como ausente: reconciliar/repetir o registro da MESMA chave/payload,
que espera a resolução da unicidade, sem concluir que uma chave nova é segura.

Os estados REGISTERING/DURABLE/COMMIT_UNKNOWN/REGISTRATION_FAILED são estados
locais do registro, não outro modelo de idempotência. O estado persistente continua
sendo PENDING/COMPLETED/RECOVERABLE_FAILURE na tabela H.4.

## Limitação histórica H.6B — resolvida na preparação H.6C

> A seção abaixo registra o estado H.6B. A extensão foi implementada na proposta
> 008 em H.6C, sem aplicação em produção: [contrato atual](gama-bot-active-intent.md).

A 008 armazena chave, escopo, geração no JSON e payload recuperável, mas não possui
um ponteiro para a intenção ativa. candidates retorna no máximo 20 chaves/estados,
com indicação de possível truncamento; nunca escolhe a mais recente ou por hash.
A recuperação automática após perda da chave ainda exige correlação durável
inequívoca. A ausência/ambiguidade interrompe a continuidade, sem fallback de criação.

A menor extensão proposta é um marcador active na própria tabela de intenções e
um índice único parcial por escopo enquanto active=true, sem segunda tabela de
idempotência. Sua transição precisaria ser atômica sob lock: não desativar uma
intenção incerta; concluir a reconciliação antes de ativar outra. Definir também
quando uma revisão é substituída e quando começa um pedido explicitamente novo.
Essa extensão NÃO foi implementada ou aplicada, nem no Neon nem nos testes.
Uma implementação futura deve revisar os grants/trigger e compatibilidade das
linhas existentes sem inferir automaticamente qual intenção histórica está ativa.

## Testes e condições para ativação

Os testes novos cobrem registro, recuperação com serviço novo e após reinício do
PostgreSQL, reconexão, repetição/concorrência, rollback, COMMIT incerto, escopo,
identidade/generação, checkout alterado, estado recuperável e pedido concluído.
Usam gama_app em cluster descartável privado em /tmp, sem TCP e sem pool global.
A preparação de fixtures/migrations é exclusiva desse cluster. Nenhuma chamada de
submissão ou criação foi adicionada ao fluxo da conversa.

Ficam pendentes: aplicar/verificar 008 no alvo somente mediante autorização;
resolver correlação ativa e baseline durável da geração no bootstrap; conectar
registro/recuperação ao transporte/sessão de forma explícita; apresentar revisão
recuperada e tratar todos os resultados; manter retries na mesma chave; integração
de estados reais e notificações pós-commit. Nenhuma dessas etapas foi ativada.

A recuperação concorrente com uma conclusão espera o lock ou recebe 40001; nesse
caso a próxima leitura, com a mesma chave, recupera COMPLETED. O teste real também
exercita essa disputa. A ausência de uma linha durante registro inicial incerto
continua sendo conservadora (não é usada para escolher/generar chave substituta).
