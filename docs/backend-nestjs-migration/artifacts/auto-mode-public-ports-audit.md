# AutoMode: явная публичная граница Nest-модуля

Дата: 2026-10-25. Срез wave23 после checkpoint `67948aa8`.

## Реализованная граница

`AutoModeModule` экспортирует три типизированных токена из
`apps/server/src/modules/auto-mode/auto-mode.ports.ts`:

| Токен                    | Потребители                                                                                     | Назначение                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `FEATURE_RUN_READ_MODEL` | GitApplicationService, WorktreeApplicationService, RunningAgentsService, ProjectOverviewService | Проверка занятости проекта, список активных feature-run, статус проекта |
| `FEATURE_ORPHAN_QUERY`   | FeatureQueryService                                                                             | Поиск orphaned features                                                 |
| `AUTO_MODE_LIFECYCLE`    | ApplicationRuntimeLifecycle                                                                     | Startup reconciliation, закрытие admission и остановка                  |

Внутри модуля `AutoModeApplicationService` использует `AUTO_MODE_SCHEDULER`,
`FEATURE_WORKFLOW` и lifecycle-порт для восстановления. Первые два токена не
экспортируются Nest-модулем. ProjectAnalysisService сохраняет собственный
существующий factory и lifecycle.

Все пять провайдеров используют `useExisting: AutoModeServiceCompat`. Это один
существующий владелец с теми же ProjectRunContextRegistry, shared services и drain,
а не пять объектов с копиями методов. Nest исключает alias wrappers при вызове
lifecycle hooks. `satisfies` проверяет соответствие каждого интерфейса реализации
при компиляции и не создаёт runtime-обёртку.

Класс Compat остаётся plain внутренней реализацией и сохраняет standalone API и
старые constructor fixtures. Его runtime export из AutoModeModule удалён.
Название класса само по себе не означает наличие второго legacy runtime.
Тестовый `app.get(AutoModeServiceCompat)` остаётся возможным через глобальный поиск
Nest: порты задают архитектурную границу, а не sandbox или механизм авторизации.

## Автоматическая защита

ESLint `auto-mode-boundaries/public-ports` применяется к `src/core/**/*.ts` и
`src/modules/**/*.ts`. Runtime import/re-export/namespace import владельца,
facade, global-service и barrel запрещён, включая dynamic import и require.
Вычисляемая загрузка модулей отклоняется, поскольку её цель нельзя проверить
статически. Type-only ссылки разрешены. Только существующие
`auto-mode.module.ts` и `auto-mode.provider.ts` являются точками сборки.
Остальные архитектурные правила сохранены.

Negative fixtures проверяют оба consumer scope, re-export, dynamic import,
require, вычисляемую цель и разрешённые type-only/port imports. Исключения сборки
не отключают guards на process.env и legacy routes.

## Проверки и свидетельства

Команды выполнялись из корня репозитория с Node из
`/home/user/.npm/_npx/ca3942424f2c6fc5/node_modules/node/bin` в PATH.

- `node --test scripts/tests/server-architecture-rules.test.mjs`: 22/22 PASS;
  `/tmp/automaker-wave23-public-ports-architecture.log`.
- `npm exec --workspace=apps/server -- vitest run` с шестью выбранными unit-файлами
  AutoMode application, Git, Worktree, feature query, running agents и application
  lifecycle: 25/25 PASS; `/tmp/automaker-wave23-ports-unit.log`.
- `npm exec --workspace=apps/server -- vitest run --config vitest.contract.config.ts`
  с `auto-mode-public-ports`, `native-runtime-composition`, `auto-mode-responses`,
  `feature-execution-correlation` и `merge-ssh-feature`: 18/18 PASS;
  `/tmp/automaker-wave23-ports-contract-final.log`.
- Scoped ESLint на изменённых production/test файлах: exit 0;
  `/tmp/automaker-wave23-ports-lint.log`. Полный lint `src/core src/modules`: 0 errors,
  две существующие unused-catch warnings в provider-usage.service.ts;
  `/tmp/automaker-wave23-ports-boundary-lint.log`.
- Первоначальный `tsc --noEmit` после port plumbing: exit 0;
  `/tmp/automaker-wave23-ports-tsc.log`. Повторная глобальная проверка во время
  параллельной extraction выявила отсутствующий `IdeationService.getCategoryDescription`
  (строка 959), вне данного среза; root уведомлён. Лог повторной проверки:
  `/tmp/automaker-wave23-ports-tsc-final.log`.

Новый native contract создаёт два настоящих Nest-приложения с отдельными
временными roots, пустым provider registry и loopback port 0. Он проверяет actual
Nest alias wrappers, точный набор exports, identity семи consumer injections,
разные owners между приложениями, реальный feature lease и authenticated HTTP
`/api/running-agents`. При успешной остановке и инъекции ошибки cleanup владелец
уничтожается ровно один раз до filesystem barrier; повторные вызовы close
сохраняют результат/идентичность ошибки, sibling-приложение продолжает работать.
Проверка не запускает платный model query. Публичный logging proxy может возвращать
разные Promise-обёртки, поэтому проверяется общий outcome и однократный drain.

## Ограничения среза

Это граница семи native consumers, а не утверждение о разделении всей внутренней
реализации AutoMode на application/domain слои. Standalone compatibility и
внутренние service зависимости не удаляются данным изменением.

Первый расширенный targeted run также обнаружил старую проверку немедленного
restart при незавершённом provider cleanup (`auto-mode-native.contract.test.ts`,
ожидание второго вызова provider на строке 263). Её семантика пересекается с
параллельным wave23 durable-uncertainty изменением; результат передан владельцу
этого изменения и root. Этот run не считается зелёным доказательством данного
поведения. Его лог: `/tmp/automaker-wave23-ports-contract.log`.

Первый новый fixture ошибочно ожидал filesystem hook `onModuleDestroy`; исправлен
на фактический `beforeApplicationShutdown`. Также исправлено ожидание identity
Promise публичного logging proxy, сохранив проверку cached failure и однократного
cleanup. Финальный targeted run выше прошёл без unhandled rejections.
