'use server';

import { ObjectId } from "mongodb";
import { scenariosCollection, simulationRunsCollection, simulationResultsCollection } from "../lib/mongodb";
import { z } from 'zod';
import { projectAuthCheck } from "./project_actions";
import { type WithStringId } from "../lib/types/types";
import { Scenario, SimulationRun, SimulationResult, SimulationAggregateResult } from "../lib/types/testing_types";
import { SimulationScenarioData } from "../lib/types/testing_types";

export async function getScenarios(projectId: string): Promise<WithStringId<z.infer<typeof Scenario>>[]> {
    await projectAuthCheck(projectId);

    const scenarios = await scenariosCollection.find({ projectId }).toArray();
    return scenarios.map(s => ({
        ...s,
        _id: s._id.toString(),
    }));
}

export async function getScenario(projectId: string, scenarioId: string): Promise<WithStringId<z.infer<typeof SimulationScenarioData>>> {
    await projectAuthCheck(projectId);

    // fetch scenario
    const scenario = await scenariosCollection.findOne({
        _id: new ObjectId(scenarioId),
        projectId,
    });
    if (!scenario) {
        throw new Error('Scenario not found');
    }
    const { _id, description, ...rest } = scenario;
    return {
        ...rest,
        _id: _id.toString(),
        scenario: description,
    };
}

export async function createScenario(
    projectId: string,
    name: string,
    description: string,
    criteria: string = '',
    context: string = ''
): Promise<string> {
    await projectAuthCheck(projectId);
    
    const now = new Date().toISOString();
    const scenario = {
        projectId,
        name,
        description,
        criteria,
        context,
        createdAt: now,
        lastUpdatedAt: now,
    };
    
    const result = await scenariosCollection.insertOne(scenario);
    return result.insertedId.toString();
}

export async function updateScenario(
    projectId: string,
    scenarioId: string,
    updates: {
        name?: string;
        description?: string;
        criteria?: string;
        context?: string;
    }
): Promise<void> {
    await projectAuthCheck(projectId);
    
    const updateData: any = {
        lastUpdatedAt: new Date().toISOString(),
    };
    
    // Only include fields that are provided in updates
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.criteria !== undefined) updateData.criteria = updates.criteria;
    if (updates.context !== undefined) updateData.context = updates.context;
    
    await scenariosCollection.updateOne(
        { _id: new ObjectId(scenarioId), projectId },
        { $set: updateData }
    );
}

export async function deleteScenario(projectId: string, scenarioId: string): Promise<void> {
    await projectAuthCheck(projectId);

    await scenariosCollection.deleteOne({
        _id: new ObjectId(scenarioId),
        projectId,
    });
}

export async function getRuns(projectId: string): Promise<WithStringId<z.infer<typeof SimulationRun>>[]> {
    await projectAuthCheck(projectId);

    const runs = await simulationRunsCollection
        .find({ projectId })
        .sort({ startedAt: -1 }) // Most recent first
        .toArray();

    return runs.map(run => ({
        ...run,
        _id: run._id.toString(),
    }));
}

export async function getRun(projectId: string, runId: string): Promise<WithStringId<z.infer<typeof SimulationRun>>> {
    await projectAuthCheck(projectId);

    const run = await simulationRunsCollection.findOne({
        _id: new ObjectId(runId),
        projectId,
    });

    if (!run) {
        throw new Error('Run not found');
    }

    return {
        ...run,
        _id: run._id.toString(),
    };
}

export async function createRun(
    projectId: string, 
    scenarioIds: string[],
    workflowId: string
): Promise<WithStringId<z.infer<typeof SimulationRun>>> {
    await projectAuthCheck(projectId);

    const run = {
        projectId,
        status: 'pending' as const,
        scenarioIds,
        workflowId,
        startedAt: new Date().toISOString(),
    };

    const result = await simulationRunsCollection.insertOne(run);

    return {
        ...run,
        _id: result.insertedId.toString(),
    };
}

export async function updateRunStatus(
    projectId: string,
    runId: string,
    status: z.infer<typeof SimulationRun>['status'],
    completedAt?: string
): Promise<void> {
    await projectAuthCheck(projectId);

    const updateData: Partial<z.infer<typeof SimulationRun>> = {
        status,
    };

    if (completedAt) {
        updateData.completedAt = completedAt;
    }

    await simulationRunsCollection.updateOne(
        {
            _id: new ObjectId(runId),
            projectId,
        },
        {
            $set: updateData,
        }
    );
}

export async function getRunResults(
    projectId: string,
    runId: string
): Promise<WithStringId<z.infer<typeof SimulationResult>>[]> {
    await projectAuthCheck(projectId);

    const results = await simulationResultsCollection
        .find({
            runId,
            projectId,
        })
        .toArray();

    return results.map(result => ({
        ...result,
        _id: result._id.toString(),
    }));
}

export async function createRunResult(
    projectId: string,
    runId: string,
    scenarioId: string,
    result: z.infer<typeof SimulationResult>['result'],
    details: string
): Promise<string> {
    await projectAuthCheck(projectId);

    const resultDoc = {
        projectId,
        runId,
        scenarioId,
        result,
        details,
    };

    const insertResult = await simulationResultsCollection.insertOne(resultDoc);
    return insertResult.insertedId.toString();
}

export async function createAggregateResult(
    projectId: string,
    runId: string,
    total: number,
    pass: number,
    fail: number
): Promise<void> {
    await projectAuthCheck(projectId);

    await simulationRunsCollection.updateOne(
        { _id: new ObjectId(runId), projectId },
        {
            $set: {
                aggregateResults: { total, pass, fail }
            }
        }
    );
}

export async function getAggregateResult(
    projectId: string,
    runId: string
): Promise<z.infer<typeof SimulationAggregateResult> | null> {
    await projectAuthCheck(projectId);

    const run = await simulationRunsCollection.findOne({
        _id: new ObjectId(runId),
        projectId,
    });

    if (!run || !run.aggregateResults) return null;

    return run.aggregateResults;
}

export async function deleteRun(projectId: string, runId: string) {
    try {
        // Delete the run using the collection directly
        await simulationRunsCollection.deleteOne({
            _id: new ObjectId(runId),
            projectId: projectId
        });

        // Delete associated results using the collection directly
        await simulationResultsCollection.deleteMany({
            runId: runId,
            projectId: projectId
        });

        return { success: true };
    } catch (error) {
        console.error('Error deleting run:', error);
        throw new Error('Failed to delete run');
    }
} 