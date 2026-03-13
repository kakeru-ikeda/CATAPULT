import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { BooleanInput, TextInput, useRecordContext } from "react-admin";
import { useFormContext } from "react-hook-form";

const EDITABLE_KEYS = ["name", "description", "endpoint", "method", "enabled"] as const;
type EditableKey = (typeof EDITABLE_KEYS)[number];

interface McpToolValues {
  id?: string;
  name: string;
  description: string;
  endpoint: string;
  method: string;
  enabled: boolean;
}

const DEFAULT_VALUES: Omit<McpToolValues, "id"> = {
  name: "",
  description: "",
  endpoint: "",
  method: "POST",
  enabled: true,
};

const tabButtonStyle = (active: boolean): CSSProperties => ({
  padding: "5px 16px",
  border: `1.5px solid ${active ? "#1976d2" : "#555"}`,
  borderRadius: 4,
  background: active ? "#1976d2" : "transparent",
  color: active ? "#fff" : "#aaa",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  letterSpacing: "0.01em",
  transition: "all 0.15s",
});

export const McpToolEditor = () => {
  const record = useRecordContext<McpToolValues>();
  const { setValue, getValues } = useFormContext();
  const [mode, setMode] = useState<"json" | "form">("json");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const initialized = useRef(false);

  const buildJsonText = useCallback(() => {
    const vals = getValues();
    const obj: Omit<McpToolValues, "id"> = {
      name: (vals.name as string | undefined) ?? DEFAULT_VALUES.name,
      description: (vals.description as string | undefined) ?? DEFAULT_VALUES.description,
      endpoint: (vals.endpoint as string | undefined) ?? DEFAULT_VALUES.endpoint,
      method: (vals.method as string | undefined) ?? DEFAULT_VALUES.method,
      enabled: (vals.enabled as boolean | undefined) ?? DEFAULT_VALUES.enabled,
    };
    return JSON.stringify(obj, null, 2);
  }, [getValues]);

  // Initialize JSON text when record loads (edit) or on mount (create)
  useEffect(() => {
    if (initialized.current) return;

    if (!record?.id && !("id" in (record ?? {}))) {
      // Create mode: set defaults
      for (const [key, val] of Object.entries(DEFAULT_VALUES)) {
        setValue(key as EditableKey, val);
      }
      setJsonText(JSON.stringify(DEFAULT_VALUES, null, 2));
      initialized.current = true;
    } else if (record?.id) {
      // Edit mode: record is available, build JSON from it
      const obj: Omit<McpToolValues, "id"> = {
        name: record.name ?? DEFAULT_VALUES.name,
        description: record.description ?? DEFAULT_VALUES.description,
        endpoint: record.endpoint ?? DEFAULT_VALUES.endpoint,
        method: record.method ?? DEFAULT_VALUES.method,
        enabled: record.enabled ?? DEFAULT_VALUES.enabled,
      };
      setJsonText(JSON.stringify(obj, null, 2));
      initialized.current = true;
    }
  }, [record, setValue]);

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      setJsonError(null);
      for (const key of EDITABLE_KEYS) {
        if (key in parsed) {
          setValue(key, parsed[key], { shouldDirty: true });
        }
      }
    } catch {
      setJsonError("無効な JSON です");
    }
  };

  const switchToJson = useCallback(() => {
    setJsonText(buildJsonText());
    setJsonError(null);
    setMode("json");
  }, [buildJsonText]);

  const switchToForm = () => setMode("form");

  return (
    <div style={{ width: "100%" }}>
      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button type="button" onClick={switchToJson} style={tabButtonStyle(mode === "json")}>
          {"{ } JSON"}
        </button>
        <button type="button" onClick={switchToForm} style={tabButtonStyle(mode === "form")}>
          フォーム
        </button>
      </div>

      {mode === "json" ? (
        <div>
          <textarea
            value={jsonText}
            onChange={(e) => handleJsonChange(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            style={{
              width: "100%",
              minHeight: 280,
              fontFamily: '"Fira Code", "Cascadia Code", "Consolas", monospace',
              fontSize: 13,
              lineHeight: 1.65,
              background: "#1a1a2e",
              color: "#cdd6f4",
              border: `1.5px solid ${jsonError ? "#f38ba8" : "#3c3f6e"}`,
              borderRadius: 6,
              padding: "12px 16px",
              resize: "vertical",
              boxSizing: "border-box",
              outline: "none",
              caretColor: "#cba6f7",
              tabSize: 2,
            }}
          />
          {jsonError ? (
            <div style={{ color: "#f38ba8", fontSize: 12, marginTop: 6 }}>⚠ {jsonError}</div>
          ) : (
            <div style={{ color: "#585b70", fontSize: 11, marginTop: 6 }}>
              有効な JSON を入力してください。変更は自動的にフォームへ反映されます。
            </div>
          )}
        </div>
      ) : (
        <div>
          <TextInput source="name" label="ツール名" fullWidth required />
          <TextInput source="description" label="説明" fullWidth multiline minRows={2} />
          <TextInput source="endpoint" label="エンドポイント URL" fullWidth required />
          <TextInput source="method" label="HTTP メソッド" />
          <BooleanInput source="enabled" label="有効" />
        </div>
      )}
    </div>
  );
};
