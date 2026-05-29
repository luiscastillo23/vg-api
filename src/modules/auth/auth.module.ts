import { Global, Module } from '@nestjs/common';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './auth.service';
import { ClerkTokenService } from './clerk-token.service';
import { OptionalAuthGuard } from './guards/optional-auth.guard';

/**
 * Global auth module. PrismaService (global) and ConfigService (global) are
 * injected without re-importing. `ClerkTokenService` is exported so AppModule
 * can construct the global `ClerkAuthGuard` / `RolesGuard` (bound as APP_GUARD
 * there). `OptionalAuthGuard` is exported for per-route `@UseGuards`.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, ClerkTokenService, OptionalAuthGuard],
  exports: [ClerkTokenService, OptionalAuthGuard],
})
export class AuthModule {}
