import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionEnvironmentBinding } from '@automaker/types';
import { ExecutionEnvironmentError } from '../../services/execution-environment/runtime.js';
import { resolveImmutableBinding } from './execution-binding.js';
import {
  EXECUTION_ADAPTERS,
  type ExecutionAdapter,
  type ExecutionAdapterDescriptor,
} from './execution.port.js';

@Injectable()
export class ExecutionRegistry {
  private readonly adapters: ReadonlyMap<string, ExecutionAdapter>;

  constructor(@Inject(EXECUTION_ADAPTERS) adapters: readonly ExecutionAdapter[]) {
    const entries = adapters.map((adapter) => [adapter.type, adapter] as const);
    if (new Set(entries.map(([type]) => type)).size !== entries.length) {
      throw new Error('Duplicate execution adapter registration.');
    }
    this.adapters = new Map(entries);
  }

  descriptors(): readonly ExecutionAdapterDescriptor[] {
    return Object.freeze(
      [...this.adapters.values()].map((adapter) =>
        Object.freeze({
          type: adapter.type,
          capabilities: Object.freeze([...adapter.capabilities]),
        })
      )
    );
  }

  async open(binding: ExecutionEnvironmentBinding) {
    const resolved = resolveImmutableBinding(binding);
    const adapter = this.adapters.get(resolved.type);
    if (!adapter) {
      throw new ExecutionEnvironmentError(
        'ADAPTER_UNAVAILABLE',
        `Execution adapter ${resolved.type} is unavailable. No fallback was performed.`
      );
    }
    return { binding: resolved, runtime: await adapter.open(resolved) };
  }
}
