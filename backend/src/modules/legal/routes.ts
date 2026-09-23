import type { FastifyInstance, FastifyRequest } from "fastify";
import argon2 from "argon2";
import {
  LEGAL_DEFAULTS,
  LEGAL_DOCS,
  MINIMUM_AGE,
  acceptTermsInput,
  agreementVersion,
  deleteAccountInput,
  fail,
  legalMissing,
  legalSettingsUpdate,
  nextLegalVersion,
  privacyUpdate,
  renderLegal,
  type ConsentEntry,
  type LegalAdminView,
  type LegalDoc,
  type LegalSummary,
  type PrivacyView,
} from "@orbyn/core";
import { pool, transaction, type Db } from "../../db/pool.js";
import {
  LAST_ADMIN,
  deleteAccount,
  otherActiveAdmins,
} from "../../lib/accounts.js";
import { audit } from "../../lib/audit.js";
import { authenticate, authorize, type UserRow } from "../../lib/auth.js";
import { strictRateLimit } from "../../lib/params.js";
import { invalidateSettings, settings } from "../../lib/settings.js";

const userAgent = (r: FastifyRequest) =>
  String(r.headers["user-agent"] ?? "").slice(0, 400);

const logConsent = (
  db: Db | typeof pool,
  userId: string,
  kind: ConsentEntry["kind"],
  version: string | null,
  granted: boolean,
  ua: string,
) =>
  db.query(
    "INSERT INTO consent_log (user_id, kind, version, granted, user_agent) VALUES ($1, $2, $3, $4, $5)",
    [userId, kind, version, granted, ua],
  );

/**
 * Terms, privacy and consent: the public documents, accepting a version,
 * the usage-analytics choice, deleting your own account, and the admin
 * editor that publishes new versions.
 */
