import { S3 } from '@aws-sdk/client-s3';
import { SecretsManager } from '@aws-sdk/client-secrets-manager';
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
    // istanbul ignore next
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

enum MappingEncoding {
    String = 'string',
    Json = 'json',
}

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
    SingleValueMapping: string; // json encoded Mapping;
    WholeFile: boolean | string;
    SecretArn: string;
    SourceHash: string;
    FileType: string | undefined;
}

enum RequestType {
    Create = 'Create',
    Update = 'Update',
    Delete = 'Delete',
}

interface CreateOrUpdateEvent {
    ResourceProperties: ResourceProperties;
    RequestType: RequestType.Create | RequestType.Update;
}

interface CreateEvent extends CreateOrUpdateEvent {
    RequestType: RequestType.Create;
}

interface UpdateEvent extends CreateOrUpdateEvent {
    PhysicalResourceId: string;
    RequestType: RequestType.Update;
}

interface DeleteEvent {
    PhysicalResourceId: string;
    RequestType: RequestType.Delete;
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

    const parts = s3Path.split('.');
    const lastPart = parts.pop();
    if (typeof lastPart === 'undefined') {
        throw new Error(`String '${s3Path}' split to have zero elements. This should not happen.`);
    }
    return lastPart;
};

const isMapping = (obj: unknown): obj is Mapping => {
    if (!hasKey('path', obj)) {
        return false;
    }
    if (!isArrayOfStrings(obj.path)) {
        return false;
    }

    // Is optional
    if (!hasKey('encoding', obj)) {
        return true;
    }

    const encoding = obj.encoding;
    if (!isString(encoding)) {
        return false;
    }
    try {
        toMappingEncodingOrError(encoding);
    } catch {
        return false;
    }
    return true;
};

const isMappings = (obj: unknown): obj is Mappings => {
    if (typeof obj !== 'object') {
        return false;
    }
    if (!obj) {
        return false;
    }
    for (const value of Object.values(obj)) {
        if (!isMapping(value)) {
            return false;
        }
    }

    return true;
};

const toMappingsOrError = (obj: unknown, errorMessage: string): Mappings => {
    if (isMappings(obj)) {
        return obj;
    }
    throw new Error(errorMessage);
};

const toMappingOrNullOrError = (obj: unknown, errorMessage: string): Mapping | null => {
    if (obj === null) {
        return null;
    }
    if (isMapping(obj)) {
        return obj;
    }
    throw new Error(errorMessage);
};

const toMappingEncodingOrError = (mappingEncodingAsString: string | undefined): MappingEncoding | undefined => {
    if (typeof mappingEncodingAsString === 'undefined') {
        return undefined;
    }
    switch (mappingEncodingAsString) {
        case 'string':
            return MappingEncoding.String;
        case 'json':
            return MappingEncoding.Json;
    }
    throw new Error(`Unknown mapping encoding: ${mappingEncodingAsString}`);
};

const bytesToString = (byteArray: Uint8Array): string => {
    return new TextDecoder().decode(byteArray);
};

const execPromise = async (args: Array<string>, input: string): Promise<string> => {
    return new Promise((res: (result: string) => void, rej: (error: Error) => void): void => {
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
                log(`Exec exited with code ${code}`, {
                    stdout,
                    stderr,
                });
                rej(new Error(`Exec exited with code ${code}`));
            } else {
                if (stderr) {
                    log(`Exec exited cleanly, but stderr was not empty`, {
                        stderr,
                    });
                } else {
                    log('Exec exited cleanly');
                }
                res(stdout);
            }
        });
    });
};

