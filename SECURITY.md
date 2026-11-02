# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

- Open a private report via GitHub Security Advisories on this repository
  (<https://github.com/aonysen/dsh-memory-rag/security/advisories/new>), or
- Email the maintainer listed in `package.json`.

Include the version, a short description, and reproduction steps if possible.
You should get an initial reply within a few days.

## Scope notes

`dsh-memory-rag` runs inside the DSH host process and handles two kinds of
sensitive material:

1. **Your embedding API key.** It is written only to
   `<dataDir>/api-key` (mode 600 on POSIX) or read from an environment
   variable / DSH credentials service. The settings API never returns the key,
   only whether it is configured and where it came from.
2. **Your memory text.** Only text you explicitly write or import is sent to the
   configured embedding endpoint. Retrieval, ranking, storage and the session
   index are computed locally.

Local HTTP endpoints live under `/dsh-memory-rag/api/*` and are registered on
the host's own web server. Write operations require a loopback client and an
Origin that is the same host or the desktop shell's `dsh-app://` origin. Remote
browsers cannot use these endpoints by design.

## Supported versions

Security fixes are applied to the latest published minor version.
