# Análise do app na Meta (App Review) — Páginas do Facebook e Messenger

Este fork funciona só em Páginas do Facebook. Sem análise, o app fica no **acesso padrão (Standard Access)**, e o teste de 2026-10-26 mostrou o limite exato:

| Evento de quem **não tem papel** no app | Standard Access |
|---|---|
| Comentário na Página ou em anúncio (webhook `feed`, inclusive com o nome) | chega |
| Private reply e mensagens depois de um toque em botão | saem |
| Toque em botão (`messaging_postbacks`) e leitura (`message_reads`) | chegam |
| **Mensagem digitada** (`messages`) | **não chega** |
| **Eco das nossas mensagens** (`message_echoes`) | **não chega** |

Sem as mensagens digitadas não há fluxo iniciado por texto, nem "parar" digitado, nem detecção de resposta humana. ManyChat, NapoleonCat e Botcake recebem tudo porque têm **acesso avançado** aprovado por esta análise. É o que este documento prepara.

O texto que vai para a Meta fica **em inglês** (os revisores leem em inglês). As instruções para quem envia estão em português.

## O que pedir

Peça **acesso avançado** para:

- `pages_messaging` — o motivo da análise.
- `pages_manage_metadata` e `pages_show_list` — dependências obrigatórias de `pages_messaging` na referência de permissões da Meta.

Não peça agora `pages_read_user_content` nem `pages_manage_engagement`: comentários, respostas públicas e ocultar comentário já funcionam no acesso padrão para as Páginas do dono. Pedir permissão sem necessidade demonstrada é motivo comum de recusa. Se a moderação (Fase 1) passar a precisar ler comentários pela API com o autor, faça uma segunda análise só para elas.

Não peça o recurso "Human Agent": o produto não envia nada fora da janela de 24h.

## Antes de enviar

1. **Verificação da empresa** do portfólio dono do app (Configurações do negócio → Central de segurança → Verificação). Documento da empresa: cartão CNPJ, contrato social ou comprovante bancário em nome da empresa, com nome e endereço iguais aos do portfólio. Costuma levar alguns dias.
2. **App básico completo** (Configurações do app → Básico): ícone 1024×1024, categoria, e as URLs `https://retention-meta.publisherscompany.com/privacy`, `/terms` e `/data-deletion`. As três já existem; revise se o texto delas cita Páginas do Facebook e Messenger (hoje falam de Instagram).
3. **Comando cURL de envio**: no painel do app → Messenger → *API Integration Helper*, gere a amostra de envio de mensagem para a Página e copie o cURL **sem o token** (troque o token por `<PAGE_ACCESS_TOKEN>`).
4. **Conta de teste para a gravação**: adicione a segunda conta do Facebook como **Testador** do app (Funções do app → Funções). Assim as mensagens digitadas dela chegam durante a gravação, antes da aprovação. Os revisores aceitam a gravação com conta de teste.
5. **Interface em inglês** durante a gravação: o painel tem idioma `en`; troque no seletor de idioma do painel.

## Justificativas (cole no formulário, uma por permissão)

### `pages_messaging`

> We are a business that runs Facebook Pages and Facebook ads. Our app automates the Messenger conversations that people start with our own Pages, so we can answer them immediately instead of hours later.
>
> How it works, step by step:
> 1. A person comments a keyword on one of our Page posts or ads (for example "LINK" or "PRICE").
> 2. Our server receives the comment through the Page `feed` webhook and sends that person exactly one private reply (`POST /{page-id}/messages` with `recipient.comment_id`) containing what they asked for, such as a link or an answer. This follows the Private Replies rules: one message per comment, within 7 days.
> 3. If the person replies in Messenger or taps a button in that message, we continue the conversation with a short sequence of messages they opted into, only inside the 24-hour standard messaging window (`messaging_type: RESPONSE`). Every new message from the person reopens the window; we never use message tags and never send outside the window.
> 4. If the person writes "stop" (or our localized stop words), we end the sequence, send a short confirmation, and never message them again from that sequence.
>
> We need `pages_messaging` with Advanced Access to receive the messages that people type to our Page (the `messages` webhook) and to keep the conversation going for people who have no role on our app. Under Standard Access the private reply is delivered, but the person's typed answers never reach us, so we cannot respond to them or honor a typed "stop".
>
> All interactions are user-initiated (a comment, a reply, or a button tap). The app only manages Pages owned by our business, connected by a Page admin through Facebook Login for Business. Message content is stored only to run the conversation and show delivery logs to our team; access tokens are encrypted at rest.

### `pages_manage_metadata`

