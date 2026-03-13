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

const GlobalSkillListActions = () => (
  <TopToolbar>
    <SkillUploadButton endpoint="/api/skills/global/upload" />
  </TopToolbar>
);

const GlobalSkillEmpty = () => (
  <div style={{ padding: "2em", textAlign: "center" }}>
    <p>グローバルスキルがまだありません。ZIP ファイルからアップロードしてください。</p>
    <SkillUploadButton endpoint="/api/skills/global/upload" />
  </div>
);

export const GlobalSkillConfig = () => (
  <List resource="skills/global" actions={<GlobalSkillListActions />} empty={<GlobalSkillEmpty />}>
    <Datagrid rowClick="edit">
      <TextField source="name" label="スキル名" />
      <TextField source="displayName" label="表示名" />
      <TextField source="description" label="説明（Copilot 自律選択用）" />
      <TextField source="version" label="バージョン" />
      <BooleanField source="enabled" label="有効" />
      <EditButton resource="skills/global" />
      <DeleteButton resource="skills/global" />
    </Datagrid>
  </List>
);

export const GlobalSkillEdit = () => (
  <Edit resource="skills/global">
    <SimpleForm toolbar={<SkillFormToolbar />}>
      {/* name はファイルシステム名のため変更不可 */}
      <TextInput source="name" label="スキル名" disabled />
      <TextInput source="displayName" label="表示名" required />
      <TextInput source="version" label="バージョン" />
      <BooleanInput source="enabled" label="有効" />
    </SimpleForm>
  </Edit>
);
