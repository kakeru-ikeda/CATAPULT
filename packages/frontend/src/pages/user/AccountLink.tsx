import { Card, CardContent, Button, Typography, Alert } from "@mui/material";
import { useEffect, useState } from "react";
import { Title, useGetIdentity } from "react-admin";

interface AccountLinkInfo {
  platform: string;
  platformUserId: string;
}

export const AccountLink = () => {
  const { identity } = useGetIdentity();
  const [links, setLinks] = useState<AccountLinkInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    fetch(`${API_URL}/api/auth/me/links`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setLinks(data as AccountLinkInfo[]))
      .catch(() => setError("アカウント連携情報の取得に失敗しました"));
  }, [API_URL]);

  return (
    <Card>
      <Title title="アカウント連携" />
      <CardContent>
        <Typography variant="h6" gutterBottom>
          アカウント連携
        </Typography>
        {identity && (
          <Typography sx={{ mb: 2 }}>
            GitHub: <strong>{identity.fullName}</strong>
          </Typography>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Typography variant="subtitle1" gutterBottom>
          連携済みプラットフォーム
        </Typography>
        {links.length === 0 ? (
          <Typography color="textSecondary">連携なし</Typography>
        ) : (
          links.map((link) => (
            <Typography key={`${link.platform}-${link.platformUserId}`}>
              {link.platform}: {link.platformUserId}
            </Typography>
          ))
        )}
        <Button
          variant="outlined"
          sx={{ mt: 2 }}
          href={`${API_URL}/api/auth/github?redirect=${encodeURIComponent(window.location.origin)}`}
        >
          GitHub と再連携する
        </Button>
      </CardContent>
    </Card>
  );
};
