# OpenHarness — shell desktop do DeepSeek Harness

App desktop (Wails v2) que empacota o **DeepSeek Harness** original (TypeScript,
`deepseek-harness/`) num único `.exe` Windows: o harness roda como sidecar local
(node.exe embutido + árvore de runtime buildada) e a UI web oficial
(`apps/web`) é exibida num iframe dentro do shell.

## Arquitetura

```
main.go                 entrypoint Wails (janela frameless)
internal/
  sidecar/              Manager: extrai assets embutidos para
                        %LOCALAPPDATA%\openharness\runtime (stamp por conteúdo:
                        CRC dos arquivos do zip + hash do node.exe — rezip sem
                        mudar arquivos reusa o cache), sobe `node lib/bin.js web
                        --no-open --host 127.0.0.1 --port 0`, captura a URL do stdout
                        ("dsh web: http://..."), DSH_HOME isolado em
                        %LOCALAPPDATA%\openharness\dsh-home
  sidecar/assets/       node.exe + dsh-runtime.zip (embed via go:embed; NÃO
                        commitar — ver .gitignore; gerados pelo pipeline abaixo)
  app/                  bindings Wails: HarnessState, RestartHarness,
                        EnableRemote / DisableRemote (túnel + QR)
  remote/               proxy em 127.0.0.1 + túnel HTTPS público com cookie
                        de token; o celular abre o harness como no desktop
frontend/dist/          shell estático (sem build step): titlebar própria
                        (logo, --wails-draggable, min/max/close via runtime
                        Wails) + iframe full-bleed para a URL do harness
build/appicon.png       mascote transparente (cabeça no anel azul + nós verdes); windows/icon.ico idem
```

## Pipeline do runtime embutido

O loader Cordis resolve plugins por nome a partir de `$DSH_HOME/profiles`, então
o runtime precisa de arquivos REAIS em disco (por isso extração, não SEA/pkg).

```powershell
cd deepseek-harness
pnpm install && pnpm run build          # builda libs + apps/web/dist
# staging sem symlinks (mesma rota do scripts/build-exe-for-python-sdk.ts):
pnpm --filter @deepseek-ai/dsh deploy --legacy --prod `
  --config.node-linker=hoisted --config.auto-install-peers=false `
  --config.link-workspace-packages=true ..\dsh-runtime
# + restore de hoists, materialização de links e cópia de TODOS os pacotes
#   workspace @deepseek-ai/* faltantes (vendor/* é raiz de pacote, 1 nível).
#   O deploy --prod NÃO inclui transitivos do Cordis: cosmokit, schemastery,
#   cordis-plugin-group, cordis-plugin-logger-console — sem eles o sidecar
#   cai com ERR_MODULE_NOT_FOUND no primeiro import de cordis.
# O staging NÃO é hardlink: copie de novo cada packages/*/*/lib para
# dsh-runtime/node_modules/@deepseek-ai/<pkg>/lib. Recopie apps/web/dist
# para dsh-web-frontend/dist. Confira RemoteChip (ou outra string nova) no
# client.js de dsh-client-ui-model-selection no staging antes de zipar.
# zipar dsh-runtime -> internal/sidecar/assets/dsh-runtime.zip
# copiar node.exe -> internal/sidecar/assets/node.exe
```

## Rebrand (deepseek → openharness)

Marca da UI trocada na fonte do monorepo (não há patch em runtime — edite lá e
rebuilde). A tela de boot não vive mais em `AppRoot.tsx`: o rc.8 preenche a
marca via slots em `packages/client/ui-brand-official` (só registra se
`DSH_CLIENT_BUILD_PROFILE === 'official'`). O título do produto vem de
`DSH_CLIENT_TITLE` (inlinado no bundle client).

Build da face client/web:

```powershell
$env:DSH_CLIENT_BUILD_PROFILE = 'official'
$env:DSH_CLIENT_TITLE = 'OpenHarness'
# opcional: $env:DSH_CLIENT_COMMIT_HASH = (git -C deepseek-harness rev-parse --short HEAD)
pnpm run build:lib:client
pnpm --filter @deepseek-ai/dsh-web-frontend run build
```

Arquivos da marca:

- `apps/web/index.html` (title), `apps/web/public/favicon.svg` (mascote
  transparente), `apps/web/public/manifest.webmanifest`
- `packages/client/ui-primitives/src/BrandWordmark.tsx` e `FishLogo.tsx`
  (mascote; `includeMark=false` deixa o box vazio para o nome slotted)
- `packages/client/ui-brand-official/src/client/` (`OfficialBrandMark` /
  `OfficialBrandName` nos slots sidebar/hero)
- `packages/client/ui-conversation/src/client/locales.ts` (`hero.headline`)
- `packages/client/ui-settings-models/src/onboarding-copy.ts` (aviso de boas-vindas)

