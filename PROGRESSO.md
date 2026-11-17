# Gama Delivery — acompanhamento de tarefas

Atualizado em: 2026-11-17.

## Repositórios

- Backend: `~/Projeto-Lanchonete/BackEnd-lanchonete`.
- Frontend: `~/Projeto-Lanchonete/Lanchonete_App`.
- Este arquivo é o registro central de progresso dos dois repositórios.

## Etapas concluídas

Conforme o histórico informado do projeto:

- **H.10 — Concluída:** checkout real via WhatsApp, pedidos persistidos e recebidos no dashboard.
- **H.11 — Concluída:** gerenciamento multi-tenant de sessões WhatsApp com Baileys.
- **H.12 — Concluída:** interface de gerenciamento do WhatsApp no dashboard Next.js. A validação da integração real é acompanhada separadamente na H.12.1.

## Etapa atual

### H.13 — Segunda conexão WhatsApp bloqueada (2026-11-17)

#### Retomada — falha na restauração de ambas as sessões (2026-11-17)

**Status atual:** correções de encerramento e diagnóstico implementadas e validadas automaticamente. Recuperação dos locks reais não executada; H.13 continua aberta até validação dos dois WhatsApps reais. O usuário relatou que, após parar/iniciar `npm run dev`, ambos retornam HTTP 503 com mensagem de sessão em uso, além do aviso de restauração parcial.

**Causa comprovada no mecanismo:** os locks são diretórios exclusivos identificados por hash do contexto e boot do sistema, não pela execução Node. Reiniciar o backend no mesmo boot não muda seus nomes. O novo processo perde o estado em memória e a função de liberação do anterior, mas mantém metadados `enabled=true`; `restore()` chama `connect()` para cada registro e encontra `LOCK_PRESENT` se o lock permaneceu. A auditoria somente de leitura nesta retomada confirmou novamente quatro locks do boot atual, dois por restaurante, vazios e sem identificação de proprietário. Não foi possível provar se o processo anterior ainda os usa nem qual evento deixou os locks; nenhum foi classificado automaticamente como órfão.

**Defeitos de encerramento reproduzidos/corrigidos:**

- Os sinais eram registrados com `process.once`, somente após `listen`. Agora ficam registrados antes de `listen`, com `process.on`; sinais repetidos compartilham uma única tarefa e não restauram a saída padrão durante a drenagem. O servidor não inicia restauração caso já esteja encerrando.
- A versão instalada de `ts-node-dev` desconecta IPC, envia SIGTERM e aguarda a saída do filho para respawn. Adicionado tratamento de `disconnect` quando `TS_NODE_DEV` está ativo. Não há evidência de que o modo normal `--respawn` necessariamente abandone locks; `--exit-child`, SIGKILL, sinais repetidos ou falhas de drenagem podem impedir a liberação. O sinal/evento histórico do incidente não foi observado.
- `ApiWhatsAppHost.releaseAuth()` apagava a referência de liberação antes de aguardá-la. Uma falha perdia a possibilidade de nova tentativa; a referência agora é mantida até sucesso. A função de liberação de `acquireLocalAuth` também permite nova tentativa após falha parcial, sem repetir remoção já concluída.

**Propriedade e concorrência:** novos locks têm `owner.json` com PID, UUID da execução e da aquisição, boot, hostname, namespace PID e início do processo no `/proc` quando disponíveis. A liberação verifica inode/dispositivo e identidade da aquisição e remove apenas o lock que ela criou. Não há adoção de lock existente, recuperação automática por PID nem remoção de locks desconhecidos. Duas aquisições diretas no mesmo processo continuam sendo rejeitadas; a idempotência correta está no host e na fila do gerenciador. Locks antigos vazios continuam compatíveis e bloqueantes, sem receber um proprietário inventado.

