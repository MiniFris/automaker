# Ideation: accepted work и durable conversion

Срез после `ef36030e`; исходные этапы миграции целиком не закрывает.

## Реализовано

- Per-service IdeationJobs принимает максимум 64 jobs; сообщения, analysis и
  suggestions tracked, а native mutations/conversion проходят runAccepted.
  Admission закрывается синхронно, shutdown aborts controllers и ждёт actual
  promises до 5 секунд в onModuleDestroy, до scoped FS barrier. Timeout и
  explicit cleanup-unknown сохраняют failed close; uncertainty блокирует новые
  jobs. Background HTTP acknowledgements сохранены.
- Stop session сохраняет controller/running ownership до окончания provider.
  Поздний response после abort не становится assistant message. User history
  сохраняется при abort; session-ended публикуется после drain/persistence.
  Normal message-complete идёт после успешной записи session. Suggestions
  используют один captured signal для SDK/execute; после async preflight
  повторно проверяется abort до provider query. Analysis проверяет отмену при
  обходе дерева и до cache commit.
- Native IdeationService получает application-owned SECURE_FILESYSTEM для своих
  reads, directory creation и atomic JSON writes с прежними backups. Прямые
  constructors сохраняют explicit legacy default; global facade override нет.
- Conversion использует durable v1 intent в
  `.automaker/ideation/conversions/<sha256(ideaId)>.json`, вне удаляемого ideaDir.
  Intent хранит first payload и token; feature ID —
  `feature-idea-<first32hex>`. Prepared temp публикуется exclusive hardlink;
  feature.json создаётся тем же no-overwrite способом с provenance
  `ideationConversion:{version:1,ideaId,token}`. Completed state подтверждается
  strict matching feature read; отдельного completed marker нет.
- Только ENOENT считается отсутствием. Parse/I/O errors не разрешают overwrite;
  existing feature с чужой/отсутствующей provenance отклоняется как conflict.
  Initial createdAt/descriptionHistory сохраняют FeatureLoader normalization.
  Retry после create/delete-failure или restart возвращает тот же featureId и
  не перезаписывает пользовательские edits. keepIdea оставляет идею; повторный
  conversion с keepIdea:false удаляет её, сохраняя прежний feature.
- deleteIdea больше не скрывает arbitrary rm errors: только ENOENT успешен.
  Ошибка удаления видна клиенту; её retry безопасен благодаря intent.

## Проверки

- Targeted unit: **42 passed** — прежние 39 IdeationService regressions и
  bounded admission/abort/drain/deadline/cleanup-unknown owner tests.
- Native HTTP contracts: **5 passed** — delete failure → restart retry с
  сохранением edited feature; concurrent two-app conversion/keepIdea/first
  payload; collision/malformed/EIO fail-closed; held-provider stop/restart
  ownership; actual shutdown drain и независимость второго приложения.
- Scoped filesystem identity проверена actual Nest provider; временные файлы,
  providers и приложения принадлежат tests. Live vendors не вызывались.
- Server tsc, owned-source ESLint, formatting/diffcheck: успешно.

## Границы

Hardlink publication требует поддержки filesystem; при отсутствии поддержки
conversion завершается ошибкой, overwrite fallback нет. Atomic publication не
обещает fsync durability при потере питания. Crash может оставить temp files;
автоматический garbage collection не добавлен. Provenance/intent нельзя
безопасно интерпретировать старым бинарником: rollback требует consistent
project snapshot, а DATA_DIR-only snapshot не охватывает project conversions.

FeatureLoader reads, используемые для existing-work context, остаются boundary
другого домена; остальные conversion callers FeatureRepository не менялись.
Active-session history/cache и prompt catalog пока остаются в IdeationService;
лимит 64 относится к accepted work, а не к историческому количеству сообщений.
EventBus decomposition, полный generic feature-storage cutover и остальные
исходные orchestration gates здесь не объявлены завершёнными.
