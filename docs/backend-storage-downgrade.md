# Проверка DATA_DIR перед downgrade backend

`scripts/check-backend-downgrade.mjs` проверяет agent storage перед запуском
backend, который не понимает delivery ledgers, deletion tombstones и execution
intents. Поддерживаемая цель называется `legacy-no-agent-ledgers`: это описание
возможностей storage reader, а не версия приложения или обещание полной
совместимости со всеми старыми backend.

Проверяйте остановленный профиль или согласованный snapshot. Во время проверки
никакой controller не должен изменять этот DATA_DIR. Скрипт не останавливает
процессы и не блокирует каталог; проверка не заменяет остановку writer.

```bash
npm run preflight:backend:downgrade -- \
  --data-dir /absolute/path/to/restored-profile \
  --target legacy-no-agent-ledgers
```

Аргументы обязательны. `DATA_DIR` из environment и каталог по умолчанию не
используются. Команда работает на Node 22 без запуска Nest, чтения `.env`,
подключения providers или выполнения recovery. Она не создаёт snapshots, не
удаляет маркеры и не преобразует данные.

## Результат

В stdout возвращается JSON с `schemaVersion`, `scope`, `target`, `status`, числом
прочитанных файлов и findings. Finding содержит код причины, относительный путь,
тип записи и известную фазу. Тексты prompts, история, credentials и содержимое
повреждённых файлов не выводятся.

| Exit code | Значение                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `0`       | `passed`: в проверенном agent storage не обнаружены несовместимые safety artifacts                   |
| `2`       | `blocked`: обнаружены известные safety ledgers или поля, которые цель не понимает                    |
| `3`       | `unconfirmed`: неизвестный формат, повреждённый/недоступный файл, symlink или неоднозначный artifact |
| `64`      | Отсутствуют обязательные аргументы или указана неподдерживаемая цель                                 |

При любом ненулевом коде старый backend против этого профиля не запускается.
Код `0` относится только к области `legacy-agent-storage-preflight`; он не
проверяет остальные настройки, форматы проекта, SDK или совместимость бинарника.

Проверяются:

- `agent-session-deletions/<id>.json`: обе фазы `deleting` и `deleted`.
- `agent-queue-deliveries/<id>.json`: claim и settled ledger, включая consumed и
  interrupted. Даже завершённый ledger не объявляется совместимым с reader,
  который не знает его семантики.
- `agent-executions/<id>.json`: running, completing и settled records. Completing
  может содержать terminal intent, ещё не подтверждённый основной историей.
- Основные файлы, `.bakN` и writer `.tmp.<timestamp>.<8hex>` artifacts в этих
  каталогах и `agent-sessions`, включая вложенные writer suffixes. Quarantine
  поля очереди и delivery/run поля истории блокируют downgrade без отдельного
  журнала. Metadata snapshots проверяются на читаемый известный формат.

Повреждённый основной файл не заменяется backup или temp. Symlinks внутри
проверяемых storage paths не обходятся. Файлы не записываются; обычное чтение
может обновлять filesystem access time согласно настройкам ОС.

## Согласованный snapshot и восстановление

1. До обновления сохраните используемый backend artifact, его launch command и
   конфигурацию. Остановите единственный controller этого DATA_DIR и дождитесь
   подтверждённого завершения cleanup. Не снимайте snapshot работающего writer.
2. Сохраните **весь DATA_DIR** отдельным snapshot с сохранением прав доступа.
   В него входят settings, credentials, metadata, session history, queues,
   backups и любые safety artifacts. Проверьте полноту копии по manifest/hashes,
   не выводя содержимое секретов. Сохраните соответствие snapshot и artifact.
3. Обновляйте рабочий профиль, сохраняя предыдущие snapshot и artifact. Ротация
   `.bak1..3` отдельных JSON-файлов не является snapshot всего DATA_DIR.
4. При rollback остановите новый controller с тем же требованием подтверждённого
   cleanup. Сохраните текущий профиль отдельно для диагностики и последующего
   восстановления новых данных.
5. Восстановите **полный предыдущий snapshot в новый пустой каталог**. Не
   накладывайте старые файлы поверх нового профиля: новые tombstones/ledgers и
   stale snapshots иначе останутся в каталоге. Проверьте совпадение manifest и
   прав доступа восстановленного профиля с выбранным snapshot.
6. Выполните preflight для восстановленного каталога. При exit `0` запускайте
   соответствующий сохранённый backend artifact с DATA_DIR этого каталога.
   Оригинальный обновлённый профиль не используется одновременно другим
   controller и остаётся сохранённым.

Если предыдущего согласованного snapshot нет, этот инструмент не выполняет
преобразование. Удаление journal/tombstone вручную не является downgrade:
оно может вернуть удалённую сессию или отправить quarantined prompt повторно.
Результаты новых действий после snapshot при его восстановлении отсутствуют.
Изменения рабочих копий, удалённых сред и внешних систем восстановление DATA_DIR
не отменяет.

## Проверка на fixtures

```bash
npm run test:backend:downgrade
```

Offline fixtures создают только собственные временные профили. Контракт
проверяет refusal без изменения bytes/modes, обхода symlink или вывода данных;
затем демонстрирует отрицательный overlay и полное восстановление в fresh
sibling с совпадающим hash/mode manifest и успешным preflight. Он не запускает
старый production binary и не заменяет предусмотренную rollout-планом проверку
конкретного artifact и rollback на staging.
