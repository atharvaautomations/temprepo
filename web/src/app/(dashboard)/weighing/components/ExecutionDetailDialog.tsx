'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ExecutionDetail } from '../types/execution';
import { useExecutionDetail } from '../hooks/useExecution';
import { format } from 'date-fns';

const statusBadgeStyles: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
  RUNNING: 'bg-blue-100 text-blue-800 border border-blue-200',
  COMPLETED: 'bg-green-100 text-green-800 border border-green-200',
  CANCELLED: 'bg-red-100 text-red-800 border border-red-200',
  SUCCESS: 'bg-green-100 text-green-800 border border-green-200',
  EXPIRED: 'bg-red-100 text-red-800 border border-red-200',
};

interface ExecutionDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  executionId: number | null;
}

export function ExecutionDetailDialog({
  open,
  onOpenChange,
  executionId,
}: ExecutionDetailDialogProps) {
  const { data } = useExecutionDetail(executionId);
  const execution = data;

  if (!open || !execution) {
    return null;
  }

  const scheduleBadge = (status: string) => {
    const className = statusBadgeStyles[status] || 'bg-gray-100 text-gray-800';
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
        {status}
      </span>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-white max-h-[calc(100vh-4rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Execution Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Execution Info */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
              Execution Information
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs text-gray-500">Execution Number</p>
                <p className="text-sm font-medium text-gray-900 font-mono">
                  {execution.executionCode}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-gray-500">Status</p>
                <span className="text-sm font-medium">{scheduleBadge(execution.status)}</span>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-gray-500">Recipe</p>
                <p className="text-sm font-medium text-gray-900">
                  {execution.recipeName} (v{execution.recipeVersion})
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-gray-500">Mode</p>
                <p className="text-sm font-medium text-gray-900">{execution.mode}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-gray-500">Total Batches</p>
                <p className="text-sm font-medium text-gray-900">
                  {execution.totalBatches}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-gray-500">Operator</p>
                <p className="text-sm font-medium text-gray-900">
                  {execution.operatorName || '—'}
                  {execution.operatorUsername ? ` (${execution.operatorUsername})` : ''}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-gray-500">Created At</p>
                <p className="text-sm font-medium text-gray-900">
                  {format(new Date(execution.createdAt), 'dd-MM-yyyy HH:mm')}
                </p>
              </div>
              {execution.productionBatchNumber && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-500">Production Batch Number</p>
                  <p className="text-sm font-medium text-gray-900">
                    {execution.productionBatchNumber}
                  </p>
                </div>
              )}
              {execution.masterBatchExpiringDate && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-500">Master Batch Expiry</p>
                  <p className="text-sm font-medium text-gray-900">
                    {format(new Date(execution.masterBatchExpiringDate), 'dd-MM-yyyy')}
                  </p>
                </div>
              )}
              {execution.finalBatchExpiringDate && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-500">Final Batch Expiry</p>
                  <p className="text-sm font-medium text-gray-900">
                    {format(new Date(execution.finalBatchExpiringDate), 'dd-MM-yyyy')}
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Schedules */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
              Schedule Details
            </h3>
            {execution.schedules.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span className="text-gray-400">No schedule</span>
                <span>No schedule has been created for this execution.</span>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {execution.schedules.map((schedule) => (
                  <div key={schedule.id} className="p-4 rounded-lg bg-gray-50">
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Schedule Code
                        </p>
                        <p className="text-sm font-medium text-gray-900 font-mono">
                          {schedule.scheduleCode}
                        </p>
                      </div>
                      {scheduleBadge(schedule.status)}
                    </div>
                    <div className="mt-3 space-y-1">
                      <div className="flex items-center gap-3">
                        <p className="text-xs text-gray-500">Scheduled Date</p>
                        <p className="text-sm text-gray-700">
                          {format(new Date(schedule.scheduleDate), 'dd-MM-yyyy')}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-xs text-gray-500">Operator</p>
                        <p className="text-sm text-gray-700">
                          {schedule.operatorName}
                          {schedule.operatorUsername ? ` (${schedule.operatorUsername})` : ''}
                        </p>
                      </div>
                      {schedule.createdByName && (
                        <div className="flex items-center gap-3">
                          <p className="text-xs text-gray-500">Created By</p>
                          <p className="text-sm text-gray-700">{schedule.createdByName}</p>
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        <p className="text-xs text-gray-500">Created At</p>
                        <p className="text-sm text-gray-700">
                          {format(new Date(schedule.createdAt), 'dd-MM-yyyy HH:mm')}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Batches */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
              Batches ({execution.batches.length})
            </h3>
            <div className="grid gap-2 md:grid-cols-3">
              {execution.batches.map((batch) => (
                <div
                  key={batch.id}
                  className={`p-3 rounded border text-center ${
                    batch.status === 'COMPLETED'
                      ? 'bg-green-50 border-green-100 text-green-800'
                      : batch.status === 'RUNNING'
                      ? 'bg-blue-50 border-blue-100 text-blue-800'
                      : 'bg-gray-50 border-gray-100 text-gray-700'
                  }`}
                >
                  <p className="text-xs font-semibold text-gray-500 uppercase">
                    Batch {batch.batchNumber}
                  </p>
                  <p className="text-sm font-medium">{batch.status}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
