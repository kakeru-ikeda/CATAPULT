import { Box, Card, CardContent, Chip, CircularProgress, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { Title, useGetList } from "react-admin";

interface Job {
  id: string;
  status: string;
  repository: string;
  createdAt: string;
}

interface LocalAgent {
  id: string;
  name: string;
  status: "ONLINE" | "OFFLINE";
  workspaceRoot: string;
  lastHeartbeatAt: string | null;
}

const AgentStatusCard = () => {
  const [agents, setAgents] = useState<LocalAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    fetch("/api/agents/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json() as Promise<{ agents: LocalAgent[] }>)
      .then((data) => {
        setAgents(data.agents ?? []);
      })
      .catch(() => {
        setAgents([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const onlineCount = agents.filter((a) => a.status === "ONLINE").length;

  return (
    <Card variant="outlined" sx={{ mt: 2 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          💻 ローカルエージェント
        </Typography>
        {loading ? (
          <CircularProgress size={20} />
        ) : agents.length === 0 ? (
          <Box>
            <Typography color="textSecondary" variant="body2">
              ローカルエージェント未登録
            </Typography>
            <Typography
              variant="body2"
              sx={{ mt: 1, fontFamily: "monospace", bgcolor: "grey.100", p: 1, borderRadius: 1 }}
            >
              npx catapult-agent init
            </Typography>
            <Typography variant="caption" color="textSecondary">
              を実行してローカルエージェントを登録すると、手元の開発環境でジョブを実行できます
            </Typography>
          </Box>
        ) : (
          <Box>
            {onlineCount > 0 && (
              <Typography variant="body2" color="success.main" sx={{ mb: 1 }}>
                🟢 {onlineCount} 台がオンライン — ローカル実行が利用可能です
              </Typography>
            )}
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {agents.map((agent) => (
                <Box
                  key={agent.id}
                  sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}
                >
                  <Chip
                    label={agent.status === "ONLINE" ? "ONLINE" : "OFFLINE"}
                    color={agent.status === "ONLINE" ? "success" : "default"}
                    size="small"
                  />
                  <Typography variant="body2">
                    <strong>{agent.name}</strong> — {agent.workspaceRoot}
                  </Typography>
                  {agent.lastHeartbeatAt && (
                    <Typography variant="caption" color="textSecondary">
                      最終確認: {new Date(agent.lastHeartbeatAt).toLocaleString("ja-JP")}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

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
        <AgentStatusCard />
      </CardContent>
    </Card>
  );
};
