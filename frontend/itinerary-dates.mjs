export function activityDateLabel(cityDates, day) {
  const dayNumber = Number(day);
  if (!Number.isInteger(dayNumber) || dayNumber <= 0) return 'Fecha flexible';

  const match = String(cityDates || '').match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (!match) return 'Fecha a confirmar';

  const [, dayText, monthText, yearText] = match;
  const start = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  if (
    start.getUTCFullYear() !== Number(yearText)
    || start.getUTCMonth() !== Number(monthText) - 1
    || start.getUTCDate() !== Number(dayText)
  ) {
    return 'Fecha a confirmar';
  }

  start.setUTCDate(start.getUTCDate() + dayNumber - 1);
  const month = new Intl.DateTimeFormat('es-AR', { month: 'long', timeZone: 'UTC' }).format(start);
  return `${start.getUTCDate()} de ${month}`;
}
