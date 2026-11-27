import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IngredientExecutionStatus,
  ExecutionStatus,
  BatchExecutionStatus,
  ScheduleStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScanQrDto } from './dto/scan-qr.dto';
import { CompleteWeighingDto } from './dto/complete-weighing.dto';
import { buildPlcPayload } from './utils/plc-payload.builder';

@Injectable()
export class WeighingService {
  constructor(private readonly prisma: PrismaService) {}

  async scan(dto: ScanQrDto) {
    console.log('QR Received:', JSON.stringify(dto.qrId));
    return this.prisma.$transaction(async (tx) => {
      const executionIngredient = await tx.executionIngredient.findUnique({
        where: {
          qrId: dto.qrId,
        },
        include: {
          ingredient: {
            include: {
              bins: true,
            },
          },
          recipeStep: true,
          executionBatch: {
            include: {
              execution: {
                include: {
                  recipe: true,
                },
              },

              ingredients: {
                include: {
                  ingredient: true,
                },
              },
            },
          },
        },
      });
      console.log(executionIngredient);

      if (!executionIngredient) {
        throw new NotFoundException('Invalid QR Code.');
      }

      // Reject if ingredient already completed
      if (executionIngredient.actualQuantity !== null) {
        throw new BadRequestException('Ingredient already completed.');
      }

      const batch = executionIngredient.executionBatch;

      // Check whether this is the first scan of this batch
      const scannedCount = await tx.executionIngredient.count({
        where: {
          executionBatchId: batch.id,
          weighedAt: {
            not: null,
          },
        },
      });

      const isFirstScanOfBatch = scannedCount === 0;

      // Status update only:
      // first weighing scan means this batch/execution has started.
      if (isFirstScanOfBatch) {
        if (batch.status === BatchExecutionStatus.PENDING) {
          await tx.executionBatch.update({
            where: {
              id: batch.id,
            },
            data: {
              status: BatchExecutionStatus.RUNNING,
              startedAt: batch.startedAt ?? new Date(),
            },
          });
        }

        if (batch.execution.status === ExecutionStatus.PENDING) {
          await tx.execution.update({
            where: {
              id: batch.execution.id,
            },
            data: {
              status: ExecutionStatus.RUNNING,
            },
          });
        }
      }

      const plcPayload = buildPlcPayload(
        executionIngredient,
        isFirstScanOfBatch
      );

      // Mark ingredient as scanned
      await tx.executionIngredient.update({
        where: {
          id: executionIngredient.id,
        },
        data: {
          status: IngredientExecutionStatus.WEIGHED,
          weighedAt: new Date(),
        },
      });

      return {
        success: true,
        payload: plcPayload,
      };
    });
  }

