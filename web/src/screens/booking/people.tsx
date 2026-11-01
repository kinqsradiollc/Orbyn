import { type TeamMember } from "@orbyn/core";
import { client } from "../../lib/session";
import { ReadState, useRead } from "./shared";
import { Field, SelectBox, Button } from "../../ui/kit";
async function readTeam(id: string) {
  const team = await client.getTeam(id);
  if (team?.id !== id)
    throw new Error("Team response does not match the selected booking space.");
  return team;
}
export function usePeople(teamId: string | null) {
  return useRead(async () => {
    const teams = await client.listTeams(),
      selected = teamId
        ? [await readTeam(teamId)]
        : await Promise.all(
            teams.filter((t) => t.role).map((t) => readTeam(t.id)),
          );
    const people = new Map<string, TeamMember>();
    for (const team of selected)
      for (const person of team.members) people.set(person.user_id, person);
    return {
      teams,
      people: [...people.values()],
      selected: teamId ? selected[0] : null,
    };
  }, [teamId]);
}
export function CoHosts({
  values,
  owner,
  people,
  onChange,
  disabled,
}: {
  values: { user_id: string; required: boolean }[];
  owner: string;
  people: ReturnType<typeof usePeople>;
  onChange: (v: { user_id: string; required: boolean }[]) => void;
  disabled: boolean;
}) {
  return (
    <section>
      <h3>Co-hosts</h3>
      <p>
        The primary host is included automatically. Collective meetings need
        required hosts free; round robin assigns one available host.
      </p>
      <ReadState read={people}>
        {values.map((v, i) => (
          <div className="booking-web-inline-fields" key={i}>
            <Field label={`Co-host ${i + 1}`}>
              <SelectBox
                value={v.user_id}
                disabled={disabled || !people.fresh}
                onChange={(e) =>
                  onChange(
                    values.map((h, n) =>
                      n === i ? { ...h, user_id: e.target.value } : h,
                    ),
                  )
                }
              >
                <option value="">Choose teammate</option>
                {v.user_id &&
                  !people.data?.people.some((p) => p.user_id === v.user_id) && (
                    <option value={v.user_id}>
                      Saved host unavailable · {v.user_id}
                    </option>
                  )}
                {people.data?.people
                  .filter(
                    (p) =>
                      p.user_id !== owner &&
                      !values.some(
                        (h, n) => n !== i && h.user_id === p.user_id,
                      ),
                  )
                  .map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.name || p.email}
                    </option>
                  ))}
              </SelectBox>
            </Field>
            <label>
              <input
                type="checkbox"
                disabled={disabled}
                checked={v.required}
                onChange={(e) =>
                  onChange(
                    values.map((h, n) =>
                      n === i ? { ...h, required: e.target.checked } : h,
                    ),
                  )
                }
              />
              Required for collective meetings
            </label>
            <Button
              disabled={disabled}
              onClick={() => onChange(values.filter((_, n) => n !== i))}
            >
              Remove co-host
            </Button>
          </div>
        ))}
        <Button
          disabled={disabled || !people.fresh || values.length >= 10}
          onClick={() => onChange([...values, { user_id: "", required: true }])}
        >
          Add co-host
        </Button>
      </ReadState>
    </section>
  );
}
