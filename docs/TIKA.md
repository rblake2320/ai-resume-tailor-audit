# Apache Tika document extraction — October 1, 2026

The résumé upload now supports PDF, DOCX, legacy DOC, RTF, ODT, UTF-8 TXT and
Markdown. Binary document formats use Apache Tika 4.1.0 through the fixed private
endpoint `http://127.0.0.1:9998/tika/json/text`; only extracted text is returned.
Author metadata, file names, parser exception contents and uploaded bytes are
excluded from tester analytics. Uploading does not invoke an AI provider.

Run `npm run tika:start` with Docker Desktop running. `npm run tika:stop` stops
only the dedicated parser stack. The containers restart with Docker after a reboot;
the pilot recovery command also starts this dedicated stack. The parser image and
the small Nginx gateway image are pinned by digest in `tika/compose.yaml`.
`npm run test:tika:live` generates synthetic documents and executes real extraction
and refusal checks. `python scripts/pilot-tika-acceptance.py` tests the real hosted
upload without generation/model calls.

Tika itself has no public port, internet route, host data mount, provider credential
or Docker socket. It runs as an unprivileged user on an internal Docker network,
with read-only root filesystem, dropped capabilities, no privilege escalation,
one CPU, 1 GiB container memory and one 256 MiB parse JVM. Its temporary filesystem
is explicitly capped at 256 MiB and disappears on container replacement. A separate
64 MiB unprivileged Nginx gateway publishes only host loopback port 9998, passes
bytes to the fixed extraction endpoint and rejects configuration/batch/other paths.
Gateway access logging is disabled; Tika exception messages are redacted.

Input limit is 10 MiB. Parser time limits, a 25-second client deadline, single
in-flight admission, bounded 512 KiB JSON response and 100,000-character text cap
contain expensive documents. Detected media type must match the upload extension;
empty text, parser exceptions, deadline flags, truncation and exceeded write limits
withhold the extraction. Failures preserve the existing résumé in the browser.
Scanned or encrypted documents need a readable text copy. OCR, image understanding
and external model enrichment are not enabled.

The default PDF path is Tika. An operator may explicitly set
`RESUME_FOUNDRY_DOCUMENT_PARSER=unpdf` for the existing PDF-only native path;
Word/RTF/ODT still require Tika. Parser failure never switches providers silently.
The invite pilot explicitly selects Tika.

Apache's current documentation describes fork-isolated parsing and warns that
Tika Server itself supplies no authorization boundary. The application/gateway
and container controls above are separate from those parser features.
[Official server documentation](https://tika.apache.org/docs/4.1.x/using-tika/server/index.html),
[security model](https://tika.apache.org/docs/4.1.x/security.html),
[official release](https://tika.apache.org/download).

Real Windows-hosted Docker extraction receipts cover PDF, DOCX, RTF, ODT and an
Apache legacy DOC test document, plus malformed PDF, disguised ZIP and forbidden
configuration/batch paths. Linux CI also starts the pinned containers and runs the
synthetic receiving checks. See `docs/evidence/2026-10-01/tika-*` for retained
receipts; unit validation and real container/browser outcomes are distinguished.
