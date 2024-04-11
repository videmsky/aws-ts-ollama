This repository uses Pulumi to create a Ollama server on a AWS GPU backed EC2 instance and an Open-WebUI client on ECS. Trialing models locally can be extremely slow and therefefore this repo aims to provide a simple way to run models with AWS GPU resources. Use with caution as GPU instances can get expensive!

[Ollama](https://github.com/ollama/ollama)
[Open WebUI](https://github.com/open-webui/open-webui)

### prerequisites
- AWS account and credentials configured with Pulumi ESC
- Pulumi CLI installed
- SSH keys added to Pulumi ESC