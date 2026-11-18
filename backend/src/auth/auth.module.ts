import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../common/env';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OidcAdapter } from './oidc.adapter';

@Global()
@Module({
  imports: [JwtModule.register({ secret: env.jwtSecret, signOptions: { algorithm: 'HS256' } })],
  providers: [AuthService, OidcAdapter, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
