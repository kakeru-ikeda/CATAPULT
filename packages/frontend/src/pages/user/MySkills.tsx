import {
  BooleanField,
  BooleanInput,
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
  TopToolbar,
} from "react-admin";

import { SkillUploadButton } from "../../components/SkillUploadButton.js";

const SkillFormToolbar = () => (
  <Toolbar>
    <SaveButton />
  </Toolbar>
);

const MySkillListActions = () => (
  <TopToolbar>
    <SkillUploadButton endpoint="/api/skills/upload" />
  </TopToolbar>
);

const MySkillEmpty = () => (
  <div style={{ padding: "2em", textAlign: "center" }}>
    <p>スキルがまだありません。ZIP ファイルからアップロードしてください。</p>
    <SkillUploadButton endpoint="/api/skills/upload" />
  </div>
);

export const MySkills = () => (
  <List actions={<MySkillListActions />} empty={<MySkillEmpty />}>
    <Datagrid rowClick="edit">
      <TextField source="name" label="スキル名" />
      <TextField source="displayName" label="表示名" />
      <TextField source="description" label="説明（Copilot 自律選択用）" />
      <BooleanField source="enabled" label="有効" />
      <EditButton />
      <DeleteButton />
    </Datagrid>
  </List>
);

export const MySkillEdit = () => (
  <Edit>
    <SimpleForm toolbar={<SkillFormToolbar />}>
      {/* name はファイルシステム名のため変更不可 */}
      <TextInput source="name" label="スキル名" disabled />
      <TextInput source="displayName" label="表示名" required />
      <BooleanInput source="enabled" label="有効" />
    </SimpleForm>
  </Edit>
);
