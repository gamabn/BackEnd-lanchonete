# Etapa 8.6B.6.2 — telefone do WhatsApp

## Implementação

Baileys mantido em **6.7.23**, Node local **22.23.1**. Nenhuma dependência,
autenticação persistida ou banco alterado. BabaYaga foi somente lido.

O envelope IncomingMessage continua estrito e mantém subject_id/chat_id originais.
A evidência telefônica segue separadamente como quinto argumento interno do menu;
ela nunca é extraída do texto, pushName, contatos encaminhados ou dígitos de LID.
Prioridade, aceitando apenas JIDs `@s.whatsapp.net` com 7–15 dígitos e primeiro
algarismo diferente de zero:

1. remoteJidAlt, por verificação de tipo em runtime;
2. remoteJid;
3. senderPn, campo tipado da 6.7.23 que o decoder preenche de sender_pn;
4. chats.phoneNumberShare, relacionando LID ao JID telefônico.

A 6.7.23 instalada não declara nem preenche remoteJidAlt; o suporte defensivo a
esse campo não faz a versão passar a emiti-lo. senderPn e phoneNumberShare são as
alternativas reais nessa versão. O evento de compartilhamento não é garantido.

O cache do evento pertence a um único processor de restaurant_id/session_id,
é separado por conta e LID, limitado a 10 mil entradas, permanece nas reconexões
do mesmo worker e desaparece ao reiniciar. Eventos de sockets antigos são ignorados.
A evidência obtida de mensagens aceitas fica também na conversa do menu, com chave
que inclui restaurante, sessão/conta/conversa fornecidas pelo processor e remetente.
Logs novos contêm somente booleano de recebimento, sem números ou identificadores.

Com carrinho preenchido, 3 avança a CUSTOMER_NAME se houver evidência do transporte.
A coleta de nome permanece como etapa em desenvolvimento: não há implementação
adicional do checkout. Sem evidência, permanece a entrada manual de contato; o
número digitado não é guardado como identidade verificada nem libera consultas.
Uma evidência posterior permite avançar também nesse estado. 0 volta ao carrinho.
Nenhum cadastro é consultado, dado de cliente divulgado ou pedido criado.

## Comparação e atualização avaliada

A referência src/service/whatsapp/whatsapp.service.ts da BabaYaga, instalada com
7.0.0-rc14, prioriza remoteJidAlt e então remoteJid, preservando remoteJid para resposta.
Ela também chama garantirCliente; essa parte não foi reproduzida nesta etapa.

A rc14 local é ESM e exige Node >=20, compatível com o Node usado. O projeto já
usa import nativo para carregar o SDK ESM e useMultiFileAuthState para autenticação.
Entretanto, v7 acrescenta chaves de autenticação lid-mapping/device-list/tctoken,
novo store signalRepository.lidMapping e alterações em contatos/eventos. Uma troca
exigiria validar tipos, migração das sessões Signal e credenciais existentes,
QR, reconexão, locks e encerramento em execução real. Não há garantia de que seja
uma troca transparente apenas pelo número da versão. Como a versão atual oferece
senderPn e phoneNumberShare, a atualização não foi necessária nem executada.

Referência oficial de migração:
https://github.com/WhiskeySockets/docs/blob/main/migration/v7.mdx

## Validação

- npx tsc --noEmit: passou.
- node tests/whatsapp-phone-identity.cjs: 5/5 passaram.
- node tests/messaging-validation.cjs: 16/16 passaram.
- node tests/whatsapp-local.cjs: 12/14 passaram, incluindo autenticação/locks,
  QR, persistência de credenciais, reconexão e encerramento simulados.
  Duas expectativas legadas falham: initialReply não está exportada (já estava
  comentada) e a resposta esperada usa INITIAL_MENU antigo/indefinido.
  Os testes existentes não foram reescritos nesta tarefa.
- Não houve conexão real ao WhatsApp para validar esta alteração.

## Teste manual

1. No terminal já configurado para o restaurante/sessão de teste, iniciar
   npm run dev:bot. Manter o diretório de autenticação existente; parear por QR
   somente se solicitado pelo fluxo normal.
2. De outra conta, adicionar um produto simples e um configurável com adicionais.
3. Escolher 3 no carrinho. Se houver PN no transporte, conferir avanço à etapa
   de nome sem solicitar digitação do telefone; verificar 0 e integridade do carrinho.
4. Com conta que entregue somente LID sem senderPn/mapeamento, conferir fallback.
   Digitar um contato não deve consultar cadastro nem avançar como vínculo verificado.
   A disponibilidade desse cenário depende do WhatsApp, não do texto enviado.
5. Se o WhatsApp emitir compartilhamento de telefone, enviar nova mensagem e
   tentar finalizar novamente: deve usar o mapeamento e continuar respondendo no LID.
6. Interromper temporariamente a rede, reconectar e repetir; encerrar com Ctrl+C,
   reiniciar com a mesma autenticação e conferir lock, restauração e carrinho novo
   (estado é temporário, como antes). Não apagar credenciais para forçar um teste.
7. Conferir que diagnósticos não mostram telefone, LID ou conteúdo de mensagens.

Identificar o telefone do transporte não equivale a autorizar acesso a um cadastro
Delivery. O vínculo com esse cadastro continua fora desta etapa. Não há conversão
regional nem remoção automática do código de país; preservam-se os dígitos do JID.
