import { expect, haveResource } from '@aws-cdk/assert';
import { Stack } from '@aws-cdk/core';
import '@aws-cdk/assert/jest';
import { SopsSecretsManager } from '..';
import * as secretsManager from '@aws-cdk/aws-secretsmanager';

test('creates a secret, and a custom resource', () => {
    const stack = new Stack();

    const secretValues = new SopsSecretsManager(stack, 'SecretValues', {
        secretName: 'MySecret',
        path: './test/test.yaml',
        kmsKey: undefined,
        mappings: {
            mykey: {
                path: ['a', 'b'],
            },
        },
    });

    expect(stack).to(
        haveResource('Custom::SopsSecretsManager', {
            SecretArn: stack.resolve((secretValues.secret as secretsManager.Secret).secretArn),
            Mappings: '{"mykey":{"path":["a","b"]}}',
        }),
    );

    expect(stack).to(
        haveResource('AWS::SecretsManager::Secret', {
            Name: 'MySecret',
        }),
    );
});


test('uses a secret, creates a custom resource', () => {
    const stack = new Stack();

    const secret = new secretsManager.Secret(stack, 'Secret', {
        secretName: 'MySecret',
    });

    new SopsSecretsManager(stack, 'SecretValues', {
        secret,
        path: './test/test.yaml',
        kmsKey: undefined,
        mappings: {
            mykey: {
                path: ['a', 'b'],
            },
        },
    });

    expect(stack).to(
        haveResource('Custom::SopsSecretsManager', {
            Mappings: '{"mykey":{"path":["a","b"]}}',
            SecretArn: stack.resolve(secret.secretArn),
        }),
    );

    expect(stack).to(
        haveResource('AWS::SecretsManager::Secret', {
            Name: 'MySecret',
        }),
    );
});
