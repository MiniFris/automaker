# Полный перенос backend Automaker на NestJS

Обновлено: 2026-10-23. Статус: проектный план, реализация не начата.

## Цель

Перевести `apps/server` с ручной композиции Express на NestJS, сохранив внешний
HTTP/WebSocket API, файловый формат `.automaker/`, поддержку Web/Electron/Docker,
все AI-провайдеры и среды выполнения Local/Docker/SSH/Memory.

Миграция выполняется как переход модульного монолита, а не как одномоментная
перепись. NestJS сначала становится новым composition root поверх Express,
после чего старые route groups удаляются по одному. Глубокое изменение бизнес-
логики выполняется только после стабилизации соответствующего Nest-модуля.

## Исходная точка

- около 299 зарегистрированных HTTP handlers;
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
    Отдельные ветки и обязательные PR между этапами не создаются; работа сохраняется
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
| 5   | [Проектные данные и workflow](05-project-domain-modules.md)             | Settings, projects, files, features, sessions и specs  | 3–5 недель |
| 6   | [Execution, Git и worktrees](06-execution-git-worktrees.md)             | Среды выполнения и Git изолированы за портами          | 4–6 недель |
| 7   | [AI providers и agents](07-providers-and-agents.md)                     | Provider registry и агентские сессии работают через DI | 3–5 недель |
| 8   | [Оркестрация и интеграции](08-orchestration-and-integrations.md)        | Auto mode, pipelines, ideation, GitHub и MCP           | 3–5 недель |
| 9   | [WebSocket и terminal](09-websockets-and-terminal.md)                   | Оба WS-протокола принадлежат Nest lifecycle            | 2–4 недели |
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

Для всей программы создаётся одна ветка:

```text
refactor/backend-nestjs-migration
```

- Все подготовительные, migration, cleanup, test и documentation commits делаются
  только в этой ветке.
- Не создаются отдельные feature branches, stage branches или обязательные PR между
  этапами.
- Коммиты должны оставаться небольшими и тематическими, но не обязаны соответствовать
  одному route group или одному файлу.
- Изменения из основной ветки при необходимости интегрируются в migration-ветку
  контролируемым merge/rebase с повторным полным checkpoint текущего этапа.
- Откат выполняется до последнего успешно протестированного stage checkpoint либо
  предыдущего production artifact.
- После завершения этапа обновляются checklist и статус соответствующего документа,
  затем создаётся фиксирующий commit вида `chore(nest-migration): complete stage N`.

Обязательный checkpoint после каждого этапа включает:

1. Форматирование, lint и typecheck всего monorepo.
2. Сборку shared packages и server production artifact.
3. Все быстрые unit и HTTP/WS contract tests.
4. Stage-specific integration tests, перечисленные в документе этапа.
5. Проверку startup/shutdown и отсутствия незакрытых handles/resources.
6. Web smoke; начиная с изменения packaging — Docker и Electron smoke.
7. Обновление route inventory, migration checklist и известных ограничений.

Если checkpoint не прошёл, этап не отмечается завершённым, фиксирующий commit не
создаётся и работа не переходит к следующему этапу. Промежуточные коммиты допустимы,
но последний commit завершённого этапа всегда соответствует зелёному checkpoint.

## Общие правила выполнения

- Не совмещать перенос route group с изменением его HTTP-контракта.
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

- [ ] Все HTTP routes обслуживаются Nest controllers.
- [ ] Оба WebSocket endpoint управляются Nest lifecycle.
- [ ] `apps/server/src/index.ts` удалён или оставлен только как временный redirect,
      не входящий в production build.
- [ ] Нет imports из `routes` в `services` и `providers`.
- [ ] Нет `get*Service()` singleton factories и side-effect provider registration.
- [ ] Runtime configuration читается через типизированный config layer.
- [ ] Startup/shutdown корректно завершают agents, PTY, Docker/SSH workers,
      tests, dev servers, timers и sockets.
- [ ] HTTP/WS contract suites проходят без расхождений.
- [ ] Web, Electron и Docker artifacts проходят smoke tests.
- [ ] Сохранена обратная совместимость `.automaker/` и settings.
- [ ] Документация deployment и разработки обновлена.

## Внешние опорные материалы

- [NestJS migration guide](https://docs.nestjs.com/migration-guide)
- [NestJS testing](https://docs.nestjs.com/fundamentals/testing)
- [NestJS validation](https://docs.nestjs.com/application/validation)
- [NestJS WebSocket gateways](https://docs.nestjs.com/websockets/gateways)
- [NestJS WebSocket adapters](https://docs.nestjs.com/websockets/adapter)
