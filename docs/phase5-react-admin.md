# Phase 5: ReactAdmin 管理画面

## 目的

ReactAdmin v5 を使用して、管理者と利用者それぞれのモードを持つ管理画面を実装します。ジョブの監視・管理、ユーザー管理、MCPツール設定、インストラクション管理、アカウント連携を提供します。

## 期間目安

**1週間**

## タスク一覧

### 1. ReactAdmin v5 セットアップ

```bash
cd packages/frontend
npm install react-admin ra-data-simple-rest react react-dom
npm install -D @types/react @types/react-dom vite @vitejs/plugin-react
```

```typescript
// packages/frontend/src/App.tsx

import { Admin, Resource, CustomRoutes } from "react-admin";
import { Route } from "react-router-dom";
import { dataProvider } from "./dataProvider";
import { authProvider } from "./authProvider";

// 管理者向けリソース
import { UserList, UserEdit } from "./pages/admin/UserList";
import { JobList, JobShow } from "./pages/admin/JobList";
import { McpToolConfig } from "./pages/admin/McpToolConfig";
import { SystemSettings } from "./pages/admin/SystemSettings";

// 利用者向けページ
import { Dashboard } from "./pages/user/Dashboard";
import { MyJobs } from "./pages/user/MyJobs";
import { MyInstructions } from "./pages/user/MyInstructions";
import { AccountLink } from "./pages/user/AccountLink";
import { McpToolSettings } from "./pages/user/McpToolSettings";

export const App = () => (
  <Admin
    dataProvider={dataProvider}
    authProvider={authProvider}
    dashboard={Dashboard}
  >
    {(permissions) => (
      <>
        {/* 管理者モード */}
        {permissions === "ADMIN" && (
          <>
            <Resource name="users" list={UserList} edit={UserEdit} />
            <Resource name="jobs/all" list={JobList} show={JobShow} />
            <Resource name="mcp-tools/global" list={McpToolConfig} />
          </>
        )}
        {/* 利用者モード */}
        <Resource name="jobs" list={MyJobs} show={JobShow} />
        <Resource name="instructions" list={MyInstructions} />
        <Resource name="mcp-tools" list={McpToolSettings} />
        <CustomRoutes>
          <Route path="/account-link" element={<AccountLink />} />
          {permissions === "ADMIN" && (
            <Route path="/system-settings" element={<SystemSettings />} />
          )}
        </CustomRoutes>
      </>
    )}
  </Admin>
);
```

### 2. dataProvider (REST API バックエンド)

```typescript
// packages/frontend/src/dataProvider.ts

import { fetchUtils, DataProvider } from "react-admin";
import simpleRestProvider from "ra-data-simple-rest";

const httpClient = (url: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers);
  const token = localStorage.getItem("token");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetchUtils.fetchJson(url, { ...options, headers });
};

export const dataProvider: DataProvider = simpleRestProvider(
  `${import.meta.env.VITE_API_URL}/api`,
  httpClient,
);
```

### 3. authProvider (JWT 認証)

```typescript
// packages/frontend/src/authProvider.ts

import { AuthProvider } from "react-admin";

export const authProvider: AuthProvider = {
  login: async ({ username, password }) => {
    // GitHub OAuth へリダイレクト
    window.location.href = `${import.meta.env.VITE_API_URL}/api/auth/github?redirect=${encodeURIComponent(window.location.origin)}`;
  },

  logout: async () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
  },

  checkAuth: async () => {
    const token = localStorage.getItem("token");
    if (!token) throw new Error("Not authenticated");
  },

  checkError: async (error) => {
    if (error.status === 401 || error.status === 403) {
      localStorage.removeItem("token");
      throw new Error("Session expired");
    }
  },

  getPermissions: async () => {
    return localStorage.getItem("role") ?? "USER";
  },

  getIdentity: async () => {
    const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    const user = await response.json();
    return {
      id: user.id,
      fullName: user.githubUsername,
      avatar: user.githubAvatarUrl,
    };
  },
};
```

### 4. ロールベース UI 分岐

`App.tsx` の `{(permissions) => ...}` パターンで ADMIN/USER を切り分けます（上記参照）。

### 5. 管理者モード: UserList / UserEdit

