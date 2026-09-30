import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { InfraStack } from "../lib/infra-stack";

test("deploys only the Ava speech API and web hosting", () => {
  const template = Template.fromStack(new InfraStack(new cdk.App(), "GlbOnly"));

  template.resourceCountIs("AWS::Lambda::Function", 1);
  template.resourceCountIs("AWS::ApiGateway::Resource", 1);
});
