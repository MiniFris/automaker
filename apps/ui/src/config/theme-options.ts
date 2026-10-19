import { translate } from '@/lib/i18n';
import {
  type LucideIcon,
  Atom,
  Cat,
  Cherry,
  CloudSun,
  Coffee,
  Eclipse,
  Feather,
  Flame,
  Flower2,
  Ghost,
  Github,
  Heart,
  Leaf,
  Moon,
  Palmtree,
  Radio,
  Scroll,
  Snowflake,
  Sparkles,
  Square,
  Sun,
  Sunrise,
  Terminal,
  Trees,
  Waves,
  Wind,
} from 'lucide-react';

// Theme value type - all available themes
export type Theme =
  // Dark themes (16)
  | 'dark'
  | 'retro'
  | 'dracula'
  | 'nord'
  | 'monokai'
  | 'tokyonight'
  | 'solarized'
  | 'gruvbox'
  | 'catppuccin'
  | 'onedark'
  | 'synthwave'
  | 'red'
  | 'sunset'
  | 'gray'
  | 'forest'
  | 'ocean'
  | 'ember'
  | 'ayu-dark'
  | 'ayu-mirage'
  | 'matcha'
  // Light themes
  | 'light'
  | 'cream'
  | 'solarizedlight'
  | 'github'
  | 'paper'
  | 'rose'
  | 'mint'
  | 'lavender'
  | 'sand'
  | 'sky'
  | 'peach'
  | 'snow'
  | 'sepia'
  | 'gruvboxlight'
  | 'nordlight'
  | 'blossom'
  | 'ayu-light'
  | 'onelight'
  | 'bluloco'
  | 'feather';

export interface ThemeOption {
  value: Theme;
  label: string;
  Icon: LucideIcon;
  testId: string;
  isDark: boolean;
  color: string; // Primary/brand color for icon display
}

