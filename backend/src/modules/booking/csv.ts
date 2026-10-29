/** Keep spreadsheet formulas as text, then escape the CSV field delimiters. */
export const csvCell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  // Spreadsheet importers may ignore leading spaces and control characters.
  const safe = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(text)
    ? `'${text}`
    : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
