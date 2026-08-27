# dsh-llm-cursor

Provider Cursor para o DSH com dois transportes: `native` (padrão, Connect/protobuf HTTP/2) e `sdk` (Cloud Agent `@cursor/sdk`).

```yaml
llm-cursor:
  transportMode: native # native (LLM no loop) ou sdk (Cloud Agent)
  apiKeyEnv: CURSOR_ACCESS_TOKEN # JWT; Sign in no card, ou cole o token
  refreshTokenEnv: CURSOR_REFRESH_TOKEN
  defaultModel: composer-2.5
  baseURL: https://api2.cursor.sh
  websiteURL: https://cursor.com
  clientVersion: 3.17.21
  # Omitido: usa o fuso retornado por Intl.DateTimeFormat().resolvedOptions().timeZone
  timezone: America/Sao_Paulo
  machineId: your-stable-machine-id
  macMachineId: your-stable-mac-machine-id
  ghostMode: false # true, false ou implicit-false
  models:
    - id: composer-2.5
      name: Composer 2.5
      contextWindow: 200000
      maxTokens: 32768
```

`clientVersion` é um valor estático no código (`3.17.21`, a versão mais recente publicada no canal `stable`/`win32-x64-user` no momento desta implementação — o mesmo número em `product.json` do cliente desktop instalado). O backend rejeita um pin antigo com `resource_exhausted` cuja mensagem humana diz que a versão do Cursor não é mais suportada; `listModels` então cai no array `models` (só Composer 2.5) e o chat falha. Sobrescreva `clientVersion` na configuração, ou atualize o default compilado, quando o backend exigir uma versão mais recente. O mesmo código Connect também cobre billing/quota (`analyticsMetadata.actionRequired: "payment"`); o adapter distingue o caso de versão pelo texto `no longer supported` / `cursor.com/downloads` e mapeia esse trailer para `PROVIDER_ERROR`, não `RATE_LIMIT`.

No modo `sdk`, `CURSOR_API_KEY` (ou `apiKeyEnv`) contém uma chave `crsr_...`; `CURSOR_SDK_KEY` é a referência persistida após mint. Se só houver `CURSOR_ACCESS_TOKEN` (JWT), o plugin chama `DashboardService/CreateUserApiKey` via HTTP/2, grava a chave e a reutiliza. No modo `native`, `apiKeyEnv`/`refreshTokenEnv` continuam apontando para JWT e refresh token (`CURSOR_ACCESS_TOKEN`/`CURSOR_REFRESH_TOKEN`).

## Login e autenticação

O plugin implementa nativamente em Node o fluxo OAuth-like do cliente desktop contra `api2.cursor.sh` — challenge/verifier PKCE-shaped, polling e refresh em JSON puro, sem protobuf — documentado em `src/auth.ts`. Três formas de obter/renovar tokens:

- **Login interativo (browser)**: quando a composição monta `ctx.authorization` (`@deepseek-ai/dsh-authorization`), o plugin registra automaticamente um flow `llm-cursor/cursor` com o método `browser`. Uma superfície (CLI, GUI de settings) chama `ctx.authorization.begin({ key: credentialKey('llm-cursor', 'cursor'), interaction })`; o flow abre `https://cursor.com/loginDeepControl?challenge=...&uuid=...&mode=login` (a superfície decide como — a notice carrega a `url`), faz polling de `GET /auth/poll?uuid=...&verifier=...` a cada 500ms (timeout padrão de 5 minutos) e, ao concluir, grava `accessToken`/`refreshToken` tanto num registro de credencial (`llm-cursor/cursor`, exigido pelo seam de authorization) quanto nas referências `apiKeyEnv`/`refreshTokenEnv` que o adapter lê. A função `loginInteractive()` (exportada) também pode ser chamada diretamente fora do seam de authorization, com `openBrowser: true` (padrão) para abrir o navegador padrão do SO via `start`/`open`/`xdg-open`.
- **Exchange headless por API key**: `exchangeApiKey(apiKey, { backendURL })` troca uma API key do dashboard (`crsr_...`) por `{accessToken, refreshToken}` via `POST /auth/exchange_user_api_key`, sem qualquer interação de navegador. Útil para provisionamento automatizado; o chamador é responsável por persistir o resultado nas referências de credencial.
- **Refresh**: `refreshTokens(refreshToken, { backendURL })` chama `POST /oauth/token` com `grant_type: "refresh_token"` e o `client_id` de produção do cliente oficial. Diferente do bundle do cliente desktop (que grava `access_token` também como `refreshToken` — ver comentário em `src/auth.ts`), esta implementação normaliza para a semântica OAuth2 padrão: mantém o `refreshToken` original quando a resposta não traz um novo.

