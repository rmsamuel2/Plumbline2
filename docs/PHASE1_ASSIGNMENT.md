# Phase 1 — corrected declaration assignment

Generated from `src/app/ui-modules.gen.js` at commit `462ebb7`. Line ranges are inclusive and refer to that file. Every top-level declaration in `studio/main.ts` (207 total) appears exactly once below.

This supersedes §3 of the Phase 1 document. The differences are listed in the last section.


## studio/shared/dom.ts  (17 declarations)

| lines | declaration |
|---|---|
| 18–18 | `fmt` |
| 19–19 | `fmin` |
| 30–30 | `$` |
| 31–41 | `flash` |
| 42–44 | `el` |
| 45–46 | `svg` |
| 47–47 | `clone` |
| 51–52 | `labelHash` |
| 600–601 | `hexToRgba` |
| 1089–1089 | `fieldNum` |
| 1269–1269 | `head` |
| 1270–1270 | `btn` |
| 1300–1300 | `td` |
| 1301–1301 | `inp` |
| 1302–1302 | `num` |
| 1303–1303 | `rad` |
| 1304–1304 | `chk` |

## studio/shared/workspace.ts  (61 declarations)

| lines | declaration |
|---|---|
| 8–8 | `ROLES` |
| 9–9 | `ROLE_COLOR` |
| 10–15 | `CHIPS` |
| 16–16 | `NW` |
| 17–17 | `GRID` |
| 20–20 | `docs` |
| 22–22 | `USER_DB_KEY` |
| 23–23 | `active` |
| 24–24 | `lastTool` |
| 25–25 | `panelHidden` |
| 26–26 | `sel` |
| 48–48 | `emptyOverlay` |
| 53–70 | `estimate` |
| 71–77 | `mkDoc` |
| 78–78 | `emptyWf` |
| 79–79 | `startWf` |
| 80–95 | `addAfter` |
| 158–163 | `blankWf` |
| 164–169 | `normalise` |
| 170–207 | `autoLayout` |
| 208–225 | `tidyLayout` |
| 226–236 | `placeNew` |
| 237–256 | `layoutMissing` |
| 257–257 | `D` |
| 258–276 | `SCAFFOLD` |
| 277–282 | `ensureDoc` |
| 283–283 | `outOf` |
| 284–284 | `roleOf` |
| 285–303 | `reachable` |
| 304–324 | `depthMap` |
| 325–347 | `backEdges` |
| 348–367 | `pathBetween` |
| 495–499 | `effective` |
| 500–509 | `rebuild` |
| 510–514 | `totals` |
| 605–606 | `editorWorkflowIdMap` |
| 607–609 | `editorDocTransitionKey` |
| 777–777 | `hasEditorCanvas` |
| 1307–1325 | `rename` |
| 1326–1328 | `uid` |
| 1329–1331 | `activeToolIndexes` |
| 1332–1333 | `unified` |
| 1340–1345 | `safe` |
| 1346–1402 | `ingest` |
| 1403–1403 | `editorNum` |
| 1404–1404 | `editorMid` |
| 1405–1405 | `editorKey` |
| 1406–1419 | `editorRole` |
| 1420–1425 | `editorDataSignature` |
| 1432–1432 | `isEditorData` |
| 1433–1550 | `editorDataToUnified` |
| 1674–1689 | `studioStateTypeForRole` |
| 1690–1813 | `studioDocToEditorData` |
| 2376–2376 | `toolHasComputed` |
| 2377–2377 | `toolActive` |
| 2379–2379 | `resetTools` |
| 2426–2426 | `plainDoc` |
| 2427–2443 | `hydrateDoc` |
| 2444–2450 | `persist` |
| 2451–2455 | `restoreState` |
| 2456–2459 | `commit` |

## studio/shared/auth.ts  (25 declarations)

| lines | declaration |
|---|---|
| 21–21 | `currentUser` |
| 1950–1950 | `PData` |
| 1951–1951 | `accountWorkflows` |
| 1952–1952 | `accountHistory` |
| 1953–1957 | `dataProblem` |
| 1958–1958 | `authVal` |
| 1959–1959 | `authChecked` |
| 1960–1960 | `blankProfile` |
| 1961–1961 | `profileFromInputs` |
| 1962–1971 | `broadcastAuthToEditor` |
| 1972–1978 | `logHistory` |
| 1979–1996 | `renderUserBadge` |
| 1997–1998 | `showAuth` |
| 1999–2009 | `refreshAccountData` |
| 2010–2027 | `paintAccountLists` |
| 2028–2048 | `renderAuth` |
| 2049–2071 | `createUser` |
| 2072–2086 | `signIn` |
| 2087–2099 | `signOut` |
| 2100–2115 | `changePassword` |
| 2116–2127 | `restoreSession` |
| 2128–2151 | `saveCurrentWorkflow` |
| 2152–2164 | `loadSavedWorkflow` |
| 2165–2174 | `deleteSavedWorkflow` |
| 2175–2189 | `updateProfile` |

