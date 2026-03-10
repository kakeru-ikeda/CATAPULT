import { LinearProgress } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useRecordContext } from "react-admin";

interface LogEntry {
  id: string;
  eventType: string;
  content: string;
  timestamp: string;
}

function formatLogEntry(log: LogEntry): string {
  const raw = (() => {
    try {
      return JSON.parse(log.content) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  switch (log.eventType) {
    case "agent_step":
      return `💭 ${(raw?.["content"] as string | undefined) ?? log.content}`;
    case "tool_call":
      return `🔧 ${(raw?.["tool"] as string | undefined) ?? ""}: ${JSON.stringify(raw?.["input"] ?? "")}`;
    case "shell":
      return `📟 ${(raw?.["command"] as string | undefined) ?? ""}`;
    case "file_edit":
      return `📝 ${(raw?.["path"] as string | undefined) ?? ""}`;
    case "error":
      return `❌ ${(raw?.["message"] as string | undefined) ?? log.content}`;
    case "done":
      return `✅ ${(raw?.["summary"] as string | undefined) ?? "完了"}`;
    default:
      return log.content;
  }
}

export const LogViewer = () => {
  const record = useRecordContext<{ id: string }>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLive, setIsLive] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

  useEffect(() => {
    if (!record?.id) return;

    const token = localStorage.getItem("token") ?? "";
    const url = `${API_URL}/api/jobs/${record.id}/stream?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(url);

    setIsLive(true);

    eventSource.onmessage = (e: MessageEvent<string>) => {
      const log = JSON.parse(e.data) as LogEntry;
      setLogs((prev) => [...prev, log]);
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    eventSource.onerror = () => {
      setIsLive(false);
      eventSource.close();
    };

    return () => {
      eventSource.close();
      setIsLive(false);
    };
  }, [record?.id, API_URL]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong>実行ログ</strong>
        {isLive && (
          <>
            <span style={{ color: "red", fontWeight: "bold" }}>● LIVE</span>
            <LinearProgress style={{ width: 100 }} />
          </>
        )}
      </div>
      <div
        style={{
          fontFamily: "monospace",
          fontSize: 13,
          backgroundColor: "#1e1e1e",
          color: "#d4d4d4",
          padding: 16,
          borderRadius: 4,
          maxHeight: 600,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {logs.map((log) => (
          <div key={log.id}>
            <span style={{ color: "#888" }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>{" "}
            {formatLogEntry(log)}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
