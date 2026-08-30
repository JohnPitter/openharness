# Agent Note: 从上游 dsh-v0.1.2-alpha.1 有选择地采纳的修复与功能

Status: implemented

[English](2026-08-29-selective-upstream-fixes-dsh-0-1-2-alpha-1.md) | 中文

## 问题

上游 `deepseek-ai/deepseek-harness` 发布了 `dsh-v0.1.2-alpha.1`，相对本分支最后同步的 `dsh-v0.1.1-rc.2` 基线大约领先 1,079 个提交。该版本中有两处属于架构级改动（移除 `ApiProxy` 包、改用本分支的压缩与同会话修订功能直接构建于其上的 `@Remote` 网关；以及对会话流 UI 的完整模块拆分，而本分支的活动摘要折叠与桌面提示音功能就位于其中），二者被刻意推迟到专门的升级项目中处理，不做零敲碎打的合并。changelog 中其余条目都是自成一体、不依赖上述两项延期改动的 bug 修复与小功能，逐一移植——依据本分支实际（已分叉）的文件结构逐项核实，而非盲目照搬——能够在不等待那次更大迁移的前提下，现在就获取真实的上游价值。

## 决策

手工移植了八项上游修复，每一项都针对本分支当前的代码树验证过编译、类型检查与其针对性测试均通过，并在本分支的文件结构、包边界或既有本地功能与上游不同之处做了相应改动：

1. **system-prompt 分区顺序相同的问题**（`packages/workflow/tool-workflow/src/index.ts`）：`tool:cordis` 与 `tool:workflow` 都声明了 `order: 115`，稳定排序便按插件激活顺序打破平局，而该顺序在不同平台组合下并不固定。`tool:workflow` 现在声明为 `115.5`，无论激活顺序如何，都保持在 `tool:cordis` 之后的既定位置。此区域本分支与上游无分叉，直接原样移植。
2. **输入框的发送/停止按钮反映草稿内容，而不只是运行状态**（`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`）：轮次运行期间，主按钮现在只有在输入框为空或被阻塞时才显示"停止"；有可发送草稿时显示"发送"（排队），而不是强制先点一次停止。直接移植；本分支的 `empty`／`blocked` 局部变量与上游修复前的形态完全一致。
3. **`str_replace_editor` 容忍 `null` 占位符**（`packages/fs/tool-str-replace-editor`）：所选命令未使用的命令特定字段（例如 `create` 命令上的 `view_range`）现在把显式的 `null` 视同省略；但所选命令的必填字段仍然拒绝 `null`，且 `str_replace.new_str` 依然只把省略（绝不是显式 `null`）当作删除。模型生成的调用把未用字段序列化为 `null` 占位符时不再校验失败。本分支此前尚未从上游获得该修复，此次为原样移植。
4. **空白会话永不计入 Workspace 的折叠配额**（`packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx`）：临时的"新建会话"行免费渲染；只有普通行才计入五行折叠上限，且折叠模式下的拖放现在以前一个*可见*行为锚点，并拒绝任何会把被拖动行重新折叠到看不见的落点。移植到本分支的实际文件（`src/client/WorkspaceBrowser.tsx`；上游对应文件深一层目录）。
5. **WebSocket 空闲连接发送保活心跳**（`packages/client/connection/src/{index,websocket-downlink}.ts`）：一个可配置的 `websocketHeartbeatIntervalMs`（默认 30 秒，经 schemastery 校验、上限为 `MAX_TIMER_DELAY_MS`）驱动每个服务器一个 `unref()` 的定时器，向每个处于打开状态的 socket 发送 Ping；不设置 pong 超时，与上游一致（半开连接检测仍交给 TCP）。上游把这个改动加在 `packages/api/gateway` 的 `RemoteStreamMuxServer` 里，而本分支没有这个类；本分支唯一的 WebSocket 服务器是 `packages/client/connection` 里的 `WebSocketDownlinks`，因此心跳被移植到了那里——这是本批次中唯一一处真正新增机制而非直接移植的改动。`packages/host/apiproxy` 不含任何 WebSocket 代码，本分支在那里的压缩／会话修订逻辑未受影响。
6. **`ask_user_question` 的草稿在切换会话后依然保留**（`packages/client/ui-user-questions`）：进行中的答案选择、自定义文本和页码位置现在存放在新的按会话建立的 `createQuestionDraftStore()` 里，而不是组件的 `useState`，因此切换离开再切回同一会话会精确恢复到用户离开时的状态。做了改动：上游的 store 从本分支没有的独立 `dsh-client-store` 包导入；本分支的 `draft-store.ts` 改为从 `@deepseek-ai/dsh-client-runtime/client` 导入 `defineStore`／`EngineStoreHandle`——本分支其他所有按会话建立的 store 早已在用的同一套引擎——因此无需新增包或 tsconfig 依赖。
7. **流式代码围栏增量高亮**（`packages/client/ui-primitives/src/markdown`）：仍在流式输出中的围栏代码块现在会随着内容增长逐步分词并高亮（复用 shiki 的 `GrammarState` 使已完成的行永不重新分词），而不是在围栏闭合前都渲染为纯文本。本分支修复前的 markdown 文件与上游逐字节相同，因此除了本分支既有的可选中文默认 `codeLabels` 属性外，此次移植原样套用。
8. **持久化 Bash／PowerShell 结果变为可展开**（`packages/client/ui-tool`）：一次已落定的持久化 shell 调用（通过不带 `description` 字段、只有 `command` 的参数对象来识别——持久化 provider 使用的正是这个标记，因为标准 bash/pwsh schema 要求必须有 description）现在会通过通用输入/输出卡片展开，而不是永久保持折叠、其输出无法触达。做了改动：本分支的 toolview 架构从 `callView`／`resultView` 渲染意图推导展示，而非上游基于原始参数的 `raw-tool-call.ts` 辅助函数（本分支没有）；本分支的 `ToolCallBlock` 也没有 `parentCallId` 字段，因此上游的子调用排除逻辑未被移植（一个不带 description 的子级 bash 调用变得可展开并无害处——pwsh 本就走始终可展开的通用 `ToolRow`）。

