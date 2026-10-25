# Notification and event-history success responses

## Covered native operations

| POST endpoint                     | Runtime shared response schema                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `/api/notifications/list`         | `NotificationsListResponseSchema`                                                  |
| `/api/notifications/unread-count` | `NotificationCountResponseSchema`                                                  |
| `/api/notifications/mark-read`    | `NotificationReadResponseSchema`: single notification or all-items count           |
| `/api/notifications/dismiss`      | `NotificationDismissResponseSchema`: single dismissal or all-items count           |
| `/api/event-history/list`         | `EventHistoryListResponseSchema`: summaries and total                              |
| `/api/event-history/get`          | `EventHistoryReadResponseSchema`: full event                                       |
| `/api/event-history/delete`       | `EventHistoryDeleteResponseSchema`: its existing success-only wire payload         |
| `/api/event-history/clear`        | `EventHistoryClearResponseSchema`: cleared count                                   |
| `/api/event-history/replay`       | `EventHistoryReplayResponseSchema`: event ID, hook count and concrete hook results |

Both controllers parse awaited application-service results directly with the named shared schemas. Existing OpenAPI source inspection can resolve these calls through public `@automaker/contracts/domains/notifications` and `/event-history` exports. No generator, inventory, root barrel or domain-service transport logic changed.

## Compatibility

Notification/event/summary/replay records describe the actual `@automaker/types` structures with explicit compatibility types for nullable optional fields. Required response payloads and nested primitive fields are validated. Existing extension keys remain through passthrough records/envelopes; timestamps remain strings rather than imposing a new ISO date constraint. Persisted notification type and event trigger strings stay open because existing readers serve historical/custom variants beyond today's domain unions. Successful mark-read/dismiss responses require their actual variant payload; a generic `{ success: true }` does not pass those schemas.

Storage formats and file-data validation remain unchanged. HTTP errors continue through the existing exception filter; malformed backend success payloads produce a safe 500 without disclosing their contents.

## Evidence

- **24 focused native contracts passed**, including thirteen response tests and eleven existing filesystem contracts. Actual local HTTP covers all nine endpoints, both notification mutation variants, real stored extension/null values, custom historical type/trigger strings, and replay with zero configured hooks (no vendor or hook calls). A bounded replay-result fixture covers failed hook records and extension fields. Nine injected malformed-success cases verify the controller boundary. Auth, request validation and not-found behavior remain covered.
- **4 shared contract tests passed**: domain-record compatibility, mutation variant requirements, typed replay results and JSON-schema exportability.
- Shared contracts build, server TypeScript check, owned controller ESLint and `git diff --check` passed. Root owns generated OpenAPI and the combined checkpoint.

No full suites, external network/vendor calls, Docker, GUI, commits or sub-agents were used.
