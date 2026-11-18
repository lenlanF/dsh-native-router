#!/usr/bin/env python3
"""Read-only public Git tree privacy audit.

Scans *tracked* files only. Never reads personal DSH profiles, AppData, HOME
contents, environment variables or credential stores. Reports file and line
but NEVER prints possible secret values, substrings or original snippets.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

HIGH_CONFIDENCE = (
    ("GITHUB_TOKEN", re.compile(rb"\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}")),
    ("OPENAI_OR_ANTHROPIC_KEY", re.compile(rb"\b(?:sk-proj-|sk-ant-|sk-)[A-Za-z0-9_-]{24,}")),
    ("AWS_ACCESS_KEY", re.compile(rb"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("GOOGLE_API_KEY", re.compile(rb"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("NPM_TOKEN", re.compile(rb"\bnpm_[A-Za-z0-9]{28,}")),
    ("GITLAB_TOKEN", re.compile(rb"\bglpat-[A-Za-z0-9_-]{18,}")),
    ("SLACK_TOKEN", re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{25,}")),
    ("JWT_LITERAL", re.compile(rb"\beyJhbGciOi[A-Za-z0-9_-]{40,}\b")),
    ("PRIVATE_KEY", re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----")),
    ("TOKEN_IN_AUTH_HEADER", re.compile(rb"Bearer\s+[A-Za-z0-9._~-]{36,}", re.I)),
    ("INLINE_SECRET", re.compile(
        rb"(?:access_?token|refresh_?token|client_?secret|api_?key|auth_?token|password)"
        rb"\s*[:=]\s*['\"\\x60][^'\"\\x60\r\n]{24,}['\"\\x60]", re.I)),
    ("WINDOWS_PRIVATE_HOME", re.compile(rb"\b[A-Za-z]:\\(?:Users|Documents and Settings|\xe7\x94\xa8\xe6\x88\xb7)\\[^\\\r\n\s]{2,80}", re.I)),
    ("LINUX_PRIVATE_HOME", re.compile(rb"(?:/home|/Users)/[A-Za-z0-9._-]{2,}/(?:\.config|\.ssh|AppData|Documents|Downloads)/")),
    ("CREDENTIALS_IN_URL", re.compile(rb"https?://[^\\s:@/]{1,120}:[^\\s@/]{8,120}@[A-Za-z0-9.-]{2,160}", re.I)),
)
# Only names and paths; all data below is synthetic. A text example containing
# "user:password@...example.test" must not accidentally be treated as live auth.
ALLOWED_EXAMPLE_DOMAINS = (
    b"example.invalid", b"example.test", b"example.com",
    b"localhost.invalid", b"localhost", b"127.0.0.1",
)
SUSPICIOUS_FILE = re.compile(
    r"(?:^|/)(?:\.env(?:\..*)?|config\.json|(?:auth|credentials?|tokens?|sessions?|account-pool|accounts|checkins|workbuddy-sources)[^/]*\.json"
    r"|[^/]*\.(?:pem|p8|p12|pfx|key|keystore)|DEVELOPMENT_LOG\.md)$", re.I
)


def looks_like_private_email(data: bytes) -> bool:
    for found in re.finditer(rb"\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b", data):
        domain = found.group(1).lower()
        if domain not in ALLOWED_EXAMPLE_DOMAINS and not domain.endswith(b".example.invalid") \
           and not domain.endswith(b".example.test") and not domain.endswith(b".noreply.github.com"):
            return True
    return False


def detect(data: bytes) -> list[tuple[str, int]]:
    hits: list[tuple[str, int]] = []
    for kind, regexp in HIGH_CONFIDENCE:
        for match in regexp.finditer(data):
            if kind == "CREDENTIALS_IN_URL":
                try:
                    host = (urlsplit(match.group(0).decode("ascii")).hostname or "").lower()
                    if host in {"localhost", "127.0.0.1"} or host.endswith(
                        (".example.invalid", ".example.test", ".example.com")
                    ):
                        continue  # Explicitly synthetic URL example only.
                except (ValueError, UnicodeDecodeError):
                    pass
            hits.append((kind, data.count(b"\n", 0, match.start()) + 1))
    if looks_like_private_email(data):
        hits.append(("PRIVATE_EMAIL", 0))
    return hits


def scan(root: Path) -> tuple[int, int, list[tuple[str, str, int]]]:
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "--cached", "-z"],
        check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    paths = [p.decode("utf-8") for p in result.stdout.split(b"\0") if p]
    problems: list[tuple[str, str, int]] = []
    for filename in paths:
        if SUSPICIOUS_FILE.search(filename):
            problems.append((filename, "FORBIDDEN_TRACKED_PATH", 0))
            continue
        path = root / filename
        if not path.is_file():
            problems.append((filename, "TRACKED_FILE_MISSING", 0))
            continue
        data = path.read_bytes()
        for kind, line in detect(data):
            problems.append((filename, kind, line))
    return len(paths), sum((root / p).stat().st_size for p in paths if (root / p).is_file()), problems


def self_test() -> None:
    assert ("GITHUB_TOKEN", 1) in detect(b"github_pat_" + b"A" * 30)
    assert ("PRIVATE_KEY", 1) in detect(b"-----BEGIN " + b"PRIVATE KEY-----")
    assert ("WINDOWS_PRIVATE_HOME", 1) in detect(b"C:\\Users\\SensitivePerson\\AppData")
    assert detect(b"const example = 'https://api.example.invalid/v1';") == []
    assert detect(b"const example = 'env:FAKE_API_KEY';") == []
    assert looks_like_private_email(b"contact@" + b"private-domain.example") is True
    assert looks_like_private_email(b"person@example.invalid") is False
    assert SUSPICIOUS_FILE.search("plugins/dsh-native-router/workbuddy-sources.json")
    assert not SUSPICIOUS_FILE.search("config.example.json")
    print("PASS: privacy rules self-test; no credential strings printed")


if __name__ == "__main__":
    cli = argparse.ArgumentParser()
    cli.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    cli.add_argument("--self-test", action="store_true")
    options = cli.parse_args()
    if options.self_test:
        self_test()
        sys.exit(0)
    project = options.root.resolve()
    number, size, findings = scan(project)
    print(f"Inspected tracked public files: {number}; bytes: {size}")
    if findings:
        print(f"BLOCKED: {len(findings)} potential secret/privacy exposures.")
        # Intentionally do NOT print the matched value, original line, or snippet.
        for path, reason, line in findings[:50]:
            print(f"{path}:{line}: {reason}")
        sys.exit(1)
    print("PASS: no matching high-confidence secret, private home path, or tracked state files")