O adapter nativo renova o access token automaticamente antes de cada `stream`/`listModels`: decodifica o `exp` do JWT atual (`decodeJwtExp`) e, se faltarem menos de 2 minutos para expirar (ou já tiver expirado) e houver um refresh token armazenado, chama `refreshTokens` e persiste o resultado via `ctx.credentials.set` antes de prosseguir. Chamadas concorrentes compartilham uma única promise de refresh em voo (nenhum refresh token é gasto duas vezes). Falha no refresh vira `LlmError` código `AUTH`. Um access token que não seja um JWT decodificável é usado como está, sem tentativa de refresh.

O adapter envia o histórico como mensagens protobuf nativas (reflection do `proto/lite.proto` via `protobufjs`), preserva turnos, mapeia schemas de tools para `mcp_tools` e decodifica frames Connect incrementais. Mensagens system são removidas de `conversation` e enviadas em `ExplicitContext.context`, que é o campo equivalente no proto.

### Matriz de suporte

| Capacidade | `sdk` | `native` |
|---|---|---|
| Chat Cloud Agent | sim | não |
| Histórico multi-turn | prompt textual com marcadores `[role]` | mensagens protobuf nativas |
| `listModels` | `Cursor.models.list({ apiKey })` | RPC `GetUsableModels` |
| tools | bridge local SDK (`sessionId` obrigatório) | tools nativas |
| temperature, stop | `UNSUPPORTED` | `UNSUPPORTED` |
| Auto-refresh JWT | mint de `crsr_` uma vez | refresh OAuth antes da chamada |

## Agentic loop (bridge de tools)

Quando `GenerateOptions.tools` existe, o SDK usa um Agent local (`local: { cwd, customTools }`) com `tools: ['mcp']`; Cloud Agent não suporta callbacks locais. Cada `sessionId` retém Agent, run e promises pendentes por até 30 minutos.

```text
stream(N, tools) -> SDK Agent.send -> customTool.execute
      -> tool-call-delta/block-end + finish(tool-calls)
stream(N+1, tool-result) -> resolve promise -> mesmo run
      -> texto/novas tools -> finish(stop|tool-calls)
```

`customTool.execute` nunca executa a ferramenta: publica o pedido DSH e aguarda o resultado da próxima chamada. `sessionId` é obrigatório para um ciclo agentic; sem ele é criado um id efêmero e o turno seguinte não pode reencontrar o run. Abort e descarregamento cancelam o run e rejeitam pendências; sessões inativas expiram em 30 minutos. O runtime local do SDK precisa estar disponível em modo headless; o fallback para MCP HTTP ainda não é implementado.

Sem tools, o adapter continua criando um Agent Cloud novo por stream. `onDelta` converte `text-delta` e `thinking-delta` para chunks DSH; usage de `turn-ended` precede `finish`. O ChatService da IDE é um transporte separado e não é usado pelo modo SDK.

### Transporte HTTP/2

`api2.cursor.sh` só oferece `h2` no ALPN de sua TLS; um cliente HTTP/1.1 (o `fetch` global do Node, via undici) recebe HTTP 464 "Incompatible Protocol Versions" do load balancer do host. Por isso o transporte (`src/transport.ts`, interface `CursorHttp2Transport`) usa `node:http2` diretamente: cada instância do adapter abre uma sessão HTTP/2 (`http2.connect(baseURL)`), reaberta lazily caso caia, e reaproveitada entre chamadas de `stream`/`listModels`. A sessão é fechada em `adapter.dispose()`, chamado quando o fiber do plugin descarrega (`ctx.effect()` em `index.ts`); um transporte injetado nos testes não é fechado pelo adapter — o teste o possui. O corpo da resposta é consumido como stream incremental, alimentando o mesmo decoder de frames Connect usado antes. `options.signal` aborta a requisição em qualquer fase (aguardando headers ou já recebendo o corpo) fechando o stream HTTP/2 subjacente. O timeout de espera por headers de resposta é configurável via `CursorTransportConfig.timeoutMs` (padrão 120000ms/120s) e produz `LlmError` código `TIMEOUT`.

O checksum usa o algoritmo oficial, com `machineId`/`macMachineId` persistentes; sem `machineId`, o provider deriva um hash estável de plataforma, arquitetura e identidade do host. O `x-session-id` é gerado uma vez por instância do plugin. Frames gzip (flag `0x01`) são descomprimidos; flags desconhecidas produzem `LlmError` código `PROTOCOL`. `temperature` e `stop` retornam `UNSUPPORTED`. `listModels('cursor')` consulta o RPC unário `aiserver.v1.AiService/GetUsableModels` em `application/connect+proto` sobre o mesmo transporte HTTP/2, com abort de 2,5s; o pedido vai em um frame Connect e a resposta é desempacotada por `payloadFromConnectBody` (dados, gzip, trailer, ou protobuf sem frame). A implementação usa `AvailableModelsRequest/Response` do dump 3.17.8: `model_names=1`, `models=2`, e `AvailableModel` com `name=1`, `context_token_limit=15`, `client_display_name=17` e `server_model_name=18`. Ids em `model_names` entram no catálogo quando nenhuma linha `models` já carrega esse id. Em falha, timeout, listagem vazia, trailer com `error` ou autenticação, usa o array `models` da configuração e registra `warn`.

