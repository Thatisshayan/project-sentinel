// Row shape for getLatestMetrics()'s SELECT DISTINCT ON projection (see
// businessDb.ts). Standalone module because businessDb.ts uses `export =`.

export interface BusinessMetricRow {
  metric_name: string;
  metric_value: string | null;
  metric_unit: string | null;
  recorded_date: string;
}

// PR business-impact snapshot/delta shapes (see businessDb.ts's
// recordPRImpact/updatePRImpact and correlationEngine.ts's callers).
export type ImpactSnapshot = Record<string, number>;

export interface ImpactDeltaEntry {
  before: number;
  after: number;
  change: number;
  changePercent: string | null;
}

export type ImpactDelta = Record<string, ImpactDeltaEntry>;
