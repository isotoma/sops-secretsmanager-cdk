import * as aws from 'aws-sdk';
import * as path from 'path';
import * as childProcess from 'child_process';
import { Writable } from 'stream';
import { TextDecoder } from 'util';

const log = (message: string, extra: Record<string, unknown> = {}): void => {
    console.log(
        JSON.stringify({
            message,
            ...extra,
        }),
    );
};

const logError = (error: Error, message: string, extra: Record<string, unknown> = {}): void => {
    const stack = error.stack;
    const stackLines = stack ? stack.split(/\n/) : [];
    console.error(
        JSON.stringify({
            error: {
                name: error.name,
                message: error.message,
                stack: stackLines,
            },
            message,
            ...extra,
        }),
    );
};

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
    if (typeof value === 'string') {
        if (value === 'true') {
            return true;
        }
        if (value === 'false') {
            return false;
        }
        throw new Error(`Unexpected string value when normalising boolean: ${value}`);
    }
    throw new Error(`Unexpected type ${typeof value}, ${value} when normalising boolean`);
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
    const result = await execPromise([path.join(__dirname, 'sops'), ...sopsArgs], fileContent);
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

    const getObjectParams = {
        Bucket: s3BucketName,
        Key: s3Path,
    };
    log('Getting object from S3', { params: getObjectParams });
    const obj = await s3.getObject(getObjectParams).promise();

    log('Reading file');
    const fileBody = (obj.Body as Buffer).toString('utf-8');
    log('Determining file type', { s3Path, fileType, wholeFile });
    const fileTypeToUse = determineFileType(s3Path, fileType, wholeFile);
    log('Decoding with sops', {
        fileBody,
        fileTypeToUse,
        kmsKeyArn,
    });
    const data = await sopsDecode(fileBody, fileTypeToUse, kmsKeyArn);
    log('Successfully decoded secret data with sops');

    if (wholeFile) {
        log('Writing decoded data to secretsmanager as whole file', { secretArn });
        const wholeFileData = (data as SopsWholeFileData).data || '';
        await setSecretString(wholeFileData, secretArn);
    } else {
        log('Mapping values from decoded data', { mappings });
        const mappedValues = resolveMappings(data, mappings);
        log('Writing decoded data to secretsmanager as JSON file', { secretArn });
        await setSecretString(JSON.stringify(mappedValues), secretArn);
    }
    log('Wrote data to secretsmanager');

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
    log('Handling event', { event });
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
        throw new Error(`Unknown event type ${eventType}`);
    } catch (err) {
        logError(err, 'Unhandled error, failing');
        return Promise.reject(new Error('Failed'));
    }
};
