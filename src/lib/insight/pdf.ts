import PDFDocument from "pdfkit";

export function markdownToPdf(markdown: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (e: any) => reject(e));

    const lines = String(markdown ?? "").split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const trimmed = lines[i].trim();
      if (trimmed === "") {
        doc.moveDown(0.4);
        i++;
        continue;
      }
      if (/^#{1,3}\s/.test(trimmed)) {
        const level = trimmed.match(/^#+/)![0].length;
        const size = level === 1 ? 16 : level === 2 ? 13 : 11;
        doc.font("Helvetica-Bold").fontSize(size).text(trimmed.replace(/^#+\s*/, ""));
        doc.moveDown(0.3);
        i++;
        continue;
      }
      if (trimmed.startsWith("|")) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          tableLines.push(lines[i]);
          i++;
        }
        const rows = tableLines.filter((l) => !/^\|\s*[-:]+\s*(\|\s*[-:]+\s*)*\|?\s*$/.test(l.trim()));
        doc.font("Helvetica").fontSize(9);
        for (const r of rows) {
          const cells = r
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((c) => c.trim());
          doc.text(cells.join("  |  "));
        }
        doc.moveDown(0.4);
        continue;
      }
      if (/^\s*[-*]\s+/.test(lines[i])) {
        doc.font("Helvetica").fontSize(11).text("• " + lines[i].replace(/^\s*[-*]\s+/, "").trim(), { indent: 16 });
        i++;
        continue;
      }
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !lines[i].trim().startsWith("|") &&
        !/^#{1,3}\s/.test(lines[i].trim()) &&
        !/^\s*[-*]\s+/.test(lines[i])
      ) {
        paraLines.push(lines[i].trim());
        i++;
      }
      doc.font("Helvetica").fontSize(11).text(paraLines.join(" "));
      doc.moveDown(0.3);
    }

    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(range.start + p);
      doc.fontSize(8).fillColor("gray").text(
        `EOC Assist · generated ${new Date().toISOString().slice(0, 10)}    Page ${p + 1} of ${range.count}`,
        50,
        doc.page.height - 40,
        { align: "center", width: doc.page.width - 100 }
      );
      doc.fillColor("black");
    }

    doc.end();
  });
}

export const pdfFromMarkdown = markdownToPdf;
export const toPdf = markdownToPdf;
export const buildPdf = markdownToPdf;
export const renderPdf = markdownToPdf;
export default markdownToPdf;
