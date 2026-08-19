import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ipc } from "@/ipc/types";
import { useEffect, useState } from "react";

interface HealthStatus {
  status: "healthy" | "degraded" | "critical";
  checks: {
    database: "ok" | "error";
    memory: "ok" | "warning" | "critical";
    eventLoop: "ok" | "lagging";
  };
  timestamp: number;
}

export function PerformanceDashboard() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const result = await ipc.health.check({});
        setHealth(result);
      } catch {
        setHealth(null);
      } finally {
        setLoading(false);
      }
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div>Loading health status...</div>;
  if (!health) return <div>Health check unavailable</div>;

  const statusColor = {
    healthy: "text-green-600",
    degraded: "text-amber-600",
    critical: "text-red-600",
  }[health.status];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${statusColor === "text-green-600" ? "bg-green-600" : statusColor === "text-amber-600" ? "bg-amber-600" : "bg-red-600"}`}
          />
          System Health: <span className={statusColor}>{health.status}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Database</div>
            <div
              className={`font-medium ${health.checks.database === "ok" ? "text-green-600" : "text-red-600"}`}
            >
              {health.checks.database === "ok" ? "OK" : "Error"}
            </div>
          </div>
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Memory</div>
            <div
              className={`font-medium ${health.checks.memory === "ok" ? "text-green-600" : health.checks.memory === "warning" ? "text-amber-600" : "text-red-600"}`}
            >
              {health.checks.memory === "ok"
                ? "OK"
                : health.checks.memory === "warning"
                  ? "Warning"
                  : "Critical"}
            </div>
          </div>
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Event Loop</div>
            <div
              className={`font-medium ${health.checks.eventLoop === "ok" ? "text-green-600" : "text-red-600"}`}
            >
              {health.checks.eventLoop === "ok" ? "OK" : "Lagging"}
            </div>
          </div>
        </div>
        <div className="mt-4 text-xs text-muted-foreground text-center">
          Last checked: {new Date(health.timestamp).toLocaleTimeString()}
        </div>
      </CardContent>
    </Card>
  );
}
