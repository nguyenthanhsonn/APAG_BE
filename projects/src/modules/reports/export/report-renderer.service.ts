import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { FlatExportRow } from '../types/report.types';
import { EXPORT_COLUMNS } from '../constants/export-columns.constant';
import type { ReportFormat } from '../../../infrastructure/queue/queue.types';

// This provider is loaded only by the worker module, never instantiated by the API.
@Injectable()
export class ReportRenderer {
  async render(format: ReportFormat, rows: FlatExportRow[]): Promise<Buffer> {
    if (format === 'pdf') return this.pdf(rows);
    if (format === 'xlsx') {
      const book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet('Kết quả rèn luyện');
      sheet.columns = EXPORT_COLUMNS.map((column) => ({ ...column }));
      sheet.getRow(1).font = { bold: true };
      sheet.addRows(rows);
      return Buffer.from(await book.xlsx.writeBuffer());
    }
    const values = [
      EXPORT_COLUMNS.map((c) => c.header),
      ...rows.map((row) => EXPORT_COLUMNS.map((c) => String(row[c.key] ?? ''))),
    ];
    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: values.map(
        (row, index) =>
          new TableRow({
            tableHeader: index === 0,
            children: row.map(
              (text) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text, bold: index === 0, size: 16 }),
                      ],
                    }),
                  ],
                }),
            ),
          }),
      ),
    });
    return Packer.toBuffer(
      new Document({
        sections: [
          {
            properties: {
              page: {
                size: { orientation: 'landscape', width: 16838, height: 11906 },
              },
            },
            children: [
              new Paragraph({
                text: 'Bảng kết quả rèn luyện sinh viên',
                heading: 'Heading1',
              }),
              table,
            ],
          },
        ],
      }),
    );
  }
  private pdf(rows: FlatExportRow[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        margin: 30,
        size: 'A4',
        layout: 'landscape',
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.once('error', reject);
      doc.once('end', () => resolve(Buffer.concat(chunks)));
      doc.registerFont(
        'ReportRegular',
        join(__dirname, '../../../../assets/fonts/NotoSans-Regular.ttf'),
      );
      doc.registerFont(
        'ReportBold',
        join(__dirname, '../../../../assets/fonts/NotoSans-Bold.ttf'),
      );
      doc
        .font('ReportRegular')
        .fontSize(14)
        .text('Bảng kết quả rèn luyện sinh viên', { align: 'center' });
      doc.moveDown();
      const width = (doc.page.width - 60) / EXPORT_COLUMNS.length;
      let y = doc.y;
      const draw = (values: string[], header = false) => {
        doc.font(header ? 'ReportBold' : 'ReportRegular').fontSize(8);
        values.forEach((text, index) =>
          doc.text(text, 30 + index * width, y, {
            width,
            height: 20,
            ellipsis: true,
          }),
        );
        y += 20;
      };
      const headers = EXPORT_COLUMNS.map((c) => c.header);
      draw(headers, true);
      for (const row of rows) {
        if (y > doc.page.height - 50) {
          doc.addPage();
          y = 30;
          draw(headers, true);
        }
        draw(EXPORT_COLUMNS.map((c) => String(row[c.key] ?? '')));
      }
      doc.end();
    });
  }
}
