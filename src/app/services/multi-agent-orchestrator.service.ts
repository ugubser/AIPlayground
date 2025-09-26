import { Injectable } from '@angular/core';
import { TaskDependencyManagerService } from './task-dependency-manager.service';
import { ExecutionLoggerService } from './execution-logger.service';
import { McpRegistryService } from './mcp-registry.service';
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

export interface MultiAgentRequest {
  query: string;
  sessionId?: string;
  modelSelection?: any;
  temperature?: number;
  seed?: number;
  enablePromptLogging?: boolean;
  skipCriticPhase?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class MultiAgentOrchestratorService {
  private readonly functionsUrl = environment.production 
    ? 'https://us-central1-aiplayground-6e5be.cloudfunctions.net'
    : 'http://127.0.0.1:5001/aiplayground-6e5be/us-central1';
  private readonly defaultMcpModel = 'meta-llama/llama-4-maverick:free';

  constructor(
    private taskManager: TaskDependencyManagerService,
    private logger: ExecutionLoggerService,
    private mcpRegistry: McpRegistryService,
    private promptLogging: PromptLoggingService
  ) {}

  private logPhaseEvent(options: {
    type: 'request' | 'response';
    title: string;
    content: string;
    sessionContext: string;
    provider: string;
    model?: string;
    status?: 'pending' | 'completed' | 'error';
    metadata?: Record<string, any>;
  }): string {
    if (!this.promptLogging.isLoggingActive()) {
      return '';
    }

    return this.promptLogging.addPromptLog({
      type: options.type,
      provider: options.provider,
      model: options.model,
      content: options.content,
      timestamp: new Date(),
      sessionContext: options.sessionContext,
      status: options.status,
      title: options.title,
      metadata: options.metadata
    });
  }

  async processQuery(
    query: string, 
    sessionId?: string,
    modelSelection?: any
  ): Promise<MultiAgentResponse> {
    return this.processQueryWithParams({
      query,
      sessionId,
      modelSelection
    });
  }

  async processQueryWithParams(request: MultiAgentRequest): Promise<MultiAgentResponse> {
    this.logger.startExecution(request.query);
    
    console.log('🤖 Multi-Agent Request Parameters:', {
      temperature: request.temperature,
      seed: request.seed,
      enablePromptLogging: request.enablePromptLogging,
      modelSelection: request.modelSelection
    });
    
    try {
      // Phase 1: Planning
      const plan = await this.planningPhase(request.query, request.modelSelection, request.temperature, request.seed, request.enablePromptLogging);
      this.logger.logPhase('planning', { taskCount: plan.tasks.length });
      
      // Phase 2: Execution with dependency management
      const executedTasks = await this.executionPhase(plan, request.modelSelection, request.temperature, request.seed, request.enablePromptLogging);
      this.logger.logPhase('execution', { completedTasks: executedTasks.filter(t => t.status === 'completed').length });
      
      // Phase 3: Verification
      const verification = await this.verificationPhase(executedTasks, request.query, request.modelSelection, request.temperature, request.seed, request.enablePromptLogging);
      this.logger.logPhase('verification', verification);

      // Phase 4: Final formatting (skip critic if requested)
      let finalAnswer: string;
      if (request.skipCriticPhase) {
        // Skip critic phase and use verifier result as final answer
        finalAnswer = verification.finalAnswer;
        this.logger.logPhase('critic', { skipped: true, answerLength: finalAnswer.length });
      } else {
        // Run critic phase for final formatting
        finalAnswer = await this.criticPhase(verification, request.query, request.modelSelection, request.temperature, request.seed, request.enablePromptLogging);
        this.logger.logPhase('critic', { answerLength: finalAnswer.length });
      }
      
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

  private async planningPhase(query: string, modelSelection?: any, temperature?: number, seed?: number, enablePromptLogging?: boolean): Promise<ExecutionPlan> {
    const availableTools = this.mcpRegistry.getAvailableTools();
    
    const plannerRequest = {
      query,
      availableTools: availableTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        serverId: tool.serverId,
        inputSchema: tool.inputSchema
      })),
      enablePromptLogging: enablePromptLogging !== undefined ? enablePromptLogging : this.promptLogging.isLoggingActive(),
      modelSelection: modelSelection,
      temperature: temperature,
      seed: seed
    };

    const plannerModel = modelSelection?.llm?.model || this.defaultMcpModel;
    const plannerRequestSummary = {
      query: query.substring(0, 500),
      toolCount: plannerRequest.availableTools.length,
      tools: plannerRequest.availableTools.map(tool => ({
        name: tool.name,
        serverId: tool.serverId
      })),
      temperature,
      seed
    };

    const plannerRequestLogId = this.logPhaseEvent({
      type: 'request',
      title: 'Planning Request',
      content: JSON.stringify(plannerRequestSummary, null, 2),
      sessionContext: 'multi-agent-planner',
      provider: 'Multi-Agent Planner',
      model: plannerModel,
      status: 'pending',
      metadata: {
        phase: 'planning'
      }
    });

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
      this.promptLogging.updatePromptLog(plannerRequestLogId, {
        status: 'error',
        content: JSON.stringify(
          {
            ...plannerRequestSummary,
            error: `${response.status} ${response.statusText}`
          },
          null,
          2
        )
      });
      throw new Error(`Planner failed: ${response.statusText}`);
    }