### Frames Connect e erros de trailer

Todo stream do protocolo Connect termina com um frame de flags `0x02` (end-of-stream trailer), cujo payload é sempre JSON — nunca protobuf, mesmo em `application/connect+proto`. Um trailer `{}` (sem campo `error`) é fim normal do stream. Um trailer `{"error": {...}}` é decodificado (`decodeTrailer` em `src/protobuf.ts`) e mapeado para `LlmError` com um código estável:

| `error.code` do Connect | `LlmError.code` |
|---|---|
| `unauthenticated`, `permission_denied` | `AUTH` |
| `resource_exhausted` (quota / billing) | `RATE_LIMIT` |
| `resource_exhausted` (versão rejeitada: `no longer supported` / `cursor.com/downloads`) | `PROVIDER_ERROR` |
| qualquer outro | `PROVIDER_ERROR` |

A mensagem da `LlmError` combina `error.message` com o texto humano em `error.details[].debug.details.detail`, quando presente (o campo `error.message` sozinho costuma ser um placeholder genérico como `"Error"`; o texto útil para o usuário vive aninhado em `details`). Um stream que termina sem nenhum frame de trailer produz `LlmError` código `STREAM_CLOSED`.

### Cabeçalhos de cliente

Os cabeçalhos em `CursorAdapter.headers()` seguem a paridade observada no cliente desktop oficial (`setCommonHeaders`/`tzg`): `x-cursor-client-os` usa `process.platform` cru (`win32`/`darwin`/`linux`, sem normalizar para `windows`/`mac`), `x-cursor-client-layout` é sempre `'editor'` (o valor do desktop para uma instalação sem Glass/unified-agent), `x-new-onboarding-completed` é sempre `'false'`, `x-cursor-client-os-version` carrega `os.release()`, e `x-amzn-trace-id` reaproveita o mesmo valor de `x-request-id` (`Root=<x-request-id>`). `x-cursor-timezone` só é enviado quando o fuso configurado valida contra `Intl.DateTimeFormat('en-US', { timeZone })`; um fuso inválido é omitido em vez de enviado. `Connect-Protocol-Version`, `User-Agent: connect-es` e o content-type `application/connect+proto` permanecem como no adapter original.

## Model Experience

O modelo recebe a conversa nativa e schemas JSON das tools; texto e thinking são emitidos em blocos separados. Quando `StreamUnifiedChatResponse.debugging_only_token_count=3` chega, os valores são acumulados e um chunk `usage` (outputTokens) precede `finish`; sem esse campo, não há usage. `WebCitation.references` é simples no dump (`title=2`, `url=1`, `chunk=3`) e é anexado ao texto como links Markdown. O adapter não implementa cache de tokens.

## Known Limitations and Deferred Work

O protocolo privado do Cursor pode alterar campos, cabeçalhos ou framing sem aviso. `StreamUnifiedChatResponseWithTools` não declara `usage`/`token_usage` no `lite.proto` nem nos bindings upstream de referência; por isso o adapter emite `finish` diretamente quando não há usage disponível.

O comportamento do bundle do cliente desktop de gravar `access_token` também no campo de refresh após um refresh (ver `src/auth.ts`) é documentado como possível bug de minificação no relatório de engenharia reversa que fundamenta esta implementação; `refreshTokens()` não o replica e não foi possível confirmar contra o backend real se o `refresh_token` original continua aceito indefinidamente após múltiplos refreshes — `tests/auth.e2e.ts` cobre um único ciclo de exchange+refresh quando `CURSOR_API_KEY` está definido, mas não uma sequência longa. O `client_id` de produção (`KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB`) é específico do cliente oficial e pode mudar sem aviso entre versões.

O código Connect `resource_exhausted` / `ERROR_GPT_4_VISION_PREVIEW_RATE_LIMIT` com `title: "Update Required"` cobre tanto um pin `clientVersion` rejeitado quanto billing/quota (`actionRequired: "payment"`). O adapter mapeia o primeiro para `PROVIDER_ERROR` quando a mensagem humana contém `no longer supported` ou `cursor.com/downloads`; os demais `resource_exhausted` continuam `RATE_LIMIT`. Uma conta com quota ou pagamento pendente ainda vê `RATE_LIMIT` com o pin atualizado.
