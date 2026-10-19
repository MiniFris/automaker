import { translate, useUiLocale } from '@/lib/i18n';
import type { OpenAICompatibleEndpoint, PhaseModelEntry } from '@automaker/types';
import { toDirectModelId } from '@automaker/types';
import { Check } from 'lucide-react';
import { CommandGroup, CommandItem } from '@/components/ui/command';
import { OpenAIIcon } from '@/components/ui/provider-icon';

export function DirectModelGroups({
  endpoints,
  value,
  onSelect,
}: {
  endpoints: OpenAICompatibleEndpoint[];
  value: PhaseModelEntry;
  onSelect: (selection: PhaseModelEntry) => void;
}) {
  useUiLocale();
  return endpoints
    .filter((endpoint) => endpoint.enabled && endpoint.protocol === 'chat-completions')
    .map((endpoint) => (
      <CommandGroup key={endpoint.id} heading={`${endpoint.name} (Direct API)`}>
        {endpoint.models.map((model) => (
          <CommandItem
            key={JSON.stringify([endpoint.id, model.id])}
            value={JSON.stringify([
              'direct',
              endpoint.id,
              endpoint.name,
              model.id,
              model.displayName,
            ])}
            onSelect={() => onSelect({ model: toDirectModelId(model.id), providerId: endpoint.id })}
          >
            <OpenAIIcon className="mr-2 h-4 w-4" />
            <span className="flex-1">{model.displayName}</span>
            {!model.capabilities.tools && (
              <span className="text-xs text-muted-foreground">{translate('Text only')}</span>
            )}
            {value.providerId === endpoint.id && value.model === toDirectModelId(model.id) && (
              <Check className="h-4 w-4" />
            )}
          </CommandItem>
        ))}
      </CommandGroup>
    ));
}
