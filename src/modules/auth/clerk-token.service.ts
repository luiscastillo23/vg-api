import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import type { ClerkConfig } from '../../config/env.types';
import type { AuthContext } from './types/auth.types';

/**
 * Centralizes Clerk session-token verification so the security-critical
 * options (`authorizedParties`, networkless `jwtKey`) are applied identically
 * by every guard. Verification is networkless when CLERK_JWT_KEY is set,
 * otherwise the JWKS is fetched using the secret key.
 */
@Injectable()
export class ClerkTokenService {
  constructor(private readonly config: ConfigService) {}

  /** Verify a Clerk session token and map its claims. Throws on failure. */
  async verify(token: string): Promise<AuthContext> {
    const clerk = this.config.get<ClerkConfig>('clerk');
    const claims = (await verifyToken(token, {
      jwtKey: clerk?.jwtKey,
      secretKey: clerk?.secretKey,
      authorizedParties: clerk?.authorizedParties,
    })) as { sub: string; sid?: string; org_id?: string };

    return {
      userId: claims.sub,
      sessionId: claims.sid,
      orgId: claims.org_id,
      clerkId: claims.sub,
    };
  }

  /** Extract a Bearer token from an Authorization header value. */
  extractBearerToken(
    authorization?: string | string[],
  ): string | undefined {
    const value = Array.isArray(authorization)
      ? authorization[0]
      : authorization;
    if (!value || !value.startsWith('Bearer ')) return undefined;
    return value.slice('Bearer '.length).trim() || undefined;
  }
}
