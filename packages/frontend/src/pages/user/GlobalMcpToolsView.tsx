import {
  BooleanField,
  Datagrid,
  List,
  Show,
  ShowButton,
  SimpleShowLayout,
  TextField,
} from "react-admin";

export const GlobalMcpToolsView = () => (
  <List resource="mcp-tools/global">
    <Datagrid bulkActionButtons={false} rowClick="show">
      <TextField source="name" label="ツール名" />
      <TextField source="endpoint" label="エンドポイント" />
      <TextField source="method" label="メソッド" />
      <BooleanField source="enabled" label="有効" />
      <ShowButton resource="mcp-tools/global" />
    </Datagrid>
  </List>
);

export const GlobalMcpToolShow = () => (
  <Show resource="mcp-tools/global">
    <SimpleShowLayout>
      <TextField source="name" label="ツール名" />
      <TextField source="description" label="説明" />
      <TextField source="endpoint" label="エンドポイント" />
      <TextField source="method" label="メソッド" />
      <BooleanField source="enabled" label="有効" />
    </SimpleShowLayout>
  </Show>
);
