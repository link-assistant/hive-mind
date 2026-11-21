"""Network confinement shared by disposable native Codex process fixtures."""
from urllib.parse import urlsplit

BACKGROUND_PATHS = frozenset([
    '/backend-api/plugins/featured', '/backend-api/ps/plugins/installed',
    '/backend-api/wham/accounts/check', '/backend-api/wham/settings/user',
    '/backend-api/codex/analytics-events/events',
])
BLOCKED_ORIGINS = frozenset(['github.com:443', 'api.github.com:443', 'chatgpt.com:443', 'raw.githubusercontent.com:443'])


def environment(port):
    endpoint = f'http://127.0.0.1:{port}'
    return {
        'HTTP_PROXY': endpoint, 'HTTPS_PROXY': endpoint, 'ALL_PROXY': endpoint,
        'NO_PROXY': '127.0.0.1,localhost',
        'CODEX_REFRESH_TOKEN_URL_OVERRIDE': endpoint + '/forbidden-refresh',
        'CODEX_AUTHAPI_BASE_URL': endpoint + '/forbidden-auth',
        'CODEX_AGENT_IDENTITY_AUTHAPI_BASE_URL': endpoint + '/forbidden-identity',
        'CODEX_AGENT_IDENTITY_JWKS_BASE_URL': endpoint + '/backend-api',
    }


def refuse_connect(handler, invalid):
    # Every tunnel stops before TLS or credentials. Nothing is forwarded.
    if handler.path not in BLOCKED_ORIGINS:
        invalid.append(('CONNECT', handler.path[:200]))
    handler.send_response(403)
    handler.send_header('Connection', 'close')
    handler.end_headers()
    handler.close_connection = True


def background(handler):
    if urlsplit(handler.path).path not in BACKGROUND_PATHS:
        return False
    handler.send_response(404)
    handler.send_header('Content-Length', '0')
    handler.send_header('Connection', 'close')
    handler.end_headers()
    handler.close_connection = True
    return True
