// Centralized export helpers for invoices: CSV, XLSX, and bulk PDF report.
import type { Invoice } from "./invoice-types";

const HEADERS = [
  "Created",
  "Invoice Date",
  "Invoice #",
  "Seller",
  "Buyer",
  "GSTIN",
  "GSTIN Verified",
  "GSTIN Legal Name",
  "GSTIN Status",
  "GSTIN Source",
  "Taxable",
  "CGST",
  "SGST",
  "IGST",
  "Total",
  "Compliance",
  "Fraud Score",
  "Fraud Risk",
  "Status",
  "Issues",
  "Fraud Reasons",
  "File",
];

function row(inv: Invoice) {
  return [
    inv.created_at?.slice(0, 10) ?? "",
    inv.invoice_date ?? "",
    inv.invoice_number ?? "",
    inv.seller_name ?? "",
    inv.buyer_name ?? "",
    inv.gstin ?? "",
    inv.gstin_verified ? "Yes" : "No",
    inv.gstin_legal_name ?? "",
    inv.gstin_status ?? "",
    inv.gstin_source ?? "",
    inv.taxable_amount ?? "",
    inv.cgst ?? "",
    inv.sgst ?? "",
    inv.igst ?? "",
    inv.total_amount ?? "",
    inv.compliance_score ?? "",
    inv.fraud_score ?? "",
    inv.fraud_risk ?? "",
    inv.status,
    (inv.issues ?? []).map((i) => (typeof i === "string" ? i : `${i.field}: ${i.issue}`)).join(" | "),
    (inv.fraud_reasons ?? []).join(" | "),
    inv.file_name,
  ];
}

export function exportCsv(invoices: Invoice[]) {
  const escape = (v: any) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [HEADERS.join(","), ...invoices.map((i) => row(i).map(escape).join(","))];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `invoice-iq-${stamp()}.csv`);
}

export async function exportXlsx(invoices: Invoice[]) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...invoices.map(row)]);
  // Auto-width
  ws["!cols"] = HEADERS.map((h, idx) => ({
    wch: Math.min(
      40,
      Math.max(
        h.length + 2,
        ...invoices.map((inv) => String(row(inv)[idx] ?? "").length + 2),
      ),
    ),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Invoices");
  XLSX.writeFile(wb, `invoice-iq-${stamp()}.xlsx`);
}

export async function exportBulkPdf(invoices: Invoice[]) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape" });

  // Cover stats
  const total = invoices.length;
  const valid = invoices.filter((i) => i.status === "valid").length;
  const warning = invoices.filter((i) => i.status === "warning").length;
  const error = invoices.filter((i) => i.status === "error").length;
  const high = invoices.filter((i) => i.fraud_risk === "high").length;
  const totalValue = invoices.reduce((s, i) => s + Number(i.total_amount ?? 0), 0);
  const avgComp = total
    ? Math.round(invoices.reduce((s, i) => s + (i.compliance_score ?? 0), 0) / total)
    : 0;

  doc.setFontSize(20);
  doc.text("Invoice IQ", 14, 18);
  doc.setFontSize(11);
  doc.setTextColor(120);
  doc.text("GST Compliance Report", 14, 25);
  doc.setTextColor(0);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, 14, 32);

  autoTable(doc, {
    startY: 38,
    theme: "plain",
    styles: { fontSize: 9 },
    body: [
      ["Total invoices", String(total), "Valid", String(valid)],
      ["Warnings", String(warning), "Errors", String(error)],
      ["High fraud risk", String(high), "Avg compliance", `${avgComp}/100`],
      [
        "Total value",
        `Rs. ${totalValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
        "",
        "",
      ],
    ],
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 45 },
      2: { fontStyle: "bold", cellWidth: 45 },
    },
  });

  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 8,
    head: [["Date", "Seller", "GSTIN", "Inv #", "Total", "Comp.", "Risk", "Status"]],
    body: invoices.map((r) => [
      r.invoice_date ?? r.created_at.slice(0, 10),
      (r.seller_name ?? "—").slice(0, 32),
      r.gstin ?? "—",
      r.invoice_number ?? "—",
      r.total_amount != null ? `Rs.${Number(r.total_amount).toFixed(2)}` : "—",
      r.compliance_score != null ? `${r.compliance_score}` : "—",
      r.fraud_risk ?? "—",
      r.status,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [16, 79, 56] },
    didParseCell: (d) => {
      if (d.section === "body" && d.column.index === 7) {
        const v = String(d.cell.raw);
        if (v === "error") d.cell.styles.textColor = [200, 30, 30];
        else if (v === "warning") d.cell.styles.textColor = [180, 120, 0];
        else if (v === "valid") d.cell.styles.textColor = [16, 130, 80];
      }
    },
  });

  doc.save(`invoice-iq-report-${stamp()}.pdf`);
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
