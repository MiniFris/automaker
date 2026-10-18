import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PhaseModelEntry } from '@automaker/types';
import { DirectSettingsTab } from '@/components/views/settings-view/providers/direct-settings-tab';
import { DirectModelGroups } from '@/components/shared/direct-model-groups';
import { Command, CommandList } from '@/components/ui/command';
import { useDirectEndpoints } from '@/hooks/queries/use-direct-endpoints';
import { ExecutionEnvironmentSettings } from '@/components/shared/execution-environment-settings';

function ModelChoices() {
  const { data } = useDirectEndpoints();
  const [selection, setSelection] = useState<PhaseModelEntry>({ model: 'claude-sonnet' });
  return (
    <section>
      <h2>Shared model choices</h2>
      <Command>
        <CommandList>
          <DirectModelGroups
            endpoints={(data?.endpoints ?? []).map((status) => status.endpoint)}
            value={selection}
            onSelect={setSelection}
          />
        </CommandList>
      </Command>
      <output data-testid="direct-browser-selection">{JSON.stringify(selection)}</output>
    </section>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <DirectSettingsTab />
    <ModelChoices />
    <ExecutionEnvironmentSettings />
  </QueryClientProvider>
);
