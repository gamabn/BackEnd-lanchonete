# WhatsApp local — etapa 8.5

Backend multi-sessão H.11: ver [endpoints, persistência e integração ao dashboard](../../../docs/whatsapp-multi-tenant.md).

## Pós-checkout e meus pedidos — H.10

Após sucesso confirmado ou recuperação de um pedido concluído, a conversa entra
em POST_CHECKOUT e libera o carrinho anterior. Oferece novo pedido, consulta de
pedidos, cardápio e menu principal. Oi/Menu/0 retornam ao menu sem reenviar uma
confirmação. Confirmações concorrentes já enfileiradas na mesma revisão continuam
respondendo com o mesmo código, sem tratar a duplicata como um novo pedido.

A intenção concluída permanece imutável, ativa no seu escopo e disponível para
replay. Para uma compra nova explícita, o menu cria um carrinho e um owner novos
e deriva um UUID interno de checkout a partir do escopo anterior e do pedido
concluído. Não troca GAMA_BOT_SESSION_ID, pasta Baileys, conta ou restaurante.
É o `session_id` interno das intenções seguintes que muda; não se deve filtrar
todas as compras futuras apenas pelo UUID original do ambiente em auditorias.
O UUID derivado é determinístico: retry/restart reencontra a mesma compra seguinte.
Após reinício, a recuperação percorre os escopos concluídos já existentes até a
compra mais recente ou uma intenção pendente, que exige apresentação de revisão.
Essa descoberta não registra novas intenções; nenhum trigger, schema ou regra
de substituição/idempotência foi alterado. A consulta inicial após restart cresce
com o histórico de compras da conversa; otimização de cursor fica para fase futura.

GET /order_item existente é administrativo e lista o restaurante inteiro.
Ele não foi exposto ao bot. GetOrderItemService ganhou listByCustomer, com
restaurant_id e customer_id obrigatórios no WHERE e vínculo com customers no JOIN.
A consulta WhatsApp reidentifica o cliente pelo telefone confiável da mensagem,
recusa identidade ausente/ambígua e retorna somente código, status e total dos
últimos 10 pedidos. Não há novo endpoint público ou leitura de dados pessoais.
Status reais: pending -> PENDENTE, enviado -> ENVIADO, completed -> CONCLUÍDO.
Não são criados estados EM PREPARO/ENTREGUE. Consulta vazia/falha mantém retorno
ao menu, e alterações de identidade durante a leitura descartam a resposta.

Validação manual futura: no host integrado já autorizado, fazer um pedido,
conferir evento no dashboard, voltar por Oi/0, consultar pedidos e iniciar outra
compra com carrinho vazio. Conferir os dois códigos distintos no banco e assegurar
que o primeiro não foi duplicado. Não iniciar workers concorrentes. Os testes
automatizados em whatsapp-post-checkout.cjs usam exclusivamente mocks; nenhuma
autenticação real ou pedido Neon é necessário para executar a suíte.

## Diagnóstico de autenticação nos dois modos — H.9.3

Os dois entrypoints carregam `.env` explicitamente com `dotenv/config`, sem
sobrescrever variáveis já exportadas. Antes disso, o isolado já carregava `.env`
indiretamente ao importar os serviços de banco; o aviso de que não carregava era
incorreto. `readLocalBotConfig` continua sendo um parser puro do ambiente fornecido.
Com o mesmo cwd e os mesmos GAMA_BOT_*, ambos resolvem o mesmo authDir absoluto e
contexto. Exports diferentes ou outro cwd podem mudar a resolução; não executar
`local.main` dentro da API para tentar compartilhar autenticação.

O Baileys instalado decide login versus novo registro por `creds.me`, não por
`creds.registered`. Uma sessão vinculada por QR pode ter `registered=false` e
`me.id` preenchido. O log agora informa identidade vinculada carregada usando
`me.id`, sem imprimir o identificador e sem modificar flags ou credenciais.
O adapter carrega/valida os JSONs antes de construir o socket em ambos os modos.

