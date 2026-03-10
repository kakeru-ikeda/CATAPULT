import { Datagrid, DateField, List, TextField } from "react-admin";

import { JobStatusBadge } from "../../components/JobStatusBadge.js";

export const MyJobs = () => (
  <List sort={{ field: "createdAt", order: "DESC" }}>
    <Datagrid rowClick="show">
      <TextField source="repository" label="リポジトリ" />
      <TextField source="branch" label="ブランチ" />
      <JobStatusBadge source="status" label="ステータス" />
      <DateField source="createdAt" label="作成日時" showTime />
    </Datagrid>
  </List>
);
