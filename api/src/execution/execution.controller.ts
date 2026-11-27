import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
  Req,
} from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { ExecutionService } from './execution.service';
import { CreateExecutionDto } from './dto/create-execution.dto';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('executions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExecutionController {
  constructor(private readonly executionService: ExecutionService) {}

  @Post()
  @Roles(UserRole.RUBBER_TECHNOLOGIST)
  create(@Body() dto: CreateExecutionDto) {
    return this.executionService.create(dto);
  }

  @Post(':id/start')
  @Roles(UserRole.OPERATOR, UserRole.RUBBER_TECHNOLOGIST)
  start(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.executionService.startExecution(id, req.user.id);
  }

  @Get(':id/qrs')
  @Roles(
    UserRole.STORES,
    UserRole.RUBBER_TECHNOLOGIST,
    UserRole.OPERATOR,
    UserRole.QUALITY_CONTROL,
  )
  findExecutionQrs(@Param('id', ParseIntPipe) id: number) {
    return this.executionService.findExecutionQrs(id);
  }

  @Get('tracking')
  @Roles(
    UserRole.RUBBER_TECHNOLOGIST,
    UserRole.OPERATOR,
    UserRole.QUALITY_CONTROL,
  )
  getTrackingList() {
    return this.executionService.getTrackingList();
  }

  @Get(':id/tracking')
  @Roles(
    UserRole.RUBBER_TECHNOLOGIST,
    UserRole.OPERATOR,
    UserRole.QUALITY_CONTROL,
  )
  getTracking(@Param('id', ParseIntPipe) id: number) {
    return this.executionService.getTracking(id);
  }

  @Get(':id/detail')
  @Roles(
    UserRole.RUBBER_TECHNOLOGIST,
    UserRole.OPERATOR,
    UserRole.QUALITY_CONTROL,
  )
  getExecutionDetail(@Param('id', ParseIntPipe) id: number) {
    return this.executionService.getExecutionDetail(id);
  }

  @Put(':id')
  @Roles(UserRole.RUBBER_TECHNOLOGIST)
  updateExecution(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: any
  ) {
    return this.executionService.updateExecution(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.RUBBER_TECHNOLOGIST)
  deleteExecution(@Param('id', ParseIntPipe) id: number) {
    return this.executionService.deleteExecution(id);
  }
}