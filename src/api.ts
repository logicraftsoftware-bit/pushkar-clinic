import type { Role } from "./data";
import { Activity } from "lucide-react";
import {
  roleMetrics,
  trendData,
  departments,
  queue,
  activityFeed,
} from "./data";

export type DashboardFilters = {
  from?: string;
  to?: string;
  branchId?: string;
  departmentId?: string;
  doctorId?: string;
};

const paths: Record<Role, string> = {
  "Clinic Admin": "/api/v1/dashboard/hospital",
  Reception: "/api/v1/dashboard/reception",
  Doctor: "/api/v1/dashboard/doctor",
  Nurse: "/api/v1/dashboard/nurse",
  Laboratory: "/api/v1/dashboard/laboratory",
  Pharmacy: "/api/v1/dashboard/pharmacy",
  Patient: "/api/v1/dashboard/patient",
  "Branch Admin": "/api/v1/dashboard/hospital",
  "Inventory Manager": "/api/v1/dashboard/hospital",
  Accountant: "/api/v1/dashboard/hospital",
  "HR Manager": "/api/v1/dashboard/hospital",
  Radiologist: "/api/v1/dashboard/laboratory",
  Broker: "/api/v1/referrals/broker-dashboard",
  "Super Admin": "/api/v1/admin/dashboard",
};

export async function getDashboard(
  role: Role,
  filters: DashboardFilters = {},
  token?: string,
): Promise<any> {
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  ).toString();
  const endpoint = `${paths[role]}${query ? `?${query}` : ""}`;

  if (token && role !== "Super Admin") {
    const response = await fetch(
      `${import.meta.env.VITE_API_URL ?? ""}${endpoint}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) throw new Error("Unable to load dashboard");
    const result = await response.json();
    return {
      ...result,
      metrics: result.metrics.map(
        (metric: Record<string, unknown>, index: number) => ({
          ...metric,
          icon: (roleMetrics[role as keyof typeof roleMetrics] ?? roleMetrics["Clinic Admin"])[index]?.icon ?? Activity,
        }),
      ),
      trendData: result.trendData.map((point: Record<string, number>) => ({
        ...point,
        revenue: Number(point.revenue || 0) / 1000,
        previous: Number(point.previous || 0) / 1000,
      })),
      departments: result.departments.map((item: Record<string, unknown>) => ({
        ...item,
        amount: `₹${Number(item.amount || 0).toLocaleString("en-IN")}`,
      })),
      activityFeed: result.activityFeed.map(
        (item: Record<string, unknown>, index: number) => ({
          ...item,
          icon: activityFeed[index % activityFeed.length]?.icon ?? Activity,
          time: relativeTime(String(item.occurredAt)),
          value:
            item.title === "Payment received"
              ? `+ ₹${Number(item.value || 0).toLocaleString("en-IN")}`
              : String(item.value ?? ""),
        }),
      ),
    };
  }

  await new Promise((resolve) => setTimeout(resolve, 350));
  return {
    endpoint,
    metrics: roleMetrics[role as keyof typeof roleMetrics] ?? roleMetrics["Clinic Admin"],
    trendData,
    departments,
    queue,
    activityFeed,
    generatedAt: new Date().toISOString(),
  };
}

function relativeTime(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)} sec`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr`;
  return `${Math.floor(seconds / 86400)} day`;
}
