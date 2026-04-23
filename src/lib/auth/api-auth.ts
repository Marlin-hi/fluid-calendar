import { createHash } from "crypto";

import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const LOG_SOURCE = "APIAuth";

function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function authenticateBearer(
  request: NextRequest,
  logSource: string
): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
  const raw = header.slice(7).trim();
  if (!raw.startsWith("fct_")) return null;

  const tokenHash = hashApiToken(raw);
  const apiToken = await prisma.apiToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!apiToken || apiToken.revokedAt) return null;

  prisma.apiToken
    .update({ where: { id: apiToken.id }, data: { lastUsedAt: new Date() } })
    .catch((error) => {
      logger.warn(
        "Failed to update apiToken.lastUsedAt",
        { error: error instanceof Error ? error.message : "Unknown error" },
        logSource
      );
    });

  return apiToken.userId;
}

/**
 * Authenticates a request and returns the user ID if authenticated
 * @param request The NextRequest object
 * @param logSource The source for logging
 * @returns An object with userId if authenticated, or a NextResponse if unauthorized
 */
export async function authenticateRequest(
  request: NextRequest,
  logSource: string
) {
  const bearerUserId = await authenticateBearer(request, logSource);
  if (bearerUserId) return { userId: bearerUserId };

  // Get the user token from the request
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // If there's no token, return unauthorized
  if (!token) {
    logger.warn("Unauthorized access attempt to API", {}, logSource);
    return { response: new NextResponse("Unauthorized", { status: 401 }) };
  }

  const userId = token.sub;
  if (!userId) {
    logger.warn("No user ID found in token", {}, logSource);
    return { response: new NextResponse("Unauthorized", { status: 401 }) };
  }

  return { userId };
}

/**
 * Middleware to ensure a user is authenticated for API routes
 * @param req The Next.js request object
 * @returns A response if authentication fails, or null if authentication succeeds
 */
export async function requireAuth(
  req: NextRequest
): Promise<NextResponse | null> {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    if (!token) {
      logger.warn(
        "Unauthenticated API access attempt",
        { path: req.nextUrl.pathname },
        LOG_SOURCE
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return null; // Authentication successful
  } catch (error) {
    logger.error(
      "Error in API authentication",
      {
        error: error instanceof Error ? error.message : "Unknown error",
        path: req.nextUrl.pathname,
      },
      LOG_SOURCE
    );

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Middleware to ensure a user is an admin for API routes
 * @param req The Next.js request object
 * @returns A response if authorization fails, or null if authorization succeeds
 */
export async function requireAdmin(
  req: NextRequest
): Promise<NextResponse | null> {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    if (!token) {
      logger.warn(
        "Unauthenticated admin API access attempt",
        { path: req.nextUrl.pathname },
        LOG_SOURCE
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (token.role !== "admin") {
      logger.warn(
        "Non-admin user attempted to access admin API",
        { userId: token.sub ?? "unknown", path: req.nextUrl.pathname },
        LOG_SOURCE
      );

      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return null; // Authorization successful
  } catch (error) {
    logger.error(
      "Error in API admin authorization",
      {
        error: error instanceof Error ? error.message : "Unknown error",
        path: req.nextUrl.pathname,
      },
      LOG_SOURCE
    );

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
