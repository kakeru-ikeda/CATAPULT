import { useCallback, useEffect, useRef } from "react";
import { useRecordContext } from "react-admin";
import { useController, useFormContext, useFormState } from "react-hook-form";

interface McpServerRecord {
  id?: string;
  name: string;
  serverKey: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

const DEFAULT_VALUES: Omit<McpServerRecord, "id"> = {
  name: "",
  serverKey: "",
  config: {},
  enabled: true,
};

const PLACEHOLDER = JSON.stringify(
  {
    name: "drawio",
    serverKey: "drawio",
    config: {
      command: "npx",
      args: ["-y", "drawio-mcp-server"],
    },
    enabled: true,
  },
  null,
  2,
);

/** { mcpServers: { key: config } } 形式を検出して変換する */
function tryParseMcpServersFormat(
  parsed: Record<string, unknown>,
): Omit<McpServerRecord, "id"> | null {
  if (!("mcpServers" in parsed) || typeof parsed["mcpServers"] !== "object") return null;
  const mcpServers = parsed["mcpServers"] as Record<string, unknown>;
  const keys = Object.keys(mcpServers);
  if (keys.length === 0) return null;
  const key = keys[0]!;
  const config = mcpServers[key] as Record<string, unknown>;
  return { name: key, serverKey: key, config, enabled: true };
}

export const McpServerEditor = () => {
  const record = useRecordContext<McpServerRecord>();
  const { setValue, getValues, control } = useFormContext();
  const { errors } = useFormState({ control });

  // react-hook-form にフィールドを登録（表示 UI なし）
  useController({ control, name: "name", defaultValue: DEFAULT_VALUES.name });
  useController({ control, name: "serverKey", defaultValue: DEFAULT_VALUES.serverKey });
  useController({ control, name: "config", defaultValue: DEFAULT_VALUES.config });
  useController({ control, name: "enabled", defaultValue: DEFAULT_VALUES.enabled });

  const initialized = useRef(false);

  const buildJson = useCallback((): string => {
    const v = getValues();
    return JSON.stringify(
      {
        name: (v.name as string | undefined) ?? DEFAULT_VALUES.name,
        serverKey: (v.serverKey as string | undefined) ?? DEFAULT_VALUES.serverKey,
        config: (v.config as Record<string, unknown> | undefined) ?? DEFAULT_VALUES.config,
        enabled: (v.enabled as boolean | undefined) ?? DEFAULT_VALUES.enabled,
      },
      null,
      2,
    );
  }, [getValues]);

  // テキストエリアの ref で直接 DOM を操作（state 管理せずにパフォーマンス確保）
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialized.current) return;
    if (record?.id) {
      // 編集モード: レコードから初期化
      const json = JSON.stringify(
        {
          name: record.name ?? "",
          serverKey: record.serverKey ?? "",
          config: record.config ?? {},
          enabled: record.enabled ?? true,
        },
        null,
        2,
      );
      if (textareaRef.current) textareaRef.current.value = json;
      initialized.current = true;
    } else if (!("id" in (record ?? {}))) {
      // 作成モード: デフォルト値
      for (const [key, val] of Object.entries(DEFAULT_VALUES)) {
        setValue(key, val);
      }
      if (textareaRef.current) textareaRef.current.value = JSON.stringify(DEFAULT_VALUES, null, 2);
      initialized.current = true;
    }
  }, [record, setValue, buildJson]);

  const handleChange = (text: string) => {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const converted = tryParseMcpServersFormat(parsed);
      const values = converted ?? (parsed as Omit<McpServerRecord, "id">);

      if ("name" in values) setValue("name", values.name, { shouldDirty: true });
      if ("serverKey" in values) setValue("serverKey", values.serverKey, { shouldDirty: true });
      if ("config" in values) setValue("config", values.config, { shouldDirty: true });
      if ("enabled" in values) setValue("enabled", values.enabled, { shouldDirty: true });

      // mcpServers 形式をネイティブ形式に変換して表示更新
      if (converted && textareaRef.current) {
        const normalized = JSON.stringify(converted, null, 2);
        textareaRef.current.value = normalized;
      }

      if (errorRef.current) errorRef.current.textContent = "";
    } catch {
      if (errorRef.current) errorRef.current.textContent = "⚠ 無効な JSON です";
    }
  };

  const validationErrors = [errors.name, errors.serverKey, errors.config]
    .filter(Boolean)
    .map((e) => e?.message as string)
    .join(" / ");

  return (
    <div style={{ width: "100%" }}>
      <div style={{ marginBottom: 8, color: "#888", fontSize: 12 }}>
        <code style={{ background: "#222", padding: "2px 6px", borderRadius: 3 }}>
          {"{ mcpServers: { key: { ... } } }"}
        </code>{" "}
        形式の貼り付けにも対応しています
      </div>
      <textarea
        ref={textareaRef}
        defaultValue={PLACEHOLDER}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={PLACEHOLDER}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        style={{
          width: "100%",
          minHeight: 320,
          fontFamily: '"Fira Code", "Cascadia Code", "Consolas", monospace',
          fontSize: 13,
          lineHeight: 1.65,
          background: "#1a1a2e",
          color: "#cdd6f4",
          border: `1.5px solid ${validationErrors ? "#f38ba8" : "#3c3f6e"}`,
          borderRadius: 6,
          padding: "12px 16px",
          resize: "vertical",
          boxSizing: "border-box",
          outline: "none",
          caretColor: "#cba6f7",
          tabSize: 2,
        }}
      />
      <div ref={errorRef} style={{ color: "#f38ba8", fontSize: 12, marginTop: 6 }} />
      {validationErrors && (
        <div style={{ color: "#f38ba8", fontSize: 12, marginTop: 4 }}>⚠ {validationErrors}</div>
      )}
      <div style={{ color: "#585b70", fontSize: 11, marginTop: 6 }}>
        必須フィールド: <code>name</code>, <code>serverKey</code>, <code>config</code>
      </div>
    </div>
  );
};