**Restauração e isolamento:** mapas, filas e caminhos continuam separados por `restaurant_id`. `restore()` já tratava falhas individualmente e continua com os outros restaurantes. Adicionado diagnóstico por restaurante/código além do resumo, sem mensagens SDK ou segredos. Testes comprovaram restauração e pedidos duplicados na mesma instância sem nova aquisição, bem como falha de B sem derrubar A. Estado em memória `error` é distinto do registro persistido `enabled=true`; este último permite nova restauração no próximo início e não prova que o socket esteja aberto. O endpoint retorna a sessão já inicializada em vez de abrir um segundo host; não foi encontrado defeito nesse comportamento.

**Arquivos desta retomada (backend):** `src/server.ts`, `src/messaging/worker/apiHost.ts`, `src/messaging/worker/localAuth.ts`, `src/messaging/worker/tenantSessionManager.ts`, `ops/whatsapp-session-audit.cjs`, `ops/whatsapp-session-audit.md`, `tests/whatsapp-api-bootstrap.cjs`, `tests/whatsapp-api-host.cjs`, `tests/whatsapp-multi-session.cjs`, `tests/whatsapp-lock-lifecycle.cjs` (novo), `src/messaging/worker/README.md` e `PROGRESSO.md`. Nenhuma alteração no frontend, checkout ou banco.

**Testes executados:** antes das correções, dois novos cenários de bootstrap falharam (handlers anteriores ao listen e desligamento por IPC) e um de host falhou (nova tentativa de liberação). Após as correções, passaram:

- `./node_modules/.bin/tsc --noEmit`.
- `node --test tests/whatsapp-lock-lifecycle.cjs tests/whatsapp-multi-session.cjs tests/whatsapp-api-bootstrap.cjs tests/whatsapp-api-host.cjs tests/whatsapp-auth-recovery.cjs tests/whatsapp-local.cjs tests/whatsapp-session-audit.cjs tests/whatsapp-multi-routes.cjs tests/whatsapp-connection-events.cjs` — nove arquivos aprovados.
- Cenários incluem duas sessões persistidas, restauração após `stopAll`, restauração repetida na instância atual, conexão duplicada, propriedade no mesmo processo, outro processo ativo real bloqueando aquisição, liberação por SIGTERM desse processo de teste, falha parcial de liberação, proprietário alterado e lock vazio de execução anterior no mesmo boot. Baileys/HTTP/banco reais não foram iniciados.
- `node ops/whatsapp-session-audit.cjs` executado somente para leitura dos registros locais: contextos/vínculos coerentes, contas diferentes, quatro locks atuais com `owner:null`. `git diff --check` aprovado.

**Recuperação manual pendente:** `ops/whatsapp-session-audit.md` agora contém os quatro caminhos exatos observados e comandos `rmdir` limitados a locks vazios, condicionados à confirmação de parada de todos os processos/containers/supervisores que acessam o volume. Não executar se algum proprietário estiver ativo ou desconhecido; não usar remoção recursiva nem apagar autenticação/vínculos. Esses comandos não foram executados. Novos locks com `owner.json` não são abrangidos pelo procedimento de locks antigos vazios.

**Validação real ainda necessária:** instalar a correção, verificar/liberar somente locks comprovadamente órfãos no host, iniciar manualmente o backend e confirmar A/B conectados; fazer reinício controlado e confirmar restauração dos dois; validar desconexão exclusiva de B preservando A. Nenhuma conexão real, desconexão de conta, reinício real, migration, alteração no Neon ou mutação de credenciais/locks reais ocorreu nesta sessão.

#### Investigação inicial — segunda conexão bloqueada

**Status:** em investigação; testes de isolamento passaram, mas o bloqueio operacional de B não foi liberado e a validação real de duas conexões continua pendente. Última etapa formalmente concluída: H.12. O usuário informou agora A conectado e funcionando e B recebendo erro ao conectar; isso atualiza o relato anterior de clique sem efeito, mas não comprova todos os cenários de H.12.1.

**Causa localizada e limites:** a mensagem informada é o texto exclusivo de `LOCK_PRESENT` no frontend. `acquireLocalAuth` (`src/messaging/worker/localAuth.ts`) gera esse código ao encontrar `.worker.lock` legado, lock do contexto em `.session-locks`, ou lock do diretório no boot atual. O gerenciador preserva o código e a rota retorna HTTP 503. Não houve captura da resposta HTTP real nem acesso aos JWTs das duas abas; a correspondência com o incidente é inferida da mensagem. A distinção entre lock ativo e órfão ainda não foi comprovada no host.