Locales pt (pt-BR) e es adicionados: `packages/client/locale` (LOCALE_IDS/LOCALES,
dicionários common + settings) e dicionários `pt`/`es` em todos os `locales.ts`
(23 pacotes em `packages/client/*` + `packages/extensions/ui-cordis` +
`packages/session-query/session-log-export`). O registro tipado exige todos os
locales por namespace — ao criar dicionário novo, inclua zh/en/pt/es.

## Provider Kimi for Code

`packages/llm/llm-kimi` é um clone adaptado de `llm-deepseek` (wire OpenAI
chat-completions): rota `kimi-for-coding`, base `https://api.kimi.com/coding/v1`
(env `KIMI_BASE_URL`), chave `KIMI_API_KEY`, modelos `kimi-for-coding` (K2.7)
e `k3` / `k3-256k` (K3). Diferenças do DeepSeek: K2.x usa `thinking: {type}`
(off/high; K2.7 Code não desliga thinking); K3 usa `reasoning_effort`
`low`/`high`/`max` (sempre pensa, sem Off). Sem headers `x-deepseek-harness-*`,
`x-trace-id` como request id, e `prompt_cache_key = sessionId` (afinidade de
cache do Kimi). Com chave configurada, o discovery busca o `GET /models` ao
vivo do endpoint e mescla sobre o catálogo (capacidades reais enriquecem até
ids não catalogados); sem chave ou falha, cai no catálogo estático. Editor de
settings igual ao DeepSeek (`layoutOf` em `ui-settings-models/ProviderEditor.tsx`
mapeia `llm-kimi` → família `kimi`). Registrado em `packages/bundle/base/cordis.patch.yml` +
`package.json` + referência em `tsconfig.host.json`. A chave se configura em
Settings → Models (seção `llm-kimi`) ou via `KIMI_API_KEY`.

## Providers Claude Code, Codex e GLM

Rotas do catálogo `llm-pi-ai` (não plugins próprios): o adapter já fala
Anthropic Messages, OpenAI Responses, Codex Responses e o dialect `thinkingFormat: zai`.
A lista padrão em Settings → Models é **um card por família** (plano de coding).
Console Anthropic (`anthropic`) e OpenAI Platform (`openai`) ficam no catálogo
e entram por **Adicionar provedor** — mesmos modelos, cobrança pay-per-token.
Composição em `packages/bundle/base/cordis.patch.yml` (`llm-pi-ai.config.providers`).
`catalog:` herda a tabela de modelos de outro vendor (Claude Code herda `anthropic`).

| UI | rota pi-ai | chave | o que é |
|--------|-------------|-------|---------|
| Claude Code | `claude-code` | `CLAUDE_CODE_OAUTH_TOKEN` | Plano Pro/Max (`claude setup-token`, `sk-ant-oat…`) |
| Codex | `openai-codex` | `CODEX_ACCESS_TOKEN` | Plano ChatGPT Codex (JWT em `%USERPROFILE%\.codex\auth.json`) |
| GLM Coding Plan | `zai` | `ZAI_API_KEY` | Coding Plan em `https://api.z.ai/api/coding/paas/v4` |
| OpenCode | `opencode` | `OPENCODE_API_KEY` | Gateway Zen (`https://opencode.ai/zen/v1`, chat-completions) |

Claude Code: o pi-ai detecta `sk-ant-oat` e manda Bearer + identity de Claude Code.
Codex: o token precisa ser JWT com `chatgpt_account_id`; `sk-` da Platform não serve nessa rota.
Cursor **não** entra: não há `/v1/chat/completions` oficial do plano Cursor (só Cloud Agents / SDK, que é outro agente, não um LLM no loop do harness).

Login OAuth (Settings → Models, no card do provider): Claude Code e Codex
aceitam **Sign in** (PKCE no browser, callback localhost) **e** colar token.
Codex também oferece device code se a porta 1455 estiver ocupada. Tokens ficam
em `$DSH_HOME/pi-ai-oauth.json` e o pi-ai faz refresh no request. HTTP:
`GET/POST /dsh-llm-pi-ai/oauth/{status,login,logout}`.

Para mudanças só de UI basta `build:lib:client` + web (com os env de marca
acima). A face host do tsdown no Windows não expande o glob
`lib/types/{index,invariant,startup}.js` no pacote raiz — o overlay
`openharness-expand-host-entries` em `tsdown.config.ts` + stub
`scripts/tsdown-root-stub.js` contorna isso. Rodar `pnpm run build` completo só
quando libs host mudarem. O staging `dsh-runtime/` é uma cópia independente:
depois de rebuildar, sincronize cada `lib/` do workspace para
`dsh-runtime/node_modules/@deepseek-ai/<pkg>/lib` e recopie `apps/web/dist`
para `dsh-web-frontend/dist` antes de rezipar. Não confie em hardlink.

