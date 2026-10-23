import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AuthStateRepository } from './auth-state.repository.js';
import { LoginAttemptStore } from './login-attempt.store.js';
import { AuthController } from './auth.controller.js';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthStateRepository,
    AuthService,
    { provide: LoginAttemptStore, useExisting: LEGACY_SERVICES.loginAttemptStore },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, LoginAttemptStore],
})
export class AuthModule {}
