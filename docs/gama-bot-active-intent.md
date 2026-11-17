# H.6C — correlação durável da intenção ativa

Implementação interna preparada; não conectada ao worker. Nenhuma migration foi
aplicada no Neon. Confirmação e mensagens públicas continuam simuladas.

## Contrato e migration 008 proposta

A tabela H.4 permanece a única fonte de idempotência. A 008 adiciona `active`
(boolean, default false), `retired_at` (timestamptz) e `identity_revision` (bigint
STORED gerado do JSON canônico imutável). A geração deve ser um inteiro seguro JS
não negativo; metadado ausente permanece NULL e não pode ser ativado. Hash,
versão, escopo canônico, FKs compostas e estados existentes são preservados.

O índice `whatsapp_checkout_one_active_scope_idx` é UNIQUE em
`(restaurant_id,customer_id,session_id,account_id,sender_id) WHERE active`.
Participam **PENDING, RECOVERABLE_FAILURE e COMPLETED**, enquanto active=true.
Telefone e geração não integram a chave única: duas gerações/telefones não podem
abrir duas intenções nesse mesmo escopo. Ambos são conferidos na leitura e na
autorização; geração também participa do hash. Não se usa telefone global nem a
linha mais recente para escolher a intenção. O índice anterior cobre o histórico.

A trigger torna aposentadoria terminal e exige retired_at para desativar uma
linha ativa. COMPLETED permanece imutável, inclusive active/retired_at. Histórico
não é apagado. `gama_app` recebe UPDATE adicional apenas em active/retired_at;
coluna gerada não é gravável e vínculos/conteúdo continuam imutáveis. Não há
DELETE. Não se alteram migrations 001–007. O preflight lê colunas/expressões e
índices para detectar uma versão antiga já instalada: nesse caso, parar e planejar
upgrade separado; não reexecutar 008 nem inferir qual linha histórica é ativa.

## Operações e concorrência

`ActiveCheckoutSessions` estende a recuperação H.6B:

- `registerActive`: H.2 autoriza o estado vivo e registra/ativa na mesma transação
  curta SERIALIZABLE. Hash ou chave concorrente divergente falha; recuperar o
  vencedor pelo escopo antes de prosseguir. Nunca gerar chave alternativa em retry.
- `recoverActive`: reidentifica cliente via telefone do transporte, restaurante do
  contexto e SELECT FOR SHARE, consulta a única linha ativa FOR UPDATE e confere
  geração atual contra o histórico. Nenhum UUID prévio é necessário.
- `replaceActive`: exige chave e geração antigas conhecidas, nova revisão e nova
  autorização. Sob os mesmos locks, aposenta a antiga e ativa a nova atomicamente.
  Geração pode avançar, nunca diminuir. Conteúdo igual não exige nova intenção.
  Retry após COMMIT incerto aceita a mesma substituição já concluída, após validar
  o vínculo com a antecessora aposentada. Nunca sobrescreve payload.
- `invalidateActive`: exige geração viva e chave/geração esperadas; aposenta apenas
  intenção não concluída. Aposentadoria não remove histórico nem permite submissão.

Um advisory lock transacional por escopo serializa inclusive a ausência de linha.
O índice UNIQUE é a garantia final, independente desse lock. SERIALIZABLE pode
retornar 40001/40P01: repetir toda a operação com autorização nova e mesma chave;
não há loop cego nem transação esperando WhatsApp. A H.5A usa lock da mesma linha:
se concluiu antes da substituição, esta recusa COMPLETED; se foi aposentada antes,
`lockCheckoutIntent` recusa a submissão antiga. Erro de serialização também exige
releitura. As operações H.4 antigas continuam disponíveis para consumidores
históricos, mas a ativação futura deve usar obrigatoriamente o protocolo ativo.

COMMIT incerto não significa rollback. Recuperar em conexão nova pelo mesmo
escopo; se a substituição aparecer, reutilizá-la; se a antiga aparecer, revalidar
e repetir a mesma substituição. Se COMPLETED, retornar só orderId original, sem
draft, criação ou reemissão de eventos. Ausência/banco indisponível não autoriza
inventar checkout novo. A leitura de recuperação também pode ter COMMIT incerto.
Não se promete entrega exatamente uma vez de mensagens ou eventos.

## Reinício e identidade

`inspectBootstrap` recebe identidade atual do transporte e geração conhecida ou
NULL exclusivamente para um processo ainda não inicializado. Faz nova identificação
e consulta o baseline do mesmo escopo no banco. Histórico legado sem geração,
telefone divergente, geração conhecida divergente ou linha ativa incompatível
são rejeitados. Ausência de histórico retorna no_durable_generation: não infere zero.
O máximo do histórico é apenas baseline de geração, nunca seleção da intenção.

Para geração NULL, devolve challenge opaco de uso único. `reconcileBootstrap`
reidentifica o transporte e relê o banco em outra transação curta. Só então retorna
a geração; não restaura autorização, snapshot nem confirmação. Um challenge não
é credencial nem substitui o banco. `CheckoutIdentityBootstrap` prepara o gate para
futura ligação ao worker: só instala a geração antes da primeira mensagem, bloqueia
inicializações paralelas e rejeita mudança de transporte ou mensagem durante await.
Uma geração conhecida não é silenciosamente resetada.

O bootstrap atual cria LocalMessageProcessor uma vez antes de abrir/reabrir o socket;
reconexões no mesmo processo preservam essa instância. session_id vem da configuração
e deve permanecer estável no reinício. O menu ainda mantém sua geração local; NÃO
foi conectado automaticamente ao gate. Na ativação futura, propagar o baseline para
a sessão antes de qualquer mensagem comercial, preservando incrementos subsequentes.
A revisão recuperada sempre exige nova apresentação/snapshot e autorização nova;
antes de qualquer persistência futura, H.3 precisa revalidar tudo na transação H.5A.

## Testes e limites para ativação

`checkout-submission-postgres.cjs` cria cluster privado /tmp, sem TCP, comprova o
diretório e stubba o pool global. Aplica 003/006/007/008 apenas ali. Operações são
executadas com LOGIN gama_app, sem privilégios de owner; owner só prepara fixtures.
Cobre recuperação sem UUID, workers concorrentes, UNIQUE independente dos locks,
substituição por carrinho e geração, stale submission, reinício real do PostgreSQL
com serviço novo, reconexão, isolamento, rollback, COMMIT incerto, estados recuperável
e concluído. Os pedidos desse arquivo são exclusivamente fixtures/testes H.5A no
banco descartável, jamais originados pelo fluxo WhatsApp. O gate tem testes puros
para corrida de mensagens/transporte e ausência de carregamento de módulos de banco.

Pendências: implantação autorizada da 008 com preflight/schema real restaurado;
ligação explícita do gate/registro/recuperação ao worker e estados de revisão;
política de geração inicial sem histórico, sessão reconfigurada, troca de telefone
e histórico legado; reconciliação administrativa de identidades divergentes;
transição explicitamente autorizada para um NOVO pedido depois de COMPLETED (a
intenção concluída permanece ativa e não é silenciosamente substituída).
Após aposentadoria sem substituição, geração divergente também exige reconciliação
explícita, não novo registro automático. Não há habilitação por variável de ambiente.
Submissão real, publicação de eventos e próxima etapa dependem de autorização.
