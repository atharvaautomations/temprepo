import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ExecutionStatus,
  BatchExecutionStatus,
  BatchProcessStatus,
  IngredientExecutionStatus,
  StepType,
  ScheduleStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExecutionDto } from './dto/create-execution.dto';
import { generateExecutionCode } from '../common/utils/code-generator';
import { buildExecutionIngredients } from './utils/execution-builder';
import { startOfDay, isAfter, isBefore } from 'date-fns';

@Injectable()
export class ExecutionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateExecutionDto) {
    return this.prisma.$transaction(async (tx) => {
      const recipe = await tx.recipe.findUnique({
        where: {
          id: dto.recipeId,
        },
        include: {
          steps: {
            include: {
              ingredients: {
                include: {
                  ingredient: {
                    include: {
                      bins: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!recipe) {
        throw new NotFoundException('Recipe not found.');
      }

      // Skip bin quantity validation during creation - validation will happen at START
      // await this.validateBinQuantities(tx, recipe, dto.totalBatches);

      const count = await tx.execution.count();

      const executionCode = generateExecutionCode(count + 1);

      const execution = await tx.execution.create({
        data: {
          recipeId: dto.recipeId,

          recipeCode: recipe.recipeCode,
          recipeName: recipe.name,
          recipeVersion: recipe.version,

          executionCode,
          mode: dto.mode,
          totalBatches: dto.totalBatches,
          status: ExecutionStatus.PENDING,
          productionBatchNumber: dto.productionBatchNumber,
          masterBatchExpiringDate: dto.masterBatchExpiringDate ? new Date(dto.masterBatchExpiringDate) : null,
          finalBatchExpiringDate: dto.finalBatchExpiringDate ? new Date(dto.finalBatchExpiringDate) : null,
          operatorName: dto.operatorName,
        },
      });

      const batches = [];

      for (let i = 1; i <= dto.totalBatches; i++) {
        const batch = await tx.executionBatch.create({
          data: {
            executionId: execution.id,
            batchNumber: i,
            status: BatchExecutionStatus.PENDING,
            kneaderStatus: BatchProcessStatus.PENDING,
            mixingStatus: BatchProcessStatus.PENDING,
          },
        });

        if (recipe.steps.some((s) => s.stepType === 'KNEADER')) {
          await tx.kneaderExecution.create({
            data: {
              executionBatchId: batch.id,
              currentBatchType: recipe.steps.some(
                (s) => s.batchType === 'MASTER_BATCH'
              )
                ? 'MASTER_BATCH'
                : 'FINAL_BATCH',
            },
          });
        }

        if (
          recipe.steps.some((s) => s.stepType === 'MIXING') &&
          !recipe.steps.some((s) => s.stepType === 'KNEADER')
        ) {
          await tx.mixingExecution.create({
            data: {
              executionBatchId: batch.id,
              currentBatchType: recipe.steps.some(
                (s) => s.batchType === 'MASTER_BATCH'
              )
                ? 'MASTER_BATCH'
                : 'FINAL_BATCH',
            },
          });
        }

        batches.push(batch);
      }

      const executionIngredients = buildExecutionIngredients(
        recipe,
        execution,
        batches
      );

      await tx.executionIngredient.createMany({
        data: executionIngredients,
      });

      return {
        message: 'Execution created successfully.',

        execution: {
          id: execution.id,
          executionCode: execution.executionCode,
          recipeCode: recipe.recipeCode,
          recipeName: recipe.name,
          mode: execution.mode,
          totalBatches: execution.totalBatches,
          status: execution.status,
        },

        summary: {
          batchesCreated: batches.length,
          ingredientsCreated: executionIngredients.length,
        },
      };
    });
  }

  private async validateBinQuantities(tx: any, recipe: any, totalBatches: number) {
    // Collect all ingredients from recipe steps with their total required quantities
    const ingredientRequirements = new Map<number, {
      ingredient: any;
      totalRequired: number;
      minQuantity: number;
      binNumber: string;
    }>();

    for (const step of recipe.steps) {
      for (const stepIngredient of step.ingredients) {
        const ingredient = stepIngredient.ingredient;
        const bin = ingredient.bins?.[0];

        if (!bin) {
          return {
            valid: false,
            message: `Ingredient "${ingredient.name || ingredient.ingredientCode || ingredient.materialName}" is not assigned to any bin.`,
          };
        }

        const requiredPerBatch = stepIngredient.baseQuantity ?? stepIngredient.quantity ?? 0;
        const totalRequired = requiredPerBatch * totalBatches;

        const existing = ingredientRequirements.get(ingredient.id);
        if (existing) {
          existing.totalRequired += totalRequired;
        } else {
          ingredientRequirements.set(ingredient.id, {
            ingredient,
            totalRequired,
            minQuantity: bin.minQuantity,
            binNumber: bin.binNumber,
          });
        }
      }

      // Now validate each ingredient
      for (const [ingredientId, requirement] of ingredientRequirements.entries()) {
        const { ingredient, totalRequired, minQuantity, binNumber } = requirement;
        const bin = ingredient.bins?.[0];

        if (!bin) {
          return {
            valid: false,
            message: `Ingredient "${ingredient.name || ingredient.ingredientCode || ingredient.materialName}" is not assigned to any bin.`,
          };
        }

        const currentQuantity = bin.currentQuantity;
        const totalRequiredWithMin = totalRequired + minQuantity;

        if (currentQuantity < totalRequiredWithMin) {
          const shortage = totalRequiredWithMin - currentQuantity;
          return {
            valid: false,
            message: `Insufficient quantity in bin ${binNumber} for ingredient "${ingredient.name || ingredient.ingredientCode || ingredient.materialName}". Required: ${totalRequiredWithMin} kg, Available: ${currentQuantity} kg. Shortage: ${shortage} kg.`,
          };
        }
      }

      return { valid: true };
    }
  }

  async startExecution(executionId: number, userId: number) {
    return this.prisma.$transaction(async (tx) => {
      // Get the execution with all related data
      const execution = await tx.execution.findUnique({
        where: { id: executionId },
        include: {
          recipe: {
            include: {
              steps: {
                include: {
                  ingredients: {
                    include: {
                      ingredient: {
                        include: {
                          bins: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
            batches: true,
            schedules: {
              include: { operator: true },
            },
          },
        });

      if (!execution) {
        throw new NotFoundException('Execution not found.');
      }

      // Check if execution is in PENDING status (CREATED)
      if (execution.status !== ExecutionStatus.PENDING) {
        throw new BadRequestException('Execution can only be started from CREATED status.');
      }

      // Schedule check: if execution has a pending/expired schedule, it can only
      // be started on or after the scheduled date.
      const pendingSchedules = execution.schedules.filter(
        (s) => s.status === ScheduleStatus.PENDING || s.status === ScheduleStatus.EXPIRED,
      );
      if (pendingSchedules.length > 0) {
        const today = startOfDay(new Date());
        for (const schedule of pendingSchedules) {
          const scheduleDay = startOfDay(schedule.scheduleDate);
          if (!isBefore(today, scheduleDay)) {
            // Schedule date has arrived or passed; execution can start now (schedule becomes expired via refresh)
            continue;
          }
          const formattedDate = schedule.scheduleDate.toISOString().slice(0, 10);
          throw new BadRequestException(
            `This execution is scheduled for ${formattedDate}. It cannot be started before the scheduled date.`,
          );
        }
      }

      // Validate bin quantities
      const validationResult = await this.validateBinQuantitiesForStart(tx, execution);
      
      if (!validationResult.valid) {
        throw new BadRequestException(validationResult.message);
      }

      // Atomically claim the execution (PENDING -> RUNNING) to prevent
      // concurrent requests from starting the same execution twice.
      const claimed = await tx.execution.updateMany({
        where: {
          id: executionId,
          status: ExecutionStatus.PENDING,
        },
        data: {
          status: ExecutionStatus.RUNNING,
        },
      });

      if (claimed.count === 0) {
        throw new BadRequestException(
          'Execution has already been started or is no longer in CREATED status.'
        );
      }

      // Update all batches to RUNNING
      await tx.executionBatch.updateMany({
        where: { executionId: executionId },
        data: {
          status: BatchExecutionStatus.RUNNING,
          startedAt: new Date(),
        },
      });

      return {
        message: 'Execution started successfully.',
        execution: {
          id: execution.id,
          executionCode: execution.executionCode,
          status: ExecutionStatus.RUNNING,
        },
      };
    });
  }

  async getExecutionDetail(executionId: number) {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        recipe: true,
        operator: {
          select: { id: true, name: true, username: true },
        },
        schedules: {
          include: {
            operator: {
              select: { id: true, name: true, username: true },
            },
            createdBy: {
              select: { id: true, name: true, username: true },
            },
          },
          orderBy: { scheduleDate: 'asc' },
        },
        batches: {
          select: {
            id: true,
            batchNumber: true,
            status: true,
          },
          orderBy: { batchNumber: 'asc' },
        },
      },
    });

    if (!execution) {
      throw new NotFoundException('Execution not found.');
    }

    const today = startOfDay(new Date());
    const schedulesWithStatus = execution.schedules.map((schedule) => {
      let calcStatus = schedule.status;
      if (execution.status === 'COMPLETED') {
        calcStatus = 'SUCCESS';
      } else if (isAfter(today, startOfDay(schedule.scheduleDate))) {
        calcStatus = 'EXPIRED';
      } else {
        calcStatus = 'PENDING';
      }
      return {
        id: schedule.id,
        scheduleCode: schedule.scheduleCode,
        scheduleDate: schedule.scheduleDate,
        operatorName: schedule.operator?.name ?? '',
        operatorUsername: schedule.operator?.username ?? '',
        createdByName: schedule.createdBy?.name ?? '',
        status: calcStatus,
        createdAt: schedule.createdAt,
      };
    });

    return {
      id: execution.id,
      executionCode: execution.executionCode,
      recipeId: execution.recipeId,
      recipeName: execution.recipeName,
      recipeVersion: execution.recipeVersion,
      mode: execution.mode,
      totalBatches: execution.totalBatches,
      status: execution.status,
      operatorName: execution.operator?.name ?? '',
      operatorUsername: execution.operator?.username ?? '',
      productionBatchNumber: execution.productionBatchNumber,
      masterBatchExpiringDate: execution.masterBatchExpiringDate,
      finalBatchExpiringDate: execution.finalBatchExpiringDate,
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt,
      schedules: schedulesWithStatus,
      batches: execution.batches.map((b) => ({
        id: b.id,
        batchNumber: b.batchNumber,
        status: b.status,
      })),
    };
  }

  async updateExecution(
    executionId: number,
    data: {
      productionBatchNumber?: string;
      masterBatchExpiringDate?: string | null;
      finalBatchExpiringDate?: string | null;
      operatorName?: string;
      totalBatches?: number;
    }
  ) {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        schedules: true,
        batches: true,
      },
    });

    if (!execution) {
      throw new NotFoundException('Execution not found.');
    }

    if (execution.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot edit execution "${execution.executionCode}" — it is already ${execution.status.toLowerCase()}.`
      );
    }

    if (execution.schedules.length > 0) {
      throw new BadRequestException(
        `Cannot edit execution "${execution.executionCode}" — it is already scheduled.`
      );
    }

    const updateData: any = {};
    if (data.productionBatchNumber !== undefined) {
      updateData.productionBatchNumber = data.productionBatchNumber || null;
    }
    if (data.masterBatchExpiringDate !== undefined) {
      updateData.masterBatchExpiringDate =
        data.masterBatchExpiringDate
          ? new Date(data.masterBatchExpiringDate)
          : null;
    }
    if (data.finalBatchExpiringDate !== undefined) {
      updateData.finalBatchExpiringDate =
        data.finalBatchExpiringDate
          ? new Date(data.finalBatchExpiringDate)
          : null;
    }
    if (data.operatorName !== undefined) {
      updateData.operatorName = data.operatorName || null;
    }
    if (data.totalBatches !== undefined) {
      updateData.totalBatches = data.totalBatches;
    }

    const updated = await this.prisma.execution.update({
      where: { id: executionId },
      data: updateData,
    });

    return {
      message: 'Execution updated successfully.',
      execution: {
        id: updated.id,
        executionCode: updated.executionCode,
        status: updated.status,
        productionBatchNumber: updated.productionBatchNumber,
        masterBatchExpiringDate: updated.masterBatchExpiringDate,
        finalBatchExpiringDate: updated.finalBatchExpiringDate,
        operatorName: updated.operatorName,
        totalBatches: updated.totalBatches,
      },
    };
  }

  async deleteExecution(executionId: number) {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        schedules: true,
        batches: true,
      },
    });

    if (!execution) {
      throw new NotFoundException('Execution not found.');
    }

    if (execution.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot delete execution "${execution.executionCode}" — it is already ${execution.status.toLowerCase()}.`
      );
    }

    if (execution.schedules.length > 0) {
      throw new BadRequestException(
        `Cannot delete execution "${execution.executionCode}" — it is already scheduled.`
      );
    }

    await this.prisma.execution.delete({
      where: { id: executionId },
    });

    return {
      message: `Execution "${execution.executionCode}" deleted successfully.`,
    };
  }

  private async validateBinQuantitiesForStart(
    tx: any,
    execution: any
  ): Promise<{ valid: boolean; message?: string; details?: any }> {
    // Collect all ingredients from recipe steps with their total required quantities
    const ingredientRequirements = new Map<number, {
      ingredient: any;
      totalRequired: number;
      minQuantity: number;
      binNumber: string;
    }>();

    for (const step of execution.recipe.steps) {
      for (const stepIngredient of step.ingredients) {
        const ingredient = stepIngredient.ingredient;
        const bin = ingredient.bins?.[0];

        if (!bin) {
          return {
            valid: false,
            message: `Ingredient "${ingredient.name || ingredient.ingredientCode || ingredient.materialName}" is not assigned to any bin.`,
          };
        }

        const requiredPerBatch = stepIngredient.baseQuantity ?? stepIngredient.quantity ?? 0;
        const totalRequired = requiredPerBatch * execution.totalBatches;

        const existing = ingredientRequirements.get(ingredient.id);
        if (existing) {
          existing.totalRequired += totalRequired;
        } else {
          ingredientRequirements.set(ingredient.id, {
            ingredient,
            totalRequired,
            minQuantity: bin.minQuantity,
            binNumber: bin.binNumber,
          });
        }
      }
    }

    // Validate each aggregated ingredient against its bin
    for (const [, requirement] of ingredientRequirements.entries()) {
      const { ingredient, totalRequired, minQuantity, binNumber } = requirement;
      const bin = ingredient.bins?.[0];

      if (!bin) {
        return {
          valid: false,
          message: `Ingredient "${ingredient.name || ingredient.ingredientCode || ingredient.materialName}" is not assigned to any bin.`,
        };
      }

      const currentQuantity = bin.currentQuantity;
      const totalRequiredWithMin = totalRequired + minQuantity;

      if (currentQuantity < totalRequiredWithMin) {
        const shortage = totalRequiredWithMin - currentQuantity;
        const ingredientName =
          ingredient.name || ingredient.ingredientCode || ingredient.materialName;
        return {
          valid: false,
          message:
            `Unable to start execution. Bin ${binNumber} has insufficient quantity for ingredient "${ingredientName}". ` +
            `Available: ${currentQuantity} kg. Required for ${execution.totalBatches} batches: ${totalRequired} kg ` +
            `+ Minimum to maintain: ${minQuantity} kg = ${totalRequiredWithMin} kg. Shortage: ${shortage} kg. ` +
            `Please fill the bin before starting the execution.`,
          details: {
            ingredient: ingredientName,
            bin: binNumber,
            currentQuantity,
            requiredQuantity: totalRequired,
            minQuantity,
            totalRequired: totalRequiredWithMin,
            shortage,
          },
        };
      }
    }

    return { valid: true };
  }

  async findExecutionQrs(id: number) {
    const execution = await this.prisma.execution.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        executionCode: true,
        totalBatches: true,

        batches: {
          orderBy: {
            batchNumber: 'asc',
          },
          select: {
            id: true,
            batchNumber: true,

            ingredients: {
              orderBy: {
                plcIngredientIndex: 'asc',
              },
              select: {
                id: true,
                qrId: true,
                expectedQuantity: true,
                tolerance: true,

                ingredient: {
                  select: {
                    name: true,
                    ingredientCode: true,
                  },
                },
                recipeStep: {
                  select: {
                    stepType: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!execution) {
      throw new NotFoundException('Execution not found.');
    }

    return {
      id: execution.id,
      executionCode: execution.executionCode,
      totalBatches: execution.totalBatches,

      batches: execution.batches.map((batch) => ({
        id: batch.id,
        batchNumber: batch.batchNumber,

        ingredients: batch.ingredients.map((ingredient) => ({
          id: ingredient.id,
          qrId: ingredient.qrId,
          expectedQuantity: ingredient.expectedQuantity,
          tolerance: ingredient.tolerance,
          ingredientCode: ingredient.ingredient.ingredientCode,
          stepType: ingredient.recipeStep?.stepType ?? null,
        })),
      })),
    };
  }

  async getTracking(id: number) {
    const execution = await this.prisma.execution.findUnique({
      where: {
        id,
      },

      include: {
        recipe: {
          include: {
            steps: {
              include: {
                ingredients: true,
              },
              orderBy: {
                sequenceNumber: 'asc',
              },
            },
          },
        },

        batches: {
          orderBy: {
            batchNumber: 'asc',
          },

          include: {
            kneaderExecution: true,
            mixingExecution: true,
            masterBatch: true,
            finalBatch: true,

            ingredients: {
              orderBy: {
                plcIngredientIndex: 'asc',
              },
            },
          },
        },
      },
    });

    if (!execution) {
      throw new NotFoundException('Execution not found.');
    }

    const totalBatches = execution.batches.length;

    const completedBatches = execution.batches.filter(
      (batch) => batch.status === BatchExecutionStatus.COMPLETED
    ).length;

    const overallProgress =
      totalBatches === 0
        ? 0
        : Math.round((completedBatches / totalBatches) * 100);

    return {
      id: execution.id,
      executionCode: execution.executionCode,

      recipeCode: execution.recipeCode,
      recipeName: execution.recipeName,

      workflow: execution.recipe.workflow,
      status: execution.status,

      totalBatches,
      completedBatches,
      overallProgress,

      batches: execution.batches.map((batch) => {
        const weighingIngredients = batch.ingredients.map((ingredient) => ({
          id: ingredient.id,

          ingredientCode: ingredient.ingredientCode,
          ingredientName: ingredient.ingredientName,

          expectedQuantity: ingredient.expectedQuantity,
          actualQuantity: ingredient.actualQuantity,

          weighed: ingredient.actualQuantity !== null,

          weighedAt: ingredient.weighedAt,
          completedAt: ingredient.completedAt,
        }));

        const weighedIngredients = weighingIngredients.filter(
          (ingredient) => ingredient.weighed
        ).length;

        const totalWeighingIngredients = weighingIngredients.length;

        const weighingProgress =
          totalWeighingIngredients === 0
            ? 0
            : Math.round((weighedIngredients / totalWeighingIngredients) * 100);

        let weighingStatus: 'PENDING' | 'RUNNING' | 'COMPLETED';

        if (
          totalWeighingIngredients > 0 &&
          weighedIngredients === totalWeighingIngredients
        ) {
          weighingStatus = 'COMPLETED';
        } else if (weighedIngredients > 0) {
          weighingStatus = 'RUNNING';
        } else {
          weighingStatus = 'PENDING';
        }

        const buildProcessSection = (
          batchType: 'MASTER_BATCH' | 'FINAL_BATCH'
        ) => {
          const relevantSteps = execution.recipe.steps.filter(
            (step) => step.batchType === batchType
          );

          if (relevantSteps.length === 0) {
            return null;
          }

          const processType =
            relevantSteps.find((step) => step.stepType === 'KNEADER')
              ?.stepType ??
            relevantSteps.find((step) => step.stepType === 'MIXING')
              ?.stepType ??
            null;

          if (!processType) {
            return null;
          }

          const processSteps = relevantSteps
            .filter((step) => step.stepType === processType)
            .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

          const processIngredients = batch.ingredients.filter(
            (ingredient) =>
              ingredient.batchType === batchType &&
              ingredient.stepType === processType
          );

          const ingredientRows = processIngredients.map((ingredient) => {
            const scanned =
              processType === 'KNEADER'
                ? ingredient.kneaderScanned
                : ingredient.mixingScanned;

            return {
              id: ingredient.id,

              ingredientCode: ingredient.ingredientCode,
              ingredientName: ingredient.ingredientName,

              stepSequence: ingredient.stepSequence,

              status: ingredient.status,

              scanned,

              completed:
                ingredient.status === IngredientExecutionStatus.CONSUMED ||
                scanned,
            };
          });

          const sequenceRows = processSteps.map((step) => {
            const stepIngredients = processIngredients.filter(
              (ingredient) => ingredient.recipeStepId === step.id
            );

            const consumedCount = stepIngredients.filter(
              (ingredient) =>
                ingredient.status === IngredientExecutionStatus.CONSUMED
            ).length;

            const completed =
              stepIngredients.length > 0 &&
              consumedCount === stepIngredients.length;

            return {
              sequenceNumber: step.sequenceNumber,
              timerSeconds: step.timerSeconds,
              completed,
            };
          });

          const completedSteps = sequenceRows.filter(
            (step) => step.completed
          ).length;

          const totalSteps = sequenceRows.length;

          const progress =
            totalSteps === 0
              ? 0
              : Math.round((completedSteps / totalSteps) * 100);

          let currentSequence: number | null = null;
          let recipeWritten = false;

          if (processType === 'KNEADER' && batch.kneaderExecution) {
            if (batch.kneaderExecution.currentBatchType === batchType) {
              currentSequence = batch.kneaderExecution.currentStepSequence;
            }

            recipeWritten = batch.kneaderExecution.recipeWritten;
          }

          if (processType === 'MIXING' && batch.mixingExecution) {
            if (batch.mixingExecution.currentBatchType === batchType) {
              currentSequence = batch.mixingExecution.currentStageSequence;
            }

            recipeWritten = batch.mixingExecution.recipeWritten;
          }

          let status: 'PENDING' | 'RUNNING' | 'COMPLETED';

          if (totalSteps > 0 && completedSteps === totalSteps) {
            status = 'COMPLETED';
          } else {
            const anyStarted = ingredientRows.some(
              (ingredient) =>
                ingredient.scanned ||
                ingredient.status === IngredientExecutionStatus.CONSUMED
            );

            const currentlyActive =
              processType === 'KNEADER'
                ? batch.kneaderExecution?.currentBatchType === batchType &&
                  batch.kneaderStatus === BatchProcessStatus.RUNNING
                : batch.mixingExecution?.currentBatchType === batchType &&
                  batch.mixingStatus === BatchProcessStatus.RUNNING;

            status = anyStarted || currentlyActive ? 'RUNNING' : 'PENDING';
          }

          return {
            batchType,

            processType,

            status,

            currentSequence,

            completedSteps,
            totalSteps,
            progress,

            recipeWritten,

            sequences: sequenceRows,

            ingredients: ingredientRows,
          };
        };

        const masterBatch = buildProcessSection('MASTER_BATCH');
        const finalBatch = buildProcessSection('FINAL_BATCH');

        let currentProcess: 'WEIGHING' | 'KNEADER' | 'MIXING' | 'COMPLETED';

        if (weighingStatus !== 'COMPLETED') {
          currentProcess = 'WEIGHING';
        } else if (batch.kneaderStatus !== BatchProcessStatus.COMPLETED) {
          const hasKneaderSteps = execution.recipe.steps.some(
            (step) => step.stepType === StepType.KNEADER
          );

          currentProcess = hasKneaderSteps ? 'KNEADER' : 'MIXING';
        } else if (batch.mixingStatus !== BatchProcessStatus.COMPLETED) {
          const hasMixingSteps = execution.recipe.steps.some(
            (step) => step.stepType === StepType.MIXING
          );

          currentProcess = hasMixingSteps ? 'MIXING' : 'COMPLETED';
        } else {
          currentProcess = 'COMPLETED';
        }

        return {
          id: batch.id,
          batchNumber: batch.batchNumber,

          status: batch.status,

          kneaderStatus: batch.kneaderStatus,
          mixingStatus: batch.mixingStatus,

          currentProcess,

          weighing: {
            status: weighingStatus,

            weighedIngredients,
            totalIngredients: totalWeighingIngredients,

            progress: weighingProgress,

            ingredients: weighingIngredients,
          },

          masterBatch,

          finalBatch,

          masterBatchQr: batch.masterBatch?.qrId ?? null,
          finalBatchQr: batch.finalBatch?.qrId ?? null,
        };
      }),
    };
  }

  async getTrackingList() {
    const executions = await this.prisma.execution.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        recipe: true,
        batches: true,
      },
    });

    return executions.map((execution) => {
      const completedBatches = execution.batches.filter(
        (batch) => batch.status === 'COMPLETED'
      ).length;

      const progress =
        execution.totalBatches === 0
          ? 0
          : Math.round((completedBatches / execution.totalBatches) * 100);

      return {
        id: execution.id,
        executionCode: execution.executionCode,

        recipeCode: execution.recipeCode,
        recipeName: execution.recipeName,

        workflow: execution.recipe.workflow,

        totalBatches: execution.totalBatches,
        completedBatches,

        progress,

        status: execution.status,

        createdAt: execution.createdAt,
      };
    });
  }
}