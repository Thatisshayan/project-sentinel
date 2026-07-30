// Row shape for getLatestMetrics()'s SELECT DISTINCT ON projection (see
// businessDb.ts). Standalone module because businessDb.ts uses `export =`.

export interface BusinessMetricRow {
  metric_name: string;
  metric_value: string | null;
  metric_unit: string | null;
  recorded_date: string;
}