本分支已有的任何成果——活动摘要折叠、Kimi/Cursor/GLM provider、pt/es 本地化、品牌重塑、压缩修复、同会话消息修订，或任务完成提示音——都没有被移除或替换；每一项移植要么是增量添加，要么是本分支已拥有文件内的一处小范围行为纠正。

## 考虑过的替代方案

**整体合并上游 `master`。** 本轮不予采纳：这是一个 alpha 预发布版本，涉及 6,421 个文件的差异，加上前述两项架构级改动各自都需要专门的移植工作（把压缩与修订功能搬到 `@Remote` 网关上；把会话流 UI 的活动摘要折叠与桌面完成逻辑搬到上游拆分后的模块结构上），不应该和不相关的 bug 修复捆绑在一次改动里。

**直接用 `git cherry-pick` 挑选上游提交。** 不予采纳：本分支的代码树已经分叉得足够多（品牌重塑、额外的 provider、额外的本地化、这些同一批文件里既有的本地修复），原始的 cherry-pick 在多数提交上都会冲突；每一项修复都改为从上游 diff 及其 Agent Note 重新推导，再手工套用到本分支当前的实际文件内容上。

## 后果

本分支获得了八项经过验证的上游修复，且未引入被推迟的架构级迁移；每一项都可独立回退（触及的文件范围窄、彼此基本不重叠），且各自都有从上游延续或改编而来的针对性测试覆盖。`packages/client/connection` 的 WebSocket 心跳是本批次中唯一真正引入新机制而非直接移植的地方，因为上游的对应服务器在本分支不存在——未来涉及 `packages/api/gateway` 流服务器的上游同步，需要改为对照本分支 `WebSocketDownlinks` 所在的位置来协调。被推迟的 `ApiProxy` 移除与会话流 UI 模块拆分，仍是留待上游发布稳定（非 alpha）`0.1.2` 之后专门升级批次去做的工作。

## 验证

每项修复都带有各自的针对性单元／组件测试覆盖（从上游延续或改编而来），单独运行全绿，并在所有涉及的包上合并成一次一致的测试运行（`packages/client/connection`、`ui-conversation` 的 desktop-complete／input-bar、`ui-primitives` 的 markdown、`ui-tool`、`ui-user-questions`、`ui-workspace`、`fs/tool-str-replace-editor`、`workflow/tool-workflow`）：1,209 个测试中 1,206 个通过，另外 3 个失败已独立确认为已发布的 v0.1.51 基线上就存在（通过对根仓库已提交的 HEAD 做 `git stash`、而非本批次的改动来验证），与本次八项移植所触及的代码无关，因此未作处理。`tsc -b tsconfig.client.json` 与 `tsc -b tsconfig.host.json` 均干净通过；oxlint 对每一个涉及的生产文件报告零错误。
