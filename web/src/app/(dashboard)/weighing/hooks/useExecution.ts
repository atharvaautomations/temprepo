'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { ExecutionItem, RecipeOption, ExecutionDetail } from '../types/execution';

export const EXECUTION_QUERY_KEYS = {
  all: ['weighing-executions'] as const,
  list: ['weighing-executions', 'list'] as const,
  detail: (id: number) => ['weighing-executions', 'detail', id] as const,
};

export function useExecution() {
  const { data: recipes = [] } = useQuery<RecipeOption[]>({
    queryKey: ['recipes'],
    queryFn: async () => {
      const res = await api.get('/recipes');
      return Array.isArray(res.data)
        ? res.data.map((recipe: any) => ({
            id: recipe.id.toString(),
            recipeCode: recipe.recipeCode,
            name: recipe.name,
            ingredients: recipe.steps.flatMap((step: any) =>
              step.ingredients.map((item: any) => ({
                ingredientCode: item.ingredient.name,
                quantity: item.quantity,
              }))
            ),
          }))
        : [];
    },
  });

  const { data: executions = [] } = useQuery<ExecutionItem[]>({
    queryKey: EXECUTION_QUERY_KEYS.list,
    queryFn: async () => {
      const res = await api.get('/weighing/executions');
      return Array.isArray(res.data)
        ? res.data.map((item: any) => ({
            id: item.id.toString(),
            executionNumber: item.executionCode,
            recipeName: item.recipeName,
            batchCount: item.totalBatches,
            status: item.status,
            scheduledDate: item.scheduledDate ?? null,
          }))
        : [];
    },
  });

  return {
    recipes,
    executions,
  };
}

export function useExecutionDetail(executionId: number | null) {
  return useQuery<ExecutionDetail>({
    queryKey: EXECUTION_QUERY_KEYS.detail(executionId ?? 0),
    queryFn: async () => {
      const res = await api.get(`/executions/${executionId}/detail`);
      return res.data;
    },
    enabled: !!executionId,
  });
}

export function useCreateExecution() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      recipeId: number;
      totalBatches: number;
      mode: 'BULK';
      operatorName: string;
      productionBatchNumber?: string;
      masterBatchExpiringDate?: string;
      finalBatchExpiringDate?: string;
    }) => {
      return api.post('/executions', payload);
    },

    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: EXECUTION_QUERY_KEYS.all,
      });
    },

    onError: (err: any) => {
      toast({
        title: 'Error creating execution',
        description:
          err?.response?.data?.message || 'Something went wrong.',
        variant: 'destructive',
      });
    },
  });
}
