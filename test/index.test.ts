import { expect as cdkExpect, haveResource } from '@aws-cdk/assert';
import { Stack } from '@aws-cdk/core';
import '@aws-cdk/assert/jest';
import { SopsSecretsManager } from '..';
import * as secretsManager from '@aws-cdk/aws-secretsmanager';
import * as kms from '@aws-cdk/aws-kms';
import * as s3Assets from '@aws-cdk/aws-s3-assets';

test('creates a secret, and a custom resource', () => {
    const stack = new Stack();

    const secretValues = new SopsSecretsManager(stack, 'SecretValues', {
        secretName: 'MySecret',
        path: './test/test.yaml',
        mappings: {
            mykey: {
                path: ['a', 'b'],
            },
        },
    });

    cdkExpect(stack).to(
        haveResource('Custom::SopsSecretsManager', {
            SecretArn: stack.resolve((secretValues.secret as secretsManager.Secret).secretArn),
            Mappings: '{"mykey":{"path":["a","b"]}}',
        }),
    );

    cdkExpect(stack).to(
        haveResource('AWS::SecretsManager::Secret', {
            Name: 'MySecret',
        }),
    );
});

test('errors if passed a secret and a secretName', () => {
    const stack = new Stack();

    const secret = new secretsManager.Secret(stack, 'Secret', {
        secretName: 'MySecret',
    });

    expect(() => {
        new SopsSecretsManager(stack, 'SecretValues', {
            secretName: 'MySecret',
            secret,
            path: './test/test.yaml',
            mappings: {
                mykey: {
                    path: ['a', 'b'],
                },
            },
        });
    }).toThrowError();
});

test('errors if passed neither a secret nor a secretName', () => {
    const stack = new Stack();

    expect(() => {
        new SopsSecretsManager(stack, 'SecretValues', {
            path: './test/test.yaml',
            mappings: {
                mykey: {
                    path: ['a', 'b'],
                },
            },
        });
    }).toThrowError();
});

test('errors if passed mappings and wholeFile=true', () => {
    const stack = new Stack();

    expect(() => {
        new SopsSecretsManager(stack, 'SecretValues', {
            secretName: 'MySecret',
            path: './test/test.yaml',
            mappings: {
                mykey: {
                    path: ['a', 'b'],
                },
            },
            wholeFile: true,
        });
    }).toThrowError();
});

test('errors if passed neither mappings and nor wholeFile=true', () => {
    const stack = new Stack();

    expect(() => {
        new SopsSecretsManager(stack, 'SecretValues', {
            secretName: 'MySecret',
            path: './test/test.yaml',
        });
    }).toThrowError();
});

test('can set wholeFile=true', () => {
    const stack = new Stack();

    const secretValues = new SopsSecretsManager(stack, 'SecretValues', {
        secretName: 'MySecret',
        path: './test/test.yaml',
        wholeFile: true,
    });

    cdkExpect(stack).to(
        haveResource('Custom::SopsSecretsManager', {
            Mappings: '{}',
            WholeFile: true,
            SecretArn: stack.resolve((secretValues.secret as secretsManager.Secret).secretArn),
        }),
    );
});

test('can pass a kms key', () => {
    const stack = new Stack();

    const kmsKey = new kms.Key(stack, 'Key');

    const secretValues = new SopsSecretsManager(stack, 'SecretValues', {
        secretName: 'MySecret',
        path: './test/test.yaml',
        kmsKey,
        mappings: {
            mykey: {
                path: ['a', 'b'],
            },
        },
    });

    cdkExpect(stack).to(
        haveResource('Custom::SopsSecretsManager', {
            SecretArn: stack.resolve((secretValues.secret as secretsManager.Secret).secretArn),
            KMSKeyArn: stack.resolve(kmsKey.keyArn),
            Mappings: '{"mykey":{"path":["a","b"]}}',
        }),
    );
});

test('can pass an asset rather than a path', () => {
    const stack = new Stack();

    const secretAsset = new s3Assets.Asset(stack, 'SecretAsset', {
        path: './test/test.yaml',
    });

    const secretValues = new SopsSecretsManager(stack, 'SecretValues', {
        secretName: 'MySecret',
        asset: secretAsset,
        mappings: {
            mykey: {
                path: ['a', 'b'],
            },
        },
    });

    cdkExpect(stack).to(
        haveResource('Custom::SopsSecretsManager', {
            S3Bucket: stack.resolve(secretAsset.s3BucketName),
            S3Path: stack.resolve(secretAsset.s3ObjectKey),
        }),
    );
});

test('errors if passed both a path and an asset', () => {
    const stack = new Stack();

    const secretAsset = new s3Assets.Asset(stack, 'SecretAsset', {
        path: './test/test.yaml',
    });

    expect(() => {
        new SopsSecretsManager(stack, 'SecretValues', {
            secretName: 'MySecret',
            path: './test/test.yaml',
            asset: secretAsset,
        });
    }).toThrowError();
});

test('errors if passed neither a path nor an asset', () => {
    const stack = new Stack();

    expect(() => {
        new SopsSecretsManager(stack, 'SecretValues', {
            secretName: 'MySecret',
        });
    }).toThrowError();
});

test('uses a secret, creates a custom resource', () => {
    const stack = new Stack();

    const secret = new secretsManager.Secret(stack, 'Secret', {
        secretName: 'MySecret',
    });

    new SopsSecretsManager(stack, 'SecretValues', {
        secret,
        path: './test/test.yaml',
        mappings: {
            mykey: {
                path: ['a', 'b'],
            },
        },
    });

    cdkExpect(stack).to(
        haveResource('Custom::SopsSecretsManager', {
            Mappings: '{"mykey":{"path":["a","b"]}}',
            SecretArn: stack.resolve(secret.secretArn),
        }),
    );

    cdkExpect(stack).to(
        haveResource('AWS::SecretsManager::Secret', {
            Name: 'MySecret',
        }),
    );
});
