import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { LoginAttemptStore } from './login-attempt.store.js';
import { AuthController } from './auth.controller.js';

@Global()
@Module({})
export class AuthModule {
  static register(loginAttemptStore: LoginAttemptStore): DynamicModule {
    return {
      global: true,
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: LoginAttemptStore, useValue: loginAttemptStore },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [AuthService, LoginAttemptStore],
    };
  }
}
