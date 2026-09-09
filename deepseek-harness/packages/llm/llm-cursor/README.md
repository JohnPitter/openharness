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
  clientVersion: 3.19.13
  clientCommit: dd066f332fcea7382764400fde902f61920648d0
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

`clientVersion` e `clientCommit` são valores estáticos no código (`3.19.13` + o `commitSha` do mesmo build — os mesmos valores em `product.json` do cliente desktop instalado e na API de downloads do Cursor). O backend rejeita pins antigos; o endpoint antigo de chat (`aiserver.v1.ChatService`) está retirado do ar no servidor (`ERROR_DEPRECATED` / "version no longer supported"), por isso o modo `native` fala o protocolo do cursor-agent: `agent.v1.AgentService/Run` (stream BiDi Connect/protobuf sobre HTTP/2). Sobrescreva `clientVersion`/`clientCommit` na configuração, ou atualize os defaults compilados, quando o backend exigir um build mais recente. O código Connect `resource_exhausted` também cobre billing/quota; o adapter distingue o caso de versão pelo texto `no longer supported` / `cursor.com/downloads` e mapeia esse trailer para `PROVIDER_ERROR`, não `RATE_LIMIT`.

No protocolo de runs, cada turno abre um stream com um frame `run_request` (ação do usuário, `model_details`, `requested_model`, tools do harness declaradas como `mcp_tools` com `provider_identifier: openharness`); o servidor responde `request_context_args` (respondido com um env mínimo, sem workspace/tools) e streama `interaction_update` (`thinking_delta` → bloco reasoning, `text_delta` → bloco text, `turn_ended` com `input_tokens`/`output_tokens` → `usage` + `finish(stop)`). Uma chamada de tool chega como exec `mcp_args` (args em `google.protobuf.Value`), vira um bloco tool-call + `finish(tool-calls)` e o run fica aberto; a próxima `stream()` com tool-result reentra no MESMO run como frame `mcp_result`. Runs expiram em 30 minutos; turnos anteriores de um run novo são retransmitidos como texto marcado `[user]`/`[assistant]`/`[tool result ...]` dentro da mensagem do usuário (o replay nativo do protocolo usa blobs enviados pelo cliente — `ConversationStateStructure.turns` + `UploadConversationBlobs` — que este adapter não implementa). O system prompt vai em `system_prompt_spec.append` (o campo `custom_system_prompt` é rejeitado nesta conta com `unknown option '--system-prompt'`).

No modo `sdk`, `CURSOR_API_KEY` (ou `apiKeyEnv`) contém uma chave `crsr_...`; `CURSOR_SDK_KEY` é a referência persistida após mint. Se só houver `CURSOR_ACCESS_TOKEN` (JWT), o plugin chama `DashboardService/CreateUserApiKey` via HTTP/2, grava a chave e a reutiliza. No modo `native`, `apiKeyEnv`/`refreshTokenEnv` continuam apontando para JWT e refresh token (`CURSOR_ACCESS_TOKEN`/`CURSOR_REFRESH_TOKEN`).

## Login e autenticação

O plugin implementa nativamente em Node o fluxo OAuth-like do cliente desktop contra `api2.cursor.sh` — challenge/verifier PKCE-shaped, polling e refresh em JSON puro, sem protobuf — documentado em `src/auth.ts`. Três formas de obter/renovar tokens:

