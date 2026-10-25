# Полный перенос backend Automaker на NestJS

Обновлено: 2026-10-25. Текущий фокус — завершение этапов 7–10 и оставшихся
application/infra границ этапа 11. Результаты возобновлённой работы собраны
в [первом checkpoint](artifacts/resumed-goal-checkpoint.md) и последующем
[native cutover checkpoint](artifacts/native-cutover-checkpoint.md).
Последующий проверенный срез: [run ownership, providers и filesystem](artifacts/run-ownership-provider-filesystem-checkpoint.md).
Следующий проверенный срез: [verification, legacy import, Gemini и performance](artifacts/verification-import-gemini-performance-checkpoint.md).
Текущий checkpoint: [planning, ideation и singleton retirement](artifacts/planning-ideation-singletons-checkpoint.md).
Следующий checkpoint: [feature storage, metrics и production artifact](artifacts/feature-storage-metrics-artifact-checkpoint.md).
Предыдущий checkpoint: [state transactions, execution filesystem и core contracts](artifacts/state-execution-contract-checkpoint.md).
Предыдущий checkpoint: [agent storage, recovery и session contracts](artifacts/agent-storage-recovery-session-checkpoint.md).
Предыдущий checkpoint: [native stores, terminal cleanup и retired routes](artifacts/native-stores-terminal-cleanup-checkpoint.md).
Предыдущий checkpoint: [source ports и service locator retirement](artifacts/source-ports-and-locators-checkpoint.md).
Предыдущий checkpoint: [owned local processes и response contracts](artifacts/owned-process-response-checkpoint.md).
Предыдущий checkpoint: [template lifecycle, contract coverage и route retirement](artifacts/template-coverage-retirement-checkpoint.md).
Предыдущий checkpoint: [preview configuration, planning/settings contracts и pipeline retirement](artifacts/preview-planning-settings-pipeline-checkpoint.md).
Предыдущий checkpoint: [execution settings, AutoMode, integrations и usage contracts](artifacts/environment-automode-integrations-usage-checkpoint.md).
Предыдущий checkpoint: [все JSON response schemas](artifacts/json-response-coverage-checkpoint.md).
Предыдущий checkpoint: [transport contexts, binary contracts, terminal и workflow metrics](artifacts/transport-context-terminal-observability-checkpoint.md).
Предыдущий checkpoint: [полное удаление legacy routes, native characterization и logging ownership](artifacts/legacy-retirement-logging-checkpoint.md).
Проверенный artifact checkpoint: [Docker/Linux Electron и private upgrade/rollback](artifacts/current-artifact-acceptance-checkpoint.md).
Предыдущий source checkpoint: [Local runtime snapshot и HTTP error codes](artifacts/local-runtime-http-errors-checkpoint.md).
Предыдущий source checkpoint: [FSM ownership, Direct path policy и Dev/Test environment](artifacts/fsm-direct-policy-process-checkpoint.md).
Последний source checkpoint: [MCP, checkpoints и correlation](artifacts/mcp-checkpoints-correlation-checkpoint.md).
Полная миграция ещё не завершена; checklist и результаты проверок ведутся
в документах соответствующих этапов.

## Цель

Перевести `apps/server` с ручной композиции Express на NestJS, сохранив внешний
HTTP/WebSocket API, файловый формат `.automaker/`, поддержку Web/Electron/Docker,
все AI-провайдеры и среды выполнения Local/Docker/SSH/Memory.

Миграция выполняется как переход модульного монолита, а не как одномоментная
перепись. NestJS сначала становится новым composition root поверх Express,
после чего старые route groups удаляются по одному. Глубокое изменение бизнес-
логики выполняется только после стабилизации соответствующего Nest-модуля.

## Исходная точка

- 305 зарегистрированных HTTP endpoints по автоматически проверяемому inventory;
- два raw WebSocket endpoint: `/api/events` и `/api/terminal/ws`;
- 133 серверных test/spec files;
- примерно 28 тысяч строк в `src/routes`, 35 тысяч в `src/services` и 19 тысяч
  в `src/providers`, `src/lib` и middleware;
