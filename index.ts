import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";
import { Resource } from "@pulumi/aws/apigateway";

// Get some configuration values or set default values.
const config = new pulumi.Config();
const instanceType = config.get("instanceType") || "g4dn.xlarge";
const vpcNetworkCidr = config.get("vpcNetworkCidr") || "10.9.0.0/16";
const containerPort = config.getNumber("containerPort") || 8080;
const cpu = config.getNumber("cpu") || 256;
const memory = config.getNumber("memory") || 512;
const llm = config.get("llm") || "llama2:latest";

// === Ollama Backend on EC2 ===
// If keyName is provided, an existing KeyPair is used, else if publicKey is provided a new KeyPair
// derived from the publicKey is created.
let keyName: pulumi.Input<string> | undefined = config.get("keyName");
const publicKey = config.get("publicKey");

// The privateKey associated with the selected key must be provided (either directly or base64 encoded).
const privateKey = config.requireSecret("privateKey").apply(key => {
	if (key.startsWith("-----BEGIN RSA PRIVATE KEY-----")) {
		return key;
	} else {
		return Buffer.from(key, "base64").toString("ascii");
	}
});

if (!keyName) {
	if (!publicKey) {
		throw new Error("must provide one of `keyName` or `publicKey`");
	}
	const key = new aws.ec2.KeyPair("key", { publicKey });
	keyName = key.keyName;
}

class Networking extends pulumi.ComponentResource {
	public vpcId: pulumi.Output<string>;
	public subnetId: pulumi.Output<string>;
	
	constructor(name: string, opts: pulumi.ResourceOptions) {
		super("ollama:utils:Networking", name, {}, opts);

		// Create VPC.
		const vpc = new aws.ec2.Vpc("laci-ollama-vpc", {
			cidrBlock: vpcNetworkCidr,
			enableDnsHostnames: true,
			enableDnsSupport: true,
			tags: {
				Name: "laci-ollama-demo",
			},
		}, { parent: this });

		// Create an internet gateway.
		const gateway = new aws.ec2.InternetGateway("laci-ollama-igw", {
			vpcId: vpc.id,
			tags: {
				Name: "laci-ollama-demo",
			},
		}, { parent: this });

		// Create a subnet that automatically assigns new instances a public IP address.
		const subnet = new aws.ec2.Subnet("laci-ollama-sbnet", {
			vpcId: vpc.id,
			availabilityZone: "us-west-2a",
			cidrBlock: "10.9.1.0/24",
			mapPublicIpOnLaunch: true,
			tags: {
				Name: "laci-ollama-demo",
			},
		}, { parent: this });

		// Create a route table.
		const routeTable = new aws.ec2.RouteTable("laci-ollama-rtable", {
			vpcId: vpc.id,
			routes: [{
				cidrBlock: "0.0.0.0/0",
				gatewayId: gateway.id,
			}],
			tags: {
				Name: "laci-ollama-demo",
			},
		}, { parent: this });

		// Associate the route table with the public subnet.
		const routeTableAssociation = new aws.ec2.RouteTableAssociation("laci-ollama-rtable-assoc", {
			subnetId: subnet.id,
			routeTableId: routeTable.id,
		}, { parent: this });
			
		this.vpcId = vpc.id;
		this.subnetId = subnet.id;

		this.registerOutputs({
			vpcId: vpc.id,
			subnetId: subnet.id,
		});
	}
}
const networking = new Networking("network", {});

// Create a security group allowing inbound access over port 11434 and outbound
// access to anywhere.
const backendSg = new aws.ec2.SecurityGroup("laci-ollama-backend-sg", {
	vpcId: networking.vpcId,
	description: "sg for Ollama demo",
	ingress: [
		{ fromPort: 11434, toPort: 11434, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"] },
		{ fromPort: 22, toPort: 22, protocol: "tcp", cidrBlocks: ["0.0.0.0/0"] },
	],
	egress: [
		{ fromPort: 0, toPort: 0, protocol: "-1", cidrBlocks: ["0.0.0.0/0"] }
	],
	tags: {
		Name: "laci-ollama-demo",
	},
});

// Look up Ubuntu g4dn GPU AMI.
const ami = aws.ec2.getAmi({
	filters: [{
		name: "name",
		values: ["Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 20.04) 20240326"],
	}],
	owners: ["898082745236"],
	mostRecent: true,
}).then(invoke => invoke.id);

// User data to download and start Ollama in the EC2 instance
const userData = `#!/bin/bash
curl -fsSL https://ollama.com/install.sh | sh
sudo mkdir -p /etc/systemd/system/ollama.service.d
echo '[Service]' >>/etc/systemd/system/ollama.service.d/environment.conf
echo 'Environment="OLLAMA_HOST=0.0.0.0:11434"' >>/etc/systemd/system/ollama.service.d/environment.conf
systemctl daemon-reload
systemctl restart ollama
sleep 5
ollama pull ${llm}
`;

// Create and launch an EC2 instance into the public subnet.
const server = new aws.ec2.Instance("laci-ollama-demo", {
	instanceType: instanceType,
	subnetId: networking.subnetId,
	vpcSecurityGroupIds: [backendSg.id],
	userData: userData,
	ami: ami,
	keyName: keyName,
	tags: {
		Name: "laci-ollama-demo",
	},
});

const ollamaServerUrl = pulumi.interpolate`http://${server.publicIp}:11434`;

// === Ollama Frontend on ECS/Fargate ===

// An ECS cluster to deploy into
const cluster = new aws.ecs.Cluster("laci-ollama-ecs", {});

// An ALB to serve the container endpoint to the internet
const loadbalancer = new awsx.lb.ApplicationLoadBalancer("laci-ollama-lb", {
	defaultTargetGroupPort: 8080,
	tags: {
		Name: "laci-ollama-demo",
	},
});

const service = new awsx.ecs.FargateService("laci-ollama-fargate", {
	cluster: cluster.arn,
	assignPublicIp: true,
	taskDefinitionArgs: {
		container: {
			name: "oi-app",
			image: "ghcr.io/open-webui/open-webui:main",
			cpu: cpu,
			memory: memory,
			essential: true,
			portMappings: [{
				hostPort: 8080,
				containerPort: containerPort,
				targetGroup: loadbalancer.defaultTargetGroup,
			}],
			environment: [
				{
					name: "OLLAMA_BASE_URL",
					value: ollamaServerUrl,
				},
			],
		},
	},
});

export const ollamaServerPublicIp = server.publicIp;
export const ollamaServerPublicDns = server.publicDns;
export const ollamaFrontendLB = pulumi.interpolate`http://${loadbalancer.loadBalancer.dnsName}`;