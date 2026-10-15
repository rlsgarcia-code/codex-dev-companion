# Third-party notices

Every production build derives its third-party inventory from the esbuild input graph and adds the platform-specific ChromaDB native binding explicitly. The build then:

- rejects dependencies without a usable SPDX license declaration;
- rejects license expressions outside the reviewed `MIT`, `ISC`, and `Apache-2.0` allowlist;
- rejects dependencies for which no license or notice text is available;
- writes a deterministic machine-readable manifest to `dist/licenses/third-party-manifest.json`;
- writes the corresponding full texts to `dist/licenses/THIRD_PARTY-LICENSES.txt`.

Both generated files are included in the VSIX. Source-only license overrides under `licenses/overrides/` cover packages whose published npm archives declare a license but omit its text.

The platform-specific ChromaDB binding currently declares MIT in its npm metadata but does not publish a standalone license file. The build records that condition in the manifest and includes the authoritative upstream Chroma Apache-2.0 text as a conservative additional notice. This is an explicit compliance warning, not an inferred license substitution.