- **Login interativo (browser)**: quando a composição monta `ctx.authorization` (`@deepseek-ai/dsh-authorization`), o plugin registra automaticamente um flow `llm-cursor/cursor` com o método `browser`. Uma superfície (CLI, GUI de settings) chama `ctx.authorization.begin({ key: credentialKey('llm-cursor', 'cursor'), interaction })`; o flow abre `https://cursor.com/loginDeepControl?challenge=...&uuid=...&mode=login` (a superfície decide como — a notice carrega a `url`), faz polling de `GET /auth/poll?uuid=...&verifier=...` a cada 500ms (timeout padrão de 5 minutos) e, ao concluir, grava `accessToken`/`refreshToken` tanto num registro de credencial (`llm-cursor/cursor`, exigido pelo seam de authorization) quanto nas referências `apiKeyEnv`/`refreshTokenEnv` que o adapter lê. A função `loginInteractive()` (exportada) também pode ser chamada diretamente fora do seam de authorization, com `openBrowser: true` (padrão) para abrir o navegador padrão do SO via `start`/`open`/`xdg-open`.
- **Exchange headless por API key**: `exchangeApiKey(apiKey, { backendURL })` troca uma API key do dashboard (`crsr_...`) por `{accessToken, refreshToken}` via `POST /auth/exchange_user_api_key`, sem qualquer interação de navegador. Útil para provisionamento automatizado; o chamador é responsável por persistir o resultado nas referências de credencial.
- **Refresh**: `refreshTokens(refreshToken, { backendURL })` chama `POST /oauth/token` com `grant_type: "refresh_token"` e o `client_id` de produção do cliente oficial. Diferente do bundle do cliente desktop (que grava `access_token` também como `refreshToken` — ver comentário em `src/auth.ts`), esta implementação normaliza para a semântica OAuth2 padrão: mantém o `refreshToken` original quando a resposta não traz um novo.

O adapter nativo renova o access token automaticamente antes de cada `stream`/`listModels`: decodifica o `exp` do JWT atual (`decodeJwtExp`) e, se faltarem menos de 2 minutos para expirar (ou já tiver expirado) e houver um refresh token armazenado, chama `refreshTokens` e persiste o resultado via `ctx.credentials.set` antes de prosseguir. Chamadas concorrentes compartilham uma única promise de refresh em voo (nenhum refresh token é gasto duas vezes). Falha no refresh vira `LlmError` código `AUTH`. Um access token que não seja um JWT decodificável é usado como está, sem tentativa de refresh.

O adapter codifica/decodifica as mensagens `agent.v1` via reflection do `proto/agent.proto` (`protobufjs`) — uma projeção esparsa do schema real (só os campos que o adapter lê/escreve; números de campo extraídos do pacote do cursor-agent CLI), com `google.protobuf.Value` redeclarado em `agent.v1` (idêntico no wire). Frames Connect são decodificados incrementalmente; frames do servidor que o adapter não reconhece (outros exec args, updates desconhecidos) são ignorados, e um watchdog de stall (`runStallTimeoutMs`, padrão 120s, só frames com progresso do turno reiniciam) falha o turno com `TIMEOUT`.

### Matriz de suporte

| Capacidade | `sdk` | `native` |
|---|---|---|
| Chat Cloud Agent | sim | não |
| Histórico multi-turn | prompt textual com marcadores `[role]` | texto marcado `[role]` dentro da mensagem do usuário |
| `listModels` | `Cursor.models.list({ apiKey })` | RPC unário `GetUsableModels` (`application/proto`) |
| tools | bridge local SDK (`sessionId` obrigatório) | bridge `mcp_args`/`mcp_result` no mesmo run |
| temperature, stop | `UNSUPPORTED` | `UNSUPPORTED` |
| Anexos de imagem | não | não (`PROVIDER_ERROR`) |
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

O checksum usa o algoritmo oficial, com `machineId`/`macMachineId` persistentes; sem `machineId`, o provider deriva um hash estável de plataforma, arquitetura e identidade do host. `x-request-id`, `x-amzn-trace-id` (`Root=<x-request-id>`) e `x-session-id` são gerados por chamada. Frames gzip (flag `0x01`) são descomprimidos; flags desconhecidas produzem `LlmError` código `PROTOCOL`. `temperature` e `stop` retornam `UNSUPPORTED`. `listModels('cursor')` consulta o RPC unário `aiserver.v1.AiService/GetUsableModels` com corpo protobuf cru em `application/proto` (sem frame Connect; a resposta também pode vir enquadrada — `payloadFromConnectBody` cobre ambos) sobre o mesmo transporte HTTP/2, com abort de 2,5s; a resposta é `GetUsableModelsResponse` com linhas `ModelDetails` (`model_id=1`, `display_name=4`). Em falha, timeout, listagem vazia ou autenticação, usa a última listagem que funcionou e, em primeira falha, o array `models` da configuração, registrando `console.error`.

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

