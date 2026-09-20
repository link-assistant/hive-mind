# Документация по Helm Chart (Экспериментально) (languages: [en](HELM.md) • [zh](HELM.zh.md) • [hi](HELM.hi.md) • ru)

> ⚠️ **ЭКСПЕРИМЕНТАЛЬНО:** Метод установки через Helm/Kubernetes является экспериментальным и может быть нестабильным.
>
> Для более надёжной установки рекомендуем использовать [метод установки через Docker](../README.ru.md#using-docker).

Этот документ содержит исчерпывающее руководство по развёртыванию Hive Mind в Kubernetes с использованием Helm.

## Предварительные требования

- Кластер Kubernetes версии 1.19+
- Helm версии 3.0+
- `kubectl`, настроенный для доступа к вашему кластеру
- Достаточные ресурсы кластера (см. [Требования к ресурсам](#требования-к-ресурсам))

## Установка

### Добавление репозитория Helm

```bash
helm repo add link-assistant https://link-assistant.github.io/hive-mind
helm repo update
```

### Установка чарта

#### Базовая установка

```bash
helm install hive-mind link-assistant/hive-mind
```

#### Установка с пользовательскими значениями

```bash
helm install hive-mind link-assistant/hive-mind -f custom-values.yaml
```

#### Установка в конкретное пространство имён

```bash
kubectl create namespace hive-mind
helm install hive-mind link-assistant/hive-mind -n hive-mind
```

## Конфигурация

### Значения по умолчанию

Файл `values.yaml` по умолчанию предоставляет разумные настройки для большинства развёртываний. Ключевые параметры конфигурации:

### Требования к ресурсам

Распределение ресурсов по умолчанию:

```yaml
resources:
  limits:
    cpu: 1000m
    memory: 2Gi
  requests:
    cpu: 500m
    memory: 1Gi
```

**Рекомендуемые минимальные ресурсы на под:**

- CPU: 500m (0.5 ядра)
- Память: 1 ГиБ RAM
- Диск: 50 ГиБ постоянного хранилища

### Настройка постоянного хранилища

По умолчанию постоянное хранилище включено с объёмом 50 ГиБ:

```yaml
persistence:
  enabled: true
  accessMode: ReadWriteOnce
  size: 50Gi
```

**Использование конкретного класса хранилища:**

```yaml
persistence:
  enabled: true
  storageClass: 'fast-ssd'
  size: 100Gi
```

**Использование существующего PVC:**

```yaml
persistence:
  enabled: true
  existingClaim: 'my-existing-pvc'
```

### Настройка аутентификации

Hive Mind требует аутентификации GitHub и Claude. Их следует настраивать через секреты Kubernetes:

#### Создание секрета с токеном GitHub

```bash
kubectl create secret generic hive-github-token \
  --from-literal=token='ghp_your_github_token_here'
```

#### Создание секрета с API-ключом Claude

```bash
kubectl create secret generic hive-claude-api-key \
  --from-literal=apiKey='sk-ant-your_claude_key_here'
```

#### Ссылки на секреты в values

```yaml
secrets:
  githubToken: 'hive-github-token'
  claudeApiKey: 'hive-claude-api-key'
```

### Запуск в качестве Telegram-бота

Для запуска Hive Mind в качестве Telegram-бота в Kubernetes:

```yaml
command:
  - /bin/bash
  - -c
  - |
    # Аутентификация в GitHub с использованием токена из секрета
    echo "$GITHUB_TOKEN" | gh auth login --with-token

    # Запуск telegram-бота
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

### Автоматическое масштабирование

Включите горизонтальное автомасштабирование подов для нескольких экземпляров бота:

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
  targetMemoryUtilizationPercentage: 80
```

### Выбор узлов и привязка

#### Выбор узлов

Развёртывание на конкретные узлы:

```yaml
nodeSelector:
  disktype: ssd
  workload: ai-intensive
```

#### Tolerations

Разрешить планирование на узлах с taint:

```yaml
tolerations:
  - key: 'ai-workload'
    operator: 'Equal'
    value: 'true'
    effect: 'NoSchedule'
```

#### Правила привязки

Размещение подов вместе или распределение:

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

## Типичные сценарии использования

### Пример 1: Один экземпляр бота

Простое развёртывание для тестирования или небольших нагрузок:

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

### Пример 2: Продакшн Telegram-бот

Высокодоступное развёртывание с автомасштабированием:

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

### Пример 3: Среда разработки

Минимальные ресурсы для разработки/тестирования:

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

## Обновление

### Обновление репозитория

```bash
helm repo update
```

### Обновление релиза

```bash
helm upgrade hive-mind link-assistant/hive-mind
```

### Обновление с новыми значениями

```bash
helm upgrade hive-mind link-assistant/hive-mind -f new-values.yaml
```

### Откат

```bash
# Просмотр истории релизов
helm history hive-mind

# Откат к предыдущей версии
helm rollback hive-mind

# Откат к конкретной ревизии
helm rollback hive-mind 2
```

## Удаление

```bash
helm uninstall hive-mind
```

**Примечание:** По умолчанию PersistentVolumeClaims не удаляются автоматически. Для их удаления:

```bash
kubectl delete pvc -l app.kubernetes.io/name=hive-mind
```

## Устранение неполадок

### Проверка статуса подов

```bash
kubectl get pods -l app.kubernetes.io/name=hive-mind
```

### Просмотр журналов подов

```bash
kubectl logs -l app.kubernetes.io/name=hive-mind --tail=100 -f
```

### Доступ к оболочке пода

```bash
kubectl exec -it deployment/hive-mind -- /bin/bash
```

### Проверка статуса PVC

```bash
kubectl get pvc
kubectl describe pvc hive-mind
```

### Распространённые проблемы

#### Под не запускается

**Симптом:** Под застрял в состоянии `Pending`

**Решения:**

1. Проверьте ресурсы узла: `kubectl describe node`
2. Убедитесь, что PVC привязан: `kubectl get pvc`
3. Проверьте наличие класса хранилища: `kubectl get storageclass`

#### Проблемы с аутентификацией

**Симптом:** Команды GitHub/Claude завершаются ошибкой

**Решения:**

1. Проверьте наличие секретов: `kubectl get secrets`
2. Проверьте содержимое секрета: `kubectl describe secret hive-github-token`
3. Выполните аутентификацию вручную внутри пода:
   ```bash
   kubectl exec -it deployment/hive-mind -- /bin/bash
   gh auth login
   claude
   ```

#### Нехватка памяти

**Симптом:** Под аварийно завершается с OOMKilled

**Решения:**

1. Увеличьте лимиты памяти в values.yaml
2. Отслеживайте фактическое использование: `kubectl top pods`
3. Рассмотрите использование автомасштабирования

## Расширенная конфигурация

### Несколько релизов Helm

Запуск нескольких изолированных экземпляров Hive Mind:

```bash
# Экземпляр 1 — Команда A
helm install hive-team-a link-assistant/hive-mind \
  -n team-a --create-namespace \
  -f team-a-values.yaml

# Экземпляр 2 — Команда B
helm install hive-team-b link-assistant/hive-mind \
  -n team-b --create-namespace \
  -f team-b-values.yaml
```

### Кастомный образ

Использование кастомного образа Docker:

```yaml
image:
  repository: myregistry.com/custom-hive-mind
  tag: '1.0.0'
  pullPolicy: Always

imagePullSecrets:
  - name: myregistrykey
```

### Дополнительные тома

Монтирование дополнительных томов:

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

## Мониторинг и наблюдаемость

### Мониторинг ресурсов

```bash
# Отслеживание использования ресурсов
kubectl top pods -l app.kubernetes.io/name=hive-mind

# Непрерывное отслеживание
watch kubectl top pods -l app.kubernetes.io/name=hive-mind
```

### Журналирование

Интеграция с системами журналирования, такими как ELK, Loki или CloudWatch:

```yaml
podAnnotations:
  prometheus.io/scrape: 'true'
  prometheus.io/port: '9090'
```

## Рекомендации по безопасности

1. **Используйте управление секретами:** Храните токены GitHub и API-ключи в секретах Kubernetes или внешних менеджерах секретов (HashiCorp Vault, AWS Secrets Manager)

2. **Сетевые политики:** Ограничьте сетевой доступ между подами:

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

3. **Стандарты безопасности подов:** Используйте ограниченные стандарты безопасности подов:

   ```yaml
   podSecurityContext:
     runAsNonRoot: true
     runAsUser: 1000
     fsGroup: 1000
     seccompProfile:
       type: RuntimeDefault
   ```

4. **RBAC:** Создайте минимальные разрешения роли для учётной записи службы

5. **Регулярные обновления:** Поддерживайте чарт и образ контейнера в актуальном состоянии

## Поддержка и участие в разработке

- **GitHub Issues:** https://github.com/link-assistant/hive-mind/issues
- **Документация:** https://github.com/link-assistant/hive-mind
- **Docker Hub:** https://hub.docker.com/r/konard/hive-mind
- **ArtifactHub:** https://artifacthub.io/packages/helm/link-assistant/hive-mind

## Лицензия

Этот Helm chart выпущен под лицензией Unlicense. Подробности см. в файле [LICENSE](https://github.com/link-assistant/hive-mind/blob/main/LICENSE).
