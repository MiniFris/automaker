# Импорт прежнего Electron profile

Native backend получает `LegacyElectronProfileSource` и `LegacyProfileImporter`
через Nest. `SettingsService` больше не читает `process.env`, `os.homedir()` или
raw filesystem для этой операции. Конструкторы вне native composition без
переданного importer не ищут профиль пользователя.

Источник определяется только snapshot host environment и `HostProfileConfig`:

- Linux: `XDG_CONFIG_HOME/Automaker` либо `HOME/.config/Automaker`.
- macOS: `HOME/Library/Application Support/Automaker`.
- Windows: `APPDATA/Automaker` либо `USERPROFILE/AppData/Roaming/Automaker`.

Home берётся из snapshot `HOME`/`USERPROFILE`, а не из текущего окружения во время
копирования. Относительная конфигурация отклоняется. Если host home/config не
переданы, чтения operator HOME не происходит. Source port допускает только
выбранный профиль, проверяет его identity и path containment, отклоняет symlinks
в profile/subtree и сверяет открытый file descriptor перед чтением. Источник
не изменяется; чтение не превращается в автоматический backup recovery.

Выборочные legacy items сохранены:
`settings.json`, `credentials.json`, `sessions-metadata.json`, `agent-sessions/`,
`.api-key`, `.sessions`. Electron caches не копируются. Существующие destination
items сохраняются. Если settings уже существовали до начала операции и pending
intent отсутствует, новый импорт не начинается. Target внутри legacy source
отклоняется, чтобы повторное staging не захватило собственные данные.

## Initialization barrier

При `runStartupTasks=true` native settings repository ждёт coalesced import до
первого чтения или изменения. Поэтому provider warmup или другой ранний reader
не создаёт defaults перед импортом. Importer использует injected
`SECURE_FILESYSTEM` напрямую и не входит повторно в settings mutation queue.

При `runStartupTasks=false` автоматического импорта нет. Явный вызов
`migrateFromLegacyElectronPath()` остаётся доступен и включает тот же barrier.
Ошибка импорта проходит наружу до repository fallback: она не превращается в
defaults, успешную mutation или ложное завершение миграции. Позднейшая явная
попытка может безопасно завершить операцию после устранения ошибки.
Typed import failure также прерывает startup до Agent initialization и readiness;
общий fallback optional startup warnings не принимает partial profile за defaults.

## Staging и восстановление

Destination использует reserved каталог `DATA_DIR/.legacy-electron-import/`:

1. `intent.json` фиксирует version 1, известный source, исходный skip set и фазу
   `staging`. Payload копируется только через native filesystem. Files получают
   mode `0600`, новые directories — `0700`. Основные JSON items должны быть
   читаемыми JSON objects; исходные bytes не преобразуются.
2. После полного staging сохраняются manifest/hash и фаза `publishing`.
   Ошибка staging не публикует частично записанные destination files; следующая
   попытка пересоздаёт private payload из того же profile.
3. Каждый файл публикуется через scoped atomic hard link из payload в target.
   Это один DATA_DIR/volume. `EEXIST` сохраняет существующий файл; overwrite и
   fallback на небезопасный copy/rename отсутствуют. Directory items дополняются
   пофайлово согласно intent, без замены существующего subtree. `settings.json`
   публикуется последним.
4. После публикации сохраняется `complete` и удаляется staged payload. Intent
   остаётся private metadata без содержимого credentials/history. Если cleanup
   не завершён, результат содержит ошибку; повторная попытка завершает cleanup.

`publishing` intent имеет приоритет над проверкой существующего settings.json.
Поэтому сбой после его публикации не делает следующую попытку ложным skip.
Полностью staged payload позволяет продолжить публикацию после перезапуска,
даже если прежний source больше недоступен. Проверяются сохранённые hashes.
Для `publishing`/`complete` source уже не читается: смена host config после
staging не блокирует локальное завершение. `staging` остаётся привязанным к
исходному profile; возвращаемый `legacyPath` сохраняет provenance intent.
Неизвестный/повреждённый intent, symlink, изменённый payload или unsupported
hard links дают явную ошибку вместо удаления данных или преобразования.

Native settings rewrites также используют private modes, чтобы первый schema
migration/read не расширил права опубликованных файлов. При shutdown importer
закрывает admission, прекращает следующие шаги и ограниченно ждёт текущую
операцию; незавершённый drain не объявляется успешной очисткой.

Один controller владеет DATA_DIR. Source должен быть неподвижным во время
первоначального staging: этот импорт не создаёт atomic snapshot работающего
старого Electron приложения. Старый профиль остаётся на месте. При ошибке
сохраните reserved intent/payload для повторной попытки; вручную удалять markers
для обхода barrier не требуется.

Downgrade preflight также распознаёт этот intent: `staging`/`publishing`
блокируют старый target, неизвестный или повреждённый intent даёт `unconfirmed`.
Валидный `complete` пропускается только в рамках этого marker, без обещания
совместимости всего бинарника. Pending частичный профиль нельзя передавать
старому backend; rollback использует полный предыдущий snapshot согласно
[процедуре](backend-storage-downgrade.md).
