/** Event age is wall-clock context, never an emotion or an action score. */
export function eventTimeContext(occurredAt: string, now: string): string {
  const seconds = Math.floor((Date.parse(now) - Date.parse(occurredAt)) / 1000);
  if (!Number.isFinite(seconds)) return `原记录时间 ${occurredAt}；无法计算距今时间`;
  if (seconds < 0) return `原记录时间 ${occurredAt} 晚于本轮时刻 ${now}，时间有冲突`;
  const age = seconds < 60 ? `${seconds} 秒`
    : seconds < 3600 ? `${Math.floor(seconds / 60)} 分钟`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分钟`
    : `${Math.floor(seconds / 86400)} 天 ${Math.floor(seconds % 86400 / 3600)} 小时`;
  return `原事件发生于 ${occurredAt}；距本轮时刻 ${now} 已过 ${age}`;
}
