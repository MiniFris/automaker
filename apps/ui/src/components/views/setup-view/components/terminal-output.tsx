import { translate, useUiLocale } from '@/lib/i18n';
interface TerminalOutputProps {
  lines: string[];
}

export function TerminalOutput({ lines }: TerminalOutputProps) {
  useUiLocale();
  return (
    <div className="bg-card border border-border rounded-lg p-4 font-mono text-sm max-h-48 overflow-y-auto">
      {lines.map((line, index) => (
        <div key={index} className="text-foreground">
          <span className="text-primary">$</span> {line}
        </div>
      ))}
      {lines.length === 0 && (
        <div className="text-muted-foreground italic">{translate('Waiting for output...')}</div>
      )}
    </div>
  );
}
