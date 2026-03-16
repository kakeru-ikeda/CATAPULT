---
name: markdown-with-python3
description: Enforce Python3-based Markdown file creation and updates. Use this skill whenever the user asks to create or edit .md files, documentation, README, notes, or any Markdown output, even if they do not explicitly mention Python.
---

# Markdown with Python3

Markdown ファイル（`.md`）を新規作成・更新するときは、必ず Python3 を使って実行する。

## 目的

- シェル依存（`cat <<EOF`、`echo >` など）を避ける
- 改行・エンコーディング崩れを減らす
- 長文や Markdown 記法（コードフェンス、表、引用）を安全に保持する
- **CLI のクォート癖（シングルクォート内のシングルクォート、ダブルクォート内の `$`・バッククォートのエスケープ）によるコンテンツ破損を排除する**
- 実行方法を Python3 に統一する

## 必須ルール

1. `.md` ファイルの作成・更新は **必ず Python3** で行う。
2. ワンライナー（`python3 -c "..."`）で長文 Markdown を直接埋め込まない。
3. `cat`, `echo`, `printf`, ヒアドキュメントで Markdown を直接書き込まない。
4. 長文や複雑な Markdown は入力ファイルを使って書き込む。
5. 文字コードは UTF-8 を使う。
6. **1 つの一時ファイルが大きくなりそうな場合（目安: 1,000 行超 / 40 KB 超）は、チャンク分割して `--input-file` を複数渡す。**
7. **Markdown 本文の文字列生成そのものも Python で行う（シェルで文字列を組み立てない）。**
   → まずテキストファイル（`.txt`）を Python で安全に作り、その後 `.md` に流し込む。
8. **bash コマンドライン・`python3 -c`・heredoc にコンテンツを直書きしない。**
   → 実行ラッパーが付加する制御マーカーがコンテンツ中の記号と衝突し、出力が途中で切断・破損することがある。
9. **生成スクリプトは必ず `create_file` ツールで別ファイル（例: `/tmp/gen_content.py`）として作成し、`python3 /tmp/gen_content.py` で実行する。**
   → コンテンツを bash の command 引数に直接埋め込む構造を根本から排除する。

## テキストファイル先行方針（重要）

シェル上で文字列の囲い方を誤るとコンテンツが破損または欠落する。
これを根本から防ぐため、**コンテンツ生成フェーズと書き込みフェーズを分離する**。

```
[生成フェーズ] Python スクリプト → /tmp/content.md.txt  (安全・クォート不要)
[書き込みフェーズ] write-markdown.py --input-file /tmp/content.md.txt → docs/xxx.md
```

### bash インライン書き込みで起きる問題（根本原因）

bash の command 引数・`python3 -c`・heredoc に長い文字列を直書きすると、
**CLI のクォート癖と実行ラッパーの制御マーカーがコンテンツ中の記号と衝突し、出力が途中で切断・破損する**。

具体的な症状:
- コードフェンス（` ``` `）や引用（`>`）、特殊記号が含まれる行で出力が途切れる
- 実行ラッパーの制御マーカー文字列が本文に埋め込まれる
- `$`, `` ` ``, `\`, `!` などのシェル特殊文字がコンテンツを壊す
- CLI がシングルクォート・ダブルクォートを勝手に解釈し、文字列が変形・欠落する

**対処の原則: Markdown 本文を一度 Python スクリプトに切り出し、CLI のクォート処理を完全に迂回する。**

### 生成フェーズのパターン

#### パターン A: 生成スクリプトを別ファイルに書く（**唯一の正規手順**）

> **コンテンツに記号・コードフェンス・引用符が 1 つでも含まれる場合は必ずこのパターンを使う。**
> `create_file` ツールで `/tmp/gen_*.py` を先に作り、`python3` で実行する。

```python
# /tmp/gen_report.py
lines = []
lines.append("# レポートタイトル\n")
lines.append("\n## セクション 1\n\n")
lines.append(some_variable)      # 変数も安全に埋め込める
lines.append("\n```python\n")  # コードフェンスも問題なし
lines.append(code_block)
lines.append("\n```\n")

with open("/tmp/content.md.txt", "w", encoding="utf-8") as f:
    f.writelines(lines)
```

```bash
# 生成 → 書き込みの 2 ステップ
python3 /tmp/gen_report.py
python3 .github/skills/markdown-with-python3/scripts/write-markdown.py docs/report.md \
  --input-file /tmp/content.md.txt
```

#### パターン B: create_file ツールで直接 `.txt` を作る（短〜中文向け代替）

AI が `create_file` / `replace_string_in_file` ツールを使えるなら、
一時 `.txt` ファイルを直接作成してから `write-markdown.py` に渡す。
**コードフェンスや多数の記号を含む長文では必ずパターン A を使うこと。**

```bash
# create_file で /tmp/content.md.txt を作成済みとして
python3 .github/skills/markdown-with-python3/scripts/write-markdown.py docs/report.md \
  --input-file /tmp/content.md.txt
