# 長文Markdown検証

このファイルは、長文かつ複雑なMarkdown記法を安全に保持できるかを確認するための入力です。

## 要件

- UTF-8 で保存されること
- 改行が保持されること
- Markdown記法が壊れないこと

> 引用ブロック: ここはそのまま保持される必要があります。

## コードフェンス

```ts
type User = {
  id: string;
  name: string;
  roles: string[];
};

const example: User = {
  id: "u-1",
  name: "alice",
  roles: ["admin", "reviewer"],
};

console.info(example);
```

## テーブル

| Key        | Value      | Notes           |
| ---------- | ---------- | --------------- |
| retries    | 3          | max retry count |
| timeout_ms | 120000     | request timeout |
| mode       | safe-write | avoid one-liner |

## 箇条書き

1. 一時ファイルを使う
2. Python3スクリプトに `--input-file` で渡す
3. 出力を確認する

---

最後の段落です。バッククォートや特殊記号を含んでいても、内容が変化しないことを期待します。