**Inspeção somente de leitura executada:**

- Há dois registros locais válidos, com IDs de restaurante e sessão diferentes, diretórios exclusivos e marcadores/vínculos coerentes. Ambos têm seus próprios locks de sessão e diretório no boot atual. Não há `.worker.lock` legado nesses diretórios. Locks de boot anterior também existem e foram preservados; não são consultados como bloqueio do boot atual.
- As contas WhatsApp vinculadas nas credenciais locais são diferentes; nenhum número, chave ou conteúdo de credencial foi registrado. Os dois IDs locais não foram associados a A/B sem evidência das respostas autenticadas das abas.
- `AuthStoreService` assina o JWT com `sub=user.id` do restaurante autenticado. A rota WhatsApp verifica assinatura/expiração e usa apenas esse `sub`, ignorando IDs do navegador. IDs diferentes foram comprovados nos testes com JWTs de teste; os JWTs reais não foram inspecionados.
- O gerenciador usa mapas e filas por `restaurant_id` normalizado; o diretório é `<root>/<restaurant_id>/<session_id>`. O lock globalmente armazenado usa hash do contexto completo, sem colisão nos dois registros observados. Baileys recebe esse diretório exclusivo.
- A reserva do worker legado é por restaurante. A configuração local de `GAMA_BOT_API_HOST_ENABLED` está desativada, mas isso não comprova o ambiente efetivo dos processos do host nem exclui worker legado em outro processo.
- Este ambiente só enxerga seus próprios processos. Os locks vazios existentes não registram PID; não foi possível comprovar seus proprietários. Nenhum lock, credencial, permissão ou sessão real foi alterado. Não houve acesso ao Neon, migration, conexão WhatsApp ou reinício da API.

**Resultado:** não foi encontrada falha que justifique desabilitar concorrência ou alterar o gerenciador. Um teste novo reproduz exatamente `LOCK_PRESENT` quando outro gerenciador detém B, preservando A conectado; após o proprietário liberar B, a tentativa explícita funciona. Isso comprova o mecanismo, não identifica o processo responsável pelo incidente real. A recuperação depende de inspeção do host, sem encerrar A nem remover locks desconhecidos.

**Arquivos modificados/criados nesta sessão, todos no backend:**

- `ops/whatsapp-session-audit.cjs`: diagnóstico somente de leitura, sem banco/Baileys; relata locks do boot atual, contexto, vínculo e eventual conta repetida, sem exibir dados secretos. Não tenta inferir que lock é órfão nem removê-lo.
- `ops/whatsapp-session-audit.md`: procedimento para identificar/liberar somente B preservando A.
- `tests/whatsapp-session-audit.cjs`: valida relatório, comparação de contas sem vazamento, recusa de links e preservação de conteúdo/permissões/mtime.
- `tests/whatsapp-multi-session.cjs`: adicionados A conectado enquanto B inicia, ambos conectados, desconectar B preservando A e conflito de B entre gerenciadores com liberação somente pelo proprietário.
- `PROGRESSO.md`: este registro. Sem alterações no frontend, checkout ou código funcional de conexão.

**Validação executada e aprovada:**

- `./node_modules/.bin/tsc --noEmit`.
- `node --test tests/whatsapp-session-audit.cjs tests/whatsapp-multi-session.cjs tests/whatsapp-multi-routes.cjs tests/whatsapp-api-host.cjs tests/whatsapp-api-bootstrap.cjs tests/whatsapp-local.cjs tests/whatsapp-connection-events.cjs` — sete arquivos passaram. Incluem concorrência do mesmo restaurante, QR independente, locks reais, diretórios exclusivos e autenticação/isolamento por JWT. Hosts de conexão simulados; sem conexões externas.
- `node ops/whatsapp-session-audit.cjs` sobre os arquivos locais existentes: dois registros coerentes, contas diferentes e locks distintos do boot atual; propriedade dos processos desconhecida.

