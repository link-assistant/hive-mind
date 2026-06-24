# Docker आइसोलेशन: DinD बनाम DooD (languages: [en](DOCKER-ISOLATION.md) • [zh](DOCKER-ISOLATION.zh.md) • hi • [ru](DOCKER-ISOLATION.ru.md))

Hive Mind `--isolation docker` के साथ हर टास्क को उसके अपने Docker कंटेनर में चला सकता
है (आसपास के Docker सेटअप के लिए [DOCKER.md](./DOCKER.hi.md) देखें)। यह पेज समझाता है कि
आइसोलेशन किसी Docker daemon से बात करने के **दो तरीकों** — **DinD** और **DooD** — के बीच
क्या ट्रेड‑ऑफ है, और हर एक के लिए सटीक रन रेसिपी क्या है।

> **संक्षेप में** — डिस्क‑सीमित होस्ट पर **DooD** को प्राथमिकता दें: बॉट होस्ट Docker
> daemon को साझा करता है, इसलिए आइसोलेटेड टास्क **होस्ट की इमेज कॉपी को शून्य कॉपी, शून्य
> पुल और शून्य अतिरिक्त डिस्क के साथ पुनः उपयोग** करते हैं। DinD हर बॉट को उसका अपना
> nested daemon देता है पर उसे मल्टी‑GB इमेज की **दूसरी, पूरी कॉपी** रखनी पड़ती है।
> देखें [issue #1962](https://github.com/link-assistant/hive-mind/issues/1962)।

## रनर एक ही है — सिर्फ daemon बदलता है

`--isolation docker` हमेशा start‑command के जरिए **वही** सादा कमांड जारी करता है:

```text
$ --isolated docker --image <ref> [--privileged] --shell sh -e … --volume … \
    --detached --session <uuid> -- '<command>'
```

यानी **जिस भी daemon से बॉट का `docker` बात करता है** उसके विरुद्ध एक सामान्य
`docker run`। मोड पूरी तरह इस बारे में है कि **वह daemon कौन‑सा है**:

| मोड                             | टास्क किस daemon पर चलता है                | इमेज लागत                                                 | प्रति‑टास्क आइसोलेशन                        |
| ------------------------------- | ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------- |
| **DinD** (Docker‑in‑Docker)     | बॉट कंटेनर के अंदर एक **nested** daemon    | इमेज की **पूरी दूसरी कॉपी** nested स्टोर में होनी चाहिए   | प्रति टास्क एक कंटेनर **और** एक निजी daemon |
| **DooD** (Docker‑out‑of‑Docker) | **होस्ट** daemon (उसके सॉकेट के जरिए साझा) | **शून्य** — टास्क होस्ट की मौजूदा इमेज पुनः उपयोग करता है | प्रति टास्क एक कंटेनर; **daemon साझा**      |

दोनों मोड हर टास्क को उसका अपना कंटेनर देते हैं (प्रोसेस / फाइलसिस्टम / नेटवर्क आइसोलेशन)।
फर्क daemon में है: DinD एक को nest करता है (पूरी इमेज कॉपी, अधिक आइसोलेशन); DooD होस्ट
वाले को साझा करता है (शून्य कॉपी, जब खाली डिस्क इमेज की दूसरी कॉपी नहीं रख सकती तब एकमात्र
नो‑कॉपी विकल्प)।

## Hive Mind मोड कैसे चुनता है

Hive Mind प्राथमिकता क्रम में मोड हल करता है:

1. **`HIVE_MIND_DOCKER_ISOLATION_MODE`** — स्पष्ट `dind` या `dood`। असंदिग्ध होने के लिए
   इसका उपयोग करें।
2. **`DIND_SKIP_DAEMON`** truthy — box का DooD स्विच। DinD entrypoint nested daemon
   शुरू करना छोड़ देता है, इसलिए `docker` CLI होस्ट daemon को टारगेट करता है → **DooD**।
3. **`DOCKER_HOST`** किसी non‑nested daemon की ओर इशारा करता है (`tcp://…`, `ssh://…`,
   या ऐसा `unix://` सॉकेट जो in‑container डिफ़ॉल्ट `/var/run/docker.sock` **नहीं** है) →
   **DooD**।
4. अन्यथा → **DinD** (ऐतिहासिक डिफ़ॉल्ट, ताकि मौजूदा डिप्लॉयमेंट अपरिवर्तित रहें)।

`--verbose` (या `TELEGRAM_BOT_VERBOSE=true`) के साथ लॉन्च लॉग हल किया गया मोड और `docker`
किस daemon को टारगेट करता है, यह प्रिंट करता है, ताकि गलत कॉन्फ़िगरेशन तुरंत दिखे।

## DinD रेसिपी (nested daemon)

हर टास्क बॉट कंटेनर के अंदर nested daemon पर चलता है। nested स्टोर शुरू में **खाली** होता
है, इसलिए इमेज को उसमें seed करना होगा (box होस्ट‑इमेज passthrough) वरना पहला टास्क पूरी
मल्टी‑GB इमेज पुल करेगा। यह [DOCKER.md → Host‑image passthrough](./DOCKER.hi.md#host-image-passthrough-avoid-re-downloading-multi-gb-images)
में विस्तार से प्रलेखित है:

```bash
docker run -dit --privileged --name hive-mind --restart unless-stopped \
  # ... आपके सामान्य क्रेडेंशियल माउंट ...
  -v /var/run/docker.sock:/var/run/host-docker.sock:ro \
  -e DIND_HOST_PASSTHROUGH_IMAGES="konard/hive-mind konard/hive-mind-dind" \
  konard/hive-mind-dind:latest bash -l -c 'bash /home/box/start-bot.sh'
```

DinD डुप्लिकेट इमेज के लिए डिस्क लागत लेता है, पर हर बॉट को पूरी तरह निजी daemon मिलता है।
जब daemon आइसोलेशन डिस्क से अधिक महत्वपूर्ण हो तब इसे प्राथमिकता दें।

## DooD रेसिपी (साझा होस्ट daemon) — डिस्क कम हो तो अनुशंसित

बॉट होस्ट Docker सॉकेट को `/var/run/docker.sock` के रूप में माउंट करके और nested daemon को
छोड़कर **होस्ट** daemon साझा करता है। आइसोलेटेड टास्क तब होस्ट daemon पर चलते हैं, **होस्ट
की इमेज को बिना पुल और बिना कॉपी के पुनः उपयोग** करते हुए:

```bash
# होस्ट का docker ग्रुप GID — कंटेनर को माउंटेड सॉकेट पढ़ने के लिए यह चाहिए।
HOST_DOCKER_GID="$(getent group docker | cut -d: -f3)"

docker run -dit --name hive-mind --restart unless-stopped \
  # ... आपके सामान्य क्रेडेंशियल माउंट ...
  -v /var/run/docker.sock:/var/run/docker.sock \
  --group-add "${HOST_DOCKER_GID}" \
  -e DIND_SKIP_DAEMON=1 \
  -e HIVE_MIND_DOCKER_ISOLATION_MODE=dood \
  konard/hive-mind-dind:latest bash -l -c 'bash /home/box/start-bot.sh'
```

मुख्य फ्लैग:

- `-v /var/run/docker.sock:/var/run/docker.sock` — बॉट का `docker` अब **होस्ट** daemon
  से बात करता है (nested से नहीं)।
- `--group-add <host-docker-gid>` — **आवश्यक** ताकि non‑root `box` यूज़र माउंटेड सॉकेट
  पढ़ सके; इसके बिना `docker` परमिशन एरर के साथ विफल हो जाता है।
- `-e DIND_SKIP_DAEMON=1` — DinD इमेज के entrypoint को बताता है कि अपना daemon शुरू न करे
  (nest करने को कुछ नहीं है)।
- `-e HIVE_MIND_DOCKER_ISOLATION_MODE=dood` — मोड को स्पष्ट करता है ताकि डायग्नोस्टिक्स
  **होस्ट** daemon का वर्णन करें और DooD में मौजूद न रहने वाले nested daemon या passthrough
  के बारे में कभी झूठी चेतावनी न दें। (`DIND_SKIP_DAEMON` सेट करना पहले ही DooD अनुमान
  लगाता है; यह उसे असंदिग्ध बनाता है।)

> **एक इमेज, दोनों मोड।** `konard/hive-mind-dind` **किसी भी** मोड में चलती है — फर्क सिर्फ
> ऊपर के रन फ्लैग का है। DooD के लिए अलग इमेज की जरूरत नहीं।

> **सुरक्षा नोट।** DooD होस्ट daemon साझा करता है, इसलिए टास्क होस्ट पर हर कंटेनर और इमेज
> तक पहुँच सकते हैं। इसे उन्हीं होस्ट पर उपयोग करें जिन पर आपका नियंत्रण है और जहाँ वह
> ट्रस्ट सीमा स्वीकार्य हो।

## DooD में क्रेडेंशियल माउंट (होस्ट‑daemon माउंट‑सोर्स जाल)

हर आइसोलेटेड टास्क bot के क्रेडेंशियल कंटेनर में माउंट करता है ताकि `gh`, git और
agent CLI प्रमाणित हो सकें: `~/.config/gh`, `~/.gitconfig`, `~/.config/git`, और —
टूल के अनुसार — `~/.claude` + `~/.claude.json` या `~/.codex`। ये माउंट **सोर्स** bot
के home से हल किए जाते हैं (जैसे `/home/box/.gitconfig`)।

**DinD** में यह सही है: nested daemon bot की फ़ाइल‑सिस्टम साझा करता है, इसलिए
`/home/box/.gitconfig` असली फ़ाइल है। **DooD** में टास्क **होस्ट** daemon पर चलता है, जो
bind‑माउंट सोर्स को **होस्ट** फ़ाइल‑सिस्टम के सापेक्ष हल करता है — जहाँ `/home/box/...`
आम तौर पर मौजूद नहीं होता। तब Docker हर गायब सोर्स को **खाली डायरेक्टरी के रूप में
स्वतः बना देता है**, जो टास्क को दो तरह से तोड़ता है
([issue #1962](https://github.com/link-assistant/hive-mind/issues/1962)):

1. फ़ाइल माउंट (`~/.claude.json`, `~/.gitconfig`) _"Are you trying to mount a
   directory onto a file (or vice‑versa)?"_ के साथ विफल होते हैं — टास्क शुरू होने से
   पहले ही मर जाता है।
2. git पहचान खाली होती है (`fatal: empty ident name (for <>)`) क्योंकि माउंट किया गया
   `~/.gitconfig` एक खाली डायरेक्टरी है।

आपको bot का कॉन्फ़िग **होस्ट पर समान पथों** पर हल करवाना होगा। दो समर्थित तरीके:

**विकल्प A — होस्ट पर समान पथ उजागर करें (symlink काम करते हैं)।** कंटेनर के home
कॉन्फ़िग को समान पथों पर होस्ट में बाइंड करें, या symlink बनाएँ। Docker symlink माउंट
सोर्स का अनुसरण करता है, इसलिए होस्ट के `/home/box/.claude` आदि को वहाँ इंगित करना जहाँ
फ़ाइलें वास्तव में रहती हैं, पर्याप्त है:

```bash
# होस्ट पर, bot द्वारा उपयोग किए जाने वाले समान पथों पर उसके क्रेडेंशियल उजागर करें।
# (यदि आपने bot यूज़र का home बदला है तो /home/box को तदनुसार समायोजित करें।)
sudo mkdir -p /home/box/.config
sudo ln -s /srv/hive-config/.gitconfig   /home/box/.gitconfig
sudo ln -s /srv/hive-config/.claude      /home/box/.claude
sudo ln -s /srv/hive-config/.claude.json /home/box/.claude.json
sudo ln -s /srv/hive-config/.config/gh   /home/box/.config/gh
# ...और Codex टूल के लिए ~/.codex, XDG git कॉन्फ़िग के लिए ~/.config/git।
```

**विकल्प B — Hive Mind को होस्ट कॉन्फ़िग रूट पर इंगित करें (अनुशंसित)।**
`HIVE_MIND_HOST_CONFIG_DIR` को **होस्ट** पर उस डायरेक्टरी पर सेट करें जिसमें bot के
`.gitconfig`, `.claude`, `.claude.json`, `.codex` और `.config/gh` हैं। DooD में Hive
Mind तब सामान्य `~/.x` माउंट सोर्स को bot के home के बजाय उस रूट के सापेक्ष हल करता है,
इसलिए होस्ट daemon असली फ़ाइलें बाइंड करता है:

```bash
docker run -dit --name hive-mind --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --group-add "${HOST_DOCKER_GID}" \
  -e DIND_SKIP_DAEMON=1 \
  -e HIVE_MIND_DOCKER_ISOLATION_MODE=dood \
  -e HIVE_MIND_HOST_CONFIG_DIR=/srv/hive-config \
  konard/hive-mind-dind:latest bash -l -c 'bash /home/box/start-bot.sh'
```

`HIVE_MIND_HOST_CONFIG_DIR` केवल DooD में प्रभावी होता है (DinD हमेशा bot का home उपयोग
करता है, क्योंकि वहाँ सोर्स असली हैं)। चूँकि bot होस्ट‑daemon पथों को stat नहीं कर
सकता, पुनर्स्थापित सोर्स bot‑साइड अस्तित्व जाँच को छोड़ देते हैं और आपके होस्ट लेआउट पर
भरोसा करते हैं — सुनिश्चित करें कि हर फ़ाइल/डायरेक्टरी सही प्रकार के साथ मौजूद है (जैसे
`.claude.json` एक **फ़ाइल** है, `.claude` एक **डायरेक्टरी** है)।

स्टार्टअप प्रीफ़्लाइट DooD का पता लगाता है और, जब माउंट सोर्स अभी भी bot के home पथ हैं
और `HIVE_MIND_HOST_CONFIG_DIR` अनसेट है, पहले टास्क से पहले चेतावनी देता है — कच्चे
Docker माउंट विफलता को एक कार्रवाई‑योग्य संदेश में बदल देता है।

## `~/.gitconfig` राइट जाल (`Device or resource busy`)

`~/.gitconfig` एकमात्र ऐसा क्रेडेंशियल है जो **लिखने‑योग्य सिंगल‑फ़ाइल bind माउंट
नहीं हो सकता**। `git config --global` — जिसे `gh-setup-git-identity --repair` चलाता है,
और जिसे bot की स्टार्टअप git‑पहचान प्रीफ़्लाइट तब आह्वान करती है जब कोई पहचान मौजूद नहीं
होती — फ़ाइल को **यथास्थान संपादित नहीं करता**। यह एक temp फ़ाइल लिखता है और उसे
**`rename()` करके `~/.gitconfig` के ऊपर रख देता है**, और किसी **mountpoint के ऊपर**
rename विफल हो जाता है:

```text
error: could not write config file /home/box/.gitconfig: Device or resource busy
```

(`git config` 4 के साथ बाहर निकलता है।) इसलिए यदि `~/.gitconfig` एक सिंगल‑फ़ाइल bind
माउंट है — या ऐसा symlink जो किसी ऐसी फ़ाइल पर हल होता है — तो उसके विरुद्ध कोई भी
`git config --global` मर जाता है। इसके विपरीत `~/.claude.json` को agent टूलिंग
**यथास्थान** पुनर्लिखित करती है, इसलिए वहाँ सिंगल‑फ़ाइल माउंट ठीक है; `.gitconfig`
एटॉमिक rename के कारण विशेष है।

ऊपर की रेसिपी के लिए दो परिणाम:

1. **आइसोलेटेड टास्क `~/.gitconfig` को read‑only माउंट करता है।** Hive Mind git पहचान
   (`~/.gitconfig`, `~/.config/git`) को हर टास्क में `:ro` के साथ बाइंड करता है: टास्क
   कमिट करने के लिए पहचान केवल **पढ़ता** है, और `:ro` माउंट किसी भी भटके हुए
   राइट‑थ्रू‑द‑माउंट को रन के बीच में नहीं बल्कि तुरंत और सुपाठ्य रूप से विफल कर देता है।
2. **bot को उसकी पहचान माउंट की गई फ़ाइल _के माध्यम से_ पॉपुलेट न करने दें।** जिस पथ पर
   `gh-setup-git-identity` / `git config --global` लिखता है, वह bind माउंट (या उस पर
   इंगित करने वाला symlink) **नहीं** होना चाहिए। इनमें से एक चुनें:
   - **राइट‑फिर‑कॉपी (अनुशंसित)।** `gh-setup-git-identity` को `~/.gitconfig` कंटेनर के
     **अपने** फ़ाइल‑सिस्टम पर लिखने दें (कोई माउंट नहीं → rename सफल होता है), फिर उसे
     उस होस्ट पथ पर कॉपी कर दें जिसे टास्क read‑only माउंट करता है। टास्क उसे केवल पढ़ता
     है, इसलिए वहाँ `:ro` फ़ाइल माउंट सही है।
   - **फ़ाइल नहीं, डायरेक्टरी माउंट करें।** `GIT_CONFIG_GLOBAL` को किसी **माउंट की गई
     डायरेक्टरी** के अंदर की फ़ाइल पर इंगित करें (जैसे
     `GIT_CONFIG_GLOBAL=/home/box/.gitcfg/config` जहाँ `.gitcfg/` bind माउंट है)। माउंट
     की गई डायरेक्टरी **के अंदर** फ़ाइलों का rename काम करता है; केवल mountpoint के ऊपर
     rename ही विफल होता है। एक ही `GIT_CONFIG_GLOBAL` को bot और आइसोलेटेड टास्क दोनों को
     मानना चाहिए।

   यदि आप ऊपर वाला **विकल्प A symlink** लेआउट उपयोग करते हैं, तो `~/.gitconfig` को ऐसी
   फ़ाइल पर इंगित करें जिसे bot **लिखता नहीं** (एक पूर्व‑पॉपुलेटेड, read‑only पहचान),
   वरना पहला `git config --global` जाल में फँस जाएगा।

देखें [issue #1962](https://github.com/link-assistant/hive-mind/issues/1962) और संबंधित
box / command‑stream जाँचें।

## सटीक‑टैग आवश्यकता (दोनों मोड)

`resolveDockerIsolationImageTag()` हर टास्क को **सटीक**
`HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` (जैसे `konard/hive-mind-dind:2.0.13`) माँगने पर
मजबूर करता है, फ्लोटिंग `:latest` नहीं। शून्य‑कॉपी पुनः उपयोग के लिए daemon को **वह सटीक
टैग** रखना चाहिए:

- **DooD** — टास्क शुरू करने से पहले **होस्ट** पर सटीक टैग पुल करें:
  ```bash
  docker pull konard/hive-mind-dind:2.0.13
  ```
- **DinD** — **nested** daemon को सटीक टैग से seed करें (passthrough या [DOCKER.md](./DOCKER.hi.md#host-image-passthrough-avoid-re-downloading-multi-gb-images)
  में प्रीलोड स्क्रिप्ट)।

रिलीज़ इमेज प्रकाशित `HIVE_MIND_VERSION` से `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` को bake
करती हैं, इसलिए `:latest` के रूप में शुरू हुआ पैरेंट भी चाइल्ड कंटेनरों को उसी अपरिवर्तनीय
रिलीज़ टैग से लॉन्च करता है। अपने डिप्लॉय में उस हल किए गए वर्शन को पिन करें; यदि daemon के
पास केवल `:latest` है, तो digest drift एक नया मल्टी‑गीगाबाइट पुल बाध्य कर देता है।

## DooD पुनः उपयोग सत्यापित करना (कोई मूक री‑पुल नहीं)

दो जाँचें पुष्टि करती हैं कि बॉट DooD में है और होस्ट इमेज पुनः उपयोग करेगा:

```bash
# 1. बॉट का docker होस्ट daemon तक पहुँचता है (DooD एक्सेस ठीक)।
docker exec hive-mind docker info >/dev/null && echo "DooD docker access OK"

# 2. उस daemon पर सटीक आइसोलेशन टैग पहले से मौजूद है (शून्य‑कॉपी पुनः उपयोग)।
TAG="$(docker exec hive-mind printenv HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG || true)"
docker exec hive-mind docker image inspect "konard/hive-mind-dind:${TAG:-latest}" >/dev/null \
  && echo "इमेज होस्ट daemon पर मौजूद → शून्य‑कॉपी, पहले टास्क पर कोई पुल नहीं"
```

स्टार्टअप प्रीफ्लाइट स्वतः समतुल्य प्रोब करता है और DooD मोड में लॉग करता है:

- ✅ इमेज **होस्ट** daemon पर मौजूद → टास्क उसे पुनः उपयोग करते हैं (शून्य कॉपी / शून्य पुल);
- ⚠️ इमेज होस्ट daemon पर **अनुपस्थित** → होस्ट पर सटीक टैग पुल करें और
  `HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG` पिन करें (यह DooD में मौजूद न रहने वाले nested
  daemon या passthrough का कभी उल्लेख नहीं करता);
- ⚠️ होस्ट daemon `vfs` स्टोरेज ड्राइवर पर / कम खाली डिस्क → सामान्य डिस्क‑ओवरफ्लो
  चेतावनियाँ, **होस्ट** daemon की ओर इंगित।

## संबंधित

- [DOCKER.md](./DOCKER.hi.md) — सामान्य Docker सेटअप, DinD इमेज, और DinD के लिए होस्ट‑इमेज
  passthrough।
- [issue #1962](https://github.com/link-assistant/hive-mind/issues/1962) — दोनों मोड को
  समर्थन और प्रलेखित करने का अनुरोध।
- [issue #1914](https://github.com/link-assistant/hive-mind/issues/1914),
  [#1879](https://github.com/link-assistant/hive-mind/issues/1879),
  [#1946](https://github.com/link-assistant/hive-mind/issues/1946) — DinD इमेज‑पुनः
  उपयोग / डिस्क कार्य जिस पर यह आधारित है।
