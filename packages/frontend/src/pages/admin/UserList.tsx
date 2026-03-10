import {
  Datagrid,
  EditButton,
  List,
  SelectField,
  SimpleForm,
  SelectInput,
  TextField,
  Edit,
} from "react-admin";

const roleChoices = [
  { id: "ADMIN", name: "管理者" },
  { id: "USER", name: "利用者" },
];

export const UserList = () => (
  <List>
    <Datagrid rowClick="edit">
      <TextField source="githubUsername" label="GitHub ユーザー名" />
      <SelectField source="role" choices={roleChoices} label="ロール" />
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
