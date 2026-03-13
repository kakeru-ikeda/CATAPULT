import {
  BooleanField,
  Datagrid,
  List,
  Show,
  ShowButton,
  SimpleShowLayout,
  TextField,
} from "react-admin";

export const GlobalInstructionsView = () => (
  <List resource="instructions/global">
    <Datagrid bulkActionButtons={false} rowClick="show">
      <TextField source="name" label="名前" />
      <BooleanField source="isActive" label="有効" />
      <ShowButton resource="instructions/global" />
    </Datagrid>
  </List>
);

export const GlobalInstructionShow = () => (
  <Show resource="instructions/global">
    <SimpleShowLayout>
      <TextField source="name" label="名前" />
      <BooleanField source="isActive" label="有効" />
      <TextField source="content" label="内容" />
    </SimpleShowLayout>
  </Show>
);
