# Helm Chart दस्तावेज़ीकरण (Experimental) (languages: [en](HELM.md) • [zh](HELM.zh.md) • hi • [ru](HELM.ru.md))

> ⚠️ **EXPERIMENTAL:** Helm/Kubernetes installation method experimental है और पूरी तरह stable नहीं हो सकती।
>
> अधिक reliable installation के लिए, हम इसके बजाय [Docker installation method](../README.hi.md#using-docker) उपयोग करने की सलाह देते हैं।

यह दस्तावेज़ Helm का उपयोग करके Kubernetes पर Hive Mind deploy करने के लिए व्यापक मार्गदर्शन प्रदान करता है।

## पूर्वापेक्षाएँ

- Kubernetes cluster 1.19+
- Helm 3.0+
- `kubectl` आपके cluster तक पहुँचने के लिए configured
- पर्याप्त cluster resources (देखें [Resource Requirements](#resource-requirements))

## Installation

### Helm Repository जोड़ें

```bash
helm repo add link-assistant https://link-assistant.github.io/hive-mind
helm repo update
```

### Chart Install करें

#### Basic Installation

```bash
helm install hive-mind link-assistant/hive-mind
```

#### Custom Values के साथ Installation

```bash
helm install hive-mind link-assistant/hive-mind -f custom-values.yaml
```

#### एक Specific Namespace में Installation

```bash
kubectl create namespace hive-mind
helm install hive-mind link-assistant/hive-mind -n hive-mind
```

## Configuration

### Default Values

Default `values.yaml` अधिकांश deployments के लिए sensible defaults प्रदान करती है। मुख्य configuration विकल्प:

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

**प्रति pod अनुशंसित minimum resources:**

- CPU: 500m (0.5 cores)
- Memory: 1Gi RAM
- Disk: 50Gi persistent storage

### Persistence Configuration

Default रूप से, 50Gi के साथ persistent storage सक्षम है:

```yaml
persistence:
  enabled: true
  accessMode: ReadWriteOnce
  size: 50Gi
```

**एक specific storage class उपयोग करना:**

```yaml
persistence:
  enabled: true
  storageClass: 'fast-ssd'
  size: 100Gi
```

**एक existing PVC उपयोग करना:**

```yaml
persistence:
  enabled: true
  existingClaim: 'my-existing-pvc'
```

### Authentication Configuration

Hive Mind को GitHub और Claude authentication की आवश्यकता है। इन्हें Kubernetes secrets के माध्यम से configure किया जाना चाहिए:

#### GitHub Token Secret बनाएं

```bash
kubectl create secret generic hive-github-token \
  --from-literal=token='ghp_your_github_token_here'
```

#### Claude API Key Secret बनाएं

```bash
kubectl create secret generic hive-claude-api-key \
  --from-literal=apiKey='sk-ant-your_claude_key_here'
```

#### Values में Secrets Reference करें

```yaml
secrets:
  githubToken: 'hive-github-token'
  claudeApiKey: 'hive-claude-api-key'
```

### Telegram Bot के रूप में चलाना

Kubernetes में Hive Mind को Telegram bot के रूप में चलाने के लिए:

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
        --attach-logs
        --verbose
      TELEGRAM_BOT_VERBOSE: true
    "

env:
  TELEGRAM_BOT_TOKEN: 'your-telegram-bot-token'
```

### Autoscaling

Multiple bot instances के लिए horizontal pod autoscaling सक्षम करें:

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
  targetMemoryUtilizationPercentage: 80
```

### Node Selection और Affinity

#### Node Selector

Specific nodes पर deploy करें:

```yaml
nodeSelector:
  disktype: ssd
  workload: ai-intensive
```

#### Tolerations

Tainted nodes पर scheduling की अनुमति दें:

```yaml
tolerations:
  - key: 'ai-workload'
    operator: 'Equal'
    value: 'true'
    effect: 'NoSchedule'
```

#### Affinity Rules

Pods को co-locate या spread करें:

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

## सामान्य Use Cases

### Example 1: Single Bot Instance

Testing या small-scale usage के लिए सरल deployment:

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

Autoscaling के साथ high-availability deployment:

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
  storageClass: 'fast-ssd'
  size: 100Gi

resources:
  requests:
    cpu: 1000m
    memory: 2Gi
  limits:
    cpu: 2000m
    memory: 4Gi

secrets:
  githubToken: 'hive-github-token'
  claudeApiKey: 'hive-claude-api-key'

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
      topologyKey: 'kubernetes.io/hostname'
```

```bash
helm install hive-mind link-assistant/hive-mind -f values-production.yaml
```

### Example 3: Development Environment

Development/testing के लिए minimal resources:

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

### Repository अपडेट करें

```bash
helm repo update
```

### Release Upgrade करें

```bash
helm upgrade hive-mind link-assistant/hive-mind
```

### New Values के साथ Upgrade करें

```bash
helm upgrade hive-mind link-assistant/hive-mind -f new-values.yaml
```

### Rollback

```bash
# Release history देखें
helm history hive-mind

# Previous version पर rollback करें
helm rollback hive-mind

# Specific revision पर rollback करें
helm rollback hive-mind 2
```

## Uninstallation

```bash
helm uninstall hive-mind
```

**नोट:** Default रूप से, PersistentVolumeClaims automatically delete नहीं होते। उन्हें delete करने के लिए:

```bash
kubectl delete pvc -l app.kubernetes.io/name=hive-mind
```

## Troubleshooting

### Pod Status जांचें

```bash
kubectl get pods -l app.kubernetes.io/name=hive-mind
```

### Pod Logs देखें

```bash
kubectl logs -l app.kubernetes.io/name=hive-mind --tail=100 -f
```

### Pod Shell Access करें

```bash
kubectl exec -it deployment/hive-mind -- /bin/bash
```

### PVC Status जांचें

```bash
kubectl get pvc
kubectl describe pvc hive-mind
```

### सामान्य Issues

#### Pod शुरू नहीं हो रहा

**Symptom:** Pod `Pending` state में अटका हुआ

**समाधान:**

1. Node resources जांचें: `kubectl describe node`
2. Verify करें कि PVC bound है: `kubectl get pvc`
3. जांचें कि storage class मौजूद है: `kubectl get storageclass`

#### Authentication Issues

**Symptom:** GitHub/Claude commands fail हो रहे हैं

**समाधान:**

1. Verify करें कि secrets मौजूद हैं: `kubectl get secrets`
2. Secret contents जांचें: `kubectl describe secret hive-github-token`
3. Pod के अंदर manually authenticate करें:
   ```bash
   kubectl exec -it deployment/hive-mind -- /bin/bash
   gh auth login
   claude
   ```

#### Out of Memory

**Symptom:** Pod OOMKilled के साथ crash होता है

**समाधान:**

1. values.yaml में memory limits बढ़ाएं
2. वास्तविक usage monitor करें: `kubectl top pods`
3. Autoscaling उपयोग करने पर विचार करें

## Advanced Configuration

### Multiple Helm Releases

Multiple isolated Hive Mind instances चलाएं:

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

एक custom Docker image उपयोग करें:

```yaml
image:
  repository: myregistry.com/custom-hive-mind
  tag: '1.0.0'
  pullPolicy: Always

imagePullSecrets:
  - name: myregistrykey
```

### Additional Volumes

Additional volumes mount करें:

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

## Monitoring और Observability

### Resource Monitoring

```bash
# Resource usage देखें
kubectl top pods -l app.kubernetes.io/name=hive-mind

# Continuously देखें
watch kubectl top pods -l app.kubernetes.io/name=hive-mind
```

### Logging

ELK, Loki या CloudWatch जैसे logging systems के साथ integrate करें:

```yaml
podAnnotations:
  prometheus.io/scrape: 'true'
  prometheus.io/port: '9090'
```

## Security सर्वोत्तम प्रथाएँ

1. **Secrets Management उपयोग करें:** GitHub tokens और API keys को Kubernetes secrets या external secret managers (HashiCorp Vault, AWS Secrets Manager) में store करें

2. **Network Policies:** Pods के बीच network access restrict करें:

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

3. **Pod Security Standards:** Restricted pod security standards उपयोग करें:

   ```yaml
   podSecurityContext:
     runAsNonRoot: true
     runAsUser: 1000
     fsGroup: 1000
     seccompProfile:
       type: RuntimeDefault
   ```

4. **RBAC:** Service account के लिए minimal role permissions बनाएं

5. **Regular Updates:** Chart और container image को updated रखें

## Support और Contributing

- **GitHub Issues:** https://github.com/link-assistant/hive-mind/issues
- **Documentation:** https://github.com/link-assistant/hive-mind
- **Docker Hub:** https://hub.docker.com/r/konard/hive-mind
- **ArtifactHub:** https://artifacthub.io/packages/helm/link-assistant/hive-mind

## License

यह Helm chart Unlicense के तहत released है। विवरण के लिए [LICENSE](https://github.com/link-assistant/hive-mind/blob/main/LICENSE) फ़ाइल देखें।
