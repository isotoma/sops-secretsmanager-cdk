import * as path from 'path';
import * as childProcess from 'child_process';
import * as events from 'events';
import { onEvent } from '../';
import { TextEncoder } from 'util';
import { Writable } from 'stream';

const mockS3GetObject = jest.fn();
const mockSecretsManagerPutSecretValue = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
    S3: jest.fn(() => ({
        getObject: mockS3GetObject,
    })),
}));
jest.mock('@aws-sdk/client-secrets-manager', () => ({
    SecretsManager: jest.fn(() => ({
        putSecretValue: mockSecretsManagerPutSecretValue,
    })),
}));
jest.mock('child_process');

interface MockS3GetObjectResponse {
    Body: {
        transformToString: () => Promise<string>;
    };
}

beforeEach(() => {
    mockS3GetObject.mockReset();
    mockSecretsManagerPutSecretValue.mockReset();

    mockS3GetObject.mockImplementation(
        (): Promise<MockS3GetObjectResponse> =>
            Promise.resolve({
                Body: {
                    transformToString: () => Promise.resolve(''),
                },
            }),
    );
    mockSecretsManagerPutSecretValue.mockImplementation(() => ({
        promise: (): Promise<Record<string, unknown>> => Promise.resolve({}),
    }));
});

class MockChildProcess extends events.EventEmitter {
    readonly stdout: events.EventEmitter;
    readonly stderr: events.EventEmitter;
    readonly stdin: Writable;

    constructor() {
        super();

        this.stdout = new events.EventEmitter();
        this.stderr = new events.EventEmitter();

        this.stdin = ({
            end: jest.fn(),
        } as unknown) as Writable;
    }
}

interface SetMockSpawnProps {
    stdoutData: string;
    stderrData?: string;
    code?: number;
}

const setMockSpawn = (props: SetMockSpawnProps): MockChildProcess => {
    const { stdoutData = null, stderrData = null, code = 0 } = props;
    const emitter = new MockChildProcess();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (childProcess.spawn as jest.Mock).mockImplementationOnce((file: string, args: Array<string>, options: Record<string, unknown>) => {
        if (stdoutData) {
            setTimeout(() => {
                emitter.stdout.emit('data', new TextEncoder().encode(stdoutData));
            }, 10);
        }
        if (stderrData) {
            setTimeout(() => {
                emitter.stderr.emit('data', new TextEncoder().encode(stderrData));
            }, 10);
        }
        setTimeout(() => {
            emitter.emit('close', code);
        }, 20);

        return emitter as childProcess.ChildProcess;
    });
    return emitter;
};

