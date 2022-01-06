export const createTemplates = function(appName: string, tag: string) {
  const deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: appName,
      labels: {
        'app.kubernetes.io/name': `load-balancer-${appName}`
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          'app.kubernetes.io/name': `load-balancer-${appName}`
        }
      },
      template: {
        metadata: {
          labels: {
            'app.kubernetes.io/name': `load-balancer-${appName}`
          },
        },
        spec: {
          containers: [{
            image: `${process.env.AWS_ACCOUNT_NUMBER}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${appName}:${tag}`,
            name: `${appName}`,
            ports: [{
              containerPort: 5000
            }],
            envs: [{
              name: 'PORT',
              value: 5000
            },
            {
              name: 'AWS_ID',
              value: process.env.AWS_ACCESS_KEY_ID
            },
            {
              name: 'AWS_SECRET',
              value: process.env.AWS_SECRET_ACCESS_KEY
            },
            {
              name: 'COMPANY_BUCKET',
              value: 'cto-ai'
            }]
          }]
        }
      }
    }
  }
  const service = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: `${appName}-service`,
      labels: {
        'app.kubernetes.io/name': `load-balancer-${appName}`
      },
    },
    spec: {
      selector: {
        'app.kubernetes.io/name': `load-balancer-${appName}`
      },
      ports: [{
        'protocol': 'TCP',
        'port': 80,
        'targetPort': 5000
      }],
      type: 'LoadBalancer'
    }
  }
  return { deployment, service }
}