O isolado suprime console da libsignal; o host integrado preserva o console da
API. Logo, mais erros visíveis no integrado não comprovam uma autenticação
diferente. No código da libsignal, MessageCounterError pode significar mensagem
já descriptografada, reenviada após reinício antes do ACK; também não permite
concluir sozinho que faltam chaves. Não apagar chaves, copiar sessões antigas ou
forçar registered=true em resposta a esses avisos. Erros persistentes em mensagens
novas exigem diagnóstico adicional controlado; este ajuste não repara estados
criptográficos arbitrariamente nem modifica o console global da API.

Para repetir o teste, encerrar normalmente qualquer worker da conta, manter os
IDs e a pasta originais e aguardar liberação automática dos locks. Se permanecer
um lock, interromper a tentativa e investigar seu proprietário; não removê-lo.
No diretório do backend, iniciar somente o host integrado já autorizado e conferir
`identidade vinculada carregada` seguido de OPEN. Não escanear novo QR, confirmar
pedidos nem iniciar o isolado em paralelo. A investigação automatizada não inicia
nenhuma conexão e não altera as credenciais reais.

## Persistência da sessão — H.8

As credenciais continuam em `GAMA_BOT_AUTH_DIR/creds.json`, e as chaves em
`<tipo>-<id>.json`, usando os mesmos nomes e BufferJSON do Baileys. O adapter
`persistentAuth.ts` reutiliza esses arquivos, sem conversão em lote. Novas
gravações são serializadas, usam temporário 0600, fsync e rename no mesmo
diretório; remoções de chaves solicitadas pelo protocolo são sincronizadas.
JSON inválido, erro de leitura ou chaves existentes sem creds geram
`AUTH_FILES_INVALID`, preservando os arquivos. Não há reset silencioso.
Arquivos já corrompidos não podem ser reconstruídos automaticamente.

`creds.update` permanece ativo durante o fechamento. Reconexão aguarda trabalho
pendente e gravações de credenciais/chaves antes de criar outro socket.
Encerramento cancela backoff, aguarda construção de socket em andamento, encerra
o socket, drena mensagens e grava uma última cópia das credenciais. O lock só
é liberado após esse processo; falha de persistência mantém o lock para inspeção.

O vínculo `.session-bindings/<hash-do-contexto>.json`, fora do diretório Baileys,
impede trocar acidentalmente a pasta de um mesmo contexto/sessão. Reutilize os
mesmos IDs e diretório absoluto/resolvido. Mudanças explícitas de conta ou novo
pareamento após invalidação usam novo contexto e outra pasta; as antigas ficam
preservadas. Não iniciar a mesma conta em outro contexto concorrente.

Locks exclusivos por contexto e diretório bloqueiam duas instâncias no mesmo
armazenamento. No Fedora/Linux, o boot ID separa os locks de boots anteriores,
que não são apagados automaticamente. Um kill -9 no mesmo boot ainda deixa lock:
confirmar todos os processos parados antes de retirar somente os locks vazios
da sessão em `.session-locks/` e `.worker-<boot-id>.lock`. Um `.worker.lock`
legado é recusado e preservado: após conferir ausência de worker antigo, remover
somente esse lock vazio, nunca a pasta de autenticação. Em plataformas sem boot
ID Linux a recuperação de lock após crash continua manual. Não há coordenação
entre máquinas com sistemas de arquivos separados.

Desde a correção H.13 de 2026-11-17, novos locks contêm `owner.json` com
identificação da execução/processo e da aquisição. Não trate PID isolado como
prova de propriedade ou de lock órfão. A liberação normal verifica a aquisição
e só ocorre após drenagem; locks antigos vazios continuam preservados. O boot ID
não muda ao reiniciar Node. Para auditar sem conectar e para o procedimento manual
específico dos locks antigos observados, consulte
[`ops/whatsapp-session-audit.md`](../../../ops/whatsapp-session-audit.md).
O servidor consolida sinais repetidos e o fechamento de IPC pelo `ts-node-dev`
em uma única tarefa de encerramento; SIGKILL não permite drenagem.

