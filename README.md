# OpenHarness

Shell desktop Windows do [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): um `.exe` único com o sidecar Node local e a UI oficial em iframe.

<p align="center">
  <img src="frontend/dist/logo.png" width="96" alt="OpenHarness" />
</p>

## O que é

OpenHarness empacota o harness num app frameless (Wails v2). Na primeira execução o runtime vai para `%LOCALAPPDATA%\openharness\runtime`; as sessões e chaves ficam em `%LOCALAPPDATA%\openharness\dsh-home`.

Não é um agente aninhado (Cursor Cloud / SDK). É o loop do harness falando direto com os provedores.

## Provedores

Um card por família na lista padrão (Settings → Modelos):

| UI | Rota | Chave | Uso |
| --- | --- | --- | --- |
| Kimi for Code | `kimi-for-coding` | `KIMI_API_KEY` | API Kimi for Coding |
| DeepSeek | `deepseek-official` | `DEEPSEEK_API_KEY` | API DeepSeek |
| Claude Code | `claude-code` | `CLAUDE_CODE_OAUTH_TOKEN` | Plano Pro/Max (Sign in ou `claude setup-token`) |
| Codex | `openai-codex` | `CODEX_ACCESS_TOKEN` | Plano ChatGPT Codex (JWT) |
| GLM Coding Plan | `zai` | `ZAI_API_KEY` | Coding Plan Z.AI |
| OpenCode | `opencode` | `OPENCODE_API_KEY` | [Zen](https://opencode.ai/docs/zen) chat-completions (`https://opencode.ai/zen/v1`) |

Console Anthropic e OpenAI Platform entram em **Adicionar provedor**. A chave OpenCode sai de [opencode.ai/auth](https://opencode.ai/auth). GPT (Responses) e Claude (Messages) no Zen usam outro protocolo — dá para declarar à mão com o mesmo `OPENCODE_API_KEY`.

## Requisitos

- Windows 10/11 x64
- [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (já vem no Windows recente)
- Para *build*: Go 1.25+, [Wails v2](https://wails.io), Node/pnpm se for rebuildar o harness

## Instalar

1. Abra a [release mais recente](https://github.com/JohnPitter/openharness/releases/latest) (repo privado — precisa de permissão ou PAT).
2. Baixe `openharness.exe`.
3. Execute. O runtime extrai só quando o conteúdo muda.

### Auto-update

O app consulta as tags/releases do GitHub. Repo privado exige autenticação:

1. Crie um PAT fine-grained com **Contents: Read** neste repositório.
2. Grave em `%LOCALAPPDATA%\openharness\github.token` **ou** defina `OPENHARNESS_GITHUB_TOKEN`.
3. Na titlebar aparece **vX.Y.Z disponível → Atualizar**. O exe é trocado e o app reabre.

## Desenvolvimento

```powershell
# Runtime do sidecar (já gerado em internal/sidecar/assets/)
wails generate module
Copy-Item -Recurse -Force frontend\wailsjs frontend\dist\wailsjs
wails build          # build/bin/openharness.exe
go test ./...
go vet ./...
```

O zip `dsh-runtime` e o `node.exe` **não** entram no git (`internal/sidecar/assets/`). Sem eles o `wails build` local não embute o sidecar.

Rebuild da face web do harness (marca OpenHarness):

```powershell
cd deepseek-harness
$env:DSH_CLIENT_BUILD_PROFILE = 'official'
$env:DSH_CLIENT_TITLE = 'OpenHarness'
pnpm run build:lib:client
pnpm --filter @deepseek-ai/dsh-web-frontend run build
```

Detalhes do pipeline, OAuth e cotas: [`AGENTS.md`](AGENTS.md).

## CI e releases

| Workflow | Quando | O que faz |
| --- | --- | --- |
| [Actions quality](.github/workflows/actions-quality.yml) | push/PR em `.github/workflows/**` | [actionlint](https://github.com/rhysd/actionlint) + [zizmor](https://github.com/zizmorcore/zizmor) |
| [CI](.github/workflows/ci.yml) | push/PR | `go test` / `go vet` |
| [Release](.github/workflows/release.yml) | tag `v*.*.*` | cria a GitHub Release (notas automáticas) |

Publicar um binário:

```powershell
wails build -ldflags "-X openharness/internal/update.Version=0.1.4"
git tag v0.1.4
git push origin v0.1.4
gh release upload v0.1.4 build/bin/openharness.exe
```

O auto-update procura o asset exatamente chamado `openharness.exe`.

## Layout

```
main.go                 # janela Wails
internal/sidecar/       # extrai zip+node, sobe dsh web
internal/update/        # check/apply via GitHub Releases
internal/app/           # bindings do shell
frontend/dist/          # titlebar + iframe
deepseek-harness/       # fonte do harness (overlay OpenHarness)
```

## Licença

O shell OpenHarness segue o mesmo espírito do harness original. O código em `deepseek-harness/` permanece sob a licença do projeto DeepSeek Harness.
