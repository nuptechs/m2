import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { verifyJWT, isOIDCConfigured, type OIDCUser } from "./jwt-auth";

// ─── API Key helpers ──────────────────────────────────────────────

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `pk_${crypto.randomBytes(32).toString("hex")}`;
  const prefix = raw.slice(0, 11);
  const hash = hashApiKey(raw);
  return { raw, prefix, hash };
}

// ─── Dual auth middleware ─────────────────────────────────────────
//
// Supports two authentication methods:
//
//   1. API Key:  Authorization: Bearer pk_<hex>
//      → For CI/CD pipelines, webhooks, headless automation.
//      → Validates hash against DB, enforces project scope.
//
//   2. JWT/OIDC: Authorization: Bearer eyJ...
//      → For interactive users authenticated via NuPIdentity (or any OIDC provider).
//      → Validates signature via JWKS, extracts user + permissions.
//
// If no Authorization header is present, the request passes through
// unauthenticated (individual routes can enforce auth as needed).

export function apiAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization as string | undefined;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.slice(7);

  // ── Path 1: API Key (pk_ prefix) ──
  if (token.startsWith("pk_")) {
    const keyHash = hashApiKey(token);

    storage.getApiKeyByHash(keyHash).then((apiKey) => {
      if (!apiKey) {
        return res.status(401).json({ message: "Invalid API key" });
      }

      if (apiKey.projectScope) {
        const projectIdParam = (req.params.projectId || req.params.id) as string | undefined;
        if (projectIdParam && parseInt(projectIdParam) !== apiKey.projectScope) {
          return res.status(403).json({ message: "API key does not have access to this project" });
        }
      }

      storage.updateApiKeyLastUsed(apiKey.id).catch(() => {});

      (req as any).apiKeyAuth = true;
      (req as any).apiKey = apiKey;
      next();
    }).catch(() => {
      res.status(500).json({ message: "Authentication error" });
    });
    return;
  }

  // ── Path 2: JWT/OIDC (eyJ... prefix) ──
  if (token.startsWith("eyJ") && isOIDCConfigured()) {
    verifyJWT(token)
      .then((user: OIDCUser) => {
        (req as any).oidcAuth = true;
        (req as any).oidcUser = user;
        next();
      })
      .catch((err: Error) => {
        res.status(401).json({ message: `Invalid token: ${err.message}` });
      });
    return;
  }

  // Unknown token format — pass through unauthenticated
  next();
}
