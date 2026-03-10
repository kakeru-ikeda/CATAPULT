import { Datagrid, DateField, List, Show, SimpleShowLayout, TextField } from "react-admin";

import { JobStatusBadge } from "../../components/JobStatusBadge.js";
import { LogViewer } from "../../components/LogViewer.js";

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
      <TextField source="repository" label="リポジトリ" />
      <TextField source="branch" label="ブランチ" />
      <TextField source="prompt" label="プロンプト" />
      <JobStatusBadge source="status" label="ステータス" />
      <LogViewer />
    </SimpleShowLayout>
  </Show>
);
