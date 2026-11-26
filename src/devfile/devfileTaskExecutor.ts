
import * as vscode from 'vscode';
import * as k8s from '@kubernetes/client-node';
import { PassThrough, Writable } from 'stream';

import { ActiveConnectionInfo } from '../commands/remoteCommands';
import { findWorkspacePodAndContainer } from '../kubernetes/KubeAuthHelper';
import {
    V1alpha2DevWorkspaceSpecTemplateCommandsItemsExecEnv
} from '@devfile/api';

type GetKubeConfig = () => Promise<k8s.KubeConfig>;

export class DevfileTaskExecutor {

    constructor(
        private readonly conn: ActiveConnectionInfo,
        private readonly getKubeConfig: GetKubeConfig
    ) { }

    createPseudoterminal(
        command: string,
        workdir: string,
        component: string,
        env?: V1alpha2DevWorkspaceSpecTemplateCommandsItemsExecEnv[]
    ): vscode.Pseudoterminal {
        return new KubernetesTaskTerminal(
            this.conn,
            this.getKubeConfig,
            command,
            workdir,
            component,
            env
        );
    }
}

class KubernetesTaskTerminal implements vscode.Pseudoterminal {

    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<number>();

    readonly onDidWrite = this.writeEmitter.event;
    readonly onDidClose = this.closeEmitter.event;

    private stdin?: PassThrough;
    private socket?: any;
    private closed = false;
    private started = false;

    constructor(
        private readonly conn: ActiveConnectionInfo,
        private readonly getKubeConfig: GetKubeConfig,
        private readonly command: string,
        private readonly workdir: string,
        private readonly component: string,
        private readonly env?: V1alpha2DevWorkspaceSpecTemplateCommandsItemsExecEnv[]
    ) { }

    open(): void {
        if (this.started) {
            return;
        }

        this.started = true;
        void this.execute();
    }

    close(): void {
        if (this.closed) {
            return;
        }

        this.stdin?.end();
        this.socket?.close();

        this.finish(130);
    }

    handleInput(data: string): void {
        this.stdin?.write(data);
    }

    private async execute(): Promise<void> {
        try {
            this.writeEmitter.fire(
                `Connecting to DevSpaces workspace: ${this.conn.workspaceName}\r\n`
            );

            const kubeConfig = await this.getKubeConfig();

            const { podName, containerName: mainContainer } =
                await findWorkspacePodAndContainer(
                    kubeConfig,
                    this.conn.namespace,
                    this.conn.devworkspaceId
                );

            const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);

            const pod = await coreApi.readNamespacedPod({
                name: podName,
                namespace: this.conn.namespace
            });

            const availableContainers =
                pod.spec?.containers?.map(container => container.name) ?? [];

            // Resolve the Devfile component to its actual pod container.
            const containerName = availableContainers.find(
                name => name === this.component
            );

            if (!containerName) {
                if (
                    this.component === mainContainer &&
                    availableContainers.includes(mainContainer)
                ) {
                    // The main container is available.
                } else {
                    throw new Error(
                        `Unable to resolve Devfile component '${this.component}' ` +
                        `to a container in pod '${podName}'. ` +
                        `Available containers: ${availableContainers.join(', ')}`
                    );
                }
            }

            const targetContainer = containerName ?? mainContainer;

            const shellCommand = this.buildShellCommand();

            this.writeEmitter.fire(
                `Executing Devfile command in container '${targetContainer}'...\r\n\r\n`
            );

            const exec = new k8s.Exec(kubeConfig);

            this.stdin = new PassThrough();

            const stdout = this.createOutputStream();
            const stderr = this.createOutputStream();

            this.socket = await exec.exec(
                this.conn.namespace,
                podName,
                targetContainer,
                ['/bin/sh', '-c', shellCommand],
                stdout,
                stderr,
                this.stdin,
                true,
                (status: k8s.V1Status) => {
                    const exitCause = status.details?.causes?.find(
                        cause => cause.reason === 'ExitCode'
                    );

                    const parsedExitCode = Number(exitCause?.message);

                    const exitCode =
                        status.status === 'Success'
                            ? 0
                            : Number.isFinite(parsedExitCode)
                                ? parsedExitCode
                                : 1;

                    this.finish(exitCode);
                }
            );

            this.socket.on('error', (error: Error) => {
                this.writeEmitter.fire(
                    `\r\nKubernetes exec error: ${error.message}\r\n`
                );
                this.finish(1);
            });

            this.socket.on('close', () => {
                // The Kubernetes status callback normally provides
                // the actual remote exit code.
                if (!this.closed) {
                    this.finish(1);
                }
            });

        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);

            this.writeEmitter.fire(
                `\r\nDevfile task execution failed: ${message}\r\n`
            );

            this.finish(1);
        }
    }

    private buildShellCommand(): string {
        const parts: string[] = [];

        const resolvedWorkdir = this.resolveWorkingDirectory();

        if (resolvedWorkdir) {
            parts.push(`cd -- ${this.shellQuote(resolvedWorkdir)}`);
        }

        for (const variable of this.env ?? []) {
            parts.push(
                `export ${variable.name}=${this.shellQuote(variable.value)}`
            );
        }

        parts.push(this.command);

        return parts.join(' && ');
    }

    private resolveWorkingDirectory(): string {
        const projectSource =
            this.conn.projectFolder ??
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        if (this.workdir.includes('${PROJECT_SOURCE}')) {
            if (!projectSource) {
                throw new Error(
                    'Unable to resolve ${PROJECT_SOURCE}: no remote workspace folder found.'
                );
            }

            return this.workdir.replaceAll(
                '${PROJECT_SOURCE}',
                projectSource
            );
        }

        return this.workdir;
    }

    private shellQuote(value: string): string {
        return `'${value.replace(/'/g, `'\\''`)}'`;
    }

    private createOutputStream(): Writable {
        return new Writable({
            write: (chunk, _encoding, callback) => {
                this.writeEmitter.fire(
                    Buffer.isBuffer(chunk)
                        ? chunk.toString('utf8')
                        : String(chunk)
                );

                callback();
            }
        });
    }

    private finish(exitCode: number): void {
        if (this.closed) {
            return;
        }

        this.closed = true;

        this.writeEmitter.fire(
            `\r\n[Devfile task finished with exit code ${exitCode}]\r\n`
        );

        this.closeEmitter.fire(exitCode);
    }
}
