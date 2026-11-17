import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapComplianceSummary, mapEmployees, mapSuppliers, type ComplianceSummary, type EmployeeList, type SupplierList } from "./records";

/** null = the team-records SQL hasn't been applied yet (pages show a "being set up" notice). */
export async function loadSuppliers(supabase: SupabaseClient): Promise<SupplierList | null> {
  const { data, error } = await supabase.rpc("pm_suppliers_list");
  return error || !data ? null : mapSuppliers(data);
}
export async function loadEmployees(supabase: SupabaseClient): Promise<EmployeeList | null> {
  const { data, error } = await supabase.rpc("pm_employees");
  return error || !data ? null : mapEmployees(data);
}
export async function loadComplianceSummary(supabase: SupabaseClient): Promise<{ canManage: boolean; subs: Record<string, ComplianceSummary> } | null> {
  const { data, error } = await supabase.rpc("pm_sub_compliance_summary");
  return error || !data ? null : mapComplianceSummary(data);
}
/** Active projects the caller can see, for the time-clock project picker. */
export async function loadClockProjects(supabase: SupabaseClient): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("project_schedules").select("id, name, status").in("status", ["active", "draft"]).order("updated_at", { ascending: false }).limit(200);
  return ((data ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name }));
}
