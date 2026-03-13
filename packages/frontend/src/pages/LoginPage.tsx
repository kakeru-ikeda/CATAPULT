import { Button, Card, CardContent, Divider, TextField, Typography, Box } from "@mui/material";
import { useState } from "react";
import { useLogin, useNotify } from "react-admin";

export const LoginPage = () => {
  const login = useLogin();
  const notify = useNotify();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleGitHubLogin = () => {
    void login({});
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login({ username, password });
    } catch (err) {
      notify(err instanceof Error ? err.message : "ログインに失敗しました", { type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        background: "#0B0F19",
      }}
    >
      <Card sx={{ minWidth: 360, background: "#161B27", color: "#e2e8f0" }}>
        <CardContent
          sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, p: 4 }}
        >
          <Typography variant="h5" component="h1" sx={{ color: "#e2e8f0", fontWeight: "bold" }}>
            CATAPULT Admin
          </Typography>

          {/* Admin ローカルログイン */}
          <Box
            component="form"
            onSubmit={(e) => void handleAdminLogin(e)}
            sx={{ width: "100%", display: "flex", flexDirection: "column", gap: 2 }}
          >
            <Typography variant="body2" sx={{ color: "#8B949E", textAlign: "center" }}>
              管理者ログイン
            </Typography>
            <TextField
              label="ユーザー名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              size="small"
              fullWidth
              autoComplete="username"
              InputLabelProps={{ style: { color: "#8B949E" } }}
              InputProps={{ style: { color: "#e2e8f0" } }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  "& fieldset": { borderColor: "#30363d" },
                  "&:hover fieldset": { borderColor: "#58a6ff" },
                  "&.Mui-focused fieldset": { borderColor: "#58a6ff" },
                },
              }}
            />
            <TextField
              label="パスワード"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              size="small"
              fullWidth
              autoComplete="current-password"
              InputLabelProps={{ style: { color: "#8B949E" } }}
              InputProps={{ style: { color: "#e2e8f0" } }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  "& fieldset": { borderColor: "#30363d" },
                  "&:hover fieldset": { borderColor: "#58a6ff" },
                  "&.Mui-focused fieldset": { borderColor: "#58a6ff" },
                },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disabled={loading || !username || !password}
              sx={{
                background: "#1f6feb",
                "&:hover": { background: "#388bfd" },
                "&:disabled": { background: "#21262d", color: "#8B949E" },
                textTransform: "none",
                fontWeight: "bold",
              }}
            >
              {loading ? "ログイン中..." : "ログイン"}
            </Button>
          </Box>

          <Divider sx={{ width: "100%", borderColor: "#30363d" }}>
            <Typography variant="caption" sx={{ color: "#8B949E" }}>
              または
            </Typography>
          </Divider>

          {/* GitHub OAuth */}
          <Typography variant="body2" sx={{ color: "#8B949E", textAlign: "center" }}>
            GitHub アカウントでログイン
          </Typography>
          <Button
            variant="outlined"
            size="large"
            fullWidth
            onClick={handleGitHubLogin}
            sx={{
              borderColor: "#238636",
              color: "#3fb950",
              "&:hover": { borderColor: "#2ea043", background: "#238636" + "22" },
              textTransform: "none",
              fontWeight: "bold",
            }}
          >
            GitHub でログイン
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
};