```typescript
// packages/frontend/src/pages/admin/UserList.tsx

import { List, Datagrid, TextField, EmailField, SelectField, EditButton } from "react-admin";

export const UserList = () => (
  <List>
    <Datagrid>
      <TextField source="githubUsername" label="GitHub ユーザー名" />
      <SelectField
        source="role"
        choices={[
          { id: "ADMIN", name: "管理者" },
          { id: "USER", name: "利用者" },
        ]}
        label="ロール"
      />
      <EditButton />
    </Datagrid>
  </List>
);
```

### 6. 管理者モード: JobList / JobShow

```typescript
// packages/frontend/src/pages/admin/JobList.tsx

import { List, Datagrid, TextField, DateField, Show, SimpleShowLayout } from "react-admin";
import { JobStatusBadge } from "../../components/JobStatusBadge";
import { LogViewer } from "../../components/LogViewer";

export const JobList = () => (
  <List sort={{ field: "createdAt", order: "DESC" }}>
    <Datagrid rowClick="show">
      <TextField source="user.githubUsername" label="ユーザー" />
      <TextField source="repository" label="リポジトリ" />
      <JobStatusBadge source="status" label="ステータス" />
      <DateField source="createdAt" label="作成日時" showTime />
    </Datagrid>
  </List>
);

export const JobShow = () => (
  <Show>
    <SimpleShowLayout>
      <TextField source="repository" />
      <TextField source="branch" />
      <TextField source="prompt" />
      <JobStatusBadge source="status" />
      <LogViewer source="id" />
    </SimpleShowLayout>
  </Show>
);
```

### 7. LogViewer コンポーネント（SSE 対応）

```typescript
// packages/frontend/src/components/LogViewer.tsx

import { useEffect, useRef, useState } from "react";
import { useRecordContext } from "react-admin";
import { LinearProgress } from "@mui/material";

interface LogEntry {
  id: string;
  eventType: string;
  content: string;
  timestamp: string;
}

export const LogViewer = () => {
  const record = useRecordContext();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLive, setIsLive] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!record?.id) return;

    const eventSource = new EventSource(
      `${import.meta.env.VITE_API_URL}/api/jobs/${record.id}/stream`,
      { withCredentials: true },
    );

    setIsLive(true);

    eventSource.onmessage = (e) => {
      const log = JSON.parse(e.data) as LogEntry;
      setLogs((prev) => [...prev, log]);
      // 自動スクロール
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
  }, [record?.id]);

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
```

### 8. JobStatusBadge コンポーネント

```typescript
// packages/frontend/src/components/JobStatusBadge.tsx

import { useRecordContext } from "react-admin";
import { Chip } from "@mui/material";

const STATUS_COLORS = {
  PENDING: "default",
  RUNNING: "primary",
  COMPLETED: "success",
  FAILED: "error",
  CANCELLED: "warning",
} as const;

export const JobStatusBadge = ({ source }: { source: string }) => {
  const record = useRecordContext();
  const status = record?.[source] as keyof typeof STATUS_COLORS;
  return <Chip label={status} color={STATUS_COLORS[status] ?? "default"} size="small" />;
};
```

### 9. SSE エンドポイント

`docs/streaming.md` の SSE エンドポイント実装を参照。

```typescript
// packages/api/src/routes/jobs.ts
// GET /api/jobs/:jobId/stream
```

## 成果物

- `packages/frontend/src/App.tsx` - アプリケーションエントリー
- `packages/frontend/src/authProvider.ts` - JWT 認証プロバイダー
- `packages/frontend/src/dataProvider.ts` - REST API データプロバイダー
- `packages/frontend/src/pages/admin/` - 管理者向けページ
- `packages/frontend/src/pages/user/` - 利用者向けページ
- `packages/frontend/src/components/JobStatusBadge.tsx` - ステータスバッジ
- `packages/frontend/src/components/LogViewer.tsx` - リアルタイムログビューアー
- `packages/api/src/routes/jobs.ts` (SSE エンドポイント)

## 完了条件

- [ ] ReactAdmin で GitHub OAuth ログインができる
- [ ] 管理者は UserList / JobList (全件) / McpToolConfig / SystemSettings にアクセスできる
- [ ] 利用者は MyJobs / MyInstructions / AccountLink / McpToolSettings にアクセスできる
- [ ] 管理者ページに利用者がアクセスするとリダイレクトされる
- [ ] LogViewer でジョブログが表示される
- [ ] 実行中ジョブに LIVE バッジが表示され、SSE でリアルタイム更新される
- [ ] JobStatusBadge でステータスが色付きで表示される
