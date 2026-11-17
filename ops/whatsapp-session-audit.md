# H.13 — diagnóstico de sessão em uso

Execute no mesmo host/container e volume de autenticação da API, a partir do backend:

```bash
node ops/whatsapp-session-audit.cjs
```

Aceita um diretório de autenticação como único argumento. Sem argumento usa
`WHATSAPP_AUTH_ROOT` do ambiente/configuração existente, ou `.gama-whatsapp`.
O comando só lê arquivos: não conecta ao WhatsApp, consulta banco, altera
permissões, remove locks ou exibe JWT, números, QR e chaves. Compara internamente
a conta vinculada para apontar reutilização entre restaurantes. Execute localmente;
o relatório contém IDs dos restaurantes, mas não contém credenciais.

`locks.session` e `locks.directory` indicam os locks do boot atual;
`locks.legacy` indica o antigo `.worker.lock`. Locks de boots anteriores
ficam preservados e não impedem aquisição no boot atual. Existência de lock
não comprova processo ativo nem órfão: `processOwnership` permanece `unknown`.
`lockDetails` mostra o caminho exato de cada lock encontrado. Novos locks incluem
`owner.json` com PID, UUID da execução, boot, hostname, namespace PID e instante de
início do processo no `/proc`. São dados de diagnóstico, não autorização para
remoção. PID isoladamente pode ser reutilizado ou representar outro container.
Nos locks antigos, `owner` é `null`; eles continuam bloqueados e preservados.
Metadados inválidos, links ou falhas de leitura produzem `AUDIT_UNAVAILABLE`.

A mensagem “Esta sessão está em uso…” corresponde a `LOCK_PRESENT` no frontend.
O backend retorna HTTP 503 com esse código quando `acquireLocalAuth` encontra
um lock de sessão/diretório do boot atual ou `.worker.lock` legado. Um worker
legado reservado no mesmo processo retorna `LEGACY_WORKER_ACTIVE`, outro código.

Para preservar A e conectar B:

1. Nas duas contas, consulte a resposta autenticada de `/api/whatsapp/status`.
   Confirme `restaurant_id` diferentes e identifique qual ID é B. Não compartilhe
   cookies/JWT. Confira o código da resposta de conexão B; a mensagem visual
   permite inferir o código, mas não substitui a captura HTTP.
2. No host real, confira processos, supervisores, containers, logs de início/fim
   e volumes compartilhados. Os locks existentes não têm PID; a lista de processos
   deste ambiente isolado não determina os proprietários no host.
3. Se B estiver em um worker dedicado, encerre somente esse worker de forma
   graciosa, para que ele drene as escritas e libere seus próprios locks. Se B
   estiver em outra API, use a desconexão autenticada de B nessa instância.
   Não reinicie a API que mantém A conectado para fazer esse diagnóstico.
4. Se não houver proprietário, a confirmação de que o lock é órfão deve abranger
   todos os processos/containers com acesso ao volume. Só então um operador pode
   planejar a retirada dos locks exatos de B. Este comando não faz essa retirada;
   não remova diretórios de autenticação, vínculos ou credenciais.
5. Após a liberação verificada, na conta B clique em Conectar. Credenciais válidas
   podem restaurar a conexão; se houver QR, escaneie com o número exclusivo de B.
   Verifique A conectado durante a tentativa, ambos conectados e desconecte apenas
   B para comprovar que A continua funcionando.

Os testes usam hosts simulados e locks reais em pastas temporárias. Eles comprovam
isolamento e concorrência local, mas H.13 exige validação real dos dois restaurantes.

## Restauração após reinício — correção de 2026-11-17

O boot ID pertence ao sistema operacional e permanece igual ao reiniciar Node ou
`ts-node-dev`. Um lock deixado por encerramento abrupto no mesmo boot impede a nova
execução de restaurar a sessão. O processo novo não possui a função de liberação
que existia somente na memória do anterior. O código não adota locks preexistentes,
mesmo que um PID coincida: outro host/gerenciador no mesmo processo também deve ser
impedido de abrir as mesmas credenciais.