## Comandos

```powershell
wails generate module                              # regera frontend/wailsjs
Copy-Item -Recurse -Force frontend\wailsjs frontend\dist\wailsjs   # bindings vivem DENTRO do embed
wails build   # gera build/bin/openharness.exe (~158 MB com assets embutidos)
wails dev     # desenvolvimento (requer assets já gerados)
go vet ./...  # lint
```

## Notas

- Primeira execução extrai o runtime para `%LOCALAPPDATA%\openharness\runtime`. Rebuilds do exe só extraem de novo se o conteúdo do runtime ou do `node.exe` mudou (não o hash bruto do zip).
- A chave da API se configura na própria UI do harness (settings) ou via
  `DEEPSEEK_API_KEY` / `KIMI_API_KEY` / `ANTHROPIC_API_KEY` /
  `CLAUDE_CODE_OAUTH_TOKEN` / `OPENAI_API_KEY` / `CODEX_ACCESS_TOKEN` /
  `ZAI_API_KEY` / `OPENCODE_API_KEY`.
- Auto-update consulta as GitHub Releases públicas; não precisa de token.
  O chip na titlebar checa no boot (com retries) e a cada 15 min. Uma
  instância já aberta não vê um tag novo até o próximo check.
- **Remote** (sidebar, acima do modelo em uso): opt-in. O exe publica um HTTPS
  público (túnel Cloudflare Quick Tunnel a partir de `127.0.0.1`) com um token
  no QR; o celular usa o harness completo (todas as sessões) de qualquer rede,
  enquanto o PC estiver ligado e o OpenHarness aberto. Quem tiver o link tem o
  mesmo poder que o desktop. Precisa de internet no PC; a primeira vez baixa
  `cloudflared` para `%LOCALAPPDATA%\openharness\cloudflared`.
- **Modo Workflow:** o Planejador só pensa e delega (sem grep/edit/shell); uma
  ou duas tarefas vão só por `subagent` — a ferramenta `workflow` não é shell.
  O Trabalhador recolhe informação e aplica as modificações, no modelo escolhido
  no chip da direita. Em criação/edição de código, o planejador põe no prompt
  do trabalhador trechos dos padrões (AGENTS.md etc.), não o arquivo inteiro.
  Planejador cobrado por request sem trabalhador no chip **não herda** a rota
  do pai: a delegação falha e o composer bloqueia até haver trabalhador. Trocar
  o preset recompõe a sessão e compacta antes do próximo prompt comum.
- **Marcos:** o modelo que fecha o trabalho grava `milestone_write` (título +
  corpo). O transcript não é índice: o trilho à esquerda salta para o chip;
  compactação preserva os títulos. No Workflow o trabalhador escreve; o
  planejador não vê a tool. Em telas de até 720px, o trilho fixado vira overlay
  absoluto; recolhido, mantém ocupação zero.
- **Custo por rota:** coding plans (Kimi, Claude Code, Codex, GLM, OpenCode)
  cobram por request; DeepSeek e plataformas pay-per-token cobram por token.
  Em rota de request o harness não dispara título-LLM nem compact-LLM por
  pressão (overflow e `/compact` continuam). A unidade vem do adapter
  (`metering`), não do nome do provedor.
- **Busca na web:** padrão é DuckDuckGo (HTML, sem chave). A busca nativa
  DeepSeek fica desativada; ela cobra saldo DeepSeek mesmo se o chat for Kimi.
- **J-Space:** skill empacotada em `apps/cli/config/skills/j-space`, nos presets
  Standard, Code e Workflow. Protocolo de construção (fast/full/loop); se a
  tarefa admite duas leituras com ações diferentes, carrega `problem-model`.
  Desligado esconde `j-space` do catálogo e da ferramenta `skill` (o `/j-space`
  do usuário continua). A skill carrega no máximo uma vez; módulos seguintes
  são Read no resource base, não outro `skill`.
- **Perguntas de subagente:** `ask_user_question` no filho não espera o composer
  do pai. Escolhe a opção `(Recommended)` (senão a primeira). Sem opções, falha
  com `DELEGATED_CALLER` em vez de travar.
- O SQLite de sessão do rc.8 (v2) **não** lê o storage antigo: dados em
  `%LOCALAPPDATA%\openharness\dsh-home` de um exe rc.5 podem quebrar. Se a UI
  não subir sessões, apague (ou renomeie) essa pasta e reabra o app.
- Tentativa de exe único via `@yao-pkg/pkg --sea` foi descartada: o loader
  Cordis cria junctions em `$DSH_HOME/profiles/node_modules` apontando para
  diretórios reais, incompatível com o FS virtual /snapshot do SEA.