Desconexões temporárias (408/428/503, falhas de rede) e restartRequired (515)
usam backoff de 1/2/4/8/16s; 60s estáveis restauram o orçamento. Credenciais não
são apagadas. 401/403/411/500 param com `REAUTH_REQUIRED` para conferir a sessão
no aplicativo e, se necessário, autorizar novo pareamento. 440 gera
`SESSION_REPLACED`: conferir outra instância antes de tentar reiniciar.

Teste manual futuro, somente com autorização para conectar WhatsApp:

1. Manter os IDs e a pasta existentes; definir checkout real como false e usar
   `npm run dev:bot`. Esperar restauração/OPEN sem novo QR quando a sessão for válida.
2. Encerrar com Ctrl+C e aguardar o processo terminar. Reiniciar com a mesma
   configuração e conferir restauração, sem apagar arquivos.
3. Interromper a rede brevemente e restaurá-la. Conferir backoff seguido de OPEN,
   sem novo pareamento. Durante backoff, testar Ctrl+C e reiniciar normalmente.
4. Em ambiente integrado previamente autorizado, repetir com
   `npm run dev:bot:integrated` e as flags exigidas pela H.7.4; não confirmar pedidos.

Não usar kill -9 como encerramento normal, não imprimir arquivos de credenciais
e não habilitar checkout real apenas para testar persistência. Teste automatizado:
`node tests/whatsapp-auth-recovery.cjs` usa sockets simulados e arquivos em /tmp;
importa apenas utilitários do SDK, sem abrir conexão real.

## Conectar pelo dashboard em desenvolvimento

No backend, rode:

```bash
NODE_ENV=development WHATSAPP_WORKER_ENABLED=true WHATSAPP_CONNECTION_ENABLED=true \
  WHATSAPP_REAL_CHECKOUT_ENABLED=false GAMA_BOT_API_HOST_ENABLED=false npm run dev
```

No diretório `Lanchonete_App`, aponte o Next.js para a API local:

```bash
NEXT_PUBLIC_API_LOCAL=http://localhost:3333 npm run dev
```

Entre no dashboard com o restaurante de teste, abra **WhatsApp** e clique em
**Conectar** para obter o QR. Sessões anteriormente habilitadas são restauradas na
inicialização. Para restaurar, mantenha o mesmo `WHATSAPP_AUTH_ROOT` (padrão
`.gama-whatsapp` na raiz do backend). Encerre outros workers que usam a mesma conta
antes de iniciar o dashboard. Em caso de conflito de lock, siga o
[procedimento de auditoria](../../../ops/whatsapp-session-audit.md).

O bot simulado usa o WhatsApp real para ler e responder mensagens. Use uma
conta de teste. A API e o bot ainda consultam dados existentes, como restaurante,
catálogo, cliente e endereço. Para testar retirada, use um cliente já cadastrado.
Para testar entrega, use um endereço já cadastrado e aceito pelo fluxo de entrega.
Na simulação, cadastro e alteração de endereço são bloqueados. A confirmação fica
em memória, sem gravar pedidos ou intenções de checkout, emitir `newOrder` ou
processar pagamentos. Baileys grava as credenciais locais e a API grava os
metadados das sessões locais para permitir restauração.

`WHATSAPP_CONNECTION_ENABLED` assume `false` quando ausente e habilita conexão
e restauração pelo painel quando vale `true`. As rotas também exigem
`WHATSAPP_WORKER_ENABLED=true`. O painel só aceita checkout simulado com
`NODE_ENV=development` e checkout real explicitamente falso ou ausente. Nos
demais ambientes, o painel exige checkout real explicitamente habilitado e o
preflight de persistência continua obrigatório.

## Host legado integrado da API — H.7.4

O host `ApiWhatsAppHost` executa Baileys no processo da API e recebe exatamente
o pool e o Socket.IO já criados em `server.ts`. Não cria servidor HTTP/Socket.IO
nem usa `local.main`, que altera console/sinais globalmente. O host não encerra
o pool ou Socket.IO ao parar o worker. A API aguarda o adapter configurado antes
de iniciar o bot; falhas do bot são diagnosticadas sem derrubar as rotas HTTP.

