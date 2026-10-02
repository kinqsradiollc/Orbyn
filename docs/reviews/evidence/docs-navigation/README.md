# Native document navigation evidence

Captured2 October2026 on the owned iOS18.5 narrow simulator, synthetic
native-models-24419a9@example.test account only. Current clean Docs checkout
93ad2e2 reconciles maine1d46af; owned Metro PID26907 has its working directory
in that checkout's mobile app. UI changes are not whole-app acceptance.

`native-inline-fragment.png` records the visible result after tapping the
same-page **Jump to result** inline link. Before tapping, First section and
Keep this section folded were both folded. The result is visible, its containing
section is expanded, and the unrelated section remains folded. Fresh native
accessibility state independently confirmed the Result and body text plus the
unrelated Unfold control. Reopening the page through its visible library entry
restored top position after simulator scroll/drag APIs failed. No clipboard,
paste or typeText was used.

This proves that native iOS interaction only. Web/mobile-web, native Android,
cross-page fragment races, all D1 Markdown/Mermaid and U1 surfaces require their
own current proof. The saved browser preview denial remains respected.
