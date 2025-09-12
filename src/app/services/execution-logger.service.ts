import { Injectable } from '@angular/core';

export interface ExecutionStep {
  timestamp: Date;
  phase: 'planning' | 'execution' | 'verification' | 'critic';
  type: 'phase_start' | 'phase_complete' | 'task_start' | 'task_complete' | 'task_error' | 'error';
  data: any;
  taskId?: string;
  duration?: number;
}

export interface TaskExecutionLog {
  taskId: string;
  description: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: any;
  error?: any;
}

@Injectable({
  providedIn: 'root'
})
export class ExecutionLoggerService {
  private executionLog: ExecutionStep[] = [];
  private taskLogs = new Map<string, TaskExecutionLog>();
  private executionStartTime?: Date;
  private currentPhase?: string;
  private phaseStartTime?: Date;

  constructor() {}

  startExecution(query: string): void {
    this.executionLog = [];
    this.taskLogs.clear();
    this.executionStartTime = new Date();
    
    this.log({
      phase: 'planning',
      type: 'phase_start',
      data: { 
        query,
        startTime: this.executionStartTime.toISOString()
      }
    });
  }

  logPhase(phase: 'planning' | 'execution' | 'verification' | 'critic', data: any): void {
    // Complete previous phase if exists
    if (this.currentPhase && this.phaseStartTime) {
      const duration = Date.now() - this.phaseStartTime.getTime();
      this.log({
        phase: this.currentPhase as any,
        type: 'phase_complete',
        data: { 
          phase: this.currentPhase,
          duration
        },
        duration
      });
    }

    // Start new phase
    this.currentPhase = phase;
    this.phaseStartTime = new Date();
    
    this.log({
      phase,
      type: 'phase_start',
      data: {
        phase,
        ...data,
        startTime: this.phaseStartTime.toISOString()
      }
    });
  }

  logTaskStart(task: any): void {
    const taskLog: TaskExecutionLog = {
      taskId: task.id,
      description: task.description,
      startTime: new Date(),
      status: 'executing'
    };
    
    this.taskLogs.set(task.id, taskLog);
    
    this.log({
      phase: 'execution',
      type: 'task_start',
      taskId: task.id,
      data: {
        taskId: task.id,
        description: task.description,
        tools: task.tools,
        dependencies: task.dependencies
      }
    });
  }

  logTaskComplete(task: any, result: any): void {
    const taskLog = this.taskLogs.get(task.id);
    if (taskLog) {
      taskLog.endTime = new Date();
      taskLog.duration = taskLog.endTime.getTime() - taskLog.startTime.getTime();
      taskLog.status = 'completed';
      taskLog.result = result;
    }
    
    this.log({
      phase: 'execution',
      type: 'task_complete',
      taskId: task.id,
      data: {
        taskId: task.id,
        result,
        duration: taskLog?.duration
      },
      duration: taskLog?.duration
    });
  }

  logTaskError(task: any, error: any): void {
    const taskLog = this.taskLogs.get(task.id);
    if (taskLog) {
      taskLog.endTime = new Date();
      taskLog.duration = taskLog.endTime.getTime() - taskLog.startTime.getTime();
      taskLog.status = 'failed';
      taskLog.error = error;
    }
    
    this.log({
      phase: 'execution',
      type: 'task_error',
      taskId: task.id,
      data: {
        taskId: task.id,
        error: error?.message || error,
        duration: taskLog?.duration
      },
      duration: taskLog?.duration
    });
  }

  logError(message: string, error: any): void {
    this.log({
      phase: (this.currentPhase as 'planning' | 'execution' | 'verification' | 'critic') || 'execution',
      type: 'error',
      data: {
        message,
        error: error?.message || error,
        stack: error?.stack
      }
    });
  }

  completeExecution(response: any): void {
    // Complete current phase
    if (this.currentPhase && this.phaseStartTime) {
      const duration = Date.now() - this.phaseStartTime.getTime();
      this.log({
        phase: this.currentPhase as any,
        type: 'phase_complete',
        data: { 
          phase: this.currentPhase,
          duration
        },
        duration
      });
    }

    // Log completion
    const totalDuration = this.executionStartTime 
      ? Date.now() - this.executionStartTime.getTime()
      : 0;

    this.log({
      phase: 'critic',
      type: 'phase_complete',
      data: {
        totalDuration,
        totalTasks: this.taskLogs.size,
        completedTasks: Array.from(this.taskLogs.values()).filter(t => t.status === 'completed').length,
        failedTasks: Array.from(this.taskLogs.values()).filter(t => t.status === 'failed').length,
        success: response.success
      },
      duration: totalDuration
    });
  }

