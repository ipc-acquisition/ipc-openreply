# Plano: migrar o projeto para Páginas do Facebook

> **Estado (2026-10-21): etapas 1 a 8 implementadas** (ver `git log`). O CLAUDE.md já foi reescrito para Páginas e `docs/setup.md` tem a seção "Páginas do Facebook". Este documento fica como registro das decisões e do teste de viabilidade. Os "pontos ainda não confirmados" ao fim continuam em aberto até o primeiro teste real.

Decidido em 2026-10-21 com o dono. **O produto passa a funcionar só em Páginas do Facebook.** Instagram e Zernio continuam no código, mas saem da interface. Este documento é o ponto de partida da implementação. Leia antes de mexer no código e siga a ordem das etapas.

## Contexto

- O fork do OpenReply era só para Instagram. O CLAUDE.md ainda descreve Instagram nas regras e fases. A **etapa 8** reescreve o CLAUDE.md para Páginas.
- As regras de trabalho do CLAUDE.md continuam valendo:
  - claim antes de chamar a Meta (`docs/delivery-retries.md`);
  - rate limiter por conta;
  - mudanças só aditivas no schema;
  - não remover Zernio nem workspaces;
  - textos novos também em `lib/i18n/pt-BR.json`;
  - `npm run typecheck && npm run lint && npm test` ao fim de cada etapa;
  - commits pequenos.
- Next.js 16: consulte `node_modules/next/dist/docs/` antes de escrever rotas e páginas (ver AGENTS.md).

## Decisões tomadas

| Tema | Decisão |
|---|---|
| Canal | Só Páginas do Facebook (Messenger + comentários da Página) |
| Provedor | Novo valor `FACEBOOK_PAGE` no enum `InstagramProvider`, ao lado de `META` e `ZERNIO` |
| Onde fica a Página | Uma linha em `InstagramAccount` por Página: `instagramId` = ID da Página, `username`/`name` = nome da Página, `accessToken` = token da Página criptografado. Não renomear modelos (regra de mudança aditiva). |
| Autenticação na Meta | **Usuário do sistema criado no portfólio do dono.** O dono gera o token uma vez e cola numa tela do painel. Sem OAuth e sem "Login do Facebook para Empresas". |
| Quantidade de Páginas | Testes com **uma** Página, mas o código já suporta várias: o painel lista as Páginas atribuídas ao usuário do sistema e o dono escolhe quais conectar. |
| Interface | Esconder Instagram, Zernio, "exigir que siga a conta", "próximo reel" e histórico de seguidores do Instagram. O código continua existindo. |
| Acesso | Standard Access, sem App Review (testado, ver abaixo) |

## Resultado do teste de viabilidade (Graph API Explorer, 2026-10-21)

Testado com o app `ipc-openreply` publicado (Live), casos de uso "Interagir com os clientes no Messenger from Meta" e "Gerenciar tudo na sua Página", acesso **Standard**. A Página foi "Stefanie Hoffman" (ID `1000571296467574`). O comentário veio de uma conta **sem papel no app**.

| Chamada | Resultado |
|---|---|
| `GET /{page-id}/feed?fields=...comments{id,message,from,created_time}` | Funciona, mas **o comentário de quem não tem papel no app vem sem `from`** |
| `POST /{page-id}/messages` com `recipient={"comment_id":...}` e `message={"text":...}` | ✅ Entregue. A resposta traz **`recipient_id` (PSID)** e `message_id` |
| `POST /{page-id}/messages` com `recipient={"id":PSID}`, `messaging_type=RESPONSE`, depois que a pessoa respondeu | ✅ Entregue |
| `POST /{comment-id}/comments?message=...` (resposta pública) | ✅ Devolve `id` |
| `POST /{comment-id}?is_hidden=true/false` | ✅ `success: true`. Se o comentário já está oculto, a Meta devolve erro `code=1`, `error_subcode=1446036` ("já marcado como spam"), **que deve ser tratado como sucesso** |
| `GET /{comment-id}?fields=is_hidden,can_hide` | ✅ Funciona |
| `DELETE /{comment-id}` | Não testado de propósito, porque não tem volta |

