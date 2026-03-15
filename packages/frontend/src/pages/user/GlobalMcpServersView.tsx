import {
  BooleanField,
  Datagrid,
  FunctionField,
  List,
  Show,
  ShowButton,
  SimpleShowLayout,
  TextField,
} from "react-admin";

interface McpServerRecord {
  id: string;
  name: string;
  serverKey: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export const GlobalMcpServersView = () => (
  <List resource="mcp-servers/global">
    <Datagrid bulkActionButtons={false} rowClick="show">
      <TextField source="name" label="管理名" />
      <TextField source="serverKey" label="サーバーキー" />
      <BooleanField source="enabled" label="有効" />
      <ShowButton resource="mcp-servers/global" />
    </Datagrid>
  </List>
);

export const GlobalMcpServerShow = () => (
  <Show resource="mcp-servers/global">
    <SimpleShowLayout>
      <TextField source="name" label="管理名" />
      <TextField source="serverKey" label="サーバーキー" />
      <BooleanField source="enabled" label="有効" />
      <FunctionField
        source="config"
        label="設定"
        render={(record: McpServerRecord) => (
          <pre
            style={{
              fontSize: 12,
              background: "#1a1a2e",
              color: "#cdd6f4",
              padding: "12px 16px",
              borderRadius: 6,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(record.config, null, 2)}
          </pre>
        )}
      />
    </SimpleShowLayout>
  </Show>
);
