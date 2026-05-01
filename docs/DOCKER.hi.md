# Hive Mind Docker सहायता (languages: [en](DOCKER.md) • [zh](DOCKER.zh.md) • hi • [ru](DOCKER.ru.md))

यह दस्तावेज़ बताता है कि Docker containers में Hive Mind कैसे चलाएं।

## त्वरित शुरुआत

### विकल्प 1: Docker Hub से पूर्व-निर्मित Image का उपयोग करना (अनुशंसित)

```bash
# नवीनतम image pull करें
docker pull konard/hive-mind:latest

# एक interactive session चलाएं
docker run -it konard/hive-mind:latest

# महत्वपूर्ण: Authentication Docker image install होने के बाद की जाती है
# Installation script gh auth login नहीं चलाता ताकि build timeouts से बचा जा सके
# यह Docker build को interactive prompts के बिना सफलतापूर्वक पूर्ण करने की अनुमति देता है

# Container के अंदर, GitHub के साथ authenticate करें
gh auth login -h github.com -s repo,workflow,user,read:org,gist

# Claude के साथ authenticate करें
claude

# अब आप hive और solve commands का उपयोग कर सकते हैं
solve https://github.com/owner/repo/issues/123
```

### विकल्प 2: स्थानीय रूप से Build करना

```bash
# Production image build करें
docker build -t hive-mind:local .

# Image चलाएं
docker run -it hive-mind:local
```

### विकल्प 3: Docker-in-Docker Image

जब agent को Hive Mind container के अंदर Docker commands, Docker Compose, या Testcontainers चलाने हों, तो `konard/hive-mind-dind:latest` उपयोग करें।

```bash
# Docker-in-Docker image pull करें
docker pull konard/hive-mind-dind:latest

# Default runtime: privileged container अंदर dockerd शुरू करता है
docker run --rm --privileged -it konard/hive-mind-dind:latest bash

# Container के अंदर nested Docker verify करें
docker info
docker run hello-world
```

Shared hosts पर, उपलब्ध हो तो Sysbox runtime को प्राथमिकता दें:

```bash
docker run --rm --runtime=sysbox-runc -it konard/hive-mind-dind:latest bash
```

DinD image `konard/hive-mind:latest` से अलग publish होती है, इसलिए जिन्हें nested Docker नहीं चाहिए वे existing lower-privilege image इस्तेमाल कर सकते हैं।

### विकल्प 4: Development Mode (Gitpod-style)

Development उद्देश्यों के लिए, legacy `Dockerfile` एक Gitpod-compatible वातावरण प्रदान करता है:

```bash
# Development image build करें
docker build -t hive-mind-dev .

# Credential mounts के साथ चलाएं
docker run --rm -it \
    -v ~/.config/gh:/home/box/.persisted-configs/gh:ro \
    -v ~/.local/share/claude-profiles:/home/box/.persisted-configs/claude:ro \
    -v ~/.config/claude-code:/home/box/.persisted-configs/claude-code:ro \
    -v "$(pwd)/output:/home/box/output" \
    hive-mind-dev
```

## Authentication

Production Docker image (`Dockerfile`) Ubuntu 24.04 और आधिकारिक installation script का उपयोग करता है। **महत्वपूर्ण:** Authentication Docker image पूरी तरह install और चलने के **बाद container के अंदर** की जाती है।

**Authentication Installation के बाद क्यों होती है:**

- ✅ Interactive prompts के कारण Docker build timeouts से बचाता है
- ✅ CI/CD pipelines में build failures को रोकता है
- ✅ Installation script को सफलतापूर्वक पूर्ण होने की अनुमति देता है
- ✅ स्वचालित Docker image builds का समर्थन करता है

### GitHub Authentication

