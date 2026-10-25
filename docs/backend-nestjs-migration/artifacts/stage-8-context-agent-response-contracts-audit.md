# Context and Agent JSON response contracts

## Covered native endpoints

| POST endpoint                 | Shared response schema                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `/api/context/describe-file`  | `DescribeFileResponseSchema`                                                                      |
| `/api/context/describe-image` | `DescribeImageResponseSchema`                                                                     |
| `/api/agent/start`            | `AgentStartResponseSchema`: session ID and full messages                                          |
| `/api/agent/send`             | `AgentSendResponseSchema`: background-dispatch acknowledgement                                    |
| `/api/agent/history`          | `AgentHistoryResponseSchema`: full messages and running state, or operation failure               |
| `/api/agent/stop`             | `AgentMutationResponseSchema`                                                                     |
| `/api/agent/clear`            | `AgentClearResponseSchema`                                                                        |
| `/api/agent/model`            | `AgentModelResponseSchema`: actual boolean success, including missing-session false without error |
| `/api/agent/queue/add`        | `AgentQueueAddResponseSchema`: concrete queued prompt or operation failure                        |
| `/api/agent/queue/list`       | `AgentQueueListResponseSchema`: concrete queued prompts or operation failure                      |
| `/api/agent/queue/remove`     | `AgentMutationResponseSchema`                                                                     |
| `/api/agent/queue/clear`      | `AgentMutationResponseSchema`                                                                     |

The Agent controller contains ten POST operations. RunningAgents is owned by root and is not included in this slice's coverage claim.

## Boundary and compatibility

Context's complete existing success payload is `{success:true, description:string}`; it has no additional nested domain response records or variants. Its shared schema preserves multiline/Unicode text and envelope extensions without applying transformations. Controller parsing wraps the awaited existing cancellation helper; file/image IO, provider mapping and abort-listener behavior remain unchanged. Root owns the generator recognition of that existing passthrough cancellation helper.

Agent schemas describe complete message and queued-prompt records, including nested image attachments and execution/delivery fields. The message record reuses the public session message schema and permits historical nullable optional fields and open optional status strings. Queue records retain optional nulls, historical timestamp strings and extensions. Records and envelopes preserve extra fields instead of stripping them.

Existing HTTP200 operation failures remain valid responses: history/stop/queue failures carry `success:false,error`; model can return only `success:false`. Existing clear/mutation success-only payloads remain success-only because that is their actual wire shape; complex start/history/queue/send responses require their concrete payloads. No domain-service DTOs, file validators, persistence, execution or dispatcher behavior changed.

Public domain-subpath exports suffice; no package exports, root barrel, generator or inventories were edited by this agent.

## Evidence

- **27 native HTTP contracts passed**: eight Context and nineteen Agent cases. Every operation has a positive HTTP path. Context uses real scoped fixtures and an offline fake provider; rich envelopes, malformed backend output and missing/denied paths are tested. Agent uses actual native storage/queue/control operations with persisted rich historical records; send's asynchronous dispatch is explicitly stubbed and no provider execution occurs. Twelve malformed application-output cases verify controller parsing without leaking payloads. HTTP200 error variants, missing model/clear behavior, and denied/invalid dispatch are covered.
- **52 existing service unit tests passed**: ContextDescriptionService and AgentService.
- **4 focused shared contract tests passed**: full records, nullable/extension compatibility, operation variants and JSON-schema exportability.
- Root's coordinated combined shared build, server TypeScript check, owned controller ESLint and `git diff --check` passed. Root owns the generated OpenAPI/combined checkpoint.

No full suites, external network/vendor or paid calls, Docker, GUI, commits or sub-agents were used.
