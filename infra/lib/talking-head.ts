import { Construct } from "constructs";
import { CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Cors, LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { Distribution, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";

export class TalkingHead extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const hostingBucket = new Bucket(this, "AvaWeb", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const distribution = new Distribution(this, "AvaDistribution", {
      defaultBehavior: {
        origin: new S3Origin(hostingBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
      errorResponses: [{
        httpStatus: 404,
        responseHttpStatus: 200,
        responsePagePath: "/index.html",
      }],
    });

    const restApi = new RestApi(this, "AvaApi", {
      defaultCorsPreflightOptions: { allowOrigins: Cors.ALL_ORIGINS },
    });

    const ttsHandler = new Function(this, "TTSHandler", {
      runtime: Runtime.NODEJS_18_X,
      code: Code.fromAsset("../backend/build"),
      handler: "tts.handler",
      timeout: Duration.seconds(10),
      environment: {
        SPEECH_KEY: process.env.SPEECH_KEY!,
        SPEECH_REGION: process.env.SPEECH_REGION!,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY!,
      },
    });
    restApi.root.addResource("tts").addMethod("POST", new LambdaIntegration(ttsHandler));

    new CfnOutput(this, "CloudFrontURL", { value: distribution.domainName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "BucketName", { value: hostingBucket.bucketName });
    new CfnOutput(this, "BackendEndpoint", { value: restApi.url });
  }
}