> We use `pages_manage_metadata` only to subscribe our app to webhook events of the Pages our business owns (`POST /{page-id}/subscribed_apps` with `feed`, `messages`, `messaging_postbacks`, `message_reads` and `message_echoes`). Without these webhooks we cannot see the comments people leave on our posts and ads, nor their replies in Messenger. A Page admin connects the Page in our app's settings and the subscription happens automatically; the screen shows "Webhook ready" for each Page. We do not change any other Page setting.

### `pages_show_list`

> We use `pages_show_list` to list the Pages the admin selected during Facebook Login for Business (`GET /me/accounts`), so they can choose which of our business Pages the automation runs on. We show only the Page name and whether it is connected.

## Roteiro do vídeo (uma tomada, 3 a 5 minutos)

Grave a tela com narração ou legendas **em inglês**. Use o app publicado, o domínio real e contas reais. Deixe preparado: uma campanha Comment-to-DM na Página com palavra-chave `LINK`, mensagem com um botão, e um fluxo de 3 passos ligado à campanha, com o primeiro passo em 0 minuto.

1. **Login no painel.** Abra `https://retention-meta.publisherscompany.com`, entre pelo link mágico. *Legenda: "Our team signs in to our internal tool."*
2. **Facebook Login for Business.** Configurações → Facebook Pages → **Connect with Facebook**. Mostre a janela da Meta com as permissões (`pages_messaging`, `pages_manage_metadata`, `pages_show_list`), selecione a Página e confirme. *Legenda: "A Page admin grants the permissions for our own Page."*
3. **Lista de Páginas e webhook** (mostra `pages_show_list` e `pages_manage_metadata`). De volta às Configurações, mostre a Página listada com **"Webhook ready"**. Se ela ainda não estiver conectada, clique em **Connect** na frente e grave o selo mudando. *Legenda: "We list the Pages and subscribe them to webhooks."*
4. **A campanha.** Abra a campanha Comment-to-DM: Página, palavra-chave `LINK`, texto da private reply com botão, e o fluxo escolhido para depois da resposta. Abra o fluxo e mostre os 3 passos e a mensagem de saída. *Legenda: "What the person will receive, and only after they interact."*
5. **O comentário.** Em outro navegador ou no celular (tela visível no vídeo), com a conta de teste, comente `LINK` num post ou anúncio da Página. *Legenda: "A person comments a keyword on our post."*
6. **A private reply chegando** (mostra `pages_messaging`). Mostre o Messenger da conta de teste recebendo a mensagem em segundos. Toque no botão e mostre a próxima mensagem chegando. *Legenda: "One private reply, then the next message after the person taps the button."*
7. **A pessoa digita e a conversa continua** (o motivo do acesso avançado). Na conta de teste, digite uma resposta. Mostre o primeiro passo do fluxo chegando. *Legenda: "We receive the typed reply through the messages webhook and continue inside the 24-hour window."*
8. **O inbox da Página.** Abra a Caixa de entrada do Meta Business Suite da Página e mostre a mesma conversa com as mensagens enviadas pelo app. *Legenda: "The messages our app sent, as seen in the Page inbox."*
9. **Parar.** Na conta de teste, digite `stop`. Mostre a confirmação chegando e, no painel, o fluxo com a pessoa encerrada. *Legenda: "The person can stop at any time."*
10. **Logs.** No painel, mostre DM Logs com a linha **Sent** e as métricas do fluxo. *Legenda: "Delivery log for our team."*

O revisor quer ver a permissão produzindo um resultado real numa conta real, e a mensagem saindo **do app** (não só prints de mensagens recebidas). Os passos 6 a 9 cobrem isso.

## Tratamento de dados (perguntas do formulário)

- **Quem processa os dados:** Vercel (site e webhooks), Railway (fila e envio), Supabase (banco Postgres), Resend (e-mail de login do painel). Se a IA das Fases 1 e 2 estiver ligada, a Anthropic recebe o texto do comentário para classificar ou sugerir resposta.
- **O que guardamos:** IDs da Página e das pessoas no escopo da Página (PSID), texto dos comentários e das mensagens trocadas, status de entrega, cliques em links rastreados. Tokens criptografados com AES-256-GCM.
- **Exclusão:** a página `/data-deletion` explica como pedir; desconectar a Página no painel apaga as campanhas, fluxos e logs dela.
- **Uso:** só para operar as conversas que as pessoas iniciam com as nossas Páginas. Não vendemos nem compartilhamos dados, não usamos para anúncios de terceiros.

## Se a Meta recusar

É comum a primeira submissão voltar com pedido de ajuste. Os motivos mais frequentes: vídeo sem mostrar o login com as permissões, mensagem não aparecendo saindo do app, uso descrito de forma genérica, ou permissão pedida sem necessidade demonstrada. Ajuste só o ponto apontado e reenvie.
