import { Button, Card, CardContent, Typography, Box } from "@mui/material";
import { useLogin } from "react-admin";

export const LoginPage = () => {
  const login = useLogin();

  const handleLogin = () => {
    void login({});
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
      <Card sx={{ minWidth: 320, background: "#161B27", color: "#e2e8f0" }}>
        <CardContent
          sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, p: 4 }}
        >
          <Typography variant="h5" component="h1" sx={{ color: "#e2e8f0", fontWeight: "bold" }}>
            CATAPULT Admin
          </Typography>
          <Typography variant="body2" sx={{ color: "#8B949E", textAlign: "center" }}>
            GitHub アカウントでログインしてください
          </Typography>
          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={handleLogin}
            sx={{
              background: "#238636",
              "&:hover": { background: "#2ea043" },
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