    const plannerResponse = await response.json();

    this.promptLogging.updatePromptLog(plannerRequestLogId, {
      status: 'completed'
    });

    this.logPhaseEvent({
      type: 'response',
      title: 'Planning Response',
      content: JSON.stringify({
        taskCount: plannerResponse.tasks?.length || 0,
        totalSteps: plannerResponse.totalSteps,
        reasoning: plannerResponse.reasoning,
        tasks: plannerResponse.tasks
      }, null, 2),
      sessionContext: 'multi-agent-planner',
      provider: 'Multi-Agent Planner',
      model: plannerModel,
      status: 'completed',
      metadata: {
        phase: 'planning',
        taskCount: plannerResponse.tasks?.length || 0
      }
    });
    
    // Log prompt data if available and enabled
    if (plannerResponse.promptData && (enablePromptLogging !== undefined ? enablePromptLogging : this.promptLogging.isLoggingActive())) {
      const messageId = `multiagent_planner_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      
      if (plannerResponse.promptData.llmRequest) {
        this.promptLogging.addPromptLog({
          type: 'request',
          provider: plannerResponse.promptData.llmRequest.provider,
          model: plannerResponse.promptData.llmRequest.model,
          content: plannerResponse.promptData.llmRequest.content,
          timestamp: new Date(),
          sessionContext: 'multi-agent-planner',
          messageId: messageId,
          status: 'completed',
          title: 'Planning LLM Request',
          metadata: {
            phase: 'planning'
          }
        });
      }
      
      if (plannerResponse.promptData.llmResponse) {
        this.promptLogging.addPromptLog({
          type: 'response',
          provider: plannerResponse.promptData.llmResponse.provider,
          model: plannerResponse.promptData.llmResponse.model,
          content: plannerResponse.promptData.llmResponse.content,
          timestamp: new Date(),
          sessionContext: 'multi-agent-planner',
          messageId: messageId,
          status: 'completed',
          title: 'Planning LLM Response',
          metadata: {
            phase: 'planning'
          }
        });
      }
    }
    
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

    console.log('🗂️ Planner generated tasks:', tasks.map(t => ({
      id: t.id,
      description: t.description.substring(0, 20) + '...',
      dependencies: t.dependencies,
      tools: t.tools
    }))); 
    // Use dependency manager to create execution order
    const orderedPlan = this.taskManager.createExecutionPlan(tasks);
    
    return orderedPlan;
  }

  private async executionPhase(plan: ExecutionPlan, modelSelection?: any, temperature?: number, seed?: number, enablePromptLogging?: boolean): Promise<Task[]> {
    const allTasks = [...plan.tasks];

    // Get all available tools once at the beginning to avoid redundant calls
    const availableTools = this.mcpRegistry.getAvailableTools();
    console.log('🔧 Cached tools for execution phase:', {
      totalTools: availableTools.length,
      toolNames: availableTools.map(t => t.name)
    });

    // Execute tasks in parallel groups based on dependencies
    for (const parallelGroup of plan.parallelGroups) {
      if (parallelGroup.length === 1) {
        // For single tasks, use the existing individual executor
        const task = parallelGroup[0];
        try {
          const result = await this.executeTask(task, modelSelection, temperature, seed, enablePromptLogging, availableTools);
          task.status = 'completed';
          task.result = result;
        } catch (error: any) {
          task.status = 'failed';
          task.error = error.message || 'Unknown error';
        }
      } else {
        // For multiple tasks, use multi-task execution
        try {
          const multiTaskResult = await this.executeMultipleTasks(parallelGroup, modelSelection, temperature, seed, enablePromptLogging, availableTools);

          // Update task statuses based on results
          parallelGroup.forEach(task => {
            if (multiTaskResult.taskResults[task.id]) {
              task.status = 'completed';
              task.result = multiTaskResult.taskResults[task.id];
              // Store result for dependent tasks
              this.taskManager.setTaskResult(task.id, task.result);
            } else {
              task.status = 'failed';
              task.error = 'No result returned for task';
            }
          });
        } catch (error: any) {
          // If multi-task execution fails, mark all tasks as failed
          parallelGroup.forEach(task => {
            task.status = 'failed';
            task.error = error.message || 'Multi-task execution error';
          });
        }
      }

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

  private async executeTask(task: Task, modelSelection?: any, temperature?: number, seed?: number, enablePromptLogging?: boolean, availableTools?: any[]): Promise<any> {
    this.logger.logTaskStart(task);
    task.status = 'executing';
    
    const executorModel = modelSelection?.llm?.model || this.defaultMcpModel;
    let executorRequestLogId = '';
    let executorRequestSummary: Record<string, any> = {};

    try {
      // Get results from dependent tasks
      const dependencyResults = this.taskManager.getDependencyResults(task.id);
      
      // Filter available tools to only those needed for this task
      const filteredMcpTools = availableTools ? availableTools.filter(tool => 
        task.tools.includes(tool.name)
      ) : [];
      
      // Convert MCP tools to OpenAI tool format expected by LLM utils
      const taskTools = filteredMcpTools.map(mcpTool => ({
        type: 'function',
        function: {
          name: mcpTool.name,
          description: mcpTool.description,
          parameters: mcpTool.inputSchema
        }
      }));
      
      console.log(`🔧 Tools for task ${task.id}:`, {
        requested: task.tools,
        available: taskTools.map(t => t.function.name),
        filtered: taskTools.length
      });
      
      const executorRequest = {
        task: {
          id: task.id,
          description: task.description,
          tools: task.tools,
          dependencyResults
        },
        enablePromptLogging: enablePromptLogging !== undefined ? enablePromptLogging : this.promptLogging.isLoggingActive(),
        modelSelection: modelSelection,
        temperature: temperature,
        seed: seed,
        preFilteredTools: taskTools // Pass pre-filtered tools to avoid server calls
      };

      executorRequestSummary = {
        taskId: task.id,
        description: task.description,
        tools: task.tools,
        dependencyResults,
        toolNames: taskTools.map(tool => tool.function.name),
        temperature,
        seed
      };

      executorRequestLogId = this.logPhaseEvent({
        type: 'request',
        title: `Task ${task.id} Execution Request`,
        content: JSON.stringify(executorRequestSummary, null, 2),
        sessionContext: `multi-agent-executor-${task.id}`,
        provider: 'Task Executor',
        model: executorModel,
        status: 'pending',
        metadata: {
          phase: 'execution',
          taskId: task.id
        }
      });

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
        if (executorRequestLogId) {
          this.promptLogging.updatePromptLog(executorRequestLogId, {
            status: 'error',
            content: JSON.stringify(
              {
                ...executorRequestSummary,
                error: `${response.status} ${response.statusText}`
              },
              null,
              2
            )
          });
        }
        throw new Error(`Executor failed: ${response.statusText}`);
      }

      const result = await response.json();
      if (executorRequestLogId) {
        this.promptLogging.updatePromptLog(executorRequestLogId, {
          status: 'completed'
        });
      }

      this.logPhaseEvent({
        type: 'response',
        title: `Task ${task.id} Execution Response`,
        content: JSON.stringify(result, null, 2),
        sessionContext: `multi-agent-executor-${task.id}`,
        provider: 'Task Executor',
        model: executorModel,
        status: 'completed',
        metadata: {
          phase: 'execution',
          taskId: task.id
        }
      });
      this.logger.logTaskComplete(task, result);
      
      // Log prompt data if available and enabled
      if (result.promptData && (enablePromptLogging !== undefined ? enablePromptLogging : this.promptLogging.isLoggingActive())) {
        const messageId = `multiagent_executor_${task.id}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        
        if (result.promptData.llmRequest) {
          this.promptLogging.addPromptLog({
            type: 'request',
            provider: result.promptData.llmRequest.provider,
            model: result.promptData.llmRequest.model,
            content: result.promptData.llmRequest.content,
            timestamp: new Date(),
            sessionContext: `multi-agent-executor-${task.id}`,
            messageId: messageId,
            status: 'completed',
            title: `Task ${task.id} LLM Request`,
            metadata: {
              phase: 'execution',
              taskId: task.id
            }
          });
        }
        
        if (result.promptData.llmResponse) {
          this.promptLogging.addPromptLog({
            type: 'response',
            provider: result.promptData.llmResponse.provider,
            model: result.promptData.llmResponse.model,
            content: result.promptData.llmResponse.content,
            timestamp: new Date(),
            sessionContext: `multi-agent-executor-${task.id}`,
            messageId: messageId,
            status: 'completed',
            title: `Task ${task.id} LLM Response`,
            metadata: {
              phase: 'execution',
              taskId: task.id
            }
          });
        }

        // Log MCP prompt data if available
        if (result.mcpPromptData && Array.isArray(result.mcpPromptData)) {
          console.log('🔧 Multi-Agent: Processing MCP prompt data:', {
            taskId: task.id,
            mcpDataCount: result.mcpPromptData.length,
            messageId: messageId
          });

          for (const mcpData of result.mcpPromptData) {
            if (mcpData.mcpRequest) {
              console.log('🟢 Multi-Agent: Adding MCP Query log');
              this.promptLogging.addPromptLog({
                type: 'request',
                provider: 'MCP Server',
                model: mcpData.mcpRequest.server,
                content: `Tool: ${mcpData.mcpRequest.toolName}\nArguments: ${JSON.stringify(mcpData.mcpRequest.arguments, null, 2)}`,
                timestamp: new Date(),
                sessionContext: 'mcp-tool-call',
                messageId: messageId,
                status: 'completed',
                title: `Tool Call Request · ${mcpData.mcpRequest.toolName}`,
                metadata: {
                  phase: 'execution',
                  taskId: task.id
                }
              });
            }

            if (mcpData.mcpResponse) {
              console.log('🔵 Multi-Agent: Adding MCP Response log');
              this.promptLogging.addPromptLog({
                type: 'response',
                provider: 'MCP Server',
                model: mcpData.mcpResponse.server,
                content: JSON.stringify(mcpData.mcpResponse.result, null, 2),
                timestamp: new Date(),
                sessionContext: 'mcp-tool-call',
                messageId: messageId,
                status: 'completed',
                title: `Tool Call Response · ${mcpData.mcpRequest?.toolName || 'MCP Tool'}`,
                metadata: {
                  phase: 'execution',
                  taskId: task.id
                }
              });
            }
          }
        } else {
          console.log('🚫 Multi-Agent: No MCP prompt data found for task:', task.id);
        }

        // Log follow-up prompt data if available
        if (result.followUpPromptData) {
          console.log('🔄 Multi-Agent: Processing follow-up prompt data:', {
            taskId: task.id,
            messageId: messageId
          });

          this.promptLogging.addPromptLog({
            type: 'request',
            provider: result.followUpPromptData.llmRequest.provider,
            model: result.followUpPromptData.llmRequest.model,
            content: result.followUpPromptData.llmRequest.content,
            timestamp: new Date(),
            sessionContext: `multi-agent-followup-${task.id}`,
            messageId: messageId + '_followup',
            status: 'completed',
            title: `Task ${task.id} Follow-up Request`,
            metadata: {
              phase: 'execution',
              taskId: task.id
            }
          });

          this.promptLogging.addPromptLog({
            type: 'response',
            provider: result.followUpPromptData.llmResponse.provider,
            model: result.followUpPromptData.llmResponse.model,
            content: result.followUpPromptData.llmResponse.content,
            timestamp: new Date(),
            sessionContext: `multi-agent-followup-${task.id}`,
            messageId: messageId + '_followup',
            status: 'completed',
            title: `Task ${task.id} Follow-up Response`,
            metadata: {
              phase: 'execution',
              taskId: task.id
            }
          });
        } else {
          console.log('🚫 Multi-Agent: No follow-up prompt data found for task:', task.id);
        }
      }

