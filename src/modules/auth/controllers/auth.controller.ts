import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { AuthService } from '../auth.service';

@Controller('webhooks')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Clerk -> backend user mirror sync. Public (authenticated by the Svix
   * signature, not Clerk session). The raw body is preserved by the scoped
   * parser registered in `main.ts`.
   */
  @Post('clerk')
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async clerkWebhook(
    @Req() req: Request,
    @Headers() headers: Record<string, string>,
  ): Promise<{ received: boolean }> {
    const body = req.body as unknown;
    if (typeof body !== 'string' && !Buffer.isBuffer(body)) {
      throw new BadRequestException('Missing raw webhook body');
    }
    return this.authService.handleClerkWebhook(body, headers);
  }
}
