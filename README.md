This repository uses Pulumi to create a Ollama server on a AWS GPU backed EC2 instance and an Open-WebUI client on ECS. Trialing models locally can be extremely slow and therefefore this repo aims to provide a simple way to run models with AWS GPU resources. Use with caution as GPU instances can get expensive!

[Ollama](https://github.com/ollama/ollama)
[Open WebUI](https://github.com/open-webui/open-webui)

### Prerequisites
- AWS account and credentials configured with Pulumi ESC
- Pulumi CLI installed
- SSH keys added to Pulumi ESC

### ESC Environment Definition Sample

```yaml
values:
  aws:
    creds:
      fn::open::aws-login:
        oidc:
          duration: 1h
          roleArn: arn:aws:iam::12345678910:role/laci-pulumi-corp
          sessionName: pulumi-environments-session
  environmentVariables:
    AWS_ACCESS_KEY_ID: ${aws.creds.accessKeyId}
    AWS_SECRET_ACCESS_KEY: ${aws.creds.secretAccessKey}
    AWS_SESSION_TOKEN: ${aws.creds.sessionToken}
  pulumiConfig:
    publicKey: ssh-ed25519 AAAAC...
    privateKey:
      fn::secret:
        ciphertext: ZXNjeAAAAA...
```

### Deploying and Running the Program

1. Create a new stack:
`$ pulumi stack init dev`

2. Set local configuration variables:
* `$ pulumi config set aws-ts-ollama:instanceType "g4dn.xlarge"`
* `$ pulumi config set aws-ts-ollama:vpcNetworkCidr "10.9.0.0/16"`
* `$ pulumi config set aws-ts-ollama:containerPort "8080"`
* `$ pulumi config set aws-ts-ollama:cpu "256"`
* `$ pulumi config set aws-ts-ollama:memory "512"`

3. `Pulumi.dev.yaml` should look like this:
```yaml
environment:
  - laci-dev
config:
  aws-ts-ollama:instanceType: g4dn.xlarge
  aws-ts-ollama:vpcNetworkCidr: "10.9.0.0/16"
  aws-ts-ollama:containerPort: "8080"
  aws-ts-ollama:cpu: "256"
  aws-ts-ollama:memory: "512"
```

### Clean Up

1. To clean up resources, run:
`$ pulumi pulumi destroy -s dev`