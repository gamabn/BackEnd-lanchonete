# Recuperação de cadastro por e-mail verificado

## Auditoria e ativação manual

A auditoria usou a definição em `migrations/003_customer_email_verification.sql` e os serviços atuais; não consultou nem modificou o Neon.
A tabela já oferece FK composta de cliente/restaurante, HMAC de 64 caracteres, cinco tentativas, prazo de até cinco minutos, `sent_at` e consumo único. O índice único de e-mail verificado por restaurante identifica o cadastro sem ambiguidade. A FK exige cliente existente; e-mails sem cadastro não recebem uma linha fictícia.

Faltava distinguir a finalidade. Antes de publicar o backend atualizado, execute **manualmente** no SQL Editor do Neon, como proprietário da migration, o arquivo `migrations/004_customer_email_recovery.sql` completo. Ele adiciona somente `purpose`, com padrão `verification`, CHECK e permissão de INSERT dessa coluna para a role existente `gama_app`. Não cria roles nem RLS. Os desafios anteriores continuam de verificação. A Etapa 1 atualizada também depende dessa coluna.

Nenhum SQL é executado pelo startup da aplicação. Após a execução manual, publique/reinicie backend e frontend. Mantenha `JWT_SECRET`, `EMAIL_USER` e `EMAIL_APP_PASSWORD` somente no backend, sem prefixos públicos. A recuperação reutiliza `CustomerEmailSender` e `issueCustomerCredential`.

## Fluxo e limites

- `POST /client/:id/email/recovery/request`: `{ "email": "cliente@example.com" }`.
- `POST /client/:id/email/recovery/confirm`: `{ "challengeId": "UUID recebido", "code": "012345" }`.
- As rotas públicas não exigem uma sessão anterior. `:id` é o restaurante.
- Solicitação válida sempre retorna 202, UUID aleatório e a mesma mensagem condicional, inclusive para e-mail desconhecido, não verificado ou com quota esgotada. Não confirma o envio. Consulta e SMTP são assíncronos, após a resposta, evitando diferenças de tempo relacionadas à existência do cadastro. Falhas de envio ou atualização deixam `sent_at` nulo e o desafio inutilizável.
- Um envio por 60 segundos, até três desafios por cliente/restaurante em 15 minutos. O bloqueio da linha do cliente serializa solicitações concorrentes. Novo desafio invalida somente recuperações anteriores.
- Até cinco tentativas por desafio; expira em cinco minutos, com HMAC separado da verificação. Confirmação exige que o e-mail atual do cadastro continue verificado e corresponda ao desafio.
- Há ainda teto de 120 chamadas de recuperação (solicitação e confirmação somadas) por endereço de conexão em 15 minutos, por processo. Ele não confia em `X-Forwarded-For`; atrás do proxy Next.js o teto pode ser compartilhado entre visitantes. Esse teto adicional reinicia com o processo; as quotas por cadastro e as tentativas ficam no PostgreSQL, compartilhadas entre instâncias.
- O envio assíncrono usa o processo Express atual, sem fila durável. Reiniciar o processo pode perder um envio pendente; o cliente pode solicitar novamente após o intervalo. Não há autenticação sem envio confirmado.
- A confirmação emite o JWT existente de cliente. Somente o proxy Next.js configura o cookie por restaurante: HttpOnly, SameSite=Strict, Path=/, 30 dias e Secure em produção. O JWT não aparece no JSON do navegador nem no armazenamento local.
- Recuperar não revoga JWTs anteriores: a política existente de expiração permanece.

Resposta neutra, códigos de uso único e limites seguem os princípios da [OWASP para recuperação de conta](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Validação real após o SQL manual

1. Em uma loja, tenha um cliente com e-mail já verificado. Use uma janela anônima, sem cookie de cliente, e abra a identificação no checkout.
2. Selecione “Recuperar meu cadastro”, informe o e-mail e use o código recebido em até cinco minutos. O cadastro deve reaparecer para confirmação da identidade; confirme seus dados/endereço antes de continuar o checkout.
3. Nas ferramentas do navegador, confira o cookie desta loja com HttpOnly e SameSite=Strict (Secure em produção). O JSON da confirmação contém apenas `recovered: true`. Cookies de outras lojas e da administração não devem mudar.
4. Repita com um e-mail inexistente e com cadastro sem e-mail verificado: a solicitação mostra a mesma mensagem e não concede sessão.
5. Teste código incorreto cinco vezes, expirado, reutilizado e enviado para outra loja. Nenhum deve conceder sessão. O código da Etapa 1 também não serve para recuperar.
6. Solicite novamente antes de 60 segundos e exceda três solicitações em 15 minutos: a resposta permanece neutra e não gera envio extra. Após o intervalo permitido, o novo código substitui a recuperação anterior.
7. Confira que o carrinho continua presente e que ainda é possível iniciar um cadastro sem e-mail.

Os testes automatizados simulam banco/SMTP e usam o emissor real de JWT e `NextResponse` real. Não substituem a validação no Neon/Gmail depois da aplicação manual do SQL. Não execute os testes de migrations contra o ambiente real.
