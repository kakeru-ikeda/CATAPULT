import {
  BooleanField,
  Datagrid,
  List,
  Show,
  ShowButton,
  SimpleShowLayout,
  TextField,
} from "react-admin";

export const GlobalSkillsView = () => (
  <List resource="skills/global">
    <Datagrid bulkActionButtons={false} rowClick="show">
      <TextField source="name" label="スキル名" />
      <TextField source="displayName" label="表示名" />
      <TextField source="description" label="説明" />
      <TextField source="version" label="バージョン" />
      <BooleanField source="enabled" label="有効" />
      <ShowButton resource="skills/global" />
    </Datagrid>
  </List>
);

export const GlobalSkillShow = () => (
  <Show resource="skills/global">
    <SimpleShowLayout>
      <TextField source="name" label="スキル名" />
      <TextField source="displayName" label="表示名" />
      <TextField source="description" label="説明" />
      <TextField source="version" label="バージョン" />
      <BooleanField source="enabled" label="有効" />
      <TextField source="content" label="内容（SKILL.md）" />
    </SimpleShowLayout>
  </Show>
);