      // Store result for dependent tasks
      this.taskManager.setTaskResult(task.id, result);
      
      return result;
      
    } catch (error) {
      this.logger.logTaskError(task, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (executorRequestLogId) {
        this.promptLogging.updatePromptLog(executorRequestLogId, {
          status: 'error',
          content: JSON.stringify(
            {
              ...executorRequestSummary,
              error: errorMessage
            },
            null,
            2
          )
        });
      }
      throw error;
    }
  }

  private async executeMultipleTasks(
    tasks: Task[],
    modelSelection?: any,
    temperature?: number,
    seed?: number,
    enablePromptLogging?: boolean,
    availableTools?: any[]
  ): Promise<{taskResults: Record<string, any>; toolCalls: any[]; success: boolean; mcpPromptData?: any[]}> {
    console.log(`🔄 Multi-task executing ${tasks.length} tasks:`, tasks.map(t => t.id));

    const multiTaskModel = modelSelection?.llm?.model || this.defaultMcpModel;
    const taskIdList = tasks.map(t => t.id);
    let multiTaskRequestLogId = '';
    let multiTaskRequestSummary: Record<string, any> = {};

    // Prepare tasks for execution
    const multiTasks = tasks.map(task => ({
      id: task.id,
      description: task.description,
      tools: task.tools,
      dependencyResults: this.taskManager.getDependencyResults(task.id)
    }));

    // Collect all required tools from all tasks
    const allRequiredTools = Array.from(new Set(tasks.flatMap(task => task.tools || [])));

    // Filter available tools to only those needed for these tasks
    const filteredMcpTools = availableTools ? availableTools.filter(tool =>
      allRequiredTools.includes(tool.name)
    ) : [];

    // Convert MCP tools to OpenAI tool format expected by LLM utils
    const taskTools = filteredMcpTools.map(mcpTool => ({
      type: 'function',
      function: {
        name: mcpTool.name,
        description: mcpTool.description,
        parameters: mcpTool.inputSchema
      }
    }));

    console.log(`🔧 Multi-task tools prepared:`, {
      allRequiredTools,
      availableToolsCount: taskTools.length,
      toolNames: taskTools.map(t => t.function.name)
    });

    const multiTaskRequest = {
      tasks: multiTasks,
      enablePromptLogging: enablePromptLogging !== undefined ? enablePromptLogging : this.promptLogging.isLoggingActive(),
      modelSelection: modelSelection,
      temperature: temperature,
      seed: seed,
      preFilteredTools: taskTools
    };

    const taskLabel = taskIdList.slice(0, 3).join(', ') + (taskIdList.length > 3 ? ', …' : '');
    multiTaskRequestSummary = {
      taskIds: taskIdList,
      tools: allRequiredTools,
      temperature,
      seed
    };

    multiTaskRequestLogId = this.logPhaseEvent({
      type: 'request',
      title: `Tasks ${taskLabel} Execution Request`,
      content: JSON.stringify(multiTaskRequestSummary, null, 2),
      sessionContext: `multi-agent-multi-task-executor`,
      provider: 'Multi-task Executor',
      model: multiTaskModel,
      status: 'pending',
      metadata: {
        phase: 'execution',
        taskIds: taskIdList
      }
    });

    // Log to prompt logging if enabled
    if (this.promptLogging.isLoggingActive()) {
      console.log(`⚡ Multi-Agent Multi-Task Execution:`, {
        taskCount: tasks.length,
        taskIds: tasks.map(t => t.id),
        toolCount: taskTools.length
      });
    }

    try {
      const response = await fetch(`${this.functionsUrl}/multiAgentMultiTaskExecutor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(multiTaskRequest)
      });

      if (!response.ok) {
        if (multiTaskRequestLogId) {
          this.promptLogging.updatePromptLog(multiTaskRequestLogId, {
            status: 'error',
            content: JSON.stringify(
              {
                ...multiTaskRequestSummary,
                error: `${response.status} ${response.statusText}`
              },
              null,
              2
            )
          });
        }
        throw new Error(`Multi-task executor failed: ${response.statusText}`);
      }

      const result = await response.json();

      if (multiTaskRequestLogId) {
        this.promptLogging.updatePromptLog(multiTaskRequestLogId, {
          status: 'completed'
        });
      }

      this.logPhaseEvent({
        type: 'response',
        title: `Tasks ${taskLabel} Execution Response`,
        content: JSON.stringify(result, null, 2),
        sessionContext: `multi-agent-multi-task-executor`,
        provider: 'Multi-task Executor',
        model: multiTaskModel,
        status: 'completed',
        metadata: {
          phase: 'execution',
          taskIds: taskIdList
        }
      });

      this.logger.logPhase('execution', {
        taskCount: tasks.length,
        success: result.success,
        toolCallsCount: result.toolCalls?.length || 0
      });

      // Log prompt data if available and enabled
      if (result.promptData && (enablePromptLogging !== undefined ? enablePromptLogging : this.promptLogging.isLoggingActive())) {
        const messageId = `multiagent_multitask_${tasks.map(t => t.id).join('_')}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

        if (result.promptData.llmRequest) {
          this.promptLogging.addPromptLog({
            type: 'request',
            provider: result.promptData.llmRequest.provider,
            model: result.promptData.llmRequest.model,
            content: result.promptData.llmRequest.content,
            timestamp: new Date(),
            sessionContext: `multi-agent-multi-task-executor`,
            messageId: messageId,
            status: 'completed',
            title: 'Multi-task LLM Request',
            metadata: {
              phase: 'execution',
              taskIds: taskIdList
            }
          });
        }

        if (result.promptData.llmResponse) {
          this.promptLogging.addPromptLog({
            type: 'response',
            provider: result.promptData.llmResponse.provider,
            model: result.promptData.llmResponse.model,
            content: result.promptData.llmResponse.content,
            timestamp: new Date(),
            sessionContext: `multi-agent-multi-task-executor`,
            messageId: messageId,
            status: 'completed',
            title: 'Multi-task LLM Response',
            metadata: {
              phase: 'execution',
              taskIds: taskIdList
            }
          });
        }

        // Log MCP prompt data if available
        if (result.mcpPromptData && Array.isArray(result.mcpPromptData)) {
          console.log('🔧 Multi-Agent Multi-Task: Processing MCP prompt data:', {
            taskCount: tasks.length,
            mcpDataCount: result.mcpPromptData.length,
            messageId: messageId
          });

          for (const mcpData of result.mcpPromptData) {
            if (mcpData.mcpRequest) {
              console.log('🟢 Multi-Agent Multi-Task: Adding MCP Query log');
              this.promptLogging.addPromptLog({
                type: 'request',
                provider: 'MCP Server',
                model: mcpData.mcpRequest.server,
                content: `Tool: ${mcpData.mcpRequest.toolName}\nArguments: ${JSON.stringify(mcpData.mcpRequest.arguments, null, 2)}`,
                timestamp: new Date(),
                sessionContext: 'mcp-tool-call',
                messageId: messageId,
                status: 'completed',
                title: `Tool Call Request · ${mcpData.mcpRequest.toolName}`,
                metadata: {
                  phase: 'execution',
                  taskIds: taskIdList
                }
              });
            }

            if (mcpData.mcpResponse) {
              console.log('🔵 Multi-Agent Multi-Task: Adding MCP Response log');
              this.promptLogging.addPromptLog({
                type: 'response',
                provider: 'MCP Server',
                model: mcpData.mcpResponse.server,
                content: JSON.stringify(mcpData.mcpResponse.result, null, 2),
                timestamp: new Date(),
                sessionContext: 'mcp-tool-call',
                messageId: messageId,
                status: 'completed',
                title: `Tool Call Response · ${mcpData.mcpRequest?.toolName || 'MCP Tool'}`,
                metadata: {
                  phase: 'execution',
                  taskIds: taskIdList
                }
              });
            }
          }
        } else {
          console.log('🚫 Multi-Agent Multi-Task: No MCP prompt data found');
        }
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (multiTaskRequestLogId) {
        this.promptLogging.updatePromptLog(multiTaskRequestLogId, {
          status: 'error',
          content: JSON.stringify(
            {
              ...multiTaskRequestSummary,
              error: errorMessage
            },
            null,
            2
          )
        });
      }
      throw error;
    }
  }

  private async verificationPhase(tasks: Task[], originalQuery: string, modelSelection?: any, temperature?: number, seed?: number, enablePromptLogging?: boolean): Promise<any> {
    const completedTasks = tasks.filter(t => t.status === 'completed');
    
    const verifierRequest = {
      originalQuery,
      tasks: completedTasks.map(t => ({
        id: t.id,
        description: t.description,
        result: t.result
      })),
      enablePromptLogging: enablePromptLogging !== undefined ? enablePromptLogging : this.promptLogging.isLoggingActive(),
      modelSelection: modelSelection,
      temperature: temperature,
      seed: seed
    };

    const verifierModel = modelSelection?.llm?.model || this.defaultMcpModel;
    const verifierRequestSummary = {
      originalQuery: originalQuery.substring(0, 500),
      taskCount: completedTasks.length,
      temperature,
      seed
    };

    const verifierLogId = this.logPhaseEvent({
      type: 'request',
      title: 'Verification Request',
      content: JSON.stringify(verifierRequestSummary, null, 2),
      sessionContext: 'multi-agent-verifier',
      provider: 'Result Verifier',
      model: verifierModel,
      status: 'pending',
      metadata: {
        phase: 'verification'
      }
    });

    // Log to prompt logging if enabled
    if (this.promptLogging.isLoggingActive()) {
      console.log('✅ Multi-Agent Verification Phase:', {
        originalQuery: originalQuery.substring(0, 200) + '...',
        completedTaskCount: completedTasks.length,
        taskIds: completedTasks.map(t => t.id)
      });
    }

    let verificationResult: any;

    try {
      const response = await fetch(`${this.functionsUrl}/multiAgentVerifier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifierRequest)
      });

      if (!response.ok) {
        if (verifierLogId) {
          this.promptLogging.updatePromptLog(verifierLogId, {
            status: 'error',
            content: JSON.stringify(
              {
                ...verifierRequestSummary,
                error: `${response.status} ${response.statusText}`
              },
              null,
              2
            )
          });
        }
        throw new Error(`Verifier failed: ${response.statusText}`);
      }

      verificationResult = await response.json();

      if (verifierLogId) {
        this.promptLogging.updatePromptLog(verifierLogId, {
          status: 'completed'
        });
      }

      this.logPhaseEvent({
        type: 'response',
        title: 'Verification Response',
        content: JSON.stringify(verificationResult, null, 2),
        sessionContext: 'multi-agent-verifier',
        provider: 'Result Verifier',
        model: verifierModel,
        status: 'completed',
        metadata: {
          phase: 'verification'
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (verifierLogId) {
        this.promptLogging.updatePromptLog(verifierLogId, {
          status: 'error',
          content: JSON.stringify(
            {
              ...verifierRequestSummary,
              error: errorMessage
            },
            null,
            2
          )
        });
      }
      throw error;
    }
    
    // Log prompt data if available and enabled
    if (verificationResult.promptData && (enablePromptLogging !== undefined ? enablePromptLogging : this.promptLogging.isLoggingActive())) {
      const messageId = `multiagent_verifier_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      
      if (verificationResult.promptData.llmRequest) {
        this.promptLogging.addPromptLog({
          type: 'request',
          provider: verificationResult.promptData.llmRequest.provider,
          model: verificationResult.promptData.llmRequest.model,
          content: verificationResult.promptData.llmRequest.content,
          timestamp: new Date(),
          sessionContext: 'multi-agent-verifier',
          messageId: messageId,
          status: 'completed',
          title: 'Verification LLM Request',
          metadata: {
            phase: 'verification'
          }
        });
      }
      
      if (verificationResult.promptData.llmResponse) {
        this.promptLogging.addPromptLog({
          type: 'response',
          provider: verificationResult.promptData.llmResponse.provider,
          model: verificationResult.promptData.llmResponse.model,
          content: verificationResult.promptData.llmResponse.content,
          timestamp: new Date(),
          sessionContext: 'multi-agent-verifier',
          messageId: messageId,
          status: 'completed',
          title: 'Verification LLM Response',
          metadata: {
            phase: 'verification'
          }
        });
      }
    }
    
    return verificationResult;
  }

  private async criticPhase(verification: any, originalQuery: string, modelSelection?: any, temperature?: number, seed?: number, enablePromptLogging?: boolean): Promise<string> {
    const criticRequest = {
      originalQuery,
      verification,
      taskResults: verification.taskResults || [],
      enablePromptLogging: enablePromptLogging !== undefined ? enablePromptLogging : this.promptLogging.isLoggingActive(),
      modelSelection: modelSelection,
      temperature: temperature,
      seed: seed
    };

    const criticModel = modelSelection?.llm?.model || this.defaultMcpModel;
    const criticRequestSummary = {
      originalQuery: originalQuery.substring(0, 500),
      confidence: verification.confidence,
      overallCorrect: verification.overallCorrect,
      temperature,
      seed
    };

    const criticLogId = this.logPhaseEvent({
      type: 'request',
      title: 'Critic Request',
      content: JSON.stringify(criticRequestSummary, null, 2),
      sessionContext: 'multi-agent-critic',
      provider: 'Response Critic',
      model: criticModel,
      status: 'pending',
      metadata: {
        phase: 'critic'
      }
    });

    // Log to prompt logging if enabled
    if (this.promptLogging.isLoggingActive()) {
      console.log('🎨 Multi-Agent Critic Phase:', {
        originalQuery: originalQuery.substring(0, 200) + '...',
        verificationConfidence: verification.confidence,
        overallCorrect: verification.overallCorrect
      });
    }

    let result: any;

    try {
      const response = await fetch(`${this.functionsUrl}/multiAgentCritic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(criticRequest)
      });

      if (!response.ok) {
        if (criticLogId) {
          this.promptLogging.updatePromptLog(criticLogId, {
            status: 'error',
            content: JSON.stringify(
              {
                ...criticRequestSummary,
                error: `${response.status} ${response.statusText}`
              },
              null,
              2
            )
          });
        }
        throw new Error(`Critic failed: ${response.statusText}`);
      }

      result = await response.json();

      if (criticLogId) {
        this.promptLogging.updatePromptLog(criticLogId, {
          status: 'completed'
        });
      }

      this.logPhaseEvent({
        type: 'response',
        title: 'Critic Response',
        content: JSON.stringify(result, null, 2),
        sessionContext: 'multi-agent-critic',
        provider: 'Response Critic',
        model: criticModel,
        status: 'completed',
        metadata: {
          phase: 'critic'
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (criticLogId) {
        this.promptLogging.updatePromptLog(criticLogId, {
          status: 'error',
          content: JSON.stringify(
            {
              ...criticRequestSummary,
              error: errorMessage
            },
            null,
            2
          )
        });
      }
      throw error;
    }
    
    // Log prompt data if available and enabled
    if (result.promptData && (enablePromptLogging !== undefined ? enablePromptLogging : this.promptLogging.isLoggingActive())) {
      const messageId = `multiagent_critic_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      
      if (result.promptData.llmRequest) {
        this.promptLogging.addPromptLog({
          type: 'request',
          provider: result.promptData.llmRequest.provider,
          model: result.promptData.llmRequest.model,
          content: result.promptData.llmRequest.content,
          timestamp: new Date(),
          sessionContext: 'multi-agent-critic',
          messageId: messageId,
          status: 'completed',
          title: 'Critic LLM Request',
          metadata: {
            phase: 'critic'
          }
        });
      }
      
      if (result.promptData.llmResponse) {
        this.promptLogging.addPromptLog({
          type: 'response',
          provider: result.promptData.llmResponse.provider,
          model: result.promptData.llmResponse.model,
          content: result.promptData.llmResponse.content,
          timestamp: new Date(),
          sessionContext: 'multi-agent-critic',
          messageId: messageId,
          status: 'completed',
          title: 'Critic LLM Response',
          metadata: {
            phase: 'critic'
          }
        });
      }
    }

    return result.finalAnswer || result.answer || 'No answer generated';
  }

  // Utility method to check if multi-agent orchestration is available
  isAvailable(): boolean {
    return this.mcpRegistry.getAvailableTools().length > 0;
  }
}