  private log(step: Omit<ExecutionStep, 'timestamp'>): void {
    const logEntry: ExecutionStep = {
      ...step,
      timestamp: new Date()
    };
    
    this.executionLog.push(logEntry);
    
    // Console logging for development
    if (!this.isProduction()) {
      this.consoleLog(logEntry);
    }
  }

  private consoleLog(step: ExecutionStep): void {
    const time = step.timestamp.toLocaleTimeString();
    const phase = step.phase.toUpperCase();
    const type = step.type.toUpperCase();
    
    switch (step.type) {
      case 'phase_start':
        console.group(`🚀 [${time}] ${phase} PHASE STARTED`);
        console.log('Data:', step.data);
        console.groupEnd();
        break;
        
      case 'phase_complete':
        console.group(`✅ [${time}] ${phase} PHASE COMPLETED`);
        console.log('Duration:', step.duration ? `${step.duration}ms` : 'Unknown');
        console.log('Data:', step.data);
        console.groupEnd();
        break;
        
      case 'task_start':
        console.log(`⚡ [${time}] Task Started: ${step.taskId}`);
        console.log('  Description:', step.data.description);
        console.log('  Tools:', step.data.tools);
        break;
        
      case 'task_complete':
        console.log(`✅ [${time}] Task Completed: ${step.taskId} (${step.duration}ms)`);
        break;
        
      case 'task_error':
        console.error(`❌ [${time}] Task Failed: ${step.taskId} (${step.duration}ms)`);
        console.error('  Error:', step.data.error);
        break;
        
      case 'error':
        console.error(`🚨 [${time}] ${phase} ERROR:`, step.data.message);
        console.error('  Details:', step.data.error);
        break;
    }
  }

  private isProduction(): boolean {
    return typeof window !== 'undefined' && window.location.hostname !== 'localhost';
  }

  // Public getter methods
  getExecutionLog(): ExecutionStep[] {
    return [...this.executionLog];
  }

  getTaskLogs(): TaskExecutionLog[] {
    return Array.from(this.taskLogs.values());
  }

  getExecutionSummary(): any {
    const totalDuration = this.executionStartTime 
      ? Date.now() - this.executionStartTime.getTime()
      : 0;

    const taskLogs = Array.from(this.taskLogs.values());
    const phaseDurations = this.calculatePhaseDurations();

    return {
      totalDuration,
      totalTasks: taskLogs.length,
      completedTasks: taskLogs.filter(t => t.status === 'completed').length,
      failedTasks: taskLogs.filter(t => t.status === 'failed').length,
      phases: phaseDurations,
      averageTaskDuration: this.calculateAverageTaskDuration(taskLogs),
      longestTask: this.findLongestTask(taskLogs),
      executionLog: this.executionLog
    };
  }

  private calculatePhaseDurations(): Record<string, number> {
    const durations: Record<string, number> = {};
    const phaseStarts = new Map<string, Date>();

    for (const step of this.executionLog) {
      if (step.type === 'phase_start') {
        phaseStarts.set(step.phase, step.timestamp);
      } else if (step.type === 'phase_complete' && step.duration) {
        durations[step.phase] = step.duration;
      }
    }

    return durations;
  }

  private calculateAverageTaskDuration(taskLogs: TaskExecutionLog[]): number {
    const completedTasks = taskLogs.filter(t => t.duration);
    if (completedTasks.length === 0) return 0;
    
    const totalDuration = completedTasks.reduce((sum, task) => sum + (task.duration || 0), 0);
    return Math.round(totalDuration / completedTasks.length);
  }

  private findLongestTask(taskLogs: TaskExecutionLog[]): TaskExecutionLog | null {
    return taskLogs.reduce((longest, current) => {
      if (!current.duration) return longest;
      if (!longest || !longest.duration) return current;
      return current.duration > longest.duration ? current : longest;
    }, null as TaskExecutionLog | null);
  }

  // Method to format logs for "Show prompts" feature
  getFormattedPromptLogs(): any[] {
    return this.executionLog.map(step => ({
      timestamp: step.timestamp.toISOString(),
      phase: step.phase,
      type: step.type,
      taskId: step.taskId,
      data: step.data,
      duration: step.duration
    }));
  }

  // Clear logs
  clear(): void {
    this.executionLog = [];
    this.taskLogs.clear();
    this.executionStartTime = undefined;
    this.currentPhase = undefined;
    this.phaseStartTime = undefined;
  }
}