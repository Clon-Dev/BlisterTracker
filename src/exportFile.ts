// Android / iOS: write the export into the cache and open the share sheet (save to files, send by mail, …).
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

/** A4 in PostScript points. */
const A4 = { short: 595, long: 842 };

export async function saveCsv(csv: string, fileName: string, dialogTitle: string) {
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle, UTI: "public.comma-separated-values-text" });
}

export async function savePdf(html: string, fileName: string, dialogTitle: string, landscape: boolean) {
  const { uri } = await Print.printToFileAsync({ html, width: landscape ? A4.long : A4.short, height: landscape ? A4.short : A4.long });
  // printToFileAsync picks a random name; the shared file gets a readable one.
  const target = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.moveAsync({ from: uri, to: target });
  await Sharing.shareAsync(target, { mimeType: "application/pdf", dialogTitle, UTI: "com.adobe.pdf" });
}