Consequências para o código:
- **O ID de quem comentou pode não vir na leitura**, e talvez também não venha no webhook (a confirmar na etapa 4). A fonte confiável do PSID é o **`recipient_id` da resposta da private reply**. Grave esse PSID para ligar o comentário às mensagens, botões e leituras da pessoa no Messenger.
- O filtro de comentário da própria conta continua necessário: `from.id === page id` quando `from` vier.
- As Páginas do dono estão num **portfólio empresarial**. O `GET /me/accounts` com token de usuário só listou a Página depois de selecioná-la na janela de permissão e incluir `business_management`. Com o usuário do sistema, o esperado é que `GET /me/accounts` liste as Páginas atribuídas a ele, com o token de cada uma. **Confirme na etapa 2.**

## Estado da infraestrutura (Fase 0)

Tudo no ar e saudável. `https://retention-meta.publisherscompany.com/api/health` responde `status: ok` com `worker.healthy: true`.

| Peça | Onde | Observação |
|---|---|---|
| Postgres | Supabase, session pooler, `us-west-2` | 23 migrações aplicadas |
| Redis | Railway, URL pública `*.proxy.rlwy.net` para a Vercel e a máquina local, interna `${{Redis.REDIS_URL}}` no worker | |
| Worker | Railway, serviço `ipc-openreply`, build `npm run db:generate`, start `npm run worker` | Variáveis: `DATABASE_URL`, `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `REDIS_URL` |
| Web | Vercel, time IPC (plano Hobby), domínio `retention-meta.publisherscompany.com` (CNAME no Cloudflare, DNS only) | 11 variáveis, sem as da Meta |
| Login do painel | Resend em modo de teste (`onboarding@resend.dev`), `ALLOWED_EMAILS=matheus@publisherscompany.com` | Cloudflare Access fica como tarefa futura |
| Repositório | `github.com/ipc-acquisition/ipc-openreply` (público), branch `main` | Railway e Vercel publicam a cada push no `main` |

Pendências de ambiente que esta migração introduz:
- `FACEBOOK_APP_ID` (novo) e `FACEBOOK_APP_SECRET` (já lido em `lib/meta/webhook.ts` para validar a assinatura) no `.env`, na Vercel e no worker do Railway.
- `META_GRAPH_API_VERSION` está `v25.0`. A documentação atual usa `v26.0`. Avalie subir.
- `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET` deixam de ser usados.

Estado do git: a exclusão do `.env.example` (pedida pelo dono) **não foi commitada**. O arquivo `saveweb2zip-com-styleguide-publisherscompany-com.zip` está fora do git e **não deve ser commitado**, porque o repositório é público. O `git config user.name/user.email` está vazio: pergunte ao dono antes do primeiro commit. **Não faça push sem confirmação.**

## Mapa do código (pontos de encaixe)

- **Camada de provedor:** `lib/instagram/context.ts` (`InstagramContext`, `createInstagramContext`), `lib/instagram/send-messages.ts`, `read-content.ts`, `read-inbox.ts` e `read-analytics.ts`. Cada função escolhe entre `META` e `ZERNIO`. É aqui que entra o ramo `FACEBOOK_PAGE`.
- **Cliente da Graph API (Instagram):** `lib/meta/client.ts`. Erros (`handleResponse`, `TokenExpiredError`, `RateLimitError`, `PermissionError`) e `facebookGraphBase()` já existem e podem ser reaproveitados.
- **Webhook:** `app/api/webhook/route.ts` chama `processInstagramWebhook` com `provider: 'META'` fixo. `lib/queue/process-webhook.ts` descarta `object !== 'instagram'`, e `lib/meta/webhook.ts` faz o mesmo em cada parser (`parseCommentEvents`, `parsePostbackEvents`, `parseMessageEvents`, `parseReadEvents`). A assinatura já aceita `FACEBOOK_APP_SECRET`.
- **Criptografia de tokens:** `encryptToken` e `decryptToken` em `lib/meta/oauth.ts`.
- **Modelo de conexão por workspace:** `ZernioConnection` em `prisma/schema.prisma`. Copie o padrão para guardar o token do usuário do sistema.
- **Worker:** `lib/queue/dm-worker.ts` (`processComment`, `processMessage`, `processPostback`, `processFollowUp`). **Ainda não mapeado.** Antes de mudar qualquer coisa, levante onde `commenterId` é lido e gravado e como o resultado do envio é usado.
- **Polling:** `lib/polling/comment-reconciler.ts` (usa `getUserMedia` e `getRecentMediaComments`).
- **Crons** (`vercel.json`): `refresh-tokens`, `attach-next-reel`, `snapshot-followers`. Os três precisam ignorar `FACEBOOK_PAGE`.
- **Interface:**
  - conexão: `app/(dashboard)/settings/page.tsx`, `app/(dashboard)/overview/page.tsx`, `components/instagram-connect-notice.tsx`, `components/top-bar.tsx`, `components/zernio-connection.tsx`;
  - funções a esconder: `components/campaign-builder.tsx`, `components/campaign-preview.tsx`, `app/(dashboard)/campaigns/page.tsx`, `app/(dashboard)/campaigns/[id]/page.tsx`;
  - textos: `lib/i18n/pt-BR.json`.
- **Testes existentes:** `__tests__/` (Vitest), por exemplo `webhook.test.ts`, `instagram-provider.test.ts`, `dm-worker.test.ts`, `comment-reconciler.test.ts`.

## Etapas (um commit cada)

### 1. Schema
- `InstagramProvider` ganha `FACEBOOK_PAGE`.
- Novo modelo `FacebookPageConnection` (nome sugerido), no padrão do `ZernioConnection`: `workspaceId @id`, `systemUserToken` criptografado, `systemUserId`, `createdAt` e `updatedAt`.
- Se o mapeamento do worker mostrar que é preciso, um campo opcional em `DmLog` para o PSID (por exemplo `recipientId String?`), em vez de sobrescrever `commenterId`. Decida depois de ler o worker.
- `prisma migrate dev --name add_facebook_page_provider`. Nunca edite migrações existentes.

### 2. Cliente da API de Páginas (`lib/meta/page-client.ts`)
Base `graph.facebook.com`, token da Página. Funções:
- `listSystemUserPages(systemUserToken)`: `GET /me/accounts?fields=id,name,tasks,access_token`. Confirme que funciona com token de usuário do sistema e se os tokens de Página vêm sem expiração.
- `subscribePageToWebhooks(pageId, pageToken)`: `POST /{page-id}/subscribed_apps` com os campos de comentários (`feed`), mensagens, botões (`messaging_postbacks`), leituras (`message_reads`) e echoes (`message_echoes`). **Confirme os nomes exatos dos campos na doc.**
- Private reply: `POST /{page-id}/messages` com `recipient.comment_id`. Versões só texto, com botão postback e com botões de link (button template). Devolva `recipient_id` e `message_id`.
- DM por PSID: `recipient.id` com `messaging_type=RESPONSE`. Mesmas três versões.
- Resposta pública: `POST /{comment-id}/comments`.
- Moderação (para a Fase 1): ocultar e reexibir com `POST /{comment-id}?is_hidden=`, tratando o subcódigo `1446036` como sucesso, e apagar com `DELETE /{comment-id}`.
- Leitura: posts (`/{page-id}/published_posts` ou `/feed`, confirme na doc), comentários (`/{post-id}/comments`), conversas (`/{page-id}/conversations?platform=messenger`) e dados da Página (nome, `followers_count`).
- Testes Vitest com `fetch` simulado: formato das requisições, PSID devolvido, `1446036` tratado como sucesso.

### 3. Roteamento do provedor
- `InstagramContext` ganha `{ provider: "FACEBOOK_PAGE"; pageId; accessToken }`.
- Cada função de `lib/instagram/*` ganha o ramo `FACEBOOK_PAGE`.
- Funções sem equivalente em Páginas (seguir a conta, insights de mídia, histórico de seguidores) devolvem "não suportado" de forma explícita, e a interface as esconde.
- Testes no padrão de `instagram-provider.test.ts`.

### 4. Webhook de Página
- `parse*Events` passam a aceitar `object: "page"`. Comentários chegam pelo campo `feed` com `item: "comment"` e `verb: "add"`. Ignore edição e remoção, e comentários da própria Página.
- Mensagens, postbacks e leituras têm o mesmo formato (`entry.messaging`). O PSID vem em `sender.id`.
- A rota `/api/webhook` escolhe o provedor pelo `object` (`instagram` vai para `META`, `page` vai para `FACEBOOK_PAGE`).
- Grave um payload real no `WebhookEvent` e **confirme se o `from` aparece** no comentário de quem não tem papel no app. Se não aparecer, o parser não pode descartar o evento por falta de `commenterId`, e o PSID tem de vir da resposta da private reply.
- Testes com payloads de Página em `__tests__/webhook.test.ts`.

### 5. Worker
- Depois de mapear, garanta que o PSID devolvido pela private reply fica gravado e é usado em botões, leituras, follow-up e na Fase 3 (drip).
- Token de Página expirado (`TokenExpiredError`): gere o token de novo pela `FacebookPageConnection` (`/me/accounts`) e tente uma vez.
- Mantenha claim antes do envio, rate limiter e a idempotência de `publicReplySentAt`.

### 6. Tela "Páginas do Facebook" (Configurações)
- O dono cola o token do usuário do sistema. O servidor valida (`/me`, `/me/accounts`), criptografa e salva. O token nunca volta para o navegador.
- Lista as Páginas atribuídas, com `tasks` (exigir `MESSAGING` e `MODERATE`). O dono marca quais conectar, e cada uma é salva como `InstagramAccount` (`provider: FACEBOOK_PAGE`) e inscrita no webhook.
- Mostra o estado da inscrição no webhook e um botão para desconectar.
- Só owner e admin do workspace (`canManageWorkspace`).

### 7. Interface pt-BR
- "Conectar Instagram" e Zernio saem da tela, e entra "Páginas do Facebook".
- No construtor de campanha, escondem-se "exigir que siga", "próximo reel" e o histórico de seguidores. Troque "reel" por "post" nos textos.
- Os crons `refresh-tokens`, `attach-next-reel` e `snapshot-followers` ignoram `FACEBOOK_PAGE`.

### 8. Documentação
- Reescreva o CLAUDE.md para Páginas: regras da Meta (private reply única em até 7 dias, janela de 24h do Messenger, sem tag de agente humano), endpoints de moderação (`is_hidden`, `DELETE`), permissões e Fases 1 a 3 adaptadas.
- Em `docs/setup.md`, uma seção "Páginas do Facebook" com o passo a passo da Meta abaixo.

## Passo a passo na Meta (o dono faz, a sessão guia um passo por vez)

1. No portfólio (Meta Business Suite → Configurações), criar um **usuário do sistema**.
2. Atribuir a ele a Página (com controle total) e o app `ipc-openreply`.
3. Gerar o token do usuário do sistema para o app, com `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `pages_manage_metadata` e `pages_messaging`, sem expiração se a opção existir. Colar o token **só no painel**, nunca no chat.
4. No app, configurar o webhook do objeto **Page**: URL `https://retention-meta.publisherscompany.com/api/webhook`, o mesmo `WEBHOOK_VERIFY_TOKEN` do `.env`, e assinar os campos de comentários, mensagens, botões, leituras e echoes.
5. Colocar `FACEBOOK_APP_ID` e `FACEBOOK_APP_SECRET` na Vercel e no worker do Railway.

## Critério de aceite

Com uma Página conectada pelo painel:
- uma conta sem papel no app comenta a palavra-chave e recebe a private reply em segundos;
- o `DmLog` fica `SENT` com o PSID gravado;
- a resposta pública aparece no comentário;
- quando a pessoa responde no Messenger, o follow-up chega;
- comentários da própria Página são ignorados.

## Pontos ainda não confirmados na documentação

- Se o `GET /me/accounts` com token de usuário do sistema devolve os tokens das Páginas, e se eles expiram.
- Nomes exatos dos campos de `subscribed_apps` e do webhook de Página (`feed`, `messages`, `messaging_postbacks`, `message_reads`, `message_echoes`).
- Se o `from` vem no webhook de comentário de quem não tem papel no app.
- Se postback (toque em botão) abre a janela de 24h no Messenger.