O host legado exige `WHATSAPP_WORKER_ENABLED=true`,
`GAMA_BOT_API_HOST_ENABLED=true` e
`WHATSAPP_REAL_CHECKOUT_ENABLED=true`, além das variáveis `GAMA_BOT_*` já exigidas.
O host legado recusa simulação. Valores padrão permanecem desativados.

Comando preparado para um teste controlado futuro, em terminal interativo:

```bash
# Configurar externamente GAMA_BOT_ENABLED=true, os IDs e GAMA_BOT_AUTH_DIR.
# DATABASE_URL deve usar gama_app; não colocar credenciais neste comando.
WHATSAPP_WORKER_ENABLED=true WHATSAPP_REAL_CHECKOUT_ENABLED=true npm run dev:bot:integrated
```

O script opta pelo host integrado; não altera .env. Ele inicia API e worker em
um único processo. Usar uma única instância e uma conta/contexto de teste, sem
outro `dev:bot` usando as mesmas credenciais. O armazenamento de autenticação
e `GAMA_BOT_SESSION_ID` devem ser preservados entre reinicializações para
recuperar o mesmo escopo de checkout. As credenciais permanecem em disco, com
lock/contexto existentes; não é uma solução de lease entre
réplicas. Não apagar pastas de autenticação. Não executar este comando sem
autorizar conexão real e eventuais pedidos. Nenhuma ativação foi realizada.

`startWhatsAppWorker()` e `stopWhatsAppWorker()` exportados por `server.ts`
permitem administrar o bot no processo existente sem encerrar HTTP. Não são
rotas públicas. Start/stop são serializados; parar aguarda mensagens pendentes,
persistência e credenciais antes de liberar o lock. Falha de drain mantém o lock.
Uma falha definitiva do worker libera recursos locais, mas não o reinicia
automaticamente. SIGINT/SIGTERM no modo integrado aguarda a parada do worker
antes de encerrar o processo inteiro. `npm run dev:bot` continua disponível para
simulação, com `WHATSAPP_REAL_CHECKOUT_ENABLED=false` ou ausente.

O dashboard usa `subscribeOrders` em `Lanchonete_App/src/app/util/ordersSocket.ts`:
após uma desconexão e reconexão, chama `onReconnect`. O componente Home chama
`router.refresh()`, a página `/dashboard` consulta novamente `/order_item`, e
Home reconcilia a prop `data` por `order_id`. Existe recuperação por consulta
após reconexão, mas não entrega garantida do evento: não há outbox/ack/reenvio,
reconciliação periódica ou nova tentativa automática de uma consulta que falhou.
COMMIT seguido de queda antes do evento, ou falha de emissão sem desconexão
visível no dashboard, pode exigir atualização manual. O primeiro connect também
não dispara o callback de reconciliação. Validar essas janelas no teste controlado;
nenhuma infraestrutura de mensageria foi adicionada nesta fase.

Testes sem conexões reais:
`node tests/whatsapp-api-host.cjs`, `node tests/whatsapp-api-bootstrap.cjs` e
`node tests/whatsapp-checkout-socket-mocks.cjs`.

## Checkout persistente — H.7.3

`WHATSAPP_REAL_CHECKOUT_ENABLED` assume `false` quando ausente. Somente os
valores literais `true` e `false` são aceitos. Desligada, a flag mantém a
confirmação simulada, sem carregar as dependências do checkout real.

Ligada, a inicialização exige pool com login efetivo `gama_app`, leitura das
colunas de clientes/pedidos usadas no preflight, grants da tabela de intenções
e a instância Socket.IO existente com namespace `/orders` configurado pelo host.
O preflight executa apenas SELECTs; não aplica migrations nem cria pedidos.
A identidade e a propriedade do cliente continuam sendo validadas por mensagem
e novamente na transação pelo authorizer existente.

O host da API usa `ApiWhatsAppHost`, descrito acima. `local.main` é reservado ao
CLI isolado, pois administra console e sinais do processo. O helper
`startConfiguredWhatsApp` de `checkoutStartup.ts` continua disponível para hosts
que administrem seu próprio ciclo de vida. Pool e Socket.IO pertencem ao host;
o worker não os cria nem os encerra.
Não importe `server.ts` para obter Socket.IO: isso iniciaria o servidor HTTP.

