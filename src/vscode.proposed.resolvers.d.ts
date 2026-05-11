/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Subset of the resolvers proposal needed by this extension.
// Full definition: https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.resolvers.d.ts

declare module 'vscode' {

	export interface RemoteAuthorityResolverContext {
		resolveAttempt: number;
	}

	export class ResolvedAuthority {
		readonly host: string;
		readonly port: number;
		readonly connectionToken: string | undefined;
		constructor(host: string, port: number, connectionToken?: string);
	}

	export interface ManagedMessagePassing {
		readonly onDidReceiveMessage: Event<Uint8Array>;
		readonly onDidClose: Event<Error | undefined>;
		readonly onDidEnd: Event<void>;
		send: (data: Uint8Array) => void;
		end: () => void;
		drain?: () => Thenable<void>;
	}

	export class ManagedResolvedAuthority {
		readonly makeConnection: () => Thenable<ManagedMessagePassing>;
		readonly connectionToken: string | undefined;
		constructor(makeConnection: () => Thenable<ManagedMessagePassing>, connectionToken?: string);
	}

	export interface ResolvedOptions {
		extensionHostEnv?: { [key: string]: string | null };
		isTrusted?: boolean;
	}

	export interface TunnelOptions {
		remoteAddress: { port: number; host: string };
		localAddressPort?: number;
		label?: string;
		privacy?: string;
		protocol?: string;
	}

	export interface TunnelCreationOptions {
		elevationRequired?: boolean;
	}

	export interface TunnelDescription {
		remoteAddress: { port: number; host: string };
		localAddress: { port: number; host: string } | string;
		privacy?: string;
		protocol?: string;
	}

	export interface Tunnel extends TunnelDescription {
		readonly onDidDispose: Event<void>;
		dispose(): void | Thenable<void>;
	}

	export interface TunnelInformation {
		environmentTunnels?: TunnelDescription[];
	}

	export type ResolverResult = (ResolvedAuthority | ManagedResolvedAuthority) & ResolvedOptions & TunnelInformation;

	export class RemoteAuthorityResolverError extends Error {
		static NotAvailable(message?: string, handled?: boolean): RemoteAuthorityResolverError;
		static TemporarilyNotAvailable(message?: string): RemoteAuthorityResolverError;
		constructor(message?: string);
	}

	export interface RemoteAuthorityResolver {
		resolve(authority: string, context: RemoteAuthorityResolverContext): ResolverResult | Thenable<ResolverResult>;
		getCanonicalURI?(uri: Uri): ProviderResult<Uri>;
		tunnelFactory?: (tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions) => Thenable<Tunnel> | undefined;
	}

	export interface ResourceLabelFormatter {
		scheme: string;
		authority?: string;
		formatting: ResourceLabelFormatting;
	}

	export interface ResourceLabelFormatting {
		label: string;
		separator: '/' | '\\' | '';
		tildify?: boolean;
		normalizeDriveLetter?: boolean;
		workspaceSuffix?: string;
		stripPathStartingSeparator?: boolean;
	}

	export namespace workspace {
		export function registerRemoteAuthorityResolver(authorityPrefix: string, resolver: RemoteAuthorityResolver): Disposable;
		export function registerResourceLabelFormatter(formatter: ResourceLabelFormatter): Disposable;
	}

	export namespace env {
		export const remoteAuthority: string | undefined;
	}
}
