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

const SkillFormToolbar = () => (
  <Toolbar>
    <SaveButton />
  </Toolbar>
);

export const GlobalSkillConfig = () => (
  <>
    <List resource="skills/global">
      <Datagrid rowClick="edit">
        <TextField source="name" label="スキル名" />
        <TextField source="displayName" label="表示名" />
        <TextField source="description" label="説明" />
        <TextField source="version" label="バージョン" />
        <BooleanField source="enabled" label="有効" />
        <EditButton resource="skills/global" />
        <DeleteButton resource="skills/global" />
      </Datagrid>
    </List>
    <Create resource="skills/global">
      <SimpleForm toolbar={<SkillFormToolbar />} defaultValues={{ scope: "GLOBAL" }}>
        <TextInput source="name" label="スキル名（小文字ハイフン形式）" required />
        <TextInput source="displayName" label="表示名" required />
        <TextInput
          source="description"
          label="説明（Copilot の自律選択に使用）"
          multiline
          required
        />
        <TextInput source="content" label="SKILL.md 全文" multiline required />
        <TextInput source="version" label="バージョン" defaultValue="1.0.0" />
        <BooleanInput source="enabled" label="有効" defaultValue={true} />
      </SimpleForm>
    </Create>
  </>
);

export const GlobalSkillEdit = () => (
  <Edit resource="skills/global">
    <SimpleForm toolbar={<SkillFormToolbar />}>
      <TextInput source="name" label="スキル名（小文字ハイフン形式）" required />
      <TextInput source="displayName" label="表示名" required />
      <TextInput source="description" label="説明（Copilot の自律選択に使用）" multiline required />
      <TextInput source="content" label="SKILL.md 全文" multiline required />
      <TextInput source="version" label="バージョン" />
      <BooleanInput source="enabled" label="有効" />
    </SimpleForm>
  </Edit>
);
