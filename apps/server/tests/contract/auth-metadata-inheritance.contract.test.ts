import 'reflect-metadata';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get, SetMetadata } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthGuard } from '../../src/core/auth/auth.guard.js';
import { AuthService } from '../../src/core/auth/auth.service.js';
import { IS_PUBLIC_ROUTE, Public } from '../../src/core/auth/public.decorator.js';
import { RUNTIME_CONFIG } from '../../src/core/config/runtime-config.tokens.js';
import { GlobalExceptionFilter } from '../../src/core/errors/global-exception.filter.js';

@Public()
class PublicClassBase {
  @Get('inherited')
  inherited() {
    return { success: true };
  }

  @Get('protected')
  @SetMetadata(IS_PUBLIC_ROUTE, false)
  protected() {
    return { success: true };
  }
}
@Controller('class-inherited')
class ClassInheritedController extends PublicClassBase {
  @Get('own')
  own() {
    return { success: true };
  }
}
@Controller('class-reprotected')
@SetMetadata(IS_PUBLIC_ROUTE, false)
class ClassReprotectedController extends PublicClassBase {}

class MethodBase {
  @Get('public')
  @Public()
  public() {
    return { success: true };
  }

  @Get('protected')
  protected() {
    return { success: true };
  }
}
@Controller('method-inherited')
class MethodInheritedController extends MethodBase {}
@Controller('method-overridden')
class MethodOverriddenController extends MethodBase {
  @Get('public')
  override public() {
    return { success: true };
  }
}

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

it('applies inherited public metadata, explicit false overrides, and protected sibling/overridden handlers through real HTTP', async () => {
  const authenticateRequest = vi.fn((request: { headers: Record<string, unknown> }) => {
    const key = request.headers['x-api-key'];
    return key === 'fixture'
      ? { authenticated: true as const }
      : {
          authenticated: false as const,
          errorType: key ? ('invalid_api_key' as const) : ('no_auth' as const),
        };
  });
  const module = await Test.createTestingModule({
    controllers: [
      ClassInheritedController,
      ClassReprotectedController,
      MethodInheritedController,
      MethodOverriddenController,
    ],
    providers: [
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: AuthService, useValue: { authenticateRequest } },
      { provide: RUNTIME_CONFIG, useValue: { auth: { disabled: false } } },
    ],
  }).compile();
  app = module.createNestApplication({ logger: false });
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const request = async (route: string, key?: string) => {
    const response = await fetch(`${origin}/${route}`, {
      headers: key ? { 'x-api-key': key } : {},
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    return { status: response.status, body };
  };
  for (const route of [
    'class-inherited/inherited',
    'class-inherited/own',
    'method-inherited/public',
  ])
    expect((await request(route)).status, route).toBe(200);
  expect(authenticateRequest).not.toHaveBeenCalled();

  for (const route of [
    'class-inherited/protected',
    'class-reprotected/inherited',
    'class-reprotected/protected',
    'method-inherited/protected',
    'method-overridden/public',
    'method-overridden/protected',
  ]) {
    expect(await request(route), route).toMatchObject({
      status: 401,
      body: { success: false, errorCode: 'UNAUTHORIZED' },
    });
    expect((await request(route, 'wrong')).status, route).toBe(403);
    expect((await request(route, 'fixture')).status, route).toBe(200);
  }
  expect(authenticateRequest).toHaveBeenCalledTimes(18);
});

it('keeps the reviewed public production inventory free of controller inheritance', async () => {
  const root = fileURLToPath(new URL('../../src/', import.meta.url));
  async function controllers(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((entry) => {
          const target = path.join(directory, entry.name);
          return entry.isDirectory()
            ? controllers(target)
            : entry.name.endsWith('.controller.ts')
              ? [target]
              : [];
        })
      )
    ).flat();
  }
  const publicRoutes: string[] = [];
  for (const file of await controllers(root)) {
    const source = ts.createSourceFile(
      file,
      await fs.readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    for (const node of source.statements) {
      if (!ts.isClassDeclaration(node)) continue;
      // Inventory generation inspects declared decorators. An inherited controller must be
      // reviewed deliberately rather than silently expanding the unauthenticated surface.
      expect(node.heritageClauses ?? [], path.relative(root, file)).toHaveLength(0);
      const hasPublic = (target: ts.ClassDeclaration | ts.MethodDeclaration) =>
        (ts.getDecorators(target) ?? []).some(
          (decorator) =>
            ts.isCallExpression(decorator.expression) &&
            decorator.expression.expression.getText(source) === 'Public'
        );
      const name = node.name?.text;
      if (hasPublic(node)) publicRoutes.push(`${name}.*`);
      for (const member of node.members)
        if (ts.isMethodDeclaration(member) && hasPublic(member))
          publicRoutes.push(`${name}.${member.name.getText(source)}`);
    }
  }
  expect(publicRoutes.sort()).toEqual([
    'AuthController.login',
    'AuthController.logout',
    'AuthController.status',
    'HealthController.environment',
    'HealthController.index',
    'HealthController.live',
    'HealthController.ready',
    'SetupController.*',
  ]);
});
