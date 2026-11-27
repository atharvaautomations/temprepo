'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/global';
import { Button } from '@/components/ui/button';
import { ExecutionItem, ExecutionStatus } from '../types/execution';
import { QrCode, Pencil, Trash2, Play, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { EXECUTION_QUERY_KEYS } from '../hooks/useExecution';

interface ExecutionTableProps {
  executions: ExecutionItem[];
  onPrintAll: (execution: ExecutionItem) => void;
  onPrintBatch: (execution: ExecutionItem) => void;
  onEdit: (execution: ExecutionItem) => void;
  onDelete: (execution: ExecutionItem) => void;
  onViewDetail: (execution: ExecutionItem) => void;
}

const statusStyles: Record<ExecutionStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  RUNNING: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

const statusLabels: Record<ExecutionStatus, string> = {
  PENDING: 'CREATED',
  RUNNING: 'IN PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

export function ExecutionTable({
  executions,
  onPrintAll,
  onPrintBatch,
  onEdit,
  onDelete,
  onViewDetail,
}: ExecutionTableProps) {
  const queryClient = useQueryClient();
  const [startingId, setStartingId] = useState<string | null>(null);

  const startMutation = useMutation({
    mutationFn: async (id: string) => {
      return api.post(`/executions/${id}/start`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXECUTION_QUERY_KEYS.all });
      toast({
        title: 'Execution started',
        description: 'The execution is now in progress.',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Unable to start execution',
        description:
          err?.response?.data?.message || 'Failed to start the execution.',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setStartingId(null);
    },
  });

  const handleStart = (execution: ExecutionItem) => {
    if (startingId) return;
    setStartingId(execution.id);
    startMutation.mutate(execution.id);
  };

  return (
    <Card noPadding>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                Execution Number
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                Recipe Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                Number Of Batches
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                Scheduled Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {executions.map((execution) => {
              const isCreated = execution.status === 'PENDING';
              const isRunning = execution.status === 'RUNNING';
              const isCompleted = execution.status === 'COMPLETED';
              const isStarting = startingId === execution.id;

              return (
                <tr
                  key={execution.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => onViewDetail(execution)}
                >
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-gray-900">
                    {execution.executionNumber}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                    {execution.recipeName}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                    {execution.batchCount}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        statusStyles[execution.status]
                      }`}
                    >
                      {statusLabels[execution.status]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                    {execution.scheduledDate ? (
                      execution.scheduledDate
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {isCreated && (
                        <>
                          <Button
                            size="sm"
                            className="gap-1 bg-green-600 text-white hover:bg-green-700"
                            disabled={isStarting}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStart(execution);
                            }}
                          >
                            {isStarting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                            {isStarting ? 'Starting...' : 'START'}
                          </Button>

                          <Button
                            variant="outline"
                            size="icon"
                            className="border-amber-200 text-amber-600 hover:bg-amber-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(execution);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>

                          <Button
                            variant="outline"
                            size="icon"
                            className="border-red-200 text-red-600 hover:bg-red-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(execution);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}

                      {(isRunning || isCompleted) && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="border-blue-200 text-blue-600 hover:bg-blue-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPrintAll(execution);
                            }}
                          >
                          <QrCode className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}