```bash
# Container के अंदर, AFTER चलने के बाद
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

**नोट:** Installation script जानबूझकर build प्रक्रिया के दौरान `gh auth login` नहीं चलाता। यह timeouts के बिना Docker builds का समर्थन करने के लिए डिज़ाइन द्वारा है।

### Claude Authentication

```bash
# Container के अंदर, AFTER चलने के बाद
claude
```

यह दृष्टिकोण अनुमति देता है:

- ✅ विभिन्न GitHub accounts के साथ कई Docker instances
- ✅ विभिन्न Claude subscriptions के साथ कई Docker instances
- ✅ Containers के बीच कोई credential leakage नहीं
- ✅ प्रत्येक container की अपनी अलग-थलग authentication है
- ✅ Interactive authentication के बिना सफल Docker builds

## पूर्वापेक्षाएं

1. **Docker:** Docker Desktop या Docker Engine (version 20.10 या उच्चतर) install करें
2. **Internet Connection:** Images pull करने और authentication के लिए आवश्यक

## डायरेक्टरी संरचना

```
.
├── Dockerfile                    # Ubuntu 24.04 का उपयोग करने वाला Production image
├── experiments/
│   └── solve-dockerize/
│       └── Dockerfile            # Legacy Gitpod-compatible image (archived)
├── scripts/
│   └── ubuntu-24-server-install.sh  # Dockerfile द्वारा उपयोग किया जाने वाला Installation script
└── docs/
    └── DOCKER.md                 # यह फ़ाइल
```

## उन्नत उपयोग

### Persistent Storage के साथ चलाना

Container restarts के बीच authentication और काम को बनाए रखने के लिए:

```bash
# box user के home directory के लिए एक volume बनाएं
docker volume create box-home

# Volume mount के साथ चलाएं
docker run -it -v box-home:/home/box konard/hive-mind:latest
```

### Detached Mode में चलाना

```bash
# एक detached container शुरू करें
docker run -d --name hive-worker -v box-home:/home/box konard/hive-mind:latest sleep infinity

# चल रहे container में commands execute करें
docker exec -it hive-worker bash

# Container के अंदर, अपने commands चलाएं
solve https://github.com/owner/repo/issues/123
```

### Docker Compose के साथ उपयोग करना

एक `docker-compose.yml` बनाएं:

```yaml
version: '3.8'
services:
  hive-mind:
    image: konard/hive-mind:latest
    volumes:
      - box-home:/home/box
    stdin_open: true
    tty: true

volumes:
  box-home:
```

फिर चलाएं:

```bash
docker-compose run --rm hive-mind
```

## समस्या निवारण

### GitHub Authentication समस्याएं

```bash
# Container के अंदर, authentication स्थिति जांचें
gh auth status

# यदि आवश्यक हो तो फिर से authenticate करें
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

### Claude Authentication समस्याएं

```bash
# Container के अंदर, authenticate करने के लिए Claude फिर से चलाएं
claude
```

### Docker समस्याएं

```bash
# Host पर Docker स्थिति जांचें
docker info

# नवीनतम image pull करें
docker pull konard/hive-mind:latest

# Source से rebuild करें
docker build -t hive-mind:local .
```

### Build समस्याएं

यदि आपको image को स्थानीय रूप से build करने में समस्याएं आती हैं:

1. सुनिश्चित करें कि आपके पास पर्याप्त disk space है (कम से कम 20GB free)
2. अपना internet connection जांचें
3. अधिक verbose output के साथ build करने का प्रयास करें:
   ```bash
   docker build -t hive-mind:local --progress=plain .
   ```

## Docker Hub Publishing के लिए CI/CD कॉन्फ़िगरेशन

यदि आप एक fork बनाए रख रहे हैं या अपने खुद के Docker Hub account पर publish करना चाहते हैं, तो GitHub Actions को कॉन्फ़िगर करने के लिए इन चरणों का पालन करें:

### चरण 1: Docker Hub Account बनाएं

