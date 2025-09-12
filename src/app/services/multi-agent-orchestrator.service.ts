import { Injectable } from '@angular/core';
import { TaskDependencyManagerService } from './task-dependency-manager.service';
import { ExecutionLoggerService } from './execution-logger.service';
import { McpRegistryService, McpTool } from './mcp-registry.service';
import { PromptLoggingService } from './prompt-logging.service';
import { environment } from '../../environments/environment';

export interface Task {
  id: string;
  description: string;
  dependencies: string[];
  tools: string[];
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  systemRole: 'planner' | 'executor' | 'verifier' | 'critic';
  executionOrder: number;
}

export interface ExecutionPlan {
  tasks: Task[];
  totalSteps: number;
  parallelGroups: Task[][];
}

export interface MultiAgentResponse {
  finalAnswer: string;
  executionLog: any[];
  tasks: Task[];
  success: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class MultiAgentOrchestratorService {
  private readonly functionsUrl = environment.production 
    ? 'https://us-central1-aiplayground-6e5be.cloudfunctions.net'
    : 'http://127.0.0.1:5001/aiplayground-6e5be/us-central1';

  constructor(
    private taskManager: TaskDependencyManagerService,
    private logger: ExecutionLoggerService,
    private mcpRegistry: McpRegistryService,
    private promptLogging: PromptLoggingService
  ) {}

  async processQuery(
    query: string, 
    sessionId?: string,
    modelSelection?: any
  ): Promise<MultiAgentResponse> {
    this.logger.startExecution(query);
    
    try {
      // Phase 1: Planning
      const plan = await this.planningPhase(query, modelSelection);
      this.logger.logPhase('planning', { taskCount: plan.tasks.length });
      
      // Phase 2: Execution with dependency management
      const executedTasks = await this.executionPhase(plan, modelSelection);
      this.logger.logPhase('execution', { completedTasks: executedTasks.filter(t => t.status === 'completed').length });
      
      // Phase 3: Verification
      const verification = await this.verificationPhase(executedTasks, query, modelSelection);
      this.logger.logPhase('verification', verification);
      
      // Phase 4: Final formatting
      const finalAnswer = await this.criticPhase(verification, query, modelSelection);
      this.logger.logPhase('critic', { answerLength: finalAnswer.length });
      
      const response: MultiAgentResponse = {
        finalAnswer,
        executionLog: this.logger.getExecutionLog(),
        tasks: executedTasks,
        success: true
      };
      
      this.logger.completeExecution(response);
      return response;
      
    } catch (error) {
      this.logger.logError('Multi-agent orchestration failed', error);
      return {
        finalAnswer: 'Sorry, I encountered an error while processing your request with multi-agent orchestration.',
        executionLog: this.logger.getExecutionLog(),
        tasks: [],
        success: false
      };
    }
  }

  private async planningPhase(query: string, modelSelection?: any): Promise<ExecutionPlan> {
    const availableTools = this.mcpRegistry.getAvailableTools();
    
    const plannerRequest = {
      query,
      availableTools: availableTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        serverId: tool.serverId,
        inputSchema: tool.inputSchema
      })),
      enablePromptLogging: this.promptLogging.isLoggingActive(),
      modelSelection: modelSelection
    };

    // Log to prompt logging if enabled
    if (this.promptLogging.isLoggingActive()) {
      console.log('🤖 Multi-Agent Planning Phase:', {
        query: query.substring(0, 200) + '...',
        toolCount: availableTools.length,
        tools: availableTools.map(t => t.name)
      });
    }

    const response = await fetch(`${this.functionsUrl}/multiAgentPlanner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plannerRequest)
    });

    if (!response.ok) {
      throw new Error(`Planner failed: ${response.statusText}`);
    }

    const plannerResponse = await response.json();
    
    // Convert planner response to execution plan
    const tasks: Task[] = plannerResponse.tasks.map((task: any, index: number) => ({
      id: task.id || `task_${index}`,
      description: task.description,
      dependencies: task.dependencies || [],
      tools: task.tools || [],
      status: 'pending' as const,
      systemRole: 'executor' as const,
      executionOrder: 0 // Will be set by dependency manager
    }));

    // Use dependency manager to create execution order
    const orderedPlan = this.taskManager.createExecutionPlan(tasks);
    
    return orderedPlan;
  }

  private async executionPhase(plan: ExecutionPlan, modelSelection?: any): Promise<Task[]> {
    const allTasks = [...plan.tasks];
    
    // Execute tasks in parallel groups based on dependencies
    for (const parallelGroup of plan.parallelGroups) {
      const executionPromises = parallelGroup.map(task => this.executeTask(task, modelSelection));
      const results = await Promise.allSettled(executionPromises);
      
      // Update task statuses based on results
      results.forEach((result, index) => {
        const task = parallelGroup[index];
        if (result.status === 'fulfilled') {
          task.status = 'completed';
          task.result = result.value;
        } else {
          task.status = 'failed';
          task.error = result.reason?.message || 'Unknown error';
        }
      });
      
      // Check if any critical tasks failed
      const failedTasks = parallelGroup.filter(t => t.status === 'failed');
      if (failedTasks.length > 0) {
        this.logger.logError('Critical tasks failed', failedTasks);
        // Mark remaining tasks as failed due to dependency
        const remainingTasks = allTasks.filter(t => t.status === 'pending');
        remainingTasks.forEach(t => {
          t.status = 'failed';
          t.error = 'Dependency task failed';
        });
        break;
      }
    }
    
    return allTasks;
  }

  private async executeTask(task: Task, modelSelection?: any): Promise<any> {
    this.logger.logTaskStart(task);
    task.status = 'executing';
    
    try {
      // Get results from dependent tasks
      const dependencyResults = this.taskManager.getDependencyResults(task.id);
      
      const executorRequest = {
        task: {
          id: task.id,
          description: task.description,
          tools: task.tools,
          dependencyResults
        },
        enablePromptLogging: this.promptLogging.isLoggingActive(),
        modelSelection: modelSelection
      };

      // Log to prompt logging if enabled
      if (this.promptLogging.isLoggingActive()) {
        console.log(`⚡ Multi-Agent Executing Task: ${task.id}`, {
          description: task.description,
          tools: task.tools,
          dependencyCount: Object.keys(dependencyResults).length
        });
      }

      const response = await fetch(`${this.functionsUrl}/multiAgentExecutor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(executorRequest)
      });

      if (!response.ok) {
        throw new Error(`Executor failed: ${response.statusText}`);
      }

      const result = await response.json();
      this.logger.logTaskComplete(task, result);
      
      // Store result for dependent tasks
      this.taskManager.setTaskResult(task.id, result);
      
      return result;
      
    } catch (error) {
      this.logger.logTaskError(task, error);
      throw error;
    }
  }

  private async verificationPhase(tasks: Task[], originalQuery: string, modelSelection?: any): Promise<any> {
    const completedTasks = tasks.filter(t => t.status === 'completed');
    
    const verifierRequest = {
      originalQuery,
      tasks: completedTasks.map(t => ({
        id: t.id,
        description: t.description,
        result: t.result
      })),
      enablePromptLogging: this.promptLogging.isLoggingActive(),
      modelSelection: modelSelection
    };

    // Log to prompt logging if enabled
    if (this.promptLogging.isLoggingActive()) {
      console.log('✅ Multi-Agent Verification Phase:', {
        originalQuery: originalQuery.substring(0, 200) + '...',
        completedTaskCount: completedTasks.length,
        taskIds: completedTasks.map(t => t.id)
      });
    }

    const response = await fetch(`${this.functionsUrl}/multiAgentVerifier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verifierRequest)
    });

    if (!response.ok) {
      throw new Error(`Verifier failed: ${response.statusText}`);
    }

    return await response.json();
  }

  private async criticPhase(verification: any, originalQuery: string, modelSelection?: any): Promise<string> {
    const criticRequest = {
      originalQuery,
      verification,
      taskResults: verification.taskResults || [],
      enablePromptLogging: this.promptLogging.isLoggingActive(),
      modelSelection: modelSelection
    };

    // Log to prompt logging if enabled
    if (this.promptLogging.isLoggingActive()) {
      console.log('🎨 Multi-Agent Critic Phase:', {
        originalQuery: originalQuery.substring(0, 200) + '...',
        verificationConfidence: verification.confidence,
        overallCorrect: verification.overallCorrect
      });
    }

    const response = await fetch(`${this.functionsUrl}/multiAgentCritic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(criticRequest)
    });

    if (!response.ok) {
      throw new Error(`Critic failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.finalAnswer || result.answer || 'No answer generated';
  }

  // Utility method to check if multi-agent orchestration is available
  isAvailable(): boolean {
    return this.mcpRegistry.getAvailableTools().length > 0;
  }
}