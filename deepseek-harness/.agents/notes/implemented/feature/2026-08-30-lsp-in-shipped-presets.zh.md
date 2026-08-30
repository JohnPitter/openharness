# Agent Note: 将 LSP 组合进已发布的 agent 预设

Status: implemented

[English](2026-08-30-lsp-in-shipped-presets.md) | 中文

## 问题

[LSP 能力 seam](../architecture/2026-07-15-lsp-capability-seam.zh.md) 发布了三个经过完整测试的包——`dsh-lsp`、`dsh-lsp-stdio`、`dsh-tool-lsp`——但没有任何部署组合过它们：`packages/bundle/base` 没有，四个已发布的 agent 预设（Standard、Code、Workflow、Cordis）都没有，`apps/cli/package.json` 也没有。该 seam 说明本身已经点名这是预期的扩展点（"future presets belong in composition plugins or `cordis.yml` overlays"），所以尽管这项能力已经产品就绪，模型可用的 `lsp` 工具却从未进入过真实会话。

## 决策

把该 seam 组合进每一个已经携带 `tool-fs-search` 的已发布预设（Standard、Code、Workflow 的 worker、Cordis）：一个 `cordis:group` 行（`id: lsp`）隔离 `ctx.lsp`——这三个包唯一发布的服务——里面是 `lsp-service`（`dsh-lsp`）、配置了一条 `typescript` server 记录的 `lsp-stdio`（`dsh-lsp-stdio`），以及 `tool-lsp`（`dsh-tool-lsp`）。`lsp-stdio` 和 `tool-lsp` 自己不发布任何服务，也不需要 realm。

`typescript-language-server` 及其 `typescript` 对等依赖成为 `apps/cli` 的真实依赖（而非 `npx`），随打包运行时一起部署进 `node_modules/.bin`，和其他每一个已发布的工具二进制一样，而不是首次使用时才通过网络拉取——这与产品「一切都在你的磁盘上」的定位一致。`command: typescript-language-server` 在生成子进程时按 PATH 解析，与 `lsp-stdio` 自己文档记载的解析方式相同。

TypeScript/JavaScript（`.ts`、`.tsx`、`.js`、`.jsx`、`.mjs`、`.cjs`）是第一个、也是目前唯一配置的语言：`typescript-language-server` 相对被分析的工作区解析 `typescript`，因此结果取决于该项目自己是否安装了 `typescript`——这是该 server 本身固有的性质，harness 并不会替它掩盖。要新增语言，在每个预设里扩展 `servers` 即可。

## 考虑过的替代方案

**通过 `npx --yes` 启动 server，与 `examples/headless-agent/e2b.cordis.yml` 演示一致。** 对已发布产品予以拒绝：一个整体卖点是本地优先、中间不经过云端的打包桌面应用，不应该在会话第一次打开 TypeScript 文件时依赖一次 npm registry 拉取，尤其是离线或受限网络下。

**只在 `packages/bundle/base` 里组合一次 `lsp`／`lsp-stdio`／`tool-lsp`，而不是逐个预设组合。** 不予采纳：`ctx.lsp` 是一个具名服务，和 `ctx.compaction`／`ctx.toolResultPruner` 完全一样（见[压缩能力 seam 说明](../feature/2026-06-18-compaction-capability-seam.zh.md)），而 `web-app` bundle 已经把基础 bundle 里那些会话作用域的服务禁用，转而使用预设各自持有的隔离实例（见[预设之后的宿主层归属](2026-08-10-host-plane-ownership-after-presets.zh.md)）；在基础 bundle 里注册会与每预设各自的非隔离同名注册冲突。

**在本次改动里支持 harness 可能触及的每一种语言 server（Python、Go、Rust……）。** 不予采纳：需求未经验证，且各 server 的启动/延迟未经测试；TypeScript 确立了这套组合形态，由该包自己钉住的 e2e 测试证明可行，而 `servers` 可以逐预设追加，无需改动源码。

## 后果

每个使用 Standard、Code、Workflow worker 或 Cordis 预设的会话现在都能看到 `lsp` 工具及其系统提示引导；token 成本是 [tool-lsp README](../../../packages/lsp/tool-lsp/README.zh.md) 记载的固定 schema/提示成本，插件激活期间每次请求都存在。`typescript-language-server`／`typescript` 会增加打包运行时的安装体积。没有自己安装 `typescript` 的工作区，查询会得到结构化的 LSP 错误，而不是悄悄给出错误结果。

## 测试

`apps/cli/tests/lsp-composition.spec.ts` 通过真实的 Cordis Loader 启动完全相同的组合（一组被 `cordis:group` 隔离的 `lsp`／`lsp-stdio`／`tool-lsp` 行、真实的 `dsh-fs-local`／`dsh-subprocess-local`、锁定版本的 `typescript-language-server` 二进制），并断言 `lsp` 工具的 schema 完成注册——与 `memory-mcp-configs.spec.ts` 对 MCP 示例覆盖层所用的严格程度相同。`verify-cordis-config` 覆盖了被编辑的全部四个预设文件，而 `packages/lsp/lsp-stdio` 自己锁定版本的 `typescript-server.e2e.ts` 已经用同一个 server 二进制证明了一次真实查询的完整往返，本测试不再重复。