- ручное создание зависимостей в `apps/server/src/index.ts`;
- несколько module-level singleton и `get*Service()` factories;
- долгоживущее состояние агентов, терминалов, тестов, dev servers и pipelines;
- прямое чтение `process.env` во многих модулях;
- файловое хранение без базы данных;
- сервер собирается отдельно и включается в Electron bundle.

Перед первым migration commit необходимо починить существующий UI typecheck и получить
воспроизводимый результат server unit suite. Это не часть Nest-переноса, а условие
достоверного baseline.

## Принятые решения

1. Целевая версия — NestJS 12 с `@nestjs/platform-express`.
2. Проект остаётся ESM/NodeNext и продолжает использовать Vitest.
3. Минимальная версия Node фиксируется не ниже `22.22.3`; текущий локальный
   `22.22.2` недостаточен для Nest 12 CLI.
4. Переход на Fastify, микросервисы, БД, CQRS и новый публичный API не входят в scope.
5. Старый и новый backend не запускаются как два независимых владельца одних
   мутаций. В каждый момент конкретный route group обслуживает только одна реализация.
6. API compatibility важнее «идеального» Nest API на промежуточных этапах.
7. Controllers остаются тонкими; бизнес-правила не переносятся в decorators,
   guards или interceptors.
8. Default singleton scope используется для stateful services; request scope
   разрешается только с отдельным обоснованием.
9. Raw WebSocket wire protocol сохраняется до появления compatibility tests.
10. Вся миграция выполняется в одной ветке `refactor/backend-nestjs-migration`.
    Отдельные ветки и обязательные PR для миграции не создаются; работа сохраняется
    последовательными небольшими коммитами.
11. Каждый этап завершается обязательным тестовым checkpoint и фиксирующим коммитом.
    Переход к следующему этапу разрешён только после успешного checkpoint.

## Этапы

| №   | Этап                                                                    | Основной результат                                     | Оценка     |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------ | ---------- |
| 0   | [Инвентаризация и архитектурные решения](00-inventory-and-decisions.md) | Зафиксированы контракты, границы и ADR                 | 1–2 недели |
| 1   | [Baseline и contract tests](01-baseline-and-contracts.md)               | Текущий backend надёжно характеризован тестами         | 1–2 недели |
| 2   | [Nest shell и legacy bridge](02-nest-shell-and-legacy-bridge.md)        | Процесс стартует через Nest без смены поведения        | 1–2 недели |
| 3   | [Core platform](03-core-platform.md)                                    | Config, auth, errors, security, lifecycle и event bus  | 2–3 недели |
| 4   | [Периферийные HTTP-модули](04-edge-http-modules.md)                     | Первые route groups полностью удалены из legacy        | 2–3 недели |
| 5   | [Проектные данные и workflow](05-project-domain-modules.md)             | Settings, projects, files, features, sessions и specs  | 4–6 недель |
| 6   | [Execution, Git и worktrees](06-execution-git-worktrees.md)             | Среды выполнения и Git изолированы за портами          | 5–7 недель |
| 7   | [AI providers и agents](07-providers-and-agents.md)                     | Provider registry и агентские сессии работают через DI | 4–6 недель |
| 8   | [Оркестрация и интеграции](08-orchestration-and-integrations.md)        | Auto mode, pipelines, ideation, GitHub и MCP           | 4–6 недель |
| 9   | [WebSocket и terminal](09-websockets-and-terminal.md)                   | Оба WS-протокола принадлежат Nest lifecycle            | 3–4 недели |
| 10  | [Cutover и production hardening](10-cutover-and-hardening.md)           | Legacy Express composition удалён                      | 2–3 недели |
| 11  | [Post-migration refactor](11-post-migration-refactor.md)                | Разделены god services и усилены границы               | 3–6 недель |

Оценки указаны в инженерных неделях и частично допускают параллельную работу.
Для команды из 2–3 разработчиков реалистичный календарный диапазон полного
переноса — 13–19 недель до cutover и ещё 3–6 недель на глубокий рефакторинг.

## Зависимости этапов

