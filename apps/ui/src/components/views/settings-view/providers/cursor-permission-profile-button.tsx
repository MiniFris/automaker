import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { CursorPermissionsTarget, CursorProfileRequest } from '@automaker/contracts';
import { translate } from '@/lib/i18n';
import { getHttpApiClient } from '@/lib/http-api-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function CursorPermissionProfileButton({
  profileId,
  scope,
  projectPath,
  disabled,
  onApply,
}: {
  profileId: 'strict' | 'development';
  scope: 'global' | 'project';
  projectPath?: string;
  disabled: boolean;
  onApply: (request: CursorProfileRequest) => Promise<unknown>;
}) {
  const [target, setTarget] = useState<CursorPermissionsTarget>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const inspect = async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const result = await getHttpApiClient().setup.getCursorPermissionsTarget(scope, projectPath);
      if (result.target.scope !== scope || (scope === 'project' && !projectPath))
        throw new Error('Cursor permissions preview scope does not match selection.');
      if (mounted.current) setTarget(result.target);
    } catch (error) {
      if (mounted.current)
        toast.error(translate('Failed to inspect Cursor permissions target'), {
          description: error instanceof Error ? error.message : undefined,
        });
    } finally {
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
  };
  const apply = async () => {
    if (!target || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      await onApply({ confirmed: true, profileId, target });
      if (mounted.current) setTarget(undefined);
    } catch {
      // Mutation hook owns the error toast. Never claim success or retry a write.
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant={scope === 'project' ? 'outline' : 'default'}
        disabled={disabled || loading || saving}
        onClick={() => void inspect()}
      >
        {loading
          ? translate('Inspecting target...')
          : translate(scope === 'global' ? 'Apply Globally' : 'Apply to Project')}
      </Button>
      <Dialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open && !saving) setTarget(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{translate('Apply Cursor permission profile?')}</DialogTitle>
            <DialogDescription>
              {translate(
                'This changes Cursor CLI permissions on the backend host, not on an SSH or Docker target. Existing runs are not restarted.'
              )}
            </DialogDescription>
          </DialogHeader>
          {target && (
            <div className="text-sm break-all space-y-2" data-testid="cursor-permissions-target">
              <p>
                {profileId} · {target.scope}
              </p>
              <p>{target.configPath}</p>
              <p>{target.workingDirectory}</p>
              <p>{target.instanceId}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setTarget(undefined)}>
              {translate('Cancel')}
            </Button>
            <Button disabled={saving || disabled} onClick={() => void apply()}>
              {translate('Confirm permission change')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
