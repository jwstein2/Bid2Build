/** Worker's own profile and the open jobs they're on (pm_worker_my_profile). Never pay, tax, bank or ID numbers. */
export interface WorkerJob { scheduleId: string; name: string; status: string; address: string | null; openTasks: number; nextDate: string | null; lastDate: string | null }
export interface WorkerProfile {
  resourceId: string; name: string; companyName: string | null; title: string | null; trades: string[]; hireDate: string | null;
  workEmail: string | null; workPhone: string | null; preferredName: string | null; personalPhone: string | null; personalEmail: string | null;
  employmentType: string | null; department: string | null; workLocation: string | null; supervisorName: string | null;
  emergencyName: string | null; emergencyRelation: string | null; emergencyPhone: string | null; jobs: WorkerJob[];
}
/** The fields a worker may change themself. */
export const SELF_FIELDS = ["preferredName", "personalPhone", "personalEmail", "emergencyName", "emergencyRelation", "emergencyPhone"] as const;
export type SelfField = (typeof SELF_FIELDS)[number];

export const EMPLOYMENT_LABEL: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", seasonal: "Seasonal", temporary: "Temporary", intern: "Intern" };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export function mapWorkerProfiles(raw: unknown): WorkerProfile[] {
  return arr(raw).map((p) => ({
    resourceId: String(p.resourceId), name: String(p.name ?? ""), companyName: str(p.companyName), title: str(p.title),
    trades: Array.isArray(p.trades) ? (p.trades as unknown[]).map(String) : [], hireDate: str(p.hireDate),
    workEmail: str(p.workEmail), workPhone: str(p.workPhone), preferredName: str(p.preferredName), personalPhone: str(p.personalPhone), personalEmail: str(p.personalEmail),
    employmentType: str(p.employmentType), department: str(p.department), workLocation: str(p.workLocation), supervisorName: str(p.supervisorName),
    emergencyName: str(p.emergencyName), emergencyRelation: str(p.emergencyRelation), emergencyPhone: str(p.emergencyPhone),
    jobs: arr(p.jobs).map((j) => ({
      scheduleId: String(j.scheduleId), name: String(j.name ?? ""), status: String(j.status ?? "active"), address: str(j.address),
      openTasks: Number(j.openTasks) || 0, nextDate: str(j.nextDate)?.slice(0, 10) ?? null, lastDate: str(j.lastDate)?.slice(0, 10) ?? null,
    })),
  }));
}