  async complete(dto: CompleteWeighingDto) {
    return this.prisma.$transaction(async (tx) => {
      const executionIngredient = await tx.executionIngredient.findUnique({
        where: {
          qrId: dto.qrId,
        },
        include: {
          executionBatch: true,
          ingredient: {
            include: {
              bins: true,
            },
          },
        },
      });

      if (!executionIngredient) {
        throw new NotFoundException('Invalid QR Code.');
      }

      // Prevent duplicate weighing and duplicate stock deduction.
      if (executionIngredient.actualQuantity !== null) {
        throw new BadRequestException('Ingredient already consumed.');
      }

      if (dto.weight <= 0) {
        throw new BadRequestException('Invalid actual weight.');
      }

      const bin = executionIngredient.ingredient.bins[0];

      if (!bin) {
        throw new NotFoundException(
          `No bin assigned for ingredient ${executionIngredient.ingredientName}.`
        );
      }

      // PLC weighing quantity is in grams.
      // Bin currentQuantity is maintained in KG.
      const consumedKg = dto.weight / 1000;

      // Minimum-quantity protection: a weighing may not take the bin below its
      // configured minimum. The conditional update below re-checks this
      // atomically so two concurrent weighings cannot both pass the check.
      const minQuantity = Math.max(0, Number(bin.minQuantity) || 0);
      const availableKg = Number(bin.currentQuantity) || 0;
      const usableKg = availableKg - minQuantity;

      if (consumedKg > usableKg) {
        throw new BadRequestException(
          `Insufficient usable quantity for ingredient ${executionIngredient.ingredientName} in bin ${bin.binNumber}. ` +
            `Available: ${availableKg} KG, Minimum required in bin: ${minQuantity} KG, ` +
            `Usable: ${Math.max(0, usableKg)} KG, Required: ${consumedKg} KG.`
        );
      }

      const newBinQuantity = availableKg - consumedKg;

      // Store actual weighing quantity in grams.
      await tx.executionIngredient.update({
        where: {
          id: executionIngredient.id,
        },
        data: {
          actualQuantity: dto.weight,
          completedAt: new Date(),
          status: IngredientExecutionStatus.WEIGHED,
        },
      });

      // Deduct actual consumed quantity from physical bin stock. The guard in
      // the where clause makes the deduction atomic under concurrency.
      const deducted = await tx.binAssignment.updateMany({
        where: {
          id: bin.id,
          currentQuantity: { gte: consumedKg + minQuantity },
        },
        data: {
          currentQuantity: { decrement: consumedKg },
        },
      });

      if (deducted.count === 0) {
        const latest = await tx.binAssignment.findUnique({
          where: { id: bin.id },
          select: { binNumber: true, currentQuantity: true, minQuantity: true },
        });
        const latestAvailable = Number(latest?.currentQuantity) || 0;
        const latestMin = Math.max(0, Number(latest?.minQuantity) || 0);

        throw new BadRequestException(
          `Insufficient usable quantity for ingredient ${executionIngredient.ingredientName} in bin ${latest?.binNumber ?? bin.binNumber}. ` +
            `Available: ${latestAvailable} KG, Minimum required in bin: ${latestMin} KG, ` +
            `Usable: ${Math.max(0, latestAvailable - latestMin)} KG, Required: ${consumedKg} KG.`
        );
      }

      const pendingWeighingIngredients = await tx.executionIngredient.count({
        where: {
          executionBatchId: executionIngredient.executionBatchId,
          actualQuantity: null,
        },
      });

      const weighingCompleted = pendingWeighingIngredients === 0;

      console.log(
        `Bin ${bin.binNumber}: deducted ${consumedKg} KG. ` +
          `Previous: ${bin.currentQuantity} KG, Current: ${newBinQuantity} KG`
      );

      return {
        success: true,
        weighingCompleted,
        consumedKg,
        binNumber: bin.binNumber,
        currentBinQuantity: newBinQuantity,
      };
    });
  }

  async findAllExecutions(user?: { id: number; role?: string }) {
    // Operators only see executions assigned to them via the Scheduling module.
    const where =
      user?.role === UserRole.OPERATOR
        ? { schedules: { some: { operatorId: Number(user.id) } } }
        : undefined;

    const executions = await this.prisma.execution.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        schedules: {
          where: {
            status: ScheduleStatus.PENDING,
          },
          orderBy: { scheduleDate: 'asc' },
          take: 1,
        },
      },
    });

    return executions.map((execution) => ({
      id: execution.id,
      executionCode: execution.executionCode,
      recipeId: execution.recipeId,
      recipeName: execution.recipeName,
      totalBatches: execution.totalBatches,
      status: execution.status,
      createdAt: execution.createdAt,
      scheduledDate: execution.schedules?.[0]?.scheduleDate
        ? new Date(execution.schedules[0].scheduleDate).toISOString().split('T')[0]
        : null,
    }));
  }

  async getFinalBatchQrs(executionId: number) {
    const finalBatches = await this.prisma.finalBatch.findMany({
      where: {
        executionBatch: {
          executionId,
        },
      },
      include: {
        executionBatch: true,
        recipe: true,
      },
      orderBy: {
        executionBatch: {
          batchNumber: 'asc',
        },
      },
    });

    return finalBatches.map((fb) => ({
      id: fb.id,
      qrId: fb.qrId,
      batchNumber: fb.executionBatch.batchNumber,
      recipeCode: fb.recipe.recipeCode,
      recipeName: fb.recipe.name,
      shift: fb.shift,
      expiryDate: fb.expiryDate,
      mixingCompletedAt: fb.mixingCompletedAt,
      status: fb.status,
    }));
  }
}
