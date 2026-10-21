# Optional PPTX schema validation

This developer-only tool uses **DocumentFormat.OpenXml 3.3.0** (an exact NuGet version) and `OpenXmlValidator(FileFormatVersions.Office2019)` to validate real PPTX packages, including relationship/part constraints supported by the SDK. Embedded chart XLSX packages are opened separately and validated too. It is independent of the importer: importer acceptance is not evidence of a legal OOXML package.

Requires the **.NET 10 SDK** (`dotnet --info`). The first restore needs access to NuGet. No .NET dependency is added to the product, npm bundle, normal tests, or CI. Run from the repository root:

```sh
dotnet restore scripts/validate-pptx/validate-pptx.csproj
dotnet run --project scripts/validate-pptx -- packages/core/test/fixtures/pptx-smoke
# One file, multiple paths, or recursively scanned directories:
dotnet run --project scripts/validate-pptx -- file.pptx another-directory
```

The process opens inputs **read-only**, never repairs or rewrites them, and does not follow directory-entry symlinks. An explicitly supplied symlink is an error. Directory scanning finds `.pptx` case-insensitively; other files are ignored. No input, no matching files, inaccessible paths, malformed ZIP/XML, schema errors, and unsupported embedded package types fail rather than pass silently. Only embedded XLSX is currently supported; this is a corpus validation tool, not a general embedded-document validator.

Exit codes: **0** all inputs passed, **1** validation/input failure, **2** missing arguments. `--help` returns 0. Diagnostics include the package, part URI, XPath and SDK error identifier where available. Output is capped globally at 100 diagnostic lines (each 1,200 characters), with a truncation notice; truncation always preserves failure. The SDK stops after 101 errors per package, so the final count is **not** a complete error total. Limits: 128 MiB PPTX file, 64 MiB embedded XLSX, 16 MiB XML characters per part. These are practical safeguards, not a sandbox for hostile packages. Use only trusted local developer fixtures: compressed-size limits do not bound all expanded data, nested-package depth, or SDK work.

## Reproducible self-test

```sh
python3 -I scripts/validate-pptx/self-test.py
# Include the embedded-workbook negative check by supplying the chart fixture:
python3 -I scripts/validate-pptx/self-test.py packages/core/test/fixtures/pptx-smoke/cases/chart.pptx
```

The self-test builds the tool, checks a schema-valid source, then checks malformed ZIP and schema-invalid temporary copies, missing/empty inputs, directory recursion, symlink handling, and capped diagnostics. When the source has an embedded XLSX it also corrupts that workbook in a temporary copy and verifies failure. All scratch files are isolated in a new temporary directory; it hashes the original to check it was not changed.

## What a pass means

A pass is an **Open XML SDK Office2019 schema/package validation result**, not proof that every OOXML normative rule is checked, and not a PowerPoint/LibreOffice open, render, visual-fidelity, font, accessibility, or round-trip test. The SDK's compatibility-version rules apply; this tool does not promise validation of arbitrary newer Office extensions. No Office installation or downloaded third-party samples are used.
