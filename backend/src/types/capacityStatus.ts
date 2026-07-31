// Shape of capacityManager.ts's getCapacityStatus() return value.
// Standalone module because capacityManager.ts uses `export =`.

export interface CapacityStatus {
  monthlyBudget: number;
  monthlySpend: number;
  remaining: number;
  usagePercent: number;
  recommendedBuilder: string;
  reason: string;
  canAffordAudit: boolean;
  canAffordTask: boolean;
  estimatedTasksLeft: number;
}
