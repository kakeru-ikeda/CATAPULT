import { Card, CardContent, Typography } from "@mui/material";
import { Title } from "react-admin";

export const SystemSettings = () => (
  <Card>
    <Title title="システム設定" />
    <CardContent>
      <Typography variant="h6" gutterBottom>
        システム設定
      </Typography>
      <Typography variant="body2" color="textSecondary">
        現在設定できる項目はありません。
      </Typography>
    </CardContent>
  </Card>
);
