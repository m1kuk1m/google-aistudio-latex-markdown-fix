<p align="right">
  <a href="README.md">English</a> | <b>简体中文</b> | <a href="README_ja.md">日本語</a>
</p>

# Google AI Studio LaTeX 与 Markdown 修复

一个用于修复 [Google AI Studio](https://aistudio.google.com/) 前端界面中 LaTeX 公式截断、Markdown 表格矩阵竖线丢失、列表多行公式劈裂、美元符号误渲染公式、生化星号加粗及排版渲染问题的 Tampermonkey 用户脚本。

---

## 背景与主要解决的问题

在使用 Google AI Studio 且模型输出包含数学公式或结构化 Markdown 时，官方前端界面常出现以下渲染与排版问题：

1. **Markdown 表格中的分块矩阵竖线截断**：
   GitHub Flavored Markdown (GFM) 默认使用竖线 `|` 作为表格列分隔符。当 LaTeX `array` 等环境（如 `\begin{array}{cc|c}`）包含用于分块矩阵的竖线时，官方解析器会误将其识别为表格的新列，导致公式截断，甚至丢失后续单元格（如对比表格中后面的矩阵内容丢失）。
2. **多行 LaTeX 公式被列表/引用语法跨块劈裂**：
   在输出如错位相消竖式计算等包含行首 `+ & ...` 或 `- & ...` 的多行公式（`\begin{array}`、`\begin{aligned}`）时，官方 CommonMark 块级解析器因行首符号触发无序列表截断规则，将多行公式硬生生劈裂进 `<p>` 和 `<ul><li>` 两个独立 DOM 块中，导致加号被吞噬成黑圆点且公式完全无法渲染。本插件引入原始完整 LaTeX 环境缓存精准匹配与跨兄弟 DOM 块联合缝合机制，原位恢复被吞加号，完美渲染完整数学块并 100% 保护 Angular DOM 引用。
3. **纯文本美元符号（`$` / 货币金额）误渲染为公式**：
   当模型在正文中输出美元价格（例如 `（$19.99/月）和 **Google AI Ultra**（$99.99/月起）`、`$2/$10` 等）时，官方 Markdown 解析器会因缺失闭合后禁数字校验而将其误配对为行内公式，导致符号吞噬、文字斜体紧缩以及内部加粗失效。本插件自动原位还原被误判的美元符号及普通文本，并联动加粗状态机恢复内部的 `**` 加粗样式，支持混排公式的智能拆分。
4. **CJK 标点与 Markdown 加粗符号未正确解析**：
   紧邻中文、日文等全角标点的加粗星号（`**bold**`）有时未被正常解析为加粗样式，导致星号直接显示在正文中，甚至引发外层斜体窃取排版。
5. **伪代码块吞噬解构**：
   解决列表内缩进排版文本被误识别为代码块导致格式丢失的问题，精准解构还原标题、列表与数学公式。
6. **波浪号区间误变删除线（~）**：
   防止数值区间（如 `5%~16%`、`3~5次`）被误渲染为删除线（`<del>` / `<s>`）。
7. **生化与蛋白质星号命名加粗误拆**：
   修复带有星号的命名实体（如 `A\beta*56`、`CYP2D*6`）在加粗时被拆分导致的裸星号外露问题。
8. **紧凑列表项（Tight List）多行公式未渲染**：
   部分嵌入在紧凑列表中的多行 LaTeX 公式无法正常触发 KaTeX 渲染。
9. **移动端长公式横向滚动回弹**：
   在手机浏览器（如 Firefox Android）上横向滑动查看超长公式时，虚拟滚动节点卸载引发的异常回弹与归零问题。
10. **流式传输内容覆盖与时序问题**：
    在模型流式生成（`fetch` / `streamGenerateContent`）过程中，未完成的文本块可能被过早执行 KaTeX 渲染，导致局部文本闪烁或内容被覆盖。

---

## 安装使用

### 前提条件
- 浏览器需已安装用户脚本管理器扩展，例如 **Tampermonkey**（支持 Chrome、Edge、Firefox 以及 Firefox Android）。

### 通过 GitHub 安装
1. 点击下方链接直接安装：
   - [安装 google-aistudio-latex-markdown-fix.user.js](https://raw.githubusercontent.com/m1kuk1m/google-aistudio-latex-markdown-fix/main/google-aistudio-latex-markdown-fix.user.js)
2. 在 Tampermonkey 弹出的确认页面中点击 **“安装”**。
3. 打开或刷新 [Google AI Studio](https://aistudio.google.com/) 页面即可生效。

---

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