1. [hub.docker.com](https://hub.docker.com) पर जाएं
2. अपने account में sign up करें या log in करें
3. अपना Docker Hub username नोट करें (जैसे, `konard`)

### चरण 2: Docker Hub Access Token Generate करें

1. [hub.docker.com](https://hub.docker.com) पर log in करें
2. ऊपर-दाएं कोने में अपने username पर click करें
3. **Account Settings** → **Security** चुनें
4. **New Access Token** पर click करें
5. एक विवरण दर्ज करें (जैसे, "GitHub Actions - Hive Mind")
6. permissions को **Read, Write, Delete** पर सेट करें (publishing के लिए आवश्यक)
7. **Generate** पर click करें
8. **महत्वपूर्ण:** Token तुरंत copy करें - आप इसे दोबारा नहीं देख पाएंगे!
   - उदाहरण format: `dckr_pat_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p`

### चरण 3: GitHub Repository में Secrets जोड़ें

1. अपनी GitHub repository पर जाएं (जैसे, `https://github.com/konard/hive-mind`)
2. **Settings** → **Secrets and variables** → **Actions** पर click करें
3. **New repository secret** पर click करें
4. निम्नलिखित दो secrets जोड़ें:

   **Secret 1: DOCKERHUB_USERNAME**
   - Name: `DOCKERHUB_USERNAME`
   - Value: आपका Docker Hub username (जैसे, `konard`)
   - **Add secret** पर click करें

   **Secret 2: DOCKERHUB_TOKEN**
   - Name: `DOCKERHUB_TOKEN`
   - Value: चरण 2 में generated access token
   - **Add secret** पर click करें

### चरण 4: Docker Image Name अपडेट करें

यदि fork का उपयोग कर रहे हैं, तो `.github/workflows/docker-publish.yml` में image name अपडेट करें:

```yaml
env:
  REGISTRY: docker.io
  IMAGE_NAME: YOUR_DOCKERHUB_USERNAME/hive-mind # इसे अपने username में बदलें
```

### चरण 5: कॉन्फ़िगरेशन सत्यापित करें

1. `main` branch में changes push करें
2. अपनी GitHub repository में **Actions** tab पर जाएं
3. "Docker Build and Publish" workflow ढूंढें
4. जांचें कि यह सफलतापूर्वक पूर्ण होता है
5. सत्यापित करें कि image [hub.docker.com/r/YOUR_USERNAME/hive-mind](https://hub.docker.com/r/konard/hive-mind) पर दिखाई देती है

### यह कैसे काम करता है

- **Pull Requests पर:** Workflow publish किए बिना Docker image build का परीक्षण करता है
- **Main Branch पर:** Workflow `latest` tag के साथ Docker Hub पर build और publish करता है
- **Version Tags पर:** Workflow semantic version tags के साथ publish करता है (जैसे, `v0.37.0`, `0.37`, `0`)

### CI/CD समस्या निवारण

**Authentication error के साथ Build fail:**

- सत्यापित करें कि `DOCKERHUB_USERNAME` बिल्कुल आपके Docker Hub username से मेल खाता है
- `DOCKERHUB_TOKEN` को regenerate करें और secret अपडेट करें

**Image publish हुई लेकिन pull नहीं हो सकती:**

- सुनिश्चित करें कि Docker Hub पर repository public है (या आप authenticated हैं)
- [hub.docker.com](https://hub.docker.com) → Your repositories → hive-mind → Settings → Make Public जांचें

**Build सफल हुई लेकिन image दिखाई नहीं देती:**

- जांचें कि आप `main` branch में push कर रहे हैं (pull requests केवल परीक्षण करते हैं, publish नहीं करते)
- Actions tab में सत्यापित करें कि workflow चला
- Docker Hub rate limits की जांच करें कि वे पार नहीं हुए हैं

## सुरक्षा नोट्स

- प्रत्येक container अपनी खुद की अलग-थलग authentication बनाए रखता है
- Containers के बीच कोई credentials साझा नहीं किए जाते
- Docker image में कोई credentials संग्रहीत नहीं हैं
- Authentication container शुरू होने के बाद container के अंदर होती है
- प्रत्येक GitHub/Claude account का अपना container instance हो सकता है
- Docker Hub access tokens केवल GitHub Secrets के रूप में संग्रहीत किए जाने चाहिए, कभी भी repository में commit नहीं किए जाने चाहिए
