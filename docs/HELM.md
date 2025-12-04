# Helm Chart Documentation

This document provides comprehensive guidance for deploying Hive Mind on Kubernetes using Helm.

## Prerequisites

- Kubernetes cluster 1.19+
- Helm 3.0+
- `kubectl` configured to access your cluster
- Sufficient cluster resources (see [Resource Requirements](#resource-requirements))

## Installation

### Add the Helm Repository

```bash
helm repo add link-assistant https://link-assistant.github.io/hive-mind
helm repo update
```

### Install the Chart

#### Basic Installation

```bash
helm install hive-mind link-assistant/hive-mind
```

#### Installation with Custom Values

```bash
helm install hive-mind link-assistant/hive-mind -f custom-values.yaml
```

#### Installation in a Specific Namespace

```bash
kubectl create namespace hive-mind
helm install hive-mind link-assistant/hive-mind -n hive-mind
```

## Configuration

### Default Values

The default `values.yaml` provides sensible defaults for most deployments. Key configuration options:

### Resource Requirements

Default resource allocation:

```yaml
resources:
  limits:
    cpu: 1000m
    memory: 2Gi
  requests:
    cpu: 500m
    memory: 1Gi
```

**Recommended minimum resources per pod:**
- CPU: 500m (0.5 cores)
- Memory: 1Gi RAM
- Disk: 50Gi persistent storage

### Persistence Configuration

By default, persistent storage is enabled with 50Gi:

```yaml
persistence:
  enabled: true
  accessMode: ReadWriteOnce
  size: 50Gi
```

**Using a specific storage class:**

```yaml
persistence:
  enabled: true
  storageClass: "fast-ssd"
  size: 100Gi
```

**Using an existing PVC:**

```yaml
persistence:
  enabled: true
  existingClaim: "my-existing-pvc"
```

### Authentication Configuration

Hive Mind requires GitHub and Claude authentication. These should be configured via Kubernetes secrets:

#### Create GitHub Token Secret

```bash
kubectl create secret generic hive-github-token \
  --from-literal=token='ghp_your_github_token_here'
```

#### Create Claude API Key Secret

```bash
kubectl create secret generic hive-claude-api-key \
  --from-literal=apiKey='sk-ant-your_claude_key_here'
```

#### Reference Secrets in Values

```yaml
secrets:
  githubToken: "hive-github-token"
  claudeApiKey: "hive-claude-api-key"
```

### Running as a Telegram Bot

To run Hive Mind as a Telegram bot in Kubernetes:

```yaml
command:
  - /bin/bash
  - -c
  - |
    # Authenticate with GitHub using token from secret
    echo "$GITHUB_TOKEN" | gh auth login --with-token

    # Start the telegram bot
    hive-telegram-bot --configuration "
      TELEGRAM_BOT_TOKEN: '$TELEGRAM_BOT_TOKEN'
      TELEGRAM_ALLOWED_CHATS:
        -1002975819706
      TELEGRAM_HIVE_OVERRIDES:
        --all-issues
        --once
        --auto-fork
        --attach-logs
        --verbose
      TELEGRAM_BOT_VERBOSE: true
    "

env:
  TELEGRAM_BOT_TOKEN: "your-telegram-bot-token"
```

### Autoscaling

Enable horizontal pod autoscaling for multiple bot instances:

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
  targetMemoryUtilizationPercentage: 80
```

### Node Selection and Affinity

#### Node Selector

Deploy to specific nodes:

```yaml
nodeSelector:
  disktype: ssd
  workload: ai-intensive
```

#### Tolerations

Allow scheduling on tainted nodes:

```yaml
tolerations:
  - key: "ai-workload"
    operator: "Equal"
    value: "true"
    effect: "NoSchedule"
```

#### Affinity Rules

Co-locate or spread pods:

```yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchExpressions:
              - key: app.kubernetes.io/name
                operator: In
                values:
                  - hive-mind
          topologyKey: kubernetes.io/hostname
```

## Common Use Cases

### Example 1: Single Bot Instance

Simple deployment for testing or small-scale usage:

```yaml
# values-simple.yaml
replicaCount: 1

persistence:
  enabled: true
  size: 50Gi

resources:
  requests:
    cpu: 500m
    memory: 1Gi
  limits:
    cpu: 1000m
    memory: 2Gi
```

```bash
helm install hive-mind link-assistant/hive-mind -f values-simple.yaml
```

### Example 2: Production Telegram Bot

High-availability deployment with autoscaling:

```yaml
# values-production.yaml
replicaCount: 3

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

persistence:
  enabled: true
  storageClass: "fast-ssd"
  size: 100Gi

resources:
  requests:
    cpu: 1000m
    memory: 2Gi
  limits:
    cpu: 2000m
    memory: 4Gi

secrets:
  githubToken: "hive-github-token"
  claudeApiKey: "hive-claude-api-key"

command:
  - /bin/bash
  - -c
  - |
    echo "$GITHUB_TOKEN" | gh auth login --with-token
    hive-telegram-bot --token "$TELEGRAM_BOT_TOKEN" --verbose

podAntiAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    - labelSelector:
        matchExpressions:
          - key: app.kubernetes.io/name
            operator: In
            values:
              - hive-mind
      topologyKey: "kubernetes.io/hostname"
```

```bash
helm install hive-mind link-assistant/hive-mind -f values-production.yaml
```

### Example 3: Development Environment

Minimal resources for development/testing:

```yaml
# values-dev.yaml
replicaCount: 1

persistence:
  enabled: false

resources:
  requests:
    cpu: 250m
    memory: 512Mi
  limits:
    cpu: 500m
    memory: 1Gi
```

```bash
helm install hive-mind-dev link-assistant/hive-mind -f values-dev.yaml
```

## Upgrading

### Update Repository

```bash
helm repo update
```

### Upgrade Release

```bash
helm upgrade hive-mind link-assistant/hive-mind
```

### Upgrade with New Values

```bash
helm upgrade hive-mind link-assistant/hive-mind -f new-values.yaml
```

### Rollback

```bash
# List release history
helm history hive-mind

# Rollback to previous version
helm rollback hive-mind

# Rollback to specific revision
helm rollback hive-mind 2
```

## Uninstallation

```bash
helm uninstall hive-mind
```

**Note:** By default, PersistentVolumeClaims are not deleted automatically. To delete them:

```bash
kubectl delete pvc -l app.kubernetes.io/name=hive-mind
```

## Troubleshooting

### Check Pod Status

```bash
kubectl get pods -l app.kubernetes.io/name=hive-mind
```

### View Pod Logs

```bash
kubectl logs -l app.kubernetes.io/name=hive-mind --tail=100 -f
```

### Access Pod Shell

```bash
kubectl exec -it deployment/hive-mind -- /bin/bash
```

### Check PVC Status

```bash
kubectl get pvc
kubectl describe pvc hive-mind
```

### Common Issues

#### Pod Not Starting

**Symptom:** Pod stuck in `Pending` state

**Solutions:**
1. Check node resources: `kubectl describe node`
2. Verify PVC is bound: `kubectl get pvc`
3. Check storage class exists: `kubectl get storageclass`

#### Authentication Issues

**Symptom:** GitHub/Claude commands fail

**Solutions:**
1. Verify secrets exist: `kubectl get secrets`
2. Check secret contents: `kubectl describe secret hive-github-token`
3. Manually authenticate inside pod:
   ```bash
   kubectl exec -it deployment/hive-mind -- /bin/bash
   gh auth login
   claude
   ```

#### Out of Memory

**Symptom:** Pod crashes with OOMKilled

**Solutions:**
1. Increase memory limits in values.yaml
2. Monitor actual usage: `kubectl top pods`
3. Consider using autoscaling

## Advanced Configuration

### Multiple Helm Releases

Run multiple isolated Hive Mind instances:

```bash
# Instance 1 - Team A
helm install hive-team-a link-assistant/hive-mind \
  -n team-a --create-namespace \
  -f team-a-values.yaml

# Instance 2 - Team B
helm install hive-team-b link-assistant/hive-mind \
  -n team-b --create-namespace \
  -f team-b-values.yaml
```

### Custom Image

Use a custom Docker image:

```yaml
image:
  repository: myregistry.com/custom-hive-mind
  tag: "1.0.0"
  pullPolicy: Always

imagePullSecrets:
  - name: myregistrykey
```

### Additional Volumes

Mount additional volumes:

```yaml
volumes:
  - name: custom-config
    configMap:
      name: hive-config

volumeMounts:
  - name: custom-config
    mountPath: /etc/hive-config
    readOnly: true
```

## Monitoring and Observability

### Resource Monitoring

```bash
# Watch resource usage
kubectl top pods -l app.kubernetes.io/name=hive-mind

# Watch continuously
watch kubectl top pods -l app.kubernetes.io/name=hive-mind
```

### Logging

Integrate with logging systems like ELK, Loki, or CloudWatch:

```yaml
podAnnotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "9090"
```

## Security Best Practices

1. **Use Secrets Management:** Store GitHub tokens and API keys in Kubernetes secrets or external secret managers (HashiCorp Vault, AWS Secrets Manager)

2. **Network Policies:** Restrict network access between pods:
   ```yaml
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: hive-mind-netpol
   spec:
     podSelector:
       matchLabels:
         app.kubernetes.io/name: hive-mind
     policyTypes:
       - Ingress
       - Egress
     egress:
       - to:
         - namespaceSelector: {}
   ```

3. **Pod Security Standards:** Use restricted pod security standards:
   ```yaml
   podSecurityContext:
     runAsNonRoot: true
     runAsUser: 1000
     fsGroup: 1000
     seccompProfile:
       type: RuntimeDefault
   ```

4. **RBAC:** Create minimal role permissions for the service account

5. **Regular Updates:** Keep the chart and container image updated

## Support and Contributing

- **GitHub Issues:** https://github.com/link-assistant/hive-mind/issues
- **Documentation:** https://github.com/link-assistant/hive-mind
- **Docker Hub:** https://hub.docker.com/r/konard/hive-mind
- **ArtifactHub:** https://artifacthub.io/packages/helm/link-assistant/hive-mind

## License

This Helm chart is released under the Unlicense. See the [LICENSE](https://github.com/link-assistant/hive-mind/blob/main/LICENSE) file for details.
