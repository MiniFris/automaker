import { translate } from '@/lib/i18n';
/**
 * Font options for per-project font customization
 *
 * All fonts listed here are bundled with the app via @fontsource packages
 * or custom font files (Zed fonts from zed-industries/zed-fonts).
 * They are self-hosted and will work without any system installation.
 */

// Sentinel value for "use default font" - Radix Select doesn't allow empty strings
export const DEFAULT_FONT_VALUE = 'default';

export interface UIFontOption {
  value: string; // CSS font-family value ('default' means "use default")
  label: string; // Display label for the dropdown
}

/**
 * Sans/UI fonts for headings, labels, and general text (Top 10)
 *
 * 'default' value means "use the theme default" (Geist Sans for all themes)
 */
export const UI_SANS_FONT_OPTIONS: readonly UIFontOption[] = [
  {
    value: DEFAULT_FONT_VALUE,
    get label() {
      return translate('Default (Geist Sans)');
    },
  },
  // Sans fonts (alphabetical)
  {
    value: 'Inter, system-ui, sans-serif',
    get label() {
      return translate('Inter');
    },
  },
  {
    value: 'Lato, system-ui, sans-serif',
    get label() {
      return translate('Lato');
    },
  },
  {
    value: 'Montserrat, system-ui, sans-serif',
    get label() {
      return translate('Montserrat');
    },
  },
  {
    value: "'Open Sans', system-ui, sans-serif",
    get label() {
      return translate('Open Sans');
    },
  },
  {
    value: 'Poppins, system-ui, sans-serif',
    get label() {
      return translate('Poppins');
    },
  },
  {
    value: 'Raleway, system-ui, sans-serif',
    get label() {
      return translate('Raleway');
    },
  },
  {
    value: 'Roboto, system-ui, sans-serif',
    get label() {
      return translate('Roboto');
    },
  },
  {
    value: "'Source Sans 3', system-ui, sans-serif",
    get label() {
      return translate('Source Sans');
    },
  },
  {
    value: "'Work Sans', system-ui, sans-serif",
    get label() {
      return translate('Work Sans');
    },
  },
  {
    value: "'Zed Sans', system-ui, sans-serif",
    get label() {
      return translate('Zed Sans');
    },
  },
  // Monospace fonts (alphabetical, for users who prefer mono UI)
  {
    value: "'Cascadia Code', monospace",
    get label() {
      return translate('Cascadia Code');
    },
  },
  {
    value: "'Fira Code', monospace",
    get label() {
      return translate('Fira Code');
    },
  },
  {
    value: "'IBM Plex Mono', monospace",
    get label() {
      return translate('IBM Plex Mono');
    },
  },
  {
    value: 'Inconsolata, monospace',
    get label() {
      return translate('Inconsolata');
    },
  },
  {
    value: 'Iosevka, monospace',
    get label() {
      return translate('Iosevka');
    },
  },
  {
    value: "'JetBrains Mono', monospace",
    get label() {
      return translate('JetBrains Mono');
    },
  },
  {
    value: "'Source Code Pro', monospace",
    get label() {
      return translate('Source Code Pro');
    },
  },
  {
    value: "'Zed Mono', monospace",
    get label() {
      return translate('Zed Mono');
    },
  },
] as const;

/**
 * Mono/code fonts for code blocks, terminals, and monospaced text (Top 10)
 *
 * 'default' value means "use the theme default" (Geist Mono for all themes)
 * Many of these support ligatures for coding symbols (-> => != etc.)
 */
export const UI_MONO_FONT_OPTIONS: readonly UIFontOption[] = [
  {
    value: DEFAULT_FONT_VALUE,
    get label() {
      return translate('Default (Geist Mono)');
    },
  },
  // Bundled fonts (alphabetical)
  {
    value: "'Cascadia Code', monospace",
    get label() {
      return translate('Cascadia Code');
    },
  },
  {
    value: "'Fira Code', monospace",
    get label() {
      return translate('Fira Code');
    },
  },
  {
    value: "'IBM Plex Mono', monospace",
    get label() {
      return translate('IBM Plex Mono');
    },
  },
  {
    value: 'Inconsolata, monospace',
    get label() {
      return translate('Inconsolata');
    },
  },
  {
    value: 'Iosevka, monospace',
    get label() {
      return translate('Iosevka');
    },
  },
  {
    value: "'JetBrains Mono', monospace",
    get label() {
      return translate('JetBrains Mono');
    },
  },
  {
    value: "'Source Code Pro', monospace",
    get label() {
      return translate('Source Code Pro');
    },
  },
  {
    value: "'Zed Mono', monospace",
    get label() {
      return translate('Zed Mono');
    },
  },
  // System fonts
  {
    value: 'Menlo, Monaco, monospace',
    get label() {
      return translate('Menlo / Monaco (macOS)');
    },
  },
] as const;

/**
 * Get the display label for a font value
 */
export function getFontLabel(
  fontValue: string | undefined,
  options: readonly UIFontOption[]
): string {
  if (!fontValue || fontValue === DEFAULT_FONT_VALUE) return options[0].label;
  const option = options.find((o) => o.value === fontValue);
  return option?.label ?? fontValue;
}