## studio/modules/editor.ts  (10 declarations)

| lines | declaration |
|---|---|
| 27–27 | `latestEditorData` |
| 28–28 | `latestEditorSignature` |
| 29–29 | `latestEditorImportedSignature` |
| 1551–1624 | `importEditorData` |
| 1625–1645 | `requestEditorSync` |
| 1646–1671 | `setupEditorSync` |
| 1672–1672 | `studioPushTimer` |
| 1673–1673 | `lastStudioPushSignature` |
| 1814–1847 | `pushStudioToEditor` |
| 1848–1852 | `schedulePushStudioToEditor` |

## studio/modules/analysis.ts  (94 declarations)

| lines | declaration |
|---|---|
| 4–4 | `io_1` |
| 5–5 | `app_1` |
| 6–6 | `lemma_1` |
| 7–7 | `presets_1` |
| 49–50 | `ANALYSIS_STAGE_COLORS` |
| 96–96 | `dragSpec` |
| 97–138 | `makeChip` |
| 139–157 | `addChip` |
| 368–494 | `computeTool` |
| 515–515 | `EDITOR_CANVAS_SIZE` |
| 516–516 | `EDITOR_OFFSET` |
| 517–517 | `EDITOR_NODE_W` |
| 518–518 | `lastEditorScrollDoc` |
| 519–519 | `analysisViewDoc` |
| 520–520 | `analysisPan` |
| 521–521 | `analysisShowAllLines` |
| 522–522 | `analysisIncreasedSpacing` |
| 523–523 | `currentAnalysisModel` |
| 524–524 | `analysisEditorPanActive` |
| 525–525 | `clampNum` |
| 526–533 | `editorContentBounds` |
| 534–543 | `updateAnalysisZoomUi` |
| 544–544 | `applyAnalysisPanZoom` |
| 545–545 | `fitEditorAnalysisToView` |
| 546–546 | `zoomAnalysisAt` |
| 547–547 | `zoomAnalysisCenter` |
| 548–573 | `ensureAnalysisHud` |
| 574–584 | `setAnalysisPanMode` |
| 585–599 | `setupAnalysisPanZoom` |
| 602–602 | `editorVisualKey` |
| 603–604 | `editorTypeDef` |
| 610–611 | `editorBuildBuckets` |
| 612–617 | `editorCanvasLayout` |
| 618–621 | `editorRouteKind` |
| 622–623 | `editorAssignRouteLanes` |
| 624–630 | `editorMakeEdgePath` |
| 631–637 | `editorWrapText` |
| 638–638 | `editorEllipsize` |
| 639–639 | `editorLabelize` |
| 640–642 | `editorMoney` |
| 643–648 | `editorIsMainFlowTransition` |
| 649–662 | `analysisRebuildStagePanels` |
| 663–672 | `analysisScaleModel` |
| 673–673 | `analysisHasAppliedVisuals` |
| 674–692 | `analysisBuildAdaptiveModel` |
| 693–693 | `analysisSpreadModel` |
| 694–700 | `analysisTransitionRelatedToSelection` |
| 701–703 | `analysisShouldDrawTransition` |
| 704–704 | `analysisRectOverlap` |
| 705–714 | `analysisBaseObstacles` |
| 715–722 | `analysisCandidateOffsets` |
| 723–725 | `analysisCountOverlaps` |
| 726–745 | `analysisPlaceLabelAwayFromNodes` |
| 746–746 | `analysisApproxLabel` |
| 747–776 | `analysisOverlapScore` |
| 778–833 | `renderEditorAnalysisCanvas` |
| 834–835 | `edgePoint` |
| 836–1038 | `renderCanvas` |
| 1039–1056 | `renderEmpty` |
| 1057–1088 | `deleteSel` |
| 1090–1167 | `renderSigma` |
| 1168–1216 | `renderTools` |
| 1217–1267 | `renderTable` |
| 1268–1268 | `fieldRow` |
| 1271–1290 | `stateRow` |
| 1291–1299 | `transRow` |
| 1305–1306 | `ssel` |
| 1334–1338 | `syncJson` |
| 1339–1339 | `loadJson` |
| 1426–1431 | `analysisEditorViewSignature` |
| 1853–1865 | `analysisSavingsHost` |
| 1866–1892 | `stepSavingsRows` |
| 1893–1921 | `renderAnalysisSavings` |
| 1922–1949 | `runAnalysis` |
| 2190–2198 | `renderWfBar` |
| 2199–2199 | `drag` |
| 2200–2200 | `conn` |
| 2201–2201 | `connectMode` |
| 2202–2204 | `updateCtUi` |
| 2205–2206 | `toggleConnectMode` |
| 2207–2280 | `wireNode` |
| 2281–2286 | `hit` |
| 2287–2331 | `renderInspector` |
| 2332–2345 | `showTab` |
| 2346–2353 | `flashTools` |
| 2354–2370 | `applyPanel` |
| 2371–2375 | `togglePanel` |
| 2378–2378 | `syncToolButtons` |
| 2380–2411 | `runTool` |
| 2412–2424 | `applyAll` |
| 2425–2425 | `remembering` |
| 2460–2465 | `full` |
| 2466–2556 | `init` |
| 2557–2570 | `boot` |

