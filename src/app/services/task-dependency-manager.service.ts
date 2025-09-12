import { Injectable } from '@angular/core';

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

@Injectable({
  providedIn: 'root'
})
export class TaskDependencyManagerService {
  private tasks = new Map<string, Task>();
  private dependencies = new Map<string, Set<string>>();
  private taskResults = new Map<string, any>();

  constructor() {}

  private initializeGraph(tasks: Task[]): void {
    this.tasks.clear();
    this.dependencies.clear();

    // Store tasks
    for (const task of tasks) {
      this.tasks.set(task.id, task);
      this.dependencies.set(task.id, new Set(task.dependencies));
    }
  }

  createExecutionPlan(tasks: Task[]): ExecutionPlan {
    this.initializeGraph(tasks);
    this.taskResults.clear();

    // Validate the task plan
    const validation = this.validateTaskPlan(tasks);
    if (!validation.valid) {
      throw new Error(`Invalid task plan: ${validation.errors.join(', ')}`);
    }

    // Check for circular dependencies
    if (this.hasCycleInDependencies(tasks)) {
      throw new Error('Circular dependencies detected in task plan');
    }

    // Get topological order using simple algorithm
    const topologicalOrder = this.getTopologicalOrder(tasks);
    
    // Create parallel execution groups
    const parallelGroups = this.createParallelGroups(tasks, topologicalOrder);
    
    // Assign execution order to tasks
    let orderCounter = 0;
    for (const group of parallelGroups) {
      for (const task of group) {
        task.executionOrder = orderCounter;
      }
      orderCounter++;
    }

    return {
      tasks,
      totalSteps: parallelGroups.length,
      parallelGroups
    };
  }

