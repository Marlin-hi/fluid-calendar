import { useMemo } from "react";

import { HiX } from "react-icons/hi";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { newDate } from "@/lib/date-utils";

import { useProjectStore } from "@/store/project";
import { useTaskStore } from "@/store/task";
import { useTaskListViewSettings } from "@/store/taskListViewSettings";

import { EnergyLevel, Task, TaskStatus, TimePreference } from "@/types/task";

import { SortableHeader, StatusFilter, TaskRow } from "./components";
import { formatEnumValue } from "./utils/task-list-utils";

interface TaskListProps {
  tasks: Task[];
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onInlineEdit: (task: Task) => void;
}

export function TaskList({
  tasks,
  onEdit,
  onDelete,
  onStatusChange,
  onInlineEdit,
}: TaskListProps) {
  const {
    sortBy,
    sortDirection,
    status,
    energyLevel,
    timePreference,
    tagIds,
    search,
    hideUpcomingTasks,
    setSortBy,
    setSortDirection,
    setFilters,
    resetFilters,
  } = useTaskListViewSettings();
  const { activeProject, projects } = useProjectStore();
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds);
  const selectAll = useTaskStore((s) => s.selectAll);
  const clearSelection = useTaskStore((s) => s.clearSelection);
  const bulkAssignToProject = useTaskStore((s) => s.bulkAssignToProject);
  const bulkDelete = useTaskStore((s) => s.bulkDelete);
  const bulkSetStatus = useTaskStore((s) => s.bulkSetStatus);

  const handleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDirection("desc");
    }
  };

  // First, filter by project
  const projectFilteredTasks = activeProject
    ? activeProject.id === "no-project"
      ? tasks.filter((task) => !task.projectId)
      : tasks.filter((task) => task.projectId === activeProject.id)
    : tasks;

  // Then apply other filters
  const filteredTasks = useMemo(() => {
    const now = newDate();

    return projectFilteredTasks.filter((task) => {
      // Status filter
      if (status?.length && !status.includes(task.status)) {
        return false;
      }

      // Hide future tasks
      if (
        hideUpcomingTasks &&
        task.startDate &&
        newDate(task.startDate) > now
      ) {
        return false;
      }

      // Energy level filter
      if (
        energyLevel?.length &&
        (!task.energyLevel || !energyLevel.includes(task.energyLevel))
      ) {
        return false;
      }

      // Time preference filter
      if (
        timePreference?.length &&
        (!task.preferredTime || !timePreference.includes(task.preferredTime))
      ) {
        return false;
      }

      // Tags filter
      if (tagIds?.length) {
        const taskTagIds = task.tags.map((t) => t.id);
        if (!tagIds.some((id) => taskTagIds.includes(id))) {
          return false;
        }
      }

      // Search
      if (search) {
        const searchLower = search.toLowerCase();
        return (
          task.title.toLowerCase().includes(searchLower) ||
          task.description?.toLowerCase().includes(searchLower) ||
          task.tags.some((tag) => tag.name.toLowerCase().includes(searchLower))
        );
      }

      return true;
    });
  }, [
    projectFilteredTasks,
    status,
    energyLevel,
    timePreference,
    tagIds,
    search,
    hideUpcomingTasks,
  ]);

  // Apply sorting
  const sortedTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      const direction = sortDirection === "asc" ? 1 : -1;
      switch (sortBy) {
        case "title":
          return direction * a.title.localeCompare(b.title);
        case "dueDate":
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return (
            direction *
            (newDate(a.dueDate).getTime() - newDate(b.dueDate).getTime())
          );
        case "startDate":
          if (!a.startDate) return 1;
          if (!b.startDate) return -1;
          return (
            direction *
            (newDate(a.startDate).getTime() - newDate(b.startDate).getTime())
          );
        case "status":
          return direction * a.status.localeCompare(b.status);
        case "project":
          if (!a.project?.name) return 1;
          if (!b.project?.name) return -1;
          return direction * a.project.name.localeCompare(b.project.name);
        case "priority":
          if (!a.priority) return 1;
          if (!b.priority) return -1;
          return direction * a.priority.localeCompare(b.priority);
        case "energyLevel":
          if (!a.energyLevel) return 1;
          if (!b.energyLevel) return -1;
          return direction * a.energyLevel.localeCompare(b.energyLevel);
        case "preferredTime":
          if (!a.preferredTime) return 1;
          if (!b.preferredTime) return -1;
          return direction * a.preferredTime.localeCompare(b.preferredTime);
        case "duration":
          if (!a.duration) return 1;
          if (!b.duration) return -1;
          return direction * (a.duration - b.duration);
        case "schedule":
          // First sort by auto-scheduled vs manual
          if (a.isAutoScheduled !== b.isAutoScheduled) {
            return direction * (a.isAutoScheduled ? -1 : 1);
          }
          // Then sort by scheduled start time
          if (a.isAutoScheduled && b.isAutoScheduled) {
            if (!a.scheduledStart) return 1;
            if (!b.scheduledStart) return -1;
            return (
              direction *
              (newDate(a.scheduledStart).getTime() -
                newDate(b.scheduledStart).getTime())
            );
          }
          // Default to creation date for manual tasks
          return (
            direction *
            (newDate(b.createdAt).getTime() - newDate(a.createdAt).getTime())
          );
        default:
          return (
            direction *
            (newDate(b.createdAt).getTime() - newDate(a.createdAt).getTime())
          );
      }
    });
  }, [filteredTasks, sortBy, sortDirection]);

  const hasActiveFilters =
    status?.length ||
    energyLevel?.length ||
    timePreference?.length ||
    tagIds?.length ||
    search;

  const orderedIds = useMemo(
    () => sortedTasks.map((t) => t.id),
    [sortedTasks]
  );
  const selectedCount = orderedIds.filter((id) =>
    selectedTaskIds.has(id)
  ).length;
  const allSelected = orderedIds.length > 0 && selectedCount === orderedIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const handleBulkAssignProject = (projectId: string | null) => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    bulkAssignToProject(ids, projectId).then(() => clearSelection());
  };

  const handleBulkSetStatus = (newStatus: TaskStatus) => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    bulkSetStatus(ids, newStatus).then(() => clearSelection());
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    if (
      !confirm(
        `Delete ${ids.length} task${ids.length === 1 ? "" : "s"}? This cannot be undone.`
      )
    ) {
      return;
    }
    bulkDelete(ids);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center gap-4">
        <StatusFilter
          value={status || []}
          onChange={(value) => setFilters({ status: value })}
        />

        <Select
          value={energyLevel?.[0] || "none"}
          onValueChange={(value) =>
            setFilters({
              energyLevel:
                value !== "none" ? [value as EnergyLevel] : undefined,
            })
          }
        >
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue placeholder="All Energy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">All Energy</SelectItem>
            {Object.values(EnergyLevel).map((level) => (
              <SelectItem key={level} value={level}>
                {formatEnumValue(level)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={timePreference?.[0] || "none"}
          onValueChange={(value) =>
            setFilters({
              timePreference:
                value !== "none" ? [value as TimePreference] : undefined,
            })
          }
        >
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue placeholder="All Times" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">All Times</SelectItem>
            {Object.values(TimePreference).map((time) => (
              <SelectItem key={time} value={time}>
                {formatEnumValue(time)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-1 gap-2">
          <Input
            value={search || ""}
            onChange={(e) =>
              setFilters({ search: e.target.value || undefined })
            }
            placeholder="Search tasks..."
            className="h-9"
          />
          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={resetFilters}
              className="h-9"
            >
              <HiX className="mr-1 h-4 w-4" />
              Clear Filters
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="hideUpcomingTasks"
            checked={hideUpcomingTasks}
            onCheckedChange={(checked) =>
              setFilters({ hideUpcomingTasks: checked as boolean })
            }
          />
          <label
            htmlFor="hideUpcomingTasks"
            className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Hide upcoming tasks
          </label>
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium">
            {selectedCount} selected
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                Assign to project
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => handleBulkAssignProject(null)}>
                No project
              </DropdownMenuItem>
              {projects
                .filter((p) => p.id !== "no-project")
                .map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    onClick={() => handleBulkAssignProject(project.id)}
                  >
                    {project.name}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                Set status
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {Object.values(TaskStatus).map((s) => (
                <DropdownMenuItem
                  key={s}
                  onClick={() => handleBulkSetStatus(s)}
                >
                  {formatEnumValue(s)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="destructive"
            size="sm"
            className="h-8"
            onClick={handleBulkDelete}
          >
            Delete
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={clearSelection}
          >
            <HiX className="mr-1 h-4 w-4" />
            Clear
          </Button>
        </div>
      )}

      <div className="flex-1 rounded-lg border bg-background">
        <div
          className="overflow-auto"
          style={{ maxHeight: "calc(100vh - 250px)" }}
        >
          <table className="min-w-full divide-y divide-border">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th
                  scope="col"
                  className="w-10 px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                >
                  <Checkbox
                    checked={
                      allSelected ? true : someSelected ? "indeterminate" : false
                    }
                    onCheckedChange={(checked) => {
                      if (checked) {
                        selectAll(orderedIds);
                      } else {
                        clearSelection();
                      }
                    }}
                    aria-label="Select all tasks"
                  />
                </th>
                <th
                  scope="col"
                  className="w-8 px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                >
                  {/* Drag handle column */}
                </th>
                <SortableHeader
                  column="status"
                  label="Status"
                  currentSort={sortBy}
                  direction={sortDirection}
                  onSort={handleSort}
                  className="w-32"
                />
                <SortableHeader
                  column="title"
                  label="Title"
                  currentSort={sortBy}
                  direction={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  column="priority"
                  label="Priority"
                  currentSort={sortBy}
                  direction={sortDirection}
                  onSort={handleSort}
                  className="w-32"
                />
                <SortableHeader
                  column="energyLevel"
                  label="Energy"
                  currentSort={sortBy}
                  direction={sortDirection}
                  onSort={handleSort}
                  className="w-32"
                />
                <SortableHeader
                  column="preferredTime"
                  label="Time"
                  currentSort={sortBy}
                  direction={sortDirection}
                  onSort={handleSort}
                  className="w-32"
                />
                <SortableHeader
                  column="dueDate"
                  label="Due Date"
                  currentSort={sortBy}
                  direction={sortDirection}
                  onSort={handleSort}
                  className="w-40"
                />
                <SortableHeader
                  column="duration"
                  label="Duration"
                  currentSort={sortBy}
                  direction={sortDirection}
                  onSort={handleSort}
                  className="w-20"
                />
                <SortableHeader
                  column="project"
                  label="Project"
                  currentSort={sortBy}
                  direction={sortDirection}
                  onSort={handleSort}
                  className="w-40"
                />
                <SortableHeader
                  column="schedule"
                  label="Schedule"
                  currentSort={sortBy}
                  direction={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader
                  column="startDate"
                  label="Start Date"
                  currentSort={sortBy}
                  direction={sortDirection}
                  onSort={handleSort}
                  className="w-40"
                />
                <th scope="col" className="relative w-10 px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-background">
              {sortedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  orderedIds={orderedIds}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onStatusChange={onStatusChange}
                  onInlineEdit={onInlineEdit}
                />
              ))}
            </tbody>
          </table>
          {sortedTasks.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No tasks found. Try adjusting your filters or create a new task.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
