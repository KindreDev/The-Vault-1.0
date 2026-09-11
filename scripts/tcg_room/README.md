# TCG room Blender pipeline

This pipeline intentionally talks to the open interactive Blender session. It
has no command-line Blender or headless fallback.

With Blender's MCP bridge listening on `localhost:9889`, run:

```powershell
python scripts/tcg_room/mcp_client.py scripts/tcg_room/build_checkpoint.py --timeout 1800
```

The base checkpoint builds all room-shell and furniture assets IDs 01-24,
preserves the accepted `glass_cabinet_tall`, and builds all 18 reusable material
map sets. The collection checkpoint then adds IDs 25-27 and 29-41 while leaving
the accepted `glass_cabinet_tall` untouched:

```powershell
python scripts/tcg_room/mcp_client.py scripts/tcg_room/build_collection_batch.py --timeout 1800
```

Together these checkpoints produce exactly 41 validated GLBs, with 16 assets
remaining unpublished. Heavy output is written beneath the configured Vault
`DATA_DIR/modules/tcg-room/1.0.0` folder.

The final live-session checkpoint preserves those 41 GLBs, builds assets 42-57,
re-import validates the new batch, renders technology/mail/decor assemblies,
and publishes a verified local 57-asset module only when every gate passes:

```powershell
python scripts/tcg_room/mcp_client.py scripts/tcg_room/build_final_batch.py --timeout 1800
```

The installed manifest intentionally keeps `base_url` empty: it describes the
verified local module and must not be mistaken for a remotely downloadable
distribution until a real hosting URL exists.
It writes exactly one GLB per asset ID; large furniture keeps separately named
LOD0 and LOD1 node hierarchies inside that one GLB.
The generated report records export settings, checksums, geometry data, and
clean-collection GLB re-import validation. It deliberately leaves the module
and all assets unpublished until the remaining 32 production assets exist.
