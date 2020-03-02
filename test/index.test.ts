import { expect, haveResource } from '@aws-cdk/assert';
import { Stack } from '@aws-cdk/core';
import '@aws-cdk/assert/jest';
import { SopsSecretsManager } from '..';

test('creates-a-provider', () => {
    const stack = new Stack();

    new SopsSecretsManager(stack, 'Secret', {
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
            Mappings: '{"mykey":{"path":["a","b"]}}',
        }),
    );

    expect(stack).to(
        haveResource('AWS::SecretsManager::Secret', {
            Name: 'MySecret',
        }),
    );
});
