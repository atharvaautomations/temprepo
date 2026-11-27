export type ExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED';

export interface IngredientLine {
  ingredientCode: string;
  quantity: number;
}

export interface RecipeOption {
  id: string;
  recipeCode: string;
  name: string;
  ingredients: IngredientLine[];
}

export interface ExecutionItem {
  id: string;
  executionNumber: string;
  recipeName: string;
  batchCount: number;
  status: ExecutionStatus;
  scheduledDate?: string | null;
}

export interface ExecutionScheduleDetail {
  id: number;
  scheduleCode: string;
  scheduleDate: string;
  operatorName: string;
  operatorUsername: string;
  createdByName: string;
  status: 'PENDING' | 'SUCCESS' | 'EXPIRED';
  createdAt: string;
}

export interface ExecutionBatchDetail {
  id: number;
  batchNumber: number;
  status: string;
}

export interface ExecutionDetail {
  id: number;
  executionCode: string;
  recipeId: number;
  recipeName: string;
  recipeVersion: number;
  mode: string;
  totalBatches: number;
  status: ExecutionStatus;
  operatorName: string;
  operatorUsername: string;
  productionBatchNumber: string | null;
  masterBatchExpiringDate: string | null;
  finalBatchExpiringDate: string | null;
  createdAt: string;
  updatedAt: string;
  schedules: ExecutionScheduleDetail[];
  batches: ExecutionBatchDetail[];
}
