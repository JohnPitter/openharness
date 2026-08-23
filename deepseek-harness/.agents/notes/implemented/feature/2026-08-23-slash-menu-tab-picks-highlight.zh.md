# Agent Note: Slash 菜单的 Tab 选定当前高亮命令

Status: implemented

[English](2026-08-23-slash-menu-tab-picks-highlight.md) | 中文

## 问题

`/` 候选菜单是 combobox：焦点留在 composer，方向键移动高亮，Enter 选定该行。Tab 仍走原生焦点移动，因此当前高亮的命令不会被选定。

## 决策

`ArbitrateKey` 包含 `tab`。菜单打开时，Tab 经与 Enter 相同的 `pick()` 路径选定当前高亮。打开但没有高亮的菜单仍消费 Tab，使焦点留在 composer；关闭的菜单放行 Tab。InputBar 仅在仲裁不是 `pass` 时 preventDefault。IME composition 仍放行所有被拦截的键。

## 备选方案

**Tab 只把命令名补进草稿，不 pick。** 不予采用：点击和 Enter 已经认领或插入该候选项；同一行再分出第三种结果会拆开手势。

**Tab 与 Enter 完全相同，包括无高亮时放行。** 不予采用：原生 Tab 会在菜单仍打开时离开 composer。

**只在 MenuView 里处理 Tab。** 不予采用：slash 菜单从不取得焦点；InputBar 是唯一按键路径。

## 影响

用方向键移到一行再按 Tab 即选定它。菜单关闭时 Tab 仍移动焦点。[slash 流水线 note](../architecture/2026-07-25-web-input-machine-and-slash-pipeline.zh.md) 把 Tab 记入被拦截的键。

## 测试

controller 测试用 Tab 选定已移动的高亮、在打开且无高亮时消费 Tab，并在 IME composition 期间放行 Tab。InputBar 间谍仲裁并断言 Tab 不提交。
