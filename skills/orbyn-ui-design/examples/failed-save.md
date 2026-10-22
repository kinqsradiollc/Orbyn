# Worked example: a draft survives failure

Synthetic UI brief. The consuming product uses a green accent, comfortable
spacing and existing web/native form controls. No browser or device is available.

## Worked result

The editor owns the unsaved title; the server owns the saved title and version.
Keep those separate. While saving, prevent accidental repeat submission and show
the pending state without removing the draft. An offline failure keeps text,
selection and a useful focus target. Put Retry near the failed action.

On reconnect, retry with the original expected version. If another client changed
the title, show a conflict with both versions and a deliberate recovery choice.
Do not silently overwrite the newer value or clear the draft because the request
finished. A successful save can update the local baseline and clear dirty state.

| State             | Visible response                         | Work retained                        |
| ----------------- | ---------------------------------------- | ------------------------------------ |
| Saving            | Pending action                           | Draft and selection                  |
| Offline failure   | Inline explanation and Retry             | Full draft                           |
| Version conflict  | Current saved value and recovery choices | User's proposed title                |
| Confirmed success | Saved state                              | Returned authoritative value/version |

Use the existing green tokens and spacing. Adapt to the actual narrow pane and
keyboard; wrap a long title without shrinking text to conceal overflow. Preserve
keyboard focus and accessible error association. Web and native controls may
look different while following the same durable state contract.

**Evidence plan.** Once authorized tools exist, inspect failure, retry, conflict,
focus return and long content at the relevant widths. A design/source review does
not prove rendering, screen-reader behavior or installed-device behavior.

**Failure example.** Close the editor on any response and show a generic toast,
losing the draft. Repainting the form in a library's default blue does not solve
the state problem.

**Reuse.** Resolve the [project context](../../orbyn-setup/references/project-context.md)
and fill the [task record](../../orbyn-workflow/references/task-record.md).
