# Lever authenticated application contract

Checked 2026-09-30 23:08 CDT / 2026-10-01 04:08 UTC against [official Lever documentation](https://hire.lever.co/developer/documentation).

Primary sections checked: “Retrieve posting application questions” (GET `/v1/postings/:posting/apply`), “Apply to a posting” (POST same endpoint), “Application file upload”, and “Upload a file” (POST `/v1/uploads`). The GET schema determines required fields, types, and question order. The application request uses ordered `personalInformation` and `customQuestions` arrays, plus `urls` and `eeoResponses`. Files require a multipart upload and its returned URI. Created applications return HTTP 201 and `data.applicationId`.

Regression evidence: `lever-native-contract-red.txt` runs the same six initial fixture tests against HEAD `d72e056c9e66e3675e2dc78fd4bf8ad09cb9b1fa`, copied into temporary evidence-only files. Five failed, one passed. Temporary baseline modules/config/test copies were removed; shipped files were never reverted. `lever-native-contract.txt` records the repaired tests, including the real local HTTP multipart/apply fixture and the added inherited-object-name rejection.

All applicant data, provider IDs, and credentials in these tests are synthetic. The injected test transport maps fixed Lever endpoint paths to one loopback server; no real employer submission occurs.
