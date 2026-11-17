# H.5B — preparação do checkout na conversa viva

O processador passa contexto validado e identidade externa (conta/remetente) como
metadados internos ao ConversationMenu. IDs de texto não definem o proprietário.
A chave existente da conversa continua incluindo restaurante, sessão lógica,
conta e chat; o getter verifica que a instância ainda pertence ao Map da sessão.
Nenhuma autenticação Baileys foi alterada.

Ao apresentar ORDER_REVIEW, LiveCheckoutSession usa H.1/H.3/H.4 para capturar a
revisão e criar uma intenção local. O snapshot é opaco e possui cópia interna dos
itens/endereço; a intenção e seus objetos de escopo são congelados. O vínculo
inclui restaurante, sessão, conta, remetente, cliente, telefone do transporte,
pagamento, carrinho, endereço, frete e geração de identidade.

A geração é própria da identidade, independente da revisão usada para cancelar
consultas assíncronas. Mudanças de metadados/telefone observado avançam a geração,
inclusive A -> B -> A. Ausência de evidência de transporte não é substituída por
telefone antigo do cadastro ou do estado. O getter H.2 é vivo e revalida a
preparação antes de retorná-la. Uma sessão removida/substituída revoga o getter.

Invalidações de pagamento, carrinho, endereço e modalidade passam pelo caminho
existente clearPayment. Comparação canônica adicional detecta mutação de dados
antes de expor snapshot/DTO, incluindo mudanças de pagamento que não alteram o
contrato legado Cartao. Entrada inválida ou reapresentação sem mudanças mantém
exatamente o snapshot e a chave. A próxima revisão materialmente diferente cria
outra chave; uma tentativa pendente não pode fazer isso.

Estados internos explícitos:
- REVIEW_READY: revisão preparada, sem submissão real.
- SUBMISSION_PENDING: simulação em andamento, com posse exclusiva da revisão.
- SUBMISSION_COMPLETED: simulação concluída; não significa pedido persistido.
- SUBMISSION_RECOVERABLE_FAILURE: falha da simulação ou estado alterado.
- IDLE: nenhuma revisão elegível.

O lock é adquirido sincronamente antes de qualquer await. Confirmações simultâneas
não executam a simulação duas vezes. 0 durante pendência não navega, não limpa o
pagamento e não substitui a intenção. Depois da conclusão, 0 continua voltando ao
pagamento como antes. Falha recuperável sem mudança permite retry da mesma chave;
mudança de identidade/checkout não pode aceitar a conclusão de uma revisão antiga.
O único agendador executável é de simulação; a dependência de agendamento nos testes
retorna void e serve para testar falha/concorrência, sem operação comercial.

As mensagens públicas de pagamento/revisão/confirmação continuam iguais. Chamadas
legadas sem metadados confiáveis e evidência ausente/incompatível não geram uma
preparação elegível. Podem manter a simulação pública existente, mas não podem
obter um DTO/autorização utilizável para criação real. Não se fabricam UUIDs,
telefones ou contexto para acomodar esses casos.

## Reconexão e limites da persistência

O LocalMessageProcessor é criado uma vez fora da abertura do socket; sua instância,
o menu e a preparação sobrevivem às reconexões desse processo. Mensagens repetidas
são deduplicadas pelo transporte ou reutilizam a mesma revisão/chave na conversa.
Não há gravação de intenções nesta etapa: registration é sempre LOCAL_ONLY.
Não se chama prepareCheckoutIntent, autoriza no banco ou executa submissão real.
A migration 008 permanece não aplicada em produção.

O Map e o lock locais não são garantia durável nem coordenam múltiplos workers.
Um reinício do processo perde a preparação local e o token H.3. A futura ativação
precisa registrar a intenção H.4 antes da confirmação e recuperar essa chave do
banco; não gerar outra automaticamente para uma tentativa incerta. O servidor deve
continuar a aplicar unicidade/locks transacionais H.4/H.5A.

## Caminho preparado para ativação futura

readCurrentSession é o getter a fornecer a WhatsAppCheckoutAuthorizer.authorize.
createSubmission(authorization) apenas monta o contrato tipado CheckoutSubmission
com o snapshot e a intenção atuais. O módulo importa esse contrato somente como
tipo: não carrega checkoutSubmission, persistência, servidor ou controllers.
Quando houver autorização explícita para ativar, utilizar exclusivamente
WhatsAppCheckoutSubmission.submit com esse DTO; não copiar SQL/regras de pedidos
para a conversa. Registrar/reconciliar a chave antes e tratar os resultados H.5A.
Também será necessário definir a transição real dos estados internos, preservando
um getter compatível com H.2 durante a transação e sem esperar mensagens no banco.

Nenhum flag de ambiente permite ativar a criação nesta versão. Nenhum pedido,
evento Socket.IO, migration ou processamento financeiro é executado pela integração.
Os testes novos são locais/mocks: não precisam de PostgreSQL nem acessam Neon.
