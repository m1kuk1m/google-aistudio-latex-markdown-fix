<p align="right">
  <a href="README.md">English</a> | <a href="README_zh.md">简体中文</a> | <b>日本語</b>
</p>

# Google AI Studio - 数式＆Markdownレンダリング修正

[Google AI Studio](https://aistudio.google.com/) 向けに開発された軽量な Tampermonkey ユーザースクリプトです。複雑な LaTeX 数式の途切れ、Markdown テーブル内での分割行列の縦線欠落、ストリーミング表示の競合、および各種レイアウト崩れを修正します。

---

## 背景と解決される主な課題

Google AI Studio で複雑な数学的表現や Markdown を含む出力を生成する際、標準のウェブUIでは以下のようなレンダリングの問題が発生します：

1. **Markdown テーブル内の分割行列パイプ（`|`）の衝突と列消失**：
   GitHub Flavored Markdown (GFM) はパイプ文字 `|` を表の列区切りとして処理します。LaTeX の `array` 環境（例：`\begin{array}{cc|c}`）で縦の分割線が使われている場合、パーサーがこれを新しい列と誤認し、数式が途中で切れたり後続の列（比較表の2つ目の行列など）が完全に消失してしまいます。
2. **ストリーミング生成時のタイミング競合と上書き防止**：
   モデルのストリーミング出力中（`fetch` / `streamGenerateContent`）、未完了のブロックに対して KaTeX が早期実行されることで、テキストのちらつきや出力内容の不要な上書きが生じるのを防ぎます。
3. **CJK（日中韓）句読点と Markdown 太字の不整合**：
   全角句読点に隣接する太字アスタリスク（`**太字**`）が適切に解析されず、記号がそのまま本文に露出してしまう問題を解消します。
4. **緊密リスト（Tight List）内の複数行数式未描画**：
   リスト項目内に含まれる複数行 LaTeX 数式がスキップされ、KaTeX が適用されない不具合を修正します。
5. **モバイル環境における横長数式スクロールの跳ね返り防止**：
   スマートフォン等のブラウザ（Firefox Android など）で幅の広い数式を横スクロールした際、仮想スクロールによるアンロードと不自然なバウンス動作を防ぎます。

---

## インストール方法

### 前提条件
- お使いのブラウザに **Tampermonkey** などのユーザースクリプト管理拡張機能がインストールされていること（Chrome, Edge, Firefox, Firefox for Android に対応）。

### GitHub から直接インストール
1. 以下の直リンクをクリックしてインストール画面を開きます：
   - [google-aistudio-latex-markdown-fix.user.js をインストール](https://raw.githubusercontent.com/m1kuk1m/google-aistudio-latex-markdown-fix/main/google-aistudio-latex-markdown-fix.user.js)
2. Tampermonkey のインストール確認画面が表示されたら、**「インストール」** をクリックします。
3. [Google AI Studio](https://aistudio.google.com/) を開くか、既存のタブを再読み込みすると有効になります。

---

## 既知の制限事項

- **プレーンテキストのドル記号（`$` / 金額表記）の誤認識**：
  AI が本文中に通常のドル記号（例：`$50` や `100$` など）を出力した際、フロントエンドのパーサーがこれを LaTeX インライン数式の開始・終了記号と誤認する場合があります。
  > **注意**：この現象は Google AI Studio 標準のフロントエンド Markdown パーサー自体に起因する上流の挙動であり、本スクリプトを導入していない素の状態でも全く同様に発生します。

---

## ライセンス

本プロジェクトは [MIT License](LICENSE) の下で公開されています。
