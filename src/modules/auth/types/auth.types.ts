import type { UserModel } from '../../../../generated/prisma/models';

/**
 * Verified Clerk session claims attached to `req.auth` by ClerkAuthGuard /
 * OptionalAuthGuard. Sourced from the JWT payload — NEVER trusted for roles.
 */
export interface AuthContext {
  /** Clerk user id (the JWT `sub` claim). Equal to `clerkId`. */
  userId: string;
  /** Clerk session id (the JWT `sid` claim), if present. */
  sessionId: string | undefined;
  /** Active Clerk organization id (the JWT `org_id` claim), if any. */
  orgId: string | undefined;
  /** Clerk user id, used to resolve the local User mirror. */
  clerkId: string;
}

/** Local User mirror attached to `req.user` and consumed by `@CurrentUser()`. */
export type AuthenticatedUser = UserModel;

/** Express request augmented by the auth guards. */
export interface RequestWithAuth {
  headers: Record<string, string | string[] | undefined>;
  auth?: AuthContext;
  user?: AuthenticatedUser;
}
