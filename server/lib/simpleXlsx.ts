import { azureCaseRows } from "../../src/lib/format";
import type { Generation } from "../../src/lib/schemas";
import type { AzureExportConfig } from "./excel";
import { sanitizeFilename } from "./http";

type ZipPart = { name: string; data: Uint8Array };

const encoder = new TextEncoder();
const crcTable = makeCrcTable();

export function buildAzureImportXlsx(generation: Generation, azureConfig: AzureExportConfig = {}) {
  const sheetRows = azureRows(generation, azureConfig);
  const files: ZipPart[] = [
    { name: "[Content_Types].xml", data: text(contentTypesXml()) },
    { name: "_rels/.rels", data: text(rootRelsXml()) },
    { name: "xl/workbook.xml", data: text(workbookXml()) },
    { name: "xl/_rels/workbook.xml.rels", data: text(workbookRelsXml()) },
    { name: "xl/styles.xml", data: text(stylesXml()) },
    { name: "xl/worksheets/sheet1.xml", data: text(sheetXml(sheetRows)) }
  ];
  return zip(files);
}

export function azureImportFilename(generation: Generation, suffix = "") {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  const base = `${sanitizeFilename(generation.requirement.projectName)}_${sanitizeFilename(generation.requirement.moduleName)}_Azure_DevOps_Test_Cases_${stamp}`;
  return `${base}${suffix}.xlsx`;
}

function azureRows(generation: Generation, azureConfig: AzureExportConfig) {
  const header = ["ID", "Work Item Type", "Title", "Test Step", "Step Action", "Step Expected", "Area Path", "Assigned To", "State"];
  const state = safeCell(azureConfig.state || "Design");
  const areaPath = safeCell(azureConfig.areaPath || `${generation.requirement.projectName}\\${generation.requirement.moduleName}`);
  const assignedTo = safeCell(azureConfig.assignedTo || "");
  const rows = [header];
  generation.testCases.forEach((testCase) => {
    azureCaseRows(testCase).forEach((row, index) => {
      const isMetadata = index === 0;
      rows.push([
        row.id,
        row.workItemType,
        truncateTitle(row.title),
        row.testStep,
        row.stepAction,
        row.stepExpected,
        isMetadata ? areaPath : "",
        isMetadata ? assignedTo : "",
        isMetadata ? state : ""
      ].map((value) => safeCell(value)));
    });
  });
  return rows;
}

function sheetXml(rows: Array<Array<string | number>>) {
  const xmlRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
      if (typeof value === "number") return `<c r="${ref}"${rowIndex === 0 ? ' s="1"' : ""}><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ""}><is><t>${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols><col min="1" max="1" width="10" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="3" width="60" customWidth="1"/><col min="4" max="4" width="12" customWidth="1"/><col min="5" max="5" width="55" customWidth="1"/><col min="6" max="6" width="60" customWidth="1"/><col min="7" max="7" width="30" customWidth="1"/><col min="8" max="8" width="25" customWidth="1"/><col min="9" max="9" width="15" customWidth="1"/></cols>
<sheetData>${xmlRows}</sheetData>
<autoFilter ref="A1:I1"/>
</worksheet>`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet2" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function workbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><name val="Segoe UI"/><sz val="11"/></font><font><b/><name val="Segoe UI"/><sz val="11"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>
</styleSheet>`;
}

function zip(files: ZipPart[]) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = text(file.name);
    const crc = crc32(file.data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(file.data.length), u32(file.data.length), u16(name.length), u16(0), name, file.data
    ]);
    localParts.push(local);
    centralParts.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(file.data.length), u32(file.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name
    ]));
    offset += local.length;
  }
  const central = concat(centralParts);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)]);
  return concat([...localParts, central, end]);
}

function text(value: string) {
  return encoder.encode(value);
}

function safeCell(value: unknown) {
  const textValue = String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  return /^[=+\-@]/.test(textValue) ? `'${textValue}` : textValue;
}

function truncateTitle(value: string) {
  return value.length > 128 ? `${value.slice(0, 125)}...` : value;
}

function escapeXml(value: string | number) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index: number) {
  let name = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(((n - 1) % 26) + 65) + name;
  return name;
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function u16(value: number) {
  const data = new Uint8Array(2);
  new DataView(data.buffer).setUint16(0, value, true);
  return data;
}

function u32(value: number) {
  const data = new Uint8Array(4);
  new DataView(data.buffer).setUint32(0, value >>> 0, true);
  return data;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}
