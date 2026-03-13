import { useRef } from "react";
import { Button, useNotify, useRefresh } from "react-admin";

const VITE_API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

interface SkillUploadButtonProps {
  /** アップロード先 API パス（例: "/api/skills/upload"） */
  endpoint: string;
}

/**
 * SKILL.md を含む ZIP ファイルをアップロードするボタン。
 * ファイル選択後すぐにアップロードし、成功したらリストを更新する。
 */
export const SkillUploadButton = ({ endpoint }: SkillUploadButtonProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const notify = useNotify();
  const refresh = useRefresh();

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 次回選択のためにリセット
    if (inputRef.current) inputRef.current.value = "";

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${VITE_API_URL}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
        body: formData,
      });
      const data = (await res.json()) as { error?: string };
      if (res.ok) {
        notify("スキルをアップロードしました", { type: "success" });
        refresh();
      } else {
        notify(data.error ?? "アップロードに失敗しました", { type: "error" });
      }
    } catch {
      notify("アップロード中にエラーが発生しました", { type: "error" });
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        style={{ display: "none" }}
        onChange={(e) => {
          void handleChange(e);
        }}
      />
      <Button label="ZIP からアップロード" onClick={() => inputRef.current?.click()} />
    </>
  );
};
