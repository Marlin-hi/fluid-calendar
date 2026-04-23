import { useEffect } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { useCalendarStore } from "@/store/calendar";
import { useSettingsStore } from "@/store/settings";

import { SettingRow, SettingsSection } from "./SettingsSection";

export function FocusBudgetSettings() {
  const { focusBudget, updateFocusBudgetSettings } = useSettingsStore();
  const feeds = useCalendarStore((s) => s.feeds);
  const loadFromDatabase = useCalendarStore((s) => s.loadFromDatabase);

  useEffect(() => {
    if (feeds.length === 0) {
      loadFromDatabase();
    }
  }, [feeds.length, loadFromDatabase]);

  const selectableFeeds = feeds.filter((f) => f.enabled);

  return (
    <SettingsSection
      title="Focus Budget"
      description="Track how many hours of focus time you have scheduled this week. Events in the selected calendar count towards your weekly target."
    >
      <SettingRow
        label="Enable focus budget"
        description="Show the weekly focus budget badge in the top bar."
      >
        <Switch
          checked={focusBudget.enabled}
          onCheckedChange={(v) => updateFocusBudgetSettings({ enabled: v })}
        />
      </SettingRow>

      <SettingRow
        label="Focus calendar"
        description="Events in this calendar count as focus time."
      >
        <Select
          value={focusBudget.feedId ?? undefined}
          onValueChange={(value) =>
            updateFocusBudgetSettings({ feedId: value || null })
          }
          disabled={!focusBudget.enabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a calendar" />
          </SelectTrigger>
          <SelectContent>
            {selectableFeeds.length === 0 ? (
              <SelectItem value="__none" disabled>
                No calendars available
              </SelectItem>
            ) : (
              selectableFeeds.map((feed) => (
                <SelectItem key={feed.id} value={feed.id}>
                  {feed.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow
        label="Target (hours per week)"
        description="Weekly focus hour target. 30h is the default."
      >
        <Input
          type="number"
          min={0}
          max={80}
          step={0.5}
          value={focusBudget.targetHours}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) {
              updateFocusBudgetSettings({ targetHours: n });
            }
          }}
          disabled={!focusBudget.enabled}
        />
      </SettingRow>

      <SettingRow
        label="Tolerance (hours)"
        description="Budget is shown green if usage is within target ± tolerance. Red otherwise."
      >
        <Input
          type="number"
          min={0}
          max={20}
          step={0.5}
          value={focusBudget.toleranceHours}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) {
              updateFocusBudgetSettings({ toleranceHours: n });
            }
          }}
          disabled={!focusBudget.enabled}
        />
      </SettingRow>
    </SettingsSection>
  );
}
