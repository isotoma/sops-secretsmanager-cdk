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

export const providerPolicyStatements: Array<PolicyStatement> = [{
    resources: ['*'],
    actions: ['s3:GetObject*', 's3:GetBucket*', 's3:List*', 's3:DeleteObject*', 's3:PutObject*', 's3:Abort*'],
}, {
    resources: ['*'],
    actions: ['kms:*'],
}, {
    resources: ['*'],
    actions: ['secretsmanager:*'],
}];
