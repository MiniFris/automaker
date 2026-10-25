# Native FeatureLoader filesystem

Срез после `bf5210e7`: FeatureStorageModule создаёт loader с явными
SECURE_FILESYSTEM и scoped canonical-project validator. FileFeatureRepository и
существующие native consumers получают этот же instance. Native path не
использует default global filesystem или глобальную конфигурацию allowed roots.
Прямые legacy constructors сохраняют прежний default отдельно.

## Реализовано

- Feature JSON, outputs, images и app-spec IO, backup rotation/recovery и atomic
  text/JSON writes используют injected filesystem. Shared helpers получили
  совместимые optional filesystem/strictErrors параметры; legacy defaults
  сохранены.
- Native read-modify-write/recovery сериализованы по canonical file path:
  symlink aliases делят lane; app-spec merges разных features используют одну
  lane документа. Admission ограничен 256 операциями, list читает по 16 features.
  beforeApplicationShutdown закрывает admission после producer onModuleDestroy
  и дренирует accepted work до scoped FS barrier;
  deadline 5 секунд и failed close кэшируются.
- Mutation reads восстанавливают valid backups/legacy temps, но EIO/access/restore
  failure не разрешают запись поверх неизвестного состояния. Query сохраняет
  null/skip для невосстановимого malformed JSON; I/O failures видны вызывающему.
- Native create публикует feature JSON exclusive hardlink: при существующем ID
  возвращается conflict, данные не перезаписываются. Native update запрещает
  менять ID; пути feature ID должны оставаться одним path component. Delete
  ошибки больше не маскируются как false.
- Новые native create/write temps не являются recovery candidates: recovery
  reader не может rename незавершённый active writer. Legacy `.tmp` и `.bak`
  recovery остаются доступны. Удаление orphan images перенесено после commit
  JSON, поэтому failed rename сохраняет старые referenced images.

## Проверки

- **93 server targeted units**: FeatureLoader, FeatureExportService и bounded
  admission/drain/deadline owner.
- **44 utils targeted tests**: atomic writer/recovery, scoped boundary, strict
  EIO и failed restore, в том числе restore ENOENT.
- **24 native contracts**: 7 новых feature filesystem cases и 17 actual
  AutoMode/Ideation/project-store consumer cases. Two-app roots/identity/close
  isolation, alias concurrency/history, shared app-spec merges, strict failures,
  exclusive cross-app same-ID create, held commit before FS close и image
  preservation при failed commit.
- Native close contract проверяет actual runtime shutdown callback → loader
  beforeApplicationShutdown drain → scoped filesystem close; callback сохраняет
  feature update и agent artifact, post-close mutation отклоняется.
- Utils build, server tsc, owned-source ESLint, formatting/diffcheck успешны.
  Full suites/network/GUI этим агентом не запускались.

## Оставшиеся границы

Per-file mutation lanes принадлежат одному приложению: concurrent updates из
разных процессов одного project не становятся distributed transaction. Exclusive
create защищён cross-app, но для update внешние writers требуют отдельной
координации. Hardlink support нужен для native create; fsync/power-loss durability
и сбор orphan temporary files здесь не добавлены. Migration images сохраняет
прежний best-effort cleanup исходных temp files; это не transactional image store.

Legacy constructor defaults остаются в AutoMode facade/global-service и
FeatureExportService; native factories передают loader явно. Неиспользуемый
legacy backlog apply route также создаёт default loader. Другие global fs
consumers и вызовы shared helpers без injected FS здесь не переносились.
