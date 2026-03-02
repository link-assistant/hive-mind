# Technical Summary: Private GitHub Image Authentication Issue

## The Authentication Problem

GitHub stores issue/PR attachments at URLs like:
```
https://github.com/user-attachments/assets/<uuid>
```

### What happens without authentication

```bash
$ curl -L -o image.png "https://github.com/user-attachments/assets/f3a85d78-f0cd-46a8-89d6-fc0db150e41e"
  % Total    % Received % Xferd  Average Speed   ...
100      9  100      9    0      0     56      0
$ file image.png
image.png: ASCII text, with no line terminators
$ cat image.png
Not Found
```

HTTP status is 200, content is "Not Found" (9 bytes). No authentication error.

### What happens with authentication

```bash
$ curl -L -H "Authorization: token $(gh auth token)" \
  -o image.png "https://github.com/user-attachments/assets/f3a85d78-f0cd-46a8-89d6-fc0db150e41e"
$ file image.png
image.png: JPEG image data, ...
$ ls -la image.png
-rw-r--r-- 1 user user 560814 Mar  2 18:51 image.png
```

Success: 547KB JPEG image.

## The Cascading Failure

```
1. AI downloads image without auth → gets 9 bytes "Not Found" (ASCII)
2. `file` command shows: "ASCII text, with no line terminators"
3. System message says: "retry or skip" but instruction not strong enough
4. AI calls Read("/tmp/issue_screenshot.png")
5. Read tool base64-encodes "Not Found" as: "Tm90IEZvdW5k"
6. Read tool tags it with media_type: "image/png"
7. API receives: {"type": "image", "source": {"data": "Tm90IEZvdW5k", "media_type": "image/png"}}
8. API returns: 400 {"message": "Could not process image"}
9. Claude Code CLI crashes with exit code 1
```

## The Fix

The system message instruction needs to be enhanced with:

1. **Explicit identification of private GitHub image URLs**: `github.com/user-attachments/assets/`
2. **Exact authenticated download command**: `curl -L -H "Authorization: token $(gh auth token)"`
3. **Mandatory skip rule**: If `file` shows non-image content, do NOT call Read — period.

### Updated Instruction (added to existing guidance)

```
- When you see screenshots or images in issue descriptions, pull request
  descriptions, comments, or discussions, use WebFetch tool (or fetch tool)
  to download the image first, then use Read tool to view and analyze it.
  IMPORTANT: Before reading downloaded images with the Read tool, verify the
  file is a valid image (not HTML). Use a CLI tool like 'file' command to
  check the actual file format. Reading corrupted or non-image files (like
  GitHub's HTML 404 pages saved as .png) can cause "Could not process image"
  errors and may crash the AI solver process. If the file command shows "HTML"
  or "text", the download failed — do NOT call Read on this file. Instead:
  (1) For images from GitHub issues/PRs (URLs containing
      "github.com/user-attachments"), retry with authenticated download:
      curl -L -H "Authorization: token $(gh auth token)" -o <filename> <url>
  (2) If retry still fails, skip the image and note it was unavailable.
```

## Verification

The authenticated curl approach was verified against the actual failing image:
- URL: `https://github.com/user-attachments/assets/f3a85d78-f0cd-46a8-89d6-fc0db150e41e`
- Without auth: 9 bytes, "ASCII text"
- With auth: 560,814 bytes, JPEG image
