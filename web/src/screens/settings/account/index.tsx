import { HttpError, sectionKey } from "@orbyn/core";
import { useRef, useState } from "react";
import { useAccount } from "../../../app/account";
import { client } from "../../../lib/session";
import { useNavigate } from "../../../lib/router";
import { messageOf } from "../../../lib/resource";
import { Button, ErrorNotice } from "../../../ui/kit";
import { SettingsSection, useSettingsExit, useSettingsOwner } from "../shared";
import { TwoStep } from "./TwoStep";
import { Passkeys } from "./Passkeys";
import { Sessions } from "./Sessions";
import { Devices } from "./Devices";
import { Preferences } from "./Preferences";
import "./account.css";

export function AccountSettings() {
  const navigate = useNavigate();
  const account = useAccount(),
    owner = useSettingsOwner(),
    lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState<boolean | null>(null),
    [error, setError] = useState("");
  useSettingsExit({
    pending: busy,
    dirty: unknown !== null,
    message: "Check the saved notification preference before leaving.",
  });
  const saveEmail = async (value: boolean) => {
    if (!owner() || lock.current || !account.user || unknown !== null) return;
    const id = account.user.id;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await client.updatePreferences({
        email_reminders: value,
      });
      if (!owner()) return;
      if (receipt.id !== id || receipt.email_reminders !== value)
        throw Error("The saved account preference doesn't match this choice.");
      await account.refresh();
    } catch (failure) {
      if (owner()) {
        if (
          !(failure instanceof HttpError) ||
          failure.statusCode >= 500 ||
          [408, 429].includes(failure.statusCode)
        )
          setUnknown(value);
        setError(messageOf(failure, "Couldn't save email reminders."));
      }
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const check = async () => {
    if (!owner() || lock.current || unknown === null) return;
    const expected = unknown,
      id = account.user?.id;
    lock.current = true;
    setBusy(true);
    try {
      const current = await client.me({ fresh: true });
      if (!owner()) return;
      if (current.id === id && current.email_reminders === expected) {
        setUnknown(null);
        setError("");
        await account.refresh();
      } else
        setError(
          "The saved account doesn't confirm this preference. The earlier request has not been resent.",
        );
    } catch (failure) {
      if (owner())
        setError(messageOf(failure, "Couldn't check the saved account."));
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  return (
    <div className="settings-account">
      <SettingsSection title="Your account">
        <dl className="settings-account-identity">
          <div>
            <dt>Name</dt>
            <dd dir="auto">{account.user?.name || "Loading account…"}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd dir="auto">{account.user?.email || "Unavailable"}</dd>
          </div>
        </dl>
        {account.error && (
          <ErrorNotice
            message={account.error}
            onRetry={() => void account.refresh()}
          />
        )}
      </SettingsSection>
      <Preferences />
      <SettingsSection title="Notifications">
        <label className="check">
          <input
            type="checkbox"
            checked={account.user?.email_reminders ?? false}
            disabled={busy || !account.user || unknown !== null}
            onChange={(event) => void saveEmail(event.target.checked)}
          />
          Email reminders
        </label>
        <p className="small muted">Reminders before items are due.</p>
        {error && <ErrorNotice message={error} />}
        {unknown !== null && (
          <Button disabled={busy} onClick={() => void check()}>
            Check saved preference
          </Button>
        )}
        <details>
          <summary>Push notifications</summary>
          <p>Manage push notifications in the mobile app.</p>
        </details>
      </SettingsSection>
      <div
        className="settings-account-signing"
        id="settings-signing-in"
        data-settings-section="signing in"
        tabIndex={-1}
      >
        <TwoStep />
        <Passkeys />
        <Sessions />
        <Devices />
      </div>
      <SettingsSection title="Help and account information">
        <div className="settings-account-actions">
          <div data-settings-section={sectionKey("What's new")} tabIndex={-1}>
            <Button
              variant="ghost"
              onClick={() => owner() && navigate("/changelog")}
            >
              What's new
            </Button>
          </div>
          <div
            data-settings-section={sectionKey("Service status")}
            tabIndex={-1}
          >
            <Button
              variant="ghost"
              onClick={() => owner() && navigate("/status")}
            >
              Service status
            </Button>
          </div>
          <Button
            variant="ghost"
            onClick={() => owner() && navigate("/security")}
          >
            Security information
          </Button>
          <Button
            variant="ghost"
            onClick={() => owner() && navigate("/app/settings/privacy")}
          >
            Privacy and data
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}
