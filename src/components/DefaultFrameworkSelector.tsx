import { SettingField } from "@/components/settings/SettingField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/useSettings";
import type { DefaultFramework } from "@/lib/schemas";

export function DefaultFrameworkSelector() {
  const { settings, updateSettings } = useSettings();

  if (!settings) {
    return null;
  }

  const framework = settings.defaultFramework ?? "vite";

  const handleFrameworkChange = (value: DefaultFramework) => {
    updateSettings({ defaultFramework: value });
  };

  const getFrameworkDisplayName = (fw: DefaultFramework) => {
    switch (fw) {
      case "vite":
        return "Vite";
      case "nextjs":
        return "Next.js";
      default:
        return fw;
    }
  };

  const getFrameworkDescription = (fw: DefaultFramework) => {
    switch (fw) {
      case "vite":
        return "Fast dev server and build tool with React";
      case "nextjs":
        return "Full-stack React framework with SSR and routing";
      default:
        return "";
    }
  };

  return (
    <SettingField
      htmlFor="default-framework"
      label="Default Framework"
      description="Choose the default framework for new apps."
    >
      <Select
        value={framework}
        onValueChange={(v) => v && handleFrameworkChange(v as DefaultFramework)}
      >
        <SelectTrigger
          className="w-full sm:w-[240px]"
          id="default-framework"
          aria-describedby="default-framework-description"
        >
          <SelectValue>{getFrameworkDisplayName(framework)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="vite">
            <div className="flex flex-col items-start">
              <span className="font-medium">Vite</span>
              <span className="text-xs text-muted-foreground">
                {getFrameworkDescription("vite")}
              </span>
            </div>
          </SelectItem>
          <SelectItem value="nextjs">
            <div className="flex flex-col items-start">
              <span className="font-medium">Next.js</span>
              <span className="text-xs text-muted-foreground">
                {getFrameworkDescription("nextjs")}
              </span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingField>
  );
}
