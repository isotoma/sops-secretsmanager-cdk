#!/bin/bash -e

STACK_NAME=SopsExampleStack

error() {
    >&2 echo "Error: $1"
    exit 1
}

setup() {
    # Find a key that is customer managed
    keyIds="$(aws kms list-keys | jq -r '.Keys[].KeyId')"
    keyArn=
    while IFS= read -r keyId; do
        keyDesc="$(aws kms describe-key --key-id "$keyId")"
        keyManager="$(echo "$keyDesc" | jq -r .KeyMetadata.KeyManager)"
        keyArn="$(echo "$keyDesc" | jq -r .KeyMetadata.Arn)"
        if [[ $keyManager == "CUSTOMER" ]]; then
            break
        fi
    done <<< "$keyIds"

    if [[ -z $keyArn ]]; then
        error "No KMS keys found"
    fi

    rm -rf ./sops-example/lib/sops-secretsmanager-cdk-dev/
    cp -R ../build ./sops-example/lib/sops-secretsmanager-cdk-dev/

    export SOPS_KMS_ARN="$keyArn"
    export AWS_SDK_LOAD_CONFIG=true
    ../build/provider/sops -e ./sample.yaml > ./sample_secret.yaml

    (cd sops-example && {
         npm ci
         npx tsc
     })
}

deploy() {
    (cd sops-example && {
         npx tsc
         npx cdk deploy --require-approval never --exclusively "$STACK_NAME"
     })
}

diff() {
    (cd sops-example && {
         npx tsc
         npx cdk diff "$STACK_NAME"
     })
}

destroy() {
    (cd sops-example && {
         npx tsc
         npx cdk destroy --force --exclusively "$STACK_NAME"
     })
}

verify() {
    secretArn="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" | jq -r '.Stacks[0].Outputs[0].OutputValue')"
    secretValue="$(aws secretsmanager get-secret-value --secret-id "$secretArn")"
    secretString="$(echo "$secretValue" | jq -r .SecretString | jq .)"
    echo "Secret string data:"
    echo "$secretString"

    expected=$(cat <<EOF
{
  "key1": "value1",
  "key2": "value2"
}
EOF
)
    echo "Expected:"
    echo "$expected"

    if [[ "$secretString" == "$expected" ]]; then
       echo "OK"
    else
        error "Do not match"
    fi
}

full_test() {
    setup
    destroy
    deploy
    verify
}

main() {
    if [[ "$1" == "setup" ]]; then
        setup
    elif [[ "$1" == "diff" ]]; then
        diff
    elif [[ "$1" == "deploy" ]]; then
        deploy
    elif [[ "$1" == "destroy" ]]; then
        destroy
    elif [[ "$1" == "verify" ]]; then
        verify
    elif [[ "$1" == "full-test" ]]; then
        full_test
    else
        error "Unknown command $1"
    fi
}

main $@
