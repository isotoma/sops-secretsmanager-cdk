# sops-secretsmanager-cdk

[![npm version](https://badge.fury.io/js/sops-secretsmanager-cdk.svg)](https://badge.fury.io/js/sops-secretsmanager-cdk)

Safely load secrets from sops into secretsmanager using the CDK

## Usage

```typescript
import { SopsSecretsManager } from 'sops-secretsmanager-cdk';
...
const ssm = new SopsSecretsManager(this, 'StoreSecrets', {
    path: './path/to/secretsfile.yaml',
    kmsKey: myKey,  // or use kms.Key.fromKeyArn, or omit and use the key in the sops file
    secretName: 'TestSecret',  // or secret: mySecret
    mappings: {
        nameInSecretsManager: {
            path: ['path', 'to', 'value', 'in', 'secretsfile'],
            // optionally pass encoding: 'json' to pass a portion of the secrets file
        },
        anotherThingInSecretsManager: {
            path: ['other', 'path'],
        },
        // etc
    },
});

if(ssm.secret) {
    // secret is a Secret you can tag, for example
}

```

## Properties for `SopsSecretsManager`

- `secret` and `secretName` - must set exactly one of these
    - if `secret`, must be `secretsManager.Secret | secretsManager.ISecret`
        - this secret will be populated with the data from the sops file
    - if `secretName`, must be a `string`
        - a secret with this name will be created
- `asset` and `path` - must set exactly one of these
    - if `asset`, must be a `s3Assets.Asset`
        - this asset should contain the encrypted sops file
    - if `path`, must be a `string`
        - should point to the encrypted sops file on disk
- `kmsKey` - optional
    - must be a `kms.IKey`
    - the sops file contains a reference to the KMS key, so probably not actually needed
- `mappings`, `wholeFile` and `singleValueMapping` - must set `mappings` or `singleValueMapping` or set `wholeFile` to `true`
    - if `mappings`, must be a `SopsSecretsManagerMappings`
        - which determines how the values from the sops file are mapped to keys in the secret (see below)
    - if `singleValueMapping`, must be a `SopsSecretsManagerMapping`
         - which determines how a single value from the sops file is mapped to the text value of the secret
    - if `wholeFile` is true
        - then rather than treating the sops data as structured and mapping keys over, the whole file will be decrypted and stored as the body of the secret
- `fileType` - optional
    - must be `'yaml'` or `'json'` if set
    - tells sops how to decode the file
    - will default getting the extension from the filename
    - unless `wholeFile` is true, then defaults to `'json'`

### Mappings

The `mappings` property, if given, specifies how to make values from
the structured sops data (json or yaml) to keys in secrets manager.

It takes an object, where:

- the keys are strings determining the target name in Secrets Manager
- the values are objects with keys:
    - `path`, required, an array of strings, pointing to a value in the structured sops data
    - `encoding`, optional, `'string'` or `'json'`, control how to alter the value found from sops for storage in Secrets Manager

## Usage

```typescript
import { SopsSecretsManager } from 'sops-secretsmanager-cdk';
```

## Implementation

Using the CDK's custom resource mini-framework, the sops secrets file
is uploaded to S3 as an asset _as is_, still encoded. The custom
resource Lambda then decodes the secrets (in memory, never on disk)
and puts them into the SecretsManager secret.

## KMS Key Policy Requirements

For the Lambda function to successfully decrypt SOPS files, the KMS key used for encryption must have a key policy that allows the Lambda execution role to perform decryption operations. While this CDK construct grants the Lambda broad KMS permissions via IAM policies (`kms:*`), KMS key policies are resource-based policies that can override IAM permissions.

Both the IAM policy (granted by this construct) AND the KMS key policy must allow the Lambda execution role to use the key.

### Approach 1: Delegate All Permissions to IAM (Simplest)

The simplest approach is to configure your KMS key policy to delegate all access control decisions to IAM policies. This allows the IAM permissions granted by this CDK construct to take full effect:

```json
{
  "Sid": "DelegateToIAM",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::ACCOUNT-ID:root"
  },
  "Action": "kms:*",
  "Resource": "*"
}
```

Replace `ACCOUNT-ID` with your AWS account ID. This approach is the least secure as it grants broad KMS permissions to all principals in your account, relying entirely on IAM policies for access control.

### Approach 2: Grant Specific Role Access (More Secure)

A more secure approach is to explicitly grant only the necessary permissions to the specific Lambda execution role:

```json
{
  "Sid": "AllowSopsSecretsManagerLambda",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::ACCOUNT-ID:role/LAMBDA-EXECUTION-ROLE-NAME"
  },
  "Action": [
    "kms:Decrypt",
    "kms:DescribeKey"
  ],
  "Resource": "*"
}
```

Replace `ACCOUNT-ID` with your AWS account ID and `LAMBDA-EXECUTION-ROLE-NAME` with the actual name of the Lambda execution role created by this CDK construct.

#### Finding the Lambda Execution Role ARN

The Lambda execution role is created automatically by this CDK construct. You can find its ARN by:

1. Looking in the AWS IAM console for roles with names containing your stack name and "sops-secrets-manager"
2. Checking the CloudFormation stack outputs or resources
3. Using the AWS CLI: `aws iam list-roles --path-prefix /` and filtering for the relevant role

### Approach 3: Use Conditions for Flexible Access (Most Secure)

The most refined approach uses conditions to allow access while maintaining security constraints:

```json
{
  "Sid": "AllowSopsSecretsManagerLambda",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::ACCOUNT-ID:root"
  },
  "Action": [
    "kms:Decrypt",
    "kms:DescribeKey"
  ],
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "kms:ViaService": "lambda.REGION.amazonaws.com"
    }
  }
}
```

Replace `ACCOUNT-ID` with your AWS account ID and `REGION` with your AWS region. This approach ensures that the key can only be used by Lambda functions in your account and region, providing a good balance between security and flexibility.

## Integration testing

Run the following to deploy a test stack named
`SopsExampleStack`. Note that if a stack with this name exists, it
will be deleted:
```
$ npm run deploy-example
```

This compiles and uses the code from your working directory, finds an
existing customer-managed KMS key, deploys a stack that uses an sample
secret, and verifies that the created secret contains the expected
data.

## Releasing a new version

- (Almost certainly) be on latest main, with no unpublished changes
- Run `npm version (patch|minor|major)` as appropriate
- Run `git push` and `git push origin TAG` where `TAG` is the tag that `npm version` just created

The tag triggers a Github Actions job to publish to npm.
