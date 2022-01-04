import * as cdk from '@aws-cdk/core'
import * as iam from '@aws-cdk/aws-iam'
import * as ec2 from '@aws-cdk/aws-ec2'
import * as eks from '@aws-cdk/aws-eks'
import * as rds from '@aws-cdk/aws-rds'
import * as sqs from '@aws-cdk/aws-sqs'
import * as elasticache from './redis'
import * as autoscaling from '@aws-cdk/aws-autoscaling'
import { exec } from 'child_process'

interface StackProps {
  repo: string,
  tag: string
}

export default class Cluster extends cdk.Stack {
  public readonly vpc: ec2.Vpc
  public readonly cluster: eks.Cluster
  public readonly db: rds.ServerlessCluster
  public readonly mq: sqs.Queue
  public readonly redis: cdk.Construct
  public readonly bastion: ec2.BastionHostLinux
  constructor(scope: cdk.Construct, id: string, props?: StackProps) {
    super(scope, id)

    const repo = props?.repo ?? 'sample-app'
    const tag = props?.tag ?? 'main'

    // todo @kc make AZ a StackProp
    const vpc = new ec2.Vpc(this, `${id}-vpc`, { 
      cidr: '10.0.0.0/16',
      natGateways: 1,
      maxAzs: 3,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE,
          cidrMask: 24,
        }
      ],
    }); 

    const bastionSecurityGroup = new ec2.SecurityGroup(this, `${id}-bastion-sg`, {
      vpc: vpc,
      allowAllOutbound: true,
      description: `bastion security group for ${id} cluster`,
      securityGroupName: `${id}-bastion-sg`
    });
    bastionSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'SSH access');

    const bastion = new ec2.BastionHostLinux(this, `${id}-bastion`, {
      vpc: vpc,
      instanceName: `${id}-bastion`,
      securityGroup: bastionSecurityGroup,
      subnetSelection: {
        subnetType: ec2.SubnetType.PUBLIC
      }
    });

    const cluster = new eks.Cluster(this, `${id}-eks`, {
      vpc: vpc,
      defaultCapacity: 0,
      defaultCapacityInstance: ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.XLARGE),
      version: eks.KubernetesVersion.V1_21,
    });

    const rootVolume: autoscaling.BlockDevice = {
      deviceName: '/dev/xvda', // define the root volume
      volume: autoscaling.BlockDeviceVolume.ebs(100), // override volume size
    };

    // IAM role for our EC2 worker nodes
    const workerRole = new iam.Role(this, `${id}-workers` , {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
    });

    const onDemandASG = new autoscaling.AutoScalingGroup(this, `${id}-asg`, {
      vpc: vpc,
      role: workerRole,
      minCapacity: 1,
      maxCapacity: 10,
      desiredCapacity: 3,
      blockDevices: [rootVolume],
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.XLARGE),
      machineImage: new eks.EksOptimizedImage({
        kubernetesVersion: '1.21',
        nodeType: eks.NodeType.STANDARD  // without this, incorrect SSM parameter for AMI is resolved
      }),
      updatePolicy: autoscaling.UpdatePolicy.rollingUpdate()
    });

    cluster.connectAutoScalingGroupCapacity(onDemandASG, {});

    const dbSecurityGroup = new ec2.SecurityGroup(this, `${id}-db-sg`, {
      vpc: vpc,
      allowAllOutbound: true,
      description: `db security group for ${id} db`,
      securityGroupName: `${id}-db-sg`
    });
    dbSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3306), 'MySQL access');

    const db = new rds.ServerlessCluster(this, `dev-db`, {
      vpc: vpc,
      defaultDatabaseName: `${id}`,
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      scaling: { autoPause: cdk.Duration.seconds(0) },
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE },
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromGeneratedSecret('root')
    });

    const redis = new elasticache.Cluster(this, `${id}-redis`, { vpc: vpc });
    const mq = new sqs.Queue(this, `${id}-sqs`);

    new cdk.CfnOutput(this, 'DBSecretArn', { value: db?.secret?.secretArn || 'unknown' })

    this.vpc = vpc;
    this.cluster = cluster;
    this.bastion = bastion;
    this.redis = redis;
    this.db = db;
    this.mq = mq;

  }
}

