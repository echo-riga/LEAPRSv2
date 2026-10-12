type RequestReportPdfRow = {
  title: string;
  eventDate: string;
  allottedBudget: string;
  utilizedBudget: string;
  evaluationAverage: number | null;
  setting: string;
};

type RequestReportPdfData = {
  label: string;
  completed: RequestReportPdfRow[];
  inProgress: RequestReportPdfRow[];
  rejected: RequestReportPdfRow[];
};

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PRIMARY = "#2e7d32";
const PRIMARY_DARK = "#005005";
const PRIMARY_PALE = "#e8f5e9";
const TEXT = "#1c281c";
const MUTED = "#566556";
const BORDER = "#d7e2d7";
const SURFACE = "#fafcfa";

function ascii(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/₱/g, "PHP ")
    .replace(/[^\x20-\x7E]/g, "?");
}

function escapePdfText(value: string) {
  return ascii(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function rgb(hex: string) {
  const value = hex.replace("#", "");
  return [0, 2, 4]
    .map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel.toFixed(3))
    .join(" ");
}

function wrapText(value: string, width: number, fontSize: number) {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  const limit = Math.max(5, Math.floor(width / (fontSize * 0.54)));
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length > limit) {
      if (line) lines.push(line);
      for (let offset = 0; offset < word.length; offset += limit)
        lines.push(word.slice(offset, offset + limit));
      line = "";
    } else if (!line || `${line} ${word}`.length <= limit) {
      line = line ? `${line} ${word}` : word;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function formatDate(value: string) {
  if (!value) return "None";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatMoney(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `PHP ${new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`
    : "PHP 0.00";
}

function rect(
  x: number,
  top: number,
  width: number,
  height: number,
  fill?: string,
  stroke?: string,
) {
  const y = PAGE_HEIGHT - top - height;
  const commands: string[] = ["q"];
  if (fill) commands.push(`${rgb(fill)} rg`);
  if (stroke) commands.push(`${rgb(stroke)} RG 0.7 w`);
  commands.push(
    `${x} ${y} ${width} ${height} re ${fill && stroke ? "B" : fill ? "f" : "S"}`,
    "Q",
  );
  return commands.join("\n");
}

function text(
  value: string,
  x: number,
  top: number,
  size: number,
  color = TEXT,
  bold = false,
) {
  return `BT /${bold ? "F2" : "F1"} ${size} Tf ${rgb(color)} rg 1 0 0 1 ${x} ${PAGE_HEIGHT - top - size} Tm (${escapePdfText(value)}) Tj ET`;
}

function addLines(
  commands: string[],
  lines: string[],
  x: number,
  top: number,
  size: number,
  color = TEXT,
  bold = false,
  lineHeight = size + 2,
) {
  lines.forEach((line, index) =>
    commands.push(text(line, x, top + index * lineHeight, size, color, bold)),
  );
}

function createPdf(pages: string[]) {
  const objects: string[] = [];
  const pageObjectNumbers = pages.map((_, index) => 5 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((content, index) => {
    const pageNumber = pageObjectNumbers[index];
    const contentNumber = pageNumber + 1;
    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`;
    objects[contentNumber] =
      `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`;
  });

  let output = "%PDF-1.4\n%LEAPRS\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(output, "ascii");
    output += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1)
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, "ascii");
}

export function renderRequestReportPdf(report: RequestReportPdfData) {
  const pages: string[][] = [];
  let commands: string[] = [];
  let cursor = 0;

  const startPage = (continuation = false) => {
    if (commands.length) pages.push(commands);
    commands = [];
    commands.push(rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, "#ffffff"));
    commands.push(rect(0, 0, PAGE_WIDTH, 8, PRIMARY));
    commands.push(text("LEAPRS", MARGIN, 27, 10, PRIMARY_DARK, true));
    commands.push(
      text("REQUEST REPORT", MARGIN, 44, continuation ? 18 : 24, TEXT, true),
    );
    commands.push(
      text(
        `Report as of ${report.label}`,
        MARGIN,
        continuation ? 68 : 76,
        11,
        MUTED,
      ),
    );
    cursor = continuation ? 98 : 108;
  };

  const ensureSpace = (height: number, section?: string) => {
    if (cursor + height <= PAGE_HEIGHT - 42) return;
    startPage(true);
    if (section) addTableHeader(`${section} (continued)`);
  };

  const addTableHeader = (section: string) => {
    commands.push(rect(MARGIN, cursor, CONTENT_WIDTH, 28, PRIMARY, PRIMARY));
    commands.push(text(section, MARGIN + 12, cursor + 8, 10, "#ffffff", true));
    cursor += 28;
    const headers = [
      "Activity title",
      "Date of event",
      "Allotted budget",
      "Utilized budget",
      "Evaluation result",
    ];
    const widths = [244, 100, 140, 140, 146];
    let x = MARGIN;
    headers.forEach((header, index) => {
      commands.push(rect(x, cursor, widths[index], 30, PRIMARY_PALE, BORDER));
      commands.push(text(header, x + 8, cursor + 10, 8.5, PRIMARY_DARK, true));
      x += widths[index];
    });
    cursor += 30;
  };

  startPage();
  const totals = [
    ["Completed", report.completed.length],
    ["In progress", report.inProgress.length],
    ["Rejected", report.rejected.length],
  ] as const;
  const summaryWidth = (CONTENT_WIDTH - 20) / 3;
  totals.forEach(([label, count], index) => {
    const x = MARGIN + index * (summaryWidth + 10);
    commands.push(rect(x, cursor, summaryWidth, 48, SURFACE, BORDER));
    commands.push(text(String(count), x + 12, cursor + 9, 17, PRIMARY, true));
    commands.push(text(label, x + 12, cursor + 30, 8.5, MUTED, true));
  });
  cursor += 66;

  const sections: Array<[string, RequestReportPdfRow[]]> = [
    ["Completed", report.completed],
    ["In Progress", report.inProgress],
    ["Rejected", report.rejected],
  ];
  const widths = [244, 100, 140, 140, 146];

  sections.forEach(([section, rows]) => {
    ensureSpace(74);
    addTableHeader(section);
    if (!rows.length) {
      commands.push(rect(MARGIN, cursor, CONTENT_WIDTH, 34, "#ffffff", BORDER));
      commands.push(
        text(
          "No requests for this period.",
          MARGIN + 12,
          cursor + 11,
          9,
          MUTED,
        ),
      );
      cursor += 50;
      return;
    }
    rows.forEach((row) => {
      const values = [
        row.title,
        formatDate(row.eventDate),
        formatMoney(row.allottedBudget),
        formatMoney(row.utilizedBudget),
        row.setting === "external" || row.evaluationAverage === null
          ? "None"
          : row.evaluationAverage.toFixed(1),
      ];
      const wrapped = values.map((value, index) =>
        wrapText(value, widths[index] - 16, 8.5),
      );
      const rowHeight = Math.max(
        32,
        12 + Math.max(...wrapped.map((lines) => lines.length)) * 11,
      );
      ensureSpace(rowHeight, section);
      let x = MARGIN;
      wrapped.forEach((lines, index) => {
        commands.push(
          rect(x, cursor, widths[index], rowHeight, "#ffffff", BORDER),
        );
        addLines(
          commands,
          lines,
          x + 8,
          cursor + 9,
          8.5,
          index === 0 ? TEXT : MUTED,
          index === 0,
          11,
        );
        x += widths[index];
      });
      cursor += rowHeight;
    });
    cursor += 16;
  });

  if (commands.length) pages.push(commands);
  pages.forEach((page, index) => {
    page.push(
      text(
        `Page ${index + 1} of ${pages.length}`,
        PAGE_WIDTH - MARGIN - 64,
        PAGE_HEIGHT - 25,
        8,
        MUTED,
      ),
    );
    page.push(text("Generated by LEAPRS", MARGIN, PAGE_HEIGHT - 25, 8, MUTED));
  });
  return createPdf(pages.map((page) => page.join("\n")));
}
