'use client';

import { useState } from 'react';
import { Plus, Calendar, Filter } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { Section } from '@/components/global';
import { Button } from '@/components/ui/button';
import { ExecutionDialog } from './ExecutionDialog';
import { ExecutionTable } from './ExecutionTable';
import { ExecutionItem } from '../types/execution';
import { useExecution, useCreateExecution, EXECUTION_QUERY_KEYS } from '../hooks/useExecution';
import ExecutionQrPreviewModal from './ExecutionQrPreviewModal';
import { ExecutionDetailDialog } from './ExecutionDetailDialog';
import api from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function BulkWeighing() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { recipes, executions } = useExecution();
  const createExecution = useCreateExecution();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRecipeId, setSelectedRecipeId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [batchCount, setBatchCount] = useState('1');
  const [productionBatchNumber, setProductionBatchNumber] = useState('');
  const [masterBatchExpiringDate, setMasterBatchExpiringDate] = useState('');
  const [finalBatchExpiringDate, setFinalBatchExpiringDate] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [recipeError, setRecipeError] = useState('');
  const [versionError, setVersionError] = useState('');
  const [batchError, setBatchError] = useState('');
  const [productionBatchError, setProductionBatchError] = useState('');
  const [operatorError, setOperatorError] = useState('');
  const [selectedExecution, setSelectedExecution] =
    useState<ExecutionItem | null>(null);
  const [scheduleFilter, setScheduleFilter] = useState<'all' | 'today' | 'tomorrow'>('all');
  const [qrPreviewOpen, setQrPreviewOpen] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const filteredExecutions = executions.filter((execution) => {
    if (!execution.scheduledDate) return scheduleFilter === 'all';
    if (scheduleFilter === 'today') return execution.scheduledDate === today;
    if (scheduleFilter === 'tomorrow') return execution.scheduledDate === tomorrow;
    return true;
  });
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailExecutionId, setDetailExecutionId] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editExecution, setEditExecution] = useState<ExecutionItem | null>(null);
  const [editProductionBatchNumber, setEditProductionBatchNumber] = useState('');
  const [editMasterBatchExpiringDate, setEditMasterBatchExpiringDate] = useState('');
  const [editFinalBatchExpiringDate, setEditFinalBatchExpiringDate] = useState('');
  const [editOperatorName, setEditOperatorName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ExecutionItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const resetForm = () => {
    setSelectedRecipeId('');
    setSelectedVersionId('');
    setBatchCount('1');
    setProductionBatchNumber('');
    setMasterBatchExpiringDate('');
    setFinalBatchExpiringDate('');
    setOperatorName('');
    setRecipeError('');
    setVersionError('');
    setBatchError('');
    setProductionBatchError('');
    setOperatorError('');
  };

  const handleSubmit = () => {
    const trimmedVersionId = selectedVersionId.trim();
    const parsedBatchCount = Number(batchCount);

    const nextRecipeError = selectedRecipeId.trim()
      ? ''
      : 'Recipe is required.';
    const nextVersionError = trimmedVersionId
      ? ''
      : 'Select a recipe version.';
    const nextBatchError =
      Number.isFinite(parsedBatchCount) && parsedBatchCount >= 1
        ? ''
        : 'Enter a valid number of batches.';
    const nextOperatorError = operatorName.trim()
      ? ''
        : 'Please select an operator.';

    setRecipeError(nextRecipeError);
    setVersionError(nextVersionError);
    setBatchError(nextBatchError);
    setOperatorError(nextOperatorError);

    if (nextRecipeError || nextVersionError || nextBatchError || nextOperatorError) {
      return;
    }

    createExecution.mutate(
      {
        recipeId: Number(trimmedVersionId),
        totalBatches: parsedBatchCount,
        mode: 'BULK',
        operatorName: operatorName.trim(),
        productionBatchNumber: productionBatchNumber.trim(),
        masterBatchExpiringDate: masterBatchExpiringDate || undefined,
        finalBatchExpiringDate: finalBatchExpiringDate || undefined,
      },
      {
        onSuccess: () => {
          setDialogOpen(false);
          resetForm();
        },
      }
    );
  };

  const handlePrintAll = (execution: ExecutionItem) => {
    setSelectedExecution(execution);
    setQrPreviewOpen(true);
  };

  const handlePrintBatch = (execution: ExecutionItem) => {
    console.log('Print batch QR', execution);
  };

  const handleViewDetail = (execution: ExecutionItem) => {
    setDetailExecutionId(Number(execution.id));
    setDetailOpen(true);
  };

  const handleEdit = (execution: ExecutionItem) => {
    setEditExecution(execution);
    setEditProductionBatchNumber(execution.productionBatchNumber || '');
    setEditMasterBatchExpiringDate(
      execution.masterBatchExpiringDate
        ? new Date(execution.masterBatchExpiringDate).toISOString().split('T')[0]
        : ''
    );
    setEditFinalBatchExpiringDate(
      execution.finalBatchExpiringDate
        ? new Date(execution.finalBatchExpiringDate).toISOString().split('T')[0]
        : ''
    );
    setEditOperatorName(execution.operatorName || '');
    setEditOpen(true);
  };

  const handleDelete = (execution: ExecutionItem) => {
    setDeleteTarget(execution);
    setConfirmDelete(true);
  };

  const handleSaveEdit = async () => {
    if (!editExecution) return;

    try {
      await api.put(`/executions/${editExecution.id}`, {
        productionBatchNumber: editProductionBatchNumber || null,
        masterBatchExpiringDate: editMasterBatchExpiringDate || null,
        finalBatchExpiringDate: editFinalBatchExpiringDate || null,
        operatorName: editOperatorName || null,
      });

      toast({
        title: 'Execution updated',
        description: `Execution "${editExecution.executionNumber}" has been updated.`,
      });

      setEditOpen(false);
      setEditExecution(null);
      queryClient.invalidateQueries({ queryKey: EXECUTION_QUERY_KEYS.all });
    } catch (err: any) {
      toast({
        title: 'Update failed',
        description: err?.response?.data?.message || 'Failed to update execution.',
        variant: 'destructive',
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;

    try {
      await api.delete(`/executions/${deleteTarget.id}`);

      toast({
        title: 'Execution deleted',
        description: `Execution "${deleteTarget.executionNumber}" has been deleted.`,
      });

      setConfirmDelete(false);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: EXECUTION_QUERY_KEYS.all });
    } catch (err: any) {
      toast({
        title: 'Delete failed',
        description: err?.response?.data?.message || 'Failed to delete execution.',
        variant: 'destructive',
      });
      setConfirmDelete(false);
      setDeleteTarget(null);
    }
  };

  return (
    <Section
      title="Bulk Weighing"
      description="Create and manage bulk weighing executions"
    >
      <div className="flex justify-end gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="schedule-filter" className="text-sm text-gray-600 mr-1">
            Filter:
          </Label>
          <select
            id="schedule-filter"
            value={scheduleFilter}
            onChange={(e) => setScheduleFilter(e.target.value as 'all' | 'today' | 'tomorrow')}
            className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
          >
            <option value="all">All Executions</option>
            <option value="today">Scheduled Today</option>
            <option value="tomorrow">Scheduled Tomorrow</option>
          </select>
        </div>
        <Button
          className="bg-green-600 hover:bg-green-700 text-white"
          onClick={() => router.push('/schedules')}
        >
          <Calendar size={16} />
          Scheduled Executions
        </Button>
        <Button
          className="bg-blue-600 hover:bg-blue-700 text-white"
          onClick={() => setDialogOpen(true)}
        >
          <Plus size={16} />
          Create Execution
        </Button>
      </div>

      <div className="mt-6">
      <ExecutionTable
        executions={filteredExecutions}
        onPrintAll={handlePrintAll}
        onPrintBatch={handlePrintBatch}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onViewDetail={handleViewDetail}
      />
      </div>

<ExecutionDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            resetForm();
          }
        }}
        recipes={recipes}
        selectedRecipeId={selectedRecipeId}
        selectedVersionId={selectedVersionId}
        batchCount={batchCount}
        productionBatchNumber={productionBatchNumber}
        masterBatchExpiringDate={masterBatchExpiringDate}
        finalBatchExpiringDate={finalBatchExpiringDate}
        operatorName={operatorName}
        recipeError={recipeError}
        versionError={versionError}
        batchError={batchError}
        productionBatchError={productionBatchError}
        operatorError={operatorError}
        onRecipeChange={(value) => {
          setSelectedRecipeId(value);
          setSelectedVersionId('');
          if (recipeError) {
            setRecipeError('');
          }
        }}
        onVersionChange={(value) => {
          setSelectedVersionId(value);
          if (versionError) {
            setVersionError('');
          }
        }}
        onBatchCountChange={(value) => {
          setBatchCount(value);
          if (batchError) {
            setBatchError('');
          }
        }}
        onProductionBatchNumberChange={(value) => {
          setProductionBatchNumber(value);
          if (productionBatchError) {
            setProductionBatchError('');
          }
        }}
        onMasterBatchExpiringDateChange={(value) => {
          setMasterBatchExpiringDate(value);
        }}
        onFinalBatchExpiringDateChange={(value) => {
          setFinalBatchExpiringDate(value);
        }}
        onOperatorChange={(value) => {
          setOperatorName(value);
          if (operatorError) {
            setOperatorError('');
          }
        }}
        onSubmit={handleSubmit}
      />
      <ExecutionQrPreviewModal
        open={qrPreviewOpen}
        executionId={selectedExecution ? Number(selectedExecution.id) : 0}
        onClose={() => {
          setQrPreviewOpen(false);
          setSelectedExecution(null);
        }}
      />
      <ExecutionDetailDialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setDetailExecutionId(null);
          }
        }}
        executionId={detailExecutionId}
      />

      {/* Edit Execution Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Edit Execution</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleSaveEdit(); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Execution Number</Label>
              <Input value={editExecution?.executionNumber || ''} readOnly className="bg-gray-100" />
            </div>
            <div className="space-y-2">
              <Label>Production Batch Number</Label>
              <Input
                type="text"
                value={editProductionBatchNumber}
                onChange={(e) => setEditProductionBatchNumber(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Master Batch Expiry Date</Label>
              <Input
                type="date"
                value={editMasterBatchExpiringDate}
                onChange={(e) => setEditMasterBatchExpiringDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Final Batch Expiry Date</Label>
              <Input
                type="date"
                value={editFinalBatchExpiringDate}
                onChange={(e) => setEditFinalBatchExpiringDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Operator Name</Label>
              <Input
                type="text"
                value={editOperatorName}
                onChange={(e) => setEditOperatorName(e.target.value)}
              />
            </div>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" onClick={handleSaveEdit}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmDelete} onOpenChange={() => setConfirmDelete(false)}>
        <DialogContent className="sm:max-w-sm bg-white">
          <DialogHeader>
            <DialogTitle>Delete Execution</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p>
              Are you sure you want to delete execution{" "}
              <strong>{deleteTarget?.executionNumber}</strong>? This action cannot be undone.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
