import type { AuthProvider } from "react-admin";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export const authProvider: AuthProvider = {
  login: async () => {
    window.location.href = `${API_URL}/api/auth/github?redirect=${encodeURIComponent(window.location.origin)}`;
    return Promise.resolve();
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
