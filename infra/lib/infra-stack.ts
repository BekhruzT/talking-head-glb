import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { TalkingHead } from './talking-head';

export class InfraStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        cdk.Tags.of(new TalkingHead(this, 'talking-head-glb')).add("Project", "Talking Heads GLB");
    }
}
