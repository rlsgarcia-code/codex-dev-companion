# License text overrides

These files are used only when an npm archive declares a reviewed SPDX license but omits the corresponding text. Keep each file byte-for-byte aligned with an authoritative upstream source and review it whenever the bundled package version changes.

| Package | Bundled version | Declared license | Authoritative source |
| --- | --- | --- | --- |
| `@cfworker/json-schema` | `4.1.1` | MIT | <https://github.com/cfworker/cfworker/blob/main/LICENSE.md> |
| `js-tiktoken` | `1.0.21` | MIT | <https://github.com/dqbd/tiktoken/blob/main/LICENSE> |
| `langsmith` | `0.9.0` | MIT | <https://github.com/langchain-ai/langsmith-sdk/blob/main/LICENSE> |

Do not add an override for a package with no license declaration, an unreviewed expression, or ambiguous upstream licensing. The build must continue to fail in those cases.