const sopsDecode = async (fileContent: string, dataType: string, kmsKeyArn: string | undefined): Promise<unknown> => {
    log('Running sops command');
    const sopsArgs = ['-d', '--input-type', dataType, '--output-type', 'json', ...(kmsKeyArn ? ['--kms', kmsKeyArn] : []), '/dev/stdin'];
    log('Sops command args', { sopsArgs });
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

const isJsonData = (obj: unknown): obj is JsonData => {
    return typeof obj === 'object';
};

const getJsonDataOrError = (obj: unknown, errorMessage: string): JsonData => {
    if (isJsonData(obj)) {
        return obj;
    }
    throw new Error(errorMessage);
};

const resolveMappingPath = (data: JsonData, path: Array<string>, encoding: MappingEncoding): string | undefined => {
    if (typeof data !== 'object') {
        return undefined;
    }

    if (path.length > 1) {
        const [head, ...rest] = path;
        return resolveMappingPath(getJsonDataOrError(data[head], `Invalid json data when resolving mapping at: ${head}`), rest, encoding);
    }

    const value = data[path[0]];

    if (typeof value === 'undefined') {
        return undefined;
    }

    switch (encoding) {
        case MappingEncoding.String:
            if (typeof value === 'object') {
                return undefined;
            }
            return String(value);
        case MappingEncoding.Json:
            return JSON.stringify(value);
    }

    throw new Error(`Unknown encoding ${encoding}`);
};

type KeyAndMapping = [string, Mapping];

const resolveMappings = (data: unknown, mappings: Mappings): MappedValues => {
    const mapped: MappedValues = {};
    Object.entries(mappings).forEach((keyAndMapping: KeyAndMapping) => {
        const [key, mapping] = keyAndMapping;
        const value = resolveMappingPath(getJsonDataOrError(data, 'Invalid json data'), mapping.path, toMappingEncodingOrError(mapping.encoding) || MappingEncoding.String);
        if (typeof value !== 'undefined') {
            mapped[key] = value;
        }
    });
    return mapped;
};

const setSecretString = async (secretString: string, secretArn: string): Promise<void> => {
    const secretsManager = new SecretsManager({});
    await secretsManager.putSecretValue({
        SecretId: secretArn,
        SecretString: secretString,
    });
};

const handleCreate = async (event: CreateOrUpdateEvent): Promise<Response> => {
    const kmsKeyArn = event.ResourceProperties.KMSKeyArn;
    const s3BucketName = event.ResourceProperties.S3Bucket;
    const s3Path = event.ResourceProperties.S3Path;
    const mappings = toMappingsOrError(JSON.parse(event.ResourceProperties.Mappings), 'Unable to parse mappings to a valid shape');
    const singleValueMapping = toMappingOrNullOrError(JSON.parse(event.ResourceProperties.SingleValueMapping), 'Unable to parse singleValueMapping to a valid shape');
    const wholeFile = normaliseBoolean(event.ResourceProperties.WholeFile);
    const secretArn = event.ResourceProperties.SecretArn;
    // const sourceHash = event.ResourceProperties.SourceHash;
    const fileType = event.ResourceProperties.FileType;

    const s3 = new S3({});

    const getObjectParams = {
        Bucket: s3BucketName,
        Key: s3Path,
    };
    log('Getting object from S3', { params: getObjectParams });
    const obj = await s3.getObject(getObjectParams);
    const body = obj.Body;

    console.error(obj);

    if (typeof body === 'undefined') {
        throw new Error('Body of object from s3 is empty');
    }

    log('Reading file');
    const fileBody = await body.transformToString('utf-8');
    log('Determining file type', { s3Path, fileType, wholeFile });
    const fileTypeToUse = determineFileType(s3Path, fileType, wholeFile);
    log('Decoding with sops', {
        fileTypeToUse,
        kmsKeyArn,
    });
    const data = await sopsDecode(fileBody, fileTypeToUse, kmsKeyArn);
    log('Successfully decoded secret data with sops');

    if (wholeFile) {
        log('Writing decoded data to secretsmanager as whole file', { secretArn });
        const wholeFileData = (data as SopsWholeFileData).data || '';
        await setSecretString(wholeFileData, secretArn);
    } else if (singleValueMapping) {
        log('Mapping values from decoded data', { singleValueMapping });
        const mappedValue = resolveMappings(data, { '': singleValueMapping })[''];
        await setSecretString(mappedValue, secretArn);
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
    const response = await handleCreate(event);
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

const hasKey = <K extends string>(key: K, obj: unknown): obj is { [_ in K]: Record<string, unknown> } => {
    return typeof obj === 'object' && !!obj && key in obj;
};

const getTypedKeyOrError = <A>(key: string, obj: unknown, errorMessageRoot: string, typeName: string, typeCheck: (value: unknown) => value is A): A => {
    if (!hasKey(key, obj)) {
        throw new Error(`${errorMessageRoot}: no ${key} set`);
    }
    const value = obj[key];
    if (!typeCheck(value)) {
        throw new Error(`${errorMessageRoot}: ${key} is not a ${typeName}`);
    }
    return value;
};

const getTypedKeyOrUndefined = <A>(key: string, obj: unknown, errorMessageRoot: string, typeName: string, typeCheck: (value: unknown) => value is A): A | undefined => {
    if (!hasKey(key, obj)) {
        return undefined;
    }
    const value = obj[key];
    if (!typeCheck(value)) {
        return undefined;
    }
    return value;
};

const getUntypedKeyOrError = (key: string, obj: unknown, errorMessageRoot: string): unknown => {
    if (!hasKey(key, obj)) {
        throw new Error(`${errorMessageRoot}: no ${key} set`);
    }
    return obj[key];
};

const isString = (a: unknown): a is string => {
    return typeof a === 'string';
};

const isStringOrBoolean = (a: unknown): a is string | boolean => {
    return typeof a === 'string' || typeof a === 'boolean';
};

const isArrayOfStrings = (obj: unknown): obj is Array<string> => {
    if (!Array.isArray(obj)) {
        return false;
    }
    for (const item of obj) {
        if (!isString(item)) {
            return false;
        }
    }
    return true;
};

const getStringKeyOrError = (key: string, obj: unknown, errorMessageRoot: string): string => {
    return getTypedKeyOrError<string>(key, obj, errorMessageRoot, 'string', isString);
};

const getStringOrBooleanKeyOrError = (key: string, obj: unknown, errorMessageRoot: string): string | boolean => {
    return getTypedKeyOrError<string | boolean>(key, obj, errorMessageRoot, '(string | boolean)', isStringOrBoolean);
};

const getStringKeyOrUndefined = (key: string, obj: unknown, errorMessageRoot: string): string | undefined => {
    return getTypedKeyOrUndefined<string>(key, obj, errorMessageRoot, 'string', isString);
};

const decodeResourceProperties = (resourceProperties: unknown): ResourceProperties => {
    return {
        KMSKeyArn: getStringKeyOrUndefined('KMSKeyArn', resourceProperties, 'Invalid resourceProperties'),
        S3Bucket: getStringKeyOrError('S3Bucket', resourceProperties, 'Invalid resourceProperties'),
        S3Path: getStringKeyOrError('S3Path', resourceProperties, 'Invalid resourceProperties'),
        Mappings: getStringKeyOrError('Mappings', resourceProperties, 'Invalid resourceProperties'),
        SingleValueMapping: getStringKeyOrError('SingleValueMapping', resourceProperties, 'Invalid resourceProperties'),
        WholeFile: getStringOrBooleanKeyOrError('WholeFile', resourceProperties, 'Invalid resourceProperties'),
        SecretArn: getStringKeyOrError('SecretArn', resourceProperties, 'Invalid resourceProperties'),
        SourceHash: getStringKeyOrError('SourceHash', resourceProperties, 'Invalid resourceProperties'),
        FileType: getStringKeyOrUndefined('FileType', resourceProperties, 'Invalid resourceProperties'),
    };
};

const decodeEvent = (event: unknown): Event => {
    const requestType = getStringKeyOrError('RequestType', event, 'Invalid event');
    switch (requestType) {
        case 'Create':
            return {
                RequestType: RequestType.Create,
                ResourceProperties: decodeResourceProperties(getUntypedKeyOrError('ResourceProperties', event, 'Invalid create event')),
            };
        case 'Update':
            return {
                RequestType: RequestType.Update,
                PhysicalResourceId: getStringKeyOrError('PhysicalResourceId', event, 'Invalid update event'),
                ResourceProperties: decodeResourceProperties(getUntypedKeyOrError('ResourceProperties', event, 'Invalid update event')),
            };
        case 'Delete':
            return {
                PhysicalResourceId: getStringKeyOrError('PhysicalResourceId', event, 'Invalid delete event'),
                RequestType: RequestType.Delete,
            };
    }
    throw new Error(`Unknown event type: ${requestType}`);
};

const handleEvent = async (inputEvent: unknown): Promise<Response> => {
    log('Handling event', { event: inputEvent });
    const event = decodeEvent(inputEvent);
    switch (event.RequestType) {
        case RequestType.Create:
            return handleCreate(event);
        case RequestType.Update:
            return handleUpdate(event);
        case RequestType.Delete:
            return handleDelete(event);
    }
    // istanbul ignore next
    throw new Error('Unknown event type. This should be unreachable.');
};

export const onEvent = (inputEvent: unknown): Promise<Response> => {
    return handleEvent(inputEvent).catch(err => {
        logError(err, 'Unhandled error, failing');
        return Promise.reject(new Error('Failed'));
    });
};
