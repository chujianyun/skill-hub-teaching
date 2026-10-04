import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { type MeResponse, SESSION_COOKIE } from '@skill-hub/shared';
import type { CookieOptions, Response } from 'express';
import { LoginDto } from './auth.dto';
import { AuthService } from './auth.service';
import { Auth, Public } from './decorators';
import { type AuthContext, SESSION_TTL_MS } from './session';
const cookieOptions = (): CookieOptions => ({ httpOnly: true, sameSite: 'lax', secure: process.env.SESSION_COOKIE_SECURE === 'true', path: '/' });
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post('login') @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { token } = await this.auth.login(dto.phone, dto.password);
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
    return { ok: true };
  }
  @Post('logout') @HttpCode(204)
  async logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(auth.sessionId);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
  }
  @Get('me')
  me(@Auth() auth: AuthContext): Promise<MeResponse> { return this.auth.me(auth); }
}
