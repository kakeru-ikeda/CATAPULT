import type { AuthProvider } from "react-admin";

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  import.meta.env.BASE_URL.replace(/\/$/, "");

export const authProvider: AuthProvider = {
  login: async (params: { username?: string; password?: string } = {}) => {
    // ローカル Admin ログイン（ID/パスワードが渡された場合）
    if (params.username !== undefined && params.password !== undefined) {
      const response = await fetch(`${API_URL}/api/auth/admin-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: params.username, password: params.password }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Login failed");
      }
      const data = (await response.json()) as { token: string; role: string };
      localStorage.setItem("token", data.token);
      localStorage.setItem("role", data.role);
      return;
    }
    // GitHub OAuth フロー
    window.location.href = `${API_URL}/api/auth/github?redirect=${encodeURIComponent(window.location.origin)}`;
  },

  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    return Promise.resolve();
  },

  checkAuth: () => {
    const token = localStorage.getItem("token");
    if (!token) return Promise.reject(new Error("Not authenticated"));
    return Promise.resolve();
  },

  checkError: (error: { status?: number }) => {
    if (error.status === 401 || error.status === 403) {
      localStorage.removeItem("token");
      return Promise.reject(new Error("Session expired"));
    }
    return Promise.resolve();
  },

  getPermissions: () => {
    return Promise.resolve(localStorage.getItem("role") ?? "USER");
  },

  getIdentity: async () => {
    const response = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
    });
    if (!response.ok) throw new Error("Failed to fetch identity");
    const user = (await response.json()) as {
      id: string;
      githubUsername: string;
      githubAvatarUrl?: string;
    };
    return {
      id: user.id,
      fullName: user.githubUsername,
      avatar: user.githubAvatarUrl,
    };
  },
};
