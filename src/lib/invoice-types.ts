// Shared invoice row type used across list, dashboard, and exports.
export interface Invoice {
  id: string;
  user_id: string;
  file_name: string;
  file_path: string;
  status: "processing" | "valid" | "warning" | "error";
  fraud_risk: "low" | "medium" | "high" | null;
  fraud_score: number | null;
  fraud_reasons: string[] | null;
  compliance_score: number | null;
  gstin: string | null;
  gstin_verified: boolean | null;
  gstin_legal_name: string | null;
  gstin_trade_name: string | null;
  gstin_status: string | null;
  gstin_source: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  seller_name: string | null;
  buyer_name: string | null;
  taxable_amount: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  total_amount: number | null;
  issues: Array<string | ValidationItem> | null;
  suggestions: string[] | null;
  created_at: string;
}
