import {
  BooleanField,
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  FunctionField,
  List,
  SaveButton,
  Show,
  ShowButton,
  SimpleForm,
  SimpleShowLayout,
  TextField,
  Toolbar,
} from "react-admin";

import { McpServerEditor } from "../../components/McpServerEditor.js";

interface McpServerRecord {
  id: string;
  name: string;
  serverKey: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

const McpServerFormToolbar = () => (
  <Toolbar>
    <SaveButton />
  </Toolbar>
);

const validateMcpServer = (values: Record<string, unknown>) => {
  const errors: Record<string, string> = {};
  if (!values["name"]) errors["name"] = "管理名は必須です";
  if (!values["serverKey"]) errors["serverKey"] = "サーバーキーは必須です";
  if (!values["config"] || Object.keys(values["config"] as object).length === 0) {
    errors["config"] = "設定オブジェクトは必須です";
  }
  return errors;
};

export const McpServerSettings = () => (
  <>
    <List>
      <Datagrid rowClick="show">
        <TextField source="name" label="管理名" />
        <TextField source="serverKey" label="サーバーキー" />
        <BooleanField source="enabled" label="有効" />
        <EditButton />
        <ShowButton />
        <DeleteButton />
      </Datagrid>
    </List>
    <Create>
      <SimpleForm toolbar={<McpServerFormToolbar />} validate={validateMcpServer}>
        <McpServerEditor />
      </SimpleForm>
    </Create>
  </>
);

export const McpServerEdit = () => (
  <Edit>
    <SimpleForm toolbar={<McpServerFormToolbar />} validate={validateMcpServer}>
      <McpServerEditor />
    </SimpleForm>
  </Edit>
);

export const McpServerShow = () => (
  <Show>
    <SimpleShowLayout>
      <TextField source="name" label="管理名" />
      <TextField source="serverKey" label="サーバーキー" />
      <BooleanField source="enabled" label="有効" />
      <FunctionField
        source="config"
        label="設定"
        render={(record: McpServerRecord) => (
          <pre
            style={{
              fontSize: 12,
              background: "#1a1a2e",
              color: "#cdd6f4",
              padding: "12px 16px",
              borderRadius: 6,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(record.config, null, 2)}
          </pre>
        )}
      />
    </SimpleShowLayout>
  </Show>
);
