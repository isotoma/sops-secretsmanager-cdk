import * as cdk from '@aws-cdk/core';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as lambda from '@aws-cdk/aws-lambda';
import * as customResource from '@aws-cdk/custom-resources';

import { SopsSecretsManager } from './sops-secretsmanager-cdk-dev/cdkv1';

export class SopsExampleStack extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const secret = new secretsmanager.Secret(this, 'TestSecret');

        new SopsSecretsManager(this, 'TestSops', {
            path: '../sample_secret.yaml',
            secret,
            mappings: {
                key1: {
                    path: ['key1'],
                },
                key2: {
                    path: ['key2'],
                },
            },
        });

        // This section hacks the CDK's utility lambda to use Node 12,
        // which uses Node 10 in cdk <1.94.0. This is no longer
        // deployable as of July 30, 2021.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const providerWrapper = cdk.Stack.of(this).node.findChild('com.isotoma.cdk.custom-resources.sops-secrets-manager') as any;
        const provider = providerWrapper.provider as customResource.Provider;
        const lambdaFn = (provider.node.findChild('framework-onEvent') as unknown) as lambda.Function;
        const cfnLambdaFn = lambdaFn.node.defaultChild as lambda.CfnFunction;
        cfnLambdaFn.addPropertyOverride('Runtime', lambda.Runtime.NODEJS_12_X.toString());

        new cdk.CfnOutput(this, 'TestSecretArn', {
            value: secret.secretArn,
        });
    }
}