describe('onCreate', () => {
    test('simple', async () => {
        mockS3GetObject.mockImplementation(
            (): Promise<MockS3GetObjectResponse> =>
                Promise.resolve({
                    Body: {
                        transformToString: () => Promise.resolve('a: 1234'),
                    },
                }),
        );
        const mockProc = setMockSpawn({ stdoutData: JSON.stringify({ a: 'abc' }) });
        mockSecretsManagerPutSecretValue.mockImplementation((): Promise<Record<string, unknown>> => Promise.resolve({}));

        expect(
            await onEvent({
                RequestType: 'Create',
                ResourceProperties: {
                    KMSKeyArn: undefined,
                    S3Bucket: 'mys3bucket',
                    S3Path: 'mys3path.yaml',
                    Mappings: JSON.stringify({
                        key: {
                            path: ['a'],
                        },
                    }),
                    SingleValueMapping: JSON.stringify(null),
                    WholeFile: false,
                    SecretArn: 'mysecretarn',
                    SourceHash: '123',
                    FileType: undefined,
                },
            }),
        ).toEqual({
            Data: {},
            PhysicalResourceId: 'secretdata_mysecretarn',
        });

        expect(mockSecretsManagerPutSecretValue).toBeCalledWith({
            SecretId: 'mysecretarn',
            SecretString: expect.any(String),
        });

        expect(JSON.parse(mockSecretsManagerPutSecretValue.mock.calls[0][0].SecretString)).toEqual({
            key: 'abc',
        });

        expect(mockS3GetObject).toBeCalledWith({
            Bucket: 'mys3bucket',
            Key: 'mys3path.yaml',
        });

        expect(childProcess.spawn as jest.Mock).toBeCalledWith(
            'sh',
            ['-c', 'cat', '-', '|', path.normalize(path.join(__dirname, '../sops')), '-d', '--input-type', 'yaml', '--output-type', 'json', '/dev/stdin'],
            {
                shell: true,
                stdio: 'pipe',
            },
        );
        expect(mockProc.stdin.end).toBeCalledWith('a: 1234');
    });

    test('can specify file type explicitly', async () => {
        mockS3GetObject.mockImplementation(
            (): Promise<MockS3GetObjectResponse> =>
                Promise.resolve({
                    Body: {
                        transformToString: () => Promise.resolve('{"a": 1234}'),
                    },
                }),
        );
        const mockProc = setMockSpawn({ stdoutData: JSON.stringify({ a: 'abc' }), stderrData: 'a message' });
        mockSecretsManagerPutSecretValue.mockImplementation((): Promise<Record<string, unknown>> => Promise.resolve({}));

        expect(
            await onEvent({
                RequestType: 'Create',
                ResourceProperties: {
                    KMSKeyArn: undefined,
                    S3Bucket: 'mys3bucket',
                    S3Path: 'mys3path.sops',
                    Mappings: JSON.stringify({
                        key: {
                            path: ['a'],
                        },
                    }),
                    SingleValueMapping: JSON.stringify(null),
                    WholeFile: false,
                    SecretArn: 'mysecretarn',
                    SourceHash: '123',
                    FileType: 'json',
                },
            }),
        ).toEqual({
            Data: {},
            PhysicalResourceId: 'secretdata_mysecretarn',
        });

        expect(childProcess.spawn as jest.Mock).toBeCalledWith(
            'sh',
            ['-c', 'cat', '-', '|', path.normalize(path.join(__dirname, '../sops')), '-d', '--input-type', 'json', '--output-type', 'json', '/dev/stdin'],
            {
                shell: true,
                stdio: 'pipe',
            },
        );
        expect(mockProc.stdin.end).toBeCalledWith('{"a": 1234}');
    });

    test('handles error from exec', async () => {
        mockS3GetObject.mockImplementation(
            (): Promise<MockS3GetObjectResponse> =>
                Promise.resolve({
                    Body: {
                        transformToString: () => Promise.resolve('a: 1234'),
                    },
                }),
        );
        setMockSpawn({ stdoutData: '', stderrData: 'Error running sops', code: 99 });
        mockSecretsManagerPutSecretValue.mockImplementation((): Promise<Record<string, unknown>> => Promise.resolve({}));

        expect(
            await onEvent({
                RequestType: 'Create',
                ResourceProperties: {
                    KMSKeyArn: undefined,
                    S3Bucket: 'mys3bucket',
                    S3Path: 'mys3path.yaml',
                    Mappings: JSON.stringify({
                        key: {
                            path: ['a'],
                        },
                    }),
                    SingleValueMapping: JSON.stringify(null),
                    WholeFile: false,
                    SecretArn: 'mysecretarn',
                    SourceHash: '123',
                    FileType: undefined,
                },
            }),
        ).toEqual({
            Data: {},
            PhysicalResourceId: 'secretdata_mysecretarn',
        });

        expect(mockSecretsManagerPutSecretValue).toBeCalledWith({
            SecretId: 'mysecretarn',
            SecretString: expect.any(String),
        });

        // Should successfully put an empty object into secrets manager
        expect(JSON.parse(mockSecretsManagerPutSecretValue.mock.calls[0][0].SecretString)).toEqual({});
    });

    test('mapping with encoding', async () => {
        setMockSpawn({
            stdoutData: JSON.stringify({
                a: {
                    b: 'c',
                },
            }),
        });

        await onEvent({
            RequestType: 'Create',
            ResourceProperties: {
                KMSKeyArn: undefined,
                S3Bucket: 'mys3bucket',
                S3Path: 'mys3path.yaml',
                Mappings: JSON.stringify({
                    key: {
                        path: ['a'],
                        encoding: 'json',
                    },
                }),
                SingleValueMapping: JSON.stringify(null),
                WholeFile: false,
                SecretArn: 'mysecretarn',
                SourceHash: '123',
                FileType: undefined,
            },
        });

        expect(mockSecretsManagerPutSecretValue).toBeCalledWith({
            SecretId: 'mysecretarn',
            SecretString: expect.any(String),
        });

        expect(JSON.parse(mockSecretsManagerPutSecretValue.mock.calls[0][0].SecretString)).toEqual({
            key: expect.any(String),
        });
        expect(JSON.parse(JSON.parse(mockSecretsManagerPutSecretValue.mock.calls[0][0].SecretString).key)).toEqual({
            b: 'c',
        });
    });

    test('wholeFile as string value', async () => {
        setMockSpawn({
            stdoutData: JSON.stringify({
                a: {
                    b: 'c',
                },
            }),
        });

        await onEvent({
            RequestType: 'Create',
            ResourceProperties: {
                KMSKeyArn: undefined,
                S3Bucket: 'mys3bucket',
                S3Path: 'mys3path.yaml',
                Mappings: JSON.stringify({
                    key: {
                        path: ['a'],
                        encoding: 'json',
                    },
                }),
                SingleValueMapping: JSON.stringify(null),
                WholeFile: 'false', // because a boolean set in the CDK becomes a string once it reaches the provider
                SecretArn: 'mysecretarn',
                SourceHash: '123',
                FileType: undefined,
            },
        });

        expect(mockSecretsManagerPutSecretValue).toBeCalledWith({
            SecretId: 'mysecretarn',
            SecretString: expect.any(String),
        });

        expect(JSON.parse(mockSecretsManagerPutSecretValue.mock.calls[0][0].SecretString)).toEqual({
            key: expect.any(String),
        });
        expect(JSON.parse(JSON.parse(mockSecretsManagerPutSecretValue.mock.calls[0][0].SecretString).key)).toEqual({
            b: 'c',
        });
    });

    test('whole file', async () => {
        setMockSpawn({
            stdoutData: JSON.stringify({
                data: 'mysecretdata',
            }),
        });

        await onEvent({
            RequestType: 'Create',
            ResourceProperties: {
                KMSKeyArn: undefined,
                S3Bucket: 'mys3bucket',
                S3Path: 'mys3path.txt',
                Mappings: JSON.stringify({}),
                SingleValueMapping: JSON.stringify(null),
                WholeFile: true,
                SecretArn: 'mysecretarn',
                SourceHash: '123',
                FileType: undefined,
            },
        });

        expect(childProcess.spawn as jest.Mock).toBeCalledWith(
            'sh',
            ['-c', 'cat', '-', '|', path.normalize(path.join(__dirname, '../sops')), '-d', '--input-type', 'json', '--output-type', 'json', '/dev/stdin'],
            {
                shell: true,
                stdio: 'pipe',
            },
        );

        expect(mockSecretsManagerPutSecretValue).toBeCalledWith({
            SecretId: 'mysecretarn',
            SecretString: 'mysecretdata',
        });
    });

    test('singleValueMapping', async () => {
        setMockSpawn({
            stdoutData: JSON.stringify({
                a: {
                    b: 'c',
                },
            }),
        });

        await onEvent({
            RequestType: 'Create',
            ResourceProperties: {
                KMSKeyArn: undefined,
                S3Bucket: 'mys3bucket',
                S3Path: 'mys3path.txt',
                Mappings: JSON.stringify({}),
                SingleValueMapping: JSON.stringify({
                    path: ['a', 'b'],
                }),
                WholeFile: false,
                SecretArn: 'mysecretarn',
                SourceHash: '123',
                FileType: undefined,
            },
        });

        expect(mockSecretsManagerPutSecretValue).toBeCalledWith({
            SecretId: 'mysecretarn',
            SecretString: 'c',
        });
    });

    test('pass kms key arn', async () => {
        mockS3GetObject.mockImplementation(
            (): Promise<MockS3GetObjectResponse> =>
                Promise.resolve({
                    Body: {
                        transformToString: () => Promise.resolve('a: 1234'),
                    },
                }),
        );
        setMockSpawn({ stdoutData: JSON.stringify({ a: 'abc' }) });
        mockSecretsManagerPutSecretValue.mockImplementation((): Promise<Record<string, unknown>> => Promise.resolve({}));

        expect(
            await onEvent({
                RequestType: 'Create',
                ResourceProperties: {
                    KMSKeyArn: 'my-kms-key-arn',
                    S3Bucket: 'mys3bucket',
                    S3Path: 'mys3path.yaml',
                    Mappings: JSON.stringify({
                        key: {
                            path: ['a'],
                        },
                    }),
                    SingleValueMapping: JSON.stringify(null),
                    WholeFile: false,
                    SecretArn: 'mysecretarn',
                    SourceHash: '123',
                    FileType: undefined,
                },
            }),
        ).toEqual({
            Data: {},
            PhysicalResourceId: 'secretdata_mysecretarn',
        });

        expect(childProcess.spawn as jest.Mock).toBeCalledWith(
            'sh',
            ['-c', 'cat', '-', '|', path.normalize(path.join(__dirname, '../sops')), '-d', '--input-type', 'yaml', '--output-type', 'json', '--kms', 'my-kms-key-arn', '/dev/stdin'],
            {
                shell: true,
                stdio: 'pipe',
            },
        );
    });
});

