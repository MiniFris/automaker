# Память в средах выполнения

Блок 5.3c.1 переводит shared project memory для managed feature/pipeline и chat
на закреплённый runtime. Он не включает terminal, dev-server, preview и remote
source editor. Обычный Local/legacy workflow сохраняет прежний memory loader.

## Где хранятся данные

- SSH: `.automaker/memory` в authoritative remote project root. Локальная копия
  проекта содержит control-plane metadata и не является запасным memory backend.
- Docker/Auto: `.automaker/memory` в root проектного mount, через worker внутри
  того же контейнера. Данные сохраняются при stop/start контейнера.
- Подтверждённый Auto Local fallback: тот же runtime, который уже закреплён за
  feature; память не переключается в Docker при последующей доступности Engine.
- Feature worktrees делят память проекта. Новый файл не создаётся внутри
  `.worktrees/<feature>/.automaker/memory`. Разные проекты не делят memory store.

Смена global/project default не переносит память существующего run. При resume
используется прежний binding. Удалённая среда проходит обычные host-key/ownership/
workspace проверки; недоступность не разрешает Local fallback.

## Чтение и статистика

Managed context сохраняет существующий подход: инструкции рабочей ветки, общие
context files и все memory `.md`/`.MD`, кроме `_index.md`, в общем бюджете
32 KiB/file, 64 KiB total, 50 entries/directory. Это не новый semantic search или
выбор top-5 файлов, используемый старым Local loader.

Memory возвращается отдельно в `ContextFilesResult.memoryFiles`; YAML frontmatter
не включается в prompt. `loaded` обновляется только после успешного чтения всего
контекста в пределах бюджета. Chat делает это после привязки runtime; до подготовки
Docker/SSH он не создаёт memory folder и не обновляет controller counters.

При завершении feature/pipeline/chat статистика `referenced` использует прежнюю
эвристику совпадения минимум трёх значимых слов. `successfulFeatures` не растёт для
feature `waiting_approval`/skip-tests, неуспешной интеграции pipeline или chat без
успешного provider result. Две загрузки (например, implementation и pipeline)
учитываются отдельно. Если файл удалён после загрузки контекста, writer не создаёт
его заново из устаревшего snapshot.

Чтение отсутствующей памяти не создаёт каталог. Каталог появляется при явной
записи learning; стартовые `_index.md`/`gotchas.md` автоматически не генерируются.
Ошибка чтения/budget блокирует передачу неполного контекста. Ошибка сохранения
статистики пишет warning в server log, но не отменяет уже выполненную работу.

## Запись и восстановление

Writer отправляет фиксированную Node-программу через `ExecutionEnvironment.exec`;
проектные scripts/dependencies для файловых операций не используются. Категории
learnings очищаются от path/shell syntax. Автоматический writer отказывается от
symlinks в `.automaker`, memory directory и category file, не затрагивает их цель.
Это защита от случайной записи сервиса в другой каталог, не sandbox агента.

Обновления одного project target сериализуются на controller. Дополнительно worker
берёт эксклюзивный `.automaker-memory.lock`, сравнивает SHA-256 прочитанного файла
и атомарно заменяет его через temporary file + rename, сохраняя permissions. Два
счётчика `referenced`/`successfulFeatures` изменяются одной заменой. Это протокол
для участвующих writers, не транзакция с произвольным внешним редактором.

`MEMORY_CONFLICT`, `MEMORY_BUSY`, потеря соединения или подтверждения записи не
запускают автоматический повтор. Предыдущие effects могут уже сохраниться. Сначала
проверьте содержимое **на target** и журнал SSH recovery, если runtime заблокирован.
После аварийного завершения worker может остаться lock/temp file. Перед ручным
удалением lock остановите writers проекта, проверьте PID/createdAt в lock именно
в нужной среде и убедитесь, что worker больше не работает. Автоматического stale
lock takeover нет; восстановление не повторяет learning или usage increment.

## Граница learnings

`RuntimeMemoryStore.appendLearning` и `FeatureMemoryWriter` поддерживают ADR-format
существующего `LearningEntry`. Completion callback получает writer закреплённого
run четвёртым аргументом: при его наличии нельзя писать source через controller fs.

В `AutoModeServiceFacade` автоматический `recordLearnings` всё ещё **stub**: перенос
хранилища не включает генерацию learnings, новые запросы к модели или дополнительные
расходы. Writer готов и проверен, но сам по себе не создаёт знания из agent-output.
Ideation/internal text helpers и их Local context loader этим блоком не перенесены.

Проверено на Linux: реальные файлы/worker, SSH/SFTP peer, Docker Engine, fake-model
feature/chat workflow и restart/default changes. Платформенная матрица — этап 5.4.
