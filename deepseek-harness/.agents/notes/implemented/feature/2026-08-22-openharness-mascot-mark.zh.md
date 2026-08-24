# Agent Note: OpenHarness 吉祥物替换环形标与 OH 字母

Status: implemented

[English](2026-08-22-openharness-mascot-mark.md) | 中文

## 问题

应用内商标是跟随 currentColor 的开口环加两个节点，`BrandWordmark` 用 SVG 画出字母 `OH`。桌面磁贴（`frontend/dist/logo.png`）是带中心点的彩色环。这些表面都不是角色吉祥物，产品只有几何图形，侧栏、英雄区、标签图标和窗口铬都缺少一张可辨认的脸。

## 决策

**产品商标是坐在蓝色开口环挽具里、带薄荷色节点扣的米色脑袋 3D 吉祥物，画在透明画布上。** `FishLogo` 通过 SVG `<image href="/mascot.png">` 在 24×24 方框里缩放该光栅，不铺底砖。`BrandWordmark` 就是同一吉祥物；`includeMark={false}` 是空的 24 方框，好让 `sidebar.brand.name` 坐在 slotted 商标旁边。`apps/web/public/favicon.svg` 包裹 `mascot.png`；桌面标题栏使用 `logo.png`。浅色浏览器铬上的对比靠蓝环和薄荷节点，而不是炭色底砖。

## 考虑过的替代方案

**继续用 currentColor，并在深色方案下反相 favicon。** 不予采纳：吉祥物的身份就是米色/蓝/薄荷色板；单色剪影会丢掉角色，反相彩色图形会把它冲淡。

**把吉祥物画成 24px 品牌色 SVG 路径。** 不予采纳：产品商标是 3D 黏土渲染；平面路径是另一个角色。

**在吉祥物后面保留炭色圆角方底板。** 不予采纳：底砖在标题栏和侧栏里读成第二份商标。

**把 PNG 以 data-URI 内联进 client bundle。** 不予采纳：`/mascot.png` 是 web host 已经提供的公共资源；在每次 `FishLogo` 导入里嵌入数十 KB 会撑大 client。

**在吉祥物旁保留 `OH` SVG 字母。** 不予采纳：官方名称已经是 slotted HTML（`OpenHarness`）；第二份 OH 图形重复了吉祥物已经替换掉的缩写。

## 后果

侧栏、英雄区、favicon 和桌面窗口标共用同一张透明 3D 光栅。浅色主题下米色脑袋的对比靠蓝环和薄荷节点，而不是 currentColor 填充或炭色底砖。
