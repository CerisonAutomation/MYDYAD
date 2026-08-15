// Cloud Sandbox Experiment Switch — disabled (cloud sandbox removed).
// All execution is now local. Kept for backward compatibility with settings UI.
export function CloudSandboxExperimentSwitch() {
  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2 text-muted-foreground">
        <span className="text-sm">
          Cloud Sandbox is no longer available. All execution runs locally.
        </span>
      </div>
    </div>
  );
}
