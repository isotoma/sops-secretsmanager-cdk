import { Match, Template } from 'aws-cdk-lib/assertions';
import { Stack } from 'aws-cdk-lib/core';
import { SopsSecretsManager } from '../cdkv2';
import * as secretsManager from 'aws-cdk-lib/aws-secretsmanager';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3Assets from 'aws-cdk-lib/aws-s3-assets';

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

    const template = Template.fromStack(stack);
    template.hasResourceProperties('Custom::SopsSecretsManager', {
        SecretArn: stack.resolve((secretValues.secret as secretsManager.Secret).secretArn),
        Mappings: '{"mykey":{"path":["a","b"]}}',
    });

    template.hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: 'MySecret',
    });
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

    const template = Template.fromStack(stack);
    template.hasResourceProperties('Custom::SopsSecretsManager', {
        Mappings: '{}',
        WholeFile: true,
        SecretArn: stack.resolve((secretValues.secret as secretsManager.Secret).secretArn),
    });
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

    const template = Template.fromStack(stack);
    template.hasResourceProperties('Custom::SopsSecretsManager', {
        SecretArn: stack.resolve((secretValues.secret as secretsManager.Secret).secretArn),
        KMSKeyArn: stack.resolve(kmsKey.keyArn),
        Mappings: '{"mykey":{"path":["a","b"]}}',
    });
});

test('can pass an asset rather than a path', () => {
    const stack = new Stack();

    const secretAsset = new s3Assets.Asset(stack, 'SecretAsset', {
        path: './test/test.yaml',
    });

    new SopsSecretsManager(stack, 'SecretValues', {
        secretName: 'MySecret',
        asset: secretAsset,
        mappings: {
            mykey: {
                path: ['a', 'b'],
            },
        },
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('Custom::SopsSecretsManager', {
        S3Bucket: stack.resolve(secretAsset.s3BucketName),
        S3Path: stack.resolve(secretAsset.s3ObjectKey),
    });
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

    const template = Template.fromStack(stack);
    template.hasResourceProperties('Custom::SopsSecretsManager', {
        Mappings: '{"mykey":{"path":["a","b"]}}',
        SecretArn: stack.resolve(secret.secretArn),
    });

    template.hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: 'MySecret',
    });
});

const allPolicyStatements = (template: Template): Array<Record<string, unknown>> =>
    Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
        (p: any) => p.Properties?.PolicyDocument?.Statement ?? [],
    );

const hasWildcardAction = (statements: Array<Record<string, unknown>>, action: string): boolean =>
    statements.some((s) =>
        s.Action === action ||
        (Array.isArray(s.Action) && (s.Action as string[]).includes(action)),
    );

test('grants scoped S3 read access to the asset for the Lambda', () => {
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

    const template = Template.fromStack(stack);

    // S3 read policy must be scoped to specific bucket/key, not a bare '*'
    const s3Statements = allPolicyStatements(template).filter((s) =>
        Array.isArray(s.Action) && (s.Action as string[]).some((a) => a.startsWith('s3:')),
    );
    expect(s3Statements.length).toBeGreaterThan(0);
    for (const stmt of s3Statements) {
        expect(stmt.Resource).not.toBe('*');
        expect(Array.isArray(stmt.Resource)).toBe(true);
    }

    void secretValues;
});

test('grants scoped SecretsManager write access to the specific secret for the Lambda', () => {
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

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
            Statement: Match.arrayWith([
                Match.objectLike({
                    Action: Match.arrayWith(['secretsmanager:PutSecretValue']),
                    Resource: stack.resolve((secretValues.secret as secretsManager.Secret).secretArn),
                }),
            ]),
        },
    });

    expect(hasWildcardAction(allPolicyStatements(template), 'secretsmanager:*')).toBe(false);
});

test('grants scoped SecretsManager write access when passing an existing secret', () => {
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

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
            Statement: Match.arrayWith([
                Match.objectLike({
                    Action: Match.arrayWith(['secretsmanager:PutSecretValue']),
                    Resource: stack.resolve(secret.secretArn),
                }),
            ]),
        },
    });
});

test('grants scoped KMS decrypt access when a kmsKey is provided', () => {
    const stack = new Stack();

    const kmsKey = new kms.Key(stack, 'Key');

    new SopsSecretsManager(stack, 'SecretValues', {
        secretName: 'MySecret',
        path: './test/test.yaml',
        kmsKey,
        mappings: {
            mykey: {
                path: ['a', 'b'],
            },
        },
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
            Statement: Match.arrayWith([
                Match.objectLike({
                    Action: 'kms:Decrypt',
                    Resource: stack.resolve(kmsKey.keyArn),
                }),
            ]),
        },
    });

    expect(hasWildcardAction(allPolicyStatements(template), 'kms:*')).toBe(false);

    // When a specific key is provided the resource must also be scoped (no kms:Decrypt *)
    const wildcardDecrypt = allPolicyStatements(template).filter((s) => {
        const isDecrypt = s.Action === 'kms:Decrypt' || (Array.isArray(s.Action) && (s.Action as string[]).includes('kms:Decrypt'));
        return isDecrypt && s.Resource === '*';
    });
    expect(wildcardDecrypt).toHaveLength(0);
});

test('falls back to kms:Decrypt * when no kmsKey is provided', () => {
    const stack = new Stack();

    new SopsSecretsManager(stack, 'SecretValues', {
        secretName: 'MySecret',
        path: './test/test.yaml',
        mappings: {
            mykey: {
                path: ['a', 'b'],
            },
        },
    });

    const template = Template.fromStack(stack);
    const stmts = allPolicyStatements(template);

    const wildcardDecrypt = stmts.filter((s) => {
        const isDecrypt = s.Action === 'kms:Decrypt' || (Array.isArray(s.Action) && (s.Action as string[]).includes('kms:Decrypt'));
        return isDecrypt && s.Resource === '*';
    });
    expect(wildcardDecrypt.length).toBeGreaterThan(0);
});

// No node12 hack behaviour to test in cdk v2
