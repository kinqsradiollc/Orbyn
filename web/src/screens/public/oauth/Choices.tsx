import {
  AGENT_ACCESS,
  AGENT_ACCESS_LABELS,
  AGENT_HIDE_OUTSIDE_TEXT,
  AGENT_TOOLSET_LABELS,
  durationText,
  type AgentToolset,
  type OAuthCheck,
} from "@orbyn/core";
import { Button, Field, Input, SelectBox } from "../../../ui/kit";
import {
  expiryChoices,
  optionalToolsets,
  teamNote,
  wider,
  type Choices as Selection,
} from "./model";
export function Choices({
  check,
  value,
  search,
  onSearch,
  onChange,
  disabled,
}: {
  check: OAuthCheck;
  value: Selection;
  search: string;
  onSearch: (text: string) => void;
  onChange: (next: Selection) => void;
  disabled: boolean;
}) {
  const account = check.account!;
  const update = <K extends keyof Selection>(key: K, next: Selection[K]) =>
    onChange({ ...value, [key]: next });
  const matched = account.teams.filter((t) =>
      t.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    ),
    days = expiryChoices(account.max_grant_days),
    seconds = check.access_token_lifetime_seconds;
  const toggleTool = (name: AgentToolset, on: boolean) =>
    update(
      "toolsets",
      on
        ? [...new Set([...value.toolsets, name])]
        : value.toolsets.filter((t) => t !== name),
    );
  return (
    <fieldset className="connect-choices" disabled={disabled}>
      <legend>Your choices</legend>
      <section aria-labelledby="connect-access">
        <h2 id="connect-access">Access</h2>
        <p>
          Requested:{" "}
          <strong>{AGENT_ACCESS_LABELS[check.requested_access].name}</strong>.
          Selected: <strong>{AGENT_ACCESS_LABELS[value.access].name}</strong>.
        </p>
        {wider(value.access, check.requested_access) && (
          <p className="connect-warning" role="status">
            You selected more access than this app requested. Allowing shares
            that wider access; change access also requires recent confirmation.
          </p>
        )}
        <div className="connect-options">
          {AGENT_ACCESS.map((level) => (
            <label className="connect-option" key={level}>
              <input
                type="radio"
                name="connect-access"
                checked={value.access === level}
                onChange={() => update("access", level)}
              />
              <span>
                <strong>{AGENT_ACCESS_LABELS[level].name}</strong>
                <span className="small">
                  {AGENT_ACCESS_LABELS[level].blurb}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>
      <section aria-labelledby="connect-spaces">
        <h2 id="connect-spaces">Spaces</h2>
        <label className="connect-option">
          <input
            type="checkbox"
            checked={value.personal}
            onChange={(e) => update("personal", e.target.checked)}
          />
          <span>Personal</span>
        </label>
        {account.teams.length > 0 && (
          <>
            <Field label="Find a team">
              <Input
                type="search"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
              />
            </Field>
            <p className="small">
              {value.teams.length} teams selected · up to 50
            </p>
            <div className="connect-options">
              {matched.map((team) => (
                <label className="connect-option" key={team.id}>
                  <input
                    type="checkbox"
                    disabled={
                      team.agent_access === "off" &&
                      !value.teams.includes(team.id)
                    }
                    checked={value.teams.includes(team.id)}
                    onChange={(e) =>
                      update(
                        "teams",
                        e.target.checked
                          ? [...new Set([...value.teams, team.id])]
                          : value.teams.filter((id) => id !== team.id),
                      )
                    }
                  />
                  <span>
                    <strong dir="auto">{team.name}</strong>
                    <span className="small">
                      {team.role} · {teamNote(team)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {!matched.length && <p>No teams match your search.</p>}
          </>
        )}
        {value.teams.some(
          (id) =>
            !account.teams.some((t) => t.id === id && t.agent_access !== "off"),
        ) && (
          <div>
            <p role="alert">
              A selected team is no longer available to agents. Remove it before
              allowing.
            </p>
            <Button
              onClick={() =>
                update(
                  "teams",
                  value.teams.filter((id) =>
                    account.teams.some(
                      (t) => t.id === id && t.agent_access !== "off",
                    ),
                  ),
                )
              }
            >
              Remove unavailable teams
            </Button>
          </div>
        )}
        {!value.personal && !value.teams.length && (
          <p role="alert">Choose Personal or at least one team.</p>
        )}
      </section>
      <section aria-labelledby="connect-tools">
        <h2 id="connect-tools">Tools and safeguards</h2>
        <p className="small">{AGENT_TOOLSET_LABELS.core.name} are included.</p>
        {optionalToolsets.map((name) => (
          <label className="connect-option" key={name}>
            <input
              type="checkbox"
              checked={value.toolsets.includes(name)}
              onChange={(e) => toggleTool(name, e.target.checked)}
            />
            <span>
              <strong>{AGENT_TOOLSET_LABELS[name].name}</strong>
              <span className="small">{AGENT_TOOLSET_LABELS[name].blurb}</span>
            </span>
          </label>
        ))}
        <label className="connect-option">
          <input
            type="checkbox"
            checked={value.bookings}
            onChange={(e) => update("bookings", e.target.checked)}
          />
          <span>
            <strong>Bookings and guest details</strong>
            <span className="small">
              {AGENT_TOOLSET_LABELS.booking.blurb} Recent confirmation is
              required.
            </span>
          </span>
        </label>
        {value.bookings && !check.requested_bookings && (
          <p className="connect-warning">
            This app did not request booking access. You are choosing to add it.
          </p>
        )}
        <label className="connect-option">
          <input
            type="checkbox"
            checked={value.notify}
            onChange={(e) => update("notify", e.target.checked)}
          />
          <span>
            <strong>Let it notify teammates</strong>
            <span className="small">
              When off, actions that tell teammates wait for your review.
            </span>
          </span>
        </label>
        <label className="connect-option">
          <input
            type="checkbox"
            checked={value.hideOutside}
            onChange={(e) => update("hideOutside", e.target.checked)}
          />
          <span>
            <strong>Hide outside content</strong>
            <span className="small">{AGENT_HIDE_OUTSIDE_TEXT}</span>
          </span>
        </label>
      </section>
      <section aria-labelledby="connect-expiry">
        <h2 id="connect-expiry">Expiry and renewal</h2>
        <Field label="Connection expires after">
          <SelectBox
            value={value.days}
            onChange={(e) => update("days", Number(e.target.value))}
          >
            {!days.includes(value.days) && (
              <option value={value.days} disabled>
                {value.days} days · no longer allowed
              </option>
            )}
            {days.map((d) => (
              <option value={d} key={d}>
                {d === 365 ? "One year" : `${d} days`}
              </option>
            ))}
          </SelectBox>
        </Field>
        <p className="small">
          This server permits at most {account.max_grant_days} days.
        </p>
        {(check.can_stay_connected === true || value.stayConnected) && (
          <label className="connect-option">
            <input
              type="checkbox"
              checked={value.stayConnected}
              onChange={(e) => update("stayConnected", e.target.checked)}
            />
            <span>
              <strong>Stay connected</strong>
              <span className="small">
                Allow automatic token renewal. You can disconnect the app in
                Settings.
              </span>
            </span>
          </label>
        )}
        {value.stayConnected && check.can_stay_connected !== true && (
          <p role="alert">
            Automatic renewal is no longer available. Refresh the request before
            continuing.
          </p>
        )}
        {(check.can_stay_connected
          ? !value.stayConnected
          : check.requested_offline_access === false) &&
          typeof seconds === "number" &&
          Number.isFinite(seconds) &&
          seconds > 0 && (
            <p role="status">
              Without renewal, this sign-in lasts up to{" "}
              {durationText(Math.ceil(seconds / 60))}; reconnect from the app
              afterward.
            </p>
          )}
      </section>
    </fieldset>
  );
}
