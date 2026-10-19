import { translate, useUiLocale } from '@/lib/i18n';
import { FileJson } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ImportJsonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importJson: string;
  onImportJsonChange: (value: string) => void;
  onImport: () => void;
  onCancel: () => void;
}

export function ImportJsonDialog({
  open,
  onOpenChange,
  importJson,
  onImportJsonChange,
  onImport,
  onCancel,
}: ImportJsonDialogProps) {
  useUiLocale();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="mcp-import-dialog">
        <DialogHeader>
          <DialogTitle>{translate('Import MCP Servers')}</DialogTitle>
          <DialogDescription>
            {translate(
              'Paste JSON configuration in Claude Code format. Servers with duplicate names will be skipped.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Textarea
            value={importJson}
            onChange={(e) => onImportJsonChange(e.target.value)}
            placeholder={translate(
              '{\n  "mcpServers": {\n    "server-name": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-name"],\n      "type": "stdio"\n    }\n  }\n}'
            )}
            className="font-mono text-sm h-64"
            data-testid="mcp-import-textarea"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {translate('Cancel')}
          </Button>
          <Button onClick={onImport} disabled={!importJson.trim()} data-testid="mcp-import-button">
            <FileJson className="w-4 h-4 mr-2" />
            {translate('Import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
