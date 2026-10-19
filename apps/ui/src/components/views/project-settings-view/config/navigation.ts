import { translate } from '@/lib/i18n';
import type { LucideIcon } from 'lucide-react';
import {
  User,
  GitBranch,
  Palette,
  AlertTriangle,
  Workflow,
  Database,
  Terminal,
  Unlink,
} from 'lucide-react';
import type { ProjectSettingsViewId } from '../hooks/use-project-settings-view';

export interface ProjectNavigationItem {
  id: ProjectSettingsViewId;
  label: string;
  icon: LucideIcon;
}

export const PROJECT_SETTINGS_NAV_ITEMS: ProjectNavigationItem[] = [
  {
    id: 'identity',
    get label() {
      return translate('Identity');
    },
    icon: User,
  },
  {
    id: 'worktrees',
    get label() {
      return translate('Worktrees');
    },
    icon: GitBranch,
  },
  {
    id: 'execution-environment',
    get label() {
      return translate('Execution Environment');
    },
    icon: Terminal,
  },
  {
    id: 'commands-scripts',
    get label() {
      return translate('Commands & Scripts');
    },
    icon: Terminal,
  },
  {
    id: 'theme',
    get label() {
      return translate('Theme');
    },
    icon: Palette,
  },
  {
    id: 'claude',
    get label() {
      return translate('Models');
    },
    icon: Workflow,
  },
  {
    id: 'data',
    get label() {
      return translate('Data');
    },
    icon: Database,
  },
  {
    id: 'orphaned',
    get label() {
      return translate('Orphaned Features');
    },
    icon: Unlink,
  },
  {
    id: 'danger',
    get label() {
      return translate('Danger Zone');
    },
    icon: AlertTriangle,
  },
];
