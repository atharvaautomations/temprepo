import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { ScheduleQueryDto } from './dto/schedule-query.dto';
import { ScheduleStatus, ExecutionStatus, UserRole } from '@prisma/client';
import { subDays, startOfDay, endOfDay, isAfter } from 'date-fns';

@Injectable()
export class SchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  private generateScheduleCode(): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `SCH-${dateStr}-${random}`;
  }

  private calculateScheduleStatus(
    scheduleDate: Date,
    executionStatus: ExecutionStatus
  ): ScheduleStatus {
    const today = startOfDay(new Date());
    const scheduleDay = startOfDay(scheduleDate);

    if (executionStatus === ExecutionStatus.COMPLETED) {
      return ScheduleStatus.SUCCESS;
    }

    if (isAfter(today, scheduleDay)) {
      return ScheduleStatus.EXPIRED;
    }

    return ScheduleStatus.PENDING;
  }

  async createSchedule(
    dto: CreateScheduleDto,
    createdById: number
  ) {
    const execution = await this.prisma.execution.findUnique({
      where: { id: dto.executionId },
    });

    if (!execution) {
      throw new NotFoundException('Execution not found');
    }

    // Prevent creating a schedule for an execution that has already started.
    if (execution.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot create a schedule. Execution "${execution.executionCode}" is already ${execution.status.toLowerCase()}.`,
      );
    }

    const operator = await this.prisma.user.findUnique({
      where: { id: dto.operatorId },
    });

    if (!operator) {
      throw new NotFoundException('Operator not found');
    }

    if (operator.role !== UserRole.OPERATOR) {
      throw new BadRequestException('Selected user is not an operator');
    }

    if (!operator.isActive) {
      throw new BadRequestException('Selected operator is not active');
    }

    const scheduleDate = new Date(dto.scheduleDate);
    const today = startOfDay(new Date());
    const scheduleDay = startOfDay(scheduleDate);

    if (isAfter(today, scheduleDay)) {
      throw new BadRequestException('Schedule date cannot be in the past');
    }

    const existingSchedule = await this.prisma.executionSchedule.findFirst({
      where: {
        executionId: dto.executionId,
      },
    });

    if (existingSchedule) {
      throw new BadRequestException(
        `Execution "${execution.executionCode}" is already scheduled and cannot be rescheduled.`
      );
    }

    const scheduleCode = this.generateScheduleCode();

    const schedule = await this.prisma.executionSchedule.create({
      data: {
        scheduleCode,
        executionId: dto.executionId,
        operatorId: dto.operatorId,
        scheduleDate,
        createdById,
      },
      include: {
        execution: {
          include: {
            recipe: true,
          },
        },
        operator: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    return this.enrichScheduleWithStatus(schedule);
  }

  async getSchedules(
    query: ScheduleQueryDto,
    userRole: UserRole,
    userId: number
  ) {
    const where: any = {};

    if (userRole === UserRole.OPERATOR) {
      where.operatorId = userId;
    } else if (query.operatorId) {
      where.operatorId = query.operatorId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.fromDate || query.toDate) {
      where.scheduleDate = {};
      if (query.fromDate) {
        where.scheduleDate.gte = new Date(query.fromDate);
      }
      if (query.toDate) {
        where.scheduleDate.lte = endOfDay(new Date(query.toDate));
      }
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const [schedules, total] = await this.prisma.$transaction([
      this.prisma.executionSchedule.findMany({
        where,
        include: {
          execution: {
            include: {
              recipe: true,
            },
          },
          operator: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.executionSchedule.count({ where }),
    ]);

    const enrichedSchedules = schedules.map((schedule) =>
      this.enrichScheduleWithStatus(schedule)
    );

    return {
      schedules: enrichedSchedules,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getScheduleById(id: number, userRole: UserRole, userId: number) {
    const schedule = await this.prisma.executionSchedule.findUnique({
      where: { id },
      include: {
        execution: {
          include: {
            recipe: true,
            batches: true,
          },
        },
        operator: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }

    if (userRole === UserRole.OPERATOR && schedule.operatorId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return this.enrichScheduleWithStatus(schedule);
  }

  async getOperatorSchedules(userId: number, query: ScheduleQueryDto) {
    return this.getSchedules(query, UserRole.OPERATOR, userId);
  }

  async getAvailableExecutions() {
    const executions = await this.prisma.execution.findMany({
      where: {
        status: {
          in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING],
        },
        schedules: {
          none: {},
        },
      },
      include: {
        recipe: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return executions.map((execution) => ({
      id: execution.id,
      executionCode: execution.executionCode,
      recipeName: execution.recipeName,
      recipeVersion: execution.recipeVersion,
      totalBatches: execution.totalBatches,
      status: execution.status,
    }));
  }

  async getAvailableOperators() {
    const operators = await this.prisma.user.findMany({
      where: {
        role: UserRole.OPERATOR,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        username: true,
      },
      orderBy: { name: 'asc' },
    });

    return operators;
  }

  private enrichScheduleWithStatus(schedule: any) {
    const calculatedStatus = this.calculateScheduleStatus(
      schedule.scheduleDate,
      schedule.execution.status
    );

    return {
      ...schedule,
      status: calculatedStatus,
      executionCode: schedule.execution?.executionCode ?? '',
      recipeName: schedule.execution?.recipe?.name ?? '',
      recipeVersion: schedule.execution?.recipe?.version ?? 0,
      operatorName: schedule.operator?.name ?? '',
      createdByName: schedule.createdBy?.name ?? '',
    };
  }

  async refreshScheduleStatuses() {
    const schedules = await this.prisma.executionSchedule.findMany({
      include: {
        execution: true,
      },
    });

    for (const schedule of schedules) {
      const newStatus = this.calculateScheduleStatus(
        schedule.scheduleDate,
        schedule.execution.status
      );

      if (schedule.status !== newStatus) {
        await this.prisma.executionSchedule.update({
          where: { id: schedule.id },
          data: { status: newStatus },
        });
      }
    }

    return { updated: schedules.length };
  }
}