export const pad2 = (value: number) => String(value).padStart(2, "0");

export const formatDate = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const formatDateTime = (date: Date) =>
  `${formatDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

export const formatDateTimeSeconds = (date: Date) =>
  `${formatDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;

export const parseDateTime = (value: string) => {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return null;
  const [_, y, m, d, hh, mm, ss] = match;
  const date = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss ?? "0")
  );
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

export const toLocalDateTimeInput = (date: Date) =>
  `${formatDate(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
