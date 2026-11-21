/**
 * V9 forecast assumptions (fin_cash_settings). Every default is a stated assumption the company can change; none is an
 * industry benchmark. Benchmarks are only what the company types in (percent of contract by cost type).
 */
export type ExpenseMode = "known" | "historical" | "benchmark";
export type Scenario = "conservative" | "expected" | "optimistic";
export type CollectionBasis = "issue" | "due";

export interface CashSettings {
  minCash: number | null;
  targetGrossMargin: number | null;
  targetNetMargin: number | null;
  collectionDays: number;
  collectionBasis: CollectionBasis;
  useHistory: boolean;
  historyMinSample: number;
  expenseMode: ExpenseMode;
  /** Percent of contract value by cost type, entered by the company. */
  benchmark: Partial<Record<string, number>>;
  payrollFromSchedule: boolean;
  payrollPayLagDays: number;
  payrollBurdenPct: number;
  subPayDays: number;
  supplierPayDays: number;
  conservativeLateDays: number;
  conservativeCostPct: number;
  arGraceDays: number;
  concentrationDays: number;
  concentrationPct: number;
  alertEmail: boolean;
  alertRecipients: string[];
  alertKindsOff: string[];
  saved: boolean;
}

export const DEFAULT_SETTINGS: CashSettings = {
  minCash: null, targetGrossMargin: null, targetNetMargin: null, collectionDays: 7, collectionBasis: "due", useHistory: true, historyMinSample: 3,
  expenseMode: "known", benchmark: {}, payrollFromSchedule: false, payrollPayLagDays: 5, payrollBurdenPct: 0, subPayDays: 7, supplierPayDays: 30,
  conservativeLateDays: 14, conservativeCostPct: 10, arGraceDays: 7, concentrationDays: 7, concentrationPct: 50, alertEmail: false, alertRecipients: [],
  alertKindsOff: [], saved: false,
};

export const COLLECTION_PRESETS = [3, 5, 7, 14, 30] as const;
export const HORIZONS = [7, 14, 30, 60, 90, 180, 365] as const;
export const EXPENSE_MODES: { value: ExpenseMode; label: string; detail: string }[] = [
  { value: "known", label: "Known costs", detail: "Actual costs, approved bills and open commitments; the signed bid's estimate fills what isn't committed yet." },
  { value: "historical", label: "Historical average", detail: "Uncommitted costs follow what your completed jobs actually cost, by cost type (needs enough completed jobs)." },
  { value: "benchmark", label: "Your benchmarks", detail: "Uncommitted costs follow the percent-of-contract figures you set, by cost type." },
];
export const SCENARIOS: { value: Scenario; label: string; detail: string }[] = [
  { value: "conservative", label: "Conservative", detail: "Customers pay later than usual and uncommitted costs run higher (your settings)." },
  { value: "expected", label: "Expected", detail: "Your usual payment times and cost assumptions." },
  { value: "optimistic", label: "Optimistic", detail: "Customers pay on the due date. Costs are never assumed lower than your records." },
];

const num = (v: unknown, d: number) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export function mapSettings(row: Record<string, unknown> | null | undefined): CashSettings {
  if (!row) return { ...DEFAULT_SETTINGS };
  const mode = String(row.expense_mode ?? "known");
  const bench = row.benchmark && typeof row.benchmark === "object" ? (row.benchmark as Record<string, unknown>) : {};
  return {
    minCash: numOrNull(row.min_cash), targetGrossMargin: numOrNull(row.target_gross_margin), targetNetMargin: numOrNull(row.target_net_margin),
    collectionDays: num(row.collection_days, 7), collectionBasis: row.collection_basis === "issue" ? "issue" : "due", useHistory: row.use_history !== false,
    historyMinSample: num(row.history_min_sample, 3), expenseMode: (["known", "historical", "benchmark"].includes(mode) ? mode : "known") as ExpenseMode,
    benchmark: Object.fromEntries(Object.entries(bench).filter(([, v]) => typeof v === "number" && v >= 0 && v <= 100)) as Record<string, number>,
    payrollFromSchedule: row.payroll_from_schedule === true, payrollPayLagDays: num(row.payroll_pay_lag_days, 5), payrollBurdenPct: num(row.payroll_burden_pct, 0),
    subPayDays: num(row.sub_pay_days, 7), supplierPayDays: num(row.supplier_pay_days, 30), conservativeLateDays: num(row.conservative_late_days, 14),
    conservativeCostPct: num(row.conservative_cost_pct, 10), arGraceDays: num(row.ar_grace_days, 7), concentrationDays: num(row.concentration_days, 7),
    concentrationPct: num(row.concentration_pct, 50), alertEmail: row.alert_email === true,
    alertRecipients: Array.isArray(row.alert_recipients) ? (row.alert_recipients as string[]) : [],
    alertKindsOff: Array.isArray(row.alert_kinds_off) ? (row.alert_kinds_off as string[]) : [], saved: true,
  };
}