// TODO: test more interesting mappings (eg, longer path)
// TODO: test if returned JSON from sops not an object
// TODO: test more interesting encodings (string vs json vs unknown), and if string but value is an object
// TODO: test wholefile if .data is undefined

describe('onUpdate', () => {
    test('simple', async () => {
        mockS3GetObject.mockImplementation(
            (): Promise<MockS3GetObjectResponse> =>
                Promise.resolve({
                    Body: {
                        transformToString: () => Promise.resolve('a: 1234'),
                    },
                }),
        );
        const mockProc = setMockSpawn({ stdoutData: JSON.stringify({ a: 'abc' }) });
        mockSecretsManagerPutSecretValue.mockImplementation((): Promise<Record<string, unknown>> => Promise.resolve({}));

        expect(
            await onEvent({
                PhysicalResourceId: 'secretdata_mysecretarn_for_update',
                RequestType: 'Update',
                ResourceProperties: {
                    KMSKeyArn: undefined,
                    S3Bucket: 'mys3bucket',
                    S3Path: 'mys3path.yaml',
                    Mappings: JSON.stringify({
                        key: {
                            path: ['a'],
                        },
                    }),
                    SingleValueMapping: JSON.stringify(null),
                    WholeFile: false,
                    SecretArn: 'mysecretarn',
                    SourceHash: '123',
                    FileType: undefined,
                },
            }),
        ).toEqual({
            Data: {},
            PhysicalResourceId: 'secretdata_mysecretarn_for_update',
        });

        expect(mockSecretsManagerPutSecretValue).toBeCalledWith({
            SecretId: 'mysecretarn',
            SecretString: expect.any(String),
        });

        expect(JSON.parse(mockSecretsManagerPutSecretValue.mock.calls[0][0].SecretString)).toEqual({
            key: 'abc',
        });

        expect(mockS3GetObject).toBeCalledWith({
            Bucket: 'mys3bucket',
            Key: 'mys3path.yaml',
        });

        expect(childProcess.spawn as jest.Mock).toBeCalledWith(
            'sh',
            ['-c', 'cat', '-', '|', path.normalize(path.join(__dirname, '../sops')), '-d', '--input-type', 'yaml', '--output-type', 'json', '/dev/stdin'],
            {
                shell: true,
                stdio: 'pipe',
            },
        );
        expect(mockProc.stdin.end).toBeCalledWith('a: 1234');
    });
});

