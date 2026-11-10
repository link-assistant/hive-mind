from pathlib import Path
for path in Path('docs').glob('HELM*.md'):
    text=path.read_text().replace('hive-telegram-bot --token "$TELEGRAM_BOT_TOKEN" --verbose', 'hive-telegram-bot --verbose')
    path.write_text(text)
for path in [Path('.lenv.example'), Path('docs/case-studies/issue-1879/raw/server-setup-gist.txt'), Path('docs/case-studies/issue-1901/data/raw/deploy-gist-67532e7a7090462a618ca86fc00d06a6.txt')]:
    import re
    text=path.read_text()
    # Only the Telegram example value changes; historical evidence remains.
    text=re.sub(r'(?m)^(TELEGRAM_BOT_TOKEN:\s*)[^\r\n]+', r'\g<1>YOUR_TELEGRAM_BOT_TOKEN', text)
    path.write_text(text)
