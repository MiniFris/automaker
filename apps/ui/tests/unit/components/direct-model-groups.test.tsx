import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAICompatibleEndpoint } from '@automaker/types';
import { Command, CommandList } from '@/components/ui/command';
import { DirectModelGroups } from '@/components/shared/direct-model-groups';

describe('direct model choices / endpoint identity', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const endpoint = (id: string, modelId = 'Vendor/Model:Case'): OpenAICompatibleEndpoint => ({
    id,
    name: id,
    enabled: true,
    baseUrl: 'http://localhost/v1/',
    protocol: 'chat-completions',
    auth: { type: 'none' },
    models: [
      {
        id: modelId,
        displayName: 'Same model name',
        capabilities: { tools: true, streaming: false },
      },
    ],
  });
  it('selects the exact endpoint when multiple endpoints share a model ID', () => {
    const onSelect = vi.fn();
    render(
      <Command>
        <CommandList>
          <DirectModelGroups
            endpoints={[endpoint('First'), endpoint('Second')]}
            value={{ model: 'direct-Vendor/Model:Case', providerId: 'First' }}
            onSelect={onSelect}
          />
        </CommandList>
      </Command>
    );
    const group = screen.getByText('Second (Direct API)').closest('[cmdk-group]')!;
    fireEvent.click(within(group as HTMLElement).getByText('Same model name'));
    expect(onSelect).toHaveBeenCalledWith({
      model: 'direct-Vendor/Model:Case',
      providerId: 'Second',
    });
  });
  it('always adds exactly one outer direct- prefix without changing opaque API IDs', () => {
    const onSelect = vi.fn();
    render(
      <Command>
        <CommandList>
          <DirectModelGroups
            endpoints={[endpoint('Local', 'direct-Model/Exact:Tag')]}
            value={{ model: 'claude-sonnet' }}
            onSelect={onSelect}
          />
        </CommandList>
      </Command>
    );
    fireEvent.click(screen.getByText('Same model name'));
    expect(onSelect).toHaveBeenCalledWith({
      model: 'direct-direct-Model/Exact:Tag',
      providerId: 'Local',
    });
  });
  it('does not offer disabled endpoints or unimplemented Responses transport', () => {
    render(
      <Command>
        <CommandList>
          <DirectModelGroups
            endpoints={[
              { ...endpoint('Disabled'), enabled: false },
              { ...endpoint('Responses'), protocol: 'responses' },
            ]}
            value={{ model: 'claude-sonnet' }}
            onSelect={vi.fn()}
          />
        </CommandList>
      </Command>
    );
    expect(screen.queryByText('Same model name')).not.toBeInTheDocument();
  });
});
