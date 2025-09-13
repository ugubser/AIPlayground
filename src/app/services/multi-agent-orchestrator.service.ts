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

export interface MultiAgentRequest {
  query: string;
  sessionId?: string;
  modelSelection?: any;
  temperature?: number;
  seed?: number;
  enablePromptLogging?: boolean;
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
      
      // Phase 4: Final formatting
      const finalAnswer = await this.criticPhase(verification, request.query, request.modelSelection, request.temperature, request.seed, request.enablePromptLogging);
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
          messageId: messageId
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
          messageId: messageId
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
      const executionPromises = parallelGroup.map(task => this.executeTask(task, modelSelection, temperature, seed, enablePromptLogging, availableTools));
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

  private async executeTask(task: Task, modelSelection?: any, temperature?: number, seed?: number, enablePromptLogging?: boolean, availableTools?: any[]): Promise<any> {
    this.logger.logTaskStart(task);
    task.status = 'executing';
    
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
            messageId: messageId
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
            messageId: messageId
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
            const mcpMessageId = `multiagent_mcp_${task.id}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

            if (mcpData.mcpRequest) {
              console.log('🟢 Multi-Agent: Adding MCP Query log');
              this.promptLogging.addPromptLog({
                type: 'request',
                provider: 'MCP Server',
                model: mcpData.mcpRequest.server,
                content: `Tool: ${mcpData.mcpRequest.toolName}\nArguments: ${JSON.stringify(mcpData.mcpRequest.arguments, null, 2)}`,
                timestamp: new Date(),
                sessionContext: 'mcp-tool-call',
                messageId: messageId  // Use the main LLM message ID to group MCP logs with the assistant response
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
                messageId: messageId  // Use the main LLM message ID to group MCP logs with the assistant response
              });
            }
          }
        } else {
          console.log('🚫 Multi-Agent: No MCP prompt data found for task:', task.id);
        }
      }

      // Store result for dependent tasks
      this.taskManager.setTaskResult(task.id, result);
      
      return result;
      
    } catch (error) {
      this.logger.logTaskError(task, error);
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

    const verificationResult = await response.json();
    
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
          messageId: messageId
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
          messageId: messageId
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
          messageId: messageId
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
          messageId: messageId
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