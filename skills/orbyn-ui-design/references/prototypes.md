# Prototype a UI decision

Use a prototype only when it resolves a concrete interaction or layout question.
Define the user's task, actual target surface, relevant state and the decision
being compared. Use representative content and existing Orbyn tokens/components.

For product UI, prototype in the current React or React Native stack. For an
explanatory artifact, use the current host's supported visualization mechanism.
An interactive chat widget is not a replacement for the app implementation.
Do not assume foreign embedding tags, injected CSS variables or allowed CDNs.

Check hierarchy before decoration: one clear next action, readable labels,
consistent control sizes, coherent spacing and useful task area. Use semantic
surface/text/accent tokens so light/dark modes stay coherent. Optional controls
must not hide essential values or consequences. Preserve selection and focus.

Choose the presentation size for the content. A compact explanatory visual may
fit inline; a detailed editor or dashboard needs a full artifact or real app pane.
Avoid nested scroll traps and viewport-relative sizing that assumes the wrong
container. Measure the actual pane width, including additional side panels.

When visual inspection is authorized, inspect the changed state with realistic
text and keyboard/touch behavior. Record what the artifact demonstrates and what
still requires app/native evidence. Transfer only the chosen interaction and layout
into production; remove disposable scaffolding rather than shipping two UI paths.
