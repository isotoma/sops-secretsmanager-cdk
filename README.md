# sops-secretsmanager-cdk
Safely load secrets from sops into secretsmanager using the CDK

## Usage

```typescript
import { SopsSecretsManager } from 'sops-secretsmanager-cdk';
...
new SopsSecretsManager(this, 'StoreSecrets', {
    path: './path/to/secretsfile.yaml',
    kmsKey: myKey,  // or use kms.Key.fromKeyArn
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
```

## Implementation

Using the CDK's custom resource mini-framework, the sops secrets file
is uploaded to S3 as an asset _as is_, still encoded. The custom
resource Lambda then decodes the secrets (in memory, never on disk)
and puts them into the SecretsManager secret.
