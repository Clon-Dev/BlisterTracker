// Web: the CSV is a normal download; the PDF comes from the browser's print dialog ("Save as PDF").

export async function saveCsv(csv: string, fileName: string, _dialogTitle: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Prints the table from a hidden frame, so only it ends up in the PDF (the page size comes from its @page rule). */
export async function savePdf(html: string, _fileName: string, _dialogTitle: string, _landscape: boolean) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  await new Promise((r) => setTimeout(r, 250)); // layout and fonts
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 60_000); // some browsers print asynchronously
}