export async function legalRoutes(app: FastifyInstance) {
  // Anyone may read who runs the service and which versions are current.
  app.get("/legal", async (): Promise<LegalSummary> => {
    const l = (await settings()).legal;
    return {
      company: l.company,
      contact_email: l.contact_email,
      terms_version: agreementVersion(l),
      privacy_version: l.privacy.version,
      minimum_age: MINIMUM_AGE,
    };
  });

  app.get("/legal/:doc", async (r) => {
    const doc = (r.params as { doc: string }).doc as LegalDoc;
    if (!LEGAL_DOCS.includes(doc)) fail(404, "There's no such document.");
    return renderLegal(doc, (await settings()).legal);
  });

  app.post("/me/consent", async (r) => {
    const u = await authenticate(r);
    const d = acceptTermsInput.parse(r.body ?? {});
    const current = agreementVersion((await settings()).legal);
    if (d.terms_version !== current)
      fail(
        409,
        "The Terms have changed since this page loaded. Reload and review them.",
      );
    await transaction(async (db) => {
      await db.query(
        "UPDATE users SET terms_version = $2, terms_accepted_at = now() WHERE id = $1",
        [u.id, current],
      );
      await logConsent(db, u.id, "terms", current, true, userAgent(r));
    });
    return { terms_version: current };
  });

  const privacyView = async (u: UserRow): Promise<PrivacyView> => {
    const [row, history] = await Promise.all([
      pool.query<{
        terms_version: string | null;
        terms_accepted_at: Date | null;
        analytics_opt_out: boolean;
      }>(
        "SELECT terms_version, terms_accepted_at, analytics_opt_out FROM users WHERE id = $1",
        [u.id],
      ),
      pool.query<{
        kind: ConsentEntry["kind"];
        version: string | null;
        granted: boolean;
        at: Date;
      }>(
        "SELECT kind, version, granted, at FROM consent_log WHERE user_id = $1 ORDER BY at DESC, id DESC LIMIT 50",
        [u.id],
      ),
    ]);
    const me = row.rows[0];
    return {
      terms_version: me.terms_version,
      terms_accepted_at: me.terms_accepted_at?.toISOString() ?? null,
      current_terms_version: agreementVersion((await settings()).legal),
      analytics_opt_out: me.analytics_opt_out,
      history: history.rows.map((h) => ({
        kind: h.kind,
        version: h.version,
        granted: h.granted,
        at: h.at.toISOString(),
      })),
    };
  };

  app.get("/me/privacy", async (r) => privacyView(await authenticate(r)));

  app.put("/me/privacy", async (r) => {
    const u = await authenticate(r);
    const d = privacyUpdate.parse(r.body ?? {});
    await transaction(async (db) => {
      const changed = await db.query(
        "UPDATE users SET analytics_opt_out = $2 WHERE id = $1 AND analytics_opt_out <> $2",
        [u.id, d.analytics_opt_out],
      );
      if (changed.rowCount)
        await logConsent(
          db,
          u.id,
          "analytics",
          null,
          !d.analytics_opt_out,
          userAgent(r),
        );
      // Turning analytics off also clears what was already counted.
      if (d.analytics_opt_out)
        await db.query("DELETE FROM daily_activity WHERE user_id = $1", [u.id]);
    });
    return privacyView(u);
  });

  // Delete your own account. The password guards it (or, for an account
  // with no password, typing its email address).
  app.delete("/me", strictRateLimit, async (r, reply) => {
    const u = await authenticate(r);
    const d = deleteAccountInput.parse(r.body ?? {});
    const hasPassword = !!u.password_hash;
    if (hasPassword) {
      if (!d.password) fail(422, "Enter your password to delete your account.");
      if (!(await argon2.verify(u.password_hash, d.password)))
        fail(401, "That password isn't right.");
    } else if (d.confirm_email?.toLowerCase() !== u.email)
      fail(422, "Type your email address to delete your account.");
    await transaction(async (db) => {
      await db.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [u.id]);
      if (u.role === "admin" && (await otherActiveAdmins(u.id, db)) === 0)
        fail(
          409,
          `${LAST_ADMIN} Make someone else an admin before you delete your account.`,
        );
      await deleteAccount(db, u.id);
      await audit(
        {
          actorId: null,
          action: "user.deleted_self",
          targetType: "user",
          targetId: u.id,
          details: { email: u.email },
        },
        db,
      );
    });
    return reply.code(204).send();
  });

  const adminView = async (): Promise<LegalAdminView> => {
    const l = (await settings()).legal;
    const counts = (
      await pool.query<{ users: number; accepted: number; opted_out: number }>(
        `SELECT count(*)::int AS users,
                count(*) FILTER (WHERE terms_version = $1)::int AS accepted,
                count(*) FILTER (WHERE analytics_opt_out)::int AS opted_out
           FROM users`,
        [agreementVersion(l)],
      )
    ).rows[0];
    return {
      settings: l,
      defaults: LEGAL_DEFAULTS,
      missing: legalMissing(l),
      accepted_current: counts.accepted,
      users: counts.users,
      analytics_opted_out: counts.opted_out,
    };
  };

  app.get("/admin/legal", async (r) => {
    await authorize(r, "system:manage");
    return adminView();
  });

  app.put("/admin/legal", async (r) => {
    const actor = await authorize(r, "system:manage");
    const d = legalSettingsUpdate.parse(r.body ?? {});
    const next = structuredClone((await settings()).legal);
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    if (d.company !== undefined) next.company = d.company;
    if (d.contact_email !== undefined) next.contact_email = d.contact_email;
    if (d.jurisdiction !== undefined) next.jurisdiction = d.jurisdiction;
    if (d.processors !== undefined) next.processors = d.processors;
    if (d.terms_body !== undefined) next.terms.body = d.terms_body;
    if (d.privacy_body !== undefined) next.privacy.body = d.privacy_body;
    for (const doc of d.publish ?? []) {
      // Always newer than the current agreement, so everyone is asked again.
      next[doc].version = nextLegalVersion(agreementVersion(next), today);
      next[doc].updated_at = now;
    }
    await transaction(async (db) => {
      await db.query(
        `INSERT INTO system_settings (key, value, updated_by, updated_at)
           VALUES ('legal', $1, $2, now())
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [JSON.stringify(next), actor.id],
      );
      await audit(
        {
          actorId: actor.id,
          action: d.publish?.length
            ? "system.legal_published"
            : "system.legal_updated",
          targetType: "system",
          targetId: "legal",
          details: {
            published: Object.fromEntries(
              (d.publish ?? []).map((doc) => [doc, next[doc].version]),
            ),
            changed: Object.keys(d).filter((k) => k !== "publish"),
          },
        },
        db,
      );
    });
    invalidateSettings();
    return adminView();
  });
}
