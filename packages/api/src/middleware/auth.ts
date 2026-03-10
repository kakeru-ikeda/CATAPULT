import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export interface AuthUser {
  id: string;
  role: "ADMIN" | "USER";
  githubUsername: string;
}

declare module "express" {
  interface Request {
    user?: AuthUser;
  }
}

function getJwtSecret(): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

export function issueJwt(user: AuthUser): string {
  return jwt.sign(user, getJwtSecret(), { expiresIn: "7d" });
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers["authorization"];
  const tokenFromQuery = req.query["token"];

  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : typeof tokenFromQuery === "string"
      ? tokenFromQuery
      : null;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as AuthUser;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