---

## Corrections to §3 of the Phase 1 document

The document's Figure 1 asserted that dependency arrows point downward only. Measured against the source, the assignment in §3 produced **248 cross-module references including 27 upward (cycle-forming) ones**. Six of those were misassignments, not real cycles:

| Declaration | §3 said | Correct home | Why |
|---|---|---|---|
| `outOf`, `roleOf`, `reachable`, `depthMap`, `backEdges`, `pathBetween` | analysis | **workspace** | `tidyLayout` (layout, workspace) calls `depthMap`. These are graph utilities over the document model, not rendering. |
| `editorWorkflowIdMap`, `editorDocTransitionKey` | analysis | **workspace** | `studioDocToEditorData` (format conversion, workspace) calls both. They are format helpers, not canvas code. |
| `hasEditorCanvas` | analysis | **workspace** | `rebuild` calls it; it is a predicate on the document, not on the DOM. |
| `toolActive`, `toolHasComputed`, `resetTools` | analysis | **workspace** | `activeToolIndexes` (serialisation) calls `toolActive`. These read/reset per-document tool state. |
| `btn`, `head`, `td`, `inp`, `num`, `rad`, `chk`, `fieldNum` | analysis | **dom** | `paintAccountLists` (auth) calls `btn`. They are generic element builders. |
| `addAfter` | analysis | **workspace** | Mutates the document; called from chip handling and from the canvas. |

Two apparent cycles were **false positives** from whole-word matching and need no action:

- `hexToRgba` → `full` — `hexToRgba` has a local `const full` (line 600).
- `CHIPS` → `init` — the `CHIPS` array contains a property `init: true` (line 11).

### Remaining upward references — all one pattern

After the corrections above, every remaining cycle is *state changed, therefore re-render*:

| Caller (module) | Reaches up to |
|---|---|
| `commit` (workspace) | `full`, `renderCanvas`, `renderInspector`, `renderTable`, `renderTools`, `syncJson`, `syncToolButtons` |
| `ingest` (workspace) | `full`, `computeTool` |
| `ensureDoc` (workspace) | `renderWfBar` |
| `hydrateDoc` (workspace) | `computeTool` |
| `persist` (workspace) | `schedulePushStudioToEditor` |
| `importEditorData` (editor) | `renderCanvas`, `showTab`, `flashTools`, `full`, `analysisViewDoc` |
| `pushStudioToEditor` (editor) | `renderCanvas`, `analysisViewDoc` |
| `fieldRow` (dom candidate) | `syncJson` — so **leave `fieldRow` in analysis**, unlike its siblings |

### The hook design that resolves them

`workspace.ts` owns three named hook registries. Modules register on `mount`, deregister on `unmount`. No module is ever called directly by a lower layer.

```js
/* studio/shared/workspace.ts */
var hooks = { change: new Set(), recomputeTools: new Set(), pushToEditor: new Set() };

function register(kind, fn) {
  hooks[kind].add(fn);
  return function () { hooks[kind].delete(fn); };   // deregistration handle
}
function fire(kind, arg) {
  hooks[kind].forEach(function (fn) {
    try { fn(arg); } catch (e) { console.error("hook " + kind + " failed", e); }
  });
}

exports.onChange         = function (fn) { return register("change", fn); };
exports.onRecomputeTools = function (fn) { return register("recomputeTools", fn); };
exports.onPushToEditor   = function (fn) { return register("pushToEditor", fn); };

/* commit() no longer knows what rendering exists */
exports.commit = function () {
  if (active < 0) return;
  persist();
  fire("change");
};
```

Then:

- `analysis.ts` `mount`: `this.offChange = ctx.workspace.onChange(() => this.renderAll())` and `this.offTools = ctx.workspace.onRecomputeTools(d => computeToolAll(d))`. `unmount` calls both handles.
- `editor.ts` `mount`: `this.offPush = ctx.workspace.onPushToEditor(() => schedulePushStudioToEditor())`. `persist()` fires the hook instead of calling into the editor.
- `importEditorData` and `pushStudioToEditor` stay in `editor.ts` but reach Analysis through `ctx.workspace` hooks rather than by direct call. `analysisViewDoc` is analysis-owned view state; the editor should not read it — pass what it needs as the hook argument.

**When no module is mounted, hooks fire into an empty set and nothing renders.** That is correct: `commit()` still persists. This is the property that makes the split safe.

### Verified counts

| Module | Declarations |
|---|---|
| `shared/dom.ts` | 17 |
| `shared/workspace.ts` | 61 |
| `shared/auth.ts` | 25 |
| `modules/editor.ts` | 10 |
| `modules/analysis.ts` | 94 |
| **Total** | **207** |

`modules/home.ts` contains no moved declarations — it is four event handlers written fresh (§3.5 of the document).
