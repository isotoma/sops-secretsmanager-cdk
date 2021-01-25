import * as cdk from '@aws-cdk/core';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';

import { SopsSecretsManager } from './sops-secretsmanager-cdk-dev';

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

        new cdk.CfnOutput(this, 'TestSecretArn', {
            value: secret.secretArn,
        });
    }
}
