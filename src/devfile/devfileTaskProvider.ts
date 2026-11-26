import {
    V1alpha2DevWorkspaceSpecTemplateCommands,
    V1alpha2DevWorkspaceSpecTemplateCommandsItemsExecEnv
} from '@devfile/api';

import * as vscode from 'vscode';

import type { ActiveConnectionInfo } from '../commands/remoteCommands';
import { DevfileTaskExecutor } from './devfileTaskExecutor';
import { K8sFlattenedDevfileReader } from './k8sFlattenedDevfileReader';

interface DevfileTaskDefinition extends vscode.TaskDefinition {
    command: string;
    workdir?: string;
    component?: string;
}

type GetKubeConfig = () => Promise<import('@kubernetes/client-node').KubeConfig>;

export class DevfileTaskProvider implements vscode.TaskProvider {

    private readonly executor: DevfileTaskExecutor;

    private readonly devfileReader: K8sFlattenedDevfileReader;

    private cachedTasks: vscode.Task[] = [];

    private preloadPromise?: Promise<void>;

    constructor(
        private readonly channel: vscode.OutputChannel,
        private readonly conn: ActiveConnectionInfo,
        getKubeConfig: GetKubeConfig
    ) {
        this.executor = new DevfileTaskExecutor(conn, getKubeConfig);

        this.devfileReader = new K8sFlattenedDevfileReader(
            channel,
            getKubeConfig,
            this.conn.namespace,
            this.conn.devworkspaceId
        );


    }

    preloadTasks(): Promise<void> {
        if (!this.preloadPromise) {
            this.preloadPromise = this.computeTasks()
                .then(tasks => {
                    this.cachedTasks = tasks;
                    this.channel.appendLine(
                        `[Task Provider] Cached ${tasks.length} task(s).`
                    );
                })
                .catch(error => {
                    this.preloadPromise = undefined;
                    throw error;
                });
        }

        return this.preloadPromise;
    }

    provideTasks(): vscode.ProviderResult<vscode.Task[]> {
        this.channel.appendLine(
            `[Task Provider] Returning ${this.cachedTasks.length} cached task(s).`
        );

        return this.cachedTasks;
    }

    resolveTask(task: vscode.Task): vscode.ProviderResult<vscode.Task> {
        return task;
    }

    private async computeTasks(): Promise<vscode.Task[]> {
        try {
            const devfileCommands = await this.fetchDevfileCommands();

            const tasks = devfileCommands
                .filter(command => {
                    const exec = command.exec;

                    if (!exec?.commandLine || !exec.component) {
                        return false;
                    }

                    const importedByAttribute =
                        (command.attributes as Record<string, unknown> | undefined)
                        ?.['controller.devfile.io/imported-by'];

                    return (
                        importedByAttribute === undefined ||
                        importedByAttribute === 'parent'
                    );
                })
                .filter(command =>
                    !/^init-ssh-agent-command-\d+$/.test(command.id)
                )
                .map(command =>
                    this.createCheTask(
                        command.exec?.label || command.id,
                        command.exec!.commandLine!,
                        command.exec!.workingDir || '${PROJECT_SOURCE}',
                        command.exec!.component!,
                        command.exec!.env
                    )
                );

            this.channel.appendLine(
                `Registered ${tasks.length} Devfile task(s).`
            );

            return tasks;
        } catch (error) {
            this.channel.appendLine(
                `Failed to retrieve Devfile tasks: ${error instanceof Error ? error.message : String(error)
                }`
            );

            return [];
        }
    }

    private async fetchDevfileCommands():
        Promise<V1alpha2DevWorkspaceSpecTemplateCommands[]> {

        const devfile = await this.devfileReader.get();

        const commands = devfile.commands ?? [];

        this.channel.appendLine(
            `Detected ${commands.length} command(s) in flattened Devfile.`
        );

        return commands;
    }

    private createCheTask(
        name: string,
        command: string,
        workdir: string,
        component: string,
        env?: Array<V1alpha2DevWorkspaceSpecTemplateCommandsItemsExecEnv>
    ): vscode.Task {

        const definition: DevfileTaskDefinition = {
            type: 'devfile',
            command,
            workdir,
            component
        };

        const execution = new vscode.CustomExecution(
            async (): Promise<vscode.Pseudoterminal> => {
                return this.executor.createPseudoterminal(
                    command,
                    workdir,
                    component,
                    env
                );
            }
        );

        const task = new vscode.Task(
            definition,
            vscode.TaskScope.Workspace,
            name,
            'Devfile',
            execution,
            []
        );

        task.detail = `Devfile command: ${command}`;

        return task;
    }
}
