import {
  Datagrid,
  EditButton,
  List,
  SelectField,
  SimpleForm,
  SelectInput,
  TextField,
  Edit,
  useRecordContext,
} from "react-admin";

const roleChoices = [
  { id: "ADMIN", name: "管理者" },
  { id: "USER", name: "利用者" },
];

interface LocalAgent {
  id: string;
  name: string;
  status: "ONLINE" | "OFFLINE";
  workspaceRoot: string;
}

interface UserRecord {
  localAgents?: LocalAgent[];
}

const LocalAgentStatusField = () => {
  const record = useRecordContext<UserRecord>();
  const agents = record?.localAgents ?? [];
  if (agents.length === 0) return <span>未登録</span>;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {agents.map((agent) => (
        <li key={agent.id}>
          {agent.status === "ONLINE" ? "🟢" : "🔴"} {agent.name} ({agent.workspaceRoot})
        </li>
      ))}
    </ul>
  );
};
LocalAgentStatusField.defaultProps = { label: "ローカルエージェント" };

export const UserList = () => (
  <List>
    <Datagrid rowClick="edit">
      <TextField source="githubUsername" label="GitHub ユーザー名" />
      <SelectField source="role" choices={roleChoices} label="ロール" />
      <LocalAgentStatusField />
      <EditButton />
    </Datagrid>
  </List>
);

export const UserEdit = () => (
  <Edit>
    <SimpleForm>
      <TextField source="githubUsername" label="GitHub ユーザー名" />
      <SelectInput source="role" choices={roleChoices} label="ロール" />
    </SimpleForm>
  </Edit>
);
