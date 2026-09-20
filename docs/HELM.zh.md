# Helm Chart 文档（实验性）(languages: [en](HELM.md) • zh • [hi](HELM.hi.md) • [ru](HELM.ru.md))

> ⚠️ **实验性：** Helm/Kubernetes 安装方法是实验性的，可能尚不完全稳定。
>
> 对于更可靠的安装，我们建议改用 [Docker 安装方法](../README.zh.md#using-docker)。

本文档提供了使用 Helm 在 Kubernetes 上部署 Hive Mind 的全面指南。

## 前提条件

- Kubernetes 集群 1.19+
- Helm 3.0+
- 已配置访问集群的 `kubectl`
- 足够的集群资源（参见[资源要求](#resource-requirements)）

## 安装

### 添加 Helm 仓库

```bash
helm repo add link-assistant https://link-assistant.github.io/hive-mind
helm repo update
```

### 安装 Chart

#### 基本安装

```bash
helm install hive-mind link-assistant/hive-mind
```

#### 使用自定义值安装

```bash
helm install hive-mind link-assistant/hive-mind -f custom-values.yaml
```

#### 在特定命名空间中安装

```bash
kubectl create namespace hive-mind
helm install hive-mind link-assistant/hive-mind -n hive-mind
```

## 配置

### 默认值

默认的 `values.yaml` 为大多数部署提供了合理的默认值。关键配置选项：

### 资源要求

默认资源分配：

```yaml
resources:
  limits:
    cpu: 1000m
    memory: 2Gi
  requests:
    cpu: 500m
    memory: 1Gi
```

**每个 Pod 推荐的最低资源：**

- CPU：500m（0.5 核）
- 内存：1Gi RAM
- 磁盘：50Gi 持久存储

### 持久化配置

默认情况下，持久存储已启用，大小为 50Gi：

```yaml
persistence:
  enabled: true
  accessMode: ReadWriteOnce
  size: 50Gi
```

**使用特定存储类：**

```yaml
persistence:
  enabled: true
  storageClass: 'fast-ssd'
  size: 100Gi
```

**使用现有 PVC：**

```yaml
persistence:
  enabled: true
  existingClaim: 'my-existing-pvc'
```

### 认证配置

Hive Mind 需要 GitHub 和 Claude 认证。这些应通过 Kubernetes 密钥配置：

#### 创建 GitHub Token 密钥

```bash
kubectl create secret generic hive-github-token \
  --from-literal=token='ghp_your_github_token_here'
```

#### 创建 Claude API 密钥密钥

```bash
kubectl create secret generic hive-claude-api-key \
  --from-literal=apiKey='sk-ant-your_claude_key_here'
```

#### 在 Values 中引用密钥

```yaml
secrets:
  githubToken: 'hive-github-token'
  claudeApiKey: 'hive-claude-api-key'
```

### 作为 Telegram Bot 运行

要在 Kubernetes 中将 Hive Mind 作为 Telegram bot 运行：

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

### 自动扩缩容

为多个 bot 实例启用水平 Pod 自动扩缩容：

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
  targetMemoryUtilizationPercentage: 80
```

### 节点选择与亲和性

#### 节点选择器

部署到特定节点：

```yaml
nodeSelector:
  disktype: ssd
  workload: ai-intensive
```

#### 容忍度

允许在有污点的节点上调度：

```yaml
tolerations:
  - key: 'ai-workload'
    operator: 'Equal'
    value: 'true'
    effect: 'NoSchedule'
```

#### 亲和性规则

共置或分散 Pod：

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

## 常见使用场景

### 示例 1：单个 Bot 实例

用于测试或小规模使用的简单部署：

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

### 示例 2：生产 Telegram Bot

带自动扩缩容的高可用部署：

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

### 示例 3：开发环境

用于开发/测试的最小资源配置：

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

## 升级

### 更新仓库

```bash
helm repo update
```

### 升级发布版本

```bash
helm upgrade hive-mind link-assistant/hive-mind
```

### 使用新值升级

```bash
helm upgrade hive-mind link-assistant/hive-mind -f new-values.yaml
```

### 回滚

```bash
# 列出发布历史
helm history hive-mind

# 回滚到上一个版本
helm rollback hive-mind

# 回滚到特定修订版
helm rollback hive-mind 2
```

## 卸载

```bash
helm uninstall hive-mind
```

**注意：** 默认情况下，PersistentVolumeClaim 不会自动删除。要删除它们：

```bash
kubectl delete pvc -l app.kubernetes.io/name=hive-mind
```

## 故障排除

### 检查 Pod 状态

```bash
kubectl get pods -l app.kubernetes.io/name=hive-mind
```

### 查看 Pod 日志

```bash
kubectl logs -l app.kubernetes.io/name=hive-mind --tail=100 -f
```

### 访问 Pod Shell

```bash
kubectl exec -it deployment/hive-mind -- /bin/bash
```

### 检查 PVC 状态

```bash
kubectl get pvc
kubectl describe pvc hive-mind
```

### 常见问题

#### Pod 无法启动

**症状：** Pod 卡在 `Pending` 状态

**解决方案：**

1. 检查节点资源：`kubectl describe node`
2. 验证 PVC 是否已绑定：`kubectl get pvc`
3. 检查存储类是否存在：`kubectl get storageclass`

#### 认证问题

**症状：** GitHub/Claude 命令失败

**解决方案：**

1. 验证密钥是否存在：`kubectl get secrets`
2. 检查密钥内容：`kubectl describe secret hive-github-token`
3. 在 Pod 内手动认证：
   ```bash
   kubectl exec -it deployment/hive-mind -- /bin/bash
   gh auth login
   claude
   ```

#### 内存不足

**症状：** Pod 因 OOMKilled 崩溃

**解决方案：**

1. 在 values.yaml 中增加内存限制
2. 监控实际使用情况：`kubectl top pods`
3. 考虑使用自动扩缩容

## 高级配置

### 多个 Helm 发布版本

运行多个隔离的 Hive Mind 实例：

```bash
# 实例 1 - 团队 A
helm install hive-team-a link-assistant/hive-mind \
  -n team-a --create-namespace \
  -f team-a-values.yaml

# 实例 2 - 团队 B
helm install hive-team-b link-assistant/hive-mind \
  -n team-b --create-namespace \
  -f team-b-values.yaml
```

### 自定义镜像

使用自定义 Docker 镜像：

```yaml
image:
  repository: myregistry.com/custom-hive-mind
  tag: '1.0.0'
  pullPolicy: Always

imagePullSecrets:
  - name: myregistrykey
```

### 额外卷

挂载额外卷：

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

## 监控与可观测性

### 资源监控

```bash
# 观察资源使用情况
kubectl top pods -l app.kubernetes.io/name=hive-mind

# 持续观察
watch kubectl top pods -l app.kubernetes.io/name=hive-mind
```

### 日志记录

与 ELK、Loki 或 CloudWatch 等日志系统集成：

```yaml
podAnnotations:
  prometheus.io/scrape: 'true'
  prometheus.io/port: '9090'
```

## 安全最佳实践

1. **使用密钥管理：** 将 GitHub token 和 API 密钥存储在 Kubernetes 密钥或外部密钥管理器（HashiCorp Vault、AWS Secrets Manager）中

2. **网络策略：** 限制 Pod 之间的网络访问：

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

3. **Pod 安全标准：** 使用受限的 Pod 安全标准：

   ```yaml
   podSecurityContext:
     runAsNonRoot: true
     runAsUser: 1000
     fsGroup: 1000
     seccompProfile:
       type: RuntimeDefault
   ```

4. **RBAC：** 为服务账户创建最小角色权限

5. **定期更新：** 保持 chart 和容器镜像更新

## 支持与贡献

- **GitHub Issues：** https://github.com/link-assistant/hive-mind/issues
- **文档：** https://github.com/link-assistant/hive-mind
- **Docker Hub：** https://hub.docker.com/r/konard/hive-mind
- **ArtifactHub：** https://artifacthub.io/packages/helm/link-assistant/hive-mind

## 许可证

此 Helm chart 在 Unlicense 下发布。详情请参阅 [LICENSE](https://github.com/link-assistant/hive-mind/blob/main/LICENSE) 文件。
