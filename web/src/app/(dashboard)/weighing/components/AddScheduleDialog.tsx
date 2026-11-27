'use client';

import { useState, useEffect } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ExecutionOption, OperatorOption } from '../types/schedule';
import { useCreateSchedule } from '../hooks/useScheduling';

interface AddScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  executions: ExecutionOption[];
  operators: OperatorOption[];
  onSuccess: () => void;
}

export function AddScheduleDialog({
  open,
  onOpenChange,
  executions,
  operators,
  onSuccess,
}: AddScheduleDialogProps) {
  const [formData, setFormData] = useState({
    executionId: '',
    operatorId: '',
    scheduleDate: '',
  });
  const [errors, setErrors] = useState({
    executionId: '',
    operatorId: '',
    scheduleDate: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createSchedule = useCreateSchedule();

  useEffect(() => {
    if (open) {
      const today = new Date().toISOString().split('T')[0];
      setFormData({
        executionId: '',
        operatorId: '',
        scheduleDate: today,
      });
      setErrors({
        executionId: '',
        operatorId: '',
        scheduleDate: '',
      });
    }
  }, [open]);

  const validateForm = () => {
    const newErrors = {
      executionId: formData.executionId ? '' : 'Execution is required.',
      operatorId: formData.operatorId ? '' : 'Operator is required.',
      scheduleDate: formData.scheduleDate ? '' : 'Schedule date is required.',
    };

    const scheduleDate = new Date(formData.scheduleDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (formData.scheduleDate && scheduleDate < today) {
      newErrors.scheduleDate = 'Schedule date cannot be in the past.';
    }

    setErrors(newErrors);
    return !Object.values(newErrors).some((error) => error);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      await createSchedule.mutateAsync({
        executionId: Number(formData.executionId),
        operatorId: Number(formData.operatorId),
        scheduleDate: formData.scheduleDate,
      });
      onSuccess();
    } catch (error) {
      // Error handled by mutation
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle>Add Schedule</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Select Execution
            </label>
            <Select
              value={formData.executionId}
              onValueChange={(value) => {
                setFormData((prev) => ({ ...prev, executionId: value }));
                if (errors.executionId) {
                  setErrors((prev) => ({ ...prev, executionId: '' }));
                }
              }}
            >
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Select an execution" />
              </SelectTrigger>
              <SelectContent>
                {executions
                  .filter((execution) => execution.status === 'PENDING')
                  .map((execution) => (
                    <SelectItem key={execution.id} value={execution.id.toString()}>
                      {execution.executionCode} - {execution.recipeName} (v{execution.recipeVersion}) -{' '}
                      {execution.totalBatches} batches - {execution.status}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {errors.executionId && (
              <p className="text-sm text-red-600">{errors.executionId}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Schedule Date
            </label>
            <Input
              type="date"
              value={formData.scheduleDate}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, scheduleDate: e.target.value }));
                if (errors.scheduleDate) {
                  setErrors((prev) => ({ ...prev, scheduleDate: '' }));
                }
              }}
              min={new Date().toISOString().split('T')[0]}
              className="bg-white"
            />
            {errors.scheduleDate && (
              <p className="text-sm text-red-600">{errors.scheduleDate}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Operator
            </label>
            <Select
              value={formData.operatorId}
              onValueChange={(value) => {
                setFormData((prev) => ({ ...prev, operatorId: value }));
                if (errors.operatorId) {
                  setErrors((prev) => ({ ...prev, operatorId: '' }));
                }
              }}
            >
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Select an operator" />
              </SelectTrigger>
              <SelectContent>
                {operators.map((operator) => (
                  <SelectItem key={operator.id} value={operator.id.toString()}>
                    {operator.name} ({operator.username})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.operatorId && (
              <p className="text-sm text-red-600">{errors.operatorId}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Schedule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}