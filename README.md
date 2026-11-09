<p align="right">
  <b>English</b> | <a href="README_zh.md">简体中文</a> | <a href="README_ja.md">日本語</a>
</p>

# Google AI Studio - LaTeX and Markdown Render Fix

A lightweight Tampermonkey userscript that addresses LaTeX rendering failures, Markdown table column truncation, streaming race conditions, dollar currency misrenderings, cross-block formula splits, and formatting quirks in [Google AI Studio](https://aistudio.google.com/).

---

## Background & Problems Solved

When using Google AI Studio with models outputting complex mathematics and structured markdown, several frontend rendering issues frequently occur:

1. **LaTeX Matrix Pipe Conflict in Markdown Tables**:
   GitHub Flavored Markdown (GFM) interprets pipe characters (`|`) as table cell delimiters. When LaTeX environments (such as `\begin{array}{cc|c}`) contain pipes for vertical partition lines, the parser incorrectly treats them as table columns. This truncates formulas, deletes subsequent columns, and causes matrix blocks to disappear.
2. **Cross-Block Formula Splitting by List Syntax**:
   When multi-line LaTeX formulas (such as `\begin{array}` or `\begin{aligned}` in vertical arithmetic) have lines starting with `+ & ...` or `- & ...`, the upstream CommonMark parser mistakes them for unordered list items, forcefully splitting the formula across separate `<p>` and `<ul><li>` DOM blocks. This swallows the `+` sign into a list bullet and breaks rendering. This script implements an original LaTeX environment cache with cross-sibling DOM stitching to seamlessly reconstruct the formula and restore swallowed signs.
3. **Literal Dollar Signs (`$` / Currency Amounts) Misrendered as Math**:
   When the model outputs dollar amounts (e.g., `($19.99/mo) and **Google AI Ultra** ($99.99/mo)`, `$2/$10`, etc.), the upstream Markdown engine can falsely pair them as inline math formulas, swallowing dollar signs, italicizing text, and breaking bold markdown. This script restores literal dollar amounts in place, seamlessly pairs trapped `**` markdown back to bold styles, and splits mixed currency/math expressions.
4. **CJK Punctuation & Bold Text Inversion**:
   Inline Markdown asterisks (`**bold**`) adjacent to CJK (Chinese, Japanese, Korean) punctuation marks can trigger parsing misalignments, leaking raw asterisks into the rendered view.
5. **Swallowed Code Blocks Unpacking**:
   Resolves issues where indented text, pseudo-code blocks, or list-contained code blocks get swallowed by the frontend parser, ensuring proper unwrapping and markdown rendering.
6. **Tilde Strikethrough vs. Range vs. Subscript**:
   Prevents numerical ranges (e.g. `5%~16%` or `3~5`) and tildes from being mistakenly rendered as strikethrough tags (`<del>` / `<s>`).
7. **Biochemical / Protein Star-Bold Split**:
   Fixes bold split issues on star-named entities (such as `A\beta*56` or `CYP2D*6`), preserving literal stars and bold styles without leaking bare asterisks.
8. **Tight List Multi-Line Formulas**:
   Multi-line formulas embedded inside tight list items often fail to trigger the built-in KaTeX pass.
9. **Mobile Horizontal Scrolling Guard & Virtual Scroll Alignment**:
   Fixes the rubber-band bounce-back issue on mobile browsers (such as Firefox Android) when panning across ultra-wide equations, preventing off-screen virtual scroll unmount collapse.
10. **Streaming Pipeline Synchronization**:
    During token streaming (`fetch` / `streamGenerateContent`), incomplete chunks can cause KaTeX to execute against partial formulas, causing text flickering or turns being prematurely overwritten.

---

## Installation

### Prerequisites
- A userscript manager such as **Tampermonkey** (recommended) installed in your browser (Chrome, Edge, Firefox, or Firefox for Android).

### Install via GitHub
1. Click the raw file link to install directly:
   - [Install google-aistudio-latex-markdown-fix.user.js](https://raw.githubusercontent.com/m1kuk1m/google-aistudio-latex-markdown-fix/main/google-aistudio-latex-markdown-fix.user.js)
2. Tampermonkey will prompt you to confirm installation. Click **Install**.
3. Open or refresh [Google AI Studio](https://aistudio.google.com/).

---

## License

This project is licensed under the [MIT License](LICENSE).
