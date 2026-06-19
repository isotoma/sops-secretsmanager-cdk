import * as path from 'path';

export type SopsSecretsManagerEncoding = 'string' | 'json';

export type SopsSecretsManagerFileType = 'yaml' | 'json';

export interface SopsSecretsManagerMapping {
    path: Array<string>;
    encoding?: SopsSecretsManagerEncoding;
}

export interface SopsSecretsManagerMappings {
    [key: string]: SopsSecretsManagerMapping;
}

export interface SopsSecretsManagerBaseProps {
    readonly secret?: unknown;
    readonly secretName?: string;
    readonly asset?: unknown;
    readonly path?: string;
    readonly kmsKey?: unknown;
    readonly mappings?: SopsSecretsManagerMappings;
    readonly wholeFile?: boolean;
    readonly singleValueMapping?: SopsSecretsManagerMapping;
    readonly fileType?: SopsSecretsManagerFileType;
}

export const providerId = 'com.isotoma.cdk.custom-resources.sops-secrets-manager';
export const providerLogicalId = 'sops-secrets-manager-provider';
export const providerFunctionLogicalId = 'sops-secrets-manager-event';
export const providerCodePath = path.join(__dirname, 'provider');
export const providerHandler = 'index.onEvent';
export const providerTimoutMinutes = 5;

interface PolicyStatement {
    resources: Array<string>;
    actions: Array<string>;
};

/**
 * @deprecated Retained for backwards compatibility only. The provider Lambda's
 * permissions are now granted directly in SopsSecretsManager via scoped
 * grant*() calls (asset read, secret write, KMS decrypt), so this is
 * intentionally empty and is no longer a supported customization point.
 */
export const providerPolicyStatements: Array<PolicyStatement> = [];