**Pendências:** receber `restaurant_id` das duas respostas autenticadas e código HTTP de B; executar diagnóstico no host/volume real; verificar proprietário dos locks de B em todos os processos/containers; liberar B pelo proprietário (ou intervenção manual somente após comprovar lock órfão); conectar B explicitamente e validar A/B simultâneos e desconexão exclusiva de B. H.13 não concluída. H.14 permanece pendente. Os logs temporários da H.12.1 foram preservados, pois não há evidência suficiente para encerrar seu diagnóstico nesta sessão.

### H.12.1 — Corrigir integração real do dashboard com o backend WhatsApp

**Status em 2026-11-16:** o usuário confirmou que o problema persiste após as correções anteriores. Diagnóstico temporário adicionado ao navegador para confrontar o estado visual com o controlador; causa da aba real ainda não comprovada. Não considerar a etapa concluída.

### Investigação e resultado

- `src/server.ts` do backend já instancia `TenantWhatsAppSessionManager` no modo normal `npm run dev`, sem depender do worker legado.
- As rotas autenticadas `/whatsapp/status`, `/whatsapp/connect`, `/whatsapp/qr` e `/whatsapp/disconnect` estão registradas.
- O proxy Next encaminha o JWT do cookie HttpOnly; o restaurante é identificado pelo JWT no backend, sem aceitar seleção de restaurante pelo navegador.
- As variáveis do frontend apontavam para `http://localhost:3333` e para o backend Render. Não foi comprovado erro de URL.
- O controlador comparava o ID do Context com `restaurant_id` e classificava divergência como JWT expirado, bloqueando os botões e disparando revalidação. Foi alterado para vincular a conexão ao restaurante retornado pelo backend autenticado e rejeitar divergências posteriores sem simular expiração.
- O contrato atual de `/me` retorna o ID do restaurante. Portanto, a ocorrência dessa divergência na sessão real do usuário não foi comprovada; o defeito corrigido não constitui confirmação da causa do incidente relatado.
- `revalidateAuth` é estável no Context. O painel passou a manter o controlador estável mesmo quando o callback de expiração muda.
- A reserva do modo legado depende da inicialização do host legado no processo; não foi identificado bloqueio apenas pela existência da configuração.
- Foram adicionadas mensagens distintas para backend inacessível, timeout, rota ausente e resposta inválida.
- O backend em `localhost:3333` não estava acessível no ambiente da investigação. Não houve pareamento real, alteração de dados no Neon, migration, exclusão de sessões ou remoção de locks.

### Arquivos alterados na H.12.1

No frontend (`Lanchonete_App`):

- `src/app/dashboard/whatsapp/connectionController.ts`.
- `src/app/dashboard/whatsapp/WhatsAppPanel.tsx`.
- `src/app/api/whatsapp/proxy.ts`.
- `src/app/util/whatsappTypes.ts`.
- `tests/whatsapp-dashboard.cjs`.
- `tests/whatsapp-proxy.cjs`.
- `tests/whatsapp-integration.cjs` (novo).
- `package.json` (inclusão do teste integrado no comando de testes).

Nenhuma alteração funcional no backend foi necessária nessa investigação.

### Testes executados na H.12.1

Todos os comandos abaixo passaram na sessão de implementação:

- Backend: `npx tsc --noEmit`.
- Backend: `node --test tests/whatsapp-api-bootstrap.cjs tests/whatsapp-multi-routes.cjs tests/whatsapp-multi-session.cjs tests/whatsapp-connection-events.cjs tests/whatsapp-api-host.cjs`.
- Frontend: `npm run typecheck`.
- Frontend: `npm run test:whatsapp` (dashboard, proxy e integração).

O teste integrado percorre autenticação JWT, roteamento Express, gerenciador real, proxy Next e controlador. Substitui a consulta de existência do restaurante e o host Baileys; não abre conexão real com WhatsApp. Cobre status inicial, falha recuperável, nova tentativa, QR, desconexão, isolamento entre restaurantes e JWT inválido. Por restrição do ambiente, o despacho Express é feito em memória, sem porta HTTP aberta.