  private getTopologicalOrder(tasks: Task[]): string[] {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    // Initialize in-degree and adjacency list
    for (const task of tasks) {
      inDegree.set(task.id, task.dependencies.length);
      adjList.set(task.id, []);
    }

    // Build adjacency list (reverse dependencies)
    for (const task of tasks) {
      for (const dep of task.dependencies) {
        if (!adjList.has(dep)) {
          adjList.set(dep, []);
        }
        adjList.get(dep)!.push(task.id);
      }
    }

    // Kahn's algorithm for topological sorting
    const queue: string[] = [];
    const result: string[] = [];

    // Start with tasks that have no dependencies
    for (const [taskId, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(taskId);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      // Reduce in-degree for dependent tasks
      const dependents = adjList.get(current) || [];
      for (const dependent of dependents) {
        const newDegree = (inDegree.get(dependent) || 0) - 1;
        inDegree.set(dependent, newDegree);
        
        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    return result;
  }

  private hasCycleInDependencies(tasks: Task[]): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const hasCycleDFS = (taskId: string): boolean => {
      if (recStack.has(taskId)) return true;
      if (visited.has(taskId)) return false;

      visited.add(taskId);
      recStack.add(taskId);

      const task = this.tasks.get(taskId);
      if (task) {
        for (const dep of task.dependencies) {
          if (hasCycleDFS(dep)) return true;
        }
      }

      recStack.delete(taskId);
      return false;
    };

    for (const task of tasks) {
      if (!visited.has(task.id)) {
        if (hasCycleDFS(task.id)) return true;
      }
    }

    return false;
  }

  private createParallelGroups(tasks: Task[], topologicalOrder: string[]): Task[][] {
    const groups: Task[][] = [];
    const processed = new Set<string>();
    const taskMap = new Map<string, Task>();
    
    // Create task lookup map
    for (const task of tasks) {
      taskMap.set(task.id, task);
    }

    // Process tasks in topological order
    for (const taskId of topologicalOrder) {
      const task = taskMap.get(taskId);
      if (!task) continue;

      // Check if all dependencies are processed
      const allDependenciesProcessed = task.dependencies.every(dep => processed.has(dep));
      
      if (allDependenciesProcessed) {
        // Find or create a group where this task can be added
        let targetGroup: Task[] | null = null;
        
        // Look for an existing group where this task can run in parallel
        for (const group of groups) {
          const canRunInParallel = group.every(groupTask => 
            !this.hasDependency(task.id, groupTask.id) && 
            !this.hasDependency(groupTask.id, task.id)
          );
          
          if (canRunInParallel) {
            targetGroup = group;
            break;
          }
        }
        
        // If no suitable group found, create a new one
        if (!targetGroup) {
          targetGroup = [];
          groups.push(targetGroup);
        }
        
        targetGroup.push(task);
        processed.add(taskId);
      }
    }

    return groups;
  }

  private hasDependency(taskId: string, potentialDependency: string): boolean {
    // Check if taskId depends on potentialDependency (directly or indirectly)
    const visited = new Set<string>();
    
    const checkDependency = (currentTaskId: string): boolean => {
      if (visited.has(currentTaskId)) return false;
      visited.add(currentTaskId);
      
      const task = this.tasks.get(currentTaskId);
      if (!task) return false;
      
      if (task.dependencies.includes(potentialDependency)) {
        return true;
      }
      
      return task.dependencies.some(dep => checkDependency(dep));
    };
    
    return checkDependency(taskId);
  }

  getDependencyResults(taskId: string): Record<string, any> {
    const task = this.findTask(taskId);
    if (!task) return {};

    const dependencyResults: Record<string, any> = {};
    
    for (const dependencyId of task.dependencies) {
      if (this.taskResults.has(dependencyId)) {
        dependencyResults[dependencyId] = this.taskResults.get(dependencyId);
      }
    }
    
    return dependencyResults;
  }

  setTaskResult(taskId: string, result: any): void {
    this.taskResults.set(taskId, result);
  }

  private findTask(taskId: string): Task | null {
    return this.tasks.get(taskId) || null;
  }

  // Utility methods for visualization and debugging
  getExecutionVisualization(): any {
    const nodes = Array.from(this.tasks.values()).map((task, index) => ({
      id: task.id,
      task: task,
      x: (index % 5) * 120,
      y: Math.floor(index / 5) * 80,
      width: 100,
      height: 50
    }));

    const edges: any[] = [];
    for (const task of this.tasks.values()) {
      for (const dep of task.dependencies) {
        edges.push({
          source: dep,
          target: task.id,
          points: []
        });
      }
    }

    return { nodes, edges };
  }

  validateTaskPlan(tasks: Task[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for missing dependencies
    const taskIds = new Set(tasks.map(t => t.id));
    for (const task of tasks) {
      for (const dependency of task.dependencies) {
        if (!taskIds.has(dependency)) {
          errors.push(`Task ${task.id} depends on non-existent task ${dependency}`);
        }
      }
    }

    // Check for duplicate task IDs
    const seenIds = new Set<string>();
    for (const task of tasks) {
      if (seenIds.has(task.id)) {
        errors.push(`Duplicate task ID: ${task.id}`);
      }
      seenIds.add(task.id);
    }

    // Check for self-dependencies
    for (const task of tasks) {
      if (task.dependencies.includes(task.id)) {
        errors.push(`Task ${task.id} has self-dependency`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Get critical path analysis
  getCriticalPath(): string[] {
    if (this.tasks.size === 0) return [];
    
    // Simple critical path: find the longest dependency chain
    const visited = new Set<string>();
    let longestPath: string[] = [];
    
    const findLongestPath = (taskId: string, currentPath: string[]): string[] => {
      if (visited.has(taskId)) return currentPath;
      
      visited.add(taskId);
      const newPath = [...currentPath, taskId];
      const task = this.tasks.get(taskId);
      
      if (!task || task.dependencies.length === 0) {
        return newPath;
      }
      
      let maxPath = newPath;
      for (const dep of task.dependencies) {
        const pathFromDep = findLongestPath(dep, newPath);
        if (pathFromDep.length > maxPath.length) {
          maxPath = pathFromDep;
        }
      }
      
      visited.delete(taskId);
      return maxPath;
    };
    
    // Find the longest path starting from any task
    for (const taskId of this.tasks.keys()) {
      const path = findLongestPath(taskId, []);
      if (path.length > longestPath.length) {
        longestPath = path;
      }
    }
    
    return longestPath;
  }

  reset(): void {
    this.tasks.clear();
    this.dependencies.clear();
    this.taskResults.clear();
  }
}