const SmsCsv = Object.freeze({
  cell(value) {
    const text = String(value ?? "");
    const safeText =
      typeof value === "string" && /^[\t\r\n ]*[=+\-@]/.test(text)
        ? `'${text}`
        : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  },
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = SmsCsv;
}