### Retomada em 2026-11-16 — cliques e ciclo de vida React

**Resultado:** corrigidos defeitos reproduzíveis do frontend, sem reinvestigar variáveis de ambiente ou inicialização do worker. Ainda não há confirmação de resolução na aba real do usuário.

- Atualizar status retornava silenciosamente quando já havia um GET automático em andamento. Mesmo sem concorrência, a atualização manual não publicava `loading=true`, deixando a interface sem feedback perceptível. Dois testes de interação falharam antes da correção, reproduzindo esses comportamentos.
- Na montagem com `document.hidden=true`, o estado inicial tinha `loading=true`, mas `refresh()` retornava sem publicar qualquer mudança. Nenhuma requisição era iniciada e os botões permaneciam desabilitados até um evento de visibilidade. O controlador agora publica o estado pausado com carregamento encerrado; uma interação explícita retoma a operação.
- Atualização manual agora cancela/substitui apenas o GET anterior, publica carregamento e apresenta “Atualizando status…”. Não há repetição automática de POST.
- Os handlers deixaram de usar optional chaining para ignorar silenciosamente um controlador nulo: apresentam erro visível nesse caso. A limpeza só apaga a referência se ela ainda pertence ao controlador descartado.
- O teste real de montagem em Strict Mode já funcionava antes da correção: houve criação, descarte e recriação com controlador válido para Conectar. Não se comprovou que Strict Mode ou controlador nulo fossem a causa do incidente.
- Testes de hidratação do componente não apresentaram erros recuperáveis. Isso não equivale a inspecionar o Console da aba real do usuário.
- Instrumentação nos testes registra eventos de clique, disabled, referência disponível e ciclo de vida do controlador real, sem payloads, JWT ou QR. O DOM expõe `data-controller-ready`, `data-paused` e `data-disabled-reason` para diagnóstico pontual; não foram adicionados logs de credenciais ou logs contínuos em produção.

**Arquivos desta retomada (frontend):** `src/app/dashboard/whatsapp/WhatsAppPanel.tsx`, `src/app/dashboard/whatsapp/connectionController.ts`, `tests/whatsapp-react.cjs` (novo), `tests/whatsapp-dashboard.cjs`, `package.json` e `package-lock.json`. Adicionado jsdom como dependência de desenvolvimento para usar DOM e eventos reais, React/ReactDOM reais e handlers reais; as requisições são controladas no teste, sem conectar ao WhatsApp. Este `PROGRESSO.md` também foi atualizado no backend.

**Validação executada:** `npm run typecheck` e `npm run test:whatsapp` passaram no frontend. O novo arquivo cobre cinco cenários: hidratação com feedback e recuperação de erro; clique durante consulta automática; replay de efeitos do Strict Mode; montagem oculta e retomada explícita; QR e desconexão com confirmação. As outras três suítes de WhatsApp também passaram. Nenhuma funcionalidade do backend, checkout ou Socket.IO foi alterada.

**Pendente:** verificar os cliques na aba real e registrar indicador de status, eventuais erros de JavaScript/hidratação e, se necessário, os atributos de diagnóstico dos botões. Não atribuir todos os sintomas reais aos cenários reproduzidos sem essa evidência.

### Nova retomada em 2026-11-16 — diagnóstico no navegador real

**Fatos informados pelo usuário:** Conectar aparece habilitado; o clique não produz ação perceptível nem requisição `/api/whatsapp/connect` no Network; o indicador mostra “Status indisponível”; não há erro evidente no Console. As correções anteriores não resolveram o incidente.

**Implementado nesta retomada, somente no frontend:**

