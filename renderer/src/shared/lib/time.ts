function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function isYesterday(date: Date, now: Date) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return isSameDay(date, yesterday);
}

function isWithinLastWeek(date: Date, now: Date) {
  const diff = now.getTime() - date.getTime();
  return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000;
}

export function formatClockTime(time: number | null) {
  if (!time) return '';
  return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function formatTime(time: number | null): string {
  if (!time) return '';

  const date = new Date(time);
  const now = new Date();

  if (isSameDay(date, now)) {
    return formatClockTime(time);
  }

  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function formatConversationListTime(time: number | null): string {
  if (!time) return '';

  const date = new Date(time);
  const now = new Date();

  if (isSameDay(date, now)) return formatClockTime(time);
  if (isYesterday(date, now)) return '昨天';
  if (isWithinLastWeek(date, now)) {
    return date.toLocaleDateString('zh-CN', { weekday: 'short' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

export function formatConversationDividerTime(time: number | null): string {
  if (!time) return '';

  const date = new Date(time);
  const now = new Date();
  const clock = formatClockTime(time);

  if (isSameDay(date, now)) return `今天 ${clock}`;
  if (isYesterday(date, now)) return `昨天 ${clock}`;
  if (isWithinLastWeek(date, now)) {
    return `${date.toLocaleDateString('zh-CN', { weekday: 'short' })} ${clock}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${clock}`;
  }
  return `${date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })} ${clock}`;
}

export function getConversationDividerLabel(time: number | null, previousTime: number | null, gapMinutes = 30) {
  if (!time) return null;
  if (!previousTime) return formatConversationDividerTime(time);

  const date = new Date(time);
  const previousDate = new Date(previousTime);
  if (!isSameDay(date, previousDate)) {
    return formatConversationDividerTime(time);
  }

  if (time - previousTime >= gapMinutes * 60 * 1000) {
    return formatConversationDividerTime(time);
  }

  return null;
}
