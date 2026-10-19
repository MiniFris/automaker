import { translate, useUiLocale } from '@/lib/i18n';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SquareTerminal,
  RefreshCw,
  Terminal,
  SquarePlus,
  SplitSquareHorizontal,
  Palette,
  Type,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';
import { TERMINAL_FONT_OPTIONS } from '@/config/terminal-themes';
import { DEFAULT_FONT_VALUE } from '@/config/ui-font-options';
import { useAvailableTerminals } from '@/components/views/board-view/worktree-panel/hooks/use-available-terminals';
import { getTerminalIcon } from '@/components/icons/terminal-icons';
import { TerminalConfigSection } from './terminal-config-section';

export function TerminalSection() {
  useUiLocale();
  const {
    terminalState,
    setTerminalDefaultRunScript,
    setTerminalScreenReaderMode,
    setTerminalFontFamily,
    setTerminalScrollbackLines,
    setTerminalLineHeight,
    setTerminalDefaultFontSize,
    defaultTerminalId,
    setDefaultTerminalId,
    setOpenTerminalMode,
    setTerminalBackgroundColor,
    setTerminalForegroundColor,
  } = useAppStore();

  const {
    defaultRunScript,
    screenReaderMode,
    fontFamily,
    scrollbackLines,
    lineHeight,
    defaultFontSize,
    openTerminalMode,
    customBackgroundColor,
    customForegroundColor,
  } = terminalState;

  // Get available external terminals
  const { terminals, isRefreshing, refresh } = useAvailableTerminals();

  return (
    <div className="space-y-6">
      <div
        className={cn(
          'rounded-2xl overflow-hidden',
          'border border-border/50',
          'bg-gradient-to-br from-card/90 via-card/70 to-card/80 backdrop-blur-xl',
          'shadow-sm shadow-black/5'
        )}
      >
        <div className="p-6 border-b border-border/50 bg-gradient-to-r from-transparent via-accent/5 to-transparent">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 flex items-center justify-center border border-green-500/20">
              <SquareTerminal className="w-5 h-5 text-green-500" />
            </div>
            <h2 className="text-lg font-semibold text-foreground tracking-tight">
              {translate('Terminal')}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground/80 ml-12">
            {translate(
              'Customize terminal appearance and behavior. Theme follows your app theme in Appearance settings.'
            )}
          </p>
        </div>
        <div className="p-6 space-y-6">
          {/* Default External Terminal */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-foreground font-medium">
                {translate('Default External Terminal')}
              </Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={refresh}
                disabled={isRefreshing}
                title={translate('Refresh available terminals')}
                aria-label={translate('Refresh available terminals')}
              >
                <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {translate(
                'Terminal to use when selecting "Open in Terminal" from the worktree menu'
              )}
            </p>
            <Select
              value={defaultTerminalId ?? 'integrated'}
              onValueChange={(value) => {
                setDefaultTerminalId(value === 'integrated' ? null : value);
                toast.success(
                  value === 'integrated'
                    ? translate('Integrated terminal set as default')
                    : translate('Default terminal changed')
                );
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={translate('Select a terminal')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="integrated">
                  <span className="flex items-center gap-2">
                    <Terminal className="w-4 h-4" />
                    {translate('Integrated Terminal')}
                  </span>
                </SelectItem>
                {terminals.map((terminal) => {
                  const TerminalIcon = getTerminalIcon(terminal.id);
                  return (
                    <SelectItem key={terminal.id} value={terminal.id}>
                      <span className="flex items-center gap-2">
                        <TerminalIcon className="w-4 h-4" />
                        {terminal.name}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {terminals.length === 0 && !isRefreshing && (
              <p className="text-xs text-muted-foreground italic">
                {translate('No external terminals detected. Click refresh to re-scan.')}
              </p>
            )}
          </div>

          {/* Default Open Mode */}
          <div className="space-y-3">
            <Label className="text-foreground font-medium">{translate('Default Open Mode')}</Label>
            <p className="text-xs text-muted-foreground">
              {translate(
                'How to open the integrated terminal when using "Open in Terminal" from the worktree menu'
              )}
            </p>
            <Select
              value={openTerminalMode}
              onValueChange={(value: 'newTab' | 'split') => {
                setOpenTerminalMode(value);
                toast.success(
                  value === 'newTab'
                    ? translate('New terminals will open in new tabs')
                    : translate('New terminals will split the current tab')
                );
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newTab">
                  <span className="flex items-center gap-2">
                    <SquarePlus className="w-4 h-4" />
                    {translate('New Tab')}
                  </span>
                </SelectItem>
                <SelectItem value="split">
                  <span className="flex items-center gap-2">
                    <SplitSquareHorizontal className="w-4 h-4" />
                    {translate('Split Current Tab')}
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Font Family */}
          <div className="space-y-3">
            <Label className="text-foreground font-medium">{translate('Font Family')}</Label>
            <Select
              value={fontFamily || DEFAULT_FONT_VALUE}
              onValueChange={(value) => {
                setTerminalFontFamily(value);
                toast.info(translate('Font family changed'), {
                  description: translate('Restart terminal for changes to take effect'),
                });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={translate('Default (Menlo / Monaco)')} />
              </SelectTrigger>
              <SelectContent>
                {TERMINAL_FONT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span
                      style={{
                        fontFamily: option.value === DEFAULT_FONT_VALUE ? undefined : option.value,
                      }}
                    >
                      {option.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Background Color */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-foreground font-medium">{translate('Background Color')}</Label>
              {customBackgroundColor && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setTerminalBackgroundColor(null);
                    toast.success(translate('Background color reset to theme default'));
                  }}
                >
                  <X className="w-3 h-3 mr-1" />
                  {translate('Reset')}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {translate(
                'Override the terminal background color. Leave empty to use the theme default.'
              )}
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <div
                  className="w-10 h-10 rounded-lg border border-border/50 shadow-sm flex items-center justify-center"
                  style={{
                    backgroundColor: customBackgroundColor || 'var(--card)',
                  }}
                >
                  <Palette
                    className={cn(
                      'w-5 h-5',
                      customBackgroundColor ? 'text-white/80' : 'text-muted-foreground'
                    )}
                  />
                </div>
                <Input
                  type="color"
                  value={customBackgroundColor || '#000000'}
                  onChange={(e) => {
                    const color = e.target.value;
                    setTerminalBackgroundColor(color);
                  }}
                  className="w-14 h-10 p-1 cursor-pointer bg-transparent border-border/50"
                  title={translate('Pick a color')}
                />
                <Input
                  type="text"
                  value={customBackgroundColor || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Validate hex color format
                    if (value === '' || /^#[0-9A-Fa-f]{0,6}$/.test(value)) {
                      if (value === '' || /^#[0-9A-Fa-f]{6}$/.test(value)) {
                        setTerminalBackgroundColor(value || null);
                      }
                    }
                  }}
                  placeholder={translate('e.g., #1a1a1a')}
                  className="flex-1 bg-accent/30 border-border/50 font-mono text-sm"
                />
              </div>
            </div>
          </div>

          {/* Foreground Color */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-foreground font-medium">{translate('Foreground Color')}</Label>
              {customForegroundColor && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setTerminalForegroundColor(null);
                    toast.success(translate('Foreground color reset to theme default'));
                  }}
                >
                  <X className="w-3 h-3 mr-1" />
                  {translate('Reset')}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {translate(
                'Override the terminal text/foreground color. Leave empty to use the theme default.'
              )}
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <div
                  className="w-10 h-10 rounded-lg border border-border/50 shadow-sm flex items-center justify-center"
                  style={{
                    backgroundColor: customForegroundColor || 'var(--foreground)',
                  }}
                >
                  <Type
                    className={cn(
                      'w-5 h-5',
                      customForegroundColor ? 'text-black/80' : 'text-background'
                    )}
                  />
                </div>
                <Input
                  type="color"
                  value={customForegroundColor || '#ffffff'}
                  onChange={(e) => {
                    const color = e.target.value;
                    setTerminalForegroundColor(color);
                  }}
                  className="w-14 h-10 p-1 cursor-pointer bg-transparent border-border/50"
                  title={translate('Pick a color')}
                />
                <Input
                  type="text"
                  value={customForegroundColor || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Validate hex color format
                    if (value === '' || /^#[0-9A-Fa-f]{0,6}$/.test(value)) {
                      if (value === '' || /^#[0-9A-Fa-f]{6}$/.test(value)) {
                        setTerminalForegroundColor(value || null);
                      }
                    }
                  }}
                  placeholder={translate('e.g., #ffffff')}
                  className="flex-1 bg-accent/30 border-border/50 font-mono text-sm"
                />
              </div>
            </div>
          </div>

          {/* Default Font Size */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-foreground font-medium">
                {translate('Default Font Size')}
              </Label>
              <span className="text-sm text-muted-foreground">
                {defaultFontSize}
                {translate('px')}
              </span>
            </div>
            <Slider
              value={[defaultFontSize]}
              min={8}
              max={32}
              step={1}
              onValueChange={([value]) => setTerminalDefaultFontSize(value)}
              className="flex-1"
            />
          </div>

          {/* Line Height */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-foreground font-medium">{translate('Line Height')}</Label>
              <span className="text-sm text-muted-foreground">{lineHeight.toFixed(1)}</span>
            </div>
            <Slider
              value={[lineHeight]}
              min={1.0}
              max={2.0}
              step={0.1}
              onValueChange={([value]) => {
                setTerminalLineHeight(value);
              }}
              onValueCommit={() => {
                toast.info(translate('Line height changed'), {
                  description: translate('Restart terminal for changes to take effect'),
                });
              }}
              className="flex-1"
            />
          </div>

          {/* Scrollback Lines */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-foreground font-medium">
                {translate('Scrollback Buffer')}
              </Label>
              <span className="text-sm text-muted-foreground">
                {(scrollbackLines / 1000).toFixed(0)}
                {translate('k lines')}
              </span>
            </div>
            <Slider
              value={[scrollbackLines]}
              min={1000}
              max={100000}
              step={1000}
              onValueChange={([value]) => setTerminalScrollbackLines(value)}
              onValueCommit={() => {
                toast.info(translate('Scrollback changed'), {
                  description: translate('Restart terminal for changes to take effect'),
                });
              }}
              className="flex-1"
            />
          </div>

          {/* Default Run Script */}
          <div className="space-y-3">
            <Label className="text-foreground font-medium">{translate('Default Run Script')}</Label>
            <p className="text-xs text-muted-foreground">
              {translate(
                'Command to run automatically when opening a new terminal (e.g., "claude", "codex")'
              )}
            </p>
            <Input
              value={defaultRunScript}
              onChange={(e) => setTerminalDefaultRunScript(e.target.value)}
              placeholder={translate('e.g., claude, codex, npm run dev')}
              className="bg-accent/30 border-border/50"
            />
          </div>

          {/* Screen Reader Mode */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-foreground font-medium">
                {translate('Screen Reader Mode')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate('Enable accessibility mode for screen readers')}
              </p>
            </div>
            <Switch
              checked={screenReaderMode}
              onCheckedChange={(checked) => {
                setTerminalScreenReaderMode(checked);
                toast.success(
                  checked
                    ? translate('Screen reader mode enabled')
                    : translate('Screen reader mode disabled'),
                  {
                    description: translate('Restart terminal for changes to take effect'),
                  }
                );
              }}
            />
          </div>
        </div>
      </div>

      <TerminalConfigSection />
    </div>
  );
}
