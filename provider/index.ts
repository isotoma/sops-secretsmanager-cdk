import * as aws from 'aws-sdk';
import * as path from 'path';
import * as childProcess from 'child_process';
import { Writable } from 'stream';
import { TextDecoder } from 'util';

type MappingEncoding = 'string' | 'json';

interface Mapping {
    path: Array<string>;
    encoding?: MappingEncoding;
}

interface Mappings {
    [name: string]: Mapping;
}

type MappedValues = {
    [name: string]: string;
};

interface SopsWholeFileData {
    data: string;
}

interface ResourceProperties {
    KMSKeyArn: string | undefined;
    S3Bucket: string;
    S3Path: string;
    Mappings: string; // json encoded Mappings;
    WholeFile: boolean | string;
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
    Data: Record<string, unknown>;
}

type Event = CreateEvent | UpdateEvent | DeleteEvent;

const normaliseBoolean = (value: boolean | string): boolean => {
    if (typeof value === 'boolean') {
        return value;
    }
    return value === 'true';
};

const determineFileType = (s3Path: string, fileType: string | undefined, wholeFile: boolean): string => {
    if (fileType) {
        return fileType;
    }

    if (wholeFile) {
        return 'json';
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

const sopsDecode = async (fileContent: string, dataType: string, kmsKeyArn: string | undefined): Promise<unknown> => {
    const sopsArgs = ['-d', '--input-type', dataType, '--output-type', 'json', ...(kmsKeyArn ? ['--kms', kmsKeyArn] : []), '/dev/stdin'];
    let result: string;
    try {
        result = await execPromise([path.join(__dirname, 'sops'), ...sopsArgs], fileContent);
    } catch {
        result = '{}';
    }
    const parsed = JSON.parse(result);
    return Promise.resolve(parsed);
};

interface JsonData {
    [key: string]: unknown;
}

const resolveMappingPath = (data: JsonData, path: Array<string>, encoding: MappingEncoding): string | undefined => {
    if (typeof data !== 'object') {
        return undefined;
    }

    if (path.length > 1) {
        const [head, ...rest] = path;
        return resolveMappingPath(data[head] as JsonData, rest, encoding);
    }

    const value = data[path[0]];

    if (typeof value === 'undefined') {
        return undefined;
    }

    switch (encoding) {
        case 'string' as MappingEncoding:
            if (typeof value === 'object') {
                return undefined;
            }
            return String(value);
        case 'json' as MappingEncoding:
            return JSON.stringify(value);
    }

    throw new Error(`Unknown encoding ${encoding}`);
};

type KeyAndMapping = [string, Mapping];

const resolveMappings = (data: unknown, mappings: Mappings): MappedValues => {
    const mapped = {} as MappedValues;
    Object.entries(mappings).forEach((keyAndMapping: KeyAndMapping) => {
        const [key, mapping] = keyAndMapping;
        const value = resolveMappingPath(data as JsonData, mapping.path, mapping.encoding || ('string' as MappingEncoding));
        if (typeof value !== 'undefined') {
            mapped[key] = value;
        }
    });
    return mapped;
};

const setSecretString = async (secretString: string, secretArn: string): Promise<void> => {
    const secretsManager = new aws.SecretsManager();
    return secretsManager
        .putSecretValue({
            SecretId: secretArn,
            SecretString: secretString,
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
    const wholeFile = normaliseBoolean(event.ResourceProperties.WholeFile);
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

    const data = await sopsDecode((obj.Body as Buffer).toString('utf-8'), determineFileType(s3Path, fileType, wholeFile), kmsKeyArn);

    if (wholeFile) {
        const wholeFileData = (data as SopsWholeFileData).data || '';
        await setSecretString(wholeFileData, secretArn);
    } else {
        const mappedValues = resolveMappings(data, mappings);
        await setSecretString(JSON.stringify(mappedValues), secretArn);
    }

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
    try {
        const eventType = event.RequestType as string;
        switch (eventType) {
            case 'Create':
                return handleCreate(event as CreateEvent);
            case 'Update':
                return handleUpdate(event as UpdateEvent);
            case 'Delete':
                return handleDelete(event as DeleteEvent);
        }
        return Promise.reject(`Unknown event type ${eventType}`);
    } catch (err) {
        console.error(err);
        return Promise.reject('Failed');
    }
};
