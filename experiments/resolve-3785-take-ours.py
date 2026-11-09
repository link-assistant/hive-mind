import re, sys
# Resolve conflict hunks by taking HEAD ("ours") side, then apply version substitutions.
subs = [(r'FORMAL_AI_VERSION=0\.355\.29', 'FORMAL_AI_VERSION=0.355.34'),
        (r'@link-assistant/agent@0\.27\.0', '@link-assistant/agent@0.27.1'),
        (r'start-command@0\.42\.0', 'start-command@0.43.0')]
for path in sys.argv[1:]:
    s = open(path).read()
    s = re.sub(r'^<<<<<<< HEAD\n(.*?)^=======\n.*?^>>>>>>> origin/main\n', lambda m: m.group(1), s, flags=re.S|re.M)
    for a, b in subs: s = re.sub(a, b, s)
    open(path, 'w').write(s)
