# Ручной test runner — 5.3c.3a

Кнопка запуска тестов в Worktree UI использует подготовленный Docker/SSH project
или сохранённый feature worktree. Команда выполняется в его фактическом runtime cwd,
а не в controller alias. Подготовка контейнера/checkout не запускается при чтении
логов; отсутствующая среда не подменяется host shell.

## Требования и запуск

- Подготовьте Docker/SSH project в Project Settings. Для SSH подтвердите fingerprint.
- На target нужны Linux, Python 3 и `/bin/sh` (как для integrated terminal).
  Зависимости проекта и test runner должны быть установлены на самом target.
  Никаких скрытых install или копирования controller credentials нет.
- Укажите **Test Command** в настройках проекта, например `npm test`.
  Это намеренная shell-команда пользователя, запускаемая как `/bin/sh -c …`.
  Настройка команды хранится в control plane Automaker; проект определяется
  серверным selector, а не произвольным `projectPath` из запроса.
- Нажмите Run Tests. UI сначала читает target identity, затем передаёт её в start.
  Изменившаяся среда требует нового inspect; не выполняется ни fallback, ни retry.
- При выборе отдельного файла он добавляется как один quoted аргумент после `--`.
  Абсолютные пути, NUL и parent traversal отклоняются, имя не санитизируется молча.

Вывод идёт через target PTY supervisor, без интерактивного shell prompt;
`CI=true`, `FORCE_COLOR=1`. Раннеры, игнорирующие CI и включающие watch mode,
нужно настроить явно. Ограничения RPC agent tools в 600 секунд здесь нет.
Логи показывают backend и runtime cwd; stdout/stderr объединены PTY.

## Привязка и lifecycle

- Сессия сохраняет исходные transport/cwd/target metadata. Изменение default,
  удаление профиля или настроек не переключает уже работающие тесты. Старые
  feature pins по-прежнему имеют приоритет перед новым default.
- Logs/Stop по session ID относятся только к этой сессии и не ищут новый target.
  По workspace возвращается активная сессия, затем последняя retained history.
  Старый активный Local run не превращается в remote и не дублируется remote run.
- Stop ждёт подтверждённого target cleanup обычных процессов Linux session и лишь
  затем показывает Cancelled. Обычный exit 0 — Passed, ненулевой — Failed;
  даже exit 255 не означает transport loss, если target прислал подтверждение.
- Потеря связи/неподтверждённый cleanup — **Error**, `exitCode: null`, а не Passed
  или обещание Cancelled. Supervisor прекращает работу при EOF или после 15 секунд
  без heartbeat. Эффекты команд не откатываются; перед новым запуском проверьте target.
- Backend restart не восстанавливает процесс, команды не replay-ятся. История
  остаётся только в памяти backend: неизвестный `managed-test-*` ID возвращает 404
  и не передаётся legacy host runner. UI сверяет активные managed runs по старому ID.
- Docker activity marker удерживает существующий проектный контейнер от idle stop;
  по окончании обновляется activity timestamp. Контейнеры ради тестов не пересоздаются,
  порты не публикуются.
- Лимиты: 8 одновременно запускаемых/работающих managed sessions, 100 records
  истории, последние 50 000 символов логов на сессию в backend и UI. Запуски,
  находящиеся в preflight/handshake, тоже учитываются; shutdown ждёт их подготовки.

Это lifecycle management, не новая sandbox. Команда имеет права target user;
намеренная daemonization/смена Linux session/credentials не покрывается cleanup.
Application HTTP/WebSocket auth сохраняется; дополнительный terminal password
не требуется для существующей Worktree test action, как и в Local/legacy runner.

## Границы

Обычный Local/legacy runner оставлен без смены backend. Начиная с 5.3c.3b pinned
Auto/Local feature manual runs работают через native supervisor на **Linux/Python 3**,
с тем же подтверждённым cleanup. На других платформах они явно отклоняются, без
запуска другого backend. Pipeline/Verify tests не изменены.

Dev-server, preview и port forwarding — [5.3c.3b](execution-environments-preview.md). В блоке test runner нет ни
proxy в origin Automaker, ни новых открытых портов, ни сетевого доступа к реальной
модели. Полный 5.3c/5.3 ещё не завершён.
