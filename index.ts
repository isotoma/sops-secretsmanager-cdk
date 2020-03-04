import * as cfn from '@aws-cdk/aws-cloudformation';
import * as iam from '@aws-cdk/aws-iam';
import * as kms from '@aws-cdk/aws-kms';
import * as lambda from '@aws-cdk/aws-lambda';
import * as s3Assets from '@aws-cdk/aws-s3-assets';
import * as secretsManager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';
import * as customResource from '@aws-cdk/custom-resources';
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

export interface SopsSecretsManagerProps {
    readonly secret?: secretsManager.Secret | secretsManager.ISecret;
    readonly secretName?: string;
    readonly asset?: s3Assets.Asset;
    readonly path?: string;
    readonly kmsKey?: kms.IKey;
    readonly mappings?: SopsSecretsManagerMappings;
    readonly wholeFile?: boolean;
    readonly fileType?: SopsSecretsManagerFileType;
}

class SopsSecretsManagerProvider extends cdk.Construct {
    public readonly provider: customResource.Provider;

    public static getOrCreate(scope: cdk.Construct): customResource.Provider {
        const stack = cdk.Stack.of(scope);
        const id = 'com.isotoma.cdk.custom-resources.sops-secrets-manager';
        const x = (stack.node.tryFindChild(id) as SopsSecretsManagerProvider) || new SopsSecretsManagerProvider(stack, id);
        return x.provider;
    }

    constructor(scope: cdk.Construct, id: string) {
        super(scope, id);

        this.provider = new customResource.Provider(this, 'sops-secrets-manager-provider', {
            onEventHandler: new lambda.Function(this, 'sops-secrets-manager-event', {
                code: lambda.Code.fromAsset(path.join(__dirname, 'provider')),
                runtime: lambda.Runtime.NODEJS_12_X,
                handler: 'index.onEvent',
                timeout: cdk.Duration.minutes(5),
                initialPolicy: [
                    new iam.PolicyStatement({
                        resources: ['*'],
                        actions: ['s3:GetObject*', 's3:GetBucket*', 's3:List*', 's3:DeleteObject*', 's3:PutObject*', 's3:Abort*'],
                    }),
                    new iam.PolicyStatement({
                        resources: ['*'],
                        actions: ['kms:*'],
                    }),
                    new iam.PolicyStatement({
                        resources: ['*'],
                        actions: ['secretsmanager:*'],
                    }),
                ],
            }),
        });
    }
}

export class SopsSecretsManager extends cdk.Construct {
    public readonly secret: secretsManager.Secret | undefined;
    public readonly secretArn: string;
    public readonly asset: s3Assets.Asset;

    constructor(scope: cdk.Construct, id: string, props: SopsSecretsManagerProps) {
        super(scope, id);

        if (props.secret && props.secretName) {
            throw new Error('Cannot set both secret and secretName');
        } else if (props.secret) {
            this.secretArn = props.secret.secretArn;
            this.secret = undefined;
        } else if (props.secretName) {
            this.secret = new secretsManager.Secret(this, 'Secret', {
                secretName: props.secretName,
            });
            this.secretArn = this.secret.secretArn;
        } else {
            throw new Error('Must set one of secret or secretName');
        }
        this.asset = this.getAsset(props.asset, props.path);

        if (props.wholeFile && props.mappings) {
            throw new Error('Cannot set mappings and set wholeFile to true');
        } else if (!props.wholeFile && !props.mappings) {
            throw new Error('Must set mappings or set wholeFile to true');
        }

        new cfn.CustomResource(this, 'Resource', {
            provider: SopsSecretsManagerProvider.getOrCreate(this),
            resourceType: 'Custom::SopsSecretsManager',
            properties: {
                SecretArn: this.secretArn,
                S3Bucket: this.asset.s3BucketName,
                S3Path: this.asset.s3ObjectKey,
                SourceHash: this.asset.sourceHash,
                KMSKeyArn: props.kmsKey?.keyArn,
                Mappings: JSON.stringify(props.mappings || {}),
                WholeFile: props.wholeFile || false,
                FileType: props.fileType,
            },
        });
    }

    public getAsset(asset?: s3Assets.Asset, secretFilePath?: string): s3Assets.Asset {
        if (asset && secretFilePath) {
            throw new Error('Cannot set both asset and path');
        }

        if (asset) {
            return asset;
        }

        if (secretFilePath) {
            return new s3Assets.Asset(this, 'SopsAsset', {
                path: secretFilePath,
            });
        }

        throw new Error('Must set one of asset or path');
    }
}
