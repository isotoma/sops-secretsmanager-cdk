import * as cfn from '@aws-cdk/aws-cloudformation';
import * as iam from '@aws-cdk/aws-iam';
import * as kms from '@aws-cdk/aws-kms';
import * as lambda from '@aws-cdk/aws-lambda';
import * as s3Assets from '@aws-cdk/aws-s3-assets';
import * as secretsManager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';
import * as customResource from '@aws-cdk/custom-resources';
import * as common from './common';
export * from './common';

export interface SopsSecretsManagerProps extends common.SopsSecretsManagerBaseProps {
    readonly secret?: secretsManager.Secret | secretsManager.ISecret;
    readonly asset?: s3Assets.Asset;
    readonly kmsKey?: kms.IKey;
}

class SopsSecretsManagerProvider extends cdk.Construct {
    public readonly provider: customResource.Provider;

    public static getOrCreate(scope: cdk.Construct): customResource.Provider {
        const stack = cdk.Stack.of(scope);
        const id = common.providerId;
        const x = (stack.node.tryFindChild(id) as SopsSecretsManagerProvider) || new SopsSecretsManagerProvider(stack, id);
        return x.provider;
    }

    constructor(scope: cdk.Construct, id: string) {
        super(scope, id);

        const policyStatements: Array<iam.PolicyStatement> = [];
        for (const statement of common.providerPolicyStatements) {
            policyStatements.push(new iam.PolicyStatement(statement));
        }

        this.provider = new customResource.Provider(this, common.providerLogicalId, {
            onEventHandler: new lambda.Function(this, common.providerFunctionLogicalId, {
                code: lambda.Code.fromAsset(common.providerCodePath),
                runtime: lambda.Runtime.NODEJS_14_X,
                handler: common.providerHandler,
                timeout: cdk.Duration.minutes(common.providerTimoutMinutes),
                initialPolicy: policyStatements,
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
