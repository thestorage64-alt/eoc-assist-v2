import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  Footer,
  PageNumber,
} from "docx";

function parseInline(text: string): TextRun[] {
  return [new TextRun(text)];
}

export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const children: any[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      i++;
      continue;
    }
    if (/^#{1,3}\s/.test(trimmed)) {
      const level = trimmed.match(/^#+/)![0].length;
      const text = trimmed.replace(/^#+\s*/, "");
      const heading =
        level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      children.push(new Paragraph({ text, heading }));
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
      if (rows.length > 0) {
        const table = new Table({
          rows: rows.map((r) => {
            const cells = r
              .trim()
              .replace(/^\|/, "")
              .replace(/\|$/, "")
              .split("|")
              .map((c) => c.trim());
            return new TableRow({
              children: cells.map((c) => new TableCell({ children: [new Paragraph(c)] })),
            });
          }),
        });
        children.push(table);
      }
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      children.push(
        new Paragraph({
          children: parseInline(line.replace(/^\s*[-*]\s+/, "")),
          bullet: { level: 0 },
        })
      );
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
    children.push(new Paragraph({ children: parseInline(paraLines.join(" ")) }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun(`EOC Assist · generated ${new Date().toISOString().slice(0, 10)}`),
                  new TextRun("\t"),
                  new TextRun("Page "),
                  new TextRun({ children: [PageNumber.CURRENT] }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  return Buffer.from(buf);
}

// aliases
export const docxFromMarkdown = markdownToDocx;
export const toDocx = markdownToDocx;
export const buildDocx = markdownToDocx;
export const renderDocx = markdownToDocx;
export const markdownToDocxBuffer = markdownToDocx;
export default markdownToDocx;
