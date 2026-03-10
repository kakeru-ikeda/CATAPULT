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

const InstructionFormToolbar = () => (
  <Toolbar>
    <SaveButton />
  </Toolbar>
);

export const MyInstructions = () => (
  <>
    <List>
      <Datagrid rowClick="edit">
        <TextField source="name" label="名前" />
        <BooleanField source="isActive" label="有効" />
        <EditButton />
        <DeleteButton />
      </Datagrid>
    </List>
    <Create>
      <SimpleForm toolbar={<InstructionFormToolbar />}>
        <TextInput source="name" label="名前" required />
        <TextInput source="content" label="内容" multiline rows={6} required />
        <BooleanInput source="isActive" label="有効" defaultValue={true} />
      </SimpleForm>
    </Create>
  </>
);

export const MyInstructionEdit = () => (
  <Edit>
    <SimpleForm toolbar={<InstructionFormToolbar />}>
      <TextInput source="name" label="名前" />
      <TextInput source="content" label="内容" multiline rows={6} />
      <BooleanInput source="isActive" label="有効" />
    </SimpleForm>
  </Edit>
);
