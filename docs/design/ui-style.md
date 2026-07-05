# 桌面端 UI 开发规范

本文档只约束桌面端 UI 的样式开发细节，包括颜色、字体、间距、边框、圆角、阴影和基础控件尺寸。布局结构、业务交互、组件命名和功能路线图不在本文档中维护。

## 颜色

颜色统一使用 Tailwind CSS 的 `slate` 色阶。除错误、成功、警告等语义状态外，不新增其他主色系。

| Token | Tailwind | Hex | 用途 |
| --- | --- | --- | --- |
| `--color-page` | `slate.50` | `#f8fafc` | 页面背景 |
| `--color-surface` | `slate.100` | `#f1f5f9` | 次级背景、侧栏背景 |
| `--color-panel` | `white` | `#ffffff` | 面板、输入框、消息块 |
| `--color-border-muted` | `slate.200` | `#e2e8f0` | 默认边框、分割线 |
| `--color-border` | `slate.300` | `#cbd5e1` | 可交互控件边框 |
| `--color-text-muted` | `slate.500` | `#64748b` | 次要文本、占位符 |
| `--color-text` | `slate.700` | `#334155` | 正文文本 |
| `--color-heading` | `slate.900` | `#0f172a` | 标题、强强调文本 |
| `--color-strong` | `slate.950` | `#020617` | 主按钮背景、最高强调 |

交互颜色仍优先从 `slate` 推导：

- Hover 背景：`slate.100` 或 `slate.200`。
- Active 背景：`slate.200`。
- Focus 边框：`slate.500`。
- Disabled 文本：`slate.400`。
- Disabled 背景：`slate.100`。

错误、成功、警告等语义色单独补充，不与普通控件颜色混用。

## 字体

默认字体栈：

```css
font-family:
  Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
  "Segoe UI", sans-serif;
```

字号使用固定 token，不随 viewport 缩放：

| Token | Size | Line height | 用途 |
| --- | --- | --- | --- |
| `--text-xs` | `12px` | `16px` | 辅助标签、状态文本 |
| `--text-sm` | `14px` | `20px` | 按钮、列表、输入框 |
| `--text-base` | `16px` | `24px` | 消息正文 |
| `--text-lg` | `18px` | `28px` | 页面标题 |

字重规范：

- 正文：`400`。
- 控件文本：`600`。
- 选中列表项、主按钮：`700`。
- 页面标题：`750` 或 `800`，不要超过 `800`。

字距保持默认值 `0`，不使用负字距。

## 间距

使用 4px 基础栅格。

| Token | Value | 用途 |
| --- | --- | --- |
| `--space-1` | `4px` | 极小间距 |
| `--space-2` | `8px` | 紧凑控件内部间距 |
| `--space-3` | `12px` | 列表、按钮左右间距 |
| `--space-4` | `16px` | 默认组件间距 |
| `--space-5` | `20px` | 面板内边距 |
| `--space-6` | `24px` | 页面区域间距 |
| `--space-8` | `32px` | 大区域留白 |

间距规则：

- 侧栏内边距：`16px`。
- 右侧内容横向内边距：桌面端 `28px` 到 `40px`，窄屏 `16px`。
- 消息列表间距：`16px`。
- 输入区内边距：`12px 16px`。
- 控件内文本与边框距离不小于 `12px`。

## 圆角

圆角不超过 `8px`。

| Token | Value | 用途 |
| --- | --- | --- |
| `--radius-sm` | `4px` | 标签、细小状态块 |
| `--radius-md` | `6px` | 输入框、列表项 |
| `--radius-lg` | `8px` | 消息块、主要按钮、弹层 |

不要使用胶囊形按钮，除非该控件是明确的状态 pill。

## 边框

默认边框：

```css
border: 1px solid var(--color-border-muted);
```

控件边框：

```css
border: 1px solid var(--color-border);
```

分割线只使用 `1px`，不使用双线、渐变线或装饰性边框。

## 阴影

桌面端默认少用阴影，优先靠边框和背景层级区分区域。

| Token | Value | 用途 |
| --- | --- | --- |
| `--shadow-sm` | `0 1px 2px rgb(15 23 42 / 0.06)` | 悬浮控件 |
| `--shadow-md` | `0 8px 24px rgb(15 23 42 / 0.08)` | 弹层、菜单 |

普通消息块、侧栏、主内容区默认不加阴影。

## 组件尺寸

常用控件高度：

| Component | Height |
| --- | --- |
| 图标按钮 | `32px` |
| 普通按钮 | `36px` |
| 主按钮 | `40px` |
| 列表项 | `40px` |
| 顶栏 | `56px` |
| 多行输入框最小高度 | `88px` |

按钮左右内边距：

- 图标按钮：`0`，宽高相等。
- 普通按钮：`12px`。
- 主按钮：`16px`。

组件 hover、focus、active 状态不得改变组件尺寸。

## 控件样式

按钮：

- Default：`slate.950` 背景，白色文字。
- Hover：`slate.800` 背景。
- Active：`slate.700` 背景。
- Disabled：`slate.100` 背景，`slate.400` 文字，禁用 pointer。

次级按钮：

- Default：白色背景，`slate.300` 边框，`slate.700` 文字。
- Hover：`slate.100` 背景。
- Active：`slate.200` 背景。

输入框：

- Default：白色背景，`slate.300` 边框。
- Hover：`slate.400` 边框。
- Focus：`slate.500` 边框，`0 0 0 3px rgb(100 116 139 / 0.16)` 外轮廓。
- Placeholder：`slate.500`。

列表项：

- Default：透明背景，`slate.700` 文字。
- Hover：`slate.100` 背景。
- Active：`slate.200` 背景，`slate.900` 文字。
- Selected：白色背景，`slate.300` 边框，`slate.950` 文字。

## CSS 约定

- 优先使用语义 class，不使用随意缩写。
- 全局 token 放在 `:root`。
- 组件样式按页面结构顺序排列。
- 不在 CSS 中混用多个色系作为主视觉。
- 不使用大面积渐变、装饰光斑或纯装饰背景。
- 不使用会让文本难以阅读的透明度叠层。

推荐 token 起点：

```css
:root {
  --color-page: #f8fafc;
  --color-surface: #f1f5f9;
  --color-panel: #ffffff;
  --color-border-muted: #e2e8f0;
  --color-border: #cbd5e1;
  --color-text-muted: #64748b;
  --color-text: #334155;
  --color-heading: #0f172a;
  --color-strong: #020617;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  --shadow-sm: 0 1px 2px rgb(15 23 42 / 0.06);
  --shadow-md: 0 8px 24px rgb(15 23 42 / 0.08);
}
```