```

## 長文 Markdown の推奨手順

1. 内容は一時ファイル（例: `/tmp/content.md.txt`）を Python で生成する。
2. 同梱 Python スクリプトに `--input-file` で渡す。
3. 生成後に対象 `.md` の内容を確認する。

内容が長くシェルラッパー経由で切れる恐れがある場合は、後述の **チャンク分割手順** を使う。

## 標準手順

1. 対象パスを決める（例: `docs/new-guide.md`）
2. **`create_file` ツールで生成スクリプト（`/tmp/gen_*.py`）を作成する**（CLI のクォート癖を完全に回避するため、コンテンツは必ずスクリプトファイルに切り出す）
3. `python3 /tmp/gen_*.py` を実行して一時テキストファイル（`/tmp/content.md.txt`）を生成する
4. `write-markdown.py` / `append-markdown.py` で `.md` に流し込む
5. 生成結果を確認する

## 実行テンプレート

### 新規作成/上書き（推奨）

```bash
python3 .github/skills/markdown-with-python3/scripts/write-markdown.py docs/new-guide.md --input-file /tmp/content.md.txt
```

### 既存に追記（推奨）

```bash
python3 .github/skills/markdown-with-python3/scripts/append-markdown.py docs/new-guide.md --input-file /tmp/append.md.txt
```

### チャンク分割して書き込む（長文・シェルで切れる場合）

内容を複数の一時ファイルに分けて、`--input-file` を繰り返し指定する。
スクリプトが渡された順に連結して書き込む。

```bash
# 内容を 3 つのチャンクに分けて書き込む例
python3 .github/skills/markdown-with-python3/scripts/write-markdown.py docs/new-guide.md \
  --input-file /tmp/chunk1.md.txt \
  --input-file /tmp/chunk2.md.txt \
  --input-file /tmp/chunk3.md.txt
```

追記も同様：

```bash
python3 .github/skills/markdown-with-python3/scripts/append-markdown.py docs/new-guide.md \
  --input-file /tmp/chunk1.md.txt \
  --input-file /tmp/chunk2.md.txt
```

### `stdin` で渡す（短文のみ）

```bash
python3 .github/skills/markdown-with-python3/scripts/write-markdown.py docs/new-guide.md --stdin < /tmp/content.md.txt
```

## 禁止例

- `python3 -c "open(...).write('...巨大Markdown...')"`
- `echo "..." > file.md`
- `cat <<EOF > file.md`
- 一時ファイルを 1 つに全文書き込んで `--stdin` でパイプする（バッファ限界に当たる）
- シェル変数や文字列結合で Markdown 本文を組み立ててから書き込む（クォートミスの温床）
- bash heredoc・`python3 -c`・run_in_terminal の command 引数に Markdown 本文を直書きする（実行ラッパーのマーカーが混入する）
- 生成スクリプトのコンテンツを `run_in_terminal` の `command` 引数に丸ごと埋め込む（必ず `create_file` で別ファイルにしてから `python3 /tmp/gen_*.py` で実行する）

## 簡易プロンプト

以下をユーザー指示として使える:

```text
Markdownファイルの作成・更新は必ずPython3で実行してください。
コンテンツの文字列生成もPythonで行い、まず /tmp/*.md.txt に安全に書き出してから
write-markdown.py / append-markdown.py で .md に流し込んでください。
echo/cat/heredoc で .md を直接書き込まないでください。
内容が長い場合は複数の --input-file チャンクに分割して渡してください。
```

## 同梱スクリプト

- `scripts/write-markdown.py`: Markdown を UTF-8 で新規作成/上書き（複数チャンク対応）
- `scripts/append-markdown.py`: Markdown に UTF-8 で追記（複数チャンク対応）

どちらも `--input-file` を複数回指定すると、渡した順に連結して処理する。

```bash
# 新規作成/上書き（１ファイル）
python3 .github/skills/markdown-with-python3/scripts/write-markdown.py docs/example.md --input-file /tmp/content.md.txt

# 新規作成/上書き（チャンク分割）
python3 .github/skills/markdown-with-python3/scripts/write-markdown.py docs/example.md \
  --input-file /tmp/part1.md.txt \
  --input-file /tmp/part2.md.txt

# 追記
python3 .github/skills/markdown-with-python3/scripts/append-markdown.py docs/example.md --input-file /tmp/append.md.txt
```

## evals

- `evals/evals.json` に 3 つの評価プロンプトを定義済み
- 目的:
	- `.md` 作成/更新で Python3 経由を一貫して選択できること
	- 長文かつ Markdown 記法を含む内容でも破損しないこと
	- 長文時にチャンク分割を選択できること
	- コンテンツ生成フェーズも Python で行い、シェルクォートミスを起こさないこと

## 出力方針

- 実施時は「Python3 で作成した」ことが分かるコマンドまたは処理内容を示す。
- **コンテンツ生成 → `.txt` 一時ファイル → `.md` 書き込み** の 2 ステップを守る。
- 長文入力時は `--input-file` を優先する。
- シェルラッパー経由で内容が切れそうな場合は迷わずチャンク分割する。
- **コンテンツに記号・コードフェンス・引用符・`$`・バッククォートが含まれる場合は、必ずパターン A（`create_file` で生成スクリプトを別ファイルに作成 → `python3` で実行）を選択する。**
- `.md` 以外のファイルは通常方針に従ってよい。
