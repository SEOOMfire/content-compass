/** Löst einen Markdown-Text als .md-Datei im Browser aus. */
export function downloadMarkdown(filename: string, markdown: string): void {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
