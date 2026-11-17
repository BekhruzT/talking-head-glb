# Optional AWS deployment

This CDK stack creates a private S3 bucket and public CloudFront distribution for the Ava web app, plus one API Gateway `/tts` route backed by a Lambda function. It does not deploy automatically from GitHub.

With AWS credentials configured, set `SPEECH_KEY`, `SPEECH_REGION`, and either `OPENAI_API_KEY` or `GEMINI_API_KEY` in your shell. Then build and deploy the backend:

```sh
npm ci && npm run build -w backend
cd infra && npm ci && npm run cdk-deploy
```

The stack outputs `BackendEndpoint`, `BucketName`, `DistributionId`, and `CloudFrontURL`. Its CloudFront distribution is public. A frontend build copies every head in `frontend/public/heads/` into `frontend/build/`, including Ava's private GLB once installed, so **do not upload that build to S3 or another public host**. Public live deployment needs authenticated model delivery; the README video demos do not need it. The stack uses generated AWS resource names and does not configure a custom domain.
