/** Hands downloaded bytes to the browser as a file to save. */
export function saveFile(bytes: Blob, fileName: string): void {
  const url = URL.createObjectURL(bytes);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
