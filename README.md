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
The job stages the release rather than publishing it (see below).

### Approving the release

Pushing the tag does not put anything in front of consumers. The workflow uses
[staged publishing](https://docs.npmjs.com/staged-publishing/): the version lands
in the registry but is not installable until a maintainer approves it with 2FA.

After the tag job goes green, approve it in the Staged Packages tab on npmjs.com,
or from the CLI:

```bash
npm stage list
npm stage approve <stage-id>
```

`npm stage reject` discards it instead. A staged version occupies its version
number, so to stage the same version again, reject the existing stage first.

### Authentication

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
over OIDC, so there is no `NPM_TOKEN` secret. The job requests `id-token: write`
and the npm CLI exchanges that for a short-lived token, which also generates
provenance attestations automatically.

The trust relationship is configured on npmjs.com under the package's settings,
naming the organisation, the repository, and the workflow filename
(`publish.yaml`). Existing configurations cannot be edited, only deleted and
recreated.

Staged publishing needs npm 11.15.0 or later, above what Node 24 bundles, so the
workflow installs npm explicitly and asserts the version. Below that floor the
CLI falls back to token authentication and fails with a misleading `E404`.

OIDC covers `npm publish` and `npm stage publish` only. The approve, reject, list
and view subcommands need interactive authentication and cannot use it.
