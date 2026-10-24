import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AuthStateRepository } from './auth-state.repository.js';
import { LoginAttemptStore } from './login-attempt.store.js';
import { AuthController } from './auth.controller.js';
import { SecurityModule } from '../security/security.module.js';

@Global()
@Module({
  imports: [SecurityModule],
  controllers: [AuthController],
  providers: [
    AuthStateRepository,
    AuthService,
    { provide: LoginAttemptStore, useFactory: () => new LoginAttemptStore() },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, LoginAttemptStore],
})
export class AuthModule {}
