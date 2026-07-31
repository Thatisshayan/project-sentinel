// Row shape for getLatestMetrics()'s SELECT DISTINCT ON projection (see
// businessDb.ts). Standalone module because businessDb.ts uses `export =`.

export interface BusinessMetricRow {
  metric_name: string;
  metric_value: string | null;
  metric_unit: string | null;
  // No pg type-parser override is registered for DATE (OID 1082) anywhere
  // in this codebase, so node-postgres's default parser applies — this
  // column comes back as a JS Date, not a string.
  recorded_date: Date;
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
