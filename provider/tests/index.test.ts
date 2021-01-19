import * as path from 'path';
import * as childProcess from 'child_process';
import * as events from 'events';
import { onEvent } from '../';
import { TextEncoder } from 'util';
import { Writable } from 'stream';

const mockS3GetObject = jest.fn();
const mockSecretsManagerPutSecretValue = jest.fn();

jest.mock('aws-sdk', () => ({
    S3: jest.fn(() => ({
        getObject: mockS3GetObject,
    })),
    SecretsManager: jest.fn(() => ({
        putSecretValue: mockSecretsManagerPutSecretValue,
    })),
}));
jest.mock('child_process');

interface MockS3GetObjectResponse {
    Body: Buffer;
}

beforeEach(() => {
    mockS3GetObject.mockReset();
    mockSecretsManagerPutSecretValue.mockReset();

    mockS3GetObject.mockImplementation(() => ({
        promise: (): Promise<MockS3GetObjectResponse> =>
            Promise.resolve({
                Body: Buffer.from(''),
            }),
    }));
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
        mockS3GetObject.mockImplementation(() => ({
            promise: (): Promise<MockS3GetObjectResponse> =>
                Promise.resolve({
                    Body: Buffer.from('a: 1234'),
                }),
        }));
        const mockProc = setMockSpawn({ stdoutData: JSON.stringify({ a: 'abc' }) });
        mockSecretsManagerPutSecretValue.mockImplementation(() => ({
            promise: (): Promise<Record<string, unknown>> => Promise.resolve({}),
        }));

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
        mockS3GetObject.mockImplementation(() => ({
            promise: (): Promise<MockS3GetObjectResponse> =>
                Promise.resolve({
                    Body: Buffer.from('{"a": 1234}'),
                }),
        }));
        const mockProc = setMockSpawn({ stdoutData: JSON.stringify({ a: 'abc' }) });
        mockSecretsManagerPutSecretValue.mockImplementation(() => ({
            promise: (): Promise<Record<string, unknown>> => Promise.resolve({}),
        }));

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
        mockS3GetObject.mockImplementation(() => ({
            promise: (): Promise<MockS3GetObjectResponse> =>
                Promise.resolve({
                    Body: Buffer.from('a: 1234'),
                }),
        }));
        const mockProc = setMockSpawn({ stdoutData: '', stderrData: 'Error running sops', code: 99 });
        mockSecretsManagerPutSecretValue.mockImplementation(() => ({
            promise: (): Promise<Record<string, unknown>> => Promise.resolve({}),
        }));

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
});

describe('onUpdate', () => {
    test('simple', async () => {
        mockS3GetObject.mockImplementation(() => ({
            promise: (): Promise<MockS3GetObjectResponse> =>
                Promise.resolve({
                    Body: Buffer.from('a: 1234'),
                }),
        }));
        const mockProc = setMockSpawn({ stdoutData: JSON.stringify({ a: 'abc' }) });
        mockSecretsManagerPutSecretValue.mockImplementation(() => ({
            promise: (): Promise<Record<string, unknown>> => Promise.resolve({}),
        }));

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
