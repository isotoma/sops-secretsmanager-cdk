import * as aws from 'aws-sdk';
import * as path from 'path';
import * as childProcess from 'child_process';
import { onEvent } from '../';

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

beforeEach(() => {
    mockS3GetObject.mockReset();
    mockSecretsManagerPutSecretValue.mockReset();

    mockS3GetObject.mockImplementation(() => ({
        promise: (): Promise<any> => Promise.resolve({}),
    }));
    mockSecretsManagerPutSecretValue.mockImplementation(() => ({
        promise: (): Promise<any> => Promise.resolve({}),
    }));
});

describe('onCreate', () => {
    test('simple', async () => {
        mockS3GetObject.mockImplementation(() => ({
            promise: (): Promise<any> => Promise.resolve({
                Body: Buffer.from('a: 1234'),
            }),
        }));
        console.log(typeof childProcess.execFile);
        (childProcess.execFile as any).mockImplementation((file: string, args: object, callback: any) => {
            callback(null, '{"a": "abc"}');
        });
        mockSecretsManagerPutSecretValue.mockImplementation(() => ({
            promise: (): Promise<any> => Promise.resolve({}),
        }));
        
        expect(await onEvent({
            RequestType: 'Create',
            ResourceProperties: {
                KMSKeyArn: undefined,
                S3Bucket: 'mys3bucket',
                S3Path: 'mys3path.yaml',
                Mappings: '{"key": {"path": ["a"]}}',
                SecretArn: 'mysecretarn',
                SourceHash: '123',
                FileType: undefined,
            }
        })).toEqual({
            Data: {},
            PhysicalResourceId: 'secretdata_mysecretarn',
        });

        const putSecretValueCalls = mockSecretsManagerPutSecretValue.mock.calls;
        expect(putSecretValueCalls.length).toEqual(1);
        const putSecretArgs = putSecretValueCalls[0][0];
        expect(putSecretArgs).toEqual({
            SecretId: 'mysecretarn',
            SecretString: expect.any(String),
        });
        expect(JSON.parse(putSecretArgs.SecretString)).toEqual({
            key: 'abc',
        });

        expect(mockS3GetObject).toBeCalledWith({
            Bucket: 'mys3bucket',
            Key: 'mys3path.yaml',
        });

        expect(childProcess.execFile as any).toBeCalledWith(
            path.normalize(path.join(__dirname, '../sops')),
            [
                '-d',
                '--input-type', 'yaml',
                '--output-type', 'json',
                '/dev/stdin',
            ],
            expect.any(Function));
    });
});

describe('onDelete', () => {
    test('simple', async () => {
        expect(await onEvent({
            RequestType: 'Delete',
            PhysicalResourceId: 'abc123',
        })).toEqual({
            Data: {},
            PhysicalResourceId: 'abc123',
        });

        expect(mockS3GetObject).not.toHaveBeenCalled();
        expect(mockSecretsManagerPutSecretValue).not.toHaveBeenCalled();
    });
});
