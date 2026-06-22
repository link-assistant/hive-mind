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

यह image inner Docker daemon को default रूप से `DIND_STORAGE_DRIVER=fuse-overlayfs` पर चलाती है। यह एक **copy-on-write** driver है, इसलिए कई गीगाबाइट की Hive Mind images डिस्क पर लगभग अपने असली आकार जितनी ही जगह (एक बार) लेती हैं — जबकि `vfs` हर layer की पूरी copy बनाता है और on-disk footprint को image आकार के कई गुना तक बढ़ा देता है, जिससे डिस्क `failed to register layer: no space left on device` के साथ भर जाती है ([issue #1914](https://github.com/link-assistant/hive-mind/issues/1914))। `fuse-overlayfs` overlay-on-overlay भी काम करता है (वही compatibility जिसके लिए शुरू में `vfs` चुना गया था), image में `fuse-overlayfs` binary पहले से मौजूद है, और Hive Mind DinD container को `--privileged` के साथ launch करता है, इसलिए `/dev/fuse` उपलब्ध रहता है। Override विकल्प:

- `-e DIND_STORAGE_DRIVER=overlay2` — nested overlay mounts को support करने वाले hosts पर तेज़, लेकिन overlay-backed hosts पर fail हो सकता है;
- `-e DIND_STORAGE_DRIVER=vfs` — केवल अंतिम विकल्प (compatibility fallback); कई गुना ज़्यादा डिस्क लेता है और यही वह configuration है जिसने issue #1914 पैदा किया।

> **पुरानी `vfs` image पर container पहले से चल रहा है?** bot container के `docker run` में `-e DIND_STORAGE_DRIVER=fuse-overlayfs` जोड़ें और container को फिर से बनाएं — image rebuild की ज़रूरत नहीं।

Shared hosts पर, उपलब्ध हो तो Sysbox runtime को प्राथमिकता दें:

```bash
docker run --rm --runtime=sysbox-runc -it konard/hive-mind-dind:latest bash
```

DinD image `konard/hive-mind:latest` से अलग publish होती है, इसलिए जिन्हें nested Docker नहीं चाहिए वे existing lower-privilege image इस्तेमाल कर सकते हैं।

#### Host-image passthrough (मल्टी-GB images फिर से download होने से बचाएं)

जब bot release DinD image के अंदर `--isolation docker` के साथ चलता है, तो हर task एक _nested_
`docker run konard/hive-mind-dind:<release-tag> …` के रूप में launch होता है। Release images
published `HIVE_MIND_VERSION` से `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` bake करती हैं, इसलिए
`konard/hive-mind-dind:latest` से started parent container भी child containers के लिए वही
immutable release tag उपयोग करता है। वह nested `docker run` **inner** dockerd से बात करता है,
जिसका image store शुरू में **खाली** होता है (deploy `docker commit` से पहले `/var/lib/docker`
को wipe कर देता है)। इसलिए Docker `Unable to find image '…' locally` report करता है और एक
नई copy pull करता है — और Hive Mind images कई gigabytes की होती हैं, इसलिए पहला isolated task
एक ऐसी image को re-download करने में बहुत समय लगा सकता है (या disk खत्म कर सकता है) जो
**host के पास पहले से मौजूद** है। देखें
[issue #1914](https://github.com/link-assistant/hive-mind/issues/1914) और
[#1879](https://github.com/link-assistant/hive-mind/issues/1879)।

Base image (`konard/box-dind`) inner daemon को host से अपने आप seed कर सकती है —
**host-image passthrough** — लेकिन केवल तभी जब host का Docker socket container में
bind-mount किया गया हो। **socket mount के बिना, passthrough एक silent no-op है** और
inner daemon खाली रहता है। इसे mount करें और allowlist set करें:

```bash
docker run -dit --privileged --name hive-mind --restart unless-stopped \
  # ... आपके सामान्य credential mounts ...
  -v /var/run/docker.sock:/var/run/host-docker.sock:ro \
  -e DIND_HOST_PASSTHROUGH_IMAGES="konard/hive-mind konard/hive-mind-dind" \
  konard/hive-mind-dind:latest bash -l -c 'bash /home/box/start-bot.sh'
```

Passthrough इन environment variables से नियंत्रित होता है (`box-dind` द्वारा honor किए जाते हैं):

| Variable                           | Default                     | उद्देश्य                                                                             |
| ---------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `DIND_HOST_PASSTHROUGH`            | `public`                    | `off`, `public` (केवल public-registry digest वाली images copy करें), या `all`।       |
| `DIND_HOST_DOCKER_SOCK`            | `/var/run/host-docker.sock` | container के अंदर host socket कहाँ mount है। Hive Mind भी यही variable पढ़ता है।     |
| `DIND_HOST_PASSTHROUGH_IMAGES`     | _(खाली = कोई भी)_           | space-separated image-name allowlist, जैसे `konard/hive-mind konard/hive-mind-dind`। |
| `DIND_HOST_PASSTHROUGH_REGISTRIES` | _(खाली)_                    | `public` mode के लिए optional registry allowlist।                                    |

default `public` mode में, केवल वे images copy होती हैं जिनमें public registry का digest होता है,
इसलिए host copy एक pulled/pushed image होनी चाहिए (केवल local `docker build` से बनी, बिना
`RepoDigest` वाली image skip हो जाएगी — पहले उसे push करें या `all` उपयोग करें)।

release deployments में final bot container start होने से पहले host पर exact child tag भी
मौजूद होना चाहिए। केवल `:latest` pull करना अब काफी नहीं है, क्योंकि release image
`HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` pin करती है:

```bash
TAG="$(docker image inspect konard/hive-mind-dind:latest \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG=//p' \
  | tail -1)"
docker pull "konard/hive-mind-dind:${TAG:-latest}"
```

**Startup preflight.** जब `--isolation docker` enabled होता है, bot startup पर inner daemon को
probe करके result log करता है, ताकि misconfiguration task के बीच में surprise pull बनने के बजाय
तुरंत सामने आ जाए:

- ✅ image पहले से मौजूद → isolated tasks उसे reuse करते हैं (कोई pull नहीं);
- ⚠️ socket mount **नहीं** है → यह आपको socket mount + allowlist जोड़ने को कहता है;
- ⚠️ socket mounted है पर image अब भी absent → यह आपको passthrough mode/allowlist/digest जाँचने को कहता है;
- ⚠️ inner daemon `vfs` storage driver पर है → यह आपको `fuse-overlayfs` पर switch करने को कहता है (issue #1914 की disk-amplification root cause);
- ⚠️ Docker data root पर कम free space और image अब भी absent → यह चेतावनी देता है कि आने वाला pull डिस्क खत्म कर सकता है।

underlying `docker image inspect` traces के लिए bot को `--verbose` (या `TELEGRAM_BOT_VERBOSE=true`) के साथ चलाएं।

**Manual fallback.** पहले से चल रहे container को तुरंत seed करने के लिए (या जब आप deployment नहीं बदल
सकते), host image को inner daemon में copy करें:

```bash
TAG="$(docker exec hive-mind printenv HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG || true)"
node scripts/preload-dind-isolation-image.mjs \
  --container hive-mind --image "konard/hive-mind-dind:${TAG:-latest}"
```

यह `docker save … | docker exec -i <container> docker load` stream करता है ताकि tarball कभी disk पर
न लिखा जाए, और अगर inner daemon के पास image पहले से है तो यह no-op है। image मौजूद होने के बाद,
start-command का native Docker backend उसे अपने आप reuse करता है (Docker की default "missing" pull
policy — यह केवल तभी pull करता है जब image absent हो, इसलिए कोई re-download नहीं होता)।

#### Docker आइसोलेशन मोड: DinD बनाम DooD

ऊपर का होस्ट‑इमेज passthrough **DinD** (Docker-in-Docker) वाली कहानी है: बॉट अपना **nested**
daemon चलाता है और मल्टी‑GB इमेज को उसमें कॉपी करना पड़ता है। डिस्क‑सीमित होस्ट पर वह कॉपी
अनुपयोगी हो सकती है (हमने ~41 GB खाली वाले होस्ट पर ~19.5 GB डुप्लिकेट मापा)। वही इमेज **DooD**
(Docker-out-of-Docker) मोड में भी चलती है, जहाँ बॉट **होस्ट daemon साझा** करता है और आइसोलेटेड
टास्क होस्ट की इमेज कॉपी को **शून्य कॉपी, शून्य पुल, शून्य अतिरिक्त डिस्क** के साथ पुनः उपयोग
करते हैं — हर टास्क फिर भी अपने कंटेनर में चलता है; केवल daemon साझा होता है। जब खाली डिस्क इमेज
की दूसरी कॉपी नहीं रख सकती तब DooD अनुशंसित मोड है।

बॉट को DooD मोड में चलाने के लिए, होस्ट Docker सॉकेट को `/var/run/docker.sock` के रूप में माउंट
करें, होस्ट docker ग्रुप जोड़ें, और nested daemon छोड़ें:

```bash
HOST_DOCKER_GID="$(getent group docker | cut -d: -f3)"

docker run -dit --name hive-mind --restart unless-stopped \
  # ... आपके सामान्य क्रेडेंशियल माउंट ...
  -v /var/run/docker.sock:/var/run/docker.sock \
  --group-add "${HOST_DOCKER_GID}" \
  -e DIND_SKIP_DAEMON=1 \
  -e HIVE_MIND_DOCKER_ISOLATION_MODE=dood \
  konard/hive-mind-dind:latest bash -l -c 'bash /home/box/start-bot.sh'
```

**दोनों** मोड में daemon को **सटीक** `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` (कभी फ्लोटिंग
`:latest` नहीं) रखना चाहिए वरना पहला टास्क री‑पुल करता है — DooD में, होस्ट पर
`docker pull konard/hive-mind-dind:<version>`। स्टार्टअप प्रीफ्लाइट अपनी शब्दावली मोड अनुसार
बदलता है (DooD में यह **होस्ट** daemon और सटीक‑टैग मार्गदर्शन रिपोर्ट करता है, वहाँ अप्रासंगिक
nested‑daemon / passthrough उपाय कभी नहीं)।

> 📖 **पूरा गाइड:** DinD‑बनाम‑DooD ट्रेड‑ऑफ, दोनों रन रेसिपी, `--group-add` सॉकेट आवश्यकता, और
> होस्ट इमेज मूक री‑पुल के बजाय पुनः उपयोग होती है यह कैसे सत्यापित करें, के लिए
> [DOCKER-ISOLATION.md](./DOCKER-ISOLATION.hi.md) देखें।

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

## Docker में Playwright MCP State

Image build अब Claude और Codex दोनों के लिए Playwright MCP register करता है:

- `claude mcp add playwright -s user -- ...`
- `codex mcp add playwright -- ...`

CI workflow Docker image भी build करता है और verify करता है कि:

- `playwright --version` CLI fallback के रूप में काम करता है;
- `npx --no-install @playwright/mcp --help` MCP package को reinstall किए बिना काम करता है;
- `claude mcp list` Playwright server को connected/enabled दिखाता है, pending या unavailable नहीं;
- `codex mcp list` Playwright server को connected/enabled दिखाता है, pending या unavailable नहीं।

यदि running container में `codex mcp list` अभी भी `No MCP servers configured yet` दिखाता है, तो सबसे संभावित root cause host से mounted `/home/box/.codex` directory है। इस image में `HOME=/home/box` है, इसलिए `/home/box/.codex` mount करने से image-baked Codex config replace हो जाता है, जिसमें preconfigured MCP entries भी शामिल हैं।

इसका अर्थ है:

- published image सही हो सकती है;
- runtime container फिर भी Codex को unconfigured दिखा सकता है;
- अंतर persisted host state के container defaults को override करने से आता है।

इसे जल्दी confirm करने के लिए इन दो cases की तुलना करें:

```bash
# Host-mounted Codex state के बिना fresh container
docker run --rm -it konard/hive-mind:latest bash -lc 'codex mcp list'

# Host से persisted Codex state के साथ container
docker run --rm -it \
  -v /root/.hive-mind/codex:/home/box/.codex \
  konard/hive-mind:latest \
  bash -lc 'codex mcp list'
```

यदि पहला command `playwright` दिखाता है और दूसरा नहीं, तो host-mounted Codex directory mismatch का source है।

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

यदि persisted `/home/box/.codex/config.toml` किसी पुराने image से आया है, तो उसमें newer images द्वारा जोड़ी गई Playwright MCP registration नहीं हो सकती। Container start होने के बाद फिर से चलाएं:

```bash
codex mcp add playwright -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080
```

जब `codex mcp list` में Playwright row नहीं होती और `@playwright/mcp` installed होता है, तब Hive Mind runtime पर भी यह default registration repair try करता है। यह existing pending, disabled, या customized Playwright row को overwrite नहीं करता; उन states के लिए MCP startup path को सीधे debug करना होगा।

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
