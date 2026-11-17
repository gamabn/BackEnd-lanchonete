# WhatsApp multi-restaurante — H.11

## Backend

`TenantWhatsAppSessionManager` cria um ApiWhatsAppHost por proprietário. Cada host
possui seu processor Baileys, resolução de telefone, ConversationMenu, carrinhos,
checkout persistente, QR e locks. Todos recebem o pool e o Socket.IO existentes
da API. `newOrder` mantém `/orders` e a sala do restaurante persistido, após COMMIT.
Não há novo servidor Socket.IO, endpoint público de pedidos ou migration.

O JWT de AuthStoreService é obrigatório: Bearer HS256, sujeito UUID de restaurante,
expiração válida e sem audience de outra finalidade. O backend confirma o sujeito
em restaurants. Params, query e body não podem escolher outro restaurante.

## Endpoints

Todos usam `Authorization: Bearer <token-do-proprietário>` e retornam
`Cache-Control: no-store, private`. Nenhum requer restaurant_id no frontend.

| Método | Endpoint | Resultado |
| --- | --- | --- |
| POST | /whatsapp/connect | 202; inicia ou reutiliza a conexão do proprietário |
| GET | /whatsapp/status | 200; restaurant_id, status, qr_available e error |
| GET | /whatsapp/qr | 200; qr e expires_at, ou ambos null |
| POST | /whatsapp/disconnect | 200; para somente o worker desse restaurante |

Status: disconnected, connecting, qr_required, connected, reconnecting, error.
`legacy_active` informa um worker do antigo modo integrado; connect/disconnect
retornam 409 LEGACY_WORKER_ACTIVE nesse caso, sem interferir nele.

O QR é a única informação de pareamento exposta, exclusivamente ao proprietário,
no endpoint dedicado. É mantido apenas em memória, com validade local máxima de
60s e substituição a cada novo evento do SDK. Não registrar, persistir, compartilhar
ou enviar esse payload para serviços externos de geração de imagens. Renderizá-lo
localmente no dashboard e substituir o QR ao fazer polling. Status não contém QR.
Connected, erro, desconexão e encerramento invalidam o QR; callbacks antigos são
ignorados. Credenciais, chaves, telefone, JID, session_id e caminhos internos não
fazem parte das respostas.

Disconnect fecha o transporte, drena operações e libera o lock seguro. Não chama
logout, não desvincula o dispositivo remotamente e não apaga credenciais. Reconnect
reutiliza a mesma sessão. É distinto de remover o dispositivo no aplicativo.

## Configuração e recuperação

- `WHATSAPP_REAL_CHECKOUT_ENABLED=true` é a configuração global necessária para
  os hosts gerenciados; false bloqueia start com 503 REAL_CHECKOUT_DISABLED, sem
  fallback. É configuração do servidor, não uma variável por restaurante.
- `WHATSAPP_AUTH_ROOT` é opcional; recomenda-se caminho absoluto em volume privado
  persistente. O padrão é `.gama-whatsapp` na raiz do backend, inclusive no build.
- Não são necessários GAMA_BOT_RESTAURANT_ID, GAMA_BOT_SESSION_ID, GAMA_BOT_ENABLED
  ou GAMA_BOT_AUTH_DIR para restaurantes conectados pelo dashboard.
- A sessão inicial tem UUID determinístico por restaurante e depois é preservada
  no manifesto. Isso mantém o mesmo contexto/diretório mesmo em starts concorrentes.
- Metadados não secretos ficam em `.tenants/<restaurant_id>.json`: versão,
  restaurantId, sessionId e enabled. Escrita atômica 0600, sem QR ou credenciais.
- Credenciais ficam em `<root>/<restaurant_id>/<session_id>/`, utilizando o adapter
  atômico e os locks existentes. Não mover/apagar as pastas ou mudar o volume/root.
- O startup restaura somente manifestos enabled, após configurar Socket.IO/adapter
  e validar proprietário e dependências. Manifesto inválido de A é preservado e não
  bloqueia B. Erros de um host não encerram as rotas HTTP nem outro restaurante.
- Disconnect persiste enabled=false. Shutdown do servidor preserva enabled para
  restaurar após reinício e aguarda os workers sem encerrar recursos compartilhados
  por uma operação individual de restaurante.

Persistência em filesystem é deliberada nesta fase. Operar um único host de workers
responsável por esse volume, com backup e permissões restritas. Não há lease
distribuído entre máquinas, roteamento de comandos/QR entre réplicas ou cofre de
credenciais. Redis de Socket.IO distribui eventos, não substitui essas funções.
Antes de escalar instâncias, definir esse responsável; não iniciar managers em
máquinas diferentes para a mesma conta. Utilizar números WhatsApp distintos para
restaurantes distintos.

## Desenvolvimento existente

`dev:bot` e `dev:bot:integrated` permanecem disponíveis com a configuração anterior.
Sessões dessas ferramentas não são importadas, copiadas nem apagadas pelo manager.
O restaurante reservado pelo host integrado legado não pode iniciar outro host
gerenciado no mesmo processo. O manager não detecta todos os workers externos;
antes de conectar uma conta já usada em desenvolvimento, encerrar seu worker com
segurança e reconciliar qualquer checkout de resultado incerto. Não remover locks
ou credenciais para contornar conflitos.

## Integração pendente no dashboard

Adicionar conectar/desconectar, estado da sessão e renderizador QR local.
Se o JWT estiver no cookie HttpOnly do frontend, usar um proxy autenticado no
servidor Next, como o de socket-ticket, validando a origem das operações POST;
não disponibilizar esse token ao JavaScript do navegador.
Após
POST connect, consultar status/QR periodicamente (por exemplo, a cada 2–3s apenas
enquanto a tela estiver ativa), substituir o QR e descartá-lo ao conectar/sair.
Tratar 401, 403, 409 e 503; não reenviar starts em loop quando houver erro de lock,
papel SQL ou autenticação. Um endpoint 202 ainda não significa conexão OPEN.
O dashboard de pedidos deve continuar conectado à mesma API ou ao adapter de
eventos configurado, com ticket próprio para `/orders`.

Validar manualmente, com autorização: A/número A e B/número B simultâneos, cardápios,
clientes e pedidos isolados, um evento após cada COMMIT, disconnect A mantendo B,
e reinício com as mesmas sessões/volume. Nenhuma conexão, pedido real ou deploy
é feito pelos testes automatizados desta fase.
