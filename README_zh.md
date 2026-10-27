<p align="right">
  <a href="README.md">English</a> | <b>简体中文</b> | <a href="README_ja.md">日本語</a>
</p>

# Google AI Studio LaTeX 与 Markdown 修复

一个用于修复 [Google AI Studio](https://aistudio.google.com/) 前端界面中 LaTeX 公式截断、Markdown 表格矩阵竖线丢失、流式输出覆盖及排版渲染问题的 Tampermonkey 用户脚本。

---

## 背景与主要解决的问题

在使用 Google AI Studio 且模型输出包含数学公式或结构化 Markdown 时，官方前端界面常出现以下渲染问题：

1. **Markdown 表格中的分块矩阵竖线截断**：
   GitHub Flavored Markdown (GFM) 默认使用竖线 `|` 作为表格列分隔符。当 LaTeX `array` 等环境（如 `\begin{array}{cc|c}`）包含用于分块矩阵的竖线时，官方解析器会误将其识别为表格的新列，导致公式截断，甚至丢失后续单元格（如对比表格中后面的矩阵内容丢失）。
2. **流式传输内容覆盖与时序问题**：
   在模型流式生成（`fetch` / `streamGenerateContent`）过程中，未完成的文本块可能被过早执行 KaTeX 渲染，导致局部文本闪烁或内容被覆盖。
3. **CJK 标点与 Markdown 加粗符号未正确解析**：
   紧邻中文、日文等全角标点的加粗星号（`**bold**`）有时未被正常解析为加粗样式，导致星号直接显示在正文中。
4. **紧凑列表项（Tight List）多行公式未渲染**：
   部分嵌入在紧凑列表中的多行 LaTeX 公式无法正常触发 KaTeX 渲染。
5. **移动端长公式横向滚动回弹**：
   在手机浏览器（如 Firefox Android）上横向滑动查看超长公式时，虚拟滚动节点卸载引发的异常回弹问题。
6. **纯文本美元符号（`$` / 货币金额）误渲染为公式**：
   当模型在正文中输出美元价格（例如 `（$19.99/月）和 **Google AI Ultra**（$99.99/月起）`、`$2/$10` 等）时，官方 Markdown 解析器会因缺失闭合后禁数字校验而将其误配对为行内公式，导致符号吞噬、文字斜体紧缩以及内部加粗失效。本插件自动原位还原被误判的美元符号及普通文本，并联动加粗状态机恢复内部的 `**` 加粗样式，支持混排公式的智能拆分。

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