```text
0 Инвентаризация
└── 1 Baseline и контракты
    └── 2 Nest shell
        └── 3 Core platform
            ├── 4 Edge HTTP
            └── 5 Project domain
                └── 6 Execution/Git
                    └── 7 Providers/Agents
                        └── 8 Orchestration/Integrations
                            └── 9 WebSocket/Terminal
                                └── 10 Cutover
                                    └── 11 Deep refactor
```

Этап 4 можно выполнять параллельно с поздней частью этапа 3. Внутреннюю
декомпозицию чистых сервисов можно делать раньше этапа 11 только тогда, когда
она не меняет наблюдаемое поведение и покрыта characterization tests.

## Целевая структура

```text
apps/server/src/
├── main.ts
├── app.module.ts
├── core/
│   ├── auth/
│   ├── config/
│   ├── errors/
│   ├── lifecycle/
│   ├── logging/
│   └── security/
├── eventing/
├── modules/
│   ├── settings/
│   ├── projects/
│   ├── files/
│   ├── features/
│   ├── execution/
│   ├── git/
│   ├── worktrees/
│   ├── providers/
│   ├── agents/
│   ├── orchestration/
│   └── integrations/
└── legacy/                    # существует только до этапа 10
```

Для сложного модуля используется направление зависимостей:

```text
api/controller -> application/use-case -> domain port -> infrastructure adapter
```

`common` не должен превращаться в склад произвольных функций. Код помещается
туда только если он действительно используется несколькими несвязанными модулями.

## Git workflow и тестовые checkpoints

Для всей программы используется единственная ветка (если она уже создана,
работа продолжается в ней):

```text
refactor/backend-nestjs-migration
```

- Все подготовительные, migration, cleanup, test и documentation commits, а также
  исправления после тестирования делаются только в этой ветке.
- Не создаются отдельные feature branches или stage branches. Отдельный PR не
  является требованием ни для этапа, ни для route group, ни для завершения миграции.
- Коммиты должны оставаться небольшими и тематическими, но не обязаны соответствовать
  одному route group или одному файлу.
- Изменения из основной ветки при необходимости интегрируются в migration-ветку
  контролируемым merge/rebase с повторным полным checkpoint текущего этапа.
- Откат выполняется до последнего успешно протестированного stage checkpoint либо
  предыдущего production artifact.
- После завершения этапа обновляются checklist и статус соответствующего документа,
  затем создаётся фиксирующий commit вида `chore(nest-migration): complete stage N`.

Эти правила обязательны для всех документов этапов 0–11. Единица сдачи этапа —
проверенное состояние в общей ветке и записанные результаты тестирования, а не
отдельный PR. Упоминания создания и обработки PR в GitHub/Git-модулях описывают
функциональность приложения и не вводят требования к организации миграции.

Единый порядок завершения каждого этапа:

```text
Изменения в refactor/backend-nestjs-migration
  → обязательное тестирование после этапа
  → запись команд и результатов в документ этапа
  → фиксирующий коммит в той же ветке
  → следующий этап
```

При неуспешных проверках следующий этап не начинается: исправления и повторное
тестирование выполняются в этой же ветке. Создание, согласование или слияние
отдельного PR не входят в критерии завершения ни одного этапа.

Обязательный checkpoint после каждого этапа включает:

1. Форматирование, lint и typecheck всего monorepo.
2. Сборку shared packages и server production artifact.
3. Все быстрые unit и HTTP/WS contract tests.
4. Stage-specific integration tests, перечисленные в документе этапа.
5. Проверку startup/shutdown и отсутствия незакрытых handles/resources.
6. Web smoke; начиная с изменения packaging — Docker и Electron smoke.
7. Обновление route inventory, migration checklist и известных ограничений.

На одном host сначала завершать Docker и другие acceptance, создающие/удаляющие
сетевые interfaces, и только затем запускать Chromium. В предыдущих параллельных
запусках зафиксирован `net::ERR_NETWORK_CHANGED` при загрузке UI modules; сам
источник конкретного OS notification ещё не доказан. Это правило изоляции runner,
не основание скрывать ошибку или увеличивать browser timeout/retries. Независимые
unit/build проверки можно выполнять параллельно. Для production HTML/module
recovery предусмотрен `npm run test:ui:bootstrap`; его fixture не использует
реальный backend или vendor services. Детали — в срезе bootstrap recovery этапа 10.

