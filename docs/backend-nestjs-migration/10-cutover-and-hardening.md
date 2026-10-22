# Этап 10. Cutover и production hardening

## Цель

Удалить legacy composition, закрыть временные compatibility layers и доказать,
что Nest backend пригоден для production во всех поддерживаемых режимах запуска.

## 10.1. Legacy removal

- [ ] Route inventory показывает Nest owner для каждого endpoint.
- [ ] Удалить legacy router module/middleware.
- [ ] Удалить Express route factories и неиспользуемые common helpers.
- [ ] Удалить старый `src/index.ts` из production build.
- [ ] Удалить wrapper providers, которые только выдавали legacy instances.
- [ ] Удалить singleton getters и side-effect registration.
- [ ] Удалить временные feature flags/route ownership registry.
- [ ] Проверить отсутствие imports из удалённых paths.

Express остаётся transitive platform через `@nestjs/platform-express`; удаляется
ручная Express composition, а не сам adapter.

## 10.2. Dependency rules

Добавить CI/ESLint checks:

- controllers не импортируются services/providers;
- domain/application не импортирует Nest/Express;
- modules не обходят public exports соседнего модуля;
- providers не импортируют routes;
- нет прямого `process.env` вне config bootstrap;
- нет module-level service instances;
- нет shell execution в controllers;
- нет циклических module imports без утверждённого ADR.

## 10.3. Production configuration

- [ ] Fail-fast validation обязательных variables.
- [ ] Корректные proxy/trust settings для web deployments.
- [ ] CORS allowlist и private-network behavior.
- [ ] Cookie secure/same-site policy по deployment mode.
- [ ] Request/body/download limits.
- [ ] WebSocket origin/auth policy.
- [ ] Secrets redaction и file permissions.
- [ ] Liveness/readiness probes.
- [ ] Graceful shutdown в Docker stop timeout.

## 10.4. Performance

- [ ] Сравнить startup/RSS/latency с baseline.
- [ ] Проверить large feature lists, event streams и terminal output.
- [ ] Проверить provider streaming без двойной serialization.
- [ ] Найти случайные request-scoped heavy dependencies.
- [ ] Проверить file descriptors и child processes после repeated workflows.
- [ ] Установить budgets и regression thresholds в CI/benchmark job.

## 10.5. Security review

- [ ] Auth bypass на public metadata и route inheritance.
- [ ] Path traversal/symlink/remote alias boundary.
- [ ] CSRF/content-type/cookie behavior.
- [ ] WebSocket token reuse и expiry.
- [ ] Command injection в Git/provider/execution paths.
- [ ] SSRF через preview/MCP/provider endpoints.
- [ ] Secret leakage в DTO, exceptions и logs.
- [ ] Cleanup ownership Docker/SSH/PTY resources.

## 10.6. Packaging acceptance

### Standalone/Web

- setup/login/project/board/agent/terminal smoke;
- restart/recovery;
- production build without dev dependencies.

### Docker

- clean install and upgrade with existing data volume;
- health/readiness;
- SIGTERM shutdown;
- no permission regression.

### Electron

- server bundle install;
- native `node-pty` rebuild;
- dynamic port/startup detection;
- app close cleanup;
- packaged macOS/Windows/Linux smoke where runners are available.

## 10.7. Rollout plan

1. Internal development artifact.
2. Automated migration/contract suite.
3. Canary with copied non-sensitive project data.
4. Opt-in prerelease channel.
5. Staged production release.
6. Monitoring window без удаления rollback artifact.
7. Объявление завершения после успешного upgrade/restart/Electron evidence.

Storage migrations должны быть backward-readable либо сопровождаться backup и
отдельным downgrade warning. Nest cutover сам по себе не требует изменения storage.

## 10.8. Документация

- [ ] README commands и prerequisites.
- [ ] Backend module architecture.
- [ ] Добавление controller/provider/module.
- [ ] Contracts и error format.
- [ ] Config/environment reference.
- [ ] Testing tiers.
- [ ] WebSocket protocols.
- [ ] Startup/shutdown lifecycle.
- [ ] Electron/Docker packaging.
- [ ] Troubleshooting и rollback.

## Exit criteria

- Legacy bridge и production legacy entrypoint удалены.
- Полная test/packaging/security matrix проходит.
- Нет необъяснённой performance/resource regression.
- Upgrade существующей установки подтверждён.
- Rollback procedure проверена на staging.
- Operations/development documentation соответствует коду.
- Финальный checkpoint этапа 10 успешно выполнен для Web, Docker и Electron;
  результаты зафиксированы завершающим cutover-коммитом в migration-ветке.