- Logs temporários com prefixo `[whatsapp:H12.1]` no handler (`panel.click`), antes das condições de retorno de `act()` (`act.enter`) e em cada bloqueio (`act.blocked`, com a lista exata de condições). Os registros confrontam flags do React, referência atual, número da instância, `disposed`, `expired`, `visible`, `busy` e `document.hidden`. Não registram IDs de restaurante, JWT, QR ou corpos de requisição/resposta.
- Logs de montagem, limpeza, descarte, mudança de visibilidade e atualizações de instâncias antigas; marcador DOM `data-whatsapp-diagnostic="h12.1-click-v1"` para identificar o código instrumentado.
- `act()` passou a retornar um resultado explícito quando rejeita a ação por `disposed`, `expired`, `hidden` ou `busy`. O painel apresenta o motivo e reconcilia seu estado com o controlador atual, em vez de tratar retorno antecipado como sucesso silencioso.
- A callback de atualização só aplica estado da instância que ainda está em `controller.current`. Respostas de outra instância são ignoradas e diagnosticadas. Isso é uma proteção implementada; não comprova que a aba real estivesse recebendo essas respostas.

**Arquivos modificados:** no frontend, `src/app/dashboard/whatsapp/WhatsAppPanel.tsx`, `src/app/dashboard/whatsapp/connectionController.ts`, `tests/whatsapp-react.cjs` e `tests/whatsapp-dashboard.cjs`; no backend, somente este registro documental.

**Validação já executada nesta retomada:** `npm run typecheck` passou. `node tests/whatsapp-react.cjs` passou nos nove cenários, incluindo divergências deliberadas entre estado visual e `disposed`/`expired`/`busy`, além de `visible=false` com documento visível. Essas divergências foram criadas nos testes e não são observações do navegador do usuário. `npm run test:whatsapp` também passou nas quatro suítes (controlador/dashboard, proxy, integração e React). Testes jsdom não comprovam resolução do incidente real.

**Pendente:** recarregar a página instrumentada, clicar uma vez e coletar os registros `panel.mount`, `panel.click`, `act.enter` e eventual `act.blocked` da aba real. Nenhum desses registros reais foi recebido ou observado nesta sessão até esta atualização. Se não houver logs, confirmar se o marcador DOM está presente e se o evento chega ao componente. Somente com essa evidência identificar a causa, aplicar eventual correção específica e validar no navegador. Remover os logs temporários após concluir o diagnóstico. Backend, JWT, Baileys e variáveis de ambiente não foram reinvestigados nesta retomada.

### Pendências e retomada

1. Iniciar o backend multi-tenant com a configuração existente de banco, JWT e diretório de sessões:
   ```bash
   cd ~/Projeto-Lanchonete/BackEnd-lanchonete
   GAMA_BOT_API_HOST_ENABLED=false WHATSAPP_REAL_CHECKOUT_ENABLED=true npm run dev
   ```
2. Iniciar o frontend em outro terminal com `npm run dev` dentro de `~/Projeto-Lanchonete/Lanchonete_App`.
3. Autenticar no dashboard e abrir `/dashboard/whatsapp`. Confirmar o estado real, conectar explicitamente, exibir e escanear o QR, aguardar conexão e testar desconexão com confirmação.
4. Se a falha persistir, registrar a categoria de erro e o status HTTP de `/api/whatsapp/*`, sem registrar JWT, QR ou credenciais. Confirmar a causa real antes de encerrar a etapa.
5. Registrar o resultado manual e somente então avaliar a conclusão da H.12.1.

## Próximas etapas

- **H.13 — Em investigação (2026-11-17):** segunda conexão bloqueada por mensagem correspondente a `LOCK_PRESENT`; ver registro atual. Testes de isolamento passaram, recuperação operacional e validação real pendentes. Verificar também isolamento de cardápios e pedidos.
- **H.14 — Pendente:** preparar persistência das sessões Baileys e deploy em produção, preservando sessões e locks existentes.

## Histórico de acompanhamento

- **2026-11-16 — Acompanhamento configurado:** criados este registro e os arquivos `AGENTS.md` nas raízes dos dois repositórios. Validação documental por leitura; nenhuma funcionalidade alterada e nenhum teste de aplicação executado nesta tarefa documental.

Para novas atualizações, registrar data, etapa, status, resultado, arquivos modificados, testes executados e pendências. Preservar o histórico relevante e nunca registrar segredos.