O comando `dev:bot` isolado não compartilha memória com a API. Com a flag ligada,
sem um host Socket.IO no mesmo processo, ele para com `REAL_CHECKOUT_UNAVAILABLE`
antes de carregar o SDK/conectar ao WhatsApp. Nunca volta silenciosamente à
simulação e nunca cria outro servidor Socket.IO. A flag não foi ativada em .env.

`newOrder` mantém a emissão após COMMIT confirmado; replay/recuperação não
reemitem. Socket.IO continua sem garantia de reenvio após falha do processo.
Teste sem rede: `node tests/whatsapp-checkout-startup.cjs`.

Um processo, uma conta e um contexto de teste. O worker não importa server.ts
nem inicia Express/Socket.IO. As opções de checkout estão descritas acima;
a confirmação permanece simulada por padrão.
O backend continua CommonJS; runtime.ts mantém import() nativo somente para Baileys
ESM. As dependências já instaladas são @whiskeysockets/baileys 6.7.23 e
qrcode-terminal 0.12.0; nenhuma instalação adicional é necessária nesta etapa.

## Iniciar

No diretório BackEnd-lanchonete, em terminal interativo sem gravação de sessão:

```bash
export GAMA_BOT_ENABLED=true
export GAMA_BOT_RESTAURANT_ID=00000000-0000-4000-8000-000000000001
export GAMA_BOT_SESSION_ID=00000000-0000-4000-8000-000000000002
export GAMA_BOT_AUTH_DIR=.gama-bot-dev/teste-local
npm run dev:bot
```

Os entrypoints carregam .env automaticamente. No Node 22, também é possível
selecionar explicitamente o arquivo para este processo:

```bash
node --env-file=.env -r ts-node/register src/messaging/worker/local.ts
```

Isso disponibiliza as variáveis do arquivo ao processo; não imprime seus valores
nem importa módulos comerciais. Variáveis já exportadas prevalecem sobre o arquivo.
Não use source/eval para interpretar o arquivo como comandos de shell. Os IDs
devem coincidir com o marcador existente; não apague autenticação para corrigir IDs.

IDs acima são exemplos sintáticos de teste; não são consultados no banco nem
autorizam acesso comercial. Use IDs exclusivos para esse teste, nunca IDs/segredos
de produção. Não há valores padrão: sem ativação explícita e configuração válida
o worker não abre conexão. Variáveis exportadas prevalecem sobre .env.

Escaneie o QR no aplicativo WhatsApp: Dispositivos conectados > Conectar dispositivo.
O QR aparece somente no terminal interativo e é apagado ao mudar de estado/sair.
Não redirecione saída, não use tee, gravação de terminal ou captura persistente.
O programa não grava QR ou logs em arquivo e desabilita os logs do SDK.
Também suprime console da libsignal no processo independente, pois essa dependência
imprime objetos de sessão diretamente. Os diagnósticos próprios são textos fixos.

Depois da indicação de conexão, use OUTRA conta WhatsApp para enviar Oi, Olá,
Menu ou outro texto ao número vinculado. Será apresentado o menu; 1, 2 e 3
retornam apenas avisos de desenvolvimento. Não existe transferência humana real.
Mensagens enviadas pela própria conta conectada são ignoradas.

Ctrl+C ou SIGTERM encerra sem logout e preserva credenciais para reiniciar com o
mesmo comando. Para revogar, remova o dispositivo no WhatsApp. Sessões revogadas,
inválidas ou substituídas não entram em reconexão infinita. Para novo pareamento,
com todos os workers parados, escolha OUTRA pasta vazia dentro de .gama-bot-dev/.
Não reutilize credenciais de outro restaurante/sessão.

## Persistência e limites

- Autenticação em arquivos locais, somente desenvolvimento. NÃO é solução para
  produção, Railway, múltiplos restaurantes, réplicas ou armazenamento criptografado.
