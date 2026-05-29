// UI copy for the Hive Mind download page, in the same four languages the
// repository maintains READMEs for (English, Russian, Chinese, Hindi).

export const locales = ['en', 'ru', 'zh', 'hi'];

export const copy = {
  en: {
    eyebrow: 'AI-powered issue solver',
    title: 'Hive Mind',
    summary: 'A command-line hive mind that reads GitHub issues, plans a fix, and opens pull requests — running the same way on macOS, Windows, and Linux.',
    release: 'Latest release',
    statusReady: 'Latest version',
    statusLoading: 'Checking latest release…',
    statusFallback: 'Open releases on GitHub',
    primaryAction: 'Install on',
    chooseOs: 'Choose your operating system',
    copy: 'Copy',
    copied: 'Copied',
    osMacos: 'macOS',
    osWindows: 'Windows',
    osLinux: 'Linux',
    prereqTitle: 'Prerequisites',
    prereqNode: 'Node.js 24+ (includes npm). Install from nodejs.org or your package manager.',
    prereqDocker: 'Or Docker, if you prefer a fully isolated, pre-configured environment.',
    methodsTitle: 'Install methods',
    methodNpm: 'Global install (npm)',
    methodNpmNote: 'Installs the hive, solve, task and review commands globally.',
    methodNpx: 'Run without installing (npx)',
    methodNpxNote: 'Try it once without adding anything to your system.',
    methodDocker: 'Docker',
    methodDockerNote: 'Recommended for servers — fully isolated with the toolchain pre-installed.',
    osNotesTitle: 'Platform notes',
    notesMacos: 'Install Node.js with Homebrew (brew install node) or from nodejs.org, then run the command in Terminal.',
    notesWindows: 'Install Node.js with winget (winget install OpenJS.NodeJS) or from nodejs.org, then run the command in PowerShell.',
    notesLinux: 'Install Node.js with your package manager or nvm, then run the command in your shell. Docker is recommended for servers.',
    verifyTitle: 'Verify your install',
    verifyIntro: 'After installing, confirm the CLI is on your PATH and reports a version:',
    linksTitle: 'Resources',
    linkNpm: 'npm package',
    linkDocker: 'Docker image',
    linkRepo: 'Source on GitHub',
    linkReleases: 'All releases',
    linkDocs: 'Documentation',
    terminalTitle: 'hive-mind',
    footer: 'Free and open source. Released under the Unlicense.',
  },
  ru: {
    eyebrow: 'AI-решатель задач',
    title: 'Hive Mind',
    summary: 'Командный «коллективный разум»: читает задачи на GitHub, планирует исправление и открывает пул-реквесты — одинаково на macOS, Windows и Linux.',
    release: 'Последний релиз',
    statusReady: 'Последняя версия',
    statusLoading: 'Проверяем последний релиз…',
    statusFallback: 'Открыть релизы на GitHub',
    primaryAction: 'Установить на',
    chooseOs: 'Выберите операционную систему',
    copy: 'Копировать',
    copied: 'Скопировано',
    osMacos: 'macOS',
    osWindows: 'Windows',
    osLinux: 'Linux',
    prereqTitle: 'Требования',
    prereqNode: 'Node.js 24+ (включает npm). Установите с nodejs.org или через менеджер пакетов.',
    prereqDocker: 'Либо Docker, если нужна полностью изолированная, готовая среда.',
    methodsTitle: 'Способы установки',
    methodNpm: 'Глобальная установка (npm)',
    methodNpmNote: 'Устанавливает команды hive, solve, task и review глобально.',
    methodNpx: 'Запуск без установки (npx)',
    methodNpxNote: 'Попробуйте один раз, ничего не добавляя в систему.',
    methodDocker: 'Docker',
    methodDockerNote: 'Рекомендуется для серверов — полная изоляция и предустановленный инструментарий.',
    osNotesTitle: 'Замечания по платформе',
    notesMacos: 'Установите Node.js через Homebrew (brew install node) или с nodejs.org, затем выполните команду в Терминале.',
    notesWindows: 'Установите Node.js через winget (winget install OpenJS.NodeJS) или с nodejs.org, затем выполните команду в PowerShell.',
    notesLinux: 'Установите Node.js через менеджер пакетов или nvm, затем выполните команду в оболочке. Для серверов рекомендуется Docker.',
    verifyTitle: 'Проверка установки',
    verifyIntro: 'После установки убедитесь, что CLI доступен в PATH и сообщает версию:',
    linksTitle: 'Ресурсы',
    linkNpm: 'Пакет npm',
    linkDocker: 'Docker-образ',
    linkRepo: 'Исходный код на GitHub',
    linkReleases: 'Все релизы',
    linkDocs: 'Документация',
    terminalTitle: 'hive-mind',
    footer: 'Свободное ПО с открытым кодом. Лицензия Unlicense.',
  },
  zh: {
    eyebrow: 'AI 驱动的问题求解器',
    title: 'Hive Mind',
    summary: '一个命令行「蜂群思维」：读取 GitHub issue、规划修复并提交 pull request——在 macOS、Windows 和 Linux 上运行方式一致。',
    release: '最新版本',
    statusReady: '最新版本',
    statusLoading: '正在检查最新版本…',
    statusFallback: '在 GitHub 上查看发布',
    primaryAction: '安装到',
    chooseOs: '选择你的操作系统',
    copy: '复制',
    copied: '已复制',
    osMacos: 'macOS',
    osWindows: 'Windows',
    osLinux: 'Linux',
    prereqTitle: '前置条件',
    prereqNode: 'Node.js 24+（自带 npm）。可从 nodejs.org 或包管理器安装。',
    prereqDocker: '或者使用 Docker，如果你更喜欢完全隔离、预配置的环境。',
    methodsTitle: '安装方式',
    methodNpm: '全局安装（npm）',
    methodNpmNote: '全局安装 hive、solve、task 和 review 命令。',
    methodNpx: '无需安装直接运行（npx）',
    methodNpxNote: '一次性试用，无需向系统添加任何内容。',
    methodDocker: 'Docker',
    methodDockerNote: '推荐用于服务器——完全隔离并预装工具链。',
    osNotesTitle: '平台说明',
    notesMacos: '用 Homebrew（brew install node）或从 nodejs.org 安装 Node.js，然后在终端运行命令。',
    notesWindows: '用 winget（winget install OpenJS.NodeJS）或从 nodejs.org 安装 Node.js，然后在 PowerShell 运行命令。',
    notesLinux: '用包管理器或 nvm 安装 Node.js，然后在 shell 中运行命令。服务器推荐使用 Docker。',
    verifyTitle: '验证安装',
    verifyIntro: '安装后，确认 CLI 已在 PATH 中并能报告版本：',
    linksTitle: '资源',
    linkNpm: 'npm 包',
    linkDocker: 'Docker 镜像',
    linkRepo: 'GitHub 源码',
    linkReleases: '所有发布',
    linkDocs: '文档',
    terminalTitle: 'hive-mind',
    footer: '自由开源软件，基于 Unlicense 发布。',
  },
  hi: {
    eyebrow: 'AI-संचालित इश्यू सॉल्वर',
    title: 'Hive Mind',
    summary: 'एक कमांड-लाइन «हाइव माइंड» जो GitHub इश्यू पढ़ता है, समाधान की योजना बनाता है और pull request खोलता है — macOS, Windows और Linux पर एक ही तरह से चलता है।',
    release: 'नवीनतम रिलीज़',
    statusReady: 'नवीनतम संस्करण',
    statusLoading: 'नवीनतम रिलीज़ जाँची जा रही है…',
    statusFallback: 'GitHub पर रिलीज़ खोलें',
    primaryAction: 'इंस्टॉल करें',
    chooseOs: 'अपना ऑपरेटिंग सिस्टम चुनें',
    copy: 'कॉपी',
    copied: 'कॉपी हो गया',
    osMacos: 'macOS',
    osWindows: 'Windows',
    osLinux: 'Linux',
    prereqTitle: 'आवश्यकताएँ',
    prereqNode: 'Node.js 24+ (npm सहित)। nodejs.org या अपने पैकेज मैनेजर से इंस्टॉल करें।',
    prereqDocker: 'या Docker, यदि आप पूरी तरह अलग, पहले से कॉन्फ़िगर वातावरण पसंद करते हैं।',
    methodsTitle: 'इंस्टॉल के तरीके',
    methodNpm: 'ग्लोबल इंस्टॉल (npm)',
    methodNpmNote: 'hive, solve, task और review कमांड ग्लोबल रूप से इंस्टॉल करता है।',
    methodNpx: 'बिना इंस्टॉल किए चलाएँ (npx)',
    methodNpxNote: 'सिस्टम में कुछ जोड़े बिना एक बार आज़माएँ।',
    methodDocker: 'Docker',
    methodDockerNote: 'सर्वर के लिए अनुशंसित — टूलचेन पहले से इंस्टॉल और पूरी तरह अलग।',
    osNotesTitle: 'प्लेटफ़ॉर्म नोट्स',
    notesMacos: 'Homebrew (brew install node) या nodejs.org से Node.js इंस्टॉल करें, फिर Terminal में कमांड चलाएँ।',
    notesWindows: 'winget (winget install OpenJS.NodeJS) या nodejs.org से Node.js इंस्टॉल करें, फिर PowerShell में कमांड चलाएँ।',
    notesLinux: 'अपने पैकेज मैनेजर या nvm से Node.js इंस्टॉल करें, फिर शेल में कमांड चलाएँ। सर्वर के लिए Docker अनुशंसित है।',
    verifyTitle: 'अपना इंस्टॉल सत्यापित करें',
    verifyIntro: 'इंस्टॉल के बाद, पुष्टि करें कि CLI आपके PATH में है और संस्करण बताता है:',
    linksTitle: 'संसाधन',
    linkNpm: 'npm पैकेज',
    linkDocker: 'Docker इमेज',
    linkRepo: 'GitHub पर सोर्स',
    linkReleases: 'सभी रिलीज़',
    linkDocs: 'दस्तावेज़',
    terminalTitle: 'hive-mind',
    footer: 'मुफ़्त और ओपन सोर्स। Unlicense के तहत जारी।',
  },
};

export function detectLocale(navigatorLike) {
  const nav = navigatorLike || (typeof navigator !== 'undefined' ? navigator : undefined);
  const languages = nav?.languages || (nav?.language ? [nav.language] : ['en']);

  for (const language of languages) {
    const code = String(language || '').toLowerCase();

    if (code.startsWith('ru')) {
      return 'ru';
    }

    if (code.startsWith('zh')) {
      return 'zh';
    }

    if (code.startsWith('hi')) {
      return 'hi';
    }

    if (code.startsWith('en')) {
      return 'en';
    }
  }

  return 'en';
}

export function text(locale, key) {
  return copy[locale]?.[key] ?? copy.en[key] ?? key;
}
