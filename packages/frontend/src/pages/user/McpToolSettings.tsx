import {
  BooleanField,
  BooleanInput,
  Create,
  Datagrid,
  DeleteButton,
  Edit,
  EditButton,
  List,
  SaveButton,
  SimpleForm,
  TextField,
  TextInput,
  Toolbar,
} from "react-admin";

const McpToolFormToolbar = () => (
  <Toolbar>
    <SaveButton />
  </Toolbar>
);

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
      <SimpleForm toolbar={<McpToolFormToolbar />}>
        <TextInput source="name" label="ツール名" required />
        <TextInput source="description" label="説明" />
        <TextInput source="endpoint" label="エンドポイント URL" required />
        <TextInput source="method" label="HTTP メソッド" defaultValue="POST" />
        <BooleanInput source="enabled" label="有効" defaultValue={true} />
      </SimpleForm>
    </Create>
  </>
);

export const McpToolEdit = () => (
  <Edit>
    <SimpleForm toolbar={<McpToolFormToolbar />}>
      <TextInput source="name" label="ツール名" />
      <TextInput source="description" label="説明" />
      <TextInput source="endpoint" label="エンドポイント URL" />
      <TextInput source="method" label="HTTP メソッド" />
      <BooleanInput source="enabled" label="有効" />
    </SimpleForm>
  </Edit>
);