Это правило распространяется на все этапы 0–11, включая подготовку и финальный
рефакторинг. В документе этапа фиксируются команды проверок, результаты и причины
пропусков. Пропущенная обязательная проверка не считается успешно пройденной.

Если checkpoint не прошёл, этап не отмечается завершённым, фиксирующий commit не
создаётся и работа не переходит к следующему этапу. Промежуточные коммиты допустимы,
но последний commit завершённого этапа всегда соответствует зелёному checkpoint.
Исправления выполняются в той же ветке; после них checkpoint этапа запускается
повторно. Открытие или слияние PR не заменяет тестирование и не является условием
перехода к следующему этапу.

## Общие правила выполнения

- Не совмещать перенос route group с изменением его HTTP-контракта.
  Явное исключение — versioned safety gate connection changes из этапа 7.6 / ADR-009/010:
  обязательное подтверждение target вводится вместе с native command и обновлением
  всех HTTP clients, без совместимого обхода проверки для старого request body.
- Не добавлять новые прямые зависимости на Express вне legacy bridge.
- Не добавлять новые чтения `process.env`, `process.cwd()` и module-level singleton.
- Не переносить файловые/Git операции в controller.
- Не скрывать Local fallback при ошибке Docker/SSH.
- Не повторять автоматически команды с неизвестным результатом.
- Не запускать настоящий provider, Docker mutation или SSH setup в unit suite.
- На каждый модуль должны существовать owner, rollback и migration checklist.
- После переноса route group его legacy implementation удаляется в том же этапе:
  в основном migration commit либо в непосредственно следующем cleanup commit.

## Общий Definition of Done

- [x] Все коммиты миграции находятся в одной ветке `refactor/backend-nestjs-migration`;
      отдельные PR не требуются.
- [ ] После каждого этапа 0–11 выполнен успешный тестовый checkpoint; команды
      и результаты записаны в документ соответствующего этапа.
- [x] Все HTTP routes обслуживаются Nest controllers.
- [x] Оба WebSocket endpoint управляются Nest lifecycle.
- [x] `apps/server/src/index.ts` удалён или оставлен только как временный redirect,
      не входящий в production build.
- [x] Нет imports из `routes` в `services` и `providers`.
- [x] Нет `get*Service()` singleton factories и side-effect provider registration.
- [ ] Runtime configuration читается через типизированный config layer.
- [ ] Startup/shutdown корректно завершают agents, PTY, Docker/SSH workers,
      tests, dev servers, timers и sockets.
- [x] HTTP/WS contract suites проходят без расхождений.
- [ ] Web, Electron и Docker artifacts проходят smoke tests.
- [ ] Сохранена обратная совместимость `.automaker/` и settings.
- [ ] Завершить сверку документации deployment и разработки. Native architecture,
      API/observability, storage downgrade и commands/checkpoints уже обновлены;
      полный deployment/rollout checklist этапа 10 ещё не закрыт.

## Внешние опорные материалы

Внутренние baseline-артефакты:

- [Current architecture inventory](artifacts/current-architecture.md)
- [Legacy WebSocket contracts](artifacts/websocket-contracts.md)
- [Storage, packaging and lifecycle](artifacts/storage-packaging-lifecycle.md)
- [Accepted architecture decisions](artifacts/architecture-decisions.md)
- [Generated HTTP route inventory](artifacts/http-routes.json)
- [Generated dependency inventory](artifacts/server-dependencies.json)
- [Generated UI API consumer inventory](artifacts/api-consumers.json)

- [NestJS migration guide](https://docs.nestjs.com/migration-guide)
- [NestJS testing](https://docs.nestjs.com/fundamentals/testing)
- [NestJS validation](https://docs.nestjs.com/application/validation)
- [NestJS WebSocket gateways](https://docs.nestjs.com/websockets/gateways)
- [NestJS WebSocket adapters](https://docs.nestjs.com/websockets/adapter)
