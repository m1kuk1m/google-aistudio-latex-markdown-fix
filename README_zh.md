<p align="right">
  <a href="README.md">English</a> | <b>简体中文</b> | <a href="README_ja.md">日本語</a>
</p>

# Google AI Studio LaTeX 与 Markdown 修复

一个用于修复 [Google AI Studio](https://aistudio.google.com/) 前端界面中内容异常截断撤回、LaTeX 公式截断、Markdown 表格矩阵竖线丢失、流式输出覆盖及排版渲染问题的 Tampermonkey 用户脚本。

---

## 背景与主要解决的问题

在使用 Google AI Studio 且模型输出包含数学公式或结构化 Markdown 时，官方前端界面常出现以下渲染与交互问题：

1. **AI 抽风整段撤回与意外截断保护（v1.4.0 新增）**：
   在模型流式生成完成或中途遇到特定敏感词/异常状态（`finishReason` 处于官方前端黑名单）时，官方底层 `lJb` 函数会直接清空本轮所有思考过程与生成正文并将其替换为空白报错块。本插件在 Angular 状态数据层 (`entities` Map) 实施微任务级救援，并建立 DOM 快照保险丝，自动拦截撤回动作，将已被清空的实质内容（包含思考过程）完整原地复活，同时规避用户主动删除的误拦截。
2. **Markdown 表格中的分块矩阵竖线截断**：
   GitHub Flavored Markdown (GFM) 默认使用竖线 `|` 作为表格列分隔符。当 LaTeX `array` 等环境（如 `\begin{array}{cc|c}`）包含用于分块矩阵的竖线时，官方解析器会误将其识别为表格的新列，导致公式截断，甚至丢失后续单元格（如对比表格中后面的矩阵内容丢失）。
3. **流式传输内容覆盖与时序问题**：
   在模型流式生成（`fetch` / `streamGenerateContent`）过程中，未完成的文本块可能被过早执行 KaTeX 渲染，导致局部文本闪烁或内容被覆盖。
4. **CJK 标点与 Markdown 加粗符号未正确解析**：
   紧邻中文、日文等全角标点的加粗星号（`**bold**`）有时未被正常解析为加粗样式，导致星号直接显示在正文中。
5. **紧凑列表项（Tight List）多行公式未渲染**：
   部分嵌入在紧凑列表中的多行 LaTeX 公式无法正常触发 KaTeX 渲染。
6. **移动端长公式横向滚动回弹**：
   在手机浏览器（如 Firefox Android）上横向滑动查看超长公式时，虚拟滚动节点卸载引发的异常回弹问题。
7. **纯文本美元符号（`$` / 货币金额）误渲染为公式**：
   当模型在正文中输出美元价格（例如 `（$19.99/月）和 **Google AI Ultra**（$99.99/月起）`、`$2/$10` 等）时，官方 Markdown 解析器会因缺失闭合后禁数字校验而将其误配对为行内公式，导致符号吞噬、文字斜体紧缩以及内部加粗失效。本插件自动原位还原被误判的美元符号及普通文本，并联动加粗状态机恢复内部的 `**` 加粗样式，支持混排公式的智能拆分。
8. **多行 LaTeX 公式被列表/引用语法跨块劈裂（v1.5.0 新增）**：
   在输出如错位相消竖式计算等包含行首 `+ & ...` 或 `- & ...` 的多行公式（`\begin{array}`、`\begin{aligned}`）时，官方 CommonMark 块级解析器因行首符号触发无序列表截断规则，将多行公式硬生生劈裂进 `<p>` 和 `<ul><li>` 两个独立 DOM 块中，导致加号被吞噬成黑圆点且公式完全无法渲染。本插件引入原始完整 LaTeX 环境缓存精准匹配与跨兄弟 DOM 块联合缝合机制，原位恢复被吞加号，完美渲染完整数学块并 100% 保护 Angular DOM 引用。
9. **手机端/移动端长久卡死在“処理しています”（等待回复）与状态机死锁（v1.5.1 新增）**：
   在手机端使用时，若提问涉及图片或敏感/安全话题导致触发官方安全拦截码（如 SAFETY=3 或 PROHIBITED=8），第 1 层拦截迫使官方走入原生保留分支，但官方该分支未清除加载态 `ln: true`，且模型在产出正文前就直接拒答，导致界面永久停滞在“処理しています”脉冲动画且右下角 Stop 按钮锁死。v1.5.1 引入流式生成终态闭环与零内容安全拒答提示注入，全面扩展移动端软键盘（Enter）与触摸交互感知，并优化 `IntersectionObserver` 避免回调吞噬，彻底根除手机端假死。

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