// All theme options with dark/light categorization (alphabetically sorted, Dark/Light first)
export const themeOptions: ReadonlyArray<ThemeOption> = [
  // Dark themes (20) - alphabetical, Dark first
  {
    value: 'dark',
    get label() {
      return translate('Dark');
    },
    Icon: Moon,
    testId: 'dark-mode-button',
    isDark: true,
    color: '#3b82f6',
  },
  {
    value: 'ayu-dark',
    get label() {
      return translate('Ayu Dark');
    },
    Icon: Moon,
    testId: 'ayu-dark-mode-button',
    isDark: true,
    color: '#E6B450',
  },
  {
    value: 'ayu-mirage',
    get label() {
      return translate('Ayu Mirage');
    },
    Icon: Sparkles,
    testId: 'ayu-mirage-mode-button',
    isDark: true,
    color: '#FFCC66',
  },
  {
    value: 'catppuccin',
    get label() {
      return translate('Catppuccin');
    },
    Icon: Cat,
    testId: 'catppuccin-mode-button',
    isDark: true,
    color: '#cba6f7',
  },
  {
    value: 'dracula',
    get label() {
      return translate('Dracula');
    },
    Icon: Ghost,
    testId: 'dracula-mode-button',
    isDark: true,
    color: '#bd93f9',
  },
  {
    value: 'ember',
    get label() {
      return translate('Ember');
    },
    Icon: Sunrise,
    testId: 'ember-mode-button',
    isDark: true,
    color: '#fd971f',
  },
  {
    value: 'forest',
    get label() {
      return translate('Forest');
    },
    Icon: Leaf,
    testId: 'forest-mode-button',
    isDark: true,
    color: '#22c55e',
  },
  {
    value: 'gray',
    get label() {
      return translate('Gray');
    },
    Icon: Square,
    testId: 'gray-mode-button',
    isDark: true,
    color: '#6b7280',
  },
  {
    value: 'gruvbox',
    get label() {
      return translate('Gruvbox');
    },
    Icon: Trees,
    testId: 'gruvbox-mode-button',
    isDark: true,
    color: '#fe8019',
  },
  {
    value: 'matcha',
    get label() {
      return translate('Matcha');
    },
    Icon: Leaf,
    testId: 'matcha-mode-button',
    isDark: true,
    color: '#A4B07E',
  },
  {
    value: 'monokai',
    get label() {
      return translate('Monokai');
    },
    Icon: Flame,
    testId: 'monokai-mode-button',
    isDark: true,
    color: '#f92672',
  },
  {
    value: 'nord',
    get label() {
      return translate('Nord');
    },
    Icon: Snowflake,
    testId: 'nord-mode-button',
    isDark: true,
    color: '#88c0d0',
  },
  {
    value: 'ocean',
    get label() {
      return translate('Ocean');
    },
    Icon: Waves,
    testId: 'ocean-mode-button',
    isDark: true,
    color: '#06b6d4',
  },
  {
    value: 'onedark',
    get label() {
      return translate('One Dark');
    },
    Icon: Atom,
    testId: 'onedark-mode-button',
    isDark: true,
    color: '#61afef',
  },
  {
    value: 'red',
    get label() {
      return translate('Red');
    },
    Icon: Heart,
    testId: 'red-mode-button',
    isDark: true,
    color: '#ef4444',
  },
  {
    value: 'retro',
    get label() {
      return translate('Retro');
    },
    Icon: Terminal,
    testId: 'retro-mode-button',
    isDark: true,
    color: '#22c55e',
  },
  {
    value: 'solarized',
    get label() {
      return translate('Solarized Dark');
    },
    Icon: Eclipse,
    testId: 'solarized-mode-button',
    isDark: true,
    color: '#268bd2',
  },
  {
    value: 'sunset',
    get label() {
      return translate('Sunset');
    },
    Icon: CloudSun,
    testId: 'sunset-mode-button',
    isDark: true,
    color: '#f97316',
  },
  {
    value: 'synthwave',
    get label() {
      return translate('Synthwave');
    },
    Icon: Radio,
    testId: 'synthwave-mode-button',
    isDark: true,
    color: '#ff7edb',
  },
  {
    value: 'tokyonight',
    get label() {
      return translate('Tokyo Night');
    },
    Icon: Sparkles,
    testId: 'tokyonight-mode-button',
    isDark: true,
    color: '#bb9af7',
  },
  // Light themes (20) - alphabetical, Light first
  {
    value: 'light',
    get label() {
      return translate('Light');
    },
    Icon: Sun,
    testId: 'light-mode-button',
    isDark: false,
    color: '#3b82f6',
  },
  {
    value: 'ayu-light',
    get label() {
      return translate('Ayu Light');
    },
    Icon: Sun,
    testId: 'ayu-light-mode-button',
    isDark: false,
    color: '#F29718',
  },
  {
    value: 'blossom',
    get label() {
      return translate('Blossom');
    },
    Icon: Cherry,
    testId: 'blossom-mode-button',
    isDark: false,
    color: '#ec4899',
  },
  {
    value: 'bluloco',
    get label() {
      return translate('Bluloco');
    },
    Icon: Waves,
    testId: 'bluloco-mode-button',
    isDark: false,
    color: '#0099e1',
  },
  {
    value: 'cream',
    get label() {
      return translate('Cream');
    },
    Icon: Coffee,
    testId: 'cream-mode-button',
    isDark: false,
    color: '#b45309',
  },
  {
    value: 'feather',
    get label() {
      return translate('Feather');
    },
    Icon: Feather,
    testId: 'feather-mode-button',
    isDark: false,
    color: '#FF7B2E',
  },
  {
    value: 'github',
    get label() {
      return translate('GitHub');
    },
    Icon: Github,
    testId: 'github-mode-button',
    isDark: false,
    color: '#0969da',
  },
  {
    value: 'gruvboxlight',
    get label() {
      return translate('Gruvbox Light');
    },
    Icon: Trees,
    testId: 'gruvboxlight-mode-button',
    isDark: false,
    color: '#d65d0e',
  },
  {
    value: 'lavender',
    get label() {
      return translate('Lavender');
    },
    Icon: Feather,
    testId: 'lavender-mode-button',
    isDark: false,
    color: '#8b5cf6',
  },
  {
    value: 'mint',
    get label() {
      return translate('Mint');
    },
    Icon: Wind,
    testId: 'mint-mode-button',
    isDark: false,
    color: '#0d9488',
  },
  {
    value: 'nordlight',
    get label() {
      return translate('Nord Light');
    },
    Icon: Snowflake,
    testId: 'nordlight-mode-button',
    isDark: false,
    color: '#5e81ac',
  },
  {
    value: 'onelight',
    get label() {
      return translate('One Light');
    },
    Icon: Atom,
    testId: 'onelight-mode-button',
    isDark: false,
    color: '#526FFF',
  },
  {
    value: 'paper',
    get label() {
      return translate('Paper');
    },
    Icon: Scroll,
    testId: 'paper-mode-button',
    isDark: false,
    color: '#374151',
  },
  {
    value: 'peach',
    get label() {
      return translate('Peach');
    },
    Icon: Cherry,
    testId: 'peach-mode-button',
    isDark: false,
    color: '#ea580c',
  },
  {
    value: 'rose',
    get label() {
      return translate('Rose');
    },
    Icon: Flower2,
    testId: 'rose-mode-button',
    isDark: false,
    color: '#e11d48',
  },
  {
    value: 'sand',
    get label() {
      return translate('Sand');
    },
    Icon: Palmtree,
    testId: 'sand-mode-button',
    isDark: false,
    color: '#d97706',
  },
  {
    value: 'sepia',
    get label() {
      return translate('Sepia');
    },
    Icon: Coffee,
    testId: 'sepia-mode-button',
    isDark: false,
    color: '#92400e',
  },
  {
    value: 'sky',
    get label() {
      return translate('Sky');
    },
    Icon: Sun,
    testId: 'sky-mode-button',
    isDark: false,
    color: '#0284c7',
  },
  {
    value: 'snow',
    get label() {
      return translate('Snow');
    },
    Icon: Snowflake,
    testId: 'snow-mode-button',
    isDark: false,
    color: '#3b82f6',
  },
  {
    value: 'solarizedlight',
    get label() {
      return translate('Solarized Light');
    },
    Icon: Sunrise,
    testId: 'solarizedlight-mode-button',
    isDark: false,
    color: '#268bd2',
  },
];

// Helper: Get only dark themes
export const darkThemes = themeOptions.filter((t) => t.isDark);

// Helper: Get only light themes
export const lightThemes = themeOptions.filter((t) => !t.isDark);
