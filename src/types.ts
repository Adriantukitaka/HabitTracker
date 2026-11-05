// Contratos entre las pantallas y el servicio local (mismos que tenía la API).

export type Status = 'PENDING' | 'PARTIAL' | 'DONE' | 'MISSED' | 'SKIPPED';
export type Mode = 'TOGGLE' | 'COUNTER' | 'ROUTINE';
export type Kind = 'HABIT' | 'TASK';

export interface ConflictRef {
  occurrenceId: number;
  title: string;
  start: string;
  end: string;
}

export interface Counter {
  variableId: number;
  name: string;
  unit: string | null;
  value: number;
  target: number;
  step: number;
}

export interface OccurrenceCard {
  id: number;
  activityId: number;
  day: string;
  title: string;
  kind: Kind;
  mode: Mode;
  start: string | null;
  end: string | null;
  status: Status;
  progress: number;
  fixed: boolean;
  priority: number;
  subtitle: string;
  counter: Counter | null;
  conflicts: ConflictRef[];
  doneAt: string | null;
}

export interface TodayView {
  date: string;
  dayStart: string;
  dayEnd: string;
  now: string;
  doneCount: number;
  total: number;
  streak: number;
  currentId: number | null;
  items: OccurrenceCard[];
}

export interface VariableEntry {
  id: number;
  name: string;
  unit: string | null;
  target: number;
  step: number;
  value: number | null;
  yesterday: number | null;
  met: boolean;
  required: boolean;
}

export interface ItemEntry {
  id: number;
  parentId: number | null;
  name: string;
  depth: number;
  group: boolean;
  variables: VariableEntry[];
}

export interface OccurrenceDetail {
  card: OccurrenceCard;
  routineName: string | null;
  challengeDay: number | null;
  challengeLength: number | null;
  items: ItemEntry[];
  savedAt: string | null;
  editableUntil: string | null;
  editable: boolean;
}

export interface Slot {
  start: string;
  end: string;
}

export interface Resolution {
  moveOccurrenceId: number;
  moveTitle: string;
  from: string;
  proposal: Slot | null;
  reason: string;
  conflicts: ConflictRef[];
}

export interface ScheduleCheck {
  conflicts: { date: string; title: string; start: string; end: string }[];
  suggestion: Slot | null;
}

export interface VariableInput {
  name: string;
  unit?: string | null;
  target: number;
  step?: number;
  aggregation?: 'SUM' | 'MAX' | 'LAST';
}

export interface ItemInput {
  name: string;
  required?: boolean;
  variables?: VariableInput[];
  children?: ItemInput[];
}

export interface ActivityInput {
  kind: Kind;
  title: string;
  goal?: string | null;
  daysMask?: number;
  taskDate?: string | null;
  start?: string | null;
  durationMin?: number;
  flexible?: boolean;
  parallel?: boolean;
  priority?: number;
  challengeDays?: number | null;
  variables?: VariableInput[];
  items?: ItemInput[];
}

export interface ActivitySummary {
  id: number;
  kind: Kind;
  title: string;
  goal: string | null;
  daysMask: number;
  taskDate: string | null;
  start: string | null;
  durationMin: number;
  flexible: boolean;
  priority: number;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED';
  challengeStart: string;
  challengeEnd: string | null;
  routineName: string | null;
  variableCount: number;
}

export interface DayValue {
  date: string;
  value: number | null;
}

export interface Progress {
  variableId: number;
  name: string;
  unit: string | null;
  itemName: string;
  activityId: number;
  activityTitle: string;
  siblings: { id: number; name: string; unit: string | null }[];
  days: number;
  today: number | null;
  yesterday: DayValue | null;
  average: number | null;
  best: DayValue | null;
  recordCount: number;
  series: DayValue[];
  records: { date: string; value: number; diff: number | null }[];
}

export interface HeatCell {
  date: string;
  pct: number;
  level: number;
  future: boolean;
}

export interface Challenge {
  activityId: number;
  title: string;
  goal: string | null;
  day: number | null;
  of: number | null;
  streak: number;
  rate: number;
  last14: (Status | 'NONE')[];
}

export interface Dashboard {
  streak: number;
  bestStreak: number;
  weekPct: number;
  todayPct: number;
  totalCheckins: number;
  heatmap: HeatCell[];
  challenges: Challenge[];
}

export interface DaySummary {
  date: string;
  done: number;
  partial: number;
  missed: number;
  total: number;
  editableUntil: string;
  items: OccurrenceCard[];
}

export interface NotificationView {
  id: number;
  occurrenceId: number | null;
  type: 'REMINDER' | 'NUDGE' | 'CONFLICT' | 'SUMMARY' | 'DONE';
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

export interface SettingsView {
  dayStart: string;
  dayEnd: string;
  nudgeMinutes: number;
  summaryTime: string;
}
