# Instruções de trabalho — Gama Delivery / Backend

1. Ao iniciar uma tarefa, ler `PROGRESSO.md` na raiz deste repositório. Ele centraliza o acompanhamento do backend e do frontend.
2. Identificar a última etapa concluída e a próxima pendente, considerando também a etapa atual e suas pendências de validação.
3. Não repetir tarefas concluídas sem necessidade. Quando uma revisão for necessária, registrar o motivo.
4. Ao finalizar uma etapa ou sessão de trabalho, atualizar `PROGRESSO.md` com data, status, resultado, arquivos modificados, testes executados e pendências. Distinguir testes executados de testes apenas planejados.
5. Não marcar tarefas como concluídas sem validação. Implementação e testes automatizados não substituem validação real quando ela for necessária para a etapa.
6. Antes de implementar alterações no frontend, consultar seu código e suas instruções locais, incluindo `../Lanchonete_App/AGENTS.md` e eventuais instruções específicas do diretório afetado. Os repositórios são separados; verificar o estado de cada um independentemente.
7. Preservar autenticação, isolamento multi-tenant e dados existentes. Não expor JWT ou credenciais Baileys; não confiar em IDs de restaurante enviados pelo navegador para definir o tenant autenticado. Não apagar sessões nem remover locks sem verificar se estão ativos. Não alterar dados reais ou executar migrations fora do escopo autorizado.
8. Manter o histórico objetivo e organizado. Preservar instruções existentes e alterações locais não relacionadas; limitar as mudanças ao escopo solicitado.

Se o frontend não estiver no caminho relativo indicado, localizar o repositório informado pelo usuário antes de alterá-lo. Não criar um segundo registro de progresso divergente.
