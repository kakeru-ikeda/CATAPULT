import {
  BooleanField,
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  List,
  SaveButton,
  SimpleForm,
  TextField,
  Toolbar,
} from "react-admin";

import { McpToolEditor } from "../../components/McpToolEditor.js";

const McpToolFormToolbar = () => (
  <Toolbar>
    <SaveButton />
  </Toolbar>
);

const validateMcpTool = (values: Record<string, unknown>) => {
  const errors: Record<string, string> = {};
  if (!values["name"]) errors["name"] = "ツール名は必須です";
  if (!values["endpoint"]) errors["endpoint"] = "エンドポイント URL は必須です";
  return errors;
};

export const McpToolSettings = () => (
  <>
    <List>
      <Datagrid rowClick="edit">
        <TextField source="name" label="ツール名" />
        <TextField source="endpoint" label="エンドポイント" />
        <BooleanField source="enabled" label="有効" />
        <EditButton />
        <DeleteButton />
      </Datagrid>
    </List>
    <Create>
      <SimpleForm toolbar={<McpToolFormToolbar />} validate={validateMcpTool}>
        <McpToolEditor />
      </SimpleForm>
    </Create>
  </>
);

export const McpToolEdit = () => (
  <Edit>
    <SimpleForm toolbar={<McpToolFormToolbar />} validate={validateMcpTool}>
      <McpToolEditor />
    </SimpleForm>
  </Edit>
);
