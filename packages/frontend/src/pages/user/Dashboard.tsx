import { Box, Card, CardContent, Typography } from "@mui/material";
import { Title, useGetList } from "react-admin";

interface Job {
  id: string;
  status: string;
  repository: string;
  createdAt: string;
}

export const Dashboard = () => {
  const { data: jobs, total } = useGetList<Job>("jobs", {
    pagination: { page: 1, perPage: 5 },
    sort: { field: "createdAt", order: "DESC" },
  });

  const running = jobs?.filter((j) => j.status === "RUNNING").length ?? 0;
  const completed = jobs?.filter((j) => j.status === "COMPLETED").length ?? 0;

  return (
    <Card>
      <Title title="ダッシュボード" />
      <CardContent>
        <Typography variant="h5" gutterBottom>
          CATAPULT ダッシュボード
        </Typography>
        <Box sx={{ display: "flex", gap: 2, mt: 1, flexWrap: "wrap" }}>
          <Card variant="outlined" sx={{ minWidth: 160 }}>
            <CardContent>
              <Typography color="textSecondary">総ジョブ数</Typography>
              <Typography variant="h4">{total ?? 0}</Typography>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ minWidth: 160 }}>
            <CardContent>
              <Typography color="textSecondary">実行中</Typography>
              <Typography variant="h4" color="primary">
                {running}
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ minWidth: 160 }}>
            <CardContent>
              <Typography color="textSecondary">完了</Typography>
              <Typography variant="h4" color="success.main">
                {completed}
              </Typography>
            </CardContent>
          </Card>
        </Box>
      </CardContent>
    </Card>
  );
};
