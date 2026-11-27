import * as vscode from 'vscode';
import * as k8s from '@kubernetes/client-node';
import * as jsYaml from 'js-yaml';
import { PassThrough } from 'stream';

import {
    V1alpha2DevWorkspaceSpecTemplate
} from '@devfile/api';

type GetKubeConfig = () => Promise<k8s.KubeConfig>;

interface WorkspaceDevfileLocation {
    containerName: string;
    flattenedDevfilePath: string;
}

export class K8sFlattenedDevfileReader {

    constructor(
        private readonly channel: vscode.OutputChannel,
        private readonly getKubeConfig: GetKubeConfig,
        private readonly namespace: string,
        private readonly devworkspaceId: string
    ) { }

    async get(): Promise<V1alpha2DevWorkspaceSpecTemplate> {
        const raw = await this.getRaw();

        if (!raw.trim()) {
            throw new Error('Flattened Devfile is empty.');
        }

        const devfile = jsYaml.load(
            raw
        ) as V1alpha2DevWorkspaceSpecTemplate;

        if (!devfile || typeof devfile !== 'object') {
            throw new Error('Invalid flattened Devfile YAML.');
        }

        return devfile;
    }

    async getRaw(): Promise<string> {
        const kubeConfig = await this.getKubeConfig();

        const coreApi = kubeConfig.makeApiClient(
            k8s.CoreV1Api
        );

        const labelSelector =
            `controller.devfile.io/devworkspace_id=${this.devworkspaceId}`;

        const podList = await coreApi.listNamespacedPod({
            namespace: this.namespace,
            labelSelector
        });

        const runningPods = podList.items.filter(
            pod => pod.status?.phase === 'Running'
                && !pod.metadata?.deletionTimestamp
        );

        if (runningPods.length !== 1) {
            throw new Error(
                `Expected one running DevWorkspace pod, found ${runningPods.length}.`
            );
        }

        const pod = runningPods[0];
        const podName = pod.metadata?.name;

        if (!podName) {
            throw new Error('DevWorkspace pod name is missing.');
        }

        // Discover container and flattened Devfile path dynamically.
        const location = await this.discoverDevfileLocation(pod);

        return this.readFileFromPod(
            podName,
            location.containerName,
            location.flattenedDevfilePath
        );
    }

    private async discoverDevfileLocation(
        pod: k8s.V1Pod
    ): Promise<WorkspaceDevfileLocation> {

        const containers = pod.spec?.containers ?? [];
        const podName = pod.metadata?.name;

        if (!podName) {
            throw new Error('DevWorkspace pod name is missing.');
        }

        for (const container of containers) {
            try {
                const path = await this.execCommand(
                    podName,
                    container.name,
                    ['printenv', 'DEVWORKSPACE_FLATTENED_DEVFILE']
                );

                if (path.trim()) {

                    return {
                        containerName: container.name,
                        flattenedDevfilePath: path.trim()
                    };
                }
            } catch {
                this.channel.appendLine(
                    `[Devfile Reader] Container '${container.name}' does not expose the flattened Devfile variable.`
                );
            }
        }

        throw new Error(
            'Unable to discover flattened Devfile path in any workspace container.'
        );
    }


    private async execCommand(
        podName: string,
        containerName: string,
        command: string[]
    ): Promise<string> {

        const kubeConfig = await this.getKubeConfig();
        const exec = new k8s.Exec(kubeConfig);

        const stdout = new PassThrough();
        const stderr = new PassThrough();

        let output = '';
        let errorOutput = '';
        let commandStatus: k8s.V1Status | undefined;

        stdout.on('data', (chunk: Buffer) => {
            output += chunk.toString();
        });

        stderr.on('data', (chunk: Buffer) => {
            errorOutput += chunk.toString();
        });

        const websocket = await exec.exec(
            this.namespace,
            podName,
            containerName,
            command,
            stdout,
            stderr,
            null,
            false,
            (status: k8s.V1Status) => {
                commandStatus = status;
            }
        );

        return new Promise<string>((resolve, reject) => {
            websocket.on('close', () => {
                if (commandStatus?.status === 'Success') {
                    resolve(output.trim());
                } else {
                    reject(
                        new Error(
                            `Command failed in container '${containerName}'. ` +
                            `Status: ${JSON.stringify(commandStatus)}. ` +
                            `Stderr: ${errorOutput}`
                        )
                    );
                }
            });

            websocket.on('error', (error: Error) => {
                reject(error);
            });
        });
    }



    private async readFileFromPod(
        podName: string,
        containerName: string,
        flattenedDevfilePath: string
    ): Promise<string> {

        return this.execCommand(
            podName,
            containerName,
            ['cat', flattenedDevfilePath]
        );
    }

}
