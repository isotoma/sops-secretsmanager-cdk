#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { SopsExampleStack } from '../lib/sops-example-stack';

const app = new cdk.App();
new SopsExampleStack(app, 'SopsExampleStack');
