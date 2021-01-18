# sops-secretsmanager-cdk
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
- `mappings` and `wholeFile` - must set `mappings` or set `wholeFile` to `true`
    - if `mappings`, must be a `SopsSecretsManagerMappings`
        - which determines how the values from the sops file are mapped to keys in the secret (see below)
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

## Implementation

Using the CDK's custom resource mini-framework, the sops secrets file
is uploaded to S3 as an asset _as is_, still encoded. The custom
resource Lambda then decodes the secrets (in memory, never on disk)
and puts them into the SecretsManager secret.

## Releasing a new version

- (Almost certainly) be on latest master, with no unpublished changes
- Run `npm version (patch|minor|major)` as appropriate
- Run `git push` and `git push origin TAG` where `TAG` is the tag that `npm version` just created

The tag triggers a Github Actions job to publish to npm.
