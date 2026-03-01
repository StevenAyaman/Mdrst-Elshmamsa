import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

export async function GET() {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("MoveAccountsTemplate");

    const headers = ["Code", "Name", "Old Class", "New Class"];

    ws.mergeCells(1, 1, 1, headers.length);
    const title = ws.getCell(1, 1);
    title.value = "Move Accounts Template";
    title.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    title.alignment = { horizontal: "center", vertical: "middle" };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16A34A" } };
    ws.getRow(1).height = 28;

    ws.addRow(headers);
    ws.addRow(["", "", "", ""]);
    ws.views = [{ state: "frozen", ySplit: 2 }];

    for (let c = 1; c <= headers.length; c += 1) {
      const headerCell = ws.getCell(2, c);
      headerCell.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FF111827" } };
      headerCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      headerCell.alignment = { horizontal: "center", vertical: "middle" };
      headerCell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };

      const dataCell = ws.getCell(3, c);
      dataCell.font = { name: "Calibri", size: 11, color: { argb: "FF111827" } };
      dataCell.alignment = { horizontal: "center", vertical: "middle" };
      dataCell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };

      const width = Math.max(headers[c - 1].length, 14) + 2;
      ws.getColumn(c).width = width;
    }

    ws.getRow(2).height = 22;
    ws.getRow(3).height = 20;

    const notes = wb.addWorksheet("Notes");
    notes.getCell("A1").value = "Required columns: Code, Name, Old Class, New Class.";
    notes.getCell("A2").value = "Name must match existing account name for the same code.";
    notes.getCell("A3").value = "Do not merge cells or add rows above header row.";
    notes.getColumn(1).width = 70;

    const buffer = await wb.xlsx.writeBuffer();
    const bytes = new Uint8Array(buffer as ArrayBuffer);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="move-accounts-template.xlsx"`,
      },
    });
  } catch (error) {
    console.error("GET /api/templates/users-promote-import error:", error);
    return NextResponse.json({ ok: false, message: "Failed to generate template." }, { status: 500 });
  }
}
