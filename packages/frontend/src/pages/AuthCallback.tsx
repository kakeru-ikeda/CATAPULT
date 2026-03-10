import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export const AuthCallback = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const role = params.get("role");

    if (token && role) {
      localStorage.setItem("token", token);
      localStorage.setItem("role", role);
      void navigate("/", { replace: true });
    } else {
      void navigate("/login", { replace: true });
    }
  }, [navigate]);

  return <div>認証処理中...</div>;
};
