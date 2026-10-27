<p align="right">
  <b>English</b> | <a href="README_zh.md">简体中文</a> | <a href="README_ja.md">日本語</a>
</p>

# Google AI Studio - LaTeX and Markdown Render Fix

A lightweight Tampermonkey userscript that addresses LaTeX rendering failures, Markdown table column truncation, streaming race conditions, and formatting quirks in [Google AI Studio](https://aistudio.google.com/).

---

## Background & Problems Solved

When using Google AI Studio with models outputting complex mathematics and structured markdown, several frontend rendering issues frequently occur:

1. **LaTeX Matrix Pipe Conflict in Markdown Tables**:
   GitHub Flavored Markdown (GFM) interprets pipe characters (`|`) as table cell delimiters. When LaTeX environments (such as `\begin{array}{cc|c}`) contain pipes for vertical partition lines, the parser incorrectly treats them as table columns. This truncates formulas, deletes subsequent columns, and causes matrix blocks to disappear.
2. **Streaming Pipeline Synchronization**:
   During token streaming (`fetch` / `streamGenerateContent`), incomplete chunks can cause KaTeX to execute against partial formulas, causing text flickering or turns being prematurely overwritten.
3. **CJK Punctuation & Bold Text Inversion**:
   Inline Markdown asterisks (`**bold**`) adjacent to CJK (Chinese, Japanese, Korean) punctuation marks can trigger parsing misalignments, leaking raw asterisks into the rendered view.
4. **Tight List Multi-Line Formulas**:
   Multi-line formulas embedded inside tight list items often fail to trigger the built-in KaTeX pass.
5. **Mobile Horizontal Scrolling Guard**:
   Fixes the rubber-band bounce-back issue on mobile browsers (such as Firefox Android) when panning across ultra-wide equations.
6. **Literal Dollar Signs (`$` / Currency Amounts) Misrendered as Math**:
   When the model outputs dollar amounts (e.g., `($19.99/mo) and **Google AI Ultra** ($99.99/mo)`, `$2/$10`, etc.), the upstream Markdown engine can falsely pair them as inline math formulas, swallowing dollar signs, italicizing text, and breaking bold markdown. This script restores literal dollar amounts in place, seamlessly pairs trapped `**` markdown back to bold styles, and splits mixed currency/math expressions.

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