- .gama-bot-dev/ é ignorada pelo Git; diretórios 0700 e arquivos novos sob umask 077.
  Marcador vincula a pasta ao contexto. Um lock exclusivo impede dois processos
  usando a mesma pasta. Após kill -9, um lock pode permanecer: confirme primeiro
  que nenhum processo usa aquela pasta, então remova manualmente apenas o diretório
  vazio correspondente à sessão/boot, conforme H.8 acima. Não remover credenciais.
- Não inicie a mesma conta em outras pastas/processos. Não há coordenação global
  de sessões, lease ou fencing nesta versão local.
- Somente messages.upsert notify sem requestId, texto simples/extendedTextMessage,
  destinos individuais @s.whatsapp.net ou @lid e timestamps posteriores ao início
  são processados. Mensagens com mais de 120s, grupos, broadcasts, status, eventos
  históricos e conteúdos não suportados são ignorados. Isso pode descartar mensagens
  legítimas atrasadas; o cliente deve enviar um novo texto.
- JIDs são opacos, não telefone autenticado. Nome de perfil é apenas sugestão.
- Deduplicação antes do envio, por sessão/conta/chat/mensagem, permanece entre
  reconexões no mesmo processo. Limite de 10 mil mensagens: para por segurança.
  Não persiste após reinício, não garante exactly-once; envios incertos não repetem.
- Reconexão: até cinco tentativas com 1/2/4/8/16s. Após 60s de conexão estável,
  o orçamento reinicia. Não há envio proativo ou destinatário configurável.
- Checkout real somente com a flag explícita e as dependências descritas acima;
  não há adaptação Telegram nem ativação automática em produção.

## Verificar sem parear ou conectar à rede

```bash
./node_modules/.bin/tsc --noEmit
node tests/whatsapp-local.cjs
node tests/messaging-validation.cjs
node --test tests/customer-access.cjs tests/order-security.cjs tests/data-isolation.cjs
git diff --check
```

Os testes importam o SDK sem abrir socket e simulam transporte/mensagens. Pareamento
e interoperabilidade real só podem ser confirmados após escanear o QR e testar
com outra conta. Não considerar aprovação automatizada como conexão comprovada.

## Diagnóstico seguro

Os entrypoints carregam .env, mas o parser exige configuração válida no ambiente
efetivo. Falhas mostram [bot:etapa] e código seguro:

- configuration / BOT_NOT_ENABLED, INVALID_TEST_IDS, AUTH_DIR_REQUIRED: conferir
  exports ou usar --env-file explicitamente.
- terminal / TTY_REQUIRED: abrir terminal interativo, sem pipe ou redirecionamento.
- qr_module / MODULE_NOT_FOUND ou esm_import / ERR_MODULE_NOT_FOUND: dependência
  não resolvida. Importação ESM não altera o CommonJS global.
- local_auth / LOCK_PRESENT: lock existe, mas o programa não afirma se é ativo
  ou obsoleto. Verificar processos antes de qualquer ação manual. Sem remoção
  automática de lock preexistente; somente lock adquirido pela execução é liberado.
- local_auth / CONTEXT_MISMATCH: IDs não correspondem à pasta existente.
- auth_load: leitura/criação do estado Baileys; auth_save: gravação de credenciais.
- connection / CLOSED: status numérico e causa allowlisted; EAI_AGAIN/ENOTFOUND
  indicam DNS, ETIMEDOUT timeout. UNKNOWN não é diagnóstico conclusivo.
- STATUS_401: logout; STATUS_440: outra conexão; STATUS_500: badSession;
  STATUS_411: incompatibilidade multidevice; STATUS_403: proibido. Param de status
  reflete o SDK e não substitui confirmação no aplicativo.
- STATUS_515 geralmente solicita reinício após pareamento; usa reconexão limitada.
- reconnect / RETRY_LIMIT: esgotou as cinco tentativas; saída com falha, preservando
  arquivos. O aviso de 16s é a quinta tentativa, não a causa original.

Não são impressos erro/stack brutos do SDK, caminhos, tokens, mensagens ou QR como
texto de log. Diagnósticos deixam de ser apagados a cada atualização; somente QR
temporário visível é limpo da tela. .context.json é um marcador, não prova de
pareamento. Sem creds.json não há credenciais salvas para restaurar nessa pasta.
