import { getFormattingLocale } from '@/lib/i18n';
import { formatCount, getUiLocale, translate } from '@/lib/i18n';
import { type CodexPlanType } from '@/store/app-store';

const WINDOW_DEFAULT_LABEL = 'Usage window';
const RESET_LABEL = 'Resets';
const UNKNOWN_LABEL = 'Unknown';
const DAY_UNIT = 'day';
const HOUR_UNIT = 'hour';
const MINUTE_UNIT = 'min';
const WINDOW_SUFFIX = 'window';
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const MILLISECONDS_PER_SECOND = 1000;
const SESSION_HOURS = 5;
const DAYS_PER_WEEK = 7;
const SESSION_WINDOW_MINS = SESSION_HOURS * MINUTES_PER_HOUR;
const WEEKLY_WINDOW_MINS = DAYS_PER_WEEK * MINUTES_PER_DAY;
const SESSION_TITLE = 'Session Usage';
const SESSION_SUBTITLE = '5-hour rolling window';
const WEEKLY_TITLE = 'Weekly';
const WEEKLY_SUBTITLE = 'All models';
const FALLBACK_TITLE = 'Usage Window';
const PLAN_TYPE_LABELS: Record<CodexPlanType, string> = {
  get free() {
    return translate('Free');
  },
  get plus() {
    return translate('Plus');
  },
  get pro() {
    return translate('Pro');
  },
  get team() {
    return translate('Team');
  },
  get business() {
    return translate('Business');
  },
  get enterprise() {
    return translate('Enterprise');
  },
  get edu() {
    return translate('Education');
  },
  unknown: UNKNOWN_LABEL,
};

export function formatCodexWindowDuration(minutes: number | null): string {
  if (!minutes || minutes <= 0) return translate(WINDOW_DEFAULT_LABEL);
  if (getUiLocale() === 'ru') {
    const duration =
      minutes % MINUTES_PER_DAY === 0
        ? formatCount(minutes / MINUTES_PER_DAY, 'day')
        : minutes % MINUTES_PER_HOUR === 0
          ? formatCount(minutes / MINUTES_PER_HOUR, 'hour')
          : formatCount(minutes, 'minute');
    return translate('Window: {value1}', { value1: duration });
  }
  if (minutes % MINUTES_PER_DAY === 0) {
    const days = minutes / MINUTES_PER_DAY;
    return `${days} ${DAY_UNIT}${days === 1 ? '' : 's'} ${WINDOW_SUFFIX}`;
  }
  if (minutes % MINUTES_PER_HOUR === 0) {
    const hours = minutes / MINUTES_PER_HOUR;
    return `${hours} ${HOUR_UNIT}${hours === 1 ? '' : 's'} ${WINDOW_SUFFIX}`;
  }
  return `${minutes} ${MINUTE_UNIT} ${WINDOW_SUFFIX}`;
}

export type CodexWindowLabel = {
  title: string;
  subtitle: string;
  isPrimary: boolean;
};

export function getCodexWindowLabel(windowDurationMins: number | null): CodexWindowLabel {
  if (windowDurationMins === SESSION_WINDOW_MINS) {
    return {
      title: translate(SESSION_TITLE),
      subtitle: translate(SESSION_SUBTITLE),
      isPrimary: true,
    };
  }
  if (windowDurationMins === WEEKLY_WINDOW_MINS) {
    return {
      title: translate(WEEKLY_TITLE),
      subtitle: translate(WEEKLY_SUBTITLE),
      isPrimary: false,
    };
  }
  return {
    title: translate(FALLBACK_TITLE),
    subtitle: formatCodexWindowDuration(windowDurationMins),
    isPrimary: false,
  };
}

export function formatCodexResetTime(resetsAt: number | null): string | null {
  if (!resetsAt) return null;
  const date = new Date(resetsAt * MILLISECONDS_PER_SECOND);
  return `${translate(RESET_LABEL)} ${date.toLocaleString(getFormattingLocale())}`;
}

export function formatCodexPlanType(plan: CodexPlanType | null): string {
  if (!plan) return translate(UNKNOWN_LABEL);
  return PLAN_TYPE_LABELS[plan] ?? plan;
}
