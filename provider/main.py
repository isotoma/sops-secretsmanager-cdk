import boto3
import os
import subprocess
import json
import logging

def sops_decode(data, data_format, kms_key=None):
    dir_path = os.path.dirname(os.path.realpath(__file__))
    sops_binary = os.path.join(dir_path, 'sops')
    command = [sops_binary, '-d', '--input-type', data_format, '--output-type', 'json']
    if kms_key:
        command.extend(['--kms', kms_key, ])
    command.append('/dev/stdin')
    output = subprocess.run(command, input=data, capture_output=True)
    return json.loads(output.stdout)

def on_event(event, context):
    request_type = event['RequestType']
    if request_type == 'Create': return on_create(event)
    if request_type == 'Update': return on_update(event)
    if request_type == 'Delete': return on_delete(event)
    raise Exception('Invalid request type: %s', request_type)

def resolve_mapping_path(secrets, mapping_path):
    value = secrets
    for step in mapping_path:
        value = value[step]
    return value

def resolve_mapping_encoding(value, encoding):
    encoding = encoding or 'string'

    if encoding == 'string':
        return str(value)
    if encoding == 'json':
        return json.dumps(value)

    raise Exception('Unknown encoding {}'.format(encoding))

def resolve_mapping(secrets, mapping):
    try:
        value = resolve_mapping_path(secrets, mapping['path'])
    except:
        logging.warning('Failed to resolve path')
        return None

    try:
        value = resolve_mapping_encoding(value, mapping.get('encoding'))
    except:
        logging.warning('Failed to resolve encoding')
        return None

    return value

def get_mapped_values(secrets, mappings):
    for name, mapping in mappings.items():
        yield name, resolve_mapping(secrets, mapping)
    

def on_create(event):
    logging.info('On create')

    kmsKey = event['ResourceProperties'].get('KMSKeyArn', None)
    s3Bucket = event['ResourceProperties']['S3Bucket']
    s3Path = event['ResourceProperties']['S3Path']
    mappings = json.loads(event['ResourceProperties']['Mappings'])
    secretArn = event['ResourceProperties']['SecretArn']
    sourceHash = event['ResourceProperties']['SourceHash']
    fileType = event['ResourceProperties'].get('FileType')

    try:
        s3 = boto3.client('s3')
        obj = s3.get_object(
            Bucket=s3Bucket,
            Key=s3Path)

        raw_content = obj['Body'].read()
        data_type = fileType
        if not data_type:
            data_type = s3Path.rsplit('.', 1)[-1]
        secrets = sops_decode(raw_content, data_type, kmsKey)

        secret_string_json = {name: value for name, value in get_mapped_values(secrets, mappings)}
        secretsManager = boto3.client('secretsmanager')

        secretsManager.put_secret_value(
            SecretId=secretArn,
            SecretString=json.dumps(secret_string_json))

    except Exception as err:
        import traceback
        traceback.print_exc()

    return {
        'PhysicalResourceId': 'secretdata_{}'.format(secretArn),
        'Data': {},
    }

def on_update(event):
    result = on_create(event)
    return {
        'PhysicalResourceId': event['PhysicalResourceId'],
        'Data': result['Data'],
    }

def on_delete(event):
    return {
        'PhysicalResourceId': event['PhysicalResourceId'],
        'Data': {},
    }