describe('onDelete', () => {
    test('simple', async () => {
        expect(
            await onEvent({
                RequestType: 'Delete',
                PhysicalResourceId: 'abc123',
            }),
        ).toEqual({
            Data: {},
            PhysicalResourceId: 'abc123',
        });

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });
});

describe('unknown event type', () => {
    test('simple', async () => {
        await expect(
            onEvent({
                RequestType: 'BadEventType',
                PhysicalResourceId: 'abc123',
            }),
        ).rejects.toThrow('Failed');

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });
});

describe('invalid event shape', () => {
    test('simple', async () => {
        await expect(
            onEvent({
                foo: 'bar',
            }),
        ).rejects.toThrow('Failed');

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });

    test('delete missing physicalresourceid', async () => {
        await expect(
            onEvent({
                RequestType: 'Delete',
                // No physicalresourceid
            }),
        ).rejects.toThrow('Failed');

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });

    test('update missing physicalresourceid', async () => {
        await expect(
            onEvent({
                RequestType: 'Update',
                // No physicalresourceid
            }),
        ).rejects.toThrow('Failed');

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });
});

describe('invalid event attribute value shapes', () => {
    const updateDefault = {
        PhysicalResourceId: 'secretdata_mysecretarn_for_update',
        RequestType: 'Update',
        ResourceProperties: {
            KMSKeyArn: undefined,
            S3Bucket: 'mys3bucket',
            S3Path: 'mys3path.yaml',
            Mappings: JSON.stringify({
                key: {
                    path: ['a'],
                },
            }),
            SingleValueMapping: JSON.stringify(null),
            WholeFile: false,
            SecretArn: 'mysecretarn',
            SourceHash: '123',
            FileType: undefined,
        },
    };

    test('update mappings path not array of strings', async () => {
        await expect(
            onEvent({
                ...updateDefault,
                ResourceProperties: {
                    ...updateDefault.ResourceProperties,
                    Mappings: JSON.stringify({
                        key: {
                            // Not an array of strings
                            path: [true, ['foo']],
                        },
                    }),
                },
            }),
        ).rejects.toThrow('Failed');

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });

    test('update mappings path not array at all', async () => {
        await expect(
            onEvent({
                ...updateDefault,
                ResourceProperties: {
                    ...updateDefault.ResourceProperties,
                    Mappings: JSON.stringify({
                        key: {
                            // Not an array at all
                            path: -1,
                        },
                    }),
                },
            }),
        ).rejects.toThrow('Failed');

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });

    test('update mappings path not set', async () => {
        await expect(
            onEvent({
                ...updateDefault,
                ResourceProperties: {
                    ...updateDefault.ResourceProperties,
                    Mappings: JSON.stringify({
                        key: {
                            // No path at all
                        },
                    }),
                },
            }),
        ).rejects.toThrow('Failed');

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });

    test('update mappings encoding not a string', async () => {
        await expect(
            onEvent({
                ...updateDefault,
                ResourceProperties: {
                    ...updateDefault.ResourceProperties,
                    Mappings: JSON.stringify({
                        key: {
                            path: ['a'],
                            // Not a string
                            encoding: -1,
                        },
                    }),
                },
            }),
        ).rejects.toThrow('Failed');

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });

    test('update mappings not an object', async () => {
        await expect(
            onEvent({
                ...updateDefault,
                ResourceProperties: {
                    ...updateDefault.ResourceProperties,
                    // Not an object
                    Mappings: JSON.stringify('foo'),
                },
            }),
        ).rejects.toThrow('Failed');

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });

    test('update mappings is null', async () => {
        await expect(
            onEvent({
                ...updateDefault,
                ResourceProperties: {
                    ...updateDefault.ResourceProperties,
                    // Not an object
                    Mappings: JSON.stringify(null),
                },
            }),
        ).rejects.toThrow('Failed');

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });

    test('update mappings encoding not a valid encoding name', async () => {
        await expect(
            onEvent({
                ...updateDefault,
                ResourceProperties: {
                    ...updateDefault.ResourceProperties,
                    Mappings: JSON.stringify({
                        key: {
                            path: ['a'],
                            // Not a valid encoding name
                            encoding: 'this is not a valid encoding name',
                        },
                    }),
                },
            }),
        ).rejects.toThrow('Failed');

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });

    test('update resourceproperties not array at all', async () => {
        const event: Record<string, unknown> = {
            ...updateDefault,
        };
        delete event['ResourceProperties'];
        await expect(onEvent(event)).rejects.toThrow('Failed');

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });
});