O servidor agora mantém handlers de sinais instalados durante todo o encerramento,
consolida sinais repetidos em uma única drenagem e trata o fechamento do IPC pelo
`ts-node-dev`. A inspeção da versão instalada mostrou `disconnect()` seguido de
SIGTERM e respawn após o filho sair. Não use `--exit-child`: esse modo adiciona
saída imediata no SIGTERM. SIGKILL e falhas de gravação continuam exigindo inspeção;
nenhum mecanismo em JavaScript pode drenar credenciais após SIGKILL.

Os locks novos registram proprietário e só são liberados pela função que os criou,
após a drenagem. Uma falha transitória de liberação pode ser tentada novamente sem
perder essa função. A restauração registra separadamente ID/código de cada falha,
sem payloads, e continua com os outros restaurantes.

## Recuperação manual dos quatro locks antigos observados (não executada)

Este procedimento é específico da auditoria local de 2026-11-17. Só use os caminhos
abaixo se coincidirem com a auditoria executada no **host e volume reais**. Se o
boot/root forem diferentes, não use estes comandos; consulte os caminhos atuais
em `lockDetails`.

1. Pare manualmente o backend e qualquer worker legado/supervisor/container com
   acesso a essas duas sessões; impeça reinício automático durante a manutenção.
   Aguarde a saída dos processos e a conclusão das escritas. Confira os processos
   do host, inclusive filhos de `ts-node-dev` e containers. `ps -eo pid,ppid,comm`
   ajuda, mas a lista deste ambiente isolado não comprova a parada no host real.
2. Confirme que nenhum processo pode acessar essas credenciais durante a operação.
   Se não conseguir confirmar, interrompa o procedimento. `owner:null` não é prova
   de lock órfão. Registre a parada com o operador responsável pelo host.
3. Rode a auditoria somente de leitura no host real. Confirme contexto/vínculo
   corretos, os quatro caminhos abaixo e que os diretórios de lock estão vazios.
   Não inspecione/compartilhe conteúdo de `creds.json` ou chaves.
4. **Somente após as confirmações acima**, execute os comandos abaixo manualmente.
   `rmdir` remove apenas diretórios vazios e recusa qualquer lock que contenha
   `owner.json` ou outro arquivo. Nunca substitua por `rm -rf`; se falhar, pare e
   investigue. Não remova `.context.json`, `.tenants`, `.session-bindings`,
   `creds.json` ou qualquer diretório de autenticação.

```bash
cd /home/binho/Projeto-Lanchonete/BackEnd-lanchonete
node ops/whatsapp-session-audit.cjs

# Após confirmar todos os processos parados e estes quatro locks vazios:
rmdir -- '.gama-whatsapp/30a56399-e0ad-4584-8474-4be247ab7ab9/47949a79-ec3d-5803-8f53-d7dfebd07d3f/.worker-f6eafa93-6b85-4dc7-b2fa-2f2f5cd552aa.lock'
rmdir -- '.gama-whatsapp/.session-locks/88456a053a8a0248778e469a280ec5b4544d24c2f10456780a470471ff9389fb-f6eafa93-6b85-4dc7-b2fa-2f2f5cd552aa.lock'
rmdir -- '.gama-whatsapp/729cfbae-a56c-4432-9128-65b97205c701/0003e8ee-d5cd-5a4c-9005-149edf8f904d/.worker-f6eafa93-6b85-4dc7-b2fa-2f2f5cd552aa.lock'
rmdir -- '.gama-whatsapp/.session-locks/ea4d29ddddfbb5e5d6c9f9f324b9372654f3e91caadab113d3d315bdc9897947-f6eafa93-6b85-4dc7-b2fa-2f2f5cd552aa.lock'

# Apenas depois da liberação verificada e com a correção instalada:
GAMA_BOT_API_HOST_ENABLED=false WHATSAPP_REAL_CHECKOUT_ENABLED=true npm run dev
```

O último comando inicia restauração real; deve ser executado pelo operador,
não pelos testes. As sessões habilitadas reutilizam IDs, vínculos e credenciais.
Confirme `/api/whatsapp/status` nas duas contas e valide ambos conectados. Faça
então um reinício controlado e confira restauração de ambos. A recuperação manual
acima não foi executada pelo agente. H.13 permanece aberta até essa validação real.