Os cabeçalhos em `CursorAgentAdapter.headers()` seguem a paridade observada no cursor-agent/desktop 3.19.x: `x-cursor-client-version` + `x-cursor-client-commit` (o par do build), `x-cursor-client-os` usa `process.platform` cru (`win32`/`darwin`/`linux`), `x-cursor-client-layout` é sempre `'editor'`, `x-cursor-client-type` é `'ide'`, `x-cursor-client-device-type` é `'desktop'`, `x-new-onboarding-completed` é `'false'`, `x-cursor-client-os-version` carrega `os.release()`, `x-cursor-client-arch` carrega `process.arch`, e `x-amzn-trace-id` reaproveita o mesmo valor de `x-request-id` (`Root=<x-request-id>`). O stream BiDi usa `content-type`/`accept` `application/connect+proto` com `connect-protocol-version: 1`.

## Model Experience

O modelo recebe o turno atual mais o histórico retransmitido como texto marcado, o system prompt em `system_prompt_spec.append` e os schemas JSON das tools como `mcp_tools`. Thinking e texto chegam como `thinking_delta`/`text_delta` e são emitidos em blocos separados (reasoning antes de text). `turn_ended` carrega `input_tokens`/`output_tokens` reais do turno, emitidos como chunk `usage` antes de `finish`; `cache_write`/`cache_read` existem no proto mas não são expostos. O adapter não implementa cache de tokens e o servidor mantém o stream aberto com heartbeats após `turn_ended` (o cliente fecha).

## Known Limitations and Deferred Work

O protocolo privado do Cursor pode alterar campos, cabeçalhos ou framing sem aviso; `proto/agent.proto` é uma projeção esparsa (campos desconhecidos decodificam como mensagens vazias e são ignorados). Limitações do estágio atual: anexos de imagem falham com `PROVIDER_ERROR`; o histórico entre runs vai como texto marcado na mensagem do usuário (o replay nativo por blobs — `ConversationStateStructure.turns` + `UploadConversationBlobs` — não é implementado); as ferramentas built-in do Cursor (shell/read/write/grep) não são oferecidas nem respondidas — um exec desconhecido aciona o watchdog de stall; `exclude_workspace_context` é rejeitado pela conta atual (`invalid_argument`) e por isso não é enviado.

O comportamento do bundle do cliente desktop de gravar `access_token` também no campo de refresh após um refresh (ver `src/auth.ts`) é documentado como possível bug de minificação no relatório de engenharia reversa que fundamenta esta implementação; `refreshTokens()` não o replica e não foi possível confirmar contra o backend real se o `refresh_token` original continua aceito indefinidamente após múltiplos refreshes — `tests/auth.e2e.ts` cobre um único ciclo de exchange+refresh quando `CURSOR_API_KEY` está definido, mas não uma sequência longa. O `client_id` de produção (`KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB`) é específico do cliente oficial e pode mudar sem aviso entre versões.

O código Connect `resource_exhausted` / `ERROR_GPT_4_VISION_PREVIEW_RATE_LIMIT` com `title: "Update Required"` cobre tanto um pin `clientVersion` rejeitado quanto billing/quota (`actionRequired: "payment"`). O adapter mapeia o primeiro para `PROVIDER_ERROR` quando a mensagem humana contém `no longer supported` ou `cursor.com/downloads`; os demais `resource_exhausted` continuam `RATE_LIMIT`. Uma conta com quota ou pagamento pendente ainda vê `RATE_LIMIT` com o pin atualizado.
