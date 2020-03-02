import * as aws from 'aws-sdk';
import * as path from 'path';
import * as childProcess from 'child_process';
import { Writable } from 'stream';
import { TextDecoder } from 'util';

interface Mapping {
    path: Array<string>;
    encoding: string;
}

interface Mappings {
    [name: string]: Mapping;
}

type MappedValues = {
    [name: string]: string;
};

interface ResourceProperties {
    KMSKeyArn: string | undefined;
    S3Bucket: string;
    S3Path: string;
    Mappings: string; // json encoded Mappings;
    SecretArn: string;
    SourceHash: string;
    FileType: string | undefined;
}

type RequestType = 'Create' | 'Update' | 'Delete';

interface BaseEvent {
    RequestType: RequestType;
}

interface CreateEvent extends BaseEvent {
    ResourceProperties: ResourceProperties;
}

interface UpdateEvent extends CreateEvent {
    PhysicalResourceId: string;
}

interface DeleteEvent extends BaseEvent {
    PhysicalResourceId: string;
}

// interface ResponseData {}

interface Response {
    PhysicalResourceId: string;
    Data: {};
}

type Event = CreateEvent | UpdateEvent | DeleteEvent;

const determineFileType = (s3Path: string, fileType: string | undefined): string => {
    if (fileType) {
        return fileType;
    }

    const parts = s3Path.split('.') as Array<string>;
    return parts.pop() as string;
};

const bytesToString = (byteArray: Uint8Array): string => {
    return new TextDecoder().decode(byteArray);
};

const execPromise = async (args: Array<string>, input: string): Promise<string> => {
    return new Promise((res: (result: string) => void, rej: (error: childProcess.ExecException) => void): void => {
        const proc = childProcess.spawn('sh', ['-c', 'cat', '-', '|', ...args], { stdio: 'pipe', shell: true });
        (proc.stdin as Writable).end(input);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Uint8Array) => {
            stdout += bytesToString(data);
        });

        proc.stderr.on('data', (data: Uint8Array) => {
            stderr += bytesToString(data);
        });

        proc.on('close', (code: number) => {
            if (code > 0) {
                rej({
                    name: `Exited with code ${code}`,
                    message: stderr,
                });
            } else {
                res(stdout);
            }
        });
    });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sopsDecode = async (fileContent: string, dataType: string, kmsKeyArn: string | undefined): Promise<any> => {
    const sopsArgs = ['-d', '--input-type', dataType, '--output-type', 'json', ...(kmsKeyArn ? ['--kms', kmsKeyArn] : []), '/dev/stdin'];
    const result = await execPromise([path.join(__dirname, 'sops'), ...sopsArgs], fileContent);
    const parsed = JSON.parse(result);
    return Promise.resolve(parsed);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const resolveMappingPath = (data: any, path: Array<string>): string | undefined => {
    if (path.length > 1) {
        const [head, ...rest] = path;
        return resolveMappingPath(data[head], rest);
    }
    return data[path[0]];
};

type KeyAndMapping = [string, Mapping];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const resolveMappings = (data: any, mappings: Mappings): MappedValues => {
    const mapped = {} as MappedValues;
    Object.entries(mappings).forEach((keyAndMapping: KeyAndMapping) => {
        const [key, mapping] = keyAndMapping;
        const value = resolveMappingPath(data, mapping.path);
        if (typeof value !== 'undefined') {
            mapped[key] = value;
        }
    });
    return mapped;
};

const setValuesInSecret = async (values: MappedValues, secretArn: string): Promise<void> => {
    const secretsManager = new aws.SecretsManager();
    return secretsManager
        .putSecretValue({
            SecretId: secretArn,
            SecretString: JSON.stringify(values),
        })
        .promise()
        .then(() => {
            // do nothing
        });
};

const handleCreate = async (event: CreateEvent): Promise<Response> => {
    const kmsKeyArn = event.ResourceProperties.KMSKeyArn;
    const s3BucketName = event.ResourceProperties.S3Bucket;
    const s3Path = event.ResourceProperties.S3Path;
    const mappings = JSON.parse(event.ResourceProperties.Mappings) as Mappings;
    const secretArn = event.ResourceProperties.SecretArn;
    // const sourceHash = event.ResourceProperties.SourceHash;
    const fileType = event.ResourceProperties.FileType;

    const s3 = new aws.S3();

    const obj = await s3
        .getObject({
            Bucket: s3BucketName,
            Key: s3Path,
        })
        .promise();

    const data = await sopsDecode((obj.Body as Buffer).toString('utf-8'), determineFileType(s3Path, fileType), kmsKeyArn);
    const mappedValues = resolveMappings(data, mappings);
    await setValuesInSecret(mappedValues, secretArn);

    return Promise.resolve({
        PhysicalResourceId: `secretdata_${secretArn}`,
        Data: {},
    });
};

const handleUpdate = async (event: UpdateEvent): Promise<Response> => {
    const physicalResourceId = event.PhysicalResourceId;
    const response = await handleCreate(event as CreateEvent);
    return Promise.resolve({
        ...response,
        PhysicalResourceId: physicalResourceId,
    });
};

const handleDelete = async (event: DeleteEvent): Promise<Response> => {
    return Promise.resolve({
        PhysicalResourceId: event.PhysicalResourceId,
        Data: {},
    });
};

export const onEvent = (event: Event): Promise<Response> => {
    const eventType = event.RequestType as string;
    switch (eventType) {
        case 'Create':
            return handleCreate(event as CreateEvent);
        case 'Update':
            return handleUpdate(event as UpdateEvent);
        case 'Delete':
            return handleDelete(event as DeleteEvent);
    }

    throw new Error(`Unknown event type ${eventType}`);
};
