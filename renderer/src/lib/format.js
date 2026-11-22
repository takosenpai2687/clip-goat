// 75.5 -> "1:15.50"; hours appear only when needed.
export function formatTime(sec, decimals = 2) {
  const s = Math.max(0, Number(sec) || 0);
  const scale = 10 ** decimals;
  const total = Math.round(s * scale) / scale;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const rest = total - h * 3600 - m * 60;
  const secStr = rest.toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${secStr}` : `${m}:${secStr}`;
}

// Clip length as the headline figure: "3.30" + unit under a minute, otherwise a clock.
export function formatLength(sec) {
  return sec < 60 ? { value: sec.toFixed(2), unit: true } : { value: formatTime(sec, 1), unit: false };
}

export function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDay(ms, t, lang) {
  const day = 86400000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const diff = Math.floor((startOfToday - new Date(ms).setHours(0, 0, 0, 0)) / day);
  const clock = new Date(ms).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  if (diff <= 0) return `${t.today} ${clock}`;
  if (diff === 1) return `${t.yesterday} ${clock}`;
  if (diff < 7) return t.daysAgo(diff);
  return new Date(ms).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
